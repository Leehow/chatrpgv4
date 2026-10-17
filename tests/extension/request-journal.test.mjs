import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequestJournal} from '../../extensions/table/request-journal.ts';
import {customMessage,requestSize,pairedTools} from '../../extensions/table/context-policy.ts';
import {readFileSync} from 'node:fs';
import {stream} from '@earendil-works/pi-ai/api/anthropic-messages';
import {convertToLlm} from './pi.mjs';
import {placeBreakpoints,prefixSnapshot} from '../../extensions/anthropic-cache/shared/policy.js';

const context=(turn,extra=[])=>[
  customMessage('coc-context-brief','The immutable book. '.repeat(200)),
  customMessage('coc-capsule',{head:'Current state',fixed:'A long stable section. '.repeat(300),where:'Office',turn:{number:turn}}),
  customMessage('coc-history',{kind:'historical_quotations',before_turn:turn,quotes:[{turn:turn-1,text:'Earlier words'}]}),
  {role:'user',content:[{type:'text',text:'I ask again.'}],timestamp:turn},
  ...extra,
  customMessage('coc-clerk',{kind:'clerk',instructions:'Only act on the current input.',step:extra.length}),
];
const input=(turn,messages=context(turn),budget=50000,key='same-source')=>({turn,messages,budget,key});
const call={role:'assistant',timestamp:2,content:[{type:'toolCall',id:'call-a',name:'look',arguments:{}}]};
const answer={role:'toolResult',timestamp:3,toolCallId:'call-a',toolName:'look',content:[{type:'text',text:'The door is closed.'}]};

test('successive inputs and tool continuations only append; snapshots reconstruct current state',()=>{
  const journal=createRequestJournal();
  const first=journal.project(input(1));journal.commit();
  const second=journal.project(input(2));journal.commit();
  assert.deepEqual(second.messages.slice(0,first.messages.length),first.messages);
  assert.ok(JSON.stringify(second.messages.at(-1)).includes('context_revision'));
  assert.ok(!JSON.stringify(second.messages.slice(first.messages.length)).includes('A long stable section.'));
  const third=journal.project(input(2,context(2,[call,answer])));journal.commit();
  assert.deepEqual(third.messages.slice(0,second.messages.length),second.messages);
  assert.ok(pairedTools(third.messages));
  assert.equal(third.messages.filter(m=>m.role==='toolResult').length,1);
  const repeat=journal.project(input(2,context(2,[call,answer])));
  assert.deepEqual(repeat.messages,third.messages);
  const revision=JSON.parse(second.messages.at(-1).content);
  const update=revision.updates.find(row=>row.context_type==='coc-capsule');
  assert.deepEqual(update.sections,{turn:{number:2}});
  const baseline=JSON.parse(first.messages.find(row=>row.customType==='coc-capsule').content);
  Object.assign(baseline,update.sections);
  assert.equal(baseline.turn.number,2);
  assert.equal(baseline.fixed,'A long stable section. '.repeat(300));
});

test('unsubmitted context candidates do not become history',()=>{
  const journal=createRequestJournal();journal.project(input(1));
  const next=journal.project(input(2));journal.commit();
  assert.ok(!JSON.stringify(next.messages).includes('"number":1'));
});

test('the complete final assistant response is appended between inputs without importing an orphan tool call',()=>{
  const journal=createRequestJournal();const first=journal.project(input(1));journal.commit();
  const completed={role:'assistant',timestamp:123,stopReason:'stop',content:[{type:'thinking',thinking:'Prior reasoning',thinkingSignature:''},{type:'text',text:'Prior final answer'}]};
  journal.complete(completed);
  const next=journal.project(input(2));journal.commit();
  assert.deepEqual(next.messages.slice(0,first.messages.length),first.messages);
  assert.deepEqual(next.messages[first.messages.length],completed);
  journal.complete({...call,stopReason:'toolUse'});
  const third=journal.project(input(3));
  assert.equal(third.messages.filter(m=>m.role==='assistant'&&m.content.some(b=>b.type==='toolCall')).length,0);
});

