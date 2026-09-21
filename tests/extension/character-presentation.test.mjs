import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cardTexts,prepareCharacterPresentation} from '../../extensions/module/character-presentation.ts';
import {PRESENTATION_REFERENCE_PROTOCOL} from '../../runtime/jev/presentation-references.ts';
const inputTexts=packet=>packet.sources.map(source=>source.text);
const presentation=(packet,{drop=[],keep=[],translate=text=>`${packet.play_language}:${text}`,finance=[]}={})=>({
 protocol:PRESENTATION_REFERENCE_PROTOCOL,
 texts:packet.sources.filter(source=>!drop.includes(source.text)).map(source=>keep.includes(source.text)
  ?{source:source.alias,action:'keep'}:{source:source.alias,action:'translate',text:translate(source.text)}),
 finance_equipment_sources:packet.equipment_sources.filter(alias=>finance.includes(packet.sources.find(source=>source.alias===alias)?.text)),
});
const sheet={name:'Helen',occupation:'Lawyer',age:28,era:'1920s',characteristics:{STR:20},derived:{HP:14,DB:'+1D4'},skills:{'Language (Other: Latin)':53},finance:{cash:{amount:60,currency:'USD'}},backstory:{traits:'Evidence first'},equipment:['Camera'],own_language:'English'};
test('presentation covers all UI and value text, skips numerical values and reuses changes of numbers',async()=>{
 const home=await mkdtemp(join(tmpdir(),'card-presentation-')),dir=join(home,'.coc/campaigns/c1/setup/drafts');await mkdir(dir,{recursive:true});
 const raw=JSON.stringify({play_language:'zh-Hans',sheet});await writeFile(join(dir,'1.json'),raw);
 await writeFile(join(dir,'2.json'),JSON.stringify({play_language:'zh-Hans',sheet:{...sheet,age:32,characteristics:{STR:60},finance:{cash:{amount:90,currency:'USD'}}}}));
 await writeFile(join(dir,'3.json'),JSON.stringify({play_language:'en',sheet}));
 let calls=0;const runner=async r=>{calls++;const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));const texts=inputTexts(input);assert.ok(!texts.includes('60'));assert.ok(!texts.includes('+1D4'));assert.ok(!texts.includes('Helen'));await writeFile(join(r.cwd,'presentation.json'),JSON.stringify(presentation(input)));return {ok:true}};
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
  const valid=JSON.stringify(presentation(input,{keep:inputTexts(input)}));
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
 const runner=async r=>{calls++;const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));const texts=inputTexts(input);assert.ok(!texts.includes('Hidden villain'));assert.ok(!texts.includes('office-id'));assert.ok(!texts.includes('2'));await writeFile(join(r.cwd,'presentation.json'),JSON.stringify(presentation(input)));return {ok:true}};
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
  const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));
  assert.deepEqual(input.equipment_sources.map(alias=>input.sources.find(source=>source.alias===alias).text),[...equipment].sort());
  await writeFile(join(r.cwd,'presentation.json'),JSON.stringify(presentation(input,{keep:inputTexts(input),finance:['Some cash']})));return {ok:true};
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
 const asked=[];const runner=async r=>{const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));asked.push(inputTexts(input));
  await writeFile(join(r.cwd,'presentation.json'),JSON.stringify(presentation(input,{translate:text=>`zh:${text}`})));return {ok:true}};
 const options={home,campaign:'c1',play_language:'zh-Hans',runner};
 const first=await prepareCharacterPresentation({...options,revision:1});
 const second=await prepareCharacterPresentation({...options,revision:2});
 assert.equal(asked.length,2);
 assert.ok(asked[0].includes('Parameter')&&asked[0].includes('Lawyer'));
 // The whole card was translated once. The second investigator's card is drawn from the same
 // vocabulary plus their own new words, so the shared chrome is never bought twice.
 assert.deepEqual(asked[1],['Journalist','Never off the record','Notebook','Camera'],
  'the cached Camera translation is not rewritten; its stable alias is present only so finance classification can select it');
 assert.equal(second.texts.Parameter,first.texts.Parameter);
 assert.equal(second.texts.Journalist,'zh:Journalist');
 assert.ok(!('Lawyer' in second.texts),'a card carries only its own strings');
});

