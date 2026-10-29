import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse } from 'dotenv'
import { databaseConfig } from '../src/config.js'

export const localConfigPath = fileURLToPath(new URL('../.env.local', import.meta.url))

export function validateLocalConfig(values, environment = process.env) {
  if (environment.NODE_ENV === 'production') throw new Error('生产环境禁止使用本地模拟身份入口，请使用 npm start')
  if (values.DB_HOST !== '127.0.0.1' || values.DB_NAME !== 'campus_d3_local' || values.DB_USER !== 'd3_local_app') {
    throw new Error('本地模式只允许 127.0.0.1 / campus_d3_local / d3_local_app；连接团队环境请配置 .env 并使用 npm start')
  }
  const port = Number(values.PORT || 3106)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('.env.local 中 PORT 无效')
  return { database: databaseConfig(values), host: '127.0.0.1', port, corsOrigin: values.D3_CORS_ORIGIN || null }
}

export async function loadLocalConfig() {
  let contents
  try { contents = await readFile(localConfigPath, 'utf8') }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('未找到 .env.local，请先运行 npm.cmd run db:setup:local')
    throw error
  }
  // 独立解析，不将 .env 的团队数据库配置与本地配置混用。
  return validateLocalConfig(parse(contents))
}
