import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {preparePdfCreationGuidance} from '../../extensions/onboarding/pdf-guidance.ts';
import {guidanceFingerprint} from '../../extensions/module/character-guidance.ts';

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
