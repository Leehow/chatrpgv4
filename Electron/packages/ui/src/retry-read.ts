/**
 * A failed read is not an answer (contract §62).
 *
 * Over a relay the host drops requests without dropping the socket, so a single
 * rejection says nothing about the thing being read. Writing a plausible value
 * in the catch — `thinkingLevel: 'off'`, every capability `false`, an empty
 * list — hands the person a confident lie and destroys whatever the shell
 * already knew. Three defects in this repo have had exactly that shape.
 *
 * `readWithRetry` gives a one-shot load the same quiet retries the extension
 * loader got in §54: transient failures cost nothing visible, and the caller is
 * only told when the retries are spent. It resolves `undefined` in that case,
 * which callers must treat as "still unknown" — never as a value.
 */
export const READ_RETRY_DELAYS_MS = [400, 1_200, 3_000, 6_000] as const

export type RetryReadOptions = {
  /** Stop retrying: the effect was cleaned up or the selection moved on. */
  cancelled?: () => boolean
  /** Called once, after the last retry fails. */
  onFailure?: (error: unknown) => void
  delaysMs?: readonly number[]
  schedule?: (fn: () => void, ms: number) => void
}

export async function readWithRetry<T>(
  read: () => Promise<T>,
  options: RetryReadOptions = {},
): Promise<T | undefined> {
  const delays = options.delaysMs ?? READ_RETRY_DELAYS_MS
  const schedule = options.schedule ?? ((fn, ms) => { setTimeout(fn, ms) })
  const cancelled = options.cancelled ?? (() => false)
  for (let attempt = 0; ; attempt += 1) {
    if (cancelled()) return undefined
    try {
      return await read()
    } catch (error) {
      if (cancelled()) return undefined
      if (attempt >= delays.length) {
        options.onFailure?.(error)
        return undefined
      }
      await new Promise<void>(resolve => schedule(resolve, delays[attempt]))
    }
  }
}
