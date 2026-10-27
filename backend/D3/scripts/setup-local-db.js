import { readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { parseArgs } from 'node:util'
import mysql from 'mysql2/promise'
import { createPool } from '../src/stores/mysql.js'
import { migrate } from './migrate.js'
import { loadLocalConfig, localConfigPath } from './local-config.js'

async function passwordPrompt() {
  if (!process.stdin.isTTY) throw new Error('请在本机交互终端运行，以隐藏输入管理员密码；也可使用 --password-file 指定已有的本地密码文件')
  const hidden = new Writable({ write(chunk, encoding, done) { done() } })
  const prompt = createInterface({ input: process.stdin, output: hidden, terminal: true })
  process.stdout.write('请输入本机 MySQL 管理员密码（输入不显示，不保存该密码）：')
  try { return await prompt.question('') }
  finally { prompt.close(); process.stdout.write('\n') }
}

let admin
let pool
try {
  if (process.env.NODE_ENV === 'production') throw new Error('生产环境禁止运行本地开发库初始化')
  const { values } = parseArgs({ options: { user: { type: 'string', default: 'root' }, port: { type: 'string', default: '3306' },
    'password-file': { type: 'string' } }, strict: true })
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MySQL 端口无效')

  let hasConfig = false
  try { await readFile(localConfigPath); hasConfig = true } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!hasConfig) {
    const password = values['password-file'] ? (await readFile(values['password-file'], 'utf8')).trim() : await passwordPrompt()
    admin = await mysql.createConnection({ host: '127.0.0.1', port, user: values.user, password, connectTimeout: 3000 })
    const [databases] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', ['campus_d3_local'])
    const [accounts] = await admin.query('SELECT User FROM mysql.user WHERE User = ?', ['d3_local_app'])
    if (databases.length || accounts.length) throw new Error('同名库或账号已经存在且没有 .env.local；不会覆盖或重设密码，请核对原连接配置')
    const appPassword = randomBytes(32).toString('hex')
    const contents = `# 本机持久化开发配置；管理员密码未保存。不要提交此文件。\nPORT=3106\nDB_HOST=127.0.0.1\nDB_PORT=${port}\nDB_NAME=campus_d3_local\nDB_USER=d3_local_app\nDB_PASSWORD=${appPassword}\nD3_CORS_ORIGIN=\n`
    // 先独占保存随机应用密码，后续失败时保留配置与现场，不清库或重置账号。
    await writeFile(localConfigPath, contents, { flag: 'wx', mode: 0o600 })
    await admin.query('CREATE DATABASE campus_d3_local CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
    await admin.query("CREATE USER 'd3_local_app'@'127.0.0.1' IDENTIFIED BY ?", [appPassword])
    await admin.query("GRANT ALL PRIVILEGES ON campus_d3_local.* TO 'd3_local_app'@'127.0.0.1'")
    console.log('已建立 campus_d3_local 和仅能访问该库的 d3_local_app；应用密码仅保存在已忽略的 .env.local。')
  }
  const config = await loadLocalConfig()
  pool = createPool(config.database)
  const result = await migrate(pool)
  console.log(`迁移 ${result.filename}：${result.applied ? '已执行' : '已执行过，校验通过'}`)
  console.log('本地数据库已就绪。启动：npm.cmd run dev:local；查看：npm.cmd run db:status:local')
} catch (error) {
  console.error(error.code === 'ER_ACCESS_DENIED_ERROR' ? 'MySQL 登录失败：请核对当前管理员密码；本程序不会重置密码。' :
    error.code ? `本地数据库初始化失败：${error.code}；保留已有文件和数据库，请核对连接或迁移状态。` : error.message)
  process.exitCode = 1
} finally {
  if (pool) await pool.end()
  if (admin) await admin.end()
}
