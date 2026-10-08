/**
 * Contract §103.1, on the real path: the kernel in process and the context hooks as installed.
 *
 * Installed App, Blood Road (2026-10-03): the Keeper named the gas station's owner on turn 2. Three ways the book's name
 * reached him or the player: the capsule the context hook sends is its own copy, not the persisted message the Keeper's
 * view was applied to; the clerk's note and tool results carry the book's names; and a say token resolved to the book's
 * name, which the transcript shows on hover and the kernel then counted as told.
 *
 * §194.1 (owner ruling 2026-10-08, two ledgers): real table TR-F showed the cost of hiding the names from the Keeper -- the
 * request's words for the untold were wrong, and the Keeper retold the module's key letter from them. The request now
 * carries the book's names as written (the capsule's `book_name`, host messages, tool results); only a handle is still shown
 * as the table's word; and the exit gate (§177.11) is what keeps a name from the player.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'untold-request-suite-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export * from './extensions/table/context-runtime.ts';
export * from './extensions/table/workspace/workpad-store.ts';`, resolveDir: root},
  outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

test('§194.1: the request carries an untold person\'s book name where the host wrote it; the capsule row is the word, book_name beside; a say token by handle tells nothing', async t => {
  const home = await mkdtemp(join(temporary, 'real-'));
  const kernel = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'untold-request',
    locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(kernel); t.after(() => runtime.close());
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  const knott = (await call('table.untold')).people.find(person => person.name === 'Steven Knott');
  assert.deepEqual(knott, {name: 'Steven Knott', id: 'steven-knott', shown: 'steven-knott'});

  const input = await call('table.player_input', {text: 'I ask Steven Knott what he wants.'});
  const rows = [], hooks = new Map(), bus = new Map();
  api.installContextPolicy({on: (name, fn) => hooks.set(name, fn), events: {on: (name, fn) => bus.set(name, fn)}},
    row => rows.push(row), () => api.workpadStoreRoot(home));
  bus.get('coc:kernel-bridge')({campaign: 'c1', call});
  bus.get('coc:capsule')({capsule: input.capsule, context: input._context});
  const messages = [
    {role: 'user', content: 'I ask Steven Knott what he wants.'},
    {role: 'custom', customType: 'coc-clerk', content: JSON.stringify({clerk_did: [{label: 'Initialize the authored presence of Steven Knott'}]}), display: false},
    {role: 'assistant', content: [{type: 'toolCall', id: 'look-1', name: 'look', arguments: {focus: 'npc', name: 'steven-knott'}}]},
    {role: 'toolResult', toolCallId: 'look-1', toolName: 'look', content: [{type: 'text', text: JSON.stringify({name: 'Steven Knott'})}]},
  ];
  const {messages: sent} = await hooks.get('context')({messages}, {model: {contextWindow: 1000000}});
  assert.ok(!sent.some(message => message.customType === 'coc-context-status'), JSON.stringify(rows.slice(-3)));
  const capsule = JSON.parse(sent.find(message => message.customType === 'coc-capsule').content);
  const row = capsule.present.find(person => person.untold && person.name === 'steven-knott');
  assert.ok(row, JSON.stringify(capsule.present));
  // §194.1: the capsule the hook itself sends carries the Keeper's view: the word as name, the book's name beside it.
  assert.equal(row.book_name, 'Steven Knott', 'the Keeper holds the book\'s name');
  assert.equal('name' in row.untold, false, 'the untold block itself carries no second seat');
  assert.match(row.untold.use, /has not heard this person's name/);
  assert.match(JSON.stringify(sent), /presence of Steven Knott/, 'the clerk\'s note reaches the Keeper as written');
  const result = sent.find(message => message.role === 'toolResult');
  assert.equal(result.content[0].text, JSON.stringify({name: 'Steven Knott'}), 'and a tool result');
  assert.equal(result.content.length, 1, 'nothing was renamed, so no untold-names note');
  assert.equal(sent.find(message => message.role === 'user').content, 'I ask Steven Knott what he wants.', 'the player\'s words are theirs');

  const byHandle = await call('table.narrate', {call_id: `t${input._context.turn}-c1`, text: 'The man behind the desk looks up. {{say:steven-knott}}"Sit down."{{/say}}'});
  assert.deepEqual(byHandle.speech?.[0]?.who, {npc: 'steven-knott', name: 'Steven Knott', shown: ''}, JSON.stringify(byHandle.speech));
  assert.ok((await call('table.untold')).people.some(person => person.id === 'steven-knott'), 'a token by handle shows nothing and tells nothing');

  const next = await call('table.player_input', {text: 'Who are you?'});
  const byName = await call('table.narrate', {call_id: `t${next._context.turn}-c1`, text: '{{say:Steven Knott}}"{{name:Steven Knott}}, of the commission."{{/say}}'});
  assert.deepEqual(byName.speech?.[0]?.who, {npc: 'steven-knott', name: 'Steven Knott'}, 'the book\'s name in a token is shown as it always was');
  assert.ok(!(await call('table.untold')).people.some(person => person.id === 'steven-knott'), 'and once shown it is told');
});

test('§176.5/§194.1: with the epithet lane\'s word, the request shows his handle and node id as the word, keeps his book name, and the row carries the name token', async t => {
  const home = await mkdtemp(join(temporary, 'real-'));
  const kernel = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'untold-request-epithet',
    locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(kernel); t.after(() => runtime.close());
  const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
  await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  await call('table.open');
  await call('epithets.submit', {entries: [{id: 'steven-knott', word: 'the ink-stained clerk'}]});
  const input = await call('table.player_input', {text: 'I ask the clerk what he wants.'});
  const rows = [], hooks = new Map(), bus = new Map();
  api.installContextPolicy({on: (name, fn) => hooks.set(name, fn), events: {on: (name, fn) => bus.set(name, fn)}},
    row => rows.push(row), () => api.workpadStoreRoot(home));
  bus.get('coc:kernel-bridge')({campaign: 'c1', call});
  bus.get('coc:capsule')({capsule: input.capsule, context: input._context});
  const messages = [
    {role: 'user', content: 'I ask the clerk what he wants.'},
    {role: 'custom', customType: 'coc-clerk', content: JSON.stringify({clerk_did: [{label: 'Initialize the authored presence of steven-knott (npc-steven-knott)'}]}), display: false},
    {role: 'assistant', content: [{type: 'toolCall', id: 'look-1', name: 'look', arguments: {focus: 'npc', name: 'the ink-stained clerk'}}]},
    {role: 'toolResult', toolCallId: 'look-1', toolName: 'look', content: [{type: 'text', text: JSON.stringify({id: 'steven-knott', name: 'Steven Knott'})}]},
  ];
  const {messages: sent} = await hooks.get('context')({messages}, {model: {contextWindow: 1000000}});
  const written = sent.filter(message => message.role !== 'user').map(message => JSON.stringify(message.content)).join('\n');
  for (const leak of ['steven-knott', 'npc-steven-knott']) assert.ok(!written.includes(leak), `${leak} reaches the Keeper`);
  assert.match(written, /presence of the ink-stained clerk \(the ink-stained clerk\)/, 'the handle and the node id are renamed to his word');
  const result = sent.find(message => message.role === 'toolResult');
  assert.equal(result.content[0].text, JSON.stringify({id: 'the ink-stained clerk', name: 'Steven Knott'}), 'in a tool result the handle is the word, the book\'s name stays');
  assert.match(result.content.at(-1).text, /^\[untold names\][^]*\{\{name:the ink-stained clerk\}\}/, 'a handle renamed, the result says so with his token');
  const capsule = JSON.parse(sent.find(message => message.customType === 'coc-capsule').content);
  const row = capsule.present.find(person => person.untold && person.name === 'the ink-stained clerk');
  assert.ok(row, JSON.stringify(capsule.present));
  assert.equal(row.untold.say_name, '{{name:the ink-stained clerk}}');
  assert.equal(row.book_name, 'Steven Knott');
  // §177.4 (table 25): the roster the request was renamed by is on the turn's record, and a failed read would be too.
  const prepared = rows.find(entry => entry.lane === 'context' && entry.event === 'prepared');
  assert.ok(prepared?.untold_rows > 0 && !prepared.untold_failed, JSON.stringify(prepared));
  const said = await call('table.narrate', {call_id: `t${input._context.turn}-c1`, text: `He looks up. {{say:the ink-stained clerk}}"I am ${row.untold.say_name}."{{/say}}`});
  assert.match(said.rendered_text, /I am Steven Knott\./, 'the copied token says his book name');
});

/**
 * A reader-built book with a cast (§177): one page, the Dock, and Old Mae on it, untold. The cast prints her as "Old Mae" and
 * "Mae", so the delivery gate (§177.11) has names to hold; an authored starter has no cast and holds nothing.
 */
