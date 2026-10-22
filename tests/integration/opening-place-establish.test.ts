/** Real TS RPC transactions, not live-play evidence (contract §253.1). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,createCampaign} from './support.ts';

const office={kind:'place',action:'establish',additions:[{name:"Knott's Office",within:null,description:'A narrow landlord office by South Station.',
  features:[{name:'Desk',description:'An oak desk with squared stacks of files.'}]}]};

test('the opening registers its place before any player input (live el-v2-20261021f/g opening)',async t=>{
  const k=await kernel(t);await createCampaign(k);
  assert.deepEqual((await k.table('open')).turn,{number:0,state:'awaiting_player'});
  const established=await k.table('apply',{call_id:'t0-c1',effects:[office]});
  assert.ok(established.receipts.length>0,'the opening place establish lands without a first-impression roll opening the turn');
});

test('an opening line that is no preparation says the opening is still owed, not to wait for the player',async t=>{
  const k=await kernel(t);await createCampaign(k);
  const refused=await k.tableErr('apply',{call_id:'t0-c1',effects:[{kind:'place',action:'move',to:'central-library',travel_band:'local_travel',via:'By streetcar'}]});
  assert.equal(refused.code,'turn_state');
  assert.match(refused.fix??'',/opening is not published yet/);assert.doesNotMatch(refused.fix??'',/wait for player_input/);
});
