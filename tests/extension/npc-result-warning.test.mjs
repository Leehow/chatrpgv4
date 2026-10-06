/** Existing intention -> canonical warning -> Keeper capsule -> explicit result; contract replay, no model. */
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';
const root=resolve(import.meta.dirname,'../..'),campaign='npc-result-warning';
const undertaking='Ask the caretaker to provide an answer to the visitor.';
let api,bundle;
before(async()=>{
    await mkdir(join(root,'.tmp'),{recursive:true});bundle=await mkdtemp(join(root,'.tmp/npc-result-warning-'));
    await build({stdin:{contents:[
        "export {capsuleWarnings,fitPresent} from './kernel-ts/read/assemble.ts';",
        "export {createKernelContext} from './kernel-ts/context.ts';",
        "export {createKernelRuntime} from './kernel-ts/registry.ts';",
        "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';"
    ].join('\n'),resolveDir:root,sourcefile:'npc-result-warning-entry.ts'},outfile:join(bundle,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
    api=await import(pathToFileURL(join(bundle,'api.mjs')).href);
});
after(async()=>{if(bundle)await rm(bundle,{recursive:true,force:true});});
test('a canonical owed-result warning retains its executable identity when the present budget cuts intent rows',()=>{
    const ref='intent:steven-knott:0123456789ab',warning={lane:'intents',kind:'intent_result_owed',ref,npc:'steven-knott',quote:null,
        why:'Steven Knott started an undertaking and this delivery recorded no result.',fix:'Record its result with intent_ref.'};
    const record={turn:2,closed_by:'narrate',warnings:[warning]},projected=api.capsuleWarnings([record],record,3);
    const present=[{name:'Steven Knott',kind:'person',description:'x'.repeat(4000),history:{intents:[{ref,status:'attempted',intent:undertaking}]}}];
    assert.equal(api.fitPresent(present,3072),true);assert.deepEqual(present[0].history.intents,[]);
    assert.equal(projected[0].ref,ref,'the warning must keep the canonical handle needed for settlement');
    assert.equal(projected[0].npc,'steven-knott','the named owner enables a bounded NPC read when its card was cut');
    assert.equal(projected[0].kind,'intent_result_owed');
});
test('the real one-pass delivery warning reaches the next input and its original intent can fail without being restarted',async()=>{
    const home=playtestScratch('npc-result-warning-contract'),kernel=await api.createKernelContext({workspace:home,content:join(root,'content'),locks:api.nativeAdvisoryLocks(),seed:'npc-result-warning',
        env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}),runtime=api.createKernelRuntime(kernel);
    const call=(method,params={})=>runtime.handlers[method]({campaign,...params});
    try{
        await call('campaign.create',{id:campaign,module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});await call('table.open');
        await call('table.narrate',{call_id:'t0-c1',text:'The visitor speaks with Knott in the office.'});
        await call('table.player_input',{text:'I ask him to request an answer from the caretaker.'});
        await call('table.apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',intends:undertaking,outcome:'attempted'}]});
        await call('table.narrate',{call_id:'t1-c2',text:'Knott undertakes to ask. There is no answer yet.'});
        await call('table.player_input',{text:'I remain here and ask whether he has an answer.'});
        await call('table.narrate',{call_id:'t2-c1',text:'No answer has arrived. The visitor remains in the office.'});
        const saved=JSON.parse(await readFile(join(home,'.coc/campaigns',campaign,'turns/0002.json'),'utf8'));
        const raw=saved.warnings.find(value=>value.kind==='intent_result_owed');assert.ok(raw?.ref);
        await call('table.player_input',{text:'I ask him to say whether that request can be fulfilled.'});
        const capsule=await call('table.capsule'),warning=capsule.warnings.find(value=>value.kind==='intent_result_owed');
        if(process.env.JEV04_NPC_WARNING_REPORT)await writeFile(process.env.JEV04_NPC_WARNING_REPORT,JSON.stringify({kind:'npc-result-warning-contract',live_play:false,model_calls:0,raw_warning:raw,projected_warning:warning},null,2)+'\n');
        assert.equal(warning.ref,raw.ref);assert.equal(warning.npc,'steven-knott');
        const view=await call('table.view');assert.equal(JSON.stringify(view).includes(raw.ref),false,'Keeper settlement handles do not enter the player-safe view');
        const person=(await call('table.look',{focus:'npc',name:warning.npc}));
        assert.ok(JSON.stringify(person).includes(warning.ref),'the retained owner gives access to the existing full intent');
        await call('table.apply',{call_id:'t3-c1',effects:[{kind:'npc',name:warning.npc,intent_ref:warning.ref,outcome:'failed',why:'The caretaker declined this request.'}]});
        const status=await call('table.status'),result=status.receipts.find(value=>value.intent?.ref===raw.ref);
        assert.equal(result.intent.outcome,'failed');
        await call('table.narrate',{call_id:'t3-c2',text:'Knott reports that the caretaker declined the request. This attempt has ended.'});
        await call('table.player_input',{text:'I consider a different source of information.'});
        const after=await call('table.capsule');assert.equal(after.warnings.some(value=>value.kind==='intent_result_owed'&&value.ref===raw.ref),false);
        const intent=after.present.find(value=>value.name==='Steven Knott').history.intents.find(value=>value.ref===raw.ref);
        assert.equal(intent.status,'failed');
        if(process.env.JEV04_NPC_WARNING_REPORT)await writeFile(process.env.JEV04_NPC_WARNING_REPORT,JSON.stringify({kind:'npc-result-warning-contract',live_play:false,model_calls:0,raw_warning:raw,projected_warning:warning,
            result_receipt:result,final_status:intent.status,warning_cleared:true,player_safe_view_has_ref:false},null,2)+'\n');
    }finally{await runtime.close();}
});