test('a private final response survives exact display redaction in the next real request projection',()=>{
  const journal=createRequestJournal();journal.project(input(1));journal.commit();
  const complete={role:'assistant',provider:'minimax-cn',model:'MiniMax-M3.1-Flash-Preview',timestamp:123,stopReason:'stop',
    content:[{type:'thinking',thinking:'Prior reasoning',thinkingSignature:'opaque'},
      {type:'text',text:'{"version":1,"record":{},"text":"A private framed reply"}'}]};
  journal.complete(complete,{privateReplay:true});
  const redacted={...complete,content:complete.content.filter(block=>block.type!=='text')};
  const missingProducer=createRequestJournal();missingProducer.project(input(1));missingProducer.commit();
  missingProducer.complete(redacted);
  const lost=missingProducer.project(input(1,context(1,[redacted])));
  assert.equal(lost.messages.filter(message=>message.role==='assistant').flatMap(message=>message.content).some(block=>block.type==='text'),false);
  journal.complete(redacted);
  const next=journal.project(input(1,context(1,[redacted])));journal.commit();
  assert.equal(next.observation.reset,undefined);assert.equal(next.observation.restored_response_texts,1);
  assert.deepEqual(next.messages.filter(message=>message.role==='assistant'),[complete]);
  assert.deepEqual(redacted.content,[complete.content[0]],'the stored/display message stays redacted');
  const changed={...redacted,content:[{...redacted.content[0],thinking:'Changed reasoning'}]};
  assert.equal(journal.project(input(1,context(1,[changed]))).observation.reset,'native_message_changed');
  assert.equal(journal.project(input(1,context(1,[redacted]),50000,'other-source')).messages.some(message=>
    message.role==='assistant'&&message.content.some(block=>block.type==='text')),false);
});

test('book-window revisions keep the initial cache brief and append exact nested changes without retransmitting the book',()=>{
  const journal=createRequestJournal(),firstMessages=context(1);
  const book={kind:'context_brief',module:{book:'Stable book text. '.repeat(1000),people:[{name:'Porter',seen:false}],'a/b~c':'old'}};
  firstMessages[0]=customMessage('coc-context-brief',book);
  const first=journal.project(input(1,firstMessages));journal.commit();
  const changed=structuredClone(book);changed.module.people[0].seen=true;changed.module.people.push({name:'Nurse'});delete changed.module['a/b~c'];
  const nextMessages=context(2);nextMessages[0]=customMessage('coc-context-brief',changed);
  const next=journal.project(input(2,nextMessages));
  assert.deepEqual(next.messages.slice(0,first.messages.length),first.messages);
  assert.equal(next.messages.filter(row=>row.customType==='coc-context-brief').length,1);
  assert.equal(next.messages[0].content,JSON.stringify(book));
  const update=JSON.parse(next.messages.at(-1).content).updates.find(row=>row.context_type==='coc-context-brief');
  assert.ok(update.patch);assert.ok(JSON.stringify(update).length<1000);
  const rebuilt=structuredClone(book);
  for(const op of update.patch){
    const keys=op.path.slice(1).split('/').map(key=>key.replaceAll('~1','/').replaceAll('~0','~'));
    const key=keys.pop();let owner=rebuilt;for(const part of keys)owner=owner[part];
    if(op.op==='remove')delete owner[key];else if(key==='-')owner.push(op.value);else owner[key]=op.value;
  }
  assert.deepEqual(rebuilt,changed);
});

test('retired and removed snapshot fields do not remain current; identical player text in a new turn survives',()=>{
  const journal=createRequestJournal();journal.project(input(1));journal.commit();
  const messages=context(2).filter(row=>row.customType!=='coc-clerk');
  const capsule=messages.find(row=>row.customType==='coc-capsule');
  const value=JSON.parse(capsule.content);delete value.where;capsule.content=JSON.stringify(value);
  const result=journal.project(input(2,messages));
  assert.equal(result.messages.filter(row=>row.role==='user').length,2);
  const revision=JSON.parse(result.messages.at(-1).content);
  assert.deepEqual(revision.updates.find(row=>row.context_type==='coc-capsule').removed,['where']);
  assert.ok(revision.retired.includes('coc-clerk'));
});

