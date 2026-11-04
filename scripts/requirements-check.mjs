import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
export function validate({requirements}, baseline, source, exists) {
 const errors=[], ids=new Set();
 const sourced=new Map(source.split('\n').map(line=>/^([A-Z][A-Z0-9]*-[A-Z0-9-]+)\t([^\t]+)\t(.+)$/.exec(line)).filter(Boolean).map(m=>[m[1],m[3]]));
 for(const r of requirements) {
  if(ids.has(r.id)) errors.push(`重复编号 ${r.id}`); ids.add(r.id);
  for(const key of ['id','title','acceptance','source','owner','command','method','gap']) if(typeof r[key]!=='string'||!r[key].trim()) errors.push(`${r.id}: 缺少 ${key}`);
  if(!['pending_acceptance','verified','partial','deferred','retired'].includes(r.status)) errors.push(`${r.id}: 状态无效`);
  if(r.status==='verified' && (!r.evidence || !exists(r.evidence))) errors.push(`${r.id}: 已验收必须有证据`);
  for(const key of ['implementation','verification']) {
   if(!Array.isArray(r[key])||!r[key].length) errors.push(`${r.id}: 缺少 ${key}`);
   else for(const p of r[key]) if(typeof p!=='string'||p.startsWith('/')||p.split('/').includes('..')||!exists(p)) errors.push(`${r.id}: 引用不存在 ${p}`);
  }
  if(!exists(r.source)) errors.push(`${r.id}: 来源不存在`);
  if(!sourced.has(r.id)) errors.push(`${r.id}: 原始需求编号已消失`);
  else if(sourced.get(r.id)!==r.acceptance) errors.push(`${r.id}: 验收标准与基线不同步`);
 }
 for(const id of baseline) if(!ids.has(id)) errors.push(`历史需求不能删除 ${id}`);
 for(const id of sourced.keys()) if(!ids.has(id)) errors.push(`需求未登记 ${id}`);
 for(const id of ids) if(!baseline.includes(id)) errors.push(`编号未登记到保留清单 ${id}`);
 return errors;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 const root=fileURLToPath(new URL('../',import.meta.url));
 const read=p=>fs.readFileSync(path.join(root,p),'utf8');
 const data=JSON.parse(read('docs/requirements/traceability.json'));
 const errors=validate(data,JSON.parse(read('docs/requirements/baseline-ids.json')),read('docs/requirements/demands.md'),p=>fs.existsSync(path.join(root,p)));
 if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
 else console.log(`需求基线检查通过：${data.requirements.length} 条（仅检查完整性，不代表业务全部验收通过）`);
}
