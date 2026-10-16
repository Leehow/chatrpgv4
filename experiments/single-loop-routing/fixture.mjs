/**
 * The turn-3 fixture: a byte copy of the live campaign's workspace slice, and its materialization into a
 * disposable workspace positioned before turn 3 by the kernel's own history operation.
 *
 *   node experiments/single-loop-routing/fixture.mjs --make   # rebuild the tarball from the App's data (read-only)
 *
 * The live source is only read. The tarball holds the campaign directory, its sidecar Git repository,
 * the campaign's module and the installed Mod packages. Module map images are stripped (see README).
 */
import {mkdirSync,mkdtempSync,readFileSync,rmSync,chmodSync,readdirSync,statSync,lstatSync,existsSync,writeFileSync,realpathSync} from 'node:fs';
import {shareTestTree} from '../../scripts/test-workspace.mjs';
import {publishTestFixture,materializeTestFixture,archiveDigest,FIXTURE_REFERENCE} from '../../scripts/test-fixture-store.mjs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

export const FIXTURES=resolve(import.meta.dirname,'fixtures');
export const LIVE_HOME=join(homedir(),'Library/Application Support/Pipi/pipicoc/pi-coc');

/** A fixture by name under fixtures/, or by a directory path (a scratch fixture; its baseline.json is optional). */
export function readFixture(name){
  const dir=name.includes('/')?resolve(name):join(FIXTURES,name),baseline=join(dir,'baseline.json');
  const turn=JSON.parse(readFileSync(join(dir,'turn.json'),'utf8'));
  const reference=existsSync(join(dir,FIXTURE_REFERENCE))?JSON.parse(readFileSync(join(dir,FIXTURE_REFERENCE),'utf8')):null;
  // SL-13: the turns of one live gate share one workspace tarball (turn.json's `tarball`, relative to the fixture).
  return {dir,turn,baseline:existsSync(baseline)?JSON.parse(readFileSync(baseline,'utf8')):{},
    workspace:reference?resolve(dir,reference.workspace):typeof turn.workspace==='string'?resolve(dir,turn.workspace):null,
    tree_sha256:reference?.tree_sha256,
    tarball:typeof turn.tarball==='string'?resolve(dir,turn.tarball):join(dir,'workspace.tar.gz')};
}
export const fixtureDigest=fixture=>fixture.tree_sha256??(fixture.workspace?JSON.parse(readFileSync(join(fixture.workspace,'..',FIXTURE_REFERENCE),'utf8')).tree_sha256:archiveDigest(fixture.tarball));

function writable(path){
  try{const stat=lstatSync(path);if(stat.isSymbolicLink())return;if(stat.isDirectory()){chmodSync(path,stat.mode|0o700);for(const entry of readdirSync(path))writable(join(path,entry));}}catch{/* already gone */}
}
/** A background lane of the finished session may still be writing into the workspace: retry instead of leaking it. */
export function removeTree(path){writable(path);rmSync(path,{recursive:true,force:true,maxRetries:10,retryDelay:200});}

/** Extract the tarball into a fresh temporary workspace. The caller removes it. */
export function materialize(name){
  const fixture=readFixture(name),workspace=mkdtempSync(join(realpathSync(tmpdir()),'single-loop-routing-'));
  rmSync(workspace,{recursive:true});
  try{materializeTestFixture({workspace:fixture.workspace,archive:fixture.tarball},workspace);return workspace;}
  catch(error){mkdirSync(workspace,{recursive:true});writeFileSync(join(workspace,'materialization-error.json'),JSON.stringify({error:String(error),fixture:name}));throw error;}
}

function make(name){
  const {dir,turn}=readFixture(name),source=join(LIVE_HOME,'.coc'),stage=mkdtempSync(join(realpathSync(tmpdir()),'single-loop-fixture-'));
  try{
    const slices=[['campaigns',turn.campaign],['repos',`${turn.campaign}.git`],['modules',turn.module],['mods','packages']];
    for(const [root,entry] of slices)shareTestTree(join(source,root,entry),join(stage,'.coc',root,entry));
    const assets=join(stage,'.coc/modules',turn.module,'assets');
    if(existsSync(assets))removeTree(assets);
    publishTestFixture(stage,dir);
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
    publishTestFixture(workspace,dir);
    for(const file of ['turn.json','baseline.json'])shareTestTree(join(source.dir,file),join(dir,file));
    // SL-25: a source that names a shared tarball (gate-fixture.mjs) would have the copy read the source's bytes, not the
    // derived ones; the derived turn reads its own.
    if(typeof source.turn.tarball==='string'||typeof source.turn.workspace==='string'){const {tarball:_shared,workspace:_workspace,...own}=source.turn;writeFileSync(join(dir,'turn.json'),JSON.stringify(own,null,1)+'\n');}
    const starter=join(root,'content/starters',source.turn.module,'module-graph.json');
    writeFileSync(join(dir,'variant.json'),JSON.stringify({derived_from:from,source_fixture_sha256:fixtureDigest(source),change:'module slice re-registered from the starter by module.register',
      module:source.turn.module,registered:frame.result,starter_sha256:sha(starter),
      starter_commit:spawnSync('git',['log','-1','--format=%H','--',starter],{cwd:root,encoding:'utf8'}).stdout.trim(),
      unchanged_outside_modules:after.length},null,1)+'\n');
  }finally{removeTree(workspace);}
}

if(import.meta.url===`file://${process.argv[1]}`&&process.argv.includes('--make'))make(process.argv[process.argv.indexOf('--fixture')+1]||'turn3');
if(import.meta.url===`file://${process.argv[1]}`&&process.argv.includes('--derive'))derive(process.argv[process.argv.indexOf('--derive')+1],process.argv[process.argv.indexOf('--from')+1]||'turn3');
