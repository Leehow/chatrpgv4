/** Assemble a standalone PipiCOC App with immutable, relocatable runtime resources. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { assembleRuntime } from '../scripts/package-runtime.mjs';
import { assemblySignals, removeAssemblyTreeSync } from '../scripts/assembly-workspace.mjs';
import { createPackageRecipe } from './package-config.mjs';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const parent=join(repo,'.build.noindex/pipicoc');
fs.mkdirSync(parent,{recursive:true});
// The App has exactly one copy on disk and it lives in /Applications, because LaunchServices
// refuses to register a symlink as a bundle: with the real bundle anywhere else, the App is
// absent from the Applications folder, Launchpad and Spotlight no matter how the link is made.
// The recipe keeps the receipt and back-link at the old build home.
// The staging directory holds an assembled runtime, a nested package-runtime closure, and the
// App this run replaces. None of it outlives the run, and the runtime is assembled read-only,
// so restore write permission before unlinking it on every exit path including failure.
const assemblyController=assemblySignals();
let stage,activeAssembly=null;
const purgeStage=()=>{if(stage)removeAssemblyTreeSync(stage);};
try {
stage=fs.mkdtempSync(join(parent,'package-'));
const productConfigPath=join(repo,'pipicoc/product.json'),product=JSON.parse(fs.readFileSync(productConfigPath,'utf8'));
const {version}=JSON.parse(fs.readFileSync(join(repo,'package.json'),'utf8'));
const {config,home,target,link,app}=createPackageRecipe({repo,stage,product,version,userHome:homedir(),appHome:process.env.PIPICOC_APP_HOME,appBundle:process.env.PIPICOC_APP_BUNDLE});
fs.mkdirSync(home,{recursive:true});
const identity=process.env.PIPICOC_SIGN_IDENTITY||'PipiUI Dev';
// A run started through the back-link reports that path, so both spellings have to be checked.
const running=execFileSync('/bin/ps',['-axo','command='],{encoding:'utf8'}).split('\n');
if(fs.existsSync(target)&&[target,link].some(path=>running.some(line=>line.trim().startsWith(join(path,'Contents/MacOS/')))))
  throw new Error('Quit the running canonical PipiCOC App before replacing it.');
const run=(command,args,cwd=repo,env=process.env)=>execFileSync(command,args,{cwd,env,stdio:'inherit'});
run('npm',['run','build:runtime']);
run('npm',['--prefix','Electron','run','build']);
activeAssembly=assembleRuntime({repo,output:join(stage,'runtime'),nodeArchive:process.env.PIPICOC_NODE_ARCHIVE,gitArchive:process.env.PIPICOC_GIT_ARCHIVE,signal:assemblyController.signal});
const assembled=await activeAssembly;
assemblyController.signal.throwIfAborted();
activeAssembly=null;
fs.writeFileSync(join(stage,'pi-coc-runtime.json'),JSON.stringify({schemaVersion:1,kind:'standalone',runtimeRoot:'pi-coc'},null,2)+'\n');
fs.copyFileSync(productConfigPath,join(stage,'product.json'));
fs.writeFileSync(join(stage,'builder.json'),JSON.stringify(config,null,2)+'\n');
run(join(repo,'Electron/node_modules/.bin/electron-builder'),['--mac','--arm64','--dir','--config',join(stage,'builder.json')],join(repo,'Electron/apps/electron'),{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false',CSC_NAME:''});
const runtime=join(app,'Contents/Resources/pi-coc');
// electron-builder's generic resource filter excludes a root node_modules directory.
// Copy the separately assembled Node closure after packaging and before signing.
fs.cpSync(assembled.output,runtime,{recursive:true,verbatimSymlinks:true});
const assembly=JSON.parse(fs.readFileSync(join(runtime,'assembly.json'),'utf8'));
for(const entry of assembly.files){
  const path=join(runtime,entry.path);
  if(entry.link!==undefined){if(fs.readlinkSync(path)!==entry.link)throw new Error(`Runtime link changed during App assembly: ${entry.path}`);}
  else if(createHash('sha256').update(fs.readFileSync(path)).digest('hex')!==entry.sha256)throw new Error(`Runtime file changed during App assembly: ${entry.path}`);
}
const signingTargets=assembly.native.filter(native=>native.format.startsWith('Mach-O'));
for(const native of signingTargets){
  const path=join(runtime,native.path);
  if(!fs.lstatSync(path).isSymbolicLink())run('/usr/bin/codesign',['--force','--sign',identity,'--timestamp=none',path]);
}
run('/usr/bin/codesign',['--force','--deep','--sign',identity,'--timestamp=none',app]);
run('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',app]);
const signedNative=signingTargets.map(entry=>({path:entry.path,sha256:createHash('sha256').update(fs.readFileSync(join(runtime,entry.path))).digest('hex')}));
const backup=fs.existsSync(target)?join(stage,'previous-PipiCOC.app'):null;
if(backup)fs.renameSync(target,backup);
try{fs.renameSync(app,target);}catch(error){if(backup)fs.renameSync(backup,target);throw error;}
const receipt={app:target,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),createdAt:new Date().toISOString(),kind:'standalone-typescript-runtime',architecture:'arm64',signingIdentity:identity,
  runtimeDescriptor:{schemaVersion:1,kind:'standalone',runtimeRoot:'pi-coc'},node:{version:assembly.node.version,abi:assembly.node.abi},git:assembly.git.version,
  sourcePackageSha256:assembly.sourcePackageSha256,sourceLockSha256:assembly.sourceLockSha256,assemblyEvidence:assembled.evidence,resourceInventoryStage:'before-codesign',signedNative};
fs.writeFileSync(join(home,'pipicoc-package.json'),JSON.stringify(receipt,null,2)+'\n');
// Repair the back-link and re-register, so the Applications entry survives every rebuild.
if(fs.existsSync(link)||fs.lstatSync(link,{throwIfNoEntry:false}))fs.rmSync(link,{recursive:true,force:true});
fs.symlinkSync(target,link);
execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-f',target]);
console.log(target);
} finally {
  // The assembler owns its processes and inner work. Never purge their parent
  // until cancellation, pipe draining and durable diagnostics have settled.
  try {
    try{await activeAssembly;}catch(error){if(error.cleanupBlocked)throw error;}
    purgeStage();
  } finally { assemblyController.dispose(); }
}
