import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  installBundledModelCapabilityOverrides,
  linkSharedCredentialFiles,
  resolveElectronPiProfile,
  SHARED_CREDENTIAL_FILE_NAMES
} from './pi-profile.js'

describe('Electron Pi profile', () => {
  let root = ''
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = ''
  })

  it('resolves agent and session state beneath userData', () => {
    expect(resolveElectronPiProfile('/app/user-data')).toEqual({
      agentDir: join('/app/user-data', 'pi-agent'),
      sessionsRoot: join('/app/user-data', 'pi-agent', 'sessions')
    })
  })

  describe('linkSharedCredentialFiles', () => {
    it('symlinks .env/auth.json/models.json into a fresh product profile when the shared dir has them', async () => {
      root = await mkdtemp(join(tmpdir(), 'pipi-shared-creds-fresh-'))
      const sharedDir = join(root, 'shared', 'pi-agent')
      const agentDir = join(root, 'product-a', 'pi-agent')
      await mkdir(sharedDir, { recursive: true })
      for (const name of SHARED_CREDENTIAL_FILE_NAMES) await writeFile(join(sharedDir, name), `${name}-content`, 'utf8')

      await linkSharedCredentialFiles(agentDir, sharedDir)

      for (const name of SHARED_CREDENTIAL_FILE_NAMES) {
        const dest = join(agentDir, name)
        const stat = await lstat(dest)
        expect(stat.isSymbolicLink()).toBe(true)
        expect(await readlink(dest)).toBe(join(sharedDir, name))
        expect(await readFile(dest, 'utf8')).toBe(`${name}-content`)
      }
    })

    it('never touches an existing real credential file', async () => {
      root = await mkdtemp(join(tmpdir(), 'pipi-shared-creds-existing-'))
      const sharedDir = join(root, 'shared', 'pi-agent')
      const agentDir = join(root, 'product-a', 'pi-agent')
      await mkdir(sharedDir, { recursive: true })
      await mkdir(agentDir, { recursive: true })
      await writeFile(join(sharedDir, 'auth.json'), 'shared-auth', 'utf8')
      await writeFile(join(agentDir, 'auth.json'), 'own-real-auth', 'utf8')

      await linkSharedCredentialFiles(agentDir, sharedDir)

      const stat = await lstat(join(agentDir, 'auth.json'))
      expect(stat.isSymbolicLink()).toBe(false)
      expect(await readFile(join(agentDir, 'auth.json'), 'utf8')).toBe('own-real-auth')
    })

    it('never touches an existing symlink, even one pointing somewhere else', async () => {
      root = await mkdtemp(join(tmpdir(), 'pipi-shared-creds-existing-link-'))
      const sharedDir = join(root, 'shared', 'pi-agent')
      const otherDir = join(root, 'other', 'pi-agent')
      const agentDir = join(root, 'product-a', 'pi-agent')
      await mkdir(sharedDir, { recursive: true })
      await mkdir(otherDir, { recursive: true })
      await mkdir(agentDir, { recursive: true })
      await writeFile(join(sharedDir, 'models.json'), 'shared-models', 'utf8')
      await writeFile(join(otherDir, 'models.json'), 'other-models', 'utf8')
      await symlink(join(otherDir, 'models.json'), join(agentDir, 'models.json'))

      await linkSharedCredentialFiles(agentDir, sharedDir)

      expect(await readlink(join(agentDir, 'models.json'))).toBe(join(otherDir, 'models.json'))
    })

    it('creates no symlink and does not throw when the shared directory is missing', async () => {
      root = await mkdtemp(join(tmpdir(), 'pipi-shared-creds-missing-'))
      const agentDir = join(root, 'product-a', 'pi-agent')

      await expect(linkSharedCredentialFiles(agentDir, join(root, 'no-such-shared-dir'))).resolves.toBeUndefined()

      for (const name of SHARED_CREDENTIAL_FILE_NAMES) {
        await expect(lstat(join(agentDir, name))).rejects.toMatchObject({ code: 'ENOENT' })
      }
    })

    it('creates no symlink for a name the shared directory does not have, but still links the ones it does', async () => {
      root = await mkdtemp(join(tmpdir(), 'pipi-shared-creds-partial-'))
      const sharedDir = join(root, 'shared', 'pi-agent')
      const agentDir = join(root, 'product-a', 'pi-agent')
      await mkdir(sharedDir, { recursive: true })
      await writeFile(join(sharedDir, 'auth.json'), 'shared-auth', 'utf8')

      await linkSharedCredentialFiles(agentDir, sharedDir)

      expect((await lstat(join(agentDir, 'auth.json'))).isSymbolicLink()).toBe(true)
      await expect(lstat(join(agentDir, '.env'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(lstat(join(agentDir, 'models.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('leaves models.json alone entirely: the canonical catalog is machine-wide', async () => {
      root = await mkdtemp(join(tmpdir(), 'pipi-shared-creds-models-'))
      const sharedDir = join(root, 'shared', 'pi-agent')
      const agentDir = join(root, 'product-a', 'pi-agent')
      await mkdir(sharedDir, { recursive: true })
      await writeFile(join(sharedDir, 'models.json'), '{"providers":{}}\n', 'utf8')
      await writeFile(join(sharedDir, 'auth.json'), '{}\n', 'utf8')
      await linkSharedCredentialFiles(agentDir, sharedDir)

      // Neither linked nor copied. A link is refused by the canonical reader; a copy forks
      // the catalog and makes a project's own models.json symlink foreign to this product.
      // The backend is pointed at the shared profile instead (sharedProfileDir).
      await expect(lstat(join(agentDir, 'models.json'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await lstat(join(agentDir, 'auth.json'))).isSymbolicLink()).toBe(true)
    })
  })

  it('converts sourced effort metadata into user-preserving Pi overrides idempotently', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-profile-model-capabilities-'))
    const profile = resolveElectronPiProfile(join(root, 'user-data'))
    const snapshotPath = join(root, 'model-capabilities.json')
    await mkdir(profile.agentDir, { recursive: true })
    await writeFile(snapshotPath, JSON.stringify({
      schemaVersion: 1,
      source: 'https://models.dev/api.json',
      retrievedAt: '2026-08-13T03:20:00Z',
      providers: {
        generic: {
          models: {
            reasoner: {
              reasoning: true,
              reasoningOptions: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh'] }],
              verifiedAdditiveEffortValues: ['minimal'],
              verification: { endpoint: 'official provider endpoint', rejectedValues: ['off', 'max'] }
            }
          }
        }
      }
    }))
    await writeFile(join(profile.agentDir, 'models.json'), `${JSON.stringify({
      topLevelUserField: { retained: true },
      providers: {
        generic: {
          apiKey: 'GENERIC_KEY',
          userProviderField: 'retained',
          modelOverrides: {
            reasoner: {
              name: 'User name',
              thinkingLevelMap: { high: 'user-high' },
              compat: { supportsDeveloperRole: false }
            },
            untouched: { reasoning: false }
          }
        },
        untouched: { apiKey: 'OTHER_KEY' }
      }
    }, null, 2)}\n`)
    const projectAgentDir = join(root, 'project', '.pi', 'agent')
    await mkdir(projectAgentDir, { recursive: true })
    await symlink(join(profile.agentDir, 'models.json'), join(projectAgentDir, 'models.json'))

    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('updated')
    const installed = await readFile(join(profile.agentDir, 'models.json'), 'utf8')
    expect((await lstat(join(profile.agentDir, 'models.json'))).mode & 0o777).toBe(0o600)
    expect(await readFile(join(projectAgentDir, 'models.json'), 'utf8')).toBe(installed)
    const parsed = JSON.parse(installed)
    expect(parsed.topLevelUserField).toEqual({ retained: true })
    expect(parsed.providers.generic).toMatchObject({
      apiKey: 'GENERIC_KEY',
      userProviderField: 'retained',
      modelOverrides: {
        untouched: { reasoning: false },
        reasoner: {
          name: 'User name',
          reasoning: true,
          thinkingLevelMap: {
            minimal: 'minimal',
            low: 'low',
            medium: 'medium',
            high: 'user-high',
            xhigh: 'xhigh',
            max: null
          },
          compat: { supportsReasoningEffort: true, supportsDeveloperRole: false }
        }
      }
    })
    // "off" stays absent from the managed map so it remains selectable and sends no effort param.
    expect(parsed.providers.generic.modelOverrides.reasoner.thinkingLevelMap.off).toBeUndefined()
    expect(parsed.providers.untouched).toEqual({ apiKey: 'OTHER_KEY' })
    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('unchanged')
    expect(await readFile(join(profile.agentDir, 'models.json'), 'utf8')).toBe(installed)
    await chmod(join(profile.agentDir, 'models.json'), 0o644)
    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('unchanged')
    expect((await lstat(join(profile.agentDir, 'models.json'))).mode & 0o777).toBe(0o600)
    expect(await readFile(join(profile.agentDir, 'models.json'), 'utf8')).toBe(installed)

    const upgraded = JSON.parse(await readFile(snapshotPath, 'utf8'))
    upgraded.providers.generic.models.reasoner.reasoningOptions[0].values = ['medium', 'high', 'xhigh']
    upgraded.providers.generic.models.reasoner.verifiedAdditiveEffortValues = ['minimal']
    await writeFile(snapshotPath, JSON.stringify(upgraded))
    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('updated')
    const upgradedSource = await readFile(join(profile.agentDir, 'models.json'), 'utf8')
    expect(await readFile(join(projectAgentDir, 'models.json'), 'utf8')).toBe(upgradedSource)
    const upgradedModels = JSON.parse(upgradedSource)
    // Managed `low` follows the newer snapshot, while the divergent user `high` mapping remains.
    expect(upgradedModels.providers.generic.modelOverrides.reasoner.thinkingLevelMap).toMatchObject({
      minimal: 'minimal', low: null, medium: 'medium', high: 'user-high', xhigh: 'xhigh'
    })

  })

  it('does not resurrect a deleted custom provider as a modelOverrides-only shell', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-profile-no-shell-'))
    const profile = resolveElectronPiProfile(join(root, 'user-data'))
    const snapshotPath = join(root, 'model-capabilities.json')
    await mkdir(profile.agentDir, { recursive: true })
    await writeFile(snapshotPath, JSON.stringify({
      schemaVersion: 1,
      source: 'https://models.dev/api.json',
      retrievedAt: '2026-08-27T00:00:00Z',
      providers: {
        jellytoken: {
          models: {
            'deepseek-v4-flash': {
              reasoning: true,
              thinkingLevelMap: { off: null, minimal: 'low', low: 'low', medium: 'high', high: 'high', xhigh: 'max', max: 'max' },
              compat: { supportsReasoningEffort: true }
            }
          }
        },
        relay: {
          models: {
            reasoner: {
              reasoning: true,
              reasoningOptions: [{ type: 'effort', values: ['low', 'medium', 'high'] }]
            }
          }
        }
      }
    }))
    // Post-delete state: the custom provider's definition is gone from models.json; only
    // another provider remains. The snapshot still carries jellytoken capability overrides.
    const modelsJsonPath = join(profile.agentDir, 'models.json')
    await writeFile(modelsJsonPath, `${JSON.stringify({
      providers: {
        relay: {
          api: 'openai-completions',
          apiKey: 'RELAY_KEY',
          baseUrl: 'https://relay.example.test/v1',
          models: [{ id: 'reasoner', name: 'Reasoner', reasoning: false, input: ['text'], contextWindow: 200000, maxTokens: 16384 }]
        }
      }
    }, null, 2)}\n`)

    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('updated')
    const installed = JSON.parse(await readFile(modelsJsonPath, 'utf8'))
    // No shell resurrection: the deleted provider stays gone; the surviving provider keeps
    // its definition and still receives its own capability overrides.
    expect(Object.keys(installed.providers)).toEqual(['relay'])
    expect(installed.providers.relay.apiKey).toBe('RELAY_KEY')
    expect(installed.providers.relay.modelOverrides.reasoner).toMatchObject({
      reasoning: true,
      thinkingLevelMap: { low: 'low', medium: 'medium', high: 'high' }
    })

    // Next launch stays clean: the rewritten provenance must not bring the shell back.
    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('unchanged')
    expect(Object.keys(JSON.parse(await readFile(modelsJsonPath, 'utf8')).providers)).toEqual(['relay'])

    // Re-adding the custom provider (fresh definition) gets overrides applied again.
    await writeFile(modelsJsonPath, `${JSON.stringify({
      providers: {
        ...installed.providers,
        jellytoken: {
          api: 'openai-completions',
          apiKey: 'JELLY_KEY',
          baseUrl: 'https://aiservice.jellytoken.com/v1',
          models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', reasoning: false, input: ['text'], contextWindow: 200000, maxTokens: 16384 }]
        }
      }
    }, null, 2)}\n`)
    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('updated')
    const readded = JSON.parse(await readFile(modelsJsonPath, 'utf8'))
    expect(readded.providers.jellytoken.api).toBe('openai-completions')
    expect(readded.providers.jellytoken.modelOverrides['deepseek-v4-flash']).toMatchObject({
      reasoning: true,
      thinkingLevelMap: { off: null, medium: 'high', max: 'max' }
    })
  })

  it('feeds the bundled override through installed Pi ModelRuntime and into the xhigh request payload', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-profile-real-model-runtime-'))
    const profile = resolveElectronPiProfile(join(root, 'user-data'))
    await mkdir(profile.agentDir, { recursive: true })
    await writeFile(join(profile.agentDir, 'models-store.json'), JSON.stringify({
      xai: {
        lastModified: 4102444800000,
        checkedAt: 4102444800000,
        models: [{
          provider: 'xai',
          id: 'grok-4.6',
          name: 'Grok 4.6',
          api: 'openai-completions',
          baseUrl: 'https://api.x.ai/v1',
          reasoning: true,
          input: ['text', 'image'],
          cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
          contextWindow: 500000,
          maxTokens: 500000,
          compat: { supportsReasoningEffort: false }
        }]
      }
    }))
    const snapshotPath = join(process.cwd(), 'resources', 'runtime', 'model-capabilities', 'models-dev-reasoning-options.json')
    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('updated')

    const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
    const runtime = await ModelRuntime.create({
      modelsPath: join(profile.agentDir, 'models.json'),
      modelsStorePath: join(profile.agentDir, 'models-store.json'),
      allowModelNetwork: false
    })
    const model = runtime.getModel('xai', 'grok-4.6')
    expect(model).toMatchObject({
      reasoning: true,
      thinkingLevelMap: {
        minimal: 'minimal',
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: null
      },
      compat: { supportsReasoningEffort: true }
    })
    expect(model?.thinkingLevelMap?.off).toBeUndefined()

    const { streamSimple } = await import('@earendil-works/pi-ai/api/openai-completions')
    let payload: Record<string, unknown> | undefined
    const stream = streamSimple(model as any, {
      messages: [{ role: 'user', content: 'probe', timestamp: Date.now() }]
    }, {
      apiKey: 'not-sent',
      reasoning: 'xhigh',
      maxTokens: 1,
      onPayload: value => {
        payload = value as unknown as Record<string, unknown>
        throw new Error('payload captured before network')
      }
    })
    await stream.result()
    expect(payload).toMatchObject({ model: 'grok-4.6', reasoning_effort: 'xhigh' })

    // Thinking off must not leak a reasoning_effort param the provider would reject.
    let offPayload: Record<string, unknown> | undefined
    const offStream = streamSimple(model as any, {
      messages: [{ role: 'user', content: 'probe', timestamp: Date.now() }]
    }, {
      apiKey: 'not-sent',
      reasoning: 'off',
      maxTokens: 1,
      onPayload: value => {
        offPayload = value as unknown as Record<string, unknown>
        throw new Error('payload captured before network')
      }
    })
    await offStream.result()
    expect(offPayload).toBeDefined()
    expect(offPayload).not.toHaveProperty('reasoning_effort')
  })

  it('expands the sparse openai-codex map so GPT-5.6 offers the efforts chatgpt.com accepts', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-profile-codex-effort-'))
    const profile = resolveElectronPiProfile(join(root, 'user-data'))
    await mkdir(profile.agentDir, { recursive: true })
    // models-store carries the model exactly as upstream pi ships it: a sparse
    // thinkingLevelMap whose absent keys mean pass-through on the wire, not
    // unsupported. Without the bundled expansion the picker offered only
    // off/minimal/xhigh/max and hid the accepted low/medium/high.
    await writeFile(join(profile.agentDir, 'models-store.json'), JSON.stringify({
      'openai-codex': {
        lastModified: 4102444800000,
        checkedAt: 4102444800000,
        models: [{
          provider: 'openai-codex',
          id: 'gpt-5.6-sol',
          name: 'GPT-5.6 Sol',
          api: 'openai-codex-responses',
          baseUrl: 'https://chatgpt.com/backend-api',
          reasoning: true,
          input: ['text', 'image'],
          cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
          contextWindow: 272000,
          maxTokens: 128000,
          thinkingLevelMap: { xhigh: 'xhigh', max: 'max', minimal: 'low' }
        }]
      }
    }))
    const snapshotPath = join(process.cwd(), 'resources', 'runtime', 'model-capabilities', 'models-dev-reasoning-options.json')
    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('updated')

    const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
    const runtime = await ModelRuntime.create({
      modelsPath: join(profile.agentDir, 'models.json'),
      modelsStorePath: join(profile.agentDir, 'models-store.json'),
      allowModelNetwork: false
    })
    const model = runtime.getModel('openai-codex', 'gpt-5.6-sol')
    expect(model).toMatchObject({
      reasoning: true,
      thinkingLevelMap: {
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: 'max'
      },
      compat: { supportsReasoningEffort: true }
    })
    expect(model?.thinkingLevelMap?.off).toBeUndefined()

    // UI contract: every effort the backend accepts is selectable (off stays implicit);
    // 'minimal' stays hidden because the backend rejects it (probe: HTTP 400 Unsupported value).
    const { thinkingLevelsForModel } = await import('@pipi/host-api')
    expect(thinkingLevelsForModel(model as any)).toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max'])

    // The previously hidden levels must actually reach the wire.
    const { streamSimple } = await import('@earendil-works/pi-ai/api/openai-codex-responses')
    const codexToken = ['header', Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-test' } })).toString('base64'), 'sig'].join('.')
    const capture = async (reasoning: string): Promise<Record<string, unknown> | undefined> => {
      let payload: Record<string, unknown> | undefined
      const stream = streamSimple(model as any, {
        messages: [{ role: 'user', content: 'probe', timestamp: Date.now() }]
      }, {
        apiKey: codexToken,
        reasoning: reasoning as any,
        maxTokens: 1,
        onPayload: value => {
          payload = value as unknown as Record<string, unknown>
          throw new Error('payload captured before network')
        }
      })
      await stream.result()
      return payload
    }
    expect(await capture('high')).toMatchObject({ model: 'gpt-5.6-sol', reasoning: { effort: 'high' } })
    // A stale session 'minimal' clamps to the nearest offered level, not to the
    // rejected literal 'minimal'.
    expect(await capture('minimal')).toMatchObject({ reasoning: { effort: 'low' } })
  })

  it('wires a hand-curated deepseek map so thinking levels reach a non-pi-named effort vocabulary', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-profile-deepseek-effort-'))
    const profile = resolveElectronPiProfile(join(root, 'user-data'))
    await mkdir(profile.agentDir, { recursive: true })
    // The broken state this guards against: a relay serving deepseek models with
    // reasoning:false and no thinking wiring, so every dispatch-level thinking knob
    // silently did nothing while the model thought itself into thousands of tokens.
    await writeFile(join(profile.agentDir, 'models.json'), JSON.stringify({
      providers: {
        jellytoken: {
          api: 'openai-completions',
          apiKey: 'not-sent',
          baseUrl: 'https://aiservice.example.test/v1',
          models: [{
            id: 'deepseek-v4-flash',
            name: 'DeepSeek V4 Flash',
            reasoning: false,
            input: ['text'],
            contextWindow: 200000,
            maxTokens: 16384
          }, {
            id: 'qwen3.7-plus',
            name: 'Qwen 3.7 Plus',
            reasoning: false,
            input: ['text'],
            contextWindow: 200000,
            maxTokens: 16384
          }, {
            id: 'kimi-k3',
            name: 'Kimi K3',
            reasoning: false,
            input: ['text'],
            contextWindow: 200000,
            maxTokens: 16384
          }, {
            id: 'qwen3.8-max',
            name: 'Qwen 3.8 Max',
            reasoning: false,
            input: ['text'],
            contextWindow: 200000,
            maxTokens: 16384
          }]
        }
      }
    }))
    await writeFile(join(profile.agentDir, 'models-store.json'), JSON.stringify({}))
    const snapshotPath = join(process.cwd(), 'resources', 'runtime', 'model-capabilities', 'models-dev-reasoning-options.json')
    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('updated')
    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('unchanged')

    const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
    const runtime = await ModelRuntime.create({
      modelsPath: join(profile.agentDir, 'models.json'),
      modelsStorePath: join(profile.agentDir, 'models-store.json'),
      allowModelNetwork: false
    })
    const model = runtime.getModel('jellytoken', 'deepseek-v4-flash')
    expect(model).toMatchObject({
      reasoning: true,
      thinkingLevelMap: {
        off: null,
        minimal: 'low',
        low: 'low',
        medium: 'high',
        high: 'high',
        xhigh: 'max',
        max: 'max'
      },
      compat: { supportsReasoningEffort: true, thinkingFormat: 'deepseek' }
    })

    const qwen = runtime.getModel('jellytoken', 'qwen3.7-plus')
    expect(qwen).toMatchObject({
      reasoning: true,
      thinkingLevelMap: {
        minimal: 'low',
        low: 'low',
        medium: 'medium',
        high: 'high'
      },
      compat: { supportsReasoningEffort: true }
    })
    expect(qwen?.thinkingLevelMap?.off).toBeUndefined()
    expect(qwen?.compat).not.toHaveProperty('thinkingFormat')

    const kimi3 = runtime.getModel('jellytoken', 'kimi-k3')
    expect(kimi3).toMatchObject({
      reasoning: true,
      thinkingLevelMap: {
        off: null,
        minimal: 'low',
        low: 'low',
        medium: 'high',
        high: 'high',
        xhigh: 'max',
        max: 'max'
      },
      compat: { supportsReasoningEffort: true }
    })

    const qwen38 = runtime.getModel('jellytoken', 'qwen3.8-max')
    expect(qwen38).toMatchObject({
      reasoning: true,
      thinkingLevelMap: {
        off: 'none',
        minimal: 'low',
        low: 'low',
        medium: 'medium',
        high: 'xhigh',
        xhigh: 'xhigh',
        max: 'xhigh'
      },
      compat: { supportsReasoningEffort: true }
    })

    const { streamSimple } = await import('@earendil-works/pi-ai/api/openai-completions')
    const capture = async (reasoning?: string) => {
      let payload: Record<string, unknown> | undefined
      const stream = streamSimple(model as any, {
        messages: [{ role: 'user', content: 'probe', timestamp: Date.now() }]
      }, {
        apiKey: 'not-sent',
        ...(reasoning ? { reasoning } : {}),
        maxTokens: 1,
        onPayload: value => {
          payload = value as unknown as Record<string, unknown>
          throw new Error('payload captured before network')
        }
      })
      await stream.result().catch(() => undefined)
      expect(payload).toBeDefined()
      return payload!
    }

    // An explicit low level arrives as deepseek's native pair: thinking on + effort low.
    expect(await capture('low')).toMatchObject({ reasoning_effort: 'low', thinking: { type: 'enabled' } })
    // medium is not a deepseek effort: the map routes it to high instead of forwarding garbage.
    expect(await capture('medium')).toMatchObject({ reasoning_effort: 'high' })
    // With no level requested, off:null must not silently disable thinking wholesale.
    expect(await capture()).not.toHaveProperty('thinking')

    const captureQwen = async (reasoning?: string) => {
      let payload: Record<string, unknown> | undefined
      const stream = streamSimple(qwen as any, {
        messages: [{ role: 'user', content: 'probe', timestamp: Date.now() }]
      }, {
        apiKey: 'not-sent',
        ...(reasoning ? { reasoning } : {}),
        maxTokens: 1,
        onPayload: value => {
          payload = value as unknown as Record<string, unknown>
          throw new Error('payload captured before network')
        }
      })
      await stream.result().catch(() => undefined)
      expect(payload).toBeDefined()
      return payload!
    }
    expect(await captureQwen('minimal')).toMatchObject({ reasoning_effort: 'low' })
    expect(await captureQwen('low')).toMatchObject({ reasoning_effort: 'low' })
    expect(await captureQwen('medium')).toMatchObject({ reasoning_effort: 'medium' })
    expect(await captureQwen('high')).toMatchObject({ reasoning_effort: 'high' })
    expect(await captureQwen('off')).not.toHaveProperty('reasoning_effort')
    expect(await captureQwen('off')).not.toHaveProperty('thinking')
  })

  it('installs hand-curated gemini thinkingLevelMaps so official Google models expose selectable thinking levels', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-profile-gemini-thinking-'))
    const profile = resolveElectronPiProfile(join(root, 'user-data'))
    await mkdir(profile.agentDir, { recursive: true })
    // The broken state this guards against: models.dev-refreshed Google Gemini 3 entries report
    // reasoning with an off-only thinkingLevelMap and no supported string levels, so
    // thinkingLevelsForModel returns [] and the ThinkingChip locks to auto.
    const flashIds = ['gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-flash-latest']
    const proIds = ['gemini-3-pro-preview', 'gemini-3.1-pro-preview']
    const storeModel = (id: string) => ({
      provider: 'google',
      id,
      name: id,
      api: 'google-generative-ai',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      reasoning: true,
      thinkingLevelMap: { off: null },
      input: ['text', 'image'],
      cost: { input: 2, output: 12, cacheRead: 0.5, cacheWrite: 0 },
      contextWindow: 1000000,
      maxTokens: 65536
    })
    await writeFile(join(profile.agentDir, 'models-store.json'), JSON.stringify({
      google: {
        lastModified: 4102444800000,
        checkedAt: 4102444800000,
        models: [...flashIds, ...proIds].map(storeModel)
      }
    }))
    const modelsJsonPath = join(profile.agentDir, 'models.json')
    await writeFile(modelsJsonPath, `${JSON.stringify({ providers: {} }, null, 2)}\n`)

    const snapshotPath = join(process.cwd(), 'resources', 'runtime', 'model-capabilities', 'models-dev-reasoning-options.json')
    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('updated')
    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('unchanged')

    const installed = JSON.parse(await readFile(modelsJsonPath, 'utf8'))
    for (const id of flashIds) {
      expect(installed.providers.google.modelOverrides[id]).toMatchObject({
        reasoning: true,
        thinkingLevelMap: { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' },
        compat: { supportsReasoningEffort: true }
      })
    }
    for (const id of proIds) {
      expect(installed.providers.google.modelOverrides[id]).toMatchObject({
        reasoning: true,
        thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: null, high: 'high' },
        compat: { supportsReasoningEffort: true }
      })
    }

    const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
    const runtime = await ModelRuntime.create({
      modelsPath: modelsJsonPath,
      modelsStorePath: join(profile.agentDir, 'models-store.json'),
      allowModelNetwork: false
    })
    const { thinkingLevelsForModel } = await import('@pipi/host-api')
    for (const id of flashIds) {
      const model = runtime.getModel('google', id)
      expect(model).toMatchObject({
        reasoning: true,
        thinkingLevelMap: { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' }
      })
      // xhigh/max stay unsupported: MINIMAL | LOW | MEDIUM | HIGH is the whole vocabulary.
      expect(model?.thinkingLevelMap).not.toHaveProperty('xhigh')
      expect(model?.thinkingLevelMap).not.toHaveProperty('max')
      // UI contract: a non-empty selectable list instead of a ThinkingChip locked to auto.
      expect(thinkingLevelsForModel(model as any)).toEqual(['minimal', 'low', 'medium', 'high'])
    }
    for (const id of proIds) {
      const model = runtime.getModel('google', id)
      expect(model).toMatchObject({
        reasoning: true,
        thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: null, high: 'high' }
      })
      expect(thinkingLevelsForModel(model as any)).toEqual(['low', 'high'])
    }

    // The override must actually reach the wire as Google's uppercase thinkingLevel enum.
    const { streamSimple } = await import('@earendil-works/pi-ai/api/google-generative-ai')
    const capture = async (id: string, reasoning?: string) => {
      const model = runtime.getModel('google', id)
      expect(model).toBeDefined()
      let payload: Record<string, unknown> | undefined
      const stream = streamSimple(model as any, {
        messages: [{ role: 'user', content: 'probe', timestamp: Date.now() }]
      }, {
        apiKey: 'not-sent',
        ...(reasoning ? { reasoning } : {}),
        maxTokens: 1,
        onPayload: value => {
          payload = value as unknown as Record<string, unknown>
          throw new Error('payload captured before network')
        }
      })
      await stream.result().catch(() => undefined)
      expect(payload).toBeDefined()
      return payload!
    }
    // Flash vocabulary is MINIMAL | LOW | MEDIUM | HIGH: medium forwards verbatim.
    expect(await capture('gemini-3.7-flash', 'medium'))
      .toMatchObject({ config: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'MEDIUM' } } })
    // Pro only accepts LOW | HIGH: minimal collapses down to LOW.
    expect(await capture('gemini-3-pro-preview', 'minimal'))
      .toMatchObject({ config: { thinkingConfig: { thinkingLevel: 'LOW' } } })
    expect(await capture('gemini-3-pro-preview', 'high'))
      .toMatchObject({ config: { thinkingConfig: { thinkingLevel: 'HIGH' } } })
    // off is not a Gemini 3 level: it clamps to the floor instead of disabling thinking.
    expect(await capture('gemini-3.7-flash', 'off'))
      .toMatchObject({ config: { thinkingConfig: { thinkingLevel: 'MINIMAL' } } })
  })
})
