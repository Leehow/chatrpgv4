import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {getCurrentTools} from '@earendil-works/pi-ai';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'turn-discovery-context-'));
await symlink(join(root,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:[
    "export {installContextPolicy} from './extensions/table/context-runtime.ts';",
    "export {COC_TOOLS} from './extensions/kernel/tools.ts';",
    "export {offeredTools} from './extensions/kernel/lean-apply.ts';",
    "export {CLERK_TYPE} from './extensions/table/context-policy.ts';",
].join('\n'),resolveDir:root},outfile:join(temp,'api.mjs'),bundle:true,packages:'external',
    format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
test.after(()=>rm(temp,{recursive:true,force:true}));

for(const [denied,seeded,stale,expired,sourceError,hybrid] of [[false,false,false],[true,false,false],[false,true,false],[false,true,true],
    [false,false,false,true,false],[false,false,false,true,true],[false,false,false,true,'foreground'],
    [false,false,false,true,false,true],[false,false,false,true,'foreground',true]])test(
    hybrid?sourceError?'expired hybrid read ownership keeps mutation held':'hybrid optional expiry refreshes without a TaskRuntime reservation port'
    :expired?sourceError==='foreground'?'expired foreground ownership never clears the current write hold':sourceError?'optional expiry never clears a failed current-source write hold':'optional expiry after model time delivers a verified full view without renewing decisions'
        :denied?'discovery shares foreground reservations and falls back before a refused provider dispatch'
        :seeded?stale?'a stale task source cannot seed current capability or package detail':'current host operations seed capability and package detail before inference'
        :'normal context hooks declare the fixed list, disclose due detail once and attach a first unshown instruction to its result',async t=>{
    const envNames=['COC_TURN_DISCOVERY','EXT_JEV_APIKEY','PI_COC_JEV_PRESELECT','PI_COC_JEV_PRESELECT_ALLOWANCE_MS'],old=Object.fromEntries(envNames.map(n=>[n,process.env[n]]));
    process.env.COC_TURN_DISCOVERY='selective';process.env.EXT_JEV_APIKEY='test-only';
    process.env.PI_COC_JEV_PRESELECT='0';if(expired)process.env.PI_COC_JEV_PRESELECT_ALLOWANCE_MS='2000';
    const previousFetch=globalThis.fetch;
    t.after(()=>{globalThis.fetch=previousFetch;for(const name of envNames){if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];}});
    let fetched=0,reserved=0,settled=0,failSource=false;
    globalThis.fetch=async(_url,init)=>{
        fetched++;
        const body=JSON.parse(init.body),cards=body.state.cards;
        assert.equal(body.state.situation.keeper_task,seeded&&!stale?'bind':'adjudicate');
        assert.equal(body.state.situation.task_reason,seeded&&!stale?'clerk_unbound':'check_unresolved');
        assert.deepEqual(body.state.situation.threat_clocks,[{name:'Patience',clock:'pressure',state:'0/4'}]);
        if(seeded&&!stale){assert.equal(body.state.situation.compile.act.row,'purchase');assert.deepEqual(body.state.situation.host_operations[0].needed_fields,['amount','to']);}
        return new Response(JSON.stringify({model:body.model,
            answers:Object.fromEntries(Object.keys(body.questions).map((key,i)=>[key,{type:'noul',
                noul:cards[i].name==='time'||cards[i].name==='pacing: Time'?.99:.01}])),
            usage:{input_tokens:30,output_tokens:0}}),{status:200,headers:{'content-type':'application/json'}});
    };
    const hooks=new Map(),bus=new Map(),rows=[],calls=[];
    const pi={on:(name,handler)=>hooks.set(name,handler),events:{on:(name,handler)=>bus.set(name,handler),
        emit:(name,value)=>bus.get(name)?.(value)},sendMessage(){},
        getAllTools:()=>api.COC_TOOLS,getActiveTools:()=>api.COC_TOOLS.map(t=>t.name).filter(n=>n!=='resolve')};
    api.installContextPolicy(pi,e=>rows.push(e));
    let binding={version:1,campaign:'table',worldline:'main',loop:0,turn:0,source_revision:'a'.repeat(64)};
    const cap={turn:{number:0,player_text:'Wait until nine.'},recent:[],module:{title:'Fixture'},style:{},
        where:{scene:'library',clock:{at:'1920-10-13T03:00'}},present:[],
        mods:{pacing:{threat_clocks:[{threat:'Patience',clock:'pressure',state:'0/4'}]},instructions:[{mod:'pacing',version:'2.0.0',form:'indexed',index_contract_version:2,instruction:'Core rules.',
            sections:[{key:'pacing@2.0.0#0',heading:'Time',gates_open:true,topics:[],gates:[],triggers:['before_apply:time'],
                applicability:{what:'Actual passage of time.',not_for:'Unattempted actions.',examples:[]},dependencies:['time']},
                {key:'pacing@2.0.0#1',heading:'Money',gates_open:true,topics:[],gates:[],triggers:['before_apply:cash'],
                    applicability:{what:'An actual payment.',not_for:'A quote.',examples:[]},dependencies:['cash']}]}]}};
    await hooks.get('session_start')();
    bus.get('coc:kernel-bridge')({campaign:'table',call:async(method,args)=>{
        calls.push(method);
        if(method==='table.capsule'){if(failSource)throw Error('imported_SQL_unavailable');return{...cap,_context:binding};}
        if(method==='table.untold')return{};
        if(method==='mods.sections')return{sections:args.keys.map(key=>({key,text:'Immutable '+key}))};
        return{cards:[],_snapshot:'fixture'};
    }});
    bus.get('coc:loop-engine')({engine:'hybrid-v1',prescreen:'run'});
    bus.get('coc:capsule')({capsule:cap,context:binding,epoch:'input-1'});
    if(seeded)bus.get('coc:discovery-task')({campaign:'table',worldline:'main',loop:0,turn:0,
        source_revision:stale?'b'.repeat(64):binding.source_revision,run:'fixture-run',
        task:{purpose:'bind',reason:'clerk_unbound',features:{act:{row:'purchase',cleared:true}},
            operations:[{verb:'apply',family:'cash',bound:{amount:20,currency:'USD',to:'here'},needs:['amount',{name:'to'}]}]}});
    const lifetime=new AbortController();let foregroundDeadline=Date.now()+20000;
    if(hybrid)bus.get('coc:discovery-read-owner')(()=>({signal:lifetime.signal,deadlineAt:foregroundDeadline}));
    else bus.get('coc:task-provider-budget')(()=>({signal:lifetime.signal,deadlineAt:foregroundDeadline,
        reserve:async bound=>{
            reserved++;assert.equal(bound.model.provider,'typesafe');assert.ok(bound.inputTokens>0);
            if(denied)throw Error('foreground_test_refusal');
            return{settle:()=>{settled++;},release:()=>{}};
        }}));
    const declared=api.offeredTools(api.COC_TOOLS,{}).filter(t=>t.name!=='resolve')
        .map(({name,description,parameters})=>({name,description,parameters}));
    const messages=[{role:'system',content:'Keeper core.',toolsAdded:declared,timestamp:0},
        {role:'user',content:[{type:'text',text:'Wait until nine.'}],timestamp:1},
        {role:'custom',customType:'coc-capsule',content:JSON.stringify(cap),
            details:{context:binding,epoch:'input-1'},timestamp:2},
        {role:'custom',customType:api.CLERK_TYPE,content:JSON.stringify({kind:'single_loop_step',purpose:'adjudicate',reason:'check_unresolved',
            native_search_scope:{run:'fixture-native-run',step:'fixture-native-step'}}),
            details:{coc_host:true,turn:0},timestamp:3}];
    const original=JSON.stringify(messages);
    const ctx={model:{contextWindow:500000},getContextUsage:()=>({percent:1}),
        sessionManager:{getBranch:()=>[],buildSessionProjection:()=>({messages})}};
    const outgoing=await hooks.get('context')({messages:messages.filter(m=>m.role!=='system')},ctx);
    const withSystem=hooks.get('context_with_system')({messages:[messages[0],...outgoing.messages]},ctx);
    const projected=withSystem?.messages??[messages[0],...outgoing.messages];
    const tools=getCurrentTools(projected);
    const nativeNote=projected.find(message=>message.customType===api.CLERK_TYPE);
    assert.deepEqual(JSON.parse(nativeNote.content).native_search_scope,{run:'fixture-native-run',step:'fixture-native-step'});
    const apply=tools.find(t=>t.name==='apply');
    // §227.1: one fixed list in every branch: canonical declarations, apply as a kind envelope.
    assert.deepEqual(tools.map(t=>t.name),declared.map(t=>t.name));
    assert.equal(apply.parameters.properties.effects.items.anyOf,undefined);
    assert.deepEqual(apply.parameters.properties.effects.items.properties.kind.enum,
        declared.find(t=>t.name==='apply').parameters.properties.effects.items.anyOf.map(v=>v.properties.kind.enum?.[0]??v.properties.kind.const));
    const detailNames=list=>new Set(list.filter(m=>m.customType==='coc-capability-detail').flatMap(m=>JSON.parse(m.content).capabilities.map(c=>c.name)));
    const sectionNames=list=>list.filter(m=>m.customType==='coc-mod-sections').flatMap(m=>JSON.parse(m.content).sections.map(s=>s.section));
    if(expired){
        hooks.get('before_provider_request')({payload:{input:outgoing.messages,tools}});
        const before=fetched;
        await new Promise(resolve=>setTimeout(resolve,2100));
        cap.where.clock.at='1920-10-13T09:00';binding={...binding,task_world_revision:'world-2'};
        await hooks.get('tool_call')({toolName:'apply',toolCallId:'expiry-change',input:{effects:[{kind:'time',minutes:360}]}});
        await hooks.get('tool_result')({toolName:'apply',toolCallId:'expiry-change',input:{effects:[{kind:'time',minutes:360}]},isError:false,details:{}});
        failSource=sourceError===true;if(sourceError==='foreground')foregroundDeadline=Date.now()-1;
        const refreshed=await hooks.get('context')({messages:messages.filter(m=>m.role!=='system')},ctx);
        const full=hooks.get('context_with_system')({messages:[messages[0],...refreshed.messages]},ctx);
        const final=full?.messages??[messages[0],...refreshed.messages];
        const finalTools=getCurrentTools(final);
        assert.equal(fetched,before,'elapsed model time must not renew optional Jev decisions');
        assert.ok(rows.some(r=>r.event==='discovery_fallback'&&r.reason==='preparation_expired'));
        assert.equal(JSON.stringify(finalTools),JSON.stringify(tools),'the expired input keeps the same list');
        hooks.get('before_provider_request')({payload:{input:refreshed.messages,tools:finalTools}});
        const hold=await hooks.get('tool_call')({toolName:'apply',toolCallId:'after-expiry',input:{effects:[{kind:'cash',amount:20,currency:'USD',to:'here'}]}});
        if(sourceError){assert.equal(hold.block,true);assert.match(hold.reason,/no world change was committed/i);}
        else{
            assert.equal(hold,undefined);
            const current=refreshed.messages.find(m=>m.customType==='coc-capsule-update');
            assert.equal(JSON.parse(current.content).sections.where.clock.at,'1920-10-13T09:00');
            assert.deepEqual(new Set(sectionNames(refreshed.messages)),new Set(['Time','Money']),'the whole current instruction view was delivered, each section once');
            assert.equal(sectionNames(refreshed.messages).length,2);
            assert.ok(rows.some(r=>r.lane==='mod-discovery'&&r.event==='prepared'&&r.reason==='forced_full'));
        }
    }else if(denied){
        assert.equal(fetched,0);assert.ok(reserved>=2);
        assert.equal(tools.length,declared.length);
        assert.equal(sectionNames(outgoing.messages).length,2);
        assert.deepEqual(detailNames(outgoing.messages),new Set(['time','cash']),'delivered sections make their dependencies due');
        assert.ok(rows.some(r=>r.lane==='capability-discovery'&&r.event==='fallback'));
        assert.ok(rows.some(r=>r.lane==='mod-discovery'&&r.event==='selection'&&r.status==='full'&&r.reason));
    }else if(seeded&&!stale){
        assert.deepEqual(detailNames(outgoing.messages),new Set(['time','cash']));
        assert.deepEqual(new Set(sectionNames(outgoing.messages)),new Set(['Time','Money']));
        hooks.get('before_provider_request')({payload:{input:outgoing.messages,tools}});
        assert.equal(await hooks.get('tool_call')({toolName:'apply',toolCallId:'seeded-call',
            input:{effects:[{kind:'cash',amount:20,currency:'USD',to:'here'}]}}),undefined);
        assert.equal(reserved,fetched);assert.equal(settled,fetched);
        const before=fetched;
        cap.where.clock.at='1920-10-13T09:00';
        await hooks.get('tool_result')({toolName:'apply',toolCallId:'seeded-call',input:{effects:[{kind:'cash',amount:20,currency:'USD',to:'here'}]},
            isError:false,content:[{type:'text',text:'Committed.'}],details:{}});
        const refreshed=await hooks.get('context')({messages:messages.filter(m=>m.role!=='system')},ctx);
        const sent=refreshed.messages.find(m=>m.customType==='coc-capsule-update');
        assert.equal(JSON.parse(sent.content).sections.where.clock.at,'1920-10-13T09:00');
        assert.ok(fetched>before,'selective context refreshes current facts even with prescreen and workspace off');
    }else{
    assert.deepEqual(detailNames(outgoing.messages),new Set(['time']));
    assert.deepEqual(sectionNames(outgoing.messages),['Time']);
    hooks.get('before_provider_request')({payload:{input:outgoing.messages,tools}});
    assert.ok(rows.some(r=>r.lane==='mod-discovery'&&r.event==='delivered'&&r.delivered));
    // §227.3: the unshown Money section and cash detail never hold the write; they ride on its result, once.
    const effects=[{kind:'cash',amount:20,currency:'USD',to:'here'}];
    assert.equal(await hooks.get('tool_call')({toolName:'apply',toolCallId:'fixture-call',input:{effects}}),undefined);
    const attached=await hooks.get('tool_result')({toolName:'apply',toolCallId:'fixture-call',input:{effects},
        isError:true,content:[{type:'text',text:'Refused for another reason.'}],details:{}});
    const extra=JSON.parse(attached.content.at(-1).text);
    assert.equal(attached.content[0].text,'Refused for another reason.');
    assert.equal(extra.kind,'disclosed_detail');
    assert.deepEqual(extra.package_sections.map(s=>s.section),['Money']);
    assert.deepEqual(extra.capability_detail.map(c=>c.name),['cash']);
    assert.equal(await hooks.get('tool_call')({toolName:'apply',toolCallId:'fixture-call-2',input:{effects}}),undefined);
    assert.equal(await hooks.get('tool_result')({toolName:'apply',toolCallId:'fixture-call-2',input:{effects},
        isError:false,content:[{type:'text',text:'Committed.'}],details:{}}),undefined,'attached once per input');
    const next=await hooks.get('context')({messages:messages.filter(m=>m.role!=='system')},ctx);
    assert.equal(sectionNames(next.messages).filter(name=>name==='Money').length,0,'an attached section is not re-sent');
    assert.deepEqual(sectionNames(next.messages),['Time'],'the first disclosure stays in place');
    assert.equal(reserved,fetched);assert.equal(settled,fetched);
    }
    const measured=rows.find(r=>r.event==='request_projection');
    assert.equal(measured.projected_request_bytes,Buffer.byteLength(JSON.stringify(projected)));
    assert.equal(measured.tool_schema_bytes,Buffer.byteLength(JSON.stringify(tools)));
    assert.ok(measured.tool_schema_bytes<measured.canonical_tool_schema_bytes);
    assert.ok(!calls.includes('table.apply'));
    assert.equal(JSON.stringify(messages),original);
    await hooks.get('session_shutdown')();
});
