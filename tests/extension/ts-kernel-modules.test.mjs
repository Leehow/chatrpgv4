import {playtestScratch} from './playtest-scratch.mjs';
import {expected as outcome, withoutPostFreezeRecovery, withoutDraftFindings} from "./oracle-fixture.mjs";
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
const evidence = playtestScratch('ts-modules-check', 'direct-');
const exports = [
  ['json', ['parsePythonJson', 'pythonJsonDumps', 'canonicalJson']],
  ['modules/visual', ['checkDraft', 'checkReview', 'requiredViewPages', 'assembleVisual', 'attachMapCandidates','recordContested']],
  ['write/source', ['openingReport', 'startSceneCandidates', 'assetRegistry']],
  ['read/module-graph', ['ModuleGraph']],
  ['read/thread', ['threadSection']],
  ['modules/index', ['createModuleRuntime']],
  ['modules/reference', ['referenceReady']],
  ['registry', ['createKernelRuntime']],
  ['modules/reading', ['Reading']],
  ['modules/source-answer',['checkSourceAnswerReview','sourceAnswerResult']],
  ['resolve/context',['npcProfileOf']],
  ['context', ['createKernelContext']],
  ['locks', ['createAdvisoryLocks']],
  ['modules/contract', ['loadModuleContract']],
  ['snapshots', ['snapshots']],
];
await build({ stdin: { contents: exports.map(([path, names]) => `export {${names.join(',')}} from ${JSON.stringify(join(ROOT, 'kernel-ts', path + '.ts'))};`).join('\n'),
  resolveDir: ROOT, sourcefile: 'source-oracle-api.ts', loader: 'ts' }, outfile: join(evidence, 'api.mjs'), bundle: true, packages:'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
const api = await import(pathToFileURL(join(evidence, 'api.mjs')).href);
const json = async path => api.parsePythonJson(await readFile(path, 'utf8'));
const clone = value => api.parsePythonJson(api.pythonJsonDumps(value));
// The contract publication loads (§134.16, §136.26): the graph vocabulary and the ruleset names a drafted shape resolves against.
const contract = await api.loadModuleContract({ content: join(ROOT, 'content'), snapshots: api.snapshots });
const refs = [{ page: 1 }];
test('a source delta inherits omitted visibility and claim holders without inventing a retranscription',()=>{
 const scene={node_id:'scene-dock',node_kind:'scene',name:'Dock',properties:{},visibility:'player-safe',source_refs:refs,ready:false};
 const person={node_id:'npc-witness',node_kind:'npc',name:'Witness',properties:{},visibility:'keeper-only',source_refs:refs,ready:false};
 const claim={claim_id:'claim-witness-at-dock',subject_id:person.node_id,predicate:'present-in',object:{node_id:scene.node_id},
  truth_status:'authored-fact',visibility:'keeper-only',source_refs:refs,known_by_ids:[person.node_id],asserted_by_ids:[person.node_id],validity:null};
 const candidate={nodes:[{node_id:scene.node_id,node_kind:'scene',name:'Dock',properties:{},source_refs:refs}],
  claims:[{claim_id:claim.claim_id,subject_id:claim.subject_id,predicate:claim.predicate,object:claim.object,truth_status:claim.truth_status,source_refs:refs}],
  node_refs:[person.node_id],ready_nodes:[scene.node_id],critical:[],coverage:{},dependencies:[]};
 const filled=api.checkDraft(clone(candidate),{module_id:'book-1',purpose:'detail',source:{page_count:2},known_nodes:[scene,person],known_claims:[claim]},contract,new Set([1]));
 assert.equal(filled.nodes[0].visibility,'player-safe');
 assert.deepEqual(filled.claims[0].known_by_ids,[person.node_id]);
 assert.deepEqual(filled.claims[0].asserted_by_ids,[person.node_id]);
 assert.ok(!filled.required_review.includes('/nodes/0/visibility'));
});
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
    return withoutDraftFindings(withoutPostFreezeRecovery({ error: error.toJson() }));
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
    // Contract §136.26 also post-dates the frozen oracle: a reader's profile is now a mechanical shape held to
    // §136.6, whose integer slots stop at the largest exact integer. Assert that refusal here; the oracle's
    // bytes are never touched, and no other case carries a shape the catalog refuses.
    if (item.name === 'large authored number retains identity') {
      assert.equal(actual[i].error?.details?.rule, 'shape_prose', `Evidence: ${evidence}`);
      assert.equal(actual[i].error.details.path, '/nodes/1/properties/mechanics/profile/characteristics/STR');
      assert.ok(expected[i].value, 'the oracle published it: this is the post-freeze change');
      return;
    }
    // Contract §22.3.1 (SL-33) post-dates the frozen oracle twice. A differing summary read from the same
    // page is a re-transcription the draft check sends to review by pointer, where the oracle refused it;
    // and publication records each written field's span in `graph.field_spans`, a key the oracle never
    // wrote. Assert both here and compare the rest; the oracle's bytes are never touched.
    if (item.name === 'prepared summary remains stable') {
      assert.equal(expected[i].error?.code, 'needs_choice', 'the oracle refused it: this is the post-freeze change');
      assert.ok(actual[i].value?.required_review.includes('/nodes/0/summary'), `Evidence: ${evidence}`);
      return;
    }
    if (actual[i].value?.graph?.field_spans) {
      const { field_spans: spans, ...graph } = actual[i].value.graph;
      assert.equal(expected[i].value?.graph?.field_spans, undefined, 'the oracle recorded no spans: this is the post-freeze addition');
      assert.deepEqual(spans['/nodes/scene-dock/properties/is_entrance'], [{ source_id: 'pdf:book-1', pdf_index: 0 }]);
      actual[i] = { ...actual[i], value: { ...actual[i].value, graph } };
    }
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
      properties:{image_sources:[{page:1}],map_scope:'interior',map_regions:[{region_id:'entry',name:'Entry',source_asset:'player-plan',source_box:[0,0,.5,1],placement:[0,0,.5,1]}]}},
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

test('an indexed map candidate marks its scene, and the marker is carried onto the assembled scene', async () => {
  const meta={id:'book-1',title:'Book',source:'pdf',reading:{materials:[],map_candidates:[{name:'Map of the Dock',focus:'Dock',pages:[9,7]}]}};
  const filled=api.checkDraft(clone(base),packet,contract,new Set([1]));
  const raw=api.assembleVisual(null,filled,meta,contract),scene=raw.nodes.find(node=>node.node_id==='scene-dock');
  assert.deepEqual(scene.properties.map_candidates,[{name:'Map of the Dock',focus:'Dock',pages:[7,9]}]);
});

/**
 * §107.1 fixtures: a bound two-page PDF whose index marks the Tower with a map and whose opening publishes the Dock,
 * read through the real module runtime. `reopen` retires the runtime (its native leases die with it, as when a
 * table stops) and starts a fresh one on the same workspace.
 */
async function mapBook(name,extraMapCandidates=[]) {
  const require=createRequire(import.meta.url),flock=promisify(require('fs-ext').flock);
  const workspace=join(evidence,name),path=join(evidence,`${name}.pdf`),bytes=Buffer.from(`%PDF-1.7\n${name} map fixture\n`);
  await writeFile(path,bytes);
  const context=await api.createKernelContext({workspace,content:join(ROOT,'content'),locks:api.createAdvisoryLocks(flock)});
  const sha=createHash('sha256').update(bytes).digest('hex'),refs1=[{page:1}];
  const book={context,runtime:api.createModuleRuntime(context),mid:null};
  const call=(method,params)=>book.runtime.handlers[method]({module_id:book.mid,...params});
  const save=(file,value)=>writeFile(file,JSON.stringify(value));
  book.call=call;
  book.store=()=>book.runtime.source.store;
  book.claim=owner=>call('module.read.claim',{owner});
  book.fail=(job,refusal)=>call('module.read.finish',{job_id:job.job_id,lease:job.lease,outcome:'failed',detail:`invalid_params: ${refusal}`,refusal:{message:refusal}});
  book.reopen=async()=>{await book.runtime.close();book.runtime=api.createModuleRuntime(context);};
  book.close=async()=>{await book.runtime.close();await context.git.close();};
  const publish=async(job,draft)=>{
    await save(join(job.work_dir,'observations.json'),{file_sha256:sha,read_pages:[1,2],full_pages:[1,2],review_pages:[1,2]});
    await save(join(job.work_dir,'draft.json'),draft);
    const checked=job.purpose==='index'?[]:api.checkDraft(clone(draft),job,contract,new Set([1,2])).required_review;
    await save(join(job.work_dir,'review.json'),{checked:[{paths:checked,verdict:'supported',source_refs:refs1,reason:'fixture support'}],missing:[]});
    return call('module.read.finish',{job_id:job.job_id,lease:job.lease,outcome:'completed',draft_path:join(job.work_dir,'draft.json'),review_path:join(job.work_dir,'review.json')});
  };
  book.publish=publish;
  book.mid=(await book.runtime.handlers['module.source.bind']({source:{path,page_count:2,file_sha256:sha}})).module_id;
  await publish(await book.claim('test-host'),{title:'The Harbor',language:'en',sections:[{name:'Harbor and tower',pages:[[1,2]],entities:['Dock','Tower','Lena']}],
    map_candidates:[{name:'Tower plan',focus:'Tower',pages:[2]},...extraMapCandidates]});
  await call('module.read.request',{purpose:'opening'});
  const nodes=[{node_id:'scene-dock',node_kind:'scene',name:'Dock',source_refs:refs1,properties:{is_entrance:true}},
    {node_id:'scene-tower',node_kind:'scene',name:'Tower',source_refs:[{page:2}],summary:'An old tower beyond the harbor.',properties:{is_final:true}},
    {node_id:'npc-lena',node_kind:'npc',name:'Lena',source_refs:refs1,properties:{mechanics:{profile:{characteristics:{STR:50}}}}}];
  const claims=[['scene-dock','route-to','scene-tower'],['npc-lena','present-in','scene-dock']].map(([subject_id,predicate,node_id])=>({subject_id,predicate,object:{node_id},truth_status:'authored-fact',source_refs:refs1}));
  assert.equal((await publish(await book.claim('test-host'),{nodes,claims,node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:['scene-dock','npc-lena']})).opening_ready,true);
  book.graph=()=>book.store().graph(book.mid);
  book.mapJobs=async()=>(await book.store().queue(book.mid)).filter(job=>job.material==='map');
  book.settled=async()=>array((await book.store().module(book.mid)).reading.materials).filter(row=>row.material==='map');
  return book;
}
const array=value=>Array.isArray(value)?value:[];
const TOWER_QUESTION='Prepare the source-backed map Tower plan that depicts Tower; extract only independently revealable regions and safe place correspondence.';
const deadPid=()=>spawnSync(process.execPath,['-e','0']).pid;

test('map discovery uses the indexed place identity while retaining broad fallback for an unknown focus',async()=>{
 const book=await mapBook('focused-map-candidates',[{name:'Another plan',focus:'Elsewhere',pages:[1]}]);
 try{
  await book.call('module.read.request',{purpose:'detail',material:'map',focus:'Tower',question:'Prepare its authored map',foreground:true});
  const exact=await book.claim('test-host');assert.deepEqual(exact.pages,[2]);
  await book.call('module.read.request',{purpose:'detail',material:'map',focus:'Unknown place',question:'Locate this map'});
  const broad=(await book.store().queue(book.mid)).find(job=>job.focus==='Unknown place');assert.deepEqual(broad.pages,[1,2]);
 }finally{await book.close();}
});

test('reviewed deferred source work is projected, queued, promoted and closed only by its matching accepted detail',async()=>{
 const book=await mapBook('source-needs-lifecycle');
 try{
  const question='What source rule governs the tower mechanism?';
  await book.call('module.read.request',{purpose:'detail',focus:'Lena',question:'Preserve current limits and later source work',foreground:true});
  await book.publish(await book.claim('test-host'),{nodes:[{node_id:'npc-lena',node_kind:'npc',name:'Lena',source_refs:[{page:1}],properties:{}}],
   claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:['npc-lena'],source_needs:[
    {kind:'deferred',focus:'Tower',question,reason:'The mechanism is outside the present conversation.',trigger:'Before using the tower mechanism.',source_refs:[{page:2}]},
    {kind:'runtime_context',focus:'Lena',question:'How much exposure has elapsed?',reason:'The source condition depends on live elapsed time.',trigger:'When exposure is resolved.',source_refs:[{page:1}]}]});
  let graph=await book.graph();
  assert.equal(graph.entityView(graph.scene('Tower')).source_needs[0].question,question);
  assert.equal(graph.sourceNeeds(graph.find('Lena'),true)[0].kind,'runtime_context');
  await book.call('module.read.ahead',{});
  const pending=(await book.store().queue(book.mid)).find(job=>job.question===question);
  assert.equal(pending.foreground,false);
  const demand=await book.call('module.read.request',{purpose:'detail',focus:'Tower',question,foreground:true});
  assert.equal(demand.job_id,pending.job_id);
  const claimed=await book.claim('test-host');assert.equal(claimed.job_id,pending.job_id);
  await assert.rejects(book.publish(claimed,{nodes:[{node_id:'scene-tower',node_kind:'scene',name:'Tower',source_refs:[{page:2}],properties:{}}],
   claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:['scene-tower'],source_needs:[
    {kind:'deferred',focus:'Tower',question,reason:'Still not read.',trigger:'Before using the mechanism.',source_refs:[{page:2}]}]}),/cannot defer its own requested source question/);
  await book.publish(claimed,{nodes:[{node_id:'scene-tower',node_kind:'scene',name:'Tower',source_refs:[{page:2}],properties:{}}],
   claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:['scene-tower'],source_needs:[]});
  graph=await book.graph();assert.equal(graph.sourceNeeds(graph.scene('Tower')).length,0);
  assert.equal(graph.sourceNeeds(graph.find('Lena'),true).length,1);
  assert.equal((await book.store().module(book.mid)).reading.resolved_source_needs.at(-1).question,question);
 }finally{await book.close();}
});

test('first-interaction readiness upgrades a prologue snapshot and continues beyond the prepared encounter',async()=>{
 const book=await mapBook('opening-interaction-scope');
 try{
  const requested=await book.call('module.read.request',{purpose:'opening',focus:'Dock',opening_scope:'first_interaction',foreground:true});
  assert.equal(requested.state,'queued','the older prologue-only snapshot cannot answer the new scope');
  const job=await book.claim('test-host');
  const node=(id,name,properties={})=>({node_id:id,node_kind:'scene',name,properties,source_refs:[{page:2}]});
  const edge=(from,to)=>({subject_id:from,predicate:'route-to',object:{node_id:to},truth_status:'authored-fact',source_refs:[{page:2}]});
  await book.publish(job,{nodes:[{node_id:'scene-dock',node_kind:'scene',name:'Dock',properties:{},source_refs:[{page:1}]},
   node('scene-market','Market'),node('scene-mill','Mill')],claims:[edge('scene-dock','scene-market'),edge('scene-market','scene-mill')],
   node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:['scene-dock','scene-market'],interaction_scene:'scene-market'});
  assert.equal((await book.call('module.read.request',{purpose:'opening',focus:'Dock',opening_scope:'first_interaction',foreground:true})).state,'ready');
  await book.call('module.read.ahead',{focus:'Dock'});
  assert.ok((await book.store().queue(book.mid)).some(job=>job.purpose==='detail'&&job.focus==='mill'&&job.foreground===false));
 }finally{await book.close();}
});

test('§107.1: the first arrival at a marked scene queues one background map reading and raises nothing', async () => {
  const book=await mapBook('arrival-map');
  try {
    const graph=await book.graph(),reading=new api.Reading(book.store());
    assert.deepEqual(graph.scene('Tower').properties.map_candidates,[{name:'Tower plan',focus:'Tower',pages:[2]}]);
    const first=await reading.queueArrivalMap(graph,graph.scene('Tower'));
    const [job]=await book.mapJobs();
    assert.deepEqual(first,{state:'queued',focus:'tower',job_id:job.job_id});
    assert.deepEqual(Object.fromEntries(['purpose','material','focus','question','pages','foreground','state'].map(key=>[key,job[key]])),
      {purpose:'detail',material:'map',focus:'tower',question:TOWER_QUESTION,pages:[2],foreground:false,state:'queued'});
    // One live job per focus: a second arrival joins it.
    assert.deepEqual(await reading.queueArrivalMap(graph,graph.scene('Tower')),first);
    assert.equal((await book.mapJobs()).length,1);
    // A scene without a marker pays for no map read.
    assert.deepEqual(await reading.queueArrivalMap(graph,graph.scene('Dock')),{state:'none'});
    await reading.close();
  } finally {await book.close();}
});

test('§107.1: a refused map review settles the focus once, and a later arrival neither queues nor re-reads', async () => {
  const book=await mapBook('refused-map');
  try {
    const graph=await book.graph(),reading=new api.Reading(book.store());
    await reading.queueArrivalMap(graph,graph.scene('Tower'));
    const job=await book.claim('test-host');
    assert.equal(job.material,'map');
    const refusal="visual review did not support ['/nodes/0/properties/map_regions/1/source_box/0']";
    assert.equal((await book.fail(job,refusal)).state,'failed');
    const [row]=await book.settled();
    assert.deepEqual(Object.fromEntries(['status','focus','reason','job_id','node_ids','material'].map(key=>[key,row[key]])),
      {status:'unusable',focus:'tower',reason:refusal,job_id:job.job_id,node_ids:[],material:'map'});
    assert.deepEqual(await reading.queueArrivalMap(graph,graph.scene('Tower')),{state:'unusable',focus:'tower'});
    assert.equal((await book.mapJobs()).length,1,'the settled focus is not read again');
    assert.equal((await book.settled()).length,1,'settled once');
    // A map identity that failed before §107.1 (no row) settles the first time an arrival meets it.
    const meta=await book.store().module(book.mid);
    meta.reading.materials=meta.reading.materials.filter(material=>material.material!=='map');
    await book.store().writeModule(meta);
    assert.deepEqual(await reading.queueArrivalMap(graph,graph.scene('Tower')),{state:'unusable',focus:'tower'});
    assert.equal((await book.mapJobs()).length,1);
    assert.equal((await book.settled())[0].reason,refusal);
    await reading.close();
  } finally {await book.close();}
});

test('§107.1: a running job whose owner process is gone is recovered on the next open, never left running', async () => {
  const book=await mapBook('orphan-map');
  try {
    const graph=await book.graph(),reading=new api.Reading(book.store());
    await reading.queueArrivalMap(graph,graph.scene('Tower'));
    const gone=`host-${deadPid()}`,first=await book.claim(gone);
    assert.equal(first.material,'map');
    await book.reopen();
    const opened=await book.call('module.read.ahead',{});
    assert.deepEqual(opened.recovered,[{job_id:first.job_id,owner:gone,to:'queued'}]);
    assert.ok(opened.queued.includes(first.job_id));
    let [job]=await book.mapJobs();
    assert.deepEqual([job.state,job.foreground],['queued',false]);
    // A live owner is left alone: its reader may still publish by the persisted token (§112).
    const live=await book.claim(`host-${process.pid}`);
    assert.equal(live.job_id,first.job_id);
    await book.reopen();
    assert.equal((await book.call('module.read.ahead',{})).recovered,undefined);
    [job]=await book.mapJobs();
    assert.equal(job.state,'running');
    // That owner's read is refused and settles; an explicit retry re-reads, and its orphan fails instead of looping.
    await book.fail(live,'the region boxes were off the printed markers');
    const retried=await book.call('module.read.request',{purpose:'detail',material:'map',focus:'tower',question:TOWER_QUESTION,retry:true});
    assert.equal(retried.state,'queued');
    assert.deepEqual(await book.settled(),[]);
    // The open also queued the Dock's exit (the Tower's text) ahead of the retry; that reader goes first and is stopped.
    const text=await book.claim('test-host');
    assert.deepEqual([text.focus,text.material],['tower',undefined]);
    await book.call('module.read.finish',{job_id:text.job_id,lease:text.lease,outcome:'cancelled'});
    const again=await book.claim(gone);
    assert.equal(again.job_id,retried.job_id);
    await book.reopen();
    assert.deepEqual((await book.call('module.read.ahead',{})).recovered,[{job_id:again.job_id,owner:gone,to:'failed'}]);
    assert.deepEqual((await book.mapJobs()).map(entry=>entry.state),['failed','failed']);
    const [row]=await book.settled();
    assert.deepEqual([row.status,row.reason],['unusable','the region boxes were off the printed markers']);
    await reading.close();
  } finally {await book.close();}
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

test('a bound PDF self-enqueues one background index when the reader first claims work', async () => {
  const require=createRequire(import.meta.url),flock=promisify(require('fs-ext').flock);
  const workspace=join(evidence,'auto-index'),path=join(evidence,'auto-index.pdf'),sourceBytes=Buffer.from('%PDF-1.7\nindex queue fixture\n');
  await writeFile(path,sourceBytes);
  const context=await api.createKernelContext({workspace,content:join(ROOT,'content'),locks:api.createAdvisoryLocks(flock)}),runtime=api.createModuleRuntime(context);
  try {
    const {module_id}=await runtime.handlers['module.source.bind']({source:{path,page_count:2,file_sha256:createHash('sha256').update(sourceBytes).digest('hex')}});
    const first=await runtime.handlers['module.read.claim']({module_id,owner:'index-owner'});
    assert.equal(first.purpose,'index');assert.equal(first.foreground,false);assert.equal(first.focus,'');assert.deepEqual(first.pages,[]);
    const queue=await runtime.source.store.queue(module_id);
    assert.equal(queue.filter(job=>job.purpose==='index').length,1);
  } finally {await runtime.close();await context.git.close();}
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

test('a matching persisted reading lease may publish after the kernel process restarts', async t => {
  const require = createRequire(import.meta.url), flock = promisify(require('fs-ext').flock);
  const workspace = join(evidence, 'cold-finish'), path = join(evidence, 'cold-finish.pdf');
  const sourceBytes = Buffer.from('%PDF-1.7\ncold publication fixture\n');
  await writeFile(path, sourceBytes);
  const context = await api.createKernelContext({ workspace, content: join(ROOT, 'content'), locks: api.createAdvisoryLocks(flock) });
  const first = api.createModuleRuntime(context), second = api.createModuleRuntime(context);
  const ok = (owner, method, params) => owner.handlers[method](params);
  try {
    const { module_id } = await ok(first, 'module.source.bind', { source: { path, page_count: 2, file_sha256: createHash('sha256').update(sourceBytes).digest('hex') } });
    await ok(first, 'module.read.request', { module_id, purpose: 'index' });
    const job = await ok(first, 'module.read.claim', { module_id, owner: 'first-owner' });
    const draft = { title: 'Book', language: 'en', sections: [{ name: 'Opening', pages: [[1, 2]], source_refs: [{ page: 1 }] }] };
    const observations = { file_sha256: job.source.file_sha256, read_pages: [1, 2], full_pages: [1, 2], review_pages: [] };
    for (const [name, value] of [['draft', draft], ['observations', observations], ['review', {}]]) await writeFile(join(job.work_dir, name + '.json'), api.pythonJsonDumps(value));
    const params = { module_id, job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json') };
    await first.close();
    const result = await ok(second, 'module.read.finish', params);
    assert.equal(result.state, 'preparing');
    assert.equal((await second.source.store.module(module_id)).reading.index_complete, true);
  } finally { await first.close(); await second.close(); await context.git.close(); }
});


test('remaining indexed units advance in the existing queue across restart and promotion',async()=>{
 const book=await mapBook('background-source-units');
 try{
  const meta=await book.store().module(book.mid);meta.reading.opening_scope='first_interaction';
  await book.store().writeModule(meta);
  await book.call('module.read.ahead',{});
  let queue=await book.store().queue(book.mid),units=queue.filter(job=>job.source_unit);
  assert.equal(units.length,1,'an unrepresented indexed source range must have a consumer');
  const unit=units[0];assert.deepEqual(unit.source_unit,{section:'Harbor and tower',first:1,last:2});
  await book.reopen();await book.call('module.read.ahead',{});
  assert.equal((await book.store().queue(book.mid)).filter(job=>job.source_unit).length,1,'restart must not duplicate the same unit');
  const demand=await book.call('module.read.request',{purpose:'detail',focus:unit.focus,question:unit.question,source_unit:unit.source_unit,foreground:true});
  assert.equal(demand.job_id,unit.job_id);
  const claimed=await book.claim('test-host');assert.equal(claimed.job_id,unit.job_id);
  assert.deepEqual(claimed.review_scope_pages,[1,2]);
  const draft={nodes:[],claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:[]};
  assert.throws(()=>api.checkDraft(clone(draft),claimed,contract,new Set([1])),/assigned original pages/);
  assert.ok(api.checkDraft(clone(draft),claimed,contract,new Set([1,2])).required_review.includes('/coverage'));
  await book.publish(claimed,draft);
  await book.call('module.read.ahead',{});
  queue=await book.store().queue(book.mid);units=queue.filter(job=>job.source_unit);
  assert.equal(units.length,1);assert.equal(units[0].state,'completed');
 }finally{await book.close();}
});


test('module logic review admits parameter differences but still blocks broken causal links and invalid data',()=>{
 const scoped={...packet,review_policy:'module-logic-v1'},draft=clone(base);
 const filled=api.checkDraft(draft,scoped,contract,new Set([1]));
 assert.ok(!filled.required_review.some(path=>path.endsWith('/STR')),'module review does not retranscribe every numeric leaf');
 const checked=filled.required_review.map(path=>({path,verdict:'supported',reason:'Logical role and link are coherent.',source_refs:refs}));
 checked.push({path:'/nodes/1/properties/mechanics/profile/characteristics/STR',verdict:'unsupported',impact:'parameter',reason:'A harmless module parameter difference.',source_refs:refs});
 const judged=api.checkReview(draft,filled,{checked,missing:[]},2,new Set([1]));
 assert.equal(judged.contested.at(-1).impact,'parameter');
 assert.throws(()=>api.checkReview(draft,filled,{checked:[...checked,{path:'/claims/0',verdict:'unsupported',impact:'logic',reason:'Wrong person is placed here.',source_refs:refs}],missing:[]},2,new Set([1])),/unsupported/);
 assert.throws(()=>api.checkReview(draft,filled,{checked,missing:[{impact:'logic',description:'The clue has no correct target.'}]},2,new Set([1])),/missing or incorrect/);
 assert.throws(()=>api.checkReview(draft,filled,{checked:[{path:'/nodes/1',verdict:'unsupported',impact:'logic',reason:'Wrong identity.',source_refs:refs}],missing:[]},2,new Set([1]),()=>true),/unsupported/,'old classification tolerance cannot waive a declared logic conflict');
 const invalid=clone(base);invalid.nodes[1].properties.mechanics.profile.characteristics.STR='many';
 assert.throws(()=>api.checkDraft(invalid,scoped,contract,new Set([1])),/numeric|number|integer|shape|prose/);
});

test('module rereading maps a differing source parameter without changing an established value',()=>{
 const meta={id:'book-1',title:'Book',source:'pdf',reading:{materials:[{node_ids:['scene-dock','npc-witness']}]}},scoped={...packet,review_policy:'module-logic-v1'};
 const first=api.checkDraft(clone(base),scoped,contract,new Set([1]));
 const original=api.assembleVisual(null,first,meta,contract);
 const changed=clone(base);changed.nodes[1].properties.mechanics.profile.characteristics.STR=55;changed.nodes[1].source_refs=[{page:2}];
 const known=original.nodes.map(node=>({...node,ready:true,source_refs:node.source_refs.map(ref=>({page:Number(ref.pdf_index)+1}))}));
 const second=api.checkDraft(changed,{...scoped,known_nodes:known,known_claims:[],field_spans:original.field_spans},contract,new Set([1,2]));
 const mapped=api.assembleVisual(original,second,meta,contract);
 assert.equal(mapped.nodes.find(node=>node.node_id==='npc-witness').properties.mechanics.profile.characteristics.STR,50);
 const mapping=mapped.source_mappings.find(row=>row.path.endsWith('/STR'));
 assert.equal(mapping.established_value,50);assert.equal(mapping.source_value,55);
 api.recordContested(mapped,second,{supported:new Set(),contested:[{path:'/nodes/1/properties/mechanics/profile/characteristics/STR',verdict:'unsupported',impact:'parameter',reason:'Reference differs.',source_refs:[{page:2}]}]},'book-1','read-2',2);
 assert.equal(mapped.contested['/nodes/npc-witness/properties/mechanics/profile/characteristics/STR'].value,50);
 const view=new api.ModuleGraph('book-1',mapped,'',contract.graph.actor_dossier);
 assert.equal(view.entityView(view.find('Witness')).source_mappings[0].established_value,50);
});


test('module answer review treats numerical differences as advisory and causal contradictions as blocking',()=>{
 const draft={status:'answered',answer:'The witness waits at the dock.',source_refs:refs,limitations:''};
 const packet={source:{page_count:2},review_policy:'module-logic-v1'};
 const review={checked:[{paths:['/status','/answer','/source_refs','/limitations'],verdict:'contradicted',impact:'parameter',source_refs:refs,reason:'A stated module amount differs.'}],missing:[]};
 assert.doesNotThrow(()=>api.checkSourceAnswerReview(draft,review,packet,new Set([1])));
 assert.equal(api.sourceAnswerResult(draft,'book-1',packet,review).source_variations.length,1);
 review.checked[0].impact='logic';
 assert.throws(()=>api.checkSourceAnswerReview(draft,review,packet,new Set([1])),/independent answer review found/);
});

test('a previously pinned campaign NPC profile survives a later module profile',()=>{
 const pinned={characteristics:{STR:40},derived:{HP:10},skills:{Listen:30},weapons:[]};
 const graph={actor:()=>({node_id:'npc-witness',node_kind:'npc'}),mechanicsOf:()=>({profile:{characteristics:{STR:60},derived:{HP:15},skills:{Listen:50},weapons:[]}})};
 const result=api.npcProfileOf(graph,{npc_profiles:{witness:pinned},npc_resources:{witness:{current_hp:7}}},'witness');
 assert.equal(result.characteristics.STR,40);assert.equal(result.derived.HP,10);assert.equal(result.hp_current,7);
});

test('original-context readiness opens setup before graph completion and queues independent page fragments',async()=>{
 const require=createRequire(import.meta.url),flock=promisify(require('fs-ext').flock),workspace=join(evidence,'reference-context');
 const pdf=join(evidence,'reference-context.pdf'),pdfBytes=Buffer.from('%PDF-1.7\nreference-context fixture\n'),sha=value=>createHash('sha256').update(value).digest('hex');await writeFile(pdf,pdfBytes);
 const context=await api.createKernelContext({workspace,content:join(ROOT,'content'),locks:api.createAdvisoryLocks(flock)}),runtime=api.createModuleRuntime(context);
 try{
  const mid=(await runtime.handlers['module.source.bind']({source:{path:pdf,page_count:6,file_sha256:sha(pdfBytes)}})).module_id;
  const dir=join(runtime.source.store.moduleDir(mid),'work','source-reference-fixture');await mkdir(dir,{recursive:true});
  const text='Harbor in 1925. Choose your own investigator.',span={id:'p3-0-43',page:3,start:0,end:text.length,text};
  const packet={protocol:'source-reference-v1',source_sha256:sha(pdfBytes),extraction_version:'fixture',purpose:'guidance',question:'Start',excerpts:[span],fields:Object.fromEntries(['era','place','premise','advice','warnings','opening'].map(key=>[key,[span.id]])),entries:[{id:'scene-source-entry-3',name:'Harbor',page:3}],partial:true,visual_coverage:'unassessed',unavailable_pages:[]};
  const task=JSON.stringify({purpose:'guidance',source_reference:'guidance'}),body=JSON.stringify(packet),guide='Harbor in 1925. Choose your own investigator.';
  await writeFile(join(dir,'task.json'),task);await writeFile(join(dir,'source-reference.json'),body);await writeFile(join(dir,'reference-guidance.txt'),guide);
  const public_fields=Object.fromEntries(['era','starting_place','public_premise','creation_advice'].map(key=>[key,{status:'value',text:guide,source_refs:[{page:3}]}]));
  const checks=Object.fromEntries(['wrong_orientation','card_restriction','advice_omission','warning_omission','plot_disclosure','causal_conflict'].map(key=>[key,{status:'answered',type:'noul',noul:0}]));
  await writeFile(join(dir,'source-reference-complete.json'),JSON.stringify({protocol:'source-reference-v1',kind:'guidance',source_sha256:sha(pdfBytes),task_sha256:sha(task),packet_sha256:sha(body),text_sha256:sha(guide),checks_policy:'material-issues-v1',checks,public_fields}));
  const result=await runtime.handlers['module.reference.publish']({module_id:mid,work_dir:dir,guidance_key:'d'.repeat(64),play_language:'en'});
  assert.equal(result.setup_ready,true);assert.equal(result.graph_complete,false);
  assert.equal((await runtime.handlers['module.status']({module_id:mid})).opening_ready,false);
  assert.equal(await runtime.source.openingReady(mid,'Harbor'),true);
  await runtime.handlers['module.read.ahead']({module_id:mid,focus:'Harbor'});
  const jobs=(await runtime.source.store.queue(mid)).filter(job=>job.reference_fragment);
  assert.equal((await runtime.source.store.queue(mid)).filter(job=>job.visual_scan).length,1,'the fast reference path also queues visual discovery');
  assert.deepEqual(jobs.map(job=>[job.source_unit.first,job.source_unit.last]),[[3,4],[5,6]]);
  const first=await runtime.handlers['module.read.claim']({module_id:mid,owner:'test'});assert.equal(first.reference_fragment,true);assert.deepEqual(first.pages,[3,4]);
  assert.equal((await runtime.handlers['module.reference.status']({module_id:mid})).ready,true,'background work cannot revoke original-context access');
  const lookup=JSON.stringify({...packet,purpose:'answer',places:[{id:'scene-source-place-3-0',name:'Harbor Station',page:3}]}),lookupTask=JSON.stringify({purpose:'answer',materialize_place:true});
  await writeFile(join(dir,'task.json'),lookupTask);await writeFile(join(dir,'source-reference.json'),lookup);
  await writeFile(join(dir,'source-reference-complete.json'),JSON.stringify({protocol:'source-reference-v1',kind:'excerpts',source_sha256:sha(pdfBytes),task_sha256:sha(lookupTask),packet_sha256:sha(lookup)}));
  const material=await runtime.handlers['module.reference.materialize']({module_id:mid,work_dir:dir});
  assert.equal(material.state,'ready');assert.equal(await runtime.source.materialReady(mid,'Harbor Station'),true);
  assert.equal((await runtime.source.store.readGraph(mid)).nodes.find(node=>node.name==='Harbor Station').summary,text,'no source paraphrase is generated');
  assert.equal((await runtime.handlers['module.reference.materialize']({module_id:mid,work_dir:dir})).reused,true,'later calls preserve the established identity');
  const originalScene=(await runtime.source.store.readGraph(mid)).nodes.find(node=>node.name==='Harbor Station');
  const unready=await runtime.source.store.module(mid);unready.reading.materials=unready.reading.materials.filter(material=>!material.node_ids?.includes(originalScene.node_id));await runtime.source.store.writeModule(unready);
  assert.equal(await runtime.source.materialReady(mid,'Harbor Station'),false);
  assert.equal((await runtime.handlers['module.reference.materialize']({module_id:mid,work_dir:dir})).state,'ready','original evidence admits an existing partial scene');
  assert.deepEqual((await runtime.source.store.readGraph(mid)).nodes.find(node=>node.name==='Harbor Station'),originalScene,'existing scene fields are not rewritten');
  // An existing library graph receives references without being replaced or reseeding source people.
  const legacy=await runtime.source.store.module(mid),oldGraph=await runtime.source.store.readGraph(mid);
  const oldEntry=oldGraph.nodes.find(node=>node.name==='Harbor');oldEntry.node_id='scene-established-harbor';oldEntry.summary='Existing authored opening description.';
  oldGraph.entry_scene_ids=[oldEntry.node_id];
  const conditional={node_id:'npc-conditional',node_kind:'npc',name:'Conditional Visitor',summary:'Appears only if the investigators refuse the hook.',properties:{},source_refs:oldEntry.source_refs};
  oldGraph.nodes.push(conditional);oldGraph.relations.push({relation_kind:'present-in',from_node_id:conditional.node_id,to_node_id:oldEntry.node_id});
  delete legacy.source_reference;legacy.character_guidance={};legacy.opening_choice={start_scene:oldEntry.node_id};
  await runtime.source.store.writeGraph(legacy,oldGraph);await runtime.source.store.writeModule(legacy);
  await writeFile(join(dir,'task.json'),task);await writeFile(join(dir,'source-reference.json'),body);
  await writeFile(join(dir,'source-reference-complete.json'),JSON.stringify({protocol:'source-reference-v1',kind:'guidance',source_sha256:sha(pdfBytes),task_sha256:sha(task),packet_sha256:sha(body),text_sha256:sha(guide),checks_policy:'material-issues-v1',checks,public_fields}));
  const upgraded=await runtime.handlers['module.reference.publish']({module_id:mid,work_dir:dir,guidance_key:'d'.repeat(64),play_language:'en'});
  assert.equal(upgraded.setup_ready,true);assert.equal(await runtime.source.openingReady(mid,'established-harbor'),true);
  const preserved=await runtime.source.store.readGraph(mid);
  assert.equal(preserved.nodes.filter(node=>node.name==='Harbor').length,1);
  assert.deepEqual(preserved.nodes.find(node=>node.node_id===oldEntry.node_id),oldEntry);
  assert.equal(await runtime.source.materialReady(mid,'Harbor Station'),true,'republishing guidance preserves previously prepared original places');
  const kernel=await api.createKernelRuntime(context);
  try{await kernel.handlers['campaign.create']({id:'reference-campaign',title:'Reference campaign',module:mid,play_language:'en',start_scene:'Harbor'});
   const world=JSON.parse(await readFile(join(workspace,'.coc/campaigns/reference-campaign/world.json'),'utf8'));
   assert.deepEqual(world.npc_presence,{},'source-linked conditional people are candidates, not current presence');
  }finally{await kernel.close();}
  const meta=await runtime.source.store.module(mid);await writeFile(join(runtime.source.store.moduleDir(mid),meta.source_reference.packet_file),'{}');
  assert.equal((await runtime.handlers['module.reference.status']({module_id:mid})).ready,false,'modified evidence cannot keep reference readiness');
 }finally{await runtime.close();await context.git.close();}
});

test('old multiple-entry reference packets still require an explicit opening choice',async()=>{
 const dir=join(evidence,'old-multiple-reference');await mkdir(dir,{recursive:true});
 const spans=[{id:'p1',page:1,start:0,end:5,text:'First'},{id:'p2',page:2,start:0,end:6,text:'Second'}];
 const packet={protocol:'source-reference-v1',source_sha256:'a'.repeat(64),extraction_version:'fixture',purpose:'guidance',question:'Start',excerpts:spans,
  fields:Object.fromEntries(['era','place','premise','advice','warnings','opening'].map(key=>[key,spans.map(span=>span.id)])),
  entries:spans.map(span=>({id:'scene-source-entry-'+span.page,name:span.text,page:span.page})),partial:true,visual_coverage:'unassessed',unavailable_pages:[]};
 const body=JSON.stringify(packet);await writeFile(join(dir,'packet.json'),body);
 const meta={page_count:2,file_sha256:packet.source_sha256,source_reference:{protocol:packet.protocol,source_sha256:packet.source_sha256,packet_file:'packet.json',packet_sha256:createHash('sha256').update(body).digest('hex')}};
 const store={module:async()=>meta,moduleDir:()=>dir};
 assert.equal(await api.referenceReady(store,'book'),false);
 assert.equal(await api.referenceReady(store,'book','Second'),true);
});

test('a background fragment publishes supported facts while an unfinished entity stays explicitly unready',()=>{
 const draft=clone(base);draft.ready_nodes=['scene-dock'];draft.source_needs=[{kind:'source_read',focus:'Witness',question:'What is the later connection?',reason:'The original page continues in another fragment.',trigger:'Before relying on that connection.',source_refs:refs}];
 const scoped={...packet,purpose:'detail',source_unit:{section:'Original page 1',first:1,last:1},pages:[1]};
 assert.equal(api.checkDraft(draft,scoped,contract,new Set([1])).source_needs[0].kind,'source_read');
 assert.throws(()=>api.checkDraft({...draft,ready_nodes:['scene-dock','npc-witness']},scoped,contract,new Set([1])),/unresolved entity ready/);
 assert.throws(()=>api.checkDraft(draft,{...packet,purpose:'detail'},contract,new Set([1])),/source needs remain unresolved/);
});

test('the real source checker reports assigned pages before submission verifies delivered images',async()=>{
 const folder=join(evidence,'source-unit-command');await mkdir(folder,{recursive:true});
 const candidate={nodes:[],claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:[]};
 const task={...packet,purpose:'detail',pages:[1,2],source_unit:{section:'Two pages',first:1,last:2}};
 await writeFile(join(folder,'task.json'),JSON.stringify(task));await writeFile(join(folder,'draft.json'),JSON.stringify(candidate));
 const run=spawnSync(join(ROOT,'bin/coc-read-check'),['--packet',join(folder,'task.json'),'--draft',join(folder,'draft.json')],{encoding:'utf8'});
 assert.equal(run.status,0,run.stdout||run.stderr);assert.deepEqual(JSON.parse(run.stdout).required_view_pages,[1,2]);
 assert.throws(()=>api.checkDraft(candidate,task,contract,new Set([1])),/assigned original pages/);
});

// §151.4 (ticket 04): need-driven background reads locate first. The host's Jev decisions arrive as the `settled`
// finish the reading service sends; these cases hold the kernel's half -- marker, packet, disposition, eligibility, order.
const NEED_Q='Any later appendix combat profile for Lena if printed separately';
async function needBook(name){
 const require=createRequire(import.meta.url),flock=promisify(require('fs-ext').flock);
 const workspace=join(evidence,name),path=join(evidence,`${name}.pdf`),bytes=Buffer.from(`%PDF-1.7\n${name} need fixture\n`);
 await writeFile(path,bytes);
 const context=await api.createKernelContext({workspace,content:join(ROOT,'content'),locks:api.createAdvisoryLocks(flock)});
 const sha=createHash('sha256').update(bytes).digest('hex'),all=[1,2,3,4];
 const book={context,runtime:api.createModuleRuntime(context),mid:null};
 const call=(method,params)=>book.runtime.handlers[method]({module_id:book.mid,...params});
 Object.assign(book,{call,store:()=>book.runtime.source.store,claim:owner=>call('module.read.claim',{owner}),
  close:async()=>{await book.runtime.close();await context.git.close();},
  queue:()=>book.store().queue(book.mid),meta:()=>book.store().module(book.mid),graph:()=>book.store().graph(book.mid),
  settle:(job,need)=>call('module.read.finish',{job_id:job.job_id,lease:job.lease,outcome:'settled',need}),
  publish:async(job,draft)=>{
   await writeFile(join(job.work_dir,'observations.json'),JSON.stringify({file_sha256:sha,read_pages:all,full_pages:all,review_pages:all}));
   await writeFile(join(job.work_dir,'draft.json'),JSON.stringify(draft));
   const checked=job.purpose==='index'?[]:api.checkDraft(clone(draft),job,contract,new Set(all)).required_review;
   await writeFile(join(job.work_dir,'review.json'),JSON.stringify({checked:[{paths:checked,verdict:'supported',source_refs:[{page:1}],reason:'fixture support'}],missing:[]}));
   return call('module.read.finish',{job_id:job.job_id,lease:job.lease,outcome:'completed',draft_path:join(job.work_dir,'draft.json'),review_path:join(job.work_dir,'review.json')});
  }});
 book.mid=(await book.runtime.handlers['module.source.bind']({source:{path,page_count:4,file_sha256:sha}})).module_id;
 await book.publish(await book.claim('test-host'),{title:'The Harbor',language:'en',map_candidates:[],
  sections:[{name:'Harbor',pages:[[1,2]],entities:['Dock','Lena']},{name:'Tower',pages:[[3,4]],entities:['Tower']}]});
 await call('module.read.request',{purpose:'opening'});
 const nodes=[{node_id:'scene-dock',node_kind:'scene',name:'Dock',source_refs:[{page:1}],properties:{is_entrance:true}},
  {node_id:'scene-tower',node_kind:'scene',name:'Tower',source_refs:[{page:3}],summary:'An old tower beyond the harbor.',properties:{is_final:true}},
  {node_id:'npc-lena',node_kind:'npc',name:'Lena',source_refs:[{page:1}],properties:{}}];
 const claims=[['scene-dock','route-to','scene-tower'],['npc-lena','present-in','scene-dock']].map(([subject_id,predicate,node_id])=>({subject_id,predicate,object:{node_id},truth_status:'authored-fact',source_refs:[{page:1}]}));
 assert.equal((await book.publish(await book.claim('test-host'),{nodes,claims,node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:['scene-dock','npc-lena']})).opening_ready,true);
 // A detail reading of Lena retains one speculative (deferred) source need about her, cited on page 3.
 await call('module.read.request',{purpose:'detail',focus:'Lena',question:'Prepare Lena for the conversation',foreground:true});
 await book.publish(await book.claim('test-host'),{nodes:[{node_id:'npc-lena',node_kind:'npc',name:'Lena',source_refs:[{page:1}],properties:{}}],
  claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:['npc-lena'],
  source_needs:[{kind:'deferred',focus:'Lena',question:NEED_Q,reason:'Not printed on these pages.',trigger:'If a fight with Lena starts.',source_refs:[{page:3}]}]});
 return book;
}
const needReads=async book=>(await book.queue()).filter(job=>job.question===NEED_Q);

test('§151.4: a need-driven read carries its need, and an answered need closes without a reader',async()=>{
 const book=await needBook('need-answered');
 try{
  await book.call('module.read.ahead',{});
  const [pending]=await needReads(book);
  assert.ok(pending?.source_need?.key,'the read-ahead marks a need-driven read');assert.equal(pending.foreground,false);
  const claimed=await book.claim('test-host');
  assert.equal(claimed.job_id,pending.job_id);
  assert.equal(claimed.source_need.question,NEED_Q);assert.deepEqual(claimed.source_need.source_refs,[{page:3}]);
  assert.deepEqual(claimed.source_need.accepted_pages,[1],'the pages its node and the claims about it cite');
  assert.deepEqual(claimed.source_need.unread_units,[],'this book streams no source units');
  assert.match(claimed.source_need.material_digest,/^[a-f0-9]{64}$/);
  const generation=(await book.meta()).generation;
  const settled=await book.settle(claimed,{disposition:'answered',distribution:{noul:0.93},gate:0.85,material_digest:claimed.source_need.material_digest});
  assert.deepEqual([settled.state,settled.source_need.disposition],['settled','answered']);
  const graph=await book.graph();
  assert.equal(graph.sourceNeeds(graph.find('Lena')).some(need=>need.question===NEED_Q),false,'the answered need is closed');
  const meta=await book.meta(),resolved=meta.reading.resolved_source_needs.at(-1);
  assert.equal(meta.generation,generation+1);
  assert.deepEqual([resolved.question,resolved.resolved_by,resolved.job_id],[NEED_Q,'accepted_material',claimed.job_id]);
  assert.equal(Number(resolved.distribution.noul),0.93);
  assert.equal((await book.call('module.read.finish',{job_id:claimed.job_id,lease:claimed.lease,outcome:'failed',detail:'host finally'})).replayed,true);
  await book.call('module.read.ahead',{});
  assert.equal((await needReads(book)).length,1,'no reader was queued for an answered need');
  const keeper=await book.call('module.read.request',{purpose:'detail',focus:'Lena',question:NEED_Q,foreground:true});
  assert.equal(keeper.state,'queued','a settled attempt never answers a waiting Keeper');assert.notEqual(keeper.job_id,claimed.job_id);
  assert.equal((await book.queue()).find(job=>job.job_id===keeper.job_id).source_need,undefined);
 }finally{await book.close();}
});

test('§151.4: an unlocated need queues nothing until a publication changes its entity material',async()=>{
 const book=await needBook('need-unlocated');
 try{
  await book.call('module.read.ahead',{});
  const claimed=await book.claim('test-host');assert.equal(claimed.question,NEED_Q);
  await assert.rejects(book.settle(claimed,{disposition:'unlocated',material_digest:claimed.source_need.material_digest,
   evidence:{need_leads:[{page:3,score:0.8}],accepted_pages:[1]}}),/no page lead outside/);
  const settled=await book.settle(claimed,{disposition:'unlocated',material_digest:claimed.source_need.material_digest,
   evidence:{need_leads:[{page:1,score:0.9}],accepted_pages:[1],candidates:[1],searched_pages:4,partial:false}});
  assert.equal(settled.source_need.disposition,'unlocated');
  const record=Object.values((await book.meta()).reading.source_need_dispositions)[0];
  assert.equal(record.disposition,'unlocated');assert.deepEqual(record.evidence.need_leads.map(lead=>[lead.page,Number(lead.score)]),[[1,0.9]]);
  const graph=await book.graph();
  assert.equal(graph.sourceNeeds(graph.find('Lena')).some(need=>need.question===NEED_Q),true,'unlocated is retained, never absent');
  await book.call('module.read.ahead',{});
  assert.equal((await needReads(book)).length,1,'the same failed candidate set is not read again');
  // A publication that gives Lena a page of her own re-opens the need.
  await book.call('module.read.request',{purpose:'detail',focus:'Tower',question:'Who waits in the tower?',foreground:true});
  const tower=await book.claim('test-host');assert.equal(tower.focus,'Tower');
  await book.publish(tower,{nodes:[{node_id:'scene-tower',node_kind:'scene',name:'Tower',source_refs:[{page:3}],properties:{}}],
   claims:[{subject_id:'npc-lena',predicate:'present-in',object:{node_id:'scene-tower'},truth_status:'authored-fact',source_refs:[{page:3}]}],
   node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:['scene-tower']});
  await book.call('module.read.ahead',{});
  const reads=await needReads(book);
  assert.equal(reads.length,2);assert.equal(reads[1].state,'queued');assert.equal(reads[1].source_need.key,claimed.source_need.key);
 }finally{await book.close();}
});

test('§151.4: a speculative need waits for the unit frontier, rides on an unread unit, and re-opens once it settles',async()=>{
 const book=await needBook('need-carried');
 try{
  const meta=await book.meta();meta.reading.opening_scope='first_interaction';await book.store().writeModule(meta);
  await book.call('module.read.ahead',{});
  assert.equal((await book.queue()).filter(job=>job.source_unit).length,1);
  assert.equal((await needReads(book)).length,0,'a deferred need waits while a streamed unit is unqueued');
  await book.call('module.read.ahead',{});
  assert.equal((await book.queue()).filter(job=>job.source_unit).length,2);
  const [pending]=await needReads(book);assert.ok(pending?.source_need);
  // The scene's adjacent read was queued first; it gives its slot back so the need read and both units can be claimed.
  let claimed=await book.claim('test-host');
  if(claimed.job_id!==pending.job_id){
   assert.equal(claimed.source_unit,undefined);
   await book.call('module.read.finish',{job_id:claimed.job_id,lease:claimed.lease,outcome:'cancelled'});
   claimed=await book.claim('test-host');
  }
  assert.equal(claimed.job_id,pending.job_id);
  assert.deepEqual(claimed.source_need.unread_units.map(unit=>[unit.first,unit.last]).sort(),[[1,2],[3,4]]);
  const unit=claimed.source_need.unread_units.find(unit=>unit.first===3);
  await assert.rejects(book.settle(claimed,{disposition:'carried',units:[unit],evidence:{need_leads:[{page:1,score:0.9}],accepted_pages:[1]}}),/located only inside/);
  await assert.rejects(book.settle(claimed,{disposition:'carried',units:[{section:'Elsewhere',first:3,last:4}],evidence:{need_leads:[{page:3,score:0.8}],accepted_pages:[1]}}),/streams/);
  assert.equal((await book.settle(claimed,{disposition:'carried',units:[unit],evidence:{need_leads:[{page:3,score:0.8}],accepted_pages:[1]}})).source_need.disposition,'carried');
  const units=[await book.claim('test-host'),await book.claim('test-host')];
  const carrier=units.find(job=>job.source_unit?.first===3),other=units.find(job=>job.source_unit?.first===1);
  assert.deepEqual(carrier.carried_needs,[{key:pending.source_need.key,focus:'lena',question:NEED_Q}],'the unit reader is asked the need');
  assert.equal(other.carried_needs,undefined);
  await book.call('module.read.ahead',{});
  assert.equal((await needReads(book)).length,1,'no separate read while the carrying unit reads');
  await book.publish(carrier,{nodes:[],claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:[]});
  await book.call('module.read.ahead',{});
  const reads=await needReads(book);
  assert.equal(reads.length,2,'the carrying unit settled: the need is checked again');assert.equal(reads[1].state,'queued');
 }finally{await book.close();}
});

// §195.2 (TR-F read-55..70): once the read-ahead has read the pages a deferred need's leads name, a read of them for that
// need is a repeat. The claim packet names the pages already read; the reader settles `waits_for_play`; the read-ahead never
// asks the need again, so it reads nothing twice and publishes nothing, while a page no reading covered still reads.
test('§195.2: a deferred need located on pages the read-ahead already read waits for play and is not asked again',async()=>{
 const book=await needBook('need-waits-for-play');
 try{
  const meta=await book.meta();meta.reading.opening_scope='first_interaction';await book.store().writeModule(meta);
  await book.call('module.read.ahead',{});
  // The first unit is read and published before the last one is asked (one unit per pass).
  let unit=await book.claim('test-host');
  while(!unit.source_unit){await book.call('module.read.finish',{job_id:unit.job_id,lease:unit.lease,outcome:'cancelled'});unit=await book.claim('test-host');}
  const done=unit.source_unit,readPages=[done.first,done.first+1],other=done.first===1?3:1;
  // A lead on a read page the entity's material does not cite (page 1 is its accepted page), and one on the unread unit.
  const readLead=readPages.find(page=>page!==1),unreadLead=other===1?2:other;
  await book.publish(unit,{nodes:[],claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:[]});
  await book.call('module.read.ahead',{});
  const [pending]=await needReads(book);assert.ok(pending?.source_need,'asked in the pass that asks the last unit');
  const claimed=await book.claim('test-host');assert.equal(claimed.job_id,pending.job_id);
  assert.deepEqual(claimed.source_need.read_pages,readPages,'the packet names the pages a completed unit read');
  assert.deepEqual(claimed.source_need.unread_units.map(row=>[row.first,row.last]),[[other,other+1]]);
  const digest=claimed.source_need.material_digest;
  await assert.rejects(book.settle(claimed,{disposition:'waits_for_play',material_digest:digest,
   evidence:{need_leads:[{page:readLead,score:0.7},{page:unreadLead,score:0.8}],accepted_pages:[1]}}),/already read/,'a page never read: not a repeat');
  const settled=await book.settle(claimed,{disposition:'waits_for_play',material_digest:digest,
   evidence:{need_leads:[{page:readLead,score:0.7}],accepted_pages:[1],candidates:[readLead,1]}});
  assert.equal(settled.source_need.disposition,'waits_for_play');
  const record=Object.values((await book.meta()).reading.source_need_dispositions)[0];
  assert.deepEqual([record.disposition,record.kind],['waits_for_play','deferred']);
  const graph=await book.graph();
  assert.equal(graph.sourceNeeds(graph.find('Lena')).some(need=>need.question===NEED_Q),true,'the need is retained for play');
  // The last unit completes; nothing is left to read, and the need is not read again.
  const last=await book.claim('test-host');assert.equal(last.source_unit?.first,other);
  await book.publish(last,{nodes:[],claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:[]});
  await book.call('module.read.ahead',{});await book.call('module.read.ahead',{});
  assert.deepEqual((await needReads(book)).map(job=>job.state),['completed'],'the read-ahead does not ask a need that waits for play');
  // A Keeper meeting the trigger in play asks for it: a fresh read, never the settled attempt.
  const keeper=await book.call('module.read.request',{purpose:'detail',focus:'Lena',question:NEED_Q,foreground:true});
  assert.equal(keeper.state,'queued');assert.notEqual(keeper.job_id,claimed.job_id);
 }finally{await book.close();}
});

test('§195.2: only a deferred need waits for play',async()=>{
 const book=await needBook('need-waits-kind');
 try{
  await book.call('module.read.ahead',{});
  const claimed=await book.claim('test-host');assert.equal(claimed.question,NEED_Q);
  const store=book.store(),raw=await store.readGraph(book.mid);
  assert.equal(raw.source_needs.find(need=>need.question===NEED_Q).kind,'deferred');
  const queue=await store.queue(book.mid),job=queue.find(row=>row.job_id===claimed.job_id);
  job.source_need={...job.source_need,kind:'source_read'};await store.writeQueue(book.mid,queue);
  await assert.rejects(book.settle(claimed,{disposition:'waits_for_play',material_digest:claimed.source_need.material_digest,
   evidence:{need_leads:[{page:2,score:0.7}],accepted_pages:[1]}}),/only a deferred need/);
 }finally{await book.close();}
});

test('§151.4: a need read a waiting Keeper promoted reads as today and records its read',async()=>{
 const book=await needBook('need-promoted');
 try{
  await book.call('module.read.ahead',{});
  const [pending]=await needReads(book);
  const waiting=await book.call('module.read.request',{purpose:'detail',focus:'Lena',question:NEED_Q,foreground:true});
  assert.equal(waiting.job_id,pending.job_id,'the Keeper attaches to the queued need read');
  const claimed=await book.claim('test-host');assert.equal(claimed.job_id,pending.job_id);
  assert.equal(claimed.source_need,undefined,'a promoted read is not decided by the need path');
  await book.publish(claimed,{nodes:[{node_id:'npc-lena',node_kind:'npc',name:'Lena',source_refs:[{page:3}],properties:{}}],
   claims:[],node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:['npc-lena'],source_needs:[]});
  const record=Object.values((await book.meta()).reading.source_need_dispositions)[0];
  assert.deepEqual([record.disposition,record.job_id],['read',claimed.job_id]);
 }finally{await book.close();}
});

test('visual discovery is a resumable background job and cannot certify page or scene completeness',async()=>{
 const book=await mapBook('visual-discovery-queue');
 try{
  await book.call('module.read.request',{purpose:'detail',focus:'Visual assets pages 1-2',question:'Inspect visual assets',visual_scan:{first:1,last:2},foreground:false});
  await book.call('module.read.ahead',{});
  let jobs=(await book.store().queue(book.mid)).filter(job=>job.visual_scan);
  assert.equal(jobs.length,1);assert.deepEqual(jobs[0].visual_scan,{first:1,last:2});assert.equal(jobs[0].foreground,false);
  await book.reopen();await book.call('module.read.ahead',{});
  assert.equal((await book.store().queue(book.mid)).filter(job=>job.visual_scan).length,1);
  await assert.rejects(book.call('module.read.request',{purpose:'detail',focus:jobs[0].focus,question:jobs[0].question,visual_scan:jobs[0].visual_scan,foreground:true}),/background visual range/);
  const packet={purpose:'detail',visual_scan:{first:1,last:2},source:{page_count:2},known_nodes:[],known_claims:[]};
  const empty={nodes:[],claims:[],node_refs:[],ready_nodes:[],coverage:{},dependencies:[],critical:[],visual_candidates:[]};
  assert.equal(api.checkDraft(empty,packet,contract,new Set()).nodes.length,0,'empty scan publishes only navigation progress');
  const scene={node_id:'scene-new',node_kind:'scene',name:'New place',properties:{},source_refs:[{page:1}]};
  assert.throws(()=>api.checkDraft({...empty,nodes:[scene],ready_nodes:[scene.node_id]},packet,contract,new Set([1])),/nominate pages only/);
  const asset={node_id:'asset-map',node_kind:'asset',name:'Map',visibility:'revealable',source_refs:[{page:1}],properties:{image_sources:[{page:1,box:[0,0,1,1]}]}};
  const {visual_candidates,...delta}=empty,assetPacket={...packet,visual_scan:undefined,visual_asset:{page:1}};
  assert.throws(()=>api.checkDraft({...delta,nodes:[asset],ready_nodes:[asset.node_id]},assetPacket,contract,new Set()),/viewed|observed/);
  assert.ok(api.checkDraft({...delta,nodes:[asset],ready_nodes:[asset.node_id]},assetPacket,contract,new Set([1])).required_review.length>0);
  const job=await book.claim('test-host');assert.ok(job.visual_scan);
  const navigation={...empty,visual_candidates:[{page:1,kind:'map',label:'Possible map'}]};
  await assert.rejects(book.publish(job,navigation),/successfully delivered overview/);
  const observations=await json(join(job.work_dir,'observations.json'));
  await writeFile(join(job.work_dir,'observations.json'),JSON.stringify({...observations,overview_pages:[1,2]}));
  const before=await book.store().readGraph(book.mid);
  const published=await book.call('module.read.finish',{job_id:job.job_id,lease:job.lease,outcome:'completed',draft_path:join(job.work_dir,'draft.json')});
  assert.equal(published.visual_navigation,true);
  assert.deepEqual(await book.store().readGraph(book.mid),before,'navigation cannot publish source facts');
  const meta=await book.store().module(book.mid);
  assert.deepEqual(meta.reading.visual_candidates,navigation.visual_candidates);
  assert.equal(meta.reading.visual_scans['1-2'].status,'overviewed');
  await assert.rejects(book.call('module.read.request',{purpose:'detail',focus:'An unknown candidate',question:'Read it',visual_asset:{page:2}}),/published visual navigation candidate/);
  assert.equal((await book.call('module.read.request',{purpose:'detail',focus:'Map image',question:'Read the original',visual_asset:{page:1},foreground:true})).state,'queued');
 }finally{await book.close();}
});

test('an incomplete text map index cannot hide a separately discovered visual map page',async()=>{
 const book=await mapBook('visual-candidates-supplement-index');
 try{
  const meta=await book.store().module(book.mid);
  meta.reading.visual_candidates=[{page:1,kind:'map',label:'Possible plan'}];
  await book.store().writeModule(meta);
  await book.call('module.read.request',{purpose:'detail',material:'map',focus:'Tower',question:'Prepare its map',foreground:true});
  const job=await book.claim('test-host');
  assert.deepEqual(job.pages,[1,2]);
  assert.deepEqual(job.visual_hints,meta.reading.visual_candidates);
 }finally{await book.close();}
});
