import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { ChatMessage } from './transcript-model'
import './game-clock.css'
import sheetSource from '../../../../content/ui/en/sheet.json'
import timelineSource from '../../../../content/ui/en/timeline.json'

export type GameTime = { y?: number; mo?: number; d?: number; day?: number; hh: number; mm: number }
export type GameClockData = {
  clock_mod?: { enabled: boolean; when: GameTime | null; turn: number }
  nodes?: { sha: string; when: GameTime | null; turn: number | null }[]
  anchors?: { commit: string; messageId: string; sessionId: string }[]
  ui?: { words?: Record<string, Record<string, string>> }
}
type Reading = { when: GameTime | null; turn: number | null }

/** Commit identity disambiguates repeated turn numbers across worldlines. */
export function gameClockReadings(messages: readonly ChatMessage[], data: GameClockData, sessionId: string): Map<string, Reading | null> {
  const nodes = new Map((data.nodes ?? []).map(node => [node.sha, node]))
  const delivered = new Map((data.anchors ?? []).filter(anchor => anchor.sessionId === sessionId)
    .map(anchor => [anchor.messageId, nodes.get(anchor.commit)]))
  const readings = new Map<string, Reading | null>()
  let previous: Reading | null = null
  for (const message of messages) {
    if (delivered.has(message.id)) {
      const node = delivered.get(message.id)
      previous = node ? { when: node.when, turn: node.turn } : null
    }
    readings.set(message.id, previous)
  }
  return readings
}

/** Only mounted, visible rows participate; virtual-list overscan is excluded. */
export function centeredClockMessage(container: HTMLElement): string | null {
  const viewport = container.querySelector<HTMLElement>('[data-testid="virtuoso-scroller"]')
    ?? container.querySelector<HTMLElement>('.message-list')
  if (!viewport) return null
  const bounds = viewport.getBoundingClientRect(), center = bounds.top + bounds.height / 2
  let picked: string | null = null, distance = Infinity
  for (const node of container.querySelectorAll<HTMLElement>('[data-game-clock-message]')) {
    const rect = node.getBoundingClientRect()
    if (rect.height <= 0 || rect.bottom <= bounds.top || rect.top >= bounds.bottom) continue
    // A long reply may fill the viewport while its own midpoint is far offscreen.
    // Prefer the row containing the reading point, then the nearest visible edge.
    const delta = center < rect.top ? rect.top - center : center > rect.bottom ? center - rect.bottom : 0
    if (delta < distance) { distance = delta; picked = node.dataset.gameClockMessage ?? null }
  }
  return picked
}

function fill(pattern: string, values: Record<string, string | number>): string {
  return pattern.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key: string) => String(values[key] ?? match))
}

export function GameClock({ data, messages, sessionId, containerRef, atBottom }: {
  data: GameClockData; messages: ChatMessage[]; sessionId: string
  containerRef: RefObject<HTMLDivElement>; atBottom: boolean
}) {
  const [centered, setCentered] = useState<string | null>(null)
  const enabled = data.clock_mod?.enabled === true
  const readings = useMemo(() => gameClockReadings(messages, data, sessionId), [messages, data, sessionId])
  useEffect(() => {
    const container = containerRef.current
    if (!container || !enabled || atBottom) return
    let frame: number | null = null
    const schedule = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => { frame = null; setCentered(centeredClockMessage(container)) })
    }
    container.addEventListener('scroll', schedule, { capture: true, passive: true })
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    resize?.observe(container)
    const list = container.querySelector('.message-list')
    const mutations = new MutationObserver(schedule)
    if (list) mutations.observe(list, { childList: true, subtree: true, characterData: true })
    schedule()
    return () => {
      container.removeEventListener('scroll', schedule, true)
      resize?.disconnect(); mutations.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [containerRef, enabled, atBottom, messages, sessionId])
  if (!enabled) return null
  const reading: Reading | null = atBottom ? data.clock_mod ?? null : centered ? readings.get(centered) ?? null : null
  const when = reading?.when
  const sheet = { ...sheetSource, ...data.ui?.words?.sheet }, timeline = { ...timelineSource, ...data.ui?.words?.timeline }
  const pad = (value: number) => String(value).padStart(2, '0')
  const time = when ? `${pad(when.hh)}:${pad(when.mm)}` : '—:—'
  const dated = when && Number.isInteger(when.y) && Number.isInteger(when.mo) && Number.isInteger(when.d)
  const full = when ? dated
    ? fill(sheet.at, { y: when.y!, mo: when.mo!, d: when.d!, mo2: pad(when.mo!), d2: pad(when.d!), hh: pad(when.hh), mm: pad(when.mm) })
    : fill(sheet['day.clock'], { d: when.day ?? '—', hh: pad(when.hh), mm: pad(when.mm) })
    : '—'
  // The projected calendar pattern remains authoritative; removing its clock leaves the date.
  const date = when ? full.replace(time, '').trim() : '—'
  const hourAngle = when ? (when.hh % 12 + when.mm / 60) * 30 : 0
  const minuteAngle = when ? when.mm * 6 : 0
  return <aside className={`game-clock${atBottom ? '' : ' is-history'}`} data-testid="game-clock" data-mode={atBottom ? 'live' : 'history'} aria-label={`${sheet.time} · ${full}`}>
    <svg className="game-clock-dial" viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="20" />
      <path className="game-clock-ticks" d="M22 5v3M22 36v3M5 22h3M36 22h3" />
      {when && <><path className="game-clock-hour" d="M22 22V12" transform={`rotate(${hourAngle} 22 22)`} /><path className="game-clock-minute" d="M22 22V8" transform={`rotate(${minuteAngle} 22 22)`} /><circle className="game-clock-pin" cx="22" cy="22" r="1.8" /></>}
    </svg>
    <div className="game-clock-reading"><div className="game-clock-date">{date}</div><div className="game-clock-time">{time}</div></div>
    <div className="game-clock-context" title={atBottom ? timeline.youAreHere : timeline.title}>
      {atBottom ? <span className="game-clock-live-dot" /> : <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true"><path d="M2 7a6 6 0 1 1 1.5 5M2 3v4h4M8 4v4l2 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      <span>{sheet.turnKey} {reading?.turn ?? '—'}</span>
    </div>
  </aside>
}
