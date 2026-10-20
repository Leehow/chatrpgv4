/** Native financial guidance names interfaces actually offered to its decision agent. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';
import {offeredTools} from '../../extensions/kernel/lean-apply.ts';
test('native cash retains its quote shape and drops removed prose transport instructions',()=>{
 const tool=offeredTools(COC_TOOLS,{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1'}).find(row=>row.name==='apply');
 const cash=tool.parameters.properties.effects.items.anyOf.find(row=>row.properties.kind.enum?.[0]==='cash');
 assert.deepEqual(cash.properties.mode.enum,['quote','settle','cancel']);
 assert(!cash.properties.mode.description.includes('narrate'));
 assert(!cash.properties.bill.description.includes('{{price:'));
 assert(cash.properties.mode.description.includes('exact itemized offer'));
 const legacy=COC_TOOLS.find(row=>row.name==='apply').parameters.properties.effects.items.anyOf.find(row=>row.properties.kind.enum?.[0]==='cash');
 assert(legacy.properties.mode.description.includes('narrate.quotes'));
});
