/** Source-backed receipt linkage tests. Contract fixtures, zero model calls, no play acceptance. */
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'../..');let api,bundle,fixture;
before(async()=>{
    await mkdir(join(root,'.tmp'),{recursive:true});bundle=await mkdtemp(join(root,'.tmp/fulfillment-test-'));
    await build({stdin:{contents:[
        "export * from './kernel-ts/memory/fulfillment-receipt.ts';",
        "export {createKernelContext} from './kernel-ts/context.ts';",
        "export {createKernelRuntime} from './kernel-ts/registry.ts';",
        "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
        "export {CampaignWriter} from './kernel-ts/write/store.ts';",
        "export {CampaignSnapshot,loadCampaignModule} from './kernel-ts/read/campaign.ts';",
        "export {stageCash,stageItem} from './kernel-ts/apply/inventory.ts';",
        "export {objectOwner} from './kernel-ts/mods/stage.ts';",
        "export {objectTransferReceipt} from './kernel-ts/mods/object-transfer.ts';",
        "export {moveObject} from './kernel-ts/mods/objects.ts';",
        "export {clone} from './kernel-ts/read/values.ts';",
        "export {issueSourceRef} from './runtime/jev/source-ref.ts';"
    ].join('\n'),resolveDir:root,sourcefile:'fulfillment-entry.ts'},outfile:join(bundle,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
    api=await import(pathToFileURL(join(bundle,'api.mjs')).href);fixture=await createFixture();
});
after(async()=>{await fixture?.runtime.close();if(bundle)await rm(bundle,{recursive:true,force:true});});
async function createFixture(){
    const base=join(root,'.coc/playtests/jev-fulfillment-contracts');await mkdir(base,{recursive:true});
    const home=await mkdtemp(join(base,'suite-'));await writeFile(join(home,'classification.json'),JSON.stringify({kind:'contract-fixture',live_play:false,model_calls:0}));
    const kernel=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:'finite-fulfillment',locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
    const runtime=api.createKernelRuntime(kernel),call=(method,params={})=>runtime.handlers[method]({campaign:'c1',...params});
    await call('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});await call('table.open');
    await call('table.player_input',{text:'I ask for the exact terms and inspect the case.'});
    const draft={name:'Accepted travel case',category:'item',description:'An ordinary travel case.',basis:'Contract fixture physical facts',parameters:{effects:[]},player_view:{description:'A travel case.',fields:[]}};
    const job=await call('mods.job',{role:'create',input:{name:draft.name,category:'item',description:draft.description}});
    await writeFile(join(job.cwd,'result.json'),JSON.stringify(draft));const accepted=await call('mods.accept',{job:job.job});
    const initialParty=await new api.CampaignWriter(kernel,'c1').party();
    await call('table.apply',{call_id:'t1-c1',effects:[{kind:'define',name:draft.name,category:'item',description:draft.description,_definition:accepted.definition,_provenance:accepted.provenance},
        {kind:'object',name:'Knott travel case',definition:draft.name,to:'Steven Knott',quantity:1},{kind:'cash',subject:initialParty[0].name,with:'Steven Knott',source:'found',currency:'USD',delta:30,why:'The existing purse receives a documented gift.'},{kind:'time',minutes:1,why:'The agreed inspection completes.'}]});
    await call('table.narrate',{call_id:'t1-c2',text:'{{say:Steven Knott}}I will pay 30 USD when the work is completed.{{/say}}\n{{say:Steven Knott}}I will pay 30 USD when the work is completed.{{/say}}\n{{say:Steven Knott}}I will give you the accepted case when the work is completed.{{/say}}\n{{say:Steven Knott}}I will pay 30 USD and give you the accepted case when the work is completed.{{/say}}'});
    const campaign=new api.CampaignWriter(kernel,'c1'),party=await campaign.party();
    const packet=await call('memory.job',{turn:1,mode:'referenced'});
    const decisions=packet.step.segments.map(segment=>segment.role==='keeper'?{source:segment.alias,outcome:'retain',annotations:[{kind:'promise',subject:'Steven Knott',entities:[party[0].name],state:'accurate'}]}:{source:segment.alias,outcome:'skip'});
    await call('memory.submit',{job_id:packet.job_id,referenced:{step:packet.step.key,decisions,...(packet.story_context?{story:{status:'unclear',thread:null,frame_source:null,bridge_delivered:false,delivery_source:null}}:{})}});
    await call('table.player_input',{text:'Please pay 10 USD now.'});
    const world=await campaign.readWorld(),turn=await campaign.readTurn(),meta=await campaign.readCampaign(),module=await api.loadCampaignModule(kernel,meta.module_id,world,'c1');
    const context={kernel,campaign,world,turn,graph:module.graph},snapshot=new api.CampaignSnapshot(kernel,'c1');
    const promises=(await snapshot.log('memory/candidates.jsonl')).filter(value=>value.kind==='promise'),record=await campaign.readTurnRecord(1);
    const sources=await Promise.all(promises.map(promise=>api.promiseFulfillmentSources(context,promise.id)));
    const instance=Object.values(world.objects.instances).find(value=>value.name==='Knott travel case');
    return {home,runtime,call,context,party,promises,sources,record,instance,condition:record.receipts.find(value=>value.kind==='time')??record.receipts.at(-1),
        cash:party[0].finance.cash.currency,payer:module.graph.handle(module.graph.npc('Steven Knott'))};
}
function binding(index=0,terms){
    const source=fixture.sources[index],result={version:1,promiseId:fixture.promises[index].id,promiseRefs:api.clone(source.refs),scope:source.scope,
        terms:terms??[{ordinal:0,kind:'cash',total:{source:source.scalars[0].ref,value:'30'},currency:fixture.cash,beneficiary:fixture.party[0].id,payer:fixture.payer}],
        conditionReceipts:[fixture.condition.id],coverage:{complete:true,used:[],omitted:[]},digest:''};
    result.coverage.used=[...result.promiseRefs,...result.terms.map(term=>term.total.source)];result.digest=api.fulfillmentBindingDigest(result);return result;
}
function cashEffect(delta){return {kind:'cash',subject:fixture.party[0].name,with:'Steven Knott',source:'quote',currency:fixture.cash,delta};}
function stagedContext(input,ordinal=1){return {...input,world:api.clone(input.world),callId:`t${input.turn.turn}-c${ordinal}`,ordinal,mint:base=>base};}
const priorReceipts=()=>[...fixture.record.receipts,...fixture.context.turn.receipts];
async function cashStage(context,effect,ordinal=1){const staged=stagedContext(context,ordinal),sheets=new Map();const {receipt}=await api.stageCash(staged,effect,sheets);return {receipt,world:staged.world,sheets};}
const reason=expected=>error=>error?.details?.reason===expected;

test('verified canonical T09 promises retain independent occurrences and exact finite scalar refs',()=>{
    assert.equal(fixture.promises.length,4);assert.notEqual(fixture.promises[0].id,fixture.promises[1].id);
    assert.equal(fixture.sources[0].scalars[0].value,'30');assert.equal(fixture.sources[2].scalars.length,0);
    assert.notDeepEqual(fixture.sources[0].refs,fixture.sources[1].refs);
});
test('partial and remainder allocations conserve exact canonical receipt values without mutable source pins',async()=>{
    const term=binding(),anchor=fixture.record.receipts.find(receipt=>receipt.kind==='cash');
    term.terms[0].total.source=api.issueSourceRef(api.fulfillmentReceiptSource(term.scope,fixture.sources[0].promise.source.commit,1,anchor),{kind:'field',path:['delta']});
    term.coverage.used=[...term.promiseRefs,term.terms[0].total.source];term.digest=api.fulfillmentBindingDigest(term);
    const effect=cashEffect(10),current=api.fulfillmentCurrentInputSource(term.scope,fixture.context.turn.turn,fixture.context.turn.player_text);
    const amountSource=api.fulfillmentNumericCandidates(current)[0].ref;
    await api.prepareFulfillments({...fixture.context,bindings:[{binding:term,effects:[{effect:0,term:0,amountSource:term.terms[0].total.source}]}],effects:[cashEffect(30)]});
    const first=await api.prepareFulfillments({...fixture.context,bindings:[{binding:term,effects:[{effect:0,term:0,amountSource}]}],effects:[effect]});
    const staged=await cashStage(fixture.context,effect);first.attach(new Map([[0,[staged.receipt]]]),staged.world);
    assert.equal(staged.receipt.fulfillment.applied,'10');assert.equal(staged.receipt.fulfillment.status,'partial');
    const receipts=[...priorReceipts(),staged.receipt],view=api.derivePromiseFulfillment(term.promiseId,receipts,term);
    assert.deepEqual([view.status,view.terms[0].fulfilled,view.terms[0].remaining],['partial','10','20']);
    const campaign=Object.create(fixture.context.campaign);campaign.party=async()=>fixture.party.map(person=>staged.sheets.get(person.id)??person);
    const context={...fixture.context,campaign,turn:{...fixture.context.turn,receipts:[...fixture.context.turn.receipts,staged.receipt]}},remainder=cashEffect(20);
    const second=await api.prepareFulfillments({...context,bindings:[{binding:term,effects:[{effect:0,term:0}]}],effects:[remainder]});
    const finished=await cashStage(context,remainder,2);second.attach(new Map([[0,[finished.receipt]]]),finished.world);
    const all=[...receipts,finished.receipt],complete=api.derivePromiseFulfillment(term.promiseId,[...all,finished.receipt],term);
    assert.equal(complete.status,'complete');assert.equal(complete.terms[0].remaining,'0');
    await assert.rejects(api.prepareFulfillments({...context,turn:{...context.turn,receipts:[...context.turn.receipts,finished.receipt]},bindings:[{binding:term,effects:[{effect:0,term:0}]}],effects:[cashEffect(1)]}),reason('promise_already_fulfilled'));
    assert.equal(api.derivePromiseFulfillment(fixture.promises[1].id,all,binding(1)).status,'open');
});
test('a missing partial source, stale input, foreign total, omitted term or overpayment refuses before attachment',async()=>{
    const base=binding();
    await assert.rejects(api.prepareFulfillments({...fixture.context,bindings:[{binding:base,effects:[{effect:0,term:0}]}],effects:[cashEffect(10)]}),reason('needs_source'));
    await assert.rejects(api.prepareFulfillments({...fixture.context,bindings:[{binding:base,effects:[{effect:0,term:0}]}],effects:[cashEffect(31)]}),reason('promise_overfulfilled'));
    for(const mutate of [value=>{value.scope.loop++;},value=>{value.coverage.complete=false;},value=>{value.terms[0].total.source.revision='changed';},value=>{value.terms[0].total.value='40';},value=>{value.conditionReceipts=['missing-condition'];}]) {
        const bad=api.clone(base);mutate(bad);bad.digest=api.fulfillmentBindingDigest(bad);
        await assert.rejects(api.prepareFulfillments({...fixture.context,bindings:[{binding:bad,effects:[{effect:0,term:0}]}],effects:[cashEffect(30)]}));
    }
    const current=api.fulfillmentCurrentInputSource(base.scope,fixture.context.turn.turn,'A stale request for 10 USD.');
    await assert.rejects(api.prepareFulfillments({...fixture.context,bindings:[{binding:base,effects:[{effect:0,term:0,amountSource:api.fulfillmentNumericCandidates(current)[0].ref}]}],effects:[cashEffect(10)]}),reason('needs_source'));
});
test('typed scalar units cannot be rebound from object quantity to money',async()=>{
    const value=binding(),created=fixture.record.receipts.find(receipt=>receipt.instance===fixture.instance.id);
    value.terms[0].total={source:api.issueSourceRef(api.fulfillmentReceiptSource(value.scope,fixture.sources[0].promise.source.commit,1,created),{kind:'field',path:['quantity']}),value:'1'};
    value.coverage.used=[...value.promiseRefs,value.terms[0].total.source];value.digest=api.fulfillmentBindingDigest(value);
    await assert.rejects(api.prepareFulfillments({...fixture.context,bindings:[{binding:value,effects:[{effect:0,term:0}]}],effects:[cashEffect(1)]}),reason('unsupported_terms'));
});
test('multi-effect attachment refuses every link when a later actual receipt is wrong',async()=>{
    const first=binding(0),second=binding(1),effect=cashEffect(30);
    const plan=await api.prepareFulfillments({...fixture.context,bindings:[{binding:first,effects:[{effect:0,term:0}]},{binding:second,effects:[{effect:1,term:0}]}],effects:[effect,effect]});
    const a=await cashStage(fixture.context,effect,3),b=await cashStage(fixture.context,effect,4);b.receipt.currency='foreign';
    assert.throws(()=>plan.attach(new Map([[0,[a.receipt]],[1,[b.receipt]]]),a.world),reason('fulfillment_receipt_invalid'));
    assert.equal(a.receipt.fulfillment,undefined);assert.equal(b.receipt.fulfillment,undefined);
});
test('non-module physical gift quantity binds its immutable creation receipt and preserves the instance',async()=>{
    const source=fixture.sources[2],created=fixture.record.receipts.find(value=>value.instance===fixture.instance.id);
    const receiptSource=api.fulfillmentReceiptSource(source.scope,source.promise.source.commit,1,created),quantity=api.issueSourceRef(receiptSource,{kind:'field',path:['quantity']});
    const terms=[{ordinal:0,kind:'object',total:{source:quantity,value:'1'},definition:fixture.instance.definition,instance:fixture.instance.id,beneficiary:fixture.party[0].id,payer:fixture.payer}];
    const value=binding(2,terms),effect={kind:'object',name:fixture.instance.name,from:'Steven Knott',to:fixture.party[0].name,quantity:1};
    const plan=await api.prepareFulfillments({...fixture.context,bindings:[{binding:value,effects:[{effect:0,term:0}]}],effects:[effect]});
    const world=api.clone(fixture.context.world),owner=await api.objectOwner(fixture.context.campaign,fixture.context.graph,world,effect.to),from=await api.objectOwner(fixture.context.campaign,fixture.context.graph,world,effect.from);
    const moved=api.moveObject(world,effect.name,null,owner,{source:from,quantity:1,turn:1}),definition=world.objects.definitions[moved.definition];
    const {receipt}=api.objectTransferReceipt({world,id:'object-gift-t1-c5',callId:'t1-c5',name:moved.name,owner,source:from,quantity:1,item:moved,definition});
    plan.attach(new Map([[0,[receipt]]]),world);
    assert.equal(receipt.fulfillment.status,'complete');assert.equal(receipt.instance,fixture.instance.id);assert.deepEqual(receipt.state,fixture.instance.state);
    assert.equal(fixture.context.graph.find(definition.name),null);
    assert.equal(api.derivePromiseFulfillment(value.promiseId,[...priorReceipts(),receipt],value).status,'complete');
});
test('derived indexes reject receipt tampering and bind exact decimal arithmetic',()=>{
    const ref=fixture.sources[0].scalars[0].ref,value=binding();
    const modified=api.clone(value);modified.terms[0].total={source:ref,value:'0.3'};modified.digest=api.fulfillmentBindingDigest(modified);
    const make=(id,amount,before,after)=>({id,kind:'cash',call_id:id,subject:fixture.party[0].id,with:fixture.payer,currency:fixture.cash,delta:amount,before,after,
        fulfillment:{version:1,promise:modified.promiseId,promise_source_refs:modified.promiseRefs,scope:modified.scope,terms_digest:modified.digest,terms:modified.terms,term:0,
            condition_receipts:[fixture.condition.id],applied:String(amount),status:'partial'}});
    const a=make('fraction-a',0.1,0,0.1),b=make('fraction-b',0.2,0.1,0.3);
    assert.equal(api.derivePromiseFulfillment(modified.promiseId,[fixture.condition,a,b],modified).terms[0].remaining,'0');
    assert.throws(()=>api.derivePromiseFulfillment(modified.promiseId,[fixture.condition,a,{...b,delta:0.3}],modified),reason('fulfillment_receipt_invalid'));
    assert.throws(()=>api.derivePromiseFulfillment(modified.promiseId,[fixture.condition,a,{...a,after:0.2}],modified),reason('fulfillment_receipt_invalid'));
    assert.throws(()=>api.fulfillmentDecimal('half'),reason('unsupported_terms'));assert.throws(()=>api.fulfillmentDecimal('20/day'),reason('unsupported_terms'));
});

test('all finite terms must reach zero and helper preparation/attachment never writes campaign state',async()=>{
    const source=fixture.sources[3],created=fixture.record.receipts.find(value=>value.instance===fixture.instance.id);
    const quantity=api.issueSourceRef(api.fulfillmentReceiptSource(source.scope,source.promise.source.commit,1,created),{kind:'field',path:['quantity']});
    const cash={ordinal:0,kind:'cash',total:{source:source.scalars[0].ref,value:'30'},currency:fixture.cash,beneficiary:fixture.party[0].id,payer:fixture.payer};
    const item={ordinal:1,kind:'object',total:{source:quantity,value:'1'},definition:fixture.instance.definition,instance:fixture.instance.id,beneficiary:fixture.party[0].id,payer:fixture.payer};
    const value=binding(3,[cash,item]),effect=cashEffect(30),paths=['world.json','turn.json','events.jsonl','memory/candidates.jsonl'];
    const read=()=>Promise.all(paths.map(path=>readFile(join(fixture.context.campaign.directory,path),'utf8'))),before=await read();
    const plan=await api.prepareFulfillments({...fixture.context,bindings:[{binding:value,effects:[{effect:0,term:0}]}],effects:[effect]});
    const staged=await cashStage(fixture.context,effect,6);plan.attach(new Map([[0,[staged.receipt]]]),staged.world);
    const view=api.derivePromiseFulfillment(value.promiseId,[...priorReceipts(),staged.receipt],value);
    assert.equal(view.status,'partial');assert.deepEqual(view.terms.map(term=>term.remaining),['0','1']);
    assert.deepEqual(await read(),before);
});
test('split ancestry uses canonical parent identity and never a legacy display name',()=>{
    const term={ordinal:0,kind:'object',total:{source:fixture.sources[0].refs[0],value:'1'},definition:fixture.instance.definition,instance:fixture.instance.id,beneficiary:fixture.party[0].id,payer:fixture.payer};
    const receipt={id:'split-contract',call_id:'t2-c99',kind:'item',subject:fixture.party[0].id,quantity:1,instance:'new-part-instance',divided_from:fixture.instance.name,divided_from_instance:fixture.instance.id};
    assert.equal(api.fulfillmentReceiptAmount(receipt,term).coefficient,1n);
    const legacy={...receipt};delete legacy.divided_from_instance;
    assert.throws(()=>api.fulfillmentReceiptAmount(legacy,term),reason('fulfillment_receipt_invalid'));
    assert.throws(()=>api.fulfillmentReceiptAmount({...legacy,divided_from:fixture.instance.id},term),reason('fulfillment_receipt_invalid'));
});
test('gift-first fulfillment remains valid after the gift moves or leaves current storage',async()=>{
    const source=fixture.sources[3],created=fixture.record.receipts.find(receipt=>receipt.instance===fixture.instance.id);
    const quantity=api.issueSourceRef(api.fulfillmentReceiptSource(source.scope,source.promise.source.commit,1,created),{kind:'field',path:['quantity']});
    const value=binding(3,[{ordinal:0,kind:'cash',total:{source:source.scalars[0].ref,value:'30'},currency:fixture.cash,beneficiary:fixture.party[0].id,payer:fixture.payer},
        {ordinal:1,kind:'object',total:{source:quantity,value:'1'},definition:fixture.instance.definition,instance:fixture.instance.id,beneficiary:fixture.party[0].id,payer:fixture.payer}]);
    const turn=fixture.context.turn.turn;
    await fixture.call('table.apply',{call_id:`t${turn}-c10`,effects:[{kind:'object',name:fixture.instance.name,from:'Steven Knott',to:fixture.party[0].name,quantity:1,handover:'given'}],
        _fulfillments:[{binding:value,effects:[{effect:0,term:1}]}]});
    await fixture.call('table.apply',{call_id:`t${turn}-c11`,effects:[{kind:'object',name:fixture.instance.name,from:fixture.party[0].name,to:'here',quantity:1}]});
    const current=await fixture.context.campaign.readTurn(),world=await fixture.context.campaign.readWorld(),missing=api.clone(world);
    delete missing.objects.instances[fixture.instance.id];delete missing.objects.definitions[fixture.instance.definition];
    await api.prepareFulfillments({...fixture.context,world:missing,turn:current,bindings:[{binding:value,effects:[{effect:0,term:0}]}],effects:[cashEffect(30)]});
    await fixture.call('table.apply',{call_id:`t${turn}-c12`,effects:[cashEffect(30)],_fulfillments:[{binding:value,effects:[{effect:0,term:0}]}]});
    const receipts=[...fixture.record.receipts,...(await fixture.context.campaign.readTurn()).receipts];
    assert.equal(api.derivePromiseFulfillment(value.promiseId,receipts,value).status,'complete');
});
test('an explicit canonical correction retires only the selected promise occurrence',async()=>{
    const turn=fixture.context.turn.turn;
    await fixture.call('table.narrate',{call_id:`t${turn}-c1`,text:'The first payment promise is withdrawn; the independent second promise remains.'});
    const packet=await fixture.call('memory.job',{turn,mode:'referenced'}),target=packet.prior[0].alias;
    const decisions=packet.step.segments.map(segment=>segment.role==='keeper'?{source:segment.alias,outcome:'retain',annotations:[{kind:'keeper_correction',subject:'Steven Knott',state:'accurate',relations:[{relation:'correction',target}]}]}:{source:segment.alias,outcome:'skip'});
    await fixture.call('memory.submit',{job_id:packet.job_id,referenced:{step:packet.step.key,decisions,...(packet.story_context?{story:{status:'unclear',thread:null,frame_source:null,bridge_delivered:false,delivery_source:null}}:{})}});
    await assert.rejects(api.promiseFulfillmentSources(fixture.context,fixture.promises[0].id),reason('promise_not_current'));
    assert.equal((await api.promiseFulfillmentSources(fixture.context,fixture.promises[1].id)).promise.id,fixture.promises[1].id);
});
