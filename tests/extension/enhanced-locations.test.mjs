/** Location capability seams; deterministic tests are not live-play evidence. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Check,Errors} from 'typebox/value';
import {COC_TOOLS,COC_TOOL_NAMES} from '../../extensions/kernel/tools.ts';
import {placeOperation} from '../../extensions/kernel/place-operation.ts';
import {PlaceParameters,PlaceEffect} from '../../shared/place-structures.ts';
import {admissionRequest,effectSignature,refusedMovesOf,registeredLocationDestination} from '../../extensions/kernel/admission.ts';
import {KernelError} from '../../extensions/kernel/client.ts';
import {emptyCalls,noteCall,applyEffectKinds} from '../../extensions/table/mod-sections.ts';
import {locationToolDeclarations,projectLocationInspections} from '../../extensions/table/location-context.ts';
import {capabilityCatalogue} from '../../extensions/table/capability-catalogue.ts';
import {turnPacket,normalizeTurnPacketArguments,compileTurnPacket,bindTurnPacketMoves,turnPacketParameterSchema,turnPacketResult} from '../../runtime/turn-packet-prototype.ts';
import {decisionScene} from '../../runtime/isolated-expression.ts';
import {locationReferenceBatch,locationReferenceAdvice,adviseLocationReference} from '../../extensions/kernel/location-reference.ts';
import {packDecisionBatch} from '../../runtime/jev/question-packing.ts';
import {moveNeedsTravelBand} from '../../runtime/jev/candidates.ts';
import {continuousConsentLine,continuousConsentQuestions,continuousConsentDisposition} from '../../runtime/jev/continuous-consent.ts';

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

test('native typed location commands use open destinations, the same effect and a whole ordered route (§250)',()=>{
    const packet={version:4,commands:[command,{kind:'scene',service:'open',crowd:'quiet'}]};
    const decoded=turnPacket(JSON.stringify(packet));
    const bound=bindTurnPacketMoves(decoded,[]);
    assert.deepEqual(compileTurnPacket(bound).effects[0],command,'no issued-target enum blocks a new place');
    assert.equal(Errors(turnPacketParameterSchema(false,[],[],false,undefined,true),packet).length,0);
    assert(Errors(turnPacketParameterSchema(false,[],[],false),packet).length,'quiet requests defer full location command detail');
    assert(Errors(turnPacketParameterSchema(true,[],[],false,undefined,true),packet).length,'a settled journey cannot be advertised again');
    const localArrival={version:4,commands:[{kind:'place',action:'move',to:'here',at:'counter',relation:'beside'}]};
    assert.equal(Errors(turnPacketParameterSchema(true,[],[],false,undefined,true),localArrival).length,0,'after arrival the Keeper can still refine the current local position');
    assert(Errors(turnPacketParameterSchema(true,[],[],false,undefined,true),{...localArrival,commands:[{...localArrival.commands[0],travel_band:'adjacent'}]}).length,'local refinement cannot repeat travel time');
    const route=compileTurnPacket(turnPacket(JSON.stringify({version:4,commands:[command,{kind:'time',until:{time:'18:00'},reason:'Wait until six.'},{kind:'move',to:'Office'}]}))).effects;
    assert.deepEqual(route.map(effect=>effect.kind),['place','time','move'],'several stops and a wait keep their submitted order');
    assert.deepEqual(route[1].until,{time:'18:00'});
    const feature={kind:'place',action:'feature',to:'Inn',at:'window',state:'open',passable:true};
    assert.deepEqual(compileTurnPacket(turnPacket(JSON.stringify({version:4,commands:[feature]}))).effects,[feature]);
    assert.throws(()=>turnPacket(JSON.stringify({version:4,commands:[{...command,travel_minutes:5}]})),/Invalid decision command/);
    assert.deepEqual(turnPacketResult({outcomes:[{kind:'place',status:'changed',position:{place:'Inn',at:'counter'}}]}).outcomes[0].position,{place:'Inn',at:'counter'});
});

test('enhanced consent reads exact observable references and invalidates changed reference context',()=>{
    const view={name:'Ordinary Inn / Room',display_name:'Room',within:'Ordinary Inn',description:'A small room.',
        position:{place:'Ordinary Inn / Room',at:'bed',relation:'beside'},private_summary:'NEVER_INCLUDE',
        features:[{name:'window',description:'The window faces the rear alley.',state:'closed',passable:false,id:'private-id'},{name:'bed',description:'An iron bed.'}]};
    const before=structuredClone(view),reference=registeredLocationDestination('here',view,['WINDOW']);
    assert.deepEqual(reference.location.features,[{name:'window',description:'The window faces the rear alley.',state:'closed',passable:false}]);
    assert.equal(reference.handle,view.name);assert.deepEqual(reference.inside,['Ordinary Inn']);assert.deepEqual(view,before);
    assert(!JSON.stringify(reference).includes('NEVER_INCLUDE'));assert(!JSON.stringify(reference).includes('private-id'));
    const effect={kind:'place',action:'move',to:'here',at:'window',relation:'beside'};
    const proposal=admissionRequest('apply',{effects:[effect]},{party:['Investigator'],destinations:[reference]});
    assert.deepEqual(proposal.operations[0].registered_destination,reference);assert(proposal.lines[0].includes('rear alley'));
    const changed=structuredClone(reference);changed.location.features[0].state='open';
    assert.notEqual(proposal.key,admissionRequest('apply',{effects:[effect]},{party:['Investigator'],destinations:[changed]}).key,'a changed canonical reference cannot reuse its old consent scope');
});

test('an independently selected activity after arrival uses canonical extra time without double counting travel',()=>{
    const extra={kind:'time',band:'speak_briefly',reason:'Ask the clerk about an available room.',beyond_travel:true};
    const packet={version:4,commands:[command,extra,{kind:'scene',service:'open',crowd:'quiet'}]};
    const schema=turnPacketParameterSchema(false,['speak_briefly'],[],false,undefined,true);
    assert.equal(Errors(schema,packet).length,0);
    const compiled=compileTurnPacket(turnPacket(JSON.stringify(packet)));
    assert.deepEqual(compiled.effects[1],{kind:'time',band:'speak_briefly',why:extra.reason,beyond_travel:true});
    assert.deepEqual(compileTurnPacket(turnPacket(JSON.stringify({...packet,commands:[command,{kind:'time',band:extra.band,reason:extra.reason}]}))).effects[1],
        {kind:'time',band:'speak_briefly',why:extra.reason},'§250: time beside a move is always additional; no marker is required');
    assert.deepEqual(compileTurnPacket(turnPacket(JSON.stringify({...packet,commands:[extra,command]}))).effects.map(effect=>effect.kind),['time','place'],'a wait before the journey keeps its place');
    assert.deepEqual(compileTurnPacket(turnPacket(JSON.stringify({...packet,commands:[extra]}))).effects,[compiled.effects[1]],'a harmless compatibility marker agrees with the ordinary stationary schema');
    assert(Errors(schema,{...packet,commands:[command,{...extra,band:'invented'}]}).length,'issued time bands still bound the extra activity');
});

test('location consent distinguishes Keeper scene creation from the actual selected journey and restrictions',()=>{
    const line=continuousConsentLine(command);
    assert.equal(line.to,command.to);assert.deepEqual(line.additions,command.additions);
    assert.match(line.arrival_scope.additions,/not an investigator construction/);
    const questions=continuousConsentQuestions(['place']);
    assert.match(questions[0].instructions,/need not supply its name/);
    assert.match(questions[1].instructions,/entry or crossing/);
    assert.equal(continuousConsentDisposition(.42,.12),'uncertain','new semantics never predetermine approval');
    assert.equal(continuousConsentDisposition(.95,.9),'not_authorized','a current restriction still vetoes a selected journey');
    assert.deepEqual(refusedMovesOf('apply',[command,{kind:'place',action:'feature',to:'Inn',at:'window',state:'closed'}],new KernelError({code:'needs',message:'Uncertain',details:{reason:'action_admission_uncertain'}})),
        [{to:command.to,reason:'action_admission_uncertain'}],'failed enhanced arrival reaches the existing delivery consumer');
});

test('native location arrays decode exact transport booleans without changing the selected operation',()=>{
    const original={version:4,commands:{item:{...command,additions:{item:{name:'Ordinary Inn',description:'A modest inn.',features:{item:[{name:'window',description:'A casement.',passable:'false'}]}}}}}};
    const before=structuredClone(original),decoded=normalizeTurnPacketArguments(original);
    assert.equal(decoded.booleanRepairs,1);assert(decoded.repairs>=3);assert.deepEqual(original,before);
    assert.equal(decoded.args.commands[0].additions[0].features[0].passable,false);
    assert.equal(decoded.args.commands[0].action,'move');assert.equal(decoded.args.commands[0].to,command.to);
    assert.doesNotThrow(()=>turnPacket(JSON.stringify(decoded.args)));
    for(const value of ['yes','FALSE','0']){
        const input={version:4,commands:[{kind:'place',action:'feature',to:'Inn',at:'window',passable:value}]};
        assert.equal(normalizeTurnPacketArguments(input).args,input);
        assert.throws(()=>turnPacket(JSON.stringify(input)));
    }
    const literal={version:4,commands:[{kind:'time',band:'brief_activity',reason:'Look around',beyond_travel:'false'}]};
    assert.throws(()=>turnPacket(JSON.stringify(normalizeTurnPacketArguments(literal).args)),'false cannot satisfy a true-only flag');
});

test('an unrelated invalid parent does not hide behind native array envelopes',()=>{
    const input={version:4,commands:[{...command,additions:{item:{name:'Ordinary Inn',within:42,description:'A public inn.',features:{item:{name:'window',description:'A wooden window.'}}}}}]};
    const original=structuredClone(input),decoded=normalizeTurnPacketArguments(input);
    assert.deepEqual(input,original);assert.equal(decoded.repairs,2);
    assert.equal(decoded.args.commands[0].additions[0].within,42,'wrongly typed parent values are never filled or omitted');
    assert.throws(()=>turnPacket(JSON.stringify(decoded.args)),/additions\/0\/within/,'the real field reaches same-turn correction');
    const corrected=structuredClone(decoded.args);delete corrected.commands[0].additions[0].within;
    assert.doesNotThrow(()=>turnPacket(JSON.stringify(corrected)));
    const unknown={version:4,commands:[{kind:'unissued',action:'move',additions:{item:{name:'Inn'}}}]};
    assert.equal(normalizeTurnPacketArguments(unknown).args,unknown,'unknown discriminators never select a supported operation');
});

test('resident location declarations defer detailed grammar while canonical validators stay complete',()=>{
    const before=JSON.stringify(COC_TOOLS),view=locationToolDeclarations(COC_TOOLS);
    const canonical=COC_TOOLS.find(tool=>tool.name==='place'),entry=view.find(tool=>tool.name==='place');
    assert(Buffer.byteLength(JSON.stringify(entry.parameters))<Buffer.byteLength(JSON.stringify(canonical.parameters))/2);
    const apply=view.find(tool=>tool.name==='apply'),branches=apply.parameters.properties.effects.items.anyOf;
    const envelope=branches.find(branch=>branch.properties.kind.anyOf?.some(value=>value.const==='place'));
    assert(envelope);assert.equal(envelope.properties.additions,undefined);
    assert.equal(JSON.stringify(COC_TOOLS),before,'request projection never edits registered schemas');
    const full=locationToolDeclarations(COC_TOOLS,true).find(tool=>tool.name==='place');
    assert.equal(full.parameters.type,'object');assert(full.parameters.properties.additions,'provider object fields remain explicit');
    for(const input of [{action:'inspect'},{action:'move',to:'Inn'},{action:'inspect',change:{}},{action:'move'},{action:'move',to:'Inn',patch:{cash:5}}])
        assert.equal(Errors(full.parameters,input).length===0,Errors(canonical.parameters,input).length===0,'provider shape retains the canonical branch constraints');
    const calls=emptyCalls();noteCall(calls,'place',{op:'submit',change:{action:'move',to:'Inn'}});
    assert(calls.apply.has('place'),'the independent entrance fires the existing Mod trigger');
    assert.deepEqual(applyEffectKinds('output',{commands:[command,{kind:'scene'}]}),['place']);
    assert.deepEqual(applyEffectKinds('apply',{effects:[command,{kind:'cash'}]}),['place','cash'],'mixed canonical calls disclose location detail through the same closed effect path');
    assert.deepEqual(applyEffectKinds('place',{op:'inspect'}),[],'a read is not a world mutation');
    assert.deepEqual(applyEffectKinds('place',{action:'inspect'}),[]);
    assert.deepEqual(applyEffectKinds('place',{action:'move',to:'Inn'}),['place'],'flat native writes use the same Mod trigger');
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
    const attached={role:'toolResult',toolName:'place',toolCallId:'move-1',details:{location_disclosure:{turn:3,index:1,package:'enhanced-locations'}},content:[{type:'text',text:'The move committed.'},
        {type:'text',text:JSON.stringify({kind:'disclosed_detail',package_sections:[{package:'enhanced-locations',text:'Location guidance '.repeat(100)},{package:'historical-reference',text:'Keep this unrelated package guidance.'}],capability_detail:[{name:'place',parameters:PlaceParameters},{name:'resolve',description:'Keep this unrelated rule detail.'}]})}]};
    const rawAttached=structuredClone(attached),projected=projectLocationInspections([attached],4).messages[0];
    assert.equal(projected.content[0].text,'The move committed.');assert.deepEqual(attached,rawAttached);
    const detail=JSON.parse(projected.content[1].text);assert.deepEqual(detail.package_sections,[{package:'historical-reference',text:'Keep this unrelated package guidance.'}]);
    assert.deepEqual(detail.capability_detail,[{name:'resolve',description:'Keep this unrelated rule detail.'}]);
    const unidentified=structuredClone(attached);delete unidentified.details.location_disclosure.package;
    assert.equal(JSON.parse(projectLocationInspections([unidentified],4).messages[0].content[1].text).package_sections.length,2,'unidentified package history is preserved');
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
