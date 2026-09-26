// @vitest-environment jsdom
/**
 * §135.11.6: §93's rule applied to the Keeper's text. The host streams it live, exactly as before
 * (the 2026-09-15 process-display ruling stands); where the assistant keeps secrets, a message's text
 * is the Keeper's working until that message has ended, because the host may still drop it there.
 * It is drawn inside a folded working card, one click away, never as the story.
 *
 * The events are the host's real shapes, run through `applyStreamEvent`, and the rows are drawn by
 * the real `Transcript`. What decides is structure: the secrets flag, the row's `streaming`, the
 * message's `segment`, the host's `replace`. No word of the text is read.
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry, PipiHostAPI, StreamEvent } from '@pipi/host-api'
import { Transcript } from './Transcript'
import { AssistantKeepsSecrets } from './assistant-secrets'
import { TranscriptWords } from './transcript-words'
import { applyStreamEvent, finishStreamingMessage, foldMarkedDeliveries, historyMessages, unsettledTextIds, type ChatMessage } from './transcript-model'
import { say, ui } from './fixtures/coc-ui-words'
import { App } from './App'
import { createMockHost } from './mock-host'

vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return { Virtuoso: React.forwardRef((props: {data: unknown[]; itemContent: (index: number, item: never) => JSX.Element}, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn(), getState: vi.fn() }), [])
    return <div>{props.data.map((item, index) => <React.Fragment key={index}>{props.itemContent(index, item as never)}</React.Fragment>)}</div>
  }) }
})
vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))
vi.mock('@xterm/xterm', () => ({ Terminal: class { open = vi.fn(); write = vi.fn(); clear = vi.fn(); focus = vi.fn(); scrollToBottom = vi.fn(); loadAddon = vi.fn(); dispose = vi.fn(); buffer = { active: { viewportY: 0, baseY: 0 } }; onData = () => ({ dispose: vi.fn() }); onScroll = () => ({ dispose: vi.fn() }) } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

type Live = Exclude<StreamEvent, { type: 'status' }>
const BESIDE = 'The clerk settled the move; the floating knife comes next.'
// The Keeper writes the quotes inside the span (§40.1); the rendered text is the draft without its tokens.
const DRAFT = '{{say:Knott}}"Not here."{{/say}} He turns away.'
const RENDERED = '"Not here." He turns away.'
const PROSE = 'The rain has not stopped since noon.'

/** One player turn and the host's events after it. */
function play(...events: Live[]): ChatMessage[] {
  return events.reduce<ChatMessage[]>((rows, event) => applyStreamEvent(rows, event), [{ id: 'u', role: 'user', content: 'I knock.' }])
}
const text = (segment: number, delta: string, extra: Partial<Extract<Live, { type: 'text' }>> = {}): Live =>
  ({ type: 'text', sessionId: 's', contentIndex: 0, segment, delta, ...extra })
const call = (segment: number): Live => ({ type: 'tool_call', sessionId: 's', contentIndex: 1, segment, toolCallId: 'call-1', name: 'resolve', delta: '{}' })
const card = (marked: string): Live => ({ type: 'presentation', sessionId: 's', entry: {
  id: 'card-1', role: 'assistant', content: '', timestamp: 1, presentation: { renderer: 'coc-mechanics', details: { marked_text: marked, mechanics: [] } },
} as HistoryEntry })

function draw(messages: ChatMessage[], { secrets = true, words = ui('en').words.transcript as Record<string, string> | undefined } = {}) {
  return render(<AssistantKeepsSecrets value={secrets}>
    <TranscriptWords words={words}>
      <Transcript messages={messages} onCopy={async () => undefined} onResend={vi.fn()} resendDisabled={false} copiedId={null} />
    </TranscriptWords>
  </AssistantKeepsSecrets>)
}
const workingCards = (root: HTMLElement) => [...root.querySelectorAll('[data-transcript-segment="working"]')]
const proseSegments = (root: HTMLElement) => [...root.querySelectorAll('[data-transcript-segment="text"]')].map(node => node.textContent)

