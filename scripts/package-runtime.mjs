/** Assemble immutable standalone resources; installation/downloads happen only at build time. */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, chmod, copyFile, lstat, mkdir, readFile, readdir, readlink, realpath, rename, stat, symlink, writeFile } from 'node:fs/promises';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { agentExtensionManifests } from '../runtime/deployment.mjs';
import { assemblySignals, assemblyStagingRoots, createAssemblyWorkspace } from './assembly-workspace.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = 'pipicoc/runtime-dependencies.json';
const forbidden = new Set(['.git', '.coc', '.pi', '.codex', '.agents', '__pycache__', '.npmrc']);
const within = (root, path) => path === root || path.startsWith(root + sep);
const exists = path => access(path).then(() => true, () => false);
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const dump = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const portable = path => path.split(sep).join('/');

async function hashFile(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
function safeRelative(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') || path.split('/').some(part => part === '..' || part === '')) throw new Error(`Invalid resource-relative path: ${path}`);
  return path;
}
function copiedAsset(path) {
  const parts = path.split('/');
  return !parts.some(part => forbidden.has(part) || /^\.env(?:\.|$)/i.test(part) || ['test', 'tests', '__tests__'].includes(part))
    && !/\.(?:ts|tsx|py|pyc|map|pem|key)$/i.test(path);
}
async function filesIn(root) {
  const files = [];
  async function walk(path) {
    for (const name of (await readdir(path)).sort()) {
      const full = join(path, name), info = await lstat(full);
      if (info.isDirectory()) await walk(full); else files.push(full);
    }
  }
  await walk(root);
  return files;
}
async function copyTree(source, destination, filter = () => true) {
  const sourceRoot = await realpath(source);
  await mkdir(destination, { recursive: true });
  for (const file of await filesIn(source)) {
    const path = portable(relative(source, file));
    if (!filter(path)) continue;
    const target = join(destination, path), info = await lstat(file);
    await mkdir(dirname(target), { recursive: true });
    if (info.isSymbolicLink()) {
      const resolved = await realpath(file);
      if (!within(sourceRoot, resolved)) throw new Error(`Source symlink escapes its resource tree: ${path}`);
      const link = await readlink(file);
      if (isAbsolute(link)) throw new Error(`Absolute resource symlink is not relocatable: ${path}`);
      await symlink(link, target);
    } else if (info.isFile()) {
      await copyFile(file, target);
      await chmod(target, info.mode & 0o777);
    } else throw new Error(`Unsupported resource file type: ${path}`);
  }
}
async function requiredFile(path, name = path) {
  if (!await exists(path) || !(await stat(path)).isFile()) throw new Error(`Missing required runtime file: ${name}`);
}
const run = (command, args, { workspace, ...options }) => workspace.run(command, args, options);
async function archiveFor(spec, cache, override, nearby = [], workspace) {
  workspace?.assertActive();
  const name = spec.name || basename(new URL(spec.url).pathname), cached = join(cache, name);
  const candidates = [override, cached, ...nearby.map(directory => join(directory, name))].filter(Boolean);
  for (const path of candidates) if (await exists(path)) {
    const actual = await hashFile(path);
    if (actual !== spec.sha256) throw new Error(`Archive checksum mismatch: ${basename(path)}`);
    return resolve(path);
  }
  if (override) throw new Error(`Supplied archive is missing: ${override}`);
  const timeoutSignal = AbortSignal.timeout(180_000);
  const signal = workspace?.signal ? AbortSignal.any([workspace.signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(spec.url, { signal });
  if (!response.ok || !response.body) throw new Error(`Archive download failed: ${response.status} ${new URL(spec.url).host}`);
  const partial = cached + '.partial-' + process.pid;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  if (await hashFile(partial) !== spec.sha256) throw new Error(`Downloaded archive checksum mismatch: ${name}`);
  await rename(partial, cached);
  return cached;
}
async function extract(archive, destination, strip = 0, workspace) {
  workspace?.assertActive();
  const listing = await run('/usr/bin/tar', ['-tzf', archive], { workspace });
  for (const path of listing.stdout.split('\n').filter(Boolean)) if (path.startsWith('/') || path.split('/').includes('..')) throw new Error('Archive contains an escaping file path');
  await mkdir(destination, { recursive: true });
  await run('/usr/bin/tar', ['-xzf', archive, '-C', destination, ...(strip ? [`--strip-components=${strip}`] : [])], { workspace });
  const root = await realpath(destination);
  for (const path of await filesIn(destination)) if ((await lstat(path)).isSymbolicLink() && !within(root, await realpath(path))) throw new Error(`Archive symlink escapes extraction: ${relative(destination, path)}`);
}
async function copyGit(manifest, archive, resource, work, cache, workspace) {
  const unpacked = join(work, 'git-unpacked'), gitRoot = join(resource, 'git');
  await extract(archive, unpacked, 0, workspace);
  for (const entry of manifest.git.executables) {
    const source = join(unpacked, safeRelative(entry.path)), target = join(gitRoot, entry.path);
    if (await hashFile(source) !== entry.sha256) throw new Error(`Git executable hash differs from its pinned profile: ${entry.path}`);
    await mkdir(dirname(target), { recursive: true }); await copyFile(source, target); await chmod(target, 0o755);
  }
  for (const entry of manifest.git.symlinks) {
    if (await readlink(join(unpacked, safeRelative(entry.path))) !== entry.target) throw new Error(`Unexpected Git helper link: ${entry.path}`);
    const target = join(gitRoot, entry.path); await mkdir(dirname(target), { recursive: true }); await symlink(entry.target, target);
  }
  await copyTree(join(unpacked, manifest.git.templates), join(gitRoot, manifest.git.templates));
  const licenses = join(resource, 'licenses', 'git'), sources = join(licenses, 'source');
  await mkdir(sources, { recursive: true });
  const provenance = [];
  for (const source of manifest.git.sources) {
    const path = await archiveFor(source, cache, undefined, [dirname(archive)], workspace);
    await copyFile(path, join(sources, source.name));
    const license = await run('/usr/bin/tar', ['-xOzf', path, safeRelative(source.licensePath)], { workspace });
    await writeFile(join(licenses, source.licenseName), license.stdout);
    provenance.push({ name: source.name, url: source.url, sha256: source.sha256, license: source.licenseName });
  }
  await dump(join(licenses, 'SOURCES.json'), { binary: { url: manifest.git.url, sha256: manifest.git.sha256 }, sources: provenance,
    arrangement: 'The Git archive supplies the git/ submodule of the dugite-native build-source archive.', license: 'GPL-2.0; preserve upstream file-level notices and corresponding source.' });
}
async function copyResources(repo, resource, manifest) {
  const content = join(repo, 'content');
  // The play language is open (contract §23): the authored captions are one source language and
  // every other `content/ui/<tag>/` directory is a shipped seed of the same shape. The package checks
  // the source's surfaces exist and that each seed carries every one of them; it keeps no list of tags.
  const languages = JSON.parse(await readFile(join(content, 'languages.json'), 'utf8'));
  const source = typeof languages.source === 'string' && languages.source ? languages.source : languages.default;
  const surfaces = (await readdir(join(content, 'ui', source))).filter(name => name.endsWith('.json'));
  if (!surfaces.length) throw new Error('The authored play language has no packaged UI surfaces');
  const seeds = (await readdir(join(content, 'ui'), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
  for (const tag of seeds) {
    for (const surface of surfaces) await requiredFile(join(content, 'ui', tag, surface));
  }
  // An extension directory travels because it is in the tree and declares an agent extension; its
  // manifest is what the runtime reads to mount it, so a new one must not depend on being listed.
  const extensionDirectories = agentExtensionManifests(repo).map(entry => `extensions/${entry.name}`);
  for (const directory of new Set([...manifest.resourceDirectories, ...extensionDirectories])) await copyTree(join(repo, directory), join(resource, directory), copiedAsset);
  for (const file of manifest.resourceFiles ?? []) {
    await requiredFile(join(repo, safeRelative(file)));
    await mkdir(dirname(join(resource, file)), { recursive: true });
    await copyFile(join(repo, file), join(resource, file));
  }
  for (const directory of manifest.buildDirectories) await copyTree(join(repo, 'build', directory), join(resource, 'build', directory), copiedAsset);
  for (const file of manifest.uiFiles) {
    const source = join(repo, 'pipicoc', file);
    await requiredFile(source);
    for (const directory of ['pipicoc', 'build/pipicoc']) { await mkdir(join(resource, directory), { recursive: true }); await copyFile(source, join(resource, directory, file)); }
  }
  for (const directory of ['pipicoc/assets', 'build/pipicoc/assets']) await copyTree(join(repo, 'pipicoc/assets'), join(resource, directory), copiedAsset);
  for (const file of manifest.hostAssets) {
    await requiredFile(join(repo, file));
    for (const target of [file, file.replace(/^Electron\/resources\/runtime\//, 'build/host/runtime/')]) {
      await mkdir(dirname(join(resource, target)), { recursive: true });
      await copyFile(join(repo, file), join(resource, target));
    }
  }
}
function installEnvironment(nodeRoot, work, python) {
  const nodeBin = join(nodeRoot, 'bin');
  return { PATH: [nodeBin, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter), HOME: join(work, 'home'), TMPDIR: join(work, 'tmp'),
    LC_ALL: 'C', LANG: 'C', CI: '1', PI_OFFLINE: '1', npm_config_cache: join(work, 'npm-cache'), npm_config_userconfig: join(work, 'npmrc'), npm_config_globalconfig: join(work, 'global-npmrc'),
    npm_config_nodedir: nodeRoot, npm_config_target: '24.19.0', npm_config_runtime: 'node', npm_config_arch: 'arm64', npm_config_platform: 'darwin',
    npm_config_python: python, PYTHON: python, NODE_GYP_FORCE_PYTHON: python, npm_config_audit: 'false', npm_config_fund: 'false',
    npm_config_update_notifier: 'false', npm_config_progress: 'false' };
}
async function productionInstall(repo, resource, manifest, nodeRoot, work, packageBytes, lockBytes, workspace) {
  const install = join(work, 'dependencies'); await mkdir(install, { recursive: true });
  await writeFile(join(install, 'package.json'), packageBytes); await writeFile(join(install, 'package-lock.json'), lockBytes);
  const pythonResult = await run('uv', ['run', '--frozen', 'python', '-c', 'import sys; print(sys.executable)'], { cwd: repo, env: process.env, log: join(work, 'python-build-tool.log'), workspace });
  const python = pythonResult.stdout.trim(); if (!isAbsolute(python)) throw new Error('The locked project Python did not return an absolute executable');
  const environment = installEnvironment(nodeRoot, work, python);
  for (const path of [environment.HOME, environment.TMPDIR, environment.npm_config_cache]) await mkdir(path, { recursive: true });
  await writeFile(environment.npm_config_userconfig, ''); await writeFile(environment.npm_config_globalconfig, '');
  const node = join(nodeRoot, 'bin/node'), npm = join(nodeRoot, 'lib/node_modules/npm/bin/npm-cli.js');
  await requiredFile(npm, 'managed Node npm CLI'); await requiredFile(join(nodeRoot, 'include/node/node.h'), 'managed Node headers');
  await run(node, [npm, 'ci', '--omit=dev', '--include=optional', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: install, env: environment, log: join(work, 'npm-ci.log'), workspace });
  if (await hashFile(join(install, 'package-lock.json')) !== createHash('sha256').update(lockBytes).digest('hex')) throw new Error('Production installation changed the locked dependency graph');
  for (const [name, version] of Object.entries(manifest.production)) {
    const installed = await json(join(install, 'node_modules', name, 'package.json'));
    if (installed.version !== version) throw new Error(`Installed ${name} differs from its runtime pin`);
  }
  // Compile only the addon that needs a Node ABI build; no global script policy is changed.
  const nodeGyp = join(nodeRoot, 'lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js');
  await requiredFile(nodeGyp, 'managed Node node-gyp CLI');
  await run(node, [nodeGyp, 'rebuild', '--nodedir=' + nodeRoot, '--python=' + python], {
    cwd: join(install, 'node_modules/fs-ext'), env: environment, log: join(work, 'fs-ext-build.log'), workspace,
  });
  await requiredFile(join(install, 'node_modules/fs-ext/build/Release/fs_ext.node'), 'managed Node fs-ext addon');
  await copyTree(join(install, 'node_modules'), join(resource, 'node_modules'), path => {
    if (path.startsWith('fs-ext/build/')) return path === 'fs-ext/build/Release/fs_ext.node';
    return !path.split('/').some(part => forbidden.has(part) || /^\.env(?:\.|$)/i.test(part));
  });
  return { install, node, environment };
}
async function smoke(resource, node, manifest, environment, work, workspace) {
  const source = `import {createRequire} from 'node:module';\nimport {openSync,closeSync} from 'node:fs';\nconst require=createRequire(process.argv[2]+'/package.json');\nif(process.version!=='v${manifest.node.version}'||process.versions.modules!==${JSON.stringify(manifest.node.abi)}||process.arch!=='arm64')throw new Error('Managed Node identity mismatch');\nconst fsExt=require('fs-ext');const fd=openSync(process.argv[3],'w');try{fsExt.flockSync(fd,'exnb');fsExt.flockSync(fd,'un');}finally{closeSync(fd);}\nconst canvas=require('@napi-rs/canvas');const png=canvas.createCanvas(1,1).toBuffer('image/png');if(png.length<8)throw new Error('Canvas native module failed');\nawait import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));\nconsole.log(JSON.stringify({version:process.version,abi:process.versions.modules,architecture:process.arch,fsExt:true,canvas:true,pdfjs:true}));\n`;
  const script = join(work, 'native-smoke.mjs'); await writeFile(script, source);
  const native = await run(node, [script, resource, join(work, 'native-smoke.lock')], { cwd: work, env: { ...environment, PI_CODING_AGENT_DIR: join(work, 'smoke-agent') }, log: join(work, 'native-smoke.log'), workspace });
  const emptyPath = join(work, 'empty-path'); await mkdir(emptyPath, { recursive: true });
  const git = await run(join(resource, manifest.deployment.git), ['--version'], { cwd: work, env: { PATH: emptyPath, HOME: environment.HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_EXEC_PATH: join(resource, manifest.deployment.gitExec), GIT_TEMPLATE_DIR: join(resource, manifest.deployment.gitTemplates) }, log: join(work, 'git-smoke.log'), workspace });
  if (git.stdout.trim() !== `git version ${manifest.git.version}`) throw new Error('Managed Git version differs from the runtime pin');
  return { native: JSON.parse(native.stdout.trim().split('\n').at(-1)), git: git.stdout.trim() };
}
async function inventory(resource, lock, workspace) {
  const files = [], native = [], packages = [];
  for (const path of await filesIn(resource)) {
    const name = portable(relative(resource, path)), info = await lstat(path);
    if (info.isSymbolicLink()) {
      if (!within(resource, await realpath(path))) throw new Error(`Output symlink escapes resources: ${name}`);
      files.push({ path: name, link: await readlink(path) }); continue;
    }
    files.push({ path: name, bytes: info.size, sha256: await hashFile(path), mode: (info.mode & 0o777).toString(8) });
    if (name.endsWith('.node') || ['node/bin/node', 'git/bin/git', 'git/libexec/git-core/git'].includes(name)) {
      const result = await run('/usr/bin/file', ['-b', path], { workspace });
      native.push({ path: name, format: result.stdout.trim().split(path).join(name) });
    }
    const locked = name.endsWith('/package.json') ? lock.packages[name.slice(0, -'/package.json'.length)] : null;
    if (name.startsWith('node_modules/') && locked) {
      const value = await json(path);
      if (value.version !== locked.version) throw new Error(`Installed package differs from its lock entry: ${name}`);
      packages.push({ name: value.name, version: value.version, path: name, license: value.license ?? value.licenses ?? null,
        integrity: locked.integrity ?? null, resolved: locked.resolved ?? null });
    }
  }
  return { files, native, packages };
}

export async function assembleRuntime(options = {}) {
  const cancellation = assemblySignals(options.signal);
  try { return await assemble({ ...options, signal: cancellation.signal }); }
  finally { cancellation.dispose(); }
}

async function assemble({ repo = ROOT, output, nodeArchive, gitArchive, signal }) {
  signal.throwIfAborted();
  repo = await realpath(resolve(repo));
  if (typeof output !== 'string' || !output) throw new Error('assembleRuntime requires an output staging path');
  output = resolve(repo, output);
  const stagingRoots = assemblyStagingRoots(repo);
  if (!stagingRoots.some(root => within(root, output)) || stagingRoots.includes(output)) throw new Error('Runtime assembly output must be a dedicated build staging directory');
  if (await exists(output)) throw new Error(`Runtime output already exists; choose a fresh staging path: ${output}`);
  const manifest = await json(join(repo, MANIFEST));
  if (manifest.schemaVersion !== 1 || process.platform !== manifest.platform || process.arch !== manifest.architecture) throw new Error('This runtime assembler requires macOS arm64');
  const packageBytes = await readFile(join(repo, 'package.json')), lockBytes = await readFile(join(repo, 'package-lock.json'));
  const sourcePackage = JSON.parse(packageBytes), lock = JSON.parse(lockBytes);
  for (const [name, version] of Object.entries(manifest.production)) {
    if (sourcePackage.dependencies?.[name] !== version || lock.packages?.[`node_modules/${name}`]?.version !== version) throw new Error(`Runtime dependency ${name}@${version} must be pinned in production package.json and package-lock.json`);
  }
  const missing = [];
  for (const path of manifest.requiredEntries) if (!await exists(join(repo, safeRelative(path)))) missing.push(path);
  for (const path of [...manifest.resourceDirectories, ...(manifest.resourceFiles ?? []), ...manifest.hostAssets]) if (!await exists(join(repo, safeRelative(path)))) missing.push(path);
  if (missing.length) throw new Error(`Compiled runtime is incomplete:\n${missing.map(path => '  ' + path).join('\n')}`);
  await mkdir(dirname(output), { recursive: true });
  const parent = await realpath(dirname(output));
  if (!stagingRoots.some(root => within(root, parent))) throw new Error('Runtime staging parent resolves outside the allowed staging roots');
  const workspace = await createAssemblyWorkspace({ repo, output, signal });
  const { work, resource, cache } = workspace;
  let outputPublished = false;
  try {
    workspace.assertActive();
    const nodePath = await archiveFor(manifest.node, cache, nodeArchive ? resolve(repo, nodeArchive) : undefined, [], workspace);
    const gitPath = await archiveFor(manifest.git, cache, gitArchive ? resolve(repo, gitArchive) : undefined, [], workspace);
    const nodeRoot = join(work, 'node-toolchain'); await extract(nodePath, nodeRoot, 1, workspace);
    const identity = await run(join(nodeRoot, 'bin/node'), ['-p', 'JSON.stringify({version:process.version,abi:process.versions.modules,arch:process.arch})'], { env: { PATH: '/usr/bin:/bin' }, workspace });
    const parsed = JSON.parse(identity.stdout);
    if (parsed.version !== `v${manifest.node.version}` || parsed.abi !== manifest.node.abi || parsed.arch !== manifest.architecture) throw new Error('Downloaded Node does not match the runtime identity');
    await mkdir(join(resource, 'node/bin'), { recursive: true }); await copyFile(join(nodeRoot, 'bin/node'), join(resource, 'node/bin/node')); await chmod(join(resource, 'node/bin/node'), 0o755);
    await mkdir(join(resource, 'licenses/node'), { recursive: true }); await copyFile(join(nodeRoot, 'LICENSE'), join(resource, 'licenses/node/LICENSE'));
    await copyGit(manifest, gitPath, resource, work, cache, workspace);
    await copyResources(repo, resource, manifest);
    const installed = await productionInstall(repo, resource, manifest, nodeRoot, work, packageBytes, lockBytes, workspace);
    const extensions = manifest.requiredEntries.filter(path => /^build\/extensions\/(?:kernel|mods|onboarding|module|memory|table)\/index\.mjs$/.test(path));
    await dump(join(resource, 'package.json'), { name: sourcePackage.name, version: sourcePackage.version, private: true, type: 'module', dependencies: sourcePackage.dependencies, pi: { extensions: extensions.map(path => './' + path) } });
    await dump(join(resource, 'deployment.json'), manifest.deployment);
    await mkdir(join(resource, 'provenance'), { recursive: true }); await writeFile(join(resource, 'provenance/package-lock.json'), lockBytes); await copyFile(join(repo, MANIFEST), join(resource, 'provenance/runtime-dependencies.json'));
    for (const path of [...manifest.requiredEntries, manifest.deployment.pi, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs', 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', 'node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm']) await requiredFile(join(resource, safeRelative(path)));
    for (const directory of ['node_modules/pdfjs-dist/cmaps', 'node_modules/pdfjs-dist/standard_fonts', 'node_modules/pdfjs-dist/wasm']) if (!await exists(join(resource, directory))) throw new Error(`PDF resource directory is missing: ${directory}`);
    const checks = await smoke(resource, join(resource, 'node/bin/node'), manifest, installed.environment, work, workspace);
    const listing = await inventory(resource, lock, workspace);
    if (await hashFile(join(repo, 'package.json')) !== createHash('sha256').update(packageBytes).digest('hex') || await hashFile(join(repo, 'package-lock.json')) !== createHash('sha256').update(lockBytes).digest('hex')) throw new Error('Source dependency manifests changed during assembly');
    workspace.assertActive();
    const receipt = { schemaVersion: 1, layout: 'compiled', platform: manifest.platform, architecture: manifest.architecture, assembledAt: new Date().toISOString(),
      node: manifest.node, git: { version: manifest.git.version, url: manifest.git.url, sha256: manifest.git.sha256 },
      sourcePackageSha256: createHash('sha256').update(packageBytes).digest('hex'), sourceLockSha256: createHash('sha256').update(lockBytes).digest('hex'),
      checks, immutableResources: true, nativeTarget: { runtime: 'node', version: manifest.node.version, abi: manifest.node.abi }, ...listing };
    await dump(join(resource, 'assembly.json'), receipt);
    await dump(join(work, 'result.json'), { output, files: listing.files.length, native: listing.native, checks });
    workspace.assertActive();
    await workspace.publish();
    outputPublished = true;
    return { output, deployment: manifest.deployment, receipt: join(output, 'assembly.json'), evidence: workspace.evidence };
  } catch (error) {
    await dump(join(work, 'failure.json'), { message: error.message, output, diagnostics: workspace.evidence }).catch(() => {});
    throw new Error(`${error.message}\nAssembly evidence retained at ${workspace.evidence}`, { cause: error });
  } finally {
    await workspace.cleanup({ preserveOutput: outputPublished });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = { '--repo': 'repo', '--output': 'output', '--node-archive': 'nodeArchive', '--git-archive': 'gitArchive' }[process.argv[index]];
    if (!key || !process.argv[index + 1]) throw new Error('Usage: package-runtime.mjs --output <staging-directory> [--repo <path>] [--node-archive <tar.gz>] [--git-archive <tar.gz>]');
    options[key] = process.argv[index + 1];
  }
  assembleRuntime(options)
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
