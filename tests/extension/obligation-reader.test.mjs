/**
 * Contract §134.16: the visual reader writes stated obligations, and the draft check refuses a malformed one.
 *
 * Every case travels a real entry: `checkDraft` (what publication runs, with the host's viewed pages) fed
 * the contract `loadModuleContract` loads from the shipped content root, or `checkSourceDraft` (the
 * offline `coc-read-check` the reader runs) over files on disk. Nothing normalises a draft before the
 * check: each case is the draft a reader would write, as JSON text.
 *
 * Refusals are asserted by their stable `rule` and their JSON pointer, never their wording.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {reviewUnits} from '../../extensions/module/reader-review.ts';

const root = resolve(import.meta.dirname, '../..'), content = join(root, 'content');
// The bundle sits inside the repository so its bare imports resolve against the repository's packages.
await mkdir(join(root, '.coc'), {recursive: true});
const bundleDir = await mkdtemp(join(root, '.coc', 'obligation-reader-'));
after(() => rm(bundleDir, {recursive: true, force: true}));
await build({stdin: {contents:
    `export {checkDraft, checkReview} from './kernel-ts/modules/visual.ts';` +
    `export {loadModuleContract} from './kernel-ts/modules/contract.ts';` +
    `export {checkSourceDraft} from './kernel-ts/check.ts';` +
    `export {snapshots} from './kernel-ts/snapshots.ts';` +
    `export {parsePythonJson, pythonJsonDumps} from './kernel-ts/json.ts';`,
    resolveDir: root, sourcefile: 'obligation-reader-api.ts', loader: 'ts'},
    outfile: join(bundleDir, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(bundleDir, 'api.mjs')).href);
const contract = await api.loadModuleContract({content, snapshots: api.snapshots});
/** A draft exactly as the reader's file would parse. */
const parsed = draft => api.parsePythonJson(JSON.stringify(draft));

const page3 = [{page: 3}], page4 = [{page: 4}];
/** A detail read of a place the opening already prepared: the scene, its editor and his presence are known. */
const packet = {module_id: 'book-1', purpose: 'detail', focus: 'Newsroom', question: '', source: {page_count: 10},
    known_nodes: [
        {node_id: 'module-book-1', node_kind: 'module', name: 'Book', ready: false},
        {node_id: 'scene-newsroom', node_kind: 'scene', name: 'Newsroom', summary: "The paper's newsroom.", properties: {}, visibility: 'keeper-only', source_refs: page3, ready: true},
        {node_id: 'npc-editor', node_kind: 'npc', name: 'The Editor', summary: 'The city editor.', properties: {}, visibility: 'keeper-only', source_refs: page3, ready: true}],
    known_claims: [{claim_id: 'claim-npc-editor-present-in-scene-newsroom', subject_id: 'npc-editor', predicate: 'present-in', object: {node_id: 'scene-newsroom'},
        truth_status: 'authored-fact', visibility: 'keeper-only', source_refs: [{source_id: 'pdf:book-1', pdf_index: 2}], known_by_ids: [], asserted_by_ids: [], validity: null}]};
const REQ = 2, BASE = `/nodes/${REQ}/properties/obligation`;
/** The demand the page states, written in the §134.1 shape, with its rule node and its three claims. */
function stated() {
    return {nodes: [
        {node_id: 'clue-old-report', node_kind: 'clue', name: 'Old report', summary: 'The paper ran a report on the house.', visibility: 'revealable', source_refs: page4, properties: {}},
        {node_id: 'rule-newsroom-access', node_kind: 'rule', name: 'Newsroom access', summary: 'The editor refuses the files unless persuaded.', source_refs: page4, properties: {}},
        {node_id: 'requirement-newsroom-files', node_kind: 'requirement', name: 'Access to the files', summary: 'The editor must be won over first.', source_refs: page4,
            properties: {obligation: {
                scene: 'scene-newsroom', trigger: {kind: 'attempt', guards: {clues: ['clue-old-report']}}, who: 'npc-editor',
                demand: [{kind: 'meet', npc: 'npc-editor'},
                    {kind: 'check', scope: 'actor-target', target: 'npc-editor', selection: 'approach',
                        values: [{path: 'skills.Persuade', label: 'Persuade'}, {path: 'skills.Credit Rating', label: 'Credit Rating', minimum: 60}],
                        difficulty: 'regular',
                        results: {critical: {settles: true}, extreme: {settles: true}, hard: {settles: true}, regular: {settles: true},
                            failure: {settles: false, book: 'He refuses.'}, fumble: {settles: false, book: 'He has them thrown out.'}},
                        push: {allowed: true, book: 'A failed push bars them from the building.'}}],
                settles: {kind: 'flag_set', flag_id: 'newsroom-files-access'}}}},
    ], claims: [
        {subject_id: 'clue-old-report', predicate: 'discoverable-at', object: {node_id: 'scene-newsroom'}, truth_status: 'authored-fact', source_refs: page4},
        {subject_id: 'scene-newsroom', predicate: 'has-requirement', object: {node_id: 'requirement-newsroom-files'}, truth_status: 'authored-fact', source_refs: page4},
        {subject_id: 'requirement-newsroom-files', predicate: 'calls-for-check', object: {node_id: 'rule-newsroom-access'}, truth_status: 'authored-fact', source_refs: page4},
    ], node_refs: ['scene-newsroom', 'npc-editor'], coverage: {}, critical: [], dependencies: [],
        ready_nodes: ['clue-old-report', 'rule-newsroom-access', 'requirement-newsroom-files']};
}
const obligationOf = draft => draft.nodes[REQ].properties.obligation;
const SEEN = new Set([3, 4]);

