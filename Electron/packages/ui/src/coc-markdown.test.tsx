// @vitest-environment jsdom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
// @ts-expect-error -- controlled ESM pack asset
import { createComponent } from '../../../../pipicoc/mechanics.js'
import { CocStreamingProse } from './CocStreamingProse'
import { renderCocProse } from './CocMarkdown'
import { loadControlledContributions } from './controlled-component-loader'
import { disposeUiContributions, getToolRenderer } from './ui-registries'

const Card = createComponent(React)
const speech = [{ who: { npc: 'clerk', name: 'Clerk' } }]
const speakers = [{ name: 'Clerk', who: speech[0].who }]
afterEach(() => { cleanup(); disposeUiContributions('coc-markdown-test') })

it('renders Markdown whose heading, emphasis and speech markers arrive across chunks', () => {
  const chunks = ['##', '# Evidence\n\n- **First', ' clue**\n- {{say:Cl']
  const mounted = render(<CocStreamingProse details={{ chunks: [...chunks], speakers }} />)
  expect(mounted.container.querySelector('h3')?.textContent).toBe('Evidence')
  expect(mounted.container.querySelector('[data-streamdown="strong"]')?.textContent).toBe('First clue')
  expect(mounted.container.textContent).not.toContain('{{')
  chunks.push('erk}}**Check** the [index](https://example.org).{{/say}}')
  mounted.rerender(<CocStreamingProse details={{ chunks: [...chunks], speakers }} />)
  expect(mounted.container.querySelectorAll('li')).toHaveLength(2)
  expect(mounted.container.querySelector('li:nth-child(2) [data-streamdown="strong"] .coc-say')?.textContent).toBe('Check')
  expect(mounted.container.querySelector('[data-streamdown="link"] .coc-say')?.textContent).toBe('index')
  expect(mounted.container.querySelector('.coc-say')?.getAttribute('data-who')).toBe('npc')
  chunks.push('\n\n> Tomorrow.\n\n`literal **code**`')
  mounted.rerender(<CocStreamingProse details={{ chunks: [...chunks], speakers, status: 'completed' }} />)
  expect(mounted.container.querySelector('blockquote')?.textContent?.trim()).toBe('Tomorrow.')
  expect(mounted.container.querySelector('code')?.textContent).toBe('literal **code**')
})

it('preserves speech ink across Markdown blocks and after the stream completes', () => {
  const chunks = ['{{say:Clerk}}### A heading\n\n**One** paragraph.\n\nAnother paragraph.{{/say}}']
  const mounted = render(<CocStreamingProse details={{ chunks, speakers }} />)
  const spans = [...mounted.container.querySelectorAll<HTMLElement>('.coc-say')]
  expect(mounted.container.querySelector('h3 .coc-say')?.textContent).toBe('A heading')
  expect(spans.map(span => span.textContent).join('')).toBe('A headingOne paragraph.Another paragraph.')
  const ink = spans[0].style.getPropertyValue('--coc-say-ink')
  expect(ink).toMatch(/^var\(--coc-say-\d+\)$/)
  expect(spans.every(span => span.style.getPropertyValue('--coc-say-ink') === ink)).toBe(true)
  mounted.rerender(<CocStreamingProse details={{ chunks, speakers, status: 'completed' }} />)
  expect(mounted.container.querySelector<HTMLElement>('.coc-say')?.style.getPropertyValue('--coc-say-ink')).toBe(ink)
  expect(mounted.container.querySelectorAll('h3')).toHaveLength(1)
})

