import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {table, usage} from './object-usages-fixture.mjs';

async function definition(game) {
  const input={name:'Stool frame',description:'An ordinary wooden stool in the current scene.'};
  const job=await game.call('mods.job',{role:'create',input});
  await writeFile(join(job.cwd,'result.json'),JSON.stringify({...input,category:'item',basis:'The retained scene fixture.',
    parameters:{charges:null,effects:[]},player_view:{description:input.description,fields:[]}}));
  const accepted=await game.call('mods.accept',{job:job.job});
  return {kind:'define',...input,_definition:accepted.definition,_provenance:accepted.provenance};
}
const input={object:'Loose stool',name:'stool swing',description:'Pick up the loose stool and swing it at the opponent.'};

test('new scene definition, placement, pickup and usage prepare without writes and commit in one replay-safe batch',async t=>{
  const game=await table(t), define=await definition(game), before=await game.world();
  const beforeSheet=await readFile(game.sheetPath,'utf8');
  const preview=[define,{kind:'object',name:input.object,definition:define.name,to:'here'},
    {kind:'object',name:input.object,from:'here',to:game.sheet.name}];
  const job=await game.call('mods.job',{role:'usage',input,preview});
  assert.equal(job.enabled,true);
  const request=JSON.parse(await readFile(join(job.cwd,'request.json'),'utf8'));
  assert.equal(request.usage_object.name,input.object);
  assert.equal(request.usage_object.definition.category,'item');
  assert.equal(request.preview.length,3);
  assert.deepEqual(await game.world(),before,'preview must never publish its staged world');
  assert.equal(await readFile(game.sheetPath,'utf8'),beforeSheet);
  await writeFile(join(job.cwd,'result.json'),JSON.stringify(usage(input.name)));
  const accepted=await game.call('mods.accept',{job:job.job});
  assert.deepEqual(await game.world(),before,'accepting the draft is not a pickup');
  const call_id=game.next(), effects=[...preview,{kind:'usage',...input,_usage:accepted}];
  const result=await game.call('table.apply',{call_id,effects});
  const committed=await game.world(), item=Object.values(committed.objects.instances).find(item=>item.name===input.object);
  assert.equal(item.owner.id,game.sheet.id);
  assert.equal(Object.keys(committed.objects.instances).length,Object.keys(before.objects.instances).length+1);
  assert.equal(Object.values(committed.objects.usages)[0].object_id,item.id);
  const replay=await game.call('table.apply',{call_id,effects});
  assert.deepEqual(replay.receipts,result.receipts);
  assert.deepEqual(await game.world(),committed);
  await game.apply([{kind:'npc',name:'Steven Knott',archetype:'ordinary_adult'}]);
  const attack=await game.call('table.resolve',{call_id:game.next(),action:{intent:'combat',object:input.object,usage:input.name,target:'Steven Knott',defense:'none'}});
  assert.ok(attack.outcome.rolls.length>0);
  assert.equal(attack.outcome.object_usage.instance,item.id);
});

test('bad preparation batches and a failed final batch create no partial scene object',async t=>{
  const game=await table(t), define=await definition(game), before=await game.world();
  await assert.rejects(game.call('mods.job',{role:'usage',input,preview:[{kind:'time',minutes:1}]}),/only preceding define and object/);
  const preview=[define,{kind:'object',name:input.object,definition:define.name,to:game.sheet.name}];
  const job=await game.call('mods.job',{role:'usage',input,preview});
  await writeFile(join(job.cwd,'result.json'),JSON.stringify(usage(input.name)));
  const accepted=await game.call('mods.accept',{job:job.job});
  await assert.rejects(game.apply([...preview,{kind:'usage',...input,_usage:accepted},{kind:'object',name:'Absent instance',to:game.sheet.name}]),/definition/);
  assert.deepEqual(await game.world(),before);
  await assert.rejects(game.apply([...preview,{kind:'usage',...input,_usage:accepted},{kind:'time',minutes:1}]),/only define, object and usage/);
  assert.deepEqual(await game.world(),before);
});

test('same-batch adoption and usage enrich one owned asset without awarding a duplicate',async t=>{
  const game=await table(t);
  await game.apply([{kind:'item',name:input.object,to:game.sheet.name}]);
  const define=await definition(game), beforeText=await readFile(game.sheetPath,'utf8'), before=JSON.parse(beforeText);
  const preview=[define,{kind:'object',name:input.object,definition:define.name,adopt:input.object,to:game.sheet.name}];
  const job=await game.call('mods.job',{role:'usage',input,preview});
  assert.equal(await readFile(game.sheetPath,'utf8'),beforeText);
  await writeFile(join(job.cwd,'result.json'),JSON.stringify(usage(input.name)));
  const accepted=await game.call('mods.accept',{job:job.job});
  await game.apply([...preview,{kind:'usage',...input,_usage:accepted}]);
  const after=JSON.parse(await readFile(game.sheetPath,'utf8'));
  assert.equal(after.equipment.length,before.equipment.length);
  assert.equal(after.equipment.filter(item=>item.name===input.object).length,1);
  assert.ok(after.equipment.find(item=>item.name===input.object).object_id);
  assert.equal(Object.values((await game.world()).objects.instances).filter(item=>item.name===input.object).length,1);
});

test('a staged pickup reuses accepted parameters, while a changed source owner makes its retained preview stale',async t=>{
  const game=await table(t), first=await game.prepare(); await game.apply([first.effect]);
  await game.apply([{kind:'object',name:'Study chair',from:game.sheet.name,to:'here'}]);
  const input={object:'Study chair',name:'swing',description:'Pick up the chair and use the existing swing.'};
  const preview=[{kind:'object',name:'Study chair',from:'here',to:game.sheet.name}];
  const job=await game.call('mods.job',{role:'usage',input,preview});
  assert.equal(job.accepted,true,'the ownership preview must not regenerate a still-applicable usage');
  const accepted=await game.call('mods.accept',{job:job.job});
  assert.ok(accepted.provenance.reused_usage);
  await game.apply([{kind:'object',name:'Study chair',from:'here',to:'Steven Knott'}]);
  const changed=await game.world();
  await assert.rejects(game.call('mods.accept',{job:job.job}),error=>error.details?.reason==='usage_stale');
  assert.deepEqual(await game.world(),changed);
  assert.equal(Object.keys(changed.objects.usages).length,1);
});
