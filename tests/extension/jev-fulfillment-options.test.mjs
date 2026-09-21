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
        "export {fulfillmentPortableNumber,fulfillmentContextExcerpt,fulfillmentConditionDescription} from './kernel-ts/runtime/fulfillment-options.ts';",
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
async function createFixture(weapon=false,quantity=1,promisedQuantity=null){
    const base=join(root,'.coc/playtests/jev-fulfillment-options-contracts');await mkdir(base,{recursive:true});
    const home=await mkdtemp(join(base,'suite-'));await writeFile(join(home,'classification.json'),JSON.stringify({kind:'contract-fixture',live_play:false,model_calls:0}));
    const kernel=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:'finite-fulfillment',locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
    const runtime=api.createKernelRuntime(kernel),call=(method,params={})=>runtime.handlers[method]({campaign:'c1',...params});
    await call('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});await call('table.open');
    await call('table.player_input',{text:'I ask for the exact terms and inspect the case.'});
    const draft=weapon?{name:'Accepted service revolver',category:'weapon',description:'An existing service revolver.',basis:'Contract fixture physical facts',parameters:{skill:'Firearms (Handgun)',damage:'1d10',uses_per_round:1,magazine:6,initial_ammo:3,impale:true,adds_damage_bonus:false},player_view:{description:'A worn service revolver.',fields:[]}}:{name:'Accepted travel case',category:'item',description:'An ordinary travel case.',basis:'Contract fixture physical facts',parameters:{charges:quantity>1?null:4,effects:[]},player_view:{description:'A travel case.',fields:[]}};
    const instanceName=weapon?'Knott service revolver':'Knott travel case';
    const job=await call('mods.job',{role:'create',input:{name:draft.name,category:draft.category,description:draft.description}});
    await writeFile(join(job.cwd,'result.json'),JSON.stringify(draft));const accepted=await call('mods.accept',{job:job.job});
    const initialParty=await new api.CampaignWriter(kernel,'c1').party();
    await call('table.apply',{call_id:'t1-c1',effects:[{kind:'define',name:draft.name,category:draft.category,description:draft.description,_definition:accepted.definition,_provenance:accepted.provenance},
        {kind:'object',name:instanceName,definition:draft.name,to:'Steven Knott',quantity,condition:'damaged'},{kind:'cash',subject:initialParty[0].name,with:'Steven Knott',source:'found',currency:'USD',delta:30,why:'The existing purse receives a documented gift.'},{kind:'time',minutes:1,why:'The agreed inspection completes.'}]});
    let narration='{{say:Steven Knott}}I will pay 30 USD when the work is completed.{{/say}}\n{{say:Steven Knott}}I will pay 30 USD when the work is completed.{{/say}}\n{{say:Steven Knott}}I will give you the accepted case when the work is completed.{{/say}}\n{{say:Steven Knott}}I will pay 30 USD and give you the accepted case when the work is completed.{{/say}}';
    if(promisedQuantity!==null) narration=narration.replaceAll('the accepted case',String(promisedQuantity)+' accepted cases');
    await call('table.narrate',{call_id:'t1-c2',text:weapon?narration.replaceAll('accepted case','accepted service revolver'):narration});
    const campaign=new api.CampaignWriter(kernel,'c1'),party=await campaign.party();
    const packet=await call('memory.job',{turn:1,mode:'referenced'});
    const decisions=packet.step.segments.map(segment=>segment.role==='keeper'?{source:segment.alias,outcome:'retain',annotations:[{kind:'promise',subject:'Steven Knott',entities:[party[0].name],state:'accurate'}]}:{source:segment.alias,outcome:'skip'});
    await call('memory.submit',{job_id:packet.job_id,referenced:{step:packet.step.key,decisions,...(packet.story_context?{story:{status:'unclear',thread:null,frame_source:null,bridge_delivered:false,delivery_source:null}}:{})}});
    await call('table.player_input',{text:quantity>1?'Please give me the promised cases; I may take 1 first.':'Please pay 10 USD now.'});
    const world=await campaign.readWorld(),turn=await campaign.readTurn(),meta=await campaign.readCampaign(),module=await api.loadCampaignModule(kernel,meta.module_id,world,'c1');
    const context={kernel,campaign,world,turn,graph:module.graph},snapshot=new api.CampaignSnapshot(kernel,'c1');
    const promises=(await snapshot.log('memory/candidates.jsonl')).filter(value=>value.kind==='promise'),record=await campaign.readTurnRecord(1);
    const sources=await Promise.all(promises.map(promise=>api.promiseFulfillmentSources(context,promise.id)));
    const instance=Object.values(world.objects.instances).find(value=>value.name===instanceName);
    return {home,runtime,call,context,party,promises,sources,record,instance,condition:record.receipts.find(value=>value.kind==='time')??record.receipts.at(-1),
        cash:party[0].finance.cash.currency,payer:module.graph.handle(module.graph.npc('Steven Knott'))};
}
const reason=expected=>error=>error?.details?.reason===expected;
async function options(indices=[0]) {return fixture.call('table.fulfillment.options',{promises:indices.map(index=>fixture.promises[index].id)});}
function selections(packet,kind='cash',index=0){
    const c=packet.catalog,p=c.promises[index],beneficiary=c.beneficiaries[0],payer=c.payers.find(value=>value.name==='Steven Knott');
    const total=p.scalars.find(value=>kind==='cash'?value.kind==='token':value.kind==='object');
    return {promise:p.alias,coverage:'complete',conditions:[c.conditions.find(value=>value.description.kind==='time').alias],terms:[{kind,total:total.alias,beneficiary:beneficiary.alias,payer:payer.alias,
        ...(kind==='cash'?{currency:beneficiary.currencies[0].alias}:{object:c.objects[0].alias,handover:'given'}),allocation:'remaining'}]};
}
test('catalog uses real canonical sources and aliases without private identity leakage',async()=>{
    const packet=await options([0,1,2,3]),json=JSON.stringify(packet.catalog);
    for(const id of [...fixture.promises.map(p=>p.id),fixture.instance.id,fixture.instance.definition,fixture.condition.id,fixture.sources[0].promise.source.commit]) assert.equal(json.includes(id),false,id);
    assert.equal(packet.catalog.promises.length,4);assert.equal(packet.catalog.promises[0].original_context[0].omitted,false);
    assert.ok(packet.catalog.objects[0].scalars.some(value=>value.value==='1'));
    const navigation=await fixture.call('table.apply.options');assert.equal(navigation.promises.length,4);assert.equal(navigation.private_promises['promise:0'],fixture.promises[0].id);
});
test('readonly prepare materializes finite cash and independent physical gift through canonical bindings',async()=>{
    const packet=await options([0,2]),before=await readFile(join(fixture.context.campaign.directory,'world.json'),'utf8');
    const value=await fixture.call('table.fulfillment.prepare',{snapshot:packet.snapshot,selections:[selections(packet),selections(packet,'object',1)]});
    assert.equal(value.effects.length,2);assert.equal(value.effects[0].delta,30);assert.equal(value.effects[1].quantity,1);
    assert.equal(value.effects[1].name,'Knott travel case');assert.equal(value.bindings.fulfillments.length,2);
    assert.equal(await readFile(join(fixture.context.campaign.directory,'world.json'),'utf8'),before);
});
test('cash allocation selects current input token and multi-term promises retain both terms',async()=>{
    const packet=await options([3]),cash=selections(packet),gift=selections(packet,'object');
    cash.terms[0].allocation=packet.catalog.allocations[0].alias;cash.terms.push(...gift.terms);
    const value=await fixture.call('table.fulfillment.prepare',{snapshot:packet.snapshot,selections:[cash]});
    assert.equal(value.effects[0].delta,10);assert.equal(value.bindings.fulfillments[0].binding.terms.length,2);
    assert.ok(value.bindings.fulfillments[0].effects[0].amountSource);
});
test('unissued identities, forged numeric amounts, foreign tokens and missing coverage refuse',async()=>{
    const packet=await options([0,1]);
    for(const mutate of [s=>s.terms[0].delta=10,s=>s.terms[0].payer=fixture.payer,s=>s.coverage='partial',s=>s.terms[0].total=packet.catalog.promises[1].scalars[0].alias,s=>s.conditions=['condition:missing'],s=>{s.terms[0].kind='object';delete s.terms[0].currency;s.terms[0].object=packet.catalog.objects[0].alias;s.terms[0].handover='given';}]) {
        const selection=selections(packet);mutate(selection);
        await assert.rejects(fixture.call('table.fulfillment.prepare',{snapshot:packet.snapshot,selections:[selection]}));
    }
    await assert.rejects(fixture.call('table.fulfillment.prepare',{snapshot:'missing',selections:[selections(packet)]}),reason('fulfillment_snapshot_stale'));
});
test('portable cash number conversion preserves decimals and rejects bigint rounding or object serialization',()=>{
    for(const value of ['0.3','10','30.25']) assert.equal(JSON.stringify(api.fulfillmentPortableNumber(value)),String(Number(value)));
    assert.throws(()=>api.fulfillmentPortableNumber('9007199254740993'),reason('unsupported_terms'));
    assert.throws(()=>api.fulfillmentPortableNumber('0.123456789012345678901'),reason('unsupported_terms'));
});
test('validated voice presentation remains fresh while changed object authority invalidates',async()=>{
    const campaign=fixture.context.campaign,world=await campaign.readWorld();
    world.mods??={};world.mods.state??={};world.mods.state['npc-voice']??={};world.mods.state['npc-voice'].dossier??={};world.mods.state['npc-voice'].dossier[fixture.payer]??={};
    const fields=world.mods.state['npc-voice'].dossier[fixture.payer];fields.voice_mask={value:['Measured.'],label:'mask',turn:1,mod:'npc-voice',shape:'lines'};
    await campaign.writeWorld(world);const packet=await options();fields.voice_mask.value=['Urgent.'];await campaign.writeWorld(world);
    const value=await fixture.call('table.fulfillment.prepare',{snapshot:packet.snapshot,selections:[selections(packet)]});assert.equal(value.effects[0].delta,30);
    const objectPacket=await options([2]);world.objects.instances[fixture.instance.id].quantity=2;await campaign.writeWorld(world);
    await assert.rejects(fixture.call('table.fulfillment.prepare',{snapshot:objectPacket.snapshot,selections:[selections(objectPacket,'object')]}),reason('fulfillment_snapshot_stale'));
    world.objects.instances[fixture.instance.id].quantity=1;await campaign.writeWorld(world);
});
test('partial terms reuse the receipt-bound immutable binding and may defer known terms',async()=>{
    const packet=await options([3]),cash=selections(packet),gift=selections(packet,'object');
    cash.terms[0].allocation=packet.catalog.allocations[0].alias;gift.terms[0].allocation='defer';cash.terms.push(...gift.terms);
    const prepared=await fixture.call('table.fulfillment.prepare',{snapshot:packet.snapshot,selections:[cash]});
    assert.equal(prepared.effects.length,1);
    await fixture.call('table.apply',{call_id:'t2-c1',effects:prepared.effects,_fulfillments:prepared.bindings.fulfillments});
    const next=await options([3]),promise=next.catalog.promises[0];assert.equal(promise.fulfillment.status,'partial');
    assert.equal(promise.prior_terms.length,2);assert.equal(promise.prior_terms[0].remaining,'20');
    const selection={promise:promise.alias,conditions:[next.catalog.conditions.find(value=>value.description.kind==='time').alias],coverage:'complete',
        terms:promise.prior_terms.map(term=>({prior:term.alias,allocation:'remaining',...(term.kind==='object'?{handover:'given'}:{})}))};
    const remainder=await fixture.call('table.fulfillment.prepare',{snapshot:next.snapshot,selections:[selection]});
    assert.equal(remainder.effects[0].delta,20);assert.equal(remainder.effects[1].quantity,1);
    assert.deepEqual(remainder.bindings.fulfillments[0].binding.terms,prepared.bindings.fulfillments[0].binding.terms);
    assert.equal(remainder.bindings.fulfillments[0].binding.digest,prepared.bindings.fulfillments[0].binding.digest);
    await assert.rejects(fixture.call('table.fulfillment.prepare',{snapshot:next.snapshot,selections:[selections(next)]}),reason('unsupported_terms'));
});
test('unchanged prepared physical gift applies through the ordinary kernel transaction and preserves ammunition',async()=>{
    const physical=await createFixture(true);
    try {
        const packet=await physical.call('table.fulfillment.options',{promises:[physical.promises[2].id]}),selection=selections(packet,'object');
        const missing=structuredClone(selection);delete missing.terms[0].handover;
        await assert.rejects(physical.call('table.fulfillment.prepare',{snapshot:packet.snapshot,selections:[missing]}),reason('unsupported_terms'));
        for(const handover of ['taken','check']) {
            const forbidden=structuredClone(selection);forbidden.terms[0].handover=handover;
            await assert.rejects(physical.call('table.fulfillment.prepare',{snapshot:packet.snapshot,selections:[forbidden]}),reason('unsupported_terms'));
        }
        const prepared=await physical.call('table.fulfillment.prepare',{snapshot:packet.snapshot,selections:[selection]});
        assert.equal(prepared.effects[0].handover,'given');assert.equal(prepared.effects[0].name,'Knott service revolver');
        const before=structuredClone(physical.instance),published=await physical.call('table.apply',{call_id:'t2-c1',effects:prepared.effects,_fulfillments:prepared.bindings.fulfillments});
        const world=await physical.context.campaign.readWorld(),turn=await physical.context.campaign.readTurn(),instance=world.objects.instances[before.id];
        const receipt=turn.receipts.find(value=>value.fulfillment?.promise===physical.promises[2].id);
        assert.ok(receipt);assert.equal(instance.id,before.id);assert.equal(instance.definition,before.definition);assert.equal(instance.quantity,before.quantity);
        assert.deepEqual(instance.state,before.state);assert.equal(instance.state.ammo,3);assert.equal(instance.state.condition,'damaged');
        assert.equal(instance.owner.id,physical.party[0].id);assert.equal(receipt.handover,'given');assert.equal(receipt.fulfillment.status,'complete');
        assert.equal(receipt.quantity,1);assert.deepEqual(receipt.state,before.state);
        const same=await physical.call('table.apply',{call_id:'t2-c1',effects:prepared.effects,_fulfillments:prepared.bindings.fulfillments});assert.equal(same.replayed,true);assert.deepEqual(same,{...published,replayed:true});
    } finally {await physical.runtime.close();}
});
test('partial physical stacks refuse before writes while whole stacks and existing split remainders apply',async()=>{
    for(const mode of ['partial-refusal','whole-stack','existing-split-remainder']) {
        const physical=await createFixture(false,3,mode==='partial-refusal'?2:3);
        try {
            const packet=await physical.call('table.fulfillment.options',{promises:[physical.promises[2].id]}),selection=selections(packet,'object');
            selection.terms[0].total=packet.catalog.promises[0].scalars.find(value=>value.kind==='token').alias;
            if(mode==='partial-refusal') {
                const paths=['world.json','turn.json','events.jsonl','memory/candidates.jsonl'],read=()=>Promise.all(paths.map(path=>readFile(join(physical.context.campaign.directory,path),'utf8'))),before=await read();
                await assert.rejects(physical.call('table.fulfillment.prepare',{snapshot:packet.snapshot,selections:[selection]}),error=>error.details?.reason==='unsupported_terms'&&error.message.includes('named part'));
                assert.deepEqual(await read(),before);assert.equal((await physical.context.campaign.readWorld()).objects.instances[physical.instance.id].quantity,3);continue;
            }
            const prepared=await physical.call('table.fulfillment.prepare',{snapshot:packet.snapshot,selections:[selection]});assert.equal(prepared.effects[0].quantity,3);assert.equal(prepared.effects[0].part,undefined);
            if(mode==='whole-stack') {
                await physical.call('table.apply',{call_id:'t2-c1',effects:prepared.effects,_fulfillments:prepared.bindings.fulfillments});
                const world=await physical.context.campaign.readWorld(),instance=world.objects.instances[physical.instance.id];assert.equal(instance.quantity,3);assert.equal(instance.owner.id,physical.party[0].id);assert.deepEqual(instance.state,physical.instance.state);continue;
            }
            // The incumbent owner supplies the independently named part and actual current-input allocation.
            const effect={...prepared.effects[0],quantity:1,part:'First accepted case'},binding=structuredClone(prepared.bindings.fulfillments[0]);
            const current=api.fulfillmentCurrentInputSource(binding.binding.scope,physical.context.turn.turn,physical.context.turn.player_text);
            binding.effects[0].amountSource=api.fulfillmentNumericCandidates(current)[0].ref;
            await physical.call('table.apply',{call_id:'t2-c1',effects:[effect],_fulfillments:[binding]});
            const splitReceipt=(await physical.context.campaign.readTurn()).receipts.find(value=>value.fulfillment?.promise===physical.promises[2].id);assert.equal(splitReceipt.divided_from_instance,physical.instance.id);assert.equal(splitReceipt.divided_from,physical.instance.name);
            const next=await physical.call('table.fulfillment.options',{promises:[physical.promises[2].id]}),promise=next.catalog.promises[0];assert.equal(promise.prior_terms[0].remaining,'2');
            const remainder=await physical.call('table.fulfillment.prepare',{snapshot:next.snapshot,selections:[{promise:promise.alias,coverage:'complete',conditions:[next.catalog.conditions.find(value=>value.description.kind==='time').alias],terms:[{prior:promise.prior_terms[0].alias,allocation:'remaining',handover:'given'}]}]});
            assert.equal(remainder.effects[0].quantity,2);assert.equal(remainder.effects[0].part,undefined);assert.equal(remainder.bindings.fulfillments[0].binding.digest,prepared.bindings.fulfillments[0].binding.digest);
            await physical.call('table.apply',{call_id:'t2-c2',effects:remainder.effects,_fulfillments:remainder.bindings.fulfillments});
            const world=await physical.context.campaign.readWorld(),turn=await physical.context.campaign.readTurn(),instance=world.objects.instances[physical.instance.id];
            assert.equal(instance.quantity,2);assert.equal(instance.owner.id,physical.party[0].id);assert.deepEqual(instance.state,physical.instance.state);
            assert.equal(turn.receipts.filter(value=>value.fulfillment?.promise===physical.promises[2].id).at(-1).fulfillment.status,'complete');
        } finally {await physical.runtime.close();}
    }
});
test('condition labels never expose unresolved historical identities and source excerpts preserve code points',()=>{
    const names=new Map([['npc-known','Current Knott'],['scene-known','The office']]);
    const view=api.fulfillmentConditionDescription({kind:'cash',subject:'retired-investigator',with:'npc-known',to:{kind:'npc',id:'retired-recipient'},from:'retired-giver',from_label:'Former owner',clue:'missing-clue',why:'Original reason text stays untouched.'},names);
    assert.equal(view.subject,null);assert.equal(view.with,'Current Knott');assert.equal(view.to,null);assert.equal(view.from,'Former owner');assert.equal(view.clue,null);
    assert.equal(view.why,'Original reason text stays untouched.');assert.equal(JSON.stringify(view).includes('retired-'),false);
    assert.deepEqual(api.fulfillmentContextExcerpt('a😀b',2),{text:'a😀',omitted:true});assert.deepEqual(api.fulfillmentContextExcerpt('a😀',2),{text:'a😀',omitted:false});
    assert.deepEqual(api.fulfillmentContextExcerpt('😀'.repeat(24001),24000),{text:'😀'.repeat(24000),omitted:true});
});
test('changing the actual open input invalidates the issued catalog',async()=>{
    const packet=await options();await fixture.context.campaign.writeTurn({...await fixture.context.campaign.readTurn(),player_text:'Please pay 20 USD now.'});
    await assert.rejects(fixture.call('table.fulfillment.prepare',{snapshot:packet.snapshot,selections:[selections(packet)]}),reason('fulfillment_snapshot_stale'));
});
