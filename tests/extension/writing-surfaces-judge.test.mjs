/** Contract §277: the host asks Jev once per carried row and keeps what it answered; a failed question registers nothing. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWritingSurfaceJudge} from '../../extensions/mods/writing-surfaces.ts';
import {writingSurfaceBatch} from '../../runtime/jev/writing-surfaces.ts';

const rows=[{id:'a',name:'Notebook and stub pencil',row:'Notebook and stub pencil'},{id:'b',name:'Flashlight',row:{name:'Flashlight',quantity:1}},
  {id:'c',name:'Sketch pad',row:'Sketch pad'}];
function kernel(listed=rows) {
  const calls=[];
  return {calls,call:async(method,params)=>{calls.push({method,params});
    if(method==='mods.equipment.surfaces')return{version:'1',rows:listed};
    if(method==='mods.equipment.surfaces.submit')return{written:params.verdicts.length};
    throw new Error(method);}};
}
const port=(answers,seen=[])=>({async decide(batch){seen.push(batch);return{batchId:batch.id,status:'complete',
  answers:Object.fromEntries(batch.questions.map((question,i)=>[question.key,{status:'answered',type:'choice',...answers[i]}]))};}});

test('each listed row is asked as one choice and every answer is submitted, low confidence as none',async()=>{
  const seen=[],records=[],{calls,call}=kernel();
  const judge=createWritingSurfaceJudge({record:row=>records.push(row),decision:()=>port([{choice:'notebook',confidence:0.93},{choice:'none',confidence:0.97},{choice:'paper',confidence:0.41}],seen)});
  assert.equal(await judge('c1',call),3);
  assert.equal(seen.length,1);assert.deepEqual(seen[0].questions.map(question=>Object.keys(question.criteria)),[0,1,2].map(()=>['none','paper','notebook','book']));
  assert.deepEqual(calls.at(-1).params.verdicts,[{id:'a',surface:'notebook'},{id:'b',surface:'none'},{id:'c',surface:'none'}]);
  assert.equal(records.at(-1).lane,'writing-surfaces');assert.equal(records.at(-1).jev_calls,1);
});

test('no rows asks nothing; a failed or unconfigured question submits nothing and pauses the campaign',async()=>{
  let asked=0;
  const empty=kernel([]),quiet=createWritingSurfaceJudge({record:()=>{},decision:()=>{asked++;return port([]);}});
  assert.equal(await quiet('c1',empty.call),0);assert.equal(asked,0);
  const failing={async decide(batch){return{batchId:batch.id,status:'failed',answers:{},failure:{code:'provider_unavailable'}};}};
  const records=[],down=kernel(),judge=createWritingSurfaceJudge({record:row=>records.push(row),decision:()=>failing});
  assert.equal(await judge('c1',down.call),0);
  assert.equal(down.calls.some(value=>value.method==='mods.equipment.surfaces.submit'),false);
  assert.equal(records.at(-1).event,'fallback');
  assert.equal(await judge('c1',down.call),0);
  assert.equal(down.calls.filter(value=>value.method==='mods.equipment.surfaces').length,1,'paused after a failure');
  const unset=kernel(),none=createWritingSurfaceJudge({record:()=>{},decision:()=>undefined});
  assert.equal(await none('c1',unset.call),0);assert.equal(unset.calls.length,1);
});

test('the question carries the sheet rows as data',()=>{
  const batch=writingSurfaceBatch(rows.map(({name,row})=>({name,row})),'c1');
  assert.deepEqual(batch.state.items.e2,{name:'Flashlight',row:{name:'Flashlight',quantity:1}});
  assert.equal(batch.family,'equipment-writing-surfaces');
});
