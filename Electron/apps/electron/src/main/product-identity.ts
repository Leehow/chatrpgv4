import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * Which product this Electron build is. PipiUI (this repo) ships `product.json` at the
 * workspace root as the base identity. A downstream product built on the base (Pipi Hydra,
 * Pipi Paper, …) sets `PIPIUI_PRODUCT_CONFIG=<path>` to its own file instead of forking core
 * code — the loader below is the only place that reads it.
 */
export interface ProductIdentity {
  /** Semantic slug, e.g. `pipiui`, `pipi-hydra`, `pipi-paper`. */
  id: string
  /** Dock / menu bar / window title. Passed to `app.setName`. */
  name: string
  /** electron-builder `build.appId`. Kept here only so a test can assert packaging agrees. */
  appId: string
  /** Directory name under `app.getPath('appData')` this product's userData lives in. */
  userDataDirname: string
  /**
   * Product pack (an extension id) a project runs unless the user says
   * otherwise. Absent means plain base: every bundled capability extension is
   * on and no form-specific layout applies. A downstream product names its own
   * pack here — it is the one line that turns this base into that product.
   */
  defaultPack?: string
  /**
   * Hard cap on nested subagent dispatch for this product (`PIPIUI_AGENT_MAX_DEPTH`).
   * 0 = nobody may dispatch; 1 = only the main session (Boss) may; 2 = Boss plus
   * one nested worker layer (the runtime absolute max). Absent keeps the runtime
   * default of 2. The kernel does not special-case any product id.
   */
  agentMaxDepth?: number
  /**
   * Directory (relative to `appData`) holding the `.env` / `auth.json` / `models.json` every
   * product on this machine shares, so switching products or moving userData never forces a
   * fresh login. See `pi-profile.ts`'s `linkSharedCredentialFiles`.
   */
  sharedCredentialsDir: string
  /**
   * Optional PNG for the dock and window icon, given in the config file relative to that
   * file (so a downstream product keeps its artwork beside its `product.json` instead of
   * inside the base). A packaged build takes its icon from the app bundle; this is what
   * gives a product its own icon when it runs from a base checkout.
   */
  icon?: string
}

const PRODUCT_ID_RE = /^[a-z][a-z0-9-]*$/

function requireString(value: unknown, field: string, sourcePath: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Product identity at ${sourcePath} must have a non-empty string "${field}"`)
  }
  return value
}

/** Matches `ABSOLUTE_MAX_SUBAGENT_DEPTH` in the orchestration runtime policy. */
const AGENT_MAX_DEPTH_CAP = 2

function requireAgentMaxDepth(value: unknown, sourcePath: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > AGENT_MAX_DEPTH_CAP) {
    throw new Error(
      `Product identity at ${sourcePath}: "agentMaxDepth" must be an integer 0-${AGENT_MAX_DEPTH_CAP} when present`,
    )
  }
  return value
}

export function parseProductIdentity(raw: unknown, sourcePath: string): ProductIdentity {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Product identity at ${sourcePath} must be a JSON object`)
  }
  const value = raw as Record<string, unknown>
  const id = requireString(value.id, 'id', sourcePath)
  if (!PRODUCT_ID_RE.test(id)) {
    throw new Error(`Product identity at ${sourcePath}: "id" must be a semantic slug matching ${PRODUCT_ID_RE} (got ${JSON.stringify(id)})`)
  }
  if (value.icon !== undefined && (typeof value.icon !== 'string' || value.icon.length === 0)) {
    throw new Error(`Product identity at ${sourcePath}: "icon" must be a non-empty string when present`)
  }
  return {
    id,
    name: requireString(value.name, 'name', sourcePath),
    appId: requireString(value.appId, 'appId', sourcePath),
    userDataDirname: requireString(value.userDataDirname, 'userDataDirname', sourcePath),
    ...(value.defaultPack === undefined ? {} : { defaultPack: requireString(value.defaultPack, 'defaultPack', sourcePath) }),
    ...(value.agentMaxDepth === undefined ? {} : { agentMaxDepth: requireAgentMaxDepth(value.agentMaxDepth, sourcePath) }),
    sharedCredentialsDir: requireString(value.sharedCredentialsDir, 'sharedCredentialsDir', sourcePath),
    ...(typeof value.icon === 'string' ? { icon: resolve(dirname(sourcePath), value.icon) } : {})
  }
}

export interface ProductConfigPathLookup {
  /** `app.isPackaged`. */
  packaged: boolean
  /** `process.resourcesPath`. */
  resourcesPath: string
  /** `__dirname` of the built main bundle (`apps/electron/out/main`). */
  dirname: string
}

/**
 * Default `product.json` location when `PIPIUI_PRODUCT_CONFIG` is unset: the packaged
 * `product.json` extraResource, or (dev) the workspace-root file next to this repo's
 * `resources/runtime` — same packaged/dev split as `resolveRuntimeAssets`.
 */
export function defaultProductConfigPath(lookup: ProductConfigPathLookup): string {
  if (lookup.packaged) return join(lookup.resourcesPath, 'product.json')
  // apps/electron/out/main -> out -> electron -> apps -> Electron.
  return join(lookup.dirname, '..', '..', '..', '..', 'product.json')
}

export interface LoadProductIdentityOptions extends ProductConfigPathLookup {
  env: NodeJS.ProcessEnv
}

export function loadProductIdentity(options: LoadProductIdentityOptions): ProductIdentity {
  const override = options.env.PIPIUI_PRODUCT_CONFIG
  const path = override && override.trim() ? override : defaultProductConfigPath(options)
  let source: string
  try {
    source = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(`Failed to read product identity from ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch (error) {
    throw new Error(`Failed to parse product identity at ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return parseProductIdentity(raw, path)
}
