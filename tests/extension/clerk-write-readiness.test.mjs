/**
 * §215 (issue #112, live table 9e7g turns 30-31): the §209.6 readiness hold is for the Keeper's own decisions. A policy
 * clerk's declared move to a chosen, visited exit was blocked by the Mod-section readiness hold ("narration-craft:
 * Establishing a place", `before_apply:move`) before the Keeper's first request of the turn had been sent, every turn, and
 * the clerk can never "re-decide with the expanded request". Here the context hook is driven exactly as the kernel
 * extension's canonical gateway drives it: the gateway port names the call's host origin.
 *
 * §228.3 (amends §209.6 and §215): no write is held for detail it was not shown any more. The Keeper's own write reaches
 * admission and the kernel, and the section it used undelivered is attached to that call's result as `disclosed_detail`,
 * once per input. A policy clerk's write decides nothing from the Keeper's request, so nothing is attached to it.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm,symlink,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'clerk-write-readiness-'));
await symlink(join(root,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:"export {installContextPolicy} from './extensions/table/context-runtime.ts'; export {parseSections} from './kernel-ts/read/sections.ts';",resolveDir:root},
    outfile:join(temp,'api.mjs'),bundle:true,packages:'external',format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
test.after(()=>rm(temp,{recursive:true,force:true}));

function install(instruction){
    const hooks=new Map(),bus=new Map(),rows=[];
    const on=(name,handler)=>{const list=bus.get(name)??[];list.push(handler);bus.set(name,list);};
    const pi={on:(name,handler)=>hooks.set(name,handler),events:{on,emit:(name,value)=>{for(const handler of bus.get(name)??[])handler(value);}},
        sendMessage(){},getAllTools:()=>[],getActiveTools:()=>[]};
    api.installContextPolicy(pi,row=>rows.push(row));
    // The captured package: narration-craft's "Establishing a place" is situational with `before_apply:move` (§203).
    const capsule={turn:{number:30,player_text:'I pay, take the streetcar back to last night\'s street and circle the house.'},recent:[],
        where:{scene:'rooming-house',clock:{at:'1920-10-13T11:32'}},present:[],
        mods:{instructions:[{mod:'narration-craft',version:'2.6.0',form:'indexed',index_contract_version:2,instruction:'Core.',
            sections:[{key:'narration-craft@2.6.0#6',heading:'Establishing a place',gates_open:true,topics:[],gates:[],triggers:['state:establish','before_apply:move'],
                applicability:{what:'Arriving somewhere.',not_for:'Staying put.',examples:[]}}]}]}};
    if(instruction)capsule.mods.instructions=[instruction];
    const binding={version:1,campaign:'game',worldline:'main',loop:0,turn:30,source_revision:'a'.repeat(64)};
    const reads=[];
    pi.events.emit('coc:kernel-bridge',{campaign:'game',call:async(method,args)=>{
        if(method==='mods.sections'){reads.push(...args.keys);return{sections:args.keys.map(key=>({key,text:instruction?.sections.find(section=>section.key===key)?.text??'Open on what the place does to arrivals.'}))};}
        if(method==='table.capsule')return{...capsule,_context:binding};
        if(method==='table.untold')return{};
        return{cards:[],_snapshot:'fixture'};
    }});
    pi.events.emit('coc:capsule',{capsule,context:binding,epoch:'input-30'});
    const messages=[{role:'user',content:[{type:'text',text:capsule.turn.player_text}],timestamp:1},
        {role:'custom',customType:'coc-capsule',content:JSON.stringify(capsule),details:{context:binding,epoch:'input-30'},timestamp:2}];
    const ctx={model:{contextWindow:500000},getContextUsage:()=>({percent:1}),
        sessionManager:{getBranch:()=>[],buildSessionProjection:()=>({messages:[{role:'system',content:'Keeper core.',timestamp:0},...messages]})}};
    /**
     * The Keeper's request of the turn. Its section packet did not reach the provider payload, so §228.2 withdraws it and
     * the section is still undelivered when the Keeper writes (the case §228.3's attachment exists for).
     */
    const keeperRequest=async()=>{
        const out=await hooks.get('context')({messages},ctx);
        assert.ok(out.messages.some(m=>m.customType==='coc-mod-sections'),'the request prepared the section packet');
        hooks.get('before_provider_request')({payload:{input:out.messages.filter(m=>m.customType!=='coc-mod-sections')}});
        assert.ok(rows.some(row=>row.lane==='mod-discovery'&&row.event==='delivered'&&row.delivered===false));
    };
    return {hooks,rows,reads,keeperRequest,emit:pi.events.emit};
}
const move={effects:[{kind:'move',to:'neighborhood-gossip'}]};
/** One write through the tool_call and tool_result hooks, as Pi runs them; returns the verdict and any attached detail. */
async function write(hooks,toolCallId){
    const verdict=await hooks.get('tool_call')({toolName:'apply',toolCallId,input:move});
    const content=[{type:'text',text:'Moved.'}];
    const patched=await hooks.get('tool_result')({toolName:'apply',toolCallId,input:move,content,details:{},isError:false});
    if(patched)assert.deepEqual(patched.content.slice(0,-1),content,'the result itself is kept as it was');
    return{verdict,detail:patched?JSON.parse(patched.content.at(-1).text):undefined};
}
const establishing=[{package:'narration-craft',section:'Establishing a place',version:'2.6.0',text:'Open on what the place does to arrivals.'}];

