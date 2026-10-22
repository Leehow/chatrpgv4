/** Semantic wording evidence and unchanged fail-closed arithmetic; no live acceptance claim. */
import assert from 'node:assert/strict';import {test} from 'node:test';
import {continuousConsentQuestions,continuousConsentDisposition,CONTINUOUS_CONSENT_MIN} from '../../runtime/jev/continuous-consent.ts';
import {admissionRequest,reviewAdmissionJevOnly} from '../../extensions/kernel/admission.ts';
test('elapsed-cost consent separates ordinary activity cost from independent delay',()=>{
 const questions=continuousConsentQuestions(['place','time'],['move',undefined],[undefined,'band']);
 const cost=questions.find(q=>q.key==='consent_1');
 assert.match(cost.instructions,/Ordinary elapsed cost of a chosen activity is not a separate request to pause/);
 assert.match(cost.criteria.false,/unselected activity.*independent delay.*duplicate cost.*extent outside/);
 assert.match(cost.instructions,/Keeper reason or a neighboring proposal is not consent/);
 assert.equal(questions.length,4);assert.equal(cost.target,'proposal.lines[1]');
 assert.equal(CONTINUOUS_CONSENT_MIN,.6);
 assert.equal(continuousConsentDisposition(.59,.2),'uncertain');
 assert.equal(continuousConsentDisposition(.9,.41),'uncertain');
 assert.equal(continuousConsentDisposition(.6,.4),'authorized');
 assert.equal(continuousConsentDisposition(.09,.2),'not_authorized');
});

test('typed time forms preserve an exact wait endpoint and an explicit duration',()=>{
 const wait=continuousConsentQuestions(['time'],[],['until'])[0],duration=continuousConsentQuestions(['time'],[],['minutes'])[0];
 assert.match(wait.instructions,/Compare the selected stopping point with until/);assert.match(wait.criteria.false,/different endpoint/);
 assert.match(duration.instructions,/explicitly select the duration/);assert.match(duration.criteria.false,/different duration/);
 assert.equal(wait.target,'proposal.lines[0]');assert.equal(duration.target,'proposal.lines[0]');
});
test('§249: explicit waits and activity time are judged by the single Keeper, not put to the typed review',()=>{
 const scope={party:['Thomas'],consentOnly:true};
 for(const effects of [[{kind:'place',action:'move',to:'Inn',at:'Counter'},{kind:'time',band:'momentary',why:'Selected local steps',beyond_travel:true}],
  [{kind:'time',until:{time:'01:15'},why:'Selected wait'}],[{kind:'time',minutes:15,why:'Selected wait'}]])
  assert.equal(admissionRequest('apply',{effects},scope),null,JSON.stringify(effects));
});
