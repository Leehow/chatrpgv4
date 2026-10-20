/** Reference instructions stay available to explicit consumers without automatic Keeper selection. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importSource,kernel,openTurn} from '../integration/support.ts';
import {selectSections,emptyCalls} from '../../extensions/table/mod-sections.ts';
const {parseSections,REFERENCE_SECTIONS_CAPABILITY}=await importSource('kernel-ts/read/sections.ts');
test('reference sections require their capability and reject every automatic selector',()=>{
 const manifest={id:'example',version:'1.0.0',requires:[REFERENCE_SECTIONS_CAPABILITY]},entry={heading:'Author',kind:'reference'},text='## Author\nAuthor-only craft.';
 const parse=(entry,manifestOverride=manifest)=>parseSections(manifestOverride,{schema_version:1,sections:[entry]},text);
 assert.deepEqual(parse(entry)[0].topics,[]);assert.deepEqual(parse(entry)[0].triggers,[]);
 assert.throws(()=>parse(entry,{...manifest,requires:[]}),/reference section requires/);
 for(const fields of [{topics:['*']},{triggers:['before_apply:place']},{gates:['opening']},{topic_threshold:.9}])assert.throws(()=>parse({...entry,...fields}),/no automatic selectors/);
});
test('the real locked author section is indexed and explicitly readable but never automatically selected',async t=>{
 const client=await kernel(t,{env:{COC_INSTRUCTION_BUDGET:'99999999'}});await openTurn(client);
 const capsule=await client.table('capsule');
 const mod=capsule.mods.instructions.find(row=>row.mod==='enhanced-locations');assert.equal(mod.form,'indexed');
 const section=mod.sections.find(row=>row.heading==='Place description for the author');assert.ok(section?.key);
 assert(!mod.instruction.includes('Let the player inhabit a particular place'));
 const calls=emptyCalls();calls.apply.add('place');calls.context=new Set(['place']);
 for(const judgement of [undefined,{status:'scored',scores:{asks_question:1,speaks_to_person:1}}])
  assert(!selectSections(capsule,judgement,calls).some(row=>row.key===section.key));
 const result=await client.ok('mods.sections',{campaign:'c1',keys:[section.key]});
 assert(result.sections.find(row=>row.key===section.key).text.includes('Let the player inhabit a particular place'));
});
