/** Contract §247: Quick Settlement's package, its routine packet element and the sole author's routine summary. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Errors} from 'typebox/value';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {turnPacket,turnPacketParameterSchema,compileTurnPacket,TURN_PACKET_PARAMETERS} from '../../runtime/turn-packet-prototype.ts';
import {routineDescription,routineRefusal,ROUTINE_AUTHOR_HEADING} from '../../extensions/kernel/routine-summary.ts';
import {writeIsolatedExpression,EXPRESSION_PROFILE} from '../../runtime/isolated-expression.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {RpcClient} from '../integration/support.ts';
import {openTable} from './harness.mjs';
import {offeredTools} from '../../extensions/kernel/lean-apply.ts';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';

const ROOT=resolve(import.meta.dirname,'../..');
const temp=await mkdtemp(join(tmpdir(),'quick-settlement-'));
await symlink(join(ROOT,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:"export * from './kernel-ts/testing/api.ts';",resolveDir:ROOT,sourcefile:'quick-settlement-test.ts'},outfile:join(temp,'api.mjs'),
    bundle:true,packages:'external',format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
test.after(()=>rm(temp,{recursive:true,force:true}));
const manifest=JSON.parse(await readFile(join(ROOT,'mods/quick-settlement/mod.json'),'utf8'));

const routine={acts:['ordered and drank a coffee at the counter','read the newspaper','looked out of the window'],
    ambient:[{target:'the newspaper on the counter',notes:['Regional papers that week led with the heat wave.']},{target:'the street outside the window'}]};
const time={kind:'time',minutes:20,reason:'Coffee, the paper and the window'};
const scene={kind:'scene',service:'open',crowd:'quiet'};

async function kernel(t){
    const home=await mkdtemp(join(temp,'home-'));
    const context=await api.createKernelContext({workspace:home,content:join(ROOT,'content'),seed:'quick-settlement',
        locks:api.createAdvisoryLocks(async()=>{}),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
    const runtime=api.createKernelRuntime(context);t.after(()=>runtime.close());
    const call=(method,args={})=>runtime.handlers[method]({campaign:'qs',...args});
    await call('campaign.create',{id:'qs',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
    return call;
}

test('the shipped package is default on, names the routine capability and keeps its author section out of the Keeper text',async t=>{
    assert.equal(manifest.default_enabled,true);
    assert.ok(manifest.requires.includes('turn.routine-summary.v1')&&manifest.requires.includes('instructions.sections.reference.v1'));
    const call=await kernel(t);
    const capsule=await call('table.capsule',{rehydrate:true});
    assert.deepEqual(capsule.mods.routine_summary,{mod:'quick-settlement',version:manifest.version});
    const row=capsule.mods.instructions.find(entry=>entry.mod==='quick-settlement');
    assert.equal(row.form,'indexed','a reference section keeps the package indexed at any budget');
    for(const heading of ['Chained routine acts'])assert.ok(row.instruction.includes(`## ${heading}\n`),heading);
    assert.ok(!row.instruction.includes(ROUTINE_AUTHOR_HEADING),'the author section never reaches the Keeper');
    const section=row.sections.find(entry=>entry.heading===ROUTINE_AUTHOR_HEADING);
    assert.deepEqual([section.topics,section.gates,section.triggers],[[],[],[]],'a reference section has no automatic selector');
    const loaded=await call('mods.sections',{keys:[section.key]});
    assert.match(loaded.sections[0].text,/^## Routine summary for the author\n/);
    await call('mods.configure',{id:'quick-settlement',enabled:false});
    const off=await call('table.capsule',{rehydrate:true});
    assert.equal(off.mods.routine_summary,undefined,'no package, no routine context');
    assert.ok(!off.mods.instructions.some(entry=>entry.mod==='quick-settlement'));
});

test('the routine element is issued only with the capability and is bounded and closed',()=>{
    const off=turnPacketParameterSchema(false,undefined,undefined,true),on=turnPacketParameterSchema(false,undefined,undefined,true,undefined,false,undefined,true);
    assert.equal(off.properties.routine,undefined);
    assert.deepEqual(Object.keys(off.properties),Object.keys(TURN_PACKET_PARAMETERS.properties),'the inactive wire is the previous packet');
    assert.ok(on.properties.routine);
    const packet={version:4,commands:[time,scene],routine};
    assert.equal(Errors(on,packet).length,0);assert.ok(Errors(off,packet).length);
    assert.throws(()=>turnPacket(JSON.stringify(packet),off),/routine is not issued/);
    assert.deepEqual(turnPacket(JSON.stringify(packet),on).routine,routine);
    assert.deepEqual(turnPacket(JSON.stringify({version:4,commands:[time,scene]}),off).routine,undefined);
    assert.deepEqual(turnPacket(JSON.stringify({...packet,routine:{ambient:[{target:'the window'}]}}),on).routine,{ambient:[{target:'the window'}]},
        'ambient looks alone are a routine summary (live el-v2-20261021b T13)');
    assert.equal(routineRefusal({mods:{routine_summary:{mod:'quick-settlement'}}},{ambient:[{target:'the window'}]},[],false),undefined,'a look alone charges no time');
    for(const bad of [{},{ambient:[]},{acts:[]},{acts:['x'.repeat(121)]},{acts:['a'],ambient:[{target:'t',notes:['1','2','3','4']}]},{acts:['a'],extra:true},
        {acts:['a'],ambient:[{target:'t',fact:'a new clue'}]}])
        assert.throws(()=>turnPacket(JSON.stringify({...packet,routine:bad}),on),/routine/,JSON.stringify(bad));
    assert.deepEqual(compileTurnPacket(turnPacket(JSON.stringify(packet),on)).effects.map(effect=>effect.kind),['time','scene'],'routine compiles to no effect');
});

test('the declared output tool names routine only while the package is active, for every provider format',()=>{
    const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1'};
    const output=routineSummary=>offeredTools(COC_TOOLS,env,{routineSummary}).find(tool=>tool.name==='output').parameters;
    assert.equal(output(false).properties.routine,undefined);assert.equal(output(undefined).properties.routine,undefined);
    assert.deepEqual(output(false),TURN_PACKET_PARAMETERS);
    assert.ok(output(true).properties.routine);
});

test('a routine summary needs the active capability and exactly one time charge for the input',()=>{
    const active={mods:{routine_summary:{mod:'quick-settlement',version:'1.0.0'}}};
    assert.equal(routineRefusal(active,undefined,[],false),undefined);
    assert.equal(routineRefusal({mods:{}},routine,[time],false).reason,'routine_summary_inactive');
    assert.equal(routineRefusal(active,routine,[],false).reason,'routine_time_missing');
    assert.equal(routineRefusal(active,routine,[time,time],false).reason,'routine_time_repeated');
    assert.equal(routineRefusal(active,routine,[],false,1),undefined,'an earlier apply of this input already charged the stretch');
    assert.equal(routineRefusal(active,routine,[time],false,1).reason,'routine_time_repeated');
    assert.equal(routineRefusal(active,routine,[time],false),undefined);
    assert.equal(routineRefusal(active,routine,[],true),undefined,'a host-settled journey already charged this input');
});

const section={key:'quick-settlement@1.0.0#3',mod:'quick-settlement',version:'1.0.0',heading:ROUTINE_AUTHOR_HEADING,text:'ROUTINE_CRAFT_FROM_THE_LOCKED_PACKAGE'};
const capsule={mods:{routine_summary:{mod:'quick-settlement',version:'1.0.0'},instructions:[{mod:'quick-settlement',version:'1.0.0',sections:[{key:section.key,heading:section.heading}]}]}};
test('only the locked provider section is loaded for the author, and a replaced version fails closed',async()=>{
    const read=async keys=>{assert.deepEqual(keys,[section.key]);return {sections:[section]};};
    const selected=await routineDescription(capsule,routine,read);
    assert.deepEqual({acts:selected.acts,ambient:selected.ambient,instruction:selected.instruction},{...routine,instruction:section.text});
    await assert.rejects(()=>routineDescription(capsule,routine,async()=>({sections:[{...section,version:'2.0.0'}]})),/locked routine summary/);
    await assert.rejects(()=>routineDescription({mods:{}},routine,read),/locked routine summary/);
});

test('the sole author gets the routine acts in its packet and the Mod section once in its system prompt',async t=>{
    const home=await mkdtemp(join(temp,'author-'));let calls=0;
    const description=await routineDescription(capsule,routine,async()=>({sections:[section]}));
    const runtime={home,async runTask({request}){
        calls++;assert.equal(request.systemPrompt.split(section.text).length-1,1);assert.ok(!request.brief.includes(section.text));
        const packet=JSON.parse(request.brief);
        assert.deepEqual(packet.decision_context.routine,routine,'acts and ambient only; no instruction, key or provider identity');
        assert.equal(packet.player_input,undefined,'acts reach the author even where the player input is withheld');
        request.onEvent({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'You drink your coffee over the paper.'}});
        const [provider,...name]=EXPRESSION_PROFILE.model.split('/');
        request.onEvent({type:'message_end',message:{role:'assistant',provider,model:name.join('/'),stopReason:'stop',content:[{type:'text',text:'You drink your coffee over the paper.'}]}});
        return {ok:true,ms:1};
    }};
    const text=[];await writeIsolatedExpression({runtime,campaign:'fixture',turn:1,run:'r',language:'en',
        decision:{scene:{name:'Cafe'},clock:{},people:[],responses:[],recent_public:[],routine:description},stream:{push:delta=>text.push(delta)},record:async()=>{}});
    assert.equal(calls,1);assert.equal(text.join(''),'You drink your coffee over the paper.');
});

const ENV={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
    PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
async function nativeTable(t,{enabled,packet}){
    const engine=createHybridEngine({env:ENV,decision:{decide:async batch=>({batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(question=>question.type==='noul'
        ?[question.key,{status:'answered',type:'noul',noul:batch.family==='location-context'||question.key.startsWith('restriction_')?.01:.99}]
        :[question.key,{status:'answered',type:'choice',choice:Object.keys(question.criteria).find(key=>key!=='none')??'none',confidence:.99,probabilities:Object.fromEntries(Object.keys(question.criteria).map(key=>[key,key==='none'?.01:.99]))}])),
        coverage:{required:batch.questions.map(q=>q.key),answered:batch.questions.map(q=>q.key),unknown:[]},issues:[]})}});
    const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,env:ENV,runDriver:engine.runDriver,prepareWorkspace:async workspace=>{
        const client=new RpcClient(workspace);
        try{
            await client.ok('table.open',{campaign:'test-camp'});
            await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'The landlord waits at the office.'});
            if(!enabled)await client.ok('mods.configure',{campaign:'test-camp',id:'quick-settlement',enabled:false});
        }finally{await client.close();}},
        extraExtensions:[{name:'engine',factory:engine.extension}],responses:[fauxAssistantMessage([fauxToolCall('output',packet)],{stopReason:'toolUse'})]});
    t.after(()=>table.dispose());
    return table;
}

test('a native packet with routine acts charges one time and hands the acts and Mod section to the author',async t=>{
    const table=await nativeTable(t,{enabled:true,packet:{version:4,commands:[time,scene],routine}});
    await table.session.prompt('I sit at the counter with a coffee, read the paper and watch the street.');
    const telemetry=table.telemetry();
    assert.deepEqual(telemetry.filter(row=>row.lane==='routine-summary').map(row=>[row.acts,row.ambient,row.time_charges]),[[3,2,1]]);
    const author=telemetry.find(row=>row.lane==='isolated-expression'&&row.event==='written');assert.ok(author,JSON.stringify(telemetry.slice(-6)));
    const task=JSON.parse(await readFile(join(author.attempt,'task.json'),'utf8'));
    assert.deepEqual({acts:task.decision_context.routine.acts,ambient:task.decision_context.routine.ambient},routine);
    assert.equal(task.decision_context.routine.version,manifest.version,'the locked provider section was resolved');
    assert.deepEqual(task.result.outcomes.filter(row=>row.kind==='time').map(row=>row.minutes),[20]);
    assert.ok(!task.result.outcomes.some(row=>['item','cash'].includes(row.kind)),'routine acts leave no item or cash receipt');
});

test('with the Mod off the same packet is refused before execution and nothing is authored',async t=>{
    const table=await nativeTable(t,{enabled:false,packet:{version:4,commands:[time,scene],routine}});
    await table.session.prompt('I sit at the counter with a coffee, read the paper and watch the street.');
    const telemetry=table.telemetry();
    assert.ok(!telemetry.some(row=>row.lane==='routine-summary'));
    assert.ok(!telemetry.some(row=>row.lane==='turn-packet-prototype'),'no effect was applied');
    assert.ok(!telemetry.some(row=>row.lane==='isolated-expression'&&row.event==='written'),'the undeclared element is refused by the tool schema itself');
});

test('with the Mod off the packet without routine still settles and publishes as before',async t=>{
    const table=await nativeTable(t,{enabled:false,packet:{version:4,commands:[time,scene]}});
    await table.session.prompt('I sit at the counter with a coffee, read the paper and watch the street.');
    const telemetry=table.telemetry();
    assert.ok(!telemetry.some(row=>row.lane==='arguments'&&row.event==='packet_parameters_refused'));
    const author=telemetry.find(row=>row.lane==='isolated-expression'&&row.event==='written');assert.ok(author,JSON.stringify(telemetry.slice(-6)));
    const task=JSON.parse(await readFile(join(author.attempt,'task.json'),'utf8'));
    assert.equal(task.decision_context.routine,undefined);
});