test('§215/§228.3 a policy clerk write is not held and gets nothing attached; the Keeper\'s own write is not held and gets the section on its result',async()=>{
    const {hooks,rows,reads,keeperRequest,emit}=install();
    const origins=new Map([['clerk:run-30:s4/op1',{origin:'policy',run:'run-30',step:'run-30:s4',clerk:'declared_bookkeeping'}]]);
    emit('coc:operation-dispatcher',Object.freeze({dispatch:async()=>{throw Error('unused');},hostOrigin:id=>origins.get(id)}));
    // The clerk runs before the turn's first Keeper request, as in the evidence: nothing has been delivered yet.
    const clerk=await write(hooks,'clerk:run-30:s4/op1');
    assert.equal(clerk.verdict,undefined,'the declared move reaches admission and the kernel');
    assert.equal(clerk.detail,undefined,'nothing is attached to a policy clerk\'s result');
    const deferred=rows.find(row=>row.lane==='mod-discovery'&&row.event==='readiness_deferred');
    assert.deepEqual(deferred?.keys,['narration-craft@2.6.0#6'],'the section the write made due is recorded for the Keeper\'s request');
    assert.equal(deferred.origin,'policy');
    assert.equal(rows.some(row=>row.lane==='turn-disclosure'),false,'the clerk owes the Keeper nothing');
    assert.deepEqual(reads,[],'no section text is read for the clerk');
    // The same move from the Keeper, after its request went out without the section: not held (§228.3), and the section
    // rides on its own result instead of a re-decision.
    await keeperRequest();
    const keeper=await write(hooks,'call-keeper-1|fc_1');
    assert.equal(keeper.verdict,undefined,'the Keeper\'s write is not held');
    assert.equal(keeper.detail?.kind,'disclosed_detail');assert.match(keeper.detail.authority,/not redone/);
    assert.deepEqual(keeper.detail.package_sections,establishing);
    assert.equal(keeper.detail.capability_detail,undefined);
    assert.ok(rows.some(row=>row.lane==='turn-disclosure'&&row.event==='owed'&&row.no_hold===true));
    assert.equal(rows.some(row=>row.event==='readiness_expansion'||row.event==='write_held'),false,'no hold of any kind');
    // Once per input: the Keeper's next move carries nothing more.
    const again=await write(hooks,'call-keeper-2|fc_2');
    assert.equal(again.verdict,undefined);assert.equal(again.detail,undefined);
});

// §228.3: without a gateway port no call can be shown to be a policy clerk's, so each is treated as the Keeper's own:
// it is not held, and the section it used undelivered is attached to its result.
test('§215/§228.3 without a gateway port a call is treated as the Keeper\'s: not held, the section attached to its result',async()=>{
    const {hooks,rows,keeperRequest}=install();
    await keeperRequest();
    const call=await write(hooks,'clerk:run-30:s4/op1');
    assert.equal(call.verdict,undefined);
    assert.deepEqual(call.detail?.package_sections,establishing);
    assert.equal(rows.some(row=>row.event==='readiness_deferred'),false,'nothing is recorded as a policy write');
});

// §228.3: a Keeper write can arrive before any request of its input was prepared (a degraded first request). The
// tool_call learns the package index from the capsule, and the ledger keeps what the input owed before its first request.
test('§228.3 a Keeper write before any prepared request of the input still gets the section on its result',
    async()=>{
    const {hooks}=install();
    const call=await write(hooks,'call-keeper-0|fc_0');
    assert.equal(call.verdict,undefined);
    assert.deepEqual(call.detail?.package_sections,establishing);
});

test('a failed ordinary expense receives the shipped place service guidance without a location call',async()=>{
    const path=join(root,'mods/enhanced-locations');
    const manifest=JSON.parse(await readFile(join(path,'mod.json'),'utf8'));
    const sections=api.parseSections(manifest,JSON.parse(await readFile(join(path,'sections.json'),'utf8')),await readFile(join(path,'agent.md'),'utf8'));
    const instruction={mod:manifest.id,version:manifest.version,form:'indexed',index_contract_version:2,instruction:'Core.',
        sections:sections.map((section,index)=>({...section,key:`${manifest.id}@${manifest.version}#${index}`,gates_open:true,topics:[],gates:[]}))};
    const {hooks,reads}=install(instruction),input={effects:[{kind:'cash',mode:'settle',category:'living',items:[{name:'Soup',quantity:1,unit_price:.2}]}]};
    assert.equal(await hooks.get('tool_call')({toolName:'apply',toolCallId:'service-expense',input}),undefined);
    const content=[{type:'text',text:'needs: The service has not yet completed.'}];
    const patched=await hooks.get('tool_result')({toolName:'apply',toolCallId:'service-expense',input,content,details:{},isError:true});
    assert.deepEqual(patched?.content.slice(0,-1),content,'the original refusal remains intact');
    const detail=JSON.parse(patched.content.at(-1).text);
    const delivered=detail.package_sections.find(section=>section.package===manifest.id&&section.section==='Continuity and authority');
    assert(delivered,'ordinary cash use must disclose the active place service instructions');
    assert.match(delivered.text,/actual delivery with item gain before consumption loss/);
    assert.equal(reads.length,1,'unrelated place and author sections are not loaded for this expense');
});
