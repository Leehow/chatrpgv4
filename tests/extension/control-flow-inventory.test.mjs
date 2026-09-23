/**
 * SL-00 guard: every call that can start, continue or drive a model run is inventoried.
 *
 * The Pi-native single loop (docs/specs/pi-native-single-loop.md) replaces the drivers of a player
 * turn one by one. That only works if the list of drivers is closed: a new `runTask`, `runLane`,
 * `pi.sendMessage(..., {triggerTurn})`, TaskRuntime submit, Jev loop or direct provider call that
 * appears somewhere unlisted is a second loop nobody planned to retire. This walks the same trees
 * as the inventory (`tests/extension/control-flow-scan.mjs`) and compares the result with its
 * machine-readable companion, `docs/specs/pi-native-single-loop-tickets/inventory-SL-00.json`.
 *
 * Keys are file + enclosing symbol + kind + callee, with a count per key, never line numbers, so
 * ordinary edits do not trip it. A new site, a second site under a listed key, or a listed site that
 * no longer exists all fail: update the JSON (and the prose inventory beside it) in the same change.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {REPO, TREES, scanControlFlow, siteKey} from './control-flow-scan.mjs';

const INVENTORY = join(REPO, 'docs/specs/pi-native-single-loop-tickets/inventory-SL-00.json');
const inventory = JSON.parse(readFileSync(INVENTORY, 'utf8'));

const tally = sites => {
  const found = new Map();
  for (const site of sites) {
    const key = siteKey(site);
    const row = found.get(key) ?? {count: 0, lines: []};
    row.count++; row.lines.push(site.line); found.set(key, row);
  }
  return found;
};

test('the inventory covers the trees the scan walks', () => {
  assert.deepEqual(inventory.trees, TREES);
});

test('every run-driving call site is in the SL-00 inventory, and every inventory entry still exists', () => {
  const found = tally(scanControlFlow());
  const listed = new Map(inventory.entries.map(entry => [siteKey(entry), entry.count]));
  const unlisted = [], stale = [];
  for (const [key, {count, lines}] of found) {
    const expected = listed.get(key) ?? 0;
    if (count > expected) unlisted.push(`${key} (${count} site(s), inventory says ${expected}; lines ${lines.join(',')})`);
  }
  for (const [key, count] of listed) {
    const actual = found.get(key)?.count ?? 0;
    if (actual < count) stale.push(`${key} (inventory says ${count}, found ${actual})`);
  }
  assert.deepEqual(unlisted, [], 'New calls that can start, continue or drive a model run. Classify each in '
    + 'docs/specs/pi-native-single-loop-tickets/inventory-SL-00.json (owner, path, role) and inventory-SL-00.md, '
    + 'or route it through an inventoried owner instead:\n' + unlisted.join('\n'));
  assert.deepEqual(stale, [], 'Inventory entries whose call sites are gone. Remove or recount them:\n' + stale.join('\n'));
});

test('every inventory entry is classified in the declared vocabulary', () => {
  const paths = Object.keys(inventory.vocabulary.path), roles = Object.keys(inventory.vocabulary.role);
  for (const entry of inventory.entries) {
    const where = siteKey(entry);
    assert.ok(typeof entry.owner === 'string' && entry.owner.trim(), `${where}: owner`);
    assert.ok(paths.includes(entry.path), `${where}: path ${entry.path}`);
    assert.ok(roles.includes(entry.role), `${where}: role ${entry.role}`);
    assert.ok(Number.isInteger(entry.count) && entry.count > 0, `${where}: count`);
  }
  const keys = inventory.entries.map(siteKey);
  assert.equal(new Set(keys).size, keys.length, 'duplicate inventory keys');
});

// The scan is the guard; this proves it sees each kind it claims to, and not the send that cannot start a run.
test('the scan recognises each inventoried kind and ignores a triggerTurn:false send', () => {
  const root = mkdtempSync(join(tmpdir(), 'sl00-scan-'));
  try {
    mkdirSync(join(root, 'extensions'), {recursive: true});
    writeFileSync(join(root, 'extensions/probe.ts'), [
      'export default function probe(pi: any, agent: any, runtime: any, ctx: any) {',
      '  pi.on("agent_end", () => { pi.sendMessage({customType: "x", content: ""}, {triggerTurn: true}); });',
      '  pi.on("turn_end", () => { pi.sendMessage({customType: "x", content: ""}, {triggerTurn: false}); });',
      '  function steer() { pi.sendMessage({customType: "x", content: ""}); }',
      '  function input() { pi.sendUserMessage("go"); }',
      '  async function loop() { await agent.continue(); await agent.prompt("x"); }',
      '  async function child() { await runtime.runTask({kind: "mod", request: {}}); }',
      '  async function lane() { await runLane({}); await ctx.modelRegistry.complete({}, {}); }',
      '  async function tasks() { const t = new TaskRuntime({}); const id = await t.begin({}); await t.submit(id, {}); }',
      '  async function jev() { createDecisionAdapter({}); await runEvidenceAgent({}); }',
      '  async function net() { await fetch("https://example.invalid"); const f = globalThis.fetch; }',
      '  function rpc(write: any) { write({type: "prompt", message: "x"}); }',
      '  function host() { sendHost("x", "steer"); }',
      '}',
      'class TaskRuntime { async submit() { return this.#run(); } async #run() {} }',
      'declare function runLane(x: any): any; declare function createDecisionAdapter(x: any): any;',
      'declare function runEvidenceAgent(x: any): any; declare function sendHost(a: string, b: string): void;',
    ].join('\n'));
    const kinds = new Map();
    for (const site of scanControlFlow(root, ['extensions'])) kinds.set(`${site.symbol}:${site.kind}:${site.callee}`, true);
    const expected = [
      'probe.on(agent_end):trigger-turn:pi.sendMessage{triggerTurn}',
      'steer:trigger-turn:pi.sendMessage{steer-when-streaming}',
      'input:trigger-turn:pi.sendUserMessage',
      'loop:agent-run:agent.continue', 'loop:agent-run:agent.prompt',
      'child:reader-task:runtime.runTask',
      'lane:lane:runLane', 'lane:provider-direct:modelRegistry.complete',
      'tasks:task-runtime:new TaskRuntime', 'tasks:task-runtime:t.begin', 'tasks:task-runtime:t.submit',
      'TaskRuntime.submit:task-runtime:#run',
      'jev:jev-adapter:createDecisionAdapter', 'jev:jev-loop:runEvidenceAgent',
      'net:network:fetch', 'net:network:globalThis.fetch',
      'rpc:rpc-run-command:{type: prompt}',
      'host:trigger-turn:sendHost',
    ];
    for (const key of expected) assert.ok(kinds.has(key), `scan missed ${key}; saw ${[...kinds.keys()].join(' | ')}`);
    assert.ok(![...kinds.keys()].some(key => key.startsWith('probe.on(turn_end)')), 'a triggerTurn:false send cannot start or extend a run');
  } finally { rmSync(root, {recursive: true, force: true}); }
});
