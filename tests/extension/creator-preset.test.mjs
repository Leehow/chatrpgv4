/**
 * Contract §138.7 (BR-03 of docs/specs/band-then-roll.md): the item creator copies a host-chosen weapon preset.
 *
 * Through the real entries: the kernel's `mods.job` / `mods.accept` handlers (the TS kernel over its testing seam,
 * with the shipped enhanced-items package), the definition checker the host runs before acceptance, and the real
 * Mods extension driving both with a fake creator child and a controlled typed endpoint behind the real decision
 * adapter (`fetch` answers the pinned Jev model). Asserted: what the packet carries, which drafts the gate refuses and
 * why, what the accepted provenance records, and the rows the host writes. The creator child is a fixture; nothing
 * here is play evidence.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import modsExtension from '../../extensions/mods/index.ts';
import {waitForValue} from './wait.mjs';

const root = resolve(import.meta.dirname, '../..'), temporary = await mkdtemp(join(tmpdir(), 'creator-preset-'));
after(() => rm(temporary, {recursive: true, force: true}));
await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
await build({stdin: {contents: "export * from './kernel-ts/testing/api.ts'; export {checkModDefinition, checkObjectUsage} from './kernel-ts/check.ts';",
  resolveDir: root, sourcefile: 'creator-preset-api.ts'}, outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', format: 'esm',
  platform: 'node', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

const OLD_VERSION = join(root, 'tests/fixtures/mods/enhanced-items-v122');
// Mod bytes are frozen per version (§26): 1.2.2 as shipped before this ticket (the retained copy under a live
// `.coc/mods/packages` hashes the same), and the current package: 1.3.0 as this ticket shipped it
// (681d03dd...), 1.3.1 since non-weapon gear waits until the fiction uses it (1404ca86...), 1.3.2 since its instruction is
// sectioned and its brief retired (§183), 1.3.4 since "Documents on carriers" is resident and carries the physical
// document operations (§179.3a).
const DIGEST_122 = '7714ce10e86032ebf427e45c63e61d38a4dabb8f75dabb2d6182f7d3638f54af';
const DIGEST_130 = '6f91fcd25e1f95bb12734330e702a19c7ad1ceac243f1f49c2955d14ef79ea7d';
const DECLARATION = 'I snatch the carving knife off the cellar shelf and go for Knott.';
const KNIFE = {name: 'Cellar knife', category: 'weapon', description: 'A long carving knife with a chipped blade, left on the cellar shelf.'};
// The rulebook's medium knife as the definition's parameters, the way the engine reads its row.
const KNIFE_MEDIUM = {skill: 'Fighting (Brawl)', damage: '1D4+2', adds_damage_bonus: true, base_range_yards: null, uses_per_round: 1,
  magazine: null, malfunction: null, impale: true};

/** A kernel answer with its Python-typed floats read as plain numbers, for deep comparison. */
const plain = value => value instanceof api.PythonFloat ? value.valueOf() : Array.isArray(value) ? value.map(plain)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)])) : value;
const definition = (input, parameters, extra = {}) => ({name: input.name, category: input.category, description: input.description,
  basis: 'Copied from request.preset for this contract fixture.', parameters, traits: [],
  player_view: {description: input.description, fields: ['damage']}, ...extra});

/** The TS kernel over its testing seam, on the-haunting, with the shipped packages and one player turn open. */
async function kernel(t, {version} = {}) {
  const home = await mkdtemp(join(temporary, 'home-'));
  const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'creator-preset',
    locks: api.createAdvisoryLocks(async () => {}), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context);
  t.after(() => runtime.close());
  // Parameters travel as JSON, as they do over RPC (an absent optional key is absent, not `undefined`).
  const call = (method, params = {}) => runtime.handlers[method](JSON.parse(JSON.stringify({campaign: 'c1', ...params})));
  await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  if (version) {
    await call('mods.install', {path: OLD_VERSION});
    await call('mods.configure', {id: 'enhanced-items', version, enabled: true});
  }
  await call('table.open');
  const jobs = join(home, '.coc/mods/jobs');
  const read = async (job, file) => JSON.parse(await readFile(join(jobs, job, file), 'utf8'));
  const lock = async () => {
    const directory = join(home, '.coc/campaigns/c1');
    return JSON.parse(await readFile(join(directory, 'campaign.json'), 'utf8')).mods_pending?.['enhanced-items']
      ?? JSON.parse(await readFile(join(directory, 'world.json'), 'utf8')).mods.active['enhanced-items'];
  };
  return {home, call, jobs, read, lock, listJobs: async () => existsSync(jobs) ? (await readdir(jobs)).sort() : []};
}

