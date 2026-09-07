import { memo, useCallback, useState } from 'react'
import { documentKindForName, type DocumentKind, type PipiHostAPI } from '@pipi/host-api'
import { DocumentPanel } from './DocumentPanel'
import './document-tabs.css'

const TAB_ICON: Record<DocumentKind, string> = { markdown: 'MD', plain: 'TXT', pdf: 'PDF', word: 'DOC', spreadsheet: 'XLS', presentation: 'PPT' }

function nameOf(path: string): string {
  return path.split('/').at(-1) || path
}

export type DocumentTabsProps = {
  host: PipiHostAPI
  /** Tabs in open order; the shell owns the list. */
  paths: readonly string[]
  activePath?: string | null
  onActivate?: (path: string) => void
  onClose?: (path: string) => void
  /** Ask before closing a tab with unsaved edits. Defaults to window.confirm. */
  confirmClose?: (path: string) => boolean
}

/**
 * Multi-document tab strip over the document panel. Every tab keeps its own
 * DocumentPanel mounted (hidden when inactive) so an editor's state — cursor,
 * unsaved edits, undo history — survives switching; only the active tab holds
 * the host file watcher and reloads on activation to catch changes made while
 * it was in the background.
 */
export const DocumentTabs = memo(function DocumentTabs({ host, paths, activePath, onActivate, onClose, confirmClose }: DocumentTabsProps) {
  const [dirtyPaths, setDirtyPaths] = useState<Record<string, boolean>>({})
  const onDirtyChange = useCallback((path: string, dirty: boolean) => {
    setDirtyPaths(current => (Boolean(current[path]) === dirty ? current : { ...current, [path]: dirty }))
  }, [])
  const close = useCallback((path: string) => {
    if (dirtyPaths[path]) {
      const ask = confirmClose ?? (target => (typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(`「${nameOf(target)}」有未保存的修改，关闭后会丢失。仍要关闭吗？`) : true))
      if (!ask(path)) return
    }
    setDirtyPaths(current => {
      if (!(path in current)) return current
      const next = { ...current }
      delete next[path]
      return next
    })
    onClose?.(path)
  }, [confirmClose, dirtyPaths, onClose])

  if (!paths.length) return <DocumentPanel host={host} documentPath={null} active />

  const active = activePath && paths.includes(activePath) ? activePath : paths[paths.length - 1]!
  return <div className="document-tabs" data-testid="document-tabs">
    {paths.length > 1 || onClose ? <div className="document-tab-strip" role="tablist" aria-label="打开的文档">
      {paths.map(path => {
        const isActive = path === active
        const kind = documentKindForName(path) ?? 'plain'
        return <div key={path} className={`document-tab${isActive ? ' active' : ''}`} role="tab" aria-selected={isActive} title={path}>
          <button type="button" className="document-tab-main" onClick={() => onActivate?.(path)} data-testid="document-tab" data-path={path} data-active={isActive ? '1' : '0'}>
            <span className="document-tab-icon" aria-hidden="true">{TAB_ICON[kind]}</span>
            <span className="document-tab-name">{nameOf(path)}</span>
            {dirtyPaths[path] ? <span className="document-tab-dirty" title="有未保存的修改" aria-label="未保存">●</span> : null}
          </button>
          {onClose ? <button type="button" className="document-tab-close" aria-label={`关闭 ${nameOf(path)}`} onClick={() => close(path)}>×</button> : null}
        </div>
      })}
    </div> : null}
    <div className="document-tab-bodies">
      {paths.map(path => <DocumentPanel key={path} host={host} documentPath={path} active={path === active} hidden={path !== active} onDirtyChange={onDirtyChange} />)}
    </div>
  </div>
})
