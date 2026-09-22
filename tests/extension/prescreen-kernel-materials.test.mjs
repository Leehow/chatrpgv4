import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(root, '.coc', 'prescreen-kernel-materials-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `
export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {ModuleGraph} from './kernel-ts/read/module-graph.ts';
export {graphMaterialCandidates} from './kernel-ts/read/workspace-candidates.ts';
export {interleaveMaterials} from './kernel-ts/read/prescreen-materials.ts';
`, resolveDir: root, sourcefile: 'prescreen-kernel-materials-api.ts'}, outfile: join(temporary, 'api.mjs'),
  bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
const closers = [];
after(async () => {for (const close of closers) await close();});

async function tree(path) {
  const result = {};
  async function walk(current, prefix = '') {
    for (const entry of await readdir(current, {withFileTypes: true})) {
      const absolute = join(current, entry.name), relative = join(prefix, entry.name);
      if (entry.isDirectory()) await walk(absolute, relative);
      else result[relative] = createHash('sha256').update(await readFile(absolute)).digest('hex');
    }
  }
  await walk(path);
  return result;
}

async function openTable(t) {
  const home = await mkdtemp(join(temporary, `table-${t.name}-`));
  const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'prescreen-kernel-materials',
    locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context); closers.push(() => runtime.close());
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  return {call, base: join(home, '.coc', 'campaigns', 'c1')};
}

test('graph material uses complete source-owned units and interleaves entities before later fat-entity units',()=>{
  const graph=new api.ModuleGraph('fixture',{nodes:[
    {node_id:'scene-fat',node_kind:'scene',name:'Fat scene',summary:'A large scene',properties:{description:'A'.repeat(7000),condition:'Door locked'},
      source_refs:[{page:1}]},{node_id:'npc-knott',node_kind:'npc',name:'Knott',summary:'Landlord',properties:{agenda:'Restore the house name'},source_refs:[{page:2}]}],
    relations:[{relation_id:'rel-1',relation_kind:'present-at',from_node_id:'npc-knott',to_node_id:'scene-fat',evidence_span_ids:[]}]},'fixture',{}),scope={campaign:'c1',worldline:'main',loop:0},
    groups=[...graph.nodes.values()].map(node=>api.graphMaterialCandidates(graph,node,scope,'a'.repeat(64),true)),rows=api.interleaveMaterials(groups);
  assert.equal(rows[0].coverage.unit.kind,'identity');assert.equal(rows[1].coverage.unit.kind,'identity','every entity identity precedes a second unit from a fat entity');
  assert.equal(new Set(rows.map(row=>row.key)).size,rows.length);
  for(const row of rows){if(row.body!==undefined){assert.doesNotThrow(()=>JSON.parse(row.body));assert(Buffer.byteLength(row.body)<=4096);}
    else{assert(row.coverage.omitted.includes('unit_body_too_large'));assert(row.coverage.unknown.includes('unit_materialization'));}
    assert.equal(row.coverage.entity_complete,false);assert(Array.isArray(row.coverage.dependencies));}
});

test('v2 catalog supplies actual graph and committed-record content with dependency revisions', async t => {
  const {call, base} = await openTable(t);
  await call('table.player_input', {text: 'I inspect the commission papers.'});
  await call('table.narrate', {call_id: 't1-c1', text: 'The signed commission names the Corbitt house in ink.'});
  await call('table.player_input', {text: 'I compare that address with the room around me.'});

  const before = await tree(base), result = await call('table.workspace.read', {query: 'commission room address',
    preselect: {version: 2, mode: 'catalog', limit: 128}});
  assert.equal(result.status, 'valid');
  assert.equal(result.materials.version, 2);
  for (const name of ['memory_revision', 'npc_revision', 'records_revision', 'catalog_revision'])
    assert.match(String(result.binding[name]), /^[a-f0-9]{64}$/, `${name} is a real dependency revision`);

  const record = result.materials.candidates.find(row => row.kind === 'committed_record');
  assert(record, 'a committed narrate record is selectable material');
  assert.match(record.body, /The signed commission names the Corbitt house in ink/);
  assert.equal(record.authority, 'table_record');

  const graphRows=result.materials.candidates.filter(row=>row.kind==='graph_entity'),identity=graphRows.find(row=>row.coverage?.unit?.kind==='identity'),
    authored=graphRows.find(row=>String(row.coverage?.unit?.kind).startsWith('authored:')&&row.body);
  assert(identity&&authored,'graph material carries complete identity and authored source units rather than one generic summary');
  assert.equal(authored.authority,'module_source');assert.ok(JSON.parse(authored.body).authored);assert.equal(authored.coverage.entity_complete,false);

  const investigator = result.materials.candidates.find(row => row.kind === 'investigator');
  assert.deepEqual({method: investigator?.method, params: investigator?.params},
    {method: 'table.look', params: {focus: 'investigator', name: '托马斯·海斯'}});
  const memory = result.materials.candidates.find(row => row.kind === 'memory');
  assert.deepEqual({method: memory?.method, params: memory?.params},
    {method: 'memory.evidence', params: {action: 'snapshot', query: 'commission room address', filters: {}}});
  assert.equal(result.materials.candidates.find(row => row.kind === 'session')?.method, 'table.look');

  assert.ok(result.materials.coverage.committed_record.emitted >= 1);
  assert.ok(result.materials.coverage.graph_entity.inspected >= result.materials.coverage.graph_entity.emitted);
  assert.deepEqual(await tree(base), before, 'host-only catalog materialization writes no campaign state');
});

test('v2 catalog supplies rule clauses and discovers printed catalog rows without an inventory instance', async t => {
  const {call} = await openTable(t);
  await call('table.player_input', {text: 'I need the core check rule.'});
  const rules = await call('table.workspace.read', {query: 'rule:coc7:combat:armor-reduction',
    preselect: {version: 2, mode: 'catalog', limit: 128}});
  const clause = rules.materials.candidates.find(row => row.kind === 'rule_clause' && row.body);
  assert(clause, `a rule query yields actual clause material: ${JSON.stringify(rules.materials.candidates.filter(row => row.kind === 'rule_clause'))}`);
  const body = JSON.parse(clause.body);
  assert.ok(Array.isArray(body.source_group) && body.source_group.length > 0);
  assert.ok(Array.isArray(body.relations));
  assert.equal(clause.authority, 'rules_source');

  const printed = await call('table.workspace.read', {query: '.45 Automatic',
    preselect: {version: 2, mode: 'catalog', limit: 128}});
  const row = printed.materials.candidates.find(value => value.kind === 'catalog_record' && value.data?.name === '.45 Automatic'
    && value.data?.source?.table === 'weapons.json');
  assert(row, 'printed catalog discovery is independent of registered world objects');
  assert.equal(row.data.source.table, 'weapons.json');
  assert.equal(printed.materials.candidates.some(value => value.kind === 'object' && value.label.includes('.45 Automatic')), false);
});

test('v2 read accepts only current issued keys and check validates material dependencies', async t => {
  const {call} = await openTable(t);
  await call('table.player_input', {text: 'I inspect the commission.'});
  const catalog = await call('table.workspace.read', {query: 'commission',
    preselect: {version: 2, mode: 'catalog', limit: 128}});
  const selected = catalog.materials.candidates.find(value => value.kind === 'graph_entity');
  const read = await call('table.workspace.read', {query: 'commission', binding: catalog.binding,
    preselect: {version: 2, mode: 'read', keys: [selected.key], limit: 8}});
  assert.deepEqual(read.materials.candidates.map(value => value.key), [selected.key]);
  assert.equal(typeof read.materials.candidates[0].body, 'string');

  const checked = await call('table.workspace.read', {query: 'commission', binding: catalog.binding,
    preselect: {version: 2, mode: 'check'}});
  assert.equal(checked.materials.check.status, 'current');
  assert.deepEqual(checked.materials.candidates, []);

  const graphStillCurrent = await call('table.workspace.read', {query: 'commission',
    binding: {...catalog.binding, npc_revision: '0'.repeat(64)},
    preselect: {version: 2, mode: 'check', keys: [selected.key]}});
  assert.equal(graphStillCurrent.materials.check.status, 'current', 'NPC-only changes do not stale source-only graph material');

  const stale = await call('table.workspace.read', {query: 'commission', binding: {...catalog.binding, npc_revision: '0'.repeat(64)},
    preselect: {version: 2, mode: 'check'}});
  assert.equal(stale.status, 'unverifiable');
  assert.equal(stale.materials.check.status, 'stale');
  assert.ok(stale.materials.check.changed.includes('npc_revision'));

  await assert.rejects(() => call('table.workspace.read', {query: 'commission', binding: catalog.binding,
    preselect: {version: 2, mode: 'read', keys: ['graph:not-issued']}}), /key not issued/);
});

test('legacy workspace and preselect true responses remain free of v2 material fields', async t => {
  const {call} = await openTable(t);
  await call('table.player_input', {text: 'I inspect the room.'});
  await call('table.narrate', {call_id: 't1-c1', text: 'A legacy-compatible retained line.'});
  const ordinary = await call('table.workspace.read');
  assert.equal(Object.hasOwn(ordinary, 'materials'), false);
  for (const key of ['memory_revision', 'npc_revision', 'records_revision', 'catalog_revision'])
    assert.equal(Object.hasOwn(ordinary.binding, key), false);
  const record = ordinary.candidates.records[0];
  assert.equal(record.text, 'A legacy-compatible retained line.');
  assert.equal(record.coverage, 'complete');
  assert.equal(Object.hasOwn(record, 'body'), false);
  assert.equal(Object.hasOwn(record, 'key'), false);
  const legacy = await call('table.workspace.read', {preselect: true});
  assert.equal(legacy.read_catalog.version, 1);
  assert.equal(Object.hasOwn(legacy, 'materials'), false);
});

test('v2 catalog reports bounded-page omissions instead of treating a limit as completeness', async t => {
  const {call} = await openTable(t);
  await call('table.player_input', {text: 'I inspect the room and its people.'});
  const page = await call('table.workspace.read', {query: 'room people',
    preselect: {version: 2, mode: 'catalog', limit: 1}});
  assert.equal(page.materials.candidates.length, 1);
  assert.equal(typeof page.materials.next, 'number');
  assert.equal(page.materials.coverage.graph_entity.status, 'partial');
  assert.ok(page.materials.coverage.graph_entity.omitted > 0);
});

test('record freshness is independent of candidate pagination and changes only with committed content', async t => {
  const {call} = await openTable(t);
  for (const [turn, text] of [[1, 'First retained statement.'], [2, 'Second retained statement.']]) {
    await call('table.player_input', {text: `Player turn ${turn}`});
    await call('table.narrate', {call_id: `t${turn}-c1`, text});
  }
  await call('table.player_input', {text: 'Player turn 3'});
  const catalog = await call('table.workspace.read', {candidate_limit: 48, query: 'retained statement',
    preselect: {version: 2, mode: 'catalog', limit: 128}});
  const record = catalog.materials.candidates.find(value => value.kind === 'committed_record');
  const current = await call('table.workspace.read', {candidate_limit: 1, query: 'retained statement', binding: catalog.binding,
    preselect: {version: 2, mode: 'check', keys: [record.key]}});
  assert.equal(current.materials.check.status, 'current');

  await call('table.narrate', {call_id: 't3-c1', text: 'Third retained statement.'});
  const stale = await call('table.workspace.read', {candidate_limit: 1, query: 'retained statement', binding: catalog.binding,
    preselect: {version: 2, mode: 'check', keys: [record.key]}});
  assert.equal(stale.materials.check.status, 'stale');
  assert.ok(stale.materials.check.changed.includes('records_revision'));
});

test('a selected rule family materializes actual clauses for a nonliteral player query', async t => {
  const {call} = await openTable(t);
  await call('table.player_input', {text: '我该如何判断这次行动？'});
  const catalog = await call('table.workspace.read', {query: '我该如何判断这次行动？',
    preselect: {version: 2, mode: 'catalog', limit: 128}});
  const family = catalog.materials.candidates.find(value => value.kind === 'rule' && value.params?.query === 'core-check');
  assert(family, 'the existing rule-family navigator is issued without relying on English query words');
  assert.equal(family.coverage.status, 'partial');
  assert.equal(Object.hasOwn(family, 'body'), false);

  const read = await call('table.workspace.read', {query: '我该如何判断这次行动？', binding: catalog.binding,
    preselect: {version: 2, mode: 'read', keys: [family.key], limit: 8}});
  const material = read.materials.candidates[0];
  assert.equal(material.key, family.key);
  assert.equal(typeof material.body, 'string');
  const body = JSON.parse(material.body);
  assert.equal(body.family, 'core-check');
  assert.ok(body.rules.length > 0);
  assert.ok(body.rules.every(rule => Array.isArray(rule.source_group) && Array.isArray(rule.relations)));
  assert.notEqual(material.coverage.status, 'complete', 'a bounded family read keeps dependency omissions explicit');
});

test('v2 dependency corruption is unavailable rather than authoritative empty state', async t => {
  const {call, base} = await openTable(t);
  await writeFile(join(base, 'npc-ledger.json'), '{broken-json', 'utf8');
  const result = await call('table.workspace.read', {query: 'the person here',
    preselect: {version: 2, mode: 'catalog', limit: 32}});
  assert.equal(result.status, 'unverifiable');
  assert.equal(result.materials.unavailable, 'dependency_read_failed');
  assert.ok(typeof result.materials.detail === 'string' && result.materials.detail.length > 0);
});
