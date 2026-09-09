import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
const evidenceRoot = join(ROOT, '.coc/playtests/runtime-consolidation/rule-queries');
await mkdir(evidenceRoot, { recursive: true });
const evidence = await mkdtemp(join(evidenceRoot, 'direct-'));
const modules = [
  ['json', ['parsePythonJson', 'pythonJsonDumps', 'jsonDigest']],
  ['context', ['createKernelContext']],
  ['capabilities', ['RESOLVER_NAMES']],
  ['read/rule-facts', ['RuleObservations']],
  ['read/module-graph', ['ModuleGraph']],
  ['rules/tables', ['RuleTables']],
  ['rules/catalog', ['Catalog', 'SUPPORTED_KINDS', 'moduleSpellRecords', 'resolveFamilyParameter']],
  ['rules/skills', ['SkillResolver']],
  ['rules/options', ['declaredOptionalRules', 'togglesFromPatches', 'effectiveOptionalRules', 'disabledDecisionGates', 'gateFor', 'gateCode', 'gateMessage']],
  ['rules/graph', ['RuleGraph']],
  ['rules/planning', ['selectAvailableDecision', 'noAvailableDecision', 'throwPlanningFailure']],
  ['rules/casefold', ['caseFold']],
];
await build({ stdin: { contents: modules.map(([name, exports]) => `export {${exports.join(',')}} from ${JSON.stringify(join(ROOT, 'kernel-ts', name + '.ts'))};`).join('\n'), resolveDir: ROOT, sourcefile: 'rules-oracle-api.ts', loader: 'ts' },
  outfile: join(evidence, 'api.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'silent' });
const api = await import(pathToFileURL(join(evidence, 'api.mjs')).href);
const context = await api.createKernelContext({ workspace: join(evidence, 'workspace'), content: join(ROOT, 'content') });
after(() => context.git.close());
const tables = new api.RuleTables(context), catalog = new api.Catalog(tables);
const observed = await api.RuleObservations.load(context);
const decoded = value => JSON.parse(api.pythonJsonDumps(value));
const clone = value => api.parsePythonJson(api.pythonJsonDumps(value));
/**
 * The Python reference predates `localized_names` keyed by play-language tag (contract §23): it
 * still carries one `localized_name`. That field is the subject of ts-kernel-i18n.test.mjs, so
 * catalogue comparisons here read both sides without it -- top-level for kernel records (whose
 * values keep their Python number identity), deep for decoded JSON answers.
 */
const unnamed = record => Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'localized_names'));
const unlocalized = value => Array.isArray(value) ? value.map(unlocalized)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'localized_name' && key !== 'localized_names').map(([key, inner]) => [key, unlocalized(inner)]))
  : value;