/** One player turn open, with the words that asked for the thing. */
async function playerTurn(k) {
  await k.call('table.narrate', {call_id: 't0-c1', text: 'The cellar is cold. Knott waits at the top of the stairs.'});
  await k.call('table.player_input', {text: DECLARATION});
}

/** A definition job for `input` with the preset named, and its draft written by the fixture creator. */
async function drafted(k, input, preset, draft) {
  const job = await k.call('mods.job', {role: 'create', input, ...(preset ? {preset} : {})});
  await writeFile(join(job.cwd, 'result.json'), JSON.stringify(draft));
  return job;
}
const refusal = async promise => { try { await promise; } catch (error) { return error; } assert.fail('expected a refusal'); };

test('a weapon definition job is offered the weapons band and mints nothing until the host answers', async t => {
  const k = await kernel(t);
  await playerTurn(k);
  const before = await k.listJobs();
  const answer = await k.call('mods.job', {role: 'create', input: KNIFE, offer_preset: true});
  assert.equal(answer.enabled, true);
  assert.equal(answer.job, undefined, 'an offer is not a job');
  assert.deepEqual(await k.listJobs(), before, 'nothing is written for an offer');
  const offer = answer.preset_offer;
  assert.equal(offer.field, 'weapon');
  assert.equal(offer.table, 'weapons');
  assert.equal(offer.for, 'define');
  assert.equal(offer.declaration, DECLARATION);
  assert.deepEqual(offer.thing, {name: KNIFE.name, description: KNIFE.description});
  assert.ok(offer.options.includes('knife_medium') && offer.options.includes('revolver_38'));
  assert.ok(!offer.options.includes('chainsaw'), 'the options are the era\'s rows (the-haunting is 1920s)');
  assert.deepEqual(offer.profiles.find(profile => profile.id === 'knife_medium'),
    {id: 'knife_medium', name: 'Knife, medium (carving knife, ritual dagger)', skill: 'Fighting (Brawl)', damage: '1D4+2', range: null});

  // Without a preset the job is the one it always was: no preset in the packet, the catalog as evidence.
  const bare = await k.call('mods.job', {role: 'create', input: KNIFE});
  const bareRequest = await k.read(bare.job, 'request.json');
  assert.equal(bareRequest.preset, undefined);
  assert.deepEqual(Object.keys(bareRequest.catalogs), ['weapons']);
  assert.equal(bare.preset, undefined);

  // With one, the packet carries the row projected onto the definition's parameters, and the preset is identity.
  const chosen = await k.call('mods.job', {role: 'create', input: KNIFE, preset: {weapon: 'knife_medium', confidence: 0.82}});
  assert.notEqual(chosen.job, bare.job, 'a preset is part of the job identity');
  assert.deepEqual(plain(chosen.preset), {weapon: 'knife_medium', confidence: 0.82});
  const request = plain(await k.read(chosen.job, 'request.json'));
  assert.equal(request.preset.table, 'weapons');
  assert.equal(request.preset.id, 'knife_medium');
  assert.equal(request.preset.confidence, 0.82);
  assert.deepEqual(request.preset.parameters, KNIFE_MEDIUM);
  assert.equal(request.preset.profile.damage_die, '1D4+2');
  assert.deepEqual(Object.keys(request.catalogs), ['weapons'], 'the catalog still travels as today');
  assert.equal((await k.read(chosen.job, 'identity.json')).request, undefined);
  assert.equal((await k.call('mods.job', {role: 'create', input: KNIFE, preset: {weapon: 'knife_medium', confidence: 0.82}})).job, chosen.job,
    'the same preset is the same retained job');
  assert.notEqual((await k.call('mods.job', {role: 'create', input: KNIFE, preset: {weapon: 'knife_large', confidence: 0.7}})).job, chosen.job,
    'a different preset is never the retained job');
  assert.notEqual((await k.call('mods.job', {role: 'create', input: KNIFE, preset: {weapon: 'knife_medium', confidence: 0.6}})).job, chosen.job,
    'the whole block is identity, the answer\'s confidence included');

  // A row the definition cannot hold is left for the creator: the Molotov is thrown once every two rounds.
  const bottle = await k.call('mods.job', {role: 'create', input: {...KNIFE, name: 'Kerosene bottle'}, preset: {weapon: 'molotov_cocktail', confidence: 0.9}});
  const stated = plain(await k.read(bottle.job, 'request.json')).preset.parameters;
  assert.equal(stated.damage, '2D6');
  assert.equal(Object.hasOwn(stated, 'uses_per_round'), false);

  const unknown = await refusal(k.call('mods.job', {role: 'create', input: KNIFE, preset: {weapon: 'chainsaw', confidence: 0.9}}));
  assert.equal(unknown.code, 'invalid_params');
  assert.equal(unknown.details.reason, 'preset_unknown');
});

