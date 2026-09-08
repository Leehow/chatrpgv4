import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { filterRailPrompts, groupRailPrompts, type RailGroup, type RailPrompt } from './prompt-rail'
import './prompt-rail.css'

/**
 * Left-edge navigation index over the player's own lines.
 *
 * Two states, one component. At rest it is the thin tick strip it has always been: one short
 * horizontal bar per prompt, hugging the transcript's left edge, active one accented. Point at it
 * (or tab into it) and it opens into a readable index — the lines cut into days, each row the
 * opening of what was typed, a search box on top, and a pin so it stays put while you read.
 *
 * The strip exists because a long session needs a sense of *where* you are; the panel exists
 * because a long session also needs to be *searched*. A play session runs hundreds of turns, and
 * the old strip could only answer "where" — finding one line meant hovering ticks one at a time.
 *
 * Two rules keep the strip honest as it grows:
 * - the pitch is measured, not fixed, so the whole session fits the rail's height instead of
 *   running off into an invisible internal scroll (down to MIN_PITCH; past that it does scroll,
 *   and the active tick is kept in view);
 * - nothing here reads what anyone wrote. Grouping is by calendar day, search is a literal
 *   substring — the rail finds text, it never decides what a line is about.
 */

/** Resting pitch between adjacent tick slots, and the floor it compresses to. */
export const RAIL_TICK_PITCH = 8
export const RAIL_MIN_PITCH = 3
/** Near-zero top/bottom padding inside the tick list. */
export const RAIL_TICK_PADDING = 1
/** Blank line between two days in the strip. */
export const RAIL_GROUP_GAP = 5
/** Row label for empty-content (image-only) prompts instead of an empty row. */
export const IMAGE_ONLY_FALLBACK = '图片消息'