const capture = action => {
  try { return { value: decoded(action()) }; }
  catch (error) { return { error: typeof error.toJson === 'function' ? decoded(error.toJson()) : { name: error.name, message: error.message } }; }
};
const REFERENCE = String.raw`
import hashlib,json,sys
from pathlib import Path
from coc.fileio import canonical_json
from coc.errors import RpcError
from coc.rules.tables import RuleTables
from coc.rules.catalog import Catalog,module_spell_records
from coc.rules.skills import SkillResolver
from coc.rules.graph import RulesRuntime,load_ruleset_graph,thaw
from coc.rules.runtime import RulesEngine,SettleContext
from coc.rules import rule_options
from coc.module_graph import ModuleGraph
from coc.resolve import ResolvePipeline
p=json.load(sys.stdin)
content=Path(p['content'])
tables=RuleTables(content/'rulesets/coc7/rules-json')
catalog=Catalog(tables)
loaded=load_ruleset_graph(content/'rulesets/coc7')
def digest(value): return hashlib.sha256(canonical_json(value).encode()).hexdigest()
def capture(fn):
    try: return {'value':thaw(fn())}
    except RpcError as error: return {'error':error.to_json()}
    except Exception as error: return {'error':{'name':type(error).__name__,'message':str(error)}}
operation=p['operation']
if operation=='records':
    output={kind:{'count':len(catalog.records([kind])),'digest':digest([{k:v for k,v in r.items() if k!='localized_name'} for r in catalog.records([kind])])} for kind in p['kinds']}
elif operation=='search':
    module=ModuleGraph('fixture',Path(p['module'])) if p.get('module') else None
    spells=SettleContext.module_spells_for(module,p.get('world')) if module else None
    output=[catalog.search(case['query'],kinds=case.get('kinds'),era=case.get('era'),limit=case.get('limit'),module_spells=spells) for case in p['cases']]
elif operation=='resolve_names':
    module=ModuleGraph('fixture',Path(p['module'])) if p.get('module') else None
    spells=SettleContext.module_spells_for(module,p.get('world')) if module else None
    output=[catalog.resolve_name(case['kind'],case['name'],module_spells=spells) for case in p['cases']]
elif operation=='skills':
    resolver=SkillResolver(tables,p['sheet'])
    output=[capture(lambda case=case:getattr(resolver,case['method'])(*case['args'])) for case in p['cases']]
elif operation=='all_cards':
    runtime=RulesRuntime(loaded['graph'],graph_manifest=loaded['graph_manifest'],campaign_id='fixture',facts_provider=lambda:p['facts'])
    output={node['node_id']:runtime.card(node['node_id'],p['facts']) for node in runtime.decision_nodes()}
elif operation=='options':
    manifest=loaded['package_manifest']
    output=[]
    for patches in p['patches']:
        effective=rule_options.effective_optional_rules(manifest,patches)
        gates=rule_options.disabled_decision_gates(manifest,effective)
        output.append({'declared':rule_options.declared_optional_rules(manifest),'toggles':rule_options.toggles_from_patches(manifest,patches),'effective':effective,'gates':gates,
          'messages':{key:{'code':rule_options.gate_code(value),'message':rule_options.gate_message(value)} for key,value in gates.items()}})
elif operation=='planning':
    output=[]
    for case in p['cases']:
        facts=case.get('facts',{})
        manifest=case.get('manifest',loaded['graph_manifest'])
        runtime=RulesRuntime(loaded['graph'],graph_manifest=manifest,campaign_id='fixture',facts_provider=lambda:facts,
            grant_context_provider=lambda:case.get('grant_context',{}),host_locked_provider=lambda ref:case.get('host_provider',{}),
            resolver_index=case.get('resolver_index'),optional_rules_provider=lambda:case.get('gates',{}))
        values=[]
        last_grant=None
        for step in case['steps']:
            method=step['method']
            if method=='facts': facts=step['value']; values.append({'value':None}); continue
            if method=='latest_grant': values.append(capture(lambda:runtime.latest_grant_covering(step['ref']))); continue
            if method=='grant_check':
                grant=runtime.latest_grant_covering(step['ref']) if step.get('latest') else last_grant if step.get('previous') else step.get('grant')
                values.append(capture(lambda:runtime._check_card_grant(grant,step['ref']))); continue
            result=capture(lambda step=step:getattr(runtime,step['method'])(*step.get('args',[])))
            if isinstance(result.get('value'),dict) and result['value'].get('card_grant'): last_grant=result['value']['card_grant']
            values.append(result)
        output.append(values)
elif operation=='planning_errors':
    pipeline=object.__new__(ResolvePipeline)
    output=[capture(lambda case=case:pipeline._raise_settle_failure(case['envelope'],case['chosen'])) for case in p['cases']]
elif operation=='fold': output=[value.casefold() for value in p['values']]
else: raise ValueError(operation)
print(json.dumps(output,ensure_ascii=False))
`;
let referenceCount = 0;
async function oracle(operation, input) {
  const packet = { operation, content: join(ROOT, 'content'), ...input };
  const run = spawnSync('uv', ['run', '--frozen', 'python', '-c', REFERENCE], { cwd: ROOT, env: { ...process.env, PYTHONPATH: join(ROOT, 'kernel'), PYTHONDONTWRITEBYTECODE: '1' }, input: api.pythonJsonDumps(packet), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30_000 });
  assert.equal(run.status, 0, run.stderr);
  const value = JSON.parse(run.stdout), stem = `${++referenceCount}-${operation}`;
  await writeFile(join(evidence, stem + '-input.json'), api.pythonJsonDumps(packet, { indent: 2 }) + '\n');
  await writeFile(join(evidence, stem + '-reference.json'), run.stdout);
  return value;
}

