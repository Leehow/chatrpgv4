/**
 * Contract §180.2, §180.7, §180.8, §180.9 and §180.13: what the visual reader is asked about persons and creatures, and
 * what its checker refuses.
 *
 * Every case travels a real entry: `checkDraft` (what `module.read.finish` runs) fed the contract `loadModuleContract`
 * loads from the shipped content root; `checkSourceDraft` (the offline `coc-read-check` the reader runs) over files on
 * disk; and, last, a kernel runtime over a bound PDF whose opening job is claimed and finished through
 * `module.read.claim` / `module.read.finish`. The drafts are the JSON a reader would write; nothing normalises them, and
 * no case reads a shipped starter.
 *
 * New tasks always carry the source weakness law (§180.20). An explicit historical packet without that law remains
 * a compatibility fixture; it is not the policy for new reads.
 *
 * Refusals are asserted by their stable `rule` (or `reason`) and their JSON pointer, never their wording.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';

const root = resolve(import.meta.dirname, '../..'), content = join(root, 'content');
const scratch = playtestScratch('creature-reader');
await build({stdin: {contents: [
    `export {checkDraft} from './kernel-ts/modules/visual.ts';`,
    `export {loadModuleContract, vocabulary} from './kernel-ts/modules/contract.ts';`,
    `export {checkSourceDraft} from './kernel-ts/check.ts';`,
    `export {snapshots} from './kernel-ts/snapshots.ts';`,
    `export {parsePythonJson, pythonJsonDumps} from './kernel-ts/json.ts';`,
    `export {createKernelContext} from './kernel-ts/context.ts';`,
    `export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';`,
    `export {createKernelRuntime} from './kernel-ts/registry.ts';`,
].join('\n'), resolveDir: root, sourcefile: 'creature-reader-api.ts', loader: 'ts'},
    outfile: join(scratch, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(scratch, 'api.mjs')).href);
const contract = await api.loadModuleContract({content, snapshots: api.snapshots});
const prompt = await readFile(join(content, 'setup', 'visual-reader.md'), 'utf8');
const parsed = value => api.parsePythonJson(JSON.stringify(value));
const closers = [];
after(async () => { for (const close of closers.reverse()) await close(); });

const page3 = [{page: 3}], page4 = [{page: 4}];
const SEEN = new Set([3, 4]);
const BOUND = api.vocabulary(contract), {actor_weaknesses: _legacyLaw, ...UNBOUND} = structuredClone(BOUND);
/** A detail read of a cellar the opening prepared; `vocabulary` is the task's, bound or not. */
const packetWith = (vocabulary, known = []) => ({module_id: 'book-9', purpose: 'detail', focus: 'Cellar', question: '', source: {page_count: 10},
    known_nodes: [
        {node_id: 'module-book-9', node_kind: 'module', name: 'Book', ready: false},
        {node_id: 'scene-cellar', node_kind: 'scene', name: 'Cellar', summary: 'A dark cellar.', properties: {}, visibility: 'keeper-only', source_refs: page3, ready: true},
        ...known],
    known_claims: [], vocabulary});

const CORBITT = 0, DAGGER = 1, CONCLUSION = 2, RIDDLE = 3, FOLKLORE = 4, RATS = 5;
const node = (node_id, node_kind, name, properties = {}) => ({node_id, node_kind, name, summary: `${name}.`, source_refs: page4, properties});
const claim = (subject_id, predicate, object) => ({subject_id, predicate, object: {node_id: object}, truth_status: 'authored-fact', source_refs: page4});
/** A person with a learnable weakness and a book-only one, the means, the route and its clue, a creature and a false lead about it. */
function stated() {
    return {nodes: [
        node('npc-walter-corbitt', 'npc', 'Walter Corbitt', {weaknesses: [
            {book: 'Struck with his own ritual dagger, his wards fail and he turns to ash and dust.', needs: ['artifact-ritual-dagger'], learned_by: 'conclusion-own-dagger-ends-him'},
            {book: 'Sunlight hurts him and may destroy him, as the Keeper decides.'}]}),
        node('artifact-ritual-dagger', 'artifact', 'Ritual dagger'),
        node('conclusion-own-dagger-ends-him', 'conclusion', 'His own dagger ends him'),
        node('clue-bible-riddle', 'clue', 'Bible riddle'),
        node('clue-silver-folklore', 'clue', 'Silver folklore'),
        node('creature-rat-pack', 'creature', 'Rat Pack'),
    ], claims: [
        claim('clue-bible-riddle', 'supports', 'conclusion-own-dagger-ends-him'),
        claim('clue-silver-folklore', 'misleads', 'creature-rat-pack'),
        claim('npc-walter-corbitt', 'present-in', 'scene-cellar'),
        claim('creature-rat-pack', 'present-in', 'scene-cellar'),
    ], node_refs: ['scene-cellar'], coverage: {}, critical: [], dependencies: [], ready_nodes: ['npc-walter-corbitt', 'creature-rat-pack']};
}
const weaknesses = draft => draft.nodes[CORBITT].properties.weaknesses;

