/**
 * Build the vendored Pi (ADR-0006) into the one copy the product loads.
 *
 * `vendor/pi/` holds the TypeScript source of `@earendil-works/pi-agent-core` and
 * `@earendil-works/pi-coding-agent` at upstream `v0.87.0` plus the reviewed patch series
 * (`vendor/pi/PATCHES.md`, `vendor/pi/patches/`). This compiles both packages with the upstream
 * compiler options into `build/node_modules/@earendil-works/<name>/`, which is where every emitted
 * entry under `build/` resolves a bare `@earendil-works/pi-*` import first, and where the launcher,
 * the reader children and pi-backend's in-process loader find Pi (`runtime/deployment.mjs`
 * `runtimeEntrypoints().pi` / `.piModule`). The rest of Pi (`pi-ai`, `pi-tui`, `chord`,
 * `pi-telemetry`) and every third-party dependency stay the installed ones and resolve through the
 * repository's `node_modules`, so exactly one copy of each package loads.
 *
 * The upstream `bin` and `./rpc-entry` point into a bundle this build does not make; the emitted
 * `package.json` points them at the unbundled `dist/cli.js` / `dist/rpc-entry.js` and records the
 * base version and patch-series digest under `piCoc` (the startup record reads it). Nothing under
 * `node_modules/` is edited.
 *
 * The build is skipped when the vendored tree, the patch series and this script are unchanged since
 * the last build (the digest is kept in `build/node_modules/.pi-build.json`). `--force` rebuilds.
 */
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const VENDOR = join(root, 'vendor/pi');
export const PI_OUTPUT = join(root, 'build/node_modules');
export const PI_BASE = Object.freeze({ repository: 'https://github.com/earendil-works/pi', tag: 'v0.87.0', commit: '16787ad5b2dc748047f314ca1bfe7708f30f54f3', version: '0.87.0' });

const PACKAGES = [
  { dir: 'agent', name: '@earendil-works/pi-agent-core', files: ['README.md', 'CHANGELOG.md'], executables: [] },
  { dir: 'coding-agent', name: '@earendil-works/pi-coding-agent', files: ['README.md', 'CHANGELOG.md'], executables: ['dist/cli.js', 'dist/rpc-entry.js'],
    // Upstream `copy-assets`: files the running package reads next to its emitted modules.
    assets: [
      ['src/modes/interactive/theme', 'dist/modes/interactive/theme', name => name.endsWith('.json')],
      ['src/modes/interactive/assets', 'dist/modes/interactive/assets', name => name.endsWith('.png')],
      ['src/core/export-html', 'dist/core/export-html', name => ['template.html', 'template.css', 'template.js'].includes(name)],
      ['src/core/export-html/vendor', 'dist/core/export-html/vendor', name => name.endsWith('.js')],
    ] },
];

function files(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(directory, join(entry.parentPath ?? entry.path, entry.name)).split('\\').join('/'))
    .sort();
}

/** The patch series digest: sha256 over the ordered patch files (the empty series has a digest too). */
export function patchSeriesDigest(vendor = VENDOR) {
  const hash = createHash('sha256');
  const directory = join(vendor, 'patches');
  const series = existsSync(directory) ? files(directory).filter(name => name.endsWith('.patch')) : [];
  for (const name of series) hash.update(`${name}\0`).update(readFileSync(join(directory, name))).update('\0');
  return hash.digest('hex');
}

function sourceDigest() {
  const hash = createHash('sha256');
  for (const name of files(VENDOR)) hash.update(`${name}\0`).update(readFileSync(join(VENDOR, name))).update('\0');
  hash.update(readFileSync(fileURLToPath(import.meta.url)));
  return hash.digest('hex');
}

export function builtPackageRoot(name, output = PI_OUTPUT) { return join(output, ...name.split('/')); }

function compilerOptions(pkg, outDir) {
  const base = ts.readConfigFile(join(VENDOR, 'tsconfig.base.json'), ts.sys.readFile);
  const own = ts.readConfigFile(join(VENDOR, 'packages', pkg.dir, 'tsconfig.build.json'), ts.sys.readFile);
  if (base.error || own.error) throw new Error(`unreadable tsconfig for ${pkg.name}`);
  const merged = { ...base.config.compilerOptions, ...own.config.compilerOptions };
  // Upstream maps sibling packages to their workspace `dist`. Here pi-agent-core is the one built by
  // this script; every other package is the installed one, found through node_modules.
  const paths = pkg.dir === 'coding-agent'
    ? { '@earendil-works/pi-agent-core': [join(builtPackageRoot('@earendil-works/pi-agent-core', outDir), 'dist/index.d.ts')],
        '@earendil-works/pi-agent-core/*': [join(builtPackageRoot('@earendil-works/pi-agent-core', outDir), 'dist/*.d.ts'),
          join(builtPackageRoot('@earendil-works/pi-agent-core', outDir), 'dist/*/index.d.ts')] }
    : undefined;
  delete merged.paths;
  const parsed = ts.parseJsonConfigFileContent({ compilerOptions: { ...merged, ...(paths ? { paths } : {}) }, include: own.config.include, exclude: own.config.exclude },
    ts.sys, join(VENDOR, 'packages', pkg.dir));
  if (parsed.errors.length) throw new Error(ts.formatDiagnostics(parsed.errors, host()));
  parsed.options.outDir = join(builtPackageRoot(pkg.name, outDir), 'dist');
  parsed.options.rootDir = join(VENDOR, 'packages', pkg.dir, 'src');
  // The published 0.87.0 was emitted by tsgo, which emits ES2022 class fields as declared (define
  // semantics) although the base config says `useDefineForClassFields: false`. The admission check
  // (`tests/extension/vendored-pi.test.mjs`) compares this build to the published dist file by file,
  // so the build follows what shipped, not the flag tsgo ignored.
  parsed.options.useDefineForClassFields = true;
  return parsed;
}

