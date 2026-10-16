/** Losslessly compact completed LAN test scratch; never expire failure evidence. */
import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {mkdirSync,readdirSync,lstatSync,existsSync,readFileSync,writeFileSync,renameSync,rmSync,chmodSync,statSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {resolve,join,dirname,basename,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

function command(args,{cwd,onSpawn=()=>{}}={}){
  return new Promise((done,reject)=>{
    const child=spawn('tar',args,{cwd,stdio:['ignore','ignore','pipe']});let error='';
    child.stderr.on('data',chunk=>{error=(error+chunk).slice(-8192);});onSpawn(child);
    child.once('error',reject);child.once('close',code=>code===0?done():reject(new Error(`tar exit ${code}: ${error}`)));
  });
}
async function sha256(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
function durableJson(path,value){
  const temporary=path+'.new';writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  const fd=openSync(temporary,'r');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(temporary,path);
}
function directory(path){return existsSync(path)&&lstatSync(path).isDirectory()&&!lstatSync(path).isSymbolicLink();}
function payloads(run){
  const result=['legacy-pytest','previous-workspace','source-artifacts','interrupted-evidence','.pytest-tmp'].filter(name=>directory(join(run,name)));
  const native=join(run,'native-ts/evidence');
  if(directory(native))for(const entry of readdirSync(native)){
    const storage=join(native,entry,'storage');if(!directory(join(native,entry))||!directory(storage))continue;
    for(const name of ['disk','ordinary','ram-evidence'])if(directory(join(storage,name)))result.push(relative(run,join(storage,name)));
  }
  return result.filter(name=>readdirSync(join(run,name)).length);
}
function assertAncestors(path){
  for(let current=path;;current=dirname(current)){
    if(lstatSync(current).isSymbolicLink())throw new Error(`Refusing symlink ancestor: ${current}`);
    if(dirname(current)===current)break;
  }
}
function removeTree(path){
  function writable(root){chmodSync(root,lstatSync(root).mode|0o700);for(const entry of readdirSync(root,{withFileTypes:true}))if(entry.isDirectory())writable(join(root,entry.name));}
  writable(path);rmSync(path,{recursive:true,force:true});
}
export async function compactRun(run,{apply=false,minAgeMs=3600000,onProgress=()=>{}}={}){
  run=resolve(run);assertAncestors(run);
  if(!run.split(sep).includes('.pytest-runs')||!basename(run).startsWith('run.'))throw new Error('Expected an independent LAN test run');
  const terminal=join(run,'result.exit');
  if(!existsSync(terminal)||!/^\d+\s*$/.test(readFileSync(terminal,'utf8')))return{run,skipped:'no terminal result'};
  if(minAgeMs>0&&Date.now()-Math.max(statSync(terminal).mtimeMs,statSync(run).mtimeMs)<minAgeMs)return{run,skipped:'recent run'};
  const selected=payloads(run);if(!apply)return{run,payloads:selected};
  const lock=join(run,'.evidence-compaction.lock');
  try{mkdirSync(lock);}catch(error){if(error.code==='EEXIST')return{run,skipped:'compaction locked'};throw error;}
  const manifestPath=join(run,'evidence-compaction.json'),archiveDir=join(run,'compressed-evidence');
  let manifest={version:1,run,archives:[]};
  try{
    writeFileSync(join(lock,'owner.json'),JSON.stringify({pid:process.pid,started:new Date().toISOString()}));
    if(existsSync(manifestPath)){manifest=JSON.parse(readFileSync(manifestPath,'utf8'));if(manifest.version!==1||manifest.run!==run)throw new Error('Unexpected compaction manifest');}
    if(existsSync(archiveDir)&&!directory(archiveDir))throw new Error('Archive destination is not a directory');
    mkdirSync(archiveDir,{recursive:true,mode:0o700});
    for(const source of selected){
      const path=join(run,source);assertAncestors(path);
      const archive=join(archiveDir,source.replaceAll(sep,'__')+'.tar.gz'),temporary=archive+'.partial';
      onProgress({run,source,status:'compressing'});
      const previous=manifest.archives.find(entry=>entry.source===source);
      if(existsSync(archive)){
        if(!previous||previous.sha256!==await sha256(archive))throw new Error('Existing archive is not verified by this manifest');
      }else{
        if(existsSync(temporary))throw new Error('An earlier partial archive requires inspection');
        try{
          await command(['--create','--use-compress-program=gzip -1','--file',temporary,'--',source],{cwd:run});
          await command(['--compare','--gzip','--file',temporary],{cwd:run});
          const fd=openSync(temporary,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
          const entry={source,archive:relative(run,archive),sha256:await sha256(temporary),bytes:statSync(temporary).size,verifiedAt:new Date().toISOString(),restore:`tar -xzf ${JSON.stringify(relative(run,archive))} -C ${JSON.stringify(run)}`};
          renameSync(temporary,archive);manifest.archives=manifest.archives.filter(row=>row.source!==source);manifest.archives.push(entry);
          durableJson(manifestPath,manifest);
        }catch(error){rmSync(temporary,{force:true});throw error;}
      }
      // On a resumed cleanup, compare again before removing any remaining original.
      if(previous)await command(['--compare','--gzip','--file',archive],{cwd:run});
      removeTree(path);onProgress({run,source,status:'compacted',bytes:statSync(archive).size});
    }
    return{run,archives:manifest.archives.length,bytes:manifest.archives.reduce((total,row)=>total+row.bytes,0)};
  }finally{rmSync(lock,{recursive:true,force:true});}
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
  try{
    const args=process.argv.slice(2);let run,root,apply=false,minAgeMs=3600000;
    for(let i=0;i<args.length;i++){
      if(args[i]==='--run')run=args[++i];else if(args[i]==='--root')root=args[++i];
      else if(args[i]==='--apply')apply=true;else if(args[i]==='--settled')minAgeMs=0;else throw new Error(`Unknown argument: ${args[i]}`);
    }
    if(Boolean(run)===Boolean(root))throw new Error('Choose --run or --root');
    let runs=[run];
    if(root){root=resolve(root);assertAncestors(root);if(basename(root)!=='.pytest-runs')throw new Error('Expected .pytest-runs root');
      runs=readdirSync(root).filter(name=>directory(join(root,name))).flatMap(name=>readdirSync(join(root,name)).filter(child=>child.startsWith('run.')&&directory(join(root,name,child))).map(child=>join(root,name,child)));
    }
    for(const path of runs){try{console.log(JSON.stringify(await compactRun(path,{apply,minAgeMs,onProgress:row=>console.log(JSON.stringify(row))})));}catch(error){console.error(JSON.stringify({run:path,error:String(error)}));process.exitCode=1;}}
  }catch(error){console.error(String(error));process.exitCode=1;}
}
