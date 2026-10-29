import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import mysql from 'mysql2/promise'

// 只启动全新本地实例；不接触 .env 指向的数据库，不删除任何已有数据。
const executable = process.argv[2] || process.env.D3_TEST_MYSQLD
if (!executable) throw new Error('请提供 mysqld 的绝对路径：npm run test:mysql:local -- <mysqld路径>')
const root = fileURLToPath(new URL('..', import.meta.url))
const baseDir = dirname(dirname(resolve(executable)))
// Windows MySQL 的启动参数对部分非 ASCII 路径处理不正确；使用系统临时目录隔离。
const testRoot = process.platform === 'win32' && /[^\x00-\x7F]/.test(root)
  ? resolve(tmpdir(), 'd3-isolated-mysql') : resolve(root, '.mysql-test')
await mkdir(testRoot, { recursive: true })
const dataDir = await mkdtemp(resolve(testRoot, 'run-'))
await writeFile(resolve(dataDir, 'D3-LOCAL-TEST-ONLY.txt'), '本目录由 D3 隔离 MySQL 测试创建；不包含共享数据库数据。测试结束后可自行删除。\n')
// MySQL 初始化要求空目录，因此使用独立的 data 子目录。
const mysqlData = resolve(dataDir, 'data')
await mkdir(mysqlData)
const reservation = createServer()
reservation.listen(0, '127.0.0.1')
await once(reservation, 'listening')
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: 'inherit', ...options })
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`子进程退出码：${code}`)))
  })
}
console.log('正在初始化全新的本地 MySQL 测试实例（不会读取项目 .env）…')
await run(executable, ['--no-defaults', '--initialize-insecure', `--basedir=${baseDir}`, `--datadir=${mysqlData}`], { stdio: 'ignore' })
const diagnostic = createWriteStream(resolve(dataDir, 'mysql-error.log'))
const daemon = spawn(executable, ['--no-defaults', '--console', `--basedir=${baseDir}`, `--datadir=${mysqlData}`, '--bind-address=127.0.0.1',
  `--port=${port}`, '--mysqlx=0', '--skip-log-bin', '--innodb-buffer-pool-size=64M'],
{ cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
daemon.stdout.pipe(diagnostic, { end: false })
daemon.stderr.pipe(diagnostic, { end: false })
let daemonError
daemon.on('error', error => { daemonError = error })
let rootConnection
try {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (daemonError) throw daemonError
    if (daemon.exitCode !== null) throw new Error(`MySQL 提前退出，请查看 ${resolve(dataDir, 'mysql-error.log')}`)
    try { rootConnection = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', connectTimeout: 500 }); break }
    catch { await new Promise(resolve => setTimeout(resolve, 250)) }
  }
  if (!rootConnection) throw new Error('本地测试 MySQL 启动超时')
  const password = randomBytes(32).toString('hex')
  // 初始化的空口令只用于本机新实例，立即设置随机密码。
  await rootConnection.query("ALTER USER 'root'@'localhost' IDENTIFIED BY ?", [randomBytes(32).toString('hex')])
  await rootConnection.query('CREATE DATABASE d3_isolated_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
  await rootConnection.query("CREATE USER 'd3_test'@'127.0.0.1' IDENTIFIED BY ?", [password])
  await rootConnection.query("GRANT ALL PRIVILEGES ON d3_isolated_test.* TO 'd3_test'@'127.0.0.1'")
  const env = { ...process.env, D3_TEST_MYSQL: JSON.stringify({ host: '127.0.0.1', port, user: 'd3_test', password, database: 'd3_isolated_test' }) }
  const files = (await readdir(resolve(root, 'test'))).filter(name => name.endsWith('.test.js')).map(name => `test/${name}`)
  await run(process.execPath, ['--test', '--test-concurrency=1', ...files], { env })
} catch (error) {
  console.error(error.code ? `隔离测试失败：${error.code}` : error.message)
  process.exitCode = 1
} finally {
  if (rootConnection) {
    await rootConnection.query('SHUTDOWN').catch(() => {})
    await rootConnection.end().catch(() => {})
  }
  if (daemon.exitCode === null && !daemonError) {
    await Promise.race([once(daemon, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))])
    if (daemon.exitCode === null) daemon.kill()
  }
  diagnostic.end()
  console.log(`隔离实例已关闭；测试数据保留在 ${dataDir}`)
}
