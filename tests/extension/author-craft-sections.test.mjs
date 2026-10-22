/** §254: author sections are declared by packages and reach only the sole author, chosen from the settled turn. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importSource} from '../integration/support.ts';
import {selectSections,emptyCalls,createModSections} from '../../extensions/table/mod-sections.ts';
const {parseSections,residentText,AUTHOR_SECTIONS_CAPABILITY}=await importSource('kernel-ts/read/sections.ts');

const manifest={id:'craft',version:'1.0.0',requires:[AUTHOR_SECTIONS_CAPABILITY]};
const text='Keeper lead.\n\n## Speech\nTalk like people.\n\n## Arriving\nFollow the eye.';
const parse=(sections,owner=manifest)=>parseSections(owner,{schema_version:1,sections},text);

test('an author section declares its slot and the settled facts that send it',()=>{
 const [lead,speech,arriving]=parse([{heading:null,kind:'resident'},{heading:'Speech',kind:'author',slot:'speech',on:['speech']},
  {heading:'Arriving',kind:'author',slot:'place-arrival',on:['establish','opening']}]);
 assert.equal(lead.kind,'resident');
 assert.deepEqual([speech.kind,speech.slot,speech.on],['author','speech',['speech']]);
 assert.deepEqual(arriving.on,['establish','opening']);
 assert.equal(arriving.text,'## Arriving\n\nFollow the eye.');
});

test('a malformed author declaration is refused at install',()=>{
 const base={heading:'Speech',kind:'author',slot:'speech',on:['speech']},rest=[{heading:null,kind:'resident'},{heading:'Arriving',kind:'resident'}];
 assert.throws(()=>parse([base,...rest],{...manifest,requires:[]}),/requires instructions\.sections\.author\.v1/);
 assert.throws(()=>parse([{...base,on:['arrival']},...rest]),/on must be/);
 assert.throws(()=>parse([{...base,on:[]},...rest]),/on must be/);
 assert.throws(()=>parse([{...base,on:['speech','speech']},...rest]),/on must be/);
 assert.throws(()=>parse([{...base,slot:'Speech Slot'},...rest]),/slot must be/);
 for(const fields of [{topics:['*']},{triggers:['before_apply:place']},{gates:['opening']},{topic_threshold:.9}])
  assert.throws(()=>parse([{...base,...fields},...rest]),/names only its slot, on and grants/);
 assert.throws(()=>parse([{heading:'Speech',kind:'situational',triggers:['before_apply:place'],slot:'speech'},...rest]),/belong to an author section/);
});

test('the Keeper text carries no author section and no empty index lead',()=>{
 const sections=parse([{heading:null,kind:'author',slot:'base',on:['always']},{heading:'Speech',kind:'author',slot:'speech',on:['speech']},
  {heading:'Arriving',kind:'author',slot:'arrival',on:['establish']}]);
 assert.equal(residentText('craft',sections),'');
 const mixed=parse([{heading:null,kind:'resident'},{heading:'Speech',kind:'author',slot:'speech',on:['speech']},{heading:'Arriving',kind:'situational',triggers:['before_apply:place']}]);
 const keeper=residentText('craft',mixed);
 assert(keeper.includes('Keeper lead.')&&keeper.includes('"craft: Arriving"'));
 assert(!keeper.includes('Talk like people'));
 const residentOnly=residentText('craft',parse([{heading:null,kind:'resident'},{heading:'Speech',kind:'author',slot:'speech',on:['speech']},{heading:'Arriving',kind:'resident'}]));
 assert(residentOnly.startsWith('Keeper lead.'),'no index lead when nothing is listed');
});

test('topics, calls and kernel gates never select an author section for the Keeper',()=>{
 const capsule={mods:{instructions:[{mod:'craft',version:'1.0.0',form:'indexed',sections:[
  {key:'craft@1.0.0#1',heading:'Speech',kind:'author',slot:'speech',on:['always'],topics:[],gates:[],triggers:[],due:false,gates_open:true}]}]}};
 const calls=emptyCalls();calls.apply.add('place');
 for(const judgement of [undefined,{status:'scored',scores:{asks_question:1}}])
  assert.deepEqual(selectSections(capsule,judgement,calls),[]);
});

test('the Keeper cannot list or read an author section with the mod verb',async()=>{
 const capsule={mods:{instructions:[{mod:'craft',version:'1.0.0',form:'indexed',sections:[
  {key:'craft@1.0.0#1',heading:'Speech',kind:'author',slot:'speech',on:['always'],topics:[],gates:[],triggers:[]},
  {key:'craft@1.0.0#2',heading:'Arriving',topics:[],gates:[],triggers:['before_apply:place']}]}]}};
 const sections=createModSections({read:async()=>({sections:[{key:'craft@1.0.0#1',text:'Talk like people.'}]}),decision:()=>undefined,record:()=>{}});
 sections.observe(capsule,{},AbortSignal.abort());
 assert.deepEqual(sections.names(),['craft: Arriving']);
 assert.equal(await sections.read('craft: Speech','c1'),undefined);
});

const {authorFacts,authorCraft,AUTHOR_CRAFT_BYTES}=await import('../../extensions/kernel/author-craft.ts');
const row=(mod,version,sections,settings={})=>({mod,version,form:'indexed',settings,sections});
const author=(key,heading,slot,on)=>({key,heading,kind:'author',slot,on,topics:[],gates:[],triggers:[]});
const reader=texts=>async keys=>({sections:keys.map(key=>({key,mod:key.split('@')[0],version:key.split('@')[1].split('#')[0],text:texts[key]}))});

test('settled facts come from what settled, not from what the packet asked',()=>{
 const spoken={responses:[{mode:'speech_only'}],scene:{}};
 assert.deepEqual(authorFacts({capsule:{mods:{}},decision:{responses:[{mode:'nonverbal'}],scene:{}},effects:[]}),
  {always:true,speech:false,establish:false,opening:false,place:false,routine:false});
 const facts=authorFacts({capsule:{mods:{establish:{why:['opening']}}},decision:spoken,effects:[{kind:'place',action:'observe'}],routine:{acts:['eat']}});
 assert.deepEqual(facts,{always:true,speech:true,establish:true,opening:true,place:true,routine:true});
 // A move the kernel left unchanged owes no establishing: the capsule after settlement carries no establish item.
 assert.equal(authorFacts({capsule:{mods:{}},decision:spoken,effects:[{kind:'move',to:'Library'}]}).establish,false);
 assert.equal(authorFacts({capsule:{mods:{}},decision:{responses:[],scene:{first_sight:{place:{described:'x'}}}},effects:[]}).place,true);
 // The host's hydrated responses carry the act: a silent one is not speech.
 assert.equal(authorFacts({capsule:{mods:{}},decision:{responses:[{act:'silent'}],scene:{}},effects:[]}).speech,false);
 assert.equal(authorFacts({capsule:{mods:{}},decision:{responses:[{act:'answer'}],scene:{}},effects:[]}).speech,true);
});

test('only sections whose facts hold reach the author, one per slot, the later package winning',async()=>{
 const capsule={mods:{instructions:[
  row('base','1.0.0',[author('base@1.0.0#1','Prose','prose',['always']),author('base@1.0.0#2','Speech','speech',['speech']),
   author('base@1.0.0#3','Arriving','arrival',['establish'])],{coarse_language:true}),
  row('lang','2.0.0',[author('lang@2.0.0#0',null,'speech',['speech'])]),
  {mod:'plain',version:'1.0.0',form:'full',instruction:'whole'}]}};
 const texts={'base@1.0.0#1':'## Prose\n\nWhole sentences.','base@1.0.0#2':'## Speech\n\nTalk.','base@1.0.0#3':'## Arriving\n\nEye.','lang@2.0.0#0':'Natural speech.'};
 const facts={always:true,speech:true,establish:false,opening:false,place:false,routine:false};
 const craft=await authorCraft(capsule,facts,reader(texts));
 assert(craft.text.includes('Whole sentences.')&&craft.text.includes('Natural speech.'));
 assert(!craft.text.includes('Talk.')&&!craft.text.includes('Eye.'));
 assert(craft.text.indexOf('Whole sentences.')<craft.text.indexOf('Natural speech.'));
 assert(craft.text.includes('"coarse_language":true'));
 assert.deepEqual(craft.record.sections.map(entry=>[entry.key,entry.slot,entry.facts]),[['base@1.0.0#1','prose',['always']],['lang@2.0.0#0','speech',['speech']]]);
 assert.deepEqual(craft.record.overridden,[{key:'base@1.0.0#2',by:'lang@2.0.0#0',slot:'speech'}]);
 assert.equal(craft.record.bytes,Buffer.byteLength('## Prose\n\nWhole sentences.')+Buffer.byteLength('Natural speech.'));
 const none=await authorCraft({mods:{instructions:[]}},facts,reader({}));
 assert.equal(none.text,'');assert.deepEqual(none.record.sections,[]);
});

test('craft past the byte cap is omitted last first, and an unreadable section stops the author input',async()=>{
 const big='x'.repeat(AUTHOR_CRAFT_BYTES-10);
 const capsule={mods:{instructions:[row('a','1.0.0',[author('a@1.0.0#0',null,'one',['always']),author('a@1.0.0#1','Two','two',['always'])])]}};
 const craft=await authorCraft(capsule,{always:true},reader({'a@1.0.0#0':big,'a@1.0.0#1':'## Two\n\nMore than ten bytes.'}));
 assert(craft.text.includes(big)&&!craft.text.includes('More than ten bytes.'));
 assert.deepEqual(craft.record.omitted,['a@1.0.0#1']);
 await assert.rejects(authorCraft(capsule,{always:true},async()=>({sections:[]})),/author craft section is unavailable/);
});

test('a section may grant bounded improvisation, and the core defines its limits',async()=>{
 const owner={...manifest};
 const [granted]=parse([{heading:'Speech',kind:'author',slot:'place',on:['place'],grants:['surface_detail']},{heading:null,kind:'resident'},{heading:'Arriving',kind:'resident'}],owner);
 assert.deepEqual(granted.grants,['surface_detail']);
 for(const grants of [[],['invent_people'],['appearance','appearance']])
  assert.throws(()=>parse([{heading:'Speech',kind:'author',slot:'place',on:['place'],grants},{heading:null,kind:'resident'},{heading:'Arriving',kind:'resident'}]),/grants must be/);
 const capsule={mods:{instructions:[row('places','2.1.0',[{...author('places@2.1.0#1','Place','place',['place']),grants:['surface_detail']}]),
  row('craft','1.0.0',[author('craft@1.0.0#1','Prose','prose',['always'])])]}};
 const craft=await authorCraft(capsule,{always:true,place:true},reader({'places@2.1.0#1':'## Place\n\nComplete the room.','craft@1.0.0#1':'## Prose\n\nWhole sentences.'}));
 assert.match(craft.text,/Granted improvisation, bounded by the core:\n- surface_detail: .*no person who acts or speaks/);
 assert.match(craft.text,/\(This section grants: surface_detail\.\)\n## Place/);
 assert(!craft.text.includes('- appearance:'),'only grants a chosen section carries are defined');
 assert.deepEqual(craft.record.sections.map(entry=>entry.grants),[['surface_detail'],undefined]);
});

test('when the Keeper writes the prose itself, every author section rides its section message',async()=>{
 const capsule={mods:{instructions:[{mod:'craft',version:'1.0.0',form:'indexed',sections:[
  {key:'craft@1.0.0#1',heading:'Speech',kind:'author',slot:'speech',on:['speech'],topics:[],gates:[],triggers:[]}]}]}};
 assert.deepEqual(selectSections(capsule,undefined,emptyCalls(),true,true).map(entry=>[entry.key,entry.why]),[['craft@1.0.0#1',['writer']]]);
 assert.deepEqual(selectSections(capsule,undefined,emptyCalls(),true,false),[]);
 const sections=createModSections({read:async()=>({sections:[{key:'craft@1.0.0#1',text:'## Speech\n\nTalk like people.'}]}),decision:()=>undefined,record:()=>{},writer:()=>true});
 const message=await sections.message(capsule,{turn:3,campaign:'c1'},emptyCalls());
 assert.match(message.content,/Talk like people\./);
});
