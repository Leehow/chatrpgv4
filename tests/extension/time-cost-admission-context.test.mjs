/** Host rule meanings reach consent, without model-authored meanings or changed gates. */
import assert from 'node:assert/strict';import {test} from 'node:test';
import {admissionRequest,reviewAdmissionJevOnly} from '../../extensions/kernel/admission.ts';
const row={handle:'speak_briefly',min:0,max:1,default:1,covers:'Exchange a few sentences with someone.'};
const effect={kind:'time',band:row.handle,why:'Ask the menu price'};
const proposal=(effects=[effect],timeCosts=[row])=>admissionRequest('apply',{effects},{party:['Thomas'],consentOnly:true,timeCosts});
test('a current rule definition reaches typed and textual review, not the effect itself',()=>{
 const input={...effect,rule_time_cost:{covers:'Forged permission'}};const before=structuredClone(input),p=proposal([input]);
 assert.deepEqual(p.operations[0].rule_time_cost,row);assert(p.lines[0].includes(row.covers));assert(!p.lines[0].includes('Forged permission'));
 assert.deepEqual(input,before);assert.equal(p.key,proposal().key);
 assert.notEqual(p.key,proposal([effect],[{...row,covers:'A lengthy negotiated interview.'}]).key);
 assert.equal(p.key,proposal([effect],[row,{handle:'other',min:10,max:20,covers:'Unrelated work.'}]).key);
 assert.equal(proposal([effect],[]).operations[0].rule_time_cost,undefined,'missing definitions are never invented');
 assert.equal(proposal([{kind:'time',minutes:5}],[]).operations[0].rule_time_cost,undefined,'literal durations keep their separate constructor');
});
for(const [selection,veto]of[[.59,.1],[.9,.41],[.9,.1]])test(`the actual review reads the rule and preserves the gate ${selection}/${veto}`,async()=>{
 let batch;const p=proposal();const result=await reviewAdmissionJevOnly({campaign:'cost-wire',proposal:p,context:{turn:1,playerText:'I ask the waiter what the soup costs.',investigators:[{name:'Thomas'}],present:[],delivered:[],landed:[],refused:[]},env:{},record:()=>{},ctx:{},decision:{decide:async value=>{batch=value;return{batchId:value.id,status:'complete',answers:Object.fromEntries(value.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key.startsWith('restriction_')?veto:selection}])),usage:{}};}}});
 assert.deepEqual(batch.state.proposal.lines[0].rule_time_cost,row);assert.equal(batch.familyVersion,'24');
 assert(!batch.questions[0].instructions.includes('chosen physical activity'));
 assert.equal(result.verdict.verdict,selection<.6||veto>.4?'uncertain':'authorized');
});