test('every catalog kind retains the Python record count and canonical content digest', async () => {
  const expected = await oracle('records', { kinds: api.SUPPORTED_KINDS });
  const actual = {};
  for (const kind of api.SUPPORTED_KINDS) { const records = await catalog.records([kind]); actual[kind] = { count: records.length, digest: api.jsonDigest(records.map(unnamed)) }; }
  await writeFile(join(evidence, 'record-digests-actual.json'), JSON.stringify(actual, null, 2));
  assert.deepEqual(actual, expected);
});

test('catalog recall preserves price variants, scopes, family parameters and closed invalid requests', async t => {
  const localized = Object.values(await tables.skillsTable()).find(value => value.localized_labels?.['zh-Hans'])?.localized_labels['zh-Hans'];
  const cases = [
    { query: '.38', kinds: ['weapon'] }, { query: 'revolver_38', kinds: ['weapon'] },
    { query: 'Khaki Jean Material', kinds: ['item'] }, { query: 'car', kinds: ['vehicle', 'rule'], limit: 5 },
    { query: 'beretta', kinds: ['weapon'], era: 'modern' }, { query: 'beretta', kinds: ['weapon'], era: '1920s' },
    { query: 'Summon/Bind Dimensional Shambler', kinds: ['spell'] }, { query: 'Summon/Bind Gug', kinds: ['spell'] },
    { query: 'Contact Deity Nyarlathotep', kinds: ['spell'] }, { query: 'Contact Deity Spells', kinds: ['spell'] },
    { query: 'Summoning Byakhee', kinds: ['spell'] }, { query: 'Flesh Ward', kinds: ['spell'] },
    { query: 'Arsenic', kinds: ['poison'] }, { query: 'Al Azif', kinds: ['tome'] },
    { query: localized, kinds: ['skill'] }, { query: 'Library Use', kinds: ['skill'] },
    { query: 'drowning', kinds: ['hazard'] }, { query: 'zzzz-no-row-999' },
    { query: 'plate', kinds: ['armor'] }, { query: '' }, { query: 4 },
    { query: 'weapon', kinds: 2 }, { query: 'weapon', kinds: [''] },
    { query: 'weapon', limit: true }, { query: 'weapon', limit: 0 }, { query: 'weapon', limit: 51 },
    { query: 'weapon', limit: api.parsePythonJson('20.0') },
    { query: 'weapon', era: '' }, { query: 'car', kinds: ['vehicle', 'vehicle'] },
  ];
  const expected = await oracle('search', { cases });
  for (const [index, value] of cases.entries()) await t.test(`query ${index}: ${String(value.query)}`, async () => {
    assert.deepEqual(unlocalized(decoded(await catalog.search(value.query, value))), unlocalized(expected[index]));
  });
});

