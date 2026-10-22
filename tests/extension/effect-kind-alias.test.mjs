/** Deterministic argument repair; not live-play evidence (contract §250.4). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {COC_TOOLS,aliasEffectKinds,effectShapeRefusal} from '../../extensions/kernel/tools.ts';

const apply=COC_TOOLS.find(tool=>tool.name==='apply');
const alias=effect=>aliasEffectKinds('apply',apply.parameters,{effects:[effect]});

test('a kind that names the effect\'s own field takes the only kind declaring all its fields (live el-v2-20261021a T8)',()=>{
 const note={kind:'document',name:'Folded note',from:'commission-briefing',to:'Thomas Hayes',document:{presentation:'paper',text:'Show the house today.'},why:'He pockets the note.'};
 const repaired=alias(note);
 assert.deepEqual(repaired.repairs,[{index:0,from:'document',to:'object'}]);
 assert.equal(repaired.args.effects[0].kind,'object');assert.equal(note.kind,'document','the submitted effect is not mutated');
 assert.equal(effectShapeRefusal('apply',apply.parameters,repaired.args),undefined);
});

test('an ambiguous or unrelated unknown kind is left for the refusal with its kind list',()=>{
 const activity={kind:'activity',name:'The broker',activity:{summary:'Waits at the door.',basis:'observed'},why:'He stays.'};
 assert.deepEqual(alias(activity).repairs,[],'npc and scene both declare activity and these fields: no single reading');
 assert.equal(effectShapeRefusal('apply',apply.parameters,alias(activity).args).details.reason,'effect_kind_unknown');
 assert.deepEqual(alias({kind:'narrate',text:'Prose.'}).repairs,[],'no field carries the kind\'s name');
 assert.deepEqual(alias({kind:'document',document:{text:'x'},unrelated:true}).repairs,[],'a field no kind declares blocks the reading');
});

test('a known kind missing its one required field it carries as an undeclared name takes that field (live el-v2-20261021b T20)',()=>{
 const repaired=alias({kind:'clue',name:'nailed-windows',label:'Nailed windows',how:'Seen from the porch.'});
 assert.deepEqual(repaired.repairs,[{index:0,from:'name',to:'clue'}]);
 assert.equal(repaired.args.effects[0].clue,'nailed-windows');assert.equal(repaired.args.effects[0].name,undefined);
 assert.equal(effectShapeRefusal('apply',apply.parameters,repaired.args),undefined);
 assert.deepEqual(alias({kind:'threat',name:'corbitt-haunting',clock:'c',segments:1,why:'w'}).repairs,[],'a kind that declares name keeps it');
});

test('a clue established without a name is refused with the establish form, not only the book-clue form (live el-v2-20261021e T23)',()=>{
 const refusal=effectShapeRefusal('apply',apply.parameters,{effects:[{kind:'clue',establish:{summary:'Three issues each have a notice cut out.'},how:'Read page by page.'}]});
 assert.equal(refusal.details.reason,'effect_field_missing');assert.deepEqual(refusal.details.missing,['clue']);
 assert.match(refusal.fix,/establish takes a new short name of its own: \{kind: "clue", clue: <new name>, establish: \{summary\}, how\}/);
 const book=effectShapeRefusal('apply',apply.parameters,{effects:[{kind:'clue',how:'Seen.'}]});
 assert.doesNotMatch(book.fix,/new short name/,'a clue without establish keeps the book-clue fix alone');
});

test('an activity effect is read by what its activity holds: wakefulness is an NPC\'s, service and crowd a scene\'s (live el-v2-20261021f T11)',()=>{
 const npc=alias({kind:'activity',name:'the doorman',activity:{summary:'He sits behind the desk.',basis:'observed',wakefulness:'awake'},why:'He is on duty.'});
 assert.deepEqual(npc.repairs,[{index:0,from:'activity',to:'npc'}]);
 assert.equal(effectShapeRefusal('apply',apply.parameters,npc.args),undefined);
 const scene=alias({kind:'activity',name:'here',activity:{summary:'The lobby is busy.',basis:'observed',crowd:'active'},why:'Evening rush.'});
 assert.deepEqual(scene.repairs,[{index:0,from:'activity',to:'scene'}]);
 assert.deepEqual(alias({kind:'activity',name:'here',activity:{summary:'Quiet.',basis:'observed'},why:'w'}).repairs,[],'shared fields alone stay ambiguous');
});
