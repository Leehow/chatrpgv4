/**
 * Contract §180.3–§180.5 (docs/specs/creature-kind.md, ticket CK-A): a person and a creature are told apart by what each
 * feature needs, not by which lookup it happened to call.
 *
 * The haunting's rat swarm reached the person layer through `npcsPresent` (an actor list): an untold block and
 * `say_name`, social and Psychology offers, a personality job `npc.submit` then refused, a coercion act. Meanwhile three
 * body features read `npc` nodes only and missed a creature: the once-only Sanity exposure, the fight's label, First Aid.
 *
 * One fixture book, built here and owing nothing to the shipped starters: a cellar where a warden (a person) stands beside
 * a rat swarm that states a stat block (an actor, no person), a moth cloud without one (scenery), and a gardener in the
 * yard next door. Every read and write travels a real entry (`campaign.create`, `table.*`, `npc.*`, `epithets.job`); the
 * act step and the expression roster are the host's own functions over the kernel's answers.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {runNpcAct} from '../../runtime/jev/npc-act-step.ts';
import {expressionContext} from '../../extensions/table/expression-reference.ts';

const root = resolve(import.meta.dirname, '../..');
const scratch = await mkdtemp(join(tmpdir(), 'creature-kind-'));
await mkdir(join(root, '.coc'), {recursive: true});
const bundleDir = await mkdtemp(join(root, '.coc', 'creature-kind-'));
after(async () => { await rm(scratch, {recursive: true, force: true}); await rm(bundleDir, {recursive: true, force: true}); });
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {fitPresent} from './kernel-ts/read/assemble.ts';
export {pythonJsonDumps} from './kernel-ts/json.ts';`, resolveDir: root, sourcefile: 'creature-kind-api.ts'},
  outfile: join(bundleDir, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(bundleDir, 'api.mjs')).href);

// ---------------------------------------------------------------------------------------------------
// The fixture book.
// ---------------------------------------------------------------------------------------------------

const MODULE = 'module-creature-bench', CELLAR = 'scene-cellar', YARD = 'scene-yard';
const RATS = 'Cellar rats', MOTHS = 'Moth cloud', WARDEN = 'Old warden', GARDENER = 'The gardener';
const RAT_SUMMARY = 'A swarm of rats nesting behind the cellar boards that may overwhelm one investigator.';
const RAT_NOTE = 'The swarm breaks and flees once one rat is killed.';

function bench() {
  const claims = [], relations = [];
  let n = 0;
  const relate = (kind, from, to) => {
    n += 1;
    const claim_id = `claim-${kind}-${n}`;
    claims.push({claim_id, subject_id: from, predicate: kind, object: {node_id: to}, truth_status: 'authored-fact', visibility: 'keeper-only',
      evidence_span_ids: [], asserted_by_ids: [], known_by_ids: [], validity: null, confidence: 1, reason: 'Creature bench fixture.'});
    relations.push({relation_id: `relation-${kind}-${n}`, relation_kind: kind, from_node_id: from, to_node_id: to, claim_id, properties: {}});
  };
  const node = (node_id, node_kind, name, summary, properties, visibility = 'keeper-only') =>
    ({node_id, node_kind, name, visibility, aliases: [], summary, evidence_span_ids: [], properties, source_refs: []});
  const meta = {schema_version: 1, scenario_id: 'creature-bench', source_language: 'en', runtime_projection_contract: 'coc.module-graph-runtime-projection.v1',
    title: 'The Cellar Bench', opening_scene: 'A cellar with a warden and something moving behind the boards.', one_liner: 'A cellar, a warden, a rat swarm.',
    structure_type: 'hub_sandbox', era: '1920s', setting_tags: ['test'], content_flags: ['test-module'], win_condition: 'None; a bench.',
    start_clock: {calendar_mode: 'gregorian', local_datetime: '1925-03-02T21:00:00', timezone: 'America/New_York', display: '1925-03-02 21:00'},
    summary: 'A bench for telling persons from creatures.', player_safe_summary: 'A cellar in Boston.', keeper_secret_summary: 'Rats behind the boards.',
    license: 'Apache-2.0', author: 'chatrpgv4 contributors', attribution: 'Original test content.', copyright_notice: []};
  const scene = (id, name, start, edges) => node(id, 'scene', name, `${name}, a test place.`, {runtime_projection: {document: 'story-graph.json', collection: 'scenes', record: {
    scene_id: id.slice('scene-'.length), is_start: start, location_tags: ['test'], scene_type: 'social', origin: 'source', dramatic_question: 'Who is here?',
    entry_conditions: [], exit_conditions: [], available_clues: [], npc_ids: [], pressure_moves: [], storylet_tags: [], affordances: [], tone: [],
    allowed_improvisation: [], scene_edges: edges}}});
  const person = (id, name, summary) => node(id, 'npc', name, summary, {runtime_projection: {document: 'npc-agendas.json', collection: 'npcs', record: {
    npc_id: id, name, origin: 'source', agenda: 'Keep the cellar shut.', fear: 'The boards giving way.', secret: 'He feeds the rats.', voice: 'Gruff and slow.',
    relationship_to_investigators: 'stranger', known_fact_ids: [], revealable_fact_ids: [], disclosure_order: [], facts: [], lie_options: [], deflect_options: [],
    leverage_ids: [], active_reactions: [], availability: {status: 'available'}, schedule: [], keeper_note: 'A person of the bench.',
    biography: `${name}, in a long coat with a ring of keys.`}}}, 'player-safe');
  const nodes = [
    node(MODULE, 'module', meta.title, meta.one_liner, {asset_root_id: null, source_binding: {},
      runtime_projection: {contract_id: 'coc.module-graph-runtime-projection.v1', documents: [{filename: 'module-meta.json', root: meta}]}}),
    scene(CELLAR, 'Cellar', true, [{to: 'yard', kind: 'travel', when: {kind: 'always'}}]),
    scene(YARD, 'Yard', false, [{to: 'cellar', kind: 'travel', when: {kind: 'always'}}]),
    person('npc-old-warden', WARDEN, 'A stooped warden who keeps the cellar keys.'),
    person('npc-the-gardener', GARDENER, 'A gardener raking the yard.'),
    // A stat block: an actor. Its numbers are the shape `mechanics-readers` already proves the engine reads; a node that
    // states a mechanic cites where it is stated.
    {...node('creature-cellar-rats', 'creature', RATS, RAT_SUMMARY, {keeper_note: RAT_NOTE, mechanics: {profile: {
      characteristics: {STR: 35, CON: 55, SIZ: 35, DEX: 70, POW: 30}, derived: {HP: 9, MOV: 9},
      skills: {'Fighting (Brawl)': 40, Dodge: 42, Psychology: 5},
      weapons: [{weapon_id: 'bite', skill: 'Fighting (Brawl)', damage: '1D3', uses_per_round: 1, impale: false}],
      sanity_loss: {success: '0', failure: '1D3'}}}}), evidence_span_ids: ['span-bench-rats'], source_refs: [{source_id: 'fixture:creature-bench', pdf_index: 1}]},
    // No stat block: scenery to the engine, a creature in the brief's roster all the same.
    node('creature-moth-cloud', 'creature', MOTHS, 'A cloud of pale moths around the cellar lamp.', {}),
  ];
  for (const id of nodes.slice(1).map(entry => entry.node_id)) relate('contains', MODULE, id);
  relate('route-to', CELLAR, YARD); relate('route-to', YARD, CELLAR);
  // The rats are seated before the warden, so their row comes after his only because persons lead present[].
  relate('present-in', 'creature-cellar-rats', CELLAR); relate('present-in', 'npc-old-warden', CELLAR);
  relate('present-in', 'creature-moth-cloud', CELLAR); relate('present-in', 'npc-the-gardener', YARD);
  const coverage = Object.fromEntries(['structure', 'world', 'actors', 'relationships', 'events', 'knowledge', 'causal', 'mechanics', 'assets', 'direction'].map(key => [key, 'accepted']));
  return {contract_id: 'coc.module-graph.v3', schema_version: 3, module_id: MODULE, source_languages: ['en'], section_ids: ['section-bench'], coverage,
    coverage_by_section: {'section-bench': coverage}, node_refs_by_section: {'section-bench': nodes.map(entry => entry.node_id)}, nodes, claims, relations, source_refs: []};
}

const content = join(scratch, 'content');
await mkdir(join(content, 'starters', 'creature-bench'), {recursive: true});
for (const name of await readdir(join(root, 'content'))) if (name !== 'starters') await symlink(join(root, 'content', name), join(content, name));
// The built-in packages sit beside the content root (natural-npc's first impression among them).
await symlink(join(root, 'mods'), join(scratch, 'mods'));
await writeFile(join(content, 'starters', 'creature-bench', 'module-graph.json'), JSON.stringify(bench(), null, 1));
await writeFile(join(content, 'starters', 'creature-bench', 'starter-listing.json'), JSON.stringify({contract_id: 'coc.starter-listing.v1', schema_version: 1,
  scenario_id: 'creature-bench', listed: false, not_listed_reason: 'Test bench.'}));
// An investigator sheet to open with; only the sheet is borrowed, never a starter's graph.
await cp(join(root, 'content/starters/the-haunting/pregens/thomas-hayes'), join(content, 'starters/creature-bench/pregens/thomas-hayes'), {recursive: true});

async function table(t) {
  const home = await mkdtemp(join(scratch, 'home-'));
  const kernel = await api.createKernelContext({workspace: home, content, seed: 'creature-kind', locks: api.nativeAdvisoryLocks(),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(kernel); t.after(() => runtime.close());
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  await call('campaign.create', {id: 'c1', module: 'creature-bench', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  await call('table.narrate', {call_id: 't0-c1', text: 'The cellar door creaks open.'});
  const opened = await call('table.player_input', {text: 'I look around the cellar.'});
  const world = async () => JSON.parse(await readFile(join(home, '.coc/campaigns/c1/world.json'), 'utf8'));
  const status = async () => (await call('table.status'));
  let ordinal = 0;
  const id = () => `t${opened._context.turn}-c${++ordinal}`;
  return {call, home, opened, world, status, id, turn: opened._context.turn};
}
const PERSON_FIELDS = ['called', 'untold', 'now', 'personality', 'knows', 'believes', 'would_lie_about', 'ties', 'history', 'relationships',
  'recent_speech', 'commitments', 'reunion', 'from_other_lines'];
const rejects = (promise, check) => assert.rejects(promise, error => { check(error); return true; });

// ---------------------------------------------------------------------------------------------------
// §180.4: the present rows and the brief.
// ---------------------------------------------------------------------------------------------------

test('§180.4: a person row says kind npc; the creature row is a body -- what, the Keeper\'s note -- after the people, with no person field', async t => {
  const {opened} = await table(t);
  const present = opened.capsule.present;
  assert.deepEqual(present.map(row => [row.name, row.kind]), [[WARDEN, 'npc'], [RATS, 'creature']], 'the moth cloud has no stat block: no actor, no row');
  const warden = present[0];
  assert.ok(warden.untold?.say_name, 'the person keeps the name path');
  assert.deepEqual(present[1], {name: RATS, kind: 'creature', what: RAT_SUMMARY, keeper_note: RAT_NOTE});
  for (const field of PERSON_FIELDS) assert.ok(!(field in present[1]), field);
});

test('§180.3: an unknown word lists who is here, and only the untold person carries the apply person that would name them', async t => {
  const {call, id} = await table(t);
  await rejects(call('table.apply', {call_id: id(), effects: [{kind: 'npc', name: 'the stranger in grey', to: 'here', why: 'test'}]}), error => {
    assert.equal(error.code, 'unknown_entity');
    const present = Object.fromEntries(error.details.present.map(row => [row.name, row]));
    assert.ok(present[WARDEN]?.introduce, 'the untold warden can be given the word');
    assert.deepEqual(present[RATS], {name: RATS}, 'the rats are here, and have no name to give (no untold block)');
  });
});

test('§180.4: the brief carries the book\'s creatures beside its people, in the same roster form', async t => {
  const {opened} = await table(t);
  const module = opened.capsule.module;
  assert.deepEqual(module.people.map(entry => entry.name), [WARDEN, GARDENER]);
  assert.deepEqual(module.creatures.map(entry => entry.name), [RATS, MOTHS], 'stat block or not, both are creatures of the book');
  assert.ok(module.creatures.every(entry => Object.keys(entry).sort().join() === 'line,name'));
  assert.equal(module.creatures[0].line, RAT_SUMMARY);
});

test('§180.4: under present[]\'s budget the creature rows are cut first, and a stub keeps its kind', () => {
  const big = 'x'.repeat(900);
  const rows = [{name: 'A', kind: 'npc', role: big}, {name: 'B', kind: 'npc', role: big}, {name: RATS, kind: 'creature', what: big}];
  assert.equal(api.fitPresent(rows, 2400), true);
  assert.deepEqual(rows.map(row => [row.name, row.truncated === true]), [['A', false], ['B', false], [RATS, true]]);
  assert.deepEqual(rows[2], {name: RATS, kind: 'creature', truncated: true});
  assert.deepEqual(Object.keys(rows[0]).slice(0, 2), ['name', 'kind'], 'a whole row keeps its kind, after its name');
  // `kind` rides outside the budget, as the name path does: rows that fit without it are not cut for it.
  const whole = [{name: 'A', kind: 'npc', role: big}, {name: RATS, kind: 'creature', what: big}];
  const bytes = Buffer.byteLength(api.pythonJsonDumps(whole.map(({kind: _kind, ...row}) => row)), 'utf8');
  assert.equal(api.fitPresent(whole, bytes), false);
  assert.deepEqual(whole.map(row => [row.name, row.kind, row.truncated === true]), [['A', 'npc', false], [RATS, 'creature', false]]);
});

// ---------------------------------------------------------------------------------------------------
// §180.3: the person consumers.
// ---------------------------------------------------------------------------------------------------

test('§180.3: social and Psychology offers target the person only; the creature is still contested and perceived', async t => {
  const {call} = await table(t);
  const options = (await call('table.resolve.options')).selection.options;
  const on = (decision, target) => options.some(option => option.action.decision === decision && option.action.target === target);
  assert.ok(on('social:adjudicate-difficulty', WARDEN) && on('psychology:observe-concealed', WARDEN));
  assert.ok(!on('social:adjudicate-difficulty', RATS), 'no social offer at the rats');
  assert.ok(!on('psychology:observe-concealed', RATS), 'no Psychology offer at the rats');
  assert.ok(on('core-check:opposed-check', RATS), 'a body to contest stays an actor\'s offer');
  assert.ok(on('sanity:check', RATS), 'and a sight to lose Sanity over');
});

test('§180.3: npc.job enumerates persons, as npc.submit accepts them: once the warden has a personality, nothing is left', async t => {
  const {call} = await table(t);
  const job = await call('npc.job');
  assert.equal(job.npc.name, WARDEN);
  await call('npc.submit', {job_id: job.job_id, claim: job.claim, personality: {description: 'Patient, wary of strangers, protective of the cellar.'}});
  assert.deepEqual(await call('npc.job'), {job_id: null}, 'the rats are never offered a personality job');
});

test('§180.3: the untold roster and the epithet lane never list the creature', async t => {
  const {call} = await table(t);
  const untold = (await call('table.untold')).people.map(person => person.name);
  assert.ok(untold.includes(WARDEN) && !untold.includes(RATS), JSON.stringify(untold));
  const job = await call('epithets.job');
  assert.ok(job.people.some(person => person.id === 'old-warden') && !job.people.some(person => person.id === 'cellar-rats'), JSON.stringify(job.people));
});

test('§180.3: a say span naming the creature stays a label; one naming the person resolves to him', async t => {
  const {call, id} = await table(t);
  const said = await call('table.narrate', {call_id: id(), text: `{{say:${RATS}}}"Squeak."{{/say}} {{say:${WARDEN}}}"Stay back."{{/say}}`});
  assert.deepEqual(said.speech.map(line => line.who), [{label: RATS}, {npc: 'old-warden', name: WARDEN}], JSON.stringify(said.speech));
});

test('§180.3: the first impression is a person\'s -- no pending contact with the creature, and not_here lists only persons', async t => {
  const {call, id, opened} = await table(t);
  const contacts = opened.capsule.mods?.pending_contacts ?? [];
  assert.ok(contacts.some(row => row.target === WARDEN), JSON.stringify(contacts));
  assert.ok(!contacts.some(row => row.target === RATS), 'no first impression is owed with the rats');
  await rejects(call('table.resolve', {call_id: id(), action: {intent: 'social', goal: 'meet him', method: 'greet', decision: 'natural-npc:first-impression',
    actor: 'Thomas Hayes', target: GARDENER}}), error => {
    assert.equal(error.code, 'not_here');
    assert.deepEqual(error.details.present, [WARDEN], 'the Keeper is offered the people here, never the rats');
  });
});

// ---------------------------------------------------------------------------------------------------
// §180.5: apply npc / apply person on a creature.
// ---------------------------------------------------------------------------------------------------

test('§180.5: apply npc refuses a person tier on a creature with not_a_person and a body-side fix', async t => {
  const {call, id} = await table(t);
  for (const [field, value, fix] of [['mood', 'hungry', /disposition/], ['reunion', {with: 'Thomas Hayes'}, /prose/], ['archetype', 'ordinary_adult', /stat block/]])
    await rejects(call('table.apply', {call_id: id(), effects: [{kind: 'npc', name: RATS, [field]: value, why: 'test'}]}), error => {
      assert.equal(error.code, 'invalid_params', field);
      assert.equal(error.details.reason, 'not_a_person', field);
      assert.equal(error.details.field, `npc.${field}`);
      assert.match(error.fix, fix, field);
    });
  await rejects(call('table.apply', {call_id: id(), effects: [{kind: 'person', who: RATS, name: 'the squeakers'}]}), error => {
    assert.equal(error.code, 'invalid_params');
    assert.equal(error.details.reason, 'not_a_person');
  });
  // The person still takes a mood.
  const applied = await call('table.apply', {call_id: id(), effects: [{kind: 'npc', name: WARDEN, mood: 'uneasy', why: 'test'}]});
  assert.equal(applied.receipts.length, 1);
});

test('§180.5: the body\'s variants stage on a creature, and its stance reaches its row as toward_party', async t => {
  const {call, id} = await table(t);
  await call('table.apply', {call_id: id(), effects: [{kind: 'npc', name: RATS, stance: 'hostile', why: 'they smell blood'}]});
  await call('table.apply', {call_id: id(), effects: [{kind: 'npc', name: RATS, conditions: {gained: ['prone']}, why: 'they tumble'}]});
  await call('table.narrate', {call_id: id(), text: 'The rats bristle.'});
  const next = await call('table.player_input', {text: 'I back away.'});
  const rats = next.capsule.present.find(row => row.name === RATS);
  assert.equal(rats.kind, 'creature');
  assert.equal(rats.toward_party?.stance, 'hostile', JSON.stringify(rats));
  assert.match(rats.toward_party.because[0], /keeper set hostile/);
});

// ---------------------------------------------------------------------------------------------------
// §180.5: acts.
// ---------------------------------------------------------------------------------------------------

test('§180.5: a creature acts by a body\'s ways -- never coercion, never walk_on -- and says it is a creature', async t => {
  const {call} = await table(t);
  const ways = options => options.ways.map(entry => entry.way);
  const rats = await call('npc.act.options', {name: RATS});
  assert.deepEqual(rats.npc, {handle: 'cellar-rats', name: RATS, kind: 'creature'});
  assert.ok(ways(rats).includes('first_blow') && ways(rats).includes('check') && ways(rats).includes('stance'), JSON.stringify(ways(rats)));
  assert.ok(!ways(rats).includes('coercion') && !ways(rats).includes('walk_on'), JSON.stringify(ways(rats)));
  // The person beside it keeps both: the investigator is here, and the gardener stands in the yard next door.
  const warden = await call('npc.act.options', {name: WARDEN});
  assert.equal(warden.npc.kind, 'npc');
  assert.ok(ways(warden).includes('coercion') && ways(warden).includes('walk_on'), JSON.stringify(ways(warden)));
  // The stakes die rolls for a creature too: its name takes the same junction.
  const stakes = await call('npc.stakes', {name: RATS});
  assert.ok('stakes' in stakes, JSON.stringify(stakes));
});

test('§180.3: the act author reads a creature\'s body -- what it is and the Keeper\'s note -- and a person\'s perspective', async t => {
  const {call} = await table(t);
  const rats = await call('npc.situation', {name: RATS});
  assert.deepEqual(rats.npc, {handle: 'cellar-rats', name: RATS, kind: 'creature'});
  assert.deepEqual(rats.who, {what: RAT_SUMMARY, keeper_note: RAT_NOTE});
  assert.deepEqual(rats.recent_speech, []);
  const warden = await call('npc.situation', {name: WARDEN});
  assert.equal(warden.npc.kind, 'npc');
  assert.deepEqual(Object.keys(warden.who).sort(), ['commitments', 'fears', 'goals', 'personality', 'relationships']);
});

/** The act step over a kernel that answers for one being: `kind` on its situation and options, a surprise allowed. */
function actDeps(kind, writes, generated) {
  const npc = {handle: 'cellar-rats', name: RATS, kind};
  const packet = {npc, who: {}, happened: [], state: {in_session: false, my_turn: false}, at_hand: {holdings: []}, done: [], constraints: [], truncated: [],
    stakes: {rung: 'dangerous', outcome: 'escalates', line: 'This turn it goes further.', surprise: true, surprise_line: 'It may have something no one knew of.'}};
  const answer = batch => ({batchId: batch.id, status: 'complete', issues: [], coverage: {required: [], answered: [], unknown: []},
    answers: Object.fromEntries(batch.questions.map(question => [question.key, question.key === 'grounded'
      ? {status: 'answered', type: 'noul', noul: 0.99}
      : {status: 'answered', type: 'choice', choice: question.key === 'way' ? 'intention_only' : question.key === 'produces_known' ? 'new' : 'none', confidence: 0.9}]))});
  return {
    call: async (method, params) => method === 'npc.situation' ? packet : method === 'npc.act.options'
      ? {npc, play_language: 'en', place: 'cellar', in_session: false, my_turn: false, acted_on: [], ways: [{way: 'intention_only', params: {}}],
        ...(params.act ? {act: {line: params.act, ref: 'intent:cellar-rats:aaaaaaaaaaaa', continues: null}} : {})} : {},
    generate: async input => { generated.push(input.packet); return {act: 'The swarm pours out from behind the boards.', produces: 'a rusted key'}; },
    decide: async batch => answer(batch),
    write: async call => { writes.push(call); return {ok: true, callId: 'x', receipts: ['npc:x'], status: 'succeeded'}; },
    record() {}, scope: {owner: 'campaign:c1', campaign: 'c1', worldline: 'main', loop: 0, audience: 'keeper'}, readSet: [], runId: 'r', stepId: 'r:s1',
    turn: 2, gate: 0.6, budget: {timeoutMs: 8000, maxPerTurn: 2, sameActRows: 5}, signal: new AbortController().signal,
  };
}

