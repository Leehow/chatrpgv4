import { accessSync, constants, statSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import type { PiBackendOptions, PiCommand, RuntimeAssets } from '@pipi/pi-backend'
import { assertWritableLocation, compiledEnvironment, PI_ENTRIES, resourcePath, standaloneRuntime } from '../../../../../runtime/deployment.mjs'

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
  cocRuntime?: PiBackendOptions['cocRuntime']
  agentDir: string
  sessionsRoot: string
  runtimeRoot: string
  authNodePath?: string
  /** The vendored Pi's package entry (ADR-0006): what pi-backend imports in-process, the same copy the Keeper runs. */
  piModule: string
}
export const EMBEDDED_NODE_VERSION = '24.19.0'
export const PI_RUNTIME_PACKAGE = '@earendil-works/pi-coding-agent' as const
export const MANAGED_RUNTIME_PACKAGE_VERSIONS = { [PI_RUNTIME_PACKAGE]: '0.87.0' } as const
export const UPDATE_CENTER_RUNTIME_PACKAGE_VERSIONS = MANAGED_RUNTIME_PACKAGE_VERSIONS

function sourceNode(env: NodeJS.ProcessEnv): string {
  const candidates = env.PI_COC_NODE_EXECUTABLE ? [env.PI_COC_NODE_EXECUTABLE]
    : process.versions.electron ? (env.PATH || '').split(delimiter).filter(Boolean).map(path => join(path, 'node')) : [process.execPath]
  for (const candidate of candidates) {
    try {if (statSync(candidate).isFile()) {accessSync(candidate, constants.X_OK); return resolve(candidate)}} catch {}
  }
  throw new Error('Source COC startup requires Node on its captured PATH or PI_COC_NODE_EXECUTABLE')
}

/** PipiCOC uses the branch's launcher; it never downloads or falls back to another Pi. */
export function resolveRuntimeAssets(lookup: AssetLookup): ResolvedAssets {
  const electronRoot = resolve(lookup.dirname, '..', '..', '..', '..')
  const mode = lookup.env.PI_COC_MODE === 'setup' ? 'setup' : 'play'
  if (lookup.packaged) {
    if (!lookup.userData) throw new Error('Packaged COC runtime requires app.userData')
    const deployment = standaloneRuntime(lookup.resourcesPath)
    const repo = deployment.resourceRoot
    const immutableRoot = basename(dirname(lookup.resourcesPath)) === 'Contents' ? resolve(lookup.resourcesPath, '../..') : lookup.resourcesPath
    const profile = assertWritableLocation(immutableRoot, join(lookup.userData, 'pi-coc'))
    const home = assertWritableLocation(immutableRoot, lookup.env.PI_COC_HOME || profile)
    const agentDir = assertWritableLocation(immutableRoot, join(profile, 'agent'))
    const sessionsRoot = assertWritableLocation(immutableRoot, join(agentDir, 'ui-sessions', mode))
    const runtimeRoot = assertWritableLocation(immutableRoot, join(lookup.userData, 'runtime'))
    const env = {...compiledEnvironment(deployment, lookup.env), PI_COC_HOME: home, PI_CODING_AGENT_DIR: agentDir}
    return {
      sourceRoot: deployment.entrypoints.hostAssets,
      managedNodeModulesRoot: join(repo, 'node_modules'),
      agentDir, sessionsRoot, runtimeRoot, authNodePath: deployment.node, piModule: deployment.entrypoints.piModule,
      cocRuntime: {layout: 'compiled', backend: 'typescript', nodeExecutable: deployment.node,
        contentRoot: join(repo, 'content'), kernelEntrypoint: deployment.entrypoints.kernel,
        preparationEntrypoint: deployment.entrypoints.preparation},
      piCommand: {executable: deployment.node, prefixArgs: [deployment.entrypoints.rpc], piPath: deployment.entrypoints.pi, env},
    }
  }
  const repo = resolve(electronRoot, '..')
  const launcher = join(repo, 'pipicoc', 'rpc')
  accessSync(launcher, constants.X_OK)
  const agentDir = join(repo, '.pi', 'coc-agent')
  const nodePath = sourceNode(lookup.env)
  return {
    sourceRoot: join(repo, 'build', 'host', 'runtime'),
    managedNodeModulesRoot: join(repo, 'node_modules'),
    agentDir, sessionsRoot: join(agentDir, 'ui-sessions', mode),
    runtimeRoot: lookup.env.PIPIUI_RUNTIME_ROOT || join(lookup.userData || repo, 'runtime'),
    authNodePath: nodePath,
    piModule: join(repo, PI_ENTRIES.piModule),
    cocRuntime: {layout: 'source', nodeExecutable: nodePath},
    piCommand: {
      executable: launcher,
      piPath: join(repo, PI_ENTRIES.pi),
      env: {
        PI_CODING_AGENT_DIR: agentDir,
        PI_COC_RESOURCE_ROOT: repo, PI_COC_LAYOUT: 'source',
        PI_COC_HOME: lookup.env.PI_COC_HOME || repo,
        PI_COC_NODE_EXECUTABLE: nodePath
      }
    }
  }
}

/** Install shipped UI code before the backend synchronously scans a fresh profile. */
export function installRuntimeProfile(assets: ResolvedAssets, environment: NodeJS.ProcessEnv): Promise<void> {
  const root = assets.piCommand?.env?.PI_COC_RESOURCE_ROOT
  if (!root || !assets.authNodePath) return Promise.reject(new Error('COC profile installation requires its captured runtime and Node'))
  const installer = resourcePath(root, 'pipicoc/install')
  const env = {...environment, ...assets.piCommand?.env,
    PI_CODING_AGENT_DIR: assets.agentDir, PI_COC_NODE_EXECUTABLE: assets.authNodePath}
  return new Promise((accept, reject) => {
    // The installer execs the selected Node and performs local synchronous asset copies only.
    execFile('/bin/bash', [installer], {cwd: root, env, timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024},
      (error, _stdout, stderr) => {
        if (error) reject(new Error(`COC profile asset installation failed: ${stderr.trim() || error.message}`))
        else accept()
      })
  })
}
