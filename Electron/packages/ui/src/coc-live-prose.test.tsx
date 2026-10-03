// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
// @ts-expect-error -- plain ESM controlled renderer
import { createComponent } from '../../../../pipicoc/mechanics.js'
import { loadControlledContributions } from './controlled-component-loader'
import { disposeUiContributions } from './ui-registries'
import { MessageView } from './Transcript'
import { AssistantKeepsSecrets } from './assistant-secrets'
import { applyStreamEvent, type ChatMessage } from './transcript-model'

/**
 * Contract §171: the delivery drawn while it streams. The host draws it as a `coc-mechanics` card marked `draft`; the
 * renderer reads it in the delivery's own face and cadence (§167), follows it as it grows, and the delivered card takes
 * its place without moving it or typing what was read again.
 */

const EXT = 'coc-live-prose-test'
const FIRST = '土路把皮卡颠进镇口。'
const MORE = `${FIRST}你熄了火，从车里下来。`
const MARKED = `${MORE}{{say:Clerk}}“要加油就直说。”{{/say}}`
const draft = (text: string) => ({ id: 'coc-live-prose:s1:1', role: 'assistant' as const, content: '', timestamp: 1,
  presentation: { renderer: 'coc-mechanics', details: { draft: true, mechanics: [], marked_text: text } } })
const delivered = { id: 'card-1', role: 'assistant' as const, content: '', timestamp: 2,
  presentation: { renderer: 'coc-mechanics', details: { marked_text: MARKED, mechanics: [], speech: [{ who: { label: 'Clerk' } }] } } }
const user: ChatMessage = { id: 'u1', role: 'user', content: '开进镇子。', timestamp: 0 }
const view = (message: ChatMessage) => <AssistantKeepsSecrets value><MessageView message={message} onCopy={async () => {}} onResend={() => {}} resendDisabled={false} /></AssistantKeepsSecrets>
const prose = (root: HTMLElement) => Array.from(root.querySelectorAll('.coc-mech-para')).map(node => node.textContent).join('')

beforeEach(async () => {
  vi.useFakeTimers()
  await loadControlledContributions({ id: EXT, directory: '/tmp/coc-live-prose', ui: { toolRenderers: [{ tool: 'coc-mechanics', entry: 'mechanics.js' }] } } as never,
    {} as never, async () => ({ createComponent }))
})
afterEach(() => { cleanup(); disposeUiContributions(EXT); vi.useRealTimers() })

it('reads a growing draft at the typewriter cadence and resumes when more arrives after it caught up', () => {
  const rows = applyStreamEvent([user], { type: 'presentation', sessionId: 's1', entry: draft(FIRST) } as never)
  const first = rows[1]
  expect(first.typewriter).toBeDefined()
  const mounted = render(view(first))
  act(() => vi.advanceTimersByTime(2000))
  expect(prose(mounted.container)).toBe(FIRST)

  const grown = applyStreamEvent(rows, { type: 'presentation', sessionId: 's1', entry: draft(MORE) } as never)
  expect(grown).toHaveLength(2)
  expect(grown[1].typewriter).toBe(first.typewriter)
  mounted.rerender(view(grown[1]))
  // What arrived after playback caught up is typed, not dropped onto the page at once.
  expect(prose(mounted.container)).toBe(FIRST)
  act(() => vi.advanceTimersByTime(40))
  expect(prose(mounted.container)).toBe(MORE.slice(0, FIRST.length + 2))
  act(() => vi.advanceTimersByTime(2000))
  expect(prose(mounted.container)).toBe(MORE)
  expect(vi.getTimerCount()).toBe(0)
})

it('puts the delivered card where the draft was, in the same update, and goes on from what was read', () => {
  let rows = applyStreamEvent([user], { type: 'presentation', sessionId: 's1', entry: draft(MORE) } as never)
  const shown = rows[1]
  const mounted = render(view(shown))
  act(() => vi.advanceTimersByTime(120))
  const reached = prose(mounted.container)
  expect(reached.length).toBeGreaterThan(0)
  expect(reached.length).toBeLessThan(MORE.length)
  // The Keeper went on working after the draft (a refused delivery, a fix): that row comes after it.
  rows = [...rows, { id: 'stream-2', role: 'assistant', content: '', thinking: '', tools: [], streaming: true, timestamp: 3 }]

  const next = applyStreamEvent(rows, { type: 'presentation', sessionId: 's1', entry: delivered, replacesDraft: shown.id } as never)
  expect(next.map(row => row.id)).toEqual(['u1', 'card-1', 'stream-2'])
  expect(next[1].typewriter).toBe(shown.typewriter)
  mounted.unmount()
  const card = render(view(next[1]))
  expect(prose(card.container)).toBe(reached)
  act(() => vi.advanceTimersByTime(4000))
  expect(prose(card.container)).toBe(`${MORE}“要加油就直说。”`)
  expect(card.container.textContent).not.toContain('{{')
  expect(vi.getTimerCount()).toBe(0)
})

it('a delivery naming a draft that is not on screen arrives as it always did', () => {
  const next = applyStreamEvent([user], { type: 'presentation', sessionId: 's1', entry: delivered, replacesDraft: 'gone' } as never)
  expect(next.map(row => row.id)).toEqual(['u1', 'card-1'])
})

it('closes the call\'s own card where it was opened when the draft row already follows it', () => {
  let rows = applyStreamEvent([user], { type: 'tool_call', sessionId: 's1', contentIndex: 0, segment: 3, toolCallId: 'content-0', name: 'tool', delta: '' } as never)
  rows = applyStreamEvent(rows, { type: 'tool_call', sessionId: 's1', contentIndex: 0, segment: 3, toolCallId: 'content-0', name: 'tool', delta: '{"text":"土路' } as never)
  rows = applyStreamEvent(rows, { type: 'presentation', sessionId: 's1', entry: draft(FIRST) } as never)
  expect(rows.map(row => row.id).slice(-1)).toEqual(['coc-live-prose:s1:1'])
  rows = applyStreamEvent(rows, { type: 'tool_call', sessionId: 's1', contentIndex: 0, segment: 3, toolCallId: 'call-narrate', name: 'narrate', delta: JSON.stringify({ text: FIRST }) } as never)
  expect(rows).toHaveLength(3)
  expect(rows[1].tools?.map(tool => [tool.id, tool.name])).toEqual([['call-narrate', 'narrate']])
  expect(rows[2].id).toBe('coc-live-prose:s1:1')
  // A call in a later message after the draft still opens a row of its own, after it.
  rows = applyStreamEvent(rows, { type: 'tool_call', sessionId: 's1', contentIndex: 0, segment: 4, toolCallId: 'content-0', name: 'tool', delta: '' } as never)
  expect(rows).toHaveLength(4)
})
