/** §207: original-book card intake; fixture records exercise publication/load gates, never gameplay. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';
import {browseInvestigators} from '../../extensions/onboarding/pregens.ts';
import {gateRefusal, reviewUnits} from '../../extensions/module/reader-review.ts';
import {sheetReviewPaths} from '../../kernel-ts/modules/sheet-review.ts';
import {claimSupportIneligibility} from '../../kernel-ts/modules/claim-support.ts';

const root = resolve(import.meta.dirname, '../..'), content = join(root, 'content');
const scratch = playtestScratch('book-pregens', 'suite-');
await build({stdin: {contents: [
  "export {createKernelContext} from './kernel-ts/context.ts';",
  "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
  "export {createKernelRuntime} from './kernel-ts/registry.ts';",
  "export {ModuleStore} from './kernel-ts/modules/store.ts';",
  "export {loadModuleContract} from './kernel-ts/modules/contract.ts';",
  "export {checkSheets,checkPregensScope} from './kernel-ts/modules/pregens.ts';",
  "export {checkDraft,checkReview} from './kernel-ts/modules/visual.ts';",
  "export {pythonJsonDumps} from './kernel-ts/json.ts';",
].join('\n'), resolveDir: root, sourcefile: 'book-pregens-api.ts'}, outfile: join(scratch, 'api.mjs'),
  bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(scratch, 'api.mjs')).href), closers = [];
after(async () => {for (const close of closers.reverse()) await close();});
const printed = {name: 'Printed Reader', occupation: 'Researcher', age: 31, era: '1920s',
  characteristics: {STR: 90, CON: 70, SIZ: 40, DEX: 60, INT: 80, POW: 50, EDU: 90, LUCK: 50},
  derived: {HP: 9, SAN: 45, MP: 6, MOV: 7, BUILD: 1, DB: '0'},
  skills: {'Library Use': 97}, weapons: [{name: 'Printed knife', skill: 'Fighting (Brawl)', damage: '1D4', impale: true, uses_per_round_unstated: true}],
  backstory: {history: 'Only the printed history.'}};
const template = {node_id: 'investigator-template-printed-reader', node_kind: 'investigator-template', name: printed.name,
  source_refs: [{page: 38}, {pdf_index: 38}], properties: {sheet: printed}};
async function fixture(name) {
  const workspace = await mkdtemp(join(scratch, name));
  const context = await api.createKernelContext({workspace, content, seed: name, locks: api.nativeAdvisoryLocks(),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context), store = new api.ModuleStore(context);
  closers.push(() => runtime.close());
  const call = async (method, params={}) => JSON.parse(api.pythonJsonDumps(await runtime.handlers[method](params)));
  return {workspace, context, store, call};
}
async function bookFixture(name) {
  const f = await fixture(name);
  await f.call('campaign.create', {id: 'seed', module: 'the-haunting', play_language: 'en'});
  const graph = JSON.parse(await readFile(await f.store.graphPath('the-haunting'), 'utf8'));
  graph.module_id = 'pregen-book'; graph.nodes.push(template);
  const meta = {...await f.store.module('the-haunting'), id: 'pregen-book', source: 'pdf', reading_version: 1,
    reading: {materials: []}, generation: 0};
  delete meta.graph_file; delete meta.graph_digest;
  await f.store.writeModule(await f.store.writeGraph(meta, graph));
  await f.call('campaign.create', {id: 'book-table', module: 'pregen-book', play_language: 'en'});
  return f;
}

test('a starter is offered during setup; its printed sheet is loaded without a library row or recalculation', async () => {
  const f = await fixture('starter-');
  await f.call('campaign.create', {id: 'starter-table', module: 'the-haunting', play_language: 'en'});
  const listing = await f.call('investigator.list', {campaign: 'starter-table'});
  assert.equal(listing.investigators.length, 0);
  assert.equal(listing.pregens.length, 2);
  const chosen = listing.pregens[0]; assert.equal(chosen.source, 'starter');
  const original = JSON.parse(await readFile(join(content, 'starters/the-haunting/pregens', chosen.pregen, 'character.json'), 'utf8'));
  const loaded = await f.call('investigator.load', {campaign: 'starter-table', pregen: chosen.pregen, as: 'New Name'});
  assert.deepEqual(loaded.sheet.characteristics, original.characteristics);
  assert.deepEqual(loaded.sheet.derived, original.derived);
  assert.equal(loaded.sheet.name, 'New Name');
  assert.deepEqual(loaded.sheet.origin, {pregen: chosen.pregen, module_id: 'the-haunting'});
  assert.equal((await f.call('investigator.list')).investigators.length, 0);
  const steps = await f.call('setup.steps', {campaign: 'starter-table'});
  assert(steps.completed.includes('load-investigator'));
  assert(!steps.completed.includes('confirm-investigator'));
  const complete = await f.call('setup.complete', {campaign: 'starter-table'});
  assert.equal(complete.status, 'ready_for_table');
});

test('book templates expose page provenance and load the deliberately non-derived printed values', async () => {
  const f = await bookFixture('book-');
  const listed = await f.call('investigator.list', {campaign: 'book-table'});
  assert.equal(listed.pregens_read, 'unread');
  assert.deepEqual(listed.pregens, [{pregen: template.node_id, name: printed.name, occupation: printed.occupation,
    age: 31, era: '1920s', source: 'book', pages: [38, 39]}]);
  const loaded = await f.call('investigator.load', {campaign: 'book-table', pregen: template.node_id});
  assert.deepEqual(loaded.sheet.derived, printed.derived);
  assert.equal(loaded.sheet.current_hp, 9); assert.equal(loaded.sheet.current_san, 45);
  assert.equal(loaded.sheet.current_mp, 6); assert.equal(loaded.sheet.current_luck, 50);
  assert.equal(loaded.sheet.weapons[0].weapon_id, 'pregen-printed-knife');
  assert.equal(loaded.sheet.weapons[0].impales, true); assert.equal(loaded.sheet.weapons[0].impale, undefined);
  assert.equal(loaded.sheet.origin.library_id, undefined);
  assert.equal(loaded.sheet.characteristics.APP, undefined, 'an unprinted characteristic stays absent');
  const meta = JSON.parse(await readFile(join(f.workspace, '.coc/campaigns/book-table/campaign.json'), 'utf8'));
  assert.equal(meta.setup.receipts.at(-1).source, 'pregen');
  await assert.rejects(f.call('investigator.load', {campaign: 'book-table', pregen: 'missing'}), error =>
    error.code === 'unknown_entity' && error.details.candidates.includes(template.node_id));
  await assert.rejects(f.call('investigator.load', {campaign: 'book-table', pregen: template.node_id, library_id: 'another'}), /exactly one/);
  for (const state of ['queued', 'running', 'failed']) {
    await f.store.writeQueue('pregen-book', [{material: 'pregens', state}]);
    assert.equal((await f.call('investigator.list', {campaign: 'book-table'})).pregens_read, state === 'failed' ? 'failed' : 'reading');
  }
  const sourceMeta = await f.store.module('pregen-book');
  sourceMeta.reading.materials = [{material: 'pregens', node_ids: []}]; await f.store.writeModule(sourceMeta);
  assert.equal((await f.call('investigator.list', {campaign: 'book-table'})).pregens_read, 'read', 'a settled empty read is still an answer');
});

test('each printed numeric leaf stays strict under module-logic review and never enters native-text Jev support', async () => {
  const f = await fixture('shape-'), contract = await api.loadModuleContract(f.context);
  api.checkSheets([template], contract);
  api.checkSheets([{...template, properties: {sheet: {name: 'Only words'}}}], contract);
  assert.throws(() => api.checkSheets([{...template, node_kind: 'npc'}], contract), /sheet belongs/);
  assert.throws(() => api.checkPregensScope({nodes: [template], ready_nodes: [], claims: []}), /ready_nodes/);
  api.checkPregensScope({nodes: [], ready_nodes: [], claims: []});
  const draft = {nodes: [template]}, task = {review_policy: 'module-logic-v1'};
  const paths = sheetReviewPaths(template, '/nodes/0');
  assert(paths.includes('/nodes/0/characteristics/LUCK') === false);
  assert(paths.includes('/nodes/0/properties/sheet/characteristics/LUCK'));
  assert(paths.includes('/nodes/0/properties/sheet/weapons/0/damage'));
  const units = reviewUnits(draft, paths, undefined, true);
  assert.deepEqual(new Set(units.flat()), new Set(['/nodes/0', ...paths]), 'the reviewer does not fold numeric leaves into one record');
  const refuses = gateRefusal(task, draft);
  for (const path of paths) assert.equal(refuses({verdict: 'unsupported', impact: 'presentation'}, path), true, path);
  assert.equal(claimSupportIneligibility(draft, '/nodes/0', () => true, () => false), 'sheet');
});

test('browse rereads after foreground completion or timeout; failed service calls stay visible', async () => {
  const requests = [];
  let status = 'unread';
  const call = async (method, params) => {requests.push({method, params});return {investigators: [], pregens: [], pregens_read: status};};
  const params = {campaign: 'c'};
  const first = await browseInvestigators(call, params, 'book', {pregens: async (moduleId, passed) => {
    assert.equal(moduleId, 'book'); assert.deepEqual(passed, params); status = 'read'; return {};}});
  assert.equal(first.pregens_read, 'read'); assert.equal(requests.length, 2);
  status = 'unread';
  const pending = await browseInvestigators(call, params, 'book', {pregens: async () => {status = 'reading'; throw {code: 'reading_timeout'};}});
  assert.equal(pending.pregens_read, 'reading');
  await browseInvestigators(call, params, 'book', {pregens: async () => assert.fail('a running read must not be requested again')});
  status = 'unread';
  await assert.rejects(browseInvestigators(call, params, 'book', {pregens: async () => {throw Error('broken source');}}), /broken source/);
});


test('the actual draft/publication checker owes every numeric pointer; a record-only review cannot clear it', async () => {
  const f = await fixture('publication-'), contract = await api.loadModuleContract(f.context);
  const packet = {module_id: 'pregen-book', purpose: 'detail', material: 'pregens', review_policy: 'module-logic-v1',
    source: {page_count: 42}, known_nodes: [], known_claims: [], field_spans: {}};
  const seen = new Set([38, 39]);
  const node = {...template, source_refs: [{page: 38}, {page: 39}]};
  const draft = {nodes: [node], claims: [], node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: [node.node_id]};
  const checked = api.checkDraft(draft, packet, contract, seen);
  const paths = sheetReviewPaths(node, '/nodes/0');
  for (const path of paths) assert(checked.required_review.includes(path), path);
  assert.throws(() => api.checkReview(draft, checked, {checked: [{paths: ['/nodes/0'], verdict: 'supported', source_refs: [{page: 38}]}], missing: []}, 42, seen), /review/);
  const review = {checked: [{paths: checked.required_review, verdict: 'supported', source_refs: [{page: 38}], reason: 'Controlled fixture support'}], missing: []};
  api.checkReview(draft, checked, review, 42, seen);
  const wrong = {checked: [...review.checked, {path: '/nodes/0/properties/sheet/derived/HP', verdict: 'unsupported',
    impact: 'presentation', source_refs: [{page: 38}], reason: 'The page prints another number.'}], missing: []};
  assert.throws(() => api.checkReview(draft, checked, wrong, 42, seen), /review/);
  const empty = {...draft, nodes: [], ready_nodes: []};
  const absent = api.checkDraft(empty, packet, contract, seen);
  assert(absent.required_review.includes('/coverage'), 'empty inventory must be independently checked');
  assert.deepEqual(reviewUnits(empty, absent.required_review, undefined, true), [['/coverage']]);
  assert.throws(() => api.checkReview(empty, absent, {checked: [], missing: []}, 42, seen), /review/);
  const absenceReview = {checked: [{path: '/coverage', verdict: 'unsupported', impact: 'presentation', source_refs: [{page: 38}], reason: 'A printed pregen is omitted.'}], missing: []};
  assert.throws(() => api.checkReview(empty, absent, absenceReview, 42, seen), /review/);
  assert.equal(gateRefusal(packet, empty)(absenceReview.checked[0], '/coverage'), true);
  api.checkReview(empty, absent, {checked: [{...absenceReview.checked[0], verdict: 'supported', reason: 'Controlled no-pregen book fixture.'}], missing: []}, 42, seen);
  assert.throws(() => api.checkDraft(draft, packet, contract, new Set([39])), /viewed/);
});
