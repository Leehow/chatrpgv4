/** Canonical occupied-position proof; actual semantic controls are retained live diagnostics. */
import test from 'node:test';import assert from 'node:assert/strict';
import {locationRouteBatch} from '../../extensions/table/location-relevance.ts';
const input={player_declaration:'I go to the window in Knott\'s office.',current_place:'commission-briefing',
 current_display_name:"Knott's Office",current_position:{place:'commission-briefing',at:'Window',relation:'beside'},
 place_identities:[{name:'commission-briefing',display_name:"Knott's Office"}],settled_receipts:[{kind:'time',minutes:2}],proposed_effects:[]};
test('occupied endpoint proof retains exact feature and public identity without inventing movement',()=>{
 const batch=locationRouteBatch(input,{campaign:'test',turn:39});
 assert.equal(batch.state.current_position.place,'commission-briefing');assert.equal(batch.state.current_position.at,'Window');
 assert.equal(batch.state.current_position.display_name,"Knott's Office");
 assert.deepEqual(batch.state.location_steps,[{stage:'committed',wait_minutes:2}]);
 assert(!batch.state.location_steps.some(step=>step.destination));
});
