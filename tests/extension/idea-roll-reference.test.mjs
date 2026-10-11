/**
 * Contract §222.7: the Idea roll may be asked out of character (Keeper Rulebook pp. 199-200). The reference scope keeps its
 * check steps, the host's clerk runs it, and admission reads it as the players' request, not an unchosen action. The live
 * table that found the three gaps is in §222.7; these are the seams.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {ideaRollProposal, registeredContactProposal} from '../../extensions/kernel/admission.ts';

const proposal = {tool: 'resolve', key: 'k', lines: ['resolve core-check:idea-roll actor=Thomas']};
const payload = {action: {decision: 'core-check:idea-roll', actor: 'Thomas', clue: 'rusted-basement-dagger'}};

test('admission: the host\'s Idea roll carries its rule line; anything else is untouched', () => {
  const read = ideaRollProposal(proposal, payload, {origin: 'policy', clerk: 'declared_check'});
  assert.notEqual(read.key, proposal.key);
  assert.match(read.lines[0], /idea_roll_rule=/);
  assert.match(read.lines[0], /in or out of character/);
  assert.equal(ideaRollProposal(proposal, payload, {origin: 'model', clerk: 'declared_check'}), proposal, 'a model-origin call is not the host\'s');
  assert.equal(ideaRollProposal(proposal, {action: {decision: 'core-check:ordinary-check'}}, {origin: 'policy', clerk: 'declared_check'}), proposal);
  assert.equal(registeredContactProposal(proposal, payload, {origin: 'policy', clerk: 'declared_check'}), proposal, 'the contact reading leaves it alone');
});
