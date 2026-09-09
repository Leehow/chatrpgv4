import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { resolveRuntimeAssets } from './runtime-assets.js'
import { COMPILED_ENTRIES, HOST_MOUNTS } from '../../../../../runtime/deployment.mjs'

describe('canonical Keeper runtime', () => {
  it('selects this checkout even when an old embedded runtime override is present', () => {
    const repo = mkdtempSync(join(tmpdir(), 'pipicoc-runtime-'))
    mkdirSync(join(repo, 'pipicoc'))
    writeFileSync(join(repo, 'pipicoc/rpc'), '#!/bin/sh\n', {mode: 0o755})
    const assets = resolveRuntimeAssets({packaged:false, resourcesPath:'/unused',
      dirname:join(repo, 'Electron/apps/electron/out/main'),
      env:{PIPIUI_EMBEDDED_RUNTIME_DIR:'/old/runtime'}})
    expect(assets.piCommand?.executable).toBe(join(repo, 'pipicoc/rpc'))
    expect(assets.piCommand?.piPath).toBe(join(repo, 'node_modules/.bin/pi'))
    expect(assets.piCommand?.env?.PI_CODING_AGENT_DIR).toBe(join(repo, '.pi/coc-agent'))
  })
  it('fails instead of silently using a different Keeper when the checkout is missing', () => {
    expect(() => resolveRuntimeAssets({packaged:false, resourcesPath:'/unused',
      dirname:'/missing/Electron/apps/electron/out/main', env:{}})).toThrow()
  })
})

it('loads only the standalone resources and keeps the profile outside them', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'pipicoc-delivery-'))
  const resources = join(fixture, 'resources'), repo = join(resources, 'pi-coc'), userData = join(fixture, 'user-data')
  const write = (path:string, text='') => {mkdirSync(dirname(path), {recursive:true});writeFileSync(path,text,{mode:0o755})}
  const manifest = {schemaVersion:1,layout:'compiled',backend:'typescript',node:'node/bin/node',git:'git/bin/git',
    gitExec:'git/libexec/git-core',gitTemplates:'git/share/git-core/templates',pi:'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'}
  write(join(repo, 'deployment.json'), JSON.stringify(manifest))
  for (const path of [manifest.node, manifest.git, manifest.pi, ...Object.values(COMPILED_ENTRIES),
    ...Object.values(HOST_MOUNTS).map(path => `build/host/runtime/${path}`),
    ...['kernel','mods','onboarding','module','memory','table'].map(name => `build/extensions/${name}/index.mjs`),
    'prompts/keeper.md','prompts/setup.md','build/host/runtime/auth/pi-auth-helper.mjs']) write(join(repo,path))
  for (const path of ['content','mods',manifest.gitExec,manifest.gitTemplates]) mkdirSync(join(repo,path), {recursive:true})
  write(join(resources,'pi-coc-runtime.json'), JSON.stringify({schemaVersion:1,kind:'standalone',runtimeRoot:'pi-coc'}))
  const assets=resolveRuntimeAssets({packaged:true,resourcesPath:resources,dirname:'/irrelevant',userData,env:{PATH:'/developer/bin'}})
  expect(assets.piCommand?.executable).toBe(join(repo,manifest.node))
  expect(assets.piCommand?.prefixArgs).toEqual([join(repo,'build/pipicoc/rpc.mjs')])
  expect(assets.sourceRoot).toBe(join(repo,'build/host/runtime'))
  expect(assets.agentDir).toBe(join(userData,'pi-coc/agent'))
  expect(assets.piCommand?.env?.PI_OFFLINE).toBe('1')
  expect(assets.piCommand?.env?.PATH).not.toContain('/developer/bin')
  write(join(resources,'pi-coc-runtime.json'), JSON.stringify({repoRoot:repo,nodePath:process.execPath}))
  expect(() => resolveRuntimeAssets({packaged:true,resourcesPath:resources,dirname:'/irrelevant',userData,env:{}})).toThrow('standalone')
})