test('source changes, backward turns, native mutations and capacity make explicit bounded checkpoints',()=>{
  for(const reason of ['identity_changed','turn_rewound','native_message_changed','capacity']){
    const journal=createRequestJournal();const initial=journal.project(input(2,context(2,[call,answer])));journal.commit();
    let next=input(3,context(3));
    if(reason==='identity_changed')next.key='other-worldline';
    if(reason==='turn_rewound')next=input(1);
    if(reason==='native_message_changed')next=input(2,context(2,[call,{...answer,content:[{type:'text',text:'Changed'}]}]));
    if(reason==='capacity')next.budget=requestSize(initial.messages)+100;
    const result=journal.project(next);
    assert.equal(result.observation.reset,reason);
    assert.ok(requestSize(result.messages)<=next.budget);
    assert.ok(pairedTools(result.messages));
  }
});

test('disclosures, image blocks and hosted-search scopes survive without JSON encoding their native bodies',()=>{
  const journal=createRequestJournal();journal.project(input(1));journal.commit();
  const disclosure=customMessage('coc-mod-sections','Exact reference disclosure.');
  const image={role:'custom',customType:'attachment',content:[{type:'image',data:'abc',mimeType:'image/png'}],timestamp:0};
  const clerk=customMessage('coc-clerk',{kind:'clerk',native_search_scope:{run:'r',step:'s'}});
  const messages=[...context(2).filter(m=>m.customType!=='coc-clerk'),disclosure,image,clerk];
  const result=journal.project(input(2,messages));
  assert.ok(result.messages.some(m=>m.content===disclosure.content));
  assert.deepEqual(result.messages.find(m=>m.customType==='attachment'),image);
  assert.deepEqual(JSON.parse(result.messages.at(-1).content).native_search_scope,{run:'r',step:'s'});
});

test('the real Anthropic SDK sends the entire previous request as an unchanged prefix through turns and tools',async()=>{
  const catalog=JSON.parse(readFileSync(new URL('../../node_modules/@earendil-works/pi-ai/dist/providers/data/minimax-cn.json',import.meta.url)));
  const model={...catalog['anthropic-messages']['chat:MiniMax-M2.7'],id:'MiniMax-M3.1-Flash-Preview',compat:{forceAdaptiveThinking:true,allowEmptySignature:true}};
  const wires=[],journal=createRequestJournal();let previous;
  const strip=value=>Array.isArray(value)?value.map(strip):value&&typeof value==='object'
    ?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='cache_control').map(([key,child])=>[key,strip(child)])):value;
  const frames=[{type:'message_start',message:{id:'test',type:'message',role:'assistant',model:model.id,content:[],usage:{input_tokens:1,output_tokens:0}}},
    {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:0}},{type:'message_stop'}];
  const client={beta:{messages:{create(body){wires.push(structuredClone(body));return{asResponse:async()=>new Response(frames.map(frame=>`event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}})};}}}};
  for(const [turn,messages] of [[1,context(1)],[2,context(2)],[2,context(2,[call,answer])],[3,context(3)]]){
    const projected=journal.project(input(turn,messages));
    const result=await stream(model,{messages:[{role:'system',content:'Stable Keeper instructions.',timestamp:0,
      toolsAdded:[{name:'look',description:'Read the scene.',parameters:{type:'object',properties:{}}}]},...convertToLlm(projected.messages)]},
      {client,thinkingEnabled:true,effort:'medium',onPayload:payload=>{
        const placed=placeBreakpoints(payload,model,{status:'available',text:context(1)[0].content},previous);
        previous=prefixSnapshot(placed.payload,model);return placed.payload;
      }}).result();
    assert.notEqual(result.stopReason,'error',result.errorMessage);journal.commit();
  }
  assert.equal(wires.length,4);
  for(let index=1;index<wires.length;index++){
    assert.deepEqual(strip(wires[index].system),strip(wires[index-1].system));
    assert.deepEqual(strip(wires[index].tools),strip(wires[index-1].tools));
    assert.deepEqual(strip(wires[index].messages.slice(0,wires[index-1].messages.length)),strip(wires[index-1].messages));
    assert.deepEqual(wires[index].thinking,wires[0].thinking);assert.deepEqual(wires[index].output_config,wires[0].output_config);
  }
});
