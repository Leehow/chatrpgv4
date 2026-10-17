import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Check} from 'typebox/value';
import {fauxAssistantMessage, fauxToolCall, getCurrentTools} from '@earendil-works/pi-ai';
import {openTable, waitForIdle} from './harness.mjs';

test('the actual setup tool projects closed rulebook constraints before the next model request', async t => {
  const catalog = {occupations: [{id: 'Engineer', credit_rating_range: [30, 60], formula: 'EDU*4', skills: []}], skills: [],
    weapons: ['Small knife'], characteristics: [{abbr: 'CON'}, {abbr: 'POW'}],
    draft_constraints: {finance_periods: ['1920s', 'modern'], aptitude: {origins: ['player', 'concept'], concept_limit: 1}}};
  const call = args => fauxAssistantMessage([fauxToolCall('setup', args)], {stopReason: 'toolUse'});
  let schema;
  const table = await openTable({mode: 'setup', campaign: null, env: {FAKE_SETUP_CATALOG: JSON.stringify(catalog)}, responses: [
    call({step: 'choose-source', kind: 'starter', module: 'the-haunting'}),
    call({step: 'create-campaign', id: 'profile-schema', title: 'Profile', play_language: 'en'}), context => {
      schema = getCurrentTools(context.messages).find(tool => tool.name === 'setup').parameters;
      return fauxAssistantMessage('Ready to draft.');
    },
  ]});
  t.after(() => table.dispose());
  await table.session.prompt('Prepare a starter.');
  await waitForIdle(table.session);
  const valid = profile => Check(schema, {step: 'create-investigator', params: {profile}});
  assert.equal(valid({era: '1975'}), false, 'a setting year is not a finance table key');
  assert.equal(valid({era: 'modern'}), true);
  assert.equal(valid({aptitude: {origin: 'concept', strong: ['CON', 'POW']}}), false);
  assert.equal(valid({aptitude: {origin: 'concept', strong: ['CON']}}), true);
  assert.equal(valid({aptitude: {origin: 'player', strong: ['CON', 'POW']}}), true);
  assert.equal(valid({weapons: [{name: 'Field knife', profile: 'Knife'}]}), false);
  assert.equal(valid({weapons: [{name: 'Field knife', profile: 'Small knife'}]}), true);
  assert.equal(valid({weapons: ['Field knife']}), true, 'unprinted gear remains equipment');
  assert.equal(valid({backstory: {key_connection: {backstory_field: 'traits', summary: 'Patient.'}}}), false);
  assert.equal(valid({key_connection: {backstory_field: 'scenario_bound', summary: 'The trip.'}}), false);
  assert.equal(valid({backstory: {traits: 'Patient.'}, key_connection: {backstory_field: 'traits', summary: 'Patient.'}}), true);
});
