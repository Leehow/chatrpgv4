// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { createMockHost } from './mock-host'

afterEach(() => cleanup())

/**
 * §85: the model name is the last instance of "not yet known is not none".
 *
 * Measured in the remote browser, 2026-09-17, sampling the composer every 250ms across a session:
 *
 *   models:   "加载模型…" ×39   "✦Unknown" ×50   "DeepSeek V4.1 Flash" ×4458
 *   thinking: "…" ×39                            "low" ×4458
 *
 * For twelve and a half seconds the chip named a model nobody chose, with a ✦ for the
 * placeholder's `provider: "unknown"`. The thinking level beside it, read in the very same call,
 * correctly said 「…」 the whole time — §63 plumbed `pending` to that chip and left the name.
 */
describe('the composer does not name a model before the host has said one', () => {
  it('draws the host placeholder as loading, never as a model called Unknown', async () => {
    const host = createMockHost()
    // What the backend answers for a session whose model state it has not established.
    host.getModelState = vi.fn(async () => ({
      model: { provider: 'unknown', id: 'unknown', name: 'Unknown', reasoning: false },
      thinkingLevel: 'off' as const,
      availableThinkingLevels: [],
    })) as unknown as typeof host.getModelState

    const rendered = render(<App host={host} />)
    const chip = await waitFor(() => {
      const found = rendered.container.querySelector('[data-testid="model-chip"]')
      expect(found).toBeTruthy()
      return found!
    }, { timeout: 10_000 })
    await waitFor(() => expect(host.getModelState).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 120))

    expect(chip.textContent).not.toContain('Unknown')
    expect(chip.textContent).toContain('加载模型…')
    // The ✦ comes from the placeholder's provider; it must not be drawn either.
    expect(chip.querySelector('svg, img')).toBeNull()
  }, 20_000)
})
