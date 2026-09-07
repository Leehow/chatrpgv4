import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultProductConfigPath, loadProductIdentity, parseProductIdentity } from './product-identity.js'

const workspaceRoot = join(import.meta.dirname, '..', '..', '..', '..')

describe('product identity', () => {
  let root = ''
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = ''
  })

  it('resolves the packaged product.json under resourcesPath', () => {
    expect(defaultProductConfigPath({ packaged: true, resourcesPath: '/Applications/PipiUI.app/Contents/Resources', dirname: '/unused' }))
      .toBe(join('/Applications/PipiUI.app/Contents/Resources', 'product.json'))
  })

  it('resolves the dev workspace-root product.json from the built main bundle dirname', () => {
    expect(defaultProductConfigPath({ packaged: false, resourcesPath: '/unused', dirname: join('/repo', 'Electron', 'apps', 'electron', 'out', 'main') }))
      .toBe(join('/repo', 'Electron', 'product.json'))
  })

  it('loads this repo\'s own product.json as the base PipiUI identity', () => {
    const identity = loadProductIdentity({
      packaged: false,
      resourcesPath: '/unused',
      dirname: join(workspaceRoot, 'apps', 'electron', 'out', 'main'),
      env: {}
    })
    expect(identity).toEqual({
      id: 'pipiui',
      name: 'PipiUI',
      appId: 'com.leehow.pipiui-electron',
      userDataDirname: 'Pipi/pipiui',
      sharedCredentialsDir: '@pipiui/electron/pi-agent'
    })
  })

  it('PIPIUI_PRODUCT_CONFIG overrides the default path for a downstream product', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-product-config-'))
    const configPath = join(root, 'pipi-hydra.product.json')
    await writeFile(configPath, JSON.stringify({
      id: 'pipi-hydra',
      name: 'Pipi Hydra',
      appId: 'com.leehow.pipi-hydra',
      userDataDirname: 'Pipi/pipi-hydra',
      defaultPack: 'hydra-workbench',
      sharedCredentialsDir: '@pipiui/electron/pi-agent'
    }), 'utf8')

    const identity = loadProductIdentity({
      packaged: false,
      resourcesPath: '/unused',
      dirname: join(workspaceRoot, 'apps', 'electron', 'out', 'main'),
      env: { PIPIUI_PRODUCT_CONFIG: configPath }
    })
    expect(identity.id).toBe('pipi-hydra')
    expect(identity.name).toBe('Pipi Hydra')
    expect(identity.userDataDirname).toBe('Pipi/pipi-hydra')
    // One line turns the base into a product: the pack a fresh project runs.
    expect(identity.defaultPack).toBe('hydra-workbench')
  })

  it('accepts agentMaxDepth 0-2 and rejects anything else', () => {
    const base = {
      id: 'pipi-paper',
      name: 'Pipi Paper',
      appId: 'com.leehow.pipi-paper',
      userDataDirname: 'Pipi/pipi-paper',
      sharedCredentialsDir: '@pipiui/electron/pi-agent',
    }
    expect(parseProductIdentity({ ...base, agentMaxDepth: 1 }, '/x/product.json').agentMaxDepth).toBe(1)
    expect(parseProductIdentity({ ...base, agentMaxDepth: 0 }, '/x/product.json').agentMaxDepth).toBe(0)
    expect(parseProductIdentity({ ...base, agentMaxDepth: 2 }, '/x/product.json').agentMaxDepth).toBe(2)
    expect(parseProductIdentity(base, '/x/product.json').agentMaxDepth).toBeUndefined()
    expect(() => parseProductIdentity({ ...base, agentMaxDepth: 3 }, '/x/product.json')).toThrow(/agentMaxDepth/)
    expect(() => parseProductIdentity({ ...base, agentMaxDepth: -1 }, '/x/product.json')).toThrow(/agentMaxDepth/)
    expect(() => parseProductIdentity({ ...base, agentMaxDepth: 1.5 }, '/x/product.json')).toThrow(/agentMaxDepth/)
    expect(() => parseProductIdentity({ ...base, agentMaxDepth: '1' }, '/x/product.json')).toThrow(/agentMaxDepth/)
  })

  it('fails loudly on a missing config file', () => {
    expect(() => loadProductIdentity({
      packaged: false,
      resourcesPath: '/unused',
      dirname: '/repo/Electron/apps/electron/out/main',
      env: { PIPIUI_PRODUCT_CONFIG: '/no/such/product.json' }
    })).toThrow(/Failed to read product identity/)
  })

  it('rejects a malformed product.json shape', () => {
    expect(() => parseProductIdentity({ id: 'pipiui', name: 'PipiUI' }, '/x/product.json'))
      .toThrow(/"appId"/)
    expect(() => parseProductIdentity(['not', 'an', 'object'], '/x/product.json'))
      .toThrow(/must be a JSON object/)
    expect(() => parseProductIdentity(null, '/x/product.json'))
      .toThrow(/must be a JSON object/)
  })

  it('resolves an icon against the config file, so a product keeps its artwork beside it', () => {
    const identity = parseProductIdentity({
      id: 'pipi-hydra',
      name: 'Pipi Hydra',
      appId: 'com.leehow.pipi-hydra',
      userDataDirname: 'Pipi/pipi-hydra',
      defaultProfileId: 'base',
      sharedCredentialsDir: '@pipiui/electron/pi-agent',
      icon: 'pipi-hydra.png'
    }, '/Users/x/hydra/pipi-hydra.product.json')
    expect(identity.icon).toBe('/Users/x/hydra/pipi-hydra.png')
  })

  it('leaves the icon unset when the product declares none, and rejects an empty one', () => {
    const base = {
      id: 'pipiui',
      name: 'PipiUI',
      appId: 'com.leehow.pipiui-electron',
      userDataDirname: 'Pipi/pipiui',
      defaultProfileId: 'base',
      sharedCredentialsDir: '@pipiui/electron/pi-agent'
    }
    expect(parseProductIdentity(base, '/x/product.json').icon).toBeUndefined()
    expect(() => parseProductIdentity({ ...base, icon: '' }, '/x/product.json')).toThrow(/"icon"/)
    expect(() => parseProductIdentity({ ...base, icon: 42 }, '/x/product.json')).toThrow(/"icon"/)
  })

  it('rejects an id that is not a semantic slug', () => {
    expect(() => parseProductIdentity({
      id: 'Pipi UI',
      name: 'PipiUI',
      appId: 'com.leehow.pipiui-electron',
      userDataDirname: 'Pipi/pipiui',
      sharedCredentialsDir: '@pipiui/electron/pi-agent'
    }, '/x/product.json')).toThrow(/semantic slug/)
  })
})
