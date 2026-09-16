// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { createMockHost } from './mock-host'

afterEach(() => cleanup())

/**
 * A failed read is not an answer (§62). Over a relay the host drops requests
 * without dropping the socket; writing a plausible value in the catch hands the
 * person a confident lie and destroys what the shell already knew.
 */
describe('a dropped read never becomes a value', () => {
  it('keeps the catalogued model rather than writing the raw id back when the read keeps failing', async () => {
    const host = createMockHost()
    const catalog = await host.listModels!()
    const known = catalog.find(model => model.name && model.name !== model.id) ?? catalog[0]
    let calls = 0
    host.getModelState = vi.fn(async () => { calls += 1; throw new Error('transport request timed out') }) as typeof host.getModelState
    const sessions = await host.listSessions!((await host.listProjects())[0].id)
    host.listSessions = vi.fn(async () => sessions.map(session => ({
      ...session,
      model: { provider: known.provider, modelId: known.id },
    }))) as typeof host.listSessions

    const rendered = render(<App host={host} />)
    const chip = () => rendered.container.querySelector('[data-testid="model-chip"]')?.textContent ?? ''
    await waitFor(() => expect(rendered.container.querySelector('[data-testid="model-chip"]')).toBeTruthy())
    // A dropped read is retried rather than latched (§62).
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2), { timeout: 10_000 })
    // And it never renames the model to its raw id, which is what the old
    // catch-writes-a-value path did on the very first failure.
    await waitFor(() => expect(chip()).toContain(known.name))
    if (known.name !== known.id) expect(chip()).not.toBe(known.id)
  }, 15_000)

  it('does not declare every capability absent when the capabilities read fails', async () => {
    const host = createMockHost()
    let calls = 0
    host.capabilities = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('transport request timed out')
      return { browser: true, terminal: true, git: true, plan: true, revealInFinder: false, computerUse: false, inputFiles: true } as never
    }) as typeof host.capabilities

    const rendered = render(<App host={host} />)
    await waitFor(() => expect(rendered.container.querySelector('.pipiui-shell')).toBeTruthy())
    // The failed first read must be retried rather than latched as "none".
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2), { timeout: 10_000 })
  }, 15_000)
})
