import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Value} from 'typebox/value';
import {COC_TOOLS,effectShapeRefusal} from '../../extensions/kernel/tools.ts';
import {owedConsentPlan} from '../../extensions/kernel/owed-consent.ts';
import {heldOperationKey,heldRecoveryOperationKey} from '../../runtime/jev/held-act-outcome.ts';
import {normalizeApplyArguments} from '../../shared/apply-protocol.ts';
import {importSource} from '../integration/support.ts';
const {owedSourceRecords}=await importSource('kernel-ts/owed/provenance.ts');

const effect={kind:'move',to:'Cafe',via:'Across Main Street',establish:{summary:'A public cafe.'},owed:'t1-owed-1'};
const source={name:'t1-owed-1',turn:1,commit:'source-commit',quote:'You arrive at Cafe.',player_text:'I walk across Main Street to Cafe.',mode:'departure',from:'office'};
const capsule={where:{scene:'office'},owed:[{name:source.name,kind:'move'}],_context:{worldline:'main',loop:0,owed_sources:[source]}};

test('owed movement uses the bound originating declaration without changing its effect',()=>{
 const plan=owedConsentPlan([effect],capsule,'I introduce myself.');
 assert.deepEqual(plan.effects,[effect]);assert.equal(plan.sources[0].player_text,source.player_text);
 assert.equal(plan.sources[0].mode,'departure');assert.notEqual(plan.identity,'current');
 assert.equal(owedConsentPlan([{...effect,to:'Garage'}],capsule,'I introduce myself.').identity,plan.identity,'the operation itself remains in the ordinary operation cache key');
 for(const broken of [{...capsule,_context:{owed_sources:[]}},{...capsule,where:{scene:'another-place'}}])assert.throws(()=>owedConsentPlan([effect],broken,'I wait.'),/source|position/);
});

test('an exact executable owed effect bypasses consent while current effects keep their scope',()=>{
 const bound={...source,mode:'effect',effect:{kind:'move',to:'Cafe'}};
 const cap={...capsule,_context:{...capsule._context,owed_sources:[bound]}};
 const current={kind:'time',band:'short',why:'Wait here'};
 const plan=owedConsentPlan([effect,current],cap,'I wait here.');
 assert.deepEqual(plan.effects,[current]);assert.deepEqual(plan.sources,[null]);assert.deepEqual(plan.told,[source.name]);
});

test('the provider apply schema declares required route variants and accepts an event-only request',()=>{
 const schema=COC_TOOLS.find(x=>x.name==='apply').parameters;
 assert.equal(Value.Check(schema,{event:{name:'Read the posted notice'}}),true);
 assert.deepEqual(normalizeApplyArguments({event:{name:'Read the posted notice'}}),{effects:[],event:{name:'Read the posted notice'}});
 assert.deepEqual(normalizeApplyArguments({event:'not an event'}),{event:'not an event'});
 assert.equal(Value.Check(schema,{effects:[{kind:'move',to:'Cafe',establish:{summary:'A cafe.'}}]}),false);
 assert.equal(Value.Check(schema,{effects:[effect]}),true);
 assert.equal(effectShapeRefusal('apply',schema,{effects:[{kind:'move',to:'An existing place'}]}),undefined);
 const move=schema.properties.effects.items.anyOf.filter(x=>x.properties?.kind?.enum?.includes('move'));
 assert.ok(move.some(x=>x.required.includes('establish')&&x.required.includes('via')));
});

test('owed source context requires the immutable commit and the actual delivered quote',async()=>{
 const entry={name:source.name,turn:1,kind:'move',quote:source.quote,departure:{from:'office'}};
 const record={turn:1,commit:source.commit,closed_by:'narrate',player_text:originalWords(),rendered_text:source.quote};
 const campaign={turn:{turn:2},party:[],optional:async path=>path==='owed.json'?{open:[entry],closed:[]}:record};
 const proven=await owedSourceRecords(campaign,capsule);assert.equal(proven.length,1);assert.equal(proven[0].player_text,source.player_text);
 for(const change of [{commit:null},{rendered_text:'Different delivery.'},{closed_by:'stranded'}]){
  assert.deepEqual(await owedSourceRecords({...campaign,optional:async path=>path==='owed.json'?{open:[entry],closed:[]}:{...record,...change}},capsule),[]);
 }
 function originalWords(){return source.player_text;}
});

test('recovery clears a held operation only with its canonical owed receipt and otherwise identical arguments',()=>{
 const {owed:_,...ordinary}=effect;
 assert.equal(heldRecoveryOperationKey('apply',{effects:[effect]},[]),undefined);
 assert.equal(heldRecoveryOperationKey('apply',{effects:[effect]},[{owed:'another-row'}]),undefined);
 const key=heldRecoveryOperationKey('apply',{effects:[effect]},[{owed:effect.owed}]);
 assert.equal(key,heldOperationKey('apply',{effects:[ordinary]}));
 assert.notEqual(key,heldOperationKey('apply',{effects:[{...ordinary,to:'Another Cafe'}]}));
 assert.notEqual(key,heldOperationKey('apply',{effects:[ordinary],event:{name:'Another event'}}));
});