test('a queued registration keeps the preset its job was minted with, in a later turn and without asking again', async t => {
  const k = await kernel(t);
  await playerTurn(k);
  const minted = await k.call('mods.job', {role: 'create', input: KNIFE, preset: {weapon: 'knife_medium', confidence: 0.82}});
  // The deferral lands a marker naming this job (§129.4); the generation beside the turn is not finished.
  await k.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'define', ...KNIFE, _queued: minted.job, _provenance: {mod: minted.mod, digest: minted.digest}}]});
  await k.call('table.narrate', {call_id: 't1-c2', text: 'You pocket the knife.'});
  await k.call('table.player_input', {text: 'I wait for Knott to come down.'});
  const unfinished = (await k.call('mods.queued', {})).unfinished;
  assert.deepEqual(unfinished.map(entry => entry.job), [minted.job]);
  // The next resume asks for the same registration as the Keeper wrote it: no offer, and the marker's own job.
  const resumed = await k.call('mods.job', {role: 'create', input: KNIFE, offer_preset: true});
  assert.equal(resumed.preset_offer, undefined);
  assert.equal(resumed.job, minted.job);
  assert.deepEqual(plain(resumed.preset), {weapon: 'knife_medium', confidence: 0.82});
  assert.equal((await k.call('mods.job', {role: 'create', input: KNIFE})).job, minted.job);
});

test('only a weapon definition or an action usage that will run a creator is offered a preset', async t => {
  const k = await kernel(t);
  await playerTurn(k);
  const item = await k.call('mods.job', {role: 'create', input: {name: 'Lamp oil', category: 'item', description: 'A tin of lamp oil.'}, offer_preset: true});
  assert.equal(item.preset_offer, undefined);
  assert.equal(typeof item.job, 'string', 'an item is minted at once, as before');
  assert.equal((await k.read(item.job, 'request.json')).preset, undefined);
  const named = await k.call('mods.job', {role: 'create', input: {...KNIFE, name: 'Service revolver', template: 'revolver_38'}, offer_preset: true});
  assert.equal(named.preset_offer, undefined, 'a template naming a weapons row is the Keeper\'s own evidence');
  assert.equal(typeof named.job, 'string');
  const spell = await k.call('mods.job', {role: 'create', input: {name: 'Whisper of the Cellar', category: 'spell', description: 'A murmured phrase that dims a lamp.'}, offer_preset: true});
  assert.equal(spell.preset_offer, undefined);
});

