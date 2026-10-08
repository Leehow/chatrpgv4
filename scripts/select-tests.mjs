/**
 * Focused test selection: the extension tests and pytest scope a change can affect.
 *
 * Usage: node scripts/select-tests.mjs [--base <rev>] [--json] [--explain <test file>]
 *
 * The change is `git diff <base>...HEAD` plus the working tree's modified and untracked files (base defaults to the
 * merge base with 0.9.7a). A test file is selected when:
 *   1. it changed;
 *   2. it reaches a changed module through imports (static or dynamic, relative specifiers, transitively through any
 *      helper or source module in the repository);
 *   3. it, or a module it reaches, names an emitted bundle (`build/....mjs`) whose sourcemap lists a changed source;
 *   4. it, or a module it reaches, names a changed data file by its repository path.
 * The smoke set always runs. A changed file this cannot place (a dependency manifest, a build script, a data file no
 * test names and that the product reads at runtime) selects everything: `full: true`.
 * pytest runs whole (`py: true`) when product code or product data changed; tests/kernel and tests/play exercise the
 * emitted kernel and the host as a whole.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }).trim();

const base = flag('--base') ?? git('merge-base', 'HEAD', '0.9.7a');
const changed = new Set([
  ...git('diff', '--name-only', `${base}...HEAD`).split('\n'),
  ...git('diff', '--name-only').split('\n'),
  ...git('diff', '--name-only', '--cached').split('\n'),
  ...git('ls-files', '--others', '--exclude-standard').split('\n'),
].filter(Boolean).filter(path => !path.split('/').includes('node_modules')));

/** Always run: the kernel boots, the static run-driving inventory, the host composes. */
const SMOKE = ['tests/extension/ts-kernel-foundation.test.mjs', 'tests/extension/control-flow-inventory.test.mjs'];
/** Code roots whose modules the import graph covers. */
const CODE_ROOTS = ['extensions', 'runtime', 'kernel-ts', 'pipicoc', 'tests/extension', 'scripts', 'experiments', 'Electron/resources/runtime'];
const CODE_EXT = new Set(['.ts', '.mts', '.mjs', '.js', '.cjs']);
/** Changes that never reach a test run. */
const INERT = [/^docs\//, /^\.claude\//, /^\.github\//, /\.md$/i];
/** Changes no static analysis can place: run everything. */
const GLOBAL = [/^package(-lock)?\.json$/, /^Electron\/package(-lock)?\.json$/, /^uv\.lock$/, /^pyproject\.toml$/,
  /^tsconfig[^/]*\.json$/, /^scripts\/build-[^/]*\.mjs$/, /^scripts\/test-extension\.mjs$/, /^vendor\//,
  /^pipicoc\/runtime-dependencies\.json$/, /^runtime\/deployment\.(m?js|d\.mts)$/];

function walk(dir, out = []) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (CODE_EXT.has(extname(entry.name)) && !entry.name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

const modules = CODE_ROOTS.flatMap(dir => walk(dir));
const moduleSet = new Set(modules);
const tests = modules.filter(path => path.startsWith('tests/extension/') && path.endsWith('.test.mjs'));

/** A relative specifier to a repository module, the way Node and the TS-ESM sources write them. */
function resolveSpecifier(from, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  const target = relative(root, resolve(root, dirname(from), specifier));
  const stem = target.replace(/\.(m?js|cjs)$/, '');
  for (const candidate of [target, `${stem}.ts`, `${stem}.mts`, `${stem}.mjs`, `${stem}.js`, `${target}.ts`, `${target}.mjs`, `${target}/index.ts`, `${target}/index.mjs`])
    if (moduleSet.has(candidate)) return candidate;
  return undefined;
}

const text = new Map(), imports = new Map();
for (const path of modules) {
  const source = readFileSync(join(root, path), 'utf8');
  text.set(path, source);
  const info = ts.preProcessFile(source, true, true);
  imports.set(path, info.importedFiles.map(file => resolveSpecifier(path, file.fileName)).filter(Boolean));
}

/** Emitted bundle → the sources its sourcemap lists. */
const bundleSources = new Map();
function mapsUnder(dir, out = []) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) mapsUnder(path, out);
    else if (entry.name.endsWith('.mjs.map')) out.push(path);
  }
  return out;
}
const maps = mapsUnder('build');
for (const map of maps) {
  try {
    const parsed = JSON.parse(readFileSync(join(root, map), 'utf8'));
    const bundle = map.slice(0, -4);
    bundleSources.set(bundle, new Set((parsed.sources ?? []).map(src => relative(root, resolve(root, dirname(bundle), src)))));
  } catch { /* an unreadable map places nothing */ }
}

