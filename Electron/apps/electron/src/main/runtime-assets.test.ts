import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { resolveRuntimeAssets } from './runtime-assets.js'

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
