/** Contract regressions from the b79 CLI third turn; no Keeper or provider is simulated here. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {renamePlaces, renameUntold} from '../../extensions/kernel/untold-view.ts';
import {readCarriedViews} from '../../runtime/jev/carried-views.ts';

test('recorded player and Keeper quotations keep exact wording when the current roster changes', () => {
  const player='我还要赶去达拉斯，从这儿回大路该往哪边走？';
  const history={role:'custom',customType:'coc-history',content:JSON.stringify({kind:'historical_quotations',
    quotes:[{turn:1,role:'player',text:player,verified:true},{turn:1,role:'keeper',text:'往东就能奔达拉斯那边。',verified:true}]})};
  const roster=[{name:'拉斯',id:'station-owner',shown:'the station owner / name-bearing-handle'}];
  assert.deepEqual(renamePlaces([history],roster),[], 'a host recording does not become new host prose');
  const result=renameUntold([history,{role:'custom',customType:'coc-clerk',content:'拉斯 waits by the pump.'}],roster);
  assert.equal(result[0],history);
  assert.equal(JSON.parse(result[0].content).quotes[0].text,player);
  assert.equal(result[1].content,'the station owner / name-bearing-handle waits by the pump.', 'new host material is still hidden');
});

test('an automatic card read retries a whole-name miss by the unique current presence identity', async () => {
  const calls=[];
  const call=async(method,params)=>{
    calls.push([method,params]);
    if(params.name==='Russell Williams') throw Object.assign(new Error('ambiguous authored name'),{code:'unknown_entity'});
    if(!params.name)return {present:[{name:'Russell Williams',untold:{id:'old-station-owner'}}]};
    assert.equal(params.name,'old-station-owner');
    return {kind:'person',id:'old-station-owner',name:'Russell Williams',role:'station owner'};
  };
  const carried=await readCarriedViews({call,people:['Russell Williams']});
  assert.deepEqual(carried.omitted,[]);
  assert.equal(carried.views[0].id,'old-station-owner');
  assert.deepEqual(carried.views[0].read,{method:'table.look',params:{focus:'npc',name:'old-station-owner'}});
  assert.deepEqual(carried.resolved,[{name:'Russell Williams',id:'old-station-owner'}]);
  assert.equal(calls.length,3);
});

test('namesakes, absent identities and failed presence reads never guess a person; one presence read serves the batch', async () => {
  for(const present of [
    [{name:'Shared Name',untold:{id:'one'}},{name:'Shared Name',untold:{id:'two'}}],
    [{name:'Shared Name'}],[],null,
  ]){
    const calls=[];
    const call=async(method,params)=>{
      calls.push(params);
      if(params.name)throw Object.assign(new Error('not found'),{code:'unknown_entity'});
      if(present===null)throw new Error('presence unavailable');
      return {present};
    };
    const result=await readCarriedViews({call,people:['Shared Name','Another Name']});
    assert.deepEqual(result.views,[]);
    assert.deepEqual(result.omitted.map(row=>row.reason),['not_found','not_found']);
    assert.equal(calls.filter(params=>!params.name).length,1);
  }
});

test('successful reads and non-identity failures retain the existing read path', async () => {
  for(const fail of [false,true]){
    const calls=[];
    const call=async(method,params)=>{calls.push(params);if(fail)throw new Error('storage unavailable');return {id:'one',name:'Known Person'};};
    const result=await readCarriedViews({call,people:['Known Person']});
    assert.equal(calls.length,1);
    assert.equal(fail?result.omitted[0].reason:result.views[0].id,fail?'read_failed':'one');
  }
});