test('the gate refuses an unstated departure and an unfounded statement, and accepts a copied or stated one', async t => {
  const k = await kernel(t);
  await playerTurn(k);
  const preset = {weapon: 'knife_medium', confidence: 0.82};
  const input = name => ({...KNIFE, name});

  const copied = await drafted(k, input('Copied knife'), preset, definition(input('Copied knife'), KNIFE_MEDIUM));
  const accepted = plain(await k.call('mods.accept', {job: copied.job}));
  assert.deepEqual(accepted.provenance.preset, {table: 'weapons', id: 'knife_medium', confidence: 0.82});
  assert.deepEqual(accepted.provenance.deviations, []);
  assert.deepEqual(accepted.definition.parameters, KNIFE_MEDIUM);

  const tuned = {...KNIFE_MEDIUM, damage: '1D6', impale: false};
  const silent = await drafted(k, input('Tuned knife'), preset, definition(input('Tuned knife'), tuned));
  const refused = await refusal(k.call('mods.accept', {job: silent.job}));
  assert.equal(refused.code, 'invalid_params');
  assert.equal(refused.details.reason, 'preset_deviation');
  assert.deepEqual(refused.details.findings.map(item => [item.code, item.field]), [['preset_deviation', 'damage'], ['preset_deviation', 'impale']]);
  assert.match(refused.message, /damage, impale/);
  assert.match(refused.fix, /deviations/);
  assert.equal(existsSync(join(silent.cwd, 'accepted.json')), false, 'a refused draft is never accepted');
  // The checker the host runs before acceptance says the same thing to the child's repair round.
  const checked = await api.checkModDefinition(join(silent.cwd, 'result.json'));
  assert.equal(checked.ok, false);
  assert.match(checked.error, /depart from the preset knife_medium without a stated contradiction: damage, impale/);

  const deviations = [{field: 'damage', reason: 'The blade is chipped and short: the description says so.'},
    {field: 'impale', reason: 'The chipped point cannot drive in: the description says the blade is chipped.'}];
  const stated = await drafted(k, input('Chipped knife'), preset, definition(input('Chipped knife'), tuned, {deviations}));
  assert.deepEqual(await api.checkModDefinition(join(stated.cwd, 'result.json')), {ok: true, name: 'Chipped knife'});
  const kept = plain(await k.call('mods.accept', {job: stated.job}));
  assert.deepEqual(kept.provenance.deviations, deviations);
  assert.equal(Object.hasOwn(kept.definition, 'deviations'), false, 'deviations are provenance, not a definition field');
  assert.equal(kept.definition.parameters.damage, '1D6');

  const unfounded = await drafted(k, input('Honest knife'), preset, definition(input('Honest knife'), KNIFE_MEDIUM,
    {deviations: [{field: 'skill', reason: 'The handle is long.'}]}));
  const overstated = await refusal(k.call('mods.accept', {job: unfounded.job}));
  assert.equal(overstated.details.reason, 'preset_deviation_unfounded');
  assert.deepEqual(overstated.details.findings.map(item => item.field), ['skill']);

  // The child can write its own directory; a preset edited in the retained packet is a changed request, not a new rule.
  const forged = await drafted(k, input('Forged knife'), preset, definition(input('Forged knife'), tuned));
  const packet = JSON.parse(await readFile(join(forged.cwd, 'request.json'), 'utf8'));
  packet.preset.parameters = {...packet.preset.parameters, damage: '1D6', impale: false};
  await writeFile(join(forged.cwd, 'request.json'), JSON.stringify(packet));
  const changed = await refusal(k.call('mods.accept', {job: forged.job}));
  assert.equal(changed.code, 'needs');
  assert.match(changed.message, /retained Mod preparation request changed/);

  const malformed = await drafted(k, input('Vague knife'), preset, definition(input('Vague knife'), KNIFE_MEDIUM, {deviations: [{field: 'damage'}]}));
  assert.equal((await refusal(k.call('mods.accept', {job: malformed.job}))).details.reason, 'preset_deviation_shape');

  // Without a preset nothing is gated, exactly as before: any numbers stand, and `deviations` is an unknown field.
  const free = await drafted(k, input('Free knife'), null, definition(input('Free knife'), tuned));
  assert.equal(plain(await k.call('mods.accept', {job: free.job})).provenance.preset, undefined);
  const stray = await drafted(k, input('Stray knife'), null, definition(input('Stray knife'), tuned, {deviations}));
  assert.match((await refusal(k.call('mods.accept', {job: stray.job}))).message, /Unknown definition field/);
});

