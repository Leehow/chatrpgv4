/** Real kernel + Pi request capture with a deterministic provider. Contract tests, not play evidence. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';

const root = resolve(import.meta.dirname, '../..');
const manifest = JSON.parse(await readFile(join(root, 'mods/narration-craft/mod.json'), 'utf8'));
const full = await readFile(join(root, 'mods/narration-craft/agent.md'), 'utf8');
const brief = await readFile(join(root, 'mods/narration-craft/brief.md'), 'utf8');
const messageText = message => typeof message.content === 'string' ? message.content
  : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
const craftOf = context => {
  const text = context.messages.map(messageText).find(text => text.includes('"kind":"context_brief"'));
  assert.ok(text, 'the real provider receives the host briefing');
  return JSON.parse(text).instructions.find(row => row.mod === 'narration-craft');
};

for (const engine of ['legacy', 'hybrid-v1']) test(`craft guidance follows active locks and settings in real ${engine} provider requests`, async t => {
  const requests = [], capsules = [], queued = [], changes = [];
  let kernelCall;
  const hybrid = engine === 'hybrid-v1' ? createHybridEngine({env: process.env, decision: null}) : undefined;
  const oldText = 'Legacy craft fixture. Preserve the existing selected goal.';
  let oldPath;
  const table = await openTable({
    realKernel: true,
    env: {PI_COC_LOOP_ENGINE: engine, PI_COC_JEV_PRESELECT: '0', EXT_JEV_PRESELECTENABLED: 'false', EXT_JEV_APIKEY: undefined},
    ...(hybrid ? {runDriver: hybrid.runDriver} : {}),
    prepareWorkspace: async workspace => {
      oldPath = join(workspace, 'old-craft-fixture');
      await mkdir(oldPath);
      await writeFile(join(oldPath, 'mod.json'), JSON.stringify({...manifest, version: '0.0.1',
        requires: ['mods.package-files.v1'], package_files: ['agent.md', 'brief.md'],
        contributes: {instructions: 'agent.md', brief: 'brief.md'}, settings: {density_guide: 'off'},
        settings_schema: {density_guide: {enum: ['off', 'on']}},
      }));
      await writeFile(join(oldPath, 'agent.md'), oldText);
      await writeFile(join(oldPath, 'brief.md'), 'Legacy craft reminder.');
      const steps = [['mods.install', {path: oldPath}], ['table.open', {}],
        ['table.player_input', {text: 'Fixture opening.'}], ['table.narrate', {call_id: 't1-c1', text: 'The office is quiet.'}]];
      const input = steps.map(([method, params], id) => JSON.stringify({id: String(id), method, params: {campaign: 'test-camp', ...params}})).join('\n') + '\n';
      const run = spawnSync(process.execPath, [join(root, 'build/kernel/rpc.mjs'), '--workspace', workspace, '--content', join(root, 'content')], {
        cwd: root, env: process.env, encoding: 'utf8', input,
      });
      assert.equal(run.status, 0, run.stderr);
      for (const frame of run.stdout.trim().split('\n').map(line => JSON.parse(line)).filter(frame => !frame.progress))
        assert.ok(frame.ok, JSON.stringify(frame));
    },
    responses: Array.from({length: 5}, () => context => {
      requests.push(context);
      return fauxAssistantMessage([fauxToolCall('narrate', {text: 'The office remains quiet.'})], {stopReason: 'toolUse'});
    }),
    extraExtensions: [
      ...(hybrid ? [{name: 'coc-hybrid-engine', factory: hybrid.extension}] : []),
      {name: 'craft-request-probe', factory: pi => {
        pi.events.on('coc:kernel-bridge', value => {kernelCall = value.call;});
        pi.events.on('coc:capsule', value => capsules.push(value.capsule));
        pi.on('before_agent_start', async () => {
          const change = queued.shift();
          if (change) changes.push(await kernelCall('mods.configure', {campaign: 'test-camp', id: 'narration-craft', ...change}));
        });
      }},
    ],
  });
  t.after(() => table.dispose());
  const configure = params => kernelCall('mods.configure', {campaign: 'test-camp', id: 'narration-craft', ...params});
  const currentStyle = async () => (await kernelCall('table.capsule', {campaign: 'test-camp', rehydrate: true})).style;
  const initialStyle = await currentStyle();
  const legacyBytes = await readFile(join(oldPath, 'agent.md'), 'utf8');

  // This runs after input acceptance. The busy table must retain the old setting for this request.
  queued.push({settings: {density_guide: 'on'}});
  await table.session.prompt('I ask whether the office is quiet.');
  assert.ok(requests.length, JSON.stringify({errors: table.extensionErrors, messages: table.session.messages.slice(-3).map(message => ({role: message.role, type: message.customType, error: message.errorMessage, text: messageText(message).slice(0, 500)})), notices: table.ui}));
  assert.equal(craftOf(requests[0]).version, manifest.version);
  assert.equal(craftOf(requests[0]).instruction, full);
  assert.equal(craftOf(requests[0]).settings.density_guide, 'off');
  const pending = changes[0].mods.find(row => row.id === manifest.id);
  assert.equal(pending.active.settings.density_guide, 'off');
  assert.equal(pending.pending.settings.density_guide, 'on', 'busy-table changes remain pending');
  assert.equal(capsules[0].mods.instructions.find(row => row.mod === manifest.id).form, 'full');

  await table.session.prompt('I ask the same simple question.');
  assert.equal(craftOf(requests[1]).settings.density_guide, 'on', 'pending settings refresh the briefing without a source change');
  const later = capsules.at(-1).mods.instructions.find(row => row.mod === manifest.id);
  assert.equal(later.form, 'brief');
  assert.equal(later.instruction, brief);

  await configure({enabled: false});
  await table.session.prompt('I remain in the office.');
  assert.equal(craftOf(requests[2]), undefined, 'disabled instructions cannot survive in the retained briefing');
  // Contract §137: with the provider disabled the base keeps only language and register; the lines were the package's.
  assert.deepEqual(Object.keys(initialStyle).sort(), ['axes', 'directives', 'floor', 'language', 'register']);
  const bare = await currentStyle();
  assert.deepEqual(Object.keys(bare).sort(), ['language', 'register'], 'without a style provider the base carries no craft lines');
  assert.equal(bare.language, initialStyle.language);
  assert.equal(bare.register, initialStyle.register);

  await configure({version: '0.0.1', enabled: true});
  await table.session.prompt('I ask for a short answer.');
  assert.equal(craftOf(requests[3]).version, '0.0.1');
  assert.equal(craftOf(requests[3]).instruction, oldText);

  await configure({version: manifest.version});
  await table.session.prompt('I ask for a clear answer.');
  assert.equal(craftOf(requests[4]).version, manifest.version);
  assert.equal(craftOf(requests[4]).instruction, full);
  assert.equal(craftOf(requests[4]).settings.density_guide, 'on');
  assert.equal(await readFile(join(oldPath, 'agent.md'), 'utf8'), legacyBytes, 'upgrades never edit the old package source');
  assert.equal(requests.length, 5, 'guidance adds no Keeper model round trip');
  assert.deepEqual(table.extensionErrors, []);
});
