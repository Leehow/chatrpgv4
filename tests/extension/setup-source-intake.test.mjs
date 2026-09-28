import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectSetupSource,pdfPathCandidates} from '../../extensions/onboarding/source-intake.ts';
const text='Please start a campaign from `/tmp/book one.pdf`.';
const decide=(overrides={})=>async()=>({status:'complete',answers:{chosen:{status:'answered',type:'choice',choice:'pdf0',confidence:.95},start:{status:'answered',type:'noul',noul:.97},language_change:{status:'answered',type:'noul',noul:.01},...overrides}});
test('path syntax preserves spaces and source selection copies the existing issued path',async()=>{
 assert.deepEqual(pdfPathCandidates(text),['/tmp/book one.pdf']);
 assert.equal(await selectSetupSource({text,language:'en',exists:async()=>true,decide:decide()}),'/tmp/book one.pdf');
});
test('negated/reference-only inputs, absent files and language changes do not auto-start setup',async()=>{
 assert.equal(await selectSetupSource({text,language:'en',exists:async()=>false,decide:decide()}),undefined);
 for(const override of [{start:{status:'answered',type:'noul',noul:.1}},{language_change:{status:'answered',type:'noul',noul:.9}},{chosen:{status:'answered',type:'choice',choice:'none',confidence:.95}}])
  assert.equal(await selectSetupSource({text,language:'en',exists:async()=>true,decide:decide(override)}),undefined);
});