test('an action usage is offered the object as the thing and gated on its parameters', async t => {
  const k = await kernel(t);
  const chair = {name: 'Chair frame', category: 'item', description: 'A solid oak chair with iron-bound legs.'};
  const job = await k.call('mods.job', {role: 'create', input: chair});
  await writeFile(join(job.cwd, 'result.json'), JSON.stringify({...chair, basis: 'Present in this contract fixture.',
    parameters: {charges: null, effects: []}, player_view: {description: chair.description, fields: []}}));
  const made = await k.call('mods.accept', {job: job.job});
  await k.call('table.apply', {call_id: 't0-c1', effects: [{kind: 'define', ...chair, _definition: made.definition, _provenance: made.provenance},
    {kind: 'object', name: 'Study chair', definition: chair.name, to: 'Thomas Hayes'}]});
  await k.call('table.narrate', {call_id: 't0-c2', text: 'The chair is in your hands.'});
  await k.call('table.player_input', {text: 'I swing the chair at Knott.'});
  const input = {object: 'Study chair', name: 'Swing', description: 'Swing the heavy chair at Knott.'};
  const {preset_offer: offer} = await k.call('mods.job', {role: 'usage', input, offer_preset: true});
  assert.equal(offer.for, 'usage');
  assert.deepEqual(offer.thing, {name: 'Study chair', why: 'Swing: Swing the heavy chair at Knott.', description: chair.description});
  const usageJob = await k.call('mods.job', {role: 'usage', input, preset: {weapon: 'club_large', confidence: 0.77}});
  const preset = plain(await k.read(usageJob.job, 'request.json')).preset;
  assert.deepEqual(preset.parameters, {skill: 'Fighting (Brawl)', damage: '1D8', adds_damage_bonus: true, base_range_yards: null, uses_per_round: 1,
    magazine: null, malfunction: null, impale: false});
  const usage = parameters => ({name: 'Swing', description: 'A heavy swing.', basis: 'The preset club.', mode: 'melee', parameters,
    player_view: {description: 'A heavy swing.', fields: ['damage']}});
  await writeFile(join(usageJob.cwd, 'result.json'), JSON.stringify(usage({...preset.parameters, damage: '1D10'})));
  const refused = await refusal(k.call('mods.accept', {job: usageJob.job}));
  assert.deepEqual(refused.details.findings.map(item => [item.code, item.field]), [['preset_deviation', 'damage']]);
  const checked = await api.checkObjectUsage(join(usageJob.cwd, 'result.json'));
  assert.equal(checked.ok, false);
  await writeFile(join(usageJob.cwd, 'result.json'), JSON.stringify(usage(preset.parameters)));
  const accepted = plain(await k.call('mods.accept', {job: usageJob.job}));
  assert.deepEqual(accepted.provenance.preset, {table: 'weapons', id: 'club_large', confidence: 0.77});
  assert.equal(accepted.usage.parameters.damage, '1D8');
  // The accepted packet is read back through the same provenance check a retained job passes.
  assert.deepEqual(plain(await k.call('mods.accept', {job: usageJob.job})), accepted);
});

test('both package versions load at their digests, and a campaign locked to 1.2.2 is offered nothing', async t => {
  const fresh = await kernel(t);
  const current = await fresh.lock();
  assert.equal(current.version, '1.3.4');
  assert.equal(current.digest, DIGEST_130);
  const old = await kernel(t, {version: '1.2.2'});
  const listed = (await old.call('mods.list', {})).mods.filter(mod => mod.id === 'enhanced-items').map(mod => [mod.version, mod.compatible]);
  assert.deepEqual(listed, [['1.2.2', true], ['1.3.4', true]]);
  const locked = await old.lock();
  assert.equal(locked.version, '1.2.2');
  assert.equal(locked.digest, DIGEST_122);
  await playerTurn(old);
  const job = await old.call('mods.job', {role: 'create', input: KNIFE, offer_preset: true});
  assert.equal(job.preset_offer, undefined, '1.2.2 does not declare weapons.preset.v1');
  assert.equal((await old.read(job.job, 'request.json')).preset, undefined);
  const ignored = await old.call('mods.job', {role: 'create', input: KNIFE, preset: {weapon: 'knife_medium', confidence: 0.9}});
  assert.equal(ignored.job, job.job, 'a preset sent to a 1.2.2 campaign changes nothing');
});

// ----- the host: the real Mods extension asks the band question and mints the job with its answer -----

