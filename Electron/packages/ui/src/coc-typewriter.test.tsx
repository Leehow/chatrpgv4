// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
// @ts-expect-error -- plain ESM controlled renderer
import { createComponent } from '../../../../pipicoc/mechanics.js'
import { loadControlledContributions } from './controlled-component-loader'
import { disposeUiContributions } from './ui-registries'
import { MessageView } from './Transcript'
import { AssistantKeepsSecrets } from './assistant-secrets'
import { applyStreamEvent, finishStreamingMessage, historyMessages, reconcileHistorySnapshot, type ChatMessage } from './transcript-model'
import { ui } from './fixtures/coc-ui-words'

const EXT = 'coc-typewriter-test'
const HEAD = 'The door opens slowly. '
const ORIGINAL = `${HEAD}{{say:Clerk}}"Take the brass key from the counter."{{/say}}`
const REPLACED = `${HEAD}{{say:Clerk}}"The brass key is yours. Keep it safe."{{/say}}`
const delivery = (marked: string) => ({ id: 'delivery', role: 'assistant' as const, content: '', timestamp: 1,
  presentation: { renderer: 'coc-mechanics', details: { marked_text: marked, mechanics: [], ui: ui('en') } } })
const live = (marked = ORIGINAL) => applyStreamEvent([], { type: 'presentation', entry: delivery(marked) } as never)[0]
const view = (message: ChatMessage) => <AssistantKeepsSecrets value><MessageView message={message} onCopy={async () => {}} onResend={() => {}} resendDisabled={false} /></AssistantKeepsSecrets>
const prose = (root: HTMLElement) => Array.from(root.querySelectorAll('.coc-mech-para')).map(node => node.textContent).join('')

beforeEach(async () => {
  vi.useFakeTimers()
  await loadControlledContributions({ id: EXT, directory: '/tmp/coc-typewriter', ui: { toolRenderers: [{ tool: 'coc-mechanics', entry: 'mechanics.js' }] } } as never,
    {} as never, async () => ({ createComponent }))
})
afterEach(() => { cleanup(); disposeUiContributions(EXT); vi.useRealTimers(); vi.unstubAllGlobals() })

it('a prose revision replaces the original card immediately, even while its unseen tail is playing', () => {
  const original = live()
  const mounted = render(view(original))
  const originalRow = mounted.container.querySelector('article.message')
  expect(prose(mounted.container)).toBe('')
  act(() => vi.advanceTimersByTime(400))
  const reached = prose(mounted.container)
  expect(reached).toBe(HEAD.slice(0, 20))
  const updated = applyStreamEvent([original], { type: 'presentation', entry: delivery(REPLACED) } as never)[0]
  expect(updated.typewriter).toBeUndefined()
  mounted.rerender(view(updated))
  expect(prose(mounted.container)).toBe(`${HEAD}"The brass key is yours. Keep it safe."`)
  expect(mounted.container.querySelectorAll('article.message')).toHaveLength(1)
  expect(mounted.container.querySelector('article.message')).toBe(originalRow)
  expect(mounted.container.textContent).not.toContain('Take the brass key')
  expect(mounted.container.textContent).not.toContain('{{')
  expect(mounted.container.querySelector('.coc-typewriter-cursor')).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  mounted.unmount()
  const remounted = render(view(updated))
  expect(prose(remounted.container)).toBe(`${HEAD}"The brass key is yours. Keep it safe."`)
  expect(vi.getTimerCount()).toBe(0)
})

it('identical prose and metadata-only patches preserve first-generation playback', () => {
  const original = live()
  const mounted = render(view(original))
  act(() => vi.advanceTimersByTime(400))
  const reached = prose(mounted.container)
  const entry = delivery(ORIGINAL)
  entry.presentation.details.mechanics = [{ kind: 'notice', text: 'A card detail.' }] as never
  const updated = applyStreamEvent([original], { type: 'presentation', entry } as never)[0]
  expect(updated.typewriter).toBe(original.typewriter)
  mounted.rerender(view(updated))
  expect(prose(mounted.container)).toBe(reached)
  expect(mounted.container.querySelector('.coc-typewriter-cursor')).not.toBeNull()
  act(() => vi.advanceTimersByTime(40))
  expect(prose(mounted.container).length).toBe(reached.length + 2)
})

