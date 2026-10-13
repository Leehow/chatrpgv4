/** Driver transport regressions, not live acceptance or Keeper decisions. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {replay_turn} from './rules-driver-support.ts';
import {player_mechanics} from '../play/driver.ts';

const entry=(customType:string,data:Record<string,unknown>,extra:Record<string,unknown>={})=>
  ({type:'entry_appended',entry:{type:'custom',customType,data,...extra}});
const start=()=>entry('coc-final-delivery',{version:1,event:'start',delivery_id:'delivery',attempt_id:'attempt',
  campaign:'c',turn:7,sequence:1});
const delta=()=>entry('coc-final-delivery',{version:1,event:'delta',delivery_id:'delivery',attempt_id:'attempt',
  sequence:2,delta:'{{name:Visitor}} listens to your request.'});
const end=(status='completed',sequence=3)=>entry('coc-final-delivery',{version:1,event:'end',delivery_id:'delivery',attempt_id:'attempt',
  sequence,status});
const footer=()=>entry('coc-mechanics',{turn:7,final_stream_id:'delivery',mechanics:[],
  marked_text:'{{say:Visitor}}The visitor listens to your request.{{/say}}'});

test('the actual driver selects the canonical public footer before stream completion',async()=>{
  const result=await replay_turn([[0,{type:'agent_start'}],[.1,start()],[.2,delta()],[.3,footer()],
    [.4,end()],[.5,{type:'agent_settled'}]]);
  assert.equal(result.final_text,'The visitor listens to your request.');
  assert.equal(result.delivery.rendered_text,result.final_text);
  assert.equal(result.settle_class,'settled');
});

test('the actual finalizing footer completed ordering and a later footer select the same published body',async()=>{
  for(const tail of [[end('finalizing'),footer(),end('completed',4)],[end(),footer()]]){
    const result=await replay_turn([[0,{type:'agent_start'}],[.1,start()],[.2,delta()],
      ...tail.map((event,index)=>[.3+index/10,event]),[.7,{type:'agent_settled'}]]);
    assert.equal(result.final_text,'The visitor listens to your request.');
    assert.equal(result.delivery.rendered_text,result.final_text);
  }
});

test('old, unrelated, hidden and empty footers preserve the completed public stream',async()=>{
  const canonical=footer();
  for(const ignored of [
    entry('coc-mechanics',{mechanics:[],marked_text:'LEGACY_UNLINKED_BODY'}),
    entry('coc-mechanics',{...canonical.entry.data,final_stream_id:'other-delivery'}),
    entry('coc-mechanics',{...canonical.entry.data,turn:8}),
    entry('coc-mechanics',{...canonical.entry.data},{display:false}),
    entry('coc-mechanics',{...canonical.entry.data},{type:'message'}),
    entry('coc-mechanics',{...canonical.entry.data,mechanics:undefined}),
    entry('coc-mechanics',{turn:7,final_stream_id:'delivery',mechanics:[]}),
    entry('coc-mechanics',{...canonical.entry.data,marked_text:'  '}),
    entry('coc-mechanics',{...canonical.entry.data,marked_text:'{{say:Visitor}}{{time:1}}{{/say}}',rendered_text:'STALE_BODY'}),
  ]){
    const result=await replay_turn([[0,{type:'agent_start'}],[.1,start()],[.2,delta()],[.3,ignored],
      [.4,end()],[.5,{type:'agent_settled'}]]);
    assert.equal(result.final_text,'{{name:Visitor}} listens to your request.');
  }
});

test('a matching older rendered body is retained without a marked body',async()=>{
  const result=await replay_turn([[0,{type:'agent_start'}],[.1,start()],[.2,delta()],
    [.3,entry('coc-mechanics',{turn:7,final_stream_id:'delivery',mechanics:[],rendered_text:'The visitor nods.'})],
    [.4,end()],[.5,{type:'agent_settled'}]]);
  assert.equal(result.final_text,'The visitor nods.');
});

test('uncompleted or mismatched attempts cannot promote a footer or private assistant into a delivered result',async()=>{
  for(const stopped of [end('interrupted'),end('publication_pending'),
    entry('coc-final-delivery',{...end().entry.data,attempt_id:'other-attempt'})]){
    const result=await replay_turn([[0,{type:'agent_start'}],[.1,start()],[.2,delta()],[.3,footer()],[.4,stopped],
      [.5,{type:'message_update',message:{display:false},assistantMessageEvent:{type:'text_delta',delta:'PRIVATE_ASSISTANT'}}],
      [.6,{type:'message_end',message:{role:'assistant',display:false,content:[{type:'text',text:'PRIVATE_ASSISTANT'}]}}],
      [.7,{type:'agent_settled'}]]);
    assert.equal(result.final_text,'');
    assert.equal(result.settle_class,'empty');
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE_ASSISTANT|The visitor listens/);
  }
});

test('canonical prose retains existing reference replies and public mechanics privacy',async()=>{
  const result=await replay_turn([[0,{type:'agent_start'}],[.1,start()],[.2,delta()],
    [.3,entry('coc-delivery',{}, {display:true,content:'The rule allows this.',
      details:{coc_delivery:true,reference_reply:true}})],
    [.4,entry('coc-mechanics',{...footer().entry.data,private_note:'PRIVATE_NOTE',mechanics:[
      {kind:'time',minutes:3},{kind:'roll',visibility:'concealed',skill:'Psychology',roll:99,target:50},
      {kind:'roll',visibility:'keeper',skill:'PRIVATE_CHECK',roll:1}]})],
    [.5,end()],[.6,{type:'agent_settled'}]]);
  assert.equal(result.final_text,'The rule allows this.\n\nThe visitor listens to your request.');
  assert.deepEqual(player_mechanics(result.delivery.mechanics),[
    {kind:'time',minutes:3},{kind:'roll',visibility:'concealed',skill:'Psychology'}]);
  assert.doesNotMatch(result.final_text,/PRIVATE_|99|50/);
});

test('a late canonical footer cannot overwrite a different accepted tool delivery',async()=>{
  const result=await replay_turn([[0,{type:'agent_start'}],[.1,start()],[.2,delta()],[.3,end()],
    [.4,{type:'tool_execution_start',toolCallId:'later',toolName:'narrate',args:{}}],
    [.5,{type:'tool_execution_end',toolCallId:'later',isError:false,result:{content:[{type:'text',
      text:JSON.stringify({rendered_text:'The accepted second response.',mechanics:[]})}]}}],
    [.6,footer()],[.7,{type:'agent_settled'}]]);
  assert.equal(result.final_text,'The accepted second response.');
  assert.equal(result.delivery.rendered_text,result.final_text);
});

test('a result without public characters keeps the accepted body linked to its later canonical footer',async()=>{
  for(const body of [{mechanics:[]},{rendered_text:'{{time:1}}{{say:Visitor}}{{/say}}',mechanics:[]}]){
    const result=await replay_turn([[0,{type:'agent_start'}],[.1,start()],[.2,delta()],[.3,end()],
      [.4,{type:'tool_execution_start',toolCallId:'later',toolName:'narrate',args:{}}],
      [.5,{type:'tool_execution_end',toolCallId:'later',isError:false,result:{content:[{type:'text',text:JSON.stringify(body)}]}}],
      [.6,footer()],[.7,{type:'agent_settled'}]]);
    assert.equal(result.final_text,'The visitor listens to your request.');
    assert.equal(result.delivery.rendered_text,result.final_text);
  }
});

test('an earlier empty acknowledgement cannot prevent the accepted stream from binding its canonical footer',async()=>{
  const result=await replay_turn([[0,{type:'agent_start'}],
    [.05,{type:'tool_execution_start',toolCallId:'earlier',toolName:'narrate',args:{}}],
    [.06,{type:'tool_execution_end',toolCallId:'earlier',isError:false,result:{content:[{type:'text',text:'{"mechanics":[]}'}]}}],
    [.1,start()],[.2,delta()],[.3,end()],[.4,footer()],[.5,{type:'agent_settled'}]]);
  assert.equal(result.final_text,'The visitor listens to your request.');
  assert.equal(result.delivery.rendered_text,result.final_text);
});