test('a round that drops a key keeps every word it got right and re-asks only the remainder',async()=>{
 const home=await mkdtemp(join(tmpdir(),'card-partial-')),dir=join(home,'.coc/campaigns/c1/setup/drafts');await mkdir(dir,{recursive:true});
 await writeFile(join(dir,'1.json'),JSON.stringify({play_language:'zh-Hans',sheet}));
 const asked=[];let calls=0;
 const result=await prepareCharacterPresentation({home,campaign:'c1',revision:1,play_language:'zh-Hans',runner:async r=>{
  calls++;const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));asked.push(inputTexts(input));
  await writeFile(join(r.cwd,'presentation.json'),JSON.stringify(presentation(input,{drop:calls===1?['Camera']:[],translate:text=>`zh:${text}`})));
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
   await writeFile(join(r.cwd,'presentation.json'),JSON.stringify(presentation(packet,{translate:text=>`zh:${text}`})));return {ok:true}}});
 assert.ok(!inputTexts(packet).includes('STR'));
 assert.ok(!inputTexts(packet).includes('Language (Other: Latin)'));
 assert.equal(packet.known_labels,undefined,'settled labels do not enter the model packet');
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
  for(const hidden of ['林岚的相机','一台木壳折叠相机。','林岚的背包','22'])assert.ok(!inputTexts(input).includes(hidden),hidden);
  await writeFile(join(r.cwd,'presentation.json'),JSON.stringify(presentation(input)));return {ok:true}};
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

test('journal words are the names and stamped scenes, never the lane\'s own prose',async()=>{
 const {prepareJournalPresentation,journalTexts}=await import('../../extensions/module/character-presentation.ts');
 const home=await mkdtemp(join(tmpdir(),'journal-presentation-'));
 const description='一位律师，办公室的主人家。神情冷静。';
 const exchange='他收回被误拿的租约，并问先去现场还是先查纸面。';
 const label='凉棚下牙口不好的中等个';
 const view={play_language:'zh-Hans',turn:4,npcs:{journal:[
  {name:'Steven Knott',description,dead_since_turn:null,exchanges:[
   {turn:1,scene:"Knott's Office",summary:exchange},{turn:2,scene:'科比特宅',summary:'他把钥匙推到桌沿。'}]},
  {name:'Gabriela Macario',description:'邻居。',exchanges:[]},
  // §103: a row the player knows only by the lane's label carries that label as `name`, in the play language already.
  {name:label,named:false,description:'帽檐压得很低。',exchanges:[{turn:3,scene:'加油站',summary:'他瞥了一眼。'}]}]}};
 const original=JSON.stringify(view);let calls=0;
 const runner=async r=>{calls++;const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));
  for(const hidden of [description,exchange,'他把钥匙推到桌沿。','邻居。','1','2',label,'帽檐压得很低。','他瞥了一眼。'])assert.ok(!inputTexts(input).includes(hidden),hidden);
  await writeFile(join(r.cwd,'presentation.json'),JSON.stringify(presentation(input,{keep:['科比特宅']})));return {ok:true}};
 const options={home,campaign:'c1',play_language:'zh-Hans',view,runner};
 assert.deepEqual(journalTexts(view),['Gabriela Macario',"Knott's Office",'Steven Knott','加油站','科比特宅']);
 const first=await prepareJournalPresentation(options);
 assert.equal(first.texts['Steven Knott'],'zh-Hans:Steven Knott');assert.equal(first.texts["Knott's Office"],"zh-Hans:Knott's Office");
 assert.equal(first.texts['科比特宅'],'科比特宅');assert.equal(calls,1);
 assert.deepEqual(JSON.parse(await readFile(join(home,'.coc/campaigns/c1/setup/presentations/journal-zh-Hans.json'),'utf8')),first);
 assert.deepEqual(await prepareJournalPresentation({...options,view:{...view,turn:5}}),first);assert.equal(calls,1);
 const met={name:'Rupert Merriweather',exchanges:[{turn:5,scene:'波士顿公共图书馆',summary:'他翻出旧档案。'}]};
 const next=await prepareJournalPresentation({...options,view:{...view,npcs:{journal:[...view.npcs.journal,met]}}});
 assert.equal(calls,2);assert.equal(next.texts['Steven Knott'],first.texts['Steven Knott']);
 assert.equal(next.texts['Rupert Merriweather'],'zh-Hans:Rupert Merriweather');
 assert.equal(JSON.stringify(view),original);
 assert.deepEqual(journalTexts({npcs:{journal:[]}}),[]);assert.deepEqual(journalTexts({}),[]);
});