test('module spell aliases, unpriced declarations and rulebook authority match Python', async () => {
  const raw = { nodes: [
    { node_id: 'spell-flesh-ward', node_kind: 'spell', name: 'Flesh Ward', aliases: ['Local Ward'], summary: 'A module annotation.', properties: { cost_mp: 77, cost_sanity: 8, source_refs: [{ page: 4 }] } },
    { node_id: 'spell-local-gate', node_kind: 'spell', name: 'Local Gate', aliases: ['Short Gate'], summary: 'An unpriced authored spell.', properties: { source_refs: [{ page: 7 }] } },
    { node_id: 'spell-case-fold', node_kind: 'spell', name: 'Stra\u00dfe', aliases: [], summary: 'A Unicode name fixture.', properties: { cost_mp: 1, cost_sanity: 0 } },
  ], relations: [] };
  raw.nodes[2].name = 'Stra' + String.fromCodePoint(0xdf) + 'e';
  const path = join(evidence, 'module-graph.json'); await writeFile(path, api.pythonJsonDumps(raw));
  const graph = new api.ModuleGraph('fixture', raw, '', {}), moduleSpells = api.moduleSpellRecords(graph);
  const cases = [{ query: 'Flesh Ward', kinds: ['spell'] }, { query: 'Short Gate', kinds: ['spell'] }, { query: 'Local Gate', kinds: ['weapon'] }, { query: 'STRASSE', kinds: ['spell'] }];
  const expected = await oracle('search', { cases, module: path });
  assert.deepEqual(unlocalized(await Promise.all(cases.map(async value => decoded(await catalog.search(value.query, { ...value, moduleSpells }))))), unlocalized(expected));
  const names = [{ kind: 'spell', name: 'Flesh Ward' }, { kind: 'spell', name: 'Short Gate' }, { kind: 'spell', name: 'Summon/Bind Dimensional Shambler' }, { kind: 'spell', name: 'Summon/Bind Gug' }];
  assert.deepEqual(unlocalized(await Promise.all(names.map(async value => decoded(await catalog.resolveName(value.kind, value.name, moduleSpells))))), unlocalized(await oracle('resolve_names', { cases: names, module: path })));
});

test('skill aliases and defaults preserve the source rules vocabulary', async () => {
  const sheet = { current_luck: 37, characteristics: { STR: 45, DEX: 51, CON: 61, APP: 55, POW: 60, INT: 70, EDU: 80, SIZ: 65 }, skills: { 'Spot Hidden': 67, 'Library Use': 55, 'Fighting (Brawl)': 45, 'Language (Own)': 80, 'Firearms (Rifle/Shotgun)': 50 } };
  const resolver = await api.SkillResolver.create(tables, sheet);
  const cases = [
    ['canonical_names', []], ['resolve_explicit', ['spot-hidden']], ['resolve_explicit', ['Brawl']], ['resolve_explicit', ['Own']],
    ['find_in_text', ['I am listening and searching the library.']], ['find_in_text', ['Use firearms rifle shotgun or brawling.']],
    ['options_for', ['look for a book']], ['options_for', ['talk to someone', ['Library Use'], 4]],
    ['target_value', ['Spot Hidden']], ['target_value', ['Dodge']], ['target_value', ['Language (Own)']], ['target_value', ['LUCK']], ['target_value', ['unknown-skill']],
  ].map(([method, args]) => ({ method, args }));
  const names = { canonical_names: 'canonicalNames', resolve_explicit: 'resolveExplicit', find_in_text: 'findInText', options_for: 'optionsFor', target_value: 'targetValue' };
  assert.deepEqual(cases.map(value => capture(() => resolver[names[value.method]](...value.args))), await oracle('skills', { sheet, cases }));
});

test('optional-rule defaults, precedence and conflicts match confirmed Python patches', async () => {
  const patch = overrides => ({ patch_id: 'patch:no-luck', relation: 'disables', target: 'rule:coc7:push-luck:luck-spend', layer: 'house_rule', scope: 'campaign', version: 1, reason: 'Fixture pressure', statement: 'No Luck spending', ...overrides });
  const patches = [[], [patch({})], [patch({ layer: 'core' })], [patch({ scope: 'scene' })],
    [patch({}), patch({ patch_id: 'patch:yes-luck', relation: 'enables' })],
    [patch({}), patch({ patch_id: 'patch:lower-priority', relation: 'enables', layer: 'module_supplement' })],
    [{ patch: patch({}) }], [patch({ target: 'unlisted-rule' })]];
  const manifest = observed.packageManifest;
  const actual = patches.map(values => { const effective = api.effectiveOptionalRules(manifest, values), gates = api.disabledDecisionGates(manifest, effective); return decoded({ declared: api.declaredOptionalRules(manifest), toggles: api.togglesFromPatches(manifest, values), effective, gates, messages: Object.fromEntries(Object.entries(gates).map(([key, value]) => [key, { code: api.gateCode(value), message: api.gateMessage(value) }])) }); });
  assert.deepEqual(actual, await oracle('options', { patches }));
});

