/** §209: real SQL metadata -> task identity -> asynchronous host selection -> request delivery. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {spawn} from 'node:child_process';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'discovery-sqlite-'));
await symlink(join(root,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:[
    "export {SourceState} from './kernel-ts/modules/source-state.ts';",
    "export {sourceMetadata} from './runtime/source-metadata.ts';",
    "export {sourceRevision} from './kernel-ts/read/context.ts';",
    "export {installContextPolicy} from './extensions/table/context-runtime.ts';",
    "export {COC_TOOLS} from './extensions/kernel/tools.ts';",
    "export {offeredTools} from './extensions/kernel/lean-apply.ts';",
    "export {DIAGNOSTIC_TYPE} from './extensions/table/context-policy.ts';",
].join('\n'),resolveDir:root},outfile:join(temp,'api.mjs'),bundle:true,packages:'external',
    format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
await build({stdin:{contents:"export {sourceMetadata} from './runtime/source-metadata.ts';",resolveDir:root},
    outfile:join(temp,'metadata-reader.mjs'),bundle:true,packages:'external',format:'esm',platform:'node',logLevel:'silent'});
test.after(()=>rm(temp,{recursive:true,force:true}));

for(const mode of ['queue','publish','sql_error','deadline','locked_sql'])test('SQL discovery binding: '+mode,async t=>{
    const envNames=['COC_TURN_DISCOVERY','EXT_JEV_APIKEY','PI_COC_JEV_PRESELECT'];
    const old=Object.fromEntries(envNames.map(n=>[n,process.env[n]])),previousFetch=globalThis.fetch;
    process.env.COC_TURN_DISCOVERY='selective';process.env.EXT_JEV_APIKEY='test-only';process.env.PI_COC_JEV_PRESELECT='0';
    t.after(()=>{globalThis.fetch=previousFetch;for(const n of envNames){if(old[n]===undefined)delete process.env[n];else process.env[n]=old[n];}});
    const stateRoot=join(temp,mode,'.coc'),directory=join(stateRoot,'modules','book'),other=join(stateRoot,'modules','other');
    for(const [path,id] of [[directory,'book'],[other,'other']]){
        await mkdir(path,{recursive:true});
        await writeFile(join(path,'module.json'),JSON.stringify({id,title:'Original',source_generation:3,reading:{status:'queued'}}));
        await writeFile(join(path,'deepen-queue.json'),JSON.stringify([{job_id:'read-1',state:'queued'}]));
    }
    const state=new api.SourceState(stateRoot);t.after(()=>state.close());
    await state.snapshot(directory);await state.snapshot(other);
    const capsule={turn:{number:0,player_text:'Wait until nine.'},recent:[],module:{title:'Fixture'},style:{},
        where:{scene:'library',clock:{at:'1920-10-13T03:00'}},present:[],
        mods:{active:[{id:'pacing'}],instructions:[{mod:'pacing',version:'2.0.0',index_contract_version:2,form:'indexed',instruction:'Core.',
            sections:[{key:'pacing@2.0.0#0',heading:'Time',gates_open:true,triggers:[],dependencies:['time'],
                applicability:{what:'Time actually passes.',not_for:'Unchosen future actions.',examples:[]}}]}]}};
    const campaign={id:'table',world:{mods:{active:{pacing:{version:'2.0.0'}}}},meta:{play_language:'en',register:'ordinary'},
        context:{content:root+'/content',snapshots:{sortedChildNames:async()=>[]}}};
    const binding=async()=>{
        const meta=await api.sourceMetadata(directory);
        const revision=await api.sourceRevision(campaign,{meta,generation:meta.source_generation,graph:{digest:'fixed-test-graph'}},capsule);
        return{version:1,campaign:'table',worldline:'main',loop:0,turn:0,task_world_revision:'world-0',...revision};
    };
    const original=await binding(),hooks=new Map(),bus=new Map(),events=[];
    let changed=false,fetches=0,reads=0,releaseRead,locker,reader,sqlStarted=false;
    const heldRead=new Promise(resolve=>{releaseRead=resolve;});
    globalThis.fetch=async(_url,init)=>{
        fetches++;
        if(!changed){
            changed=true;
            const snapshot=await state.snapshot(directory);
            if(mode==='queue'){
                await state.update(directory,{metadata:{...snapshot.metadata,reading:{status:'completed'},updated_at:'later'},
                    jobs:[{job_id:'read-1',state:'completed'}]});
                const otherSnapshot=await state.snapshot(other);
                await state.update(other,{metadata:{...otherSnapshot.metadata,title:'Other scope changed'}});
                // A short peer write plus a truncating checkpoint detects a pinned SQL snapshot during the model call.
                const peer=new DatabaseSync(join(stateRoot,'source-reading.sqlite'));
                try{peer.exec('PRAGMA busy_timeout=50; BEGIN IMMEDIATE; UPDATE source_exports SET error=NULL; COMMIT;');
                    const checkpoint=peer.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
                    assert.equal(checkpoint.busy,0);assert.equal(checkpoint.log,0);
                }finally{peer.close();}
                const now=await binding();
                assert.notEqual(now.source_revision,original.source_revision);
                assert.equal(now.task_source_revision,original.task_source_revision);
            }else if(mode==='publish')await state.update(directory,{metadata:{...snapshot.metadata,source_generation:4,title:'Published update'}});
            else if(mode==='sql_error'){
                // The valid legacy JSON cannot rescue an imported SQL scope with corrupt authoritative metadata.
                const peer=new DatabaseSync(join(stateRoot,'source-reading.sqlite'));
                try{peer.exec("UPDATE source_modules SET payload='broken' WHERE scope='modules/book';");}finally{peer.close();}
                await assert.rejects(api.sourceMetadata(directory));
            }
        }
        const body=JSON.parse(init.body);
        return new Response(JSON.stringify({model:body.model,answers:Object.fromEntries(Object.keys(body.questions).map((key,i)=>
            [key,{type:'noul',noul:['time','pacing: Time'].includes(body.state.cards[i].name)?.99:.01}])),
            usage:{input_tokens:30,output_tokens:0}}),{status:200,headers:{'content-type':'application/json'}});
    };
    const pi={on:(name,handler)=>hooks.set(name,handler),events:{on:(name,handler)=>bus.set(name,handler),
        emit:(name,value)=>bus.get(name)?.(value)},sendMessage(){},getAllTools:()=>api.COC_TOOLS,
        getActiveTools:()=>api.COC_TOOLS.map(tool=>tool.name).filter(name=>name!=='resolve')};
    api.installContextPolicy(pi,row=>events.push(row));await hooks.get('session_start')();
    bus.get('coc:kernel-bridge')({campaign:'table',call:async(method,args)=>{
        if(method==='table.capsule'){
            reads++;if(mode==='deadline')await heldRead;
            if(mode==='locked_sql')await new Promise((resolveRead,rejectRead)=>{
                reader=spawn(process.execPath,['--input-type=module','-e',
                    "const api=await import(process.argv[1]); process.send({ready:true}); await api.sourceMetadata(process.argv[2]);",
                    pathToFileURL(join(temp,'metadata-reader.mjs')).href,directory],{stdio:['ignore','ignore','pipe','ipc']});
                reader.on('message',message=>{if(message.ready)sqlStarted=true;});
                reader.on('error',rejectRead);reader.on('exit',code=>code===0?resolveRead():rejectRead(Error('SQL reader exited '+code)));
            });
            return{...capsule,_context:await binding()};
        }
        if(method==='table.untold')return{};
        if(method==='mods.sections')return{sections:args.keys.map(key=>({key,text:'Immutable time instructions.'}))};
        return{cards:[],_snapshot:'fixture'};
    }});
    bus.get('coc:loop-engine')({engine:'hybrid-v1',prescreen:'run'});
    bus.get('coc:capsule')({capsule,context:original,epoch:'input-1'});
    if(mode==='locked_sql'){
        state.close();locker=new DatabaseSync(join(stateRoot,'source-reading.sqlite'));
        locker.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE;');
        t.after(()=>{try{locker.exec('ROLLBACK');locker.close();}catch{}if(reader?.exitCode===null)reader.kill('SIGTERM');});
    }
    if(['deadline','locked_sql'].includes(mode))bus.get('coc:task-provider-budget')(()=>({signal:new AbortController().signal,
        deadlineAt:Date.now()+(mode==='locked_sql'?300:80),reserve:async()=>({settle(){},release(){}})}));
    const messages=[{role:'user',content:[{type:'text',text:'Wait until nine.'}],timestamp:1},
        {role:'custom',customType:'coc-capsule',content:JSON.stringify(capsule),details:{context:original,epoch:'input-1'},timestamp:2}];
    const tools=api.offeredTools(api.COC_TOOLS,{}).filter(tool=>tool.name!=='resolve'),system={role:'system',content:'Core.',toolsAdded:tools,timestamp:0};
    const ctx={model:{contextWindow:500000},sessionManager:{getBranch:()=>[],buildSessionProjection:()=>({messages:[system,...messages]})}};
    const began=Date.now(),out=await hooks.get('context')({messages},ctx);
    if(mode==='queue'){
        assert.ok(out.messages.some(message=>message.customType==='coc-mod-sections'));
        assert.ok(events.some(row=>row.event==='discovery_snapshot'&&row.status==='current'));
        assert.ok(fetches>0);
    }else{
        assert.ok(!out.messages.some(message=>message.customType==='coc-mod-sections'));
        assert.ok(!out.messages.some(message=>message.customType==='coc-capsule'));
        assert.ok(out.messages.some(message=>message.customType===api.DIAGNOSTIC_TYPE));
        assert.ok(out.messages.some(message=>message.role==='user'));
        const hold=await hooks.get('tool_call')({toolName:'apply',toolCallId:'unverified-write',input:{effects:[{kind:'time',minutes:60}]}});
        assert.equal(hold.block,true);assert.match(hold.reason,/No world change was committed/);
        assert.equal(hooks.get('context_with_system')({messages:[system,...out.messages]},ctx),undefined);
        if(['deadline','locked_sql'].includes(mode)){
            assert.ok(Date.now()-began<1500,'the host deadline bounds a pending source read');assert.equal(fetches,0);
            const before=events.filter(row=>row.event==='prepared').length;
            if(mode==='locked_sql'){
                assert.ok(sqlStarted,'the real SQL reader reached the locked scope before the deadline');
                assert.equal(reader.exitCode,null,'SQL is still waiting when the host returns');
                locker.exec('ROLLBACK');locker.close();
                await new Promise(resolve=>reader.once('exit',resolve));
            }else releaseRead();
            await new Promise(resolve=>setTimeout(resolve,25));
            assert.equal(events.filter(row=>row.event==='prepared').length,before,'late hydration cannot populate the invalidated cache');
            const count=reads;await hooks.get('context')({messages},ctx);assert.equal(reads,count,'the same spent allowance does not start another read');
        }else assert.ok(events.some(row=>row.event==='discovery_snapshot'&&row.status==='unavailable'));
    }
    await hooks.get('session_shutdown')();
});