test('identity words are the setup model\'s sex, never the player\'s prose, and grow with the table',async()=>{
 const {prepareIdentityPresentation,identityTexts}=await import('../../extensions/module/character-presentation.ts');
 const home=await mkdtemp(join(tmpdir(),'identity-presentation-'));
 // The prose the player wrote (occupation_stated, concept) and the card's figures stay out;
 // an unset, blank or figure-only sex is nothing to ask. What remains is the one identity word
 // the setup model drafted, whatever language it drafted it in.
 const view={play_language:'zh-Hans',investigators:[
  {name:'艾琳',sex:'Female',occupation_stated:'律师',backstory:{concept:' evidence-first lawyer '}},
  {name:'苏散',sex:'女'},
  {name:'Figure',sex:'25'},
  {name:'Blank',sex:'  '},
  {name:'Unset'}]};
 assert.deepEqual(identityTexts(view),['Female','女']);
 const original=JSON.stringify(view);let calls=0;
 const runner=async r=>{calls++;const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));
  for(const hidden of ['律师','evidence-first lawyer','25'])assert.ok(!inputTexts(input).includes(hidden),hidden);
  await writeFile(join(r.cwd,'presentation.json'),JSON.stringify(presentation(input,{keep:['女']})));return {ok:true}};
 const options={home,campaign:'c1',play_language:'zh-Hans',view,runner};
 const first=await prepareIdentityPresentation(options);
 assert.equal(first.texts.Female,'zh-Hans:Female');assert.equal(first.texts['女'],'女');assert.equal(calls,1);
 assert.deepEqual(JSON.parse(await readFile(join(home,'.coc/campaigns/c1/setup/presentations/identity-zh-Hans.json'),'utf8')),first);
 // What the file has is kept: the same view asks nothing again, and a newly drafted card pays
 // for its own word only.
 assert.deepEqual(await prepareIdentityPresentation({...options,view:{...view,turn:9}}),first);assert.equal(calls,1);
 const next=await prepareIdentityPresentation({...options,view:{...view,investigators:[...view.investigators,{name:'新卡',sex:'Nonbinary'}]}});
 assert.equal(calls,2);assert.equal(next.texts.Female,first.texts.Female);assert.equal(next.texts.Nonbinary,'zh-Hans:Nonbinary');
 assert.equal(JSON.stringify(view),original);
 assert.deepEqual(identityTexts({investigators:[]}),[]);assert.deepEqual(identityTexts({}),[]);
});

