/**
 * Contract §185.7 and §185.10 (NFH-04, docs/specs/name-free-handles.md): in a name-free campaign no book node's node id,
 * no old slug (the node id without its kind, which the reading layer keeps as the book's handle, §185.12) and no cast name
 * inside an identifier reaches the Keeper.
 *
 * The seam is the one §185.10 names: the kernel in process and the context hooks as installed. A reader-built book whose
 * node ids carry its people's names -- `npc-robert-taylor`, `scene-robert-taylor-home`, `clue-mae-collins-note`, a stated
 * obligation `requirement-robert-taylor-ledger` -- is read through the real reading path, its cast read, and a name-free
 * campaign played on it for an opening and two turns: the handle lane names some nodes, gives one up and leaves the rest
 * interim, and names one more person between the turns; the epithet, first-sight and memory lanes answer. Every
 * Keeper-facing surface the turns reach is handed to the hook as the tool or the host hands it -- a tool result is
 * `JSON.stringify(result)` (the kernel extension's success path), a refusal the lines `errorText` renders, a host message
 * its text (the opening, the recovery after a mid-turn reopen, the reading layer's answers) -- and the request the hook
 * assembles, workspace included, is scanned. Contract §185.11 `#### NFH-04` lists what the scan found and what was done.
 *
 * What the scan compares, all exact strings the kernel holds:
 * - every node id of the book's graph, anywhere in any string or key;
 * - every old slug, inside an identifier: equal to a hyphen-bounded run of one of its `:` segments;
 * - every cast form `handles.job` gives the lane to avoid (§185.5), inside an identifier, by the check `carries_name`
 *   uses (`occurs` on the normalized identifier).
 *
 * Which strings are identifiers is read from the contract's grammar of references, never from what a string means:
 * - every object key (a projection keys its maps by handle);
 * - every string value that is, as a whole, lowercase ASCII kebab-case segments joined by `:` -- §185.5's handle shape and
 *   the composites built from handles (an intention ref, §142; a receipt id; a marker);
 * - inside any other string (a message, a fix, prose), every token in that grammar that joins two segments by `-` or `:`.
 * A display name or a sentence, in any language, is never one: names inside prose are the request rename's (§103.5).
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = resolve(import.meta.dirname, '../..'), content = join(root, 'content');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'name-free-egress-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export {pythonJsonDumps} from './kernel-ts/json.ts';
export {checkSourceDraft} from './kernel-ts/check.ts';
export {occurs} from './kernel-ts/journal/naming.ts';
export {normalize, stripPrefix} from './kernel-ts/read/values.ts';
export {openingInstruction} from './extensions/kernel/opening-instruction.ts';
export * from './extensions/table/context-runtime.ts';
export * from './extensions/table/workspace/workpad-store.ts';`, resolveDir: root, sourcefile: 'name-free-egress-api.ts', loader: 'ts'},
  outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

// ---------------------------------------------------------------------------------------------------
// The book: every person, and every node that names a person, carries the person's name in its id.
// ---------------------------------------------------------------------------------------------------

const REFS = [{page: 1}];
const node = (node_id, node_kind, name, summary, properties = {}, page = 1) => ({node_id, node_kind, name, summary, source_refs: [{page}], properties});
const claim = (subject_id, predicate, object) => ({subject_id, predicate, object: {node_id: object}, truth_status: 'authored-fact', source_refs: REFS});
const PAGES = ['Robert Taylor keeps the Harbor Bar. Mae Collins pours the drinks and rents the room upstairs from Ida Brooks. The rent ledger sits under the counter.',
  'Taylor\'s house stands up the hill; his hound guards the yard and fears the brass whistle.'];
const OWNER_LOOKS = 'The bar owner with a pencil mustache.', BARMAID_LOOKS = 'A barmaid who watches the door.', LANDLADY_LOOKS = 'The landlady who lets the room upstairs.';
/** The barmaid's room is in the book but not read yet: moving there meets the reading layer (§185.12). */
const UNREAD = 'scene-mae-collins-room', LANDLADY = 'npc-ida-brooks';

