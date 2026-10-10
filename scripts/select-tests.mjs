/**
 * Focused test selection: the extension tests and pytest scope a change can affect.
 *
 * Usage: node scripts/select-tests.mjs [--base <rev>] [--changed <file>] [--json] [--explain <test file>] [--run-py]
 *
 * The change is `git diff <base>...HEAD` plus the working tree's modified and untracked files (base defaults to the
 * merge base with 0.9.7a). `--changed <file>` reads that list instead, one path per line: the box gets the list from the
 * checkout it mirrors, since its own copy holds untracked files the mirror never had (.venv, run logs). A test file is
 * selected when:
 *   1. it changed;
 *   2. it reaches a changed module through imports (static or dynamic, relative specifiers, transitively through any
 *      helper or source module in the repository);
 *   3. it, or a module it reaches, names an emitted bundle (`build/....mjs`) whose sourcemap lists a changed source;
 *   4. it, or a module it reaches, names a changed data file or a changed module by its repository path.
 * The smoke set always runs. A changed file this cannot place (a dependency manifest, a build script, a data file no
 * test names and that the product reads at runtime) selects everything: `full: true`.
 * The routing loop test (experiments/single-loop-routing/loop.test.mjs) is placed by the same rules.
 * `py_files` narrows independent pytest-file changes; shared helpers, deleted tests and emitted bundles keep both
 * suite directories. `py` remains a boolean for older runners. --run-py executes the selection locally (-n 2).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }).trim();

const listed = flag('--changed');
const base = listed ? flag('--base') ?? '' : git('rev-parse', flag('--base') ?? git('merge-base', 'HEAD', '0.9.7a'));
const changed = new Set((listed ? readFileSync(listed, 'utf8').split('\n') : [
  ...git('diff', '--name-only', `${base}...HEAD`).split('\n'),
  ...git('diff', '--name-only').split('\n'),
  ...git('diff', '--name-only', '--cached').split('\n'),
  ...git('ls-files', '--others', '--exclude-standard').split('\n'),
]).map(path => path.trim()).filter(Boolean).filter(path => !path.split('/').includes('node_modules')));

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
const LOOP = 'experiments/single-loop-routing/loop.test.mjs';
const tests = modules.filter(path => (path.startsWith('tests/extension/') && path.endsWith('.test.mjs')) || path === LOOP);

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
const isPytestFile = path => /^tests\/(kernel|play)\/(?:[^/]+\/)*test_[A-Za-z0-9_]+\.py$/.test(path);
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
  // A Python test is executable test code, not an unknown product data file.
  if (isPytestFile(path)) {
    for (const reader of readersOf(path)) affected.add(reader);
    continue;
  }
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
    // A source loaded by its repository path rather than imported (read as text, or handed to a child process).
    const named = [...affected].find(path => text.get(module).includes(path));
    if (named) { select(test, `names ${named}`); break; }
  }
}
for (const test of SMOKE) if (existsSync(join(root, test))) select(test, 'smoke');

/** Python tests build paths from parts (`ROOT / "build" / "kernel" / "rpc.mjs"`), so a file counts as named by its basename. */
function pythonUnder(dir, out = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) pythonUnder(path, out); else if (entry.name.endsWith('.py')) out.push(path);
  }
  return out;
}
const pySources = new Map(pythonUnder('tests').map(path => [path, readFileSync(join(root, path), 'utf8')]));
const pyText = [...pySources.values()].join('\n');
const pyTriggers = [...changed].filter(path => path.endsWith('.py') || path.startsWith('tests/kernel/')
  || path.startsWith('tests/play/') || (!INERT.some(rule => rule.test(path)) && pyText.includes(path.split('/').pop())));
const py = full || changedBundles.size > 0 || pyTriggers.length > 0;
// Naming a changed test module anywhere else is conservatively treated as shared usage,
// including multiline imports and importlib calls. Helpers and implicit fixtures always run whole.
const independent = path => isPytestFile(path) && existsSync(join(root, path)) && ![...pySources].some(([other, source]) =>
  other !== path && new RegExp(`\\b${path.split('/').pop().slice(0, -3)}\\b`).test(source));
const pyFiles = !py ? [] : !full && !changedBundles.size && pyTriggers.length && pyTriggers.every(independent)
  ? [...new Set(pyTriggers)].sort() : ['tests/kernel', 'tests/play'];
for (const path of pyFiles) reasons.set(path, isPytestFile(path) ? 'independent changed pytest file' : 'full pytest fallback');
const ext = [...reasons.keys()].filter(test => test !== LOOP && !pyFiles.includes(test)).sort();
const result = {
  base, changed: changed.size, full, unplaced,
  ext: full ? ['tests/extension/**/*.test.mjs'] : ext,
  py,
  py_files: pyFiles,
  loop_routing: full || reasons.has(LOOP),
};
const explain = flag('--explain');
if (explain) { console.log(reasons.get(explain) ?? 'not selected'); process.exit(0); }
if (args.includes('--run-py')) {
  console.log(`pytest selection: ${pyFiles.join(' ') || '(none)'}`);
  if (pyFiles.length) {
    const run = spawnSync('uv', ['run', '--frozen', 'python', '-m', 'pytest', ...pyFiles, '-n', flag('--py-workers') ?? '2', '-q', '-p', 'no:cacheprovider'],
      { cwd: root, stdio: 'inherit', env: { ...process.env, COC_TEST_NODE: process.env.COC_TEST_NODE ?? process.execPath } });
    if (run.error) throw run.error;
    process.exitCode = run.status ?? (run.signal === 'SIGINT' ? 130 : 1);
  }
}
else if (args.includes('--json')) console.log(JSON.stringify({ ...result, reasons: Object.fromEntries(reasons) }, null, 1));
else {
  console.log(`base ${base.slice(0, 9)}  changed ${changed.size}  full ${full}  ext ${full ? 'all' : result.ext.length + '/' + (tests.length - 1)}  py ${result.py}  loop ${result.loop_routing}`);
  if (unplaced.length) console.log('unplaced: ' + unplaced.join(', '));
  if (!full) console.log(result.ext.join('\n'));
}
