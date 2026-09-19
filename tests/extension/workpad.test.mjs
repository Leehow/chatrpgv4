/**
 * KIC-04 Workpad lifecycle (contract §19.2): the host-only `workpad_patch` parameter is stripped
 * before the payload exists, bound to the call-start snapshot, published only after the same
 * delivery truly succeeds, stored in a bounded rebuildable host cache, and projected as short
 * advisory entries inside the existing `coc-workspace` message — never into player UI,
 * admission or any formal record.
 */
import assert from 'node:assert/strict';
import {after, describe, test} from 'node:test';
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {convertToLlm} from '@earendil-works/pi-coding-agent';
import {openTable, waitFor, waitForIdle} from './harness.mjs';

const root = resolve(import.meta.dirname, '../..'), evidence = join(root, '.coc/playtests/bounded-context-contracts');
await mkdir(evidence, {recursive: true});
const directory = await mkdtemp(join(evidence, 'workpad-suite-'));
await build({stdin: {contents: `export * from './extensions/table/context-policy.ts';
export * from './extensions/table/workspace/projection.ts';
export * from './extensions/table/workspace/workpad-store.ts';
export * from './extensions/table/workspace/workpad.ts';`, resolveDir: root, sourcefile: 'workpad-api.ts'},
  outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);

const SOURCE = 'a'.repeat(64), STAMP = 'b'.repeat(64);
const binding = turn => ({version: 1, campaign: 'test-campaign', worldline: 'main', loop: 0, turn, source_revision: SOURCE,
  memory_coverage: {committed: turn, completed: turn, gaps: 0, recent: [], older: {gaps: 0}}});
const staticRef = (locator, kind = 'npc', authority = 'module_source') => ({id: createHash('sha256').update(locator).digest('hex'),
  locator, kind, authority, scope: {campaign: 'test-campaign', worldline: 'main', loop: 0},
  source_revision: SOURCE, identity: createHash('sha256').update(`i:${locator}`).digest('hex'), coverage: 'complete'});
const snapshot = (stateStamp = STAMP, turn = 4) => ({
  version: 1, status: 'valid',
  binding: {campaign: 'test-campaign', worldline: 'main', loop: 0, turn, source_revision: SOURCE, stateStamp, generation: 1},
  source: {available: true, revision: SOURCE, authority: 'module_source', generation: 1},
  authority: {checked: true, allowed: ['module_source', 'campaign_adaptation', 'table_record'], scope: {campaign: 'test-campaign', worldline: 'main', loop: 0}},
  coverage: {static: {status: 'complete', count: 2, ready: 2, omitted: 0}, records: {status: 'complete', count: 1, omitted: 0}},
  manifest: {version: 1, static: [staticRef('npc:gardener'), staticRef('scene:estate', 'scene')],
    records: [{id: createHash('sha256').update('turn:1').digest('hex'), locator: 'turn:1', turn: 1, authority: 'table_record',
      scope: {campaign: 'test-campaign', worldline: 'main', loop: 0}, source_revision: SOURCE,
      identity: createHash('sha256').update('r:1').digest('hex'), coverage: 'complete'}], truncated: false},
});
const view = (entries, focus = null, revision = 3) => ({revision, focus, entries});
const entry = (id, stateStamp, over = {}) => ({id, kind: 'hypothesis', text: `Note ${id}`, status: 'tentative',
  evidence: ['npc:gardener'], turn: 2, stateStamp, ...over});

describe('workpad patch validation', () => {
  const upsert = over => ({id: 'q1', kind: 'open_question', text: 'Who moved the letter?', evidence: ['npc:gardener'], ...over});
  test('a well-formed patch validates and reports its bytes', () => {
    const good = api.validateWorkpadPatch({focus: 'the letter', upserts: [upsert({status: 'needs_recheck'})], removes: ['q0']});
    assert.equal(good.ok, true);
    assert.equal(good.patch.upserts[0].status, 'needs_recheck', 'status defaults are explicit after validation');
    assert.ok(good.bytes <= api.WORKPAD_PATCH_BYTES);
    assert.equal(api.validateWorkpadPatch({focus: 'just the focus'}).ok, true, 'a focus-only patch is a patch');
  });
  test('the shape is closed: no confidence, no do-not-research, no fact claims, no JSON Pointer paths', () => {
    for (const bad of [
      {upserts: [upsert({confidence: 0.9})]},
      {upserts: [upsert({do_not_research: true})]},
      {upserts: [upsert({confirmed: true})]},
      {upserts: [upsert({evidence: ['/npc/gardener']})], },
      {upserts: [upsert({evidence: ['../../etc/passwd']})]},
      {upserts: [upsert({text: ''})]},
      {upserts: [upsert({text: 'x'.repeat(201)})]},
      {upserts: [upsert({id: 'bad id with spaces'})]},
      {upserts: [upsert(), upsert()]},
      {upserts: [upsert({evidence: []})]},
      {upserts: [upsert({kind: 'fact'})]},
      {upserts: [upsert({status: 'certain'})]},
      {upserts: []},
      {removes: []},
      {},
      {focus: 'x'.repeat(201)},
      {upserts: [upsert()], removes: ['q1'], rogue_key: true},
      'narrate something',
      null,
    ]) assert.equal(api.validateWorkpadPatch(bad).ok, false, JSON.stringify(bad));
  });
  test('a patch over the 1 KiB budget is over budget, not invalid', () => {
    const fat = {upserts: Array.from({length: 8}, (_, i) => upsert({id: `q${i}`, text: 'x'.repeat(200)}))};
    const checked = api.validateWorkpadPatch(fat);
    assert.equal(checked.ok, false);
    assert.equal(checked.reason, 'patch_over_budget');
  });
});

describe('workpad store', () => {
  const made = [];
  const make = () => { const dir = mkdtempSync(join(tmpdir(), 'workpad-store-')); made.push(dir); return api.createWorkpadStore(dir); };
  const patch = over => ({scope: {campaign: 'test-campaign', worldline: 'main', loop: 0}, baseRevision: 0,
    turn: 4, stateStamp: STAMP, patch: {upserts: [{id: 'q1', kind: 'open_question', text: 'Who moved the letter?', evidence: ['npc:gardener']}]}, ...over});
  test('publish is revision-compared, atomic and readable back', async () => {
    const store = make();
    const first = await store.publish(patch());
    assert.equal(first.status, 'published');
    assert.equal(first.view.revision, 1);
    assert.deepEqual(first.view.entries[0], {id: 'q1', kind: 'open_question', text: 'Who moved the letter?',
      status: 'tentative', evidence: ['npc:gardener'], turn: 4, stateStamp: STAMP});
    const read = await store.read(patch().scope);
    assert.equal(read.status, 'ok');
    assert.equal(read.view.revision, 1);
    // A second patch bound to the same base revision lost the race: discarded, never merged.
    const conflict = await store.publish(patch());
    assert.deepEqual(conflict, {status: 'discarded', reason: 'revision_conflict'});
    // The winner publishes against the current revision and replaces the item it upserts.
    const second = await store.publish(patch({baseRevision: 1, turn: 5, stateStamp: 'c'.repeat(64),
      patch: {focus: 'the letter', upserts: [{id: 'q1', kind: 'hypothesis', text: 'The gardener took it.', status: 'needs_recheck', evidence: ['turn:1']}]}}));
    assert.equal(second.status, 'published');
    assert.equal(second.view.entries.length, 1, 'an upsert replaces, never duplicates');
    assert.equal(second.view.entries[0].turn, 5, 'a re-published item refreshes its binding');
    assert.equal(second.view.focus, 'the letter');
    const removed = await store.publish(patch({baseRevision: 2, patch: {removes: ['q1']}}));
    assert.equal(removed.status, 'published');
    assert.deepEqual(removed.view.entries, []);
    assert.equal(removed.view.focus, 'the letter', 'a patch without focus leaves the focus line alone');
  });
  test('an invalid or over-limit patch is discarded without touching the stored items', async () => {
    const store = make();
    await store.publish(patch());
    assert.deepEqual(await store.publish(patch({baseRevision: 1,
      patch: {upserts: [{id: 'q2', kind: 'hypothesis', text: 'note', evidence: ['npc:gardener'], confidence: 1}]}})),
      {status: 'discarded', reason: 'invalid_patch'});
    assert.equal((await store.read(patch().scope)).view.entries.length, 1, 'the stored item survived the bad patch');
    // Fill the workpad past its 2 KiB bound: the whole pushing patch is discarded, earlier items stay.
    const filler = Array.from({length: 8}, (_, i) => ({id: `n${i}`, kind: 'hypothesis', text: 'x'.repeat(200), status: 'tentative', evidence: ['npc:gardener']}));
    await store.publish(patch({baseRevision: 1, patch: {upserts: filler.slice(0, 3)}}));
    assert.equal((await store.read(patch().scope)).view.entries.length, 4, 'the fillers that fit are stored');
    const over = await store.publish(patch({baseRevision: 2, patch: {upserts: filler.slice(3, 6)}}));
    assert.deepEqual(over, {status: 'discarded', reason: 'workpad_over_limit'});
    assert.equal((await store.read(patch().scope)).view.entries.length, 4, 'the pushing patch left nothing behind');
  });
  test('a corrupt, oversized or foreign-scope file reads as an empty workpad and is rebuilt by the next publish', async () => {
    const store = make();
    const scope = patch().scope;
    await store.publish(patch());
    const file = readdirSync(store.root).find(name => name.endsWith('.json'));
    writeFileSync(join(store.root, file), '{not json at all');
    assert.deepEqual(await store.read(scope), {status: 'empty'}, 'corrupt is a miss, never an error');
    assert.equal(await store.publish(patch()).then(r => r.status), 'published', 'the next publish rebuilds the file');
    writeFileSync(join(store.root, file), JSON.stringify({version: 1, scope, revision: 99,
      focus: null, entries: Array.from({length: 40}, (_, i) => entry(`x${i}`, STAMP))}));
    assert.deepEqual(await store.read(scope), {status: 'empty'}, 'an oversized or item-capped file is a miss');
    const other = await store.read({campaign: 'test-campaign', worldline: 'side', loop: 0});
    assert.deepEqual(other, {status: 'empty'}, 'another worldline starts from nothing');
    assert.equal(await store.publish(patch()).then(r => r.status), 'published', 'the store accepts a good patch again');
    assert.equal((await store.read({campaign: 'test-campaign', worldline: 'main', loop: 0})).status, 'ok');
  });
  test('worldline and loop scopes are separate stores; dormant lines are retained, not merged', async () => {
    const store = make();
    await store.publish(patch());
    const side = await store.publish(patch({scope: {campaign: 'test-campaign', worldline: 'side', loop: 0},
      patch: {upserts: [{id: 'q1', kind: 'hypothesis', text: 'Side line note', evidence: ['npc:gardener']}]}}));
    assert.equal(side.status, 'published', 'a new line starts at revision 0 and publishes');
    assert.equal((await store.read(patch().scope)).view.entries[0].text, 'Who moved the letter?', 'the dormant line is retained');
    const back = await store.read({campaign: 'test-campaign', worldline: 'side', loop: 1});
    assert.deepEqual(back, {status: 'empty'}, 'a loop change is a different scope, nothing inherited');
  });
  test('the root sits beside the evidence cache under the host home', () => {
    assert.equal(api.workpadStoreRoot('/tmp/home'), join('/tmp/home', '.coc', 'workspace-cache', 'workpad'));
    assert.throws(() => api.workpadStoreRoot(''), TypeError);
  });
  after(async () => { for (const dir of made.splice(0)) await rm(dir, {recursive: true, force: true}); });
});

describe('workpad projection', () => {
  test('entries ride the workspace message as advisory working notes, current first, stale marked', () => {
    const selection = api.selectWorkspace({snapshot: snapshot(), binding: binding(4), budget: 24576,
      workpad: view([entry('q1', STAMP), entry('q2', 'c'.repeat(64)), entry('q3', 'c'.repeat(64), {turn: 1})], 'the letter')});
    assert.equal(selection.status, 'selected');
    const content = JSON.parse(selection.message.content);
    assert.equal(content.workpad.focus, 'the letter');
    assert.match(content.workpad.note, /never facts/);
    assert.deepEqual(content.workpad.entries.map(e => [e.id, e.validity]),
      [['q1', 'current'], ['q3', 'stale'], ['q2', 'stale']], 'current leads, stale follows, then publish turn');
    assert.equal(content.workpad.entries[1].needs_recheck, true, 'a state change marks the old note needs_recheck');
    assert.equal(content.workpad.entries[0].needs_recheck, undefined);
    assert.deepEqual(Object.keys(content.workpad.entries[0]).sort(),
      ['evidence', 'id', 'kind', 'status', 'text', 'turn', 'validity']);
    assert.deepEqual(selection.counts.workpad, {packed: 3, omitted: 0});
    // The evidence section is untouched by the workpad.
    assert.deepEqual(content.evidence.map(e => e.locator), ['npc:gardener', 'scene:estate', 'turn:1']);
  });
  test('a moved state stamps every entry stale without deleting anything', () => {
    const selection = api.selectWorkspace({snapshot: snapshot('d'.repeat(64)), binding: binding(4), budget: 24576,
      workpad: view([entry('q1', STAMP)])});
    const content = JSON.parse(selection.message.content);
    assert.equal(content.workpad.entries[0].validity, 'stale');
    assert.equal(content.workpad.entries[0].needs_recheck, true);
  });
  test('the budget skips workpad items before it ever cuts packed evidence, and counts what it skipped', () => {
    const fat = view(Array.from({length: 6}, (_, i) => entry(`q${i}`, STAMP, {text: `Note ${i} `.repeat(20)})));
    const roomy = api.selectWorkspace({snapshot: snapshot(), binding: binding(4), budget: 24576, workpad: fat});
    assert.deepEqual(JSON.parse(roomy.message.content).workpad.entries.map(e => e.id), ['q0', 'q1', 'q2', 'q3', 'q4', 'q5']);
    const tight = api.selectWorkspace({snapshot: snapshot(), binding: binding(4), budget: 1300, workpad: fat});
    assert.equal(tight.status, 'selected');
    const view1 = JSON.parse(tight.message.content);
    assert.ok(view1.evidence.length >= 1, 'packed evidence survives a tight workpad budget');
    const shown = view1.workpad?.entries ?? [];
    assert.deepEqual(tight.counts.workpad, {packed: shown.length, omitted: 6 - shown.length});
    if (shown.length) assert.equal(view1.workpad.omitted, tight.counts.workpad.omitted, 'the section reports its own omissions');
    const floor = api.selectWorkspace({snapshot: snapshot(), binding: binding(4), budget: 700, workpad: view([entry('q1', STAMP)], 'focus')});
    assert.equal(floor.status, 'selected');
    assert.equal(JSON.parse(floor.message.content).workpad, undefined, 'not even the focus fits: the workpad is omitted whole');
    assert.ok(floor.counts.workpad.omitted >= 1);
  });
  test('no workpad view means no workpad section at all', () => {
    const bare = api.selectWorkspace({snapshot: snapshot(), binding: binding(4), budget: 24576});
    assert.equal('workpad' in JSON.parse(bare.message.content), false);
  });
});

describe('workpad patch parameter handling', () => {
  test('takeWorkpadPatch deletes the patch from the arguments and only for delivery tools', () => {
    const params = {text: 'story', workpad_patch: {focus: 'x'}};
    assert.deepEqual(api.takeWorkpadPatch('narrate', params), {focus: 'x'});
    assert.deepEqual(params, {text: 'story'}, 'the arguments no longer carry the patch');
    assert.equal(api.takeWorkpadPatch('look', {workpad_patch: {focus: 'x'}}), undefined, 'non-delivery tools are untouched');
    assert.equal(api.takeWorkpadPatch('ask', {}), undefined);
  });
});

// ---- Live table: the real extension path with the scripted kernel ------------------------------

function payloadsOf(context, kind) {
  return context.messages.flatMap(message => (Array.isArray(message.content) ? message.content : []).flatMap(block => {
    if (block.type !== 'text') return [];
    try {const data = JSON.parse(block.text); return data?.kind === kind ? [data] : [];} catch {return [];}
  }));
}
const keeperTurn = (text, patch) => [fauxAssistantMessage(
  [fauxToolCall('narrate', {text, ...(patch ? {workpad_patch: patch} : {})})], {stopReason: 'toolUse'})];
const LETTER_PATCH = {focus: 'the letter on the desk',
  upserts: [{id: 'q1', kind: 'open_question', text: 'Who else has a key to the desk?',
    status: 'tentative', evidence: ['npc:gardener']},
    {id: 'h1', kind: 'hypothesis', text: 'The letter was never posted.', evidence: ['scene:estate']}],
  removes: []};

test('a delivered narrate publishes its patch and the next request shows it stale', async t => {
  const requests = [];
  const table = await openTable({
    campaign: 'workpad-live', realKernel: false, retainAt: directory,
    env: {FAKE_KERNEL_WORKSPACE: '1'},
    responses: [...keeperTurn('The letter sits where you left it, sealed and patient.', LETTER_PATCH),
      ...keeperTurn('You pocket the letter; the hall stays quiet.')],
  });
  t.after(() => table.dispose());
  const runner = table.session._extensionRunner, transform = runner.emitContext.bind(runner);
  runner.emitContext = async messages => {
    const result = await transform(messages);
    requests.push({context: {messages: convertToLlm(result)}, branch: structuredClone(table.rawEntries())});
    return result;
  };
  await table.session.prompt('I take the letter from the desk.');
  await waitForIdle(table.session, {timeoutMs: 60000});
  // Strip: the kernel RPC never sees the patch, and the binding read happened before the delivery.
  const requests1 = table.kernelRequests();
  const narrate = requests1.filter(r => r.method === 'table.narrate');
  assert.equal(narrate.length, 1);
  assert.equal('workpad_patch' in narrate[0].params, false, 'the kernel arguments carry no patch');
  const readAt = requests1.findIndex(r => r.method === 'table.workspace.read');
  assert.ok(readAt >= 0 && readAt < requests1.findIndex(r => r.method === 'table.narrate'),
    'the call-start binding read precedes the delivery');
  assert.deepEqual(Object.keys(requests1[readAt].params).sort(), ['campaign'], 'the read is host-only and parameterless');
  // Publish: the store file exists beside the evidence cache and telemetry recorded the lifecycle.
  await waitFor(() => existsSync(join(table.workspace, '.coc', 'workspace-cache', 'workpad')), {timeoutMs: 10000});
  const storeFiles = readdirSync(join(table.workspace, '.coc', 'workspace-cache', 'workpad')).filter(f => f.endsWith('.json'));
  assert.equal(storeFiles.length, 1);
  const stored = JSON.parse(readFileSync(join(table.workspace, '.coc', 'workspace-cache', 'workpad', storeFiles[0]), 'utf8'));
  assert.equal(stored.revision, 1);
  assert.equal(stored.focus, 'the letter on the desk');
  assert.deepEqual(stored.entries.map(e => e.id), ['q1', 'h1']);
  const lanes = table.telemetry().filter(row => row.lane === 'workpad');
  assert.deepEqual(lanes.map(row => row.event), ['bound', 'published']);
  assert.equal(lanes.find(row => row.event === 'published').entries, 2);
  // The player saw the delivery, never the patch; the branch carries no workspace message.
  const sessionTexts = table.session.messages.flatMap(m => typeof m.content === 'string' ? [m.content]
    : Array.isArray(m.content) ? m.content.filter(b => b?.type === 'text').map(b => b.text) : []).join('\n');
  assert.equal(sessionTexts.includes('Who else has a key to the desk?'), false, 'the patch never reaches any visible surface');
  assert.equal(table.rawEntries().filter(e => e.type === 'custom_message' && e.customType === 'coc-workspace').length, 0,
    'the workpad rides the transport-only message, never the branch');
  for (const input of table.lanes.admission.requests())
    assert.equal(input.includes('workpad_patch'), false, 'admission never sees the patch');

  // The next turn moved the state stamp: the same note comes back marked needs_recheck.
  await table.session.prompt('I pocket the letter and look around.');
  await waitForIdle(table.session, {timeoutMs: 60000});
  const withWorkspace = requests.filter(request => payloadsOf(request.context, 'coc_workspace').length > 0);
  assert.ok(withWorkspace.length >= 1, `the workspace reached the outgoing request: ${JSON.stringify({
    requests: requests.length, lanes: table.telemetry().filter(row => row.lane === 'workspace'), errors: table.extensionErrors})}`);
  const views = withWorkspace.flatMap(request => payloadsOf(request.context, 'coc_workspace'));
  const withWorkpad = views.filter(v => v.workpad && v.workpad.entries.length > 0);
  assert.ok(withWorkpad.length >= 1, 'the published notes reach the keeper-only message');
  const shown = withWorkpad[0].workpad;
  assert.equal(shown.focus, 'the letter on the desk');
  assert.deepEqual(shown.entries.map(e => e.id), ['h1', 'q1'], 'current entries order by publish turn then item name');
  for (const e of shown.entries) {
    assert.equal(e.validity, 'stale', 'a note from an earlier turn is marked stale');
    assert.equal(e.needs_recheck, true);
  }
  assert.match(shown.note, /never facts/);
  for (const request of withWorkspace) {
    for (const v of payloadsOf(request.context, 'coc_workspace'))
      assert.equal(JSON.stringify(v).includes('stateStamp'), false, 'host stamps stay host-side');
  }
  assert.deepEqual(table.extensionErrors, []);
});

test('a refused delivery drops its patch without a second model round', async t => {
  const table = await openTable({
    campaign: 'workpad-refused', realKernel: false, retainAt: directory,
    env: {FAKE_KERNEL_WORKSPACE: '1',
      FAKE_KERNEL_ERRORS: JSON.stringify({'table.narrate': {code: 'invalid_params', message: 'the table refuses this draft'}})},
    responses: [...keeperTurn('This draft is refused.', LETTER_PATCH), fauxAssistantMessage('Then I stop here.')],
  });
  t.after(() => table.dispose());
  await table.session.prompt('I take the letter from the desk.');
  await waitForIdle(table.session, {timeoutMs: 60000});
  const lanes = table.telemetry().filter(row => row.lane === 'workpad');
  assert.deepEqual(lanes.map(row => row.event), ['bound', 'dropped'], 'the patch was bound, then dropped with the refusal');
  assert.equal(lanes.find(row => row.event === 'dropped').reason, 'delivery_failed');
  assert.equal(existsSync(join(table.workspace, '.coc', 'workspace-cache', 'workpad')), false, 'nothing was published');
  // The delivery failure itself is unchanged: the tool result carries the kernel error, verbatim.
  const result = table.session.messages.find(m => m.role === 'toolResult');
  assert.ok(JSON.stringify(result).includes('the table refuses this draft'));
});

test('a split delivery is refused whole and never binds or publishes', async t => {
  const table = await openTable({
    campaign: 'workpad-split', realKernel: false, retainAt: directory,
    env: {FAKE_KERNEL_WORKSPACE: '1'},
    responses: [fauxAssistantMessage([
      fauxToolCall('narrate', {text: 'First half.', workpad_patch: LETTER_PATCH}),
      fauxToolCall('narrate', {text: 'Second half.', workpad_patch: LETTER_PATCH}),
    ], {stopReason: 'toolUse'}), fauxAssistantMessage('Understood; one delivery, then.')],
  });
  t.after(() => table.dispose());
  await table.session.prompt('I take the letter from the desk.');
  await waitForIdle(table.session, {timeoutMs: 60000});
  assert.equal(table.telemetry().filter(row => row.lane === 'workpad').length, 0,
    'the gate refuses before the host ever binds a patch');
  assert.equal(existsSync(join(table.workspace, '.coc', 'workspace-cache', 'workpad')), false);
});

test('mode off silently drops the patch: no read, no store, delivery unchanged', async t => {
  const table = await openTable({
    campaign: 'workpad-off', realKernel: false, retainAt: directory,
    responses: [...keeperTurn('The letter sits where you left it.', LETTER_PATCH)],
  });
  t.after(() => table.dispose());
  await table.session.prompt('I take the letter from the desk.');
  await waitForIdle(table.session, {timeoutMs: 60000});
  const requests1 = table.kernelRequests();
  assert.equal(requests1.filter(r => r.method === 'table.workspace.read').length, 0, 'off reads nothing');
  assert.equal('workpad_patch' in (requests1.find(r => r.method === 'table.narrate')?.params ?? {}), false,
    'the kernel arguments are clean regardless of mode');
  assert.deepEqual(table.telemetry().filter(row => row.lane === 'workpad').map(row => row.event), ['dropped']);
  assert.equal(table.telemetry().filter(row => row.lane === 'workpad')[0].reason, 'workspace_off');
  assert.equal(existsSync(join(table.workspace, '.coc', 'workspace-cache', 'workpad')), false);
  const narrate = requests1.find(r => r.method === 'table.narrate');
  assert.equal(narrate.params.text, 'The letter sits where you left it.', 'the delivery itself is byte-identical');
});
