/** Deployment locations shared by Node launchers and the Electron host. No TS loader is needed. */
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const COMPILED_ENTRIES = Object.freeze({
  kernel: 'build/kernel/rpc.mjs', kernelCheck: 'build/kernel/check.mjs',
  host: 'build/runtime/host.mjs', preparation: 'build/runtime/preparation.mjs',
  check: 'build/runtime/check.mjs', launch: 'build/runtime/launch.mjs',
  sourceWorker: 'build/runtime/source-worker.mjs', source: 'build/extensions/module/source.mjs',
  onboardingWorker: 'build/pipicoc/onboarding-worker.mjs', rpc: 'build/pipicoc/rpc.mjs',
  agent: 'build/pipicoc/agent.mjs', readerContext: 'build/extensions/module/reader-context.mjs',
  readerPdf: 'build/extensions/module/reader-pdf.mjs', readerSubmit: 'build/extensions/module/reader-submit.mjs',
  deepseek: 'build/extensions/deepseek/agent/index.mjs',
  characterGuidance: 'build/extensions/module/character-guidance.mjs',
  characterPresentation: 'build/extensions/module/character-presentation.mjs',
  documentPresentation: 'build/extensions/mods/document-presentation.mjs',
  uiPresentation: 'build/extensions/module/ui-presentation.mjs',
});
const COC_EXTENSIONS = ['kernel', 'mods', 'onboarding', 'module', 'memory', 'table'];
export const HOST_MOUNTS = Object.freeze({
  'secret-vault': 'kernel/pipiui-secret-vault.mjs',
  'context-fold': 'pi-ext/packages/context-fold/index.mjs',
  'update-center': 'kernel/pipiui-update-center.mjs',
  'runtime-info': 'kernel/pipiui-runtime-info.mjs',
  'ext-invoke': 'kernel/pipiui-ext-invoke.mjs',
  'prompt-observer': 'kernel/pipiui-prompt-observer.mjs',
});

