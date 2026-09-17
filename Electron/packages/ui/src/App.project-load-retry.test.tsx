// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { createMockHost } from './mock-host'

afterEach(() => cleanup())

/**
 * §82: a dropped project list is not an empty one, and a spent retry is not a dead end.
 *
 * Remote browser, 2026-09-17, right after the desktop app restarted. The first `listProjects`
 * answered `transport request timed out`, the shell put up 「加载项目失败」 over an empty sidebar,
 * and it stayed there. Ninety seconds of polling, no recovery. A reload then loaded both projects
 * immediately — the host had been answering the whole time.
 *
 * The capabilities read on the very same line already had its retries (§62). This one did not.
 */
describe('the first project list survives a dropped request', () => {
  it('retries instead of turning one timeout into a permanent banner', async () => {
    const host = createMockHost()
    const real = host.listProjects.bind(host)
    let calls = 0
    host.listProjects = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('transport request timed out')
      return real()
    }) as typeof host.listProjects

    const rendered = render(<App host={host} />)
    // The banner never appears: the retry lands before the person could read it.
    await waitFor(() => expect(calls).toBeGreaterThan(1))
    await waitFor(() => expect(rendered.container.querySelector('[data-testid="sidebar"]')).toBeTruthy())
    expect(rendered.queryByTestId('sidebar-project-error')).toBeNull()
  })

  it('offers a way back that is not a reload once the retries are spent', async () => {
    const host = createMockHost()
    const real = host.listProjects.bind(host)
    let failing = true
    host.listProjects = vi.fn(async () => {
      if (failing) throw new Error('transport request timed out')
      return real()
    }) as typeof host.listProjects

    const rendered = render(<App host={host} />)
    const banner = await waitFor(() => {
      const found = rendered.queryByTestId('sidebar-project-error')
      expect(found).toBeTruthy()
      return found!
    }, { timeout: 20_000 })
    expect(banner.textContent).toContain('加载项目失败')

    // The host recovers; the person presses 重试 rather than reloading the page.
    failing = false
    const retry = rendered.getByLabelText('重新加载项目')
    fireEvent.click(retry)
    await waitFor(() => expect(rendered.queryByTestId('sidebar-project-error')).toBeNull())
  }, 30_000)
})
