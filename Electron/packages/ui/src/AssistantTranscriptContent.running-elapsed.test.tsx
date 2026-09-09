// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantTranscriptContent } from './AssistantTranscriptContent'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('running step elapsed', () => {
  // A CoC `apply` that defines objects spends minutes inside the host with no stream events at all.
  // The card is rendered once and never again, so without its own clock the seconds it shows are
  // whatever unrelated render last touched the transcript — a three-minute wait read as "运行中 · 0s".
  it('advances while a tool is still running', () => {
    const startedAt = Date.now()
    render(<AssistantTranscriptContent expandSteps message={{
      content: '',
      activities: [{ type: 'tool', contentIndex: 0, tool: { id: 'apply-1', name: 'apply', input: '{}', startedAt } }],
    }} />)
    expect(screen.getByRole('button', { name: /运行中 · 0s/ })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(screen.getByRole('button', { name: /运行中 · 5s/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /运行中/ }).closest('[data-activity-status="running"]')).toBeTruthy()
  })

  it('leaves a finished tool at its own recorded duration', () => {
    const startedAt = Date.now()
    render(<AssistantTranscriptContent expandSteps message={{
      content: '',
      activities: [{ type: 'tool', contentIndex: 0, tool: { id: 'look-1', name: 'look', input: '{}', startedAt, finished: true, finishedAt: startedAt + 2_000 } }],
    }} />)
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(screen.getByRole('button', { name: /完成 · 2s/ })).toBeTruthy()
  })
})
