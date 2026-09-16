// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { createMockHost } from './mock-host'

afterEach(() => cleanup())

/**
 * §63: "not yet known" is not "none". On a local host these answers land in
 * milliseconds and nobody saw the difference; over the relay the first frames of
 * every load stated two things that were not true — that the person has no
 * projects, and that their session is thinking `off`.
 */
describe('the first frames do not state what has not been asked', () => {
  it('does not say the person has no projects before listProjects has answered', async () => {
    const host = createMockHost()
    let release: (value: never[]) => void = () => undefined
    const pending = new Promise<never[]>(resolve => { release = resolve })
    host.listProjects = vi.fn(() => pending) as typeof host.listProjects

    const rendered = render(<App host={host} />)
    await waitFor(() => expect(rendered.container.querySelector('[data-testid="sidebar"]')).toBeTruthy())
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(rendered.queryByTestId('sidebar-empty')).toBeNull()

    release([])
    // Once the host has answered, an empty answer is a real one and is shown.
    await waitFor(() => expect(rendered.queryByTestId('sidebar-empty')?.textContent).toContain('暂无项目与会话'))
  })

  it('does not claim a thinking level before the host reports one', async () => {
    const host = createMockHost()
    let release: (value: unknown) => void = () => undefined
    const pending = new Promise(resolve => { release = resolve })
    const real = host.getModelState!.bind(host)
    host.getModelState = vi.fn(async (sessionId?: string) => {
      await pending
      return real(sessionId)
    }) as typeof host.getModelState

    const rendered = render(<App host={host} />)
    const label = () => rendered.container.querySelector('[aria-label^="思考级别"]')?.getAttribute('aria-label') ?? ''
    await waitFor(() => expect(rendered.container.querySelector('[data-testid="thinking-chip-anchor"]')).toBeTruthy())
    await new Promise(resolve => setTimeout(resolve, 80))
    // Whatever it shows, it must not assert a level nobody reported.
    expect(label()).not.toContain('当前：off')
    expect(label()).not.toContain('当前：low')

    release(undefined)
    await waitFor(() => expect(label()).toContain('当前：'))
  })
})
