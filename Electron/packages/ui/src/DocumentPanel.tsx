import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { documentKindForName, type BinaryDocumentContent, type DocumentContent, type DocumentKind, type PipiHostAPI } from '@pipi/host-api'
import type { DocumentRendererActions, DocumentRendererDescriptor } from '@pipiui/extension-api'
import { DocumentSurface } from './DocumentSurface'
import { TranscriptMarkdown } from './AssistantTranscriptContent'
import './document-panel.css'

function errorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined
  if (code === 'document_not_found') return '文件已不存在'
  return error instanceof Error && error.message.trim() ? error.message : '无法读取这个文档'
}

const DOCUMENT_ICON: Record<DocumentKind, string> = { markdown: 'MD', plain: 'TXT', pdf: 'PDF', word: 'DOC', spreadsheet: 'XLS', presentation: 'PPT' }

function validDocument(value: DocumentContent | null | undefined): value is DocumentContent {
  if (!value || !documentKindForName(value.path) || !value.name) return false
  return value.kind === 'markdown' || value.kind === 'plain'
    ? typeof value.content === 'string'
    : value.bytes instanceof Uint8Array
}

function isBinaryContent(value: DocumentContent): value is BinaryDocumentContent {
  return value.kind !== 'markdown' && value.kind !== 'plain'
}

/** File extension with a leading dot, lowercase — the registry match key, never a path. */
function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index).toLowerCase() : ''
}

/** Process-wide opaque ids so two mounted surfaces never share a documentId. */
let nextOpaqueDocumentId = 0

type DocumentRequest = {
  host: PipiHostAPI
  documentPath: string
  reloadGeneration: number
}

function sameDocumentRequest(a: DocumentRequest | null | undefined, b: DocumentRequest | null | undefined): boolean {
  return !!a && !!b && a.host === b.host && a.documentPath === b.documentPath && a.reloadGeneration === b.reloadGeneration
}

/**
 * Core document panel: owns the tab chrome and the whole host document lifecycle
 * (read / watch / reload / external open / size and validity checks / anydoc
 * fallback derivation). Body rendering — registry renderers and builtin views —
 * is delegated to the reusable DocumentSurface.
 */
export type DocumentPanelProps = {
  host: PipiHostAPI
  documentPath?: string | null
  /**
   * Whether this panel is the visible tab. Only the active panel holds the host
   * file watcher; a panel returning to the front reloads so edits made on disk
   * while it was hidden are picked up (or, when dirty, offered as a choice).
   */
  active?: boolean
  hidden?: boolean
  /** Tab strip callback: unsaved-edit state for this document. */
  onDirtyChange?: (path: string, dirty: boolean) => void
}

