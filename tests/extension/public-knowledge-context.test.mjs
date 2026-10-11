/** Public source membership, paged original integrity and advisory pre-draft preparation. */
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {fitKnowledgeCatalogue,preparePublicKnowledge,PUBLIC_KNOWLEDGE_BYTES} from '../../runtime/jev/knowledge-context.ts';
import {bindDocumentAppend,documentBindingScope,DOCUMENT_BINDING_FAMILY} from '../../runtime/jev/document-binding-domain.ts';
import {DocumentReadCoverage} from '../../extensions/kernel/document-read-coverage.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
const repo=join(dirname(fileURLToPath(import.meta.url)),'../..'),temp=await mkdtemp(join(tmpdir(),'public-knowledge-'));
after(()=>rm(temp,{recursive:true,force:true}));await symlink(join(repo,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:"export {knowledgeEntries,knowledgePage} from './kernel-ts/read/knowledge-catalogue.ts';",resolveDir:repo,sourcefile:'knowledge-api.ts'},outfile:join(temp,'api.mjs'),bundle:true,format:'esm',platform:'node',packages:'external',logLevel:'silent'});
const {knowledgeEntries,knowledgePage}=await import(pathToFileURL(join(temp,'api.mjs')).href);
const context={turn:50,view:1,line:'Main',loop:0};
const snapshot=(entries)=>({signature:'private',scope:context,entries,served:new Map()});
const record=(turn,text,extra={})=>({turn,text,commit:'receipt',worldline:'main',loop:0,...extra});

test('all public days remain reachable; secret authored summaries, other lines, loops and undelivered drafts stay out',()=>{
    const entries=knowledgeEntries({clues:{discovered:[{label:'Old house',how:'Seen in the register',summary:'concealed truth'}]},handouts:[{name:'Old clipping',text:'Public original'},{name:'Missing',text:''}]},
        [record(1,'Early public terms'),record(40,'Recent reply',{interaction_scope:'reference'}),record(10,'other line',{worldline:'other'}),record(11,'other loop',{loop:2}),record(12,'superseded',{superseded_by:13}),record(13,'draft',{commit:null}),record(52,'future')],{active_worldline:'main',worldlines:{main:{loop:0}}},50);
    assert.deepEqual(entries.filter(entry=>entry.kind==='transcript').map(entry=>entry.turn),[40,1]);
    assert.equal(entries.find(entry=>entry.turn===40).mode,'reference');assert.equal(entries[2].available,false);
    assert.ok(!JSON.stringify(entries).includes('concealed truth'));
});

test('catalogue continuation includes every low-score and unavailable item, starting at the first omitted row',()=>{
    const entries=Array.from({length:43},(_,index)=>({name:'Turn '+index,kind:'transcript',text:'Public original '.repeat(30),available:index!==31}));
    const saved=snapshot(entries);let params={},names=[];
    do{const listed=knowledgePage(saved,params),scores=Object.fromEntries(listed.entries.map((_,index)=>[index,{status:'available',relevance:0,conflict:.99}]));
        const packet=fitKnowledgeCatalogue(listed,[],scores,1500);assert.ok(Buffer.byteLength(JSON.stringify(packet))<=1500);
        assert.ok(packet.entries.length>0);names.push(...packet.entries.map(entry=>entry.name));params=packet.next;
    }while(params);
    assert.deepEqual(names,entries.map(entry=>entry.name));
});

