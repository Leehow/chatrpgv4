import type { ReactNode } from 'react'
import resendIcon from './sf-icons/arrow-clockwise.png'

export type MessageActionBarProps = {
  alignment: 'leading' | 'trailing'
  canCopy: boolean
  canResend?: boolean
  canJump?: boolean
  copyDisabled?: boolean
  resendDisabled?: boolean
  onCopy: () => void
  onResend?: () => void
  onJump?: () => void
  copied?: boolean
  onBranch?: () => void
  branchDisabled?: boolean
  onIllustrate?: () => void
  illustrateBusy?: boolean
  illustrateDisabled?: boolean
  words?: Record<string,string>
}

function JumpGlyph() {
  return (
    <svg className="message-action-icon-svg" width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CopyGlyph() {
  return <svg className="message-action-icon-svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="8" y="7" width="12" height="14" rx="2" />
    <path d="M16 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" />
  </svg>
}

function IllustrateGlyph() {
  return <svg className="message-action-icon-svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.8" />
    <path d="M4.5 18.5 10 13l3.5 3.5L17 13l2.5 2.5" />
  </svg>
}

function MessageActionButton({ label, title, icon, disabled, onClick, children }: {
  label: string
  title: string
  icon?: string
  disabled?: boolean
  onClick?: () => void
  children?: ReactNode
}) {
  return (
    <button className="message-action-button" type="button" aria-label={label} title={title} disabled={disabled} onClick={onClick}>
      {icon
        ? <span className="message-action-icon" style={{ WebkitMaskImage: `url(${icon})`, maskImage: `url(${icon})` }} aria-hidden="true" />
        : children}
    </button>
  )
}

export function MessageActionBar({ alignment, canCopy, canResend = false, canJump = false, copyDisabled = false, resendDisabled = false, onCopy, onResend, onJump, copied = false, onBranch, branchDisabled, onIllustrate, illustrateBusy = false, illustrateDisabled = false, words }: MessageActionBarProps) {
  if (!canCopy && !canResend && !canJump && !onIllustrate) return null
  const illustrateLabel = illustrateBusy ? (words?.illustrating ?? '生成插画中…') : (words?.illustrate ?? '生成插画')

  return <div className={`message-action-bar ${alignment}${onBranch ? ' has-branch' : ''}`} role="toolbar" aria-label={words?.actions ?? '消息操作'}>
    <div className="message-action-buttons">
      {canCopy && <MessageActionButton label={words?.copy ?? '复制消息'} title={words?.copy ?? '复制'} disabled={copyDisabled} onClick={onCopy}><CopyGlyph /></MessageActionButton>}
      {onBranch && <MessageActionButton label={words?.branch ?? '…'} title={words?.branch ?? '…'} disabled={branchDisabled} onClick={onBranch}><svg className="message-action-icon-svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10M18 7c0 7-12 3-12 10"/></svg></MessageActionButton>}
      {onIllustrate && <MessageActionButton label={illustrateLabel} title={illustrateLabel} disabled={illustrateDisabled || illustrateBusy} onClick={onIllustrate}><IllustrateGlyph /></MessageActionButton>}
      {canJump && <MessageActionButton label="跳转到上一条用户消息" title="跳转到上一条用户消息" onClick={onJump}><JumpGlyph /></MessageActionButton>}
      {canResend && <MessageActionButton label="重发消息" title="重发（撤回后重新发送）" icon={resendIcon} disabled={resendDisabled} onClick={onResend} />}
    </div>
    {copied && <span className="message-copied-notice" role="status">{words?.copied ?? '已复制'}</span>}
  </div>
}
