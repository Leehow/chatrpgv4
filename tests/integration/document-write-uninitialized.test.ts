/** Writing into a carrier that never held text (2026-10-22 sandbox, mc1 turn 3). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,RpcClient,CAMPAIGN,openTurn,prepared,type Row} from './support.ts';

const paper=(name='Notebook',text='',presentation='notebook'):Row=>({name,category:'item',description:'An ordinary writable carrier.',
  basis:'Fixture text, not an authored scenario claim.',parameters:{charges:null,effects:[]},document:{text,presentation},player_view:{description:'A carried paper.',fields:[]}});
const view=(k:RpcClient)=>k.ok('mods.document.view',{campaign:CAMPAIGN,actor:'Thomas Hayes',name:'Notebook'});
test('test_writing_a_carrier_without_text_is_refused_with_its_initialization',async t=>{
  // 2026-10-22 sandbox (mc1 turn 3): writing into an adopted notebook that had no document yet threw
  // "TypeError: unsupported JSON value" from the version digest instead of the carrier's own refusal.
  const k=await kernel(t);await openTurn(k);const draft=paper();delete draft.document;
  await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,draft),{kind:'object',name:'Notebook',to:'Thomas Hayes'}]});
  const refused=await k.tableErr('apply',{call_id:'t1-c2',effects:[{kind:'object',name:'Notebook',from:'Thomas Hayes',to:'Thomas Hayes',
    document:{action:'write',text:'Line one\nLine two'},why:'Hayes writes down what he learned'}]});
  assert.equal(refused.code,'invalid_params');assert.equal(refused.details?.reason,'document_not_initialized');
  await k.table('apply',{call_id:'t1-c3',effects:[{kind:'object',name:'Notebook',from:'Thomas Hayes',to:'Thomas Hayes',
    document:{text:'Line one\nLine two',presentation:'notebook'},why:'Hayes writes down what he learned'}]});
  assert.equal((await view(k)).text,'Line one\nLine two');
});
