// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry, StreamEvent } from '@pipi/host-api'
import { MessageView } from './Transcript'
import { applyStreamEvent, historyMessages, transcriptFingerprint, type ChatMessage } from './transcript-model'
import { TranscriptWords } from './transcript-words'
import words from '../../../../content/ui/en/transcript.json'

vi.mock('streamdown', async importOriginal => ({ ...await importOriginal<typeof import('streamdown')>(), Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))
afterEach(cleanup)

const NOTE = 'Your slip says 14 Webster Street, not 137 Beacon Street.'
const entry = (tableNote?: true): HistoryEntry => ({ id: 'table-note', role: 'assistant', content: NOTE, timestamp: 1, placedByHost: true, ...(tableNote ? { tableNote } : {}) })
const draw = (message: ChatMessage) => <TranscriptWords words={words}>
  <MessageView message={message} onCopy={async () => {}} onResend={() => {}} resendDisabled={false} />
</TranscriptWords>

describe('the Keeper\'s out-of-character table note (§256.1)', () => {
  it('is drawn apart from the story, live and after reload', () => {
    const row = entry(true)
    const live = applyStreamEvent([], { type: 'presentation', sessionId: 's', entry: row } as Extract<StreamEvent, { type: 'presentation' }>)[0]
    const saved = historyMessages([row])[0]
    for (const message of [live, saved]) {
      expect(message.tableNote).toBe(true)
      render(draw(message))
      const note = screen.getByRole('note')
      expect(note.textContent).toContain(words.table_note)
      expect(note.textContent).toContain(NOTE)
      cleanup()
    }
  })

  it('leaves ordinary host prose on its path and is part of snapshot identity', () => {
    const plain = historyMessages([entry()])[0]
    render(draw(plain))
    expect(screen.queryByRole('note')).toBeNull()
    expect(transcriptFingerprint([plain])).not.toBe(transcriptFingerprint([{ ...plain, tableNote: true }]))
  })
})
