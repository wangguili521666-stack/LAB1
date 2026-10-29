import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const root = fileURLToPath(new URL('../', import.meta.url))
const suffix = randomBytes(6).toString('hex')
const name = `campus-d2-test-${suffix}`
const password = randomBytes(24).toString('hex')
const appPassword = randomBytes(24).toString('hex')
let created = false
let setup

function docker(args, env = process.env) {
  const result = spawnSync('docker', args, { encoding: 'utf8', env, windowsHide: true, timeout: 30000 })
  if (result.error || result.status !== 0) throw new Error(`Docker ${args[0]} 失败：${result.stderr || result.error?.code || 'unknown'}`)
  return result.stdout.trim()
}

try {
  // 仅使用本机已有镜像，不访问项目 Compose 和数据库卷，不加载项目 .env。
  docker(['image', 'inspect', 'mysql:8.0', '--format', '{{.Id}}'])
  docker(['run', '--rm', '--detach', '--name', name, '--env', 'MYSQL_ROOT_PASSWORD', '--env', 'MYSQL_ROOT_HOST=%',
    '--publish', '127.0.0.1::3306', 'mysql:8.0'], { ...process.env, MYSQL_ROOT_PASSWORD: password })
  created = true
  console.log('已启动独立临时 MySQL，未使用项目数据卷。')
  const port = Number(docker(['port', name, '3306/tcp']).split('\n')[0].match(/:(\d+)$/)[1])
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      setup = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password, connectTimeout: 1000 })
      break
    } catch {
      if (attempt === 89) throw new Error('临时 MySQL 未在时限内就绪')
      await pause(1000)
    }
  }
  const databases = [`d2_test_${suffix}`, `d2_test_${randomBytes(6).toString('hex')}`]
  const user = 'd2_test_app'
  await setup.query('CREATE USER ?@\'%\' IDENTIFIED BY ?', [user, appPassword])
  for (const database of databases) {
    await setup.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    await setup.query(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO ?@'%'`, [user])
  }
  await setup.end()
  setup = null
  for (const [index, suite] of ['resources', 'occupancy'].entries()) {
  const child = spawn(process.execPath, ['--test', '--test-timeout=30000', `tests/integration/${suite}.test.js`], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      D2_TEST_ISOLATED: 'docker', D2_TEST_DB_NAME: databases[index], D2_TEST_DB_USER: user,
      D2_TEST_DB_HOST: '127.0.0.1', D2_TEST_DB_PORT: String(port), D2_TEST_DB_PASSWORD: appPassword
    }
  })
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolve(code ?? 1))
  })
  if (process.exitCode) break
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (setup) await setup.end().catch(() => {})
  if (created) {
    // 自动删除的只有本脚本创建的 --rm 临时容器，无挂载卷。
    try { docker(['stop', '--time', '5', name]); console.log('独立临时 MySQL 已清理。') } catch {
      console.error(`临时容器清理失败，请检查 ${name}`)
      process.exitCode = 1
    }
  }
}
