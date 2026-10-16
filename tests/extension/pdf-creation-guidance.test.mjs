import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,rm,writeFile,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {preparePdfCreationGuidance} from '../../extensions/onboarding/pdf-guidance.ts';
import {guidanceFingerprint} from '../../extensions/module/character-guidance.ts';
import {readerInstructionText} from '../../runtime/reader-instructions.ts';

test('PDF setup binds first and opens the reviewed guidance scope before any first-scene read',async t=>{
 const home=await mkdtemp(join(tmpdir(),'pdf-creation-guidance-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const moduleDir=join(home,'.coc/modules/book-1');await mkdir(moduleDir,{recursive:true});
 await writeFile(join(moduleDir,'module.json'),JSON.stringify({id:'book-1',file_sha256:'a'.repeat(64)}));
 const calls=[],occupations=[{id:'journalist',name:'Journalist'}];
 const result=await preparePdfCreationGuidance({home,params:{pdf:'source.pdf',start_scene:'Roadside meeting'},
  reading:{async prepare(params){calls.push(params);return params.purpose==='bind'?{ok:true,module_id:'book-1'}:{state:'ready',setup_ready:true,guidance_key:params.guidance_key}}},
  playLanguage:async()=>'zh-Hans',occupations:async()=>occupations});
 assert.deepEqual(calls.map(row=>row.purpose),['bind','guidance']);
 assert.equal(calls[1].focus,undefined);
 assert.equal(calls[1].start_scene,'Roadside meeting');
 assert.equal(calls[1].guidance_key,await guidanceFingerprint({home,module_id:'book-1',opening:'Roadside meeting',play_language:'zh-Hans',occupations}));
 assert.equal(result.guidance_key,calls[1].guidance_key);
 assert.equal(result.setup_ready,true);
});

test('both PDF guidance owners receive the revised orientation and invalidate old prepared guidance',async t=>{
 const home=await mkdtemp(join(tmpdir(),'pdf-guidance-orientation-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const moduleDir=join(home,'.coc/modules/book-1'),contentRoot=join(home,'content');
 await mkdir(moduleDir,{recursive:true});await mkdir(join(contentRoot,'setup'),{recursive:true});
 await writeFile(join(moduleDir,'module.json'),JSON.stringify({id:'book-1',file_sha256:'a'.repeat(64)}));
 const sourceContent=new URL('../../content/',import.meta.url);
 for(const name of ['character-guidance.md','character-guidance-review.md','visual-guidance.md','source-reference-guidance.md'])await copyFile(new URL('setup/'+name,sourceContent),join(contentRoot,'setup',name));
 const options={home,contentRoot,module_id:'book-1',play_language:'en',occupations:[]};
 const current=await guidanceFingerprint(options);
 for(const name of ['visual-guidance.md','source-reference-guidance.md']){
  await writeFile(join(contentRoot,'setup',name),'Earlier guidance instructions.');
  assert.notEqual(await guidanceFingerprint(options),current,name+' must invalidate the source-bound cache');
  await copyFile(new URL('setup/'+name,sourceContent),join(contentRoot,'setup',name));
 }
 assert.equal(await guidanceFingerprint(options),current);
 const content=join(import.meta.dirname,'../../content');
 for(const phase of ['read','verify']){
  const instructions=await readerInstructionText(content,{phase,guidance:true});
  assert.ok(instructions.includes('## Player orientation'));
  assert.ok(instructions.includes('from the delivered opening alone'),'both phases must carry the independent delivery check');
 }
 const reference=await readerInstructionText(content,{phase:'read',reference:'guidance'});
 assert.ok(reference.includes('introduction must stand on its own'));
 assert.ok(reference.includes('not an investigation action'));
});
