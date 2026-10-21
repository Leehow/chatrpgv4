/** Semantic wording evidence and unchanged fail-closed arithmetic; no live acceptance claim. */
import assert from 'node:assert/strict';import {test} from 'node:test';
import {continuousConsentQuestions,continuousConsentDisposition,CONTINUOUS_CONSENT_MIN} from '../../runtime/jev/continuous-consent.ts';
import {admissionRequest,reviewAdmissionJevOnly} from '../../extensions/kernel/admission.ts';
test('elapsed-cost consent separates ordinary activity cost from independent delay',()=>{
 const questions=continuousConsentQuestions(['place','time'],['move',undefined],[undefined,'band']);
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
 assert.equal(batch.familyVersion,'22');assert.equal(batch.questions.length,4);
 assert.equal(batch.state.current_player_words,'I return to the counter and look around.');
 assert.equal(result.verdict.verdict,selection<.6?'uncertain':'authorized');
});

test('typed time forms preserve an exact wait endpoint and an explicit duration',()=>{
 const wait=continuousConsentQuestions(['time'],[],['until'])[0],duration=continuousConsentQuestions(['time'],[],['minutes'])[0];
 assert.match(wait.instructions,/Compare the selected stopping point with until/);assert.match(wait.criteria.false,/different endpoint/);
 assert.match(duration.instructions,/explicitly select the duration/);assert.match(duration.criteria.false,/different duration/);
 assert.equal(wait.target,'proposal.lines[0]');assert.equal(duration.target,'proposal.lines[0]');
});
for(const [fields,pattern]of[[{until:{time:'01:15'}},/Compare the selected stopping point with until/],[{minutes:15},/Compare the selected duration with minutes/]])test('primary review projects the typed time constructor without reading player keywords '+JSON.stringify(fields),async()=>{
 let batch;const proposal=admissionRequest('apply',{effects:[{kind:'time',...fields,why:'Selected wait'}]},{party:['Thomas'],consentOnly:true});
 await reviewAdmissionJevOnly({campaign:'form',proposal,context:{turn:1,playerText:'An arbitrary language declaration.',investigators:[{name:'Thomas'}],present:[],delivered:[],landed:[],refused:[]},env:{},record:()=>{},ctx:{},decision:{decide:async value=>{batch=value;return{batchId:value.id,status:'complete',answers:Object.fromEntries(value.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:.5}])),usage:{}};}}});
 assert.match(batch.questions[0].instructions,pattern);assert.equal(batch.familyVersion,'22');
});
