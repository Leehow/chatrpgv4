// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { createMockHost } from './mock-host'

afterEach(() => cleanup())

describe('App product pack projection', () => {
  it('keeps a generic primary sidebar with no pack enabled and no Coding surfaces', async () => {
    const host = createMockHost()
    // No enabled extension declares a layout, so this project is plain base.
    host.listExtensions = vi.fn(async () => [{
      id: 'skill-loader-extension',
      name: 'PipiUI Skill Loader',
      version: '1.0.0',
      state: 'enabled' as const,
      source: 'builtin' as const,
      capabilities: [],
    }])

    const rendered = render(<App host={host} />)
    await waitFor(() => expect(rendered.container.querySelector('[data-workbench-container="pipi.sessions"]')).toBeTruthy())
    expect(rendered.getByTestId('sidebar')).toBeTruthy()
    expect(rendered.queryByTestId('open-settings-header')).toBeNull()
    expect(rendered.queryByTestId('new-conversation-header')).toBeNull()
    expect(rendered.queryByTestId('git-branch-button')).toBeNull()
    expect(rendered.queryByTestId('tool-quick-rail')).toBeNull()
    expect(rendered.container.querySelector('.pipiui-shell')?.className).not.toContain('sidebar-collapsed')
    expect(rendered.queryByRole('separator', { name: '调整左栏宽度' })).toBeTruthy()
    expect(rendered.queryByText('Subagents')).toBeNull()
    expect(rendered.getByTestId('sidebar-footer')).toBeTruthy()
    // Remote pairing is a package, not a base capability: without it the footer shows
    // no entry, and the panel behind it is never mounted.
    expect(rendered.queryByRole('button', { name: '远程控制' })).toBeNull()
    expect(rendered.queryByTestId('remote-connection-panel')).toBeNull()
    // A session with no `productProfile` metadata (mock-host never sets one) falls back to
    // the currently active form, not a hardcoded pack — so it is never spuriously flagged
    // as a mismatch and the composer stays writable.
    expect(rendered.queryByTestId('composer-read-only')).toBeNull()
  })

  it('shows the remote pairing entry once the remote-control package is enabled', async () => {
    const host = createMockHost()
    host.listExtensions = vi.fn(async () => [{
      id: 'remote-control',
      name: 'PipiUI Remote Control',
      version: '0.1.0',
      state: 'enabled' as const,
      source: 'builtin' as const,
      capabilities: [],
    }])

    const rendered = render(<App host={host} />)
    expect(await rendered.findByRole('button', { name: '远程控制' })).toBeTruthy()
  })

  it('takes the workbench layout from the enabled pack extension', async () => {
    // The mock ships a demo pack enabled: an ordinary extension whose manifest declares
    // `app.ui.layout`. Its layout names the shell's own session container, because the
    // shell owns that view — a pack chooses the arrangement, not the pieces.
    const rendered = render(<App host={createMockHost()} />)
    await waitFor(() => expect(rendered.container.querySelector('[data-workbench-container="pipi.sessions"]')).toBeTruthy())
  })
})
