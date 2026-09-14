import { afterEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createPackageRecipe } from '../../../pipicoc/package-config.mjs'
import { convertDocumentFileToMarkdown } from '../../packages/pi-backend/src/anydoc-convert'
import workspacePackage from '../../package.json'
import packageJSON from './package.json'

const repo = resolve(import.meta.dirname, '../../..')
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const product = readJson(join(repo, 'pipicoc/product.json'))
const rootPackage = readJson(join(repo, 'package.json'))
const runtimeDependencies = readJson(join(repo, 'pipicoc/runtime-dependencies.json'))
const recipe = createPackageRecipe({ repo, stage: join(repo, '.build.noindex/recipe-test'), product, version: rootPackage.version, userHome: '/recipe-user' })
const fixtures: string[] = []
afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true })
})

/** Run the real entry and recipe against tiny resources, never a real builder or signer. */
function runPackager(mode = 'success') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pipicoc-package-contract-')))
  fixtures.push(root)
  for (const path of ['pipicoc/package.mjs', 'pipicoc/package-config.mjs', 'pipicoc/product.json', 'scripts/assembly-workspace.mjs']) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    copyFileSync(join(repo, path), join(root, path))
  }
  // Deliberately differs from every product/extension/workspace version.
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', version: '9.8.7-beta.6' }))
  const home = join(root, 'package-home'), target = join(root, 'installed/PipiCOC.app')
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'prior-version'), 'preserve until verified')
  const log = join(root, 'operations.jsonl')
  writeFileSync(join(root, 'scripts/package-runtime.mjs'), `
import fs from 'node:fs';
import {join, dirname} from 'node:path';
import {createHash} from 'node:crypto';
export async function assembleRuntime({repo, output}) {
  const contents = {
    'node/bin/node': 'fixture Node', 'git/bin/git': 'fixture Git',
    'lib/addon.node': 'fixture addon', 'lib/not-macho.node': 'fixture ELF', 'data/plain.txt': 'fixture data',
  };
  for (const [path, content] of Object.entries(contents)) {
    fs.mkdirSync(dirname(join(output,path)), {recursive:true});
    fs.writeFileSync(join(output,path),content,{mode:0o444});
  }
  fs.symlinkSync('node',join(output,'node/bin/node-link'));
  const files = Object.entries(contents).map(([path, content]) => ({path,sha256:createHash('sha256').update(content).digest('hex')}));
  files.push({path:'node/bin/node-link',link:'node'});
  const assembly = {files,native:[
    {path:'node/bin/node',format:'Mach-O executable'}, {path:'git/bin/git',format:'Mach-O executable'},
    {path:'lib/addon.node',format:'Mach-O bundle'}, {path:'node/bin/node-link',format:'Mach-O executable'},
    {path:'lib/not-macho.node',format:'ELF'},
  ],node:{version:'24.19.0',abi:'137'},git:{version:'2.53.0'},sourcePackageSha256:'package-hash',sourceLockSha256:'lock-hash'};
  fs.writeFileSync(join(output,'assembly.json'),JSON.stringify(assembly),{mode:0o444});
  const evidence=join(repo,'.build.noindex/diagnostics/run');
  fs.mkdirSync(evidence,{recursive:true});
  fs.writeFileSync(join(evidence,'result.json'),JSON.stringify({status:'success'}));
  fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({kind:'assemble',output})+'\\n');
  return {output,evidence,receipt:assembly};
}
`)
  const preload = join(root, 'preload.mjs')
  writeFileSync(preload, `
import fs from 'node:fs';
import cp from 'node:child_process';
import {join,dirname} from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
const root=${JSON.stringify(root)}, target=${JSON.stringify(target)}, home=${JSON.stringify(home)}, mode=${JSON.stringify(mode)};
const log = event => fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(event)+'\\n');
const readJson = path => JSON.parse(fs.readFileSync(path,'utf8'));
for (const name of ['spawn','spawnSync','exec','execSync','execFile','fork']) cp[name] = () => {throw new Error('Unexpected subprocess: '+name);};
globalThis.fetch = () => {throw new Error('Network forbidden in packaging tests');};
cp.execFileSync = (command,args,options) => {
  log({kind:'command',command,args});
  if (command === '/bin/ps') {
    const path = mode === 'running-target' ? target : mode === 'running-link' ? join(home,'PipiCOC.app') : '/other/PipiCOC.app';
    return join(path,'Contents/MacOS/PipiCOC')+'\\n';
  }
  if (command === 'npm') return '';
  if (command === join(root,'Electron/node_modules/.bin/electron-builder')) {
    const config=readJson(args[args.indexOf('--config')+1]);
    log({kind:'builder',config,env:{CSC_IDENTITY_AUTO_DISCOVERY:options.env.CSC_IDENTITY_AUTO_DISCOVERY,CSC_NAME:options.env.CSC_NAME},
      product:readJson(config.extraResources[0].from),descriptor:readJson(config.extraResources[1].from)});
    if (mode === 'builder-failure') throw new Error('Injected builder failure');
    const app=join(config.directories.output,'mac-arm64',config.productName+'.app');
    fs.mkdirSync(join(app,'Contents/Resources'),{recursive:true});
    return '';
  }
  if (command === '/usr/bin/codesign') {
    const path=args.at(-1);
    if (args.includes('--verify')) {
      if (mode === 'verify-failure') throw new Error('Injected strict verification failure');
    } else if (!args.includes('--deep')) {
      // Real signing changes bytes; the receipt must hash the settled files, not their inputs.
      fs.chmodSync(path,0o644);
      fs.appendFileSync(path,' signed');
    }
    return '';
  }
  if (command === 'git' && args.join(' ') === 'rev-parse HEAD') return 'fixture-commit\\n';
  if (command.endsWith('/lsregister')) { log({kind:'register',link:fs.readlinkSync(join(home,'PipiCOC.app'))}); return ''; }
  throw new Error('Unexpected command: '+command);
};
const cpSync=fs.cpSync,renameSync=fs.renameSync;
fs.cpSync = (source,destination,options) => {
  log({kind:'copy-runtime',source,destination,options,readonly:(fs.statSync(join(source,'node/bin/node')).mode & 0o222) === 0});
  cpSync(source,destination,options);
  if (mode === 'tampered-file') {
    fs.chmodSync(join(destination,'data/plain.txt'),0o644);
    fs.writeFileSync(join(destination,'data/plain.txt'),'tampered');
  }
  if (mode === 'tampered-link') {
    fs.unlinkSync(join(destination,'node/bin/node-link'));
    fs.symlinkSync('../../git/bin/git',join(destination,'node/bin/node-link'));
  }
};
fs.renameSync = (from,to) => {
  log({kind:'rename',from,to});
  if (mode === 'install-failure' && to === target && from.includes('mac-arm64')) throw new Error('Injected install failure');
  return renameSync(from,to);
};
syncBuiltinESMExports();
`)
  const result = spawnSync(process.execPath, ['--import', preload, join(root, 'pipicoc/package.mjs')], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, NODE_OPTIONS: '', HOME: root, TMPDIR: root, PIPICOC_APP_HOME: home, PIPICOC_APP_BUNDLE: target, PIPICOC_SIGN_IDENTITY: 'Fixture Identity' },
  })
  const events = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  return { root, home, target, result, events }
}

