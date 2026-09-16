/**
 * Keeps the host's outbound frames inside what the link accepts (contract §64).
 *
 * The relay counts frames per room, not per peer, and closes a socket with 1008
 * when the count crosses its window. A streaming turn pushed 129 frames in a
 * second — one per delta — so the relay killed the *browser's* socket seven
 * times in a single turn, for traffic the host produced. The browser reconnects
 * in under a second, which is why play mostly worked; what did not survive were
 * the frames in flight, and a turn whose completion event was among them sat at
 * 「运行中」 forever with no error and no way to stop it.
 *
 * This is a queue, not a filter: every frame is sent, in order. It only refuses
 * to hand the socket more than `framesPerWindow` of them per window, so a burst
 * is spread over the next few hundred milliseconds instead of being destroyed.
 */
export type FramePacerOptions = {
  send: (frame: string) => void
  /** Frames allowed per window. Stay clearly under the relay's own ceiling. */
  framesPerWindow?: number
  windowMs?: number
  now?: () => number
  schedule?: (fn: () => void, ms: number) => unknown
  cancel?: (handle: unknown) => void
}

export type FramePacer = {
  push: (frame: string) => void
  /** Queue depth, for tests and telemetry. */
  pending: () => number
  /** The socket is gone: a new one rebinds with a fresh queue. */
  reset: () => void
}

export const RELAY_FRAME_BUDGET = 90
export const RELAY_FRAME_WINDOW_MS = 1_000

export function createFramePacer(options: FramePacerOptions): FramePacer {
  const limit = options.framesPerWindow ?? RELAY_FRAME_BUDGET
  const windowMs = options.windowMs ?? RELAY_FRAME_WINDOW_MS
  const now = options.now ?? (() => Date.now())
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms))
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as never))
  const queue: string[] = []
  let sentAt: number[] = []
  let timer: unknown = null

  const prune = (at: number) => { sentAt = sentAt.filter(stamp => at - stamp < windowMs) }

  const drain = () => {
    timer = null
    const at = now()
    prune(at)
    while (queue.length && sentAt.length < limit) {
      options.send(queue.shift()!)
      sentAt.push(at)
    }
    if (!queue.length) return
    // The window's oldest send is what frees the next slot.
    const wait = Math.max(1, windowMs - (at - sentAt[0]))
    timer = schedule(drain, wait)
  }

  return {
    push(frame) {
      queue.push(frame)
      if (timer === null) drain()
    },
    pending: () => queue.length,
    reset() {
      queue.length = 0
      sentAt = []
      if (timer !== null) { cancel(timer); timer = null }
    },
  }
}
