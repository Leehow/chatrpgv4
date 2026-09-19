import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import errorSource from '../../../../../content/ui/en/errors.json'
import {
  createShellDiagnosticLog, installShellRecovery, SHELL_LOG_MAX_BYTES, SHELL_STABLE_MS,
  shellErrorNotice, shellErrorWordsFromAnswer,
} from './shell-recovery.js'

class Surface extends EventEmitter {
  destroyed = false
  isDestroyed() { return this.destroyed }
}

function fixture(load = vi.fn((): Promise<unknown> => Promise.resolve())) {
  vi.useFakeTimers()
  const contents = new Surface()
  const window = new Surface()
  const app = new EventEmitter()
  let quitting = false
  const log = vi.fn()
  const showError = vi.fn((): void | Promise<unknown> => {})
  const recovery = installShellRecovery({
    contents, window, app, load, log, showError, isQuitting: () => quitting,
  })
  recovery.load()
  const crash = (reason = 'crashed') => contents.emit('render-process-gone', {}, { reason, exitCode: 17 })
  const failLoad = (mainFrame = true, code = -6) => contents.emit('did-fail-load', {}, code, 'secret description', 'https://secret.example/?token=private', mainFrame)
  return { contents, window, app, load, log, showError, recovery, crash, failLoad, quit: () => { quitting = true } }
}

