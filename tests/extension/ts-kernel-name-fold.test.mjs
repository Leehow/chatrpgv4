/**
 * A graph's node ids are the shape gate's ASCII kebab; its names and aliases keep the book's own
 * spelling. The Keeper names people the way the book prints them, so a name that differs from its
 * own node only by an accent has to resolve -- in both directions -- through the RPC the Keeper
 * actually calls (#64: `apply npc` refused 'Nemesio Sánchez' while `npc-nemesio-sanchez` sat in the
 * Masks graph). The fold is Unicode's own: marks the standard composes onto a base letter drop;
 * marks that never compose (a Devanagari vowel sign) stay, so names that differ only by one of
 * those keep telling apart. Two names that fold together are ambiguous, never a silent pick.
 *
 * Everything travels the product path: a starter whose graph carries the node exactly as the
 * playtest graph did, registered by `campaign.create`, resolved by `table.apply`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { KernelClient } from '../../extensions/kernel/client.ts';

const ROOT = resolve(import.meta.dirname, '../..'), CONTENT = join(ROOT, 'content'), RPC = join(ROOT, 'build/kernel/rpc.mjs');
const STARTER = 'the-haunting';
const evidence = join(ROOT, '.coc/playtests/ts-name-fold-node');
await mkdir(evidence, { recursive: true });

const npc = (node_id, name, aliases = []) => ({ node_id, node_kind: 'npc', name, aliases, visibility: 'keeper', summary: name, evidence_span_ids: [], properties: {} });
const NODES = [
  // The node as the Masks graph carried it (#64): ASCII handle, accented name, titled aliases.
  npc('npc-nemesio-sanchez', 'Professor Nemesio Sánchez', ['Prof. Sánchez', 'Prof. Nemesio Sánchez']),
  // A handle that is not the name at all, so only the name index can answer an unaccented query.
  npc('npc-old-priest', 'Padre Iñigo Muñoz'),
  // Two people whose names fold to the same key: the fold must surface both, not pick one.
  npc('npc-the-widow', 'Señora Peña'),
  npc('npc-the-tenant', 'The tenant upstairs', ['Senora Pena']),
  // Names that differ only by a mark Unicode never composes onto its base (a Devanagari vowel sign).
  npc('npc-kiran', 'किरण'),
  npc('npc-karan', 'करण'),
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

/** A table opened on the accented graph, one player turn in, ready for `apply`. */
async function opened(t) {
  const content = await contentRoot(), home = await mkdtemp(join(evidence, 'rpc-'));
  const client = new KernelClient({ command: [process.execPath, RPC, '--workspace', home, '--content', content], cwd: ROOT, env: environment({ COC_KERNEL_SEED: 'name-fold' }), inheritEnv: false, timeoutMs: 20000 });
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

const refused = (promise, code, pattern) => assert.rejects(promise, error => {
  assert.equal(error.code, code, error.message);
  assert.match(error.message, pattern);
  return true;
});

test('an accented name resolves to its ASCII-handled node, and an unaccented one to its accented name (#64)', async t => {
  const { apply, receipts } = await opened(t);
  // Forward: the query carries the accent the handle folded away.
  await apply('Nemesio Sánchez');
  // Reverse: the query dropped the accents the name keeps, and the handle is no help.
  await apply('padre inigo munoz');
  const applied = await receipts();
  assert.deepEqual(applied.map(row => [row.handle, row.npc, row.name]), [
    ['nemesio-sanchez', 'npc-nemesio-sanchez', 'Professor Nemesio Sánchez'],
    ['old-priest', 'npc-old-priest', 'Padre Iñigo Muñoz'],
  ]);
  assert.ok(applied[0].id.startsWith('npc:nemesio-sanchez-t1-'), applied[0].id);
});

test('names that fold together are ambiguous with both candidates, never a silent pick', async t => {
  const { apply } = await opened(t);
  await refused(apply('Señora Peña'), 'unknown_entity', /ambiguous/);
  await assert.rejects(apply('Señora Peña'), error => {
    assert.deepEqual(error.details.candidates.map(row => row.name).sort(), ['the-tenant', 'the-widow']);
    return true;
  });
});

test('a mark Unicode never composes is not an accent: names differing only by it stay distinct', async t => {
  const { apply, receipts } = await opened(t);
  await apply('किरण');
  assert.deepEqual((await receipts()).map(row => row.handle), ['kiran']);
});

test('a name the graph does not hold is still unknown_entity with candidates, accents or not', async t => {
  const { apply } = await opened(t);
  await refused(apply('Nemesio Sánchez Junior'), 'unknown_entity', /no npc named/);
});
