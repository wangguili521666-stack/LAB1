import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)); process.chdir(root);
const exec=(cmd,args,extra={})=>execFileSync(cmd,args,{stdio:'inherit',...extra});
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()) throw Error('发布必须来自干净的已提交版本');
const run=process.env.GITHUB_RUN_ID || 'local';
const attempt=process.env.GITHUB_RUN_ATTEMPT || '1';
const release=`${revision}-${run}-${attempt}`;
if(!/^[a-f0-9]{40}-[a-z0-9]+-\d+$/.test(release))throw Error('非法发布版本');
const platform=process.env.RELEASE_PLATFORM || 'linux/amd64';
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'lab1-release-'));
try{
 let fingerprints=[];
 for(const module of ['D1','D2','D3','M1','M2','M3']) for(const file of fs.readdirSync(`backend/${module}/migrations`).filter(f=>f.endsWith('.sql')).sort()) fingerprints.push(module+'/'+file+'\n'+fs.readFileSync(`backend/${module}/migrations/${file}`,'utf8').replace(/\r\n/g,'\n'));
 const meta={release,revision,run,attempt,createdAt:new Date().toISOString(),schema:createHash('sha256').update(fingerprints.join('\n')).digest('hex')};
 fs.writeFileSync('deploy/release.json',JSON.stringify(meta,null,2)+'\n');
 const images=[];
 for(const service of ['d1','d2','d3','m1','m2','m3','frontend']){
  const image=`lab1-${service}:${release}`; images.push(image);
  exec('docker',['build','--platform',platform,'--label',`org.opencontainers.image.revision=${revision}`,'-t',image,...(service==='frontend'?['-f','deploy/Dockerfile.frontend','.']:[`backend/${service.toUpperCase()}`])]);
 }
 exec('docker',['pull','--platform',platform,'mysql:8.0']);
 const c=JSON.parse(execFileSync('docker',['compose','--env-file','.env.example','config','--no-interpolate','--no-env-resolution','--format','json'],{encoding:'utf8'}));
 delete c.name; c.networks={default:{}}; c.volumes={mysql_data:{}};
 for(const [service,v] of Object.entries(c.services)){
  delete v.build; delete v.ports; delete v.extra_hosts;
  v.logging={driver:'json-file',options:{'max-size':'10m','max-file':'3'}};
  if(service!=='mysql'){v.image=`lab1-${service}:${release}`;v.environment={...v.environment,NODE_OPTIONS:'--max-old-space-size=96'};delete v.volumes;}
 }
 const front=c.services.frontend; front.environment={};front.ports=['${LAB1_BIND:-0.0.0.0}:${LAB1_PORT:-80}:80'];
 front.depends_on=Object.fromEntries(['d1','d2','d3','m1','m2','m3'].map(s=>[s,{condition:'service_healthy'}]));
 front.healthcheck={test:['CMD','wget','-q','-O','/dev/null','http://127.0.0.1/healthz'],interval:'10s',timeout:'5s',retries:6};
 const db=c.services.mysql;db.env_file=[{path:'./.env',required:true}];db.volumes=[{type:'volume',source:'mysql_data',target:'/var/lib/mysql'},{type:'bind',source:'./db/init',target:'/docker-entrypoint-initdb.d',read_only:true}];
 db.command.push('--innodb-buffer-pool-size=64M','--performance-schema=OFF','--max-connections=100','--innodb-log-buffer-size=8M');
 fs.cpSync('db',path.join(stage,'db'),{recursive:true});fs.copyFileSync('.env.example',path.join(stage,'.env.example'));
 fs.copyFileSync('deploy/release.json',path.join(stage,'release.json'));
 fs.writeFileSync(path.join(stage,'compose.json'),JSON.stringify(c,null,2));
 fs.copyFileSync('scripts/server-release.sh',path.join(stage,'server-release.sh'));
 exec('docker',['save','-o',path.join(stage,'images.tar'),...images,'mysql:8.0']);
 fs.mkdirSync('artifacts',{recursive:true});const archive=path.join(root,'artifacts',`release-${release}.tar.gz`);
 exec('tar',['-czf',archive,'-C',stage,'.']);
 fs.writeFileSync(archive+'.sha256',createHash('sha256').update(fs.readFileSync(archive)).digest('hex')+'  '+path.basename(archive)+'\n');
 console.log(`RELEASE=${release}\nBUNDLE=${archive}`);
 if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`release=${release}\n`);
}finally{fs.rmSync(stage,{recursive:true,force:true});fs.rmSync('deploy/release.json',{force:true});}