const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
function distribution(keys, chosen, confidence) {
  const rest = keys.length > 1 ? (1 - confidence) / (keys.length - 1) : 0;
  return Object.fromEntries(keys.map(key => [key, key === chosen ? (keys.length > 1 ? confidence : 1) : rest]));
}
/** A controlled typed endpoint: `answer(key, question)` names the choice and its confidence for every question. */
function installJev(t, answer) {
  const original = globalThis.fetch, requests = [];
  globalThis.fetch = async (url, init) => {
    if (String(url) !== JEV_URL) return original(url, init);
    const body = JSON.parse(init.body);
    requests.push(body);
    const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
      const keys = Object.keys(question.criteria), {choice, confidence} = answer(key, question);
      return [key, {type: 'choice', choice, confidence, probabilities: distribution(keys, choice, confidence)}];
    }));
    return new Response(JSON.stringify({model: 'jev-1.13.0', answers, usage: {input_tokens: 400, output_tokens: 10}}), {status: 200});
  };
  t.after(() => { globalThis.fetch = original; });
  return requests;
}
/** The Jev key for this test only: set, or removed with its compatibility fallback. */
function jevKey(t, present) {
  const saved = {EXT_JEV_APIKEY: process.env.EXT_JEV_APIKEY, TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY};
  delete process.env.TYPESAFE_API_KEY;
  if (present) process.env.EXT_JEV_APIKEY = 'test-jev-key'; else delete process.env.EXT_JEV_APIKEY;
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}
/** Family first, then the profile the fixture wants inside that family, `none` for every other family in the beam. */
const picks = (family, profile, confidence) => (key, question) => key === 'family' ? {choice: family, confidence}
  : Object.hasOwn(question.criteria, profile) ? {choice: profile, confidence} : {choice: 'none', confidence};

/** The real Mods extension over the kernel, with a fake creator child that copies whatever preset its packet names. */
async function host(t, k) {
  const pi = {events: new EventEmitter(), on() {}}, rows = [], runs = [];
  let bridge;
  pi.events.on('coc:mods-bridge', value => { bridge = value; });
  modsExtension(pi);
  pi.events.emit('coc:kernel-bridge', {call: k.call, record: row => rows.push(row), mintCallId: () => undefined, runtime: {
    async runTask(task) {
      const request = JSON.parse(await readFile(join(task.request.cwd, 'request.json'), 'utf8'));
      runs.push(request);
      const input = request.input, preset = request.preset?.parameters;
      const draft = request.role === 'usage'
        ? {name: input.name, description: 'A heavy swing.', basis: 'Fixture.', mode: 'melee', player_view: {description: 'A heavy swing.', fields: ['damage']},
          parameters: preset ?? {skill: 'Fighting (Brawl)', damage: '1D6', uses_per_round: 1, impale: false, adds_damage_bonus: true}}
        : definition(input, preset ?? {skill: 'Fighting (Brawl)', damage: '1D6', base_range_yards: null, uses_per_round: 1, magazine: null,
          malfunction: null, impale: false, adds_damage_bonus: true});
      await writeFile(join(task.request.cwd, 'result.json'), JSON.stringify(draft));
      return {ok: true};
    },
    async check(request) { return request.kind === 'object-usage' ? api.checkObjectUsage(request.draft) : api.checkModDefinition(request.draft); },
  }});
  return {bridge, rows, runs};
}
const presetRows = rows => rows.filter(row => (row.lane === 'run' && row.clerk === 'creator_preset') || row.lane === 'band-recovery');
/** Define a weapon the ordinary way (deferred beside the turn) and wait for its job to be accepted. */
async function defineWeapon(k, h) {
  const effect = {kind: 'define', ...KNIFE};
  await h.bridge.prepare('apply', {campaign: 'c1', effects: [effect]});
  assert.equal(typeof effect._queued, 'string', 'the weapon is registered beside the turn');
  await waitForValue(() => existsSync(join(k.jobs, effect._queued, 'accepted.json')), {label: 'the deferred definition accepted'});
  return {job: effect._queued, request: plain(await k.read(effect._queued, 'request.json')), accepted: plain(await k.read(effect._queued, 'accepted.json'))};
}

test('above the gate the host mints the definition job with the profile Jev named, asking once', async t => {
  jevKey(t, true);
  const requests = installJev(t, picks('Fighting (Brawl)', 'knife_medium', 0.86));
  const k = await kernel(t);
  await playerTurn(k);
  const h = await host(t, k);
  const {job, request, accepted} = await defineWeapon(k, h);
  assert.equal(request.preset.id, 'knife_medium');
  assert.equal(request.preset.confidence, 0.86);
  assert.deepEqual(accepted.definition.parameters, KNIFE_MEDIUM);
  assert.deepEqual(accepted.provenance.preset, {table: 'weapons', id: 'knife_medium', confidence: 0.86});
  // Two levels, one question: the deferral and the generation beside the turn minted the same job from one answer.
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].state.thing, {name: KNIFE.name, description: KNIFE.description});
  assert.equal(requests[0].state.declaration, DECLARATION);
  assert.equal(h.runs.length, 1);
  const [bind, recovery] = presetRows(h.rows);
  assert.equal(presetRows(h.rows).length, 2);
  assert.equal(bind.status, 'succeeded');
  assert.equal(bind.for, 'define');
  assert.equal(bind.job, job);
  assert.deepEqual(bind.bindings.map(({distribution: _d, family: _f, ...binding}) => binding),
    [{name: 'weapon', path: 'banded', value: 'knife_medium', table: 'weapons', confidence: 0.86}]);
  assert.equal(bind.bindings[0].family.choice, 'Fighting (Brawl)');
  assert.deepEqual([recovery.lane, recovery.ok, recovery.reason, recovery.for, recovery.band, recovery.job], ['band-recovery', true, 'decided', 'define', 'knife_medium', job]);
});

