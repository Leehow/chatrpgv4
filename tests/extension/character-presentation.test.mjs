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

test('a second investigator only asks for the words the language has never seen',async()=>{
 const home=await mkdtemp(join(tmpdir(),'card-vocabulary-')),dir=join(home,'.coc/campaigns/c1/setup/drafts');await mkdir(dir,{recursive:true});
 const other={...sheet,name:'Marcus',occupation:'Journalist',backstory:{traits:'Never off the record'},equipment:['Camera','Notebook']};
 await writeFile(join(dir,'1.json'),JSON.stringify({play_language:'zh-Hans',sheet}));
 await writeFile(join(dir,'2.json'),JSON.stringify({play_language:'zh-Hans',sheet:other}));
 const asked=[];const runner=async r=>{const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));asked.push(input.texts);
  await writeFile(join(r.cwd,'presentation.json'),JSON.stringify({finance_equipment:[],texts:Object.fromEntries(input.texts.map(t=>[t,`zh:${t}`]))}));return {ok:true}};
 const options={home,campaign:'c1',play_language:'zh-Hans',runner};
 const first=await prepareCharacterPresentation({...options,revision:1});
 const second=await prepareCharacterPresentation({...options,revision:2});
 assert.equal(asked.length,2);
 assert.ok(asked[0].includes('Parameter')&&asked[0].includes('Lawyer'));
 // The whole card was translated once. The second investigator's card is drawn from the same
 // vocabulary plus their own new words, so the shared chrome is never bought twice.
 assert.deepEqual(asked[1],['Journalist','Never off the record','Notebook']);
 assert.equal(second.texts.Parameter,first.texts.Parameter);
 assert.equal(second.texts.Journalist,'zh:Journalist');
 assert.ok(!('Lawyer' in second.texts),'a card carries only its own strings');
});

test('a round that drops a key keeps every word it got right and re-asks only the remainder',async()=>{
 const home=await mkdtemp(join(tmpdir(),'card-partial-')),dir=join(home,'.coc/campaigns/c1/setup/drafts');await mkdir(dir,{recursive:true});
 await writeFile(join(dir,'1.json'),JSON.stringify({play_language:'zh-Hans',sheet}));
 const asked=[];let calls=0;
 const result=await prepareCharacterPresentation({home,campaign:'c1',revision:1,play_language:'zh-Hans',runner:async r=>{
  calls++;const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));asked.push(input.texts);
  const supplied=calls===1?input.texts.filter(t=>t!=='Camera'):input.texts;
  await writeFile(join(r.cwd,'presentation.json'),JSON.stringify({finance_equipment:[],texts:Object.fromEntries(supplied.map(t=>[t,`zh:${t}`]))}));
  return {ok:true};
 }});
 assert.equal(calls,2);
 assert.deepEqual(asked[1],['Camera']);
 assert.ok(JSON.parse(await readFile(join(dir,'..','presentations','1-zh-Hans.json'),'utf8')).texts.Camera);
 assert.equal(result.texts.Camera,'zh:Camera');
 assert.equal(result.texts.Parameter,'zh:Parameter');
});

test('kernel glossary labels are context for the model, never a question put to it',async()=>{
 const home=await mkdtemp(join(tmpdir(),'card-known-')),dir=join(home,'.coc/campaigns/c1/setup/drafts');await mkdir(dir,{recursive:true});
 await writeFile(join(dir,'1.json'),JSON.stringify({play_language:'zh-Hans',sheet}));
 let packet;
 const result=await prepareCharacterPresentation({home,campaign:'c1',revision:1,play_language:'zh-Hans',
  known_labels:{STR:'力量','Language (Other: Latin)':'其他语言（拉丁语）',Unrelated:'无关'},
  runner:async r=>{packet=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));
   await writeFile(join(r.cwd,'presentation.json'),JSON.stringify({finance_equipment:[],texts:Object.fromEntries(packet.texts.map(t=>[t,`zh:${t}`]))}));return {ok:true}}});
 assert.ok(!packet.texts.includes('STR'));
 assert.ok(!packet.texts.includes('Language (Other: Latin)'));
 assert.deepEqual(packet.known_labels,{STR:'力量','Language (Other: Latin)':'其他语言（拉丁语）'});
 assert.equal(result.texts.STR,'力量');
 assert.equal(result.texts['Language (Other: Latin)'],'其他语言（拉丁语）');
});

test('possession words are localized once, grow with the kit, and never include what the Keeper wrote',async()=>{
 const {preparePossessionPresentation,possessionTexts}=await import('../../extensions/module/character-presentation.ts');
 const home=await mkdtemp(join(tmpdir(),'possession-presentation-'));
 const camera={name:'林岚的相机',category:'item',description:'一台木壳折叠相机。',parameters:{description:'一台木壳折叠相机。'},
  traits:[{name:'length',value:22,unit:'cm'},{name:'capacity',value:'12 exposures'},{name:'material',value:'mahogany, leather bellows'}],
  state:{condition:'intact',ammo:null,charges:null},container:'林岚的背包'};
 const view={play_language:'zh-Hans',turn:2,investigators:[{...sheet,objects:[camera]}]};
 const original=JSON.stringify(view);let calls=0;
 const runner=async r=>{calls++;const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));
  for(const hidden of ['林岚的相机','一台木壳折叠相机。','林岚的背包','22'])assert.ok(!input.texts.includes(hidden),hidden);
  await writeFile(join(r.cwd,'presentation.json'),JSON.stringify({finance_equipment:[],texts:Object.fromEntries(input.texts.map(t=>[t,`${input.play_language}:${t}`]))}));return {ok:true}};
 const options={home,campaign:'c1',play_language:'zh-Hans',view,runner};
 assert.deepEqual(possessionTexts(view),['12 exposures','capacity','cm','condition','intact','length','mahogany, leather bellows','material']);
 const first=await preparePossessionPresentation(options);
 assert.equal(first.texts.intact,'zh-Hans:intact');assert.equal(first.texts['mahogany, leather bellows'],'zh-Hans:mahogany, leather bellows');assert.equal(calls,1);
 assert.deepEqual(JSON.parse(await readFile(join(home,'.coc/campaigns/c1/setup/presentations/possessions-zh-Hans.json'),'utf8')),first);
 assert.deepEqual(await preparePossessionPresentation({...options,view:{...view,turn:3}}),first);assert.equal(calls,1);
 const damaged={...camera,state:{...camera.state,condition:'damaged'}};
 const next=await preparePossessionPresentation({...options,view:{...view,investigators:[{...sheet,objects:[damaged]}]}});
 assert.equal(calls,2);assert.equal(next.texts.intact,first.texts.intact);assert.equal(next.texts.damaged,'zh-Hans:damaged');
 assert.equal(JSON.stringify(view),original);
 await assert.rejects(preparePossessionPresentation({...options,view:{...view,play_language:'en'}}),/language/);
 assert.deepEqual(possessionTexts({investigators:[{objects:[{traits:[{name:'重量',value:2.4,unit:'公斤'}],state:{condition:'intact'}}]}]}),['condition','intact','公斤','重量']);
});