/** The draft check's refusal as {rule, path, rules, error}, or null when it passed. */
function refusal(draft, packetValue = packet, seen = SEEN) {
    try {
        api.checkDraft(parsed(draft), structuredClone(packetValue), contract, seen);
        return null;
    } catch (error) {
        assert.equal(error.code, 'invalid_params', error.message);
        assert.equal(error.details?.reason, 'reading_failed', error.message);
        return {rule: error.details.rule, path: error.details.path, rules: (error.details.refusals ?? []).map(r => `${r.rule} ${r.path}`), error};
    }
}

test('a stated obligation passes the draft check and every field is required for review', () => {
    const draft = stated(), filled = api.checkDraft(parsed(draft), structuredClone(packet), contract, SEEN);
    const fields = ['scene', 'trigger', 'who', 'demand/0/npc', 'demand/1/scope', 'demand/1/target', 'demand/1/selection', 'demand/1/values',
        'demand/1/difficulty', 'demand/1/results', 'demand/1/push', 'settles'].map(field => `${BASE}/${field}`);
    for (const path of [...fields, `${BASE}/demand/1/values/1/minimum`])
        assert.ok(filled.required_review.includes(path), `${path} is not required for review`);
    // Every field is required although critical lists none of them.
    assert.deepEqual(draft.critical, []);
    // The reviewer units assign exactly what the publication gate will demand.
    const assigned = reviewUnits(draft).flat();
    for (const path of filled.required_review) assert.ok(assigned.includes(path), `no reviewer unit is assigned ${path}`);
    // A review that supports everything but one obligation field does not publish.
    const all = {checked: [{paths: filled.required_review, verdict: 'supported', source_refs: page4}], missing: []};
    api.checkReview(parsed(draft), filled, all, 10, SEEN);
    const short = {checked: [{paths: filled.required_review.filter(path => path !== `${BASE}/demand/1/difficulty`), verdict: 'supported', source_refs: page4}], missing: []};
    assert.throws(() => api.checkReview(parsed(draft), filled, short, 10, SEEN), /visual review omitted required fields/);
});

test('an obligation the reader listed whole in critical still has each field required', () => {
    const draft = stated();
    draft.critical = [BASE];
    const required = api.checkDraft(parsed(draft), structuredClone(packet), contract, SEEN).required_review;
    assert.ok(required.includes(BASE));
    assert.ok(required.includes(`${BASE}/demand/1/results`));
});

test('an unstated difficulty and unstated approaches are accepted and reviewed as statements', () => {
    const draft = stated(), check = obligationOf(draft).demand[1];
    delete check.difficulty; check.difficulty_unstated = true;
    delete check.values; delete check.selection; check.approaches_unstated = true;
    const required = api.checkDraft(parsed(draft), structuredClone(packet), contract, SEEN).required_review;
    assert.ok(required.includes(`${BASE}/demand/1/difficulty_unstated`));
    assert.ok(required.includes(`${BASE}/demand/1/approaches_unstated`));
    assert.ok(!required.some(path => path.includes('/minimum')));
});

test('an obligation without source_refs is refused at its path', () => {
    const draft = stated();
    delete draft.nodes[REQ].source_refs;
    const refused = refusal(draft);
    assert.ok(refused, 'the draft passed');
    assert.equal(refused.rule, 'obligation_unsourced');
    assert.equal(refused.path, `/nodes/${REQ}/source_refs`);
});