// Both require("x") and createRequire(<nested expr>)("x") escape electron-vite.
// Keep the latter's resolution root: an explicitly installed extension is not the app asar.
const createRequireSpecifiers = (source: string): { base: string; specifier: string }[] => {
  const specifiers: { base: string; specifier: string }[] = []
  const opener = /\bcreateRequire\(/g
  for (let match = opener.exec(source); match; match = opener.exec(source)) {
    let depth = 1
    let i = match.index + match[0].length
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '(') depth++
      else if (source[i] === ')') depth--
    }
    if (depth !== 0) continue
    const call = /^\("([^"]+)"\)/.exec(source.slice(i))
    if (call) specifiers.push({ base: source.slice(match.index + match[0].length, i - 1), specifier: call[1] })
  }
  return specifiers
}

function bundledExternals() {
  const mainOut = resolve(import.meta.dirname, 'out/main')
  const builtins = new Set(builtinModules)
  const found = new Set<string>()
  const extensionRoots = new Map<string, { base: string; specifier: string }>()
  const files = readdirSync(mainOut).filter(file => file.endsWith('.js'))
  expect(files.length, 'compiled main output must exist; run the existing build before this suite').toBeGreaterThan(0)
  for (const file of files) {
    const source = readFileSync(resolve(mainOut, file), 'utf8')
    const specifiers = [...source.matchAll(/\brequire\("([^"]+)"\)/g)].map(match => match[1])
    for (const call of createRequireSpecifiers(source)) {
      if (/\b__filename\b|\bimport\.meta\.url\b/.test(call.base)) specifiers.push(call.specifier)
      else extensionRoots.set(JSON.stringify(call), call)
    }
    for (const specifier of specifiers) {
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
      if (builtins.has(specifier) || specifier === 'electron') continue
      found.add(specifier)
    }
  }
  return { app: found, extensionRoots: [...extensionRoots.values()] }
}

describe('standalone PipiCOC packaging contract', () => {
  it('defines WS_NO_BUFFER_UTIL and WS_NO_UTF_8_VALIDATE so bundled ws skips empty native stubs', () => {
    const viteConfig = readFileSync(resolve(import.meta.dirname, 'electron.vite.config.ts'), 'utf8')
    expect(viteConfig).toMatch(/'process\.env\.WS_NO_BUFFER_UTIL':\s*JSON\.stringify\('1'\)/)
    expect(viteConfig).toMatch(/'process\.env\.WS_NO_UTF_8_VALIDATE':\s*JSON\.stringify\('1'\)/)
  })

  it('uses the canonical identity and root version without the inherited PipiUI builder resources', () => {
    expect(recipe.config).toMatchObject({ appId: product.appId, productName: product.name, extraMetadata: { version: rootPackage.version } })
    expect(recipe.config.mac.extendInfo).toEqual({ CFBundleDisplayName: product.name, CFBundleName: product.name })
    expect(recipe.config.extraResources.map((entry: { to: string }) => entry.to)).toEqual(['product.json', 'pi-coc-runtime.json', product.icon, 'browser-ui'])
    expect(recipe.config.mac.target).toEqual(['dir'])
    expect(recipe.target).toBe('/Applications/PipiCOC.app')
    expect(recipe.link).toBe(join(recipe.home, 'PipiCOC.app'))
  })

  it('keeps only the node_modules the compiled main bundle actually requires, after the blanket exclusion', () => {
    const files: string[] = recipe.config.files
    expect(files).toContain('!node_modules/**/*')
    const reincluded = files.filter(pattern => pattern.startsWith('node_modules/'))
      .map(pattern => pattern.replace(/^node_modules\//, '').replace(/\/\*\*\/\*$/, ''))
    for (const name of reincluded) expect(files.indexOf('!node_modules/**/*')).toBeLessThan(files.indexOf(`node_modules/${name}/**/*`))
    const externals = bundledExternals()
    expect([...externals.app].sort()).toEqual(reincluded.sort())
    // Do not silently ignore a new non-app resolver. Each explicit root needs an owner check.
    expect(externals.extensionRoots).toEqual([{ base: 'nativeManifest', specifier: '@firecrawl/anydoc' }])
    expect(reincluded).not.toContain('@firecrawl/anydoc')
  })

  it('detects nested createRequire externals without treating unrelated calls as dependencies', () => {
    expect(createRequireSpecifiers('createRequire(require("url").pathToFileURL(__filename).href)("node-pty"); createRequire(nativeManifest)("@firecrawl/anydoc"); createRequire(x); other("not-external")')).toEqual([
      { base: 'require("url").pathToFileURL(__filename).href', specifier: 'node-pty' },
      { base: 'nativeManifest', specifier: '@firecrawl/anydoc' },
    ])
  })

  it('resolves the optional document engine from its explicit extension root, not shipped app dependencies', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'pipicoc-extension-engine-')))
    fixtures.push(root)
    const engine = join(root, 'node_modules/@firecrawl/anydoc')
    mkdirSync(engine, { recursive: true })
    writeFileSync(join(engine, 'package.json'), JSON.stringify({ name: '@firecrawl/anydoc', main: 'index.cjs' }))
    writeFileSync(join(engine, 'index.cjs'), 'exports.toMarkdownBytes = bytes => "extension-engine:" + bytes.toString();')
    const input = join(root, 'input.doc')
    writeFileSync(input, 'fixture-document')
    expect(await convertDocumentFileToMarkdown(input, { anydocRoot: join(root, 'absent') })).toBeUndefined()
    expect(await convertDocumentFileToMarkdown(input, { anydocRoot: root })).toBe('extension-engine:fixture-document')
  })

  it('retains build/dev tooling without exposing the obsolete product packager in npm scripts', () => {
    expect(workspacePackage.scripts.build).toContain('npm run build -w @pipiui/electron')
    expect(workspacePackage.scripts.dev).toBe('npm run dev -w @pipiui/electron')
    expect(packageJSON.scripts.build).toContain('electron-vite build')
    expect(packageJSON.scripts.dev).toBe('electron-vite dev')
    for (const manifest of [rootPackage, workspacePackage, packageJSON]) {
      for (const command of Object.values(manifest.scripts)) expect(command).not.toContain('package-product.mjs')
    }
  })

  it('pins the current standalone Node/Git archives and compiled deployment, not an inherited Hermes runtime', () => {
    expect(runtimeDependencies).toMatchObject({ platform: 'darwin', architecture: 'arm64', node: { version: '24.19.0', abi: '137' } })
    expect(runtimeDependencies.node.url).toBe('https://nodejs.org/dist/v24.19.0/node-v24.19.0-darwin-arm64.tar.gz')
    for (const asset of [runtimeDependencies.node, runtimeDependencies.git, ...runtimeDependencies.git.sources]) {
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(asset.url).toMatch(/^https:\/\//)
    }
    expect(runtimeDependencies.deployment).toMatchObject({ layout: 'compiled', backend: 'typescript', node: 'node/bin/node', git: 'git/bin/git', pi: 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js' })
    expect(runtimeDependencies.requiredEntries).toContain('build/kernel/rpc.mjs')
    expect(runtimeDependencies.requiredEntries).toContain('build/pipicoc/rpc.mjs')
    expect(runtimeDependencies.requiredEntries).toContain('build/host/runtime/kernel/pipiui-secret-vault.mjs')
    expect(runtimeDependencies.resourceFiles).not.toContain('secret-vault.key')
  })

  it('the actual entry consumes the recipe and copies the immutable closure only after unsigned builder staging', () => {
    const { root, home, target, result, events } = runPackager()
    expect(result.status, result.stderr).toBe(0)
    const built = events.find(event => event.kind === 'builder')
    const copied = events.find(event => event.kind === 'copy-runtime')
    const stage = dirname(built.config.directories.output)
    const expected = createPackageRecipe({ repo: root, stage, product, version: '9.8.7-beta.6', userHome: root, appHome: home, appBundle: target })
    expect(built.config).toEqual(expected.config)
    expect(built.product).toEqual(product)
    expect(built.descriptor).toEqual({ schemaVersion: 1, kind: 'standalone', runtimeRoot: 'pi-coc' })
    expect(built.env).toEqual({ CSC_IDENTITY_AUTO_DISCOVERY: 'false', CSC_NAME: '' })
    expect(built.config.forceCodeSigning).toBe(false)
    expect(built.config.mac.identity).toBeNull()
    expect(built.config.mac.binaries).toBeUndefined()
    expect(copied.readonly).toBe(true)
    expect(copied.options).toEqual({ recursive: true, verbatimSymlinks: true })
    expect(events.indexOf(copied)).toBeGreaterThan(events.indexOf(built))
    expect(copied.destination).toBe(join(expected.app, 'Contents/Resources/pi-coc'))
    expect(existsSync(stage)).toBe(false)
    expect(readdirSync(join(root, '.build.noindex/pipicoc'))).toEqual([])
    const receipt = readJson(join(home, 'pipicoc-package.json'))
    expect(receipt.app).toBe(target)
    expect(receipt.sourcePackageSha256).toBe('package-hash')
    expect(receipt.sourceLockSha256).toBe('lock-hash')
    expect(receipt.resourceInventoryStage).toBe('before-codesign')
    expect(readJson(join(receipt.assemblyEvidence, 'result.json'))).toEqual({ status: 'success' })
    expect(readlinkSync(join(home, 'PipiCOC.app'))).toBe(target)
    expect(events.at(-1)).toEqual({ kind: 'register', link: target })
    expect(existsSync(join(target, 'prior-version'))).toBe(false)
  })

  it('signs only real Mach-O inventory files, strictly verifies before replacement, and hashes signed bytes', () => {
    const { home, target, result, events } = runPackager()
    expect(result.status, result.stderr).toBe(0)
    const commands = events.filter(event => event.command === '/usr/bin/codesign')
    const copied = events.find(event => event.kind === 'copy-runtime')
    const app = dirname(dirname(dirname(copied.destination)))
    const nativePaths = ['node/bin/node', 'git/bin/git', 'lib/addon.node']
    expect(commands.map(event => event.args)).toEqual([
      ...nativePaths.map(path => ['--force', '--sign', 'Fixture Identity', '--timestamp=none', join(copied.destination, path)]),
      ['--force', '--deep', '--sign', 'Fixture Identity', '--timestamp=none', app],
      ['--verify', '--deep', '--strict', '--verbose=2', app],
    ])
    expect(events.indexOf(commands[0])).toBeGreaterThan(events.indexOf(copied))
    const renames = events.filter(event => event.kind === 'rename')
    expect(events.indexOf(renames[0])).toBeGreaterThan(events.indexOf(commands.at(-1)))
    expect(renames).toEqual([
      { kind: 'rename', from: target, to: join(dirname(dirname(dirname(app))), 'previous-PipiCOC.app') },
      { kind: 'rename', from: app, to: target },
    ])
    const receipt = readJson(join(home, 'pipicoc-package.json'))
    expect(receipt.signedNative.map((entry: { path: string }) => entry.path)).toEqual([...nativePaths, 'node/bin/node-link'])
    for (const entry of receipt.signedNative) {
      const bytes = readFileSync(join(target, 'Contents/Resources/pi-coc', entry.path))
      expect(bytes.toString()).toContain(' signed')
      expect(entry.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    }
  })

  for (const mode of ['tampered-file', 'tampered-link', 'builder-failure', 'verify-failure', 'install-failure']) {
    it(`${mode} cannot publish an invalid bundle or leave heavy staging`, () => {
      const { root, home, target, result, events } = runPackager(mode)
      expect(result.status, result.stderr).toBe(1)
      const error = {
        'tampered-file': 'Runtime file changed during App assembly: data/plain.txt',
        'tampered-link': 'Runtime link changed during App assembly: node/bin/node-link',
        'builder-failure': 'Injected builder failure',
        'verify-failure': 'Injected strict verification failure',
        'install-failure': 'Injected install failure',
      }[mode]
      expect(result.stderr).toContain(error)
      expect(readFileSync(join(target, 'prior-version'), 'utf8')).toBe('preserve until verified')
      expect(existsSync(join(home, 'pipicoc-package.json'))).toBe(false)
      expect(events.some(event => event.kind === 'register')).toBe(false)
      expect(readdirSync(join(root, '.build.noindex/pipicoc'))).toEqual([])
      if (mode.startsWith('tampered-') || mode === 'builder-failure') expect(events.some(event => event.command === '/usr/bin/codesign')).toBe(false)
      const renames = events.filter(event => event.kind === 'rename')
      if (mode === 'install-failure') {
        expect(renames).toHaveLength(3)
        expect(renames[0].from).toBe(target)
        expect(renames[2]).toEqual({ kind: 'rename', from: renames[0].to, to: target })
      } else expect(renames).toEqual([])
    })
  }

  for (const mode of ['running-target', 'running-link']) {
    it(`${mode} is refused before build work without stopping the running App`, () => {
      const { root, target, result, events } = runPackager(mode)
      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).toContain('Quit the running canonical PipiCOC App before replacing it.')
      expect(events).toEqual([{ kind: 'command', command: '/bin/ps', args: ['-axo', 'command='] }])
      expect(readFileSync(join(target, 'prior-version'), 'utf8')).toBe('preserve until verified')
      expect(readdirSync(join(root, '.build.noindex/pipicoc'))).toEqual([])
    })
  }
})
