// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { createMockHost } from './mock-host'

afterEach(() => cleanup())

/**
 * §84: a dropped product read is not "this is the base app".
 *
 * Remote browser, 2026-09-17, seconds after the desktop app restarted. `getProduct` was answered
 * with a dropped request, its bare catch swallowed it, and `productId` stayed ''. Every surface
 * gated on `productId === 'pipicoc'` stayed off: no character-creation onboarding, the composer's
 * generic 「给 PipiUI 发送消息…」 instead of its own prompt, the base brand in the sidebar. The
 * effect depends only on `host`, which does not change when the relay reconnects, so nothing ever
 * asked again. A reload brought the entire product back — the recovery this work exists to remove.
 */
describe('the product identity survives a dropped read', () => {
  it('asks again instead of running as the base app for the life of the page', async () => {
    const host = createMockHost()
    let calls = 0
    host.getProduct = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('transport request timed out')
      return { id: 'pipicoc', name: 'PipiCOC' }
    }) as typeof host.getProduct

    const rendered = render(<App host={host} />)
    await waitFor(() => expect(calls).toBeGreaterThan(1), { timeout: 10_000 })
    // The brand is the visible half of the same read the CoC surfaces are gated on: this img
    // renders only for PipiCOC, so it is the shell saying which product it believes it is.
    await waitFor(() => expect(rendered.container.querySelector('img.sb-brand-octopus')).toBeTruthy(), { timeout: 10_000 })
  }, 20_000)

  it('stays on the base brand only when the host keeps answering that way', async () => {
    const host = createMockHost()
    host.getProduct = vi.fn(async () => ({ id: 'base', name: 'PipiUI' })) as typeof host.getProduct
    const rendered = render(<App host={host} />)
    await waitFor(() => expect(host.getProduct).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(rendered.container.querySelector('img.sb-brand-octopus')).toBeNull()
    expect(rendered.container.querySelector('[aria-label="PipiUI"]')).toBeTruthy()
    expect(host.getProduct).toHaveBeenCalledTimes(1)
  }, 20_000)
})
