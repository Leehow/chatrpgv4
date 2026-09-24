/**
 * Contract §14.16 (SL-28): a built-in starter that names a window of a book reads it through the same
 * store an imported PDF module has. Real kernel runtime, the real host PDF.js owner and the shared host
 * registration; the only books are the one the Haunting ships and a fixture PDF this suite writes.
 * No model calls: reading jobs are queued and claimed, never run.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {after, before, test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
const CONTENT = join(ROOT, 'content');
const sha = value => createHash('sha256').update(value).digest('hex');
let api, bundle;
before(async () => {
  await mkdir(join(ROOT, '.tmp'), {recursive: true});
  bundle = await mkdtemp(join(ROOT, '.tmp/starter-source-binding-test-'));
  await build({stdin: {contents: [
    "export {createKernelContext} from './kernel-ts/context.ts';",
    "export {createKernelRuntime} from './kernel-ts/registry.ts';",
    "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
    "export {preparePrescreenSources} from './runtime/jev/prescreen-source-provider.ts';",
    "export {sourceInfo,sourceSearch,sourceText,sourceWindow,closeSourceDocuments} from './extensions/module/source.ts';",
    "export {registerSourcePdf} from './extensions/module/source-registration.ts';",
  ].join('\n'), resolveDir: ROOT, sourcefile: 'starter-source-binding-entry.ts'}, outfile: join(bundle, 'api.mjs'),
  bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
  api = await import(pathToFileURL(join(bundle, 'api.mjs')).href);
});
after(async () => { await api?.closeSourceDocuments(); if (bundle) await rm(bundle, {recursive: true, force: true}); });

const stream = text => `BT /F1 12 Tf 20 160 Td (${text}) Tj ET`;
function textPdf(texts) {
  const streams = texts.map(stream);
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${streams.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${streams.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (const [i, value] of streams.entries()) objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    `<< /Length ${Buffer.byteLength(value)} >>\nstream\n${value}\nendstream`);
  let text = '%PDF-1.7\n'; const offsets = [0];
  for (const [i, value] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${value}\nendobj\n`; }
  const xref = Buffer.byteLength(text), size = objects.length + 1;
  return Buffer.from(text + `xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map(value => String(value).padStart(10, '0') + ' 00000 n ').join('\n')}\n`
    + `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
const BOOK_PAGES = ['Front matter.', 'Rules chapter.', 'The teahouse opens at dusk.', 'Rain on the dock boards.', 'The ledger is hidden under the counter.', 'Index.'];
const SOURCE_ID = 'pdf:window-book-fixture';

async function kernel(t, content = CONTENT) {
  const home = await mkdtemp(join(tmpdir(), 'starter-source-binding-'));
  const context = await api.createKernelContext({workspace: home, content, seed: 'starter-source-binding', locks: api.nativeAdvisoryLocks(),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context), call = (method, params = {}) => runtime.handlers[method](params);
  const refusal = async (method, params) => { try { await call(method, params); } catch (error) { return error; } assert.fail(`${method} was not refused`); };
  t.after(async () => { await runtime.close(); await context.git.close(); await rm(home, {recursive: true, force: true}); });
  return {home, call, refusal, modules: join(home, '.coc/modules')};
}
const meta = async (f, id) => JSON.parse(await readFile(join(f.modules, id, 'module.json'), 'utf8'));
const hostRuntime = {sourceInfo: ({pdf}) => api.sourceInfo(pdf), sourceWindow: ({pdf, ...options}) => api.sourceWindow(pdf, options)};

/** A content root whose starters are the shipped ones plus `window-book`: the voice-bench graph, one scene citing the fixture book. */
async function fixtureContent(t, {builtIn = false, declare = {}} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'starter-source-content-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const entry of await readdir(CONTENT)) if (entry !== 'starters') await symlink(join(CONTENT, entry), join(root, entry));
  await mkdir(join(root, 'starters'));
  for (const entry of await readdir(join(CONTENT, 'starters'))) await symlink(join(CONTENT, 'starters', entry), join(root, 'starters', entry));
  const folder = join(root, 'starters/window-book'), bookPath = join(root, 'book.pdf'), book = textPdf(BOOK_PAGES);
  await mkdir(folder); await writeFile(bookPath, book);
  await cp(join(CONTENT, 'starters/voice-bench/pregens'), join(folder, 'pregens'), {recursive: true});
  const graph = JSON.parse(await readFile(join(CONTENT, 'starters/voice-bench/module-graph.json'), 'utf8'));
  graph.module_id = 'module-window-book';
  graph.nodes.find(node => node.node_id === 'scene-sanyi-teahouse').source_refs = [{source_id: SOURCE_ID, pdf_index: 2}, {source_id: SOURCE_ID, pdf_index: 3}];
  // A reference to another source, and one to this book outside the window, index nothing.
  graph.nodes.find(node => node.node_id === 'scene-haihe-dock').source_refs = [{source_id: 'pdf:another-book', pdf_index: 3}, {source_id: SOURCE_ID, pdf_index: 5}];
  await writeFile(join(folder, 'module-graph.json'), JSON.stringify(graph, null, 2));
  const declaration = {contract_id: 'coc.starter-source-binding.v1', schema_version: 1, source_id: SOURCE_ID,
    book: {file_sha256: sha(book), pages: [2, 4]}, ...declare};
  if (builtIn) {
    const extract = await api.sourceWindow(bookPath, {first_page: 3, last_page: 5, out: join(folder, 'source.pdf')});
    declaration.built_in = {path: 'source.pdf', file_sha256: extract.file_sha256, page_count: 3};
  }
  await writeFile(join(folder, 'source-binding.json'), JSON.stringify(declaration));
  return {root, folder, bookPath, book, graph};
}

