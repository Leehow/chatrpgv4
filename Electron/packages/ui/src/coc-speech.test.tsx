// @vitest-environment jsdom
/**
 * A spoken line is drawn as the person who spoke it (contract §40).
 *
 * The kernel wraps every spoken line in `{{say:<name>}}…{{/say}}` and hands the host a `speech[]`
 * in the same text order. Three things can fail silently here and all three are pinned below.
 *
 * 1. **The token reaches the player.** The strip the card has always run is the ASCII marker
 *    grammar of §16.6, and a name is written in the play language, which is open (§23). A card
 *    that does not learn the new token prints `{{say:诺特}}` at the table.
 * 2. **Two people share a hue, or one person changes hue.** The colour is not stored anywhere
 *    (§40.4): it is allocated from the anchor's hash, probing to the next free slot. The probe
 *    and the anchor have to be the same in the delivery card and in the case board's legend, and
 *    those two files cannot import each other, so this is where the two are compared.
 * 3. **A card cuts a line in half.** A receipt is drawn where it happened, which can be inside a
 *    spoken line; the words after it are still the same mouth.
 */
import React from 'react'
import { render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
// @ts-expect-error -- plain ESM pack asset, no type declarations
import { createComponent } from '../../../../pipicoc/mechanics.js'
// @ts-expect-error -- plain ESM pack asset, no type declarations
import { createComponent as createPanel } from '../../../../pipicoc/board.js'
import zhBoard from '../../../../content/ui/zh-Hans/board.json'
import zhErrors from '../../../../content/ui/zh-Hans/errors.json'
import { foldMarkedDeliveries, withoutMechanicsMarkers, type ChatMessage } from './transcript-model'
import { ui } from './fixtures/coc-ui-words'

const Card = createComponent(React)
const Panel = createPanel(React)

/** The window-wide slot table the two renderers share (§40.4). Nothing persists it, so a test
 *  clears it exactly the way a reload does. */
const SLOT_TABLE = '__pipicocSpeakerSlots1'

beforeEach(() => { delete (globalThis as Record<string, unknown>)[SLOT_TABLE] })
afterEach(cleanup)

const Delivery = ({details}: {details: Record<string, unknown>}) =>
  <Card details={{ui: ui(String(details.play_language ?? 'zh-Hans')), ...details}} />

const ROLL = {
  kind: 'roll', receipt: 'roll:spot-hidden-t5-c1', actor: 'thomas-hayes', actor_label: '托马斯·海斯',
  actor_is_investigator: true, skill: 'Spot Hidden', roll: 12, target: 50, threshold: 50,
  difficulty: 'regular', level: 'regular', passed: true, pushed: false, visibility: 'public',
  marker: 'check:spot-hidden',
}

const npc = (handle: string, name: string, text: string) => ({who: {npc: handle, name}, text})
const label = (text_: string, name: string) => ({who: {label: name}, text: text_})

/** Every span the card drew, in document order. */
const spans = (root: HTMLElement) => Array.from(root.querySelectorAll('span.coc-say'))
/** The palette reference an element was tinted with, as the inline custom property holds it. */
const ink = (el: Element) => (el as HTMLElement).style.getPropertyValue('--coc-say-ink').trim()

describe('the card colours a spoken line by who spoke it', () => {
  it('cuts mixed mechanics and say tokens, and gives each speaker a data-who and a slot', () => {
    const marked = '门开了一条缝。{{say:诺特}}「锁了很久了。」{{/say}}\n\n'
      + '你打量门框{{check:spot-hidden}}。{{say:托马斯·海斯}}「让我看看。」{{/say}}'
    const {container} = render(<Delivery details={{turn: 5, mechanics: [ROLL], marked_text: marked, speech: [
      npc('steven-knott', '诺特', '「锁了很久了。」'),
      {who: {investigator: 'thomas-hayes', name: '托马斯·海斯'}, text: '「让我看看。」'},
    ]}} />)

    const drawn = spans(container)
    expect(drawn.map(el => el.getAttribute('data-who'))).toEqual(['npc', 'investigator'])
    expect(drawn.map(el => el.textContent)).toEqual(['「锁了很久了。」', '「让我看看。」'])
    // The investigator is the one voice that is not hashed: one fixed ink, every turn (§40.4).
    expect(ink(drawn[1])).toBe('var(--coc-say-pc)')
    expect(ink(drawn[0])).toMatch(/^var\(--coc-say-\d+\)$/)
    expect(ink(drawn[0])).not.toBe(ink(drawn[1]))
    // The name is the hover, through the campaign's glossary; it is never printed a second time.
    expect(drawn[0].getAttribute('title')).toBe('诺特')
    expect(container.textContent).not.toContain('{{')
    // The receipt still lands where the Keeper put it, between the two lines.
    expect(container.querySelectorAll('.coc-mech-here')).toHaveLength(1)
  })

  it('keeps a span cut by a mechanics card in the same colour on both sides', () => {
    const marked = '{{say:诺特}}「我早说过——」{{check:spot-hidden}}「——这地方不该开。」{{/say}}'
    const {container} = render(<Delivery details={{turn: 5, mechanics: [ROLL], marked_text: marked,
      speech: [npc('steven-knott', '诺特', '「我早说过——」「——这地方不该开。」')]}} />)

    const drawn = spans(container)
    expect(drawn).toHaveLength(2)
    expect(drawn.map(el => el.textContent)).toEqual(['「我早说过——」', '「——这地方不该开。」'])
    expect(drawn.every(el => el.getAttribute('data-who') === 'npc')).toBe(true)
    expect(ink(drawn[0])).toBe(ink(drawn[1]))
    expect(container.querySelectorAll('.coc-mech-here')).toHaveLength(1)
  })

  /**
   * `jackson-elias` and `the-woman-in-the-black-coat` are an FNV-1a collision on sixteen slots,
   * which is the whole reason §40.4 asks for a linear probe rather than the raw hash.
   */
  it('probes past a taken slot so two anchors that hash alike never share a hue', () => {
    const marked = '{{say:Jackson Elias}}"Don\'t open it."{{/say}} '
      + '{{say:the woman in the black coat}}"He already did."{{/say}}'
    const {container} = render(<Delivery details={{play_language: 'en', turn: 5, mechanics: [], marked_text: marked,
      speech: [
        npc('jackson-elias', 'Jackson Elias', '"Don\'t open it."'),
        label('"He already did."', 'the-woman-in-the-black-coat'),
      ]}} />)

    const drawn = spans(container)
    expect(drawn.map(el => el.getAttribute('data-who'))).toEqual(['npc', 'label'])
    expect(ink(drawn[0])).toBe('var(--coc-say-11)')
    expect(ink(drawn[1])).toBe('var(--coc-say-12)')
  })

  it('gives one label used twice one slot, and an unresolved span the name in its own token', () => {
    const marked = '{{say:门后的人}}「走开。」{{/say}}\n\n'
      + '你敲了第二次。{{say:门后的人}}「我说走开。」{{/say}}'
    // No `speech` at all: a record from before §40, or a delivery the kernel resolved to nothing.
    const {container} = render(<Delivery details={{turn: 5, mechanics: [], marked_text: marked}} />)

    const drawn = spans(container)
    expect(drawn).toHaveLength(2)
    expect(drawn.every(el => el.getAttribute('data-who') === 'label')).toBe(true)
    expect(ink(drawn[0])).toBe(ink(drawn[1]))
    expect(drawn[0].getAttribute('title')).toBe('门后的人')
  })

  it('never prints a token, whatever script the name is in and whether or not it closes', () => {
    const marked = '{{say:诺特}}「锁了。」\n\n{{say:老太太}}「别信他。」{{/say}} 她转身走了。{{/say}}'
    const {container} = render(<Delivery details={{turn: 5, mechanics: [], marked_text: marked}} />)

    expect(container.textContent).not.toContain('{{')
    expect(container.textContent).not.toContain('}}')
    expect(container.textContent).not.toContain('say')
    // An open with no close of its own ends where the next one begins; the narration after the
    // close is nobody's line.
    expect(spans(container).map(el => el.textContent)).toEqual(['「锁了。」', '「别信他。」'])
    expect(container.textContent).toContain('她转身走了。')
  })

  /** A name longer than §40.1 allows is not a say token and cannot be coloured — but it is still
   *  braces, and §40.4 says braces do not reach the player. It goes out with the loose tokens. */
  it('strips a malformed token instead of printing it', () => {
    const wide = `{{say:${'诺'.repeat(61)}}}「谁在那儿？」{{/say}}`
    const {container} = render(<Delivery details={{turn: 5, mechanics: [], marked_text: `门后有声音。${wide}`}} />)
    expect(container.textContent).not.toContain('{{')
    expect(container.textContent).toContain('「谁在那儿？」')
    expect(spans(container)).toHaveLength(0)
  })

  it('draws a delivery that settled nothing and was only spoken', () => {
    const {container} = render(<Delivery details={{turn: 5, mechanics: [],
      marked_text: '{{say:诺特}}「你又来了。」{{/say}}'}} />)
    expect(spans(container)).toHaveLength(1)
    expect(container.querySelector('.coc-mech-list')).toBeNull()
  })
})

describe('the case board paints the legend for the same people', () => {
  /** The board is driven by one `board` answer, the way `coc-board.test.tsx` drives it. */
  const host = (rows: Record<string, unknown>[]) => ({
    invoke: async () => ({ok: true, data: {status: 'ready', campaign: 'c1',
      ui: {tag: 'zh-Hans', words: {board: zhBoard, errors: zhErrors}},
      view: {play_language: 'zh-Hans', turn: 5, state: 'awaiting_player', investigators: [],
        clues: {discovered: []}, labels: {}, npcs: {journal: rows}},
      maps: []}}),
  })

  it('gives a journal row the hue its lines wear in the transcript', async () => {
    const marked = '{{say:埃利亚斯}}"Don\'t open it."{{/say}}'
    const card = render(<Delivery details={{play_language: 'en', turn: 5, mechanics: [], marked_text: marked,
      speech: [npc('jackson-elias', '埃利亚斯', '"Don\'t open it."')]}} />)
    const spoken = ink(spans(card.container)[0])
    expect(spoken).toBe('var(--coc-say-11)')

    const panel = render(<Panel api={host([
      {id: 'jackson-elias', name: '埃利亚斯', description: '记者。', exchanges: []},
      {id: 'steven-knott', name: '诺特', description: '看门人。', exchanges: []},
    ])} />)
    await expect.poll(() => panel.container.querySelectorAll('span.coc-say-dot').length).toBe(2)
    const painted = Array.from(panel.container.querySelectorAll('span.coc-say-dot'))
    expect(ink(painted[0])).toBe(spoken)
    expect(ink(painted[1])).not.toBe(spoken)
    expect(painted.every(dot => dot.getAttribute('aria-hidden') === 'true')).toBe(true)
  })

  it('falls back to the name when a journal row predates the handle projection', async () => {
    const panel = render(<Panel api={host([{name: '诺特', description: '看门人。', exchanges: []}])} />)
    await expect.poll(() => panel.container.querySelectorAll('span.coc-say-dot').length).toBe(1)
    expect(ink(panel.container.querySelector('span.coc-say-dot')!)).toMatch(/^var\(--coc-say-\d+\)$/)
  })
})

/**
 * `withoutMechanicsMarkers` has three callers and every one of them hands its result to a person
 * or to a model: the fold that decides the card is already drawing this delivery (or the narration
 * prints twice), the Copy affordance on a delivery row, and the text the illustration lane is
 * given. A say token left in leaks into all three at once.
 */
describe('the plain copy of a spoken delivery is still folded away', () => {
  it('matches a delivery carrying say tokens against its own prose', () => {
    const marked = '门开了一条缝。{{say:诺特}}「锁了很久了。」{{/say}}{{check:spot-hidden}}'
    const prose = '门开了一条缝。「锁了很久了。」'
    expect(withoutMechanicsMarkers(marked)).toBe(prose)

    const messages: ChatMessage[] = [
      {id: 'card', role: 'assistant', content: '', timestamp: 1,
        presentation: {renderer: 'coc-mechanics', details: {turn: 5, mechanics: [ROLL], marked_text: marked}}} as ChatMessage,
      {id: 'plain', role: 'assistant', content: prose, timestamp: 2} as ChatMessage,
    ]
    expect(foldMarkedDeliveries(messages).map(message => message.id)).toEqual(['card'])
  })
})
