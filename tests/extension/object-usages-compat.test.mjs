import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {cp, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, relative} from 'node:path';
import {api, root, table, usage} from './object-usages-fixture.mjs';

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const writeJson = (path, value) => writeFile(path, JSON.stringify(value));
const usageRows = world => Object.values(world.objects?.usages ?? {});
const turnNumber = game => readJson(join(game.directory, 'turn.json')).then(row => row.turn);

async function coldCall(t, home, method, params = {}) {
  const context = await api.createKernelContext({
    workspace: home,
    content: join(root, 'content'),
    seed: 'usage-rpc-cold',
    locks: api.createAdvisoryLocks(async () => {}),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'},
  });
  const runtime = api.createKernelRuntime(context);
  t.after(() => runtime.close());
  return runtime.handlers[method]({campaign: 'c1', ...params});
}

async function packageDigest(directory) {
  const paths = [];
  const walk = async current => {
    for (const entry of await readdir(current, {withFileTypes: true})) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) paths.push(path);
    }
  };
  await walk(directory);
  const digest = createHash('sha256');
  for (const path of paths.sort()) {
    digest.update(Buffer.from(relative(directory, path).split('\\').join('/')));
    digest.update(Buffer.from([0]));
    digest.update(createHash('sha256').update(await readFile(path)).digest());
  }
  return digest.digest('hex');
}

async function installedPackage(t, version) {
  const directory = await mkdtemp(join(tmpdir(), `object-usages-v${version}-`));
  t.after(() => rm(directory, {recursive: true, force: true}));
  await cp(join(root, 'mods/enhanced-items'), directory, {recursive: true});
  const manifestPath = join(directory, 'mod.json');
  const manifest = await readJson(manifestPath);
  manifest.id = 'usage-fixture';
  manifest.version = version;
  manifest.requires = [...new Set([...manifest.requires, 'objects.usages.v1', api.CONTINUITY_AUDIT])];
  manifest.contributes = {materializer: 'creator.md', auditor: 'auditor.md'};
  await writeJson(manifestPath, manifest);
  return {directory, digest: await packageDigest(directory)};
}

test('legacy worlds without objects.usages still read, then persist an accepted usage across narrate and a cold kernel context', async t => {
  const game = await table(t);
  const worldPath = join(game.directory, 'world.json');
  const legacy = await readJson(worldPath);
  delete legacy.objects.usages;
  await writeJson(worldPath, legacy);

  const legacyLook = await game.call('table.look', {focus: 'object', name: 'Study chair'});
  assert.equal(JSON.stringify(legacyLook).includes('swing'), false);

  const prepared = await game.prepare();
  await game.apply([prepared.effect]);
  await game.call('table.narrate', {call_id: game.next(), text: 'The chair swing is recorded.'});
  const warm = await game.world();
  assert.equal(usageRows(warm).length, 1);
  assert.equal(usageRows(warm)[0].name, 'swing');

  const coldLook = await coldCall(t, game.home, 'table.look', {focus: 'object', name: 'Study chair'});
  assert.ok(JSON.stringify(coldLook).includes('swing'));
});

test('disabled usage mods do not remove accepted usages, but refuse new usage preparation without parameters', async t => {
  const game = await table(t);
  await game.apply([(await game.prepare()).effect]);
  await game.call('mods.configure', {id: 'usage-fixture', version: '1.0.0', enabled: false});
  await game.call('mods.configure', {id: 'enhanced-items', enabled: false});
  await game.call('table.narrate', {call_id: game.next(), text: 'The item materializers are disabled.'});
  await game.call('table.player_input', {text: 'Use the chair without inventing a new profile.'});
  let turn = await turnNumber(game);
  const disabled = await game.world();
  assert.equal(disabled.mods.active['usage-fixture'].enabled, false);
  assert.equal(disabled.mods.active['enhanced-items'].enabled, false);

  const look = await game.call('table.look', {focus: 'object', name: 'Study chair'});
  assert.ok(JSON.stringify(look).includes('swing'));
  await game.call('table.apply', {call_id: `t${turn}-c1`, effects: [{kind: 'npc', name: 'Steven Knott', archetype: 'ordinary_adult'}]});
  const attack = await game.call('table.resolve', {call_id: `t${turn}-c2`, action: {intent: 'combat', object: 'Study chair', usage: 'swing', target: 'Steven Knott', defense: 'none', goal: 'strike'}});
  assert.equal(attack.outcome.object_usage.usage, 'swing');
  assert.ok(attack.outcome.rolls.length > 0);

  const missing = await game.call('mods.job', {role: 'usage', input: {object: 'Study chair', name: 'new disabled use', description: 'Try to invent another use after disabling the provider.'}});
  assert.equal(missing.enabled, false);
  assert.equal('parameters' in missing, false);
  assert.equal('cwd' in missing, false);
});

