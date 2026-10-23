/** §260: beats, attention from public settled data, the bearing grant and the NPC Portrayal package. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Value} from 'typebox/value';
import {importSource} from '../integration/support.ts';
import {Interaction} from '../../runtime/decision-content.ts';
import {npcBearing,attachBearing} from '../../runtime/npc-bearing.ts';
import {DECISION_AUTHOR_INSTRUCTION} from '../../runtime/isolated-expression.ts';
const {parseSections,residentText,AUTHOR_SECTIONS_CAPABILITY,NPC_BEARING_CAPABILITY}=await importSource('kernel-ts/read/sections.ts');
const {authorFacts,authorCraft}=await import('../../extensions/kernel/author-craft.ts');

const root=join(import.meta.dirname,'../../mods/npc-portrayal');
const manifest=JSON.parse(readFileSync(join(root,'mod.json'),'utf8'));
const shipped=()=>parseSections(manifest,JSON.parse(readFileSync(join(root,'sections.json'),'utf8')),readFileSync(join(root,'agent.md'),'utf8'));

test('a beat rides any interaction and is bounded',()=>{
 for(const row of [{actor:'npc_1',act:'silent',beat:'keeps wiping the same glass'},
  {actor:'npc_1',to:['investigator_1'],act:'refuse',beat:'stops reaching for the drawer'},
  {actor:'npc_1',to:['investigator_1'],act:'answer',content:[{fact_ref:'fact_1'}],beat:'looks past you at the door'}])
  assert(Value.Check(Interaction,row),JSON.stringify(row));
 assert(!Value.Check(Interaction,{actor:'npc_1',act:'silent',beat:'x'.repeat(121)}));
 assert(!Value.Check(Interaction,{actor:'npc_1',act:'silent',beat:'   '}));
});

test('the author instruction lets a beat supply behavior and keeps settled facts the packet\'s',()=>{
 assert(!DECISION_AUTHOR_INSTRUCTION.includes('It supplies no physical action'));
 assert(!DECISION_AUTHOR_INSTRUCTION.includes('small expressive gestures'));
 assert(DECISION_AUTHOR_INSTRUCTION.includes('its beat, if any, is what the person visibly does, never a state change'));
 assert(DECISION_AUTHOR_INSTRUCTION.includes('nonverbal behavior creates no commitment, consent, message, belief or result'));
});

const presence=()=>[{ref:'npc_1'},{ref:'npc_2'},{ref:'npc_3'},{ref:'npc_4'},{ref:'npc_5'}];
const people=[{ref:'npc_1',relationships:[{toward:'investigator_1',affinity:'guarded'},{toward:'npc_2',kind:'employer'}]},
 {ref:'npc_2',relationships:[{toward:'investigator_1',affinity:'friendly'}]}];

test('attention follows what settled in public',()=>{
 const tiers=npcBearing({presence:presence(),people,
  responses:[{actor:'npc_1',act:'refuse',to:['investigator_1']},{actor:'npc_2',act:'answer',to:['npc_1']},{actor:'npc_3',act:'greet',to:['investigator_1']}],
  outcomes:[{kind:'npc',status:'changed',actor:'npc_4',to:'Bar'}],relationshipChanges:[],firstSight:[{ref:'npc_3'}]});
 assert.deepEqual([...tiers].map(([ref,value])=>[ref,value.tier]),
  [['npc_1','focus'],['npc_2','focus'],['npc_3','focus'],['npc_4','focus'],['npc_5','background']]);
 assert.equal(tiers.get('npc_3').needs_introduction,true);
 assert.deepEqual(tiers.get('npc_1').toward,[{ref:'investigator_1',disposition:'unfriendly'}]);
 const quiet=npcBearing({presence:presence(),people,responses:[{actor:'npc_1',act:'silent',beat:'keeps wiping'},{actor:'npc_2',act:'acknowledge'}],outcomes:[]});
 assert.deepEqual([quiet.get('npc_1').tier,quiet.get('npc_2').tier,quiet.get('npc_5').tier],['engaged','engaged','background']);
 assert.equal(npcBearing({presence:presence(),people,responses:[],outcomes:[],relationshipChanges:[{actor:'npc_5',toward:'investigator_1',affinity:'hostile'}]}).get('npc_5').tier,'focus');
 assert.equal(npcBearing({presence:presence(),people,responses:[],outcomes:[],firstSight:[{ref:'npc_5'}]}).get('npc_5').tier,'background','introduced without acting is not the focus');
});

test('§258 P1\'s shown public disposition is read before the legacy affinity',()=>{
 const tiers=npcBearing({presence:[{ref:'npc_1'}],responses:[],outcomes:[],
  people:[{ref:'npc_1',relationships:[{toward:'investigator_1',public:'ally'},{toward:'npc_2',public:'hostile'}]}]});
 assert.deepEqual(tiers.get('npc_1').toward,[{ref:'investigator_1',disposition:'ally'}]);
});

test('hidden state cannot move a tier or reach the author',()=>{
 const input=hidden=>({presence:presence(),responses:[{actor:'npc_1',act:'answer',to:['investigator_1']}],outcomes:[],
  people:people.map(person=>({...person,...hidden}))});
 const plain=JSON.stringify([...npcBearing(input({}))]);
 const secret=JSON.stringify([...npcBearing(input({trust:0,fear:5,pressure:5,control:{by:'cult',kind:'magic'},mood:{text:'terrified',hidden:true},hides:'the ledger'}))]);
 assert.equal(secret,plain);
 assert(!/fear|trust|pressure|terrified|ledger/.test(secret));
});

test('bearing sits beside each presence entry and telemetry names beats',()=>{
 const rows=presence(),responses=[{actor:'npc_1',act:'silent',beat:'keeps wiping'}];
 const telemetry=attachBearing(rows,npcBearing({presence:rows,people,responses,outcomes:[]}),responses);
 assert.deepEqual(rows[0].bearing,{tier:'engaged',toward:[{ref:'investigator_1',disposition:'unfriendly'}]});
 assert.deepEqual(telemetry[0],{ref:'npc_1',tier:'engaged',beat:true});
});

test('the people fact holds only with someone present',()=>{
 assert.equal(authorFacts({capsule:{mods:{}},decision:{responses:[],scene:{presence:{people:[{ref:'npc_1'}]}}},outcomes:[]}).people,true);
 assert.equal(authorFacts({capsule:{mods:{}},decision:{responses:[],scene:{presence:{people:[]}}},outcomes:[]}).people,false);
});

test('the people fact and the bearing grant need the portrayal capability',()=>{
 const text='## Lead\n\nx\n\n## People\n\nShow them.';
 const sections=[{heading:'Lead',kind:'resident'},{heading:'People',kind:'author',slot:'bearing',on:['people'],grants:['bearing']}];
 assert.throws(()=>parseSections({id:'p',version:'1.0.0',requires:[AUTHOR_SECTIONS_CAPABILITY]},{schema_version:1,sections},text),/require npc\.bearing\.v1/);
 assert.equal(parseSections({id:'p',version:'1.0.0',requires:[AUTHOR_SECTIONS_CAPABILITY,NPC_BEARING_CAPABILITY]},{schema_version:1,sections},text)[1].slot,'bearing');
});

test('the shipped package: on by default, small, its craft for the author only',async()=>{
 assert.equal(manifest.default_enabled,true);
 assert(manifest.requires.includes('npc.bearing.v1'));
 const sections=shipped(),keeper=residentText('npc-portrayal',sections),author=sections.find(section=>section.kind==='author');
 assert(Buffer.byteLength(keeper,'utf8')<=600,`Keeper text is ${Buffer.byteLength(keeper,'utf8')} bytes`);
 assert(Buffer.byteLength(author.text,'utf8')<4096);
 assert(!keeper.includes('People in motion'));
 assert.deepEqual([author.slot,author.on,author.grants],['bearing',['people'],['bearing']]);
 const capsule={mods:{instructions:[{mod:'npc-portrayal',version:manifest.version,form:'indexed',
  sections:[{key:'npc-portrayal@1.0.0#1',heading:'People in motion',kind:'author',slot:'bearing',on:['people'],grants:['bearing']}]}]}};
 const read=async()=>({sections:[{key:'npc-portrayal@1.0.0#1',mod:'npc-portrayal',version:manifest.version,text:author.text}]});
 const craft=await authorCraft(capsule,{always:true,people:true},read);
 assert.match(craft.text,/- bearing: For a person in presence\.people you may invent micro-presentation/);
 assert.match(craft.text,/Make people feel physically present/);
 assert.equal((await authorCraft(capsule,{always:true,people:false},read)).text,'');
});
