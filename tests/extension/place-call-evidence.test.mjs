/** Protocol diagnostics compare boundaries without changing or executing arguments. */
import {test} from 'node:test';import assert from 'node:assert/strict';
import {createPlaceCallEvidence} from '../../runtime/place-call-evidence.ts';
const start={api:'anthropic-messages',provider:'minimax-cn',model:'MiniMax-M3.1-Flash-Preview'};
test('first location raw, normalized and prepare arguments remain separate and unchanged',()=>{
 const rows=[],trace=createPlaceCallEvidence(row=>rows.push(row)),args={action:'move',to:'Inn'};
 const event=data=>trace.provider({...start,data},4);
 event({type:'content_block_start',index:1,content_block:{type:'tool_use',id:'place-1',name:'place',input:{}}});
 event({type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:JSON.stringify(args)}});
 event({type:'content_block_stop',index:1});
 trace.message({role:'assistant',content:[{type:'toolCall',name:'place',id:'place-1',arguments:{action:'inspect',to:'Inn'}}]},4);
 trace.prepare(args,4);trace.prepare({action:'inspect'},4);
 assert.deepEqual(rows.map(row=>row.phase),['provider','normalized','prepare']);
 assert.deepEqual(rows[0].delta.arguments,args);assert.equal(rows[1].arguments.action,'inspect');assert.deepEqual(rows[2].arguments,args);
 assert.deepEqual(args,{action:'move',to:'Inn'});
 trace.prepare(args,5);assert.equal(rows.at(-1).turn,5);
});
test('oversized tool input and unrelated provider fields never enter diagnostic arguments',()=>{
 const rows=[],trace=createPlaceCallEvidence(row=>rows.push(row));
 trace.provider({...start,headers:{Authorization:'DO_NOT_COPY'},data:{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'p',name:'place',input:{}}}},1);
 trace.provider({...start,data:{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify({description:'x'.repeat(10000)})}}},1);
 trace.provider({...start,data:{type:'content_block_stop',index:0}},1);
 assert.equal(rows[0].delta.omitted,true);assert.match(rows[0].delta.sha256,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(rows).includes('DO_NOT_COPY'),false);
 assert(JSON.stringify(rows).length<1000);
});
test('diagnostic recorder failure does not affect tool argument preparation',()=>{
 const trace=createPlaceCallEvidence(()=>{throw Error('diagnostic store unavailable');});
 assert.doesNotThrow(()=>trace.prepare({action:'move',to:'Inn'},1));
});
test('request diagnostics retain only place schema shape once per turn',()=>{
 const rows=[],trace=createPlaceCallEvidence(row=>rows.push(row)),payload={headers:{Authorization:'PRIVATE_KEY'},messages:[{content:'PRIVATE_STORY'}],tools:[{name:'place',input_schema:{type:'object',properties:{action:{type:'string',enum:['inspect','move']},to:{type:'string'}},required:['action']}}]};
 trace.request(payload,2);trace.request(payload,2);assert.equal(rows.length,1);assert.equal(rows[0].phase,'request_schema');assert.deepEqual(rows[0].fields,['action','to']);
 payload.tools[0].input_schema.properties.action.enum.push('other');assert.deepEqual(rows[0].action.arguments.enum,['inspect','move']);
 assert(!JSON.stringify(rows).includes('PRIVATE_'));assert.doesNotThrow(()=>trace.request(null,3));
});
