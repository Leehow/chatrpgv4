import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PUBLIC_GUIDANCE_FIELDS,validatePublicGuidance} from '../../kernel-ts/modules/public-guidance.ts';
import {piBackend} from './pi-backend-source.mjs';
const {publicPreparationSnapshot} = await piBackend('coc-onboarding.ts');

const fields=()=>Object.fromEntries(PUBLIC_GUIDANCE_FIELDS.map(field=>[field,{status:'value',text:field,source_refs:[{page:1}]}]));
test('public source fields reject private additions, unbound pages and text in an unresolved field',()=>{
 assert.deepEqual(validatePublicGuidance(fields(),2),fields());
 assert.throws(()=>validatePublicGuidance({...fields(),secret:'not a public field'},2));
 const missing=fields();missing.era={status:'needs_choice',text:'',source_refs:[]};assert.equal(validatePublicGuidance(missing,2).era.status,'needs_choice');
 missing.era.text='A hidden future era';assert.throws(()=>validatePublicGuidance(missing,2));
 const unbound=fields();unbound.creation_advice.source_refs=[{page:3}];assert.throws(()=>validatePublicGuidance(unbound,2));
});

test('public progress strips provisional values, retains confirmed values and rejects another source or opening',()=>{
 const binding={moduleId:'book',sourceSha:'a'.repeat(64),opening:'start'};
 const event={module_id:'book',source_sha256:binding.sourceSha,opening:'start',guidance_key:'b'.repeat(64),job_id:'read-1',attempt:'attempt-1',
  fields:Object.fromEntries(PUBLIC_GUIDANCE_FIELDS.map(field=>[field,{state:'checking',value:'private candidate text'}]))};
 const pending=publicPreparationSnapshot(undefined,event,binding);
 assert.deepEqual(pending.fields.era,{state:'checking'});
 const confirmed=publicPreparationSnapshot(pending,{...event,fields:{...event.fields,era:{state:'confirmed',value:'1925'}}},binding);
 assert.equal(confirmed.fields.era.value,'1925');
 assert.equal(publicPreparationSnapshot(confirmed,event,binding).fields.era.value,'1925');
 const corrected=publicPreparationSnapshot(confirmed,{...event,fields:{...event.fields,era:{state:'unavailable'}}},binding);
 assert.deepEqual(corrected.fields.era,{state:'unavailable'});
 assert.equal(publicPreparationSnapshot(confirmed,{...event,opening:'another start'},binding),undefined);
 assert.equal(publicPreparationSnapshot(confirmed,{...event,source_sha256:'c'.repeat(64)},binding),undefined);
 const next=publicPreparationSnapshot(confirmed,{...event,guidance_key:'d'.repeat(64)},binding);
 assert.deepEqual(next.fields.era,{state:'checking'});
});
