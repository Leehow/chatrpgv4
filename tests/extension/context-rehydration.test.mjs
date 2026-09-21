import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..'), evidence = join(root, '.coc/playtests/context-rehydration');
await mkdir(evidence, { recursive: true });
const directory = await mkdtemp(join(evidence, 'suite-'));
await writeFile(join(directory, 'classification.json'), JSON.stringify({ kind: 'contract-fixture', live_play: false, model_calls: 0 }));
await build({ stdin: { contents: `
export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {loadModule} from './kernel-ts/read/campaign.ts';
export {evidenceAnchors} from './kernel-ts/read/assemble.ts';
export {contextBinding, fitCoverage, MEMORY_COVERAGE_BYTES} from './kernel-ts/read/context.ts';
`, resolveDir: root, sourcefile: 'context-rehydration-api.ts' }, outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent' });
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href), closers = [];
after(async () => { for (const close of closers) await close(); });

const wrong = { kind: 'knowledge', subject: 'Thomas Hayes', entities: ['Steven Knott'], statement: 'The house belongs to Thomas Hayes.' };
const correction = { kind: 'keeper_correction', subject: 'keeper', entities: ['Steven Knott'], statement: 'The previous ownership claim has no support and is withdrawn.' };

async function table() {
    const home = await mkdtemp(join(directory, 'campaign-'));
    const context = await api.createKernelContext({ workspace: home, content: join(root, 'content'), seed: 'rehydrate', locks: api.nativeAdvisoryLocks(), env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    const runtime = api.createKernelRuntime(context); closers.push(() => runtime.close());
    const call = (method, params = {}) => runtime.handlers[method]({ campaign: 'c1', ...params });
    const base = join(home, '.coc/campaigns/c1');
    await call('campaign.create', { id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en' });
    await call('table.open');
    return { home, base, context, call };
}

async function hashTree(rootPath) {
    const seen = {};
    async function walk(path, prefix = '') {
        for (const entry of await readdir(path, { withFileTypes: true })) {
            const absolute = join(path, entry.name), relative = join(prefix, entry.name);
            if (entry.isDirectory()) await walk(absolute, relative);
            else seen[relative] = createHash('sha256').update(await readFile(absolute)).digest('hex');
        }
    }
    await walk(rootPath);
    return seen;
}

function coverageBytes(coverage) {
    return Buffer.byteLength(JSON.stringify(coverage), 'utf8');
}

function largeCoverage(rows, noteSize = 2600) {
    return {
        scope: 'canonical_committed_records', committed: rows, completed: 0, gaps: rows, recent_from: 1,
        recent: Array.from({ length: rows }, (_, index) => ({ from: index + 1, to: index + 1, status: 'missing', recall: { what: 'history', turns: [index + 1, index + 1] } })),
        older: { gaps: 0 },
        original_read: { what: 'transcript', read: { turn: rows, role: 'keeper', offset: 0, limit: 4096 } },
        note: 'x'.repeat(noteSize)
    };
}

test('table.capsule adds transport binding and rehydrate restores the full brief without consuming firstStyleTurn or writing files', async () => {
    const t = await table();
    const before = await hashTree(t.base);
    const plainBefore = await t.call('table.capsule');
    assert.equal(plainBefore._context.version, 1);
    assert.equal(plainBefore._context.campaign, 'c1');
    assert.equal(plainBefore._context.worldline, 'main');
    assert.equal(plainBefore._context.loop, 0);
    assert.equal(plainBefore._context.turn, 0);
    assert.match(plainBefore._context.source_revision, /^[0-9a-f]{64}$/);
    assert.ok(plainBefore.module, 'ordinary first capsule remains full before the first player input');

    const hydrated = await t.call('table.capsule', { rehydrate: true });
    assert.ok(hydrated.module, 'rehydration forces the module briefing');
    assert.match(hydrated.head, /module section/);
    assert.equal(hydrated._context.source_revision, plainBefore._context.source_revision);
    await assert.rejects(t.call('table.capsule', { rehydrate: 'false' }), /params\.rehydrate must be boolean/);
    assert.deepEqual(await t.call('table.capsule', { rehydrate: true }), hydrated, 'same snapshot rehydrates deterministically');
    assert.deepEqual(await hashTree(t.base), before, 'rehydration does not write game files');
    assert.ok((await t.call('table.capsule')).module, 'rehydration did not consume firstStyleTurn');

    await t.call('table.narrate', { call_id: 't0-c1', text: 'The study smells of dust and old smoke.' });
    await t.call('table.player_input', { text: 'I examine the desk.' });
    await t.call('table.narrate', { call_id: 't1-c1', text: 'You find a letter folded beneath the blotter.' });
    await t.call('table.player_input', { text: 'I read the letter.' });
    await t.call('table.narrate', { call_id: 't2-c1', text: 'The letter names a person you do not know yet.' });
    const floor = await t.call('table.capsule');
    assert.equal(floor.module, undefined, 'normal capsule remains the brief floor after first use');
    assert.ok(!floor.head.includes('module section'));
    const refilled = await t.call('table.capsule', { rehydrate: true });
    assert.ok(refilled.module, 'rehydration restores the full module briefing after first use');
    assert.equal(refilled._context.turn, floor._context.turn);
    assert.equal(floor._context.source_revision, plainBefore._context.source_revision, 'turn-only progression does not alter source_revision');
    assert.equal(refilled._context.source_revision, plainBefore._context.source_revision, 'normal and full forms share the same source_revision');
});

test('rehydration preserves a legacy snapshot without writing its missing trail cache', async () => {
    const t = await table(), path = join(t.base, 'world.json');
    const world = JSON.parse(await readFile(path, 'utf8'));
    delete world.scene_trail;
    await writeFile(path, JSON.stringify(world));
    const before = await hashTree(t.base);
    const capsule = await t.call('table.capsule', {rehydrate: true});
    assert.ok(capsule.where);
    assert.deepEqual(await hashTree(t.base), before, 'legacy trail reconstruction must stay in the read snapshot');
});

test('table.player_input carries the same binding beside capsule and never persists it inside the turn capsule', async () => {
    const t = await table();
    await t.call('table.narrate', { call_id: 't0-c1', text: 'Rain crosses the window.' });
    const opened = await t.call('table.player_input', { text: 'I step inside.' });
    assert.equal(opened.state, 'open');
    assert.ok(opened.capsule);
    assert.ok(opened._context);
    assert.equal(opened._context.turn, opened.turn);
    const capsule = await t.call('table.capsule');
    assert.equal(capsule._context.source_revision, opened._context.source_revision);
    assert.equal(capsule._context.worldline, opened._context.worldline);
    const record = JSON.parse(await readFile(join(t.base, 'turn.json'), 'utf8'));
    assert.ok(record.capsule);
    assert.equal(record.turn, opened.turn);
    assert.equal(record.capsule._context, undefined, 'host binding is not game state');
});

test('memory coverage distinguishes completed-empty jobs from missing and failed extraction gaps within the byte bound', async () => {
    const t = await table();
    await t.call('table.narrate', { call_id: 't0-c1', text: 'A quiet arrival.' });
    const job0 = await t.call('memory.job', { turn: 0 });
    await t.call('memory.submit', { job_id: job0.job_id, candidates: [] });
    await t.call('table.player_input', { text: 'I ask about the house.' });
    await t.call('table.narrate', { call_id: 't1-c1', text: 'The caretaker avoids your eyes.' });
    await t.call('table.player_input', { text: 'I press him.' });
    await t.call('table.narrate', { call_id: 't2-c1', text: 'He denies everything and closes the door.' });
    const job2 = await t.call('memory.job', { turn: 2 });
    await t.call('memory.fail', { job_id: job2.job_id, reason: 'model_error', detail: 'fixture failure' });

    const coverage = (await t.call('table.capsule'))._context.memory_coverage;
    assert.equal(coverage.committed, 3);
    assert.equal(coverage.completed, 1);
    assert.equal(coverage.gaps, 2);
    const statusAt = (turn) => coverage.recent.flatMap(range => range.from <= turn && turn <= range.to ? [range.status] : []);
    assert.deepEqual(statusAt(1), ['missing']);
    assert.deepEqual(statusAt(2), ['failed']);
    assert.deepEqual(coverage.recent[0].recall, { what: 'history', turns: [1, 1] });
    assert.deepEqual(coverage.original_read, { what: 'transcript', read: { turn: 2, role: 'keeper', offset: 0, limit: 4096 } });
    assert.match(coverage.note, /not a semantic completeness claim/);
    assert.ok(coverageBytes(coverage) <= api.MEMORY_COVERAGE_BYTES);
});

test('coverage trimming hard-fits final serialized bytes and drops optional detail before lying', () => {
    for (const [limit, rows, note] of [[4096, 20, 2800], [3000, 8, 2600], [900, 8, 2600], [320, 4, 2600]]) {
        const result = largeCoverage(rows, note);
        const trimmed = api.fitCoverage(result, limit);
        assert.ok(coverageBytes(trimmed) <= limit, `coverage fits ${limit} bytes`);
        if (trimmed.truncated) assert.ok(trimmed.omitted_recent_gaps || trimmed.recent.length === 0 || trimmed.note == null || trimmed.original_read == null);
    }
    assert.throws(() => api.fitCoverage(largeCoverage(1), 128), /too small/);
});

test('corrupt optional coverage metadata degrades honestly without blocking a valid opened turn', async () => {
    const t = await table();
    await t.call('table.narrate', { call_id: 't0-c1', text: 'The entry hall settles.' });
    const job = await t.call('memory.job', { turn: 0 });
    await mkdir(join(t.base, 'memory', 'jobs'), { recursive: true });
    await writeFile(join(t.base, 'memory', 'jobs', `${job.job_id}.json`), '{');
    const beforeJobCorruption = await hashTree(t.base);
    const capsule = await t.call('table.capsule');
    assert.equal(capsule._context.memory_coverage.status, 'unavailable');
    assert.equal(capsule._context.memory_coverage.committed, null);
    assert.match(capsule._context.memory_coverage.note, /unavailable/);
    assert.deepEqual(await hashTree(t.base), beforeJobCorruption, 'coverage downgrade is read-only');

    await writeFile(join(t.base, 'memory', 'backlog.jsonl'), '{');
    const opened = await t.call('table.player_input', { text: 'I enter despite the broken metadata.' });
    assert.equal(opened.turn, 1);
    assert.equal(opened._context.memory_coverage.status, 'unavailable');
    const turn = JSON.parse(await readFile(join(t.base, 'turn.json'), 'utf8'));
    assert.equal(turn.turn, 1);
    assert.equal(turn.player_text, 'I enter despite the broken metadata.');
    const closed = (await readdir(join(t.base, 'turns'))).filter(name => name.endsWith('.json'));
    assert.deepEqual(closed, ['0000.json']);
});

test('source binding failures are advisory and keep a conservative null revision', async () => {
    const t = await table();
    const module = await api.loadModule(t.context, 'the-haunting');
    const badContext = { ...t.context, snapshots: { ...t.context.snapshots, sortedChildNames: async () => { throw new Error('fixture source unavailable'); } } };
	const binding = await api.contextBinding({
		id: 'c1', context: badContext,
		meta: { active_worldline: 'main', worldlines: { main: { loop: 0 } }, register: 'purist', play_language: 'en' },
		world: { mods: { active: {} } }, party: [],
		turn: { turn: 0, receipts: [], pending_choice: null }, records: [], log: async () => [], optional: async () => null
    }, module, { mods: { active: [] } });
    assert.equal(binding.source_revision, null);
    assert.equal(binding.unavailable, true);
    assert.match(binding.reason, /source unavailable/);
    assert.notEqual(binding.memory_coverage.status, 'unavailable');
});

test('context identity resets on worldline fork while inherited memory and coverage follow the canonical line snapshot', async () => {
    const t = await table();
    await t.call('table.narrate', { call_id: 't0-c1', text: 'The entry hall settles.' });
    const job0 = await t.call('memory.job', { turn: 0 });
    await t.call('memory.submit', { job_id: job0.job_id, candidates: [{ kind: 'knowledge', subject: 'Thomas Hayes', knowers: [], entities: [], statement: 'Thomas arrived before the rain.' }] });
    const main = await t.call('table.capsule');
    assert.equal(main._context.worldline, 'main');

    await t.call('table.player_input', { text: 'Consider the other road.' });
    await t.call('table.apply', { call_id: 't1-c1', effects: [{ kind: 'fork', name: 'side', mode: 'if' }] });
    await t.call('table.narrate', { call_id: 't1-c2', text: 'The other road opens.' });
    const side = await t.call('table.capsule');
    assert.equal(side._context.worldline, 'side');
    assert.notEqual(side._context.turn, main._context.turn);
    assert.equal(side._context.source_revision, main._context.source_revision, 'source revision is source identity, while the binding line changed');
    assert.ok(side.memory.some(row => row.statement === 'Thomas arrived before the rain.'), 'inherited parent-line candidate still projects');
    assert.equal(side._context.memory_coverage.committed, 2);
    assert.equal(side._context.memory_coverage.completed, 1);
    assert.equal(side._context.memory_coverage.gaps, 1);
});

test('source_revision changes for effective source and active package locks but not empty dynamic state', async () => {
    const t = await table();
    const module = await api.loadModule(t.context, 'the-haunting');
	const campaign = (world) => ({
		id: 'c1', context: t.context,
		meta: { active_worldline: 'main', worldlines: { main: { loop: 0 } }, register: 'purist', play_language: 'en' },
		world: { mods: { active: {} }, ...world }, party: [],
		turn: { turn: 0, receipts: [], pending_choice: null }, records: [], log: async () => [], optional: async () => null
	});
    const base = await api.contextBinding(campaign({ clock: { minutes: 0 } }), module, { mods: { active: [] } });
    const dynamic = await api.contextBinding(campaign({ clock: { minutes: 99 }, active_scene: 'changed' }), module, { mods: { active: [] } });
    assert.equal(dynamic.source_revision, base.source_revision, 'ordinary world state does not affect source_revision');
    const locked = await api.contextBinding(campaign({ mods: { active: { fixture: { enabled: true, version: '1.0.0', digest: 'a', settings: { mode: 'quiet' } } } } }), module, { mods: { active: [{ id: 'fixture', version: '1.0.0' }] } });
    const changedSetting = await api.contextBinding(campaign({ mods: { active: { fixture: { enabled: true, version: '1.0.0', digest: 'a', settings: { mode: 'loud' } } } } }), module, { mods: { active: [{ id: 'fixture', version: '1.0.0' }] } });
    const changedPackage = await api.contextBinding(campaign({ mods: { active: { fixture: { enabled: true, version: '1.0.0', digest: 'b', settings: { mode: 'quiet' } } } } }), module, { mods: { active: [{ id: 'fixture', version: '1.0.0' }] } });
    assert.notEqual(changedSetting.source_revision, locked.source_revision);
    assert.notEqual(changedPackage.source_revision, locked.source_revision);
    const changedSource = await api.contextBinding(campaign({}), { ...module, graph: { digest: 'different-graph' } }, { mods: { active: [] } });
    assert.notEqual(changedSource.source_revision, base.source_revision);
});

test('capsule memory anchors include the current scene and most recent acquired evidence while preserving correction priority', async () => {
    const t = await table();
    const view = await t.call('table.view'), scene = view.scene.name;
    await t.call('table.narrate', { call_id: 't0-c1', text: 'The house holds its breath.' });
    const sceneJob = await t.call('memory.job', { turn: 0 });
    const sceneMemory = 'This place listens before it answers.';
    await t.call('memory.submit', { job_id: sceneJob.job_id, candidates: [{ kind: 'knowledge', subject: scene, knowers: [], entities: [], statement: sceneMemory }] });
    const sceneCapsule = await t.call('table.capsule');
    assert.ok(sceneCapsule.memory.some(row => row.statement === sceneMemory), 'scene-anchored candidate rides the capsule memory');
    assert.ok(sceneCapsule.memory.length <= 6);

    const module = await api.loadModule(t.context, 'the-haunting'), graph = module.graph;
    const clue = graph.kind('clue')[0];
    const carrier = graph.kind('handout').find(handout => (graph.out.get(handout.node_id) ?? []).some(edge => ['supports', 'depicts'].includes(edge.relation_kind) && graph.nodes.get(edge.to_node_id)?.node_kind === 'clue'));
    assert.ok(clue, 'fixture module has clue evidence');
    assert.ok(carrier, 'fixture module has a handout carrier');
    const carriedClue = graph.nodes.get((graph.out.get(carrier.node_id) ?? []).find(edge => ['supports', 'depicts'].includes(edge.relation_kind) && graph.nodes.get(edge.to_node_id)?.node_kind === 'clue').to_node_id);
    const anchors = api.evidenceAnchors(graph, { discovered_clues: [graph.handle(clue)], handouts_shown: [graph.handle(carrier)] }, [
        { turn: 3, receipts: [{ kind: 'handout', handout: graph.handle(carrier) }] },
        { turn: 5, receipts: [{ kind: 'clue', clue: graph.handle(clue) }] }
    ]);
    assert.equal(anchors[0], graph.handle(clue));
    assert.ok(anchors.includes(graph.handle(carrier)), 'handout receipts anchor the handout itself');
    assert.ok(anchors.includes(graph.handle(carriedClue)), 'handout carrier receipts anchor the clue they carry');
    assert.ok(anchors.length <= 4);

    const u = await table();
    await u.call('table.narrate', { call_id: 't0-c1', text: wrong.statement });
    const wrongJob = await u.call('memory.job', { turn: 0 });
    await u.call('memory.submit', { job_id: wrongJob.job_id, candidates: [wrong] });
    await u.call('table.player_input', { text: 'Clarify the earlier account.' });
    await u.call('table.narrate', { call_id: 't1-c1', text: correction.statement });
    const correctionJob = await u.call('memory.job', { turn: 1 });
    const target = correctionJob.correction_targets.find(target => target.statement === wrong.statement);
    assert.ok(target);
    await u.call('memory.submit', { job_id: correctionJob.job_id, candidates: [{ ...correction, corrects: [{ subject: target.subject, statement: target.statement }] }] });
    const priority = await u.call('table.capsule');
    assert.equal(priority.memory[0].kind, 'keeper_correction');
    assert.equal(priority.memory[0].authority, 'conversation_report');
    assert.ok(priority.memory.length <= 6);
});
