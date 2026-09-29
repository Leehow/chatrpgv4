// @vitest-environment jsdom
/**
 * Contract §39.4 in the real React the transcript mounts the delivery card with: a map the table
 * already holds arrives as a row naming what was added, with no picture, and its control reaches the
 * app's panel switch through the transcript -- the case board, where the living map is.
 */
import React from 'react'
import {render, cleanup, fireEvent} from '@testing-library/react'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
// @ts-expect-error -- plain ESM pack asset, no type declarations
import {createComponent} from '../../../../pipicoc/mechanics.js'
import {MessageView} from './Transcript'
import {registerToolRenderer, disposeToolRenderers} from './ui-registries'
import type {ChatMessage} from './transcript-model'
import {ui} from './fixtures/coc-ui-words'
import enMechanics from '../../../../content/ui/en/mechanics.json'

const Card = createComponent(React)
const EXT = 'coc-map-update-test'

beforeAll(() => {
  // The renderer gets exactly what the transcript hands a tool renderer.
  registerToolRenderer(EXT, {toolName: 'coc-mechanics', render: props => <Card {...props} />})
})
afterAll(() => disposeToolRenderers(EXT))
afterEach(cleanup)

const UPDATE = {kind: 'map', receipt: 'map:village-map-t6', marker: 'map:village-map', map: 'village-map', name: 'Village', label: 'The village',
  words: 'play_language', presentation: 'update', document: 'none',
  regions: [{id: 'poe-street', label: 'Poe Street cemetery', level: null}],
  revealed: [{id: 'poe-street', label: 'Poe Street cemetery', level: null}]}

const delivery = (rows: unknown[]): ChatMessage => ({id: 'delivery-t6', role: 'assistant', content: '', timestamp: 6,
  presentation: {renderer: 'coc-mechanics', details: {ui: ui('en'), play_language: 'en', turn: 6,
    rendered_text: 'The cemetery gate stands open.', marked_text: 'The cemetery gate stands open. {{map:village-map}}', mechanics: rows}}}) as ChatMessage

describe('a map update row', () => {
  it('names what was added, draws no picture, and opens the case board through the transcript', () => {
    const onOpenPanel = vi.fn()
    const {container} = render(<MessageView message={delivery([UPDATE])} onOpenPanel={onOpenPanel}
      onCopy={async () => {}} onResend={() => {}} resendDisabled={false} />)
    const row = container.querySelector('[data-presentation="update"]') as HTMLElement
    expect(row).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
    expect(row.textContent).toContain('The village')
    expect(row.textContent).toContain(`${enMechanics.mapNew} Poe Street cemetery`)
    const open = row.querySelector('button') as HTMLButtonElement
    expect(open.textContent).toBe(enMechanics.mapOpenBoard)
    fireEvent.click(open)
    expect(onOpenPanel).toHaveBeenCalledWith('coc.board')
  })

  it('has no control where the app cannot open panels', () => {
    const {container} = render(<MessageView message={delivery([UPDATE])} onCopy={async () => {}} onResend={() => {}} resendDisabled={false} />)
    expect(container.querySelector('[data-presentation="update"] button')).toBeNull()
  })
})
