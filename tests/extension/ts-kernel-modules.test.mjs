import {expected as outcome, withoutPostFreezeRecovery} from "./oracle-fixture.mjs";
import {pythonOracleRoot} from "../python-oracle.mjs";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
const evidenceRoot = join(ROOT, '.coc/playtests/ts-modules-check');
await mkdir(evidenceRoot, { recursive: true });
const evidence = await mkdtemp(join(evidenceRoot, 'direct-'));
const exports = [
  ['json', ['parsePythonJson', 'pythonJsonDumps', 'canonicalJson']],
  ['modules/visual', ['checkDraft', 'checkReview', 'requiredViewPages', 'assembleVisual']],
  ['write/source', ['openingReport', 'startSceneCandidates', 'assetRegistry']],
  ['read/module-graph', ['ModuleGraph']],
  ['read/thread', ['threadSection']],
  ['modules/index', ['createModuleRuntime']],
  ['modules/reading', ['Reading']],
  ['context', ['createKernelContext']],
  ['locks', ['createAdvisoryLocks']],
];
await build({ stdin: { contents: exports.map(([path, names]) => `export {${names.join(',')}} from ${JSON.stringify(join(ROOT, 'kernel-ts', path + '.ts'))};`).join('\n'),
  resolveDir: ROOT, sourcefile: 'source-oracle-api.ts', loader: 'ts' }, outfile: join(evidence, 'api.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
const api = await import(pathToFileURL(join(evidence, 'api.mjs')).href);
const json = async path => api.parsePythonJson(await readFile(path, 'utf8'));
const clone = value => api.parsePythonJson(api.pythonJsonDumps(value));
const contract = { graph: await json(join(ROOT, 'content/modules/module-graph-contract-v3.json')), template: await json(join(ROOT, 'content/modules/module-graph-template-v1.json')) };
const refs = [{ page: 1 }];
const base = { nodes: [
  { node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', properties: { is_entrance: true }, source_refs: refs },
  { node_id: 'npc-witness', node_kind: 'npc', name: 'Witness', source_refs: refs, properties: { mechanics: { profile: { characteristics: { STR: 50 } } }, knowledge: ['A recorded fact.'] } },
], claims: [{ subject_id: 'npc-witness', predicate: 'present-in', object: { node_id: 'scene-dock' }, truth_status: 'authored-fact', source_refs: refs }],
  node_refs: [], coverage: {}, critical: [], dependencies: [], ready_nodes: ['scene-dock', 'npc-witness'] };
const packet = { module_id: 'book-1', purpose: 'opening', source: { page_count: 2 }, known_nodes: [{ node_id: 'module-book-1', node_kind: 'module', name: 'Book', ready: false }], known_claims: [] };
const REFERENCE = String.raw`
import json,sys
from coc.errors import RpcError
from coc.modules.visual import check_draft,check_review,required_view_pages,assemble_visual
from coc.modules.playability import opening_check,start_scene_candidates
from coc.modules.assets import registry_from_graph
payload=json.load(sys.stdin)
results=[]
for case in payload['cases']:
    try:
        op=case.get('op','draft')
        if op=='draft': value=check_draft(case['draft'],case['packet'],set(case['seen']) if 'seen' in case else None)
        elif op=='pages': value=required_view_pages(case['draft'],case.get('baseline'))
        elif op=='review':
            filled=check_draft(case['draft'],case['packet'],set(case.get('seen',[1,2])))
            check_review(case['draft'],filled,case['review'],2,set(case.get('review_seen',[1,2])))
            value=None
        elif op=='assemble':
            filled=check_draft(case['draft'],case['packet'],set(case.get('seen',[1,2])))
            graph=assemble_visual(case.get('previous'),filled,case['meta'])
            value={'graph':graph,'opening':opening_check(graph),'candidates':start_scene_candidates(graph),'assets':registry_from_graph(graph,case.get('assets',[]))}
        results.append({'value':value})
    except RpcError as error: results.append({'error':error.to_json()})
json.dump(results,sys.stdout,ensure_ascii=False)
`;

function capture(case_) {
  try {
    let value;
    if ((case_.op ?? 'draft') === 'draft') value = api.checkDraft(case_.draft, case_.packet, contract, case_.seen ? new Set(case_.seen) : undefined);
    if (case_.op === 'pages') value = api.requiredViewPages(case_.draft, case_.baseline);
    if (case_.op === 'review') {
      const filled = api.checkDraft(case_.draft, case_.packet, contract, new Set(case_.seen ?? [1, 2]));
      api.checkReview(case_.draft, filled, case_.review, 2, new Set(case_.review_seen ?? [1, 2]));
      value = null;
    }
    if (case_.op === 'assemble') {
      const filled = api.checkDraft(case_.draft, case_.packet, contract, new Set(case_.seen ?? [1, 2]));
      const graph = api.assembleVisual(case_.previous ?? null, filled, case_.meta, contract);
      value = { graph, opening: api.openingReport(graph, new api.ModuleGraph(case_.meta.id, graph, '', contract.graph.actor_dossier), contract.template, contract.graph.actor_dossier),
        candidates: api.startSceneCandidates(graph, contract.graph.actor_dossier), assets: api.assetRegistry(graph, case_.assets ?? []) };
    }
    return { value };
  } catch (error) {
    if (typeof error.toJson !== 'function') throw error;
    return withoutPostFreezeRecovery({ error: error.toJson() });
  }
}

async function compare(name, cases, t) {
  const input = api.pythonJsonDumps({ cases });
  const captured = outcome('modules-' + name, () => {
    const reference = spawnSync('uv', ['run', '--frozen', 'python', '-c', REFERENCE], { cwd: ROOT, input, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, PYTHONPATH: join(pythonOracleRoot(), "kernel"), PYTHONDONTWRITEBYTECODE: '1' } });
    assert.equal(reference.status, 0, reference.stderr);
    return reference.stdout;
  }, REFERENCE);
  const expected = api.parsePythonJson(captured), actual = cases.map(capture);
  await writeFile(join(evidence, name + '-input.json'), input);
  await writeFile(join(evidence, name + '-captured.json'), captured);
  await writeFile(join(evidence, name + '-typescript.json'), api.pythonJsonDumps(actual));
  for (const [i, item] of cases.entries()) await t.test(item.name ?? String(i), () => {
    // Contract §90 also post-dates the frozen oracle: `way_on` is a readiness entry the historical
    // implementation had no concept of. Assert the new requirement here -- it is carried exactly
    // when the produced graph's start scene publishes no way out and the book does not end there --
    // then compare the opening the oracle did answer, which by §46 is readiness with that one entry
    // removed. The oracle's own bytes are never touched.
    const wayOn = actual[i].value?.opening?.missing?.includes('way_on');
    if (wayOn) {
      const graph = actual[i].value.graph, start = actual[i].value.opening.start_scene;
      const scenes = new Set(graph.nodes.filter(node => node.node_kind === 'scene').map(node => node.node_id));
      const exits = graph.relations.filter(rel => rel.from_node_id === start && rel.to_node_id !== start
        && scenes.has(rel.to_node_id)
        && ['route-to', 'play-precedes', 'may-lead-to', 'alternative-to', 'hands-off-to'].includes(rel.relation_kind));
      assert.deepEqual(exits, [], 'way_on is only for a start scene that publishes no way out');
      const record = graph.nodes.find(node => node.node_id === start)?.properties?.runtime_projection?.record;
      assert.notEqual(record?.is_final, true, 'a book that ends in its first scene has accounted for it');
      assert.ok(!expected[i].value.opening.missing.includes('way_on'), 'this is the post-freeze addition');
      const missing = actual[i].value.opening.missing.filter(entry => entry !== 'way_on');
      actual[i] = { ...actual[i], value: { ...actual[i].value,
        opening: { ...actual[i].value.opening, missing, opening_ready: !missing.length } } };
    }
    if (actual[i].value?.required_review && expected[i].value?.required_review && !['skeleton','guidance'].includes(item.packet?.purpose)) {
      // The frozen oracle predates the scope-review requirement. Keep every prior assertion
      // and compare the unchanged payload; assert the new TS requirement separately.
      const {required_review: current, ...body} = actual[i].value;
      const {required_review: historical, ...oldBody} = expected[i].value;
      assert.ok(current.includes('/coverage'));
      assert.deepEqual(current.filter(path => path !== '/coverage'), historical);
      assert.equal(api.canonicalJson(body), api.canonicalJson(oldBody), `Evidence: ${evidence}`);
    } else assert.equal(api.canonicalJson(actual[i]), api.canonicalJson(expected[i]), `Evidence: ${evidence}`);
  });
}

test('pure source checker matches Python vocabulary, page and readiness gates', async t => {
  const cases = [];
  function add(name, change) { const item = { name, draft: clone(base), packet: clone(packet), seen: [1, 2] }; change?.(item); cases.push(item); }
  add('valid authored material');
  add('root is not an object', c => { c.draft = []; });
  add('unknown root field', c => { c.draft.machine_stamp = 1; });
  add('wrong contract', c => { c.draft.contract_id = null; });
  add('unresolved dependency', c => { c.draft.dependencies = [{ focus: 'Tower' }]; });
  for (const field of ['nodes', 'claims', 'node_refs', 'critical', 'ready_nodes']) add(field + ' shape', c => { c.draft[field] = null; });
  add('unknown coverage domain', c => { c.draft.coverage = { invented: 'ready' }; });
  add('unknown coverage state', c => { c.draft.coverage = { [contract.graph.coverage_domains[0]]: 'finished' }; });
  add('unknown node field', c => { c.draft.nodes[0].state = 'active'; });
  add('unknown node kind despite packet spoof', c => { c.packet.vocabulary = { node_kinds: ['invented'] }; c.draft.nodes[0].node_kind = 'invented'; });
  add('duplicate semantic node', c => { c.draft.nodes.push(clone(c.draft.nodes[0])); });
  add('nonsemantic identifier', c => { c.draft.nodes[0].node_id = 'scene-opaque--token'; });
  add('blank source name', c => { c.draft.nodes[0].name = '  '; });
  add('aliases must be names', c => { c.draft.nodes[0].aliases = [42]; });
  add('properties are an object', c => { c.draft.nodes[0].properties = null; });
  add('standalone NPC stats', c => { c.draft.nodes[1].properties = { stats: { STR: 50 } }; });
  add('unknown visibility', c => { c.draft.nodes[0].visibility = 'public'; });
  add('no source references', c => { c.draft.nodes[0].source_refs = []; });
  add('unknown source reference field', c => { c.draft.nodes[0].source_refs = [{ page: 1, text: 'invented' }]; });
  for (const page of [0, 3, true, '1', api.parsePythonJson('1.0')]) add('invalid physical page ' + api.pythonJsonDumps(page), c => { c.draft.nodes[0].source_refs = [{ page }]; });
  add('page not viewed', c => { c.seen = [2]; });
  add('string page observation cannot authorize', c => { c.seen = ['1']; });
  add('invalid box', c => { c.draft.nodes[0].source_refs = [{ page: 1, box: [0, 0, 2, 1] }]; });
  add('duplicate refs coalesce', c => { c.draft.nodes[0].source_refs = [{ page: 1 }, { page: 1 }]; });
  add('unknown node reference', c => { c.draft.node_refs = ['scene-missing']; });
  add('skeleton cannot grant readiness', c => { c.packet.purpose = 'skeleton'; });
  add('skeleton can publish source nodes', c => { c.packet.purpose = 'skeleton'; c.draft.ready_nodes = []; });
  add('empty skeleton', c => { c.packet.purpose = 'skeleton'; c.draft.nodes = []; });
  add('detail must name prepared nodes', c => { c.draft.ready_nodes = []; });
  add('ready reference must be independently reviewed', c => { c.draft.ready_nodes = ['module-book-1']; });
  add('unknown critical pointer', c => { c.draft.critical = ['/nodes/0/absent']; });
  add('critical path format', c => { c.draft.critical = ['nodes/0']; });
  add('unknown predicate', c => { c.draft.claims[0].predicate = 'invented'; });
  add('self impersonation', c => { c.draft.claims[0].predicate = 'impersonates'; c.draft.claims[0].object.node_id = 'npc-witness'; });
  add('claim object fields', c => { c.draft.claims[0].object.value = 'extra'; });
  add('invalid truth status', c => { c.draft.claims[0].truth_status = 'certain'; });
  add('invalid claim audience', c => { c.draft.claims[0].visibility = 'public'; });
  add('invalid known-by identity', c => { c.draft.claims[0].known_by_ids = ['npc-missing']; });
  add('reuses accepted claim identity and validity', c => { c.packet.known_claims = [{ ...clone(c.draft.claims[0]), claim_id: 'claim-authored', validity: { when: 'night' } }]; });
  add('prepared summary remains stable', c => { c.packet.known_nodes.push({ ...clone(c.draft.nodes[0]), summary: 'Original.', ready: true }); c.draft.nodes[0].summary = 'Changed.'; });
  add('first preparation may replace navigation summary', c => { c.packet.known_nodes.push({ ...clone(c.draft.nodes[0]), summary: 'Navigation.', ready: false }); c.draft.nodes[0].summary = 'Reviewed description.'; });
  add('large authored number retains identity', c => { c.draft.nodes[1].properties.mechanics.profile.characteristics.STR = api.parsePythonJson('9007199254740993'); });
  add('source page boundary cannot round a large integer down', c => { c.packet.source.page_count = api.parsePythonJson('9007199254740992'); c.draft.nodes[0].source_refs = [{ page: api.parsePythonJson('9007199254740993') }]; });
  add('host asset path cannot be invented', c => { c.draft.nodes.push({ node_id: 'handout-letter', node_kind: 'handout', name: 'Letter', source_refs: [{ page: 1 }], properties: { asset_ref: '/private/unrelated.png' } }); });
  await compare('gates', cases, t);
});

test('independent review names every required field and its observed source', async t => {
  const required = api.checkDraft(base, packet, contract, new Set([1, 2])).required_review;
  const valid = { checked: [{ paths: required, verdict: 'supported', source_refs: refs }], missing: [] };
  const cases = [];
  function add(name, change) { const item = { name, op: 'review', draft: clone(base), packet: clone(packet), review: clone(valid) }; change?.(item); cases.push(item); }
  add('grouped paths');
  add('empty independent report', c => { c.review.checked = []; });
  add('parent does not cover number', c => { c.review.checked[0].paths = required.filter(p => !p.endsWith('STR')); });
  add('independent page not viewed', c => { c.review_seen = [2]; });
  add('contradicted field', c => { c.review.checked[0].verdict = 'contradicted'; c.review.checked[0].reason = 'The source differs.'; });
  add('missing facts', c => { c.review.missing = ['An omitted fact']; });
  add('invalid checked entry', c => { c.review.checked = [false]; });
  add('no pointer', c => { c.review.checked = [{ verdict: 'supported', source_refs: refs }]; });
  for (const [index, item] of cases.entries()) await t.test(item.name, () => {
    const result = capture(item);
    if (index === 0) assert.deepEqual(result, {value: null});
    else { assert.equal(result.error?.code, 'invalid_params'); assert.ok(result.error.message); }
  });
});

test('visual source publication validates map regions and private-source redactions',()=>{
  const draft=clone(base);
  draft.nodes.push(
    {node_id:'asset-player-plan',node_kind:'asset',name:'Player plan',visibility:'player-safe',aliases:[],source_refs:refs,
      properties:{image_sources:[{page:1}],map_regions:[{region_id:'entry',name:'Entry',source_asset:'player-plan',source_box:[0,0,.5,1],placement:[0,0,.5,1]}]}},
    {node_id:'asset-keeper-cellar',node_kind:'asset',name:'Keeper cellar',visibility:'keeper-only',aliases:[],source_refs:refs,
      properties:{image_sources:[{page:1}]}});
  draft.ready_nodes.push('asset-player-plan','asset-keeper-cellar');
  assert.doesNotThrow(()=>api.checkDraft(draft,packet,contract,new Set([1])));
  const privateDraft=clone(draft),map=privateDraft.nodes.find(node=>node.node_id==='asset-player-plan');
  map.properties.map_regions.push({region_id:'secret',name:'Secret room',source_asset:'keeper-cellar',source_box:[0,0,1,1],placement:[.5,0,1,1],redactions:[[.2,.2,.8,.5]],safe_after_redactions:true});
  assert.doesNotThrow(()=>api.checkDraft(privateDraft,packet,contract,new Set([1])));
  map.properties.map_regions[1].redactions=[];
  assert.throws(()=>api.checkDraft(privateDraft,packet,contract,new Set([1])),/private map sources require reviewed redactions/);
});

test('a no-clue prepared scope needs its own semantic review but no numeric clue quota',()=>{
  const draft=clone(base),filled=api.checkDraft(draft,packet,contract,new Set([1]));
  const review={checked:[{paths:filled.required_review.filter(path=>path!=='/coverage'),verdict:'supported',source_refs:refs}],missing:[]};
  assert.throws(()=>api.checkReview(draft,filled,review,2,new Set([1])),/\/coverage/);
  review.checked.push({paths:['/coverage'],verdict:'supported',source_refs:refs,reason:'This prepared interaction has no discoverable investigation facts.'});
  assert.doesNotThrow(()=>api.checkReview(draft,filled,review,2,new Set([1])));
  assert.throws(()=>api.checkReview(draft,filled,{...review,missing:['A source-backed clue was omitted.']},2,new Set([1])),/missing or incorrect material/);
});

test('a PDF map demand emits a bounded material-pending descriptor with candidate pages', async () => {
  const reading = new api.Reading({ module: async () => ({ source: 'pdf', reading: { map_candidates: [{ name: 'Farm', pages: [23, 17] }] } }) });
  const graph = { moduleId: 'book-1', nodes: new Map() };
  await assert.rejects(reading.requireMapMaterial(graph, { name: 'Farm' }), error => {
    assert.equal(error.details.reason, 'material_pending');
    assert.deepEqual(error.details.read, {
      purpose: 'detail', material: 'map', focus: 'Farm', pages: [17, 23],
      question: 'Identify the source-backed map material needed to orient investigators at Farm; extract only independently revealable map regions and safe place correspondence.',
    });
    return true;
  });
  await reading.close();
});

test('canonical PDF clue properties and knows/supports relations reach the existing thread',()=>{
  const draft=clone(base),sceneId='scene-dock',clueId='clue-destination',conclusionId='conclusion-mill';
  draft.nodes.push(
    {node_id:'handout-receipt',node_kind:'handout',name:'Receipt',properties:{},source_refs:refs},
    {node_id:clueId,node_kind:'clue',name:'Cargo destination',summary:'The cargo was sent to the mill.',visibility:'revealable',properties:{delivery_kind:'npc_dialogue',delivery:'Ask the witness about the cargo.'},source_refs:refs},
    {node_id:conclusionId,node_kind:'conclusion',name:'Destination established',properties:{importance:'core'},source_refs:refs});
  for(const [subject_id,predicate,target] of [['handout-receipt','discoverable-at',sceneId],[clueId,'discoverable-at',sceneId],[clueId,'supports',conclusionId],['npc-witness','knows',clueId]])
    draft.claims.push({subject_id,predicate,object:{node_id:target},truth_status:'authored-fact',source_refs:refs});
  draft.ready_nodes.push(clueId,conclusionId,'handout-receipt');draft.coverage={knowledge:'accepted',causal:'accepted'};
  const filled=api.checkDraft(draft,packet,contract,new Set([1]));
  api.checkReview(draft,filled,{checked:[{paths:filled.required_review,verdict:'supported',source_refs:refs}],missing:[]},2,new Set([1]));
  const raw=api.assembleVisual(null,filled,{id:'book-1',title:'Book',reading:{materials:[]}},contract),graph=new api.ModuleGraph('book-1',raw,'',contract.graph.actor_dossier);
  const scene=graph.nodes.get(sceneId),npc=graph.nodes.get('npc-witness');
  const world={active_scene:graph.handle(scene),discovered_clues:[],scene_trail:[],npc_presence:{[graph.handle(npc)]:graph.handle(scene)}};
  const line=api.threadSection(graph,world,scene,[npc]).lines.find(item=>item.name===graph.handle(graph.nodes.get(conclusionId)));
  assert.equal(line.here[0].line,'Ask the witness about the cargo.');
  assert.equal(line.here[0].gate,'npc_dialogue: check unspecified');
  assert.equal(line.handed[0].by,graph.displayName(npc));
  assert.equal(graph.kind('handout').length,1);assert.equal(graph.kind('clue').length,1);
  world.discovered_clues.push(graph.handle(graph.nodes.get(clueId)));
  assert.deepEqual(api.threadSection(graph,world,scene,[npc]).lines,[]);
});

test('source assembly and changed-page projection preserve accepted facts and assets', async t => {
  const meta = { id: 'book-1', title: 'Book', languages: ['en'], reading: { materials: [] } };
  const first = { op: 'assemble', name: 'initial published source', draft: clone(base), packet: clone(packet), meta };
  const graph = capture(first).value.graph;
  const cases = [first,
    { op: 'pages', name: 'unchanged source needs no repeated evidence', draft: clone(base), baseline: clone(base) },
    { op: 'pages', name: 'new source reference requires a view', draft: { ...clone(base), claims: [{ ...clone(base.claims[0]), source_refs: [{ page: 2 }] }] }, baseline: clone(base) },
  ];
  const additive = { ...clone(first), name: 'additive NPC dossier', previous: graph, meta: { ...clone(meta), reading: { materials: [{ node_ids: ['scene-dock', 'npc-witness'] }] } } };
  additive.draft.nodes[1].properties.knowledge = ['Another source fact.'];
  cases.push(additive);
  const image = { ...clone(first), name: 'legacy assets retain paths and identity', assets: [{ id: 'old-letter', node_id: 'handout-letter', name: 'Old', path: 'legacy/letter.png', kind: 'handout', pages: [0], sha256: 'a'.repeat(64) }] };
  image.draft.nodes.push({ node_id: 'handout-letter', node_kind: 'handout', name: 'Letter', source_refs: refs, visibility: 'revealable', properties: { authored_text: 'Recorded letter.' } });
  image.draft.ready_nodes.push('handout-letter');
  cases.push(image);
  await compare('assembly', cases, t);
});

test('native owners recover unpublished attempts without exposing or duplicating partial files', async t => {
  const require = createRequire(import.meta.url), flock = promisify(require('fs-ext').flock);
  for (const purpose of ['index', 'opening']) await t.test(purpose, async () => {
    const workspace = join(evidence, 'interrupted-' + purpose), path = join(evidence, purpose + '.pdf');
    const sourceBytes = Buffer.from('%PDF-1.7\ntransport fixture; no rendering or gameplay\n');
    await writeFile(path, sourceBytes);
    const context = await api.createKernelContext({ workspace, content: join(ROOT, 'content'), locks: api.createAdvisoryLocks(flock) });
    const first = api.createModuleRuntime(context), second = api.createModuleRuntime(context);
    const ok = (owner, method, params) => owner.handlers[method](params);
    const store = first.source.store;
    // The opening draft is `base` plus the one thing contract §90 requires an opening to account
    // for: where the first scene leads, or that the book ends in it. `base` is a single scene, so
    // it ends there. Without that, publication is refused for `way_on` before this test's own
    // injected failure, and the subject here is an interrupted metadata publication, not readiness.
    const opening = clone(base);
    opening.nodes[0].properties.is_final = true;
    const rawDraft = purpose === 'index' ? { title: 'Book', language: 'en', sections: [{ name: 'Opening', pages: [[1, 2]], source_refs: [{ page: 1 }] }] } : opening;
    const review = { checked: [{ paths: ['/nodes/0', '/nodes/1', '/nodes/1/properties/mechanics/profile/characteristics/STR', '/claims/0', '/coverage'], verdict: 'supported', source_refs: refs }], missing: [] };
    const prepare = async job => {
      const observations = { file_sha256: job.source.file_sha256, read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2] };
      for (const [name, value] of [['draft', rawDraft], ['observations', observations], ['review', review]]) await writeFile(join(job.work_dir, name + '.json'), api.pythonJsonDumps(value));
      return { module_id: job.module_id, job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json') };
    };
    try {
      const { module_id } = await ok(first, 'module.source.bind', { source: { path, page_count: 2, file_sha256: createHash('sha256').update(sourceBytes).digest('hex') } });
      await ok(first, 'module.read.request', { module_id, purpose });
      const job = await ok(first, 'module.read.claim', { module_id, owner: 'first-owner' });
      const params = await prepare(job), original = store.writeModule.bind(store);
      store.writeModule = async () => { throw new Error('interrupted before metadata publication'); };
      await assert.rejects(ok(first, 'module.read.finish', params), /interrupted before metadata/);
      store.writeModule = original;
      const previous = await store.module(module_id);
      assert.equal(previous.generation, 0);
      assert.equal(previous.index_file, undefined);
      assert.equal(await store.readGraph(module_id), null);
      assert.deepEqual(await ok(second, 'module.read.claim', { module_id }), { job_id: null });
      await first.close();
      await assert.rejects(ok(first, 'module.read.claim', { module_id }), /no longer owns publication/);
      const retry = await ok(second, 'module.read.claim', { module_id, owner: 'second-owner' });
      assert.equal(retry.attempts, 2); assert.notEqual(retry.lease, job.lease);
      assert.equal(retry.resume_from, job.work_dir);
      const result = await ok(second, 'module.read.finish', await prepare(retry));
      assert.equal(result.generation, purpose === 'opening' ? 1 : 0);
      assert.deepEqual((await store.module(module_id)).reading.viewed_pages, [0, 1]);
      assert.equal((await readFile(join(job.work_dir, 'draft.json'), 'utf8')), api.pythonJsonDumps(rawDraft));
      if (purpose === 'index') assert.equal((await store.sections(module_id)).length, 1);
      else assert.equal((await readdir(join(store.moduleDir(module_id), 'generations'))).length, 2);
    } finally { await first.close(); await second.close(); await context.git.close(); }
  });
});