/**
 * Type errors the unpatched upstream tree shows under this repository's toolchain, none of which
 * changes what is emitted (`erasableSyntaxOnly`: emit is type erasure): upstream type-checks with its
 * own devDependencies (`@types/semver`, `@types/proper-lockfile`, `@types/cross-spawn`,
 * `@types/hosted-git-info`) and `@types/node`, which the product does not install. TS7016 is "no
 * declaration file for a third-party module"; the three listed sites are the consequences of the
 * missing `proper-lockfile` types and the older `@types/node` here. Any other error fails the build,
 * so a patch that does not type-check is caught.
 */
const TOLERATED_CODES = new Set([7016]);
const TOLERATED_SITES = new Set(['coding-agent/src/core/auth-storage.ts:2722', 'coding-agent/src/core/auth-storage.ts:2322', 'coding-agent/src/core/tools/find.ts:2694']);
const tolerated = diagnostic => TOLERATED_CODES.has(diagnostic.code) || (diagnostic.file
  && TOLERATED_SITES.has(`${relative(join(VENDOR, 'packages'), diagnostic.file.fileName).split('\\').join('/')}:${diagnostic.code}`));

const host = () => ({ getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n' });

function emitPackage(pkg, outDir) {
  const target = builtPackageRoot(pkg.name, outDir);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const parsed = compilerOptions(pkg, outDir);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const emitted = program.emit();
  const errors = [...diagnostics, ...emitted.diagnostics].filter(value => value.category === ts.DiagnosticCategory.Error);
  const fatal = errors.filter(value => !tolerated(value));
  if (fatal.length) throw new Error(`vendored ${pkg.name} does not compile:\n${ts.formatDiagnostics(fatal.slice(0, 30), host())}`);
  const manifest = JSON.parse(readFileSync(join(VENDOR, 'packages', pkg.dir, 'package.json'), 'utf8'));
  if (manifest.name !== pkg.name || manifest.version !== PI_BASE.version) throw new Error(`vendor/pi/packages/${pkg.dir} is not ${pkg.name}@${PI_BASE.version}`);
  if (pkg.dir === 'coding-agent') {
    manifest.bin = { pi: 'dist/cli.js' };
    manifest.exports = { ...manifest.exports, './rpc-entry': { import: './dist/rpc-entry.js' } };
    delete manifest.exports['./client'];
    delete manifest.exports['./experimental/plugin'];
  }
  delete manifest.scripts;
  delete manifest.devDependencies;
  manifest.piCoc = { vendored: true, base: PI_BASE, patchSeriesDigest: patchSeriesDigest() };
  writeFileSync(join(target, 'package.json'), JSON.stringify(manifest, null, '\t') + '\n');
  for (const name of pkg.files) copyFileSync(join(VENDOR, 'packages', pkg.dir, name), join(target, name));
  for (const [from, to, keep] of pkg.assets ?? []) {
    mkdirSync(join(target, to), { recursive: true });
    for (const entry of readdirSync(join(VENDOR, 'packages', pkg.dir, from), { withFileTypes: true }))
      if (entry.isFile() && keep(entry.name)) copyFileSync(join(VENDOR, 'packages', pkg.dir, from, entry.name), join(target, to, entry.name));
  }
  for (const path of pkg.executables) chmodSync(join(target, path), 0o755);
}

/** Build both packages into `outDir` (default `build/node_modules`). Returns whether it rebuilt. */
export function buildPi({ force = false, outDir = PI_OUTPUT } = {}) {
  const digest = sourceDigest();
  const stamp = join(outDir, '.pi-build.json');
  if (!force && existsSync(stamp)) {
    try {
      const previous = JSON.parse(readFileSync(stamp, 'utf8'));
      if (previous.digest === digest && PACKAGES.every(pkg => existsSync(join(builtPackageRoot(pkg.name, outDir), 'package.json')))) return false;
    } catch { /* an unreadable stamp rebuilds */ }
  }
  for (const pkg of PACKAGES) emitPackage(pkg, outDir);
  writeFileSync(stamp, JSON.stringify({ digest, base: PI_BASE, patchSeriesDigest: patchSeriesDigest(), packages: PACKAGES.map(pkg => pkg.name) }, null, 2) + '\n');
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const began = Date.now();
  const rebuilt = buildPi({ force: process.argv.includes('--force') });
  if (rebuilt) console.log(`vendored Pi ${PI_BASE.tag} built into ${relative(root, PI_OUTPUT)} in ${Date.now() - began} ms`);
}