/** The draft check's refusal as {reason, rule, path, error}, or null when it passed. */
function refusal(draft, packet = packetWith(BOUND)) {
    try {
        api.checkDraft(parsed(draft), structuredClone(packet), contract, SEEN);
        return null;
    } catch (error) {
        assert.equal(error.code, 'invalid_params', error.message);
        assert.ok(error.fix, 'every refusal carries a literal fix');
        return {reason: error.details?.reason, rule: error.details?.rule, path: error.details?.path, error};
    }
}
const refusedAs = (draft, rule, path, packet) => {
    const got = refusal(draft, packet);
    assert.ok(got, `expected ${rule} at ${path}, the draft passed`);
    assert.deepEqual([got.reason, got.rule, got.path], [rule === 'one_being_two_nodes' ? rule : 'reading_failed', rule, path], got.error.message);
    return got.error;
};

test('new tasks always carry the source weakness law, even when a consumer switch is false', () => {
    const graph = contract.graph;
    assert.deepEqual(Object.keys(graph.creature_dossier).sort(), ['law', 'profile_keys', 'profile_labels', 'why']);
    assert.deepEqual(graph.creature_dossier.profile_keys, [], 'a creature has no core keys (§180.8)');
    assert.deepEqual(graph.creature_dossier.profile_labels, {});
    for (const spine of [graph.actor_dossier, graph.creature_dossier])
        assert.match(spine.why, /per node and per encounter[^.]*never per species/, 'the §180.2 boundary rides in both dossiers');
    assert.deepEqual(UNBOUND.creature_dossier, graph.creature_dossier);
    assert.deepEqual(UNBOUND.relation_endpoints, graph.relation_endpoints);
    assert.equal(UNBOUND.actor_weaknesses, undefined, 'the historical packet fixture remains unbound');
    assert.deepEqual(api.vocabulary(contract, {actor_weaknesses: false}).actor_weaknesses, graph.actor_weaknesses);
    assert.deepEqual(BOUND.actor_weaknesses, graph.actor_weaknesses);
    assert.equal(BOUND.actor_weaknesses.capability, 'actor.weaknesses.v1');
    // A package's creature word arrives with its ask, beside the empty core list, as an actor word does (§28.3, §180.8).
    const habits = {key: 'habits', label: 'habits', ask: 'how this creature lives and acts as the book states'};
    const asked = api.vocabulary(contract, {creature_profile_keys: [habits], actor_profile_keys: []});
    assert.deepEqual(asked.creature_dossier.contributed, [habits]);
    assert.deepEqual(asked.creature_dossier.profile_keys, []);
    assert.equal(asked.actor_dossier.contributed, undefined, 'a creature word is not asked of persons');
});

test("the reader's instructions carry the boundary, the creature ask, the bound weakness entry and the false leads", () => {
    for (const words of ['per node and per encounter', 'never from its species', 'task.vocabulary.creature_dossier', 'task.vocabulary.actor_weaknesses',
        '`properties.weaknesses`', 'never a keeper_note', '`learned_by`', 'supported by the clues that teach it', '`misleads`', '`contradicts`',
        'One being is one node'])
        assert.ok(prompt.includes(words), words);
    const read = prompt.slice(prompt.indexOf('## Read phase'), prompt.indexOf('## Verify phase')), verify = prompt.slice(prompt.indexOf('## Verify phase'));
    assert.ok(read.includes('task.vocabulary.actor_weaknesses') && read.includes('task.vocabulary.creature_dossier'), 'the asks ride in the read phase');
    assert.match(verify, /each stated weakness with its means and its route/, 'the coverage review counts weaknesses and their routes');
});