test('paged Unicode originals are exact and bounded; a foreign scope or skipped prefix cannot splice a body',()=>{
    const text='🧪'.repeat(8000)+'end',saved=snapshot([{name:'Original',kind:'handout',text,available:true}]);
    const issued=knowledgePage(saved,{}).entries[0].read;
    assert.equal(knowledgePage(saved,{...issued,knowledge_page:{...issued.knowledge_page,offset:10}}).status,'stale');
    assert.equal(knowledgePage(saved,{...issued,knowledge_page:{...issued.knowledge_page,context:{...context,loop:1}}}).status,'stale');
    let next=issued,read='';do{const page=knowledgePage(saved,next);assert.ok(Array.from(page.text).length<=4096);assert.ok(Buffer.byteLength(JSON.stringify(page))<=12*1024);read+=page.text;next=page.next;}while(next);
    assert.equal(read,text);
    const restarted=snapshot(saved.entries);assert.equal(knowledgePage(restarted,{...issued,knowledge_page:{...issued.knowledge_page,offset:1}}).status,'stale');
});

test('pre-draft scores prioritize one original, never veto material; unchanged public evidence costs no repeat decision or body read',async()=>{
    const saved=snapshot([{name:'Unrelated',kind:'clue',text:'Other public fact',available:true},{name:'Selected',kind:'transcript',text:'Knott offered twenty per day.',available:true},{name:'Absent',kind:'handout',text:'',available:false}]);
    const catalogue=knowledgePage(saved,{}),calls=[],batches=[];
    const call=async(method,params)=>{calls.push({method,params});return method==='mods.document.options'?{knowledge:catalogue,documents:[]}:knowledgePage(saved,params);};
    const decision={async decide(batch){batches.push(batch);return {status:'complete',attempts:0,batchId:batch.id,answers:Object.fromEntries(batch.questions.map(question=>[question.key,{status:'answered',type:'noul',noul:question.key==='relevance_1'?.3:question.key.startsWith('conflict')?.99:0}])),issues:[],coverage:{required:[],answered:[],unknown:[]}};}};
    const input={campaign:'fixture',playerText:'Review the terms',call,decision,signal:new AbortController().signal};
    const prepared=await preparePublicKnowledge(input);assert.equal(batches.length,1);
    assert.equal(prepared.packet.entries.length,3);assert.equal(prepared.packet.entries[1].opinion.relevance,.3);
    assert.equal(prepared.packet.originals[0].text,saved.entries[1].text);assert.ok(Buffer.byteLength(JSON.stringify(prepared.packet))<=PUBLIC_KNOWLEDGE_BYTES-64);
    const again=await preparePublicKnowledge({...input,previous:prepared});assert.equal(again,prepared);assert.equal(batches.length,1);assert.equal(calls.filter(value=>value.method==='table.look').length,1);
    const unknown=await preparePublicKnowledge({...input,decision:{async decide(){throw new Error('optional unavailable');}}});
    assert.equal(unknown.packet.entries.length,3);assert.ok(unknown.packet.entries.every(entry=>entry.opinion.status==='unavailable'));
});

test('exact canonical carrier without a dictated quotation needs no semantic call; identity binding still grants no consent',async()=>{
    const input={campaign:'fixture',turn:1,playerText:'I read my notes.',actor:'Investigator',requestedName:'Field notebook',suffix:'KP proposed text',documents:[{name:'Field notebook',owner:'Investigator',version:'private'}]};
    const lease=new TaskLease({owner:DOCUMENT_BINDING_FAMILY,goal:'Identity only',...documentBindingScope(input),capabilities:['decision'],signal:new AbortController().signal,budget:{deadlineAt:Date.now()+1000,remainingActions:1,remainingInputTokens:1000,remainingOutputTokens:1000,remainingCostUsd:.01}});
    try{const result=await bindDocumentAppend(input,{async decide(){assert.fail('canonical identity must not call Jev');}},lease);assert.equal(result.status,'bound');assert.equal(result.targetProbability,1);assert.equal(result.advice,undefined);}finally{lease.close();}
});