function opening() {
  const nodes = [
    node('scene-harbor-bar', 'scene', 'Harbor Bar', 'A smoky bar on the dock.', {is_entrance: true}),
    node('scene-robert-taylor-home', 'scene', 'Taylor\'s house', 'A narrow house up the hill.', {is_final: true}, 2),
    node(UNREAD, 'scene', 'The room upstairs', 'A rented room above the bar.'),
    node(LANDLADY, 'npc', 'Ida Brooks', LANDLADY_LOOKS),
    node('npc-robert-taylor', 'npc', 'Robert Taylor', OWNER_LOOKS, {agenda: 'Keep the rent ledger hidden.', thread_refs: ['clue-robert-taylor-ledger']}),
    node('npc-mae-collins', 'npc', 'Mae Collins', BARMAID_LOOKS, {agenda: 'Leave town before winter.'}),
    // A reader's raw properties may name other nodes by id anywhere (§185.7: a raw dump shows them as handles).
    node('clue-robert-taylor-ledger', 'clue', 'Rent ledger', 'The rents taken from the house, year by year.', {thread_refs: ['clue-mae-collins-note']}),
    node('clue-mae-collins-note', 'clue', 'Folded note', 'A note in a barmaid\'s hand.'),
    node('conclusion-robert-taylor-owes-rent', 'conclusion', 'The owner owes rent', 'The bar owner is behind on his rent.'),
    node('creature-robert-taylor-hound', 'creature', 'Yard hound', 'A lean hound that guards the yard.', {
      weaknesses: [{book: 'A blast of the brass whistle sends it cowering.', needs: ['artifact-robert-taylor-whistle']}],
      mechanics: {profile: {characteristics: {STR: 50, CON: 45, SIZ: 40, DEX: 70, POW: 30}}}}, 2),
    node('artifact-robert-taylor-whistle', 'artifact', 'Brass whistle', 'A dented brass whistle.', {}, 2),
    // A stated obligation (§134.1): its raw shape names the scene, the person and the clue by node id.
    node('rule-robert-taylor-ledger-access', 'rule', 'Ledger access', 'The owner keeps the ledger to himself unless persuaded.'),
    node('requirement-robert-taylor-ledger', 'requirement', 'Access to the ledger', 'The owner must be won over first.', {obligation: {
      scene: 'scene-harbor-bar', trigger: {kind: 'attempt', guards: {clues: ['clue-robert-taylor-ledger']}}, who: 'npc-robert-taylor',
      demand: [{kind: 'meet', npc: 'npc-robert-taylor'},
        {kind: 'check', scope: 'actor-target', target: 'npc-robert-taylor', selection: 'approach', values: [{path: 'skills.Persuade', label: 'Persuade'}],
          difficulty: 'regular', results: {critical: {settles: true}, extreme: {settles: true}, hard: {settles: true}, regular: {settles: true},
            failure: {settles: false, book: 'He refuses.'}, fumble: {settles: false, book: 'He throws them out.'}},
          push: {allowed: true, book: 'A failed push bars them from the bar.'}}],
      settles: {kind: 'flag_set', flag_id: 'ledger-access'}}}),
  ];
  const claims = [
    claim('scene-harbor-bar', 'route-to', 'scene-robert-taylor-home'), claim('scene-harbor-bar', 'route-to', UNREAD),
    claim('npc-robert-taylor', 'present-in', 'scene-harbor-bar'), claim('npc-mae-collins', 'present-in', 'scene-harbor-bar'),
    claim('creature-robert-taylor-hound', 'present-in', 'scene-robert-taylor-home'), claim(LANDLADY, 'present-in', UNREAD),
    claim('clue-robert-taylor-ledger', 'discoverable-at', 'scene-harbor-bar'), claim('clue-mae-collins-note', 'discoverable-at', 'scene-harbor-bar'),
    claim('clue-robert-taylor-ledger', 'supports', 'conclusion-robert-taylor-owes-rent'),
    claim('clue-mae-collins-note', 'supports', 'conclusion-robert-taylor-owes-rent'),
    claim('npc-mae-collins', 'knows', 'clue-mae-collins-note'),
    claim('artifact-robert-taylor-whistle', 'located-in', 'scene-robert-taylor-home'),
    claim('scene-harbor-bar', 'has-requirement', 'requirement-robert-taylor-ledger'),
    claim('requirement-robert-taylor-ledger', 'calls-for-check', 'rule-robert-taylor-ledger-access'),
  ];
  return {nodes, claims, node_refs: [], coverage: {}, dependencies: [], critical: [],
    ready_nodes: nodes.map(entry => entry.node_id).filter(id => id !== UNREAD && id !== LANDLADY)};
}

