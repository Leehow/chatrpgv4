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
import {locationContextBatch,locationContextRelevance,locationCoverageBatch,locationDecisionCoverage} from '../../extensions/table/location-relevance.ts';
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
test('input relevance selects context only, keeps uncertainty conservative and names no destination',async()=>{
    const capsule={mods:{location_context:{mod:'enhanced-locations',version:'1.0.1'}},turn:{player_text:'I enter an ordinary inn.'},where:{scene:'Office'}},binding={campaign:'test',turn:1};
    const batch=locationContextBatch(capsule,binding);packDecisionBatch(batch);
    assert.equal(batch.questions.length,4);assert(batch.questions.every(question=>question.type==='noul'));
    for(const [probability,needed]of [[.96,true],[.02,false]]){
        const result=await locationContextRelevance(capsule,binding,{decide:async current=>({batchId:current.id,status:'complete',answers:Object.fromEntries(current.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:probability}]))})},new AbortController().signal);
        assert.equal(result.needed,needed);assert.equal(result.review,needed);assert.equal(result.probabilities.move_selected,probability);assert.equal(result.to,undefined);
    }
    const fallback=await locationContextRelevance(capsule,binding,undefined,new AbortController().signal);
    assert.equal(fallback.needed,true);assert.equal(fallback.review,false,'an unavailable applicability check discloses context without inventing a selected action');
    const reference=await locationContextRelevance(capsule,binding,{decide:async current=>({batchId:current.id,status:'complete',answers:Object.fromEntries(current.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key==='reference_selected'?.99:.01}]))})},new AbortController().signal);
    assert.equal(reference.needed,true);assert.equal(reference.review,false,'a location question alone does not require execution');
});
test('spatial completion composes independent movement and feature answers without an invented confidence',async()=>{
    const binding={campaign:'test',turn:2},input={player_declaration:'I approach the window.',proposed_effects:[],settled_receipts:[]};
    const batch=locationCoverageBatch(input,binding);packDecisionBatch(batch);
    assert.equal(batch.familyVersion,'7');assert.equal(batch.questions.length,6);assert(batch.questions.every(question=>question.type==='noul'));
    assert(!batch.questions.some(question=>question.key.endsWith('_accounted')),'typed operation presence is not a model judgment');
    const review=async(values,effects=[])=>locationDecisionCoverage({...input,proposed_effects:effects},binding,{decide:async current=>({batchId:current.id,status:'complete',answers:Object.fromEntries(current.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:values[q.key]??.01}]))})},new AbortController().signal);
    const missing=await review({move_selected:.99});
    assert.equal(missing.covered,false);assert.equal(missing.axes.move,'missing');assert.equal(missing.axes.feature,'not_selected');
    assert.equal(missing.probabilities.move_selected,.99);assert.equal(missing.probability,undefined,'independent answers have no aggregate probability');
    assert.equal(missing.to,undefined,'a completion finding never executes a destination');
    const move={kind:'move',to:'Ordinary Inn'};
    const arrival=await review({move_selected:.99},[move]);assert.equal(arrival.covered,true);assert.equal(arrival.accounting.move,'proposed');
    const omittedFeature=await review({move_selected:.99,feature_selected:.99},[move]);
    assert.equal(omittedFeature.covered,false);assert.equal(omittedFeature.axes.feature,'missing','a movement does not replace opening the window');
    const blocked=await review({move_selected:.99,move_blocked:.99});assert.equal(blocked.covered,true);assert.equal(blocked.axes.move,'blocked');
    const unsure=await review({move_selected:.5});assert.equal(unsure.covered,false);assert.equal(unsure.axes.move,'uncertain');
    assert.equal((await review({move_selected:.4})).covered,true,'a negative selection does not force an action');
    const unavailable=await locationDecisionCoverage(input,binding,undefined,new AbortController().signal);assert.equal(unavailable.covered,false);
    const partial=await locationDecisionCoverage(input,binding,{decide:async current=>({batchId:current.id,status:'complete',answers:{move_selected:{status:'answered',type:'noul',noul:.99}}})},new AbortController().signal);
    assert.equal(partial.status,'fallback');assert.equal(partial.covered,false,'all independent answers must be valid');
    const selected={...input,initial_selection:{move:.95,feature:.02,observation:.01}};
    const noRepeat={decide:async()=>{throw Error('An actual typed movement is judged by admission, not another completion question');}};
    for(const [extra,source]of [[{proposed_effects:[move]},'proposed'],[{settled_receipts:[{kind:'move',from:'Room',to:'Ordinary Inn'}]},'committed']]){
        const accounted=await locationDecisionCoverage({...selected,...extra},binding,noRepeat,new AbortController().signal);
        assert.equal(accounted.covered,true);assert.equal(accounted.jev_calls,0);assert.equal(accounted.accounting.move,source);assert.equal(accounted.status,'accounted');
    }
    const missingBatch=locationCoverageBatch(selected,binding);
    assert.deepEqual(missingBatch.questions.map(question=>question.key),['move_blocked'],'only the missing selected dimension asks about a real blocker');
});
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

