/**
 * The turn-3 fixture: a byte copy of the live campaign's workspace slice, and its materialization into a
 * disposable workspace positioned before turn 3 by the kernel's own history operation.
 *
 *   node experiments/single-loop-routing/fixture.mjs --make   # rebuild the tarball from the App's data (read-only)
 *
 * The live source is only read. The tarball holds the campaign directory, its sidecar Git repository,
 * the campaign's module and the installed Mod packages. Module map images are stripped (see README).
 */
import {cpSync,mkdtempSync,readFileSync,rmSync,chmodSync,readdirSync,statSync,existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

export const FIXTURES=resolve(import.meta.dirname,'fixtures');
export const LIVE_HOME=join(homedir(),'Library/Application Support/Pipi/pipicoc/pi-coc');

export function readFixture(name){
  const dir=join(FIXTURES,name);
  return {dir,turn:JSON.parse(readFileSync(join(dir,'turn.json'),'utf8')),baseline:JSON.parse(readFileSync(join(dir,'baseline.json'),'utf8')),
    tarball:join(dir,'workspace.tar.gz')};
}

function writable(path){
  try{const stat=statSync(path);chmodSync(path,stat.mode|0o200);if(stat.isDirectory())for(const entry of readdirSync(path))writable(join(path,entry));}catch{/* already gone */}
}
export function removeTree(path){writable(path);rmSync(path,{recursive:true,force:true});}

/** Extract the tarball into a fresh temporary workspace. The caller removes it. */
export function materialize(name){
  const {tarball}=readFixture(name),workspace=mkdtempSync(join(tmpdir(),'single-loop-routing-'));
  const run=spawnSync('tar',['-xzf',tarball,'-C',workspace],{encoding:'utf8'});
  if(run.status!==0){removeTree(workspace);throw new Error(`tar failed: ${run.stderr}`);}
  return workspace;
}

function make(name){
  const {dir,turn}=readFixture(name),source=join(LIVE_HOME,'.coc'),stage=mkdtempSync(join(tmpdir(),'single-loop-fixture-'));
  try{
    const slices=[['campaigns',turn.campaign],['repos',`${turn.campaign}.git`],['modules',turn.module],['mods','packages']];
    for(const [root,entry] of slices)cpSync(join(source,root,entry),join(stage,'.coc',root,entry),{recursive:true});
    const assets=join(stage,'.coc/modules',turn.module,'assets');
    if(existsSync(assets))removeTree(assets);
    const run=spawnSync('tar',['-czf',join(dir,'workspace.tar.gz'),'-C',stage,'.coc'],{encoding:'utf8'});
    if(run.status!==0)throw new Error(`tar failed: ${run.stderr}`);
  }finally{removeTree(stage);}
}

if(import.meta.url===`file://${process.argv[1]}`&&process.argv.includes('--make'))make(process.argv[process.argv.indexOf('--fixture')+1]||'turn3');
