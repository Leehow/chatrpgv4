/**
 * The preparation worker's `handout-reading` action (contract §155), run as the emitted bundle.
 *
 * The worker is the boundary the host actually crosses: it launches a zero-tool child the way every reader is launched,
 * relays what the child has written so far as `progress` lines while it is still writing, and answers on stdout. The
 * child here is `fixtures/handout-reader.mjs`, so what is under test is the wiring -- which model was launched, with
 * what arguments, what the child saw, what the worker emitted and when, what stayed on disk -- not a provider.
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
async function readOnce(f,input={},env={}){
  const configuration={layout:'source',backend:'typescript',resourceRoot:root,contentRoot:join(root,'content'),agentHome:f.agentHome,nodeExecutable:f.launcher};
  const request={campaign:'one',handout:'clipping',play_language:'en',home:f.home,image:{path:f.image,media_type:'image/png',sha256:sha},
    model:'table/vision',thinking:'high',vision:true,lane:{model:'fallback/lane',thinking:'medium'},...input};
  const child=spawn(process.execPath,[join(root,'build/pipicoc/onboarding-worker.mjs'),'handout-reading',JSON.stringify(request),JSON.stringify(configuration)],
    {env:{...process.env,PI_COC_READER_CMD:'',PI_COC_MOD_MODEL:'',PI_COC_MOD_THINKING:'',HANDOUT_FIXTURE_KEEP:'',...env},stdio:['ignore','pipe','pipe']});
  const seen=[];let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
  await new Promise(done=>child.once('close',done));
  const events=stdout.split('\n').filter(Boolean).map(line=>JSON.parse(line));
  return {events,stderr,progress:events.filter(event=>event.type==='progress').map(event=>event.data),
    result:events.find(event=>event.type==='result')?.data,failure:events.find(event=>event.type==='error')?.data};
}
/** What each launched child recorded. */
function launches(f){
  const attempts=join(f.home,'.coc/handout-readings',sha,'attempts'),rows=[];
  if(existsSync(attempts))for(const id of readdirSync(attempts)){
    const path=join(attempts,id,'launch-argv.json');
    if(existsSync(path))rows.push(JSON.parse(readFileSync(path,'utf8')));
  }
  return rows;
}
const SETTING={extensions:{'coc-keeper':{settings:{'ext.coc-keeper.laneThinking':{level:'off'}}}}};

test('the picture goes to a zero-tool child as an attachment, and the reading streams back while it is written',async t=>{
  const f=fixture(t,SETTING);
  const {result,failure,progress,stderr}=await readOnce(f);
  assert.equal(failure,undefined,`the worker failed: ${stderr}`);
  assert.deepEqual([result.title,result.keep,result.digest],['[en] PRINTED HEADLINE',false,sha]);
  assert.equal(result.text,'[en] Printed body, line one.\n\n[en] Printed body, line two […]');
  // What the child was launched with: no tools, JSON events, the picture as an attachment before `--`, the table's model,
  // the lane's effort (the table's `high` never reaches it).
  const [launch]=launches(f);
  assert.equal(launch.tools,'');assert.equal(launch.mode,'json');assert.deepEqual(launch.attachments,['@image.png']);
  assert.equal(launch.model,'table/vision');assert.equal(launch.thinking,'off');
  assert.equal(launch.seen_sha256,sha,'the child saw exactly the delivered bytes');
  assert.match(launch.brief,/^Play language: en\n/);
  // The reading was relayed while the child was still writing: several states, each longer than the last, the last the answer.
  assert.ok(progress.length>=3,`only ${progress.length} progress lines`);
  for(let index=1;index<progress.length;index++)
    assert.ok(progress[index].title.length>progress[index-1].title.length||progress[index].text.length>progress[index-1].text.length);
  assert.ok(progress.every(row=>row.stage==='reading'));
  assert.deepEqual(progress.at(-1),{stage:'reading',title:result.title,text:result.text});
  assert.ok(progress[0].text.length<result.text.length,'the first state is a beginning, not the whole');
  const [row]=readFileSync(join(f.home,'.coc/handout-readings/telemetry.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual([row.phase,row.model,row.sha256,row.ok],['reading','table/vision',sha,true]);
  assert.ok(Number.isFinite(row.ms));
});

test('a second ask starts no child for the same language, and another language is another reading',async t=>{
  const f=fixture(t,SETTING);
  await readOnce(f);
  const again=await readOnce(f,{campaign:'two'});
  assert.equal(launches(f).length,1);assert.equal(again.result.title,'[en] PRINTED HEADLINE');
  const french=await readOnce(f,{play_language:'fr'});
  assert.equal(launches(f).length,2);assert.equal(french.result.title,'[fr] PRINTED HEADLINE');
});

test('a picture already in the play language is kept, and no text is relayed',async t=>{
  const f=fixture(t,SETTING);
  const {result,progress}=await readOnce(f,{},{HANDOUT_FIXTURE_KEEP:'1'});
  assert.deepEqual([result.keep,result.title,result.text],[true,'','']);
  assert.deepEqual(progress,[]);
});

test('a table model without image input is refused before any child starts, and the code reaches the host',async t=>{
  const f=fixture(t,SETTING);
  const {result,failure}=await readOnce(f,{vision:false});
  assert.equal(result,undefined);
  assert.equal(failure.code,'model_without_images');
  assert.deepEqual(launches(f),[]);
});

test('a picture that is not the one the host checked is refused, and nothing is read',async t=>{
  const f=fixture(t,SETTING);
  writeFileSync(f.image,Buffer.concat([PNG,Buffer.from('replaced')]));
  const {failure}=await readOnce(f);
  assert.equal(failure.code,'handout_not_available');
  assert.deepEqual(launches(f),[]);
});