async function castBook(t) {
  const home = await mkdtemp(join(temporary, 'cast-'));
  const kernel = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'untold-request-cast',
    locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(kernel); t.after(() => runtime.close());
  const raw = (method, params = {}) => runtime.handlers[method](params);
  const page = 'The harbor dock smells of tar. Old Mae mends nets by the water; the regulars call her Mae.', refs = [{page: 1}];
  const pdf = join(home, 'harbor.pdf');
  await writeFile(pdf, `%PDF-1.7\n% ${page}\n%%EOF\n`);
  const sha = createHash('sha256').update(await readFile(pdf)).digest('hex');
  const {module_id: mid} = await raw('module.source.bind', {source: {path: pdf, page_count: 1, file_sha256: sha}});
  const read = async (purpose, draft, paths) => {
    await raw('module.read.request', {module_id: mid, purpose});
    const job = await raw('module.read.claim', {module_id: mid, owner: 'test-host'});
    await writeFile(join(job.work_dir, 'observations.json'), JSON.stringify({file_sha256: sha, read_pages: [1], full_pages: [1], review_pages: [1]}));
    await writeFile(join(job.work_dir, 'draft.json'), JSON.stringify(draft));
    await writeFile(join(job.work_dir, 'review.json'), JSON.stringify({checked: [{paths, verdict: 'supported', source_refs: refs, reason: 'fixture support'}], missing: []}));
    return raw('module.read.finish', {module_id: mid, job_id: job.job_id, lease: job.lease, outcome: 'completed',
      draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
  };
  await read('index', {title: 'The Harbor', language: 'en', sections: [{name: 'Harbor', pages: [[1, 1]], source_refs: refs, entities: ['Dock']}]}, []);
  await read('opening', {nodes: [
    {node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: refs, properties: {is_entrance: true, is_final: true}},
    {node_id: 'npc-old-mae', node_kind: 'npc', name: 'Old Mae', source_refs: refs, summary: 'A net mender on the dock.'}],
    claims: [{subject_id: 'npc-old-mae', predicate: 'present-in', object: {node_id: 'scene-dock'}, truth_status: 'authored-fact', source_refs: refs}],
    node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-dock', 'npc-old-mae']}, ['/nodes/0', '/nodes/1', '/claims/0', '/coverage']);
  const cast = await raw('cast.job', {module_id: mid, claim: true});
  await raw('cast.source', {module_id: mid, job_id: cast.job_id, lease: cast.lease, pages: [{page: 1, text: page}]});
  const range = await raw('cast.range', {module_id: mid, job_id: cast.job_id, lease: cast.lease, index: 0});
  await writeFile(join(range.cwd, 'draft.json'), JSON.stringify({people: [{book: ['Old Mae', 'Mae'], play: ['Old Mae', 'Mae'], notes: ['Old Mae', 'Mae'], pages: [1]}]}));
  assert.equal((await raw('cast.submit', {module_id: mid, job_id: cast.job_id, lease: cast.lease, index: 0})).state, 'complete');
  await raw('campaign.create', {id: 'card-source', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  const saved = await raw('investigator.save', {campaign: 'card-source'});
  await raw('campaign.create', {id: 'c1', module: mid, play_language: 'en'});
  await raw('investigator.load', {campaign: 'c1', library_id: saved.library_id});
  await raw('setup.complete', {campaign: 'c1'});
  const call = (method, params = {}) => raw(method, {campaign: 'c1', ...params});
  await call('table.open');
  return {home, call};
}

test('§194.1: the capsule and a tool result carrying an untold person\'s book name reach the Keeper as written, and a delivery printing it is still refused the first time (§177.11)', async t => {
  const {home, call} = await castBook(t);
  await call('table.narrate', {call_id: 't0-c1', text: 'The harbor is quiet.'});
  const mae = (await call('table.untold')).people.find(person => person.name === 'Old Mae');
  assert.ok(mae, JSON.stringify(await call('table.untold')));
  assert.deepEqual((await call('epithets.submit', {entries: [{id: mae.id, word: 'the net mender'}]})).refused, []);
  const input = await call('table.player_input', {text: 'I watch the woman at the nets.'});
  const look = await call('table.look', {focus: 'npc', name: 'the net mender'});
  assert.ok(JSON.stringify(look).includes('Old Mae'), `the kernel's own look carries her book name: ${JSON.stringify(look)}`);

  const rows = [], hooks = new Map(), bus = new Map();
  api.installContextPolicy({on: (name, fn) => hooks.set(name, fn), events: {on: (name, fn) => bus.set(name, fn)}},
    row => rows.push(row), () => api.workpadStoreRoot(home));
  bus.get('coc:kernel-bridge')({campaign: 'c1', call});
  bus.get('coc:capsule')({capsule: input.capsule, context: input._context});
  const result = [{type: 'text', text: JSON.stringify(look)}];
  const {messages: sent} = await hooks.get('context')({messages: [{role: 'user', content: 'I watch the woman at the nets.'},
    {role: 'assistant', content: [{type: 'toolCall', id: 'look-1', name: 'look', arguments: {focus: 'npc', name: 'the net mender'}}]},
    {role: 'toolResult', toolCallId: 'look-1', toolName: 'look', content: result}]}, {model: {contextWindow: 1000000}});
  const prepared = rows.find(entry => entry.lane === 'context' && entry.event === 'prepared');
  assert.ok(prepared?.untold_rows > 0 && !prepared.untold_failed, `the roster was read: ${JSON.stringify(prepared)}`);
  assert.deepEqual(sent.find(message => message.role === 'toolResult').content, result, 'the tool result reaches the Keeper unchanged, no note');
  const capsule = JSON.parse(sent.find(message => message.customType === 'coc-capsule').content);
  const row = capsule.present.find(person => person.untold);
  assert.deepEqual([row?.name, row?.book_name, row?.untold?.say_name], ['the net mender', 'Old Mae', '{{name:the net mender}}'], JSON.stringify(capsule.present));
  assert.ok(!rows.some(entry => entry.lane === 'untold-spans'), 'nothing in the request is asked about');

  // The exit is the guard: the first delivery printing her name is refused, naming no name; the token says it and tells it.
  await assert.rejects(call('table.narrate', {call_id: `t${input._context.turn}-c1`, text: 'Old Mae looks up from the nets.'}),
    error => error?.details?.reason === 'untold_name' && error.details.places === 1 && !JSON.stringify(error.details).includes('Old Mae'), 'the name is held at the exit');
  const told = await call('table.narrate', {call_id: `t${input._context.turn}-c2`,
    text: `The net mender looks up. {{say:the net mender}}"Folk call me ${row.untold.say_name}."{{/say}}`});
  assert.match(told.rendered_text, /Folk call me Old Mae\./);
  assert.ok(!(await call('table.untold')).people.some(person => person.id === mae.id), 'said through the token, she is told');
});