test('§180.5: the host strips what a creature\'s act would bring out; the same act of a person keeps it', async () => {
  const writes = [], generated = [];
  const outcome = await runNpcAct(actDeps('creature', writes, generated), RATS, 'acted_on');
  assert.equal(outcome.status, 'bound');
  assert.equal(generated[0].stakes.surprise, false, 'the generator is offered no surprise for a creature');
  assert.equal(outcome.produces, null);
  assert.equal(outcome.produced, null);
  assert.ok(writes.length && writes.every(call => !call.carries), JSON.stringify(writes));
  const person = [], personGenerated = [];
  const control = await runNpcAct(actDeps('npc', person, personGenerated), RATS, 'acted_on');
  assert.equal(personGenerated[0].stakes.surprise, true);
  assert.equal(control.produced?.name, 'a rusted key', 'a person brings it out');
  assert.ok(person.some(call => call.carries?.produce), JSON.stringify(person));
});

test('§180.3: the expression roster is the persons of present[], a cut creature included out', () => {
  const context = expressionContext({turn: {number: 3, player_text: 'I speak to the warden.'}, present: [
    {name: WARDEN, kind: 'npc', personality: {description: 'Wary.'}},
    {name: RATS, kind: 'creature', what: RAT_SUMMARY},
    {name: MOTHS, kind: 'creature', truncated: true},
  ]});
  assert.deepEqual(context.people.map(person => person.name), [WARDEN]);
});

