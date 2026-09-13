// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MessageView } from './Transcript'
import type { ChatMessage } from './transcript-model'

afterEach(cleanup)

const narration: ChatMessage = { id: 'narration-1', role: 'assistant', content: 'The harbor wind pushes through the office blinds.', timestamp: 1 } as ChatMessage

function renderRow(overrides: Record<string, unknown> = {}, message: ChatMessage = narration) {
  return render(<MessageView message={message} showFooter onCopy={vi.fn(async () => undefined)} onResend={() => undefined} resendDisabled={false} {...overrides} />)
}

it('mounts a ready illustration as the first child of the first text segment', () => {
  const { container } = renderRow({ illustration: { status: 'ready', image: 'data:image/png;base64,abc' } })
  const segment = container.querySelector('[data-transcript-segment="text"]') as HTMLElement
  const mount = segment.querySelector('[data-testid="message-illustration"]') as HTMLElement
  expect(mount.className).toBe('message-illustration')
  expect(segment.firstChild).toBe(mount)
  expect((mount.querySelector('img') as HTMLImageElement).src).toContain('data:image/png;base64,abc')
})

it('mounts the busy skeleton while generation runs', () => {
  const { container } = renderRow({ illustration: { status: 'busy' } })
  const mount = container.querySelector('[data-testid="message-illustration"]') as HTMLElement
  expect(mount.className).toContain('is-busy')
  expect(mount.getAttribute('role')).toBe('status')
})

it('mounts the error note after a failed generation', () => {
  const { container } = renderRow({ illustration: { status: 'error', code: 'image_failed' } })
  const mount = container.querySelector('[data-testid="message-illustration"]') as HTMLElement
  expect(mount.className).toContain('is-error')
  expect(mount.textContent).toBe('插画生成失败')
})

it('passes the mount into the opening narration row too', () => {
  const opening = { id: 'opening-1', role: 'assistant', content: 'The wind comes off the harbor and waits for no one.', opening: true, timestamp: 1 } as unknown as ChatMessage
  const { container } = renderRow({ illustration: { status: 'ready', image: 'data:image/png;base64,xyz' } }, opening)
  const segment = container.querySelector('[data-transcript-segment="text"]') as HTMLElement
  const mount = segment.querySelector('[data-testid="message-illustration"]') as HTMLElement
  expect(mount.querySelector('img')).toBeTruthy()
  expect(segment.firstChild).toBe(mount)
})

it('offers the illustrate button on settled assistant rows, including the opening row', () => {
  const onIllustrate = vi.fn()
  renderRow({ onIllustrate })
  fireEvent.click(screen.getByRole('button', { name: '生成插画' }))
  expect(onIllustrate).toHaveBeenCalledWith(narration)
  cleanup()
  const opening = { id: 'opening-2', role: 'assistant', content: 'The wind comes off the harbor.', opening: true, timestamp: 1 } as unknown as ChatMessage
  renderRow({ onIllustrate }, opening)
  fireEvent.click(screen.getByRole('button', { name: '生成插画' }))
  expect(onIllustrate).toHaveBeenCalledWith(opening)
})

it('offers the illustrate action on a mechanics turn and mounts inside the presentation article', () => {
  const onIllustrate = vi.fn()
  const mechanics = { id: 'mech-1', role: 'assistant', content: '', presentation: { renderer: 'coc-mechanics', details: { marked_text: '他抬起眼睛，正好撞上你的视线。' } } } as unknown as ChatMessage
  const { container } = renderRow({ onIllustrate, illustration: { status: 'ready', image: 'data:image/png;base64,mech' } }, mechanics)
  fireEvent.click(screen.getByRole('button', { name: '生成插画' }))
  expect(onIllustrate).toHaveBeenCalledWith(mechanics)
  const article = container.querySelector('article[data-presentation="coc-mechanics"]') as HTMLElement
  expect(article.firstElementChild?.getAttribute('data-testid')).toBe('message-illustration')
})

it('hides the illustrate button on streaming, textless presentation, and user rows', () => {
  const onIllustrate = vi.fn()
  renderRow({ onIllustrate }, { ...narration, streaming: true })
  expect(screen.queryByRole('button', { name: '生成插画' })).toBeNull()
  cleanup()
  renderRow({ onIllustrate }, { id: 'card', role: 'assistant', content: '', presentation: { renderer: 'coc-mechanics', details: {} } } as unknown as ChatMessage)
  expect(screen.queryByRole('button', { name: '生成插画' })).toBeNull()
  cleanup()
  renderRow({ onIllustrate }, { id: 'user-1', role: 'user', content: 'I open the door.', timestamp: 1 } as ChatMessage)
  expect(screen.queryByRole('button', { name: '生成插画' })).toBeNull()
})
