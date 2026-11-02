import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const frontend = fileURLToPath(new URL('../frontend/', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(args) {
  const result = spawnSync(npm, args, {
    cwd: frontend,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}

if (!existsSync(new URL('../frontend/node_modules/vite/bin/vite.js', import.meta.url))) {
  run(['ci', '--no-audit', '--no-fund']);
}
run(['run', 'build']);