test('clue words are the names the table filed, never the book\'s sentence, a handle or an unfound clue',async()=>{
 const {prepareCluePresentation,clueTexts}=await import('../../extensions/module/character-presentation.ts');
 const home=await mkdtemp(join(tmpdir(),'clue-presentation-'));
 // §80: the module's own sentence about a clue is Keeper material and no longer reaches a player
 // row, so it is not a word this lane has to project. `how` does reach the row, and is still not
 // asked: the Keeper wrote it at this table in the play language, like the journal's own prose.
 const summary='Corbitt can form pools of blood on floor, ceiling, or walls to frighten intruders away from his secret.';
 const how='她蹲下去看地板上那摊东西。';
 const view={play_language:'zh-Hans',turn:2,investigators:[sheet],clues:{
  discovered:[{clue:'blood-pool-manifest',label:'血泊',how},{clue:'knott-commission',label:"Knott's commission"}],
  here:[{name:'hidden-villain',summary:'The villain is Corbitt.',discovered:false},{name:'blood-pool-manifest',label:'血泊',discovered:true}]}};
 const original=JSON.stringify(view);let calls=0;
 const runner=async r=>{calls++;const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));
  for(const hidden of ['blood-pool-manifest','knott-commission','hidden-villain','The villain is Corbitt.',summary,how,'2'])assert.ok(!inputTexts(input).includes(hidden),hidden);
  await writeFile(join(r.cwd,'presentation.json'),JSON.stringify(presentation(input,{keep:['血泊']})));return {ok:true}};
 const options={home,campaign:'c1',play_language:'zh-Hans',view,runner};
 assert.deepEqual(clueTexts(view),["Knott's commission",'血泊']);
 const first=await prepareCluePresentation(options);
 assert.equal(first.texts["Knott's commission"],"zh-Hans:Knott's commission");assert.equal(first.texts['血泊'],'血泊');assert.equal(calls,1);
 assert.equal(first.texts[summary],undefined,'the book\'s sentence was never a word this lane had');
 assert.deepEqual(JSON.parse(await readFile(join(home,'.coc/campaigns/c1/setup/presentations/clues-zh-Hans.json'),'utf8')),first);
 assert.deepEqual(await prepareCluePresentation({...options,view:{...view,turn:3}}),first);assert.equal(calls,1);
 const found={clue:'knott-keys',label:'宅子钥匙',how:'诺特把钥匙放在桌上。'};
 const next=await prepareCluePresentation({...options,view:{...view,clues:{discovered:[...view.clues.discovered,found]}}});
 assert.equal(calls,2);assert.equal(next.texts["Knott's commission"],first.texts["Knott's commission"]);assert.equal(next.texts[found.label],`zh-Hans:${found.label}`);
 assert.equal(next.texts[found.how],undefined,'and the account it was found by is not asked either');
 assert.equal(JSON.stringify(view),original);
 await assert.rejects(prepareCluePresentation({...options,view:{...view,play_language:'en'}}),/language/);
 assert.deepEqual(clueTexts({clues:{discovered:[]}}),[]);assert.deepEqual(clueTexts({}),[]);
});
test('a language name is asked once per language, and only the name is asked',async()=>{
 const {prepareLanguagePresentation,languageTexts}=await import('../../extensions/module/character-presentation.ts');
 const home=await mkdtemp(join(tmpdir(),'language-presentation-'));
 // The three key shapes the catalog writes, beside the required field that names the native tongue.
 const skills={'Language (Own)':80,'Language (Other: English)':40,'Language (Latin)':25,'Spot Hidden':55};
 const view={play_language:'zh-Hans',investigators:[{name:'Helen',own_language:'Cantonese',skills}]};
 const original=JSON.stringify(view);let calls=0;
 const runner=async r=>{
  calls++;
  const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));
  // Every name, no number, and no skill that is not a language.
  assert.deepEqual(inputTexts(input),['Cantonese','English','Latin']);
  await writeFile(join(r.cwd,'presentation.json'),JSON.stringify(presentation(input)));
  return {ok:true};
 };
 const options={home,campaign:'c1',play_language:'zh-Hans',view,runner};
 const first=await prepareLanguagePresentation(options);
 assert.equal(first.texts.Latin,'zh-Hans:Latin');
 assert.equal(first.texts.Cantonese,'zh-Hans:Cantonese');
 // A second read of the same words asks nothing.
 assert.deepEqual(await prepareLanguagePresentation(options),first);
 assert.equal(calls,1);
 assert.equal(JSON.stringify(view),original);
 // `Language (Own: X)` is the shape a card carries when it names its own tongue in the key.
 assert.deepEqual(languageTexts({investigators:[{skills:{'Language (Own: Cantonese)':70}}]}),['Cantonese']);
 // A sheet that names no tongue and holds no other language asks for nothing.
 assert.deepEqual(languageTexts({investigators:[{skills:{'Language (Own)':80}}]}),[]);
 assert.deepEqual(languageTexts({}),[]);
});

