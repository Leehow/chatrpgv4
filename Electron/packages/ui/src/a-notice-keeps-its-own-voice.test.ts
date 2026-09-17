import { describe, expect, it } from 'vitest'
import { applyStreamEvent, historyMessages } from './transcript-model'
import type { HistoryEntry } from '@pipi/host-api'

/**
 * Contract §83: a notice the host placed is not more of the Keeper's message.
 *
 * §55 made a host-placed notice arrive live, as its own bubble. This is the other reading of the
 * same row, and until now the two disagreed: `historyMessages` folds an assistant entry that
 * carries text into the assistant card above it when that card has activities and no text of its
 * own -- the shape of a Keeper turn whose prose came in a later entry. A service notice arriving
 * after such a card matched that rule exactly, and three things happened at once: the host's
 * out-of-fiction sentence was printed inside the Keeper's tool card as the Keeper's own words, the
 * notice lost the bubble the live reading had just given it, and the merge took the notice's id,
 * so the Keeper's own card id vanished from the transcript entirely.
 *
 * The turns this lands on are exactly the ones where the notice is all the player gets: a turn that
 * ran tools and delivered no text is what `turn_unfinished`, `review_unavailable`,
 * `provider_outage`, `delivery_cut_short` and the §8 `placed_by_host` fallback all announce.
 *
 * Measured on H-SIDE `t4` turn 109 (2026-09-17): the notice `ad53217a` was merged into the Keeper
 * card `0f29857e`, whose id then appeared nowhere in the transcript, while the live projection of
 * the same id was a standalone bubble with no activities.
 *
 * Nothing here reads a word of the text: the speaker comes from the entry, which the backend marks
 * from the channel registry (§53).
 */

const AT = 1_760_000_000_000

/** A Keeper turn that ran tools and delivered no prose -- the shape every service notice follows. */
const keeperCard: HistoryEntry = {
  id: 'keeper-card', role: 'assistant', content: '', timestamp: AT,
  tools: [{ id: 'call-1', name: 'lookup', input: '{}' }],
  activities: [{ type: 'tool', contentIndex: 0, tool: { id: 'call-1', name: 'lookup', input: '{}' } }],
}

const NOTICE = 'This turn ended without a delivery. Everything already settled is kept.'

/** The row the host placed, as the backend's reader renders it (§53, §83). */
const notice: HistoryEntry = {
  id: 'notice-1', role: 'assistant', content: NOTICE, timestamp: AT + 1, placedByHost: true,
}

/** The same shape without the mark: a Keeper turn whose text arrived in a later entry. */
const keeperTail: HistoryEntry = {
  id: 'keeper-tail', role: 'assistant', content: 'The clerk closes the ledger.', timestamp: AT + 1,
}

describe('a notice the host placed keeps its own voice on every reading', () => {
  it('does not fold into the Keeper card above it', () => {
    const messages = historyMessages([keeperCard, notice])
    expect(messages.map(message => message.id)).toEqual(['keeper-card', 'notice-1'])
    // The Keeper's card keeps its own identity and stays empty of the host's sentence.
    expect(messages[0].content).toBe('')
    expect(messages[0].activities).toHaveLength(1)
    // The notice keeps its own, and carries no tool card of the Keeper's.
    expect(messages[1].content).toBe(NOTICE)
    expect(messages[1].activities ?? []).toHaveLength(0)
  })

  it('reads the same live and re-read, which is the whole point of naming the speaker', () => {
    // §55 publishes the notice live as its own bubble. A re-read that merged it produced a
    // different transcript for the same bytes -- one fewer message, under a different id.
    const live = applyStreamEvent(historyMessages([keeperCard]), {
      type: 'presentation', sessionId: 's', entry: notice,
    } as never)
    const reread = historyMessages([keeperCard, notice])
    expect(reread.map(message => [message.id, message.role, message.content]))
      .toEqual(live.map(message => [message.id, message.role, message.content]))
  })

  it('still folds a Keeper turn whose own text arrived in a later entry', () => {
    // The rule exists for a reason and is not weakened: only the host's own words are exempt.
    const messages = historyMessages([keeperCard, keeperTail])
    expect(messages).toHaveLength(1)
    expect(messages[0].id).toBe('keeper-tail')
    expect(messages[0].content).toBe(keeperTail.content)
    expect(messages[0].activities).toHaveLength(1)
  })
})
