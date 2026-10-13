/** Committed conversational context from test_last_exchange.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,createCampaign,openTurn,type RpcClient,type Row} from './support.ts';
const ASKED='我问诺特那栋房子的事。',KNOTT_SAID='「那房子空了好些年。」',EDNA_SAID='「钥匙在我这儿。」';
const client=(t:any)=>kernel(t,{env:{COC_KERNEL_SEED:'1'}});
const status=(k:RpcClient)=>k.table('status');
const label=async(k:RpcClient,name:string)=>{const person=(await k.table('capsule')).present.find((row:Row)=>row.name===name);return person.called?.name||person.name;};
async function bothSpoke(k:RpcClient){await openTurn(k,ASKED);await k.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'Edna Hale',to:'here',walk_on:true,why:"test fixture: the landlord's clerk"}]});
  await k.table('narrate',{call_id:'t1-c2',text:`诺特靠回椅背。{{say:Steven Knott}}${KNOTT_SAID}{{/say}}埃德娜抬起头。{{say:Edna Hale}}${EDNA_SAID}{{/say}}`});}
test('test_the_last_turns_words_and_the_lines_its_markers_gave_each_person',async t=>{
  const k=await client(t);await bothSpoke(k);await k.table('player_input',{text:'那你先把钥匙给我。'});
  assert.deepEqual((await status(k)).last_exchange,{turn:1,player_text:ASKED,speech:[{who:await label(k,'Steven Knott'),line:KNOTT_SAID},{who:await label(k,'Edna Hale'),line:EDNA_SAID}]});
});
test('test_no_committed_turn_before_this_one_is_no_exchange',async t=>{
  const k=await client(t);await createCampaign(k);const result=await status(k);assert.equal(result.turn,0);assert.equal(result.last_exchange,null);
});
test('test_a_turn_with_neither_words_nor_attributed_lines_is_no_exchange',async t=>{
  const k=await client(t);await openTurn(k);assert.equal((await status(k)).last_exchange,null);
});
test('test_the_opening_is_an_exchange_when_someone_spoke_in_it',async t=>{
  const k=await client(t);await createCampaign(k);await k.table('open');await k.table('narrate',{call_id:'t0-c1',text:`开场。诺特抬头。{{say:Steven Knott}}${KNOTT_SAID}{{/say}}`});
  await k.table('player_input',{text:'你说什么？'});assert.deepEqual((await status(k)).last_exchange,{turn:0,player_text:null,speech:[{who:await label(k,'Steven Knott'),line:KNOTT_SAID}]});
});
test('test_leaving_the_scene_ends_the_exchange',async t=>{
  const k=await client(t);await bothSpoke(k);await k.table('player_input',{text:'我去《环球报》报馆翻旧报纸。'});assert.notEqual((await status(k)).last_exchange,null);
  await k.table('apply',{call_id:'t2-c1',effects:[{kind:'move',to:'newspaper-morgue'}]});assert.equal((await status(k)).last_exchange,null);
});
test('test_the_delivery_s_last_six_lines_each_bounded_and_an_unresolved_speaker_left_out',async t=>{
  const k=await client(t);await openTurn(k,ASKED);const longLine='「'+'很'.repeat(300)+'」',lines=Array.from({length:7},(_,i)=>`{{say:Steven Knott}}「第${i+1}句。」{{/say}}`).join('');
  await k.table('narrate',{call_id:'t1-c1',text:`{{say:a passer-by nobody knows}}「借过。」{{/say}}${lines}{{say:Steven Knott}}${longLine}{{/say}}`});await k.table('player_input',{text:'你到底想说什么？'});
  const speech=(await status(k)).last_exchange.speech;assert.deepEqual(speech.slice(0,-1).map((row:Row)=>row.line),Array.from({length:5},(_,i)=>`「第${i+3}句。」`));
  const last=speech.at(-1).line;assert.equal([...last].length,200);assert.ok(last.endsWith('...'));assert.ok(!speech.some((row:Row)=>row.line.includes('借过')));
});
