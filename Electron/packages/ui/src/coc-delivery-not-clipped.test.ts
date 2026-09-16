import { describe, expect, it } from 'vitest'
import { applyStreamEvent, foldMarkedDeliveries, historyMessages, type ChatMessage } from './transcript-model'
import { messagePreview, shouldCollapseMessage } from './UserMessageBubble'
import type { HistoryEntry } from '@pipi/host-api'

/**
 * Contract §53, the reading end: what a delivery costs if it arrives on the wrong side.
 *
 * The side is decided by the host (see the backend's own case for §53); this file pins what the
 * transcript then does with it, because that is what a real table paid. Both halves below are the
 * behaviour of the player's own bubble and of the §16.6 fold -- correct behaviour, for a player's
 * message. Neither may be softened to make a mislabelled delivery survivable: the fix belongs at
 * the projection that names the speaker, and these two are why.
 *
 * Nothing here reads a word of the text.
 */

const DELIVERY = [
  'The clerk follows your finger to the stack of leases and his mouth tightens.',
  '「I am not the records office, friend.」',
  'He pulls the drawer open and drops a thin folder on the ledger.',
  'Further down there are two or three older short-term drafts, forwarding address blank.',
  '「That is all of it. They moved out alive; the head of the house went into the asylum.」',
  'The pen is left where you can reach it.',
].join('\n\n')

const entry = (role: HistoryEntry['role']): HistoryEntry => ({
  id: 'delivery-1', role, content: DELIVERY, timestamp: 1_760_000_000_000,
})

/** The card §16.6 mounts for the same turn, carrying the same delivery with its markers in. */
const card: ChatMessage = {
  id: 'card-1', role: 'assistant', content: '', timestamp: 1_760_000_000_000,
  presentation: { renderer: 'coc-mechanics', details: { marked_text: DELIVERY } },
}

describe('what a delivery costs on the player s side of the transcript', () => {
  it('loses paragraphs to the collapse rule, on a sentence boundary', () => {
    // Six paragraphs is eleven lines, and a player's message is previewed at five: three
    // paragraphs survive and the cut lands on a full stop, so nothing on screen says it is short.
    expect(shouldCollapseMessage(DELIVERY)).toBe(true)
    const preview = messagePreview(DELIVERY)
    expect(preview.split(/\n{2,}/)).toHaveLength(3)
    expect(DELIVERY.split(/\n{2,}/)).toHaveLength(6)
    expect(DELIVERY.startsWith(preview)).toBe(true)
  })

  it('stops folding against its own card, so the narration is drawn twice', () => {
    const keeperSide = foldMarkedDeliveries([card, ...historyMessages([entry('assistant')])])
    const playerSide = foldMarkedDeliveries([card, ...historyMessages([entry('user')])])
    expect(keeperSide.map(message => message.id)).toEqual(['card-1'])
    expect(playerSide.map(message => message.id)).toEqual(['card-1', 'delivery-1'])
  })

  it('reads the same live and re-read once both projections name the same speaker', () => {
    const live = applyStreamEvent([], { type: 'presentation', sessionId: 's', entry: entry('assistant') } as never)
    const reread = historyMessages([entry('assistant')])
    expect(reread.map(m => [m.id, m.role, m.content])).toEqual(live.map(m => [m.id, m.role, m.content]))
  })
})
