/** Native admission must carry the same ownership and actual-cost policy as legacy review. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {admissionRequest,reviewAdmissionJevOnly,CASH_CONSENT_POLICY} from '../../extensions/kernel/admission.ts';

test('native service review retains exact cost preview, NPC agency and prior refusals without granting consent',async()=>{
 const preview={index:1,subject:'Thomas',with:'Shopkeeper',purchase_amount:.08,delta:0,currency:'USD',settlement:'spending_level'};
 const proposal=admissionRequest('apply',{effects:[
  {kind:'object',name:'Bread',from:'Shopkeeper',to:'Thomas',handover:'given'},
  {kind:'cash',subject:'Thomas',with:'Shopkeeper',category:'purchase',items:[{name:'Bread',quantity:1,unit_price:'.08'}]},
 ]},{party:['Thomas'],cash:{previews:[preview],quotes:[],consent_policy:CASH_CONSENT_POLICY}});
 let batch;
 const result=await reviewAdmissionJevOnly({campaign:'service',proposal,context:{turn:1,playerText:'Is the shop open? I would like some bread.',investigators:[{name:'Thomas'}],present:['Shopkeeper'],delivered:[],landed:[],refused:['Earlier purchase was refused; no handover occurred.']},env:{},ctx:{},record(){},decision:{async decide(value){
  batch=value;return {batchId:value.id,status:'complete',answers:Object.fromEntries(value.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key.startsWith('restriction_')?.5:.9}])),usage:{}};
 }}});
 assert.deepEqual(batch.state.proposal.lines[1].registered_cash_context.previews,[preview]);
 assert.equal(batch.state.proposal.lines[1].registered_cash_context.consent_policy,CASH_CONSENT_POLICY);
 assert.equal(batch.state.proposal.lines[0].acting_party,'Shopkeeper');
 assert.deepEqual(batch.state.refused_this_turn,['Earlier purchase was refused; no handover occurred.']);
 assert.match(batch.questions.find(q=>q.key==='consent_1').instructions,/actual delta/);
 assert.match(batch.questions.find(q=>q.key==='consent_0').instructions,/NPC initiative/);
 assert.equal(result.verdict.verdict,'uncertain');
 assert.equal(result.meta.jev_calls,1);
});
