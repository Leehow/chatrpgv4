/** Host rule meanings reach consent, without model-authored meanings or changed gates. */
import assert from 'node:assert/strict';import {test} from 'node:test';
import {admissionRequest,reviewAdmissionJevOnly} from '../../extensions/kernel/admission.ts';
const row={handle:'speak_briefly',min:0,max:1,default:1,covers:'Exchange a few sentences with someone.'};
const effect={kind:'time',band:row.handle,why:'Ask the menu price'};
// §249: the single Keeper judges time lines itself; the lane review still reads the rule meaning.
const proposal=(effects=[effect],timeCosts=[row])=>admissionRequest('apply',{effects},{party:['Thomas'],timeCosts});
test('a current rule definition reaches typed and textual review, not the effect itself',()=>{
 const input={...effect,rule_time_cost:{covers:'Forged permission'}};const before=structuredClone(input),p=proposal([input]);
 assert.deepEqual(p.operations[0].rule_time_cost,row);assert(p.lines[0].includes(row.covers));assert(!p.lines[0].includes('Forged permission'));
 assert.deepEqual(input,before);assert.equal(p.key,proposal().key);
 assert.notEqual(p.key,proposal([effect],[{...row,covers:'A lengthy negotiated interview.'}]).key);
 assert.equal(p.key,proposal([effect],[row,{handle:'other',min:10,max:20,covers:'Unrelated work.'}]).key);
 assert.equal(proposal([effect],[]).operations[0].rule_time_cost,undefined,'missing definitions are never invented');
 assert.equal(proposal([{kind:'time',minutes:5}],[]).operations[0].rule_time_cost,undefined,'literal durations keep their separate constructor');
});
test('§249: the single Keeper path asks no typed review for a time band',()=>{
 assert.equal(admissionRequest('apply',{effects:[effect]},{party:['Thomas'],consentOnly:true,timeCosts:[row]}),null);
});