test('cards, graph identity, grants and slot plans match the Python planning seam', async t => {
  const ordinary = 'decision:coc7:core-check:ordinary-check', opposed = 'decision:coc7:opposed:opposed-check', combined = 'decision:coc7:core-check:combined-check';
  const allResolvers = Object.fromEntries(api.RESOLVER_NAMES.map(name => [name, {}]));
  const facts = { 'actor.id': 'alice', 'campaign.ruleset_id': 'coc7', 'campaign.ruleset_version': '1.0.0', 'actor.resources.hp': 10, 'actor.conditions': [], 'intent.action_kind': 'investigate', 'subsystem.snapshot.active': false, 'sanity.bout.pending': false };
  const cases = [
    { facts, resolver_index: allResolvers, steps: [{ method: 'context', args: [{ family: 'core-check' }] }, { method: 'slots_for', args: [ordinary] }, { method: 'compile_plan', args: [ordinary, {}] }] },
    { facts, resolver_index: {}, steps: [{ method: 'compile_plan', args: [ordinary, {}] }] },
    { facts, steps: [{ method: 'compile_plan', args: ['decision:coc7:missing:nope', {}] }, { method: 'context', args: [{}] }, { method: 'context', args: [null] }] },
    { facts, resolver_index: allResolvers, steps: [{ method: 'compile_plan', args: [ordinary, { unknown: true }] }, { method: 'compile_plan', args: [ordinary, { skill: 'Spot Hidden', difficulty: 'regular', difficulty_basis: 'An ordinary source condition', goal: 'Find it', stakes: 'A clear consequence' }, facts, { unknown: 4 }] }] },
    { facts, resolver_index: allResolvers, host_provider: { target: 1 }, steps: [{ method: 'card', args: [ordinary, facts] }, { method: 'compile_plan', args: [ordinary, { skill: 'Spot Hidden', difficulty: 'regular', difficulty_basis: 'An ordinary source condition', bonus: 0, penalty: 0, goal: 'Find it', stakes: 'A clear consequence', target: 999 }, facts, { investigator_id: 'alice', target: 67 }] }] },
    { facts, manifest: null, grant_context: { stage: 'acting', player_turn_epoch: 2 }, steps: [{ method: 'context', args: [{ family: 'core-check', selected_affordance_ids: [ordinary] }] }, { method: 'latest_grant', ref: ordinary }, { method: 'grant_check', ref: ordinary, latest: true }, { method: 'grant_check', ref: ordinary, grant: { grant_id: 'not-issued' } }, { method: 'facts', value: { ...facts, 'actor.id': 'bob' } }, { method: 'grant_check', ref: ordinary, previous: true }] },
    { facts: { ...facts, 'actor.conditions.dying': true, 'actor.conditions.major_wound': true, 'actor.resources.hp': 0 }, steps: [{ method: 'context', args: [{ family: 'healing' }] }] },
    { facts, gates: { [ordinary]: { option_id: 'fixture', enabled: false, decided_by: 'ruleset_default' } }, steps: [{ method: 'context', args: [{ family: 'core-check' }] }] },
    { facts, resolver_index: allResolvers, steps: [{ method: 'compile_plan', args: [combined, { combined_target_refs: ['skill:Spot Hidden', 'skill:Listen'], combined_mode: 'all', difficulty: 'regular', goal: 'Notice both details', stakes: 'A fixture consequence', skill: 'Discarded by combined planning', characteristic: 'STR', difficulty_basis: 'Discarded by combined planning' }, facts, { investigator_id: 'alice', combined_targets: { 'Spot Hidden': 67, Listen: 50 } }] }] },
  ];
  const expected = await oracle('planning', { cases });
  const methods = { slots_for: 'slotsFor', compile_plan: 'compilePlan' };
  for (const [index, value] of cases.entries()) await t.test(`planning case ${index}`, () => {
    let currentFacts = value.facts ?? {}, lastGrant = null;
    const graph = new api.RuleGraph(observed, { graphManifest: Object.hasOwn(value, 'manifest') ? value.manifest : observed.manifest, campaignId: 'fixture', facts: () => currentFacts, grantContext: () => value.grant_context ?? {}, hostLocked: () => value.host_provider ?? {}, resolverIndex: value.resolver_index, optionalRules: () => value.gates ?? {} });
    const actual = value.steps.map(step => {
      if (step.method === 'facts') { currentFacts = step.value; return { value: null }; }
      if (step.method === 'latest_grant') return capture(() => graph.latestGrantCovering(step.ref));
      if (step.method === 'grant_check') return capture(() => graph.checkCardGrant(step.latest ? graph.latestGrantCovering(step.ref) : step.previous ? lastGrant : step.grant, step.ref));
      const result = capture(() => graph[methods[step.method] ?? step.method](...clone(step.args ?? [])));
      if (result.value?.card_grant) lastGrant = result.value.card_grant;
      return result;
    });
    assert.deepEqual(actual, expected[index]);
    if (index === 4) {
      assert.ok(actual[1].value.plan, 'The positive fixture must compile a real plan');
      assert.equal(actual[1].value.plan.command.payload.target, 67);
      const plan = graph.compilePlan(...clone(value.steps[1].args)).plan;
      assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.command.payload));
    }
    if (index === 8) assert.ok(actual[0].value.plan, 'Combined planning must produce a real plan');
  });
});