test('a handed-over handout is asked as one document, with the heading the kernel wrote above it',async()=>{
 const {prepareHandoutPresentation,handoutInput,handoutTexts}=await import('../../extensions/module/character-presentation.ts');
 const home=await mkdtemp(join(tmpdir(),'handout-presentation-'));
 const folder=join(home,'.coc/campaigns/c1/handouts');await mkdir(folder,{recursive:true});
 const display='Handout 2: Unpublished Boston Globe Story (1918)';
 // Exactly what `apply handout` writes: `# <display>\n\n<body>\n`.
 const text=`# ${display}\n\nHOUSE ON SHEAFE STREET LEAVES A RECORD OF MISFORTUNE\n\nThe Macario family took the house early in 1918.\n`;
 await writeFile(join(folder,'globe-unpublished-1918.md'),text);
 await writeFile(join(folder,'empty.md'),'   \n');
 await writeFile(join(folder,'map.png'),'not markdown');
 // The heading is read back, never guessed out of the prose; a blank card and a non-markdown
 // attachment contribute nothing.
 assert.deepEqual(await handoutInput(home,'c1'),[{name:display,text}]);
 assert.deepEqual(await handoutInput(home,'never-played'),[]);
 await assert.rejects(handoutInput(home,'../escape'),/Invalid presentation request/);
 // One string for the whole document: a newspaper column translated a line at a time stops being
 // a newspaper column. The name is asked beside it, for the row the document folds under.
 assert.deepEqual(handoutTexts({handouts:[{name:display,text}]}),[display,text].sort());
 assert.deepEqual(handoutTexts({}),[]);
 assert.deepEqual(handoutTexts({handouts:[{name:null,text:'  '}]}),[]);

 let asked=null;
 const runner=async r=>{const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));asked=inputTexts(input);
  await writeFile(join(r.cwd,'presentation.json'),JSON.stringify(presentation(input)));return {ok:true}};
 const saved=await prepareHandoutPresentation({home,campaign:'c1',play_language:'zh-Hans',runner});
 assert.deepEqual(asked.sort(),[display,text].sort());
 assert.equal(saved.texts[text],`zh-Hans:${text}`);
 assert.deepEqual(JSON.parse(await readFile(join(home,'.coc/campaigns/c1/setup/presentations/handouts-zh-Hans.json'),'utf8')),saved);
 // A second delivery of the same document asks for nothing.
 asked=null;
 assert.deepEqual(await prepareHandoutPresentation({home,campaign:'c1',play_language:'zh-Hans',runner}),saved);
 assert.equal(asked,null);
});