function within(root, path) {
  const suffix = relative(root, path);
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`));
}

/** Validate both spelling and the resolved symlink target before loading a resource. */
export function resourcePath(root, value, kind = 'file') {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') ||
      isAbsolute(value) || value.split('/').some(part => part === '..' || part === ''))
    throw new Error(`Invalid relative runtime resource: ${String(value)}`);
  const base = realpathSync(root), path = resolve(root, value);
  if (!within(base, realpathSync(path))) throw new Error(`Runtime resource escapes its root: ${value}`);
  const info = statSync(path);
  if (kind === 'directory' ? !info.isDirectory() : !info.isFile())
    throw new Error(`Runtime resource has the wrong type: ${value}`);
  accessSync(path, constants.R_OK | (kind === 'executable' || kind === 'directory' ? constants.X_OK : 0));
  return path;
}

/** Writable locations may be new, but an existing ancestor may not point into resources. */
export function assertWritableLocation(root, path) {
  const target = resolve(path), base = realpathSync(root);
  let ancestor = target;
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
  const canonical = resolve(realpathSync(ancestor), relative(ancestor, target));
  if (within(base, canonical)) throw new Error(`Runtime writable location is inside immutable resources: ${path}`);
  return target;
}

export function resourceRootFrom(moduleUrl, env = process.env) {
  if (env.PI_COC_RESOURCE_ROOT) return resolve(env.PI_COC_RESOURCE_ROOT);
  let path = dirname(fileURLToPath(moduleUrl));
  for (;;) {
    if (existsSync(join(path, 'deployment.json')) ||
        (existsSync(join(path, 'pyproject.toml')) && existsSync(join(path, 'content')))) return path;
    const parent = dirname(path);
    if (parent === path) throw new Error('Cannot locate the COC resource root');
    path = parent;
  }
}

export function runtimeEntrypoints(root, layout = 'source') {
  if (!['source', 'compiled'].includes(layout)) throw new Error(`Unknown runtime layout: ${layout}`);
  const resolved = Object.fromEntries(Object.entries(COMPILED_ENTRIES).map(([name, path]) => [name, resolve(root, path)]));
  return Object.freeze({ ...resolved,
    extensions: Object.freeze(COC_EXTENSIONS.map(name => join(root, 'build/extensions', name, 'index.mjs'))),
    hostAssets: join(root, 'build/host/runtime'),
    pi: join(root, 'node_modules', '.bin', 'pi'),
  });
}

export function runtimeEntryUrl(name, moduleUrl, env = process.env) {
  const root = resourceRootFrom(moduleUrl, env);
  const layout = env.PI_COC_LAYOUT === 'compiled' || existsSync(join(root, 'deployment.json')) ? 'compiled' : 'source';
  const path = runtimeEntrypoints(root, layout)[name];
  if (typeof path !== 'string') throw new Error(`Unknown runtime entrypoint: ${name}`);
  return pathToFileURL(path).href;
}

export function readDeployment(root) {
  const manifest = JSON.parse(readFileSync(resourcePath(root, 'deployment.json'), 'utf8'));
  if (manifest?.schemaVersion !== 1 || manifest.layout !== 'compiled' || manifest.backend !== 'typescript')
    throw new Error('Unsupported standalone COC deployment manifest');
  const node = resourcePath(root, manifest.node, 'executable');
  const git = resourcePath(root, manifest.git, 'executable');
  const gitExec = resourcePath(root, manifest.gitExec, 'directory');
  const gitTemplates = resourcePath(root, manifest.gitTemplates, 'directory');
  const pi = resourcePath(root, manifest.pi);
  const entries = runtimeEntrypoints(root, 'compiled');
  for (const path of [...Object.values(COMPILED_ENTRIES), ...COC_EXTENSIONS.map(name => `build/extensions/${name}/index.mjs`)]) resourcePath(root, path);
  for (const path of Object.values(HOST_MOUNTS)) resourcePath(root, `build/host/runtime/${path}`);
  for (const path of ['content', 'mods', 'node_modules', 'build/host/runtime']) resourcePath(root, path, 'directory');
  for (const path of ['prompts/keeper.md', 'prompts/setup.md', 'build/host/runtime/auth/pi-auth-helper.mjs']) resourcePath(root, path);
  return Object.freeze({ layout: 'compiled', backend: 'typescript', resourceRoot: resolve(root),
    node, git, gitExec, gitTemplates, entrypoints: Object.freeze({ ...entries, pi }) });
}

export function standaloneRuntime(resourcesPath) {
  const descriptor = JSON.parse(readFileSync(resourcePath(resourcesPath, 'pi-coc-runtime.json'), 'utf8'));
  if (descriptor?.schemaVersion !== 1 || descriptor.kind !== 'standalone' || 'repoRoot' in descriptor)
    throw new Error('Unsupported packaged COC runtime descriptor; a standalone runtime is required');
  return readDeployment(resourcePath(resourcesPath, descriptor.runtimeRoot, 'directory'));
}

export function compiledEnvironment(deployment, env = {}) {
  const root = deployment.resourceRoot;
  const captured = { ...env,
    PI_COC_RESOURCE_ROOT: root, PI_COC_LAYOUT: 'compiled', PI_COC_RUNTIME: 'typescript',
    PI_COC_CONTENT_ROOT: join(root, 'content'), PI_COC_NODE_EXECUTABLE: deployment.node,
    PI_COC_GIT: deployment.git, GIT_EXEC_PATH: deployment.gitExec, GIT_TEMPLATE_DIR: deployment.gitTemplates,
    PI_OFFLINE: '1', SHELL: '/bin/bash', PATH: [dirname(deployment.node), dirname(deployment.git), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
  };
  // A bundled Node process must not inherit an Electron loader or developer module search path.
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'PYTHONPATH', 'PYTHONHOME', 'VIRTUAL_ENV']) delete captured[key];
  return captured;
}
