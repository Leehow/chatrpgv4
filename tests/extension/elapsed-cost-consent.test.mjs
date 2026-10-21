/** Semantic wording evidence and unchanged fail-closed arithmetic; no live acceptance claim. */
import assert from 'node:assert/strict';import {test} from 'node:test';
import {continuousConsentQuestions,continuousConsentDisposition,CONTINUOUS_CONSENT_MIN} from '../../runtime/jev/continuous-consent.ts';
import {admissionRequest,reviewAdmissionJevOnly} from '../../extensions/kernel/admission.ts';
test('elapsed-cost consent separates ordinary activity cost from independent delay',()=>{
 const questions=continuousConsentQuestions(['place','time'],['move',undefined]);
 const cost=questions.find(q=>q.key==='consent_1');
 assert.match(cost.instructions,/Ordinary elapsed cost of a chosen physical activity is not a separate request to pause/);
 assert.match(cost.criteria.false,/unselected activity.*independent delay.*duplicate cost.*extent outside/);
 assert.match(cost.instructions,/Keeper reason or a neighboring proposal is not consent/);
 assert.equal(questions.length,4);assert.equal(cost.target,'proposal.lines[1]');
 assert.equal(CONTINUOUS_CONSENT_MIN,.6);
 assert.equal(continuousConsentDisposition(.59,.2),'uncertain');
 assert.equal(continuousConsentDisposition(.9,.41),'uncertain');
 assert.equal(continuousConsentDisposition(.6,.4),'authorized');
 assert.equal(continuousConsentDisposition(.09,.2),'not_authorized');
});
for(const selection of [.59,.67])test(`native time batch versions the question and retains gate at ${selection}`,async()=>{
 let batch;
 const proposal=admissionRequest('apply',{effects:[{kind:'place',action:'move',to:'Inn',at:'Counter'},{kind:'time',band:'momentary',why:'Selected local steps',beyond_travel:true}]},{party:['Thomas'],consentOnly:true});
 const result=await reviewAdmissionJevOnly({campaign:'cost',proposal,context:{turn:1,playerText:'I return to the counter and look around.',investigators:[{name:'Thomas'}],present:[],delivered:[],landed:[],refused:[],currentPosition:{place:'Inn',at:'Window'},currentClock:{at:'1920-10-13T01:00'}},env:{},record:()=>{},ctx:{},decision:{decide:async value=>{batch=value;return{batchId:value.id,status:'complete',answers:Object.fromEntries(value.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key.startsWith('restriction_')?.2:q.key==='consent_1'?selection:.9}])),usage:{}};}}});
 assert.equal(batch.familyVersion,'21');assert.equal(batch.questions.length,4);
 assert.equal(batch.state.current_player_words,'I return to the counter and look around.');
 assert.equal(result.verdict.verdict,selection<.6?'uncertain':'authorized');
});
