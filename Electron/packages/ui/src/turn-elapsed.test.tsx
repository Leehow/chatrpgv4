// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MessageView } from './Transcript'
import { applyStreamEvent, historyMessages, type ChatMessage } from './transcript-model'
import { formatTurnElapsed, turnElapsedMs } from './turn-elapsed'

afterEach(cleanup)

const user = (timestamp: number, content = '我推开门'): ChatMessage => ({ id: `u${timestamp}`, role: 'user', content, timestamp })
const steps = (timestamp: number): ChatMessage => ({ id: `s${timestamp}`, role: 'assistant', content: '', timestamp, activities: [] })
const card = (timestamp: number, marked = '门开了。'): ChatMessage => ({ id: `c${timestamp}`, role: 'assistant', content: '', timestamp, presentation: { renderer: 'coc-mechanics', details: { mechanics: [], marked_text: marked } } })

describe('turnElapsedMs', () => {
  it('runs from the player message to the delivery card that put the prose on screen', () => {
    const messages = [user(1_000), steps(5_000), card(33_000)]
    expect(turnElapsedMs(messages, 2)).toBe(32_000)
  })

  it('does not count rows after the prose that show none', () => {
    const messages = [user(1_000), card(20_000), steps(90_000)]
    expect(turnElapsedMs(messages, 2)).toBe(19_000)
  })

  it('takes the last prose of the turn when the reply arrived in more than one piece', () => {
    const messages = [user(1_000), card(20_000), { ...steps(41_000), content: '雨还在下。' }]
    expect(turnElapsedMs(messages, 2)).toBe(40_000)
  })

  it('has no wait for a turn no player message opened', () => {
    expect(turnElapsedMs([card(5_000)], 0)).toBeUndefined()
    expect(turnElapsedMs([user(1_000, '[subagent-done] reader'), card(5_000)], 1)).toBeUndefined()
  })

  it('has no wait for a turn that put no prose on screen', () => {
    expect(turnElapsedMs([user(1_000), steps(9_000)], 1)).toBeUndefined()
  })

  it('stops at the turn boundary rather than reading the previous turn', () => {
    const messages = [user(1_000), card(10_000), user(50_000), steps(70_000)]
    expect(turnElapsedMs(messages, 3)).toBeUndefined()
  })

  it('reads a streamed reply at its last delta, not where the row opened', () => {
    let messages: ChatMessage[] = [user(Date.now() - 30_000)]
    messages = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 0, delta: '雨' })
    const opened = messages[1].timestamp!
    messages = [...messages.slice(0, 1), { ...messages[1], timestamp: opened - 25_000 }]
    messages = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 0, delta: '还在下。' })
    expect(messages[1].deliveredAt).toBeGreaterThanOrEqual(opened)
    expect(turnElapsedMs(messages, 1)).toBe(messages[1].deliveredAt! - messages[0].timestamp!)
  })

  it('reads a restored transcript off the times its entries were written', () => {
    const messages = historyMessages([
      { id: 'u', role: 'user', content: '我推开门', timestamp: 1_000 },
      { id: 'a', role: 'assistant', content: '', timestamp: 4_000, tools: [{ id: 't', name: 'narrate', input: '{}' }] },
      { id: 'c', role: 'assistant', content: '', timestamp: 18_500, presentation: { renderer: 'coc-mechanics', details: { mechanics: [], marked_text: '门开了。' } } },
    ])
    expect(turnElapsedMs(messages, messages.length - 1)).toBe(17_500)
  })
})

describe('formatTurnElapsed', () => {
  it('fills the table words, minutes only past a minute', () => {
    const words = { elapsed_s: 'Took {s}s', elapsed_ms: 'Took {m}m {s}s' }
    expect(formatTurnElapsed(32_400, words)).toBe('Took 32s')
    expect(formatTurnElapsed(65_000, words)).toBe('Took 1m 5s')
    expect(formatTurnElapsed(200, words)).toBe('Took 1s')
  })
})

describe('MessageView footer', () => {
  const noop = async () => {}
  it('puts the wait after the time on the turn-end row', () => {
    render(<MessageView message={{ id: 'a', role: 'assistant', content: '门开了。', timestamp: Date.UTC(2026, 8, 30) }} showFooter elapsedMs={32_000} actionWords={{ elapsed_s: '用时 {s} 秒' }} onCopy={noop} onResend={() => {}} resendDisabled={false} />)
    const footer = screen.getByTestId('message-elapsed').parentElement!
    expect(screen.getByTestId('message-elapsed').textContent).toBe('用时 32 秒')
    expect(footer.firstElementChild?.tagName).toBe('TIME')
    expect(footer.children[1]).toBe(screen.getByTestId('message-elapsed'))
  })

  it('shows nothing without a measured wait', () => {
    render(<MessageView message={{ id: 'a', role: 'assistant', content: '门开了。', timestamp: 1 }} showFooter onCopy={noop} onResend={() => {}} resendDisabled={false} />)
    expect(screen.queryByTestId('message-elapsed')).toBeNull()
  })
})
