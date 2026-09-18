import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {KernelError} from '../../extensions/kernel/client.ts';

const answer={status:'answered',answer:'The source describes a harbor worker.',limitations:'',source_refs:[{source_id:'pdf:book',pdf_index:0}],authority:'source-consultation',prepared:false,supported:true};

test('source answer mode returns checked evidence directly instead of a graph lookup',async t=>{
 const table=await openTable({responses:[
  fauxAssistantMessage([fauxToolCall('lookup',{kind:'source',source_mode:'answer',query:'Lena',question:'What does the book say about her work?'})],{stopReason:'toolUse'}),
  fauxAssistantMessage([fauxToolCall('narrate',{text:'She works at the harbor.'})],{stopReason:'toolUse'}),fauxAssistantMessage('She works at the harbor.'),
 ]});t.after(()=>table.dispose());const requests=[];
 table.emit('coc:reading-bridge',{async ensure(mid,params){requests.push(params);return{state:'ready',source_answer:answer};}});
 await table.session.prompt('Check her work in the source.');
 assert.equal(requests.length,1);assert.equal(requests[0].purpose,'answer');assert.equal(requests[0].foreground,true);
 assert.equal(table.kernelRequests().filter(r=>r.method==='table.lookup').length,0);
 const result=table.session.messages.find(m=>m.role==='toolResult'&&m.toolName==='lookup');
 assert.ok(result&&!result.isError);assert.match(JSON.stringify(result),/source-consultation/);assert.match(JSON.stringify(result),/harbor worker/);
});

test('source answer mode requires a question before starting any reader',async t=>{
 const table=await openTable({responses:[
  fauxAssistantMessage([fauxToolCall('lookup',{kind:'source',source_mode:'answer',query:'Lena'})],{stopReason:'toolUse'}),
  fauxAssistantMessage([fauxToolCall('narrate',{text:'The question remains open.'})],{stopReason:'toolUse'}),fauxAssistantMessage('The question remains open.'),
 ]});t.after(()=>table.dispose());let calls=0;
 table.emit('coc:reading-bridge',{async ensure(){calls++;return{state:'ready',source_answer:answer};}});
 await table.session.prompt('Clarify the source.');assert.equal(calls,0);
 assert.match(JSON.stringify(table.session.messages.filter(m=>m.role==='toolResult')),/nonempty question/);
});

test('source answer timeout tells the Keeper to preserve answer mode on a later retry',async t=>{
 const table=await openTable({responses:[
  fauxAssistantMessage([fauxToolCall('lookup',{kind:'source',source_mode:'answer',query:'Lena',question:'Her work?'})],{stopReason:'toolUse'}),
  fauxAssistantMessage([fauxToolCall('narrate',{text:'The conversation continues here.'})],{stopReason:'toolUse'}),fauxAssistantMessage('The conversation continues here.'),
 ]});t.after(()=>table.dispose());
 table.emit('coc:reading-bridge',{async ensure(){throw new KernelError({code:'needs',message:'The source is still being read',details:{reason:'reading_timeout'}});}});
 await table.session.prompt('Check the source.');
 const result=table.session.messages.find(m=>m.role==='toolResult'&&m.toolName==='lookup');
 assert.match(JSON.stringify(result),/source_mode=answer/);
 assert.match(JSON.stringify(result),/answer/);
});

test('an unresolved consultation is returned explicitly and never prepared implicitly',async t=>{
 const table=await openTable({responses:[
  fauxAssistantMessage([fauxToolCall('lookup',{kind:'source',source_mode:'answer',query:'Lena',question:'What is unknown?'})],{stopReason:'toolUse'}),
  fauxAssistantMessage([fauxToolCall('narrate',{text:'That detail remains unknown.'})],{stopReason:'toolUse'}),fauxAssistantMessage('That detail remains unknown.'),
 ]});t.after(()=>table.dispose());const purposes=[];
 table.emit('coc:reading-bridge',{async ensure(mid,params){purposes.push(params.purpose);return{state:'ready',source_answer:{...answer,status:'unresolved',answer:'The inspected page does not establish it.',limitations:'Only the cited passage was checked.',supported:false}};}});
 await table.session.prompt('Consult the source without changing the setting.');
 assert.deepEqual(purposes,['answer']);assert.equal(table.kernelRequests().filter(r=>r.method==='table.lookup').length,0);
 assert.match(JSON.stringify(table.session.messages.filter(m=>m.role==='toolResult')),/unresolved/);
});