test('below the gate, on none, and without a key the job is minted as before and the rows say why', async t => {
  for (const [label, answer, key, cause] of [
    ['below the gate', picks('Fighting (Brawl)', 'knife_medium', 0.31), true, 'low_confidence'],
    ['none', (keyName) => ({choice: 'none', confidence: 0.9}), true, 'none'],
    ['no key', picks('Fighting (Brawl)', 'knife_medium', 0.95), false, 'unconfigured'],
  ]) {
    await t.test(label, async t => {
      jevKey(t, key);
      const requests = installJev(t, answer);
      const k = await kernel(t);
      await playerTurn(k);
      const h = await host(t, k);
      const {job, request, accepted} = await defineWeapon(k, h);
      assert.equal(request.preset, undefined, 'no preset in the packet');
      assert.equal(accepted.provenance.preset, undefined);
      assert.equal(accepted.definition.parameters.damage, '1D6', 'the creator\'s own numbers stand, as before');
      const rows = presetRows(h.rows);
      if (key) {
        assert.ok(requests.length >= 1);
        assert.deepEqual(rows.map(row => [row.lane, row.outcome ?? row.ok, row.cause ?? row.reason, row.job]),
          [['run', 'keeper', cause, job], ['band-recovery', false, cause, job]]);
        assert.equal(rows[0].bindings[0].value, null);
      } else {
        assert.equal(requests.length, 0, 'no key, no question');
        assert.deepEqual(rows.map(row => [row.lane, row.ok, row.reason, row.for]), [['band-recovery', false, 'unconfigured', 'define']]);
      }
    });
  }
});

test('an action usage batch waits for its preset and the accepted usage copies it', async t => {
  jevKey(t, true);
  const requests = installJev(t, picks('Fighting (Brawl)', 'club_large', 0.8));
  const k = await kernel(t);
  const chair = {name: 'Chair frame', category: 'item', description: 'A solid oak chair with iron-bound legs.'};
  const job = await k.call('mods.job', {role: 'create', input: chair});
  await writeFile(join(job.cwd, 'result.json'), JSON.stringify({...chair, basis: 'Present in this contract fixture.',
    parameters: {charges: null, effects: []}, player_view: {description: chair.description, fields: []}}));
  const made = await k.call('mods.accept', {job: job.job});
  await k.call('table.apply', {call_id: 't0-c1', effects: [{kind: 'define', ...chair, _definition: made.definition, _provenance: made.provenance},
    {kind: 'object', name: 'Study chair', definition: chair.name, to: 'Thomas Hayes'}]});
  await k.call('table.narrate', {call_id: 't0-c2', text: 'The chair is in your hands.'});
  await k.call('table.player_input', {text: 'I swing the chair at Knott.'});
  const h = await host(t, k);
  const effect = {kind: 'usage', object: 'Study chair', name: 'Swing', description: 'Swing the heavy chair at Knott.'};
  await h.bridge.prepare('apply', {campaign: 'c1', effects: [effect]});
  const usage = plain(effect._usage);
  assert.deepEqual(usage.provenance.preset, {table: 'weapons', id: 'club_large', confidence: 0.8});
  assert.equal(usage.usage.parameters.damage, '1D8');
  assert.equal(h.runs[0].preset.id, 'club_large');
  assert.equal(requests[0].state.thing.name, 'Study chair');
  assert.equal(requests[0].state.thing.description, chair.description);
  const [bind] = presetRows(h.rows);
  assert.equal(bind.for, 'usage');
  assert.equal(bind.status, 'succeeded');
});
