/** Real source gates and NPC consumers; deterministic evidence, not a live table. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, readFile, writeFile, symlink, readdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {reviewUnits, gateRefusal} from '../../extensions/module/reader-review.ts';
import {KernelClient} from '../../extensions/kernel/client.ts';
import {profilePayloadDigests} from '../../extensions/npc/profile-observation.ts';
const root = resolve(import.meta.dirname, '../..');
const parent = join(root, '.pi/module-npc-profiles-tests'); await mkdir(parent,{recursive:true});
const dir = await mkdtemp(join(parent,'run-'));
await symlink(join(root,'node_modules'),join(dir,'node_modules'),'dir');
await symlink(join(root,'mods'),join(dir,'mods'),'dir');
await build({stdin:{contents:`export {checkDraft,checkReview,assembleVisual} from './kernel-ts/modules/visual.ts';
export {loadModuleContract} from './kernel-ts/modules/contract.ts'; export {snapshots} from './kernel-ts/snapshots.ts';
export {ModuleGraph} from './kernel-ts/read/module-graph.ts'; export {moduleCharacterProfile,publishCharacterProfiles} from './kernel-ts/npc/profile.ts';
export {personalityView,sourceRelationships} from './kernel-ts/npc/material.ts'; export {npcPerspective} from './kernel-ts/npc/perspective.ts';
export {fitSituation} from './kernel-ts/npc/situation.ts';
export {buildPacket} from './kernel-ts/voice/jobs.ts';`,resolveDir:root,loader:'ts'},outfile:join(dir,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
const api=await import(pathToFileURL(join(dir,'api.mjs')).href);
const contract=await api.loadModuleContract({content:join(root,'content'),snapshots:api.snapshots});
const card=()=>({schema_version:1,profile:{priorities:['Keep reliable work without abandoning an honest friend.'],tendencies:[{context:'A stranger requests testimony.',inclination:'Offer only a bounded account.',exception:'A kept confidence supports more private conversation.'}],expression:'Blunt and practical; adjust to the listener without reciting motives.'},basis:['priorities','tendencies','expression'].map(field=>({field,derivation:'interpretation',source_refs:[{page:1}]}))});
const draft=()=>({nodes:[{node_id:'npc-witness',node_kind:'npc',name:'Witness',summary:'A blunt worker who fears losing work.',properties:{character_profile:card()},source_refs:[{page:1}]}],claims:[],node_refs:[],critical:[],ready_nodes:['npc-witness'],coverage:{},dependencies:[]});
const packet={module_id:'profile-book',purpose:'detail',source:{page_count:2},known_nodes:[],known_claims:[],review_policy:'module-logic-v1'};
function checked(value=draft()){return api.checkDraft(value,packet,contract,new Set([1]));}
function review(value, verdict='supported'){const filled=checked(value);const r={checked:filled.required_review.map(path=>({path,verdict:path.endsWith('character_profile')?verdict:'supported',source_refs:[{page:1}],reason:'Source identity is supported; optional interpretation assessed separately.'})),missing:[]};return {filled,r};}

test('source and host review owe exactly one optional profile pointer, not profile numbers as source facts',()=>{
 const d=draft(),filled=checked(d),pointer='/nodes/0/properties/character_profile';
 assert(filled.required_review.includes(pointer));
 assert(!filled.required_review.some(p=>p.includes('character_profile/schema_version')));
 assert(reviewUnits(d,filled.required_review,undefined,true).flat().includes(pointer));
 assert.equal(gateRefusal(packet,d)({verdict:'unsupported'},pointer),false);
 assert.equal(gateRefusal(packet,d)({verdict:'unsupported'},'/nodes/0/summary'),true);
});
test('malformed optional enrichment drops without refusing valid identity or changing original evidence',()=>{
 const d=draft();d.nodes[0].properties.character_profile.profile.tendencies.push(...Array(4).fill({context:'x',inclination:'y'}));
 const filled=checked(d);assert.equal(filled.nodes[0].properties.character_profile,undefined);
 assert.equal(filled.nodes[0].summary,d.nodes[0].summary);assert(d.nodes[0].properties.character_profile);
});
test('source drafts cannot claim host-minted references from a different source',()=>{
 const d=draft();for(const b of d.nodes[0].properties.character_profile.basis)b.source_refs=[{source_id:'pdf:another-book',pdf_index:0}];
 assert.equal(checked(d).nodes[0].properties.character_profile,undefined);
});
test('a malformed large integer in optional profile content never refuses the source record',()=>{
 const d=draft();d.nodes[0].properties.character_profile.profile.priorities=[999999999999999999999n];
 assert.equal(checked(d).nodes[0].properties.character_profile,undefined);
});
test('unsupported or omitted optional review drops the card, but unsupported source identity still refuses',()=>{
 for(const verdict of ['unsupported','contested']){const d=draft(),{filled,r}=review(d,verdict);api.checkReview(d,filled,r,2,new Set([1]));assert.equal(filled.nodes[0].properties.character_profile,undefined);}
 const d=draft(),{filled,r}=review(d);r.checked=r.checked.filter(r=>!r.path.endsWith('character_profile'));api.checkReview(d,filled,r,2,new Set([1]));assert.equal(filled.nodes[0].properties.character_profile,undefined);
 const strict=review(d);strict.r.checked.find(r=>r.path.endsWith('/summary')).verdict='unsupported';assert.throws(()=>api.checkReview(d,strict.filled,strict.r,2,new Set([1])),/unsupported/);
});
test('publication mints derived provenance and local freshness; unrelated changes do not invalidate it',()=>{
 const d=draft(),{filled,r}=review(d);api.checkReview(d,filled,r,2,new Set([1]));filled.character_profile_author={job_id:'host-owned',model:'test/author'};
 const raw=api.assembleVisual(null,filled,{id:'profile-book',title:'Book'},contract);
 const view=()=>new api.ModuleGraph('profile-book',raw,'',contract.graph.actor_dossier),g=view(),node=g.find('Witness');
 assert.equal(node.properties.character_profile.origin,'module_derived');assert.equal(node.properties.character_profile.author.model,'test/author');
 assert.deepEqual(api.moduleCharacterProfile(g,node).profile,card().profile);
 raw.nodes.push({node_id:'npc-unrelated',node_kind:'npc',name:'Unrelated',properties:{},summary:'A different person.'});
 assert(api.moduleCharacterProfile(view(),view().find('Witness')));
 node.properties.fear='New source evidence changes the fear.';assert.equal(api.moduleCharacterProfile(view(),view().find('Witness')),null);
});
test('a structurally valid card is not published without independent support',()=>{
 const filled=checked(draft()),raw=api.assembleVisual(null,filled,{id:'profile-book',title:'Book'},contract);
 assert.equal(raw.nodes.find(n=>n.node_id==='npc-witness').properties.character_profile,undefined);
});
test('shared perspective and voice inputs use the same card and preserve directed played evidence',()=>{
 const d=draft(),{filled,r}=review(d);api.checkReview(d,filled,r,2,new Set([1]));const raw=api.assembleVisual(null,filled,{id:'profile-book',title:'Book'},contract);
 const g=new api.ModuleGraph('profile-book',raw,'',contract.graph.actor_dossier),node=g.find('Witness'),world={};
 const memory=[{kind:'relationship',subject:'Witness',entities:['Investigator'],knowers:['Witness'],statement:'The investigator kept the promised confidence.',state:'accurate',turn:1}];
 const v=api.npcPerspective(g,world,node,memory,[],{}).view;
 const voice=api.buildPacket({id:'trial'},g,world,{id:'npc-voice',enabled:true,lock:{}},node,'en',{relationships:v.relationships},'instruction');
 assert.deepEqual(v.personality.profile,voice.npc.personality.profile);assert.deepEqual(voice.npc.relationships,v.relationships);
 assert.equal(v.relationships[0].toward,'Investigator');assert(!JSON.stringify(voice).includes('source_revision'));
});
test('source personality coexists with a graph card while an accepted legacy personality suppresses replacement',()=>{
 const d=draft();d.nodes[0].properties.personality='Direct but careful about witnesses.';
 const {filled,r}=review(d);api.checkReview(d,filled,r,2,new Set([1]));const raw=api.assembleVisual(null,filled,{id:'profile-book',title:'Book'},contract);
 const g=new api.ModuleGraph('profile-book',raw,'',contract.graph.actor_dossier),node=g.find('Witness');
 const fresh=api.personalityView(g,{},node);assert.equal(fresh.description,d.nodes[0].properties.personality);assert.deepEqual(fresh.profile,card().profile);
 const old={npc_character:{'npc-witness':{personality:{description:'A previously accepted person.',origin:'table_supplement'}}}};
 assert.equal(api.personalityView(g,old,node).profile,undefined);
});
test('accepted campaign profile survives a changed module interpretation while source disagreement is explicit',()=>{
 const d=draft(),{filled,r}=review(d);api.checkReview(d,filled,r,2,new Set([1]));const raw=api.assembleVisual(null,filled,{id:'profile-book',title:'Book'},contract);
 const g=new api.ModuleGraph('profile-book',raw,'',contract.graph.actor_dossier),node=g.find('Witness');const adopted=api.moduleCharacterProfile(g,node);
 const world={npc_character:{'npc-witness':{personality:adopted}}};node.properties.fear='A newly read source fear';
 assert.deepEqual(api.personalityView(g,world,node).profile,card().profile);assert.equal(api.personalityView(g,world,node).source_changed,true);
 const other={};assert.equal(api.personalityView(g,other,node),null,'a second campaign never inherits the first adoption');
});
test('source relationship evidence stays directed and attributed, and its own revision invalidates interpretation',()=>{
 const d=draft(),{filled,r}=review(d);api.checkReview(d,filled,r,2,new Set([1]));const raw=api.assembleVisual(null,filled,{id:'profile-book',title:'Book'},contract);
 raw.nodes.push({node_id:'npc-friend',node_kind:'npc',name:'Friend',properties:{},summary:'Another person.'});
 raw.relations.push({relation_id:'rel-trust',relation_kind:'trusts',from_node_id:'npc-witness',to_node_id:'npc-friend',claim_id:'claim-trust',properties:{}});
 raw.claims.push({claim_id:'claim-trust',subject_id:'npc-witness',predicate:'trusts',object:{node_id:'npc-friend'},truth_status:'authored-rumor',known_by_ids:['npc-witness']});
 api.publishCharacterProfiles(raw,filled.nodes,{model:'test/reader'});
 const dossier={...contract.graph.actor_dossier,tie_relation_kinds:['trusts']},g=new api.ModuleGraph('profile-book',raw,'',dossier),node=g.find('Witness');
 assert.equal(api.sourceRelationships(g,node)[0].truth_status,'authored-rumor');assert.deepEqual(api.sourceRelationships(g,g.find('Friend')),[]);
 assert(api.moduleCharacterProfile(g,node));raw.claims[0].known_by_ids=['npc-friend'];
 assert.deepEqual(api.sourceRelationships(g,node),[]);assert.equal(api.moduleCharacterProfile(g,node),null);
});
test('optional profile failure cannot bypass an unsupported source summary through a grouped review row',()=>{
 const d=draft(),{filled,r}=review(d);r.checked.push({paths:['/nodes/0/properties/character_profile','/nodes/0/summary'],verdict:'unsupported',source_refs:[{page:1}],reason:'Bad source summary as well as bad profile.'});
 assert.throws(()=>api.checkReview(d,filled,r,2,new Set([1])),/unsupported/);
});
test('actual adapter shapes preserve profile observation through nested JSON without changing or recording prose',()=>{
 const object={personality:{origin:'module_derived',profile:card().profile}},before=structuredClone(object);
 const expected=profilePayloadDigests(object);assert.equal(expected.length,1);
 const responses={input:[{role:'tool',content:[{type:'text',text:JSON.stringify({result:JSON.stringify(object)})}]}]};
 const chat={messages:[{role:'tool',content:JSON.stringify(object,null,2)}]};
 assert.deepEqual(profilePayloadDigests(responses),expected);assert.deepEqual(profilePayloadDigests(chat),expected);
 assert.deepEqual(object,before);assert.deepEqual(profilePayloadDigests({text:'A profile was prepared.'}),[]);
});
test('optional derived guidance is cut before immediate facts or player context under pressure',()=>{
 const p={who:{personality:{origin:'module_derived',profile:{expression:'x'.repeat(850)}}},at_hand:{objects:['Witness record'],exits:[],holdings:[],present:[]},
    done:[],recent_speech:[],happened:['The investigator asks to hear the witness.'],canonical_context:{player_declaration:'Please tell me what you saw.'},constraints:['No extra knowledge.'],truncated:[]};
 api.fitSituation(p,700,true);assert.equal(p.who.personality,undefined);
 assert.deepEqual(p.at_hand.objects,['Witness record']);assert.equal(p.canonical_context.player_declaration,'Please tell me what you saw.');
 assert.deepEqual(p.truncated,['who.personality.profile']);
});

await build({entryPoints:[join(root,'kernel-ts/rpc.ts')],outfile:join(dir,'rpc.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
async function opened(t){
 const home=await mkdtemp(join(dir,'campaign-')),content=await mkdtemp(join(dir,'content-'));
 for(const name of await readdir(join(root,'content')))if(name!=='starters')await symlink(join(root,'content',name),join(content,name));
 await mkdir(join(content,'starters','the-haunting'),{recursive:true});
 for(const name of await readdir(join(root,'content/starters/the-haunting')))if(name!=='module-graph.json')await symlink(join(root,'content/starters/the-haunting',name),join(content,'starters/the-haunting',name));
 const raw=JSON.parse(await readFile(join(root,'content/starters/the-haunting/module-graph.json'),'utf8'));
 const n=raw.nodes.find(n=>n.name==='Steven Knott');n.properties.character_profile=card();
 api.publishCharacterProfiles(raw,[n],{model:'test/reader'});
 await writeFile(join(content,'starters/the-haunting/module-graph.json'),JSON.stringify(raw));
 const connect=()=>new KernelClient({command:[process.execPath,join(dir,'rpc.mjs'),'--workspace',home,'--content',content],cwd:root,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},timeoutMs:30000});
 const client=connect();t.after(()=>client.close());await client.call('campaign.create',{id:'profile-test',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});await client.call('table.open',{campaign:'profile-test'});
 return {client,connect,home};
}
test('real NPC adoption skips authorship, survives reload and matches capsule/action inputs',async t=>{
 const {client,connect,home}=await opened(t),params={campaign:'profile-test',name:'Steven Knott'};
 const readBefore=await client.call('table.look',{...params,focus:'npc'});assert.deepEqual(readBefore.personality.profile,card().profile);
 const adopted=await client.call('npc.job',params);assert.equal(adopted.job_id,null);assert.equal(adopted.adopted,true);
 const capsule=await client.call('table.capsule',{campaign:params.campaign});assert.deepEqual((capsule.capsule??capsule).present.find(p=>p.name===params.name).personality.profile,card().profile);
 const perspective=await client.call('npc.perspective',params);assert.deepEqual(perspective.personality.profile,card().profile);
 const situation=await client.call('npc.situation',params);assert.deepEqual(situation.who.personality.profile,card().profile);
 await client.close();const fresh=connect();t.after(()=>fresh.close());assert.deepEqual((await fresh.call('table.look',{...params,focus:'npc'})).personality.profile,card().profile);
 assert.equal((await fresh.call('npc.job',params)).adopted,undefined);
 const world=JSON.parse(await readFile(join(home,'.coc/campaigns/profile-test/world.json'),'utf8'));assert(Object.values(world.npc_character).some(x=>x.personality.origin==='module_derived'));
});

test('real voice job reads played relationship and promise evidence from its campaign scope',async t=>{
 const {client,home}=await opened(t),campaign='profile-test';
 await client.call('npc.job',{campaign,name:'Steven Knott'});
 const base={subject:'Steven Knott',entities:['Investigator'],knowers:['Steven Knott'],state:'accurate',turn:1,worldline:'main',loop:0};
 const memories=[{...base,kind:'relationship',statement:'The investigator kept the agreed confidence.'},
  {...base,kind:'promise',statement:'Steven Knott promised to hear the verified report.'},
  {...base,kind:'relationship',worldline:'another-line',statement:'A different worldline relationship.'},
  {...base,kind:'relationship',loop:1,statement:'A different loop relationship.'}];
 await mkdir(join(home,'.coc/campaigns/profile-test/memory'),{recursive:true});
 await writeFile(join(home,'.coc/campaigns/profile-test/memory/candidates.jsonl'),memories.map(x=>JSON.stringify(x)).join('\n')+'\n');
 const packet=await client.call('voice.job',{campaign});
 assert(packet.job_id);assert.deepEqual(packet.npc.personality.profile,card().profile);
 const perspective=await client.call('npc.perspective',{campaign,name:'Steven Knott'});
 assert.deepEqual(packet.npc.relationships,perspective.relationships);
 assert.equal(packet.npc.relationships[0].evidence.length,1);
 assert.equal(packet.npc.commitments.length,1);
 assert.equal(packet.npc.commitments[0].statement,memories[1].statement);
});
