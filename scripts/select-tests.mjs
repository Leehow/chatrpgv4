/**
 * Focused native test selection: extension, integration and routing scopes a change can affect.
 *
 * Usage: node scripts/select-tests.mjs [--base <rev>] [--changed <file>] [--json] [--explain <test file>] [--run-integration]
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
 * Native integration tests use these same rules, including imports through tests/play helpers.
 * `integration_files` contains selected native files; `integration` records whether the lane is needed.
 * --run-integration invokes the native evidence runner with the selected files and preserves its exit status.
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
const CODE_ROOTS = ['extensions', 'runtime', 'kernel-ts', 'pipicoc', 'tests/extension', 'tests/integration', 'tests/play', 'scripts', 'experiments', 'Electron/resources/runtime'];
const CODE_EXT = new Set(['.ts', '.mts', '.mjs', '.js', '.cjs']);
/** Changes that never reach a test run. */
const INERT = [/^docs\//, /^\.claude\//, /^\.github\//, /\.md$/i];
/** Changes no static analysis can place: run everything. */
const GLOBAL = [/^package(-lock)?\.json$/, /^Electron\/package(-lock)?\.json$/, /^\.npmrc$/, /^Electron\/\.npmrc$/,
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
const isIntegrationTest = path => path.startsWith('tests/integration/') && path.endsWith('.test.ts');
const tests = modules.filter(path => (path.startsWith('tests/extension/') && path.endsWith('.test.mjs')) || isIntegrationTest(path) || path === LOOP);

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
  // A complete repository module path is an explicit dependency too: native fixtures hand
  // kernel-ts/rpc.ts to esbuild, and that entry's own imports must remain in the closure.
  const named = [...source.matchAll(/["'`]([A-Za-z0-9_./-]+\.(?:ts|mts|mjs|js|cjs))["'`]/g)]
    .map(match => moduleSet.has(match[1]) ? match[1] : resolveSpecifier(path, match[1]))
    .filter(candidate => candidate && candidate !== path);
  imports.set(path, [...new Set([...info.importedFiles.map(file => resolveSpecifier(path, file.fileName)).filter(Boolean), ...named])]);
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
  // A deleted code dependency no longer has an import graph to prove a narrow scope.
  if (!moduleSet.has(path) && CODE_EXT.has(extname(path)) && CODE_ROOTS.some(dir => path.startsWith(dir + '/'))) {
    full = true; unplaced.push(path); continue;
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

const integrationFiles = [...reasons.keys()].filter(isIntegrationTest).sort();
const ext = [...reasons.keys()].filter(test => test.startsWith('tests/extension/')).sort();
const result = {
  base, changed: changed.size, full, unplaced,
  ext: full ? ['tests/extension/**/*.test.mjs'] : ext,
  integration: full || integrationFiles.length > 0,
  integration_files: full ? ['tests/integration/*.test.ts'] : integrationFiles,
  loop_routing: full || reasons.has(LOOP),
};
const explain = flag('--explain');
if (explain) { console.log(reasons.get(explain) ?? 'not selected'); process.exit(0); }
if (args.includes('--run-integration')) {
  console.log(`Native integration selection: ${result.integration_files.join(' ') || '(none)'}`);
  if (result.integration_files.length) {
    const run = spawnSync(process.execPath, ['scripts/test-integration.mjs', ...result.integration_files],
      { cwd: root, stdio: 'inherit', env: { ...process.env, COC_TS_TEST_CONCURRENCY: flag('--integration-workers') ?? process.env.COC_TS_TEST_CONCURRENCY ?? '2' } });
    if (run.error) throw run.error;
    process.exitCode = run.status ?? (run.signal === 'SIGINT' ? 130 : 1);
  }
}
else if (args.includes('--json')) console.log(JSON.stringify({ ...result, reasons: Object.fromEntries(reasons) }, null, 1));
else {
  console.log(`base ${base.slice(0, 9)}  changed ${changed.size}  full ${full}  ext ${full ? 'all' : result.ext.length}  integration ${result.integration}  loop ${result.loop_routing}`);
  if (unplaced.length) console.log('unplaced: ' + unplaced.join(', '));
  if (!full) console.log(result.ext.join('\n'));
}
