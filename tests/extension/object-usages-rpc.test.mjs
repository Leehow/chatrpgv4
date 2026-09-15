import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {table, usage} from './object-usages-fixture.mjs';

test('accepted usage reaches the real sheet and combat executor without changing the ordinary definition',async t=>{
  const game=await table(t), before=await game.world(), prepared=await game.prepare();
  await game.apply([prepared.effect]);
  const world=await game.world(), profile=Object.values(world.objects.usages)[0];
  assert.deepEqual(world.objects.definitions,before.objects.definitions);
  assert.deepEqual(world.objects.instances,before.objects.instances);
  assert.equal(profile.object_id,Object.keys(world.objects.instances)[0]);
  const sheet=JSON.parse(await readFile(game.sheetPath,'utf8'));
  assert.ok(sheet.weapons.some(row=>row.usage==='swing'&&row.damage==='1D6'));
  const look=await game.call('table.look',{focus:'object',name:'Study chair'});
  assert.ok(JSON.stringify(look).includes('swing'));
  await game.apply([{kind:'npc',name:'Steven Knott',archetype:'ordinary_adult'}]);
  await assert.rejects(game.call('table.resolve',{call_id:game.next(),action:{intent:'combat',object:'Study chair',weapon:'unarmed',usage:'swing',target:'Steven Knott',defense:'none'}}),error=>error.code==='invalid_params');
  const result=await game.call('table.resolve',{call_id:game.next(),action:{intent:'combat',object:'Study chair',weapon:profile.id,usage:'swing',target:'Steven Knott',defense:'none',goal:'strike'}});
  assert.ok(result.receipts.length>0);
  assert.equal(result.outcome.object_usage.usage,'swing');
  assert.ok(result.outcome.rolls.length>0,'the attack actually rolled, not only opened a combat');
  const combat=JSON.parse(await readFile(join(game.directory,'save/combat.json'),'utf8'));
  assert.equal(combat.weapon_catalog[profile.id].damage,'1D6');
  assert.equal(combat.weapon_catalog[profile.id].object_id,profile.object_id);
  const audit=await game.call('mods.job',{role:'audit',input:{text:'The chair was used to attack Knott.'}});
  assert.equal(audit.continuity_review,true);
  const focused=JSON.parse(await readFile(join(audit.cwd,'context.json'),'utf8'));
  assert.ok(focused.objects.instances.find(item=>item.name==='Study chair').usages.some(item=>item.name==='swing'&&item.applicable));
  assert.ok(focused.receipts.some(receipt=>receipt.object==='Study chair'&&receipt.usage==='swing'));
});

test('reuse skips generation, stale packets and bad batches leave no partial usage writes',async t=>{
  const game=await table(t), first=await game.prepare();
  const before=await game.world();
  await assert.rejects(game.apply([first.effect,{kind:'object',name:'Missing',to:game.sheet.name}]),/definition|defined/i);
  assert.deepEqual((await game.world()).objects,before.objects);
  await game.apply([first.effect]);
  const again=await game.prepare({...usage(),description:'Strike using the same prepared swing.'}); assert.equal(again.job.accepted,true);
  assert.ok(again.accepted.provenance.reused_usage);
  const late=await game.prepare(usage('throw','thrown'));
  await game.apply([{kind:'object',name:'Study chair',from:game.sheet.name,to:game.sheet.name,condition:'broken',why:'The frame broke in this deterministic fixture.'}]);
  await assert.rejects(game.apply([late.effect]),error=>error.details?.reason==='usage_stale');
  assert.equal(Object.keys((await game.world()).objects.usages).length,1);
  await assert.rejects(game.call('table.resolve',{call_id:game.next(),action:{intent:'combat',object:'Study chair',usage:'swing',target:'Steven Knott',defense:'none'}}),/usage|physical/);
  const tampered=await game.call('mods.job',{role:'usage',input:{object:'Study chair',name:'brace',description:'Use the retained broken frame.'}});
  await writeFile(join(tampered.cwd,'result.json'),JSON.stringify(usage('brace')));
  const request=JSON.parse(await readFile(join(tampered.cwd,'request.json'),'utf8'));
  request.usage_object.definition.description='An invented different object';
  await writeFile(join(tampered.cwd,'request.json'),JSON.stringify(request));
  await assert.rejects(game.call('mods.accept',{job:tampered.job}),error=>error.details?.reason==='usage_request_changed');
  assert.equal(Object.keys((await game.world()).objects.usages).length,1);
  const forged=await game.call('mods.job',{role:'usage',input:{object:'Study chair',name:'direct draft',description:'A draft placed in the wrong artifact file.'}});
  const originalRequest=JSON.parse(await readFile(join(forged.cwd,'request.json'),'utf8'));
  const acceptedPacket=()=>({usage:usage('direct draft'),physical_basis:originalRequest.physical_basis,
    provenance:{mod:forged.mod,digest:forged.digest,job:forged.job}});
  for(const [mutate,message] of [
    [packet=>{packet.usage.parameters.skill='Fighting (Invented skill)';},/skill/],
    [packet=>{packet.usage.name='Another usage';},/identity/],
    [packet=>{packet.physical_basis={...packet.physical_basis,condition:'intact'};},/physical basis/],
    [packet=>{packet.provenance.mod='another-provider';},/provenance/],
  ]) {
    const packet=acceptedPacket(); mutate(packet);
    await writeFile(join(forged.cwd,'accepted.json'),JSON.stringify(packet));
    await assert.rejects(game.call('mods.accept',{job:forged.job}),message);
  }
  assert.equal(Object.keys((await game.world()).objects.usages).length,1);
});
