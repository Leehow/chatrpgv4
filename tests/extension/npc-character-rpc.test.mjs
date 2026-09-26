/** Core NPC material through the real kernel RPC surface; deterministic contract evidence, not play. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,mkdtemp,readFile,symlink,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {KernelClient} from '../../extensions/kernel/client.ts';

const root=resolve(import.meta.dirname,'../..'),evidence=join(root,'.pi/npc-implementation/rpc-tests');
await mkdir(evidence,{recursive:true});
const emitted=await mkdtemp(join(evidence,'entry-'));
await symlink(join(root,'node_modules'),join(emitted,'node_modules'),'dir');
await build({entryPoints:[join(root,'kernel-ts/rpc.ts')],outfile:join(emitted,'rpc.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',logLevel:'silent'});
async function opened(t){
 const home=await mkdtemp(join(evidence,'campaign-'));
 const connect=()=>new KernelClient({command:[process.execPath,join(emitted,'rpc.mjs'),'--workspace',home,'--content',join(root,'content')],cwd:root,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',COC_KERNEL_SEED:'npc-character'},timeoutMs:30000});
 const client=connect();t.after(()=>client.close());
 await client.call('campaign.create',{id:'npc-test',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
 await client.call('table.open',{campaign:'npc-test'});
 return {client,connect,home};
}

test('accepted personality reaches the actual NPC view and survives a fresh kernel',async t=>{
 const {client,connect}=await opened(t);
 const packet=await client.call('npc.job',{campaign:'npc-test',name:'Steven Knott'});
 assert.equal(packet.npc.name,'Steven Knott');
 const personality={description:'He prefers explicit agreements, but a kept promise makes him willing to offer discreet help.'};
 const accepted=await client.call('npc.submit',{campaign:'npc-test',job_id:packet.job_id,claim:packet.claim,personality});
 assert.equal(accepted.personality.description,personality.description);
 const view=await client.call('table.look',{campaign:'npc-test',focus:'npc',name:'Steven Knott'});
 assert.equal(view.personality.description,personality.description);
 const capsule=await client.call('table.capsule',{campaign:'npc-test'});
 assert.equal((capsule.capsule??capsule).present.find(p=>p.name==='Steven Knott').personality.description,personality.description);
 await client.close();
 const fresh=connect();t.after(()=>fresh.close());
 assert.equal((await fresh.call('table.look',{campaign:'npc-test',focus:'npc',name:'Steven Knott'})).personality.description,personality.description);
 assert.equal((await fresh.call('npc.job',{campaign:'npc-test',name:'Steven Knott'})).job_id,null);
 assert.equal((await fresh.call('npc.submit',{campaign:'npc-test',job_id:packet.job_id,claim:packet.claim,personality})).replayed,true);
});

test('a failed author cannot publish after another attempt reclaims the same missing personality',async t=>{
 const {client}=await opened(t),params={campaign:'npc-test',name:'Steven Knott'};
 const old=await client.call('npc.job',params);
 await client.call('npc.fail',{campaign:params.campaign,job_id:old.job_id,claim:old.claim,reason:'cancelled'});
 const current=await client.call('npc.job',params);
 assert.equal(current.job_id,old.job_id,'the logical preparation is reused');
 assert.notEqual(current.claim,old.claim,'publication belongs to the new attempt');
 await assert.rejects(client.call('npc.submit',{campaign:params.campaign,job_id:old.job_id,claim:old.claim,personality:{description:'An old late result.'}}),error=>error.details?.reason==='npc_claim_stale');
 assert.equal((await client.call('table.look',{campaign:params.campaign,focus:'npc',name:'Steven Knott'})).personality,undefined);
 const personality={description:'He is deliberate, values reliable promises, and can offer practical help.'};
 await client.call('npc.submit',{campaign:params.campaign,job_id:current.job_id,claim:current.claim,personality});
 await assert.rejects(client.call('npc.submit',{campaign:params.campaign,job_id:current.job_id,claim:current.claim,personality:{description:'A replacement person.'}}),error=>error.code==='idempotency_conflict');
});

test('personality preparation cannot create a person or publish mechanical fields',async t=>{
 const {client}=await opened(t);
 await assert.rejects(client.call('npc.job',{campaign:'npc-test',name:'A person absent from this campaign'}),error=>error.code==='unknown_entity');
 const packet=await client.call('npc.job',{campaign:'npc-test',name:'Steven Knott'});
 await assert.rejects(client.call('npc.submit',{campaign:'npc-test',job_id:packet.job_id,claim:packet.claim,
   personality:{description:'A helpful person.',skills:{Medicine:99}}}),error=>error.code==='invalid_params');
 assert.equal((await client.call('table.look',{campaign:'npc-test',focus:'npc',name:'Steven Knott'})).personality,undefined);
});

test('NPC relationships are directed and own speech remains available before memory extraction',async t=>{
 const {client}=await opened(t),campaign='npc-test';
 const spoken='I remember that you kept your word. I will consider helping you again.';
 await client.call('table.narrate',{campaign,call_id:'t0-c1',text:`{{say:Steven Knott}}${spoken}{{/say}}`});
 const pending=await client.call('npc.perspective',{campaign,name:'Steven Knott'});
 assert.equal(pending.recent_speech.at(-1).statement,spoken);
 assert.equal(pending.recent_speech.at(-1).authority,'conversation_report');
 const job=await client.call('memory.job',{campaign,turn:0}),investigator=job.investigators[0].name;
 await client.call('memory.submit',{campaign,job_id:job.job_id,candidates:[
   {kind:'relationship',subject:'Steven Knott',entities:[investigator],knowers:['Steven Knott'],statement:'Knott respects the investigator for keeping his word.',privacy:'keeper_only',state:'accurate',confidence:0.9},
   {kind:'relationship',subject:investigator,entities:['Steven Knott'],knowers:[investigator],statement:'The investigator privately distrusts Knott.',privacy:'keeper_only',state:'uncertain',confidence:0.7},
   {kind:'promise',subject:investigator,entities:['Steven Knott'],knowers:['Steven Knott',investigator],statement:'The investigator will tell Knott the truth before publishing a report.',privacy:'player_safe',state:'accurate',confidence:0.9},
   {kind:'belief',subject:investigator,knowers:[investigator],statement:'A private suspicion that Knott has not heard.',privacy:'keeper_only',state:'uncertain',confidence:0.7}
 ]});
 const view=await client.call('table.look',{campaign,focus:'npc',name:'Steven Knott'});
 assert.equal(view.relationships[0].toward,investigator);
 assert.equal(view.relationships.length,1,'the reverse relationship does not become Knott\'s view');
 assert.equal(view.relationships[0].evidence[0].authority,'conversation_report');
 const perspective=await client.call('npc.perspective',{campaign,name:'Steven Knott'});
 assert.equal(perspective.relationships[0].toward,investigator);
 assert(!JSON.stringify(perspective).includes('A private suspicion that Knott has not heard.'));
 assert(!JSON.stringify(perspective).includes('The investigator privately distrusts Knott.'));
 assert.equal(perspective.commitments[0].subject,investigator,'a promise heard from someone else remains attributable to its actual maker');
 assert.equal(perspective.recent_speech.at(-1).statement,spoken);
});

test('the response bank is retired: its methods are unknown and an older campaign\'s bank is neither read nor deleted (§139.6)',async t=>{
 const {client,home}=await opened(t),campaign='npc-test';
 const persona=await client.call('npc.job',{campaign,name:'Steven Knott'});
 await client.call('npc.submit',{campaign,job_id:persona.job_id,claim:persona.claim,personality:{description:'Practical and attentive to evidence.'}});
 for(const method of ['npc.responses.job','npc.responses.submit'])
  await assert.rejects(client.call(method,{campaign,name:'Steven Knott'}),e=>e.code==='unknown_method',`${method} is no longer a method`);
 // A ready bank as an older build wrote it, at the path it used: npc/responses/<digest of {npc, scope}>.json.
 const row='Ask for verifiable evidence before accepting a supernatural explanation.';
 const digest=createHash('sha256').update(JSON.stringify({npc:'npc-steven-knott',scope:{loop:0,worldline:'main'}})).digest('hex');
 const dir=join(home,'.coc','campaigns',campaign,'npc','responses'),file=join(dir,`${digest}.json`);
 await mkdir(dir,{recursive:true});
 await writeFile(file,JSON.stringify({status:'ready',responses:[{intent:row,when:'The visitor offers a supernatural explanation.'}],settled_seen:0},null,2));
 const bytes=await readFile(file,'utf8');
 const view=await client.call('npc.perspective',{campaign,name:'Steven Knott'});
 assert.equal(view.responses,undefined,'a perspective carries no bank rows');
 assert.deepEqual((await client.call('npc.perspectives',{campaign})).views.find(value=>value.name==='Steven Knott'),view);
 const capsule=await client.call('table.capsule',{campaign}),knott=(capsule.capsule??capsule).present.find(p=>p.name==='Steven Knott');
 assert.equal(knott.response_options,undefined,'the card has no advice hint');
 assert(!JSON.stringify(capsule).includes(row),'no bank row reaches the capsule');
 await client.call('table.narrate',{campaign,call_id:'t0-c1',text:'Knott waits.'});
 await client.call('table.player_input',{campaign,text:'I ask him about the house.'});
 assert.equal(await readFile(file,'utf8'),bytes,'the old file is left where it was, untouched');
});

test('a reunion is generated at an actual return, accepted once, and survives reload without simulated intermediate turns',async t=>{
 const {client,connect}=await opened(t),campaign='npc-test';
 const continuity={background:['Knott spent the interval sorting ordinary correspondence.'],reports:['He says the office has been quiet.'],open_threads:[]};
 await assert.rejects(client.call('table.apply',{campaign,call_id:'t0-c1',effects:[{kind:'npc',name:'Steven Knott',reunion:continuity}]}));
 await client.call('table.narrate',{campaign,call_id:'t0-c2',text:'{{say:Steven Knott}}Bring me what you can establish.{{/say}}'});
 await client.call('table.player_input',{campaign,text:'I spend an hour at the library.'});
 await client.call('table.apply',{campaign,call_id:'t1-c1',effects:[{kind:'move',to:'central-library',travel_minutes:60}]});
 await client.call('table.narrate',{campaign,call_id:'t1-c2',text:'You are at the library.'});
 await client.call('table.player_input',{campaign,text:'I return to Knott.'});
 await client.call('table.apply',{campaign,call_id:'t2-c1',effects:[{kind:'move',to:'commission-briefing',travel_minutes:60}]});
 const before=await client.call('table.look',{campaign,focus:'npc',name:'Steven Knott'});
 assert.equal(before.reunion.status,'needed');assert.equal(before.reunion.elapsed_minutes,120);
 await client.call('table.apply',{campaign,call_id:'t2-c2',effects:[{kind:'npc',name:'Steven Knott',reunion:continuity}]});
 const accepted=await client.call('table.look',{campaign,focus:'npc',name:'Steven Knott'});
 assert.equal(accepted.reunion.status,'established');assert.deepEqual(accepted.reunion.background,continuity.background);
 await assert.rejects(client.call('table.apply',{campaign,call_id:'t2-c3',effects:[{kind:'npc',name:'Steven Knott',reunion:{...continuity,background:['A different invented past.']}}]}),e=>e.code==='idempotency_conflict');
 await client.call('table.apply',{campaign,call_id:'t2-c4',effects:[{kind:'npc',name:'Steven Knott',reunion:{extend:true,reports:['He says he has finished reading a routine letter.']}}]});
 assert.deepEqual((await client.call('table.look',{campaign,focus:'npc',name:'Steven Knott'})).reunion.background,continuity.background,'an addition never requires recopying or replacing the original background');
 await client.call('table.narrate',{campaign,call_id:'t2-c5',text:'{{say:Steven Knott}}The office has been quiet.{{/say}}'});
 await client.close();const fresh=connect();t.after(()=>fresh.close());
 assert.deepEqual((await fresh.call('table.look',{campaign,focus:'npc',name:'Steven Knott'})).reunion.background,continuity.background);
});

test('a recorded death excludes an onstage person from response advice even without a resource profile',async t=>{
 const {client}=await opened(t),campaign='npc-test';
 await client.call('table.narrate',{campaign,call_id:'t0-c1',text:'A person waits in the office.'});
 await client.call('table.player_input',{campaign,text:'I check the person after the fatal accident.'});
 await client.call('table.apply',{campaign,call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',dead:true}]});
 await client.call('table.narrate',{campaign,call_id:'t1-c2',text:'Knott has died.'});
 const view=await client.call('npc.perspective',{campaign,name:'Steven Knott'});
 assert.equal(view.availability.can_act,false);
});