/** A two-page PDF the kernel can bind. */
function pdf() {
  const streams = ['0 0 1 rg 0 0 100 100 re f', '0 0.6 0 rg 0 0 200 100 re f'];
  const pages = streams.map((stream, index) => ({page: 3 + index * 2, content: 4 + index * 2, stream}));
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map(row => `${row.page} 0 R`).join(' ')}] /Count ${streams.length} >>`,
    ...pages.flatMap(row => [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Contents ${row.content} 0 R >>`,
      `<< /Length ${row.stream.length} >>\nstream\n${row.stream}\nendstream`])];
  let text = '%PDF-1.7\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(text), size = objects.length + 1;
  text += `xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return text;
}

async function kernel(t) {
  const workspace = await mkdtemp(join(temporary, 'home-'));
  const context = await api.createKernelContext({workspace, content, seed: 'name-free-egress', locks: api.nativeAdvisoryLocks(),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
  // What crosses the RPC wire, as the host receives it.
  const wire = value => value === undefined ? value : JSON.parse(api.pythonJsonDumps(value));
  const call = async (method, params = {}) => {
    try { return wire(await runtime.handlers[method](params)); }
    catch (error) { throw typeof error?.toJson === 'function' ? Object.assign(new Error(error.message), wire(error.toJson())) : error; }
  };
  return {workspace, call};
}

/** The book through the reader's real path -- bind, index, opening, cast -- and a campaign on it with an investigator, being set up. */
async function book(t) {
  const game = await kernel(t);
  const file = join(game.workspace, 'original.pdf');
  await writeFile(file, pdf());
  const sha = createHash('sha256').update(await readFile(file)).digest('hex');
  const {module_id: mid} = await game.call('module.source.bind', {source: {path: file, page_count: 2, file_sha256: sha}});
  const read = (method, params = {}) => game.call(method, {module_id: mid, ...params});
  const publish = async (job, body) => {
    await writeFile(join(job.work_dir, 'observations.json'), JSON.stringify({file_sha256: sha, read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2]}));
    await writeFile(join(job.work_dir, 'draft.json'), JSON.stringify(body));
    const checked = job.purpose === 'index' ? [] : (await api.checkSourceDraft(content, join(job.work_dir, 'packet.json'), join(job.work_dir, 'draft.json'))).required_review ?? [];
    await writeFile(join(job.work_dir, 'review.json'), JSON.stringify({checked: checked.length ? [{paths: checked, verdict: 'supported', source_refs: REFS, reason: 'fixture support'}] : [], missing: []}));
    return read('module.read.finish', {job_id: job.job_id, lease: job.lease, outcome: 'completed', draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
  };
  await read('module.read.request', {purpose: 'index'});
  await publish(await read('module.read.claim', {owner: 'test-host'}), {title: 'The Harbor Bar', language: 'en',
    sections: [{name: 'Bar and house', pages: [[1, 2]], entities: ['Harbor Bar', 'Taylor\'s house']}], map_candidates: []});
  await read('module.read.request', {purpose: 'opening'});
  const opened = await publish(await read('module.read.claim', {owner: 'test-host'}), opening());
  assert.equal(opened.opening_ready, true, JSON.stringify(opened));
  // §177: the cast, with notes renderings that are not the book's.
  const cast = await read('cast.job', {claim: true});
  await read('cast.source', {job_id: cast.job_id, lease: cast.lease, pages: PAGES.map((text, index) => ({page: index + 1, text}))});
  const range = await read('cast.range', {job_id: cast.job_id, lease: cast.lease, index: 0});
  await writeFile(join(range.cwd, 'draft.json'), JSON.stringify({people: [
    {book: ['Robert Taylor'], play: ['Robert Taylor'], notes: ['Bob Taylor', 'Taylor'], pages: [1, 2]},
    {book: ['Mae Collins'], play: ['Mae Collins'], notes: ['Mae Collins'], pages: [1]},
    {book: ['Ida Brooks'], play: ['Ida Brooks'], notes: ['Ida Brooks'], pages: [1]}]}));
  assert.equal((await read('cast.submit', {job_id: cast.job_id, lease: cast.lease, index: 0})).state, 'complete');
  // The investigator, saved from a starter pregen (§21.5).
  await game.call('campaign.create', {id: 'source', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  const library = (await game.call('investigator.save', {campaign: 'source'})).library_id;
  await game.call('campaign.create', {id: 'c1', module: mid, play_language: 'en'});
  const call = (method, params = {}) => game.call(method, {campaign: 'c1', ...params});
  await call('investigator.load', {library_id: library});
  return {...game, mid, call};
}

// ---------------------------------------------------------------------------------------------------
// The Keeper's request, as the installed context hook assembles it.
// ---------------------------------------------------------------------------------------------------

/**
 * A refusal as the kernel extension's `errorText` renders it: code, message and fix, then each detail it puts on a line --
 * the ones it renders by name and every `details.<key>` the fix names -- here as the detail's whole JSON, a superset of the
 * line it draws from it. A detail no line renders (a host-only key such as a person's `_land_on_text` key) does not reach the Keeper.
 */
const RENDERED_DETAILS = ['needs', 'candidates', 'conflicts', 'exits', 'fields', 'missing', 'findings', 'source_review', 'continuity_review'];
function refusalText(error) {
  const named = [...String(error.fix ?? '').matchAll(/\bdetails\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]);
  const details = error.details ?? {};
  return [`${error.code}: ${error.message}`, `retryable: ${error.retryable}`, `next: ${error.next}`, ...(error.fix ? [`fix: ${error.fix}`] : []),
    ...[...new Set([...RENDERED_DETAILS, ...named])].filter(key => details[key] !== undefined).map(key => `${key}: ${JSON.stringify(details[key])}`)].join('\n');
}
/** One Keeper call and the result the tool hands back: the result's JSON (the tool's success path), or the refusal's text. */
async function keeperCall(log, tool, method, params, call) {
  const id = `call-${log.length + 1}`;
  let text, ok = true;
  try { text = JSON.stringify(await call(method, params)); }
  catch (error) {
    ok = false;
    if (typeof error?.code !== 'string') throw error;
    text = refusalText(error);
  }
  const {campaign: _campaign, ...args} = params;
  log.push({id, tool, method, ok, text,
    messages: [{role: 'assistant', content: [{type: 'toolCall', id, name: tool, arguments: args}]},
      {role: 'toolResult', toolCallId: id, toolName: tool, content: [{type: 'text', text}]}]});
  return ok ? JSON.parse(text) : undefined;
}
/** A host message, as `sendHost` sends it. */
const hostMessage = (content, kind) => ({role: 'custom', customType: 'coc-host', content, display: false, details: {coc_host: true, kind, scope: 'turn'}});

/** The recovery message `table.open` with a pending turn has the host send (extensions/kernel/index.ts, `sendHost(..., "recovery")`). */
const recoveryText = open => {
  const pending = open.pending_turn, oneLine = typeof open.resume?.one_line === 'string' ? open.resume.one_line : '';
  return 'The last session broke mid-turn and this turn was never delivered. ' + (oneLine ? `The last commit stopped at: ${oneLine}. ` : '')
    + `The player said: ${pending.player_text ?? '(nothing)'}. Receipts already landed: ${JSON.stringify(pending.receipts ?? [])}. `
    + `Still owed: ${(pending.owed ?? []).join(', ') || 'narrate'}. Use look to see the scene as it stands, finish this turn, then deliver it with narrate.`;
};

/** The request the installed context hook assembles for this turn: the capsule the input published, the brief, the history, and the turn's calls. */
async function keeperRequest(game, {input, player, calls, host = []}) {
  const hooks = new Map(), bus = new Map();
  const telemetry = [];
  api.installContextPolicy({on: (name, fn) => hooks.set(name, fn), events: {on: (name, fn) => bus.set(name, fn)}},
    row => telemetry.push(row), () => api.workpadStoreRoot(game.workspace));
  bus.get('coc:kernel-bridge')({campaign: 'c1', call: game.call});
  if (input) bus.get('coc:capsule')({capsule: input.capsule, context: input._context, epoch: `epoch-${input._context.turn}`});
  const messages = [...(player ? [{role: 'user', content: player}] : []), ...host, ...calls.flatMap(entry => entry.messages)];
  const {messages: sent} = await hooks.get('context')({messages}, {model: {contextWindow: 1000000}});
  // The scan below reads what travelled: every result and host message sent is in the request, and so are the capsule and brief.
  for (const entry of calls)
    assert.ok(sent.some(message => message.role === 'toolResult' && message.toolCallId === entry.id), `${entry.method} reached the request`);
  for (const message of host)
    assert.ok(sent.some(item => item.customType === 'coc-host' && item.details?.kind === message.details.kind), `the ${message.details.kind} message reached the request`);
  assert.ok(sent.some(message => message.customType === 'coc-capsule'), `the capsule reached the request: ${JSON.stringify(telemetry)}`);
  if (input) assert.ok(sent.some(message => message.customType === 'coc-workspace'), `the workspace reached the request: ${JSON.stringify(telemetry.filter(row => String(row.lane).startsWith('workspace')))}`);
  return sent;
}

// ---------------------------------------------------------------------------------------------------
// The scan.
// ---------------------------------------------------------------------------------------------------

const GRAMMAR = /^[a-z0-9]+(?:[-:][a-z0-9]+)*$/;
/** Every string of a value with its path: each key, then each value. */
function* stringsOf(value, path) {
  if (typeof value === 'string') yield {path, text: value, key: false};
  else if (Array.isArray(value)) for (const [index, item] of value.entries()) yield* stringsOf(item, `${path}[${index}]`);
  else if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) { yield {path: `${path}.${key}`, text: key, key: true}; yield* stringsOf(item, `${path}.${key}`); }
}
/** The identifiers a string carries, by the grammar of references (see the header): a key or a whole kebab value, else the composite tokens inside. */
const identifiersIn = ({text, key}) => key || GRAMMAR.test(text) ? [text]
  : text.split(/[^A-Za-z0-9:-]+/).filter(token => /[a-z0-9][-:][a-z0-9]/.test(token) && GRAMMAR.test(token));
const parsed = text => { try { return JSON.parse(text); } catch { return text; } };

/** What the kernel holds that must not reach the Keeper: the book's node ids, its slugs, and the cast's forms. */
function forbidden(graph, moduleId, avoid) {
  const ids = graph.nodes.map(entry => entry.node_id).concat(`module-${moduleId}`);
  // The module node's id is the library's id with its kind; that id is the campaign's module_id, not a word of the book.
  const slugs = [...new Set(graph.nodes.map(entry => api.stripPrefix(entry.node_id, entry.node_kind)))];
  return {ids, slugs, forms: avoid.map(api.normalize).filter(Boolean)};
}

/** Every place the request carries a node id, a slug inside an identifier, or a cast form inside an identifier. */
function scan(sent, {ids, slugs, forms}) {
  const hits = [];
  for (const [at, message] of sent.entries()) {
    // The Keeper's own calls and the player's words are not the kernel's output.
    if (message.role !== 'toolResult' && message.role !== 'custom') continue;
    const where = message.role === 'toolResult' ? `${message.toolName}#${message.toolCallId}` : `${message.customType}@${at}`;
    const parts = typeof message.content === 'string' ? [message.content]
      : message.content.filter(part => part.type === 'text').map(part => part.text);
    for (const part of parts)
      for (const entry of stringsOf(parsed(part), '')) {
        for (const id of ids)
          for (let from = entry.text.indexOf(id); from >= 0; from = entry.text.indexOf(id, from + 1))
            if (!/[A-Za-z0-9]/.test(entry.text[from - 1] ?? '') && !/[A-Za-z0-9]/.test(entry.text[from + id.length] ?? '')) {
              hits.push({where, path: entry.path, kind: 'node_id', found: id, in: entry.text.slice(0, 120)}); break;
            }
        for (const token of identifiersIn(entry)) {
          const segments = token.split(':').map(segment => `-${segment}-`);
          for (const slug of slugs)
            if (segments.some(segment => segment.includes(`-${slug}-`)) && !ids.some(id => token.includes(id)))
              hits.push({where, path: entry.path, kind: 'slug', found: slug, in: token});
          const form = forms.find(value => api.occurs(api.normalize(token), value));
          if (form && !ids.some(id => token.includes(id)) && !slugs.some(slug => segments.some(segment => segment.includes(`-${slug}-`))))
            hits.push({where, path: entry.path, kind: 'cast_name', found: form, in: token});
        }
      }
  }
  return hits;
}
const report = hits => hits.map(hit => `${hit.kind} ${JSON.stringify(hit.found)} at ${hit.where}${hit.path} in ${JSON.stringify(hit.in)}`).join('\n');

