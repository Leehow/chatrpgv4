import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ExtUiEvent, ExtUiResponse, PipiHostAPI } from '@pipi/host-api'
import './extension-ui-host.css'

export type ExtensionUiHostApi = Pick<PipiHostAPI, 'subscribeExtUi' | 'extensionUiResponse'>

/**
 * 确认请求落脚的插槽：输入框上方，和「计划待确认」同一条带。
 *
 * 为什么不继续用居中弹层：扩展的 confirm 常常带一份要读的正文（Hydra 的 Execution
 * Preview 就是目标、逐步的临时改动、交还状态），弹层把它压在屏幕中央、盖住对话，人读
 * 完还得回想上下文是什么。放回对话流里，正文和它要确认的那次工具调用挨着。
 *
 * 协议一点没变：仍然是阻塞的请求/应答，扩展在等 extensionUiResponse。改的只是画在哪。
 * 插槽不在时（旧布局、测试）自动退回弹层——不能因为找不到 DOM 节点就把一道门吞掉。
 */

/** 确认正文里高亮"变了的东西"和"危险的那句"。
 *
 * 扩展只能给宿主一个字符串——pi 的 `ui.confirm(title, message, opts)` 里 opts 只有
 * signal 和 timeout，没有结构化通道。所以约定写在文本里，而约定必须**退化成纯文本
 * 也读得通**：同一个串还要发给终端 pi、RPC 和日志。
 *
 * 因此只认两条，都不靠猜内容：
 *   `**...**`  → 变了的值（强调色）。纯文本里是一对星号，读得懂。
 *   行首 `⚠`   → 危险提示（警示色）。纯文本里就是个警示符号，本来就该显眼。
 *
 * 宿主不解析别的、不猜语义：一旦开始按"看起来像坐标"上色，扩展改一个字就错位。
 */
function renderConfirmBody(message: string): React.ReactNode[] {
  return message.split("\n").map((line, lineIndex) => {
    const danger = line.trimStart().startsWith("⚠")
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((part, partIndex) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4
        ? <b key={partIndex} className="extui-confirm-changed">{part.slice(2, -2)}</b>
        : <span key={partIndex}>{part}</span>
    )
    return (
      <span key={lineIndex} className={danger ? 'extui-confirm-danger' : undefined}>
        {parts}{lineIndex < message.split("\n").length - 1 ? "\n" : ""}
      </span>
    )
  })
}

export const EXT_CONFIRM_SLOT_ID = 'extui-confirm-slot'

type NotifyItem = {
  id: string
  sessionId: string
  requestId: string
  message: string
  tone: 'info' | 'warning' | 'error'
}