test('explicit mod version upgrades leave existing usage, definition and instance records unchanged', async t => {
  const game = await table(t);
  await game.apply([(await game.prepare()).effect]);
  const before = await game.world();
  const packageV2 = await installedPackage(t, '2.0.0');

  await game.call('mods.install', {path: packageV2.directory});
  await game.call('mods.configure', {id: 'usage-fixture', version: '2.0.0', enabled: true});
  await game.call('table.narrate', {call_id: game.next(), text: 'The usage provider upgrade is accepted.'});
  await game.call('table.player_input', {text: 'Use the existing chair swing after the upgrade.'});
  const after = await game.world();
  const active = after.mods.active['usage-fixture'];
  assert.equal(active.version, '2.0.0');
  assert.equal(active.digest, packageV2.digest);
  assert.notEqual(active.digest, before.mods.active['usage-fixture'].digest);
  assert.equal(active.enabled, true);
  assert.deepEqual(after.objects.definitions, before.objects.definitions);
  assert.deepEqual(after.objects.instances, before.objects.instances);
  assert.deepEqual(after.objects.usages, before.objects.usages);
  const look = await game.call('table.look', {focus: 'object', name: 'Study chair'});
  assert.ok(JSON.stringify(look).includes('swing'));
  const turn = await turnNumber(game);
  await game.call('table.apply', {call_id: `t${turn}-c1`, effects: [{kind: 'npc', name: 'Steven Knott', archetype: 'ordinary_adult'}]});
  const attack = await game.call('table.resolve', {call_id: `t${turn}-c2`, action: {intent: 'combat', object: 'Study chair', usage: 'swing', target: 'Steven Knott', defense: 'none', goal: 'strike'}});
  assert.equal(attack.outcome.object_usage.usage, 'swing');
  assert.ok(attack.outcome.rolls.length > 0);
});

test('worldline fork, switch and merge preserve object usages and report divergent usage state as a stable mod_state conflict', async t => {
  const game = await table(t);
  await game.apply([(await game.prepare()).effect]);
  await game.call('table.narrate', {call_id: game.next(), text: 'Main line keeps the swing.'});

  await game.call('table.player_input', {text: 'Open a side line.'});
  let turn = await turnNumber(game);
  await game.call('table.apply', {call_id: `t${turn}-c1`, effects: [{kind: 'fork', name: 'side', mode: 'if'}]});
  await game.call('table.narrate', {call_id: `t${turn}-c2`, text: 'The side line opens.'});

  await game.call('table.player_input', {text: 'Try throwing the chair here.'});
  turn = await turnNumber(game);
  await game.call('table.apply', {call_id: `t${turn}-c1`, effects: [(await game.prepare(usage('throw', 'thrown'))).effect]});
  const sideWorld = await game.world();
  assert.ok(usageRows(sideWorld).some(row => row.name === 'throw'));
  await game.call('table.narrate', {call_id: `t${turn}-c2`, text: 'The side line keeps the throw.'});

  await game.call('table.player_input', {text: 'Return to the main line.'});
  turn = await turnNumber(game);
  await game.call('table.apply', {call_id: `t${turn}-c1`, effects: [{kind: 'switch', line: 'main'}]});
  await game.call('table.narrate', {call_id: `t${turn}-c2`, text: 'Back on main.'});
  assert.deepEqual(usageRows(await game.world()).map(row => row.name), ['swing']);

  await game.call('table.player_input', {text: 'Merge the usage lines.'});
  turn = await turnNumber(game);
  const beforeMerge = await game.world();
  let first;
  try { await game.call('table.apply', {call_id: `t${turn}-c1`, effects: [{kind: 'merge', name: 'joined', lines: ['main', 'side']}]}); }
  catch (error) { first = error; }
  assert.equal(first?.code, 'needs');
  assert.ok(first.details?.conflicts?.some(conflict => conflict.class === 'mod_state' && conflict.field === 'snapshot' && conflict.values?.side?.objects?.usages));
  assert.deepEqual(await game.world(), beforeMerge);
  let second;
  try { await game.call('table.apply', {call_id: `t${turn}-c2`, effects: [{kind: 'merge', name: 'joined', lines: ['main', 'side']}]}); }
  catch (error) { second = error; }
  assert.equal(second?.code, 'needs');
  assert.deepEqual(second.details.conflicts, first.details.conflicts);

  const conflict = first.details.conflicts.find(row => row.class === 'mod_state' && row.field === 'snapshot');
  await game.call('table.apply', {call_id: `t${turn}-c3`, effects: [{kind: 'merge', name: 'joined', lines: ['main', 'side'], dispositions: {[conflict.id]: {mode: 'from', line: 'side'}}}]});
  await game.call('table.narrate', {call_id: `t${turn}-c4`, text: 'The chosen side line is joined.'});
  const joined = await game.world();
  assert.deepEqual(joined.objects, conflict.values.side.objects);
  assert.ok(usageRows(joined).some(row => row.name === 'throw'));
  const sheet = await readJson(game.sheetPath);
  assert.ok(sheet.weapons.some(row => row.usage === 'throw'));
});
