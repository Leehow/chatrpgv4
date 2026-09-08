import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cardTexts,prepareCharacterPresentation} from '../../extensions/module/character-presentation.ts';
const sheet={name:'Helen',occupation:'Lawyer',age:28,era:'1920s',characteristics:{STR:20},derived:{HP:14,DB:'+1D4'},skills:{'Language (Other: Latin)':53},finance:{cash:{amount:60,currency:'USD'}},backstory:{traits:'Evidence first'},equipment:['Camera'],own_language:'English'};
test('presentation covers all UI and value text, skips numerical values and reuses changes of numbers',async()=>{
 const home=await mkdtemp(join(tmpdir(),'card-presentation-')),dir=join(home,'.coc/campaigns/c1/setup/drafts');await mkdir(dir,{recursive:true});
 const raw=JSON.stringify({play_language:'zh-Hans',sheet});await writeFile(join(dir,'1.json'),raw);
 await writeFile(join(dir,'2.json'),JSON.stringify({play_language:'zh-Hans',sheet:{...sheet,age:32,characteristics:{STR:60},finance:{cash:{amount:90,currency:'USD'}}}}));
 await writeFile(join(dir,'3.json'),JSON.stringify({play_language:'en',sheet}));
 let calls=0;const runner=async r=>{calls++;const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));assert.ok(!input.texts.includes('60'));assert.ok(!input.texts.includes('+1D4'));assert.ok(!input.texts.includes('Helen'));await writeFile(join(r.cwd,'presentation.json'),JSON.stringify({texts:Object.fromEntries(input.texts.map(t=>[t,`${input.play_language}:${t}`]))}));return {ok:true}};
 const options={home,campaign:'c1',revision:1,play_language:'zh-Hans',runner};
 const first=await prepareCharacterPresentation(options);assert.ok(first.texts.Parameter);assert.ok(first.texts.Lawyer);assert.ok(first.texts.USD);assert.ok(first.texts.traits);assert.ok(first.texts['Language (Other: Latin)']);
 assert.deepEqual(await prepareCharacterPresentation({...options,revision:2}),first);assert.equal(calls,1);
 await prepareCharacterPresentation({...options,revision:3,play_language:'en'});assert.equal(calls,2);
 assert.equal(await readFile(join(dir,'1.json'),'utf8'),raw);
 await assert.rejects(prepareCharacterPresentation({...options,campaign:'../other'}),/Invalid/);
});
test('incomplete text projection is refused',async()=>{
 const home=await mkdtemp(join(tmpdir(),'card-presentation-')),dir=join(home,'.coc/campaigns/c1/setup/drafts');await mkdir(dir,{recursive:true});await writeFile(join(dir,'1.json'),JSON.stringify({play_language:'zh-Hans',sheet}));
 await assert.rejects(prepareCharacterPresentation({home,campaign:'c1',revision:1,play_language:'zh-Hans',runner:async r=>{await writeFile(join(r.cwd,'presentation.json'),JSON.stringify({texts:{Parameter:'Parameter'}}));return {ok:true}}}),/Incomplete/);
});
