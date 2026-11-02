import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'lab1-package-'));
const output = path.join(root, 'artifacts');
const excluded = new Set(['node_modules', '.git', '.DS_Store', 'dist', 'test-results', '.local-logs', 'coverage']);
let revision = 'unknown';
try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch {}
const stamp = new Date().toISOString().replace(/[-:.]/g, '');
const name = `lab1-${revision.slice(0,12)}-${stamp}-${randomBytes(3).toString('hex')}.tar.gz`;
const archive = path.join(output, name);
function copy(source, destination) {
  const base = path.basename(source);
  if (excluded.has(base) || base.endsWith('.log') || (base.startsWith('.env') && base !== '.env.example')) return;
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw Error(`打包不接受符号链接: ${source}`);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const child of fs.readdirSync(source)) copy(path.join(source, child), path.join(destination, child));
  } else if (stat.isFile()) {
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, stat.mode & 0o777);
  }
}
try {
  // Deliberately package only runtime sources and their deployment helpers.
  for (const entry of ['frontend','backend','db','scripts','docker-compose.yml','.env.example','package.json','package-lock.json','start.sh','README.md']) {
    copy(path.join(root, entry), path.join(stage, entry));
  }
  fs.writeFileSync(path.join(stage, 'release.json'), JSON.stringify({ revision, packagedAt: new Date().toISOString(), type: 'source-compose', note: 'Current working tree; tests must pass before packaging in CI.' }, null, 2));
  fs.mkdirSync(output, { recursive: true });
  execFileSync('tar', ['-czf', archive, '-C', stage, '.'], { stdio: 'inherit', env: {...process.env, COPYFILE_DISABLE: '1'} });
  const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(archive + '.sha256', `${digest}  ${name}\n`);
  console.log(`部署源码包: ${archive}\n校验文件: ${archive}.sha256`);
} catch (error) {
  fs.rmSync(archive, { force: true });
  throw error;
} finally { fs.rmSync(stage, { recursive: true, force: true }); }
