import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const stage=join(repo,'.build.noindex/pipicoc');
const out=join(repo,'build');
fs.mkdirSync(stage,{recursive:true});fs.mkdirSync(out,{recursive:true});
const target=join(out,'PipiCOC.app');
if (fs.existsSync(target) && execFileSync('/bin/ps',['-axo','command='],{encoding:'utf8'}).split('\n').some(line=>line.trim().startsWith(join(target,'Contents/MacOS/'))))
  throw new Error('Quit the running PipiCOC App before replacing it.');
const run=(cmd,args,cwd=repo,env=process.env)=>execFileSync(cmd,args,{cwd,env,stdio:'inherit'});
run('npm',['--prefix','Electron','run','build']);
run(join(repo,'pipicoc/install'),[]);
fs.writeFileSync(join(stage,'pi-coc-runtime.json'),JSON.stringify({repoRoot:repo,nodePath:process.execPath,toolBin:dirname(execFileSync('/usr/bin/which',['uv'],{encoding:'utf8'}).trim())},null,2));
fs.writeFileSync(join(stage,'product.json'),fs.readFileSync(join(repo,'pipicoc/product.json')));
const config={appId:'com.leehow.pipicoc',productName:'PipiCOC',forceCodeSigning:false,npmRebuild:true,
  extraMetadata:{version:'0.1.0'},directories:{output:join(stage,'output')},
  files:['out/**/*','package.json','!node_modules/**/*','node_modules/node-pty/**/*','node_modules/@xterm/headless/**/*','node_modules/@xterm/addon-serialize/**/*'],
  extraResources:[{from:join(stage,'product.json'),to:'product.json'},{from:join(stage,'pi-coc-runtime.json'),to:'pi-coc-runtime.json'}],
  mac:{identity:null,icon:join(repo,'pipicoc/pipicoc.icns'),extendInfo:{CFBundleDisplayName:'PipiCOC',CFBundleName:'PipiCOC'},target:['dir']}};
fs.writeFileSync(join(stage,'builder.json'),JSON.stringify(config,null,2));
run(join(repo,'Electron/node_modules/.bin/electron-builder'),['--mac','--arm64','--dir','--config',join(stage,'builder.json')],join(repo,'Electron/apps/electron'),{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false',CSC_NAME:''});
const app=join(stage,'output/mac-arm64/PipiCOC.app');
run('/usr/bin/codesign',['--force','--deep','--sign','PipiUI Dev','--timestamp=none',app]);
run('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',app]);
const backup=fs.existsSync(target) ? join(stage, 'previous-'+Date.now()) : undefined;
if(backup)fs.renameSync(target,backup);
try { fs.renameSync(app,target); } catch(error) { if(backup)fs.renameSync(backup,target); throw error; }
fs.writeFileSync(join(out,'pipicoc-package.json'),JSON.stringify({app:target,repoRoot:repo,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),createdAt:new Date().toISOString(),kind:'local-checkout-runtime',architecture:'arm64'},null,2));
console.log(target);
