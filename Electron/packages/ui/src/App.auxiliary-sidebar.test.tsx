// @vitest-environment jsdom
/**
 * A pack that names `app.ui.layout.auxiliarySidebar` is saying that panel is where the right
 * pane lives in this product. PipiCOC's investigator sheet is part of the table, so the pane
 * has to open on it — including after a collapse persisted from another product or an earlier
 * run, which is how the sheet went missing for a whole session.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

beforeEach(() => { localStorage.clear() })
afterEach(() => { cleanup(); localStorage.clear() })

/** The shape the real `pipiui-extension.json` projects into a descriptor. */
const sheetPack = {
  id: 'coc-keeper',
  name: 'COC Keeper',
  version: '0.1.0',
  state: 'enabled' as const,
  source: 'builtin' as const,
  capabilities: [],
  directory: '/packs/coc-keeper',
  ui: {
    layout: { primarySidebar: 'pipi.sessions', center: 'pipi.conversation', activity: ['pipi.sessions'], auxiliarySidebar: 'coc.investigator' },
    panels: [{ slot: 'toolPanel', id: 'coc.investigator', title: 'Investigator', entry: 'pipicoc/panel.js' }],
  },
}

function packHost() {
  const host = createMockHost() as ReturnType<typeof createMockHost> & Record<string, unknown>
  host.listExtensions = vi.fn(async () => [sheetPack])
  host.getExtensionUiEntrySource = vi.fn(async () => 'export function createComponent(React){ return function Sheet(){ return React.createElement("div",{"data-testid":"sheet-panel"},"sheet") } }')
  return host
}

/**
 * Open means all three: the pane is expanded (the header's restore button is what shows when it
 * is not), the sheet's tab is the active one, and the sheet itself is on screen rather than
 * mounted-but-hidden behind another tab.
 */
const expectSheetOpen = async () => {
  const panel = await screen.findByTestId('sheet-panel')
  expect((panel.parentElement as HTMLElement).hidden).toBe(false)
  // The chat header only grows a restore button while the pane is shut.
  expect(document.querySelector('.chat-header [data-testid="toggle-tools"]')).toBeNull()
  expect(screen.getByRole('button', { name: 'coc.investigator' }).getAttribute('aria-current')).toBe('page')
}

describe('the pack’s auxiliary sidebar is the right pane’s home', () => {
  it('opens on the declared panel from a clean slate', async () => {
    render(<App host={packHost()} />)
    await waitFor(expectSheetOpen)
  })

  it('opens it even when the right pane was left collapsed', async () => {
    localStorage.setItem('pipiui:eui-pane-widths', JSON.stringify({ sidebar: 258, tools: 368, browserTools: 586, sidebarCollapsed: false, toolsCollapsed: true }))
    render(<App host={packHost()} />)
    await waitFor(expectSheetOpen)
  })

  it('still lets the player close the pane during the run', async () => {
    render(<App host={packHost()} />)
    await waitFor(expectSheetOpen)
    fireEvent.click(screen.getByRole('button', { name: 'coc.investigator' }))
    await waitFor(() => expect(document.querySelector('.chat-header [data-testid="toggle-tools"]')).toBeTruthy())
  })
})