test("a failed card round names what the child said, not only that the card failed",async()=>{
 // The run that dies on an unresolvable model writes no events at all; its one actionable line is
 // the child's own, and the player used to be shown the lane's generic sentence instead.
 const home=await mkdtemp(join(tmpdir(),'card-cause-')),dir=join(home,'.coc/campaigns/c1/setup/drafts');await mkdir(dir,{recursive:true});
 await writeFile(join(dir,'1.json'),JSON.stringify({play_language:'zh-Hans',sheet}));
 const options={home,campaign:'c1',revision:1,play_language:'zh-Hans'};
 await assert.rejects(prepareCharacterPresentation({...options,
  runner:async()=>({ok:false,code:1,timedOut:false,stderr:'Error: Model "deepseek-extended/deepseek-flash" not found. Use --list-models to see available models.\n'})}),
  error=>{
   assert.match(error.message,/Card presentation could not be prepared/);
   assert.match(error.message,/deepseek-extended\/deepseek-flash/);
   assert.match(error.message,/not found/);
   return true;
  });
 await assert.rejects(prepareCharacterPresentation({...options,
  runner:async()=>({ok:false,code:null,timedOut:true,stderr:''})}),/timed out/);
 // With nothing to add, the lane's own sentence stands alone rather than trailing an empty clause.
 await assert.rejects(prepareCharacterPresentation({...options,
  runner:async()=>({ok:false,code:null,timedOut:false,stderr:''})}),
  error=>{assert.equal(/\(/.test(error.message),false);return true;});
});

const OK={ok:true,code:0,timedOut:false,ms:1,stderr:'',command:[]};
const json=async path=>JSON.parse(await readFile(path,'utf8'));
async function cardFixture(t) {
 const home=await mkdtemp(join(tmpdir(),'card-attempt-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const drafts=join(home,'.coc/campaigns/c1/setup/drafts');
 await mkdir(drafts,{recursive:true});
 await writeFile(join(drafts,'1.json'),JSON.stringify({play_language:'en',sheet}));
 const instructions=await readFile(new URL('../../content/setup/character-presentation.md',import.meta.url),'utf8');
 const directory=join(home,'.coc/character-presentations');
 const digest=createHash('sha256').update(instructions).digest('hex').slice(0,8);
 const kit=createHash('sha256').update(JSON.stringify(['en',['Camera']])).digest('hex').slice(0,32);
 return {options:{home,campaign:'c1',revision:1,play_language:'en'},directory,
  vocabulary:join(directory,`vocabulary-en-${digest}.json`),finance:join(directory,`equipment-en-${kit}.json`),
  projection:join(home,'.coc/campaigns/c1/setup/presentations/1-en.json')};
}

for(const ending of ['rejected','provider','cancel']) test(`card round vocabulary and kit survive a ${ending} second round`,async t=>{
 const {options,directory,vocabulary,finance,projection}=await cardFixture(t);
 const controller=new AbortController();let calls=0,attempt;
 const runner=async request=>{
  calls++;attempt=request.cwd;
  assert.equal(request.model,'owner/card');assert.equal(request.thinking,'high');
  assert.strictEqual(request.signal,controller.signal);assert.equal(request.timeoutMs,120000);
  assert.equal(request.eventLog,join(attempt,`events-${calls}.jsonl`));
  assert.ok(request.systemPrompt.endsWith('setup/character-presentation.md'));
  assert.match(await readFile(join(attempt,'check.mjs'),'utf8'),/validateFinanceEquipment/);
  await writeFile(request.eventLog,`round ${calls}\n`);
  const packet=await json(join(attempt,'texts.json'));
  if(calls===1) {
   await writeFile(join(attempt,'presentation.json'),JSON.stringify(presentation(packet,{drop:['Camera'],translate:word=>`kept:${word}`})));
   return OK;
  }
  assert.deepEqual(inputTexts(packet),['Camera']);assert.equal(packet.finance_equipment_required,false);
  assert.equal((await json(vocabulary)).texts.Parameter,'kept:Parameter');
  assert.deepEqual(await json(finance),{play_language:'en',equipment:['Camera'],finance_equipment:[]});
  assert.deepEqual((await json(join(attempt,'findings.json'))).sources,[packet.sources[0].alias]);
  await assert.rejects(readFile(projection),{code:'ENOENT'});
  assert.match(request.brief,/Read findings.json/);
  if(ending==='provider')return {...OK,ok:false,code:1,stderr:'Error: owner unavailable'};
  if(ending==='cancel') {
   await writeFile(join(attempt,'presentation.json'),JSON.stringify({texts:{Camera:'must not commit'}}));
   controller.abort();return OK;
  }
  await writeFile(join(attempt,'presentation.json'),'{}');return OK;
 };
 await assert.rejects(prepareCharacterPresentation({...options,runner,model:'owner/card',thinking:'high',signal:controller.signal}),error=>{
  assert.equal(error.code,ending==='cancel'?'presentation_timeout':'preparation_failed');
  if(ending==='provider')assert.match(error.message,/owner unavailable/);
  else if(ending==='cancel')assert.equal(error.message,'Card presentation could not be prepared');
  else assert.equal(error.message,'Incomplete card presentation: 1 text were not projected');
  return true;
 });
 assert.equal(calls,2);
 assert.equal((await json(vocabulary)).texts.Camera,undefined);
 await assert.rejects(readFile(projection),{code:'ENOENT'});
 assert.equal((await json(join(attempt,'presentation-round-1.json'))).texts.find(row=>row.source==='text:0').action,'translate');
 if(ending==='rejected')assert.equal(await readFile(join(attempt,'presentation-round-2.json'),'utf8'),'{}');
 else await assert.rejects(readFile(join(attempt,'presentation-round-2.json')),{code:'ENOENT'});
 const fixed=await prepareCharacterPresentation({...options,runner:async request=>{
  const packet=await json(join(request.cwd,'texts.json'));
  assert.deepEqual(inputTexts(packet),['Camera']);assert.equal(packet.finance_equipment_required,false);
  await writeFile(join(request.cwd,'presentation.json'),JSON.stringify(presentation(packet,{translate:()=> 'repaired'})));return OK;
 }});
 assert.equal(fixed.texts.Parameter,'kept:Parameter');assert.equal(fixed.texts.Camera,'repaired');
 assert.deepEqual(await prepareCharacterPresentation(options),fixed,'accepted caches require no runner');
 assert.equal((await readdir(directory)).filter(file=>file.endsWith('.tmp')).length,0);
});

for(const repaired of [false,true]) test(`financial validation retries independently of accepted words (repaired=${repaired})`,async t=>{
 const {options,vocabulary,finance}=await cardFixture(t);let calls=0;
 const task=prepareCharacterPresentation({...options,runner:async request=>{
  calls++;const packet=await json(join(request.cwd,'texts.json'));
  if(calls===2) {
   assert.deepEqual(inputTexts(packet),['Camera']);assert.equal(packet.finance_equipment_required,true);
   assert.match(request.brief,/only the financial equipment alias subset/);
   assert.ok((await json(vocabulary)).texts.Parameter);
   await assert.rejects(readFile(finance),{code:'ENOENT'});
   const findings=await json(join(request.cwd,'findings.json'));
   assert.equal(findings.finance_equipment_required,true);assert.deepEqual(findings.sources,[packet.sources[0].alias]);
   assert.match(findings.error,/Invalid financial equipment projection/);
  }
  const value=presentation(packet,{keep:inputTexts(packet)});
  value.finance_equipment_sources=calls===2&&repaired?[]:['text:999'];
  await writeFile(join(request.cwd,'presentation.json'),JSON.stringify(value));
  return OK;
 }});
 if(repaired)assert.deepEqual((await task).finance_equipment,[]);
 else {
  await assert.rejects(task,{code:'preparation_failed',message:'Invalid financial equipment projection'});
  await assert.rejects(readFile(finance),{code:'ENOENT'});
  const result=await prepareCharacterPresentation({...options,runner:async request=>{
   const packet=await json(join(request.cwd,'texts.json'));
   assert.deepEqual(inputTexts(packet),['Camera']);assert.equal(packet.finance_equipment_required,true);
   await writeFile(join(request.cwd,'presentation.json'),JSON.stringify(presentation(packet,{keep:inputTexts(packet)})));return OK;
  }});
  assert.deepEqual(result.finance_equipment,[]);
 }
 assert.equal(calls,2);assert.equal((await json(vocabulary)).texts.Parameter,'Parameter');
 assert.deepEqual((await prepareCharacterPresentation(options)).finance_equipment,[]);
});

for(const ending of ['malformed','missing','throw']) test(`card ${ending} output retains its error and artifact policy`,async t=>{
 const {options,vocabulary,finance}=await cardFixture(t);let calls=0,attempt;
 const expected=new Error('owner runner threw');
 await assert.rejects(prepareCharacterPresentation({...options,runner:async request=>{
  calls++;attempt=request.cwd;
  if(ending==='throw')throw expected;
  if(ending==='malformed')await writeFile(join(attempt,'presentation.json'),'not JSON\n');
  return OK;
 }}),error=>{
  if(ending==='throw')assert.strictEqual(error,expected);
  else assert.equal(error.code,ending==='missing'?'ENOENT':'preparation_failed');
  return true;
 });
 assert.equal(calls,ending==='malformed'?2:1);
 await assert.rejects(readFile(vocabulary),{code:'ENOENT'});
 await assert.rejects(readFile(finance),{code:'ENOENT'});
 if(ending==='malformed') {
  for(const round of [1,2])assert.equal(await readFile(join(attempt,`presentation-round-${round}.json`),'utf8'),'not JSON\n');
  assert.match((await json(join(attempt,'findings.json'))).error,/SyntaxError/);
 } else await assert.rejects(readFile(join(attempt,'findings.json')),{code:'ENOENT'});
});

test('a fully known standing projection bypasses the runner and attempt creation',async t=>{
 const {prepareStandingPresentation}=await import('../../extensions/module/character-presentation.ts');
 const {options,directory}=await cardFixture(t);
 const result=await prepareStandingPresentation({...options,view:{play_language:'en',present:['Known person']},known_labels:{'Known person':'Settled name'}});
 assert.deepEqual(result.texts,{'Known person':'Settled name'});
 await assert.rejects(readdir(join(directory,'attempts')),{code:'ENOENT'});
});

/**
 * A book set in a year the rulebook never tabulated builds its card off the table's own nominated
 * column, and the kernel records what that column stood in for (§23.4). The card says so beside the
 * numbers, which it can only do in the player's language if the projection is asked for the two
 * captions and for the book's own words -- the authored setting is prose, not a rules identifier,
 * so nothing else in the card's vocabulary carries it.
 */
test('the card asks its projection for the substitution it has to say, and only when there is one',()=>{
 const era='1895 (default); investigators then reach the night before the 1287 storm';
 const asked=cardTexts({...sheet,finance:{...sheet.finance,period:'1920s',substituted_for:era}});
 for(const key of ['finance_period','substituted_for',era]) assert.ok(asked.includes(key),`the card cannot say ${key} in the play language`);
 assert.ok(!cardTexts(sheet).includes(era),'a card with no substitution does not carry another card\'s setting');
 assert.ok(cardTexts(sheet).includes('finance_period'),'the captions themselves are always projected, so a card never half-says it');
});
