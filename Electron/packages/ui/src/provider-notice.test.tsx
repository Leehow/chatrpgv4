// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry, StreamEvent } from '@pipi/host-api'
import { MessageView } from './Transcript'
import { applyStreamEvent, historyMessages, transcriptFingerprint, type ChatMessage } from './transcript-model'
import { TranscriptWords } from './transcript-words'
import words from '../../../../content/ui/en/transcript.json'

vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))
afterEach(cleanup)

const ORIGINAL = 'The earlier request failed after 60 seconds and was automatically retried.'
const entry = (providerNotice?: HistoryEntry['providerNotice']): HistoryEntry => ({
  id: 'provider-notice', role: 'assistant', content: ORIGINAL, timestamp: 1,
  placedByHost: true, ...(providerNotice ? { providerNotice } : {}),
})
const draw = (message: ChatMessage, captions = words) => <TranscriptWords words={captions}>
  <MessageView message={message} onCopy={async () => {}} onResend={() => {}} resendDisabled={false} />
</TranscriptWords>

describe('provider outage disclosure', () => {
  it.each(['recovered', 'failed'] as const)('keeps the %s status visible and defaults details closed live and after reload', outcome => {
    const row = entry(outcome)
    const live = applyStreamEvent([], { type: 'presentation', sessionId: 's', entry: row } as Extract<StreamEvent, { type: 'presentation' }>)[0]
    const saved = historyMessages([row])[0]
    expect(live.providerNotice).toBe(outcome)
    expect(saved.providerNotice).toBe(outcome)
    for (const message of [live, saved]) {
      const view = render(draw(message))
      const caption = outcome === 'recovered' ? words.provider_recovered : words.provider_failed
      const toggle = screen.getByRole('button', { name: caption })
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(screen.getByRole('status').textContent).toContain(caption)
      expect(screen.queryByText(ORIGINAL)).toBeNull()
      fireEvent.click(toggle)
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(screen.getByText(ORIGINAL)).toBeTruthy()
      view.rerender(draw({ ...message, timestamp: 2 }))
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      fireEvent.click(toggle)
      expect(screen.queryByText(ORIGINAL)).toBeNull()
      expect(message.content).toBe(ORIGINAL)
      cleanup()
    }
  })

  it('uses projected captions without classifying the original notice or rewriting evidence', () => {
    const projected = { ...words, provider_recovered: 'Projected recovery caption.' }
    render(draw(historyMessages([entry('recovered')])[0], projected))
    expect(screen.getByRole('button', { name: projected.provider_recovered })).toBeTruthy()
    expect(screen.queryByText(ORIGINAL)).toBeNull()
  })

  it('keeps ordinary host prose on its existing path and makes the outcome part of snapshot identity', () => {
    const plain = historyMessages([entry()])[0]
    render(draw(plain))
    expect(screen.getByText(ORIGINAL)).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(transcriptFingerprint([plain])).not.toBe(transcriptFingerprint([{ ...plain, providerNotice: 'recovered' }]))
  })
})
