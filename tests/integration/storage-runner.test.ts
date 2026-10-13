/** Real native child sessions preserve the four original storage-runner boundaries. */
import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,unlinkSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {storageFixture} from './storage-support.ts';

const ROOT=resolve(import.meta.dirname,'../..'),RUNNER=join(ROOT,'scripts/test-storage.mjs');
const json=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const inside=(path:string,parent:string)=>{const rel=relative(parent,path);return rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);};
function scratch(t:TestContext){return storageFixture(t,{file:import.meta.filename,nodeid:`tests/runner/test_pytest_storage.py::${t.name}`});}
function sandbox(tmp:string,ordinary:string,disk=''){
  const project=join(tmp,'project');mkdirSync(project,{recursive:true});
  const policy=join(project,'storage-policy.json');writeFileSync(policy,JSON.stringify({version:1,disk_files:['test_disk.ts'],disk_tests:[]}));
  const prefix=`import assert from 'node:assert/strict';\nimport {test} from 'node:test';\nimport {writeFileSync,symlinkSync,existsSync} from 'node:fs';\nimport {join} from 'node:path';\nimport {setTimeout as delay} from 'node:timers/promises';\nimport {storageFixture} from ${JSON.stringify(join(ROOT,'tests/integration/storage-support.ts'))};\ntest('test_fixture',async(t)=>{const tmp_path=storageFixture(t,{file:import.meta.filename});\n`;
  writeFileSync(join(project,'test_ordinary.ts'),prefix+ordinary+'\n});\n');
  if(disk)writeFileSync(join(project,'test_disk.ts'),prefix+disk+'\n});\n');
  return{project,env:{...process.env,COC_TEST_STORAGE_POLICY:policy}};
}
function start(project:string,env:NodeJS.ProcessEnv,run:string,mode='hybrid'){
  return spawn(process.execPath,[RUNNER,'--run-dir',run,'--mode',mode,'--','--test-concurrency=1','*.ts'],{cwd:project,env,stdio:'pipe'});
}
function finish(proc:ChildProcessWithoutNullStreams):Promise<{code:number|null;output:string}>{
  let output='';proc.stdout.on('data',chunk=>output+=chunk);proc.stderr.on('data',chunk=>output+=chunk);
  return new Promise((done,reject)=>{const timer=setTimeout(()=>{proc.kill('SIGTERM');reject(new Error('Native storage child timed out: '+output));},20000);proc.once('error',reject);proc.once('close',code=>{clearTimeout(timer);done({code,output});});});
}
function find(root:string,name:string):string{
  for(const entry of readdirSync(root,{withFileTypes:true})){const path=join(root,entry.name);if(entry.name===name)return path;if(entry.isDirectory()){const found=find(path,name);if(found)return found;}}
  return '';
}
test('test_real_fixtures_route_to_independent_roots_without_changing_cases',async(t)=>{
  const tmp=scratch(t),body="writeFileSync(join(tmp_path,'value'),'retained');",{project,env}=sandbox(tmp,body,body),run=join(tmp,'run');
  const {code,output}=await finish(start(project,env,run));assert.equal(code,0,output);
  const report=json(join(run,'storage-main.json')),rows=Object.fromEntries(report.paths.map((row:any)=>[row.nodeid,row]));
  assert.ok(rows['test_disk.ts::test_fixture'],JSON.stringify({report,output}));assert.equal(rows['test_disk.ts::test_fixture'].storage,'disk');assert.ok(inside(rows['test_disk.ts::test_fixture'].path,join(run,'disk')));
  const meta=json(join(run,'run.json'));assert.equal(rows['test_ordinary.ts::test_fixture'].storage,'ordinary');assert.ok(inside(rows['test_ordinary.ts::test_fixture'].path,meta.ordinary));
  assert.deepEqual(new Set(Object.keys(rows)),new Set(report.collected.map((row:any)=>row.nodeid)));assert.ok(!existsSync(meta.ordinary));assert.ok(!existsSync(join(run,'disk')));
});
test('test_failed_ram_and_disk_fixtures_survive_a_later_success',{skip:!existsSync('/dev/shm')&&'Linux shared memory is required'},async(t)=>{
  const tmp=scratch(t),ram="const data=join(tmp_path,'value');writeFileSync(data,'ram failure');symlinkSync(data,join(tmp_path,'alias'));assert.fail('controlled failure');",disk="writeFileSync(join(tmp_path,'value'),'disk failure');assert.fail('controlled failure');";
  const {project,env}=sandbox(tmp,ram,disk),failed=join(tmp,'failed');let result=await finish(start(project,env,failed));assert.equal(result.code,1,result.output);
  const meta=json(join(failed,'run.json'));assert.equal(meta.mode,'hybrid');assert.ok(!existsSync(meta.ordinary));
  const alias=find(join(failed,'ram-evidence'),'alias');assert.equal(readFileSync(alias,'utf8'),'ram failure');assert.equal(readFileSync(find(join(failed,'disk'),'value'),'utf8'),'disk failure');
  sandbox(tmp,'assert.ok(existsSync(tmp_path));');unlinkSync(join(project,'test_disk.ts'));result=await finish(start(project,env,join(tmp,'passed')));assert.equal(result.code,0,result.output);
  assert.equal(readFileSync(alias,'utf8'),'ram failure');assert.equal(readFileSync(find(join(failed,'disk'),'value'),'utf8'),'disk failure');
});
test('test_disk_mode_keeps_all_fixtures_on_disk_and_rejects_run_reuse',async(t)=>{
  const tmp=scratch(t),{project,env}=sandbox(tmp,'assert.ok(existsSync(tmp_path));'),run=join(tmp,'run');let result=await finish(start(project,env,run,'disk'));assert.equal(result.code,0,result.output);
  const meta=json(join(run,'run.json'));assert.ok(meta.mode==='disk'&&inside(meta.ordinary,run));const original=readFileSync(join(run,'run.json'));
  result=await finish(start(project,env,run,'disk'));assert.ok(result.code!==0&&result.output.includes('cannot reuse'));assert.deepEqual(readFileSync(join(run,'run.json')),original);
});
test('test_interruption_preserves_ram_after_stopping_the_owned_child',{skip:!existsSync('/dev/shm')&&'Linux shared memory is required'},async(t)=>{
  const tmp=scratch(t),ready=join(tmp,'ready'),body=`writeFileSync(join(tmp_path,'value'),'interrupted');writeFileSync(${JSON.stringify(ready)},'');while(true)await delay(50);`,{project,env}=sandbox(tmp,body),run=join(tmp,'run'),proc=start(project,env,run),finished=finish(proc);
  try{
    const deadline=Date.now()+10000;while(!existsSync(ready)&&Date.now()<deadline&&proc.exitCode===null)await new Promise(done=>setTimeout(done,50));assert.ok(existsSync(ready));proc.kill('SIGTERM');
    const {code,output}=await finished;assert.equal(code,143,output);assert.equal(readFileSync(find(join(run,'ram-evidence'),'value'),'utf8'),'interrupted');assert.equal(json(join(run,'run.json')).exit_code,143);
  }finally{if(proc.exitCode===null){proc.kill('SIGTERM');await finished;}}
});