test('the shipped Haunting is bound to its built-in window through the imported-module store', async t => {
  const f = await kernel(t), declaration = JSON.parse(await readFile(join(CONTENT, 'starters/the-haunting/source-binding.json'), 'utf8'));
  const shipped = await readFile(join(CONTENT, 'starters/the-haunting', declaration.built_in.path));
  assert.equal(sha(shipped), declaration.built_in.file_sha256, 'the package ships the window its declaration names');
  await f.call('module.register', {module_id: 'the-haunting'});
  const bound = await meta(f, 'the-haunting');
  assert.equal(bound.source, 'starter', 'still a starter: catalogue, opening and guidance are its graph');
  assert.equal(bound.file_sha256, undefined, 'no book identity at the top level: the guidance fingerprint keys on it');
  assert.ok(Object.keys(bound.character_guidance ?? {}).length, 'bundled guidance still registers');
  assert.equal(bound.reading_version, 1);
  assert.deepEqual(bound.source_document, {path: 'source.pdf', file_sha256: declaration.built_in.file_sha256, page_count: 17,
    window: {source_id: 'pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting', file_sha256: declaration.book.file_sha256, pages: [446, 462]}});
  assert.equal(sha(await readFile(join(f.modules, 'the-haunting/source.pdf'))), declaration.built_in.file_sha256);
  assert.equal(bound.reading.index_complete, true);
  const legacy = bound.reading.materials.find(material => !material.focus);
  assert.equal(legacy.verification, 'legacy');
  const graph = JSON.parse(await readFile(join(CONTENT, 'starters/the-haunting/module-graph.json'), 'utf8'));
  assert.deepEqual(legacy.node_ids, graph.nodes.map(node => node.node_id), 'the authored graph is ready material');
  const index = JSON.parse(await readFile(join(f.modules, 'the-haunting', bound.index_file), 'utf8'));
  assert.deepEqual(index[0], {name: "Knott's Office", pages: [[0, 0]], topics: [], entities: [], references: [], state: 'indexed'},
    'the index is the authored scenes at the window pages their own references cite');

  const snapshot = await f.call('module.source.snapshot', {module_id: 'the-haunting'});
  assert.equal(snapshot.page_count, 17);
  assert.deepEqual(snapshot.window.pages, [446, 462]);
  const info = await api.sourceInfo(snapshot.pdf);
  assert.equal(info.page_count, 17);
  assert.equal(info.labels[0], '435', "the book's printed page numbers survive extraction");
  assert.equal((await f.call('module.status', {module_id: 'the-haunting'})).source, 'starter');

  // The reading lane takes the question: queued, and a reader would be handed the window.
  const asked = await f.call('module.read.request', {module_id: 'the-haunting', purpose: 'answer', focus: 'Steven Knott',
    question: 'What does Steven Knott offer the investigators?', foreground: true});
  assert.equal(asked.state, 'queued');
  const job = await f.call('module.read.claim', {module_id: 'the-haunting', owner: 'test'});
  assert.equal(job.job_id, asked.job_id);
  assert.equal(job.source.page_count, 17);
  assert.equal(sha(await readFile(job.source.path)), declaration.built_in.file_sha256);

  // Registration again is a replay: no second copy, nothing set aside.
  const before = await meta(f, 'the-haunting');
  await f.call('module.register', {module_id: 'the-haunting'});
  assert.deepEqual((await meta(f, 'the-haunting')).source_document, before.source_document);
  assert.deepEqual((await readdir(join(f.modules, 'the-haunting'))).filter(name => name.startsWith('source-')), []);
});

