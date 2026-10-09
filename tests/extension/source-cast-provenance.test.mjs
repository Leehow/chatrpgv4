/** §177.8: printed-name navigation survives author/reviewer projection; original-page proof stays mandatory. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {readerBook} from './name-free-book.mjs';
import {playtestScratch} from './playtest-scratch.mjs';
import {detailReviewInput, checkReviewEvidence, reviewUnitIdentity} from '../../extensions/module/reader-review.ts';

const root = resolve(import.meta.dirname, '../..');
const temporary = playtestScratch('source-cast-provenance');
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {checkCastDraft} from './kernel-ts/cast/draft.ts';`, resolveDir: root},
  outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

test('a real detail claim retains the cast writer\'s physical source pages', async t => {
  const book = await readerBook(api, {root, temporary, t, seed: 'cast-page-provenance'});
  await book.raw('module.read.request', {module_id: book.mid, purpose: 'detail', focus: 'Tower', question: 'Prepare the keeper.'});
  const packet = await book.raw('module.read.claim', {module_id: book.mid, owner: 'regression-host'});
  assert.deepEqual(packet.cast_names.find(person => person.book.includes('Old Mae')),
    {book: ['Old Mae'], play: ['Old Mae'], pages: [1]});
  assert.ok(packet.cast_names.every(person => person.pages.length), 'accepted cast page anchors must reach the author');
});

const cast = [
  {book: ['Ada North', 'Ada'], play: ['Ada North', 'Ada'], pages: [1, 2]},
  {book: ['Eli South'], play: ['Eli South'], pages: [9]},
];
const draft = {nodes: [{node_id: 'npc-ada', node_kind: 'npc', name: 'Ada North', aliases: ['Ada'],
  source_refs: [{page: 1}, {page: 2}], properties: {}}], claims: [], ready_nodes: ['npc-ada'], coverage: {}};
const task = {purpose: 'detail', source: {page_count: 10}, cast_names: cast, review_scope_pages: [2]};

test('focused name review retains relevant page navigation without expanding coverage', () => {
  const input = detailReviewInput(task, draft, ['/nodes/0/name', '/nodes/0/aliases']);
  assert.deepEqual(input.task.cast_names, [cast[0]]);
  const coverage = detailReviewInput(task, draft, ['/coverage']);
  assert.deepEqual(coverage.task.review_scope_pages, [2]);
  assert.deepEqual(coverage.task.cast_names, [cast[0]], 'an unrelated name must not expand the reviewer packet');
  assert.deepEqual(task.cast_names, cast);
});

test('cast navigation cannot stand in for independently viewed original pages', () => {
  const paths = ['/nodes/0/name', '/nodes/0/aliases'];
  const review = {checked: [{paths, verdict: 'supported', source_refs: [{page: 1}, {page: 2}]}], missing: []};
  assert.throws(() => checkReviewEvidence(review, paths, new Set([2]), [1, 2], draft), /page not supplied/);
  assert.doesNotThrow(() => checkReviewEvidence(review, paths, new Set([1, 2]), [1, 2], draft));
  const native = new Map([[1, 'Ada North keeps the lighthouse.'], [2, 'Ada trims the lamp.']]);
  const row = {book: ['Ada North', 'Ada'], play: ['Ada North', 'Ada'], notes: ['Ada North', 'Ada'], pages: [1, 2]};
  assert.equal(api.checkCastDraft({people: [row]}, native, 2).refused.length, 0);
  assert.equal(api.checkCastDraft({people: [{...row, book: ['Ada North', 'Invented Alias']}]}, native, 2).refused.length, 1);
});

test('name provenance changes invalidate only connected fact review identities', () => {
  const base = {source: 'a'.repeat(64), model: {id: 'fixture/vision'}};
  const key = value => reviewUnitIdentity(base, value, draft, ['/nodes/0/name']).identity;
  assert.notEqual(key(task), key({...task, cast_names: [{...cast[0], pages: [1, 2, 3]}, cast[1]]}));
  assert.equal(key(task), key({...task, cast_names: [cast[0], {...cast[1], pages: [8, 9]}]}));
  const legacy = detailReviewInput({...task, cast_names: [{book: ['Ada North'], play: ['Ada North']}]}, draft, ['/nodes/0/name']);
  assert.deepEqual(legacy.task.cast_names[0].pages, [], 'missing old page anchors must never be invented');
});