describe('where the assistant keeps secrets, a message\'s text is folded until the message ends', () => {
  it('holds the Keeper\'s text beside a tool call in a folded card, never as prose, and drops the card with the text', () => {
    const streaming = play(text(4, 'The clerk settled the move; '), text(4, 'the floating knife comes next.'))
    const first = draw(streaming)
    expect(workingCards(first.container)).toHaveLength(1)
    expect(proseSegments(first.container)).toEqual([])
    expect(screen.queryByText(BESIDE)).toBeNull()
    cleanup()

    // The call arrives in the same message: the message is still being written.
    const withCall = play(text(4, BESIDE), call(4))
    const second = draw(withCall)
    expect(workingCards(second.container)).toHaveLength(1)
    expect(proseSegments(second.container)).toEqual([])
    cleanup()

    // message_end: the extension stripped the text, and the host erases it with an empty replacement.
    const ended = play(text(4, BESIDE), call(4), text(4, '', { replace: true }))
    const third = draw(ended)
    expect(workingCards(third.container)).toEqual([])
    expect(proseSegments(third.container)).toEqual([])
    expect(third.container.textContent).not.toContain('floating knife')
  })

  it('keeps implicit prose folded while it streams and draws the host\'s rewrite as prose at its message end', () => {
    const streaming = draw(play(text(7, DRAFT)))
    expect(workingCards(streaming.container)).toHaveLength(1)
    expect(proseSegments(streaming.container)).toEqual([])
    cleanup()

    const ended = draw(play(text(7, DRAFT), text(7, RENDERED, { replace: true })))
    expect(workingCards(ended.container)).toEqual([])
    expect(proseSegments(ended.container)).toEqual([RENDERED])
    expect(ended.container.textContent).not.toContain('{{say')
  })

  it('draws kept text that its message end left unchanged as prose once a later message begins or the turn ends', () => {
    const kept = play(text(2, PROSE))
    const open = draw(kept)
    expect(workingCards(open.container)).toHaveLength(1)
    cleanup()

    // The next message of the same turn has begun: the host advances the segment only at a message_end.
    const next = draw(play(text(2, PROSE), { type: 'thinking', sessionId: 's', contentIndex: 0, segment: 3, delta: 'Next.' }))
    expect(workingCards(next.container)).toEqual([])
    expect(proseSegments(next.container)).toEqual([PROSE])
    cleanup()

    // Or the turn settles.
    const settled = draw(finishStreamingMessage(kept))
    expect(workingCards(settled.container)).toEqual([])
    expect(proseSegments(settled.container)).toEqual([PROSE])
  })

  it('opens nothing by itself: the body is one click away, and the label says the Keeper is working', () => {
    const view = draw(play(text(4, BESIDE)))
    const button = view.container.querySelector('[data-transcript-segment="working"] button')!
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.textContent).toContain(say('en', 'transcript', 'keeper_working'))
    expect(button.querySelector('.activity-spinner')).toBeTruthy()
    expect(screen.queryByText(BESIDE)).toBeNull()
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(BESIDE)).toBeTruthy()
    // Still the working card, never the story.
    expect(proseSegments(view.container)).toEqual([])
  })

  it('takes the label from the play language\'s words, the key when the words lack it, an ellipsis when there are none', () => {
    const zh = draw(play(text(4, BESIDE)), { words: ui('zh-Hans').words.transcript as Record<string, string> })
    expect(zh.container.querySelector('[data-transcript-segment="working"] button')!.textContent).toContain(say('zh-Hans', 'transcript', 'keeper_working'))
    cleanup()
    const gap = draw(play(text(4, BESIDE)), { words: ui('en', { transcript: { keeper_working: undefined } }).words.transcript as Record<string, string> })
    expect(gap.container.querySelector('[data-transcript-segment="working"] button')!.textContent).toContain('keeper_working')
    cleanup()
    const none = draw(play(text(4, BESIDE)), { words: undefined })
    expect(none.container.querySelector('[data-transcript-segment="working"] button')!.textContent).toContain('…')
  })

  it('folds a setup reply the same way, and the onboarding hook\'s removal takes the card with it', () => {
    // Setup is the same product and the same transcript; the hook that hides a blocked setup reply
    // strips its text at message_end, which reaches the renderer as an empty replacement.
    const reply = 'Tell me who your investigator is.'
    const streaming = draw(play(text(0, reply)))
    expect(workingCards(streaming.container)).toHaveLength(1)
    expect(screen.queryByText(reply)).toBeNull()
    cleanup()
    const removed = draw(play(text(0, reply), text(0, '', { replace: true })))
    expect(workingCards(removed.container)).toEqual([])
    expect(removed.container.textContent).not.toContain(reply)
  })
})

describe('a console, and a history reading, are unchanged', () => {
  it('streams the text as prose where the assistant keeps no secrets, and erases a stripped draft as before', () => {
    const streaming = draw(play(text(4, BESIDE), call(4)), { secrets: false })
    expect(workingCards(streaming.container)).toEqual([])
    expect(proseSegments(streaming.container)).toEqual([BESIDE])
    cleanup()
    const ended = draw(play(text(4, BESIDE), call(4), text(4, '', { replace: true })), { secrets: false })
    expect(proseSegments(ended.container)).toEqual([])
  })

  it('draws a history reading as prose, exactly as before', () => {
    const history = historyMessages([
      { id: 'u1', role: 'user', content: 'I knock.', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: PROSE, timestamp: 2 },
    ] as HistoryEntry[])
    const view = draw(history)
    expect(workingCards(view.container)).toEqual([])
    expect(proseSegments(view.container)).toEqual([PROSE])
  })
})

