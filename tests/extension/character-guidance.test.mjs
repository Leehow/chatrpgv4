import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareCharacterGuidance,validateGuidance} from '../../extensions/module/character-guidance.ts';
const occupations=[{id:'Journalist',name:'Journalist'}];
const guide={scene:'Story',guide:'',handoff:'Continue the meeting.',opening:'Boston, 1920. What is your name, and what kind of person are you?',advice:'Suggest source-fitting occupations and respect the player choices.'};
async function fixture(approved=true){
 const home=await mkdtemp(join(tmpdir(),'guidance-'));const folder=join(home,'.coc/modules/story');await mkdir(folder,{recursive:true});
 await writeFile(join(folder,'module.json'),JSON.stringify({id:'story'}));
 await writeFile(join(folder,'module-graph.json'),JSON.stringify({nodes:[{node_id:'opaque',name:'Story',node_kind:'module',summary:'Boston, 1920.',properties:{era:'1920s'}}]}));
 let calls=0;
 const runner=async req=>{calls++;if(req.systemPrompt.endsWith('character-guidance-review.md'))await writeFile(join(req.cwd,'review.json'),JSON.stringify({approved,issues:approved?[]:['Spoiler']}));else await writeFile(join(req.cwd,'guidance.json'),JSON.stringify({...guide,secret:'must never project'}));return {ok:true};};
 return {folder,options:{home,module_id:'story',play_language:'en',occupations,runner},calls:()=>calls};
}
test('accepted guidance is shared across sessions and invalidates for source/language/opening changes',async()=>{
 const {folder,options,calls}=await fixture();
 assert.deepEqual(await prepareCharacterGuidance(options),guide);assert.equal(calls(),2);
 assert.deepEqual(await prepareCharacterGuidance({...options}),guide);assert.equal(calls(),2);
 await prepareCharacterGuidance({...options,play_language:'zh-Hans'});assert.equal(calls(),4);
 await prepareCharacterGuidance({...options,opening:'Other opening'});assert.equal(calls(),6);
 await writeFile(join(folder,'module-graph.json'),JSON.stringify({nodes:[{name:'New source'}]}));
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
 const {options,calls}=await fixture();
 await assert.rejects(prepareCharacterGuidance({...options,module_id:'../escape'}),/Invalid module/);
 await assert.rejects(prepareCharacterGuidance({...options,play_language:'unknown'}),/language/);
 await assert.rejects(prepareCharacterGuidance({...options,signal:AbortSignal.abort()}),/cancelled/);assert.equal(calls(),0);
});
test('a reviewer cannot change the draft before publication',async()=>{
 const {options}=await fixture();const runner=options.runner;
 options.runner=async req=>{const result=await runner(req);if(req.systemPrompt.endsWith('character-guidance-review.md'))await writeFile(join(req.cwd,'guidance.json'),JSON.stringify({...guide,opening:'Tampered'}));return result;};
 await assert.rejects(prepareCharacterGuidance(options),/changed during review/);
});
