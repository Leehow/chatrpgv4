/** Emit host-loadable JavaScript with the same pinned build tool as the Pi package. */
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  absWorkingDir: root,
  entryPoints: {
    'kernel/rpc': 'kernel-ts/rpc.ts',
    'runtime/host': 'runtime/host.ts',
    'runtime/preparation': 'runtime/preparation.ts',
    'runtime/check': 'runtime/check.ts',
  },
  outdir: resolve(root, 'build'),
  outExtension: {'.js': '.mjs'},
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'warning',
});
