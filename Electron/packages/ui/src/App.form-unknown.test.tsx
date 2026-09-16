// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { createMockHost } from './mock-host'

afterEach(() => cleanup())

/**
 * The shell paints the base layout before it has asked which form the project
 * is in. `activeWorkbenchPlan.packId` therefore reads `base` during that
 * window, and the mismatch check used to believe it: over a remote link the
 * answer can take tens of seconds, and for all of them the person was told
 * 「此会话使用 … 扩展包；当前项目是 base。请用当前扩展包新建会话继续。」 with the
 * composer locked, on a session that was perfectly fine (§54).
 */
describe('a project whose form is not known yet is not called base', () => {
  it('holds the accusation while the extension list is still in flight, then makes it once the host answers', async () => {
    const host = createMockHost()
    const sessions = await host.listSessions!((await host.listProjects())[0].id)
    // The session was started under a pack; the project will answer `base`.
    host.listSessions = vi.fn(async () => sessions.map(session => ({
      ...session,
      productProfile: { id: 'coc-keeper', fingerprint: 'sha256:test' },
    })))

    let answer: (list: never[]) => void = () => undefined
    const pending = new Promise<never[]>(resolve => { answer = resolve })
    host.listExtensions = vi.fn(() => pending) as typeof host.listExtensions

    const rendered = render(<App host={host} />)
    await waitFor(() => expect(rendered.container.querySelector('.pipiui-shell')).toBeTruthy())
    // Give the shell every chance to settle into its placeholder form.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(rendered.queryByTestId('composer-read-only')).toBeNull()

    answer([])
    // Now the host has answered: this project really is `base`, and a session
    // stamped with another pack is genuinely unusable here — say so.
    await waitFor(() => expect(rendered.queryByTestId('composer-read-only')).toBeTruthy())
    expect(rendered.getByTestId('composer-read-only').textContent).toContain('coc-keeper')
  })
})
