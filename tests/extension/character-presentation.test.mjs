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

test('clue words are localized once, grow with what is found, and never include a handle or an unfound clue',async()=>{
 const {prepareCluePresentation,clueTexts}=await import('../../extensions/module/character-presentation.ts');
 const home=await mkdtemp(join(tmpdir(),'clue-presentation-'));
 const summary='Corbitt can form pools of blood on floor, ceiling, or walls to frighten intruders away from his secret.';
 const view={play_language:'zh-Hans',turn:2,investigators:[sheet],clues:{
  discovered:[{clue:'blood-pool-manifest',label:'血泊',summary},{clue:'knott-commission',label:"Knott's commission"}],
  here:[{name:'hidden-villain',summary:'The villain is Corbitt.',discovered:false},{name:'blood-pool-manifest',summary,discovered:true}]}};
 const original=JSON.stringify(view);let calls=0;
 const runner=async r=>{calls++;const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));
  for(const hidden of ['blood-pool-manifest','knott-commission','hidden-villain','The villain is Corbitt.','2'])assert.ok(!input.texts.includes(hidden),hidden);
  await writeFile(join(r.cwd,'presentation.json'),JSON.stringify({finance_equipment:[],texts:Object.fromEntries(input.texts.map(t=>[t,t==='血泊'?t:`${input.play_language}:${t}`]))}));return {ok:true}};
 const options={home,campaign:'c1',play_language:'zh-Hans',view,runner};
 assert.deepEqual(clueTexts(view),[summary,"Knott's commission",'血泊']);
 const first=await prepareCluePresentation(options);
 assert.equal(first.texts[summary],`zh-Hans:${summary}`);assert.equal(first.texts["Knott's commission"],"zh-Hans:Knott's commission");assert.equal(first.texts['血泊'],'血泊');assert.equal(calls,1);
 assert.deepEqual(JSON.parse(await readFile(join(home,'.coc/campaigns/c1/setup/presentations/clues-zh-Hans.json'),'utf8')),first);
 assert.deepEqual(await prepareCluePresentation({...options,view:{...view,turn:3}}),first);assert.equal(calls,1);
 const found={clue:'knott-keys',label:'宅子钥匙',summary:'Knott hands over the keys to the Corbitt house.'};
 const next=await prepareCluePresentation({...options,view:{...view,clues:{discovered:[...view.clues.discovered,found]}}});
 assert.equal(calls,2);assert.equal(next.texts[summary],first.texts[summary]);assert.equal(next.texts[found.summary],`zh-Hans:${found.summary}`);
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
  assert.deepEqual(input.texts,['Cantonese','English','Latin']);
  await writeFile(join(r.cwd,'presentation.json'),JSON.stringify({texts:Object.fromEntries(input.texts.map(t=>[t,`${input.play_language}:${t}`]))}));
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
 const runner=async r=>{const input=JSON.parse(await readFile(join(r.cwd,'texts.json'),'utf8'));asked=input.texts;
  await writeFile(join(r.cwd,'presentation.json'),JSON.stringify({texts:Object.fromEntries(input.texts.map(t=>[t,`zh-Hans:${t}`]))}));return {ok:true}};
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
