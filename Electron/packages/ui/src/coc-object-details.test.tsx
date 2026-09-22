// @vitest-environment jsdom
/**
 * Contract §129: an object's details never hold the delivery card.
 *
 * The belongings an opening registers are prepared beside the turn, not inside it (§26 "Same-turn
 * prepare"), so the card that names them is drawn before their parameters exist. It draws the name
 * at once with a small waiting mark and nothing to open; when the host says the details are in hand
 * it streams the same entry id again, the transcript replaces the card where it sits, and the row
 * becomes a fold that opens into what the object is. Both halves are pinned here through the real
 * path: the pack's renderer mounted in the transcript's own presentation entry, and the stream
 * reducer that applies the redraw.
 */
import React from 'react'
import {render, screen, cleanup, fireEvent} from '@testing-library/react'
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'
// @ts-expect-error -- plain ESM pack asset, no type declarations
import {createComponent} from '../../../../pipicoc/mechanics.js'
import {MessageView} from './Transcript'
import {registerToolRenderer, disposeToolRenderers} from './ui-registries'
import {applyStreamEvent, type ChatMessage} from './transcript-model'
import {ui} from './fixtures/coc-ui-words'
import enMechanics from '../../../../content/ui/en/mechanics.json'
import enSheet from '../../../../content/ui/en/sheet.json'

const Card = createComponent(React)
const EXT = 'coc-object-details-test'

beforeAll(() => {
  registerToolRenderer(EXT, {toolName: 'coc-mechanics', render: props => <Card details={props.details} />})
})
afterAll(() => disposeToolRenderers(EXT))
afterEach(cleanup)

const ROLL = {kind: 'roll', receipt: 'roll:appearance-t0-c1', skill: 'Appearance', roll: 16, target: 60, threshold: 60,
  difficulty: 'regular', level: 'hard', passed: true, pushed: false, visibility: 'public', actor_is_investigator: true,
  actor: 'investigator', actor_label: '沈默', call: 't0-c1', family: 'mod'}
/** The row the kernel projects for a belonging whose registration was queued past the delivery. */
const PENDING = {kind: 'item', receipt: 'definition:queued-adopt-t0-c2', name: '沈默的旧皮腔相机', adopted: '旧皮腔相机',
  definition: 'pending', definition_name: '旧皮腔相机', call: 't0-c2'}
const OBJECT = {category: 'item', description: '折叠式皮腔相机，镜头盖有划痕。',
  traits: [{name: 'weight', value: 1.2, unit: 'kg'}], parameters: {charges: 8, range: '3 yards'}}

const delivery = (rows: unknown[]): ChatMessage => ({id: 'delivery-t0', role: 'assistant', content: '', timestamp: 1,
  presentation: {renderer: 'coc-mechanics', details: {ui: ui('en'), play_language: 'en', turn: 0, mechanics: rows}}}) as ChatMessage
const draw = (message: ChatMessage) => <MessageView message={message} onCopy={async () => {}} onResend={() => {}} resendDisabled={false} />

describe('an object whose details are still being prepared', () => {
  it('is drawn at once, named, with a waiting mark and nothing to open', () => {
    const {container} = render(draw(delivery([ROLL, PENDING])))
    const row = container.querySelector('[data-kind="item"]') as HTMLElement
    expect(row).toBeTruthy()
    expect(row.textContent).toContain('沈默的旧皮腔相机')
    // The waiting mark carries the shipped caption, so a screen reader and a hover both say why.
    const waiting = screen.getByRole('status', {name: enMechanics.preparing})
    expect(row.contains(waiting)).toBe(true)
    // Not a fold: no disclosure to open into parameters that do not exist yet.
    expect(row.tagName).not.toBe('DETAILS')
    expect(row.querySelector('summary')).toBeNull()
    expect(container.textContent).not.toContain(OBJECT.description)
    // A belonging the investigator already carries was handed to nobody, so no owner badge.
    expect(row.querySelector('.coc-mech-delta')).toBeNull()
    // The rest of the card is not held back by it.
    expect(container.querySelector('[data-kind="roll"]')).toBeTruthy()
  })

  it('opens in place into its parameters when the host redraws the same card', () => {
    let messages: ChatMessage[] = [delivery([ROLL, PENDING])]
    const view = render(draw(messages[0]))
    expect(view.container.querySelector('details[data-kind="item"]')).toBeNull()

    // The host's redraw: the same entry id, the row now carrying the player view.
    const ready = {...PENDING, definition: 'ready', object: OBJECT}
    messages = applyStreamEvent(messages, {type: 'presentation', entry: {id: 'delivery-t0', role: 'assistant', content: '', timestamp: 2,
      presentation: {renderer: 'coc-mechanics', details: {ui: ui('en'), play_language: 'en', turn: 0, mechanics: [ROLL, ready]}}}} as any)
    // Replaced where it sits, not appended as a second copy of the turn.
    expect(messages.map(message => message.id)).toEqual(['delivery-t0'])
    view.rerender(draw(messages[0]))

    const fold = view.container.querySelector('details[data-kind="item"]') as HTMLDetailsElement
    expect(fold).toBeTruthy()
    expect(screen.queryByRole('status', {name: enMechanics.preparing})).toBeNull()
    const summary = fold.querySelector('summary') as HTMLElement
    expect(summary.textContent).toContain('沈默的旧皮腔相机')
    fireEvent.click(summary)
    expect(fold.open).toBe(true)
    // The description as prose, each public trait and field under the sheet's own caption.
    expect(fold.textContent).toContain(OBJECT.description)
    expect(fold.textContent).toContain('weight')
    expect(fold.textContent).toContain('1.2 kg')
    expect(fold.textContent).toContain(enSheet['item.range'])
    expect(fold.textContent).toContain('3 yards')
    expect(fold.textContent).toContain('8')
  })

  it('stops waiting without a fold when the preparation was dropped', () => {
    const {container} = render(draw(delivery([{...PENDING, definition: 'none'}])))
    const row = container.querySelector('[data-kind="item"]') as HTMLElement
    expect(row.textContent).toContain('沈默的旧皮腔相机')
    expect(screen.queryByRole('status')).toBeNull()
    expect(row.tagName).not.toBe('DETAILS')
  })

  it('an object handed over with its details already in hand opens at once', () => {
    const given = {kind: 'item', receipt: 'item:t3-c1', name: 'Knott keys', label: '诺特的钥匙', quantity: 1, to: 'investigator',
      to_label: '沈默', definition: 'ready', object: {category: 'item', description: '一串铜钥匙。', traits: [], parameters: {}}}
    const {container} = render(draw(delivery([given])))
    const fold = container.querySelector('details[data-kind="item"]') as HTMLDetailsElement
    expect(fold).toBeTruthy()
    expect(fold.querySelector('summary')!.textContent).toContain('诺特的钥匙')
    // A handover still says whose hands it went into.
    expect(fold.querySelector('summary .coc-mech-delta')!.textContent).toContain('沈默')
    expect(fold.textContent).toContain('一串铜钥匙。')
  })

  it('an item row with nothing to open stays a line', () => {
    const plain = {kind: 'item', receipt: 'item:t3-c2', name: 'Rope', quantity: 1, to: 'investigator', to_label: '沈默'}
    const {container} = render(draw(delivery([plain])))
    const row = container.querySelector('[data-kind="item"]') as HTMLElement
    expect(row.tagName).not.toBe('DETAILS')
    expect(screen.queryByRole('status')).toBeNull()
  })
})
