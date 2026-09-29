// @vitest-environment jsdom
/**
 * The host call a transcript renderer makes (contract §155.8), proven on the real path.
 *
 * A pictured handout's translate control lives in the pack's delivery card (`pipicoc/mechanics.js`)
 * and asks the host for `handout.reading`. A control that draws but whose call never arrives is the
 * hollow version of this feature, so every test here renders the real card through the real
 * controlled loader -- registered under the pack's own id, the way the App loads it -- and follows
 * the call from the button to `host.invokeExtension`:
 *
 * - the loader binds the call to the extension that registered the renderer, and passes nothing
 *   when the host UI handed nothing down;
 * - the transcript row forwards the host UI's call to the renderer;
 * - the App binds that call to the session it shows, resolves `data` on `ok`, and rejects with the
 *   refusal's `code` so the card captions it from the `errors` surface.
 *
 * The states of the control itself are pinned in `tests/extension/handout-reading-control.test.mjs`.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry, PipiHostAPI } from '@pipi/host-api'
import enHandout from '../../../../content/ui/en/handout.json'
import { loadControlledContributions } from './controlled-component-loader'
import { getToolRenderer, type ToolRenderProps } from './ui-registries'
import { rendererInvoke } from './renderer-invoke'
import type { Disposer } from './contribution-registry'
import type { ChatMessage } from './transcript-model'
import { ui } from './fixtures/coc-ui-words'

vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return { Virtuoso: React.forwardRef(({ data, itemContent }: { data: unknown[]; itemContent: (index: number, item: never) => JSX.Element }, ref) => { React.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() })); return <div>{data.map((item, index) => <React.Fragment key={index}>{itemContent(index, item as never)}</React.Fragment>)}</div> }) }
})
vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))
vi.mock('@xterm/xterm', () => ({ Terminal: class { open = vi.fn(); write = vi.fn(); clear = vi.fn(); focus = vi.fn(); scrollToBottom = vi.fn(); loadAddon = vi.fn(); dispose = vi.fn(); buffer = { active: { viewportY: 0, baseY: 0 } }; onData = () => ({ dispose: vi.fn() }); onScroll = () => ({ dispose: vi.fn() }) } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

import { App } from './App'
import { MessageView } from './Transcript'
import { createMockHost } from './mock-host'

const PACK = 'coc-keeper'
const PNG = 'data:image/png;base64,iVBORw0KGgo='
const READY = { status: 'ready', handout: 'clipping', keep: false, title: 'Grave robbers strike again', text: 'The body was gone by morning.', digest: 'abc' }

/** The shipped English words plus the `handout` surface the control reads (§23: words are data). */
function words() {
  const base = ui('en')
  return { ...base, words: { ...base.words, handout: enHandout } }
}

/** One delivery holding an image handout, placed at its sentence so no fold hides it. */
function delivery() {
  return {
    ui: words(),
    marked_text: 'The clerk slides a clipping across the counter. {{handout:clipping}}',
    mechanics: [{ kind: 'handout', handout: 'clipping', name: 'Clipping', label: 'Clipping', receipt: 'handout:clipping-t4',
      document: 'ready', image: PNG, marker: 'handout:clipping' }],
  }
}

const translate = () => screen.getByRole('button', { name: enHandout.translate, hidden: true })

let disposers: Disposer[] = []
beforeAll(async () => {
  // The pack's manifest entry, loaded by the same loader the App uses, with the real renderer.
  disposers = await loadControlledContributions({
    id: PACK,
    directory: '/tmp/coc-keeper',
    ui: { toolRenderers: [{ tool: 'coc-mechanics', entry: 'pipicoc/mechanics.js' }] },
  // @ts-expect-error -- plain ESM pack asset, no type declarations
  }, createMockHost() as PipiHostAPI, async () => import('../../../../pipicoc/mechanics.js'))
})
afterAll(() => { for (const dispose of disposers) dispose() })
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('the controlled loader binds a renderer\'s host call to its own extension', () => {
  const props = (extra: Partial<ToolRenderProps> = {}) => ({
    tool: { id: 'card-1', name: 'coc-mechanics', input: '', startedAt: 0, finished: true },
    elapsed: () => '', content: '', details: delivery(), ...extra,
  }) as ToolRenderProps

  it('hands the card onInvoke, which calls as the registering extension with only {handout}', async () => {
    const onInvokeExtension = vi.fn(async () => READY)
    render(<>{getToolRenderer('coc-mechanics')!.render!(props({ onInvokeExtension }))}</>)
    fireEvent.click(translate())
    await waitFor(() => expect(onInvokeExtension).toHaveBeenCalledTimes(1))
    expect(onInvokeExtension).toHaveBeenCalledWith(PACK, 'handout.reading', { handout: 'clipping' })
    expect(await screen.findByText(READY.text)).toBeTruthy()
  })

  it('passes no call when the host UI handed none down, and the card then draws no control', () => {
    const { container } = render(<>{getToolRenderer('coc-mechanics')!.render!(props())}</>)
    expect(container.querySelector('img.coc-map-image')).toBeTruthy()
    expect(screen.queryByRole('button', { name: enHandout.translate, hidden: true })).toBeNull()
  })
})