// ---------------------------------------------------------------------------------------------------
// §180.3: the body consumers, npc-only until now.
// ---------------------------------------------------------------------------------------------------

test('§180.3: a SAN check on perceiving the creature is recorded against it, so the sight is offered once', async t => {
  const {call, id} = await table(t);
  const offered = async () => (await call('table.resolve.options')).selection.options
    .some(option => option.action.decision === 'sanity:check' && option.action.target === RATS);
  assert.ok(await offered());
  await call('table.resolve', {call_id: id(), action: {intent: 'investigate', goal: 'the swarm in the lamplight', method: 'looks at it',
    decision: 'sanity:check', target: RATS, involuntary: 'flee'}});
  const roll = (await call('table.status')).receipts.find(receipt => receipt.roll_kind === 'sanity_check');
  assert.equal(roll?.npc_exposure, 'cellar-rats', JSON.stringify(roll));
  assert.equal(await offered(), false, 'the same sight is not offered again this visit');
});

test('§180.3: a fight labels the creature by its name, and a defence it rolls tags the attacker\'s roll against it', async t => {
  const {call, id} = await table(t);
  const resolve = action => call('table.resolve', {call_id: id(), action});
  let result = await resolve({intent: 'combat', goal: 'hit it', method: 'fists', target: RATS, weapon: 'unarmed'});
  const label = participants => participants.find(row => row.name === 'cellar-rats')?.label;
  assert.equal(label(result.session.participants), RATS);
  // Play the rats' turn first when they won the initiative, then the investigator's blow, which the rats defend.
  if (result.session.turn_of === 'cellar-rats') {
    await resolve({intent: 'combat', goal: 'they swarm', method: '', actor: RATS, target: 'Thomas Hayes'});
    await resolve({intent: 'combat', goal: 'combat:defend', method: 'combat:defend', actor: 'thomas-hayes', defense: 'dodge'});
    result = await resolve({intent: 'combat', goal: 'hit it', method: 'fists', target: RATS, weapon: 'unarmed'});
  }
  const pending = result.session.pending_defense;
  assert.equal(pending?.actor, 'cellar-rats', JSON.stringify(result.session));
  const defended = await resolve({intent: 'combat', goal: 'combat:defend', method: 'combat:defend', actor: RATS, defense: pending.standing?.defense ?? 'dodge'});
  const receipts = (await call('table.status')).receipts.filter(receipt => defended.receipts.includes(receipt.id) && receipt.kind === 'roll');
  const hayes = receipts.filter(receipt => receipt.actor === 'thomas-hayes');
  assert.ok(hayes.length, JSON.stringify(receipts));
  assert.ok(hayes.every(receipt => receipt.npc === 'cellar-rats'), JSON.stringify(hayes));
  // The fight folds into the stance ledger against the rats, as against a person (§11.5.3's stance read).
  assert.equal((await call('npc.situation', {name: RATS})).state.stance, 'hostile');
});

