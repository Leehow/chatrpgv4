/** Location capability seams; deterministic tests are not live-play evidence. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Check,Errors} from 'typebox/value';
import {COC_TOOLS,COC_TOOL_NAMES} from '../../extensions/kernel/tools.ts';
import {placeOperation} from '../../extensions/kernel/place-operation.ts';
import {PlaceParameters,PlaceEffect} from '../../shared/place-structures.ts';
import {admissionRequest,effectSignature} from '../../extensions/kernel/admission.ts';
import {locationToolDeclarations,projectLocationInspections} from '../../extensions/table/location-context.ts';
import {capabilityCatalogue} from '../../extensions/table/capability-catalogue.ts';
import {turnPacket,compileTurnPacket,bindTurnPacketMoves,turnPacketParameterSchema,turnPacketResult} from '../../runtime/turn-packet-prototype.ts';
import {decisionScene} from '../../runtime/isolated-expression.ts';
import {locationReferenceBatch,locationReferenceAdvice,adviseLocationReference} from '../../extensions/kernel/location-reference.ts';
import {packDecisionBatch} from '../../runtime/jev/question-packing.ts';
import {moveNeedsTravelBand} from '../../runtime/jev/candidates.ts';

const command={kind:'place',action:'move',to:'Ordinary Inn / Lobby',via:'Through the ordinary entrance',travel_band:'adjacent',
    additions:[{name:'Ordinary Inn',within:null,description:'An ordinary inn.'},{name:'Lobby',within:'Ordinary Inn',description:'A small lobby.',features:[{name:'counter',description:'A scarred wooden counter.'}]}]};
test('the dedicated typed tool normalizes before canonical write admission, without another transaction',()=>{
    assert(COC_TOOL_NAMES.includes('place'));
    const {kind,...change}=command,input={op:'submit',change};
    assert(Check(PlaceParameters,input));assert(Check(PlaceEffect,command));
    const normalized=placeOperation('place',input);
    assert.deepEqual(normalized,{name:'apply',params:{effects:[command]}});
    assert.deepEqual(placeOperation('place',{op:'inspect',name:'Inn'}),{name:'place',params:{op:'inspect',name:'Inn'}});
    assert(Errors(COC_TOOLS.find(tool=>tool.name==='apply').parameters,normalized.params).length===0);
    const scope={party:['Investigator'],scene:{handle:'Office'}};
    assert.equal(admissionRequest('apply',normalized.params,scope).kinds[0],'place');
    assert(admissionRequest('apply',{effects:[{kind:'place',action:'move',to:'Office',at:'counter'}]},scope),'approaching a feature is still an action');
    assert.equal(admissionRequest('apply',{effects:[{kind:'place',action:'establish',additions:command.additions}]},scope),null);
    assert.notEqual(effectSignature({...command,at:'window'}),effectSignature({...command,at:'counter'}),'local target belongs to admission identity');
    assert(moveNeedsTravelBand({kind:'move',to:'West'},{within:'City',locations:true}),'containment cannot suppress an enhanced journey duration');
    assert(!Check(PlaceEffect,{...command,patch:{cash:100}}));
});

test('native typed location commands use open destinations, the same effect and one journey limit',()=>{
    const packet={version:4,commands:[command,{kind:'scene',service:'open',crowd:'quiet'}]};
    const decoded=turnPacket(JSON.stringify(packet));
    const bound=bindTurnPacketMoves(decoded,[]);
    assert.deepEqual(compileTurnPacket(bound).effects[0],command,'no issued-target enum blocks a new place');
    assert.equal(Errors(turnPacketParameterSchema(false,[],[],false,undefined,true),packet).length,0);
    assert(Errors(turnPacketParameterSchema(false,[],[],false),packet).length,'quiet requests defer full location command detail');
    assert(Errors(turnPacketParameterSchema(true,[],[],false,undefined,true),packet).length,'a settled journey cannot be advertised again');
    assert.throws(()=>turnPacket(JSON.stringify({version:4,commands:[command,{kind:'move',to:'Office'}]})),/Only one destination/);
    assert.throws(()=>turnPacket(JSON.stringify({version:4,commands:[command,{kind:'time',band:'work',reason:'test'}]})));
    const feature={kind:'place',action:'feature',to:'Inn',at:'window',state:'open',passable:true};
    assert.deepEqual(compileTurnPacket(turnPacket(JSON.stringify({version:4,commands:[feature]}))).effects,[feature]);
    assert.throws(()=>turnPacket(JSON.stringify({version:4,commands:[{...command,travel_minutes:5}]})),/Invalid decision command/);
    assert.deepEqual(turnPacketResult({outcomes:[{kind:'place',status:'changed',position:{place:'Inn',at:'counter'}}]}).outcomes[0].position,{place:'Inn',at:'counter'});
});

test('resident location declarations defer detailed grammar while canonical validators stay complete',()=>{
    const before=JSON.stringify(COC_TOOLS),view=locationToolDeclarations(COC_TOOLS);
    const canonical=COC_TOOLS.find(tool=>tool.name==='place'),entry=view.find(tool=>tool.name==='place');
    assert(Buffer.byteLength(JSON.stringify(entry.parameters))<Buffer.byteLength(JSON.stringify(canonical.parameters))/2);
    const apply=view.find(tool=>tool.name==='apply'),branches=apply.parameters.properties.effects.items.anyOf;
    const envelope=branches.find(branch=>branch.properties.kind.anyOf?.some(value=>value.const==='place'));
    assert(envelope);assert.equal(envelope.properties.additions,undefined);
    assert.equal(JSON.stringify(COC_TOOLS),before,'request projection never edits registered schemas');
    const catalogue=capabilityCatalogue(COC_TOOLS);
    assert(catalogue.some(card=>card.name==='place'&&card.verb==='place'));
    assert(catalogue.some(card=>card.name==='place-change'&&card.effect==='place'));
});

test('only old host location results lose request detail; raw history and assistant continuation survive',()=>{
    const assistant={role:'assistant',content:[{type:'thinking',thinking:'Opaque continuation',thinkingSignature:'signature'},{type:'toolCall',id:'read-1',name:'place',arguments:{op:'inspect',need:'contract'}}]};
    const result={role:'toolResult',toolCallId:'read-1',toolName:'place',content:[{type:'text',text:'Long location instructions '.repeat(500)}],details:{location_inspection:{turn:3,need:'contract'},parameters:PlaceParameters}};
    const raw=[assistant,result],before=structuredClone(raw);
    assert.equal(projectLocationInspections(raw,3).omittedBytes,0);
    const view=projectLocationInspections(raw,4);
    assert(view.omittedBytes>5000);assert.equal(view.messages[0],assistant);
    assert.equal(view.messages[1].toolCallId,'read-1');assert.deepEqual(raw,before);
    assert(view.messages[1].content[0].text.includes('historical_detail_omitted'));
});

test('the sole author consumes committed public local position and feature state',()=>{
    const location={position:{place:'Inn',at:'window',relation:'beside'},features:[{name:'window',description:'A narrow casement.',state:'open',passable:true}]};
    const view=decisionScene({where:{display_name:'Inn',location},public_scene:{description:'A simple inn.'},present:[]});
    assert.deepEqual(view.location,location);assert.equal(view.description,'A simple inn.');
    view.location.features[0].state='changed in projection';assert.equal(location.features[0].state,'open');
});

test('Jev reference advice keeps source, registered features, no-match and uncertainty distinct',async()=>{
    const read={query:'the front desk',current:'Inn',coverage:'Partial known-place catalogue',candidates:[
        {name:'Inn',kind:'place',origin:'source',summary:'An ordinary inn.'},
        {name:'Inn / counter',place:'Inn',feature:'counter',kind:'feature',origin:'mod',summary:'The public front desk.'},
    ]};
    const batch=locationReferenceBatch(read,'c1',2);
    packDecisionBatch(batch);assert.equal(batch.questions.length,3);
    assert(batch.questions[0].criteria.none);assert(batch.questions[0].criteria.uncertain);
    assert.notEqual(batch.id,locationReferenceBatch({...read,query:'a different hotel'},'c1',2).id);
    const answer=(choice,confidence=.9)=>({status:'answered',type:'choice',choice,confidence});
    const result={answers:{reference:answer('c1'),within:answer('c0'),scale:answer('feature')}};
    const advice=locationReferenceAdvice(read,result);assert.equal(advice.status,'matched');assert.equal(advice.candidate.origin,'mod');assert.equal(advice.scale,'feature');
    assert.equal(locationReferenceAdvice(read,{answers:{reference:answer('none')}}).status,'unmatched');
    assert.equal(locationReferenceAdvice(read,{answers:{reference:answer('c0',.1)}}).status,'uncertain');
    const before=structuredClone(read),rows=[];
    const failed=await adviseLocationReference(read,{env:{},campaign:'c1',turn:2,record:row=>rows.push(row),decision:{decide:async()=>{throw Error('Unavailable');}}});
    assert.equal(failed.status,'unavailable');assert.deepEqual(read,before);assert.equal(rows[0].status,'unavailable');
});
