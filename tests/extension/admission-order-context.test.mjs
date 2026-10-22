/** The review sees exact words and conditional geometry, never a fabricated receipt. */
import {test} from 'node:test';import assert from 'node:assert/strict';
import {declarationSegments,conditionalExecutionPositions} from '../../runtime/jev/consent-order-context.ts';
import {admissionRequest,reviewAdmissionJevOnly} from '../../extensions/kernel/admission.ts';
test('source segmentation preserves every character and coalesces its bounded tail',()=>{
 for(const source of ['First approach the counter, then wait; return to the window.',' A, B; C! '.repeat(100),'','No punctuation']){
  const spans=declarationSegments(source);assert.equal(spans.map(x=>x.text).join(''),source);assert(spans.length<=64);assert.deepEqual(spans.map(x=>x.index),spans.map((_,i)=>i));
 }
});
test('conditional positions advance only through typed movements without changing their canonical start',()=>{
 const current={place:'Dining room',at:'Counter'},move={kind:'place',action:'move',to:'here',at:'Window',relation:'beside'},observe={kind:'place',action:'observe',to:'Street'};
 const input=[move,observe],before=structuredClone(input),rows=conditionalExecutionPositions(input,[],current);
 assert.deepEqual(rows[0].execution_position.before,current);assert.deepEqual(rows[1].execution_position.before,{place:'Dining room',at:'Window',relation:'beside'});
 assert.equal(rows[1].execution_position.conditional_on_earlier_approval,true);assert.deepEqual(input,before);assert.deepEqual(current,{place:'Dining room',at:'Counter'});
 assert.equal(conditionalExecutionPositions([observe],[],undefined)[0].execution_position.before,null);
 assert.equal(conditionalExecutionPositions([observe],[move],current)[0].execution_position.before.at,'Window');
});
test('§249: a selected route with its final look is judged by the single Keeper, not the typed review',()=>{
 const effects=[{kind:'place',action:'move',to:'Dining room',at:'Window'},{kind:'place',action:'observe',to:'Street',sense:'sight',access:'clear',scope:'The door',facts:['The door remains closed.']}];
 assert.equal(admissionRequest('apply',{effects},{party:['Thomas'],consentOnly:true}),null);
});