it('a revised history snapshot is immediate and later redraws never restart its playback', () => {
  const original = live()
  const mounted = render(view(original))
  act(() => vi.advanceTimersByTime(80))
  const refreshed = reconcileHistorySnapshot([delivery(REPLACED)] as never, 0, 0, undefined, [original]).messages[0]
  expect(refreshed.typewriter).toBeUndefined()
  mounted.rerender(view(refreshed))
  expect(prose(mounted.container)).toBe(`${HEAD}"The brass key is yours. Keep it safe."`)
  expect(vi.getTimerCount()).toBe(0)
  const redraw = applyStreamEvent([refreshed], { type: 'presentation', entry: delivery(`${REPLACED} The clerk nods.`) } as never)[0]
  mounted.rerender(view(redraw))
  expect(prose(mounted.container)).toContain('The clerk nods.')
  expect(vi.getTimerCount()).toBe(0)
})

it('virtualized remount and same-card history refresh preserve playback; completed text never replays', () => {
  const message = live()
  const first = render(view(message))
  act(() => vi.advanceTimersByTime(400))
  const reached = prose(first.container)
  first.unmount()
  expect(vi.getTimerCount()).toBe(0)
  const refreshed = reconcileHistorySnapshot([delivery(ORIGINAL)] as never, 0, 0, undefined, [message]).messages[0]
  expect(refreshed.typewriter).toBe(message.typewriter)
  const second = render(view(refreshed))
  expect(prose(second.container)).toBe(reached)
  act(() => vi.advanceTimersByTime(4000))
  second.unmount()
  const patched = applyStreamEvent([refreshed], { type: 'presentation', entry: delivery(REPLACED) } as never)[0]
  const third = render(view(patched))
  expect(prose(third.container)).toContain('Keep it safe.')
  expect(vi.getTimerCount()).toBe(0)
})

it('cold history draws complete prose immediately, including later card patches', () => {
  const history = historyMessages([delivery(ORIGINAL)] as never)
  const mounted = render(view(history[0]))
  expect(prose(mounted.container)).toContain('Take the brass key')
  const patched = applyStreamEvent(history, { type: 'presentation', entry: delivery(REPLACED) } as never)[0]
  expect(patched.typewriter).toBeUndefined()
  mounted.rerender(view(patched))
  expect(prose(mounted.container)).toContain('Keep it safe.')
  expect(vi.getTimerCount()).toBe(0)
})

it('reduced motion shows the complete delivery and schedules no playback', () => {
  const remove = vi.fn()
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: remove }))
  const mounted = render(view(live()))
  expect(prose(mounted.container)).toContain('Take the brass key')
  expect(vi.getTimerCount()).toBe(0)
  mounted.unmount()
  expect(remove).toHaveBeenCalled()
})

it('reveals Unicode graphemes whole and brings an inline receipt in at its prose position', () => {
  const marked = `A👩🏽‍🚀{{say:Clerk}}é好{{/say}}{{m:1}} The journey ends.`
  const entry = delivery(marked)
  entry.presentation.details.mechanics = [{ kind: 'roll', skill: 'Spot Hidden', roll: 12, target: 50, passed: true, level: 'regular', visibility: 'public', marker: 'm:1' }] as never
  const message = applyStreamEvent([], { type: 'presentation', entry } as never)[0]
  const mounted = render(view(message))
  expect(mounted.container.querySelector('.coc-mech-here')).toBeNull()
  act(() => vi.advanceTimersByTime(40))
  expect(prose(mounted.container)).toBe('A👩🏽‍🚀')
  expect(mounted.container.querySelector('.coc-mech-here')).toBeNull()
  act(() => vi.advanceTimersByTime(40))
  expect(prose(mounted.container)).toBe('A👩🏽‍🚀é好')
  expect(mounted.container.querySelector('.coc-mech-here')).not.toBeNull()
  expect(mounted.container.querySelector('.coc-say')?.getAttribute('data-who')).toBe('label')
  expect(mounted.container.textContent).not.toContain('{{')
})

it('a settled ordinary Keeper paragraph is paced, while a persisted one is immediate', () => {
  const content = 'The editor watches the doorway and keeps his hand on the file.'
  const settled = finishStreamingMessage([{ id: 'plain', role: 'assistant', content, streaming: true }])[0]
  const mounted = render(view(settled))
  expect(mounted.container.textContent).not.toContain('keeps his hand')
  act(() => vi.advanceTimersByTime(4000))
  expect(mounted.container.textContent).toContain(content)
  mounted.unmount()
  const history = render(view({ id: 'plain-history', role: 'assistant', content }))
  expect(history.container.textContent).toContain(content)
})