test('one being, one node: an npc and a creature sharing a normalized name or handle are refused with the §180.2 repair', () => {
    const twin = stated();
    twin.nodes.push(node('npc-rat-pack', 'npc', 'rat  pack'));
    const error = refusedAs(twin, 'one_being_two_nodes', `/nodes/${RATS}`, packetWith(UNBOUND));
    assert.deepEqual(error.details.pairs.map(pair => [pair.npc, pair.creature, pair.shared, pair.published ?? null]), [['npc-rat-pack', 'creature-rat-pack', 'rat pack', null]]);
    assert.match(error.fix, /keep the single node whose kind contract 180\.2 decides/);
    assert.match(error.fix, /delete the other node and its claims from the draft/);

    // The handle alone: different names, one handle.
    const handles = stated();
    handles.nodes.push(node('npc-rat-pack', 'npc', 'The swarm in the walls'));
    assert.equal(refusedAs(handles, 'one_being_two_nodes', `/nodes/${RATS}`, packetWith(UNBOUND)).details.pairs[0].shared, 'rat pack');

    // A drafted creature beside a published person is refused at the draft's node, naming the published one.
    const beside = stated();
    const published = refusedAs(beside, 'one_being_two_nodes', `/nodes/${RATS}`,
        packetWith(UNBOUND, [{...node('npc-the-rats', 'npc', 'Rat Pack'), visibility: 'keeper-only', ready: true}]));
    assert.equal(published.details.pairs[0].published, 'npc-the-rats');
    assert.match(published.fix, /keep the published node/);

    // Not refused: a pair only the published graph carries (a compile snapshot, §180.7), two persons of one name,
    // and an npc and a creature whose names and handles differ.
    assert.equal(refusal(stated(), packetWith(UNBOUND, [
        {...node('npc-old-rats', 'npc', 'Old rats'), ready: true}, {...node('creature-old-rats', 'creature', 'Old rats'), ready: true}])), null);
    const persons = stated();
    persons.nodes.push(node('npc-guard-one', 'npc', 'Guard'), node('npc-guard-two', 'npc', 'Guard'));
    assert.equal(refusal(persons, packetWith(UNBOUND)), null);
    assert.equal(refusal(stated(), packetWith(UNBOUND)), null);
});

test('a bound build holds every weaknesses entry to the contract: book stated, needs and learned_by resolved to their kinds', () => {
    assert.equal(refusal(stated()), null, 'the worked entries pass');
    const W = `/nodes/${CORBITT}/properties/weaknesses`;
    const cases = [
        ['no book', d => { delete weaknesses(d)[0].book; }, 'shape_unresolved', `${W}/0/book`],
        ['a blank book', d => { weaknesses(d)[1].book = '  '; }, 'shape_unresolved', `${W}/1/book`],
        ['a need that names nothing', d => { weaknesses(d)[0].needs = ['artifact-ritual-dagger', 'artifact-silver-knife']; }, 'shape_unresolved', `${W}/0/needs/1`],
        ['a need of a kind outside the list', d => { weaknesses(d)[0].needs = ['clue-bible-riddle']; }, 'shape_unresolved', `${W}/0/needs/0`],
        ['needs that are not a list', d => { weaknesses(d)[0].needs = 'artifact-ritual-dagger'; }, 'shape_unresolved', `${W}/0/needs`],
        ['a route that is a clue', d => { weaknesses(d)[0].learned_by = 'clue-bible-riddle'; }, 'shape_unresolved', `${W}/0/learned_by`],
        ['a route that names nothing', d => { weaknesses(d)[0].learned_by = 'conclusion-silver-works'; }, 'shape_unresolved', `${W}/0/learned_by`],
        ['a key the entry does not have', d => { weaknesses(d)[1].how = 'by day'; }, 'shape_unknown_key', `${W}/1/how`],
        ['prose in place of entries', d => { d.nodes[CORBITT].properties.weaknesses = 'his own dagger'; }, 'shape_prose', W],
        ['a creature is held to it too', d => { d.nodes[RATS].properties.weaknesses = [{book: 'Fire drives them off.', needs: ['object-torch']}]; },
            'shape_unresolved', `/nodes/${RATS}/properties/weaknesses/0/needs/0`],
    ];
    for (const [name, change, rule, path] of cases) {
        const draft = stated();
        change(draft);
        const error = refusedAs(draft, rule, path);
        assert.match(error.fix, /never write an entry, a means or a route the book does not give/, name);
        // The gate is the task's bound shape: the same draft under an unbound task passes.
        assert.equal(refusal(draft, packetWith(UNBOUND)), null, `${name}: an unbound build checks no weaknesses`);
    }
    // A need may name a node the published graph defines, of any listed kind.
    const known = stated();
    weaknesses(known)[0].needs = ['artifact-ritual-dagger', 'scene-cellar'];
    assert.equal(refusal(known), null);
    // An entry the published graph already carries is not the draft's to repair.
    const old = {...node('npc-old-ghost', 'npc', 'Old ghost', {weaknesses: [{needs: ['artifact-lost-ring']}]}), ready: true};
    assert.equal(refusal(stated(), packetWith(BOUND, [old])), null);
});