it('keeps a receipt inside its original list item, with speech continuing on both sides', () => {
  const marked_text = '### Evidence\n\n- **Index**\n- {{say:Clerk}}Before {{clue:index}} **after**.{{/say}}\n- Last'
  const details = { marked_text, speech, mechanics: [{ kind: 'clue', clue: 'index', label: 'Index', marker: 'clue:index' }] }
  const mounted = render(<Card details={details} renderProse={renderCocProse} />)
  expect(mounted.container.querySelector('h3')?.textContent).toBe('Evidence')
  expect(mounted.container.querySelectorAll('li')).toHaveLength(3)
  const item = mounted.container.querySelector('li:nth-child(2)')!
  expect(item.querySelectorAll('.coc-mech-here')).toHaveLength(1)
  const receipt = item.querySelector('.coc-mech-here')!
  const voices = [...item.querySelectorAll<HTMLElement>('.coc-say')]
  expect(voices[0].textContent).toBe('Before ')
  expect(item.querySelector('[data-streamdown="strong"] .coc-say')?.textContent).toBe('after')
  expect(voices[0].compareDocumentPosition(receipt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(receipt.compareDocumentPosition(voices[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(voices.every(span => span.style.getPropertyValue('--coc-say-ink') === voices[0].style.getPropertyValue('--coc-say-ink'))).toBe(true)
  expect(mounted.container.textContent).not.toMatch(/\{\{|zZcocReceipt/)
})

it('gates Markdown and embedded receipts with the existing reveal budget', () => {
  const details = { marked_text: '**Before**{{clue:index}} **after**', mechanics: [{ kind: 'clue', clue: 'index', label: 'Index', marker: 'clue:index' }] }
  const mounted = render(<Card details={details} renderProse={renderCocProse} typewriter={{ visible: 4, active: true }} />)
  expect(mounted.container.querySelector('[data-streamdown="strong"]')?.textContent).toBe('Be')
  expect(mounted.container.querySelector('.coc-mech-here')).toBeNull()
  mounted.rerender(<Card details={details} renderProse={renderCocProse} typewriter={{ visible: 10, active: true }} />)
  expect(mounted.container.querySelector('.coc-mech-here')).not.toBeNull()
  mounted.rerender(<Card details={details} renderProse={renderCocProse} typewriter={{ visible: 100, active: false }} />)
  expect(mounted.container.querySelectorAll('[data-streamdown="strong"]')).toHaveLength(2)
  expect(mounted.container.querySelectorAll('.coc-mech-here')).toHaveLength(1)
})

it('uses the host Markdown callback for final deliveries loaded through the controlled renderer', async () => {
  await loadControlledContributions({ id: 'coc-markdown-test', directory: '/tmp/coc-markdown-test', ui: {
    toolRenderers: [{ tool: 'coc-mechanics', entry: 'mechanics.js' }],
  } } as never, {} as never, async () => ({ createComponent }))
  const renderer = getToolRenderer('coc-mechanics')!
  const mounted = render(<>{renderer.render!({ tool: { id: 'card', name: 'coc-mechanics', input: '', startedAt: 0, finished: true },
    content: '', elapsed: () => '', details: { rendered_text: '### Summary\n\n- **Confirmed**', mechanics: [] } })}</>)
  expect(mounted.container.querySelector('h3')?.textContent).toBe('Summary')
  expect(mounted.container.querySelector('li [data-streamdown="strong"]')?.textContent).toBe('Confirmed')
})

it('keeps Markdown sanitization when decorating speaker text', () => {
  const mounted = render(<Card renderProse={renderCocProse} details={{ marked_text:
    '{{say:Clerk}}**Safe** <script>alert(1)</script><img src="x" onerror="alert(2)">{{/say}}', speech, mechanics: [] }} />)
  expect(mounted.container.querySelector('[data-streamdown="strong"] .coc-say')?.textContent).toBe('Safe')
  expect(mounted.container.querySelector('script')).toBeNull()
  expect(mounted.container.querySelector('[onerror]')).toBeNull()
})

it('keeps speech ranges aligned after Markdown escapes and HTML entities', () => {
  const text = 'A &amp; B \\*literal\\* {{say:Clerk}}Hello &amp; goodbye{{/say}} tail.'
  const mounted = render(<CocStreamingProse details={{ chunks: [text], speakers }} />)
  expect(mounted.container.querySelector('.coc-say')?.textContent).toBe('Hello & goodbye')
  expect(mounted.container.textContent).toBe('A & B *literal* Hello & goodbye tail.')
  const ink = mounted.container.querySelector<HTMLElement>('.coc-say')?.style.getPropertyValue('--coc-say-ink')
  mounted.rerender(<Card renderProse={renderCocProse} details={{ marked_text: text, speech, mechanics: [] }} />)
  expect(mounted.container.querySelector('.coc-say')?.textContent).toBe('Hello & goodbye')
  expect(mounted.container.querySelector<HTMLElement>('.coc-say')?.style.getPropertyValue('--coc-say-ink')).toBe(ink)
})

it('keeps emphasis continuous when a speech boundary or receipt interrupts it', () => {
  const marked_text = '**Before {{say:Clerk}}spoken {{clue:index}}still spoken{{/say}} after**'
  const mounted = render(<Card renderProse={renderCocProse} details={{ marked_text, speech,
    mechanics: [{ kind: 'clue', clue: 'index', label: 'Index', marker: 'clue:index' }] }} />)
  expect(mounted.container.querySelectorAll('[data-streamdown="strong"]')).toHaveLength(1)
  expect(mounted.container.querySelectorAll('.coc-mech-here')).toHaveLength(1)
  expect([...mounted.container.querySelectorAll('.coc-say')].map(span => span.textContent).join('')).toBe('spoken still spoken')
  expect(mounted.container.textContent).not.toContain('**')
})

it('places a visible receipt once while hiding keeper-only receipts', () => {
  const mounted = render(<Card renderProse={renderCocProse} details={{
    marked_text: '**Before**{{clue:index}}After{{clue:index}}{{check:hidden}}',
    mechanics: [
      { kind: 'clue', clue: 'index', label: 'Index', marker: 'clue:index' },
      { kind: 'roll', visibility: 'keeper', marker: 'check:hidden', roll: 73, target: 80, skill: 'Secret roll' },
      { kind: 'clue', clue: 'other', label: 'Other clue' },
    ],
  }} />)
  expect(mounted.container.querySelectorAll('.coc-mech-here')).toHaveLength(1)
  expect(mounted.container.querySelectorAll('.coc-mech-list')).toHaveLength(1)
  expect(mounted.container.textContent).not.toMatch(/Secret roll|73|\{\{|zZcocReceipt/)
})

it('keeps an open list and code fence intact while later chunks arrive', () => {
  const chunks = ['### Notes\n\n- First\n\n']
  const mounted = render(<CocStreamingProse details={{ chunks: [...chunks] }} />)
  const heading = mounted.container.querySelector('h3')
  chunks.push('- Second\n\n```text\n**literal**\n\n')
  mounted.rerender(<CocStreamingProse details={{ chunks: [...chunks] }} />)
  expect(mounted.container.querySelector('h3')).toBe(heading)
  expect(mounted.container.querySelectorAll('ul')).toHaveLength(1)
  expect(mounted.container.querySelectorAll('li')).toHaveLength(2)
  chunks.push('end\n```\n\nA final paragraph.')
  mounted.rerender(<CocStreamingProse details={{ chunks: [...chunks] }} />)
  // The code renderer represents empty lines as line elements rather than text newlines.
  expect(mounted.container.querySelector('code')?.textContent).toMatch(/\*\*literal\*\*\s+end/)
  expect(mounted.container.querySelectorAll('h3')).toHaveLength(1)
  mounted.rerender(<CocStreamingProse details={{ chunks: [...chunks], status: 'completed' }} />)
  expect(mounted.container.querySelectorAll('li')).toHaveLength(2)
  expect(mounted.container.textContent).toContain('A final paragraph.')
})