export const DocumentPanel = memo(function DocumentPanel({ host, documentPath, active = true, hidden = false, onDirtyChange }: DocumentPanelProps) {
  const [resolved, setResolved] = useState<{
    request: DocumentRequest
    document: DocumentContent | null
    error: string | null
    errorCode?: string
  } | null>(null)
  const [reloadGeneration, setReloadGeneration] = useState(0)
  const [viewerError, setViewerError] = useState<string | null>(null)
  const [fallbackMarkdown, setFallbackMarkdown] = useState<string | null>(null)
  const [fallbackPending, setFallbackPending] = useState(false)
  const [genericFallback, setGenericFallback] = useState(false)
  const [revision, setRevision] = useState(0)
  /** The mounted renderer reports unsaved edits (contract `reportDirty`). */
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  /** The file changed on disk while the renderer was dirty; ask instead of clobbering. */
  const [externalChange, setExternalChange] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  /** Ignore the watcher echo of our own save until this timestamp. */
  const selfWriteUntilRef = useRef(0)
  const fallbackAttemptedRef = useRef(false)
  /** Session-scoped opaque document ids — never the filesystem path (contract v1). */
  const documentIdsRef = useRef(new Map<string, string>())

  const currentRequest: DocumentRequest | null = documentPath
    ? { host, documentPath, reloadGeneration }
    : null
  const resolvedMatches = sameDocumentRequest(resolved?.request, currentRequest)
  const document = resolvedMatches ? resolved!.document : null
  const error = resolvedMatches ? resolved!.error : null
  const loading = Boolean(currentRequest) && !resolvedMatches

  const load = useCallback(() => setReloadGeneration(value => value + 1), [])
  const markDirty = useCallback((next: boolean) => {
    dirtyRef.current = next
    setDirty(next)
    if (documentPath) {
      void host.setDocumentDirty?.(documentPath, next).catch(() => undefined)
      onDirtyChange?.(documentPath, next)
    }
  }, [host, documentPath, onDirtyChange])
  const onViewerError = useCallback((nextError: unknown) => setViewerError(errorMessage(nextError)), [])
  const onDismissError = useCallback(() => {
    setResolved(previous => previous ? { ...previous, error: null } : previous)
  }, [])
  const onDismissViewerError = useCallback(() => {
    setViewerError(null)
    setGenericFallback(false)
    setFallbackMarkdown(null)
    setFallbackPending(false)
  }, [])

  // Restricted, host-mediated renderer actions (contract v1). No paths, no host API.
  const actions = useMemo<DocumentRendererActions>(() => ({
    reload: async () => { setReloadGeneration(value => value + 1) },
    openExternally: async () => {
      if (!documentPath || !host.openDocumentExternally) return
      setResolved(previous => previous ? { ...previous, error: null } : previous)
      try {
        await host.openDocumentExternally(documentPath)
      } catch (nextError) {
        setResolved(previous => {
          if (!previous || previous.request.host !== host || previous.request.documentPath !== documentPath) return previous
          return { ...previous, error: errorMessage(nextError) }
        })
      }
    },
    useGenericFallback: async () => { setGenericFallback(true) },
    ...(host.writeDocument ? {
      save: async (bytes: Uint8Array) => {
        if (!documentPath || !host.writeDocument) throw new Error('当前连接不支持保存文档')
        setSaveError(null)
        // The watcher will echo this write back as documentChanged; that echo must not
        // remount the editor that just saved, so it is ignored for a short window.
        selfWriteUntilRef.current = Date.now() + 3000
        let summary
        try {
          summary = await host.writeDocument(documentPath, bytes)
        } catch (nextError) {
          selfWriteUntilRef.current = 0
          setSaveError(errorMessage(nextError))
          throw nextError
        }
        const size = summary?.size ?? bytes.byteLength
        // Keep the panel's copy current without bumping `revision`: a renderer keyed on
        // revision stays mounted, and a later reload starts from the saved bytes.
        setResolved(previous => {
          if (!previous?.document || previous.request.host !== host || previous.request.documentPath !== documentPath) return previous
          const current = previous.document
          if (!isBinaryContent(current)) return previous
          const next: BinaryDocumentContent = { ...current, bytes, size, updatedAt: summary?.updatedAt ?? Date.now() }
          return { ...previous, document: next }
        })
        dirtyRef.current = false
        setDirty(false)
        setExternalChange(false)
        void host.setDocumentDirty?.(documentPath, false).catch(() => undefined)
        onDirtyChange?.(documentPath, false)
        return { size }
      },
      reportDirty: markDirty,
    } : {}),
  }), [host, documentPath, markDirty, onDirtyChange])

  const documentId = useMemo(() => {
    if (!documentPath) return ''
    const existing = documentIdsRef.current.get(documentPath)
    if (existing) return existing
    const id = `doc-${(nextOpaqueDocumentId += 1)}`
    documentIdsRef.current.set(documentPath, id)
    return id
  }, [documentPath])

  const descriptor = useMemo<DocumentRendererDescriptor | undefined>(() => {
    if (!document || !documentPath) return undefined
    return {
      documentId,
      name: document.name,
      extension: extensionOf(document.name),
      documentKind: document.kind,
      size: document.size ?? 0,
      revision,
    }
  }, [document, documentId, documentPath, revision])

  useEffect(() => {
    if (!documentPath) return
    return () => {
      if (dirtyRef.current) void host.setDocumentDirty?.(documentPath, false).catch(() => undefined)
      dirtyRef.current = false
    }
  }, [host, documentPath])

  useEffect(() => {
    setViewerError(null)
    setFallbackMarkdown(null)
    setFallbackPending(false)
    setGenericFallback(false)
    setDirty(false)
    setExternalChange(false)
    setSaveError(null)
    dirtyRef.current = false
    fallbackAttemptedRef.current = false
    if (!documentPath) {
      setResolved(null)
      return
    }
    const request: DocumentRequest = { host, documentPath, reloadGeneration }
    if (!host.readDocument) {
      setResolved({ request, document: null, error: '当前连接不支持读取文档' })
      return
    }
    let cancelled = false
    void host.readDocument(documentPath)
      .then(value => {
        if (cancelled) return
        if (!validDocument(value)) throw new Error('宿主返回了无效的文档内容')
        setResolved({ request, document: value, error: null })
        setRevision(count => count + 1)
      })
      .catch(nextError => {
        if (cancelled) return
        const code = nextError && typeof nextError === 'object' && 'code' in nextError ? String((nextError as { code?: unknown }).code) : undefined
        setResolved({ request, document: null, error: errorMessage(nextError), ...(code ? { errorCode: code } : {}) })
      })
    return () => { cancelled = true }
  }, [host, documentPath, reloadGeneration])

  useEffect(() => {
    if (!documentPath || !host.watchDocument || !active) return
    void host.watchDocument(documentPath).catch(error => console.warn('[document-watch]', error))
    return () => { void host.unwatchDocument?.().catch(() => undefined) }
  }, [host, documentPath, active])

  // A tab coming back to the front missed the watcher while hidden: reload once,
  // or — when it holds unsaved edits — ask, exactly like an external change.
  const wasActiveRef = useRef(active)
  useEffect(() => {
    const was = wasActiveRef.current
    wasActiveRef.current = active
    if (!documentPath || !active || was) return
    if (dirtyRef.current) setExternalChange(true)
    else load()
  }, [active, documentPath, load])

  useEffect(() => {
    if (!documentPath || !host.subscribeDocuments || !active) return
    return host.subscribeDocuments(event => {
      if (event.type !== 'documentChanged' || event.path !== documentPath) return
      if (Date.now() < selfWriteUntilRef.current) return
      if (dirtyRef.current) {
        setExternalChange(true)
        return
      }
      load()
    })
  }, [host, documentPath, load, active])

  const reloadDiscardingEdits = useCallback(() => {
    dirtyRef.current = false
    setDirty(false)
    setExternalChange(false)
    if (documentPath) void host.setDocumentDirty?.(documentPath, false).catch(() => undefined)
    load()
  }, [host, documentPath, load])

  const errorCode = resolvedMatches ? resolved!.errorCode : undefined
  const pathKind = documentPath ? documentKindForName(documentPath) : null
  /** The host refused to ship the bytes; a text preview needs none, so offer it. */
  const tooLargeBinary = errorCode === 'document_too_large' && !!pathKind && pathKind !== 'markdown' && pathKind !== 'plain'

  // Generic fallback is requested by a path-free renderer action (or by the
  // too-large offer above). Core owns the only anydoc engine and the document
  // path; the renderer never sees either.
  useEffect(() => {
    if (!genericFallback || !documentPath) return
    if (!document && !tooLargeBinary) return
    if (document && (document.kind === 'markdown' || document.kind === 'plain')) return
    if (!host.convertDocumentToMarkdown || fallbackAttemptedRef.current) return
    fallbackAttemptedRef.current = true
    let cancelled = false
    setFallbackPending(true)
    void host.convertDocumentToMarkdown(documentPath)
      .then(markdown => { if (!cancelled) setFallbackMarkdown(typeof markdown === 'string' && markdown.trim() ? markdown : '') })
      .catch(() => { if (!cancelled) setFallbackMarkdown('') })
      .finally(() => { if (!cancelled) setFallbackPending(false) })
    return () => { cancelled = true }
  }, [genericFallback, document, host, documentPath, tooLargeBinary])

  const tooLargeView = tooLargeBinary && genericFallback
    ? fallbackPending
      ? <div className="document-loading" role="status">文件太大，正在本地转换为可读文本…</div>
      : fallbackMarkdown
        ? <div className="document-fallback" data-testid="document-fallback">
          <div className="document-fallback-bar" role="status">文件超过面板可直接打开的大小，已显示本地转换的文本预览。</div>
          <article className="document-markdown" aria-label={`文档内容 ${documentPath?.split('/').at(-1) ?? ''}`}><TranscriptMarkdown content={fallbackMarkdown} /></article>
        </div>
        : <div className="document-error" role="alert"><span>无法将文档转换为可读文本</span><span className="document-error-actions"><button onClick={load}>重试</button></span></div>
    : null

  return <section className="document-panel" aria-label="文档面板" hidden={hidden}>
    {!documentPath ? <div className="document-empty" data-testid="document-empty">
      <span className="document-empty-icon" aria-hidden="true">▤</span>
      <b>没有打开的文档</b>
      <p>点击主聊天或 subagent 消息下方的文档卡片，或把文件拖进右侧面板，即可预览 Markdown、TXT、PDF 或扩展支持的文档。</p>
    </div> : <>
      <header className="document-panel-header">
        <span className="document-header-icon" aria-hidden="true">{DOCUMENT_ICON[document?.kind ?? documentKindForName(documentPath) ?? 'plain']}</span>
        <span className="document-header-copy"><b>{document?.name ?? documentPath.split('/').at(-1)}</b><small>{documentPath}</small></span>
        {dirty ? <span className="document-dirty-badge" role="status" title="有未保存的修改">未保存</span> : null}
        {host.openDocumentExternally ? <button className="document-external-open" aria-label="用默认应用打开文档" title="用默认应用打开" onClick={() => void actions.openExternally()}>↗</button> : null}
        <button className="document-reload" aria-label="重新加载文档" title="重新加载文档" onClick={dirty ? reloadDiscardingEdits : load}>↻</button>
      </header>
      {externalChange ? <div className="document-external-change" role="alert" data-testid="document-external-change">
        <span>磁盘上的文件已被修改（可能是 agent 刚编辑过），面板里还有未保存的修改。</span>
        <span className="document-error-actions">
          <button onClick={reloadDiscardingEdits}>重新加载（丢弃未保存修改）</button>
          <button onClick={() => setExternalChange(false)}>保留我的修改</button>
        </span>
      </div> : null}
      {saveError ? <div className="document-error" role="alert"><span>保存失败：{saveError}</span><span className="document-error-actions"><button aria-label="关闭保存错误" onClick={() => setSaveError(null)}>×</button></span></div> : null}
      {tooLargeBinary && !genericFallback ? <div className="document-external-change" role="status" data-testid="document-too-large">
        <span>这个文件太大，面板不会把整份内容载入编辑器/预览器。</span>
        <span className="document-error-actions"><button onClick={() => setGenericFallback(true)}>改用文本预览</button>{host.openDocumentExternally ? <button onClick={() => void actions.openExternally()}>用默认应用打开</button> : null}</span>
      </div> : null}
      {tooLargeView ?? <DocumentSurface
        document={document}
        descriptor={descriptor}
        actions={actions}
        loading={loading}
        error={error}
        onRetry={load}
        onDismissError={onDismissError}
        viewerError={viewerError}
        onViewerError={onViewerError}
        onDismissViewerError={onDismissViewerError}
        fallbackMarkdown={fallbackMarkdown}
        fallbackPending={fallbackPending}
        genericFallback={genericFallback}
      />}
    </>}
  </section>
})
