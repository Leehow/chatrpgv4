/**
 * The book prints "Professor Nemesio Sánchez"; the Keeper says "Nemesio Sánchez" (#64, second
 * half). No title list may exist, so the kernel's only bridge is the shape of the name itself: the
 * query's words, in order and unbroken, inside a node's name key -- and only after both exact paths
 * (handle, name index) have missed, so nothing that resolves today changes its answer. One owner
 * resolves; two are ambiguous with both candidates, never a silent pick; a run broken inside a word
 * or across other words is no match; a single word stays a hint for candidates, not an identity.
 *
 * Every node here has a handle that cannot help (the diacritic fold already covers
 * `npc-nemesio-sanchez`), so the word run is the only way through. Everything travels the product
 * path: a starter graph carrying the nodes, `campaign.create`, one turn, `table.apply`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { KernelClient } from '../../extensions/kernel/client.ts';

const ROOT = resolve(import.meta.dirname, '../..'), CONTENT = join(ROOT, 'content'), RPC = join(ROOT, 'build/kernel/rpc.mjs');
const STARTER = 'the-haunting';
const evidence = join(ROOT, '.coc/playtests/ts-name-phrase-node');
await mkdir(evidence, { recursive: true });

const node = (node_kind, node_id, name, aliases = []) => ({ node_id, node_kind, name, aliases, visibility: 'keeper', summary: name, evidence_span_ids: [], properties: {} });
const npc = (node_id, name, aliases = []) => node('npc', node_id, name, aliases);
const NODES = [
  // The titled name as the book prints it, on a handle that says nothing about the person.
  npc('npc-visiting-scholar', 'Professor Nemesio Sánchez', ['Prof. Sánchez', 'Prof. Nemesio Sánchez']),
  // A clue that carries the same run: the kind filter must keep it out of an npc query.
  node('clue', 'clue-scholars-letter', 'Letter from Nemesio Sánchez'),
  // A clue whose name is a whole sentence, the shape the starters actually carry. The run sits in
  // the middle of it, and an unanchored bridge answered `apply clue "Elena Vargas"` with this.
  node('clue', 'clue-ledger-entry', 'The ledger records that Elena Vargas paid the fee in March and never returned.'),
  // Two people who share the bare name under different titles: both must surface.
  npc('npc-the-abbot', 'Abbot Tomás Reyes'),
  npc('npc-the-novice', 'Novice Tomás Reyes'),
  // An exact handle that is also a run inside another node's name: the exact one wins.
  npc('npc-elena-vargas', 'Elena Vargas'),
  npc('npc-elena-vargas-senior', 'Doña Elena Vargas'),
  // An exact alias that is also a run inside another node's name: the alias wins.
  npc('npc-the-cook', 'The cook', ['Marta Ruiz']),
  npc('npc-the-maid', 'Marta Ruiz Ortega'),
];

/** `content/` with every entry shared, except a copy of the starter graph carrying NODES. */
async function contentRoot() {
  const home = await mkdtemp(join(evidence, 'content-')), content = join(home, 'content');
  await mkdir(content);
  for (const name of await readdir(CONTENT))
    if (name !== 'starters') await symlink(join(CONTENT, name), join(content, name));
  const starters = join(content, 'starters');
  await mkdir(starters);
  for (const id of await readdir(join(CONTENT, 'starters'))) {
    if (id !== STARTER) { await symlink(join(CONTENT, 'starters', id), join(starters, id)); continue; }
    await mkdir(join(starters, id));
    for (const name of await readdir(join(CONTENT, 'starters', id)))
      if (name !== 'module-graph.json') await symlink(join(CONTENT, 'starters', id, name), join(starters, id, name));
    const graph = JSON.parse(await readFile(join(CONTENT, 'starters', id, 'module-graph.json'), 'utf8'));
    graph.nodes.push(...NODES);
    await writeFile(join(starters, id, 'module-graph.json'), JSON.stringify(graph, null, 1));
  }
  return content;
}

function environment(extra = {}) {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0', GIT_AUTHOR_DATE: '2000-01-02T03:04:05Z', GIT_COMMITTER_DATE: '2000-01-02T03:04:05Z',
    COC_TEST_CLOCK: '2000-01-02T03:04:05Z', NODE_OPTIONS: `--require ${JSON.stringify(join(ROOT, 'tests/kernel/rpc_clock.cjs'))}`, TZ: 'UTC', ...extra };
}

