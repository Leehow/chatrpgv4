// @vitest-environment jsdom
/**
 * §NN. The Keeper's run is available to the player, not read to them.
 *
 * The process display stays (2026-09-15 ruling, `docs/kernel-rpc.md` §22): the step group, the
 * Thinking card, its label, its live token count, the spinner and every tool card are all still
 * there while the turn runs. What is pinned here is that the reasoning BODY is not opened by the
 * product. It is one click away, exactly like a tool card's input and output.
 *
 * The leak window is the stream itself: the reasoning is the last activity in its group while it
 * is still arriving, so the transcript used to force it open and the player read the Keeper's
 * conclusion ("Arty grants access.") before the Keeper had narrated Arty answering. A later tool
 * call pushed it out of last place and it folded again -- which is why the fixtures here are the
 * streaming shape, not the settled one.
 *
 * Suppression and pushing are different things, and only one of them is ruled out. A mutation
 * that deletes the card fails the availability assertions; a mutation that re-opens it by itself
 * fails the first one.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Transcript } from './Transcript'
import type { ChatMessage } from './transcript-model'
import { AssistantKeepsSecrets, assistantKeepsSecretsFor } from './assistant-secrets'
import type { Session } from '@pipi/host-api'

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

afterEach(cleanup)

const REASONING = 'Ruth is in the scene but not downstairs yet. Arty grants access.'

/** The turn as it stands mid-stream: the reasoning has arrived, nothing else has. */
function streamingTurn(): ChatMessage[] {
  return [
    { id: 'u', role: 'user', content: '我敲门。' },
    { id: 'turn', role: 'assistant', content: '', thinking: REASONING, streaming: true },
  ]
}

/** The same turn once it settled: reasoning, the tool it called, the narration it delivered. */
function settledTurn(): ChatMessage[] {
  return [
    { id: 'u', role: 'user', content: '我敲门。' },
    {
      id: 'turn',
      role: 'assistant',
      content: '门开了一条缝。',
      thinking: REASONING,
      tools: [{ id: 'call-1', name: 'scene_view', input: '{}', result: 'ok', startedAt: 0, finished: true }],
    },
  ]
}

function draw(messages: ChatMessage[], keepsSecrets = true) {
  render(<AssistantKeepsSecrets value={keepsSecrets}>
    <Transcript messages={messages} onCopy={async () => undefined} onResend={vi.fn()} resendDisabled={false} copiedId={null} />
  </AssistantKeepsSecrets>)
}

function session(profile?: string): Session {
  return { id: 's', projectId: 'p', name: '鬼屋', updatedAt: 0, ...(profile ? { productProfile: { id: profile, fingerprint: 'sha256:x' } } : {}) }
}

describe('the Keeper\'s reasoning is available, not pushed', () => {
  it('does not open the reasoning body while it is still streaming', () => {
    draw(streamingTurn())
    expect(screen.queryByText(REASONING)).toBeNull()
  })

  it('still shows the run while it streams: the open step group and a live Thinking card', () => {
    draw(streamingTurn())
    const group = screen.getByRole('button', { name: /个步骤/ })
    expect(group.getAttribute('aria-expanded')).toBe('true')
    expect(group.textContent).toContain('Thinking')
    const card = screen.getByRole('button', { name: /^Thinking/ })
    expect(card.textContent).toContain('tokens')
    expect(card.querySelector('.activity-spinner')).toBeTruthy()
  })

  it('opens the reasoning body on the player\'s own click, mid-stream', () => {
    draw(streamingTurn())
    const card = screen.getByRole('button', { name: /^Thinking/ })
    expect(card.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(card)
    expect(screen.getByText(REASONING)).toBeTruthy()
  })

  it('keeps the same closed-but-reachable card once the turn has settled', () => {
    draw(settledTurn())
    expect(screen.getByText('门开了一条缝。')).toBeTruthy()
    expect(screen.queryByText(REASONING)).toBeNull()
    const group = screen.getByRole('button', { name: /个步骤/ })
    expect(group.textContent).toContain('scene_view')
    fireEvent.click(group)
    fireEvent.click(screen.getByRole('button', { name: /^Thinking/ }))
    expect(screen.getByText(REASONING)).toBeTruthy()
  })

  it('leaves a console transcript alone: there the reasoning body still opens itself', () => {
    draw(streamingTurn(), false)
    expect(screen.getByText(REASONING)).toBeTruthy()
  })
})

describe('which transcripts have an assistant that keeps secrets', () => {
  it('says so for the PipiCOC shell', () => {
    expect(assistantKeepsSecretsFor('pipicoc', session())).toBe(true)
  })

  it('still says so when the one product read dropped and the shell fell back to base (§84)', () => {
    expect(assistantKeepsSecretsFor('', session('coc-keeper'))).toBe(true)
    expect(assistantKeepsSecretsFor(undefined, session('coc-keeper'))).toBe(true)
  })

  it('says no for the base console, with or without a session', () => {
    expect(assistantKeepsSecretsFor('pipiui', session())).toBe(false)
    expect(assistantKeepsSecretsFor('pipiui', session('base'))).toBe(false)
    expect(assistantKeepsSecretsFor('', undefined)).toBe(false)
  })
})
