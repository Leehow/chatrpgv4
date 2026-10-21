/** The compact declaration must teach transport types before execution validation. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Check} from 'typebox/value';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';
import {locationToolDeclarations} from '../../extensions/table/location-context.ts';
import {streamSimple as responses} from '@earendil-works/pi-ai/api/openai-responses';
const tool=locationToolDeclarations(COC_TOOLS).find(tool=>tool.name==='place');
const move={action:'move',to:'Diner',via:'Along the street',spot:'quiet corner',additions:[{name:'Diner',within:null,description:'A small late-night lunch room.',features:[{name:'Counter',description:'An oak counter.'}]}]};
test('compact location entry exposes every array value as an array before a contract read',()=>{
 for(const field of ['additions','relations','facts','people','situations']){
  assert.equal(tool.parameters.properties[field]?.type,'array',field);
  const action=field==='additions'?'move':field==='relations'?'relate':'observe';
  assert(!Check(tool.parameters,{action,to:'Diner',[field]:'[]'}),field+' is never a quoted JSON field');
 }
 assert(Check(tool.parameters,move));
 assert(!Check(tool.parameters,{...move,additions:[{name:'Diner',features:[{name:'Counter',description:3}]}]}));
 assert(!Check(tool.parameters,{action:'inspect',name:'Diner',additions:move.additions}),'a typed declaration still never upgrades inspect into a write');
});
test('actual Responses payload preserves the typed compact additions without other tools',async()=>{
 const model={id:'grok-4.5',name:'Fixture',api:'openai-responses',provider:'grok-build',baseUrl:'https://invalid.example/v1',reasoning:true,input:['text'],contextWindow:128000,maxTokens:16384,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
 const abort=new AbortController();let payload;
 await responses(model,{messages:[{role:'system',content:'Fixture',toolsAdded:[tool],timestamp:0},{role:'user',content:'Fixture',timestamp:0}]},{apiKey:'fixture',signal:abort.signal,onPayload:body=>{payload=body;abort.abort();}}).result();
 const wire=payload.tools.find(tool=>tool.name==='place').parameters;
 assert.equal(wire.properties.additions?.type,'array');assert(Check(wire,move));assert(!Check(wire,{...move,additions:JSON.stringify(move.additions)}));
});
