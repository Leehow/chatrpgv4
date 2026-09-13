// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry, PipiHostAPI } from '@pipi/host-api'

vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return { Virtuoso: React.forwardRef(({ data, itemContent }: { data: unknown[]; itemContent: (index: number, item: never) => JSX.Element }, ref) => { React.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() })); return <div>{data.map((item, index) => <React.Fragment key={index}>{itemContent(index, item as never)}</React.Fragment>)}</div> }) }
})
vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))
vi.mock('@xterm/xterm', () => ({ Terminal: class { open = vi.fn(); write = vi.fn(); clear = vi.fn(); focus = vi.fn(); scrollToBottom = vi.fn(); loadAddon = vi.fn(); dispose = vi.fn(); buffer = { active: { viewportY: 0, baseY: 0 } }; onData = () => ({ dispose: vi.fn() }); onScroll = () => ({ dispose: vi.fn() }) } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

import { App } from './App'
import { createMockHost } from './mock-host'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

function history(): HistoryEntry[] {
  return [
    { id: 'user-1', role: 'user', content: '我推开门。', timestamp: 1 },
    { id: 'narration-1', role: 'assistant', content: '门轴发出一声很长的呻吟，灰尘在手电光里浮起来。', timestamp: 2 },
  ]
}

/** §35: a cold graph answer (no live agent yet) has anchors but neither status nor campaign. */
function coldGraphData() {
  return {
    active: 'main', lines: [], nodes: [],
    anchors: [{ commit: 'c1', turn: 1, messageId: 'narration-1', endId: 'narration-1', sessionId: 'welcome' }],
    sessions: [],
    ui: { words: { 'message-actions': { illustrate: '生成插画', illustrating: '正在生成插画…', illustrate_failed: '插画生成失败' } } },
  }
}

function hostForGraph(graph: { ok: boolean; data: unknown }) {
  const base = createMockHost()
  const invokeExtension = vi.fn(async (_id: string, method: string) => {
    if (method === 'timeline.graph') return graph
    if (method === 'illustration.list') return { ok: true, data: { images: [] } }
    if (method === 'illustration.generate') return { ok: true, data: { status: 'generating' } }
    if (method === 'illustration.get') return { ok: false, error: { code: 'illustration_not_found', message: 'none' } }
    return { ok: true, data: {} }
  })
  return {
    ...base,
    getProduct: async () => ({ id: 'pipicoc', name: 'PipiCOC' }),
    getSessionHistory: async (sessionId: string) => sessionId === 'welcome' ? history() : [],
    invokeExtension,
  } as unknown as PipiHostAPI & { invokeExtension: ReturnType<typeof vi.fn> }
}

describe('App turn illustration (§35)', () => {
  it('offers the illustrate action on a bound session even when the graph answer is cold', async () => {
    const host = hostForGraph({ ok: true, data: coldGraphData() })
    render(<App host={host} />)
    const button = await screen.findByRole('button', { name: '生成插画' })
    fireEvent.click(button)
    await waitFor(() => expect(host.invokeExtension).toHaveBeenCalledWith(
      'coc-keeper', 'illustration.generate',
      { messageId: 'narration-1', text: '门轴发出一声很长的呻吟，灰尘在手电光里浮起来。' },
      { sessionId: 'welcome' },
    ))
  })

  it('hides the illustrate action when the session is unbound', async () => {
    const host = hostForGraph({ ok: true, data: { status: 'unbound', campaign: null } })
    render(<App host={host} />)
    await screen.findByText('门轴发出一声很长的呻吟，灰尘在手电光里浮起来。')
    await waitFor(() => expect(host.invokeExtension).toHaveBeenCalledWith('coc-keeper', 'timeline.graph', {}, { sessionId: 'welcome' }))
    expect(screen.queryByRole('button', { name: '生成插画' })).toBeNull()
  })
})
