import { accessSync, constants } from 'node:fs'
import { join, resolve } from 'node:path'
import type { PiCommand, RuntimeAssets } from '@pipi/pi-backend'

export interface AssetLookup {
  packaged: boolean
  resourcesPath: string
  dirname: string
  env: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  arch?: string
  userData?: string
}
export interface ResolvedAssets extends RuntimeAssets {
  piCommand?: PiCommand
  managedNodeModulesRoot?: string
}
export const EMBEDDED_NODE_VERSION = '24.19.0'
export const PI_RUNTIME_PACKAGE = '@earendil-works/pi-coding-agent' as const
export const MANAGED_RUNTIME_PACKAGE_VERSIONS = { [PI_RUNTIME_PACKAGE]: '0.85.1' } as const
export const UPDATE_CENTER_RUNTIME_PACKAGE_VERSIONS = MANAGED_RUNTIME_PACKAGE_VERSIONS

/** PipiCOC uses the branch's launcher; it never downloads or falls back to another Pi. */
export function resolveRuntimeAssets(lookup: AssetLookup): ResolvedAssets {
  if (lookup.packaged) throw new Error('PipiCOC currently runs from its source checkout; packaged delivery is not configured.')
  const electronRoot = resolve(lookup.dirname, '..', '..', '..', '..')
  const repo = resolve(electronRoot, '..')
  const launcher = join(repo, 'pipicoc', 'rpc')
  accessSync(launcher, constants.X_OK)
  return {
    sourceRoot: join(electronRoot, 'resources', 'runtime'),
    managedNodeModulesRoot: join(repo, 'node_modules'),
    piCommand: {
      executable: launcher,
      piPath: join(repo, 'node_modules', '.bin', 'pi'),
      env: { PI_CODING_AGENT_DIR: join(repo, '.pi', 'coc-agent') }
    }
  }
}
