/** Journal identity references through real kernel jobs and existing privacy validation. No model calls. */
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'../..');let api,bundle;
before(async()=>{
    await mkdir(join(root,'.tmp'),{recursive:true});bundle=await mkdtemp(join(root,'.tmp/journal-reference-'));
    await build({stdin:{contents:[
        "export {buildJob as buildJournalJob,openJob as openJournalJob,readJob as readJournalJob,submit as submitJournal,materializeJournalEntries} from './kernel-ts/journal/jobs.ts';",
        "export {journalSystemPrompt,journalUserInput,shapeJournalEntries} from './extensions/npc-journal/index.ts';",
        "export {createKernelContext} from './kernel-ts/context.ts';",
        "export {createKernelRuntime} from './kernel-ts/registry.ts';",
        "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
        "export {CampaignWriter} from './kernel-ts/write/store.ts';",
        "export {loadCampaignModule} from './kernel-ts/read/campaign.ts';"
    ].join('\n'),resolveDir:root,sourcefile:'journal-reference-entry.ts'},outfile:join(bundle,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
    api=await import(pathToFileURL(join(bundle,'api.mjs')).href);
});
after(async()=>{if(bundle)await rm(bundle,{recursive:true,force:true});});
async function fixture(t,{secondPerson=false}={}){
    const base=join(root,'.coc/playtests/jev-journal-reference-contracts');await mkdir(base,{recursive:true});const home=await mkdtemp(join(base,'suite-'));
    await writeFile(join(home,'classification.json'),JSON.stringify({kind:'contract-fixture',live_play:false,model_calls:0}));
    const kernel=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:'journal-reference',locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}),runtime=api.createKernelRuntime(kernel);
    t.after(()=>runtime.close());const call=(method,params={})=>runtime.handlers[method]({campaign:'c1',...params});
    await call('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});await call('table.open');await call('table.player_input',{text:'I observe the people involved.'});
    if(secondPerson) await call('table.apply',{call_id:'t1-c1',effects:[{kind:'clue',clue:'knott-commission',from:'Walter Corbitt'}]});
    await call('table.narrate',{call_id:'t1-c2',text:'The man behind the desk offers the commission. A letter records another visitor.'});
    const campaign=new api.CampaignWriter(kernel,'c1'),world=await campaign.readWorld(),meta=await campaign.readCampaign(),module=await api.loadCampaignModule(kernel,meta.module_id,world,'c1');
    return {home,kernel,runtime,campaign,world,graph:module.graph,call};
}
const submission=(packet,entries)=>({job_id:packet.job_id,protocol:packet.protocol,selection_binding:packet.selection_binding,entries});

test('host prompts expose aliases and new prose only; invalid selector rows never disappear',()=>{
    const packet={protocol:'journal-reference-v2',selection_binding:'private-binding',job_id:'journal:c1:t1',commit:'private-commit',
        recordable:[{alias:'person:0',name:'A Name'}],present:['person:0'],unnamed:['person:0'],investigators:[{name:'Investigator'}],
        prior:[{person:'person:0',label:'The watcher',description:'A quiet watcher.'}],speech:[{person:'person:0',text:'A complete sentence.'}]};
    const text=api.journalUserInput(packet),system=api.journalSystemPrompt(packet);
    assert.match(text,/person:0/);assert.ok(!text.includes('private-binding'));assert.ok(!text.includes('private-commit'));
    assert.ok(!text.includes('journal:c1:t1'));assert.ok(!system.includes('copied exactly'));assert.match(system,/"person":"person:0"/);
    const good={person:'person:0',label:'The watcher',description:'A quiet watcher.'};
    assert.deepEqual(api.shapeJournalEntries({entries:[good]},packet),[good]);
    for(const bad of [{...good,name:'A Name'},{...good,id:'private-id'},{...good,person:'person:1'},{...good,person:'npc:0'},{...good,named:false}])
        assert.equal(api.shapeJournalEntries({entries:[good,bad]},packet),undefined);
    assert.equal(api.shapeJournalEntries({entries:[good,good]},packet),undefined);
    assert.equal(api.shapeJournalEntries({entries:[good],extra:true},packet),undefined);
});
test('referenced kernel jobs restore exact identity, retain raw aliases, and preserve unnamed-person privacy',async(t)=>{
    const f=await fixture(t),packet=await f.call('journal.job',{turn:1,mode:'referenced'});
    assert.equal(packet.protocol,'journal-reference-v2');assert.deepEqual(packet.recordable,[{alias:'person:0',name:'Steven Knott'}]);
    assert.deepEqual(packet.unnamed,['person:0']);assert.deepEqual(packet.present,['person:0']);
    assert.ok(!JSON.stringify(packet).includes('npc-steven-knott'));assert.ok(!JSON.stringify(packet).includes('selector'));
    const worldBefore=await readFile(join(f.campaign.directory,'world.json'),'utf8');
    for(const entries of [[{person:'person:99',label:'The watcher'}],[{person:'person:0',label:'Steven Knott'}],[{person:'person:0',label:'The watcher'},{person:'person:0',exchange:'Nods.'}],
        [{person:'person:0',name:'Steven Knott',label:'The watcher'}]]) await assert.rejects(f.call('journal.submit',submission(packet,entries)),error=>error.code==='invalid_params');
    await assert.rejects(f.call('journal.submit',{...submission(packet,[{person:'person:0',label:'The watcher'}]),selection_binding:'foreign-binding'}));
    await assert.rejects(f.call('journal.submit',{job_id:packet.job_id,entries:[{person:'person:0',label:'The watcher'}]}));
    const entries=[{person:'person:0',label:'The man at the desk',description:'He speaks quietly.',exchange:'He offers the commission.'}];
    const result=await f.call('journal.submit',submission(packet,entries)),replay=await f.call('journal.submit',submission(packet,entries));
    assert.equal(result.entries,1);assert.equal(replay.replayed,true);
    const stored=await api.readJournalJob(f.campaign,packet.job_id),journal=JSON.parse(await readFile(join(f.campaign.directory,'npc-journal.json'),'utf8'));
    assert.deepEqual(stored.submitted,entries);assert.equal(stored.canonical_submitted[0].name,'Steven Knott');
    assert.equal(journal.entries['npc-steven-knott'].name,'Steven Knott');assert.equal(journal.entries['npc-steven-knott'].named_at,undefined);
    const visible=(await f.call('table.view')).npcs.journal[0];assert.equal(visible.name,'The man at the desk');assert.equal(visible.named,false);
    assert.ok(!JSON.stringify({name:visible.name,description:visible.description,exchanges:visible.exchanges}).includes('Steven Knott'));
    assert.equal(await readFile(join(f.campaign.directory,'world.json'),'utf8'),worldBefore);
});
test('requesting references never rewrites or reinterprets an existing legacy job or its completed artifact',async(t)=>{
    const f=await fixture(t),legacy=await f.call('journal.job',{turn:1}),path=join(f.campaign.directory,'npc-journal/jobs',`${legacy.job_id}.json`),before=await readFile(path,'utf8');
    assert.equal(legacy.protocol,undefined);assert.deepEqual((await f.call('journal.job',{turn:1,mode:'referenced'})),legacy);
    assert.equal(await readFile(path,'utf8'),before);
    const entries=[{name:'Steven Knott',label:'The man at the desk',description:'He speaks quietly.'}];
    await f.call('journal.submit',{job_id:legacy.job_id,entries});const accepted=await readFile(path,'utf8');
    await assert.rejects(f.call('journal.submit',{job_id:legacy.job_id,protocol:'journal-reference-v2',selection_binding:'invented',entries:[{person:'person:0',label:'The watcher'}]}));
    assert.deepEqual(await f.call('journal.job',{turn:1,mode:'referenced'}),legacy);assert.equal(await readFile(path,'utf8'),accepted);
    assert.equal((await f.call('journal.submit',{job_id:legacy.job_id,entries})).replayed,true);
});
test('equal display names retain separate pinned identities without first-name reanchoring',async(t)=>{
    const f=await fixture(t,{secondPerson:true}),graph=new Proxy(f.graph,{get(target,key,receiver){return key==='displayName'?()=> 'Same Name':Reflect.get(target,key,receiver);}});
    const packet=await api.openJournalJob(f.campaign,await api.buildJournalJob(f.campaign,graph,'en',1,await f.campaign.party(),f.world,{referenced:true}));
    assert.equal(packet.recordable.length,2);assert.deepEqual(packet.recordable.map(value=>value.name),['Same Name','Same Name']);
    const job=await api.readJournalJob(f.campaign,packet.job_id),entries=[{person:'person:1',label:'The visitor in the letter',description:'The visitor wrote a letter.'}],selected=api.materializeJournalEntries(job,entries);
    assert.equal(selected.ids.length,1);assert.equal(selected.ids[0],'npc-walter-corbitt');
    await api.submitJournal(f.campaign,job,entries);
    const journal=JSON.parse(await readFile(join(f.campaign.directory,'npc-journal.json'),'utf8'));
    assert.deepEqual(Object.keys(journal.entries),['npc-walter-corbitt']);assert.equal(journal.entries['npc-walter-corbitt'].name,'Same Name');
});
test('stale retained catalogs refuse before the journal writer can act',async(t)=>{
    const f=await fixture(t),packet=await f.call('journal.job',{turn:1,mode:'referenced'}),path=join(f.campaign.directory,'npc-journal/jobs',`${packet.job_id}.json`),job=JSON.parse(await readFile(path,'utf8'));
    job.people_source.record[0].name='Another person';await writeFile(path,JSON.stringify(job));
    await assert.rejects(f.call('journal.submit',submission(packet,[{person:'person:0',label:'The watcher'}])),error=>error.details?.reason==='journal_reference_stale');
});

test('changed original input and unreadable retained files cannot be silently replaced',async(t)=>{
    const f=await fixture(t),packet=await f.call('journal.job',{turn:1,mode:'referenced'}),turnPath=join(f.campaign.directory,'turns/0001.json');
    const original=JSON.parse(await readFile(turnPath,'utf8'));original.rendered_text='Changed retained prose with the old commit pointer.';
    await writeFile(turnPath,JSON.stringify(original));
    await assert.rejects(f.call('journal.submit',submission(packet,[{person:'person:0',label:'The watcher'}])),error=>error.details?.reason==='journal_reference_stale');
    const path=join(f.campaign.directory,'npc-journal/jobs',`${packet.job_id}.json`);await writeFile(path,'retained unreadable fixture');
    await assert.rejects(f.call('journal.job',{turn:1,mode:'referenced'}),error=>error.details?.reason==='journal_reference_stale');
    await assert.rejects(f.call('journal.fail',{job_id:packet.job_id,protocol:packet.protocol,selection_binding:packet.selection_binding,reason:'lane_error',detail:'The job became unreadable.'}));
    assert.equal(await readFile(path,'utf8'),'retained unreadable fixture');
});
