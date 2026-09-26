import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {prepareCharacterGuidance,validateGuidance,validateGuidanceReference,guidanceFingerprint,SETUP_GUIDANCE_REFERENCE_PROTOCOL} from '../../extensions/module/character-guidance.ts';
const REPO=resolve(import.meta.dirname,'../..');
const occupations=[{id:'Journalist',name:'Journalist'}];
const guide={scene:'Story',guide:'',handoff:'Continue the meeting.',opening:'Boston, 1920. What is your name, and what kind of person are you?',advice:'Suggest source-fitting occupations and respect the player choices.'};
const rawGuidance=packet=>({protocol:SETUP_GUIDANCE_REFERENCE_PROTOCOL,opening:guide.opening,advice:guide.advice,
 guide:packet.guides[0]?.alias??null,handoff:guide.handoff});
test('default, name, node ID and runtime handle reuse one reviewed opening',async()=>{
 const {folder,options,calls}=await fixture();
 await writeFile(join(folder,'module.json'),JSON.stringify({id:'story',opening:{start_scene:'scene-office'}}));
 await writeFile(join(folder,'module-graph.json'),JSON.stringify({nodes:[{node_id:'scene-office',node_kind:'scene',name:'The Office',aliases:['Office entrance'],properties:{runtime_projection:{record:{scene_id:'office'}}}}]}));
 const keys=await Promise.all([undefined,'scene-office','The Office','office','Office entrance'].map(opening=>guidanceFingerprint({...options,opening})));
 assert.equal(new Set(keys).size,1);
 for(const opening of [undefined,'The Office','office'])await prepareCharacterGuidance({...options,opening});
 assert.equal(calls(),2);
 const [attempt]=await readdir(join(folder,'character-guidance',keys[0],'attempts'));
 const packet=JSON.parse(await readFile(join(folder,'character-guidance',keys[0],'attempts',attempt,'packet.json'),'utf8'));
 assert.equal(packet.opening,'The Office');
 assert.equal(packet.protocol,SETUP_GUIDANCE_REFERENCE_PROTOCOL);assert.deepEqual(packet.guides,[]);
});
test('author selects an opening guide alias while host materializes exact scene and name',async()=>{
 const {folder,options}=await fixture();
 await writeFile(join(folder,'module.json'),JSON.stringify({id:'story',opening:{start_scene:'scene-office'}}));
 await writeFile(join(folder,'module-graph.json'),JSON.stringify({nodes:[
  {node_id:'scene-office',node_kind:'scene',name:'The Office',summary:'Opening office.'},
  {node_id:'npc-knott',node_kind:'npc',name:'Steven Knott',summary:'The landlord.'}],
  relations:[{relation_id:'present',relation_kind:'present-in',from_node_id:'npc-knott',to_node_id:'scene-office'}]}));
 let raw,packet;
 const result=await prepareCharacterGuidance({...options,runner:async req=>{
  if(req.systemPrompt.endsWith('character-guidance-review.md'))await writeFile(join(req.cwd,'review.json'),JSON.stringify({approved:true,issues:[]}));
  else {packet=JSON.parse(await readFile(join(req.cwd,'packet.json'),'utf8'));raw=rawGuidance(packet);await writeFile(join(req.cwd,'guidance.json'),JSON.stringify(raw));}
  return {ok:true};
 }});
 assert.deepEqual(packet.guides,[{alias:'guide:0',name:'Steven Knott',summary:'The landlord.'}]);
 assert.equal(raw.scene,undefined);assert.equal(raw.guide,'guide:0');assert.ok(!JSON.stringify(raw).includes('Steven Knott'));
 assert.equal(result.scene,'The Office');assert.equal(result.guide,'Steven Knott');
 const key=await guidanceFingerprint(options),[attempt]=await readdir(join(folder,'character-guidance',key,'attempts'));
 assert.deepEqual(JSON.parse(await readFile(join(folder,'character-guidance',key,'attempts',attempt,'guidance-round-1.json'),'utf8')),raw);
 assert.deepEqual((JSON.parse(await readFile(join(folder,'character-guidance',key,'accepted.json'),'utf8'))).guidance,result);
});
test('a listed starter: a stale bundle for the tag never runs a reader; a tag with no bundle generates per campaign',async()=>{
 const {folder,options,calls}=await fixture();
 // The starter ships one bundle, for en, that the kernel did not accept (its graph digest is stale).
 const contentRoot=await bundledContentRoot({'en.json':JSON.stringify({module_id:'story',play_language:'en',graph_sha256:'stale',fingerprint:'0'.repeat(64),approved:true,guidance:guide})});
 await writeFile(join(folder,'module.json'),JSON.stringify({id:'story',bundled_guidance_required:true,opening:{start_scene:'scene-story'}}));
 await assert.rejects(prepareCharacterGuidance({...options,contentRoot,play_language:'en'}),error=>error.code==='guidance_not_ready'&&/Bundled starter guidance/.test(error.message));
 assert.equal(calls(),0);
 // A tag the starter ships no bundle for reaches the generation path, as a PDF module does.
 assert.deepEqual(await prepareCharacterGuidance({...options,contentRoot,play_language:'pt-BR'}),guide);
 assert.equal(calls(),2);
 const key=await guidanceFingerprint({...options,contentRoot,play_language:'pt-BR'});
 const [attempt]=await readdir(join(folder,'character-guidance',key,'attempts'));
 assert.equal(JSON.parse(await readFile(join(folder,'character-guidance',key,'attempts',attempt,'packet.json'),'utf8')).play_language,'pt-BR');
 // Once the kernel has accepted the en bundle, en is served from it without a reader.
 const accepted=await guidanceFingerprint({...options,contentRoot,play_language:'en'});
 await mkdir(join(folder,'character-guidance',accepted),{recursive:true});
 await writeFile(join(folder,'character-guidance',accepted,'accepted.json'),JSON.stringify({fingerprint:accepted,approved:true,play_language:'en',guidance:guide}));
 await writeFile(join(folder,'module.json'),JSON.stringify({id:'story',bundled_guidance_required:true,opening:{start_scene:'scene-story'},character_guidance:{[accepted]:{scene:'Story',play_language:'en'}}}));
 assert.deepEqual(await prepareCharacterGuidance({...options,contentRoot,play_language:'en'}),guide);
 assert.equal(calls(),2);
});
/** A content root with the real prompts and a starter `story` shipping exactly `files` as its guidance bundles. */
async function bundledContentRoot(files){
 const content=await mkdtemp(join(tmpdir(),'guidance-content-'));
 await symlink(join(REPO,'content/setup'),join(content,'setup'),'dir');
 const bundles=join(content,'starters/story/character-guidance');
 await mkdir(bundles,{recursive:true});
 for(const [name,text] of Object.entries(files))await writeFile(join(bundles,name),text);
 return content;
}
async function fixture(approved=true){
 const home=await mkdtemp(join(tmpdir(),'guidance-'));const folder=join(home,'.coc/modules/story');await mkdir(folder,{recursive:true});
 await writeFile(join(folder,'module.json'),JSON.stringify({id:'story',opening:{start_scene:'scene-story'}}));
 await writeFile(join(folder,'module-graph.json'),JSON.stringify({nodes:[
  {node_id:'opaque',name:'Story module',node_kind:'module',summary:'Boston, 1920.',properties:{era:'1920s'}},
  {node_id:'scene-story',name:'Story',node_kind:'scene',summary:'The opening meeting.'},
  {node_id:'scene-other',name:'Other opening',node_kind:'scene',summary:'Another opening meeting.'}],relations:[]}));
 let calls=0;
 const runner=async req=>{calls++;if(req.systemPrompt.endsWith('character-guidance-review.md'))await writeFile(join(req.cwd,'review.json'),JSON.stringify({approved,issues:approved?[]:['Spoiler']}));else {
  const packet=JSON.parse(await readFile(join(req.cwd,'packet.json'),'utf8'));
  await writeFile(join(req.cwd,'guidance.json'),JSON.stringify(rawGuidance(packet)));
 }return {ok:true};};
 return {folder,options:{home,module_id:'story',play_language:'en',occupations,runner},calls:()=>calls};
}
test('accepted guidance is shared across sessions and invalidates for source/language/opening changes',async()=>{
 const {folder,options,calls}=await fixture();
 assert.deepEqual(await prepareCharacterGuidance(options),guide);assert.equal(calls(),2);
 assert.deepEqual(await prepareCharacterGuidance({...options}),guide);assert.equal(calls(),2);
 await prepareCharacterGuidance({...options,play_language:'zh-Hans'});assert.equal(calls(),4);
 await prepareCharacterGuidance({...options,opening:'Other opening'});assert.equal(calls(),6);
 await writeFile(join(folder,'module-graph.json'),JSON.stringify({nodes:[{node_id:'scene-story',name:'Story',node_kind:'scene',summary:'Changed source.'}],relations:[]}));
 await prepareCharacterGuidance(options);assert.equal(calls(),8);
 assert.equal((await readdir(join(folder,'character-guidance'))).length,4);
});
test('review rejection is never cached or exposed and retry retains earlier attempts',async()=>{
 const {folder,options,calls}=await fixture(false);
 await assert.rejects(prepareCharacterGuidance(options),/needs revision/);
 await assert.rejects(prepareCharacterGuidance(options),/needs revision/);assert.equal(calls(),8);
 const [key]=await readdir(join(folder,'character-guidance'));
 assert.equal((await readdir(join(folder,'character-guidance',key,'attempts'))).length,2);
 await assert.rejects(readFile(join(folder,'character-guidance',key,'accepted.json')));
});
test('invalid guidance, language, traversal and cancellation are rejected',async()=>{
 assert.throws(()=>validateGuidance({opening:'',advice:'Test'}),/Invalid/);
 assert.throws(()=>validateGuidanceReference({protocol:SETUP_GUIDANCE_REFERENCE_PROTOCOL,opening:'Open',advice:'Advice',guide:'guide:9',handoff:'Continue'},'Scene',[]),/guide selection/);
 const {options,calls}=await fixture();
 await assert.rejects(prepareCharacterGuidance({...options,module_id:'../escape'}),/Invalid module/);
 // A tag is accepted by shape alone: `unknown` is not one, while a tag no data names is.
 await assert.rejects(prepareCharacterGuidance({...options,play_language:'unknown'}),error=>error.code==='invalid_params'&&/language/.test(error.message));
 await assert.rejects(prepareCharacterGuidance({...options,play_language:'Not A Tag'}),error=>error.code==='invalid_params'&&/language/.test(error.message));
 await assert.rejects(prepareCharacterGuidance({...options,signal:AbortSignal.abort()}),/cancelled/);assert.equal(calls(),0);
});
test('a reviewer cannot change the draft before publication',async()=>{
 const {options}=await fixture();const runner=options.runner;
 options.runner=async req=>{const result=await runner(req);if(req.systemPrompt.endsWith('character-guidance-review.md'))await writeFile(join(req.cwd,'guidance.json'),JSON.stringify({...guide,opening:'Tampered'}));return result;};
 await assert.rejects(prepareCharacterGuidance(options),/changed during review/);
});
test('background graph enrichment does not invalidate guidance for the same source and opening',async()=>{
 const {folder,options,calls}=await fixture();
 await writeFile(join(folder,'module.json'),JSON.stringify({id:'story',file_sha256:'a'.repeat(64),generation:1,opening:{start_scene:'scene-story'}}));
 await prepareCharacterGuidance(options);assert.equal(calls(),2);
 const graph=JSON.parse(await readFile(join(folder,'module-graph.json'),'utf8'));
 graph.nodes.push({node_id:'npc-later',node_kind:'npc',name:'Later antagonist',visibility:'keeper-only',summary:'Later chapter details.'});
 await writeFile(join(folder,'module-graph.json'),JSON.stringify(graph));
 await writeFile(join(folder,'module.json'),JSON.stringify({id:'story',file_sha256:'a'.repeat(64),generation:2,opening:{start_scene:'scene-story'}}));
 await prepareCharacterGuidance(options);assert.equal(calls(),2);
});
test('§140: a reviewer that ends without writing review.json is a coded failure that says so, and nothing is accepted',async()=>{
 const {folder,options}=await fixture();
 const author=options.runner;
 // The shape a truncated reviewer leaves (occ-check, 2026-09-26): the child exits cleanly, no verdict on disk.
 options.runner=async req=>req.systemPrompt.endsWith('character-guidance-review.md')?{ok:true}:author(req);
 await assert.rejects(prepareCharacterGuidance(options),error=>error.code==='preparation_failed'
  &&/reviewer ended without writing review\.json/.test(error.message));
 const [key]=await readdir(join(folder,'character-guidance'));
 await assert.rejects(readFile(join(folder,'character-guidance',key,'accepted.json')));
 // An author that writes nothing is named the same way.
 options.runner=async()=>({ok:true});
 await assert.rejects(prepareCharacterGuidance(options),error=>error.code==='preparation_failed'
  &&/author ended without writing guidance\.json/.test(error.message));
});
