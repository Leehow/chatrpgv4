// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    buffer = { active: { viewportY: 0, baseY: 0 } }
    options = {}
    open = vi.fn(); write = vi.fn(); clear = vi.fn(); focus = vi.fn()
    scrollToBottom = vi.fn(); loadAddon = vi.fn(); dispose = vi.fn()
    onData() { return { dispose: vi.fn() } }
    onScroll() { return { dispose: vi.fn() } }
  }
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

import { RemoteBrowserApp } from './RemoteBrowserApp'

class FakeSocket {
  readyState = 0
  listeners = new Map<string, Array<(...args: any[]) => void>>()
  send = vi.fn()
  close = vi.fn()
  addEventListener(type: string, listener: (...args: any[]) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  removeEventListener(type: string, listener: (...args: any[]) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== listener))
  }
  emit(type: string, value?: unknown) {
    this.listeners.get(type)?.forEach(listener => listener(value))
    if (type === 'open') this.readyState = 1
    if (type === 'close') this.readyState = 3
  }
}

afterEach(() => { cleanup(); sessionStorage.clear() })

const pairID = '11111111-1111-4111-8111-111111111111'
const secret = 'ab'.repeat(32)

/**
 * A dropped request over a relay is ordinary; losing the table is not. The
 * shell used to render `<App>` inside a different tree for each lifecycle
 * phase, so every blip unmounted it: React reconciles by position and type, and
 * `<><App/>…</>` is not `<div class="remote-browser-shell">…<App/></div>`. The
 * person saw the whole product reset to 「暂无项目与会话」 and everything it had
 * loaded — session, transcript, draft — was gone (§57).
 */
describe('a reconnect does not restart the app', () => {
  it('keeps the same mounted shell across connected → reconnecting → connected', async () => {
    const sockets: FakeSocket[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith(`/pair/${pairID}/claim`)) return new Response(null, { status: 204 })
      if (url.endsWith(`/pair/${pairID}`)) return new Response('', { status: 200 })
      throw new Error(url)
    })
    render(
      <RemoteBrowserApp
        location={{ protocol: 'http:', host: 'relay.test', pathname: `/pair/${pairID}`, hash: `#${secret}` }}
        historyReplace={vi.fn()}
        fetch={fetchImpl as unknown as typeof fetch}
        socket={() => { const socket = new FakeSocket(); sockets.push(socket); return socket as any }}
        schedule={(fn) => { fn(); return 1 }}
        cancel={vi.fn()}
        hysteresisMs={0}
      />,
    )
    await waitFor(() => expect(sockets.length).toBe(1))
    sockets[0].emit('open')
    const shell = await waitFor(() => {
      const node = document.querySelector('.pipiui-shell')
      expect(node).toBeTruthy()
      return node as HTMLElement & { __mountMark?: string }
    })
    shell.__mountMark = 'first-mount'

    // A transient drop: the socket closes and the shell reconnects on its own.
    sockets[0].emit('close', { code: 1006, reason: '' })
    await waitFor(() => expect(sockets.length).toBeGreaterThan(1))
    sockets[sockets.length - 1].emit('open')
    await waitFor(() => expect(screen.queryByTestId('remote-lifecycle')).toBeNull())

    const after = document.querySelector('.pipiui-shell') as (HTMLElement & { __mountMark?: string }) | null
    expect(after).toBeTruthy()
    expect(after!.__mountMark).toBe('first-mount')
  })
})
