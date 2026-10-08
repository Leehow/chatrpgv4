import {resolve} from 'node:path';
import {build} from 'esbuild';
import {join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const out = join(root, '.coc', 'graph-grounding-probe-api.mjs');
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';`, resolveDir: root},
  outfile: out, bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent', nodePaths: [join(root, 'node_modules')]});
export const api = await import(pathToFileURL(out).href);
export async function kernel(home) {
  const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'probe', locks: api.nativeAdvisoryLocks(),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context);
  return {context, runtime, call: (m, p = {}) => runtime.handlers[m](p)};
}
