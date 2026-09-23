/**
 * Replay a fixture turn through the single-loop routing prototype.
 *
 *   node experiments/single-loop-routing/run.mjs --fixture turn3 --runs 3 [--out <dir>]
 *
 * The entry is bundled with esbuild (the product modules it imports use TypeScript syntax Node does not
 * strip) into a temporary file next to the repository's node_modules, then executed. Needs a built
 * kernel (`npm run build:runtime`) and the App's Jev key (read from the profile's secret vault).
 */
import {mkdtempSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
const scratch = mkdtempSync(join(tmpdir(), 'single-loop-routing-bundle-'));
try {
  symlinkSync(join(ROOT, 'node_modules'), join(scratch, 'node_modules'), 'dir');
  await build({entryPoints: [join(import.meta.dirname, 'run-entry.ts')], outfile: join(scratch, 'run-entry.mjs'), bundle: true, packages: 'external',
    format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent', define: {'import.meta.dirname': JSON.stringify(import.meta.dirname)}});
  const {main} = await import(pathToFileURL(join(scratch, 'run-entry.mjs')).href);
  await main(process.argv.slice(2));
} finally {
  rmSync(scratch, {recursive: true, force: true});
}