describe('the transcript row forwards the host UI\'s call to the renderer', () => {
  const message = { id: 'card-1', role: 'assistant', content: '', timestamp: 1, presentation: { renderer: 'coc-mechanics', details: delivery() } } as unknown as ChatMessage

  it('reaches the pack card from MessageView and shows the reading under the picture', async () => {
    const onInvokeExtension = vi.fn(async () => READY)
    const { container } = render(<MessageView message={message} onInvokeExtension={onInvokeExtension} onCopy={vi.fn(async () => undefined)} onResend={() => undefined} resendDisabled={false} />)
    fireEvent.click(translate())
    await waitFor(() => expect(onInvokeExtension).toHaveBeenCalledWith(PACK, 'handout.reading', { handout: 'clipping' }))
    expect(await screen.findByText(READY.text)).toBeTruthy()
    expect(container.querySelector('img.coc-map-image')).toBeTruthy()
  })
})

describe('a streamed reading and the finished one share one slot', () => {
  const message = { id: 'card-2', role: 'assistant', content: '', timestamp: 1, presentation: { renderer: 'coc-mechanics', details: delivery() } } as unknown as ChatMessage

  it('draws the partial as it streams, then fills the same element with the final reading', async () => {
    const answers: unknown[] = [{ status: 'pending', handout: 'clipping', partial: { title: 'Grave', text: 'Draft words' } }, READY]
    const onInvokeExtension = vi.fn(async () => (answers.length > 1 ? answers.shift() : answers[0]))
    const { container } = render(<MessageView message={message} onInvokeExtension={onInvokeExtension} onCopy={vi.fn(async () => undefined)} onResend={() => undefined} resendDisabled={false} />)
    fireEvent.click(translate())
    const streamed = await waitFor(() => {
      const node = container.querySelector('[data-reading="streaming"]')
      expect(node).toBeTruthy()
      return node as HTMLElement
    })
    expect(streamed.textContent).toContain('Draft words')
    expect(streamed.getAttribute('aria-busy')).toBe('true')
    await waitFor(() => expect(container.querySelector('[data-reading="reading"]')).toBeTruthy(), { timeout: 3000 })
    // Not a new node: React kept the slot and changed its words, so the text does not flicker.
    expect(container.querySelector('[data-reading="reading"]')).toBe(streamed)
    expect(streamed.textContent).toContain(READY.text)
    expect(streamed.textContent).not.toContain('Draft words')
    expect(streamed.getAttribute('aria-busy')).toBeNull()
  })
})

describe('the App binds the call to the session it shows', () => {
  function history(): HistoryEntry[] {
    return [
      { id: 'user-1', role: 'user', content: 'I ask the clerk about the grave robbers.', timestamp: 1 },
      { id: 'card-1', role: 'assistant', content: '', timestamp: 2, presentation: { renderer: 'coc-mechanics', details: delivery() } },
    ]
  }
  function hostAnswering(reading: { ok: boolean; data?: unknown; error?: unknown }) {
    const invokeExtension = vi.fn(async (_id: string, method: string) => {
      if (method === 'handout.reading') return reading
      if (method === 'timeline.graph') return { ok: true, data: { active: 'main', lines: [], nodes: [], anchors: [], sessions: [] } }
      if (method === 'illustration.list') return { ok: true, data: { images: [] } }
      return { ok: true, data: {} }
    })
    return {
      ...createMockHost(),
      getProduct: async () => ({ id: 'pipicoc', name: 'PipiCOC' }),
      getSessionHistory: async (sessionId: string) => sessionId === 'welcome' ? history() : [],
      invokeExtension,
    } as unknown as PipiHostAPI & { invokeExtension: ReturnType<typeof vi.fn> }
  }

  it('sends handout.reading as the pack, on the selected session, and draws the answer', async () => {
    const host = hostAnswering({ ok: true, data: READY })
    render(<App host={host} />)
    fireEvent.click(await screen.findByRole('button', { name: enHandout.translate, hidden: true }))
    await waitFor(() => expect(host.invokeExtension).toHaveBeenCalledWith(PACK, 'handout.reading', { handout: 'clipping' }, { sessionId: 'welcome' }))
    expect(await screen.findByText(READY.text)).toBeTruthy()
    expect(screen.getByText(READY.title)).toBeTruthy()
  })

  it('turns a refusal into its code, so the card captions it from the errors surface', async () => {
    const host = hostAnswering({ ok: false, error: { code: 'handout_not_available', message: 'not delivered to this table' } })
    render(<App host={host} />)
    fireEvent.click(await screen.findByRole('button', { name: enHandout.translate, hidden: true }))
    const alert = await screen.findByRole('alert', { hidden: true })
    expect(alert.textContent).toBe(ui('en').words.errors.handout_not_available)
    expect(screen.getByRole('button', { name: enHandout.retry, hidden: true })).toBeTruthy()
  })
})

describe('rendererInvoke', () => {
  it('resolves data, rejects a refusal with its code, and is absent without a session or channel', async () => {
    const invokeExtension = vi.fn(async (_id: string, method: string) => method === 'ok'
      ? { ok: true as const, data: { value: 1 } }
      : { ok: false as const, error: { code: 'handout_reading_failed' as never, message: 'worker stopped' } })
    const host = { invokeExtension } as unknown as PipiHostAPI
    const call = rendererInvoke(host, 'session-1')!
    await expect(call(PACK, 'ok', { handout: 'x' })).resolves.toEqual({ value: 1 })
    expect(invokeExtension).toHaveBeenCalledWith(PACK, 'ok', { handout: 'x' }, { sessionId: 'session-1' })
    await expect(call(PACK, 'no', {})).rejects.toMatchObject({ code: 'handout_reading_failed', message: 'worker stopped' })
    expect(rendererInvoke(host, '')).toBeUndefined()
    expect(rendererInvoke({} as PipiHostAPI, 'session-1')).toBeUndefined()
  })
})
