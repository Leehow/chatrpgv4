import { isNavigationEligibleUserPrompt } from './prompt-rail'
import type { ChatMessage } from './transcript-model'

/** The moment this row's prose was on the player's screen, or undefined for a row that shows none. */
function proseLandedAt(message: ChatMessage): number | undefined {
  if (message.role !== 'assistant') return undefined
  const marked = (message.presentation?.details as { marked_text?: unknown } | undefined)?.marked_text
  const prose = message.presentation ? typeof marked === 'string' && marked.trim() !== '' : message.content.trim() !== ''
  return prose ? message.deliveredAt ?? message.timestamp : undefined
}

/**
 * How long the player waited for the reply that ends at `endIndex`: from when the host began on
 * their message (`sentAt`, contract §164) to the moment the turn's last prose was on screen.
 *
 * A delivery card lands its prose when it is appended, a persisted text when its entry is written,
 * and a text still streaming at its last delta (`deliveredAt`). Rows that carry no prose -- steps,
 * choice cards, notices -- do not move the mark, so time the table spends after the story is told
 * is not counted. A turn no player message opened (the opening, a host follow-up) has no wait.
 */
export function turnElapsedMs(messages: readonly ChatMessage[], endIndex: number): number | undefined {
  let landed: number | undefined
  for (let index = endIndex; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) return undefined
    if (message.role === 'user') {
      // §164: the host's start on this message; Pi's stamp only for one the host never recorded.
      const sent = message.sentAt ?? message.timestamp
      if (!isNavigationEligibleUserPrompt(message) || !sent || landed === undefined) return undefined
      return landed >= sent ? landed - sent : undefined
    }
    const at = proseLandedAt(message)
    if (at !== undefined) landed = Math.max(landed ?? at, at)
  }
  return undefined
}

/** `{s}` seconds under a minute, `{m}` and `{s}` above; the words come from the table's own surface. */
export function formatTurnElapsed(ms: number, words?: Record<string, string>): string {
  const total = Math.max(1, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  const template = minutes > 0 ? (words?.elapsed_ms ?? '用时 {m} 分 {s} 秒') : (words?.elapsed_s ?? '用时 {s} 秒')
  return template.replace('{m}', String(minutes)).replace('{s}', String(seconds))
}
