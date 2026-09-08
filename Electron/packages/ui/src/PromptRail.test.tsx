// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useMemo } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry } from '@pipi/host-api'
import { App } from './App'
import { createMockHost } from './mock-host'
import { PromptRail, useActivePromptId } from './PromptRail'
import {
  buildRailPrompts,
  dayLabel,
  filterRailPrompts,
  groupRailPrompts,
  isNavigationEligibleUserPrompt,
  isRuntimeOrSystemInjectedUserText,
  promptSummaryText,
  RAIL_TOOLTIP_MAX_LENGTH
} from './prompt-rail'
import type { RailPrompt } from './prompt-rail'

const virtuosoHarness = { atBottom: undefined as undefined | ((value: boolean) => void), scrollToIndex: vi.fn() }
vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return { Virtuoso: React.forwardRef(({ data, itemContent, atBottomStateChange }: { data: unknown[]; itemContent: (index: number, item: never) => JSX.Element; atBottomStateChange?: (value: boolean) => void }, ref) => { virtuosoHarness.atBottom = atBottomStateChange; React.useImperativeHandle(ref, () => ({ scrollToIndex: virtuosoHarness.scrollToIndex })); return <div>{data.map((item, index) => <React.Fragment key={index}>{itemContent(index, item as never)}</React.Fragment>)}</div> }) }
})

vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))