test('an already established local position can satisfy completion without another move',async()=>{
    const input={player_declaration:'I sit by the window.',current_place:'Tea room',current_position:{place:'Tea room',at:'window table',relation:'beside'},features:[{name:'window table'}],initial_selection:{move:.99,feature:.02},proposed_effects:[],settled_receipts:[]};
    const review=async(probability)=>locationDecisionCoverage(input,{campaign:'test',turn:3},{decide:async batch=>({batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(question=>[question.key,{status:'answered',type:'noul',noul:question.key==='move_satisfied'?probability:.01}]))})},new AbortController().signal);
    const covered=await review(.99);assert.equal(covered.covered,true);assert.equal(covered.axes.move,'already_satisfied');assert.equal(covered.accounting.move,null);assert.equal(covered.to,undefined);
    assert.equal((await review(.49)).covered,false,'uncertain established satisfaction does not bypass completion');
    assert.match(locationCoverageBatch(input,{campaign:'test',turn:3}).questions.find(question=>question.key==='move_satisfied').instructions,/same enclosing place/);
    const noPosition={...input,current_position:undefined};
    assert.equal(locationCoverageBatch(noPosition,{campaign:'test',turn:3}).questions.some(question=>question.key==='move_satisfied'),false,'a narrated pose alone is not established state');
});

test('already satisfied feature state still requires complete evidence-bound answers',async()=>{
    const input={player_declaration:'I open the window.',current_place:'Room',features:[{name:'window',state:'open',passable:true}],initial_selection:{move:.01,feature:.99},proposed_effects:[],settled_receipts:[]},binding={campaign:'test',turn:4};
    const result=await locationDecisionCoverage(input,binding,{decide:async batch=>({batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(question=>[question.key,{status:'answered',type:'noul',noul:question.key==='feature_satisfied'?.99:.01}]))})},new AbortController().signal);
    assert.equal(result.covered,true);assert.equal(result.axes.feature,'already_satisfied');assert.equal(result.accounting.feature,null);
    const unavailable=await locationDecisionCoverage(input,binding,undefined,new AbortController().signal);assert.equal(unavailable.covered,false);
    const partial=await locationDecisionCoverage(input,binding,{decide:async batch=>({batchId:batch.id,status:'complete',answers:{feature_satisfied:{status:'answered',type:'noul',noul:.99}}})},new AbortController().signal);
    assert.equal(partial.covered,false);assert.equal(partial.status,'fallback');
    assert.equal(locationCoverageBatch({...input,features:[{name:'window'}]},binding).questions.some(question=>question.key==='feature_satisfied'),false);
});

test('native typed location commands use open destinations, the same effect and one journey limit',()=>{
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
    assert.throws(()=>turnPacket(JSON.stringify({version:4,commands:[command,{kind:'move',to:'Office'}]})),/Only one destination/);
    assert.throws(()=>turnPacket(JSON.stringify({version:4,commands:[command,{kind:'time',band:'work',reason:'test'}]})));
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
    assert.throws(()=>turnPacket(JSON.stringify({...packet,commands:[command,{kind:'time',band:extra.band,reason:extra.reason}]})),/Movement already owns travel time.*beyond_travel/);
    assert.throws(()=>turnPacket(JSON.stringify({...packet,commands:[extra,command]})),/must follow the journey/);
    assert.deepEqual(compileTurnPacket(turnPacket(JSON.stringify({...packet,commands:[extra]}))).effects,[compiled.effects[1]],'a harmless compatibility marker agrees with the ordinary stationary schema');
    assert(Errors(schema,{...packet,commands:[command,{...extra,band:'invented'}]}).length,'issued time bands still bound the extra activity');
});

test('location consent distinguishes Keeper scene creation from the actual selected journey and restrictions',()=>{
    const line=continuousConsentLine(command);
    assert.equal(line.to,command.to);assert.deepEqual(line.additions,command.additions);
    assert.match(line.arrival_scope.additions,/not an investigator construction/);
    const questions=continuousConsentQuestions(['place']);
    assert.match(questions[0].instructions,/need not supply its name/);
    assert.match(questions[1].instructions,/entry or boundary crossing/);
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
    assert.equal(full.parameters.type,'object');assert(full.parameters.properties.change.properties.additions,'provider object fields remain explicit');
    for(const input of [{op:'inspect'},{op:'submit',change:{action:'move',to:'Inn'}},{op:'inspect',change:{}},{op:'submit'},{op:'submit',change:{action:'move',to:'Inn',patch:{cash:5}}}])
        assert.equal(Errors(full.parameters,input).length===0,Errors(canonical.parameters,input).length===0,'provider shape retains the canonical branch constraints');
    const calls=emptyCalls();noteCall(calls,'place',{op:'submit',change:{action:'move',to:'Inn'}});
    assert(calls.apply.has('place'),'the independent entrance fires the existing Mod trigger');
    assert.deepEqual(applyEffectKinds('output',{commands:[command,{kind:'scene'}]}),['place']);
    assert.deepEqual(applyEffectKinds('apply',{effects:[command,{kind:'cash'}]}),['place','cash'],'mixed canonical calls disclose location detail through the same closed effect path');
    assert.deepEqual(applyEffectKinds('place',{op:'inspect'}),[],'a read is not a world mutation');
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