test("the prescreen reads the Haunting's window, and its authored references choose native pages", async t => {
  const f = await kernel(t);
  await f.call('module.register', {module_id: 'the-haunting'});
  const snapshot = await f.call('module.source.materials.snapshot', {campaign: 'c1', module_id: 'the-haunting', answer_limit: 8});
  assert.deepEqual(snapshot.window.pages, [446, 462]);
  const source = {home: f.home, sourceInfo: ({pdf}) => api.sourceInfo(pdf),
    sourceSearch: ({pdf, ...options}, signal) => api.sourceSearch(pdf, options, signal),
    sourceText: ({pdf, ...options}, signal) => api.sourceText(pdf, options, signal)};
  const prepare = capsule => api.preparePrescreenSources({call: f.call, campaign: 'c1', moduleId: 'the-haunting',
    scope: {owner: 'campaign:c1', campaign: 'c1', worldline: 'main', loop: 0, audience: 'keeper'}, query: 'qqzzxx', capsule, source,
    signal: new AbortController().signal, budget: {deadlineAt: Date.now() + 30_000, candidateBytes: 64_000, materialBytes: 16_000, maxNativePages: 2}, snapshot});
  // Book index 450 is window page 5 (446 is page 1).
  const cited = await prepare({where: {source_refs: [{source_id: 'pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting', pdf_index: 450}]}});
  assert.ok(cited.coverage.native.materialized_pages.includes(5), JSON.stringify(cited.coverage.native));
  const label = cited.candidates.find(candidate => candidate.authority === 'native_text' && candidate.data.page === 5)?.label;
  assert.equal(label, 'Original PDF page 5 (439)');
  const uncited = await prepare({});
  assert.ok(!uncited.coverage.native.materialized_pages.includes(5), 'without the authored reference page 5 is not chosen');
});

test('a starter without a declaration still has no document to read', async t => {
  const f = await kernel(t);
  await f.call('module.register', {module_id: 'voice-bench'});
  const error = await f.refusal('module.read.request', {module_id: 'voice-bench', purpose: 'answer', focus: 'teahouse', question: 'Who owns it?'});
  assert.equal(error.code, 'needs');
  assert.equal(error.details.reason, 'no_source_document');
  assert.equal(error.details.source_declared, undefined);
  assert.equal((await meta(f, 'voice-bench')).source_document, undefined);
});

