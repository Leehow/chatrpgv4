/**
 * User-prompt navigation rail projection.
 *
 * Mirrors Swift `MessageActions.isNavigationEligibleHumanPrompt` +
 * `UserPromptIndex` semantics: rail items must come from *real human user
 * input* only. Runtime/system injections that reuse the user role (subagent
 * heartbeats / done / stalled / interrupted-reminder, worktree + post-merge
 * notifications, session sentinels, git status snapshots, delivery wrappers)
 * are excluded, as are every non-user role (assistant, tool, system, …).
 *
 * The current host protocol (`HistoryEntry`) exposes only `role` + `content`,
 * so there is no structured kind/source metadata to prefer today. The
 * classifier is still written against an optional `kind`/`source` input so a
 * metadata path can slot in when the host adds one; without it, it falls back
 * to the same conservative content-prefix rules Swift uses.
 */

import { isBrowserWatchSignalText } from './subagent-signal'

export type RailPromptInput = {
  id: string
  role: string
  content: string
  /** Epoch millis the message carries; 0/absent when the host did not stamp one. */
  timestamp?: number
  /** Optional structured kind (e.g. 'subagent-done'); when set, drives classification. */
  kind?: string
  /** Optional source tag (e.g. 'host' | 'system'); when set, drives classification. */
  source?: string
}

export type RailPrompt = {
  /** Stable message id (ChatMessage.id). */
  id: string
  /** Index of the message inside the transcript (used for scroll-to). */
  index: number
  /** 1-based position among the player's own lines — the number the index list prints. */
  ordinal: number
  /** Plain-text summary (markdown stripped, whitespace collapsed, truncated). */
  summary: string
  /** Epoch millis, for day grouping; 0 when unknown. */
  timestamp: number
  /** The whole cleaned line, untruncated — what a search query is matched against. */
  haystack: string
}

/** Max grapheme length for rail hover/focus summaries (Swift uses 72; 80–120 requested). */
export const RAIL_TOOLTIP_MAX_LENGTH = 96

/**
 * Family prefixes for runtime/system content stored or streamed with the user
 * role but not authored by the human. Mirrors the retired Swift
 * `isRuntimeOrSystemInjectedUserText`. `[browser-watch]` is deliberately NOT
 * here: a blind prefix would swallow malformed marker-lookalikes typed by a
 * human, so that family is excluded through the shared strict parser
 * (isBrowserWatchSignalText) instead.
 */
export const RUNTIME_INJECTION_PREFIXES = [
  '[subagent-', // heartbeat / done / stalled / interrupted-reminder / …
  '[worktree-', // worktree merge notifications
  '[post-merge-', // post-merge verify notifications
  '[PipiUI', // session sentinels: skill policy, isolation, internal title jobs
  '## Git (Pipi UI)', // git extension status snapshot leaked into user role
  '(re-delivery', // done-message delivery wrappers
  '(recovered delivery'
] as const

export function isRuntimeOrSystemInjectedUserText(text: string): boolean {
  if (!text) return false
  return RUNTIME_INJECTION_PREFIXES.some(prefix => text.startsWith(prefix))
    || isBrowserWatchSignalText(text)
}

/**
 * Single reusable predicate: real human user input eligible for the prompt
 * rail. Role gate first (assistant/tool/system excluded), then structured
 * metadata when present, then the conservative content-prefix fallback.
 */
export function isNavigationEligibleUserPrompt(message: RailPromptInput): boolean {
  if (message.role !== 'user') return false
  const kind = message.kind?.trim().toLowerCase()
  const source = message.source?.trim().toLowerCase()
  if (kind && kind !== 'user' && kind !== 'prompt') return false
  if (source && source !== 'user' && source !== 'human') return false
  // Empty content stays eligible (image-only prompts), matching Swift.
  return !isRuntimeOrSystemInjectedUserText(message.content ?? '')
}

/** Project transcript messages → rail nodes (oldest → newest), eligible users only. */
export function buildRailPrompts(messages: RailPromptInput[]): RailPrompt[] {
  let ordinal = 0
  return messages.flatMap((message, index) => {
    if (!isNavigationEligibleUserPrompt(message)) return []
    const haystack = plainText(message.content)
    ordinal += 1
    return [{
      id: message.id,
      index,
      ordinal,
      summary: truncateText(haystack, RAIL_TOOLTIP_MAX_LENGTH),
      timestamp: Number.isFinite(message.timestamp) ? Number(message.timestamp) : 0,
      haystack,
    }]
  })
}

/** One day's worth of prompts in the index list. `label` is empty for undated messages. */
export type RailGroup = { key: string; label: string; prompts: RailPrompt[] }

const DAY = 86_400_000

/**
 * The player's own lines, cut into days.
 *
 * A play session runs for hours across several sittings, so the date is the one grouping the
 * transcript already carries — no reading of what anyone wrote. Messages the host never stamped
 * fall into one unlabelled group rather than inventing a date for them.
 */
export function groupRailPrompts(prompts: readonly RailPrompt[], now: number = Date.now()): RailGroup[] {
  const groups: RailGroup[] = []
  for (const prompt of prompts) {
    const key = prompt.timestamp > 0 ? dayKey(prompt.timestamp) : ''
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.prompts.push(prompt)
    else groups.push({ key, label: key ? dayLabel(prompt.timestamp, now) : '', prompts: [prompt] })
  }
  return groups
}

/** Local calendar day, as `YYYY-M-D`. Local on purpose: a table sits in one timezone. */
function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

/** 今天 / 昨天 for the two days a player is most likely to scroll back through, else a date. */
export function dayLabel(timestamp: number, now: number = Date.now()): string {
  const date = new Date(timestamp)
  const today = new Date(now)
  if (dayKey(timestamp) === dayKey(now)) return '今天'
  if (dayKey(timestamp) === dayKey(now - DAY)) return '昨天'
  const month = date.getMonth() + 1
  const day = date.getDate()
  return date.getFullYear() === today.getFullYear()
    ? `${month}月${day}日`
    : `${date.getFullYear()}年${month}月${day}日`
}

/**
 * Substring match over the whole cleaned line, case-folded. Deliberately literal: the rail
 * finds text the player typed, it does not decide what a line is about.
 */
export function matchRailPrompt(prompt: RailPrompt, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return prompt.haystack.toLowerCase().includes(needle)
}

/** The prompts a query keeps, in order. An empty query keeps everything. */
export function filterRailPrompts(prompts: readonly RailPrompt[], query: string): RailPrompt[] {
  const needle = query.trim()
  if (!needle) return [...prompts]
  return prompts.filter(prompt => matchRailPrompt(prompt, needle))
}

/**
 * Plain-text hover summary: strip markdown syntax, collapse whitespace, and
 * lightly truncate. Never renders markup.
 */
export function promptSummaryText(content: string, maxLength = RAIL_TOOLTIP_MAX_LENGTH): string {
  return truncateText(plainText(content), maxLength)
}

/** Markdown stripped and whitespace collapsed, at full length. */
export function plainText(content: string): string {
  return stripMarkdown(content ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Conservative markdown stripping for summaries. Deliberately regex-only and
 * non-destructive: strips fences, inline code, links/images, headings,
 * blockquotes, bullets, bold and strikethrough. Single `*`/`_` italics are
 * left alone so code-ish text like `foo_bar` is not mangled.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
}

/** Grapheme-safe truncation with ellipsis (Swift `truncate` semantics). */
export function truncateText(text: string, maxLength: number): string {
  if (maxLength <= 0) return ''
  const chars = Array.from(text)
  if (chars.length <= maxLength) return text
  return chars.slice(0, maxLength).join('') + '…'
}
