import assert from 'node:assert/strict';
import {readFileSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {readJevApiKey, describeJevConfig, API_KEY_KEY, API_KEY_ENV, SETTINGS_ENV} from '../../extensions/jev/agent/config.js';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {JEV_MODEL} from '../../runtime/jev/question-packing.ts';
import {agentExtensionManifests, runtimeEntrypoints, sessionExtensionPaths, desktopSessionExtensionPaths} from '../../runtime/deployment.mjs';

const key = 'jev-test-secret';
const managed = (extra = {}) => ({PIPIUI_SPAWN_CONTRACT: '{}', PIPIUI_MOUNTED_EXTENSIONS: 'kernel,jev',
  [SETTINGS_ENV]: '{}', [API_KEY_ENV]: key, TYPESAFE_API_KEY: 'old-cli-secret', ...extra});

test('one resolver handles the vault credential and source CLI compatibility', () => {
  assert.equal(readJevApiKey({}), undefined);
  assert.equal(readJevApiKey({TYPESAFE_API_KEY: ' cli-key '}), 'cli-key');
  assert.equal(readJevApiKey({[API_KEY_ENV]: ' vault-key ', TYPESAFE_API_KEY: 'cli-key'}), 'vault-key');
  assert.equal(readJevApiKey(managed()), key);
  assert.deepEqual(describeJevConfig(managed()), {configured: true});
  assert.deepEqual(describeJevConfig({}), {configured: false});
});

test('clear, disable and missing mounts cannot revive inherited CLI or vault credentials', () => {
  for (const env of [
    managed({[API_KEY_ENV]: ''}), managed({[API_KEY_ENV]: '   '}),
    managed({PIPIUI_MOUNTED_EXTENSIONS: 'kernel,rerank'}), managed({PIPIUI_MOUNTED_EXTENSIONS: undefined}),
    {[SETTINGS_ENV]: '{}', TYPESAFE_API_KEY: key},
    {[SETTINGS_ENV]: JSON.stringify({[API_KEY_KEY]: key}), TYPESAFE_API_KEY: key},
    {PIPIUI_HOST_PROTOCOL: '1', [API_KEY_ENV]: key},
  ]) assert.equal(readJevApiKey(env), undefined);
  assert.equal(readJevApiKey({[SETTINGS_ENV]: '{}', [API_KEY_ENV]: key}), key, 'cold preparation uses managed settings');
});

test('the manifest owns a secret setting and is included in both emitted session routes', () => {
  const root = new URL('../../', import.meta.url).pathname;
  const manifest = JSON.parse(readFileSync(new URL('../../extensions/jev/pipiui-extension.json', import.meta.url)));
  assert.equal(manifest.app.settings.schema.properties[API_KEY_KEY].format, 'secret');
  assert.equal(manifest.app.settings.scope, 'app');
  assert.equal(API_KEY_ENV, API_KEY_KEY.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase());
  assert(agentExtensionManifests(root).some(row => row.name === 'jev' && row.built === 'build/extensions/jev/agent/index.mjs'));
  const entries = runtimeEntrypoints(root);
  assert(sessionExtensionPaths(entries).includes(entries.jev));
  assert(desktopSessionExtensionPaths(entries).includes(entries.jev));
});

test('the actual profile installer installs the emitted Jev entry and settings UI in an isolated profile', t => {
  const root = new URL('../../', import.meta.url).pathname;
  const temporary = mkdtempSync(join(tmpdir(), 'jev-profile-install-'));
  t.after(() => rmSync(temporary, {recursive: true, force: true}));
  for (const path of ['build', 'content', 'extensions', 'node_modules']) symlinkSync(join(root, path), join(temporary, path), 'dir');
  copyFileSync(join(root, 'pipiui-extension.json'), join(temporary, 'pipiui-extension.json'));
  mkdirSync(join(temporary, 'pipicoc'));
  for (const entry of readdirSync(join(root, 'pipicoc'))) {
    if (entry === 'install') copyFileSync(join(root, 'pipicoc/install'), join(temporary, 'pipicoc/install'));
    else symlinkSync(join(root, 'pipicoc', entry), join(temporary, 'pipicoc', entry));
  }
  execFileSync('/bin/bash', [join(temporary, 'pipicoc/install')], {env: {...process.env,
    PI_COC_HOME: temporary, PI_COC_LAYOUT: 'source', PI_COC_NODE_EXECUTABLE: process.execPath}, stdio: 'pipe'});
  const installed = join(temporary, '.pi/coc-agent/extensions/jev');
  const manifest = JSON.parse(readFileSync(join(installed, 'pipiui-extension.json'), 'utf8'));
  assert.equal(manifest.agent.extension, 'agent/index.mjs');
  assert.equal(readFileSync(join(installed, manifest.agent.extension), 'utf8'), readFileSync(join(root, 'build/extensions/jev/agent/index.mjs'), 'utf8'));
  assert.equal(readFileSync(join(installed, manifest.app.ui.settingsSections[0].entry), 'utf8'), readFileSync(join(root, 'extensions/jev/app/settings-jev.js'), 'utf8'));
});

function fixture() {
  const scope = {owner: 'credential-test', audience: 'keeper'};
  const batch = {id: 'credential-batch', model: JEV_MODEL, family: 'credential-test', familyVersion: '1', scope, readSet: [],
    state: {record: 'The door is open.'}, questions: [{key: 'open', target: 'door', type: 'noul', instructions: 'Is the door open?'}]};
  const lease = new TaskLease({owner: 'credential-test', goal: 'check authentication transport', scope, readSet: [], capabilities: [],
    budget: {deadlineAt: Date.now() + 5_000, remainingInputTokens: 100_000, remainingOutputTokens: 10_000, remainingCostUsd: 1, remainingActions: 10}});
  return {batch, lease};
}

test('the real adapter reads the shared key, keeps it out of request data and traces, and freezes its captured credential', async () => {
  const env = managed(), {batch, lease} = fixture(), traces = [];
  let calls = 0;
  const adapter = createDecisionAdapter({env, trace: event => traces.push(event), fetcher: async (_url, init) => {
    calls++;
    assert.equal(init.headers.Authorization, `Bearer ${key}`);
    assert(!init.body.includes(key));
    return new Response(JSON.stringify({model: JEV_MODEL, answers: {open: {type: 'noul', noul: 1}}, usage: {input_tokens: 20, output_tokens: 5}}));
  }});
  env[API_KEY_ENV] = 'rotated-key';
  const result = await adapter.decide(batch, lease);
  assert.equal(result.status, 'complete');
  assert.equal(calls, 1);
  assert(!JSON.stringify({result, traces, context: lease.context}).includes(key));
});

test('an unconfigured managed consumer sends no HTTP request or budget reservation', async () => {
  const {batch, lease} = fixture(), before = structuredClone(lease.context);
  const result = await createDecisionAdapter({env: managed({[API_KEY_ENV]: ''}), fetcher: async () => {throw new Error('must not call');}}).decide(batch, lease);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.failure.code, 'unconfigured');
  assert.deepEqual(lease.context, before);
});
