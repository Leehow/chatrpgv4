// @vitest-environment jsdom
import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { GameClock, centeredClockMessage, gameClockReadings, type GameClockData } from './GameClock'
import type { ChatMessage } from './transcript-model'

afterEach(cleanup)
const messages: ChatMessage[] = [
  { id: 'opening', role: 'assistant', content: 'A letter.' },
  { id: 'a1', role: 'assistant', content: 'Morning.' },
  { id: 'u2', role: 'user', content: 'I wait.' },
  { id: 'a2', role: 'assistant', content: 'Afternoon.' },
]
const data: GameClockData = {
  clock_mod: { enabled: true, when: { y: 1975, mo: 7, d: 15, hh: 13, mm: 25 }, turn: 9 },
  nodes: [
    { sha: 'first', turn: 1, when: { y: 1975, mo: 7, d: 14, hh: 23, mm: 55 } },
    { sha: 'second', turn: 1, when: { y: 1975, mo: 7, d: 15, hh: 9, mm: 5 } },
    { sha: 'foreign', turn: 1, when: { day: 88, hh: 6, mm: 0 } },
  ],
  anchors: [
    { commit: 'first', sessionId: 'selected', messageId: 'a1' },
    { commit: 'second', sessionId: 'selected', messageId: 'a2' },
    { commit: 'foreign', sessionId: 'other', messageId: 'a1' },
  ],
}
function bounds(top: number, height: number): DOMRect { return { top, bottom: top + height, height, left: 0, right: 600, width: 600, x: 0, y: top, toJSON() {} } }
function fixture() {
  const containerRef = createRef<HTMLDivElement>()
  const view = render(<div ref={containerRef}><div className="message-list" data-testid="virtuoso-scroller">
    {messages.map(message => <div key={message.id} data-game-clock-message={message.id}>{message.content}</div>)}
  </div></div>)
  const container = containerRef.current!
  const scroller = container.querySelector<HTMLElement>('.message-list')!
  scroller.getBoundingClientRect = () => bounds(86, 500)
  let picked = 'a1'
  for (const row of container.querySelectorAll<HTMLElement>('[data-game-clock-message]')) {
    row.getBoundingClientRect = () => row.dataset.gameClockMessage === picked ? bounds(210, 240) : bounds(-500, 100)
  }
  return { containerRef, scroller, view, select: (id: string) => { picked = id; fireEvent.scroll(scroller) } }
}

test('commit and session bindings survive duplicate turn numbers, and a player message inherits the preceding reading', () => {
  const readings = gameClockReadings(messages, data, 'selected')
  expect(readings.get('opening')).toBeNull()
  expect(readings.get('a1')?.when?.hh).toBe(23)
  expect(readings.get('u2')).toEqual(readings.get('a1'))
  expect(readings.get('a2')?.when?.hh).toBe(9)
  const omitted = { ...data, nodes: data.nodes!.filter(node => node.sha !== 'second') }
  expect(gameClockReadings(messages, omitted, 'selected').get('a2')).toBeNull()
})

test('center selection excludes virtual-list overscan outside the viewport', () => {
  const f = fixture()
  expect(centeredClockMessage(f.containerRef.current!)).toBe('a1')
  f.select('u2')
  expect(centeredClockMessage(f.containerRef.current!)).toBe('u2')
})

test('a long reply containing the reading point wins over a shorter preceding message', () => {
  const f = fixture()
  const rows = f.containerRef.current!.querySelectorAll<HTMLElement>('[data-game-clock-message]')
  rows[1].getBoundingClientRect = () => bounds(120, 80)
  rows[2].getBoundingClientRect = () => bounds(220, 80)
  rows[3].getBoundingClientRect = () => bounds(320, 1800)
  expect(centeredClockMessage(f.containerRef.current!)).toBe('a2')
})

test('scrolling selects historical time and returning to the bottom restores the current reading', async () => {
  const f = fixture()
  const clock = render(<GameClock data={data} messages={messages} sessionId="selected" containerRef={f.containerRef} atBottom />)
  expect(screen.getByTestId('game-clock').textContent).toContain('13:25')
  clock.rerender(<GameClock data={data} messages={messages} sessionId="selected" containerRef={f.containerRef} atBottom={false} />)
  await waitFor(() => expect(screen.getByTestId('game-clock').textContent).toContain('23:55'))
  expect(screen.getByTestId('game-clock').getAttribute('data-mode')).toBe('history')
  expect(screen.getByTestId('game-clock').textContent).toContain('1975-07-14')
  f.select('a2')
  await waitFor(() => expect(screen.getByTestId('game-clock').textContent).toContain('09:05'))
  clock.rerender(<GameClock data={data} messages={messages} sessionId="selected" containerRef={f.containerRef} atBottom />)
  expect(screen.getByTestId('game-clock').textContent).toContain('13:25')
  expect(screen.getByTestId('game-clock').getAttribute('data-mode')).toBe('live')
})

test('unknown history stays unknown while a new live reading arrives', async () => {
  const f = fixture(); f.select('opening')
  const clock = render(<GameClock data={data} messages={messages} sessionId="selected" containerRef={f.containerRef} atBottom={false} />)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
  const changed = { ...data, clock_mod: { enabled: true, when: { day: 4, hh: 17, mm: 0 }, turn: 10 } }
  clock.rerender(<GameClock data={changed} messages={messages} sessionId="selected" containerRef={f.containerRef} atBottom={false} />)
  expect(screen.getByTestId('game-clock').textContent).toContain('—:—')
  expect(screen.getByTestId('game-clock').textContent).not.toContain('17:00')
})

test('undated calendars use projected words, and disabling the Mod removes the display', () => {
  const f = fixture()
  const undated = { ...data, clock_mod: { enabled: true, when: { day: 2, hh: 1, mm: 5 }, turn: 2 }, ui: { words: { sheet: { 'day.clock': 'Cycle {d} · {hh}:{mm}', turnKey: 'Beat' } } } }
  const clock = render(<GameClock data={undated} messages={messages} sessionId="selected" containerRef={f.containerRef} atBottom />)
  expect(screen.getByTestId('game-clock').textContent).toContain('Cycle 2 ·')
  expect(screen.getByTestId('game-clock').textContent).toContain('01:05')
  expect(screen.getByTestId('game-clock').textContent).toContain('Beat 2')
  clock.rerender(<GameClock data={{ ...undated, clock_mod: { ...undated.clock_mod, enabled: false } }} messages={messages} sessionId="selected" containerRef={f.containerRef} atBottom />)
  expect(screen.queryByTestId('game-clock')).toBeNull()
})

test('projected calendar patterns may use unpadded month and day fields', () => {
  const f = fixture()
  render(<GameClock data={{ ...data, ui: { words: { sheet: { at: '{d}/{mo}/{y} {hh}:{mm}' } } } }} messages={messages} sessionId="selected" containerRef={f.containerRef} atBottom />)
  expect(screen.getByTestId('game-clock').textContent).toContain('15/7/1975')
  expect(screen.getByTestId('game-clock').textContent).not.toContain('{')
})