// ---------------------------------------------------------------------------------------------------
// The tests.
// ---------------------------------------------------------------------------------------------------

test('§185.10: the scan finds what it looks for -- a node id anywhere, a slug or a cast name inside an identifier, and nothing in prose', () => {
  const graph = opening(), held = forbidden(graph, 'book-1', ['Robert Taylor', 'Bob Taylor', 'Taylor', 'Mae Collins']);
  const message = value => ({role: 'toolResult', toolName: 'look', toolCallId: 'x', content: [{type: 'text', text: JSON.stringify(value)}]});
  const kinds = value => scan([message(value)], held).map(hit => [hit.kind, hit.found]).sort((a, b) => a.join().localeCompare(b.join()));
  assert.deepEqual(kinds({node_id: 'npc-robert-taylor'}), [['node_id', 'npc-robert-taylor']]);
  assert.deepEqual(kinds({note: 'see npc-mae-collins first'}), [['node_id', 'npc-mae-collins']], 'a node id inside prose');
  assert.deepEqual(kinds({receipt: 'clue:robert-taylor-ledger-t3'}), [['slug', 'robert-taylor'], ['slug', 'robert-taylor-ledger']]);
  assert.deepEqual(kinds({focus: 'harbor-bar'}), [['slug', 'harbor-bar']]);
  assert.deepEqual(kinds({fix: 'move to robert-taylor-home first'}), [['slug', 'robert-taylor'], ['slug', 'robert-taylor-home']], 'a slug inside prose');
  assert.deepEqual(kinds({ref: 'intent:taylor-the-elder:0123456789ab'}), [['cast_name', 'taylor']], 'a cast form inside a composite');
  assert.deepEqual(kinds({'Bob Taylor': 1}), [['cast_name', 'bob taylor']], 'a key is an identifier');
  assert.deepEqual(kinds({name: 'Robert Taylor', summary: 'Robert Taylor keeps the bar at the harbor-bar end', id: 'bar-owner-pencil-mustache'}),
    [['slug', 'harbor-bar']], 'names in prose are the rename\'s; a name-free handle is clean');
  assert.deepEqual(kinds({id: 'npc-1a2b3c', scene: 'scene-2', words: 'the man with the pencil mustache'}), []);
});