test('issued public continuations bypass the look count only once; unissued or stale scopes have no exemption',()=>{
    const saved=snapshot(Array.from({length:30},(_,index)=>({name:'Turn '+index,kind:'transcript',text:'Original '.repeat(1000),available:true})));
    const coverage=new DocumentReadCoverage(),packet=fitKnowledgeCatalogue(knowledgePage(saved,{}),[]);
    coverage.addKnowledge(packet);const read=packet.entries[0].read;
    assert.equal(coverage.permits(read),true);assert.equal(coverage.consume(read),true);assert.equal(coverage.consume(read),false);
    const body=knowledgePage(saved,read);coverage.addKnowledge(body);assert.equal(coverage.consume(body.next),true);
    assert.equal(coverage.permits({...read,knowledge_page:{...read.knowledge_page,context:{...context,turn:51}}}),false);
    assert.equal(coverage.consume(packet.next),true);
});

test('spent shared preparation budget keeps the catalogue and performs no extra decision',async()=>{
    const saved=snapshot([{name:'Low priority',kind:'clue',text:'Public fact',available:true}]);
    const prepared=await preparePublicKnowledge({campaign:'fixture',playerText:'Read this',signal:new AbortController().signal,
        providerBudget:{actions:0,inputTokens:0,outputTokens:0,costUsd:0},
        call:async(method,params)=>method==='mods.document.options'?{knowledge:knowledgePage(saved,{}),documents:[]}:knowledgePage(saved,params),
        decision:{async decide(){assert.fail('spent shared budget');}}});
    assert.equal(prepared.packet.entries.length,1);assert.equal(prepared.packet.entries[0].opinion.status,'unavailable');
});

test('partial decision usage without fees keeps shared accounting finite and leaves the next preparation budget usable',async()=>{
    for(const costUsd of [undefined,NaN,Infinity,-1]){
        const saved=snapshot([{name:'Evidence',kind:'clue',text:'Public original',available:true}]);
        const providerBudget={actions:4,inputTokens:100_000,outputTokens:20_000,costUsd:.08};
        const result=await preparePublicKnowledge({campaign:'fixture',playerText:'Read the clue',signal:new AbortController().signal,providerBudget,
            call:async(method,params)=>method==='mods.document.options'?{knowledge:knowledgePage(saved,{}),documents:[]}:knowledgePage(saved,params),
            decision:{async decide(batch){return {batchId:batch.id,status:'complete',attempts:1,usage:{inputTokens:10,outputTokens:2,...(costUsd===undefined?{}:{costUsd})},
                answers:Object.fromEntries(batch.questions.map(question=>[question.key,{status:'answered',type:'noul',noul:.5}])),issues:[],coverage:{required:[],answered:[],unknown:[]}};}}});
        assert.ok(Object.values(providerBudget).every(Number.isFinite));assert.equal(providerBudget.actions,3);
        assert.ok(providerBudget.costUsd>0&&providerBudget.costUsd<.08);assert.equal(providerBudget.inputTokens,99_990);
        assert.equal(result.packet.entries[0].opinion.status,'available');
    }
});

test('under source pressure the public reader fits 512 bytes and remains reachable, without another grading or body read',async()=>{
    const saved=snapshot(Array.from({length:30},(_,index)=>({name:'Evidence '+index,kind:'clue',text:'Public original '.repeat(80),available:true})));
    let calls=0,decisions=0;
    const input={campaign:'fixture',playerText:'Read the clues',signal:new AbortController().signal,
        call:async(method,params)=>{if(method==='table.look')calls++;return method==='mods.document.options'?{knowledge:knowledgePage(saved,{}),documents:[]}:knowledgePage(saved,params);},
        decision:{async decide(){decisions++;throw new Error('optional unavailable');}}};
    const full=await preparePublicKnowledge(input),priorCalls=calls;
    const fitted=await preparePublicKnowledge({...input,byteBudget:512,previous:full});
    assert.ok(Buffer.byteLength(JSON.stringify(fitted.packet))+96<=512);assert.equal(decisions,1);assert.equal(calls,priorCalls);
    assert.equal(fitted.packet.next.focus,'knowledge');
    assert.ok(knowledgePage(saved,fitted.packet.next).entries.length>0);
});
