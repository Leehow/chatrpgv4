/**
 * Optional rules on the kernel that ships: what a ruleset declares, and how confirmed patches
 * decide it. The layering is the point -- a house rule outranks a campaign patch, two patches that
 * disagree at one layer are a conflict rather than a guess, and a patch the seam cannot enforce is
 * reported rather than quietly applied.
 *
 * These cases came from a suite that asserted the same behaviour against the retired Python
 * implementation, where no product defect could have failed them. The two cases that read a
 * campaign's own `save/house-rules.json` are not here: they need a campaign snapshot, and belong
 * with the RPC-level cases rather than beside the pure functions.
 */
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {after, test} from 'node:test';
import {build} from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(tmpdir(), 'pi-coc-rule-options-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: "export * from './kernel-ts/rules/options.ts';", resolveDir: ROOT, loader: 'ts', sourcefile: 'options.ts'},
  outfile: join(temporary, 'options.mjs'), bundle: true, format: 'esm', platform: 'node', target: 'node22',
  packages: 'external', logLevel: 'silent'});
const options = await import(pathToFileURL(join(temporary, 'options.mjs')).href);
const manifest = JSON.parse(await readFile(join(ROOT, 'content/rulesets/coc7/manifest.json'), 'utf8'));

const LUCK_SPEND_RULE = 'rule:coc7:push-luck:luck-spend';
const LUCK_SPEND_DECISION = 'decision:coc7:push-luck:luck-spend';
const LUCK_RECOVERY_RULE = 'rule:coc7:development:luck-recovery';
const DEFAULT_LAYER = 'ruleset_default';

const patch = (overrides = {}) => ({
  patch_id: 'patch:no-luck-spend', relation: 'disables', target: LUCK_SPEND_RULE,
  layer: 'house_rule', scope: 'campaign', version: 1,
  reason: 'classic resource pressure', statement: 'no Luck spending', ...overrides,
});

test('coc7 declares its rulebook optional rules with explicit defaults', () => {
  const declared = Object.fromEntries(options.declaredOptionalRules(manifest).map(row => [row.option_id, row]));
  for (const name of ['luck-spend', 'luck-recovery']) assert.ok(name in declared, name);
  for (const row of Object.values(declared)) {
    assert.equal(typeof row.enabled_by_default, 'boolean', row.option_id);
    assert.ok(row.source_note, row.option_id);
  }
  assert.ok(declared['luck-spend'].operation_gates.includes('rules.luck_spend'));
  assert.ok(declared['luck-spend'].decision_refs.includes(LUCK_SPEND_DECISION));
  assert.ok(declared['luck-recovery'].settlement_gates.includes('development.luck_recovery'));
});

test('with nothing confirmed, every option keeps the ruleset default', () => {
  const effective = options.effectiveOptionalRules(manifest, []);
  const declared = Object.fromEntries(options.declaredOptionalRules(manifest).map(row => [row.option_id, row]));
  for (const [name, status] of Object.entries(effective)) {
    assert.equal(status.enabled, declared[name].enabled_by_default, name);
    assert.equal(status.decided_by, DEFAULT_LAYER, name);
  }
});

test('a confirmed patch on the rule or on the decision switches the same option', () => {
  for (const target of [LUCK_SPEND_RULE, LUCK_SPEND_DECISION]) {
    const status = options.effectiveOptionalRules(manifest, [patch({target})]);
    assert.equal(status['luck-spend'].enabled, false, target);
    assert.equal(status['luck-spend'].decided_by, 'patch:no-luck-spend', target);
    // One option switching leaves the others where the ruleset put them.
    assert.equal(status['luck-recovery'].enabled, true, target);
  }
});

test('a house rule outranks a campaign patch', () => {
  const status = options.effectiveOptionalRules(manifest, [
    patch({patch_id: 'patch:campaign-luck-off', layer: 'campaign_patch', relation: 'disables'}),
    patch({patch_id: 'patch:house-luck-on', layer: 'house_rule', relation: 'enables'}),
  ])['luck-spend'];
  assert.equal(status.enabled, true);
  assert.equal(status.decided_by, 'patch:house-luck-on');
});

test('two disagreeing toggles at one layer are a conflict, not a guess', () => {
  const status = options.effectiveOptionalRules(manifest, [
    patch({patch_id: 'patch:luck-off', relation: 'disables'}),
    patch({patch_id: 'patch:luck-on', relation: 'enables'}),
  ])['luck-spend'];
  assert.equal(status.conflict, true);
  assert.equal(status.enabled, null);
  assert.deepEqual(new Set(status.conflicting.map(row => row.patch_id)), new Set(['patch:luck-off', 'patch:luck-on']));
  assert.equal(options.disabledDecisionGates(manifest, {'luck-spend': status})[LUCK_SPEND_DECISION].conflict, true);
  assert.equal(options.gateCode(status), 'rule_conflict');
});

test('two agreeing toggles at one layer decide, and name the first of them', () => {
  const status = options.effectiveOptionalRules(manifest, [
    patch({patch_id: 'patch:luck-off-a', relation: 'disables'}),
    patch({patch_id: 'patch:luck-off-b', relation: 'disables'}),
  ])['luck-spend'];
  assert.equal(status.enabled, false);
  assert.equal(status.decided_by, 'patch:luck-off-a');
});

test('a patch this seam cannot enforce is reported, not applied', () => {
  for (const [override, reason] of [
    [{relation: 'overrides'}, 'relation_not_enforced'],
    [{scope: 'scene'}, 'scope_not_enforced'],
    [{layer: 'session_ruling'}, 'layer_cannot_toggle'],
  ]) {
    const [toggle] = options.togglesFromPatches(manifest, [patch(override)]);
    assert.equal(toggle.applicable, false, reason);
    assert.equal(toggle.inapplicable_reason, reason);
    assert.equal(options.effectiveOptionalRules(manifest, [patch(override)])['luck-spend'].enabled, true, reason);
  }
});

test('gates map a disabled option onto its decisions, operations and settlements', () => {
  const effective = options.effectiveOptionalRules(manifest, [
    patch(), patch({patch_id: 'patch:no-luck-recovery', target: LUCK_RECOVERY_RULE}),
  ]);
  const gates = options.disabledDecisionGates(manifest, effective);
  assert.equal(gates[LUCK_SPEND_DECISION].decided_by, 'patch:no-luck-spend');
  assert.equal(options.gateFor(manifest, effective, {operation: 'rules.luck_spend'}).option_id, 'luck-spend');
  assert.equal(options.gateFor(manifest, effective, {settlement: 'development.luck_recovery'}).option_id, 'luck-recovery');
  assert.equal(options.gateFor(manifest, effective, {operation: 'rules.roll'}), null);
  // Nothing disabled is nothing gated.
  assert.deepEqual(options.disabledDecisionGates(manifest, options.effectiveOptionalRules(manifest, [])), {});
});
