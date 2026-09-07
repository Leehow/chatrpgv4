// @vitest-environment jsdom
/**
 * 扩展确认在 **App 的真实布局里** 走一遍。
 *
 * 为什么要单独一条：ExtensionUiHost.test.tsx 里的插槽是测试自己 createElement 出来、
 * 直接挂在 body 上的。那验证的是"给我一个插槽我就能就地渲染"，而不是"App 真的提供了
 * 这个插槽、而且它活得足够久"。真实插槽长在 chat-composer-stack 里，随会话与重渲染
 * 变化——2026-09-05 就是在这里出的问题：改成就地条之后，确认框只活了约两秒。
 *
 * 所以这里挂的是完整的 <App>，只往 mock host 上补 extUi 那两个方法。
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtUiEvent, ExtUiResponse, PipiHostAPI } from '@pipi/host-api'
import { App } from './App'
import { createMockHost } from './mock-host'
import { EXT_CONFIRM_SLOT_ID } from './ExtensionUiHost'

afterEach(cleanup)

function hostWithExtUi() {
  const listeners = new Set<(event: ExtUiEvent) => void>()
  const responses: Array<{ requestId: string; response: ExtUiResponse }> = []
  const base = createMockHost()
  const host: PipiHostAPI = {
    ...base,
    subscribeExtUi: (listener: (event: ExtUiEvent) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    extensionUiResponse: vi.fn(async (_sessionId: string, requestId: string, response: ExtUiResponse) => {
      responses.push({ requestId, response })
    }),
  } as unknown as PipiHostAPI
  return {
    host,
    responses,
    emit(event: ExtUiEvent) { for (const listener of listeners) listener(event) },
    sessionOf(): string | undefined {
      return undefined
    },
  }
}

describe('extension confirm inside the real App layout', () => {
  it('provides the confirm slot in the composer stack', async () => {
    const { host } = hostWithExtUi()
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    const stack = screen.getByTestId('chat-composer-stack')
    const slot = within(stack).getByTestId('extui-confirm-slot')
    expect(slot.id).toBe(EXT_CONFIRM_SLOT_ID)
  })

  it('shows the confirm inline and does not answer it on its own', async () => {
    // 核心断言：没有人点，它就该一直待着。实测里它约两秒就被取消了——如果那条路径
    // 还在，这里会看到一个没人请求过的 response。
    const ext = hostWithExtUi()
    render(<App host={ext.host} />)
    await screen.findAllByText('Electron 三栏界面')
    const stack = screen.getByTestId('chat-composer-stack')
    const slot = within(stack).getByTestId('extui-confirm-slot')

    // 用 App 当前实际选中的会话 id 发请求：会话对不上时 ExtensionUiHost 会按"换会话"
    // 处理并取消——那正是要排除的一种可能。
    const sessionId = screen.getByTestId('chat-composer-stack').closest('[data-session-id]')
      ?.getAttribute('data-session-id') ?? 'layout'
    act(() => {
      ext.emit({
        type: 'request', kind: 'confirm', sessionId, requestId: 'r-app',
        payload: { title: '确认执行 Hydra Semantic Plan？', message: '目标：拍一张\n共 2 步：' },
      } as ExtUiEvent)
    })

    await waitFor(() => expect(within(slot).queryByTestId('extui-confirm-bar')).toBeTruthy())
    // 静置：期间不许出现任何应答
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(ext.responses).toEqual([])
    expect(within(slot).getByTestId('extui-confirm-bar')).toBeTruthy()

    fireEvent.click(within(slot).getByTestId('extui-confirm-yes'))
    await waitFor(() => expect(ext.responses.at(-1)?.response).toEqual({ confirmed: true }))
  })

  it('shows a select inline too, with every option in reach', async () => {
    // 复核点是对着聊天里那张候选表做的判断。模态框会把表盖住，人得先处理弹层才能
    // 回头看图——所以 select 和 confirm 走同一个插槽，且选项不藏在"展开详情"后面。
    const ext = hostWithExtUi()
    render(<App host={ext.host} />)
    await screen.findAllByText('Electron 三栏界面')
    const stack = screen.getByTestId('chat-composer-stack')
    const slot = within(stack).getByTestId('extui-confirm-slot')
    const sessionId = stack.closest('[data-session-id]')?.getAttribute('data-session-id') ?? 'layout'

    const options = ['focus_m2', 'focus_m1', 'focus_0（AI 建议）', 'focus_p1', 'focus_p2', '都不合适 —— 我在对话里说']
    act(() => {
      ext.emit({
        type: 'request', kind: 'select', sessionId, requestId: 'r-select',
        payload: { title: 'focus_candidates：选一个候选（AI 建议 focus_0）', options },
      } as ExtUiEvent)
    })

    await waitFor(() => expect(within(slot).queryByTestId('extui-select-bar')).toBeTruthy())
    expect(screen.queryByTestId('extui-dialog-backdrop')).toBeNull()
    const rendered = within(slot).getAllByTestId('extui-select-option').map(node => node.textContent)
    expect(rendered).toEqual(options)

    await new Promise(resolve => setTimeout(resolve, 300))
    expect(ext.responses).toEqual([])

    // 人可以选一个 AI 没建议的档位，答案原样回到扩展
    fireEvent.click(within(slot).getAllByTestId('extui-select-option')[4])
    await waitFor(() => expect(ext.responses.at(-1)?.response).toEqual({ value: 'focus_p2' }))
  })

  it('highlights what changed and marks the dangerous line, and stays readable as plain text', async () => {
    // 扩展只能给宿主一个字符串（pi 的 confirm opts 里只有 signal/timeout），所以
    // 强调靠一个约定。约定必须退化成纯文本也读得通——同一个串还要发给终端 pi 和日志。
    const ext = hostWithExtUi()
    render(<App host={ext.host} />)
    await screen.findAllByText('Electron 三栏界面')
    const stack = screen.getByTestId('chat-composer-stack')
    const slot = within(stack).getByTestId('extui-confirm-slot')
    const sessionId = stack.closest('[data-session-id]')?.getAttribute('data-session-id') ?? 'layout'

    act(() => {
      ext.emit({
        type: 'request', kind: 'confirm', sessionId, requestId: 'r-color',
        payload: {
          title: '确认电镜操作 stage.goto_named？',
          message: '  变化  **X -8.990 mm**，旋转 -0.0°\n⚠ 机械结构会真的动。',
        },
      } as ExtUiEvent)
    })

    const body = await within(slot).findByTestId('extui-confirm-body')
    // 变了的值被高亮，没变的留原色
    const changed = body.querySelectorAll('.extui-confirm-changed')
    expect([...changed].map(n => n.textContent)).toEqual(['X -8.990 mm'])
    expect(body.querySelector('.extui-confirm-danger')?.textContent).toContain('机械结构会真的动')
    // 星号是标记，不该被人看到
    expect(body.textContent).not.toContain('**')
    // 而且内容一个字不少：高亮是加在上面的，不是替换掉的
    expect(body.textContent).toContain('X -8.990 mm')
    expect(body.textContent).toContain('旋转 -0.0°')
  })

  it('lets the human refuse the whole set instead of forcing a pick', async () => {
    const ext = hostWithExtUi()
    render(<App host={ext.host} />)
    await screen.findAllByText('Electron 三栏界面')
    const stack = screen.getByTestId('chat-composer-stack')
    const slot = within(stack).getByTestId('extui-confirm-slot')
    const sessionId = stack.closest('[data-session-id]')?.getAttribute('data-session-id') ?? 'layout'

    act(() => {
      ext.emit({
        type: 'request', kind: 'select', sessionId, requestId: 'r-cancel',
        payload: { title: '选一个候选', options: ['focus_0', 'focus_p1'] },
      } as ExtUiEvent)
    })
    await waitFor(() => expect(within(slot).queryByTestId('extui-select-bar')).toBeTruthy())

    fireEvent.click(within(slot).getByTestId('extui-select-cancel'))
    await waitFor(() => expect(ext.responses.at(-1)?.response).toEqual({ cancelled: true }))
  })
})
