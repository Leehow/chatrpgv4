/** Compare the old clipped page-lead representation with whole-page demand-driven long context. */
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readVaultSecret} from '../single-loop-routing/vault.mjs';
import {readJevApiKey} from '../../extensions/jev/agent/config.js';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {sourceInfo,sourceText} from '../../extensions/module/source.ts';
import {JEV_MODEL} from '../../runtime/jev/question-packing.ts';
import {packSourcePageBatch,sourcePageQuestionState} from '../../runtime/jev/source-reader-driver.ts';

const env={...process.env,EXT_JEV_APIKEY:readJevApiKey(process.env)??readVaultSecret('EXT_JEV_APIKEY')};
if(!readJevApiKey(env))throw new Error('Canonical Jev credential unavailable');
const pdf=resolve('content/starters/the-haunting/source.pdf'),info=await sourceInfo(pdf);
const pages=(await sourceText(pdf,{pages:Array.from({length:16},(_,i)=>i+1),expected_file_sha256:info.file_sha256})).snapshots;
const question='Does the page explicitly state that Pastor Michael Thomas escaped prison in 1917?';
const scope={owner:'text-context-comparison',audience:'keeper'},readSet=[{kind:'source',resource:pdf,revision:info.file_sha256}];
await mkdir('.coc/experiments',{recursive:true});const dir=await mkdtemp(resolve('.coc/experiments/jev-text-context-20261014-'));
const events=[],adapter=createDecisionAdapter({env,maxConcurrency:4,trace:row=>events.push(row)}),results={};
for(const arm of ['old-clipped','whole-page']) {
  const began=Date.now(),groups=arm==='old-clipped'?Array.from({length:4},(_,i)=>pages.slice(i*4,i*4+4)):[pages],rows=[];
  await Promise.all(groups.map(async group=>{
    const state=sourcePageQuestionState(question,undefined,null,group.map(row=>({...row,text:arm==='old-clipped'?row.text.slice(0,2800):row.text})));
    const batch=packSourcePageBatch({id:randomUUID(),model:JEV_MODEL,family:'source-page-lead',familyVersion:'2',scope,readSet,state,
      questions:group.map((row,index)=>({key:'p'+row.page,target:'pages['+index+']',type:'noul',instructions:question+' Judge only this page, using its actual text. A matching person name alone does not establish the event or year.'}))});
    const lease=new TaskLease({owner:arm,goal:question,scope,readSet,capabilities:['decision'],signal:AbortSignal.timeout(30000),
      budget:{deadlineAt:Date.now()+30000,remainingInputTokens:600000,remainingOutputTokens:10000,remainingCostUsd:0.1,remainingActions:4}});
    try{const result=await adapter.decide(batch,lease);rows.push({longContext:batch.longContext??false,pages:group.map(row=>row.page),result});}
    finally{lease.close();}
  }));
  results[arm]={ms:Date.now()-began,rows,calls:rows.reduce((n,row)=>n+(row.result.attempts??0),0),inputTokens:rows.reduce((n,row)=>n+(row.result.usage?.inputTokens??0),0)};
  console.log(JSON.stringify({arm,ms:results[arm].ms,calls:results[arm].calls,inputTokens:results[arm].inputTokens,
    page4:rows.flatMap(row=>Object.entries(row.result.answers)).find(([key])=>key==='p4')?.[1],longContext:rows.some(row=>row.longContext)}));
}
await writeFile(join(dir,'result.json'),JSON.stringify({pdf,source_sha256:info.file_sha256,question,expected_page:4,
  full_page_4:pages.find(row=>row.page===4).text,results},null,2));
await writeFile(join(dir,'events.jsonl'),events.map(JSON.stringify).join('\n')+'\n');
console.log(JSON.stringify({evidence:dir}));
