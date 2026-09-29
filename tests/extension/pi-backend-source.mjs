/**
 * Loads an Electron pi-backend source module for a root test.
 *
 * pi-backend is compiled by tsc with NodeNext, so its relative imports end in `.js` and name files that exist only as
 * `.ts` in src/. Node's type stripping loads a leaf module fine but cannot follow such an import, so the day a module
 * the tests load gains a sibling import (coc-view.ts importing ./coc-handout-images.js, 2026-09-29) every test file that
 * imports it fails before its first test. esbuild resolves those imports the way the App's own build does. Root tests
 * load pi-backend code only through here.
 *
 * The module is bundled self-contained into a temporary directory; Node builtins stay external. One bundle per module
 * per test process, so a test file sees one instance of the module however many times it asks.
 */
import {build} from 'esbuild';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const ROOT = resolve(import.meta.dirname, '../..');
const SOURCE = join(ROOT, 'Electron/packages/pi-backend/src');
const loaded = new Map();
let directory = null;

function outputDirectory() {
  if (!directory) {
    directory = mkdtempSync(join(tmpdir(), 'pi-backend-source-'));
    process.on('exit', () => rmSync(directory, {recursive: true, force: true}));
  }
  return directory;
}

/** The module `src/<file>` of pi-backend, e.g. `await piBackend('coc-view.ts')`. */
export function piBackend(file) {
  if (!loaded.has(file)) loaded.set(file, (async () => {
    const outfile = join(outputDirectory(), file.replace(/[\\/]/g, '__').replace(/\.ts$/, '.mjs'));
    await build({entryPoints: [join(SOURCE, file)], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
    return import(pathToFileURL(outfile).href);
  })());
  return loaded.get(file);
}
