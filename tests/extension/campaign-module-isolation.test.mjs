import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
const MODULE = 'isolation-book', A = 'table-dock', B = 'table-tower';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const save = (path, value) => writeFile(path, JSON.stringify(value));
const refs = [{ page: 1 }];
const scene = (name, entrance = false) => ({ node_id: `scene-${name.toLowerCase()}`, node_kind: 'scene', name,
  properties: entrance ? { is_entrance: true } : {}, source_refs: refs });
const shard = (nodes, ready_nodes, claims = []) => ({ nodes, ready_nodes, claims, node_refs: [], coverage: {}, critical: [], dependencies: [] });
const route = from => ({ subject_id: `scene-${from}`, predicate: 'route-to', object: { node_id: 'scene-cellar' }, truth_status: 'authored-fact', source_refs: refs });

// A deterministic source fixture, not an agent transcript or a live-play acceptance run.
function sourcePdf() {
  const text = 'Dock and Tower are alternate entrances. Both lead to Cellar. Cellar contains a ledger. Receipt is a player-safe image.';
  const stream = `BT /F1 10 Tf 20 700 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((value, i) => { const offset = pdf.length; pdf += `${i + 1} 0 obj\n${value}\nendobj\n`; return offset; });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

// Only transport and projections live here: all source operations call production TS APIs.
const CHILD = `
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { createKernelContext, createAdvisoryLocks, createModuleRuntime, loadModule, loadCampaignModule, mapView } from './api.mjs';
const [root, workspace] = process.argv.slice(2);
const require = createRequire(root + '/package.json');
const context = await createKernelContext({ workspace, content: root + '/content', locks: createAdvisoryLocks(promisify(require('fs-ext').flock)) });
const runtime = createModuleRuntime(context);
process.on('message', async ({ id, method, params }) => {
  try {
    let result;
    if (method === 'close') { await runtime.close(); await context.git.close(); result = null; }
    else if (method.startsWith('inspect.')) {
      const loaded = method === 'inspect.module' ? await loadModule(context, params.module_id, params.campaign)
        : await loadCampaignModule(context, params.module_id, {}, params.campaign);
      if (method === 'inspect.require') { await runtime.source.requireMaterial(loaded.graph, [params.name]); result = true; }
      else if (method === 'inspect.adjacent') result = await runtime.source.queueAdjacentReading(loaded.graph, loaded.graph.scene(params.name));
      else if (method === 'inspect.map') {
        // The injected library reader is a decoy: a scoped graph must resolve its own published bytes.
        const node = loaded.graph.find(params.name), handle = loaded.graph.handle(node);
        const view = await mapView(loaded.graph, { map_knowledge: { [handle]: params.regions } }, () => ({ path: params.decoy, media_type: 'image/png' }), params.name);
        // Project to plain IPC fields; the authored numeric boxes carry PythonFloat wrappers.
        result = { handle, available: view.available, layers: view.render.layers.map(layer => ({ region: layer.region, path: layer.path, label: layer.label })) };
      }
      else if (method === 'inspect.map_gate') {
        // Interface-level pin of the adapted-view branch; the adaptation pipeline itself is elsewhere.
        loaded.graph.materialOverride = () => 'missing';
        try { await runtime.source.requireMapMaterial(loaded.graph, { name: params.name }); result = { reason: null, code: null }; }
        catch (error) { result = { code: error.code ?? null, reason: error.details?.reason ?? null }; }
      }
      else result = { meta: loaded.meta, graph: loaded.graph.raw, digest: loaded.graph.digest, path: loaded.path,
        sourceCampaign: loaded.graph.sourceCampaign, material: loaded.material(params.name),
        materialReady: await runtime.source.materialReady(params.module_id, params.name, params.campaign),
        openingReady: await runtime.source.openingReady(params.module_id, params.focus ?? '', params.campaign),
        sourcePath: await runtime.source.graphPath(params.module_id, params.campaign),
        asset: loaded.asset ? await loaded.asset('Receipt') : null };
    } else result = await runtime.handlers[method](params);
    process.send({ id, result }, () => { if (method === 'close') process.disconnect(); });
  } catch (error) { process.send({ id, error: typeof error.toJson === 'function' ? error.toJson() : { message: error.message } }); }
});
process.send({ ready: true, workspace: context.workspace, pid: process.pid });
`;

async function client(directory, workspace) {
  const child = fork(join(directory, 'client.mjs'), [ROOT, workspace], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const pending = new Map();
  let stderr = '', serial = 0;
  child.stderr.on('data', data => { stderr += data; });
  child.on('message', message => {
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(Object.assign(new Error(message.error.message), message.error));
    else item.resolve(message.result);
  });
  child.on('exit', code => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(`kernel exited ${code}: ${stderr}`)); }
    pending.clear();
  });
  const ready = await Promise.race([once(child, 'message').then(([message]) => message),
    once(child, 'exit').then(([code]) => { throw new Error(`kernel startup exited ${code}: ${stderr}`); })]);
  assert.equal(ready.ready, true);
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`kernel timeout: ${method}\n${stderr}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); child.send({ id, method, params });
  });
  return { ...ready, call, async close() {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit');
    try { await call('close'); } finally { if (child.connected) child.disconnect(); }
    await exited;
  } };
}

