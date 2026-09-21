/** Receipt-derived reader conformance through the actual kernel apply path; no model or play claims. */
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'../..');let api,bundle;
before(async()=>{
    await mkdir(join(root,'.tmp'),{recursive:true});bundle=await mkdtemp(join(root,'.tmp/fulfillment-views-'));
    await build({stdin:{contents:[
        "export * from './kernel-ts/read/memory.ts';",
        "export * from './kernel-ts/memory/fulfillment-receipt.ts';",
        "export {lineFulfillmentEvidence} from './kernel-ts/read/worldline.ts';",
        "export {candidatesFor} from './kernel-ts/memory/recall.ts';",
        "export {createKernelContext} from './kernel-ts/context.ts';",
        "export {createKernelRuntime} from './kernel-ts/registry.ts';",
        "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
        "export {CampaignWriter} from './kernel-ts/write/store.ts';",
        "export {CampaignSnapshot,loadCampaignModule} from './kernel-ts/read/campaign.ts';",
        "export {clone} from './kernel-ts/read/values.ts';",
        "export {committedTurnCatalog} from './runtime/jev/committed-turn-sources.ts';"
    ].join('\n'),resolveDir:root,sourcefile:'fulfillment-views-entry.ts'},outfile:join(bundle,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
    api=await import(pathToFileURL(join(bundle,'api.mjs')).href);
});
after(async()=>{if(bundle)await rm(bundle,{recursive:true,force:true});});
function linkedFixture({line='main',id='mem:fixture',commit='a'.repeat(40),kind='cash'}={}) {
    const scope={campaign:'fixture',worldline:line,loop:0},catalog=api.committedTurnCatalog({scope:{owner:'campaign:fixture',...scope,audience:'keeper'},turn:1,commit,playerText:'',keeperText:'A finite promise for 30.'}),ref=catalog.segments[0].ref;
    const promise={id,kind:'promise',memory_version:2,status:'candidate',state:'accurate',subject:'Giver',statement:'A finite promise for 30.',source:{turn:1,commit},worldline:line,loop:0,statement_ref:ref,source_refs:[ref]};
    const term={ordinal:0,kind,total:{source:ref,value:'30'},beneficiary:'private-beneficiary',payer:'private-payer',...(kind==='cash'?{currency:'USD'}:{definition:'private-definition',instance:'private-instance'})};
    const binding={version:1,promiseId:id,promiseRefs:[ref],scope,terms:[term]};binding.digest=api.fulfillmentBindingDigest(binding);
    const condition={id:'condition-fixture',kind:'time',minutes:1},receipt={id:'effect-fixture',call_id:'t2-c1',subject:term.beneficiary,kind:kind==='cash'?'cash':'item',
        ...(kind==='cash'?{delta:30,before:0,after:30,currency:'USD',with:term.payer}:{quantity:30,name:'Accepted case',instance:'private-instance',from:'Giver'}),
        fulfillment:{version:1,promise:id,promise_source_refs:[ref],scope,terms:[term],terms_digest:binding.digest,term:0,condition_receipts:[condition.id],applied:'30',status:'complete',...(kind==='cash'?{}:{source_label:'Giver'})}};
    return {promise,condition,receipt};
}
test('closed fulfillment metadata preserves history while removing complete active obligations',()=>{
    const fixture=linkedFixture({kind:'object'}),raw=[fixture.promise],rows=api.withPromiseFulfillment(raw,{campaign:'fixture',receipts:[fixture.condition,fixture.receipt],world:{}});
    assert.equal(raw[0].fulfillment,undefined);assert.equal(api.promiseObligations(rows).length,0);
    const view=api.hitView(rows[0]).fulfillment;
    assert.deepEqual(view,{status:'complete',terms:[{kind:'object',display_name:'Accepted case',total:'30',fulfilled:'30',remaining:'0'}]});
    const serialized=JSON.stringify(view);for(const secret of ['private-definition','private-instance','private-beneficiary','private-payer','mem:fixture','selector','revision'])assert.ok(!serialized.includes(secret));
    assert.equal(api.memoryEvidenceView(api.hitView(rows[0])).fulfillment.status,'complete');
    assert.equal(api.memoryEvidenceView({...fixture.promise,fulfillment:{status:'complete',terms:[]}}).fulfillment.status,'unavailable','stored or untrusted claims cannot replace receipt derivation');
});
test('malformed links stay explicitly unavailable and foreign scope cannot complete reused IDs',()=>{
    const first=linkedFixture(),other=linkedFixture({line:'other',commit:'b'.repeat(40)});
    assert.notEqual(api.memoryOccurrenceKey(first.promise),api.memoryOccurrenceKey(other.promise));
    const views=api.withPromiseFulfillment([first.promise,other.promise],{campaign:'fixture',receipts:[first.condition,first.receipt]});
    assert.deepEqual(views.map(value=>value.fulfillment.status),['complete','open']);
    const bad=api.clone(first.receipt);bad.fulfillment.applied='31';
    const broken=api.withPromiseFulfillment([first.promise],{campaign:'fixture',receipts:[first.condition,bad]})[0];
    assert.equal(api.memoryEvidenceView(broken).fulfillment.status,'unavailable');assert.equal(api.promiseObligations([broken]).length,1);
    assert.equal(api.withPromiseFulfillment([first.promise],{campaign:'fixture',receipts:[],available:false})[0].fulfillment.status,'unavailable');
    assert.equal(api.memoryEvidenceView(api.withPromiseFulfillment([{kind:'promise',id:'legacy',statement:'An old promise.'}],{receipts:[]})[0]).fulfillment.status,'open');
});
test('actual private apply reaches capsule, NPC history, recall, adaptive evidence and stranded-close accounting',async()=>{
    const base=join(root,'.coc/playtests/jev-fulfillment-view-contracts');await mkdir(base,{recursive:true});const home=await mkdtemp(join(base,'suite-'));
    await writeFile(join(home,'classification.json'),JSON.stringify({kind:'contract-fixture',live_play:false,model_calls:0}));
    const kernel=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:'fulfillment-readers',locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}),runtime=api.createKernelRuntime(kernel);
    try {
        const call=(method,params={})=>runtime.handlers[method]({campaign:'c1',...params});
        await call('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});await call('table.open');await call('table.player_input',{text:'I ask for the agreed terms.'});
        const campaign=new api.CampaignWriter(kernel,'c1'),party=await campaign.party();
        await call('table.apply',{call_id:'t1-c1',effects:[{kind:'cash',subject:party[0].name,with:'Steven Knott',source:'found',currency:'USD',delta:1},{kind:'time',minutes:1,why:'The condition is demonstrated.'}]});
        await call('table.narrate',{call_id:'t1-c2',text:'{{say:Steven Knott}}I will pay 30 USD when the work finishes.{{/say}}\n{{say:Steven Knott}}I will pay 30 USD when the work finishes.{{/say}}'});
        const packet=await call('memory.job',{turn:1,mode:'referenced'});
        await call('memory.submit',{job_id:packet.job_id,referenced:{step:packet.step.key,decisions:packet.step.segments.map(segment=>segment.role==='keeper'?{source:segment.alias,outcome:'retain',annotations:[{kind:'promise',subject:'Steven Knott',entities:[party[0].name],state:'accurate'}]}:{source:segment.alias,outcome:'skip'}),
            ...(packet.story_context?{story:{status:'unclear',thread:null,frame_source:null,bridge_delivered:false,delivery_source:null}}:{})}});
        await call('table.player_input',{text:'Please pay 10 USD now.'});
        const world=await campaign.readWorld(),turn=await campaign.readTurn(),meta=await campaign.readCampaign(),module=await api.loadCampaignModule(kernel,meta.module_id,world,'c1'),snapshot=new api.CampaignSnapshot(kernel,'c1');
        const rows=(await snapshot.log('memory/candidates.jsonl')).filter(value=>value.kind==='promise'),source=await api.promiseFulfillmentSources({kernel,campaign,world,turn,graph:module.graph},rows[0].id),history=await campaign.readTurnRecord(1),condition=history.receipts.find(value=>value.kind==='time');
        const term={ordinal:0,kind:'cash',total:{source:source.scalars[0].ref,value:'30'},currency:'USD',beneficiary:party[0].id,payer:module.graph.handle(module.graph.npc('Steven Knott'))};
        const binding={version:1,promiseId:rows[0].id,promiseRefs:source.refs,scope:source.scope,terms:[term],conditionReceipts:[condition.id],coverage:{complete:true,used:[...source.refs,term.total.source],omitted:[]}};binding.digest=api.fulfillmentBindingDigest(binding);
        const amountSource=api.fulfillmentNumericCandidates(api.fulfillmentCurrentInputSource(source.scope,turn.turn,turn.player_text))[0].ref;
        const effect=delta=>({kind:'cash',subject:party[0].name,with:'Steven Knott',source:'quote',currency:'USD',delta});
        const partial=await call('table.apply',{call_id:'t2-c1',effects:[effect(10)],_fulfillments:[{binding,effects:[{effect:0,term:0,amountSource}]}]});
        assert.ok((await campaign.readTurn()).receipts.some(receipt=>receipt.fulfillment?.promise===rows[0].id));
        const reads=async()=>({capsule:await call('table.capsule',{rehydrate:true}),npc:await call('table.look',{focus:'npc'}),
            recall:await call('table.recall',{what:'memory',kinds:['promise'],limit:12}),continuity:await call('table.lookup',{kind:'continuity',anchors:['Steven Knott']})});
        const partialViews=await reads();
        const partialAudit=await call('mods.job',{role:'audit',input:{text:'The first part of the payment has arrived.'}});
        assert.ok(partialAudit.focus.memory.some(value=>value.fulfillment?.status==='partial'));
        assert.ok(partialViews.capsule.obligations.some(value=>value.name===rows[0].id&&value.fulfillment?.status==='partial'));
        assert.ok(partialViews.npc.present.some(npc=>npc.history?.promises?.some(promise=>promise.fulfillment?.status==='partial')));
        assert.ok(partialViews.recall.hits.some(value=>value.id===rows[0].id&&value.fulfillment?.terms[0].remaining==='20'));
        assert.ok(partialViews.continuity.promises.some(value=>value.fulfillment?.status==='partial'));
        const adaptive=await call('memory.evidence',{action:'snapshot',query:'Which payment remains?',filters:{kinds:['promise']}}),page=await call('memory.evidence',{action:'page',snapshot:adaptive.snapshot,offset:0});
        assert.ok(page.rows.some(value=>value.fulfillment?.status==='partial'));
        const memoryBefore=await readFile(join(campaign.directory,'memory/candidates.jsonl'),'utf8');
        // A host-declared stranded turn retains the first real payment without narration.
        await call('table.player_input',{text:'Please pay the remaining balance.',release:'stranded'});
        const current=await campaign.readTurn(),closed=await campaign.readTurnRecord(2);assert.equal(closed.closed_by,'stranded');
        const completed=await call('table.apply',{call_id:`t${current.turn}-c1`,effects:[effect(20)],_fulfillments:[{binding,effects:[{effect:0,term:0}]}]});
        const replay=await call('table.apply',{call_id:`t${current.turn}-c1`,effects:[effect(20)],_fulfillments:[{binding,effects:[{effect:0,term:0}]}]});assert.equal(replay.replayed,true);assert.deepEqual({...replay,replayed:undefined},{...completed,replayed:undefined});
        await assert.rejects(call('table.apply',{call_id:`t${current.turn}-c2`,effects:[effect(1)],_fulfillments:[{binding,effects:[{effect:0,term:0}]}]}),error=>error.details?.reason==='promise_already_fulfilled');
        const completeViews=await reads();
        const completeAudit=await call('mods.job',{role:'audit',input:{text:'The agreed payment has arrived.'}});
        assert.ok(completeAudit.focus.memory.some(value=>value.fulfillment?.status==='complete'));
        assert.ok(!completeViews.capsule.obligations.some(value=>value.name===rows[0].id));
        assert.ok(completeViews.capsule.obligations.some(value=>value.name===rows[1].id));
        assert.equal(completeViews.recall.hits.find(value=>value.id===rows[0].id).fulfillment.status,'complete');
        assert.ok(completeViews.npc.present.some(npc=>npc.history?.promises?.some(promise=>promise.fulfillment?.status==='complete')));
        assert.ok(completeViews.continuity.promises.some(value=>value.fulfillment?.status==='complete'));
        assert.equal(await readFile(join(campaign.directory,'memory/candidates.jsonl'),'utf8'),memoryBefore);
        const evidence=await call('memory.evidence',{action:'snapshot',query:'Which payment remains?',filters:{kinds:['promise']}}),done=await call('memory.evidence',{action:'page',snapshot:evidence.snapshot,offset:0});
        assert.ok(done.rows.some(value=>value.fulfillment?.status==='complete'));
        await call('table.narrate',{call_id:`t${current.turn}-c3`,text:'The agreed payment is handed over.'});
        const branch=await api.lineFulfillmentEvidence(campaign,'main');assert.equal(branch.available,true);
        const historical=api.withPromiseFulfillment(branch.memory,{campaign:'c1',...branch});assert.equal(historical.find(value=>value.id===rows[0].id).fulfillment.status,'complete');
    } finally {await runtime.close();}
});
