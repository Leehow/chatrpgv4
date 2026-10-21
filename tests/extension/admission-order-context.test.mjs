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
test('native atomic review retains the actual start, source order and conditional prior move while uncertainty still holds',async()=>{
 const player='I go to the counter, wait until seven, return to the window, then look out.';
 const proposal=admissionRequest('apply',{effects:[{kind:'place',action:'move',to:'Dining room',at:'Window'},{kind:'place',action:'observe',to:'Street',sense:'sight',access:'clear',scope:'The door',facts:['The door remains closed.']}]},{party:['Thomas'],consentOnly:true});let batch;
 const result=await reviewAdmissionJevOnly({campaign:'order',proposal,context:{turn:1,playerText:player,investigators:[{name:'Thomas'}],present:[],delivered:[],landed:['Actual wait settled.'],refused:[],currentPosition:{place:'Dining room',at:'Counter'},currentClock:{at:'1920-10-12T19:00'}},env:{},record:()=>{},ctx:{},decision:{decide:async value=>{batch=value;return{batchId:value.id,status:'complete',answers:Object.fromEntries(value.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key==='restriction_1'?.45:q.key.startsWith('restriction_')?.1:.9}])),usage:{}};}}});
 assert.equal(batch.familyVersion,'23');assert.equal(batch.state.current_player_words,player);assert.deepEqual(batch.state.current_position,{place:'Dining room',at:'Counter'});
 assert.equal(batch.state.declaration_segments.map(x=>x.text).join(''),player);assert.equal(batch.state.proposal.lines[1].execution_position.before.at,'Window');
 assert.match(batch.questions.find(q=>q.key==='restriction_1').instructions,/never settled state or permission/);assert.equal(result.verdict.verdict,'uncertain');
});
