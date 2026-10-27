/** A card revised in the approving message is not approved by it, and the refusal says to stop asking (1026n). */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel,CAMPAIGN} from './support.ts';
import {profile} from './setup-drafts.test.ts';
// 1026n Digging for a Dead God setup T3: the card was revised in "确认，进入桌面" and confirm was refused seven times in one reply.
test('the same-input refusal tells the Keeper to stop calling setup and ask again',async t=>{
  const k=await kernel(t,{});
  await k.ok('campaign.create',{id:CAMPAIGN,module:'the-haunting',play_language:'en'});
  const draft=await k.ok('setup.draft',{campaign:CAMPAIGN,profile:await profile(),input_key:'approval'});
  const error=await k.err('setup.confirm',{campaign:CAMPAIGN,revision:draft.revision,consent:'approved',input_key:'approval'});
  assert.equal(error.code_detail,'confirmation_required');
  assert.match(error.fix,/no more setup calls/);
});
