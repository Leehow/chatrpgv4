// @vitest-environment jsdom
/**
 * A marked delivery reaches the player once, with each receipt where it happened (contract §16.6).
 *
 * Two halves, and both can fail silently, which is why they are pinned here. The card draws the
 * narration itself when it has `marked_text`, because only whoever holds both the text and the rows
 * can put a row at a sentence; and the plain copy of that same delivery -- the assistant message,
 * which stays prose because a terminal reads it too -- is folded away, or the narration prints
 * twice.
 */
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, it, expect } from 'vitest'
// @ts-expect-error -- plain ESM pack asset, no type declarations
import { createComponent } from '../../../../pipicoc/mechanics.js'
import { foldMarkedDeliveries, withoutMechanicsMarkers, type ChatMessage } from './transcript-model'

const Delivery = createComponent(React)
afterEach(cleanup)

const ROLL = {
  kind: 'roll', receipt: 'roll:library-use-t5-c1', actor: 'thomas-hayes', actor_label: '托马斯·海斯',
  skill: 'Library Use', roll: 84, target: 50, threshold: 50, difficulty: 'regular', level: 'failure',
  passed: false, pushed: false, visibility: 'public', marker: 'check:library-use',
}
const TIME = { kind: 'time', receipt: 'time:t5-c2', minutes: 10, marker: 'time' }
const CLUE = { kind: 'clue', receipt: 'clue:knott-keys-t5', clue: 'knott-keys', label: '宅子钥匙' }

const MARKED = '你翻遍了匣子{{check:library-use}}\n\n十分钟很快耗尽。{{time}}架子深处还有未开的匣。'

describe('the card draws a marked delivery', () => {
  it('keeps the prose in order and puts each placed receipt at its point', () => {
    const { container } = render(
      <Delivery details={{ play_language: 'zh-Hans', turn: 5, marked_text: MARKED, mechanics: [ROLL, TIME] }} />,
    )
    const blocks = [...container.querySelectorAll('.coc-mech-para, .coc-mech-here')]
      .map(node => (node.className === 'coc-mech-para' ? 'text' : 'row'))
    expect(blocks).toEqual(['text', 'row', 'text', 'row', 'text'])
    expect(container.textContent).not.toContain('{{')
    expect(screen.getByText(/你翻遍了匣子/)).toBeTruthy()
  })

  it('groups a receipt the Keeper did not place instead of losing it', () => {
    const { container } = render(
      <Delivery details={{ play_language: 'zh-Hans', turn: 5, marked_text: MARKED, mechanics: [ROLL, TIME, CLUE] }} />,
    )
    expect(container.querySelectorAll('.coc-mech-here')).toHaveLength(2)
    expect(container.querySelector('.coc-mech-list')?.textContent).toContain('宅子钥匙')
  })

  it('keeps the text whole around a marker whose row the projection hid', () => {
    // A keeper-visibility roll is stripped from the rows before the frontend sees them, but its
    // marker is still in the delivery. Nothing may be lost around it.
    const hidden = '你看了他一眼{{check:psychology}}，他移开了目光。'
    const { container } = render(
      <Delivery details={{ play_language: 'zh-Hans', turn: 5, marked_text: hidden, mechanics: [] }} />,
    )
    expect(container.querySelectorAll('.coc-mech-here')).toHaveLength(0)
    expect(container.textContent).toContain('你看了他一眼，他移开了目光。')
    expect(container.textContent).not.toContain('{{')
  })

  it('draws the plain card when no marker was placed, exactly as before', () => {
    const { container } = render(
      <Delivery details={{ play_language: 'zh-Hans', turn: 5, rendered_text: '一段叙事。', mechanics: [CLUE] }} />,
    )
    expect(container.querySelector('.coc-mech-inline')).toBeNull()
    expect(container.querySelector('.coc-mech-prose')?.textContent).toBe('一段叙事。')
  })
})

describe('the plain copy of a drawn delivery is folded away', () => {
  const card = (marked: string): ChatMessage => ({
    id: 'm1', role: 'assistant', content: '', timestamp: 1,
    presentation: { renderer: 'coc-mechanics', details: { turn: 5, mechanics: [ROLL], marked_text: marked } },
  } as ChatMessage)
  const said = (content: string): ChatMessage => ({ id: 'a1', role: 'assistant', content, timestamp: 2 } as ChatMessage)

  it('drops the assistant copy of the same delivery', () => {
    const folded = foldMarkedDeliveries([card(MARKED), said(withoutMechanicsMarkers(MARKED))])
    expect(folded).toHaveLength(1)
    expect(folded[0].presentation?.renderer).toBe('coc-mechanics')
  })

  it('leaves a different assistant message alone', () => {
    const other = said('另一段完全不同的话。')
    expect(foldMarkedDeliveries([card(MARKED), other])).toHaveLength(2)
  })

  it('changes nothing when no delivery was marked', () => {
    const messages = [said('一段叙事。')]
    expect(foldMarkedDeliveries(messages)).toEqual(messages)
  })

  it('strips markers the way the kernel does, so the two texts can be compared at all', () => {
    expect(withoutMechanicsMarkers('你翻遍了匣子{{check:library-use}}。')).toBe('你翻遍了匣子。')
  })
})
