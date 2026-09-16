import { describe, expect, it, vi } from 'vitest'
import { readWithRetry } from './retry-read'

const immediately = (fn: () => void) => { fn() }

describe('readWithRetry', () => {
  it('returns the value once a retry succeeds, and never invents one', async () => {
    let calls = 0
    const value = await readWithRetry(async () => {
      calls += 1
      if (calls < 3) throw new Error('transport request timed out')
      return 'low'
    }, { schedule: immediately })
    expect(value).toBe('low')
    expect(calls).toBe(3)
  })

  it('resolves undefined — not a plausible value — when the retries are spent', async () => {
    const onFailure = vi.fn()
    const value = await readWithRetry(async () => { throw new Error('transport request timed out') },
      { schedule: immediately, onFailure, delaysMs: [1, 1] })
    expect(value).toBeUndefined()
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  it('stops as soon as the caller says the read no longer matters', async () => {
    let calls = 0
    let cancelled = false
    const value = await readWithRetry(async () => {
      calls += 1
      cancelled = true
      throw new Error('transport request timed out')
    }, { schedule: immediately, cancelled: () => cancelled })
    expect(value).toBeUndefined()
    expect(calls).toBe(1)
  })
})
