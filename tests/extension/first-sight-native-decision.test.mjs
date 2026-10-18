import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFirstSightLane} from '../../runtime/jev/first-sight.ts';
test('native first sight dispatches typed choices and never falls back to a generative judge',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'first-sight-native-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const before=globalThis.fetch,key=process.env.EXT_JEV_APIKEY;process.env.EXT_JEV_APIKEY='fixture-key';
 t.after(()=>{globalThis.fetch=before;if(key===undefined)delete process.env.EXT_JEV_APIKEY;else process.env.EXT_JEV_APIKEY=key;});
 let calls=0,uncertain=false,modelCalls=0;
 globalThis.fetch=async(_url,options)=>{
  const body=JSON.parse(options.body);calls++;
  return new Response(JSON.stringify({model:body.model,answers:Object.fromEntries(Object.entries(body.questions).map(([name,q])=>{
   const keys=Object.keys(q.criteria),choice=uncertain?'pending':'shown',p=Object.fromEntries(keys.map(k=>[k,k===choice?.99:.01/(keys.length-1)]));
   return [name,{type:'choice',choice,confidence:(keys.length*.99-1)/(keys.length-1),probabilities:p}];
  })),usage:{input_tokens:100,output_tokens:1}}),{status:200});
 };
 const rows=[],ctx={cwd,modelRegistry:{complete:async()=>{modelCalls++;throw Error('unexpected author');}}};
 const lane=createFirstSightLane({events:new EventEmitter(),appendEntry:(_kind,row)=>rows.push(row)},
  {ctx:()=>ctx,campaign:()=> 'camp',sourceReferences:()=>true});
 const input={turn:1,prose:'A tall man waits beside a woman in a blue hat.',items:[{id:'clerk',kind:'person',described:'A tall man.'},{id:'woman',kind:'person',described:'',undescribed:true}]};
 const first=await lane.check(input,new AbortController().signal);assert.equal(first.ok,true);assert.equal(first.items.length,2);assert.equal(calls,1);assert.equal(modelCalls,0);
 uncertain=true;const pending=await lane.check({...input,turn:2},new AbortController().signal);assert.equal(pending.ok,true);assert.deepEqual(pending.items,[]);assert.equal(pending.pending,2);
 assert.equal(rows.at(-1).pending_review,true);assert.equal(modelCalls,0);
 globalThis.fetch=async()=>{throw Error('offline');};
 assert.equal((await lane.check({...input,turn:3},new AbortController().signal)).ok,false);assert.equal(modelCalls,0);
});