test('an obligation citing a page this reader did not view is refused at the reference', () => {
    const draft = stated();
    draft.nodes[REQ].source_refs = [{page: 4}, {page: 7}];
    const refused = refusal(draft);
    assert.ok(refused, 'the draft passed');
    assert.equal(refused.rule, 'obligation_unviewed_page');
    assert.equal(refused.path, `/nodes/${REQ}/source_refs/1`);
});

test('a prose skill string in the values slot is refused at its path', () => {
    const draft = stated();
    obligationOf(draft).demand[1].values = 'Persuade (reason), Credit Rating (60 or more)';
    const refused = refusal(draft);
    assert.ok(refused, 'the draft passed');
    assert.equal(refused.rule, 'check_values');
    assert.equal(refused.path, `${BASE}/demand/1/values`);
});

test('a person not seated in the scene is refused at its path', () => {
    // The book never puts the editor in the newsroom: no present-in claim, known or drafted.
    const refused = refusal(stated(), {...packet, known_claims: []});
    assert.ok(refused, 'the draft passed');
    assert.equal(refused.rule, 'obligation_not_seated');
    assert.equal(refused.path, `${BASE}/who`);
    assert.ok(refused.rules.includes(`obligation_not_seated ${BASE}/demand/0/npc`), refused.rules.join(', '));
    // The same person, seated by the draft's own present-in claim, passes.
    const draft = stated();
    draft.claims.push({subject_id: 'npc-editor', predicate: 'present-in', object: {node_id: 'scene-newsroom'}, truth_status: 'authored-fact', source_refs: page4});
    assert.equal(refusal(draft, {...packet, known_claims: []}), null);
});

test("a skill the ruleset does not have is refused with the ruleset's own names", () => {
    const draft = stated();
    obligationOf(draft).demand[1].values[0] = {path: 'skills.Sweet Talk', label: 'Sweet Talk'};
    const refused = refusal(draft);
    assert.ok(refused, 'the draft passed');
    assert.equal(refused.rule, 'check_unknown_skill');
    assert.equal(refused.path, `${BASE}/demand/1/values/0/path`);
    assert.ok(refused.error.details.ruleset.skills.includes('Fast Talk'));
    assert.ok(refused.error.details.ruleset.characteristics.includes('APP'));
    assert.match(refused.error.fix, /details\.ruleset/);
});

test('the offline check the reader runs refuses the same draft at the same path', async () => {
    const dir = await mkdtemp(join(bundleDir, 'offline-'));
    const draft = stated();
    obligationOf(draft).demand[1].values = 'Persuade (reason)';
    await writeFile(join(dir, 'task.json'), JSON.stringify(packet));
    await writeFile(join(dir, 'draft.json'), JSON.stringify(draft));
    const result = await api.checkSourceDraft(content, join(dir, 'task.json'), join(dir, 'draft.json'));
    assert.equal(result.ok, false);
    assert.equal(result.error.details.rule, 'check_values');
    assert.equal(result.error.details.path, `${BASE}/demand/1/values`);
    await writeFile(join(dir, 'draft.json'), JSON.stringify(stated()));
    const passed = await api.checkSourceDraft(content, join(dir, 'task.json'), join(dir, 'draft.json'));
    assert.equal(passed.ok, true);
    assert.ok(passed.required_review.includes(`${BASE}/settles`));
});

test('a draft that states no obligation returns what the parent commit returned, byte for byte', async () => {
    const golden = JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'obligation-reader-parent.json'), 'utf8'));
    assert.ok(golden.cases.length >= 5);
    for (const item of golden.cases) {
        let result;
        if (item.op === 'offline') {
            const dir = await mkdtemp(join(bundleDir, 'golden-'));
            await writeFile(join(dir, 'task.json'), JSON.stringify(item.packet));
            await writeFile(join(dir, 'draft.json'), JSON.stringify(item.draft));
            result = api.pythonJsonDumps(await api.checkSourceDraft(content, join(dir, 'task.json'), join(dir, 'draft.json')));
        } else {
            try { result = api.pythonJsonDumps({value: api.checkDraft(parsed(item.draft), item.packet, contract, item.seen ? new Set(item.seen) : undefined)}); }
            catch (error) { if (!error.toJson) throw error; result = api.pythonJsonDumps({error: error.toJson()}); }
        }
        assert.equal(result, item.result, item.name);
    }
});
