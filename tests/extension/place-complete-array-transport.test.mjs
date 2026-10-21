/** Real Pi argument preparation; controlled component evidence, never live play. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable,waitForIdle} from './harness.mjs';
import {normalizePlaceArrayArguments,placeParameterRefusal} from '../../extensions/kernel/place-operation.ts';

test('decoding is confined to one complete schema-valid array and preserves refusal boundaries',()=>{
 const additions=[{name:'Station',description:'A station.'}],raw={action:'move',to:'Station',additions:JSON.stringify(additions)},before=structuredClone(raw);
 assert.deepEqual(normalizePlaceArrayArguments(raw),{args:{...raw,additions},fields:['additions']});
 assert.deepEqual(raw,before);
 for(const additions of ['[{"name":','{}','null','[]','[{"name":"Station","features":"[]"}]',JSON.stringify(JSON.stringify([{name:'Station'}]))]){
  const args={action:'move',additions};assert.equal(normalizePlaceArrayArguments(args).args,args);
  assert.equal(placeParameterRefusal(args).details.reason,'place_array_required');
 }
 for(const args of [{action:'invented',additions:'[]'},{action:'inspect',facts:'["A fact"]'},{action:'move',to:'["Station"]'},{action:'observe',scope:'["A room"]'}])assert.equal(normalizePlaceArrayArguments(args).args,args);
 const conflict=normalizePlaceArrayArguments({op:'inspect',action:'move',additions:JSON.stringify(additions)}).args;
 assert.equal(placeParameterRefusal(conflict).details.reason,'place_mode_conflict');
});

test('a complete schema-valid encoded place array reaches normal execution as an array',async t=>{
 const additions=[{name:'Station',description:'A modest street station.'}];
 const raw={action:'move',to:'Station',via:'The main entrance',additions:JSON.stringify(additions)};
 const table=await openTable({responses:[fauxAssistantMessage([fauxToolCall('place',raw)],{stopReason:'toolUse'}),fauxAssistantMessage('Stopped fixture.')]});
 t.after(()=>table.dispose());await table.session.prompt('I enter the station.');await waitForIdle(table.session);
 const request=table.kernelRequests().find(row=>row.method==='table.apply');
 assert.ok(request,'the complete valid transport must reach ordinary admission and execution');
 assert.deepEqual(request.params.effects[0].additions,additions);
 assert.equal(raw.additions,JSON.stringify(additions),'raw provider evidence stays intact');
 assert.ok(table.telemetry().some(row=>row.lane==='arguments'&&row.event==='place_array_transport_normalized'));
});

test('blank optional place fields say nothing and are omitted before validation (§250.4, live el-v2-20261021e T8)',()=>{
 const raw={action:'move',to:'Central Library',via:'',travel_band:' ',relation:''};
 const normalized=normalizePlaceArrayArguments(raw);
 assert.deepEqual(normalized.args,{action:'move',to:'Central Library'});
 assert.deepEqual(normalized.fields.sort(),['relation:blank','travel_band:blank','via:blank']);
 assert.equal(placeParameterRefusal(normalized.args),undefined,'the plain move is no longer refused');
 assert.equal(normalizePlaceArrayArguments({action:'move',to:''}).args.to,'','a required field is left for its own refusal');
});

test('a read that names its place by to is a read of that place; a write field beside it is still a conflict (§250.4, live el-v2-20261021e T25)',()=>{
 const raw={action:'inspect',to:'corbitt-house-ground',at:'前门',need:'context'};
 const normalized=normalizePlaceArrayArguments(raw);
 assert.deepEqual(normalized.args,{action:'inspect',name:'corbitt-house-ground',at:'前门',need:'context'});
 assert.deepEqual(normalized.fields,['to:name']);
 assert.equal(placeParameterRefusal(normalized.args),undefined,'the read is no longer refused');
 const write={action:'inspect',to:'corbitt-house-ground',at:'前门',state:'locked'};
 assert.deepEqual(normalizePlaceArrayArguments(write).fields,[],'a state beside to is not guessed into a read or a write');
 assert.equal(placeParameterRefusal(normalizePlaceArrayArguments(write).args).details.reason,'place_mode_conflict');
 assert.deepEqual(normalizePlaceArrayArguments({action:'inspect',to:'A',name:'B'}).fields,[],'two different targets stay for their own refusal');
});

test('a look at a place is carried to place inspect instead of failing look validation (§250.4, live el-v2-20261021e T33)',async t=>{
 const table=await openTable({responses:[fauxAssistantMessage([fauxToolCall('look',{focus:'place',name:'Station',need:'context'})],{stopReason:'toolUse'}),fauxAssistantMessage('Stopped fixture.')]});
 t.after(()=>table.dispose());await table.session.prompt('I think back over the station.');await waitForIdle(table.session);
 const request=table.kernelRequests().find(row=>row.method==='mods.locations.inspect'||row.method==='table.look');
 assert.ok(request,'the read reaches the kernel');
 assert.equal(request.method,'mods.locations.inspect','it is the place read, not a scene look');
 assert.equal(request.params.name,'Station');assert.equal(request.params.need,'context');
 assert.ok(table.telemetry().some(row=>row.lane==='arguments'&&row.event==='look_place_routed'));
});