export function PromptRail({ prompts, activeId, onJump }: {
  prompts: RailPrompt[]
  activeId: string | null
  onJump: (index: number, id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [query, setQuery] = useState('')
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [pitch, setPitch] = useState(RAIL_TICK_PITCH)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const stripGroups = useMemo(() => groupRailPrompts(prompts), [prompts])
  const matches = useMemo(() => filterRailPrompts(prompts, query), [prompts, query])
  const listGroups = useMemo(() => groupRailPrompts(matches), [matches])

  // Measured pitch: the strip's length is the session's length, bounded by the rail's own box.
  // jsdom and a not-yet-laid-out rail report 0 — those keep the resting pitch rather than
  // collapsing every tick onto the floor.
  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const height = node.clientHeight
      if (!height || !prompts.length) { setPitch(RAIL_TICK_PITCH); return }
      const gaps = Math.max(0, stripGroups.length - 1) * RAIL_GROUP_GAP
      const room = height - RAIL_TICK_PADDING * 2 - gaps
      const fitted = Math.floor(room / prompts.length)
      setPitch(Math.max(RAIL_MIN_PITCH, Math.min(RAIL_TICK_PITCH, fitted)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [prompts.length, stripGroups.length])

  // Past the pitch floor the strip scrolls, and a player 200 turns in would otherwise never see
  // their own position. Keep the active tick on screen.
  useEffect(() => {
    if (!activeId) return
    const tick = scrollRef.current?.querySelector<HTMLElement>(`[data-prompt-id="${cssEscape(activeId)}"]`)
    tick?.scrollIntoView?.({ block: 'nearest' })
  }, [activeId, pitch])

  // Pointing at a tick previews it in the open panel, so the strip works as a scrubber.
  useEffect(() => {
    if (!open || !hoverId) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-prompt-id="${cssEscape(hoverId)}"]`)
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [open, hoverId])

  const close = useCallback(() => { setOpen(false); setPinned(false); setHoverId(null) }, [])

  if (prompts.length === 0) return null

  const jump = (prompt: RailPrompt) => {
    onJump(prompt.index, prompt.id)
    if (!pinned) setOpen(false)
  }

  return (
    <nav
      className="prompt-rail"
      aria-label="用户输入导航"
      data-testid="prompt-rail"
      data-open={open || undefined}
      data-pinned={pinned || undefined}
      style={{ ['--rail-pitch' as string]: `${pitch}px`, ['--rail-group-gap' as string]: `${RAIL_GROUP_GAP}px` }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => { if (!pinned) { setOpen(false); setHoverId(null) } }}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={event => {
        if (pinned) return
        const next = event.relatedTarget as Node | null
        if (next && event.currentTarget.contains(next)) return
        setOpen(false)
      }}
      onKeyDown={event => { if (event.key === 'Escape') { close(); } }}
    >
      <div className="prompt-rail-scroll" ref={scrollRef}>
        {stripGroups.map(group => (
          <div className="prompt-rail-strip-group" key={group.key || 'undated'}>
            {group.prompts.map(prompt => (
              <button
                key={prompt.id}
                type="button"
                className="prompt-rail-tick"
                data-prompt-id={prompt.id}
                data-active={prompt.id === activeId || undefined}
                aria-label={`用户输入 ${prompt.ordinal}/${prompts.length}`}
                aria-current={prompt.id === activeId ? 'true' : undefined}
                onMouseEnter={() => setHoverId(prompt.id)}
                onMouseLeave={() => setHoverId(current => (current === prompt.id ? null : current))}
                onFocus={() => setHoverId(prompt.id)}
                onClick={() => jump(prompt)}
              />
            ))}
          </div>
        ))}
      </div>
      {open && (
        <div className="prompt-rail-panel" data-testid="prompt-rail-panel">
          <div className="prompt-rail-panel-head">
            <input
              className="prompt-rail-search"
              type="search"
              value={query}
              aria-label="搜索我说过的话"
              placeholder="输入关键字过滤…"
              data-testid="prompt-rail-search"
              onChange={event => setQuery(event.target.value)}
            />
            <button
              type="button"
              className="prompt-rail-pin"
              data-testid="prompt-rail-pin"
              aria-pressed={pinned}
              aria-label={pinned ? '取消钉住列表' : '钉住列表'}
              title={pinned ? '取消钉住列表' : '钉住列表'}
              onClick={() => setPinned(value => !value)}
            >
              <PinIcon pinned={pinned} />
            </button>
          </div>
          <div className="prompt-rail-list" ref={listRef}>
            {listGroups.length === 0
              ? <p className="prompt-rail-empty" role="status">没有匹配的发言。</p>
              : listGroups.map(group => <PanelGroup
                  key={group.key || 'undated'}
                  group={group}
                  activeId={activeId}
                  hoverId={hoverId}
                  onPick={jump}
                />)}
          </div>
        </div>
      )}
    </nav>
  )
}

function PanelGroup({ group, activeId, hoverId, onPick }: {
  group: RailGroup
  activeId: string | null
  hoverId: string | null
  onPick: (prompt: RailPrompt) => void
}) {
  return (
    <section className="prompt-rail-day">
      {group.label && <h3 className="prompt-rail-day-label">{group.label}</h3>}
      {group.prompts.map(prompt => (
        <button
          key={prompt.id}
          type="button"
          className="prompt-rail-row"
          data-prompt-id={prompt.id}
          data-active={prompt.id === activeId || undefined}
          data-hover={prompt.id === hoverId || undefined}
          onClick={() => onPick(prompt)}
        >
          <span className="prompt-rail-row-ordinal">{prompt.ordinal}</span>
          <span className="prompt-rail-row-text">{prompt.summary || IMAGE_ONLY_FALLBACK}</span>
        </button>
      ))}
    </section>
  )
}

function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"
      fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M9.5 1.8l4.7 4.7-2 .5-1 1 .6 3-2.1-2.1-4.4 4.4.5-2.7 2.3-2.3-2.1-2.1 3-.6 1-1z" />
    </svg>
  )
}

/** Message ids are host-minted, so quote them before they reach a selector. */
function cssEscape(value: string): string {
  const escape = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS?.escape
  return escape ? escape(value) : value.replace(/["\\]/g, '\\$&')
}

/**
 * Resolve which user prompt is "current" for the rail.
 *
 * Mirrors Swift's `resolvedCurrentMessageID`: while live (following output)
 * the latest user prompt is current; while browsing history the bottom-most
 * *visible* user prompt in the transcript viewport is current. An
 * IntersectionObserver rooted at the transcript container tracks visible user
 * messages; it degrades gracefully to the live rule when the browser has no
 * IntersectionObserver (e.g. jsdom).
 *
 * The returned `containerRef` must be attached to the transcript container so
 * the observer can measure visibility against it.
 */
export function useActivePromptId(prompts: RailPrompt[], atBottom: boolean): { activeId: string | null; containerRef: React.RefObject<HTMLDivElement> } {
  const containerRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const promptsRef = useRef(prompts)
  promptsRef.current = prompts

  // Live/latest → last user node (Swift parity, and the no-IO fallback).
  useEffect(() => {
    if (atBottom && prompts.length > 0) setActiveId(prompts[prompts.length - 1].id)
  }, [atBottom, prompts])

  // Viewport-derived active while browsing history.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined') return
    const root = containerRef.current
    if (!root) return

    const visible = new Map<string, number>() // prompt id → message index
    let raf = 0
    const pickBottomMost = () => {
      const indexById = new Map(promptsRef.current.map(p => [p.id, p.index]))
      let bestId: string | null = null
      let bestIndex = -1
      for (const [id, index] of visible) {
        const resolved = indexById.get(id) ?? index
        if (resolved > bestIndex) { bestIndex = resolved; bestId = id }
      }
      if (bestId) setActiveId(bestId)
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement
        const id = el.dataset.userPrompt
        if (!id) continue
        if (entry.isIntersecting) visible.set(id, Number(el.dataset.userIndex ?? -1))
        else visible.delete(id)
      }
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(pickBottomMost)
    }, { root, threshold: 0 })

    const observed = new Set<Element>()
    const scan = () => {
      root.querySelectorAll<HTMLElement>('[data-user-prompt]').forEach(el => {
        if (!observed.has(el)) { observed.add(el); observer.observe(el) }
      })
    }
    scan()
    const mo = new MutationObserver(scan)
    mo.observe(root, { childList: true, subtree: true })
    return () => { observer.disconnect(); mo.disconnect(); cancelAnimationFrame(raf) }
  }, [prompts])

  return { activeId, containerRef }
}
