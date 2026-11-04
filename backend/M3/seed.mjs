import 'dotenv/config';
import mysql from 'mysql2/promise';
import { readdir, readFile } from 'node:fs/promises';
const files = (await readdir(new URL('./seeds/', import.meta.url))).filter(f => f.endsWith('.sql')).sort();
if (files.length) {
  for (const key of ['DB_HOST','DB_NAME','DB_USER','DB_PASSWORD']) if (!process.env[key]) throw Error(`缺少 ${key}`);
  const c = await mysql.createConnection({host:process.env.DB_HOST, port:Number(process.env.DB_PORT || 3306), database:process.env.DB_NAME, user:process.env.DB_USER, password:process.env.DB_PASSWORD, multipleStatements:true});
  try {
    const [[lock]] = await c.query('SELECT GET_LOCK(?,30) AS acquired', ['lab1_seed_' + process.env.DB_NAME]);
    if (Number(lock.acquired) !== 1) throw Error('无法获得种子锁');
    await c.beginTransaction();
    for (const file of files) await c.query(await readFile(new URL('./seeds/' + file, import.meta.url), 'utf8'));
    await c.commit();
    console.log('种子数据已同步');
  } catch (error) { await c.rollback(); throw error; }
  finally { await c.end(); }
}
