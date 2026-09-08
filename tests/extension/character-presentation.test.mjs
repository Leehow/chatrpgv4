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
 let calls=0;const runner=async r=>{calls++;const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));assert.ok(!input.texts.includes('60'));assert.ok(!input.texts.includes('+1D4'));assert.ok(!input.texts.includes('Helen'));await writeFile(join(r.cwd,'presentation.json'),JSON.stringify({finance_equipment:[],texts:Object.fromEntries(input.texts.map(t=>[t,`${input.play_language}:${t}`]))}));return {ok:true}};
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
test('malformed presentation is repaired by the agent without changing the card',async()=>{
 const home=await mkdtemp(join(tmpdir(),'card-repair-')),dir=join(home,'.coc/campaigns/c1/setup/drafts');await mkdir(dir,{recursive:true});
 const original=JSON.stringify({play_language:'en',sheet});await writeFile(join(dir,'1.json'),original);
 let calls=0;
 const result=await prepareCharacterPresentation({home,campaign:'c1',revision:1,play_language:'en',runner:async r=>{
  calls++;const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));
  const valid=JSON.stringify({texts:Object.fromEntries(input.texts.map(t=>[t,t])),finance_equipment:[]});
  if(calls===2)assert.ok(JSON.parse(await readFile(join(r.cwd,'findings.json'),'utf8')).error);
  await writeFile(join(r.cwd,'presentation.json'),calls===1?valid+'\ntrailing prose':valid);
  return {ok:true};
 }});
 assert.equal(calls,2);assert.equal(result.texts.Lawyer,'Lawyer');
 assert.equal(await readFile(join(dir,'1.json'),'utf8'),original);
});

test('standing names are localized once, grow with visible people and never include hidden content',async()=>{
 const {prepareStandingPresentation,standingTexts}=await import('../../extensions/module/character-presentation.ts');
 const home=await mkdtemp(join(tmpdir(),'standing-presentation-'));
 const view={play_language:'zh-Hans',scene:{name:'office-id',display_name:"Knott's Office"},present:['Steven Knott'],turn:2,investigators:[sheet],clues:{here:[{name:'Hidden villain'}]}};
 const original=JSON.stringify(view);let calls=0;
 const runner=async r=>{calls++;const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));assert.ok(!input.texts.includes('Hidden villain'));assert.ok(!input.texts.includes('office-id'));assert.ok(!input.texts.includes('2'));await writeFile(join(r.cwd,'presentation.json'),JSON.stringify({finance_equipment:[],texts:Object.fromEntries(input.texts.map(t=>[t,`${input.play_language}:${t}`]))}));return {ok:true}};
 const options={home,campaign:'c1',play_language:'zh-Hans',view,runner};
 const first=await prepareStandingPresentation(options);assert.deepEqual(standingTexts(view),["Knott's Office",'Steven Knott']);
 assert.deepEqual(await prepareStandingPresentation({...options,view:{...view,turn:3}}),first);assert.equal(calls,1);
 const next=await prepareStandingPresentation({...options,view:{...view,present:['Steven Knott','Another Visitor']}});assert.equal(calls,2);assert.equal(next.texts['Steven Knott'],first.texts['Steven Knott']);assert.ok(next.texts['Another Visitor']);
 await prepareStandingPresentation({...options,play_language:'en',view:{...view,play_language:'en'}});assert.equal(calls,3);
 assert.equal(JSON.stringify(view),original);
 assert.ok(cardTexts({...sheet,derived:{DB:'none'}}).includes('none'));
});

test('explanation rule rows match recorded movement and damage results without rebuilding the card',async()=>{
 const {creationRuleDetails}=await import('../../extensions/module/character-presentation.ts');
 const sheet={creation:{age:{mov_penalty:2},derived:{MOV:'movement-rate.rules both_str_and_dex_less_than_siz - age penalty 2',DB:'damage-bonus-build STR+SIZ=85'}},derived:{MOV:5,DB:'none',BUILD:0}};
 const before=JSON.stringify(sheet),result=await creationRuleDetails(sheet);
 assert.deepEqual(result.movement,{condition:'both STR and DEX lower than SIZ',base:7,penalty:2});
 assert.deepEqual(result.damage_bonus,{total:85,min:85,max:124});
 assert.deepEqual(await creationRuleDetails({...sheet,derived:{MOV:9,DB:'+1D4',BUILD:1}}),{});
 assert.equal(JSON.stringify(sheet),before);
});

test('financial exclusions must be an exact equipment subset and are preserved in cached projections',async()=>{
 const {validateFinanceEquipment}=await import('../../extensions/module/character-presentation.ts');
 const equipment=['Some cash','Wallet','Collectible coin'];
 assert.deepEqual(validateFinanceEquipment({finance_equipment:['Some cash']},equipment),['Some cash']);
 assert.throws(()=>validateFinanceEquipment({finance_equipment:['Invented']},equipment));
 assert.throws(()=>validateFinanceEquipment({finance_equipment:['Some cash','Some cash']},equipment));
 const home=await mkdtemp(join(tmpdir(),'cash-projection-')),dir=join(home,'.coc/campaigns/c1/setup/drafts');await mkdir(dir,{recursive:true});
 const raw=JSON.stringify({play_language:'en',sheet:{...sheet,equipment}});await writeFile(join(dir,'1.json'),raw);
 const options={home,campaign:'c1',revision:1,play_language:'en',runner:async r=>{
  const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));assert.deepEqual(input.equipment,[...equipment].sort());
  await writeFile(join(r.cwd,'presentation.json'),JSON.stringify({texts:Object.fromEntries(input.texts.map(t=>[t,t])),finance_equipment:['Some cash']}));return {ok:true};
 }};
 const result=await prepareCharacterPresentation(options);assert.deepEqual(result.finance_equipment,['Some cash']);
 assert.deepEqual(await prepareCharacterPresentation({...options,runner:async()=>{throw Error('Unexpected model call')}}),result);
 assert.equal(await readFile(join(dir,'1.json'),'utf8'),raw);
});
