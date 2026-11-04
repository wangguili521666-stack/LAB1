import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const dir = new URL('./migrations/', import.meta.url);
const manifest = new URL('./migrations.sha256.json', import.meta.url);
const saved = JSON.parse(readFileSync(manifest, 'utf8'));
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
const hash = f => createHash('sha256').update(readFileSync(new URL(f, dir), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
for (const [f, expected] of Object.entries(saved)) {
  if (!files.includes(f) || hash(f) !== expected) throw Error(`历史迁移被删除或修改: ${f}`);
}
let latest = Object.keys(saved).sort().at(-1) || '';
for (const f of files) {
  if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(f)) throw Error(`迁移命名错误: ${f}`);
  if (saved[f]) continue;
  if (f.slice(0,3) <= latest.slice(0,3)) throw Error(`新迁移版本必须递增: ${f}`);
  if (!process.argv.includes('--register')) throw Error(`请先 npm run migration:register 并提交清单: ${f}`);
  saved[f] = hash(f); latest = f;
}
if (process.argv.includes('--register')) writeFileSync(manifest, JSON.stringify(saved, null, 2) + '\n');
console.log('迁移清单校验通过');
