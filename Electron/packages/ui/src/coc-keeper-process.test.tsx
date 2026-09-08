// @vitest-environment jsdom
/**
 * PipiCOC used to run its transcript through a player-view projection that dropped the Keeper's
 * thinking, the tool cards and every streaming assistant message, leaving a silent gap where the
 * base shows the run. Pinned here because the projection was invisible from the product side: the
 * turn still arrived intact over the wire, so nothing failed -- the window just showed less.
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Transcript } from './Transcript'
import type { ChatMessage } from './transcript-model'

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

it('shows the Keeper run: thinking, tool steps and the streaming delivery', () => {
  const messages: ChatMessage[] = [
    { id: 'u', role: 'user', content: '我推开门。' },
    { id: 'turn', role: 'assistant', content: '门开了。', thinking: '先看这一格有什么线索',
      tools: [{ id: 'call-1', name: 'scene_view', input: '{}', result: 'ok', startedAt: 0, finished: true }] },
    { id: 'live', role: 'assistant', content: '走廊尽头', streaming: true },
  ]
  render(<Transcript messages={messages} onCopy={async () => undefined} onResend={vi.fn()} resendDisabled={false} copiedId={null} />)
  expect(screen.getByRole('button', { name: /个步骤/ }).textContent).toContain('scene_view')
  expect(screen.getByText('门开了。')).toBeTruthy()
  expect(screen.getByText('走廊尽头')).toBeTruthy()
})
