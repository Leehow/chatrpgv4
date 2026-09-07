import { constants as fsConstants } from 'node:fs'
import { lstat, mkdir, open, readFile, readlink, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { getBuiltinProviders } from '@earendil-works/pi-ai/providers/all'

export interface ElectronPiProfile {
  agentDir: string
  sessionsRoot: string
}

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const MODEL_CAPABILITY_PROVENANCE = '.pipiui-model-capability-overrides-v1.json'
type ThinkingLevel = typeof THINKING_LEVELS[number]
type JsonObject = Record<string, any>

interface ModelCapabilitySnapshot {
  schemaVersion: 1
  providers: Record<string, {
    models: Record<string, {
      reasoning?: boolean
      reasoningOptions?: Array<{ type: string, values?: string[] }>
      verifiedAdditiveEffortValues?: string[]
      /**
       * Hand-curated passthrough for providers whose effort vocabulary is not named after
       * pi levels (deepseek accepts low/high/max). The derived same-name map would forward
       * an unsupported "medium" — the one failure mode this file exists to prevent.
       */
      thinkingLevelMap?: Record<string, string | null>
      /** Hand-curated compat fields (e.g. thinkingFormat) merged over the derived override. */
      compat?: Record<string, unknown>
    }>
  }>
}

function objectValue(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must contain a JSON object`)
  return value as JsonObject
}

function parseSnapshot(source: string): ModelCapabilitySnapshot {
  const snapshot = objectValue(JSON.parse(source), 'Bundled model capability snapshot')
  if (snapshot.schemaVersion !== 1) throw new Error('Unsupported bundled model capability snapshot schema')
  objectValue(snapshot.providers, 'Bundled model capability snapshot providers')
  return snapshot as ModelCapabilitySnapshot
}

function capabilityOverride(model: ModelCapabilitySnapshot['providers'][string]['models'][string]): JsonObject | undefined {
  const catalogValues = model.reasoningOptions
    ?.filter(option => option.type === 'effort')
    .flatMap(option => option.values ?? []) ?? []
  const supported = new Set([...catalogValues, ...(model.verifiedAdditiveEffortValues ?? [])])
  const handCurated = model.thinkingLevelMap !== undefined || model.compat !== undefined
  if (!handCurated && (!model.reasoning || supported.size === 0)) return undefined
  // "off" disables reasoning and must stay available even when the provider's effort
  // catalog omits it. Leave the key absent rather than mapped: an absent entry keeps
  // "off" selectable in the UI while sending no reasoning param, whereas a string value
  // would be forwarded as the provider effort and null would hide the level entirely
  // (stranding the UI default thinking level as invalid). A hand-curated entry may set
  // "off": null deliberately — for a model that cannot be trusted to think on command,
  // keeping an unset level at the provider default beats silently disabling thinking.
  const derived = handCurated && model.thinkingLevelMap !== undefined
    ? model.thinkingLevelMap
    : Object.fromEntries(
        THINKING_LEVELS.filter(level => level !== 'off').map(level => [level, supported.has(level) ? level : null])
      ) as Record<ThinkingLevel, string | null>
  return {
    reasoning: model.reasoning ?? true,
    thinkingLevelMap: derived,
    compat: { supportsReasoningEffort: true, ...(model.compat ?? {}) }
  }
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

const DELETE_MANAGED_VALUE = Symbol('delete-managed-value')

/** Replace only missing fields or fields that still equal the last PipiUI-managed value. */
function mergeManagedFields(current: unknown, next: unknown, previous: unknown): unknown | typeof DELETE_MANAGED_VALUE {
  if (next === undefined && previous !== undefined) {
    if (equalJson(current, previous)) return DELETE_MANAGED_VALUE
    if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return current
  }
  if (!next || typeof next !== 'object' || Array.isArray(next)) {
    if (previous !== undefined && equalJson(current, previous))
      return next === undefined ? DELETE_MANAGED_VALUE : next
    return current === undefined ? next : current
  }
  const existing = objectValue(current ?? {}, 'models.json managed capability fields')
  const prior = previous === undefined ? {} : objectValue(previous, 'model capability provenance')
  const merged = structuredClone(existing)
  for (const key of new Set([...Object.keys(next), ...Object.keys(prior)])) {
    const value = mergeManagedFields(existing[key], (next as JsonObject)[key], prior[key])
    if (value === DELETE_MANAGED_VALUE) delete merged[key]
    else merged[key] = value
  }
  if (next === undefined && previous !== undefined && Object.keys(merged).length === 0) return DELETE_MANAGED_VALUE
  return merged
}

function sourcedOverrides(snapshot: ModelCapabilitySnapshot): JsonObject {
  const result: JsonObject = { providers: {} }
  for (const [providerId, providerSnapshot] of Object.entries(snapshot.providers)) {
    const models = objectValue(providerSnapshot.models, `Snapshot provider ${providerId} models`)
    for (const [modelId, modelSnapshot] of Object.entries(models)) {
      const sourced = capabilityOverride(modelSnapshot)
      if (!sourced) continue
      result.providers[providerId] ??= { modelOverrides: {} }
      result.providers[providerId].modelOverrides[modelId] = sourced
    }
  }
  return result
}

export function mergeBundledModelCapabilityOverrides(
  modelsJson: unknown,
  snapshot: ModelCapabilitySnapshot,
  previousManaged: unknown = { providers: {} }
): JsonObject {
  const existing = objectValue(modelsJson, 'models.json')
  const result = structuredClone(existing)
  const providers = objectValue(result.providers ?? {}, 'models.json providers')
  result.providers = providers
  const sourced = sourcedOverrides(snapshot)
  const previous = objectValue(previousManaged, 'model capability provenance')
  const previousProviders = objectValue(previous.providers ?? {}, 'model capability provenance providers')
  // A provider models.json no longer defines must not be resurrected as a modelOverrides-only
  // shell: for a custom provider (no built-in catalog entry) pi composes that shell into a
  // ghost provider with zero models. Built-in providers (xai) keep their entry because pi
  // composes it over the built-in catalog — that entry is how their overrides reach Pi.
  // The provenance file is rewritten wholesale from the snapshot on every install, so
  // skipping here (including previousManaged cleanup for the absent provider) stays idempotent.
  const builtins: Set<string> = new Set(getBuiltinProviders())
  for (const providerId of new Set([...Object.keys(sourced.providers), ...Object.keys(previousProviders)])) {
    if (!(providerId in providers) && !builtins.has(providerId)) continue
    const sourcedModels = sourced.providers[providerId]?.modelOverrides ?? {}
    const previousModels = previousProviders[providerId]?.modelOverrides ?? {}
    for (const modelId of new Set([...Object.keys(sourcedModels), ...Object.keys(previousModels)])) {
      const sourcedModel = sourcedModels[modelId]
      const provider = objectValue(providers[providerId] ?? {}, `models.json provider ${providerId}`)
      providers[providerId] = provider
      const modelOverrides = objectValue(provider.modelOverrides ?? {}, `models.json provider ${providerId} modelOverrides`)
      provider.modelOverrides = modelOverrides
      const user = objectValue(modelOverrides[modelId] ?? {}, `models.json override ${providerId}/${modelId}`)
      const prior = previousProviders[providerId]?.modelOverrides?.[modelId]
      const merged = mergeManagedFields(user, sourcedModel, prior)
      if (merged === DELETE_MANAGED_VALUE) delete modelOverrides[modelId]
      else modelOverrides[modelId] = merged
    }
    if (Object.keys(providers[providerId].modelOverrides).length === 0) delete providers[providerId].modelOverrides
    if (Object.keys(providers[providerId]).length === 0) delete providers[providerId]
  }
  return result
}

async function tightenCanonicalSecretFileMode(path: string): Promise<void> {
  let stat
  try {
    stat = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (!stat.isFile()) return
  const noFollow = fsConstants.O_NOFOLLOW ?? 0
  let handle
  try {
    try {
      handle = await open(path, fsConstants.O_RDWR | noFollow)
    } catch (error) {
      if (!noFollow || !['EINVAL', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      handle = await open(path, fsConstants.O_RDWR)
    }
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) {
      throw new Error('canonical models path changed during permission tighten')
    }
    await handle.chmod(0o600)
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/**
 * A downstream product's agentDir may hold this file as a symlink into the shared
 * credentials directory (see `linkSharedCredentialFiles` below). `rename()` replaces
 * whatever sits at the destination path, symlink included, so an atomic writer must resolve
 * one hop through an existing symlink and write the real target instead — otherwise the very
 * first canonical write after linking would silently sever the shared file.
 */
async function resolveCanonicalWriteTarget(path: string): Promise<string> {
  try {
    const stat = await lstat(path)
    if (!stat.isSymbolicLink()) return path
    const linkTarget = await readlink(path)
    return isAbsolute(linkTarget) ? linkTarget : resolve(dirname(path), linkTarget)
  } catch {
    return path // missing: the write creates `path` itself, same as today.
  }
}

async function writeCanonicalSecretFile(path: string, contents: string): Promise<void> {
  const target = await resolveCanonicalWriteTarget(path)
  await mkdir(dirname(target), { recursive: true })
  const temporary = join(dirname(target), `.${basename(target)}-${process.pid}-${Date.now()}-${crypto.randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(contents, { encoding: 'utf8' })
      await handle.chmod(0o600)
    } finally {
      await handle.close()
    }
    await rename(temporary, target)
    await tightenCanonicalSecretFileMode(target)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Install the bundled capability layer before Pi ModelRuntime reads models.json. */
export async function installBundledModelCapabilityOverrides(
  profile: ElectronPiProfile,
  snapshotPath: string
): Promise<'updated' | 'unchanged'> {
  const modelsPath = join(profile.agentDir, 'models.json')
  const provenancePath = join(profile.agentDir, MODEL_CAPABILITY_PROVENANCE)
  await mkdir(profile.agentDir, { recursive: true })
  let original = ''
  try {
    original = await readFile(modelsPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  let current: unknown = { providers: {} }
  if (original) {
    try {
      current = JSON.parse(original)
    } catch (error) {
      throw new Error(`Failed to parse Electron Pi models.json: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const snapshot = parseSnapshot(await readFile(snapshotPath, 'utf8'))
  let previousManaged: unknown = { providers: {} }
  try {
    previousManaged = JSON.parse(await readFile(provenancePath, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Failed to read model capability provenance: ${error instanceof Error ? error.message : String(error)}`)
  }
  const managed = sourcedOverrides(snapshot)
  const merged = `${JSON.stringify(mergeBundledModelCapabilityOverrides(current, snapshot, previousManaged), null, 2)}\n`
  const provenance = `${JSON.stringify(managed, null, 2)}\n`
  let previousProvenance = ''
  try { previousProvenance = await readFile(provenancePath, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (original === merged && previousProvenance === provenance) {
    if (original) await tightenCanonicalSecretFileMode(modelsPath)
    if (previousProvenance) await tightenCanonicalSecretFileMode(provenancePath)
    return 'unchanged'
  }
  if (original !== merged) await writeCanonicalSecretFile(modelsPath, merged)
  else if (original) await tightenCanonicalSecretFileMode(modelsPath)
  if (previousProvenance !== provenance) await writeCanonicalSecretFile(provenancePath, provenance)
  else if (previousProvenance) await tightenCanonicalSecretFileMode(provenancePath)
  return 'updated'
}

export function resolveElectronPiProfile(userData: string): ElectronPiProfile {
  const agentDir = join(userData, 'pi-agent')
  return { agentDir, sessionsRoot: join(agentDir, 'sessions') }
}

/**
 * Login identity every product on this machine shares, so switching products never re-logs
 * in. These are read by the Pi child, which follows symlinks like any other process.
 *
 * `models.json` is deliberately absent. The canonical model catalog is machine-wide, not
 * per product: it stays in the shared profile and the backend is pointed at it there
 * (`PiBackendOptions.sharedProfileDir`). A per-product copy would fork the catalog, and a
 * per-product canonical directory makes a project's own models.json symlink foreign to
 * whichever product did not create it.
 */
export const SHARED_CREDENTIAL_FILE_NAMES = ['.env', 'auth.json'] as const

/**
 * Every product (PipiUI, and whatever is built on it) keeps its own `pi-agent` dir for
 * project list, settings, extension enablement, telemetry, and the agent index — but
 * `.env` / `auth.json` / `models.json` resolve to one shared credentials directory so a
 * fresh product install, or moving a product's userData, never forces a fresh login.
 *
 * Only ever adds a symlink for a name that does not already exist in `agentDir` — an
 * existing real file or an existing symlink (correct or not) is never touched. A missing or
 * unreadable shared file, or a missing/unreadable shared directory, is tolerated silently:
 * nothing is created, and the normal first-run login flow creates the file in `agentDir`
 * itself, in place, exactly as it does today without this function.
 */
export async function linkSharedCredentialFiles(agentDir: string, sharedCredentialsDir: string): Promise<void> {
  for (const name of SHARED_CREDENTIAL_FILE_NAMES) {
    await linkSharedCredentialFile(agentDir, sharedCredentialsDir, name).catch(() => undefined)
  }
}


async function linkSharedCredentialFile(agentDir: string, sharedCredentialsDir: string, name: string): Promise<void> {
  const dest = join(agentDir, name)
  try {
    await lstat(dest)
    return // a real file or an existing symlink is already there -- never touch it
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return // unreadable: tolerate, do nothing
  }
  const source = join(sharedCredentialsDir, name)
  let sourceStat
  try {
    sourceStat = await lstat(source)
  } catch {
    return // shared dir/file missing: let first-run login create `dest` in place
  }
  if (!sourceStat.isFile() && !sourceStat.isSymbolicLink()) return
  try {
    await mkdir(agentDir, { recursive: true })
    await symlink(source, dest)
  } catch {
    /* read-only agentDir, a concurrent writer, etc. -- tolerate, do nothing */
  }
}