test('a starter naming a registered book: refused until registration, which binds its window and never the whole book', async t => {
  const content = await fixtureContent(t), f = await kernel(t, content.root);
  await f.call('module.register', {module_id: 'window-book'});
  const unbound = await f.refusal('module.read.request', {module_id: 'window-book', purpose: 'answer', focus: 'teahouse', question: 'When does it open?'});
  assert.equal(unbound.details.reason, 'no_source_document');
  assert.deepEqual(unbound.details.source_declared, {source_id: SOURCE_ID, pdf_index: [2, 4], built_in: false});
  assert.match(unbound.message, /not bound on this installation/);
  assert.match(unbound.fix, /lookup kind=module/);

  const whole = await f.refusal('module.source.bind', {source: {path: content.bookPath, file_sha256: sha(content.book), page_count: 6}});
  assert.equal(whole.code, 'needs');
  assert.equal(whole.details.reason, 'source_window_required');
  assert.deepEqual(whole.details.windows, [{module_id: 'window-book', source_id: SOURCE_ID, file_sha256: sha(content.book), pages: [2, 4], physical_pages: [3, 5]}]);
  assert.deepEqual((await readdir(f.modules)).filter(name => name.startsWith('book-')), [], 'the book never becomes a module of its own');

  const registered = await api.registerSourcePdf({runtime: hostRuntime, call: f.call, pdf: content.bookPath, cache: f.home});
  assert.equal(registered.module_id, 'window-book');
  assert.equal(registered.replayed, false);
  assert.deepEqual(registered.starters, ['window-book']);
  const bound = await meta(f, 'window-book');
  assert.equal(bound.source, 'starter');
  assert.equal(bound.source_document.page_count, 3);
  assert.deepEqual(bound.source_document.window, {source_id: SOURCE_ID, file_sha256: sha(content.book), pages: [2, 4]});
  const text = await api.sourceText(join(f.modules, 'window-book/source.pdf'), {pages: [1, 2, 3]});
  assert.deepEqual(text.snapshots.map(snapshot => snapshot.text.trim()), BOOK_PAGES.slice(2, 5), 'exactly the declared pages, in order');
  const index = JSON.parse(await readFile(join(f.modules, 'window-book', bound.index_file), 'utf8'));
  assert.deepEqual(index.map(row => [row.name, row.pages]), [['sanyi-teahouse', [[0, 1]]]]);
  assert.equal((await f.call('module.read.request', {module_id: 'window-book', purpose: 'answer', focus: 'teahouse', question: 'When does it open?'})).state, 'queued');

  // Registering the same book again is a replay and does not replace the bound window.
  const bytes = await readFile(join(f.modules, 'window-book/source.pdf'));
  const again = await api.registerSourcePdf({runtime: hostRuntime, call: f.call, pdf: content.bookPath, cache: f.home});
  assert.deepEqual([again.module_id, again.replayed, again.starters], ['window-book', true, ['window-book']]);
  assert.equal(sha(await readFile(join(f.modules, 'window-book/source.pdf'))), sha(bytes));
});

test('a window bind is checked against the declaration', async t => {
  const content = await fixtureContent(t), f = await kernel(t, content.root), out = join(f.home, 'extract.pdf');
  const extract = await api.sourceWindow(content.bookPath, {first_page: 3, last_page: 5, out});
  const source = {path: out, file_sha256: extract.file_sha256, page_count: extract.page_count};
  const wrongPages = await f.refusal('module.source.bind', {source, window: {module_id: 'window-book', file_sha256: sha(content.book), pages: [1, 4]}});
  assert.equal(wrongPages.code, 'invalid_params');
  assert.equal(wrongPages.details.reason, 'source_window_mismatch');
  const wrongBook = await f.refusal('module.source.bind', {source, window: {module_id: 'window-book', file_sha256: sha('another book'), pages: [2, 4]}});
  assert.equal(wrongBook.details.reason, 'source_window_mismatch');
  const short = await api.sourceWindow(content.bookPath, {first_page: 3, last_page: 4, out: join(f.home, 'short.pdf')});
  const count = await f.refusal('module.source.bind', {source: {path: short.path, file_sha256: short.file_sha256, page_count: 2},
    window: {module_id: 'window-book', file_sha256: sha(content.book), pages: [2, 4]}});
  assert.equal(count.code, 'invalid_params');
  assert.equal((await meta(f, 'window-book')).source_document, undefined, 'a refused bind writes nothing');
});