type DialogItem = {
  sessionId: string
  requestId: string
  kind: 'confirm' | 'select' | 'input' | 'editor'
  title: string
  message: string
  placeholder?: string
  options: string[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function notifyMessage(kind: string, payload: Record<string, unknown>): string {
  if (kind === 'widget') {
    const lines = payload.widgetLines
    if (Array.isArray(lines)) return lines.filter(item => typeof item === 'string').join('\n')
  }
  return asString(payload.message) || asString(payload.title) || asString(payload.text)
}

function notifyTone(payload: Record<string, unknown>): NotifyItem['tone'] {
  const raw = asString(payload.notifyType)
  return raw === 'warning' || raw === 'error' ? raw : 'info'
}

function toDialog(event: Extract<ExtUiEvent, { type: 'request' }>): DialogItem | undefined {
  if (event.kind !== 'confirm' && event.kind !== 'select' && event.kind !== 'input' && event.kind !== 'editor') {
    return undefined
  }
  const payload = asRecord(event.payload)
  const options = Array.isArray(payload.options) ? payload.options.filter(item => typeof item === 'string') as string[] : []
  return {
    sessionId: event.sessionId,
    requestId: event.requestId,
    kind: event.kind,
    title: asString(payload.title) || (event.kind === 'confirm' ? '确认' : event.kind === 'select' ? '选择' : '输入'),
    message: asString(payload.message),
    placeholder: asString(payload.placeholder) || undefined,
    options,
  }
}

export function ExtensionUiHost({
  host,
  sessionId,
}: {
  host: ExtensionUiHostApi
  sessionId?: string
}) {
  const [notifies, setNotifies] = useState<NotifyItem[]>([])
  const [dialog, setDialog] = useState<DialogItem | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [expanded, setExpanded] = useState(true)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const dialogRef = useRef<DialogItem | null>(null)
  const sessionRef = useRef(sessionId)
  const notifyTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const titleId = useId()
  dialogRef.current = dialog

  const reply = useCallback((item: { sessionId: string; requestId: string }, response: ExtUiResponse) => {
    void host.extensionUiResponse?.(item.sessionId, item.requestId, response)?.catch(() => undefined)
  }, [host])

  useEffect(() => {
    const previous = sessionRef.current
    sessionRef.current = sessionId
    const open = dialogRef.current
    if (open && previous && previous !== sessionId) {
      reply(open, { cancelled: true })
      setDialog(null)
    }
  }, [sessionId, reply])

  useEffect(() => () => {
    for (const timer of notifyTimers.current) clearTimeout(timer)
    notifyTimers.current = []
  }, [])

  useEffect(() => {
    if (!host.subscribeExtUi) return
    return host.subscribeExtUi((event: ExtUiEvent) => {
      if (event.type === 'cancel') {
        setDialog(current => (
          current && current.sessionId === event.sessionId && current.requestId === event.requestId ? null : current
        ))
        return
      }
      if (event.type !== 'request') return
      if (event.kind === 'notify' || event.kind === 'widget') {
        const payload = asRecord(event.payload)
        const message = notifyMessage(event.kind, payload)
        if (!message) return
        const item: NotifyItem = {
          id: `${event.sessionId}:${event.requestId}`,
          sessionId: event.sessionId,
          requestId: event.requestId,
          message,
          tone: notifyTone(payload),
        }
        setNotifies(current => [...current.filter(entry => entry.id !== item.id), item])
        const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
          setNotifies(current => current.filter(entry => entry.id !== item.id))
        }, 5000)
        notifyTimers.current.push(timer)
        return
      }
      const next = toDialog(event)
      if (!next) return
      setDialog(current => {
        if (current && (current.sessionId !== next.sessionId || current.requestId !== next.requestId)) {
          reply(current, { cancelled: true })
        }
        return next
      })
      setInputValue(asString(asRecord(event.payload).prefill))
    })
  }, [host, reply])

  // 插槽随会话挂载；就地条要渲染就得在弹出的那一刻拿到它。拿不到就退回弹层。
  //
  // confirm 和 select 都走这里：两者都是"停下来等人回答一句"的门，模态框把它们盖在
  // 主界面上，人得先处理弹层才能看聊天里的候选表——而复核恰恰要对着那张表看。
  // 插槽 id 沿用 EXT_CONFIRM_SLOT_ID，只是为了不动其它文件里已有的引用。
  const inline = dialog?.kind === 'confirm' || dialog?.kind === 'select'
  useEffect(() => {
    // 正文默认摊开——和选项同一个道理：这是一道门，藏起来的正文等于没给。
    // 这里原来默认折叠，怕长正文把输入框顶出屏幕；但那件事是由正文自己的
    // max-height + overflow-y 挡住的（见 css），不是由折叠挡住的。折叠只做到了
    // 一件事：把"按下确定之后机器上会发生什么"缩成两行看不懂的开头。
    setExpanded(true)
    setSlot(inline ? document.getElementById(EXT_CONFIRM_SLOT_ID) : null)
  }, [dialog, inline])

  useEffect(() => {
    if (!dialog) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      reply(dialog, { cancelled: true })
      setDialog(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, reply])

  const dismissDialog = (response: ExtUiResponse) => {
    if (!dialog) return
    reply(dialog, response)
    setDialog(null)
  }

  return (
    <>
      {notifies.length > 0 && (
        <div className="extui-notify-stack" data-testid="extui-notify-stack">
          {notifies.map(item => (
            <div
              key={item.id}
              className={`extui-notify${item.tone !== 'info' ? ` is-${item.tone}` : ''}`}
              role="status"
              data-testid="extui-notify"
            >
              <p className="extui-notify-message">{item.message}</p>
              <button
                type="button"
                className="extui-notify-close"
                aria-label="关闭通知"
                onClick={() => setNotifies(current => current.filter(entry => entry.id !== item.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {dialog && inline && slot && createPortal(
        <section
          className="extui-confirm-bar"
          data-testid={dialog.kind === 'select' ? 'extui-select-bar' : 'extui-confirm-bar'}
          role="group"
          aria-labelledby={titleId}
        >
          <div className="extui-confirm-bar-head">
            <span className="extui-confirm-bar-label">{dialog.kind === 'select' ? '待选择' : '待确认'}</span>
            <span className="extui-confirm-bar-title" id={titleId}>{dialog.title}</span>
            {dialog.kind === 'confirm' && dialog.message ? (
              <button
                type="button"
                className="extui-confirm-bar-toggle"
                data-testid="extui-confirm-toggle"
                aria-expanded={expanded}
                onClick={() => setExpanded(value => !value)}
              >
                {expanded ? '收起详情' : '展开详情'}
              </button>
            ) : null}
            <div className="extui-confirm-bar-actions">
              {dialog.kind === 'select' ? (
                <button type="button" data-testid="extui-select-cancel" onClick={() => dismissDialog({ cancelled: true })}>取消</button>
              ) : (
                <>
                  <button type="button" data-testid="extui-confirm-no" onClick={() => dismissDialog({ confirmed: false })}>取消</button>
                  <button type="button" className="extui-dialog-primary" data-testid="extui-confirm-yes" onClick={() => dismissDialog({ confirmed: true })}>确定</button>
                </>
              )}
            </div>
          </div>
          {dialog.kind === 'select' ? (
            // 选项永远摊开：它们就是这道门的正文，藏在"展开详情"后面等于没给。
            <div className="extui-confirm-bar-options" data-testid="extui-select-options">
              {dialog.options.map(option => (
                <button
                  key={option}
                  type="button"
                  className="extui-dialog-option"
                  data-testid="extui-select-option"
                  onClick={() => dismissDialog({ value: option })}
                >
                  {option}
                </button>
              ))}
            </div>
          ) : dialog.message ? (
            <pre className="extui-confirm-bar-body" data-testid="extui-confirm-body" data-expanded={expanded}>{renderConfirmBody(dialog.message)}</pre>
          ) : null}
        </section>,
        slot,
      )}
      {dialog && !(inline && slot) && (
        <div
          className="extui-dialog-backdrop"
          data-testid="extui-dialog-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget) dismissDialog({ cancelled: true })
          }}
        >
          <section
            className="extui-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid="extui-dialog"
            data-kind={dialog.kind}
          >
            <header className="extui-dialog-header">
              <h2 id={titleId}>{dialog.title}</h2>
              <button
                type="button"
                className="extui-dialog-close"
                aria-label="关闭对话框"
                onClick={() => dismissDialog({ cancelled: true })}
              >
                ×
              </button>
            </header>
            <div className="extui-dialog-body">
              {dialog.message ? <p className="extui-dialog-message">{dialog.message}</p> : null}
              {dialog.kind === 'select' && (
                <div className="extui-dialog-options">
                  {dialog.options.map(option => (
                    <button
                      key={option}
                      type="button"
                      className="extui-dialog-option"
                      data-testid="extui-select-option"
                      onClick={() => dismissDialog({ value: option })}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
              {(dialog.kind === 'input' || dialog.kind === 'editor') && (
                dialog.kind === 'editor' ? (
                  <textarea
                    className="extui-dialog-input"
                    data-testid="extui-input"
                    placeholder={dialog.placeholder}
                    value={inputValue}
                    onChange={event => setInputValue(event.target.value)}
                    rows={6}
                  />
                ) : (
                  <input
                    className="extui-dialog-input"
                    data-testid="extui-input"
                    placeholder={dialog.placeholder}
                    value={inputValue}
                    onChange={event => setInputValue(event.target.value)}
                  />
                )
              )}
              <div className="extui-dialog-actions">
                {dialog.kind === 'confirm' ? (
                  <>
                    <button type="button" data-testid="extui-confirm-no" onClick={() => dismissDialog({ confirmed: false })}>取消</button>
                    <button type="button" className="extui-dialog-primary" data-testid="extui-confirm-yes" onClick={() => dismissDialog({ confirmed: true })}>确定</button>
                  </>
                ) : dialog.kind === 'input' || dialog.kind === 'editor' ? (
                  <>
                    <button type="button" data-testid="extui-input-cancel" onClick={() => dismissDialog({ cancelled: true })}>取消</button>
                    <button type="button" className="extui-dialog-primary" data-testid="extui-input-submit" onClick={() => dismissDialog({ value: inputValue })}>提交</button>
                  </>
                ) : (
                  <button type="button" data-testid="extui-select-cancel" onClick={() => dismissDialog({ cancelled: true })}>取消</button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
