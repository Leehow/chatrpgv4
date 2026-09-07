// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtUiEvent, ExtUiResponse } from '@pipi/host-api'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { EXT_CONFIRM_SLOT_ID, ExtensionUiHost } from './ExtensionUiHost'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function fakeHost() {
  const listeners = new Set<(event: ExtUiEvent) => void>()
  const responses: Array<{ sessionId: string; requestId: string; response: ExtUiResponse }> = []
  return {
    subscribeExtUi: (listener: (event: ExtUiEvent) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    extensionUiResponse: vi.fn(async (sessionId: string, requestId: string, response: ExtUiResponse) => {
      responses.push({ sessionId, requestId, response })
    }),
    emit(event: ExtUiEvent) {
      for (const listener of listeners) listener(event)
    },
    responses,
  }
}

describe('ExtensionUiHost', () => {
  it('renders notify as an inline banner', () => {
    const host = fakeHost()
    render(<ExtensionUiHost host={host} sessionId="session-1" />)
    act(() => {
      host.emit({
        type: 'request',
        sessionId: 'session-1',
        requestId: 'n1',
        kind: 'notify',
        payload: { message: 'Command blocked', notifyType: 'warning' },
      })
    })
    expect(screen.getByTestId('extui-notify').textContent).toContain('Command blocked')
    expect(host.responses).toEqual([])
  })

  it('sends confirmed true/false for confirm 确定 and 取消', () => {
    const host = fakeHost()
    render(<ExtensionUiHost host={host} sessionId="session-1" />)
    act(() => {
      host.emit({
        type: 'request',
        sessionId: 'session-1',
        requestId: 'c1',
        kind: 'confirm',
        payload: { title: 'Clear?', message: 'All gone.' },
      })
    })
    expect(screen.getByTestId('extui-dialog').textContent).toContain('All gone.')
    fireEvent.click(screen.getByTestId('extui-confirm-yes'))
    expect(host.extensionUiResponse).toHaveBeenCalledWith('session-1', 'c1', { confirmed: true })
    expect(screen.queryByTestId('extui-dialog')).toBeNull()

    act(() => {
      host.emit({
        type: 'request',
        sessionId: 'session-1',
        requestId: 'c2',
        kind: 'confirm',
        payload: { title: 'Again?' },
      })
    })
    fireEvent.click(screen.getByTestId('extui-confirm-no'))
    expect(host.extensionUiResponse).toHaveBeenCalledWith('session-1', 'c2', { confirmed: false })
  })

  it('renders confirm inline in the composer slot instead of a centered modal', () => {
    // 扩展的 confirm 常带一份要读的正文（Hydra 的 Execution Preview）。居中弹层把它压在
    // 屏幕中央、盖住对话，人读完还得回想上下文。放回对话流里，正文和它要确认的那次
    // 工具调用挨着——和「计划待确认」同一条带。协议不变，仍是阻塞的请求/应答。
    const host = fakeHost()
    const slot = document.createElement('div')
    slot.id = EXT_CONFIRM_SLOT_ID
    document.body.appendChild(slot)
    try {
      render(<ExtensionUiHost host={host} sessionId="s1" />)
      act(() => {
        host.emit({
          type: 'request', kind: 'confirm', sessionId: 's1', requestId: 'r-inline',
          payload: { title: '确认执行 Hydra Semantic Plan？', message: '目标：拍一张\n共 2 步：' },
        } as ExtUiEvent)
      })
      expect(screen.getByTestId('extui-confirm-bar')).toBeTruthy()
      expect(screen.queryByTestId('extui-dialog-backdrop')).toBeNull()
      expect(slot.contains(screen.getByTestId('extui-confirm-bar'))).toBe(true)
      fireEvent.click(screen.getByTestId('extui-confirm-yes'))
      expect(host.responses.at(-1)?.response).toEqual({ confirmed: true })
    } finally {
      slot.remove()
    }
  })

  it('falls back to the modal when no slot exists, rather than swallowing the gate', () => {
    // 找不到插槽就退回弹层。确认是扩展写操作唯一由人把关的一步——宁可难看，
    // 不能因为 DOM 里少个节点就把它吞掉。
    const host = fakeHost()
    render(<ExtensionUiHost host={host} sessionId="s1" />)
    act(() => {
      host.emit({
        type: 'request', kind: 'confirm', sessionId: 's1', requestId: 'r-fallback',
        payload: { title: '确认？', message: '正文' },
      } as ExtUiEvent)
    })
    expect(screen.queryByTestId('extui-confirm-bar')).toBeNull()
    expect(screen.getByTestId('extui-dialog')).toBeTruthy()
    fireEvent.click(screen.getByTestId('extui-confirm-yes'))
    expect(host.responses.at(-1)?.response).toEqual({ confirmed: true })
  })

  it('the inline body starts open, because a confirmation nobody can read is not a gate', () => {
    const host = fakeHost()
    const slot = document.createElement('div')
    slot.id = EXT_CONFIRM_SLOT_ID
    document.body.appendChild(slot)
    try {
      render(<ExtensionUiHost host={host} sessionId="s1" />)
      act(() => {
        host.emit({
          type: 'request', kind: 'confirm', sessionId: 's1', requestId: 'r-fold',
          payload: { title: '确认？', message: Array.from({ length: 40 }, (_, i) => `行 ${i}`).join('\n') },
        } as ExtUiEvent)
      })
      // 正文是这道门唯一要人核对的东西（台子要去哪、走多远、什么会真的动）。
      // 默认折叠时它只剩两行开头，人按确定时并不知道自己批准了什么。
      // 输入框不会被顶掉：正文自己带 max-height + overflow-y（见 extension-ui-host.css）。
      expect(screen.getByTestId('extui-confirm-body').dataset.expanded).toBe('true')
      fireEvent.click(screen.getByTestId('extui-confirm-toggle'))
      expect(screen.getByTestId('extui-confirm-body').dataset.expanded).toBe('false')

      // 下一个确认重新摊开：上一次收起过，不代表下一次也该藏起来。
      act(() => {
        host.emit({
          type: 'request', kind: 'confirm', sessionId: 's1', requestId: 'r-fold-2',
          payload: { title: '再确认？', message: Array.from({ length: 40 }, (_, i) => `行 ${i}`).join('\n') },
        } as ExtUiEvent)
      })
      expect(screen.getByTestId('extui-confirm-body').dataset.expanded).toBe('true')
    } finally {
      slot.remove()
    }
  })

  it('keeps a long multi-line confirm readable and its buttons reachable', () => {
    // 扩展送来的确认正文是**按行写的**（Hydra 的 Execution Preview：目标、逐步的临时改动、
    // 交还状态）。它原来落在一个普通 <p> 里：HTML 吃掉换行、没有滚动容器，于是长正文塌成
    // 一坨、把「确定/取消」顶出对话框——用户看到的是"没有确认按钮"，那道门就等于消失了。
    //
    // jsdom 不做布局，量不出溢出；所以这里钉两件能测的：换行确实进了 DOM，且正文再长
    // 按钮也在。真正决定可读性的四条 CSS 声明由下一个用例守着。
    const host = fakeHost()
    render(<ExtensionUiHost host={host} sessionId="s1" />)
    const body = Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 行：临时改动 …`).join('\n')
    act(() => {
      host.emit({
        type: 'request', kind: 'confirm', sessionId: 's1', requestId: 'r-long',
        payload: { title: '确认执行 Hydra Semantic Plan？', message: body },
      } as ExtUiEvent)
    })
    const message = screen.getByText(/第 1 行/)
    expect(message.textContent).toContain('\n')
    expect(message.textContent?.split('\n').length).toBe(60)
    // 正文多长，两个按钮都必须还在，而且点得动
    expect(screen.getByTestId('extui-confirm-no')).toBeTruthy()
    fireEvent.click(screen.getByTestId('extui-confirm-yes'))
    expect(host.responses.at(-1)?.response).toEqual({ confirmed: true })
  })

  it('the dialog stylesheet keeps newlines, scrolls the body and pins the actions', () => {
    // 这四条是上面那条用例测不到、却真正决定"看不看得见按钮"的部分。写死在这里，
    // 谁把它们删了都会红。
    // vitest 下 import.meta.url 不是 file: URL，从包根解析；找不到就让它红，
    // 而不是悄悄读到空串把断言变成永真。
    const cssPath = resolve(process.cwd(), 'src/extension-ui-host.css')
    expect(existsSync(cssPath)).toBe(true)
    const css = readFileSync(cssPath, 'utf8')
    // 不用正则：多层转义容易把它写成永远匹配不到、于是永远为空的样子——那种断言不会红。
    const rule = (selector: string) => {
      const at = css.indexOf(`${selector}{`)
      if (at < 0) return ''
      return css.slice(at + selector.length + 1, css.indexOf('}', at))
    }
    expect(rule('.extui-dialog-message')).toContain('white-space:pre-wrap')
    expect(rule('.extui-dialog-message')).toContain('overflow-y:auto')
    expect(rule('.extui-dialog-actions')).toContain('flex:none')
    expect(rule('.extui-dialog')).toContain('flex-direction:column')
  })

  it('submits input text and cancels on close', () => {
    const host = fakeHost()
    render(<ExtensionUiHost host={host} sessionId="session-1" />)
    act(() => {
      host.emit({
        type: 'request',
        sessionId: 'session-1',
        requestId: 'i1',
        kind: 'input',
        payload: { title: 'Name', placeholder: 'type' },
      })
    })
    fireEvent.change(screen.getByTestId('extui-input'), { target: { value: 'Ada' } })
    fireEvent.click(screen.getByTestId('extui-input-submit'))
    expect(host.extensionUiResponse).toHaveBeenCalledWith('session-1', 'i1', { value: 'Ada' })
  })

  it('closes a pending dialog when the session is aborted without sending a late response', () => {
    const host = fakeHost()
    render(<ExtensionUiHost host={host} sessionId="session-1" />)
    act(() => {
      host.emit({
        type: 'request',
        sessionId: 'session-1',
        requestId: 'c1',
        kind: 'confirm',
        payload: { title: 'Clear?' },
      })
    })
    expect(screen.getByTestId('extui-dialog')).toBeTruthy()
    act(() => {
      host.emit({ type: 'cancel', sessionId: 'session-1', requestId: 'c1', reason: 'aborted' })
    })
    expect(screen.queryByTestId('extui-dialog')).toBeNull()
    expect(host.extensionUiResponse).not.toHaveBeenCalled()
  })

  it('cancels a pending dialog when the selected session changes', () => {
    const host = fakeHost()
    const view = render(<ExtensionUiHost host={host} sessionId="session-1" />)
    act(() => {
      host.emit({
        type: 'request',
        sessionId: 'session-1',
        requestId: 'c1',
        kind: 'confirm',
        payload: { title: 'Clear?' },
      })
    })
    view.rerender(<ExtensionUiHost host={host} sessionId="session-2" />)
    expect(screen.queryByTestId('extui-dialog')).toBeNull()
    expect(host.extensionUiResponse).toHaveBeenCalledWith('session-1', 'c1', { cancelled: true })
  })
})