test('§185.7: in a name-free campaign no node id, slug or cast name inside an identifier reaches the Keeper', async t => {
  const game = await book(t);
  const {call} = game;
  const meta = JSON.parse(await readFile(join(game.workspace, '.coc', 'campaigns', 'c1', 'campaign.json'), 'utf8'));
  assert.equal(meta.handles, 'name-free');
  const {avoid} = await call('handles.job');
  const held = forbidden(opening(), game.mid, avoid);
  assert.ok(['Robert Taylor', 'Taylor', 'Mae Collins'].every(form => avoid.includes(form)), JSON.stringify(avoid));

  // The lanes, during setup: a word for each person (§176.3); handles for three nodes, one given up, the rest left interim (§185.5).
  const words = await call('epithets.job');
  const wordOf = {[OWNER_LOOKS]: 'the man with the pencil mustache', [BARMAID_LOOKS]: 'the barmaid at the door', [LANDLADY_LOOKS]: 'the landlady with the key ring'};
  assert.deepEqual((await call('epithets.submit', {entries: words.people.map(person => ({id: person.id, word: wordOf[person.looks]}))})).refused, []);
  assert.deepEqual((await call('handles.submit', {entries: [{id: 'npc-robert-taylor', handle: 'bar-owner-pencil-mustache'},
    {id: 'scene-harbor-bar', handle: 'smoky-dockside-tavern'}, {id: 'clue-robert-taylor-ledger', handle: 'rent-ledger-under-counter'}],
  given_up: ['conclusion-robert-taylor-owes-rent']})).refused, []);
  await call('setup.complete');
  const requests = [];
  const keeper = (method, params) => keeperCall(calls, ({'table.look': 'look', 'table.lookup': 'lookup', 'table.recall': 'recall',
    'table.resolve': 'resolve', 'table.apply': 'apply', 'table.narrate': 'narrate'})[method], method, params, call);
  let calls = [];

  // Turn 0, the opening: the host's opening message (§168.2), built from table.open, and the opening scene looked at.
  const open = await call('table.open');
  // The optional workspace (KIC-03): the hook injects the book's entities as evidence beside the capsule.
  const previousMode = process.env.PI_COC_WORKSPACE_MODE;
  process.env.PI_COC_WORKSPACE_MODE = 'on';
  t.after(() => { if (previousMode === undefined) delete process.env.PI_COC_WORKSPACE_MODE; else process.env.PI_COC_WORKSPACE_MODE = previousMode; });
  const opening0 = hostMessage(api.openingInstruction({prologue: open.setup_prologue || undefined, playLanguage: 'en',
    party: open.investigators.map(row => row.name), modContext: open.mod_context}), 'opening');
  await keeper('table.look', {focus: 'scene'});
  await keeper('table.look', {focus: 'npc', name: 'the man with the pencil mustache'});
  requests.push(['opening', await keeperRequest(game, {calls, host: [opening0]})]);
  await call('table.narrate', {call_id: 't0-c1', text: 'The bar is loud tonight.'});

  // Turn 1: the Keeper reads, writes and refuses its way through the bar.
  calls = [];
  const input1 = await call('table.player_input', {text: 'I sit at the bar and look around.'});
  const owner = 'the man with the pencil mustache', barmaid = 'the barmaid at the door';
  await keeper('table.look', {focus: 'npc', name: owner});
  await keeper('table.look', {focus: 'npc', name: barmaid});
  await keeper('table.look', {focus: 'npc', name: 'Yard hound'});
  await keeper('table.look', {focus: 'clues'});
  await keeper('table.look', {focus: 'time'});
  await keeper('table.look', {focus: 'investigator'});
  await keeper('table.look', {focus: 'map'});
  await keeper('table.look', {focus: 'object', name: 'Rent ledger'});
  await keeper('table.lookup', {kind: 'module', query: 'Rent ledger'});
  await keeper('table.lookup', {kind: 'module', query: 'Yard hound'});
  await keeper('table.lookup', {kind: 'module', query: 'Taylor\'s house', expected_kind: 'scene'});
  await keeper('table.lookup', {kind: 'module', query: 'The room upstairs'});
  await keeper('table.lookup', {kind: 'module', query: 'Lighthouse', expected_kind: 'scene'});
  await keeper('table.lookup', {kind: 'module', query: 'Access to the ledger'});
  await keeper('table.lookup', {kind: 'module', query: 'smoky-dockside-tavern rent-ledger-under-counter'});
  await keeper('table.lookup', {kind: 'secret'});
  await keeper('table.lookup', {kind: 'secret', scope: 'module'});
  await keeper('table.lookup', {kind: 'continuity', query: 'Rent ledger'});
  await keeper('table.lookup', {kind: 'catalog', query: 'whistle'});
  await keeper('table.lookup', {kind: 'rule', query: 'Spot Hidden'});
  await keeper('table.apply', {call_id: 't1-c1', effects: [{kind: 'npc', name: owner, intends: 'Get the stranger drunk before closing.', outcome: 'attempted'}]});
  // The barmaid sets out to do something while she still shows her interim handle; the lane names her after this turn.
  await keeper('table.apply', {call_id: 't1-c10', effects: [{kind: 'npc', name: barmaid, intends: 'Slip the stranger a note.', outcome: 'attempted'}]});
  await keeper('table.apply', {call_id: 't1-c2', effects: [{kind: 'clue', clue: 'rent-ledger-under-counter', how: 'found under the counter'}]});
  await keeper('table.apply', {call_id: 't1-c3', effects: [{kind: 'note', name: 'owner-nervous', text: 'The owner keeps glancing at the counter.', entities: [owner, 'Rent ledger']}]});
  await keeper('table.apply', {call_id: 't1-c4', effects: [{kind: 'dossier', name: 'Yard hound', values: {habits: 'It circles the yard at night.'}, why: 'seen in play'}]});
  await keeper('table.apply', {call_id: 't1-c5', effects: [{kind: 'clue', clue: 'a torn photograph', how: 'found'}]});
  await keeper('table.apply', {call_id: 't1-c6', effects: [{kind: 'npc', name: 'Taylor\'s cousin', intends: 'Ask for money.', outcome: 'attempted'}]});
  await keeper('table.resolve', {call_id: 't1-c7', action: {intent: 'investigate', skill: 'Spot Hidden', goal: 'search the counter'}});
  await keeper('table.recall', {what: 'memory', about: [owner]});
  await keeper('table.recall', {what: 'transcript'});
  await keeper('table.apply', {call_id: 't1-c8', effects: [{kind: 'npc', name: 'Ida Brooks', intends: 'Collect the rent.', outcome: 'attempted'}]});
  // The request is assembled while the turn is open, as the Keeper's next model call would be; the delivery closes it.
  requests.push(['turn 1', await keeperRequest(game, {input: input1, player: 'I sit at the bar and look around.', calls})]);
  calls = [];
  await keeper('table.narrate', {call_id: 't1-c9', text: 'He wipes the counter and says nothing.'});
  const delivered1 = calls;
  // The first-sight lane's answer for the place it was shown (§168.5), keyed by the id the capsule gave it.
  const place = input1.capsule.first_sight?.place;
  assert.ok(place?.id, JSON.stringify(input1.capsule.first_sight));
  await call('table.first_sight', {turn: 1, items: [{kind: 'place', id: place.id, missing: ['A smoky bar']}]});
  // The reading layer's answer to the host's read of the unread room (§185.12): every focus crosses back as this campaign's handle.
  const room = (await call('table.lookup', {kind: 'module', query: 'The room upstairs'})).entities[0].name;
  const readAnswer = await call('module.read.request', {module_id: game.mid, purpose: 'detail', focus: room, question: 'What is in the room upstairs?', foreground: true});

  // The handle lane names the barmaid between the turns; turn 2's input folds it (§185.6), with her intention stored under the interim handle.
  assert.deepEqual((await call('handles.submit', {entries: [{id: 'npc-mae-collins', handle: 'barmaid-watching-the-door'}]})).refused, []);
  // The memory lane's answer for turn 1, folded into recall (§185.11 NFH-01's sweep names memory subjects and entities).
  const job = await call('memory.job', {turn: 1});
  if (job.job_id) await call('memory.submit', {job_id: job.job_id, candidates: [{kind: 'knowledge', subject: 'Robert Taylor', knowers: ['Mae Collins'], entities: ['rent-ledger-under-counter'],
    statement: 'The owner hides the rent ledger under the counter.'}]});

  // Turn 2: the card carries the owner's intention, the hound has a habit, the turn before is history.
  calls = [...delivered1];
  const input2 = await call('table.player_input', {text: 'I watch him.'});
  const card = input2.capsule.present.find(person => person.name === owner || person.untold?.label === owner);
  const ref = card?.history?.intents?.[0]?.ref;
  assert.ok(ref, JSON.stringify(input2.capsule.present));
  await keeper('table.look', {focus: 'npc', name: owner});
  const maeLook = await keeper('table.look', {focus: 'npc', name: barmaid});
  await keeper('table.look', {focus: 'npc', name: 'Yard hound'});
  await keeper('table.look', {focus: 'scene'});
  await keeper('table.recall', {what: 'history'});
  await keeper('table.recall', {what: 'history', page: {section: 'events'}});
  await keeper('table.recall', {what: 'memory', about: [owner]});
  await keeper('table.lookup', {kind: 'continuity', query: owner});
  await keeper('table.apply', {call_id: 't2-c1', effects: [{kind: 'npc', name: owner, intent_ref: ref, outcome: 'done'}]});
  await keeper('table.apply', {call_id: 't2-c2', effects: [{kind: 'npc', name: owner, intent_ref: `${ref.slice(0, -1)}0`, outcome: 'done'}]});
  await keeper('table.recall', {what: 'history', diff: [0, 1]});
  // Two Mod doors (§180.8-§180.9): a person's word and a creature's weakness; their receipts are in the turn the reopen recovers.
  await keeper('table.apply', {call_id: 't2-c5', effects: [{kind: 'dossier', name: 'barmaid-watching-the-door', values: {language: 'English, with a Dublin lilt'}, why: 'heard her speak'}]});
  await keeper('table.apply', {call_id: 't2-c6', effects: [{kind: 'dossier', name: 'Yard hound', values: {weaknesses: [{book: 'It will not cross running water.', needs: ['Brass whistle']}]}, why: 'seen in play'}]});
  await keeper('table.apply', {call_id: 't2-c3', effects: [{kind: 'move', to: 'Taylor\'s house', why: 'follow him home'}]});
  await keeper('table.look', {focus: 'npc', name: 'Yard hound'});
  await keeper('table.look', {focus: 'object', name: 'Brass whistle'});
  await keeper('table.resolve', {call_id: 't2-c4', action: {intent: 'combat', goal: 'drive it off', method: 'fists', target: 'Yard hound', weapon: 'unarmed'}});
  await keeper('table.look', {focus: 'session'});
  await keeper('table.look', {focus: 'scene'});
  // The session breaks mid-turn: the table reopens and the host's recovery message carries the turn's receipts (§38).
  const reopened = await call('table.open');
  assert.ok(reopened.pending_turn, JSON.stringify(reopened.turn));
  const recovery = hostMessage(recoveryText(reopened), 'recovery');
  const reference = await call('module.reference.status', {module_id: game.mid});
  const host2 = [hostMessage(`The reading layer answered the host's read: ${JSON.stringify(readAnswer)} ${JSON.stringify(reference)}`, 'reading'), recovery];
  requests.push(['turn 2', await keeperRequest(game, {input: input2, player: 'I watch him.', calls, host: host2})]);

  const hits = requests.flatMap(([label, sent]) => scan(sent, held).map(hit => ({...hit, where: `${label}: ${hit.where}`})));
  assert.deepEqual(hits, [], `the Keeper's request carries the book's identifiers:\n${report(hits)}`);

  // Two of the surfaces the scan read, checked by value: the recovered dossier receipts (the known candidate) name their beings by handle.
  const hound = (await call('table.lookup', {kind: 'module', query: 'Yard hound'})).entities[0].name;
  assert.deepEqual(reopened.pending_turn.receipts.filter(receipt => receipt.kind === 'dossier').map(receipt => receipt.npc).sort(),
    ['barmaid-watching-the-door', hound].sort(), 'the dossier receipts reach the recovery by handle');

  // NFH-02's note: the single read shows the barmaid's intention as her card does -- by her current handle -- though the
  // ledger stored it under the interim handle she had when she set out.
  const maeCard = input2.capsule.present.find(person => person.untold?.label === barmaid);
  const cardRefs = maeCard?.history?.intents?.map(row => row.ref);
  assert.ok(cardRefs?.length === 1 && cardRefs[0].startsWith('intent:barmaid-watching-the-door:'), JSON.stringify(maeCard));
  const stored = JSON.parse(await readFile(join(game.workspace, '.coc', 'campaigns', 'c1', 'npc-ledger.json'), 'utf8'))['npc-mae-collins'].intents.map(row => row.ref);
  assert.ok(stored[0] !== cardRefs[0] && stored[0].endsWith(cardRefs[0].split(':').at(-1)), `the ledger keeps the interim owner: ${stored}`);
  assert.deepEqual(maeLook.ledger.intents.map(row => row.ref), cardRefs, 'look focus=npc shows the canonical reference');
});

