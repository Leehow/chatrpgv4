/** Deployment locations shared by Node launchers and the Electron host. No TS loader is needed. */
import { accessSync, constants, existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
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
  imageGen: 'build/extensions/image-gen/agent/index.mjs',
  grokBuild: 'build/extensions/grok-build-oauth/agent/index.mjs',
  rerank: 'build/extensions/rerank/agent/index.mjs',
  jev: 'build/extensions/jev/agent/index.mjs',
  characterGuidance: 'build/extensions/module/character-guidance.mjs',
  characterPresentation: 'build/extensions/module/character-presentation.mjs',
  documentPresentation: 'build/extensions/mods/document-presentation.mjs',
  auditSubmit: 'build/extensions/mods/audit-submit.mjs',
  adaptationSubmit: 'build/extensions/kernel/adaptation-submit.mjs',
  uiPresentation: 'build/extensions/module/ui-presentation.mjs',
  mapPresentation: 'build/extensions/module/map-presentation.mjs',
});
/**
 * The one Pi the product loads (ADR-0006): `vendor/pi` compiled by `scripts/build-pi.mjs` into
 * `build/node_modules`, the first `node_modules` every emitted entry under `build/` resolves through.
 * The Keeper launch, every reader/Mod child and pi-backend's in-process loader take these paths, in
 * source and compiled layouts alike; the installed `@earendil-works/pi-coding-agent` is never started.
 */
export const PI_PACKAGE_ROOT = 'build/node_modules/@earendil-works/pi-coding-agent';
export const PI_ENTRIES = Object.freeze({ pi: `${PI_PACKAGE_ROOT}/dist/cli.js`, piModule: `${PI_PACKAGE_ROOT}/dist/index.js` });
export const COC_EXTENSIONS = Object.freeze(['kernel', 'mods', 'onboarding', 'module', 'memory', 'npc', 'table', 'npc-journal', 'npc-voice']);
/**
 * The extensions that register a model provider, read from the manifests that already declare it.
 *
 * A model the table can be switched to must be a model every lane child can run, so one list feeds
 * both mounts: the session launcher and the zero-extension lane command. It is discovered, not
 * written down, because a written-down list is the defect: the session mount and the lane mount
 * were maintained separately, a provider an extension registered existed only in the session, and
 * the first card drawn on such a model died in the child with "Model not found" before it emitted
 * one event. `pipiui-extension.json` already states `auth.provider.id` and `agent.extension`, so a
 * new provider extension is mounted everywhere by existing in the tree.
 *
 * Membership is registration, not tools: these mount into lanes because a provider is how a model
 * runs at all. An extension that only registers tools has no `auth.provider` and stays a session
 * mount, and `--tools` remains the lane's allowlist over everything a mounted extension offers.
 */
