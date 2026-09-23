// @vitest-environment jsdom
/**
 * The delivery card's trailing mechanics rows fold, in the real React the transcript mounts it with.
 *
 * The owner at the live table (2026-09-22): the rows under the prose fold away, and each fold says
 * what its rows are (items gained, clues found, a settlement's family), not "this turn's mechanics".
 * Every fold starts shut; a row the Keeper placed at its sentence is not part of any; a shut header
 * still counts its rows and carries the §129 waiting mark while one of them is preparing its details;
 * and a host redraw of the same card (the details landing) keeps each fold the way the player left it.
 */
import React from 'react'
import {render, cleanup, fireEvent, within} from '@testing-library/react'
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'
// @ts-expect-error -- plain ESM pack asset, no type declarations
import {createComponent} from '../../../../pipicoc/mechanics.js'
import {MessageView} from './Transcript'
import {registerToolRenderer, disposeToolRenderers} from './ui-registries'
import {applyStreamEvent, type ChatMessage} from './transcript-model'
import {ui} from './fixtures/coc-ui-words'
import enMechanics from '../../../../content/ui/en/mechanics.json'

const Card = createComponent(React)
const EXT = 'coc-mechanics-fold-test'

beforeAll(() => {
  registerToolRenderer(EXT, {toolName: 'coc-mechanics', render: props => <Card details={props.details} />})
})
afterAll(() => disposeToolRenderers(EXT))
afterEach(cleanup)

const ROLL = {kind: 'roll', receipt: 'roll:spot-t4-c1', marker: 'check:spot-hidden', skill: 'Spot Hidden', roll: 16, target: 60,
  threshold: 60, difficulty: 'regular', level: 'hard', passed: true, pushed: false, visibility: 'public',
  actor_is_investigator: true, actor: 'investigator', actor_label: 'Shen', call: 't4-c1', family: 'skill'}
const PENDING = {kind: 'item', receipt: 'definition:queued-adopt-t4-c2', name: 'Old camera', adopted: 'Old camera',
  definition: 'pending', definition_name: 'Old camera', call: 't4-c2'}
const NOTEBOOK = {kind: 'item', receipt: 'definition:adopt-t4-c3', name: 'Notebook', adopted: 'Notebook', call: 't4-c3'}
const CLUE = {kind: 'clue', receipt: 'clue:shelf-t4', clue: 'shelf-scratches', label: 'Scratches', call: 't4-c5'}
const OBJECT = {category: 'item', description: 'A folding bellows camera.', traits: [], parameters: {charges: 8}}

const delivery = (rows: unknown[], timestamp = 1): ChatMessage => ({id: 'delivery-t4', role: 'assistant', content: '', timestamp,
  presentation: {renderer: 'coc-mechanics', details: {ui: ui('en'), play_language: 'en', turn: 4,
    rendered_text: 'You look at the door. It opens.', marked_text: 'You look at the door. {{check:spot-hidden}} It opens.', mechanics: rows}}}) as ChatMessage
const draw = (message: ChatMessage) => <MessageView message={message} onCopy={async () => {}} onResend={() => {}} resendDisabled={false} />

describe('the trailing mechanics slip', () => {
  it('starts folded behind a real toggle, while the placed row stays at its sentence', () => {
    const {container} = render(draw(delivery([ROLL, NOTEBOOK, PENDING])))
    const toggle = container.querySelector('.coc-mech-list button') as HTMLButtonElement
    expect(container.querySelectorAll('.coc-mech-list button[aria-controls]').length).toBe(1)
    // The header says what the rows are: belongings that arrived.
    expect(toggle.querySelector('.coc-mech-list-name')!.textContent).toBe(enMechanics['fold.itemsGained'])
    expect(toggle.getAttribute('type')).toBe('button')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const body = container.querySelector(`[id="${toggle.getAttribute('aria-controls')}"]`) as HTMLElement
    expect(body).toBeTruthy()
    expect(body.hidden).toBe(true)
    expect(body.querySelectorAll('[data-kind]').length).toBe(0)
    // The placed roll is outside the slip, drawn where the Keeper put it.
    expect(container.querySelector('.coc-mech-here [data-kind="roll"]')).toBeTruthy()
    // Folded, the caption counts the rows and says one is still preparing.
    expect(toggle.querySelector('.coc-mech-list-count')!.textContent).toMatch(/\b2\b/)
    expect(within(toggle).getAllByRole('status').length).toBe(1)

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(body.hidden).toBe(false)
    expect([...body.querySelectorAll('[data-kind]')].map(row => row.getAttribute('data-kind'))).toEqual(['item', 'item'])
    // Open, the pending row carries its own mark and the caption lets go of its copy.
    expect(within(toggle).queryAllByRole('status').length).toBe(0)
    expect(within(body).getAllByRole('status').length).toBe(1)
  })

  it('gives each kind of row its own fold, header and count, opened one at a time', () => {
    const {container} = render(draw(delivery([ROLL, NOTEBOOK, CLUE, PENDING])))
    const toggles = [...container.querySelectorAll<HTMLButtonElement>('.coc-mech-list button[aria-controls]')]
    expect(toggles.map(toggle => [toggle.querySelector('.coc-mech-list-name')!.textContent,
      toggle.querySelector('.coc-mech-list-count')!.textContent!.replace(/\D+/g, '')])).toEqual([
      [enMechanics['fold.itemsGained'], '2'], [enMechanics['fold.clue'], '1']])
    expect(toggles.map(toggle => toggle.getAttribute('aria-expanded'))).toEqual(['false', 'false'])
    expect(toggles.map(toggle => within(toggle).queryAllByRole('status').length)).toEqual([1, 0])
    const ids = toggles.map(toggle => toggle.getAttribute('aria-controls'))
    expect(new Set(ids).size).toBe(2)

    fireEvent.click(toggles[1])
    expect(toggles.map(toggle => toggle.getAttribute('aria-expanded'))).toEqual(['false', 'true'])
    const clues = container.querySelector(`[id="${ids[1]}"]`) as HTMLElement
    expect([...clues.querySelectorAll('[data-kind]')].map(row => row.getAttribute('data-kind'))).toEqual(['clue'])
    expect((container.querySelector(`[id="${ids[0]}"]`) as HTMLElement).hidden).toBe(true)
  })

  it('stays open across the redraw that lands an object\'s details, and the row then opens as before', () => {
    let messages: ChatMessage[] = [delivery([ROLL, NOTEBOOK, PENDING])]
    const view = render(draw(messages[0]))
    fireEvent.click(view.container.querySelector('.coc-mech-list button') as HTMLButtonElement)

    messages = applyStreamEvent(messages, {type: 'presentation', entry: delivery([ROLL, NOTEBOOK, {...PENDING, definition: 'ready', object: OBJECT}], 2)} as any)
    view.rerender(draw(messages[0]))

    const toggle = view.container.querySelector('.coc-mech-list button') as HTMLButtonElement
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const fold = view.container.querySelector('.coc-mech-list details[data-kind="item"]') as HTMLDetailsElement
    expect(fold).toBeTruthy()
    fireEvent.click(fold.querySelector('summary') as HTMLElement)
    expect(fold.open).toBe(true)
    expect(fold.textContent).toContain(OBJECT.description)
  })
})