test('§185.7: a legacy campaign shows what it showed -- the node id on a single read, the book\'s raw claims, the recovered receipts\' person', async t => {
  // An authored starter is legacy (§185.1): its handles are slugs by design, and each surface converted above is left as written.
  const game = await kernel(t);
  const call = (method, params = {}) => game.call(method, {campaign: 'old', ...params});
  await game.call('campaign.create', {id: 'old', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
  assert.equal(JSON.parse(await readFile(join(game.workspace, '.coc', 'campaigns', 'old', 'campaign.json'), 'utf8')).handles, 'legacy');
  await call('table.open');
  await call('table.narrate', {call_id: 't0-c1', text: 'The office is quiet.'});
  await call('table.player_input', {text: 'I ask Mr. Knott about the house.'});
  const knott = await call('table.look', {focus: 'npc', name: 'Steven Knott'});
  assert.equal(knott.node_id, 'npc-steven-knott', 'the single read keeps the book\'s node id');
  await call('table.apply', {call_id: 't1-c1', effects: [{kind: 'npc', name: 'Steven Knott', intends: 'Get the visitor to sign for the keys.', outcome: 'attempted'}]});
  const continuity = await call('table.lookup', {kind: 'continuity', query: 'clue: own-dagger-ends-him'});
  assert.ok(JSON.stringify(continuity).includes('"object":{"node_id":"conclusion-own-dagger-ends-corbitt"}'), 'the raw claims keep their node ids');
  const reopened = await call('table.open');
  assert.deepEqual(reopened.pending_turn.receipts.filter(receipt => receipt.kind === 'npc').map(receipt => receipt.npc), ['npc-steven-knott'],
    'a recovered receipt keeps the person as the record stores it');
  // The ledger's intention reads by its stored reference, which in a legacy campaign is already the canonical one.
  await call('table.narrate', {call_id: 't1-c9', text: 'He slides the keys across.'});
  await call('table.player_input', {text: 'I take them.'});
  const stored = JSON.parse(await readFile(join(game.workspace, '.coc', 'campaigns', 'old', 'npc-ledger.json'), 'utf8'))['npc-steven-knott'].intents.map(row => row.ref);
  assert.deepEqual((await call('table.look', {focus: 'npc', name: 'Steven Knott'})).ledger.intents.map(row => row.ref), stored);
});
