/**
 * The turn-3 fixture: a byte copy of the live campaign's workspace slice, and its materialization into a
 * disposable workspace positioned before turn 3 by the kernel's own history operation.
 *
 *   node experiments/single-loop-routing/fixture.mjs --make   # rebuild the tarball from the App's data (read-only)
 *
 * The live source is only read. The tarball holds the campaign directory, its sidecar Git repository,
 * the campaign's module and the installed Mod packages. Module map images are stripped (see README).
 */
import {cpSync,copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,chmodSync,readdirSync,statSync,existsSync,writeFileSync} from 'node:fs';
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

/**
 * SO-04: a fixture variant whose only difference from its source is the module slice, re-registered from the current
 * starter by the kernel's own `module.register` (the campaign, its sidecar Git repository and the Mod packages are the
 * source's bytes). The source fixture is only read. Writes fixtures/<name>/{workspace.tar.gz,turn.json,baseline.json,
 * variant.json}; turn.json and baseline.json are byte copies.
 *
 *   node experiments/single-loop-routing/fixture.mjs --derive turn3-obligations --from turn3
 */
function derive(name,from){
  const source=readFixture(from),dir=join(FIXTURES,name),workspace=materialize(from),root=resolve(import.meta.dirname,'../..');
  const sha=path=>spawnSync('shasum',['-a','256',path],{encoding:'utf8'}).stdout.split(' ')[0];
  const listing=()=>spawnSync('find',['.coc','-type','f','-not','-path','.coc/modules/*'],{cwd:workspace,encoding:'utf8'}).stdout.split('\n').filter(Boolean).sort()
    .map(path=>`${path} ${sha(join(workspace,path))}`);
  try{
    const before=listing();
    const request=JSON.stringify({id:'1',method:'module.register',params:{module_id:source.turn.module}});
    const run=spawnSync(process.execPath,[join(root,'build/kernel/rpc.mjs'),'--workspace',workspace,'--content',join(root,'content')],{cwd:root,input:`${request}\n`,encoding:'utf8'});
    const frame=run.stdout.split('\n').filter(Boolean).map(line=>JSON.parse(line)).find(value=>value.id==='1');
    if(!frame?.ok)throw new Error(`module.register failed: ${JSON.stringify(frame?.error)} ${run.stderr}`);
    const after=listing();
    if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('module.register changed files outside the module slice');
    mkdirSync(dir,{recursive:true});
    const tar=spawnSync('tar',['-czf',join(dir,'workspace.tar.gz'),'-C',workspace,'.coc'],{encoding:'utf8'});
    if(tar.status!==0)throw new Error(`tar failed: ${tar.stderr}`);
    for(const file of ['turn.json','baseline.json'])copyFileSync(join(source.dir,file),join(dir,file));
    const starter=join(root,'content/starters',source.turn.module,'module-graph.json');
    writeFileSync(join(dir,'variant.json'),JSON.stringify({derived_from:from,source_tarball_sha256:sha(source.tarball),change:'module slice re-registered from the starter by module.register',
      module:source.turn.module,registered:frame.result,starter_sha256:sha(starter),
      starter_commit:spawnSync('git',['log','-1','--format=%H','--',starter],{cwd:root,encoding:'utf8'}).stdout.trim(),
      unchanged_outside_modules:after.length},null,1)+'\n');
  }finally{removeTree(workspace);}
}

if(import.meta.url===`file://${process.argv[1]}`&&process.argv.includes('--make'))make(process.argv[process.argv.indexOf('--fixture')+1]||'turn3');
if(import.meta.url===`file://${process.argv[1]}`&&process.argv.includes('--derive'))derive(process.argv[process.argv.indexOf('--derive')+1],process.argv[process.argv.indexOf('--from')+1]||'turn3');
