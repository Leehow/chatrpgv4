import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {after, test} from 'node:test';
import {build} from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = await mkdtemp(join(tmpdir(), 'object-usages-'));
after(() => rm(temporary, {recursive:true, force:true}));
await build({stdin:{contents:"export * from './kernel-ts/mods/usages.ts';",resolveDir:root,sourcefile:'usage-api.ts'},
  outfile:join(temporary,'api.mjs'),bundle:true,format:'esm',platform:'node',target:'node22',logLevel:'silent'});
const api = await import(pathToFileURL(join(temporary,'api.mjs')).href);
const raw = (name = 'swing', mode = 'melee') => ({name, description:'Use the wooden chair as a striking implement.', basis:'Its retained solid wooden frame.', mode,
  parameters:{skill:mode==='thrown'?'Throw':'Fighting (Brawl)',damage:'1D6',base_range_yards:mode==='thrown'?5:null,
    uses_per_round:1,magazine:null,malfunction:null,impale:false,adds_damage_bonus:true},
  player_view:{description:'A solid wooden chair.',fields:['skill','damage']}});
const world = () => ({objects:{definitions:{d1:{id:'d1',name:'Wooden chair',category:'item',digest:'immutable-chair',description:'A solid wooden chair.',parameters:{charges:null,effects:[]}}},
  instances:{o1:{id:'o1',name:'Study chair',definition:'d1',owner:{id:'p1',kind:'investigator',name:'Player'},quantity:1,
    state:{condition:'intact',ammo:null,charges:null}}},abilities:{}}});
const accept = (w, value = raw()) => api.registerUsage(w, 'Study chair', value, api.usagePhysicalBasis(w,'Study chair'), {mod:'enhanced-items',digest:'provider',job:'accepted-job'});

test('ordinary objects gain executable usages without replacing their definition, instance or state', () => {
  const w=world(), before=structuredClone(w.objects), profile=accept(w);
  assert.deepEqual(w.objects.definitions,before.definitions);
  assert.deepEqual(w.objects.instances,before.instances);
  assert.equal(profile.object_id,'o1');
  const weapon=api.selectObjectWeapon(w,'Study chair','swing','p1');
  assert.equal(weapon.damage,'1D6');
  assert.equal(weapon.object_id,'o1');
  assert.equal(weapon.usage,'swing');
  assert.notEqual(weapon.weapon_id,'o1');
});

test('accepted parameters are immutable and reused across transfers and resource changes', () => {
  const w=world(), first=accept(w), before=JSON.stringify(w.objects.usages);
  assert.equal(accept(w).id,first.id);
  assert.equal(JSON.stringify(w.objects.usages),before);
  w.objects.instances.o1.owner={kind:'npc',id:'n1',name:'Keeper actor'};
  w.objects.instances.o1.state.ammo=2;
  assert.equal(api.findAcceptedUsage(w,'Study chair','swing').id,first.id);
  assert.throws(()=>api.selectObjectWeapon(w,'Study chair','swing','p1'),/carry/);
  assert.equal(api.selectObjectWeapon(w,'Study chair','swing','n1').ammo,2);
  const changed=raw(); changed.parameters.damage='2D6';
  assert.throws(()=>accept(w,changed),/already|different|immutable/);
  assert.equal(JSON.stringify(w.objects.usages),before);
});

test('a changed physical state invalidates old parameters but can support a new accepted use without repair', () => {
  const w=world(), first=accept(w);
  w.objects.instances.o1.state.condition='broken';
  assert.equal(api.findAcceptedUsage(w,'Study chair','swing'),null);
  assert.throws(()=>api.selectObjectWeapon(w,'Study chair','swing','p1'),/usage|condition|state|prepared/);
  const next=accept(w);
  assert.notEqual(next.id,first.id);
  assert.equal(api.selectObjectWeapon(w,'Study chair','swing','p1').damage,'1D6');
  assert.equal(w.objects.instances.o1.state.condition,'broken');
  assert.equal(Object.keys(w.objects.usages).length,2);
});

test('multiple usages share one physical identity and require an explicit choice', () => {
  const w=world(); accept(w); accept(w,raw('throw','thrown'));
  assert.throws(()=>api.selectObjectWeapon(w,'Study chair',undefined,'p1'),error=>error.code==='needs_choice');
  assert.equal(api.selectObjectWeapon(w,'Study chair','throw','p1').skill,'Throw');
  assert.deepEqual(api.usageWeaponRows(w,'p1').map(row=>row.object_id),['o1','o1']);
});

test('usage validation rejects incomplete or state-resetting profiles without mutating input', () => {
  for(const mutate of [value=>{value.parameters={damage:'1D6'};},value=>{value.parameters.initial_ammo=6;},
    value=>{value.parameters.damage='9999D6';},value=>{value.mode='anything';}]) {
    const value=raw(); mutate(value); const before=structuredClone(value);
    assert.throws(()=>api.validateUsage(value)); assert.deepEqual(value,before);
  }
});

test('legacy executable profiles remain defaults without generating or rewriting old saves', () => {
  const w=world(); w.objects.definitions.d1.category='weapon'; w.objects.definitions.d1.parameters=raw().parameters;
  const before=structuredClone(w), weapon=api.selectObjectWeapon(w,'Study chair',undefined,'p1');
  assert.equal(weapon.weapon_id,'o1'); assert.equal(weapon.damage,'1D6'); assert.deepEqual(w,before);
  w.objects.instances.o1.state.condition='jammed';
  assert.throws(()=>api.selectObjectWeapon(w,'Study chair',undefined,'p1'),/condition|usage|state|prepared/);
});
