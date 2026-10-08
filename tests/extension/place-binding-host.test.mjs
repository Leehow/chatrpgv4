/** §204.4 on the actual Pi tool path and emitted kernel. Controlled model/reference ports, no live model or gameplay acceptance. */
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable, waitFor, waitForIdle} from './harness.mjs';
import {buildRosterBook, CAMPAIGN, PAGES} from './roster-book.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
let temporary, api;
before(async () => {
  temporary = await mkdtemp(join(ROOT, '.tmp/place-binding-host-'));
  await build({stdin: {contents: "export * from './kernel-ts/testing/api.ts'; export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';", resolveDir: ROOT},
    outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
  api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
});
after(async () => {if (temporary) await rm(temporary, {recursive: true, force: true});});

test('a model-origin committed mint starts the book reference and writes the private binding automatically', async t => {
  const requested = [], text = 'A bare bulb lights the narrow room. Damp paper and cold air meet you; a window rattles above a wooden cabinet. Its half-open door invites a closer look.';
  const modelReply = args => fauxAssistantMessage([fauxToolCall(args.name, args.params)], {stopReason: 'toolUse'});
  const table = await openTable({realKernel: true, seedCampaign: false, campaign: CAMPAIGN,
    env: {PI_COC_JEV_PRESELECT: '0', PI_COC_SCENE_PLACEMENT: 'off'},
    prepareWorkspace: async home => {
      const context = await api.createKernelContext({workspace: home, content: join(ROOT, 'content'), seed: 'binding-host', locks: api.nativeAdvisoryLocks()});
      const runtime = api.createKernelRuntime(context);
      try {
        await buildRosterBook((method, params) => runtime.handlers[method](params), home, {open: true});
        await runtime.handlers['table.narrate']({campaign: CAMPAIGN, call_id: 't0-c1', text: 'The captain hands you the orders.'});
      } finally {await runtime.close();}
    },
    extraExtensions: [pi => pi.events.emit('coc:reading-bridge', {
      ensure: async () => ({state: 'ready'}), reading: () => false,
      reference: async (moduleId, params) => {requested.push({moduleId, params});return {source_answer: {status: 'excerpts', authority: 'original-source-excerpts', excerpts: [{page: 2, text: PAGES[1]}]}};},
    })],
    laneResponses: {establish: [fauxAssistantMessage(JSON.stringify({items: ['space', 'people', 'things', 'senses', 'period', 'hook'].map(key =>
      key === 'people' ? {key, verdict: 'not_applicable'} : {key, verdict: 'shown', quote: text})}))]},
    responses: [modelReply({name: 'apply', params: {effects: [{kind: 'move', to: 'North cottage', via: 'Across the farm lane.', establish: {summary: 'A cottage by the northern pond.', within: null}}]}}),
      modelReply({name: 'narrate', params: {text}})],
  });
  t.after(() => table.dispose());
  await table.session.prompt('I go to the cottage by the northern pond.');
  await waitForIdle(table.session);
  const row = await waitFor(() => table.telemetry().find(row => row.lane === 'place-binding' && row.outcome === 'bound'), {label: 'committed place receives its book binding'});
  assert.equal(requested.length, 1);
  assert.equal(requested[0].params.focus, 'North cottage');
  assert.match(requested[0].params.question, /cottage by the northern pond/);
  assert.deepEqual(row.pages, [2]);
  assert(table.kernelRequests().some(call => call.method === 'table.place.bind' && call.params?.place === 'North cottage'));
});
