/** The actual Pi Anthropic serializer, not a facade that merely records options. */
import{test}from'node:test';import assert from'node:assert/strict';
import{stream}from'@earendil-works/pi-ai/api/anthropic-messages';
import{laneReasoningOptions}from'../../extensions/lanes/subsession.ts';
import{miniMaxStream}from'../../extensions/minimax-enhanced/agent/index.js';
import*as consent from'../../runtime/jev/continuous-consent.ts';
const model={provider:'minimax-cn',id:'MiniMax-M3.1-Flash-Preview',name:'MiniMax',api:'anthropic-messages',baseUrl:'https://api.invalid',reasoning:true,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:200000,maxTokens:8192,compat:{forceAdaptiveThinking:true}};
for(const route of['raw','provider-proxy'])for(const level of['medium','off'])test(route+' Anthropic completion serializes the requested '+level+' rather than the provider default',async()=>{
 let sent,network=0;const m={...model,thinkingLevelMap:{off:'off',low:'low',medium:'medium',high:'high'}};
 await (route==='raw'?stream:miniMaxStream())(m,{messages:[{role:'user',content:[{type:'text',text:'Return a short artifact.'}],timestamp:1}]},{...laneReasoningOptions(m,level),apiKey:'fixture',maxRetries:0,onPayload:body=>{sent=body;throw Error('Captured before dispatch');},fetch:async()=>{network++;throw Error('Unexpected network');}}).result();
 assert.equal(network,0);assert.ok(sent);
 if(level==='medium'){assert.equal(sent.thinking?.type,'adaptive');assert.equal(sent.output_config?.effort,'medium');}else assert.equal(sent.thinking?.type,'disabled');
});
test('prescreen and admission project the same non-entry arrival operation',()=>{
 assert.equal(typeof consent.continuousConsentLine,'function');const original={kind:'move',to:'Inn'};const projected=consent.continuousConsentLine(original);
 assert.deepEqual(projected.arrival_scope,{at:'destination approach or doorway',enter_building:false,open_door:false,start_interaction:false});assert.equal(original.arrival_scope,undefined);
 assert.deepEqual(consent.continuousConsentLine({kind:'time',minutes:3}),{kind:'time',minutes:3});
});