async function treeDigest(directory, prefix = '') {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = join(prefix, entry.name), path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await treeDigest(path, name));
    else result[name] = sha(await readFile(path));
  }
  return result;
}

const invalid = error => { assert.equal(error.code, 'invalid_params', error.message); return true; };
test('two kernel processes isolate one source module per campaign in the same home', { timeout: 90000 }, async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'coc-campaign-source-')));
  const workspace = join(directory, 'home'), clients = [];
  t.after(async () => { await Promise.all(clients.map(owner => owner.close())); await rm(directory, { recursive: true, force: true }); });
  const exports = [['context', ['createKernelContext']], ['locks', ['createAdvisoryLocks']],
    ['modules/index', ['createModuleRuntime']], ['read/campaign', ['loadModule', 'loadCampaignModule']], ['modules/visual', ['checkDraft']], ['read/maps', ['mapView']]];
  await build({ stdin: { contents: exports.map(([path, names]) => `export {${names.join(',')}} from ${JSON.stringify(join(ROOT, 'kernel-ts', path + '.ts'))};`).join('\n'),
    resolveDir: ROOT, sourcefile: 'campaign-source-api.ts', loader: 'ts' }, outfile: join(directory, 'api.mjs'),
    bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
  await writeFile(join(directory, 'client.mjs'), CHILD);
  const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
  const contract = { graph: await json(join(ROOT, 'content/modules/module-graph-contract-v3.json')), template: await json(join(ROOT, 'content/modules/module-graph-template-v1.json')) };
  const start = async () => { const owner = await client(directory, workspace); clients.push(owner); return owner; };
  let [first, second] = await Promise.all([start(), start()]);
  assert.notEqual(first.pid, second.pid);
  assert.equal(first.workspace, second.workspace);
  const call = (owner, method, campaign, params = {}) => owner.call(method, { module_id: MODULE, ...(campaign === undefined ? {} : { campaign }), ...params });
  const inspect = (owner, campaign, method = 'inspect.campaign') => call(owner, method, campaign, { name: 'Cellar', focus: 'Tower' });
  const store = campaign => campaign === undefined ? join(workspace, '.coc/modules', MODULE)
    : join(workspace, '.coc/module-campaigns', campaign, 'modules', MODULE);
  const queue = campaign => json(join(store(campaign), 'deepen-queue.json'));
  async function finish(owner, campaign, job, draft, assets = []) {
    const checked = job.purpose === 'index' ? [] : api.checkDraft(draft, job, contract, new Set([1])).required_review;
    await Promise.all([save(join(job.work_dir, 'draft.json'), draft),
      save(join(job.work_dir, 'review.json'), { checked: [{ paths: checked, verdict: 'supported', source_refs: refs }], missing: [] }),
      save(join(job.work_dir, 'observations.json'), { file_sha256: job.source.file_sha256, read_pages: [1], full_pages: [1], review_pages: [1] })]);
    return call(owner, 'module.read.finish', campaign, { job_id: job.job_id, lease: job.lease, outcome: 'completed',
      draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json'), assets });
  }
  async function claim(owner, campaign, params) {
    const requested = await call(owner, 'module.read.request', campaign, params);
    assert.equal(requested.state, 'queued');
    const job = await call(owner, 'module.read.claim', campaign);
    assert.equal(job.job_id, requested.job_id);
    return job;
  }

  const pdf = sourcePdf(), source = join(directory, 'source.pdf');
  await writeFile(source, pdf);
  await call(first, 'module.source.bind', undefined, { title: 'Isolation Book', source: { path: source, page_count: 1, file_sha256: sha(pdf) } });
  await finish(first, undefined, await claim(first, undefined, { purpose: 'index' }),
    { title: 'Isolation Book', language: 'en', sections: [{ name: 'Entrances and Cellar', entities: ['Dock', 'Tower', 'Cellar'], pages: [[1, 1]], source_refs: refs }] });
  const initial = await claim(first, undefined, { purpose: 'opening' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGk0AAAAASUVORK5CYII=', 'base64');
  const image = join(initial.work_dir, 'receipt.png'); await writeFile(image, png);
  await finish(first, undefined, initial, shard([scene('Dock', true), scene('Tower', true), scene('Cellar'),
    { node_id: 'handout-receipt', node_kind: 'handout', name: 'Receipt', visibility: 'player-safe', source_refs: refs, properties: { image_sources: refs } }],
    ['scene-dock', 'scene-tower', 'handout-receipt'], [route('dock'), route('tower')]), [{ node_id: 'handout-receipt', path: image, sha256: sha(png) }]);
  // A table's prefetch is not enqueued into the shared library on this campaign's behalf.
  assert.deepEqual(await call(first, 'inspect.adjacent', A, { name: 'Dock' }), []);
  await assert.rejects(readdir(store(A)), { code: 'ENOENT' });

  const rootJob = await claim(first, undefined, { purpose: 'detail', focus: 'Cellar' });
  await call(first, 'module.read.request', undefined, { purpose: 'detail', focus: 'Dock', question: 'Read the entrance again.' });
  const root = await inspect(first); let rootBytes = await treeDigest(store());
  assert.ok(Object.keys(root.meta.reading.completed).length > 0);
  assert.equal((await queue()).filter(job => job.state === 'running').length, 1);

  // Reads follow the shared library until a campaign's first private write forks it.
  const rootReceipt = await call(second, 'module.asset', undefined, { name: 'Receipt' });
  const before = await Promise.all([inspect(first, A), inspect(second, A, 'inspect.module'), inspect(second, B)]);
  for (const [i, campaign] of [A, A, B].entries()) {
    const live = before[i];
    assert.equal(live.digest, root.digest);
    assert.deepEqual(live.graph, root.graph);
    assert.equal(live.meta.generation, root.meta.generation);
    assert.deepEqual(live.meta.reading, root.meta.reading);
    assert.equal(live.sourceCampaign, undefined);
    assert.equal(live.path, root.path);
    assert.equal(live.sourcePath, root.path);
    const asset = await call(second, 'module.asset', campaign, { name: 'Receipt' });
    assert.equal(asset.player_visible, true);
    assert.equal(asset.asset.path, rootReceipt.asset.path);
    await assert.rejects(readdir(store(campaign)), { code: 'ENOENT' }, 'no private workspace before the first write');
  }
  assert.deepEqual(await treeDigest(store()), rootBytes);
  // A scoped claim before any private write reads the shared queue without forking, and a fork
  // that happens while that lease is open must not reroute the finish into the private queue.
  const shared = await call(first, 'module.read.request', undefined, { purpose: 'detail', focus: 'Tower', question: 'Read the other entrance.' });
  const claimedShared = await call(second, 'module.read.claim', A);
  assert.ok(claimedShared.job_id, 'a scoped claim reads the shared queue');
  assert.equal(claimedShared.purpose, 'detail');
  await call(first, 'module.read.request', A, { purpose: 'detail', focus: 'Cellar', question: 'Fork the campaign while a shared lease is open.' });
  // Job ids are ordinal inside one queue. A private queue may already contain the same id as the
  // shared job; routing by id alone sends the shared finish to the wrong Reading owner and rejects
  // its otherwise matching token. The lease is the cross-scope discriminator.
  const privateQueue = await queue(A);
  const collision = { job_id: claimedShared.job_id, key: 'private-collision', purpose: 'detail', focus: 'Private decoy', question: '', pages: [],
    foreground: false, state: 'failed', attempts: 1, at: new Date().toISOString(), lease: 'private-decoy-lease', detail: 'fixture decoy' };
  assert.ok(!privateQueue.some(job => job.job_id === claimedShared.job_id), 'fixture needs an unused private ordinal');
  privateQueue.push(collision); await save(join(store(A), 'deepen-queue.json'), privateQueue);
  await call(second, 'module.read.finish', A, { job_id: claimedShared.job_id, lease: claimedShared.lease, outcome: 'cancelled' });
  assert.equal((await queue()).find(job => job.job_id === claimedShared.job_id).state, 'cancelled');
  await save(join(store(A), 'deepen-queue.json'), (await queue(A)).filter(job => job.key !== collision.key));
  assert.equal((await inspect(second, A)).sourceCampaign, A);
  rootBytes = await treeDigest(store());

  const [dock, tower] = await Promise.all([call(first, 'module.opening.choose', A, { scene: 'Dock' }), call(second, 'module.opening.choose', B, { scene: 'Tower' })]);
  assert.equal(dock.start_scene, 'scene-dock'); assert.equal(tower.start_scene, 'scene-tower');
  assert.equal(dock.generation, root.meta.generation + 1); assert.equal(tower.generation, dock.generation);
  // The fork copied the published generation without any of the library's in-flight work.
  for (const campaign of [A, B]) {
    assert.ok(await readFile(join(store(campaign), 'module.json')));
    const copied = await treeDigest(store(campaign));
    assert.ok(!Object.keys(copied).some(path => /(?:packet|observations|draft|review)\.json$/.test(path)));
    for (const name of [root.meta.graph_file, root.meta.source_document.path, root.meta.index_file])
      assert.equal(sha(await readFile(join(store(campaign), name))), sha(await readFile(join(store(), name))));
  }
  const privateReceipt = await call(second, 'module.asset', A, { name: 'Receipt' });
  assert.ok(privateReceipt.asset.path.startsWith(store(A) + '/'));
  assert.equal(sha(await readFile(privateReceipt.asset.path)), sha(png));
  assert.deepEqual(await treeDigest(store()), rootBytes);
  const chosenA = await inspect(first, A), chosenB = await inspect(second, B);
  assert.equal(chosenA.meta.opening_choice.start_scene, 'scene-dock');
  assert.equal(chosenB.meta.opening_choice.start_scene, 'scene-tower');
  assert.notEqual(chosenA.digest, chosenB.digest);
  assert.equal(chosenA.openingReady, true); assert.equal(chosenB.openingReady, true);
  for (const [campaign, expected] of [[undefined, false], [A, true], [B, true]])
    assert.equal((await call(second, 'module.status', campaign)).opening_ready, expected);
  await assert.rejects(call(first, 'inspect.require', A, { name: 'Cellar' }), error => error.details?.reason === 'material_pending');
  assert.equal((await call(first, 'inspect.adjacent', A, { name: 'Dock' })).length, 1);
  assert.deepEqual(await queue(B), []);
  const attempts = await Promise.all([call(first, 'module.read.claim', A), call(second, 'module.read.claim', A)]);
  const winner = attempts.findIndex(job => job.job_id !== null), jobA = attempts[winner], ownerA = [first, second][winner];
  assert.equal(attempts.filter(job => job.job_id !== null).length, 1, 'same scoped job has exactly one native lease owner');
  const jobB = await claim(second, B, { purpose: 'detail', focus: 'Cellar' });
  assert.equal(jobA.job_id, jobB.job_id);
  assert.notEqual(jobA.lease, jobB.lease);
  const beforeB = await treeDigest(store(B));
  // A private lease never authorizes another campaign's job; a shared job keeps its own home.
  await assert.rejects(call(second, 'module.read.finish', B, { job_id: jobA.job_id, lease: jobA.lease, outcome: 'cancelled' }), invalid);
  const privateA = await treeDigest(store(A));
  assert.equal((await call(first, 'module.read.finish', A, { job_id: rootJob.job_id, lease: rootJob.lease, outcome: 'cancelled' })).state, 'cancelled');
  assert.equal((await queue()).find(job => job.job_id === rootJob.job_id).state, 'cancelled');
  assert.deepEqual(await treeDigest(store(A)), privateA);
  rootBytes = await treeDigest(store());
  const plate = join(jobA.work_dir, 'plate.png'); await writeFile(plate, png);
  const mapDraft = shard([{ ...scene('Cellar'), summary: 'Cellar contains a ledger.' },
    { node_id: 'asset-plate', node_kind: 'asset', name: 'Atlas Plate', visibility: 'player-safe', source_refs: refs, properties: { image_sources: refs } },
    { node_id: 'handout-atlas', node_kind: 'handout', name: 'Atlas', visibility: 'player-safe', source_refs: refs,
      properties: { map_regions: [{ region_id: 'dock', name: 'Dock', source_asset: 'asset-plate', source_box: [0, 0, 1, 1], placement: [0, 0, 1, 1] }] } }],
    ['scene-cellar', 'asset-plate', 'handout-atlas']);
  const result = await finish(ownerA, A, jobA, mapDraft, [{ node_id: 'asset-plate', path: plate, sha256: sha(png) }]);
  assert.equal(result.generation, dock.generation + 1);
  assert.deepEqual(await treeDigest(store(B)), beforeB);
  assert.deepEqual(await treeDigest(store()), rootBytes);
  const published = await inspect(first, A), untouched = await inspect(second, B);
  assert.equal(published.material, 'ready'); assert.equal(published.materialReady, true);
  assert.equal(untouched.material, 'missing'); assert.equal(untouched.materialReady, false);
  // Map layers resolve the campaign's own published bytes: a same-named library asset is never
  // substituted, and an adapted (pinned) view reports fixed-source semantics instead of library rows.
  const mapped = await call(first, 'inspect.map', A, { name: 'handout-atlas', regions: ['dock'], decoy: rootReceipt.asset.path });
  assert.equal(mapped.handle, 'atlas');
  assert.equal(mapped.available, true);
  assert.equal(mapped.layers.length, 1);
  assert.notEqual(mapped.layers[0].path, rootReceipt.asset.path);
  assert.ok(mapped.layers[0].path.startsWith(store(A) + '/'));
  assert.equal(sha(await readFile(mapped.layers[0].path)), sha(png));
  const gate = await call(second, 'inspect.map_gate', B, { name: 'Atlas' });
  assert.equal(gate.code, 'needs'); assert.equal(gate.reason, 'adaptation_material_missing');
  assert.deepEqual(await treeDigest(store()), rootBytes);
  assert.equal(await call(first, 'inspect.require', A, { name: 'Cellar' }), true);
  await assert.rejects(call(second, 'inspect.require', B, { name: 'Cellar' }), error => error.details?.reason === 'material_pending');
  assert.deepEqual((await inspect(second, A, 'inspect.module')).meta, published.meta, 'repeated seed must not reset a private publication');
  await assert.rejects(call(ownerA, 'module.read.finish', A, { job_id: jobA.job_id, lease: jobB.lease, outcome: 'completed' }), invalid);
  assert.equal((await call(ownerA, 'module.read.finish', A, { job_id: jobA.job_id, lease: jobA.lease, outcome: 'completed' })).replayed, true);
  assert.equal((await call(second, 'module.read.finish', B, { job_id: jobB.job_id, lease: jobB.lease, outcome: 'cancelled' })).state, 'cancelled');

  const privateBytes = await treeDigest(store(A)), otherBytes = await treeDigest(store(B));
  await Promise.all([first.close(), second.close()]);
  [first, second] = await Promise.all([start(), start()]);
  const [coldA, coldB, coldRoot] = await Promise.all([inspect(first, A), inspect(second, B), inspect(second)]);
  assert.deepEqual(coldA, published); assert.deepEqual(coldB, untouched); assert.deepEqual(coldRoot, root);
  await assert.rejects(call(first, 'module.read.finish', A, { job_id: jobA.job_id, lease: jobB.lease, outcome: 'completed' }), invalid);
  assert.equal((await call(first, 'module.read.finish', A, { job_id: jobA.job_id, lease: jobA.lease, outcome: 'completed' })).replayed, true);
  assert.deepEqual(await treeDigest(store(A)), privateBytes);
  assert.deepEqual(await treeDigest(store(B)), otherBytes);
  assert.deepEqual(await treeDigest(store()), rootBytes);
  for (const campaign of ['../escape', '/absolute', 'nested/scope', '..', '', null])
    await assert.rejects(call(first, 'module.status', campaign), invalid);
  await assert.rejects(call(first, 'module.status', A, { module_id: '../escape' }), invalid);

  // A valid-looking scope cannot redirect to another table or claim another table's metadata.
  const redirected = 'table-redirected';
  await symlink(join(workspace, '.coc/module-campaigns', A), join(workspace, '.coc/module-campaigns', redirected));
  await assert.rejects(call(first, 'module.status', redirected), invalid);
  const metadataPath = join(store(A), 'module.json'), metadataBytes = await readFile(metadataPath);
  try {
    await save(metadataPath, { ...coldA.meta, campaign_scope: B });
    await assert.rejects(call(first, 'module.status', A), invalid);
  } finally { await writeFile(metadataPath, metadataBytes); }
  // A private workspace that lost its binding is damaged, not a campaign that never forked.
  const heldMeta = metadataPath + '.held';
  await rename(metadataPath, heldMeta);
  try { await assert.rejects(call(first, 'module.status', A), error => error.details?.reason === 'module_scope_incomplete'); }
  finally { await rename(heldMeta, metadataPath); }
  assert.deepEqual(await treeDigest(store(A)), privateBytes);

  // The published graph is the one hard requirement for a fork; the original PDF, the index and
  // asset bytes are copied when present, and a published generation stays playable without them.
  const relativeTo = path => path.startsWith('/') ? relative(store(), path) : path;
  for (const [kind, path, missing] of [['pdf', join(store(), root.meta.source_document.path), root.meta.source_document.path],
    ['index', join(store(), root.meta.index_file), root.meta.index_file],
    ['asset', rootReceipt.asset.path, relativeTo(rootReceipt.asset.path)]]) {
    const campaign = `sparse-${kind}`, held = path + '.held';
    await rename(path, held);
    try {
      const chosen = await call(first, 'module.opening.choose', campaign, { scene: 'Dock' });
      assert.equal(chosen.start_scene, 'scene-dock');
      assert.ok(await readFile(join(store(campaign), 'module.json')));
      await assert.rejects(readFile(join(store(campaign), missing)), { code: 'ENOENT' });
      if (kind === 'index') {
        // A missing index may not keep claiming a complete one.
        const meta = await json(join(store(campaign), 'module.json'));
        assert.equal(meta.reading.index_complete, false);
        assert.equal(meta.index_file, undefined);
      }
    } finally { await rename(held, path); }
  }
  // Without the published graph a fork must refuse and leave no private directory behind.
  const sourceGraph = join(store(), root.meta.graph_file);
  const heldGraph = sourceGraph + '.held';
  await rename(sourceGraph, heldGraph);
  try {
    await assert.rejects(call(first, 'module.opening.choose', 'no-graph', { scene: 'Dock' }));
    await assert.rejects(readdir(store('no-graph')), { code: 'ENOENT' });
  } finally { await rename(heldGraph, sourceGraph); }
  // A registered module with no published generation cannot fork either.
  const unpublished = join(workspace, '.coc', 'modules', 'unpublished');
  await mkdir(unpublished, { recursive: true });
  await save(join(unpublished, 'module.json'), { id: 'unpublished', status: 'assembled', source: 'pdf' });
  try {
    await assert.rejects(first.call('module.opening.choose', { campaign: 'no-generation', module_id: 'unpublished', scene: 'Dock' }), error => error.code === 'campaign_not_ready');
    await assert.rejects(readdir(join(workspace, '.coc', 'module-campaigns', 'no-generation', 'modules', 'unpublished')), { code: 'ENOENT' });
  } finally { await rm(unpublished, { recursive: true, force: true }); }
  assert.deepEqual(await treeDigest(store()), rootBytes);

  // Corruption must fail closed in one scope, without changing another scope's source bytes.
  await writeFile(join(store(A), coldA.meta.source_document.path), Buffer.from('altered source'));
  await assert.rejects(call(first, 'module.read.request', A, { purpose: 'detail', focus: 'Cellar', question: 'Inspect the ledger.' }), /original PDF was modified/);
  await writeFile(coldA.path, Buffer.from('{}'));
  await assert.rejects(inspect(first, A), error => error.code === 'campaign_not_ready' && error.details?.reason === 'module_graph_integrity');
  assert.deepEqual(await treeDigest(store(B)), otherBytes);
  assert.deepEqual(await treeDigest(store()), rootBytes);
});