/** A table opened on the titled graph, one player turn in, ready for `apply`. */
async function opened(t) {
  const content = await contentRoot(), home = await mkdtemp(join(evidence, 'rpc-'));
  const client = new KernelClient({ command: [process.execPath, RPC, '--workspace', home, '--content', content], cwd: ROOT, env: environment({ COC_KERNEL_SEED: 'name-phrase' }), inheritEnv: false, timeoutMs: 20000 });
  t.after(() => client.close());
  await client.call('campaign.create', { id: 'c1', module: STARTER, pregen: 'thomas-hayes', play_language: 'en' });
  await client.call('table.open', { campaign: 'c1' });
  await client.call('table.narrate', { campaign: 'c1', call_id: 't0-c1', text: 'The professor is waiting in the hall.' });
  await client.call('table.player_input', { campaign: 'c1', text: 'I greet the professor.' });
  let ordinal = 0;
  const apply = name => client.call('table.apply', { campaign: 'c1', call_id: `t1-c${++ordinal}`, effects: [{ kind: 'npc', name, to: 'here' }] });
  const receipts = async () => (await client.call('table.status', { campaign: 'c1' })).receipts.filter(row => row.kind === 'npc');
  return { client, apply, receipts };
}

/** The same table, asked for a clue by name: the kind filter is what makes the shape visible. */
const applyClue = async (t, name) => {
  const { client } = await opened(t);
  return client.call('table.apply', { campaign: 'c1', call_id: 't1-c9', effects: [{ kind: 'clue', clue: name }] });
};

const refused = (promise, code, pattern) => assert.rejects(promise, error => {
  assert.equal(error.code, code, error.message);
  assert.match(error.message, pattern);
  return true;
});

test('the bare name reaches the titled node through a whole-word run, with or without its accents (#64)', async t => {
  const { apply, receipts } = await opened(t);
  await apply('Nemesio Sánchez');
  await apply('nemesio sanchez');
  const applied = await receipts();
  assert.deepEqual(applied.map(row => [row.handle, row.npc, row.name]), [
    ['visiting-scholar', 'npc-visiting-scholar', 'Professor Nemesio Sánchez'],
    ['visiting-scholar', 'npc-visiting-scholar', 'Professor Nemesio Sánchez'],
  ]);
  assert.ok(applied[0].id.startsWith('npc:visiting-scholar-t1-'), applied[0].id);
});

test('two nodes holding the run are ambiguous with both candidates, never a silent pick', async t => {
  const { client, apply } = await opened(t);
  await refused(apply('Tomás Reyes'), 'unknown_entity', /ambiguous/);
  await assert.rejects(apply('Tomás Reyes'), error => {
    assert.deepEqual(error.details.candidates.map(row => row.name).sort(), ['the-abbot', 'the-novice']);
    return true;
  });
  // Declaring a newcomer does not get past it (§87.7): a third Tomás Reyes would shadow both.
  await refused(client.call('table.apply', { campaign: 'c1', call_id: 't1-c8', effects: [{ kind: 'npc', name: 'Tomás Reyes', to: 'here', walk_on: true }] }),
    'unknown_entity', /ambiguous/);
});

test('the exact paths still win: a handle or alias that is also a run inside another name resolves exactly', async t => {
  const { apply, receipts } = await opened(t);
  await apply('Elena Vargas');
  await apply('Marta Ruiz');
  assert.deepEqual((await receipts()).map(row => [row.handle, row.name]), [
    ['elena-vargas', 'Elena Vargas'],
    ['the-cook', 'The cook'],
  ]);
});

test('words only: a run broken inside a word, across other words, or a single word is no match', async t => {
  const { apply } = await opened(t);
  // Inside a word, at either end.
  await refused(apply('emesio Sánchez'), 'unknown_entity', /no npc named/);
  await refused(apply('Nemesio Sanch'), 'unknown_entity', /no npc named/);
  // The words are all there but not in one unbroken run.
  await refused(apply('Professor Sánchez'), 'unknown_entity', /no npc named/);
  // One word is a hint for candidates, not an identity.
  await assert.rejects(apply('Sánchez'), error => {
    assert.equal(error.code, 'unknown_entity');
    assert.match(error.message, /no npc named/);
    assert.ok(error.details.candidates.some(row => row.name === 'visiting-scholar'), JSON.stringify(error.details.candidates));
    return true;
  });
});

test('a run in the middle of a sentence is not a name: the bridge is anchored at one end', async t => {
  const { apply, receipts } = await opened(t);
  // `clue-ledger-entry` holds "elena vargas" in its middle. A name key is not always a name -- the graph
  // puts a whole sentence in a clue's `name` -- so an unanchored run made this a substring search over
  // prose, and a person asked for as a clue came back as that clue instead of unknown_entity.
  await refused(applyClue(t, 'Elena Vargas'), 'unknown_entity', /no clue named/);
  // The qualified forms still resolve: the qualifier sits outside the name, so the run is at one end.
  await apply('Nemesio Sánchez');
  assert.deepEqual((await receipts()).map(row => row.handle), ['visiting-scholar']);
});
