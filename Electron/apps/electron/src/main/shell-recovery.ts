import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { EventEmitter } from 'node:events'
import errorSource from '../../../../../content/ui/en/errors.json'

export const SHELL_STABLE_MS = 60_000
export const SHELL_LOG_MAX_BYTES = 256 * 1024

type Events = Pick<EventEmitter, 'on' | 'removeListener'>
type ShellContents = Events & { isDestroyed(): boolean }
type ShellWindow = Events & { isDestroyed(): boolean }
export type ShellDiagnostic = {
  event: 'renderer-gone' | 'load-failed' | 'retry-started' | 'retry-stopped' | 'load-finished' | 'stable' | 'notice-failed'
  reason?: string
  exitCode?: number
  errorCode?: number
}
const EXIT_REASONS = new Set(['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure', 'memory-eviction'])
const EVENTS = new Set(['renderer-gone', 'load-failed', 'retry-started', 'retry-stopped', 'load-finished', 'stable', 'notice-failed'])

/** Only allowlisted metadata reaches disk; never serialize Electron errors or URLs. */
export function createShellDiagnosticLog(userData: string) {
  const path = join(userData, 'logs', 'shell-recovery.jsonl')
  return {
    path,
    write(entry: ShellDiagnostic): void {
      try {
        const row = {
          timestamp: new Date().toISOString(),
          event: EVENTS.has(entry.event) ? entry.event : 'unknown',
          ...(entry.reason !== undefined ? { reason: EXIT_REASONS.has(entry.reason) ? entry.reason : 'unknown' } : {}),
          ...(Number.isSafeInteger(entry.exitCode) ? { exitCode: entry.exitCode } : {}),
          ...(Number.isSafeInteger(entry.errorCode) ? { errorCode: entry.errorCode } : {}),
        }
        const line = `${JSON.stringify(row)}\n`
        mkdirSync(dirname(path), { recursive: true })
        let size = 0
        try { size = statSync(path).size } catch { /* first entry */ }
        if (size + Buffer.byteLength(line) > SHELL_LOG_MAX_BYTES) renameSync(path, `${path}.1`)
        appendFileSync(path, line, { mode: 0o600 })
      } catch { /* diagnostics must never prevent recovery */ }
    },
  }
}

export type ShellErrorWords = { unknown: string; details: string }
/** Cache only words already returned by the existing UI projection, never start a lane. */
export function shellErrorWordsFromAnswer(answer: unknown): ShellErrorWords | undefined {
  const value = answer as { data?: { ui?: { words?: { errors?: Partial<ShellErrorWords> } } }; ui?: { words?: { errors?: Partial<ShellErrorWords> } } } | null
  const words = value?.data?.ui?.words?.errors ?? value?.ui?.words?.errors
  return typeof words?.unknown === 'string' && typeof words.details === 'string'
    ? { unknown: words.unknown, details: words.details } : undefined
}

export function shellErrorNotice(logPath: string, words: ShellErrorWords = errorSource) {
  return {
    message: words.unknown,
    detail: `shell_renderer_unavailable\n\n${words.details}\n${logPath}`,
  }
}

/** Recover only the shell document on the same webContents. This owns no backend/RPC. */
export function installShellRecovery(options: {
  contents: ShellContents
  window: ShellWindow
  app: Events
  isQuitting(): boolean
  load(): Promise<unknown>
  log(entry: ShellDiagnostic): void
  showError(): void | Promise<unknown>
}) {
  const { contents, window, app } = options
  let disposed = false
  let usedRetry = false
  let stopped = false
  let attempt: { failed: boolean } | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let stableTimer: ReturnType<typeof setTimeout> | undefined
  const log = (entry: ShellDiagnostic) => {
    try { options.log(entry) } catch { /* an optional sink cannot break recovery */ }
  }
  const cancelStable = () => { clearTimeout(stableTimer); stableTimer = undefined }
  const live = () => !disposed && !options.isQuitting() && !window.isDestroyed() && !contents.isDestroyed()
  const dispose = () => {
    if (disposed) return
    disposed = true
    clearTimeout(retryTimer)
    retryTimer = undefined
    cancelStable()
    for (const [target, event, listener] of listeners) target.removeListener(event, listener)
  }
  const fail = () => {
    cancelStable()
    if (!live()) { dispose(); return }
    if (stopped) return
    if (usedRetry) {
      stopped = true
      clearTimeout(retryTimer)
      retryTimer = undefined
      log({ event: 'retry-stopped' })
      try { void Promise.resolve(options.showError()).catch(() => log({ event: 'notice-failed' })) }
      catch { log({ event: 'notice-failed' }) }
      return
    }
    usedRetry = true
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      if (!live()) { dispose(); return }
      log({ event: 'retry-started' })
      load()
    }, 0)
  }
  const loadFailure = (current: typeof attempt, errorCode?: number) => {
    if (!live()) { dispose(); return }
    if (errorCode === -3 || current?.failed) return
    if (current) current.failed = true
    log({ event: 'load-failed', errorCode })
    fail()
  }
  const load = () => {
    if (!live()) { dispose(); return }
    const current = { failed: false }
    attempt = current
    cancelStable()
    try {
      void Promise.resolve(options.load()).catch((error: unknown) => {
        // A crash/load event may already account for this same failed navigation.
        if (attempt !== current) return
        const value = error as { errno?: unknown; code?: unknown } | null
        const code = value?.code === 'ERR_ABORTED' ? -3 : typeof value?.errno === 'number' ? value.errno : undefined
        loadFailure(current, code)
      })
    } catch { loadFailure(current) }
  }
  const onGone = (_event: unknown, details: { reason: string; exitCode: number }) => {
    if (!live()) { dispose(); return }
    log({ event: 'renderer-gone', reason: details.reason, exitCode: details.exitCode })
    if (attempt) attempt.failed = true
    cancelStable()
    // Any exit of a still-owned live shell is unexpected, even a clean process exit.
    fail()
  }
  const onLoadFailed = (_event: unknown, code: number, _description: string, _url: string, mainFrame: boolean) => {
    if (mainFrame && code !== -3) loadFailure(attempt, code)
  }
  const onFinished = () => {
    if (!live()) { dispose(); return }
    if (stopped || attempt?.failed) return
    log({ event: 'load-finished' })
    cancelStable()
    stableTimer = setTimeout(() => {
      stableTimer = undefined
      if (!live()) { dispose(); return }
      usedRetry = false
      log({ event: 'stable' })
    }, SHELL_STABLE_MS)
  }
  const listeners: [Events, string, (...args: any[]) => void][] = [
    [contents, 'render-process-gone', onGone],
    [contents, 'did-fail-load', onLoadFailed],
    [contents, 'did-finish-load', onFinished],
    [contents, 'did-start-loading', cancelStable],
    [contents, 'destroyed', dispose],
    [window, 'close', dispose],
    [window, 'closed', dispose],
    [app, 'before-quit', dispose],
  ]
  for (const [target, event, listener] of listeners) target.on(event, listener)
  return { load, dispose }
}
