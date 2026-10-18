import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decideFirstSight,firstSightUnits} from '../../runtime/jev/first-sight-decision.ts';
const item={id:'clerk',kind:'person',described:'His coat is blue. His daughter lives abroad. His hands shake.'};
const input={campaign:'camp',turn:1,prose:'A blue-coated man looks up.',items:[item]};
const signal=()=>new AbortController().signal;
const port=(choices,inspect=()=>{})=>({async decide(batch,lease){inspect(batch,lease);return {status:'complete',answers:Object.fromEntries(batch.questions.map((q,i)=>[q.key,{status:'answered',type:'choice',choice:choices[i]??'pending',confidence:.99}]))};}});
test('typed coverage selects exact visible spans without copying hidden source or calling an author',async()=>{
 const result=await decideFirstSight(input,port(['shown','not_visible','missing_visible'],batch=>{assert.equal(batch.questions.length,3);assert.equal(batch.state.units[2].excerpt,'His hands shake.');}),signal());
 assert.equal(result.ok,true);assert.deepEqual(result.items,[{id:'clerk',kind:'person',missing:['His hands shake.']}]);assert.equal(result.pending,0);
});
test('mixed units, low confidence and unissued choices retain the whole item owed',async()=>{
 for(const mode of ['pending','low','foreign','incomplete']){
  const p={async decide(batch){return {status:'complete',answers:Object.fromEntries(batch.questions.map((q,i)=>[q.key,i===2?mode==='incomplete'?{status:'unknown'}:{status:'answered',type:'choice',choice:mode==='foreign'?'invented':mode==='pending'?'pending':'missing_visible',confidence:mode==='low'?.2:.99}:{status:'answered',type:'choice',choice:'shown',confidence:.99}]))};}};
  const result=await decideFirstSight(input,p,signal());assert.equal(result.ok,true);assert.deepEqual(result.items,[]);assert.equal(result.pending,1);
  assert.equal(result.blockers[0].item,'clerk');assert.equal(result.blockers[0].reason,({pending:'mixed_or_uncertain',low:'low_or_invalid_confidence',foreign:'unissued_choice',incomplete:'unanswered'})[mode]);
 }
});
test('one uncertain item does not lose another confident result',async()=>{
 const result=await decideFirstSight({...input,items:[{...item,described:'He is tall.'},{id:'hall',kind:'place',described:'A bright hall.'}]},port(['pending','missing_visible']),signal());
 assert.deepEqual(result.items,[{id:'hall',kind:'place',missing:['A bright hall.']}]);assert.equal(result.pending,1);
});
test('an undescribed person clears only when appearance is affirmatively shown',async()=>{
 for(const choice of ['shown','not_visible','missing_visible','pending']){
  const result=await decideFirstSight({...input,items:[{id:'clerk',kind:'person',described:'',undescribed:true}]},port([choice]),signal());
  assert.equal(result.items.length,choice==='shown'?1:0);assert.equal(result.pending,choice==='shown'?0:1);
 }
});
test('exact sentence spans preserve non-Latin text and every selected span belongs to the source',()=>{
 for(const text of ['A tall man. A blue coat.','高い窓。赤い扉。','عينا الرجل زرقاوان. يرتدي معطفا.'])for(const unit of firstSightUnits(text))assert.ok(text.includes(unit));
});
test('oversized or cancelled work never dispatches; unavailable work stays unaccepted',async()=>{
 let calls=0;const p={async decide(){calls++;throw Error('unavailable');}};
 assert.equal((await decideFirstSight(input,p,signal())).reason,'unavailable');assert.equal(calls,1);
 const control=new AbortController();control.abort();assert.equal((await decideFirstSight(input,p,control.signal)).reason,'cancelled');
 assert.equal((await decideFirstSight({...input,items:[{...item,described:Array(70).fill('A coat.').join(' ')}]},p,signal())).reason,'oversized');assert.equal(calls,1);
});
