/** Native Pi/RunDriver integration with controlled typed decisions, not live gameplay. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall,getCurrentTools} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {api,root} from './object-usages-fixture.mjs';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';

const retained='The blue envelope is held until the written report.';
function decide(batch){
    return bindDecisionAnswers(batch,Object.fromEntries(batch.questions.map(question=>{
        const choice=question.key.startsWith('coverage:')?'essential':question.key.startsWith('support:')?'supported':
            question.key.startsWith('applicability:')?'current':question.key.startsWith('contradiction:')?'none':Object.keys(question.criteria)[0];
        return [question.key,{status:'answered',type:'choice',choice}];
    })),{inputTokens:1,outputTokens:1,costUsd:0});
}
async function native(t,{decision,responses,observe,onSearch,onRevision}={}){
    const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision});
    const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,runDriver:engine.runDriver,
        env:{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_MEMORY_BACKFILL:'0',PI_COC_JEV_PRESELECT:'0'},
        async prepareWorkspace(workspace){
            const context=await api.createKernelContext({workspace,content:join(root,'content'),seed:'native-memory-query',
                locks:api.createAdvisoryLocks(async()=>{}),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
            const runtime=api.createKernelRuntime(context);
            try{await runtime.handlers['table.open']({campaign:'test-camp'});
                await runtime.handlers['table.narrate']({campaign:'test-camp',call_id:'t0-c1',text:retained});
            }finally{await runtime.close();}
        },extraExtensions:[...((observe||onSearch||onRevision)?[{name:'memory-evidence-observer',factory(pi){
        pi.events.on('coc:typed-memory-search',value=>onSearch?.(value));
        pi.events.on('coc:kernel-bridge',bridge=>{
            if(!bridge?.call)return;
            const call=bridge.call;
            bridge.call=async(method,params)=>{const result=await call(method,params);if(method==='memory.evidence')await observe?.(params,result);
                if(method==='table.capsule'&&params._revision_only===true)onRevision?.();return result;};
        });}}]:[]),{name:'native-driver',factory:engine.extension}],responses});
    t.after(()=>table.dispose());return table;
}

test('native unconfigured recall omits query and refuses a retained explicit query clearly',async t=>{
    let offered;
    const table=await native(t,{decision:null,responses:[context=>{
        offered=getCurrentTools(context.messages).find(tool=>tool.name==='recall');
        return fauxAssistantMessage([fauxToolCall('recall',{what:'memory',query:'What was retained?'})],{stopReason:'toolUse'});
    },fauxAssistantMessage('{{reference}}The semantic query is unavailable.') ]});
    await table.session.prompt('Recall the prior condition.');
    assert.deepEqual(table.extensionErrors,[]);
    assert.ok(offered);
    assert.equal(Object.hasOwn(offered.parameters.properties,'query'),false);
    const result=table.session.messages.find(message=>message.role==='toolResult'&&message.toolName==='recall');
    assert.equal(result.isError,true);
    assert.equal(result.details.coc_error.details.reason,'memory_query_requires_host');
});

test('native configured recall reaches production evidence originals and returns bounded attributed text',async t=>{
    let offered,revisionReads=0;const evidence=[];const batches=[];
    const table=await native(t,{decision:{decide:async batch=>{batches.push(batch);return decide(batch);}},
        onRevision:()=>revisionReads++,observe:(params,result)=>evidence.push({params:structuredClone(params),result:structuredClone(result)}),responses:[context=>{
            offered=getCurrentTools(context.messages).find(tool=>tool.name==='recall');
            return fauxAssistantMessage([fauxToolCall('recall',{what:'memory',query:'What condition was stated about the blue envelope?',turns:[0,0],include_superseded:true})],{stopReason:'toolUse'});
        },fauxAssistantMessage('{{reference}}The earlier report retains its condition.') ]});
    await table.session.prompt('Recall the condition in the earlier report.');
    assert.deepEqual(table.extensionErrors,[]);
    assert.equal(Object.hasOwn(offered.parameters.properties,'query'),true);
    const result=table.session.messages.find(message=>message.role==='toolResult'&&message.toolName==='recall');
    assert.equal(result.isError,false,JSON.stringify(result.details));
    assert.ok(evidence.some(row=>row.params.action==='original'));
    assert.ok(evidence.some(row=>row.params.action==='finish'));
    assert.ok(revisionReads<=evidence.length+batches.length+2,`Repeated revision reads: ${revisionReads} for ${evidence.length} owner operations`);
    assert.ok(batches.length>0&&batches.every(batch=>batch.family==='memory-read'));
    assert.ok(evidence.filter(row=>row.params.action==='snapshot').every(row=>JSON.stringify(row.params.filters)===JSON.stringify({turns:[0,0],include_superseded:true})));
    assert.ok(evidence.every(row=>row.params.scope.audience==='keeper'&&row.params.scope.worldline==='main'&&row.params.scope.loop===0));
    const modelText=result.content.filter(block=>block.type==='text').map(block=>block.text).join('');
    assert.ok(modelText.includes(retained));
    assert.ok(modelText.includes('conversation_report'));
    for(const row of evidence.filter(row=>row.params.action==='snapshot'))assert.ok(!modelText.includes(row.result.snapshot));
    assert.ok(!modelText.includes('canonical-turn:'));
    assert.ok(!table.activeTools().includes('submit_plan_packet'));
});

test('semantic recall and an independent native view overlap without losing ordered evidence results',{timeout:30000},async t=>{
    const started=Promise.withResolvers(),release=Promise.withResolvers(),lookFinished=Promise.withResolvers();
    let held=true,lookWhileHeld=false;const evidence=[];
    const table=await native(t,{decision:{decide:async batch=>{started.resolve();await release.promise;return decide(batch);}},
        observe:params=>evidence.push(params.action),responses:[fauxAssistantMessage([
            fauxToolCall('recall',{what:'memory',query:'Recall the retained condition.',turns:[0,0]},{id:'semantic-read'}),
            fauxToolCall('look',{focus:'investigator'},{id:'independent-view'})],{stopReason:'toolUse'}),
            fauxAssistantMessage('{{reference}}The earlier report retains its condition.')]});
    const tool=table.session.agent.state.tools.find(tool=>tool.name==='look'),execute=tool.execute;
    tool.execute=async(...args)=>{const result=await execute(...args);lookWhileHeld=held;lookFinished.resolve();return result;};
    const running=table.session.prompt('I recall the earlier condition and check my own sheet.');
    try{
        await started.promise;
        await Promise.race([lookFinished.promise,new Promise(resolve=>{const timer=setTimeout(resolve,2000);timer.unref();})]);
    }finally{held=false;release.resolve();await running;}
    assert.equal(lookWhileHeld,true,'the sheet read must finish while the independent semantic decision is still held');
    const results=table.session.messages.filter(message=>message.role==='toolResult'&&['semantic-read','independent-view'].includes(message.toolCallId));
    assert.deepEqual(results.map(row=>[row.toolCallId,row.isError]),[['semantic-read',false],['independent-view',false]]);
    assert.ok(evidence.includes('original')&&evidence.includes('finish'));
    assert.ok(JSON.stringify(results[0].content).includes(retained));
    assert.deepEqual(table.extensionErrors,[]);
});

test('native read-set invalidation refuses stale evidence before canonical finish',async t=>{
    let table,changed=false;const evidence=[];
    table=await native(t,{decision:{decide:async batch=>decide(batch)},observe:async params=>{
        evidence.push(params.action);
        if(params.action==='snapshot'&&!changed){changed=true;
            await table.runtimeBridges().at(-1).call('table.apply',{campaign:'test-camp',call_id:'t1-c99',effects:[{kind:'time',minutes:1}]});
        }
    },responses:[fauxAssistantMessage([fauxToolCall('recall',{what:'memory',query:'Recall the retained condition.'})],{stopReason:'toolUse'}),
        fauxAssistantMessage('{{reference}}The evidence changed during retrieval.')]});
    await table.session.prompt('Recall the retained condition.');
    assert.deepEqual(table.extensionErrors,[]);
    assert.equal(changed,true);
    assert.ok(!evidence.includes('finish'));
    const result=table.session.messages.find(message=>message.role==='toolResult'&&message.toolName==='recall');
    assert.equal(result.isError,true);
    assert.equal(result.details.coc_error.details.reason,'memory_query_stale');
});

test('native query cancellation releases its leaf and bridge closure removes query capability',async t=>{
    const started=Promise.withResolvers(),aborted=Promise.withResolvers();const evidence=[];let offered;
    const table=await native(t,{decision:{decide(_batch,lease){started.resolve();return new Promise((_resolve,reject)=>{
        lease.signal.addEventListener('abort',()=>{aborted.resolve();reject(new Error('controlled cancellation'));},{once:true});
    });}},observe:params=>evidence.push(params.action),responses:[
        fauxAssistantMessage([fauxToolCall('recall',{what:'memory',query:'Recall the retained condition.'})],{stopReason:'toolUse'}),
        context=>{offered=getCurrentTools(context.messages).find(tool=>tool.name==='recall');return fauxAssistantMessage('{{reference}}The query owner is closed.');}
    ]});
    const running=table.session.prompt('Recall the retained condition.').catch(()=>undefined);
    await started.promise;
    await table.session.abort();
    await Promise.race([Promise.all([running,aborted.promise]),new Promise((_resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('native query did not abort')),5000);timer.unref();})]);
    assert.ok(!evidence.includes('finish'));
    table.emit('coc:kernel-bridge',undefined);
    await table.session.prompt('The query is no longer needed.');
    assert.equal(Object.hasOwn(offered.parameters.properties,'query'),false);
    assert.deepEqual(table.extensionErrors,[]);
});

test('concurrent native queries on the same actual run retain independent operation ownership',async t=>{
    let search,secondary;const evidence=[];
    const table=await native(t,{decision:{decide:async batch=>decide(batch)},onSearch:value=>{search=value;},observe:async(params,result)=>{
        evidence.push({params,result});
        if(params.action==='snapshot'&&!secondary){
            secondary=search({campaign:'test-camp',toolCallId:'concurrent-native-query',query:'What was stated about the envelope?',filters:{turns:[0,0]}});
            await secondary;
        }
    },responses:[fauxAssistantMessage([fauxToolCall('recall',{what:'memory',query:'Recall the retained condition.',turns:[0,0]})],{stopReason:'toolUse'}),
        fauxAssistantMessage('{{reference}}The retained reports remain attributed.')]});
    await table.session.prompt('Recall the prior report.');
    const parallel=await secondary;
    assert.deepEqual(table.extensionErrors,[]);
    assert.ok(JSON.stringify(parallel).includes(retained));
    const result=table.session.messages.find(message=>message.role==='toolResult'&&message.toolName==='recall');
    assert.equal(result.isError,false,JSON.stringify(result.details));
    assert.equal(evidence.filter(row=>row.params.action==='finish').length,2);
    const snapshots=evidence.filter(row=>row.params.action==='snapshot').map(row=>row.result.snapshot);
    assert.equal(new Set(snapshots).size,2);
});