test('a registered window survives a new graph generation; a campaign fork carries it', async t => {
  const content = await fixtureContent(t), f = await kernel(t, content.root);
  await api.registerSourcePdf({runtime: hostRuntime, call: f.call, pdf: content.bookPath, cache: f.home});
  const first = await meta(f, 'window-book');
  const graph = structuredClone(content.graph);
  graph.nodes.find(node => node.node_id === 'scene-haihe-dock').summary = 'The dock, rewritten in a later edition of the starter.';
  await writeFile(join(content.folder, 'module-graph.json'), JSON.stringify(graph, null, 2));
  await f.call('module.register', {module_id: 'window-book'});
  const next = await meta(f, 'window-book');
  assert.equal(next.generation, first.generation + 1);
  assert.deepEqual(next.source_document, first.source_document, 'the registered window is carried to the new generation');
  assert.equal(next.reading.materials[0].generation, next.generation, 'with a reading state for the new generation');

  await f.call('module.read.request', {campaign: 'forked', module_id: 'window-book', purpose: 'answer', focus: 'dock', question: 'What is on the boards?'});
  const forked = join(f.home, '.coc/module-campaigns/forked/modules/window-book');
  assert.equal(sha(await readFile(join(forked, 'source.pdf'))), first.source_document.file_sha256);
  assert.deepEqual(JSON.parse(await readFile(join(forked, 'module.json'), 'utf8')).source_document, first.source_document);
});

test('a built-in window: bound at registration, refused when its bytes differ, and said so when the package lost it', async t => {
  const content = await fixtureContent(t, {builtIn: true}), f = await kernel(t, content.root);
  const declaration = JSON.parse(await readFile(join(content.folder, 'source-binding.json'), 'utf8'));
  await f.call('module.register', {module_id: 'window-book'});
  assert.equal((await meta(f, 'window-book')).source_document.file_sha256, declaration.built_in.file_sha256);
  // Registering the book itself needs nothing: the window ships with the starter.
  const registered = await api.registerSourcePdf({runtime: hostRuntime, call: f.call, pdf: content.bookPath, cache: f.home});
  assert.deepEqual([registered.module_id, registered.replayed, registered.starters], ['window-book', true, ['window-book']]);

  const broken = await fixtureContent(t, {builtIn: true}), g = await kernel(t, broken.root);
  const wrong = JSON.parse(await readFile(join(broken.folder, 'source-binding.json'), 'utf8'));
  wrong.built_in.file_sha256 = sha('not the shipped window');
  await writeFile(join(broken.folder, 'source-binding.json'), JSON.stringify(wrong));
  const refused = await g.refusal('module.register', {module_id: 'window-book'});
  assert.equal(refused.code, 'invalid_params');
  assert.match(refused.message, /built_in\.file_sha256/);

  const lost = await fixtureContent(t, {builtIn: true}), h = await kernel(t, lost.root);
  await rm(join(lost.folder, 'source.pdf'));
  await h.call('module.register', {module_id: 'window-book'});
  assert.equal((await meta(h, 'window-book')).source_document, undefined);
  const said = await h.refusal('module.read.request', {module_id: 'window-book', purpose: 'answer', focus: 'teahouse', question: 'When does it open?'});
  assert.deepEqual([said.details.reason, said.details.source_declared?.built_in], ['no_source_document', true]);
});
