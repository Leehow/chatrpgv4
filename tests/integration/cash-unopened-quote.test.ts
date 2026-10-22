/** Real TS RPC transactions, not live-play evidence (contract 250.4). */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel,openTurn,type Row} from './support.ts';

const fare={kind:'cash',mode:'settle',category:'living',quote:'Cab fare back to the office',source:'quote',with:'Steven Knott',
    items:[{name:'Cab fare',quantity:1,unit_price:'1.00'}],why:'The cab ride back to the office.'};

test('a settlement naming a quote no offer ever had, with its own priced lines, settles as that fresh expense',async t=>{
    const k=await kernel(t);await openTurn(k,'I take a cab back to the office and pay the fare.');
    const result=await k.table('apply',{call_id:'t1-c1',effects:[fare]});
    const outcome=result.outcomes.find((row:Row)=>row.kind==='cash');
    assert.deepEqual(outcome.adjusted,['quote: no_open_quote_fresh_expense']);
    assert.equal(outcome.transaction,'settled');
    const receipt=(await k.table('status',{projection:'receipts'})).receipts.find((row:Row)=>row.call_id==='t1-c1'&&row.kind==='cash');
    assert.equal(receipt.bill,'Cab fare back to the office','the name the Keeper gave becomes the bill');
    assert.equal(receipt.quote,undefined,'no offer is invented');
});

test('a settled or never-priced quote still refuses, so nothing is paid twice',async t=>{
    const k=await kernel(t);await openTurn(k,'I ask Knott what the cab fare is, then pay it.');
    const {mode:_settle,...offer}=fare;
    await k.table('apply',{call_id:'t1-c1',effects:[{...offer,mode:'quote'}]});
    const {items:_lines,...binding}=fare;
    await k.table('apply',{call_id:'t1-c2',effects:[binding]});
    await assert.rejects(k.table('apply',{call_id:'t1-c3',effects:[binding]}),/missing or already closed/);
    await assert.rejects(k.table('apply',{call_id:'t1-c4',effects:[{...binding,quote:'A fare nobody named'}]}),/missing or already closed/,
        'without priced lines a missing quote still refuses');
});
