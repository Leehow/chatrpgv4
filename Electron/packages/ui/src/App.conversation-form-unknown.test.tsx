// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { createMockHost } from './mock-host'

afterEach(() => cleanup())

/**
 * §62, the session end of §54. Two answers decide whether a session belongs to
 * another product, and §54 only taught the shell to wait for one of them. The
 * session's own recorded form can be missing too — the session list has two
 * producers and one of them used to drop the field — and an unrecorded form is
 * not "the same form as this project".
 *
 * And when the difference is real, what the person is told has to leave them
 * their table. A 68-turn session whose every receipt is on disk was told
 * 「请用当前扩展包新建会话继续」: the one instruction that throws the game away.
 */
describe('a session whose form is not recorded is not accused, and a real difference keeps the table', () => {
  it('does not accuse a session the host recorded no form for, even once the project has answered `base`', async () => {
    const host = createMockHost()
    const sessions = await host.listSessions!((await host.listProjects())[0].id)
    // No productProfile: the host did not say which form this session is in.
    host.listSessions = vi.fn(async () => sessions.map(session => {
      const { productProfile: _dropped, ...rest } = session as typeof session & { productProfile?: unknown }
      return rest
    })) as typeof host.listSessions
    // The project answers, and answers `base`.
    host.listExtensions = vi.fn(async () => []) as typeof host.listExtensions

    const rendered = render(<App host={host} />)
    await waitFor(() => expect(rendered.container.querySelector('.pipiui-shell')).toBeTruthy())
    await waitFor(() => expect(host.listExtensions).toHaveBeenCalled())
    // Give the answered `base` every chance to lock the composer.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(rendered.queryByTestId('composer-read-only')).toBeNull()
  })

  it('names the recovery that keeps the session when the forms really do differ, and never offers a new one', async () => {
    const host = createMockHost()
    const sessions = await host.listSessions!((await host.listProjects())[0].id)
    host.listSessions = vi.fn(async () => sessions.map(session => ({
      ...session,
      productProfile: { id: 'coc-keeper', fingerprint: 'sha256:test' },
    }))) as typeof host.listSessions
    host.listExtensions = vi.fn(async () => []) as typeof host.listExtensions

    const rendered = render(<App host={host} />)
    await waitFor(() => expect(rendered.queryByTestId('composer-read-only')).toBeTruthy())
    const notice = rendered.getByTestId('composer-read-only').textContent ?? ''
    expect(notice).toContain('coc-keeper')
    // The transcript is intact and the pack can be turned back on for this
    // project; abandoning the session is never the advice.
    expect(notice).not.toContain('新建会话继续')
    expect(notice).toContain('重新启用')
  })
})