/** Minimal IntersectionObserver stand-in so the active-prompt viewport logic is drivable. */
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  callback: IntersectionObserverCallback
  targets = new Set<Element>()
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    MockIntersectionObserver.instances.push(this)
  }
  observe(target: Element) { this.targets.add(target) }
  unobserve(target: Element) { this.targets.delete(target) }
  disconnect() { this.targets.clear() }
  emit(target: Element, isIntersecting: boolean) {
    this.callback([{ target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  MockIntersectionObserver.instances.length = 0
  virtuosoHarness.scrollToIndex.mockClear()
})

// ---------------------------------------------------------------------------
// Message classification (mirrors Swift isNavigationEligibleHumanPrompt)
// ---------------------------------------------------------------------------

describe('prompt-rail message classification', () => {
  // Mixed fixture: system/tool/assistant + runtime-injected user-role signals
  // + real human prompts (including an empty-content image-only prompt).
  const fixture = [
    { id: 'sys', role: 'system', content: 'system policy' },
    { id: 'asst', role: 'assistant', content: '我会先检查现有结构。' },
    { id: 'tool', role: 'tool', content: 'read: package.json' },
    { id: 'hb', role: 'user', content: '[subagent-heartbeat] outstanding=1 vanished=0' },
    { id: 'done', role: 'user', content: '[subagent-done] agentId=w1 name=worker ok=true' },
    { id: 'stalled', role: 'user', content: '[subagent-stalled] agentId=w1 idle=120s' },
    { id: 'interrupt', role: 'user', content: '[subagent-interrupted-reminder] agentId=w2 state=interrupted nudge=1/2' },
    { id: 'worktree', role: 'user', content: '[worktree-merge-failed] agentId=w1 branch=x' },
    { id: 'postmerge', role: 'user', content: '[post-merge-verify-failed] agentId=w1 branch=x' },
    { id: 'watch', role: 'user', content: '[browser-watch] watchId=bw-7 reason=matched waitedMs=1500 url=https://example.com/ready title=Ready' },
    { id: 'watchwrap', role: 'user', content: '(re-delivery #1: Pi did not confirm the prior follow-up; obligationId=o1; treat it as the same event.)\n[browser-watch] watchId=bw-8 reason=timeout waitedMs=60000' },
    { id: 'watchfuture', role: 'user', content: '[browser-watch] watchId=bw-9 reason=expired waitedMs=10' },
    { id: 'git', role: 'user', content: '## Git (Pipi UI)\nbranch: main\ndirty: no' },
    { id: 'policy', role: 'user', content: '[PipiUI session skill policy: opt-in only.]' },
    { id: 'title', role: 'user', content: '[PipiUI internal — session title] generate title' },
    { id: 'redeliver', role: 'user', content: '(re-delivery #1: the previous [subagent-done] below was not confirmed)' },
    { id: 'recovered', role: 'user', content: '(recovered delivery of the previous [subagent-done])' },
    { id: 'watchplain', role: 'user', content: '[browser-watch] 普通文本乱写' }, // malformed marker-lookalike: stays a human prompt
    { id: 'watchbadms', role: 'user', content: '[browser-watch] watchId=bw-1 reason=matched waitedMs=abc' }, // non-canonical: stays a human prompt
    { id: 'u1', role: 'user', content: '第一问：修导航' },
    { id: 'u2', role: 'user', content: '带图提问' },
    { id: 'u3', role: 'user', content: '' } // image-only prompt stays eligible (Swift parity)
  ]

  it('keeps only real human user prompts from the mixed fixture', () => {
    expect(fixture.filter(isNavigationEligibleUserPrompt).map(m => m.id)).toEqual(['watchplain', 'watchbadms', 'u1', 'u2', 'u3'])
  })

  it('builds rail nodes with transcript indices and plain summaries', () => {
    const prompts = buildRailPrompts(fixture)
    expect(prompts.map(p => p.id)).toEqual(['watchplain', 'watchbadms', 'u1', 'u2', 'u3'])
    expect(prompts.map(p => p.index)).toEqual([17, 18, 19, 20, 21])
    expect(prompts.map(p => p.summary)).toEqual(['[browser-watch] 普通文本乱写', '[browser-watch] watchId=bw-1 reason=matched waitedMs=abc', '第一问：修导航', '带图提问', ''])
  })

  it('prefers structured kind/source metadata when the host provides it', () => {
    expect(isNavigationEligibleUserPrompt({ id: 'x', role: 'user', content: 'hello', kind: 'subagent-done' })).toBe(false)
    expect(isNavigationEligibleUserPrompt({ id: 'x', role: 'user', content: 'hello', source: 'host' })).toBe(false)
    expect(isNavigationEligibleUserPrompt({ id: 'x', role: 'user', content: 'hello', source: 'system' })).toBe(false)
    expect(isNavigationEligibleUserPrompt({ id: 'x', role: 'user', content: 'hello', kind: 'user' })).toBe(true)
    // The content fallback still applies even with benign metadata.
    expect(isNavigationEligibleUserPrompt({ id: 'x', role: 'user', content: '[subagent-done] x', kind: 'user' })).toBe(false)
  })

  it('excludes browser-watch only through the shared strict parser, not a blind prefix', () => {
    expect(isRuntimeOrSystemInjectedUserText('[subagent-done] x')).toBe(true)
    expect(isRuntimeOrSystemInjectedUserText('[browser-watch] watchId=bw-7 reason=matched waitedMs=1')).toBe(true)
    expect(isRuntimeOrSystemInjectedUserText('[browser-watch] watchId=bw-9 reason=expired waitedMs=10')).toBe(true)
    // Malformed marker-lookalikes stay ordinary human prompts.
    expect(isRuntimeOrSystemInjectedUserText('[browser-watch] 普通文本乱写')).toBe(false)
    expect(isRuntimeOrSystemInjectedUserText('[browser-watch] watchId=bw-1 reason=matched')).toBe(false)
    expect(isRuntimeOrSystemInjectedUserText('[browser-watch] watchId=bw-1 reason=matched waitedMs=abc')).toBe(false)
    expect(isRuntimeOrSystemInjectedUserText('[browser-watch hello]')).toBe(false)
    // Other families keep their prefix semantics.
    expect(isRuntimeOrSystemInjectedUserText('[PipiUI internal — session title] x')).toBe(true)
    expect(isRuntimeOrSystemInjectedUserText('## Git (Pipi UI)\nbranch: main')).toBe(true)
    expect(isRuntimeOrSystemInjectedUserText('(re-delivery #1 …)')).toBe(true)
    expect(isRuntimeOrSystemInjectedUserText('normal prompt')).toBe(false)
    expect(isRuntimeOrSystemInjectedUserText('')).toBe(false)
  })

  it('strips markdown, collapses whitespace, and truncates summaries', () => {
    expect(promptSummaryText('**bold** and `code` and [link](https://x)')).toBe('bold and code and link')
    expect(promptSummaryText('# Header\n\n- item one\n- item two')).toBe('Header item one item two')
    expect(promptSummaryText('a\n\n  b\t c')).toBe('a b c')
    expect(promptSummaryText('')).toBe('')
    const long = 'x'.repeat(200)
    const summary = promptSummaryText(long)
    expect(Array.from(summary)).toHaveLength(RAIL_TOOLTIP_MAX_LENGTH + 1)
    expect(summary.endsWith('…')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// PromptRail view
// ---------------------------------------------------------------------------

/** Rail nodes without hand-writing every derived field. */
function node(id: string, index: number, ordinal: number, text: string, timestamp = 0) {
  return { id, index, ordinal, summary: text, haystack: text, timestamp }
}

describe('day grouping and search', () => {
  // 2026-09-07 20:00 local and 2026-09-08 09:00 local.
  const day1 = new Date(2026, 8, 7, 20, 0).getTime()
  const day2 = new Date(2026, 8, 8, 9, 0).getTime()
  const now = new Date(2026, 8, 9, 12, 0).getTime()

  it('carries the ordinal, timestamp and full text a rail row needs', () => {
    const prompts = buildRailPrompts([
      { id: 'a', role: 'assistant', content: 'x', timestamp: day1 },
      { id: 'u1', role: 'user', content: '**我先去**看看桑切斯的办公室', timestamp: day1 },
      { id: 'hb', role: 'user', content: '[subagent-done] noise', timestamp: day1 },
      { id: 'u2', role: 'user', content: '继续等待原文核对', timestamp: day2 }
    ])
    expect(prompts.map(p => p.ordinal)).toEqual([1, 2])
    expect(prompts.map(p => p.timestamp)).toEqual([day1, day2])
    expect(prompts[0].haystack).toBe('我先去看看桑切斯的办公室')
  })

  it('cuts the lines into calendar days, newest label last', () => {
    const groups = groupRailPrompts([node('u1', 0, 1, 'a', day1), node('u2', 1, 2, 'b', day1), node('u3', 2, 3, 'c', day2)], now)
    expect(groups.map(g => g.label)).toEqual(['9月7日', '昨天'])
    expect(groups.map(g => g.prompts.length)).toEqual([2, 1])
  })

  it('labels today and yesterday, and dates anything older', () => {
    expect(dayLabel(now, now)).toBe('今天')
    expect(dayLabel(day2, now)).toBe('昨天')
    expect(dayLabel(day1, now)).toBe('9月7日')
    expect(dayLabel(new Date(2025, 11, 31, 12, 0).getTime(), now)).toBe('2025年12月31日')
  })

  it('leaves undated lines in one unlabelled group rather than inventing a date', () => {
    const groups = groupRailPrompts([node('u1', 0, 1, 'a'), node('u2', 1, 2, 'b')], now)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('')
  })

  it('matches a literal substring of the whole line, case-folded', () => {
    const prompts = [node('u1', 0, 1, '我先去看看桑切斯的办公室'), node('u2', 1, 2, 'Ask Hughes about the plateau')]
    expect(filterRailPrompts(prompts, '桑切斯').map(p => p.id)).toEqual(['u1'])
    expect(filterRailPrompts(prompts, 'HUGHES').map(p => p.id)).toEqual(['u2'])
    expect(filterRailPrompts(prompts, '   ').map(p => p.id)).toEqual(['u1', 'u2'])
    expect(filterRailPrompts(prompts, '不存在')).toEqual([])
  })
})

describe('PromptRail', () => {
  // Two fixed past days, so the rendered headers are absolute dates whatever "today" is.
  const day1 = new Date(2025, 2, 4, 20, 0).getTime()
  const day2 = new Date(2025, 2, 5, 9, 0).getTime()
  const prompts: RailPrompt[] = [
    node('u1', 0, 1, '我先去看看桑切斯的办公室', day1),
    node('u2', 5, 2, '继续等待原文核对', day1),
    node('u3', 9, 3, '', day2) // image-only prompt → row fallback
  ]

  it('renders one small tick per prompt with ordinal labels', () => {
    render(<PromptRail prompts={prompts} activeId={null} onJump={vi.fn()} />)
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.getByRole('button', { name: '用户输入 1/3' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '用户输入 3/3' })).toBeTruthy()
  })

  it('hides entirely when there are no user prompts', () => {
    const { container } = render(<PromptRail prompts={[]} activeId={null} onJump={vi.fn()} />)
    expect(container.querySelector('.prompt-rail')).toBeNull()
  })

  it('stays navigable but low-interference with a single prompt', () => {
    render(<PromptRail prompts={[node('u1', 2, 1, 'only')]} activeId="u1" onJump={vi.fn()} />)
    const tick = screen.getByRole('button', { name: '用户输入 1/1' })
    expect(tick.getAttribute('data-active')).toBe('true')
    fireEvent.click(tick)
  })

  it('highlights only the active prompt', () => {
    render(<PromptRail prompts={prompts} activeId="u2" onJump={vi.fn()} />)
    const active = screen.getByRole('button', { name: '用户输入 2/3' })
    expect(active.getAttribute('data-active')).toBe('true')
    expect(active.getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('button', { name: '用户输入 1/3' }).getAttribute('data-active')).toBeNull()
  })

  it('separates days in the strip so a long session has landmarks', () => {
    const { container } = render(<PromptRail prompts={prompts} activeId={null} onJump={vi.fn()} />)
    const groups = container.querySelectorAll('.prompt-rail-strip-group')
    expect(groups).toHaveLength(2)
    expect(groups[0].querySelectorAll('.prompt-rail-tick')).toHaveLength(2)
    expect(groups[1].querySelectorAll('.prompt-rail-tick')).toHaveLength(1)
  })

  it('stays a closed strip until it is pointed at', () => {
    render(<PromptRail prompts={prompts} activeId={null} onJump={vi.fn()} />)
    expect(screen.queryByTestId('prompt-rail-panel')).toBeNull()
    fireEvent.mouseEnter(screen.getByTestId('prompt-rail'))
    expect(screen.getByTestId('prompt-rail-panel')).toBeTruthy()
    fireEvent.mouseLeave(screen.getByTestId('prompt-rail'))
    expect(screen.queryByTestId('prompt-rail-panel')).toBeNull()
  })

  it('opens the index as a readable list, grouped by day, with an image fallback', () => {
    render(<PromptRail prompts={prompts} activeId={null} onJump={vi.fn()} />)
    fireEvent.mouseEnter(screen.getByTestId('prompt-rail'))
    const panel = screen.getByTestId('prompt-rail-panel')
    expect(within(panel).getByText('2025年3月4日')).toBeTruthy()
    expect(within(panel).getByText('2025年3月5日')).toBeTruthy()
    expect(within(panel).getByText('我先去看看桑切斯的办公室')).toBeTruthy()
    expect(within(panel).getByText('图片消息')).toBeTruthy()
    expect([...panel.querySelectorAll('.prompt-rail-row-ordinal')].map(n => n.textContent)).toEqual(['1', '2', '3'])
  })

  it('opens on keyboard focus too, so the index is reachable without a mouse', () => {
    render(<PromptRail prompts={prompts} activeId={null} onJump={vi.fn()} />)
    fireEvent.focus(screen.getByRole('button', { name: '用户输入 2/3' }))
    expect(screen.getByTestId('prompt-rail-panel')).toBeTruthy()
  })

  it('filters the list to a literal substring and says so when nothing matches', () => {
    render(<PromptRail prompts={prompts} activeId={null} onJump={vi.fn()} />)
    fireEvent.mouseEnter(screen.getByTestId('prompt-rail'))
    const search = screen.getByTestId('prompt-rail-search')
    fireEvent.change(search, { target: { value: '桑切斯' } })
    const panel = screen.getByTestId('prompt-rail-panel')
    expect(within(panel).getByText('我先去看看桑切斯的办公室')).toBeTruthy()
    expect(within(panel).queryByText('继续等待原文核对')).toBeNull()
    // The ordinal keeps counting the whole session, not the filtered view.
    expect([...panel.querySelectorAll('.prompt-rail-row-ordinal')].map(n => n.textContent)).toEqual(['1'])
    fireEvent.change(search, { target: { value: '奥斯陆' } })
    expect(within(panel).getByText('没有匹配的发言。')).toBeTruthy()
  })

  it('jumps from a tick and from a list row, and the strip keeps its ticks unfiltered', () => {
    const onJump = vi.fn()
    render(<PromptRail prompts={prompts} activeId={null} onJump={onJump} />)
    fireEvent.click(screen.getByRole('button', { name: '用户输入 2/3' }))
    expect(onJump).toHaveBeenCalledWith(5, 'u2')

    fireEvent.mouseEnter(screen.getByTestId('prompt-rail'))
    fireEvent.change(screen.getByTestId('prompt-rail-search'), { target: { value: '桑切斯' } })
    expect(document.querySelectorAll('.prompt-rail-tick')).toHaveLength(3)
    fireEvent.click(screen.getByText('我先去看看桑切斯的办公室'))
    expect(onJump).toHaveBeenLastCalledWith(0, 'u1')
  })

  it('closes after a jump unless the list is pinned', () => {
    render(<PromptRail prompts={prompts} activeId={null} onJump={vi.fn()} />)
    fireEvent.mouseEnter(screen.getByTestId('prompt-rail'))
    fireEvent.click(screen.getByText('继续等待原文核对'))
    expect(screen.queryByTestId('prompt-rail-panel')).toBeNull()

    fireEvent.mouseEnter(screen.getByTestId('prompt-rail'))
    fireEvent.click(screen.getByTestId('prompt-rail-pin'))
    fireEvent.click(screen.getByText('继续等待原文核对'))
    expect(screen.getByTestId('prompt-rail-panel')).toBeTruthy()
    // Pinned means the mouse can leave the rail and read the list.
    fireEvent.mouseLeave(screen.getByTestId('prompt-rail'))
    expect(screen.getByTestId('prompt-rail-panel')).toBeTruthy()
  })

  it('lets Escape drop the pin and close the list', () => {
    render(<PromptRail prompts={prompts} activeId={null} onJump={vi.fn()} />)
    fireEvent.mouseEnter(screen.getByTestId('prompt-rail'))
    fireEvent.click(screen.getByTestId('prompt-rail-pin'))
    expect(screen.getByTestId('prompt-rail-pin').getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(screen.getByTestId('prompt-rail'), { key: 'Escape' })
    expect(screen.queryByTestId('prompt-rail-panel')).toBeNull()
    fireEvent.mouseLeave(screen.getByTestId('prompt-rail'))
    fireEvent.mouseEnter(screen.getByTestId('prompt-rail'))
    expect(screen.getByTestId('prompt-rail-pin').getAttribute('aria-pressed')).toBe('false')
  })

  it('previews the pointed-at tick as the matching row in the open list', () => {
    render(<PromptRail prompts={prompts} activeId={null} onJump={vi.fn()} />)
    fireEvent.mouseEnter(screen.getByTestId('prompt-rail'))
    fireEvent.mouseEnter(screen.getByRole('button', { name: '用户输入 2/3' }))
    const row = screen.getByText('继续等待原文核对').closest('.prompt-rail-row')
    expect(row?.getAttribute('data-hover')).toBe('true')
  })

  it('lays out many prompts as a compact measured-pitch list, not absolute message offsets', () => {
    const many = Array.from({ length: 20 }, (_, i) => node(`u${i}`, i, i + 1, `prompt ${i}`))
    const { container } = render(<PromptRail prompts={many} activeId={null} onJump={vi.fn()} />)
    const rail = screen.getByTestId('prompt-rail')
    const ticks = container.querySelectorAll('.prompt-rail-tick')
    expect(ticks).toHaveLength(20)
    // Compact list: ticks are flow siblings inside a group with no per-tick absolute
    // top/left (no message-offset spreading).
    for (const tick of ticks) expect(tick.getAttribute('style')).toBeNull()
    expect(ticks[0].parentElement?.className).toContain('prompt-rail-strip-group')
    // An unmeasured rail (jsdom, first paint) keeps the resting pitch rather than
    // collapsing every tick onto the compressed floor.
    expect(rail.getAttribute('style')).toContain('--rail-pitch: 8px')
  })

  it('sizes the index panel so CJK wraps instead of collapsing into a column', () => {
    const css = readFileSync(join(__dirname, 'prompt-rail.css'), 'utf8')
    expect(css).toContain('width:clamp(220px, 30vw, 320px)')
    expect(css).toContain('min-width:220px')
    expect(css).toContain('max-height:min(70vh, calc(100dvh - 96px))')
    expect(css).not.toContain('max-height:240px')
    // A 900px desktop viewport exposes a 630px rail — not a short 240px block.
    expect(Math.min(900 * 0.7, 900 - 96)).toBeGreaterThan(500)
    expect(css).not.toContain('border-radius:50%')
    // The bar can never outgrow its own slot once the pitch compresses.
    expect(css).toContain('height:min(3px, calc(var(--rail-pitch, 8px) - 1px))')
  })

  it('draws its own buttons instead of borrowing the shell’s global reset', () => {
    // A tick that leans on `button{border:0;background:transparent}` from app.css grows a system
    // button's border and grey fill anywhere that rule is overridden — which is exactly what the
    // ticks did inside a host that injects its own reset after ours.
    const css = readFileSync(join(__dirname, 'prompt-rail.css'), 'utf8')
    const tickRule = css.slice(css.indexOf('.prompt-rail-tick{'), css.indexOf('.prompt-rail-tick::before'))
    for (const declaration of ['border:0', 'background:transparent', 'appearance:none', 'font:inherit']) {
      expect(tickRule).toContain(declaration)
    }
  })
})

// ---------------------------------------------------------------------------
// useActivePromptId (viewport-derived "current" marker)
// ---------------------------------------------------------------------------

describe('useActivePromptId', () => {
  function Harness({ atBottom }: { atBottom: boolean }) {
    const messages = [
      { id: 'u1', role: 'user', content: 'first' },
      { id: 'u2', role: 'user', content: 'second' }
    ]
    const prompts = useMemo(() => buildRailPrompts(messages), [])
    const { activeId, containerRef } = useActivePromptId(prompts, atBottom)
    return <div ref={containerRef} data-testid="harness">
      <div data-user-prompt="u1" data-user-index={0} />
      <div data-user-prompt="u2" data-user-index={1} />
      <span data-testid="active-id">{activeId ?? 'none'}</span>
    </div>
  }

  beforeEach(() => { vi.stubGlobal('IntersectionObserver', MockIntersectionObserver) })

  it('treats the latest user prompt as current while live', async () => {
    render(<Harness atBottom />)
    await waitFor(() => expect(screen.getByTestId('active-id').textContent).toBe('u2'))
  })

  it('tracks the bottom-most visible user prompt while browsing history', async () => {
    render(<Harness atBottom={false} />)
    await waitFor(() => expect(MockIntersectionObserver.instances.length).toBe(1))
    const io = MockIntersectionObserver.instances[0]
    const el = (id: string) => [...io.targets].find(t => t.getAttribute('data-user-prompt') === id)!
    const u1 = el('u1')
    const u2 = el('u2')

    io.emit(u2, true)
    await waitFor(() => expect(screen.getByTestId('active-id').textContent).toBe('u2'))
    io.emit(u2, false)
    io.emit(u1, true)
    await waitFor(() => expect(screen.getByTestId('active-id').textContent).toBe('u1'))
  })
})

// ---------------------------------------------------------------------------
// Integration: App wiring with the mixed fixture
// ---------------------------------------------------------------------------

describe('PromptRail integration in App', () => {
  const mixedHistory: HistoryEntry[] = [
    { id: 's1', role: 'assistant', content: '我会先检查现有结构。', timestamp: 1 },
    { id: 'u1', role: 'user', content: '请实现导航 rail', timestamp: 2 },
    { id: 'hb', role: 'user', content: '[subagent-heartbeat] outstanding=1 vanished=0', timestamp: 3 },
    { id: 't1', role: 'tool', content: 'read: package.json', timestamp: 4 },
    { id: 'a1', role: 'assistant', content: '正在实现…', timestamp: 5 },
    { id: 'done', role: 'user', content: '[subagent-done] agentId=w1 name=worker ok=true', timestamp: 6 },
    { id: 'u2', role: 'user', content: '第二问：加个测试', timestamp: 7 },
    { id: 'stalled', role: 'user', content: '[subagent-stalled] agentId=w1 idle=120s', timestamp: 8 }
  ]

  beforeEach(() => { vi.stubGlobal('IntersectionObserver', MockIntersectionObserver) })

  it('marks only real user prompts, opens a searchable index, scrolls on click, tracks active', async () => {
    const host = createMockHost()
    vi.spyOn(host, 'getSessionHistory').mockResolvedValue(mixedHistory)
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    virtuosoHarness.scrollToIndex.mockClear()

    const rail = screen.getByTestId('prompt-rail')
    const ticks = rail.querySelectorAll('.prompt-rail-tick')
    // u1 + u2 only; heartbeat/done/stalled (user-role) and tool/assistant are excluded.
    expect(ticks).toHaveLength(2)
    const tick1 = within(rail).getByRole('button', { name: '用户输入 1/2' })
    const tick2 = within(rail).getByRole('button', { name: '用户输入 2/2' })

    // Live mode → latest user prompt is current.
    await waitFor(() => expect(tick2.getAttribute('data-active')).toBe('true'))

    // Pointing at the rail opens the index over the player's own lines, and only those.
    fireEvent.mouseEnter(rail)
    const panel = screen.getByTestId('prompt-rail-panel')
    expect(within(panel).getByText('第二问：加个测试')).toBeTruthy()
    expect(within(panel).getByText('请实现导航 rail')).toBeTruthy()
    expect(within(panel).queryByText(/subagent-/)).toBeNull()
    // Searching it reaches one line out of the session.
    fireEvent.change(screen.getByTestId('prompt-rail-search'), { target: { value: '加个测试' } })
    expect(within(panel).queryByText('请实现导航 rail')).toBeNull()
    fireEvent.change(screen.getByTestId('prompt-rail-search'), { target: { value: '' } })
    fireEvent.mouseLeave(rail)

    // Click scrolls the existing transcript container to the message index and
    // keeps the sought prompt current (Swift "seeking" semantics).
    fireEvent.click(tick1)
    expect(virtuosoHarness.scrollToIndex).toHaveBeenCalledWith({ index: 1, align: 'start', behavior: 'smooth' })
    await waitFor(() => expect(tick1.getAttribute('data-active')).toBe('true'))
  })

  it('hides the rail for a session with no user prompts', async () => {
    const host = createMockHost()
    vi.spyOn(host, 'getSessionHistory').mockResolvedValue([
      { id: 's1', role: 'assistant', content: 'nothing to do', timestamp: 1 },
      { id: 'hb', role: 'user', content: '[subagent-heartbeat] outstanding=0 vanished=0', timestamp: 2 }
    ])
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    expect(container.querySelector('.prompt-rail')).toBeNull()
    expect(screen.queryByTestId('prompt-rail')).toBeNull()
  })

  it('replaces the old dot style with thin tick CSS', () => {
    const appCss = readFileSync(join(__dirname, 'app.css'), 'utf8')
    // Old big-dot rail (circles on user messages) must be gone from app.css.
    expect(appCss).not.toContain('.prompt-rail button')
    expect(appCss).not.toContain('.prompt-rail{position:absolute')
    const railCss = readFileSync(join(__dirname, 'prompt-rail.css'), 'utf8')
    expect(railCss).toContain('.prompt-rail-tick::before')
    expect(railCss).toContain('width:14px') // rail column / active tick
    expect(railCss).toContain('min-width:14px')
    expect(railCss).toContain('padding:1px 0')
    expect(railCss).toContain('width:9px') // inactive tick
    expect(railCss).toContain('width:12px') // hover tick
    expect(railCss).toContain('height:var(--rail-pitch, 8px)')
    expect(railCss).toContain('max-height:min(70vh, calc(100dvh - 96px))')
    expect(railCss).not.toContain('max-height:240px')
    expect(railCss).toContain('border-radius:1.5px')
    expect(railCss).toContain('width:clamp(220px, 30vw, 320px)')
    // The hover card the panel replaced must not linger in either sheet.
    expect(railCss).not.toContain('.prompt-rail-tooltip')
    expect(appCss).not.toContain('.prompt-rail-tooltip')
  })
})
