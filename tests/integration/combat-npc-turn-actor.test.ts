/** An NPC's fight action sent without its actor is told whose turn it is (1026j). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveErr} from './rules-rpc-support.ts';
import {clientFor,corbittsTurn,CORBITT,INVESTIGATOR} from './rules-fight-fixtures.ts';
// 1026j An Amaranthine Desire T12: the NPC's grab sent without action.actor was read as the investigator attacking himself;
// the refusal offered the NPC as the target and the Keeper swapped the two until the three-strikes stop.
test('an NPC\'s fight action sent without its actor is told whose turn it is',async t=>{
 const k=await clientFor(t),n=await corbittsTurn(k);
 const error=await resolveErr(k,`t1-c${n}`,{intent:'combat',goal:'grab the ledger back',method:'wrench his wrist',target:INVESTIGATOR,weapon:'unarmed',defense:'fight_back'});
 assert.equal(error.code,'turn_state',JSON.stringify(error));
 assert.equal(error.details.turn_of,CORBITT);
 assert.match(error.fix,/action\.actor/);
});
