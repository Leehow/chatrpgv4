/** Actionable feedback for a refused multi-effect travel batch. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {kernel,campaignDir,readJson,openTurn} from './support.ts';
import {KernelError} from '../../extensions/kernel/client.ts';

test('travel recovery names the exact time effect in model-facing feedback and preserves atomic settlement',async t=>{
  for(const timeIndex of [0,1]){
    const k=await kernel(t);await openTurn(k);
    const effects=[{kind:'time',minutes:5,why:'Return borrowed tools before walking'},
      {kind:'move',to:'newspaper-morgue',travel_minutes:30}];
    if(timeIndex===1)effects.reverse();
    const error=await k.tableErr('apply',{call_id:'t1-c1',effects});
    assert.equal(error.details.index,timeIndex);
    assert.equal(error.details.reason,'travel_time_duplicated');
    const text=new KernelError(error).toToolText();
    assert.ok(text.includes(`effects[${timeIndex}]`),text);
    assert.ok(text.includes('beyond_travel: true'),text);
    assert.equal(readJson(join(campaignDir(k.workspace),'world.json')).clock.minutes,0);
    assert.deepEqual((await k.table('status')).receipts,[]);
    Object.assign(effects[timeIndex],{beyond_travel:true});
    await k.table('apply',{call_id:'t1-c1',effects});
    assert.equal(readJson(join(campaignDir(k.workspace),'world.json')).clock.minutes,35);
  }
});