test('§180.3: a creature that is down is a First Aid patient, as a person is', async t => {
  const {call, id} = await table(t);
  await call('table.apply', {call_id: id(), effects: [{kind: 'npc', name: RATS, conditions: {gained: ['unconscious']}, why: 'stunned by the fall'}]});
  const options = (await call('table.resolve.options')).selection.options;
  assert.ok(options.some(option => option.action.decision === 'healing:first-aid-ordinary' && option.action.target === RATS),
    JSON.stringify(options.filter(option => option.family === 'healing').map(option => option.label)));
});

test('§180.3: an object\'s resource effect lands on a creature\'s body', async t => {
  const {call, id, world} = await table(t);
  const request = {name: 'Smelling salts', category: 'item', description: 'A sharp fictional salt.'};
  const job = await call('mods.job', {role: 'create', input: request});
  await writeFile(join(job.cwd, 'result.json'), JSON.stringify({...request, basis: 'Fixture', parameters: {charges: 1, effects: [{kind: 'condition', value: 'calm'}]},
    player_view: {description: 'A sharp salt.', fields: ['charges']}}));
  const accepted = await call('mods.accept', {job: job.job});
  await call('table.apply', {call_id: id(), effects: [{kind: 'define', ...request, _definition: accepted.definition, _provenance: accepted.provenance},
    {kind: 'object', name: 'My salts', definition: request.name, to: 'Thomas Hayes'}]});
  const used = await call('table.resolve', {call_id: id(), action: {intent: 'investigate', goal: 'calm them', method: 'the salts', decision: 'objects:use',
    object: 'My salts', target: RATS}});
  assert.equal(used.outcome.target, RATS);
  assert.ok((await world()).npc_resources['cellar-rats'].conditions.includes('calm'));
});

test('§180.3: the stance ledger takes no social delta for a creature, while its intention is folded as a person\'s is', async t => {
  const {call, id} = await table(t);
  await call('table.resolve', {call_id: id(), action: {intent: 'social', goal: 'distract them', method: 'quick chatter', skill: 'Fast Talk', target: RATS}});
  // Fast Talk moves a person's stance at every level; a creature is not talked round.
  assert.equal((await call('npc.situation', {name: RATS})).state.stance, 'neutral');
  await call('table.apply', {call_id: id(), effects: [{kind: 'npc', name: RATS, intends: 'reach the lamp', outcome: 'attempted', why: 'the light draws them'}]});
  const done = (await call('npc.situation', {name: RATS})).done;
  assert.deepEqual(done.map(row => [row.intent, row.status]), [['reach the lamp', 'attempted']], JSON.stringify(done));
});
