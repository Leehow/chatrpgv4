/**
 * Contract §257: exhibits are part of the graph contract.
 *
 * Every case travels the real reading path: a kernel runtime over a bound PDF whose opening job is claimed and finished
 * through `module.read.claim` / `module.read.finish`, the accepted graph read back through `ModuleStore.graph`. Refusals
 * are asserted by their stable rule, never their wording.
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
const scratch = playtestScratch('module-exhibits');
await build({stdin: {contents: [
    `export {checkDraft} from './kernel-ts/modules/visual.ts';`,
    `export {loadModuleContract} from './kernel-ts/modules/contract.ts';`,
    `export {checkSourceDraft} from './kernel-ts/check.ts';`,
    `export {snapshots} from './kernel-ts/snapshots.ts';`,
    `export {pythonJsonDumps} from './kernel-ts/json.ts';`,
    `export {createKernelContext} from './kernel-ts/context.ts';`,
    `export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';`,
    `export {createKernelRuntime} from './kernel-ts/registry.ts';`,
    `export {ModuleStore} from './kernel-ts/modules/store.ts';`,
    `export {npcView} from './kernel-ts/read/capsule.ts';`,
    `export {decisionPerson} from './runtime/decision-content.ts';`,
    `export {ModuleGraph} from './kernel-ts/read/module-graph.ts';`,
    `export {exhibitsView} from './kernel-ts/read/exhibits.ts';`,
].join('\n'), resolveDir: root, sourcefile: 'module-exhibits-api.ts', loader: 'ts'},
    outfile: join(scratch, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(scratch, 'api.mjs')).href);
const closers = [];
after(async () => { for (const close of closers.reverse()) await close(); });

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

const REFS = [{page: 1}];
const node = (node_id, node_kind, name, extra = {}) => ({node_id, node_kind, name, source_refs: REFS, summary: `${name}.`, properties: {}, ...extra});
const claim = (subject_id, predicate, object) => ({subject_id, predicate, object: {node_id: object}, truth_status: 'authored-fact', source_refs: REFS});
const surface = (text, extra = {}) => ({text, language: 'en', verbatim: false, ...extra});
const exhibit = (exhibit_id, kind, carrier, channel, extra = {}) => ({exhibit_id, kind, carrier, channel, label: `${exhibit_id} label`,
    surface: surface('A low room with a smell of lamp oil.'), source_refs: REFS, ...extra});

/** The opening a reader would write: a hall, a cellar, two persons (one knowing a clue), a handout and a clue. */
function opening(exhibits, contract_id = 'coc.module-graph-shard.v5') {
    return {contract_id, nodes: [
        node('scene-hall', 'scene', 'Hall', {properties: {is_entrance: true}}),
        node('scene-cellar', 'scene', 'Cellar', {source_refs: [{page: 2}], properties: {is_final: true}}),
        node('npc-edna-marsh', 'npc', 'Edna Marsh', {aliases: ['Mrs Marsh']}),
        node('npc-bob-hale', 'npc', 'Bob Hale'),
        node('handout-ledger', 'handout', 'Ledger page'),
        node('clue-ledger', 'clue', 'Ledger entry'),
    ], claims: [
        claim('scene-hall', 'route-to', 'scene-cellar'),
        claim('npc-edna-marsh', 'present-in', 'scene-hall'),
        claim('npc-bob-hale', 'present-in', 'scene-hall'),
        claim('npc-edna-marsh', 'knows', 'clue-ledger'),
    ], node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-hall'], ...(exhibits ? {exhibits} : {})};
}
const GOOD = () => [
    exhibit('exhibit-hall-sight', 'description', 'scene-hall', 'sight', {surface: surface('Lamp oil and damp plaster.', {verbatim: true})}),
    exhibit('exhibit-edna-look', 'appearance', 'npc-edna-marsh', 'sight'),
    exhibit('exhibit-ledger-page', 'document', 'handout-ledger', 'text', {teaches: ['clue-ledger'], keeper_note: 'The date is the lie.'}),
    // A verbatim handout shows a name as printed: the name check applies to paraphrase only.
    exhibit('exhibit-ledger-signature', 'document', 'handout-ledger', 'text', {surface: surface('Received with thanks, Edna Marsh.', {verbatim: true})}),
    exhibit('exhibit-edna-lie', 'testimony', 'npc-edna-marsh', 'speech', {owners: ['npc-edna-marsh'], stance: 'lie', teaches: ['clue-ledger'],
        surface: surface('{{who:npc-edna-marsh}} says nobody came down here.')}),
    exhibit('exhibit-edna-voice', 'voice', 'npc-edna-marsh', 'speech', {owners: ['npc-edna-marsh']}),
];

async function kernelFixture() {
    const workspace = playtestScratch('module-exhibits', 'kernel-');
    const context = await api.createKernelContext({workspace, content, seed: 'module-exhibits', locks: api.nativeAdvisoryLocks(),
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
    const publish = async (job, draft) => {
        await writeFile(join(job.work_dir, 'observations.json'), JSON.stringify({file_sha256: sha, read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2]}));
        await writeFile(join(job.work_dir, 'draft.json'), JSON.stringify(draft));
        const checked = job.purpose === 'index' ? [] : (await api.checkSourceDraft(content, join(job.work_dir, 'packet.json'), join(job.work_dir, 'draft.json'))).required_review ?? [];
        await writeFile(join(job.work_dir, 'review.json'), JSON.stringify({checked: checked.length ? [{paths: checked, verdict: 'supported', source_refs: REFS, reason: 'fixture support'}] : [], missing: []}));
        return call('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
    };
    const claimJob = () => call('module.read.claim', {owner: 'test-host'});
    await call('module.read.request', {purpose: 'index'});
    await publish(await claimJob(), {title: 'The Cellar', language: 'en', sections: [{name: 'House', pages: [[1, 2]], entities: ['Hall', 'Cellar']}], map_candidates: []});
    await call('module.read.request', {purpose: 'opening'});
    const job = await claimJob();
    return {job, publish, graph: async () => (await new api.ModuleStore(context).graph(mid))};
}
const refusedRules = result => Object.fromEntries(result.exhibit_refusals.map(item => [item.exhibit_id, item.rules]));

test('a v5 shard with valid exhibits is accepted and its exhibits are readable from the accepted graph', async () => {
    const {job, publish, graph} = await kernelFixture();
    const result = await publish(job, opening(GOOD()));
    assert.equal(result.opening_ready, true);
    assert.equal(result.exhibit_refusals, undefined);
    const view = await graph();
    assert.deepEqual(view.exhibits.map(item => item.exhibit_id), GOOD().map(item => item.exhibit_id));
    assert.deepEqual(view.exhibitsOf('npc-edna-marsh').map(item => item.kind), ['appearance', 'testimony', 'voice']);
    const lie = view.exhibits.find(item => item.exhibit_id === 'exhibit-edna-lie');
    assert.deepEqual([lie.stance, lie.owners, lie.teaches, lie.surface.text], ['lie', ['npc-edna-marsh'], ['clue-ledger'], '{{who:npc-edna-marsh}} says nobody came down here.']);
    assert.deepEqual(lie.source_refs, [{source_id: lie.source_refs[0].source_id, pdf_index: 0}], 'pages are stored as the graph stores every source ref');
    assert.equal(view.exhibits.find(item => item.exhibit_id === 'exhibit-ledger-page').keeper_note, 'The date is the lie.');
});

test('a v4 shard without exhibits is accepted unchanged and its graph reads no exhibits', async () => {
    const {job, publish, graph} = await kernelFixture();
    const draft = opening(null, 'coc.module-graph-shard.v4');
    const result = await publish(job, draft);
    assert.equal(result.opening_ready, true);
    const view = await graph();
    assert.deepEqual(view.exhibits, []);
    assert.deepEqual(view.exhibitsOf('scene-hall'), []);
    assert.equal(Object.hasOwn(view.raw, 'exhibits'), false);
});

test('a v4 shard that carries exhibits, an unknown contract id and a non-array exhibits are refused whole', async () => {
    const {job, publish} = await kernelFixture();
    for (const [draft, rule] of [[opening(GOOD(), 'coc.module-graph-shard.v4'), 'exhibits_contract'], [opening(GOOD(), 'coc.module-graph-shard.v3'), 'contract_id'],
        [{...opening(null), exhibits: {}}, 'not_an_array']])
        await assert.rejects(publish(job, draft), error => {
            assert.equal(error.code, 'invalid_params', error.message);
            assert.equal(error.details.rule ?? error.details.findings?.[0]?.rule, rule, error.message);
            return true;
        });
});

test('each checker refusal is a named reason, the exhibit is dropped and the rest of the shard is accepted', async () => {
    const {job, publish, graph} = await kernelFixture();
    const bad = (id, kind, carrier, channel, extra) => exhibit(id, kind, carrier, channel, extra);
    const refusals = [
        ['exhibit-unknown-carrier', bad('exhibit-unknown-carrier', 'description', 'scene-nowhere', 'sight'), 'exhibit_carrier_unknown'],
        ['exhibit-unknown-owner', bad('exhibit-unknown-owner', 'voice', 'npc-edna-marsh', 'speech', {owners: ['npc-nobody']}), 'exhibit_owner_unknown'],
        ['exhibit-owner-not-person', bad('exhibit-owner-not-person', 'voice', 'npc-edna-marsh', 'speech', {owners: ['scene-hall']}), 'exhibit_owner_unknown'],
        ['exhibit-owners-on-description', bad('exhibit-owners-on-description', 'description', 'scene-hall', 'sight', {owners: ['npc-edna-marsh']}), 'exhibit_owners_wrong_kind'],
        ['exhibit-testimony-ownerless', bad('exhibit-testimony-ownerless', 'testimony', 'npc-edna-marsh', 'speech'), 'exhibit_owners_missing'],
        ['exhibit-voice-ownerless', bad('exhibit-voice-ownerless', 'voice', 'npc-edna-marsh', 'speech', {owners: []}), 'exhibit_owners_missing'],
        ['exhibit-bob-unlinked', bad('exhibit-bob-unlinked', 'testimony', 'npc-bob-hale', 'speech', {owners: ['npc-bob-hale'], teaches: ['clue-ledger']}), 'exhibit_owner_unlinked'],
        ['exhibit-teaches-scene', bad('exhibit-teaches-scene', 'document', 'handout-ledger', 'text', {teaches: ['scene-cellar']}), 'exhibit_teaches_target'],
        ['exhibit-teaches-unknown', bad('exhibit-teaches-unknown', 'document', 'handout-ledger', 'text', {teaches: ['clue-missing']}), 'exhibit_teaches_target'],
        ['exhibit-no-pages', bad('exhibit-no-pages', 'description', 'scene-hall', 'sight', {source_refs: []}), 'exhibit_source_refs'],
        ['exhibit-oversize', bad('exhibit-oversize', 'description', 'scene-hall', 'sight', {surface: surface('x'.repeat(5000))}), 'exhibit_surface_oversize'],
        ['exhibit-full-name', bad('exhibit-full-name', 'appearance', 'npc-edna-marsh', 'sight', {surface: surface('Edna Marsh wipes the counter.')}), 'exhibit_name_in_surface'],
        ['exhibit-alias', bad('exhibit-alias', 'appearance', 'npc-edna-marsh', 'sight', {surface: surface('Everyone calls her Mrs Marsh.')}), 'exhibit_name_in_surface'],
        ['exhibit-other-person', bad('exhibit-other-person', 'description', 'scene-hall', 'sight', {surface: surface('Bob Hale sits by the stove.')}), 'exhibit_name_in_surface'],
        ['exhibit-who-space', bad('exhibit-who-space', 'description', 'scene-hall', 'sight', {surface: surface('Beside {{ who:npc-bob-hale }} the stove.')}), 'exhibit_who_malformed'],
        ['exhibit-who-unclosed', bad('exhibit-who-unclosed', 'description', 'scene-hall', 'sight', {surface: surface('Beside {{who:npc-bob-hale} the stove.')}), 'exhibit_who_malformed'],
        ['exhibit-who-stray-close', bad('exhibit-who-stray-close', 'description', 'scene-hall', 'sight', {surface: surface('Beside the stove }} quietly.')}), 'exhibit_who_malformed'],
    ];
    const kept = [exhibit('exhibit-kept', 'description', 'scene-hall', 'sight', {surface: surface('A reference {{who:npc-bob-hale}} is not a literal name.')}),
        exhibit('exhibit-edna-ok', 'testimony', 'npc-edna-marsh', 'speech', {owners: ['npc-edna-marsh'], teaches: ['clue-ledger']})];
    const result = await publish(job, opening([...refusals.map(item => item[1]), ...kept]));
    assert.equal(result.opening_ready, true, 'the rest of the shard publishes');
    assert.deepEqual(refusedRules(result), Object.fromEntries(refusals.map(([id, , rule]) => [id, [rule]])));
    assert.ok(result.exhibit_refusals.every(item => item.path.startsWith('/exhibits/')));
    const view = await graph();
    assert.deepEqual(view.exhibits.map(item => item.exhibit_id), ['exhibit-kept', 'exhibit-edna-ok']);
    assert.ok(view.nodes.has('npc-edna-marsh'));
});

test('§257.16: a person with a voice exhibit has speech_style in the author input, without one none; only the surface travels', async () => {
    const {job, publish, graph} = await kernelFixture();
    const draft = opening(GOOD().map(item => item.exhibit_id === 'exhibit-edna-voice'
        ? {...item, label: 'KEEPER_LABEL', keeper_note: 'KEEPER_NOTE', teaches: ['clue-ledger'], surface: surface('Clipped and low; "Mind the step, {{who:npc-bob-hale}}."')} : item));
    await publish(job, draft);
    const view = await graph();
    const person = node => api.decisionPerson({...api.npcView(view, {}, view.nodes.get(node)), ref: 'npc_1', display_name: 'Someone', name_known: false}, []);
    const edna = person('npc-edna-marsh'), bob = person('npc-bob-hale');
    // §257.17: the token is resolved in the view (an untold person with no table word reads as the generic epithet).
    assert.equal(edna.speech_style, 'Clipped and low; "Mind the step, Person."');
    assert.equal(Object.hasOwn(bob, 'speech_style'), false);
    assert.ok(!/KEEPER_|clue-ledger/.test(JSON.stringify(edna)), JSON.stringify(edna));
});

test('§257.16: voice exhibits win over a derived profile expression and several surfaces are joined', () => {
    const base = {ref: 'npc_1', display_name: 'X', name_known: false, personality: {profile: {expression: 'Derived'}}};
    assert.equal(api.decisionPerson({...base, voice: ['One.', 'Two.']}, []).speech_style, 'One.\nTwo.');
    assert.equal(api.decisionPerson(base, []).speech_style, 'Derived');
});

// ---- review fixes: the exhibits read's scope and the carrier the author may be told ----
const viewGraph = () => {
    const at = (node_id, node_kind, name, extra = {}) => ({node_id, node_kind, name, aliases: [], summary: '', properties: {}, source_refs: [], ...extra});
    const nodes = [at('scene-hall', 'scene', 'Hall'), at('npc-ann', 'npc', 'Ann Bell'), at('object-diary', 'object', 'Corbitt Diaries'), at('object-lamp', 'object', 'Brass Lamp'),
        at('creature-rats', 'creature', 'Rat pack'), at('handout-letter', 'handout', 'Corbitt Letter'), at('handout-map', 'handout', 'Cellar Plan')];
    const one = (exhibit_id, carrier, extra = {}) => ({exhibit_id, kind: 'perception', channel: 'sight', carrier, label: `label ${exhibit_id}`, surface: {text: `text ${exhibit_id}`, language: 'en', verbatim: false}, ...extra});
    const exhibits = ['object-diary', 'object-lamp', 'creature-rats', 'handout-letter', 'handout-map', 'npc-ann'].map(id => one(`exhibit-${id}`, id));
    const relations = [['handout-letter', 'handout-map', 'object-diary', 'object-lamp', 'creature-rats'].map((from, i) => ({relation_id: `r${i}`, relation_kind: 'depicts', from_node_id: from, to_node_id: 'scene-hall'}))].flat();
    return new api.ModuleGraph('book-1', {nodes, relations, claims: [], exhibits}, '', {});
};
const viewOf = (graph, world) => Object.fromEntries(api.exhibitsView(graph, {active_scene: 'hall', npc_presence: {ann: 'hall'}, ...world}, graph.scene('hall')).exhibits.map(item => [item.exhibit_id.replace('exhibit-', ''), item]));

test('an investigator-held object is in scope by its exact source_object identity, never by its name', () => {
    const graph = viewGraph();
    const held = (name, source_object) => ({objects: {instances: {a: {id: 'a', name, quantity: 1, owner: {kind: 'investigator', id: 'inv'}, ...(source_object ? {source_object} : {})}}}});
    // The diary is not placed in the scene (no relation), so only the instance can put it in scope.
    const lone = new api.ModuleGraph('book-1', {...graph.raw, relations: []}, '', {});
    assert.equal(viewOf(lone, held('Corbitt Diaries'))['object-diary'], undefined, 'a name alone, even the book\'s own, holds nothing');
    assert.equal(viewOf(lone, held('Corbitt Diaries', {module_id: 'another-book', node_id: 'object-diary'}))['object-diary'], undefined, 'another source\'s identity is not this book\'s');
    const mine = viewOf(lone, held('my notes', {module_id: 'book-1', node_id: 'object-diary'}))['object-diary'];
    assert.equal(mine.scope, 'object');
    assert.equal(mine.carrier.public_label, 'my notes', 'the author hears the instance\'s own name');
});

test('the author\'s carrier is the table\'s public label only: no book name of a creature, handout or object', () => {
    const graph = viewGraph(), view = viewOf(graph, {});
    assert.equal(view['creature-rats'].carrier.display_name, 'Rat pack', 'the Keeper catalog keeps its label');
    for (const id of ['creature-rats', 'handout-letter', 'handout-map', 'object-diary', 'object-lamp'])
        assert.equal(Object.hasOwn(view[id].carrier, 'public_label'), false, `${id} has no public name yet`);
    const shown = viewOf(graph, {handouts_shown: ['letter']});
    assert.equal(shown['handout-letter'].carrier.public_label, 'Corbitt Letter', 'a shown handout has the name the table has for it');
    assert.equal(Object.hasOwn(shown['handout-map'].carrier, 'public_label'), false);
    const named = viewOf(graph, {person_epithets: {ann: {word: 'the clerk', by: 'graph'}}});
    assert.equal(named['npc-ann'].carrier.public_label, 'the clerk', 'a person is the epithet until the name is told');
    assert.equal(viewOf(graph, {person_labels: {rats: {name: 'the swarm'}}})['creature-rats'].carrier.public_label, 'the swarm', 'a creature by the name the table gave it');
});