test('all compiled decision cards preserve slots, capability refs and exception authority', async () => {
  const facts = { 'actor.id': 'alice', 'campaign.ruleset_id': 'coc7', 'actor.conditions': [], 'actor.resources.hp': 10, 'subsystem.snapshot.active': false, 'sanity.bout.pending': false, 'intent.action_kind': 'investigate' };
  const graph = new api.RuleGraph(observed, { campaignId: 'fixture', facts: () => facts });
  const actual = Object.fromEntries(graph.decisionNodes().map(node => [node.node_id, decoded(graph.card(node.node_id, facts))]));
  assert.deepEqual(actual, await oracle('all_cards', { facts }));
});

test('missing slot and authority failures retain the closed needs response shape', async () => {
  const chosen = { name: 'core-check:ordinary-check' };
  const cases = [
    { chosen, envelope: { failure: { code: 'missing_semantic_input', missing: ['goal', 'target_ref'] } } },
    { chosen, envelope: { failure: { code: 'rule_decision_not_applicable', message: 'Gate refused', unmet: [] } } },
    { chosen, envelope: { failure: { code: 'locked_input_override', message: 'The host owns this', fields: ['target_ref'] } } },
    { chosen, envelope: { failure: { code: 'optional_rule_disabled', message: 'Disabled' }, optional_rule: { option_id: 'fixture' } } },
  ];
  assert.deepEqual(cases.map(value => capture(() => api.throwPlanningFailure(value.envelope, value.chosen))), await oracle('planning_errors', { cases }));
  const cards = [{ decision_ref: 'decision:coc7:a:first', name: 'a:first', label: 'First' }, { decision_ref: 'decision:coc7:a:second', name: 'a:second', label: 'Second' }];
  const refusal = capture(() => api.selectAvailableDecision(cards, cards.map(card => card.decision_ref)));
  assert.equal(refusal.error.code, 'needs_choice');
  assert.deepEqual(refusal.error.details.candidates, [{ name: 'a:first', when: 'First' }, { name: 'a:second', when: 'Second' }]);
  assert.equal(api.selectAvailableDecision(cards, cards.map(card => card.decision_ref), { director: { beat: 'REVEAL', grounded: [cards[1].decision_ref] } }).decision_source, 'director');
});

test('catalog casefold follows the locked Unicode version rather than lowercase alone', async () => {
  const values = ['ASCII', String.fromCodePoint(0xdf), String.fromCodePoint(0x1e9e), String.fromCodePoint(0x3a3, 0x3c2), String.fromCodePoint(0x130), String.fromCodePoint(0xfb03), String.fromCodePoint(0x13a0, 0xab70)];
  assert.deepEqual(values.map(api.caseFold), await oracle('fold', { values }));
});
