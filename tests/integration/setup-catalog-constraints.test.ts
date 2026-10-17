import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {kernel, createCampaign} from './support.ts';

test('setup.catalog publishes the actual rulebook and creation policy constraints', async t => {
  const client = await kernel(t);
  await createCampaign(client);
  const catalog = await client.ok('setup.catalog', {campaign: 'c1'});
  const steps = await client.ok('setup.steps', {campaign: 'c1'});
  const policy = JSON.parse(readFileSync(new URL('../../content/setup/steps.json', import.meta.url), 'utf8'))
    .steps.find((step: any) => step.op === 'setup.draft').aptitude;
  assert.deepEqual(catalog.draft_constraints.finance_periods, steps.state.rulebook_eras);
  assert.deepEqual(catalog.draft_constraints.aptitude, policy);
  assert.ok(catalog.draft_constraints.finance_periods.length > 0);
  assert.ok(catalog.weapons.length > 0);
  assert.ok(catalog.characteristics.length > 0);
});
