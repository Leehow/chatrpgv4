/** Quantity-preserving work and a later acquisition remain distinct at the real RPC boundary. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir,readJson,PREGEN} from './support.ts';

test('work on an owned legacy item preserves quantity while a second acquisition still adds a unit',async t=>{
    const client=await kernel(t);await openTurn(client,'I collect a valve and have it installed.');
    const name='cooling valve';
    const quantity=()=>readJson(join(campaignDir(client.workspace),'party',`${PREGEN}.json`)).equipment.find((entry:any)=>entry.name===name)?.quantity;
    await client.table('apply',{call_id:'t1-c1',effects:[{kind:'item',name,from:'the mechanic'}]});
    assert.equal(quantity(),1);
    await client.table('apply',{call_id:'t1-c2',effects:[],event:{name:'installed-owned-valve',summary:'The valve already owned by the investigator is installed; ownership and quantity remain unchanged.'}});
    assert.equal(quantity(),1);
    await client.table('apply',{call_id:'t1-c3',effects:[{kind:'item',name,from:'the mechanic'}]});
    assert.equal(quantity(),2,'a legitimate second acquisition is not deduplicated by name or source');
});
