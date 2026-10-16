/** Native Node test runner with owned scratch and durable failure evidence. */
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,existsSync,writeFileSync,readFileSync,readdirSync,lstatSync,chmodSync,rmSync,cpSync,readlinkSync,symlinkSync,unlinkSync,statfsSync} from 'node:fs';
import {resolve,join,relative,isAbsolute,dirname,sep} from 'node:path';
import {constants} from 'node:os';
import {pathToFileURL} from 'node:url';

export function removeOwned(path){
  if(!existsSync(path))return;
  if(lstatSync(path).isSymbolicLink())throw new Error('Owned scratch root became a symlink');
  function writable(directory){chmodSync(directory,lstatSync(directory).mode|0o700);for(const entry of readdirSync(directory,{withFileTypes:true}))if(entry.isDirectory())writable(join(directory,entry.name));}
  writable(path);rmSync(path,{recursive:true,force:true});
}
export function preserveRam(ordinary,destination){
  cpSync(ordinary,destination,{recursive:true,dereference:false,verbatimSymlinks:true,errorOnExist:true,force:false});
  const relocated=[];
  function walk(directory){for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())walk(path);else if(entry.isSymbolicLink()){
    const target=readlinkSync(path),rel=relative(ordinary,resolve(target));
    if(!isAbsolute(target)||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))continue;
    const mode=lstatSync(dirname(path)).mode;chmodSync(dirname(path),mode|0o700);
    try{unlinkSync(path);symlinkSync(join(destination,rel),path);}finally{chmodSync(dirname(path),mode);}
    relocated.push({path:relative(destination,path),original_target:target});
  }}}
  walk(destination);return relocated;
}
export function removePassedFixtures(paths,outcomes,{ordinary,disk}){
  const results=new Map(),byPath=new Map(),removed=[];
  for(const row of outcomes){const values=results.get(row.nodeid)??[];values.push(row.outcome);results.set(row.nodeid,values);}
  for(const row of paths){
    if(!isAbsolute(row.path))throw new Error('Fixture path must be absolute');
    const path=resolve(row.path),parent=dirname(path),root=row.storage==='disk'?disk:ordinary;
    const direct=row.storage==='disk'?dirname(parent)===disk&&/^\d+$/.test(parent.slice(disk.length+1)):parent===ordinary;
    if(!direct||!/^case-[a-f0-9]{16}-/.test(path.slice(parent.length+1)))throw new Error('Fixture path escaped its owned root');
    for(const ancestor of new Set([root,parent,path]))if(existsSync(ancestor)&&lstatSync(ancestor).isSymbolicLink())throw new Error('Fixture ancestor became a symlink');
    const rows=byPath.get(path)??[];rows.push(row);byPath.set(path,rows);
  }
  const candidates=new Set([...byPath].filter(([,rows])=>rows.every(row=>{
    const values=results.get(row.nodeid);return values?.length&&values.every(value=>value==='passed');
  })).map(([path])=>path));
  // A retained case can depend on another case through a symlink. Keep that dependency too.
  const pending=[...byPath.keys()].filter(path=>!candidates.has(path)),seen=new Set();
  function links(directory){
    if(!existsSync(directory))return;
    for(const entry of readdirSync(directory,{withFileTypes:true})){
      const path=join(directory,entry.name);
      if(entry.isDirectory())links(path);
      else if(entry.isSymbolicLink()){
        const target=resolve(directory,readlinkSync(path));
        for(const candidate of candidates){const rel=relative(candidate,target);if(rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep))){candidates.delete(candidate);pending.push(candidate);}}
      }
    }
  }
  while(pending.length){const path=pending.pop();if(!seen.has(path)){seen.add(path);links(path);}}
  for(const path of candidates){removeOwned(path);removed.push(path);}
  return removed;
}
export async function runStorage(runDir,args,{mode='hybrid',ramParent='/dev/shm',cwd=process.cwd(),env=process.env}={}){
  if(!['hybrid','disk'].includes(mode))throw new Error('Unsupported storage mode');
  runDir=resolve(runDir);mkdirSync(runDir,{recursive:true});
  if(existsSync(join(runDir,'run.json')))throw new Error('A native test invocation cannot reuse an earlier run directory');
  const disk=join(runDir,'disk');mkdirSync(disk);
  let effectiveMode=mode;
  if(mode==='hybrid'){try{const fs=statfsSync(ramParent);if(!lstatSync(ramParent).isDirectory()||fs.bavail*fs.bsize<4*1024**3)effectiveMode='disk';}catch{effectiveMode='disk';}}
  const ordinary=effectiveMode==='hybrid'?mkdtempSync(join(ramParent,'coc-ts-test-')):join(runDir,'ordinary');
  mkdirSync(ordinary,{recursive:true});writeFileSync(join(ordinary,'.coc-ts-test-owned'),runDir);
  const reporters=args.some(arg=>arg.startsWith('--test-reporter='))?[]:['--test-reporter=spec','--test-reporter-destination=stdout'];
  const command=[process.execPath,'--test',...reporters,`--test-reporter=${resolve(import.meta.dirname,'test-storage-reporter.mjs')}`,'--test-reporter-destination=stdout',...args],start=performance.now();
  const metadata={started:new Date().toISOString(),requested_mode:mode,mode:effectiveMode,command,ordinary,disk,status:'running'};
  writeFileSync(join(runDir,'run.json'),JSON.stringify(metadata,null,2)+'\n');
  let child,receivedSignal,exitCode=1;
  const handlers=new Map();
  for(const signal of ['SIGINT','SIGTERM','SIGHUP']){const handler=()=>{receivedSignal=signal;if(child?.pid){try{process.kill(process.platform==='win32'?child.pid:-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}}};handlers.set(signal,handler);process.on(signal,handler);}
  console.log(`Native storage: mode=${effectiveMode} run=${runDir} ordinary=${ordinary} disk=${disk}`);
  try{
    if(!receivedSignal){const childEnv={...env,COC_TEST_STORAGE_RUN:runDir,COC_TEST_DISK_TMP_ROOT:disk,COC_TEST_ORDINARY_TMP_ROOT:ordinary,TMPDIR:ordinary};delete childEnv.NODE_TEST_CONTEXT;
      child=spawn(command[0],command.slice(1),{cwd,env:childEnv,detached:process.platform!=='win32',stdio:'inherit'});
      exitCode=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>done(code??(128+(constants.signals[signal]??1))));});}
    if(receivedSignal)exitCode=128+constants.signals[receivedSignal];
    return exitCode;
  }finally{
    Object.assign(metadata,{exit_code:exitCode,node_process_seconds:(performance.now()-start)/1000,status:exitCode===0?'passed':'failed'});
    const reports=readdirSync(runDir).filter(file=>/^storage-\d+\.json$/.test(file)).map(file=>JSON.parse(readFileSync(join(runDir,file),'utf8')));
    const events=existsSync(join(runDir,'storage-events.json'))?JSON.parse(readFileSync(join(runDir,'storage-events.json'),'utf8')):null;
    const summary={collected:events?.collected??reports.flatMap(report=>report.collected),paths:reports.flatMap(report=>report.paths),reports:events?.reports??reports.flatMap(report=>report.reports),exit_code:exitCode};
    writeFileSync(join(runDir,'storage-main.json'),JSON.stringify(summary,null,2)+'\n');
    if(exitCode!==0){try{metadata.removed_passed_fixtures=removePassedFixtures(summary.paths,summary.reports,{ordinary,disk});}catch(error){metadata.fixture_cleanup_error=String(error);}}
    if(exitCode!==0&&effectiveMode==='hybrid'){try{metadata.relocated_links=preserveRam(ordinary,join(runDir,'ram-evidence'));}catch(error){metadata.ram_preservation_error=String(error);metadata.ram_retained=ordinary;}}
    try{if(!metadata.ram_retained&&(exitCode===0||effectiveMode==='hybrid'))removeOwned(ordinary);if(exitCode===0)removeOwned(disk);}catch(error){metadata.cleanup_error=String(error);}
    for(const [signal,handler]of handlers)process.off(signal,handler);
    metadata.total_seconds=(performance.now()-start)/1000;writeFileSync(join(runDir,'run.json'),JSON.stringify(metadata,null,2)+'\n');
    console.log(`Native storage result: exit=${exitCode} evidence=${runDir}`);
  }
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
  try{const argv=process.argv.slice(2),separator=argv.indexOf('--'),options=separator<0?argv:argv.slice(0,separator),args=separator<0?[]:argv.slice(separator+1);let runDir,mode=process.env.COC_TEST_STORAGE_MODE??'hybrid',ramParent='/dev/shm';
    for(let i=0;i<options.length;i++){if(options[i]==='--run-dir')runDir=options[++i];else if(options[i]==='--mode')mode=options[++i];else if(options[i]==='--ram-parent')ramParent=options[++i];else throw new Error('Unknown storage runner option: '+options[i]);}
    if(!runDir)throw new Error('--run-dir is required');process.exitCode=await runStorage(runDir,args,{mode,ramParent});
  }catch(error){console.error(String(error));process.exitCode=1;}
}
