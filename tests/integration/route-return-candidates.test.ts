/** New kernel-ts/runtime/apply-operation.ts regression; frozen migration counterparts stay unchanged. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,createCampaign,type Row} from './support.ts';
test('a travelled reverse road remains offered after the navigation stack forgets its destination',async t=>{
  const k=await kernel(t);await createCampaign(k);await k.table('open');
  await k.table('narrate',{call_id:'t0-c1',text:'The public street is clear.'});
  await k.table('player_input',{text:'I walk between the two public shops and return.'});
  await k.table('apply',{call_id:'t1-c1',effects:[{kind:'move',to:'Fixture Lodge',via:'public street',travel_minutes:3,establish:{summary:'A public lodging house.',within:null}}]});
  await k.table('apply',{call_id:'t1-c2',effects:[{kind:'move',to:'Fixture Diner',via:'public street',travel_minutes:3,establish:{summary:'A public diner.',within:null}}]});
  await k.table('apply',{call_id:'t1-c3',effects:[{kind:'move',to:'Fixture Lodge'}]});
  const options=await k.table('apply.options');
  const offered=options.candidates.find((candidate:Row)=>candidate.effect.kind==='move'&&candidate.effect.to==='Fixture Diner');
  assert.ok(offered,'execution supports the reverse road, so the catalog must offer it');
  assert.equal(offered.description.travel_minutes,3,JSON.stringify(offered));
  assert.deepEqual((await k.table('apply',{call_id:'t1-c4',effects:[offered.effect]})).world.clock,{minutes:12});
});
