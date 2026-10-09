/** Instruction delivery and structural boundaries; these fixtures do not measure model extraction accuracy. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolve} from 'node:path';
import {readerInstructionText} from '../../runtime/reader-instructions.ts';
import {detailReviewInput, gateRefusal} from '../../extensions/module/reader-review.ts';
import {checkTargetedRepair, repairDecision} from '../../extensions/module/targeted-repair.ts';

// Complete paths keep the focused selector aware of these instruction-only changes.
const READ_GUIDE = 'content/setup/visual-reader/read.md';
const REVIEW_GUIDE = 'content/setup/visual-reader/review.md';
const CONTENT = resolve(import.meta.dirname, '../../content');

test('opening and detail authors receive proposition ownership and page-grounded repair guidance', async () => {
  for (const purpose of ['opening', 'detail']) {
    const prompt = await readerInstructionText(CONTENT, {phase: 'read', purpose});
    for (const rule of [
      'Separate independently judged propositions and their knowledge owners',
      'Discovering a carrier, hearing testimony and establishing the truth of what was said',
      'Each claim keeps its own source-supported truth_status and conditions',
      'Optional examples remain optional Keeper material with their stated conditions',
      'Treat review reasons as judgments to verify against the original pages',
      'inspect its connected assertion, knowledge and discovery claims in draft.json and task.known_claims',
      'task.repair still governs changes to supported records and published values',
    ]) assert.ok(prompt.includes(rule), `${READ_GUIDE}: ${purpose}: ${rule}`);
  }
});

test('the independent reviewer receives source conditions, scoped omissions and separate claim judgments', async () => {
  const prompt = await readerInstructionText(CONTENT, {phase: 'verify'});
  for (const rule of [
    'Review each proposition and knowledge owner separately',
    "Compare each claim's own truth_status and conditions with the page",
    'Keep authored optional examples optional, with their source conditions',
    'Your reasons are judgments for the author to verify against original pages, not new authored facts',
    "cite the original page's actual condition and the deepest affected candidate pointer",
    'Describe absent material in missing without inventing a candidate pointer',
    'which requested use or immediate dependency would fail without it',
    'Explicitly list every required_review pointer',
  ]) assert.ok(prompt.includes(rule), `${REVIEW_GUIDE}: ${rule}`);
});

const fixture = () => ({
  nodes: [
    {node_id: 'npc-witness', node_kind: 'npc', name: 'Witness', summary: 'A witness.', source_refs: [{page: 1}]},
    {node_id: 'clue-testimony', node_kind: 'clue', summary: 'The witness reports a locked door.', source_refs: [{page: 1}]},
    {node_id: 'scene-room', node_kind: 'scene', name: 'Room', source_refs: [{page: 1}]},
  ],
  claims: [
    {subject_id: 'npc-witness', predicate: 'asserts', object: {node_id: 'clue-testimony'}, truth_status: 'authored-lie', source_refs: [{page: 1}]},
    {subject_id: 'clue-testimony', predicate: 'discoverable-at', object: {node_id: 'scene-room'}, truth_status: 'authored-fact', source_refs: [{page: 1}]},
    {subject_id: 'npc-witness', predicate: 'knows', object: {node_id: 'clue-testimony'}, truth_status: 'authored-fact', source_refs: [{page: 1}]},
  ],
  node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-room'],
});
const task = () => ({purpose: 'detail', review_policy: 'module-logic-v1', focus: 'Room', question: 'What does the witness report?',
  known_nodes: [{node_id: 'npc-archivist', node_kind: 'npc', name: 'Archivist'}],
  known_claims: [{subject_id: 'npc-archivist', predicate: 'knows', object: {node_id: 'clue-testimony'}, truth_status: 'authored-fact', source_refs: [{page: 1}]}],
});

test('a refused assertion retains adjacent discovery and knowledge context without mutating either ledger', () => {
  const draft = fixture(), inputTask = task(), before = structuredClone({draft, inputTask});
  const input = detailReviewInput(inputTask, draft, ['/claims/0/truth_status']);
  assert.deepEqual(input.review_records, {'/claims/0': draft.claims[0]});
  assert.deepEqual(input.candidate_context.claims, draft.claims);
  assert.deepEqual(input.known_context.claims, inputTask.known_claims);
  assert.deepEqual(input.known_context.nodes, inputTask.known_nodes);
  assert.deepEqual(input.candidate_context.nodes, draft.nodes);
  assert.equal(input.omitted_context.full_candidate, 'draft.json');
  assert.equal(input.omitted_context.full_task, 'task.json');
  assert.deepEqual({draft, inputTask}, before);
});

test('context visibility does not relax truth review or authorize a neighboring supported repair', () => {
  const draft = fixture(), inputTask = task();
  const negative = {paths: ['/claims/0/truth_status'], verdict: 'unsupported', impact: 'logic',
    reason: 'The source prints testimony but does not establish it as a lie.', source_refs: [{page: 1}]};
  const refuses = gateRefusal(inputTask, draft);
  assert.equal(refuses(negative, negative.paths[0]), true);
  assert.equal(refuses({...negative, verdict: 'contested'}, negative.paths[0]), true);
  assert.equal(refuses({...negative, verdict: 'supported'}, negative.paths[0]), false);
  assert.equal(refuses({...negative, impact: 'presentation'}, '/nodes/0/summary'), true, 'person statements remain strict');
  assert.equal(refuses({...negative, impact: 'parameter'}, '/nodes/1/properties/sheet/derived/HP'), true, 'sheet pointers remain strict');
  const decision = repairDecision(draft, {checked: [negative], missing: []}, inputTask);
  assert.equal(decision.kind, 'targeted');
  assert.deepEqual(decision.roots, ['/claims/0']);
  const repaired = structuredClone(draft);
  repaired.claims[0].truth_status = 'authored-belief';
  assert.deepEqual(checkTargetedRepair(draft, repaired, decision.roots), {ok: true});
  repaired.claims[1].truth_status = 'authored-lie';
  const outside = checkTargetedRepair(draft, repaired, decision.roots);
  assert.equal(outside.ok, false);
  assert.ok(outside.paths.includes('/claims/1'));
});