describe('the model behind it', () => {
  it('names the unsettled text by the three structural ends, and nothing else', () => {
    const rows = play(text(1, 'Earlier. '), call(1), text(2, 'Now.'))
    const row = rows.at(-1)!
    // Segment 1 ended when segment 2 began; segment 2 is still being written.
    expect([...unsettledTextIds(row)]).toEqual(['text:2:0'])
    // The host's replacement ends its segment.
    const replaced = applyStreamEvent(rows, text(2, 'Now, rewritten.', { replace: true })).at(-1)!
    expect([...unsettledTextIds(replaced)]).toEqual([])
    // A row that stopped streaming has nothing unsettled.
    expect([...unsettledTextIds({ ...row, streaming: false })]).toEqual([])
    // A row built without the stream ends with the row.
    expect([...unsettledTextIds({ content: 'Plain.', streaming: true })]).toEqual(['content'])
  })

  it('lands the host\'s replacement on the row that holds the message, even behind a card its own hook appended', () => {
    // An implicit narrate appends its coc-mechanics card inside the message_end hook, before the
    // host's answer for the text arrives, so the card is the last row when the replacement lands.
    const rows = play(text(7, DRAFT), card(DRAFT), text(7, RENDERED, { replace: true }))
    const streamed = rows.find(row => row.role === 'assistant' && !row.presentation)!
    expect(streamed.content).toBe(RENDERED)
    expect(streamed.activities?.filter(activity => activity.type === 'text')).toEqual([
      { type: 'text', id: 'text:7:0', contentIndex: 0, segment: 7, content: RENDERED, final: true },
    ])
    expect(rows.find(row => row.presentation)!.content).toBe('')
    // The card draws the delivery, so its plain copy folds away (§16.6) instead of a draft staying on.
    expect(foldMarkedDeliveries(rows).filter(row => row.role === 'assistant').map(row => row.id)).toEqual(['card-1'])
  })
})

describe('the App hands the transcript its words and its secrets flag', () => {
  function hostFor(product: string) {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host = {
      ...base,
      getProduct: async () => ({ id: product, name: product }),
      getSessionHistory: async (sessionId: string) => sessionId === 'welcome'
        ? [{ id: 'user-1', role: 'user', content: 'I knock.', timestamp: 1 }, { id: 'a-1', role: 'assistant', content: PROSE, timestamp: 2 }] as HistoryEntry[]
        : [],
      // The graph answer carries the campaign's `ui` block, as the host attaches it (§23).
      invokeExtension: vi.fn(async (_id: string, method: string) => method === 'timeline.graph'
        ? { ok: true, data: { active: 'main', lines: [], nodes: [], anchors: [], sessions: [], campaign: 'c1', ui: ui('zh-Hans') } }
        : { ok: true, data: {} }),
      subscribeStream: (_sessionId: string, callback: (event: StreamEvent) => void) => { listener = callback; return () => { listener = undefined } },
    } as unknown as PipiHostAPI
    return { host, emit: (event: StreamEvent) => act(() => { listener?.(event) }), ready: () => waitFor(() => expect(listener).toBeDefined()) }
  }

  it('folds the live text under the play language\'s label in PipiCOC, and draws the replacement as prose', async () => {
    const { host, emit, ready } = hostFor('pipicoc')
    const view = render(<App host={host} />)
    await screen.findByText(PROSE)
    await ready()
    await waitFor(() => expect(host.invokeExtension).toHaveBeenCalledWith('coc-keeper', 'timeline.graph', {}, { sessionId: 'welcome' }))
    emit({ type: 'status', sessionId: 'welcome', status: 'started', pendingFollowUps: ['host'] })
    emit({ type: 'text', sessionId: 'welcome', contentIndex: 0, segment: 5, delta: DRAFT })
    await waitFor(() => expect(view.container.querySelector('[data-transcript-segment="working"] button')?.textContent)
      .toContain(say('zh-Hans', 'transcript', 'keeper_working')))
    expect(screen.queryByText(DRAFT)).toBeNull()
    emit({ type: 'text', sessionId: 'welcome', contentIndex: 0, segment: 5, delta: RENDERED, replace: true })
    await screen.findByText(RENDERED)
    expect(workingCards(view.container)).toEqual([])
  })

  it('leaves the console streaming prose', async () => {
    const { host, emit, ready } = hostFor('pipiui')
    const view = render(<App host={host} />)
    await screen.findByText(PROSE)
    await ready()
    emit({ type: 'status', sessionId: 'welcome', status: 'started', pendingFollowUps: ['host'] })
    emit({ type: 'text', sessionId: 'welcome', contentIndex: 0, segment: 5, delta: BESIDE })
    await screen.findByText(BESIDE)
    expect(workingCards(view.container)).toEqual([])
  })
})
