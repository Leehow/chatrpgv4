/**
 * Contract §31: no world-state key with only one end.
 *
 * Nine of seventeen defects on record were the same shape — something written that nothing reads, or read that
 * nothing writes — and each was found by play rather than by a test. This walks the kernel and pairs the two
 * ends. It is the cheap half of the ledger and it has a known blind spot, stated here so nobody trusts it for
 * more than it covers: it sees only *world* state. A projection that reads an authored graph field and presents
 * it as if play could change it looks perfectly paired to this test, which is exactly how the threat clocks
 * shipped dead. The offer ledger (§31.2) is what catches that.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readdirSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const KERNEL = resolve(dirname(fileURLToPath(import.meta.url)), '../../kernel-ts');

/** The world reaches most code as `world` or `<something>.world`. Where a file stages it under another name,
 *  that name is declared rather than guessed, so an ordinary local is never mistaken for the world. */
const ALIASES = {'apply/index.ts': ['staged']};

/** Identifiers named `world` that are not the campaign world. Each entry says what it is instead. */
const NOT_THE_WORLD = {
  'memory/recall.ts': {scene: 'the turn record\'s own snapshot (`row(record.world)`), not the campaign world'},
};

/** Keys a campaign is created with and no later path assigns. Each needs the reason it stays put. */
const SEEDED = {};

function walk() {
  const files = [];
  for (const entry of readdirSync(KERNEL, {recursive: true, withFileTypes: true}))
    if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts'))
      files.push(join(entry.parentPath ?? entry.path, entry.name));
  const reads = new Map(), writes = new Map();
  const add = (map, key, where) => (map.get(key) ?? map.set(key, new Set()).get(key)).add(where);
  for (const path of files.sort()) {
    const rel = path.slice(KERNEL.length + 1).split('\\').join('/');
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const isWorld = node => {
      const text = node.getText();
      return text === 'world' || /\.world$/.test(text) || (ALIASES[rel] ?? []).includes(text);
    };
    const visit = node => {
      if (ts.isPropertyAccessExpression(node) && isWorld(node.expression)) {
        const key = node.name.text;
        if (!NOT_THE_WORLD[rel]?.[key]) {
          const parent = node.parent, assigned = ts.isBinaryExpression(parent) && parent.left === node
            && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken].includes(parent.operatorToken.kind);
          add(assigned || ts.isDeleteExpression(parent) ? writes : reads, key, rel);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return {reads, writes};
}

test('every world-state key the kernel reads has something that writes it', () => {
  const {reads, writes} = walk();
  const orphans = [...reads.keys()].filter(key => !writes.has(key) && !Object.hasOwn(SEEDED, key)).sort();
  assert.deepEqual(orphans, [], orphans.length
    ? `read with no writer: ${orphans.map(key => `world.${key} (read in ${[...reads.get(key)].join(', ')})`).join('; ')}`
      + ' -- give it a writer, stop reading it, or declare it in SEEDED with the reason it never changes'
    : '');
});

test('every world-state key the kernel writes has something that reads it', () => {
  const {reads, writes} = walk();
  const unread = [...writes.keys()].filter(key => !reads.has(key)).sort();
  assert.deepEqual(unread, [], unread.length
    ? `written with no reader: ${unread.map(key => `world.${key} (written in ${[...writes.get(key)].join(', ')})`).join('; ')}`
      + ' -- project it or stop writing it'
    : '');
});

test('the ledger sees the keys play actually turns on', () => {
  const {reads, writes} = walk();
  // A guard that matched nothing would pass both tests above in silence.
  for (const key of ['active_scene', 'discovered_clues', 'flags', 'clock', 'npc_presence', 'threat_clocks'])
    assert.ok(reads.has(key) && writes.has(key), `${key} should be paired on both ends`);
  assert.ok(reads.size >= 12, 'the walk should find the world, not a handful of accidents');
});
