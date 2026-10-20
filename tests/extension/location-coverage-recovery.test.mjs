/** Actual completion seam: an uncertain context hint is not a selected operation. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {locationDecisionCoverage} from '../../extensions/table/location-relevance.ts';

const binding={campaign:'spatial-recovery',turn:7};
const input={player_declaration:'I leave the lunchroom, enter a nearby open shop and look around its counter.',
 current_place:'Sporting shop',current_position:{place:'Sporting shop'},features:[{name:'counter',description:'A wooden counter.'}],
 initial_selection:{move:.97,feature:.49},proposed_effects:[],
 settled_receipts:[{kind:'move',from:'Lunchroom',to:'Sporting shop',position:{place:'Sporting shop'}}]};
const answer=(observed,selected=.02)=>({decide:async batch=>{
 observed.push(batch);
 return {batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,
  {status:'answered',type:'noul',noul:q.key==='feature_selected'?selected:.01}]))};
}});
test('ambiguous preliminary feature relevance is clarified against the committed journey',async()=>{
 const observed=[],before=structuredClone(input);
 const result=await locationDecisionCoverage(input,binding,answer(observed),new AbortController().signal);
 assert.equal(result.covered,true,'a clarified nonselected feature cannot veto the actual arrival');
 assert.equal(result.accounting.move,'committed');
 assert.equal(result.axes.feature,'not_selected');
 assert(observed.some(batch=>batch.questions.some(q=>q.key==='feature_selected')));
 assert.deepEqual(input,before);
});
test('clarification cannot discharge a selected uncommitted feature change or an unavailable decision',async()=>{
 for(const probability of [.49,.99]){
  const result=await locationDecisionCoverage(input,binding,answer([],probability),new AbortController().signal);
  assert.equal(result.covered,false);
 }
 const result=await locationDecisionCoverage(input,binding,undefined,new AbortController().signal);
 assert.equal(result.covered,false);
});
