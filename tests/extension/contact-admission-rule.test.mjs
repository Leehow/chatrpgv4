import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {admissionRequest, registeredContactProposal, buildAdmissionInput} from '../../extensions/kernel/admission.ts';
import {admissionRolesBatches} from '../../runtime/jev/admission-roles-domain.ts';
import {admissionJevBatches} from '../../runtime/jev/admission-domain.ts';

const mod = JSON.parse(readFileSync(new URL('../../mods/natural-npc/mod.json', import.meta.url)));
const check = mod.contributes.checks[0];
// The emitted-kernel producer is verified in single-loop-candidates.test.mjs; this fixture tests its admission reader.
const row = {actor: 'Jack', target: 'Bartender', decision: check.name,
  rule: {trigger: check.trigger, scope: check.scope, reusable: check.reusable}};
const payload = {action: {actor: 'Jack', target: 'Bartender', decision: row.decision, intent: 'social',
  goal: 'Pay the bartender and greet the other patron', method: 'Pay and greet'}};
const proposal = admissionRequest('resolve', payload, {party: ['Jack']});
const evidence = {origin: 'policy', clerk: 'mod_contact', basis: {read: 'table.capsule', path: 'mods.pending_contacts[0]', row}};
const context = {turn: 3, playerText: 'I pay the bartender for my meal, then greet the other patron.',
  investigators: [{name: 'Jack'}], present: ['Bartender'],
  delivered: [{turn: 2, player: 'I rent a room from the bartender.', keeper: 'The bartender hands you the key.'}],
  landed: [], refused: []};

test('kernel contact declaration reaches both admission reviewers with its actual rule meaning', () => {
  assert.deepEqual(row.rule, {trigger: 'contact', scope: 'actor-target', reusable: true});
  const enriched = registeredContactProposal(proposal, payload, evidence);
  assert.notEqual(enriched.key, proposal.key, 'a rule-context verdict is not reused for an ordinary social action');
  assert.match(buildAdmissionInput(enriched, context), /registered_contact_check=.*initial reaction/);
  const input = {...context, campaign: 'test-camp', tool: 'resolve', proposal: enriched.lines};
  for (const batches of [admissionRolesBatches(input), admissionJevBatches(input)]) {
    assert.match(JSON.stringify(batches.batches[0].state), /initial reaction/);
    assert.match(JSON.stringify(batches.batches[0].state), /mere presence does not establish it/);
  }
});

test('model claims, a different target or a non-contact rule cannot supply registered contact evidence', () => {
  const forged = {...payload, registered_contact_check: row};
  for (const [args, host] of [
    [forged, {...evidence, origin: 'model'}],
    [{action: {...payload.action, target: 'Other patron'}}, evidence],
    [payload, {...evidence, basis: {...evidence.basis, row: {...row, rule: {...row.rule, reusable: false}}}}],
    [payload, {...evidence, basis: {...evidence.basis, row: {...row, rule: {...row.rule, trigger: 'attack'}}}}],
  ]) assert.equal(registeredContactProposal(proposal, args, host), proposal);
});