test('misleads runs only from a clue to an npc or creature', () => {
    const toPerson = stated();
    toPerson.claims[1] = claim('clue-silver-folklore', 'misleads', 'npc-walter-corbitt');
    assert.equal(refusal(toPerson, packetWith(UNBOUND)), null);
    const fromScene = stated();
    fromScene.claims.push(claim('scene-cellar', 'misleads', 'npc-walter-corbitt'));
    const error = refusedAs(fromScene, 'relation_endpoints', '/claims/4', packetWith(UNBOUND));
    assert.match(error.fix, /contradicts from that clue to the weakness's conclusion/);
    const toPlace = stated();
    toPlace.claims[1] = claim('clue-silver-folklore', 'misleads', 'scene-cellar');
    refusedAs(toPlace, 'relation_endpoints', '/claims/1', packetWith(UNBOUND));
    // Other relations keep their endpoints free.
    const supports = stated();
    supports.claims.push(claim('clue-silver-folklore', 'contradicts', 'conclusion-own-dagger-ends-him'));
    assert.equal(refusal(supports, packetWith(UNBOUND)), null);
});

test('the offline coc-read-check reads the gate from the packet on disk', async () => {
    const draft = stated();
    delete weaknesses(draft)[0].book;
    await writeFile(join(scratch, 'draft.json'), JSON.stringify(draft));
    await writeFile(join(scratch, 'bound.json'), api.pythonJsonDumps(packetWith(BOUND)));
    await writeFile(join(scratch, 'unbound.json'), api.pythonJsonDumps(packetWith(UNBOUND)));
    const bound = await api.checkSourceDraft(content, join(scratch, 'bound.json'), join(scratch, 'draft.json'));
    assert.equal(bound.ok, false);
    assert.deepEqual([bound.error.details.rule, bound.error.details.path], ['shape_unresolved', `/nodes/${CORBITT}/properties/weaknesses/0/book`]);
    assert.ok(bound.error.fix);
    assert.equal((await api.checkSourceDraft(content, join(scratch, 'unbound.json'), join(scratch, 'draft.json'))).ok, true);
});

/** A two-page PDF the kernel can bind. */
function pdf() {
    const streams = ['0 0 1 rg 0 0 100 100 re f', '0 0.6 0 rg 0 0 200 100 re f'];
    const pages = streams.map((stream, index) => ({page: 3 + index * 2, content: 4 + index * 2, stream}));
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map(row => `${row.page} 0 R`).join(' ')}] /Count ${streams.length} >>`,
        ...pages.flatMap(row => [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Contents ${row.content} 0 R >>`,
            `<< /Length ${row.stream.length} >>\nstream\n${row.stream}\nendstream`])];
    let text = '%PDF-1.7\n';
    const offsets = [0];
    for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
    const xref = Buffer.byteLength(text), size = objects.length + 1;
    text += `xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return text;
}

test('the real reading path: the opening task carries creature_dossier, and module.read.finish refuses a twin and a bound malformed weakness', async () => {
    const workspace = playtestScratch('creature-reader', 'kernel-');
    const context = await api.createKernelContext({workspace, content, seed: 'creature-reader', locks: api.nativeAdvisoryLocks(),
        env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context);
    closers.push(() => runtime.close());
    const wire = value => value === undefined ? value : JSON.parse(api.pythonJsonDumps(value));
    const kernel = async (method, params = {}) => {
        try { return wire(await runtime.handlers[method](params)); }
        catch (error) { throw typeof error?.toJson === 'function' ? Object.assign(new Error(error.message), wire(error.toJson())) : error; }
    };
    const file = join(workspace, 'original.pdf');
    await writeFile(file, pdf());
    const sha = createHash('sha256').update(await readFile(file)).digest('hex');
    const {module_id: mid} = await kernel('module.source.bind', {source: {path: file, page_count: 2, file_sha256: sha}});
    const call = (method, params = {}) => kernel(method, {module_id: mid, ...params});
    const claimJob = () => call('module.read.claim', {owner: 'test-host'});
    const REFS = [{page: 1}];
    const publish = async (job, draft) => {
        await writeFile(join(job.work_dir, 'observations.json'), JSON.stringify({file_sha256: sha, read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2]}));
        await writeFile(join(job.work_dir, 'draft.json'), JSON.stringify(draft));
        const checked = job.purpose === 'index' ? [] : (await api.checkSourceDraft(content, join(job.work_dir, 'packet.json'), join(job.work_dir, 'draft.json'))).required_review ?? [];
        await writeFile(join(job.work_dir, 'review.json'), JSON.stringify({checked: checked.length ? [{paths: checked, verdict: 'supported', source_refs: REFS, reason: 'fixture support'}] : [], missing: []}));
        return call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
    };
    await call('module.read.request', {purpose: 'index'});
    await publish(await claimJob(), {title: 'The Cellar', language: 'en', sections: [{name: 'House', pages: [[1, 2]], entities: ['Hall', 'Cellar']}], map_candidates: []});
    await call('module.read.request', {purpose: 'opening'});
    const job = await claimJob();
    const packetPath = join(job.work_dir, 'packet.json'), packet = JSON.parse(await readFile(packetPath, 'utf8'));
    // The shipped Hostile Creatures package (§180.11, on by default) contributes `habits` and binds actor.weaknesses.v1.
    const habits = JSON.parse(await readFile(join(root, 'mods', 'hostile-creatures', 'mod.json'), 'utf8')).contributes.vocabulary.creature_profile_keys;
    assert.deepEqual(packet.vocabulary.creature_dossier, {...contract.graph.creature_dossier, contributed: habits}, 'the reader is handed the creature words');
    assert.deepEqual(packet.vocabulary.relation_endpoints, contract.graph.relation_endpoints);
    assert.deepEqual(packet.vocabulary.actor_weaknesses, contract.graph.actor_weaknesses, 'the build bound actor.weaknesses.v1');

    const opening = (extraNodes, extraClaims = [], ready = []) => ({nodes: [
        {node_id: 'scene-hall', node_kind: 'scene', name: 'Hall', source_refs: REFS, properties: {is_entrance: true}},
        {node_id: 'scene-cellar', node_kind: 'scene', name: 'Cellar', source_refs: [{page: 2}], summary: 'A cellar under the house.', properties: {is_final: true}},
        ...extraNodes,
    ], claims: [{subject_id: 'scene-hall', predicate: 'route-to', object: {node_id: 'scene-cellar'}, truth_status: 'authored-fact', source_refs: REFS}, ...extraClaims],
    node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-hall', ...ready]});
    const rats = {node_id: 'creature-rat-pack', node_kind: 'creature', name: 'Rat Pack', source_refs: REFS, summary: 'A swarm of rats.', properties: {}};
    const ratsAtHall = {subject_id: 'creature-rat-pack', predicate: 'present-in', object: {node_id: 'scene-hall'}, truth_status: 'authored-fact', source_refs: REFS};
    const person = (properties = {}) => ({node_id: 'npc-rat-pack', node_kind: 'npc', name: 'Rat Pack', source_refs: REFS, summary: 'The rats as a person.', properties});

    await assert.rejects(publish(job, opening([rats, person()], [ratsAtHall])), error => {
        assert.equal(error.code, 'invalid_params', error.message);
        assert.equal(error.details.reason, 'one_being_two_nodes');
        assert.equal(error.details.path, '/nodes/2');
        return true;
    });
    // The gate is the packet the kernel re-reads: bound, an entry without its book line is refused at publication.
    await writeFile(packetPath, JSON.stringify({...packet, vocabulary: {...packet.vocabulary, actor_weaknesses: contract.graph.actor_weaknesses}}));
    const keeper = {...person({weaknesses: [{needs: ['creature-rat-pack']}]}), node_id: 'npc-old-keeper', name: 'Old keeper'};
    await assert.rejects(publish(job, opening([rats, keeper], [ratsAtHall])), error => {
        assert.equal(error.details.rule, 'shape_unresolved', error.message);
        assert.equal(error.details.path, '/nodes/3/properties/weaknesses/0/book');
        return true;
    });
    await writeFile(packetPath, JSON.stringify(packet));
    const lore = {node_id: 'clue-rat-lore', node_kind: 'clue', name: 'Rat lore', source_refs: REFS, summary: 'Folk say the rats fear bells.', properties: {}};
    const result = await publish(job, opening([rats, lore], [ratsAtHall,
        {subject_id: 'clue-rat-lore', predicate: 'misleads', object: {node_id: 'creature-rat-pack'}, truth_status: 'authored-fact', source_refs: REFS}], ['creature-rat-pack']));
    assert.equal(result.opening_ready, true);
});