/** What a module names: emitted bundles and repository data paths written as strings. */
const BUNDLE_REF = /build\/[A-Za-z0-9_./-]+?\.mjs/g;

const reasons = new Map();
const select = (test, why) => { if (!reasons.has(test)) reasons.set(test, why); };

// Closure of each test over imports, computed once per test.
const reach = new Map();
function closure(test) {
  if (reach.has(test)) return reach.get(test);
  const seen = new Set([test]), stack = [test];
  while (stack.length) for (const next of imports.get(stack.pop()) ?? []) if (!seen.has(next)) { seen.add(next); stack.push(next); }
  reach.set(test, seen);
  return seen;
}

let full = false;
const unplaced = [];
const isData = path => !moduleSet.has(path) && !INERT.some(rule => rule.test(path)) && !GLOBAL.some(rule => rule.test(path));
/** The modules that name a data path, or the nearest of its directories that some module names. */
function readersOf(path) {
  for (let dir = path; dir && dir !== '.'; dir = dirname(dir)) {
    const needle = dir === path ? path : dir + '/';
    const found = modules.filter(module => text.get(module).includes(needle));
    if (found.length) return found;
  }
  return [];
}
// The modules a change touches: changed code, and the modules that read changed data.
const affected = new Set([...changed].filter(path => moduleSet.has(path)));
for (const path of changed) {
  if (GLOBAL.some(rule => rule.test(path))) { full = true; unplaced.push(path); continue; }
  if (!isData(path)) continue;
  const readers = readersOf(path);
  if (readers.length) for (const reader of readers) affected.add(reader);
  else if (!path.startsWith('experiments/')) { full = true; unplaced.push(path); }
}
const changedBundles = new Set();
for (const [bundle, sources] of bundleSources) for (const path of affected) if (sources.has(path)) changedBundles.add(bundle);
if (!maps.length && [...affected].some(path => !path.startsWith('tests/'))) { full = true; unplaced.push('(no build/ sourcemaps: run build:runtime first)'); }

for (const test of tests) {
  if (changed.has(test)) { select(test, 'changed'); continue; }
  const reached = closure(test);
  const viaImport = [...affected].find(path => reached.has(path));
  if (viaImport) { select(test, `reaches ${viaImport}`); continue; }
  for (const module of reached) {
    const hit = (text.get(module).match(BUNDLE_REF) ?? []).find(ref => changedBundles.has(ref));
    if (hit) { select(test, `names ${hit}`); break; }
  }
}
for (const test of SMOKE) if (existsSync(join(root, test))) select(test, 'smoke');

const product = [...changed].some(path => !INERT.some(rule => rule.test(path)) && !path.startsWith('tests/extension/'));
const result = {
  base, changed: changed.size, full, unplaced,
  ext: full ? ['tests/extension/**/*.test.mjs'] : [...reasons.keys()].sort(),
  py: full || product || [...changed].some(path => path.startsWith('tests/kernel/') || path.startsWith('tests/play/')),
  loop_routing: full || [...changed].some(path => path.startsWith('experiments/single-loop-routing/')) || [...reasons.keys()].some(t => /single-loop/.test(t)),
};
const explain = flag('--explain');
if (explain) { console.log(reasons.get(explain) ?? 'not selected'); process.exit(0); }
if (args.includes('--json')) console.log(JSON.stringify({ ...result, reasons: Object.fromEntries(reasons) }, null, 1));
else {
  console.log(`base ${base.slice(0, 9)}  changed ${changed.size}  full ${full}  ext ${full ? 'all' : result.ext.length + '/' + tests.length}  py ${result.py}`);
  if (unplaced.length) console.log('unplaced: ' + unplaced.join(', '));
  if (!full) console.log(result.ext.join('\n'));
}
