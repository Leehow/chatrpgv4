// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssistantTranscriptContent } from './AssistantTranscriptContent'

afterEach(cleanup)

const OPENING = 'The wind comes off the harbor and pushes through the office blinds. ' +
  'Knott taps the desk with one finger and waits for you to say who you are.'

function openingMessage(id: string) {
  return { id, content: OPENING, opening: true } as unknown as Parameters<typeof AssistantTranscriptContent>[0]['message']
}

describe('opening narration reveal', () => {
  it('reveals the opening narration progressively instead of as one blob', () => {
    vi.useFakeTimers()
    try {
      const view = render(<AssistantTranscriptContent message={openingMessage('opening-progressive')} />)
      expect(view.container.textContent ?? '').not.toContain('Knott taps the desk')
      act(() => { vi.advanceTimersByTime(400) })
      expect(view.container.textContent ?? '').toContain('The wind comes off the harbor')
      expect(view.container.textContent ?? '').not.toContain('who you are.')
      act(() => { vi.advanceTimersByTime(5000) })
      expect(view.container.textContent ?? '').toContain('who you are.')
    } finally {
      vi.useRealTimers()
    }
  })

  it('resumes from the progress a remount already reached, and lands complete', () => {
    vi.useFakeTimers()
    try {
      const first = render(<AssistantTranscriptContent message={openingMessage('opening-resume')} />)
      act(() => { vi.advanceTimersByTime(400) })
      const reached = first.container.textContent ?? ''
      first.unmount()
      const second = render(<AssistantTranscriptContent message={openingMessage('opening-resume')} />)
      // A row that comes back after being unmounted must not restart from an empty page.
      expect((second.container.textContent ?? '').length).toBeGreaterThanOrEqual(reached.length)
      act(() => { vi.advanceTimersByTime(5000) })
      expect(second.container.textContent ?? '').toContain('who you are.')
      second.unmount()
      const third = render(<AssistantTranscriptContent message={openingMessage('opening-resume')} />)
      expect(third.container.textContent ?? '').toContain('who you are.')
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders an entry without the opening flag whole, as before', () => {
    const view = render(<AssistantTranscriptContent message={{ content: OPENING } as never} />)
    expect(view.container.textContent ?? '').toContain('who you are.')
  })
})

describe('the opening help fold', () => {
  const HELP = { title: 'What is happening here?', lines: ['You are making your investigator.', 'A name and a trade is enough.', 'Say "make the card now" to skip.'] }

  it('draws a "?" after the revealed opening that opens and closes the fold, and never the fold by itself', () => {
    vi.useFakeTimers()
    try {
      const message = { id: 'opening-help', content: OPENING, opening: true, help: HELP } as unknown as Parameters<typeof AssistantTranscriptContent>[0]['message']
      const view = render(<AssistantTranscriptContent message={message} />)
      expect(view.container.querySelector('[data-testid="opening-help"]')).toBeNull()
      act(() => { vi.advanceTimersByTime(8000) })
      const toggle = screen.getByRole('button', { name: HELP.title })
      expect(view.container.textContent ?? '').not.toContain(HELP.lines[0])
      fireEvent.click(toggle)
      expect(view.container.textContent ?? '').toContain(HELP.lines[0])
      expect(view.container.textContent ?? '').toContain(HELP.lines[2])
      fireEvent.click(toggle)
      expect(view.container.textContent ?? '').not.toContain(HELP.lines[0])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a re-read opening (no reveal flag) still carries its "?"', () => {
    render(<AssistantTranscriptContent message={{ content: OPENING, help: HELP } as never} />)
    expect(screen.getByRole('button', { name: HELP.title })).toBeTruthy()
  })

  it('an opening without help draws no button', () => {
    render(<AssistantTranscriptContent message={{ content: OPENING } as never} />)
    expect(screen.queryByRole('button', { name: HELP.title })).toBeNull()
  })
})