const extensionManifestCache = new Map();
function agentExtensionsIn(root) {
  const cached = extensionManifestCache.get(root);
  if (cached) return cached;
  const base = join(root, 'extensions');
  let names = [];
  try { names = readdirSync(base, {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => entry.name).sort(); }
  catch { /* a tree without an extensions directory contributes nothing */ }
  const found = [];
  for (const name of names) {
    let manifest;
    try { manifest = JSON.parse(readFileSync(join(base, name, 'pipiui-extension.json'), 'utf8')); }
    catch { continue; /* not every extension directory carries a manifest */ }
    const agent = manifest?.agent?.extension;
    if (typeof agent !== 'string' || !agent.endsWith('.js')) continue;
    if (agent.includes('..') || agent.startsWith('/')) throw new Error(`Invalid agent extension path in ${name}: ${agent}`);
    const provider = manifest?.auth?.provider?.id;
    found.push(Object.freeze({ name,
      providers: Object.freeze(typeof provider === 'string' && provider.trim() ? [provider] : []),
      source: `extensions/${name}/${agent}`,
      built: `build/extensions/${name}/${agent.slice(0, -3)}.mjs`,
      entry: join(root, 'build/extensions', name, agent.slice(0, -3) + '.mjs') }));
  }
  const frozen = Object.freeze(found);
  extensionManifestCache.set(root, frozen);
  return frozen;
}
/** Every extension under `root` that contributes an agent extension, in directory order. */
export function agentExtensionManifests(root) { return agentExtensionsIn(root); }
/** Those of them that register a model provider, with the ids each one declares. */
export function providerExtensionManifests(root) { return agentExtensionsIn(root).filter(entry => entry.providers.length); }
export const HOST_MOUNTS = Object.freeze({
  'secret-vault': 'kernel/pipiui-secret-vault.mjs',
  'context-fold': 'pi-ext/packages/context-fold/index.mjs',
  'update-center': 'kernel/pipiui-update-center.mjs',
  'runtime-info': 'kernel/pipiui-runtime-info.mjs',
  'ext-invoke': 'kernel/pipiui-ext-invoke.mjs',
  'prompt-observer': 'kernel/pipiui-prompt-observer.mjs',
});

const sessionExtensionGroups = entrypoints => [entrypoints.extensions, entrypoints.providerExtensions, [entrypoints.imageGen], [entrypoints.rerank], [entrypoints.jev]];
export function sessionExtensionPaths(entrypoints) { return Object.freeze(sessionExtensionGroups(entrypoints).flat()); }
export function desktopSessionExtensionPaths(entrypoints) {
  // Everything after the first two groups is a single-entrypoint capability mount (image
  // generation, rerank). Spreading the remainder rather than naming today's entries is the
  // point: a group added to `sessionExtensionGroups` used to be mounted by the lane command
  // and silently dropped here, which is a mount that exists everywhere except the Keeper.
  const [extensions, providers, ...capabilityMounts] = sessionExtensionGroups(entrypoints);
  return Object.freeze([join(entrypoints.hostAssets, HOST_MOUNTS['ext-invoke']), ...extensions, entrypoints.agent, ...providers, ...capabilityMounts.flat()]);
}
export function readerProviderExtensionPaths(entrypoints) {
  const [, providers] = sessionExtensionGroups(entrypoints);
  return Object.freeze([...providers]);
}
export function extensionArgs(paths) { return paths.flatMap(path => ['-e', path]); }

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
    providerExtensions: Object.freeze(providerExtensionManifests(root).map(({entry}) => entry)),
    providerExtensionIds: Object.freeze(providerExtensionManifests(root).flatMap(({providers}) => providers)),
    hostAssets: join(root, 'build/host/runtime'),
    pi: join(root, PI_ENTRIES.pi),
    piModule: join(root, PI_ENTRIES.piModule),
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
  if (manifest.pi !== PI_ENTRIES.pi) throw new Error(`The standalone runtime must start the vendored Pi (${PI_ENTRIES.pi}), not ${manifest.pi}`);
  const piModule = resourcePath(root, PI_ENTRIES.piModule);
  const entries = runtimeEntrypoints(root, 'compiled');
  for (const path of [...Object.values(COMPILED_ENTRIES), ...COC_EXTENSIONS.map(name => `build/extensions/${name}/index.mjs`)]) resourcePath(root, path);
  // A manifest that declares an agent extension must have shipped its emitted code. Discovery is
  // silent by nature -- an extension directory that failed to travel simply stops being mounted --
  // and a provider that stops being mounted is exactly the failure this list exists to prevent.
  for (const extension of agentExtensionManifests(root)) resourcePath(root, extension.built);
  for (const path of Object.values(HOST_MOUNTS)) resourcePath(root, `build/host/runtime/${path}`);
  for (const path of ['content', 'mods', 'node_modules', 'build/host/runtime']) resourcePath(root, path, 'directory');
  for (const path of ['prompts/keeper.md', 'prompts/setup.md', 'build/host/runtime/auth/pi-auth-helper.mjs']) resourcePath(root, path);
  return Object.freeze({ layout: 'compiled', backend: 'typescript', resourceRoot: resolve(root),
    node, git, gitExec, gitTemplates, entrypoints: Object.freeze({ ...entries, pi, piModule }) });
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
