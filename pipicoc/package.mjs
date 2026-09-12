/** Assemble a standalone PipiCOC App with immutable, relocatable runtime resources. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleRuntime } from '../scripts/package-runtime.mjs';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const parent=join(repo,'.build.noindex/pipicoc');
fs.mkdirSync(parent,{recursive:true});
const stage=fs.mkdtempSync(join(parent,'package-')),out=join(repo,'build');
fs.mkdirSync(out,{recursive:true});
const target=join(out,'PipiCOC.app'),identity=process.env.PIPICOC_SIGN_IDENTITY||'PipiUI Dev';
if(fs.existsSync(target)&&execFileSync('/bin/ps',['-axo','command='],{encoding:'utf8'}).split('\n').some(line=>line.trim().startsWith(join(target,'Contents/MacOS/'))))
  throw new Error('Quit the running canonical PipiCOC App before replacing it.');
const run=(command,args,cwd=repo,env=process.env)=>execFileSync(command,args,{cwd,env,stdio:'inherit'});
run('npm',['run','build:runtime']);
run('npm',['--prefix','Electron','run','build']);
const assembled=await assembleRuntime({repo,output:join(stage,'runtime'),nodeArchive:process.env.PIPICOC_NODE_ARCHIVE,gitArchive:process.env.PIPICOC_GIT_ARCHIVE});
fs.writeFileSync(join(stage,'pi-coc-runtime.json'),JSON.stringify({schemaVersion:1,kind:'standalone',runtimeRoot:'pi-coc'},null,2)+'\n');
fs.copyFileSync(join(repo,'pipicoc/product.json'),join(stage,'product.json'));
const config={appId:'com.leehow.pipicoc',productName:'PipiCOC',forceCodeSigning:false,npmRebuild:true,
  extraMetadata:{version:'0.1.0'},directories:{output:join(stage,'output')},
  files:['out/**/*','package.json','!node_modules/**/*','node_modules/node-pty/**/*','node_modules/@xterm/headless/**/*','node_modules/@xterm/addon-serialize/**/*'],
  extraResources:[{from:join(stage,'product.json'),to:'product.json'},{from:join(stage,'pi-coc-runtime.json'),to:'pi-coc-runtime.json'},{from:join(repo,'pipicoc/pipicoc.png'),to:'pipicoc.png'},{from:join(repo,'Electron/packages/ui/dist/browser'),to:'browser-ui'}],
  mac:{identity:null,icon:join(repo,'pipicoc/pipicoc.icns'),extendInfo:{CFBundleDisplayName:'PipiCOC',CFBundleName:'PipiCOC'},target:['dir']}};
fs.writeFileSync(join(stage,'builder.json'),JSON.stringify(config,null,2)+'\n');
run(join(repo,'Electron/node_modules/.bin/electron-builder'),['--mac','--arm64','--dir','--config',join(stage,'builder.json')],join(repo,'Electron/apps/electron'),{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false',CSC_NAME:''});
const app=join(stage,'output/mac-arm64/PipiCOC.app'),runtime=join(app,'Contents/Resources/pi-coc');
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
fs.writeFileSync(join(out,'pipicoc-package.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(target);