const tempDirs: string[] = []
afterEach(() => {
  vi.useRealTimers()
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('shell renderer failure containment', () => {
  it('reloads the canonical shell once on the same contents, preserving crash metadata', async () => {
    const f = fixture()
    f.crash()
    expect(f.load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.load).toHaveBeenCalledTimes(2)
    expect(f.log).toHaveBeenCalledWith({ event: 'renderer-gone', reason: 'crashed', exitCode: 17 })
    expect(f.log).toHaveBeenCalledWith({ event: 'retry-started' })
    expect(f.showError).not.toHaveBeenCalled()
  })

  it('stops on a second crash even after did-finish-load and reports only once per burst', async () => {
    const f = fixture()
    f.crash()
    await vi.advanceTimersByTimeAsync(0)
    f.contents.emit('did-finish-load')
    await vi.advanceTimersByTimeAsync(SHELL_STABLE_MS - 1)
    f.crash('oom')
    f.crash()
    await vi.advanceTimersByTimeAsync(SHELL_STABLE_MS * 2)
    expect(f.load).toHaveBeenCalledTimes(2)
    expect(f.showError).toHaveBeenCalledOnce()
    expect(f.log).toHaveBeenCalledWith({ event: 'retry-stopped' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('resets its budget only after 60 seconds of stable successful loading', async () => {
    const f = fixture()
    f.crash()
    await vi.advanceTimersByTimeAsync(0)
    // Elapsed time without a successful load does not restore the budget.
    await vi.advanceTimersByTimeAsync(SHELL_STABLE_MS * 2)
    expect(f.log).not.toHaveBeenCalledWith({ event: 'stable' })
    f.contents.emit('did-finish-load')
    await vi.advanceTimersByTimeAsync(SHELL_STABLE_MS)
    f.crash()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.load).toHaveBeenCalledTimes(3)
    expect(f.showError).not.toHaveBeenCalled()
  })

  it('cancels the stable interval when a new load starts', async () => {
    const f = fixture()
    f.crash()
    await vi.advanceTimersByTimeAsync(0)
    f.contents.emit('did-finish-load')
    await vi.advanceTimersByTimeAsync(SHELL_STABLE_MS - 1)
    f.contents.emit('did-start-loading')
    await vi.advanceTimersByTimeAsync(SHELL_STABLE_MS)
    f.crash()
    expect(f.showError).toHaveBeenCalledOnce()
  })

  it.each(['close', 'closed', 'destroyed', 'before-quit', 'dispose'] as const)('cancels pending retry and removes listeners on %s', async event => {
    const f = fixture()
    f.crash()
    if (event === 'dispose') f.recovery.dispose()
    else if (event === 'before-quit') f.app.emit(event)
    else if (event === 'destroyed') { f.contents.destroyed = true; f.contents.emit(event) }
    else f.window.emit(event)
    f.crash()
    await vi.advanceTimersByTimeAsync(SHELL_STABLE_MS)
    expect(f.load).toHaveBeenCalledTimes(1)
    expect(f.showError).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(f.contents.eventNames()).toEqual([])
    expect(f.window.eventNames()).toEqual([])
    expect(f.app.eventNames()).toEqual([])
  })

  it.each(['quitting', 'window', 'contents'] as const)('checks %s again before executing pending recovery', async state => {
    const f = fixture()
    f.crash()
    if (state === 'quitting') f.quit()
    else f[state].destroyed = true
    await vi.advanceTimersByTimeAsync(0)
    expect(f.load).toHaveBeenCalledTimes(1)
    expect(f.showError).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels stable timers on disposal and ignores later events', async () => {
    const f = fixture()
    f.contents.emit('did-finish-load')
    f.recovery.dispose()
    f.contents.emit('did-finish-load')
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(SHELL_STABLE_MS)
    expect(f.log).not.toHaveBeenCalledWith({ event: 'stable' })
  })

  it('ignores subframe failures and ERR_ABORTED but recovers a main-frame failure', async () => {
    const f = fixture()
    f.failLoad(false)
    f.failLoad(true, -3)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.load).toHaveBeenCalledTimes(1)
    expect(f.log).not.toHaveBeenCalled()
    f.failLoad()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.load).toHaveBeenCalledTimes(2)
    f.failLoad()
    expect(f.showError).toHaveBeenCalledOnce()
    expect(f.log).toHaveBeenCalledWith({ event: 'load-failed', errorCode: -6 })
    expect(JSON.stringify(f.log.mock.calls)).not.toContain('secret')
  })

  it('handles load promise rejection without unhandled rejection, retrying once', async () => {
    const load = vi.fn(() => Promise.reject(Object.assign(new Error('secret URL'), { errno: -6 })))
    const f = fixture(load)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(2)
    expect(f.showError).toHaveBeenCalledOnce()
    expect(f.log.mock.calls.filter(([row]) => row.event === 'load-failed')).toHaveLength(2)
    expect(JSON.stringify(f.log.mock.calls)).not.toContain('secret')
  })

  it('ignores aborted load promises and catches synchronous load failures', async () => {
    const aborted = fixture(vi.fn(() => Promise.reject({ code: 'ERR_ABORTED' })))
    await vi.advanceTimersByTimeAsync(0)
    expect(aborted.load).toHaveBeenCalledTimes(1)
    expect(aborted.log).not.toHaveBeenCalled()
    aborted.recovery.dispose()
    const failed = fixture(vi.fn(() => { throw new Error('secret') }))
    await vi.advanceTimersByTimeAsync(1)
    expect(failed.load).toHaveBeenCalledTimes(2)
    expect(failed.showError).toHaveBeenCalledOnce()
  })

  it('does not count did-fail-load plus its promise rejection as two failures', async () => {
    let reject!: (reason: unknown) => void
    const load = vi.fn((): Promise<unknown> => Promise.resolve())
      .mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    const f = fixture(load)
    f.failLoad()
    reject({ errno: -6 })
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(2)
    expect(f.showError).not.toHaveBeenCalled()
    expect(f.log.mock.calls.filter(([row]) => row.event === 'load-failed')).toHaveLength(1)
  })

  it('ignores an old load rejection after a renderer crash/reload', async () => {
    let reject!: (reason: unknown) => void
    const load = vi.fn((): Promise<unknown> => Promise.resolve())
      .mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    const f = fixture(load)
    f.crash()
    await vi.advanceTimersByTimeAsync(0)
    reject(new Error('secret URL'))
    await vi.advanceTimersByTimeAsync(0)
    expect(f.showError).not.toHaveBeenCalled()
    expect(f.log.mock.calls.filter(([row]) => row.event === 'load-failed')).toHaveLength(0)
    f.failLoad()
    expect(f.log).toHaveBeenCalledWith({ event: 'load-failed', errorCode: -6 })
    expect(f.showError).toHaveBeenCalledOnce()
  })

  it('never shows an error from a load rejection settling after close', async () => {
    let reject!: (reason: unknown) => void
    const f = fixture(vi.fn(() => new Promise((_resolve, fail) => { reject = fail })))
    f.window.emit('close')
    reject(new Error('late failure'))
    await vi.advanceTimersByTimeAsync(0)
    expect(f.showError).not.toHaveBeenCalled()
    expect(f.load).toHaveBeenCalledTimes(1)
  })

  it('contains diagnostic and native notice errors without another retry', async () => {
    const f = fixture()
    f.log.mockImplementation(() => { throw new Error('disk failure') })
    f.showError.mockImplementation(() => Promise.reject(new Error('dialog failure')))
    f.crash()
    await vi.advanceTimersByTimeAsync(0)
    f.crash()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.log).toHaveBeenCalledWith({ event: 'notice-failed' })
    expect(f.load).toHaveBeenCalledTimes(2)
  })
})

describe('shell diagnostics and existing UI words', () => {
  it('rotates metadata-only JSONL at 256 KiB with just one backup', () => {
    const root = mkdtempSync(join(tmpdir(), 'shell-recovery-'))
    tempDirs.push(root)
    const log = createShellDiagnosticLog(root)
    for (let i = 0; i < 7000; i++) log.write({
      event: 'renderer-gone', reason: 'https://secret.example/?token=private', exitCode: 17,
      url: 'secret', body: 'secret', token: 'secret',
    } as any)
    expect(readdirSync(join(root, 'logs')).sort()).toEqual(['shell-recovery.jsonl', 'shell-recovery.jsonl.1'])
    for (const path of [log.path, `${log.path}.1`]) {
      expect(statSync(path).size).toBeLessThanOrEqual(SHELL_LOG_MAX_BYTES)
      const text = readFileSync(path, 'utf8')
      expect(text).not.toMatch(/secret|token|https|body|url/)
      const rows = text.trim().split('\n').map(line => JSON.parse(line))
      expect(rows[0]).toEqual({ timestamp: expect.any(String), event: 'renderer-gone', reason: 'unknown', exitCode: 17 })
    }
  })

  it('does not throw when its log directory cannot be created', () => {
    const root = mkdtempSync(join(tmpdir(), 'shell-recovery-'))
    tempDirs.push(root)
    writeFileSync(join(root, 'logs'), 'not a directory')
    expect(() => createShellDiagnosticLog(root).write({ event: 'retry-started' })).not.toThrow()
  })

  it('uses already projected words or the single existing English source without requesting a lane', () => {
    const words = shellErrorWordsFromAnswer({ data: { ui: { words: { errors: { unknown: 'projected failure', details: 'projected details' } } } } })
    expect(shellErrorNotice('/app/logs/shell-recovery.jsonl', words)).toEqual({
      message: 'projected failure', detail: 'shell_renderer_unavailable\n\nprojected details\n/app/logs/shell-recovery.jsonl',
    })
    expect(shellErrorWordsFromAnswer(undefined)).toBeUndefined()
    expect(shellErrorWordsFromAnswer({ data: { ui: { words: { errors: { unknown: 1 } } } } })).toBeUndefined()
    expect(shellErrorNotice('/app/logs/shell-recovery.jsonl').message).toBe(errorSource.unknown)
    expect(shellErrorNotice('/app/logs/shell-recovery.jsonl').detail).toContain(errorSource.details)
  })
})
