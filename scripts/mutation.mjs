import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
fs.mkdirSync(path.join(root, 'test-results'), {recursive:true});
const output = fs.mkdtempSync(path.join(root, 'test-results/mutation-'));
const cases = [
  {id:'MUT-CODE', requirement:'M1-DISPLAY', module:'backend/M1', file:'src/checkin-code.js', from:".update(room+':'+day)", to:".update('same-room:'+day)", test:'test/checkin-code.test.js'},
  {id:'MUT-ROLE', requirement:'M3-04', module:'backend/M3', file:'src/common.js', from:'if (!roles.some((r) => u.roles.includes(r)))', to:'if (false)', test:'test/validation.test.js'},
  {id:'MUT-DURATION', requirement:'M1-LIMIT', module:'frontend', file:'src/utils/m1.js', from:'end.timestamp - start.timestamp > maxHours * 3600000', to:'false', test:'tests/m1.test.mjs'},
  {id:'MUT-OPENING', requirement:'D2-19', module:'backend/D2', file:'src/time.js', from:'if (open === close) return true', to:'if (open === close) return false', test:'tests/unit/occupancy.test.js'},
  {id:'MUT-PAYLOAD', requirement:'QUALITY-TEST', module:'backend/D1', file:'src/utils/response.js', from:"return { code: 'OK', message, data,", to:"return { code: 'BROKEN', message, data,", test:'test/response.test.js'},
];
const results = [];
for (const item of cases) {
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab1-mut-'));
 try {
  const source = path.join(root, item.module);
  fs.cpSync(source, temp, {recursive:true, filter:p => !['node_modules','.env','.git','dist'].includes(path.basename(p))});
  const dependencies = path.join(source, 'node_modules');
  if (fs.existsSync(dependencies)) fs.symlinkSync(dependencies, path.join(temp,'node_modules'), 'dir');
  const run = () => spawnSync(process.execPath, ['--test','--test-reporter=tap', item.test], {cwd:temp, encoding:'utf8', timeout:30000, env:{...process.env,DOTENV_CONFIG_PATH:path.join(temp,'.env-does-not-exist')}});
  const baseline = run();
  fs.writeFileSync(path.join(output,item.id+'-baseline.log'), (baseline.stdout||'')+(baseline.stderr||''));
  if (baseline.error || baseline.status !== 0 || !/# pass [1-9]/.test(baseline.stdout)) throw Error('原版测试未通过或没有有效测试');
  const target = path.join(temp,item.file), original = fs.readFileSync(target,'utf8');
  if (original.split(item.from).length !== 2) throw Error('变异位置不唯一或已变化，请人工更新实验');
  fs.writeFileSync(target, original.replace(item.from,item.to));
  const syntax = spawnSync(process.execPath,['--check',target],{encoding:'utf8'});
  if (syntax.status !== 0) throw Error('变异产生语法错误，不计为发现行为缺陷');
  const changed = run();
  const log = (changed.stdout||'')+(changed.stderr||'');
  fs.writeFileSync(path.join(output,item.id+'-mutant.log'),log);
  // Only an actual assertion failure counts. Crashes, import failures and timeouts do not.
  if (changed.error || changed.signal || changed.status === 0 || !/ERR_ASSERTION/.test(log)) throw Error('变异未被行为断言发现（或运行故障），门禁失败');
  results.push({...item,result:'killed'});
  console.log(`${item.id}: 原版通过，破坏实现后断言失败`);
 } catch(error) {results.push({...item,result:'failed',reason:error.message}); console.error(item.id,error.message);}
 finally {fs.rmSync(temp,{recursive:true,force:true});}
}
fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify({createdAt:new Date().toISOString(),results},null,2));
console.log(`变异报告: ${output}`);
if (results.some(r=>r.result!=='killed')) process.exitCode=1;
