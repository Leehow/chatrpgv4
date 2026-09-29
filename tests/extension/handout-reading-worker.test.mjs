/**
 * The preparation worker's `handout-reading` action (contract §155), run as the emitted bundle.
 *
 * The worker is the boundary the host actually crosses: it resolves the two models (the table's for the picture, the
 * lane's for the words), launches the child the way every reader is launched, and answers on stdout. The child here is
 * `fixtures/handout-reader.mjs`, so what is under test is the wiring -- which model launched which step, what the
 * child saw, what the worker emitted, what stayed on disk -- not a provider.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {test} from 'node:test';

const root=resolve(import.meta.dirname,'../..');
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const PNG=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('a clipping')]);
const sha=createHash('sha256').update(PNG).digest('hex');

function fixture(t,settings){
  const base=realpathSync(mkdtempSync(join(tmpdir(),'handout worker ')));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const home=join(base,'home'),agentHome=join(base,'agent');
  for(const path of [home,agentHome])mkdirSync(path,{recursive:true});
  if(settings)writeFileSync(join(agentHome,'pipiui-settings.json'),JSON.stringify(settings));
  const image=join(base,'clipping.png');writeFileSync(image,PNG);
  const launcher=join(base,'selected node');
  writeFileSync(launcher,`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(root,'tests/extension/fixtures/handout-reader.mjs'))} "$@"\n`,{mode:0o755});
  return {home,agentHome,image,launcher};
}
async function readOnce(f,input={}){
  const configuration={layout:'source',backend:'typescript',resourceRoot:root,contentRoot:join(root,'content'),agentHome:f.agentHome,nodeExecutable:f.launcher};
  const request={campaign:'one',handout:'clipping',play_language:'en',home:f.home,image:{path:f.image,media_type:'image/png',sha256:sha},
    model:'table/vision',thinking:'high',vision:true,lane:{model:'fallback/lane',thinking:'medium'},...input};
  const child=spawn(process.execPath,[join(root,'build/pipicoc/onboarding-worker.mjs'),'handout-reading',JSON.stringify(request),JSON.stringify(configuration)],
    {env:{...process.env,PI_COC_READER_CMD:'',PI_COC_MOD_MODEL:'',PI_COC_MOD_THINKING:''},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
  await new Promise(done=>child.once('close',done));
  const events=stdout.split('\n').filter(Boolean).map(line=>JSON.parse(line));
  return {events,stderr,result:events.find(event=>event.type==='result')?.data,failure:events.find(event=>event.type==='error')?.data};
}
/** What each launched child recorded, oldest first. */
function launches(f){
  const attempts=join(f.home,'.coc/handout-readings',sha,'attempts'),rows=[];
  const walk=folder=>{for(const entry of readdirSync(folder,{withFileTypes:true})){
    const path=join(folder,entry.name);
    if(entry.isDirectory())walk(path);else if(entry.name==='launch-argv.json')rows.push(JSON.parse(readFileSync(path,'utf8')));}};
  if(existsSync(attempts))walk(attempts);
  const projections=join(f.home,'.coc/handout-readings',sha,'readings');
  if(existsSync(projections))walk(projections);
  return rows;
}
const SETTING={extensions:{'coc-keeper':{settings:{'ext.coc-keeper.laneModel':{model:'lanes/settled'},'ext.coc-keeper.laneThinking':{level:'off'}}}}};

test('the picture is read on the table\'s model and the words on the lane setting, and the answer is the reading',async t=>{
  const f=fixture(t,SETTING);
  const {result,failure,stderr}=await readOnce(f);
  assert.equal(failure,undefined,`the worker failed: ${stderr}`);
  assert.equal(result.title,'[en] PRINTED HEADLINE');
  assert.equal(result.text,'[en] Printed body, line one.');
  assert.equal(result.keep,false);assert.equal(result.digest,sha);
  const rows=launches(f),transcription=rows.find(row=>row.phase==='transcription'),projection=rows.find(row=>row.phase==='projection');
  // The reader saw exactly the delivered bytes, under a name that says what they are.
  assert.equal(transcription.image,'image.png');assert.equal(transcription.seen_sha256,sha);
  // Two models for two steps. The lane setting outranks the caller's fallback; the table's effort never reaches either step.
  assert.equal(transcription.model,'table/vision');assert.equal(projection.model,'lanes/settled');
  assert.equal(transcription.thinking,'off');assert.equal(projection.thinking,'off');
  // Cost evidence for both steps.
  const telemetry=readFileSync(join(f.home,'.coc/handout-readings/telemetry.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(telemetry.map(row=>[row.phase,row.model]),[['transcription','table/vision'],['projection','lanes/settled']]);
  assert.ok(telemetry.every(row=>row.sha256===sha&&Number.isFinite(row.ms)));
});

test('a second run, in another language, reads no picture again and answers from disk for the same language',async t=>{
  const f=fixture(t,SETTING);
  await readOnce(f);
  const before=launches(f).length;
  const other=await readOnce(f,{campaign:'two',play_language:'fr'});
  assert.equal(other.result.title,'[fr] PRINTED HEADLINE');
  const after=launches(f);
  assert.equal(after.filter(row=>row.phase==='transcription').length,1,'one transcription serves both languages');
  assert.equal(after.length,before+1);
  await readOnce(f);
  assert.equal(launches(f).length,before+1,'the same table again starts no child');
});

test('a table model without image input is refused before any child starts, and the code reaches the host',async t=>{
  const f=fixture(t,SETTING);
  const {result,failure}=await readOnce(f,{vision:false});
  assert.equal(result,undefined);
  assert.equal(failure.code,'model_without_images');
  assert.deepEqual(launches(f),[]);
});

test('a picture that is not the one the host checked is refused, and nothing is transcribed',async t=>{
  const f=fixture(t,SETTING);
  writeFileSync(f.image,Buffer.concat([PNG,Buffer.from('replaced')]));
  const {failure}=await readOnce(f);
  assert.equal(failure.code,'handout_not_available');
  assert.deepEqual(launches(f),[]);
});
