import { describe, expect, it } from 'vitest'
import { createFramePacer } from './frame-pacer.js'

function harness(framesPerWindow = 3, windowMs = 1000) {
  const sent: string[] = []
  let clock = 0
  const timers: Array<{ at: number; fn: () => void }> = []
  const pacer = createFramePacer({
    send: frame => { sent.push(frame) },
    framesPerWindow,
    windowMs,
    now: () => clock,
    schedule: (fn, ms) => { const entry = { at: clock + ms, fn }; timers.push(entry); return entry },
    cancel: handle => { const i = timers.indexOf(handle as never); if (i >= 0) timers.splice(i, 1) },
  })
  const advance = (ms: number) => {
    clock += ms
    for (const entry of [...timers].sort((a, b) => a.at - b.at)) {
      if (entry.at <= clock) { timers.splice(timers.indexOf(entry), 1); entry.fn() }
    }
  }
  return { sent, pacer, advance }
}

describe('frame pacer', () => {
  it('holds a burst under the window instead of handing it all to the socket', () => {
    const { sent, pacer } = harness(3)
    for (const frame of ['a', 'b', 'c', 'd', 'e']) pacer.push(frame)
    // The relay closes the socket at 1008 when the room's window is crossed, so
    // the burst must not reach it whole (§64).
    expect(sent).toEqual(['a', 'b', 'c'])
    expect(pacer.pending()).toBe(2)
  })

  it('sends every frame, in order, once the window moves on', () => {
    const { sent, pacer, advance } = harness(3)
    for (const frame of ['a', 'b', 'c', 'd', 'e']) pacer.push(frame)
    advance(1000)
    expect(sent).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(pacer.pending()).toBe(0)
  })

  it('drops the backlog when the socket is replaced, so a new link starts clean', () => {
    const { sent, pacer, advance } = harness(2)
    for (const frame of ['a', 'b', 'c', 'd']) pacer.push(frame)
    expect(sent).toEqual(['a', 'b'])
    pacer.reset()
    advance(5000)
    expect(sent).toEqual(['a', 'b'])
    expect(pacer.pending()).toBe(0)
  })
})
