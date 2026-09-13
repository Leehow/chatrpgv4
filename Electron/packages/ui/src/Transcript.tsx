import {CocCharacterDraft} from './CocCharacterDraft'
import {getToolRenderer,useToolRenderers} from './ui-registries'
import { forwardRef, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, type StateSnapshot, type VirtuosoHandle } from 'react-virtuoso'
import { ActivityCard as CollapsibleActivityCard } from './ActivityCard'
import { AssistantTranscriptContent } from './AssistantTranscriptContent'
import { MessageActionBar } from './MessageActionBar'
import { PromptRail, useActivePromptId } from './PromptRail'
import { SubagentSignalCard } from './SubagentSignalCard'
import { UserMessageBubble } from './UserMessageBubble'
import { WaitingPlaceholder, type WaitingPhase } from './WaitingPlaceholder'
import { buildRailPrompts, isNavigationEligibleUserPrompt } from './prompt-rail'
import { parseSubagentNotice } from './subagent-notice'
import { parseInternalUserSignal } from './subagent-signal'
import { TruncatedText } from './TruncatedText'
import { foldMarkedDeliveries, foldSupersededDrafts, withoutMechanicsMarkers, type ChatMessage } from './transcript-model'
import { nextTranscriptFirstItemIndex, TRANSCRIPT_FIRST_ITEM_BASE, TRANSCRIPT_PIN_MAX_ATTEMPTS, transcriptDataIndex, transcriptMessageIdentity } from './transcript-scroll'

/** §35 turn illustration: per-row generation state, keyed by message id in App. */
export type IllustrationState = { status: 'busy' | 'ready' | 'error'; image?: string; code?: string }

export type MessageActionHandlers = { onBranch?: (message: ChatMessage) => void; branchMessageIds?: ReadonlySet<string>; branchDisabled?: boolean; onIllustrate?: (message: ChatMessage) => void; illustrateDisabled?: boolean; illustrations?: ReadonlyMap<string, IllustrationState>; actionWords?: Record<string,string>; onCopy: (message: ChatMessage) => Promise<void>; onResend: (message: ChatMessage) => void; resendDisabled: boolean; copiedId: string | null }
type DocumentOpenProps = { documentBasePath?: string; onOpenDocument?: (path: string) => void }
type PresentationActionProps = {onChoose?: (entry:NonNullable<ChatMessage['presentation']>,option:string)=>Promise<unknown>; onDraftOverride?: (entry:NonNullable<ChatMessage['presentation']>,request:Record<string,unknown>)=>Promise<Record<string,any>>}
type SubagentOpenProps = { onOpenSubagents?: (agentId?: string) => void }
type TranscriptStateRecord = { messageIds: readonly string[]; firstItemIndex: number; snapshot: StateSnapshot }

const TRANSCRIPT_STATE_CACHE_LIMIT = 12
const transcriptStateCache = new Map<string, TranscriptStateRecord>()

function matchingTranscriptState(stateKey: string | undefined, messageIds: readonly string[]): TranscriptStateRecord | undefined {
  if (!stateKey) return undefined
  const cached = transcriptStateCache.get(stateKey)
  if (!cached) return undefined
  const matches = cached.messageIds.length === messageIds.length && cached.messageIds.every((id, index) => id === messageIds[index])
  if (!matches) {
    transcriptStateCache.delete(stateKey)
    return undefined
  }
  transcriptStateCache.delete(stateKey)
  transcriptStateCache.set(stateKey, cached)
  return cached
}

function rememberTranscriptState(stateKey: string, state: TranscriptStateRecord) {
  transcriptStateCache.delete(stateKey)
  transcriptStateCache.set(stateKey, state)
  while (transcriptStateCache.size > TRANSCRIPT_STATE_CACHE_LIMIT) {
    const oldest = transcriptStateCache.keys().next().value as string | undefined
    if (!oldest) break
    transcriptStateCache.delete(oldest)
  }
}

function assignForwardedVirtuosoRef(ref: React.ForwardedRef<VirtuosoHandle>, value: VirtuosoHandle | null) {
  if (typeof ref === 'function') ref(value)
  else if (ref) ref.current = value
}

function transcriptItemKey(index: number, message: ChatMessage) {
  return `${index}:${message.id}`
}

/** Nearest earlier human user prompt. Skips tools, assistants, and injected user-role signals. */
export function findPreviousUserMessageIndex(messages: readonly ChatMessage[], fromIndex: number): number | null {
  for (let index = fromIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index]
    if (candidate && isNavigationEligibleUserPrompt(candidate)) return index
  }
  return null
}

function assignVirtuosoRef(ref: React.RefObject<VirtuosoHandle> | undefined, value: VirtuosoHandle | null) {
  if (ref) (ref as React.MutableRefObject<VirtuosoHandle | null>).current = value
}

export function Transcript({ stateKey, messages: rawMessages, transcriptRef, waiting, active = true, onLoadOlder, documentBasePath, onOpenDocument, onOpenSubagents, onChoose, onDraftOverride, onCopy, onResend, resendDisabled, copiedId, onBranch, branchMessageIds, branchDisabled, onIllustrate, illustrateDisabled, illustrations, actionWords, navigation }: {
  /** Stable session identity used to restore Virtuoso measurements after remounting. */
  stateKey?: string
  navigation?: {messageId:string; nonce:number}
  messages: ChatMessage[]
  /** Optional bridge used by the active transcript to expose its handle. */
  transcriptRef?: React.RefObject<VirtuosoHandle>
  waiting?: { startedAt: number; phase: WaitingPhase; detail?: string; onStop?: () => void }
  active?: boolean
  onLoadOlder?: () => void
} & DocumentOpenProps & SubagentOpenProps & PresentationActionProps & MessageActionHandlers) {
  const [atBottom, setAtBottom] = useState(true)
  const [seekingId, setSeekingId] = useState<string | null>(null)
  const completedNavigation = useRef<number | null>(null)
  const activeRef = useRef(active)
  const atBottomRef = useRef(true)
  const followIntentRef = useRef(true)
  const userDetachedRef = useRef(false)
  const userDetachedSawAwayRef = useRef(false)
  const pendingPinRef = useRef(false)
  const pinGenerationRef = useRef(0)
  const pinIssuedGenerationRef = useRef(-1)
  const pinAttemptsRef = useRef(0)
  const pinFrameRef = useRef<number | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  activeRef.current = active

  const clearPinFrame = useCallback(() => {
    if (pinFrameRef.current !== null) cancelAnimationFrame(pinFrameRef.current)
    pinFrameRef.current = null
    pinAttemptsRef.current = 0
  }, [])
  const requestPin = useCallback(() => {
    if (!activeRef.current || !followIntentRef.current) return
    pinGenerationRef.current += 1
    pinIssuedGenerationRef.current = -1
    pendingPinRef.current = true
    pinAttemptsRef.current = 0
    if (pinFrameRef.current !== null) return
    const attempt = () => {
      pinFrameRef.current = null
      if (!activeRef.current || !followIntentRef.current || !pendingPinRef.current) return
      const generation = pinGenerationRef.current
      const handle = virtuosoRef.current
      if (handle) {
        // Mark before invoking Virtuoso because a test double (or a future
        // synchronous implementation) may report atBottom from this call.
        pinIssuedGenerationRef.current = generation
        handle.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })
      }
      pinAttemptsRef.current += 1
      if (pendingPinRef.current && pinAttemptsRef.current < TRANSCRIPT_PIN_MAX_ATTEMPTS) {
        pinFrameRef.current = requestAnimationFrame(attempt)
      }
    }
    pinFrameRef.current = requestAnimationFrame(attempt)
  }, [])
  const cancelFollow = useCallback(() => {
    if (!activeRef.current) return
    followIntentRef.current = false
    userDetachedRef.current = true
    userDetachedSawAwayRef.current = !atBottomRef.current
    pendingPinRef.current = false
    clearPinFrame()
    setAtBottom(false)
  }, [clearPinFrame])
  const setVirtuosoHandle = useCallback((handle: VirtuosoHandle | null) => {
    const previous = virtuosoRef.current
    virtuosoRef.current = handle
    if (!transcriptRef || !activeRef.current) return
    if (handle) assignVirtuosoRef(transcriptRef, handle)
    else if (transcriptRef.current === previous) assignVirtuosoRef(transcriptRef, null)
  }, [transcriptRef])

  // §16.6: a delivery the mechanics card draws with its markers in place must not also appear as
  // the plain assistant copy that the terminal reads. Folded here, so both the live reducer and a
  // history page get the same answer without either of them knowing about the other.
  // §23.4: a superseded draft card draws the same current sheet the last one does, so it folds too.
  const messages = useMemo(() => foldSupersededDrafts(foldMarkedDeliveries(rawMessages)), [rawMessages])
  const prompts = useMemo(() => buildRailPrompts(messages), [messages])
  const { activeId: viewportActiveId, containerRef } = useActivePromptId(prompts, atBottom)
  const activeId = seekingId ?? viewportActiveId
  useEffect(() => { if (atBottom) setSeekingId(null) }, [atBottom])
  useLayoutEffect(() => {
    if (!active) {
      pendingPinRef.current = false
      clearPinFrame()
      return
    }
    followIntentRef.current = true
    userDetachedRef.current = false
    userDetachedSawAwayRef.current = false
    setSeekingId(null)
    requestPin()
  }, [active, clearPinFrame, requestPin])
  useLayoutEffect(() => {
    if (active && followIntentRef.current) requestPin()
  }, [active, messages, requestPin])
  useLayoutEffect(() => {
    if (!active || !transcriptRef) return
    const handle = virtuosoRef.current
    assignVirtuosoRef(transcriptRef, handle)
    return () => {
      if (transcriptRef.current === handle) assignVirtuosoRef(transcriptRef, null)
    }
  }, [active, transcriptRef])
  useEffect(() => {
    const node = containerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    let width = -1
    let height = -1
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.contentRect.width === width && entry.contentRect.height === height) continue
        width = entry.contentRect.width
        height = entry.contentRect.height
        requestPin()
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [containerRef, requestPin])
  useEffect(() => () => clearPinFrame(), [clearPinFrame])

  const handleAtBottom = (value: boolean) => {
    if (!activeRef.current) return
    atBottomRef.current = value
    if (!value) {
      if (userDetachedRef.current) userDetachedSawAwayRef.current = true
      setAtBottom(false)
      return
    }
    // A hidden slot can replay an old true before the activation RAF runs.
    // Only a true after this generation actually issued LAST may finish it.
    if (pendingPinRef.current && pinIssuedGenerationRef.current !== pinGenerationRef.current) return
    // Ignore a stale true delivered between the upward gesture and Virtuoso's
    // first measured-away callback. A later false→true is a real return.
    if (userDetachedRef.current && !userDetachedSawAwayRef.current) return
    userDetachedRef.current = false
    userDetachedSawAwayRef.current = false
    setAtBottom(true)
    followIntentRef.current = true
    pendingPinRef.current = false
    clearPinFrame()
  }
  const jump = (index: number, id: string) => {
    cancelFollow()
    setSeekingId(id)
    virtuosoRef.current?.scrollToIndex({ index, align: 'start', behavior: 'smooth' })
  }
  useEffect(() => {
    if (!navigation || !active || completedNavigation.current === navigation.nonce) return
    cancelFollow()
    const index = messages.findIndex(message => message.id === navigation.messageId)
    if (index < 0) { onLoadOlder?.(); return }
    const frame = requestAnimationFrame(() => {
      if (!virtuosoRef.current) return
      completedNavigation.current = navigation.nonce
      jump(index, navigation.messageId)
    })
    return () => cancelAnimationFrame(frame)
  }, [navigation, active, messages, onLoadOlder, cancelFollow])
  const returnLatest = () => {
    followIntentRef.current = true
    userDetachedRef.current = false
    userDetachedSawAwayRef.current = false
    setSeekingId(null)
    requestPin()
  }
  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) cancelFollow()
  }
  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null
  }
  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    const start = touchStartRef.current
    if (!touch || !start) return
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (deltaY >= 5 && deltaY > Math.abs(deltaX)) cancelFollow()
  }
  return <div className={waiting ? 'transcript-area is-waiting' : 'transcript-area'} ref={containerRef} onWheelCapture={handleWheel} onTouchStartCapture={handleTouchStart} onTouchMoveCapture={handleTouchMove}>
    <PromptRail prompts={prompts} activeId={activeId} onJump={jump} />
    <MessageList ref={setVirtuosoHandle} stateKey={stateKey} messages={messages} active={active} shouldFollow={() => followIntentRef.current} onAtBottom={handleAtBottom} onListHeightChanged={requestPin} onLoadOlder={onLoadOlder} documentBasePath={documentBasePath} onOpenDocument={onOpenDocument} onOpenSubagents={onOpenSubagents} onChoose={onChoose} onDraftOverride={onDraftOverride} onBranch={onBranch} branchMessageIds={branchMessageIds} branchDisabled={branchDisabled} onIllustrate={onIllustrate} illustrateDisabled={illustrateDisabled} illustrations={illustrations} actionWords={actionWords} onCopy={onCopy} onResend={onResend} resendDisabled={resendDisabled} copiedId={copiedId} onJump={jump} />
    {waiting && <WaitingPlaceholder phase={waiting.phase} startedAt={waiting.startedAt} detail={waiting.detail} onStop={waiting.onStop} />}
    {active && !atBottom && messages.length > 0 && <button className="return-latest" aria-label="回到最新" title="回到最新" onClick={returnLatest}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
  </div>
}

export const MessageList = memo(forwardRef<VirtuosoHandle, { stateKey?: string; messages: ChatMessage[]; active?: boolean; shouldFollow: () => boolean; onAtBottom: (value: boolean) => void; onListHeightChanged: () => void; onLoadOlder?: () => void; onJump: (index: number, id: string) => void } & DocumentOpenProps & SubagentOpenProps & PresentationActionProps & MessageActionHandlers>(function MessageList({ stateKey, messages, active = true, shouldFollow, onAtBottom, onListHeightChanged, onLoadOlder, documentBasePath, onOpenDocument, onOpenSubagents, onChoose, onDraftOverride, onCopy, onResend, resendDisabled, copiedId, onBranch, branchMessageIds, branchDisabled, onIllustrate, illustrateDisabled, illustrations, actionWords, onJump }, ref) {
  const ids = useMemo(() => messages.map(transcriptMessageIdentity), [messages])
  const restoredStateRef = useRef<TranscriptStateRecord | undefined>(undefined)
  const restoredStateCheckedRef = useRef(false)
  if (!restoredStateCheckedRef.current) {
    restoredStateRef.current = matchingTranscriptState(stateKey, ids)
    restoredStateCheckedRef.current = true
  }
  const previousIdsRef = useRef<readonly string[]>(restoredStateRef.current?.messageIds ?? [])
  const firstItemIndexRef = useRef(restoredStateRef.current?.firstItemIndex ?? TRANSCRIPT_FIRST_ITEM_BASE)
  const firstItemIndex = nextTranscriptFirstItemIndex(firstItemIndexRef.current, previousIdsRef.current, ids)
  firstItemIndexRef.current = firstItemIndex
  previousIdsRef.current = ids
  const idsRef = useRef(ids)
  idsRef.current = ids
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  const setVirtuosoHandle = useCallback((handle: VirtuosoHandle | null) => {
    const previous = virtuosoRef.current
    if (!handle && previous && stateKey && typeof previous.getState === 'function') {
      const capturedIds = [...idsRef.current]
      const capturedFirstItemIndex = firstItemIndexRef.current
      previous.getState(snapshot => rememberTranscriptState(stateKey, {
        messageIds: capturedIds,
        firstItemIndex: capturedFirstItemIndex,
        snapshot,
      }))
    }
    virtuosoRef.current = handle
    assignForwardedVirtuosoRef(ref, handle)
  }, [ref, stateKey])
  return <div className="message-list" data-testid="message-scroll"><Virtuoso
    ref={setVirtuosoHandle}
    data={messages}
    firstItemIndex={firstItemIndex}
    computeItemKey={transcriptItemKey}
    initialTopMostItemIndex={restoredStateRef.current ? undefined : { index: 'LAST', align: 'end' }}
    restoreStateFrom={restoredStateRef.current?.snapshot}
    followOutput={() => active && shouldFollow() ? 'auto' : false}
    atBottomStateChange={onAtBottom}
    startReached={onLoadOlder}
    totalListHeightChanged={onListHeightChanged}
    alignToBottom
    itemContent={(index, message) => {
      const dataIndex = transcriptDataIndex(index, firstItemIndex)
      const next = messages[dataIndex + 1]
      const isTurnEnd = message.role === 'user' || (!message.streaming && (!next || next.role !== 'assistant'))
      const previousUserIndex = message.role === 'assistant' ? findPreviousUserMessageIndex(messages, dataIndex) : null
      const previousUser = previousUserIndex === null ? undefined : messages[previousUserIndex]
      return <MessageView message={message} showFooter={isTurnEnd} documentBasePath={documentBasePath} onOpenDocument={onOpenDocument} onOpenSubagents={onOpenSubagents} onChoose={onChoose} onDraftOverride={onDraftOverride} onBranch={onBranch} branchMessageIds={branchMessageIds} branchDisabled={branchDisabled} onIllustrate={onIllustrate} illustrateDisabled={illustrateDisabled} illustration={illustrations?.get(message.id)} actionWords={actionWords} onCopy={onCopy} onResend={onResend} resendDisabled={resendDisabled} copied={copiedId === message.id} canJump={previousUser != null} onJump={previousUserIndex === null || !previousUser ? undefined : () => onJump(previousUserIndex, previousUser.id)} />
    }}
  /></div>
}))

function messageTime(timestamp?: number): string { if (!timestamp) return ''; const date = new Date(timestamp); const pad = (value: number) => String(value).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}` }

export const MessageView = memo(function MessageView({ message, showFooter, documentBasePath, onOpenDocument, onOpenSubagents, onChoose, onDraftOverride, onCopy, onResend, resendDisabled, copied, onBranch, branchMessageIds, branchDisabled, onIllustrate, illustrateDisabled, illustration, actionWords, canJump = false, onJump }: { message: ChatMessage; showFooter?: boolean; copied?: boolean; canJump?: boolean; onJump?: () => void; illustration?: IllustrationState } & DocumentOpenProps & SubagentOpenProps & PresentationActionProps & Omit<MessageActionHandlers, 'copiedId' | 'illustrations'>) {
  const signal = message.role === 'user' ? parseInternalUserSignal(message.content) : null
  const marked = (message.presentation?.details as {marked_text?:string})?.marked_text
  const copyMessage = marked ? {...message, content:withoutMechanicsMarkers(marked)} : message
  const copyDisabled = !copyMessage.content.trim()
  const canBranch = Boolean(onBranch && branchMessageIds?.has(message.id))
  // §35: illustration is a narration affordance — assistant prose rows only, settled ones
  // (never a live stream). Mechanics turns are presentation rows whose prose is the marked
  // text, so the check rides the same content Copy uses, not the renderer kind.
  const canIllustrate = Boolean(onIllustrate && message.role === 'assistant' && !message.streaming && copyMessage.content.trim())
  const illustrationNode = illustration && message.role === 'assistant' ? <IllustrationMount state={illustration} words={actionWords} /> : undefined
  const copy = () => { void onCopy(copyMessage).catch(() => undefined) }
  const time = showFooter && message.timestamp ? <time className="message-time" dateTime={new Date(message.timestamp).toISOString()}>{messageTime(message.timestamp)}</time> : null
  const alignment = message.role === 'user' ? 'trailing' : 'leading'
  const actions = (showFooter || canBranch || canIllustrate) && !signal ? <MessageActionBar onBranch={canBranch ? () => onBranch?.(message) : undefined} branchDisabled={branchDisabled} onIllustrate={canIllustrate ? () => onIllustrate?.(message) : undefined} illustrateBusy={illustration?.status === 'busy'} illustrateDisabled={illustrateDisabled} words={actionWords} alignment={alignment} canCopy canResend={message.role === 'user' && Boolean(message.content.trim())} canJump={canJump && !canBranch && message.role === 'assistant'} copyDisabled={copyDisabled} resendDisabled={resendDisabled} onCopy={copy} onResend={() => onResend(message)} onJump={onJump} copied={copied} /> : null
  const footer = actions || time ? <div className="message-footer">{time}{actions}</div> : null
  if (message.presentation) return <><PresentationEntry message={message} illustration={illustrationNode} onChoose={onChoose} onDraftOverride={onDraftOverride} />{marked && <div className="message presentation-footer">{footer}</div>}</>
  if (message.role === 'compaction') return <CompactionDivider message={message} />
  if (message.role === 'user') return signal ? <article className="message user-message subagent-signal-message"><div className="subagent-signal-stack"><SubagentSignalCard content={message.content} documentBasePath={documentBasePath} onOpenDocument={onOpenDocument} />{time}</div></article> : <article className="message user-message" data-user-prompt={message.id}><div className="user-message-stack"><UserMessageBubble text={message.content} images={message.images} /></div>{footer}</article>
  if (message.role === 'tool') { const notice = parseSubagentNotice(message.content); return notice ? <article className="message assistant-message"><CollapsibleActivityCard kind="result" label="子任务" summary={notice.name} meta={`${notice.ok ? '成功' : '失败'} · ${notice.cost}`} error={!notice.ok}><pre><TruncatedText text={message.content} /></pre></CollapsibleActivityCard>{footer}</article> : <article className="system-message tool-message"><div><TruncatedText text={message.content} /></div>{footer}</article> }
  return <article className="message assistant-message"><AssistantTranscriptContent message={message} onOpenSubagents={onOpenSubagents} documentBasePath={documentBasePath} onOpenDocument={onOpenDocument} illustration={illustrationNode} />{footer}</article>
})

function IllustrationMount({ state, words }: { state: IllustrationState; words?: Record<string,string> }) {
  if (state.status === 'ready' && state.image) return <figure className="message-illustration" data-testid="message-illustration"><img src={state.image} alt={words?.illustrate ?? '生成插画'} /></figure>
  if (state.status === 'busy') return <div className="message-illustration is-busy" data-testid="message-illustration" role="status" aria-label={words?.illustrating ?? '生成插画中…'} />
  return <div className="message-illustration is-error" data-testid="message-illustration"><span className="message-illustration-error">{words?.illustrate_failed ?? '插画生成失败'}</span></div>
}

/**
 * The one caption this file owes a COC player, from the presentation's own `ui` block (§23).
 *
 * A presentation that carries no `ui` gets an ellipsis rather than a sentence: the words for a
 * language nobody has chosen yet are worse than no words. A `ui` that carries no such key gets the
 * key, which is a gap a player can report.
 */
function presentationWord(details: unknown, surface: string, key: string): string {
  const words=(details as {ui?:{words?:Record<string,Record<string,string>>}})?.ui?.words
  if(!words)return '…'
  const word=words[surface]?.[key]
  return typeof word==='string'?word:key
}

function PresentationEntry({message,illustration,onChoose,onDraftOverride}:{message:ChatMessage;illustration?:ReactNode}&PresentationActionProps) {
  useToolRenderers()
  const data=message.presentation!
  if(data.renderer==='coc-character-draft')return <article className="message assistant-message"><CocCharacterDraft data={data.details as any} onPresentation={onChoose?async()=>await onChoose(data,'presentation') as any:undefined} onRendered={onChoose?async()=>{await onChoose(data,'previewed')}:undefined} onOverride={onDraftOverride?async(request)=>await onDraftOverride(data,request):undefined}/></article>
  const render=getToolRenderer(data.renderer)?.render
  return <article className="message assistant-message" data-presentation={data.renderer}>
    {illustration}
    {render ? render({tool:{id:message.id,name:data.renderer,input:'',startedAt:0,finished:true},content:'',details:data.details,onSelectOption:onChoose?async(option)=>{await onChoose(data,option)}:undefined,elapsed:()=>''}) : <p role="status">{presentationWord(data.details,'transcript','loading')}</p>}
  </article>
}

export function CompactionDivider({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false)
  const summary = message.content.trim()
  return (
    <div className="compaction-divider" data-testid="compaction-divider" data-compaction-id={message.id}>
      <div className="compaction-divider-rule" aria-hidden="true" />
      <button type="button" className="compaction-divider-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        上下文已压缩
        <span className="compaction-divider-hint">{open ? '收起摘要' : '查看摘要'}</span>
      </button>
      {open && <div className="compaction-divider-summary" data-testid="compaction-summary">{summary || '本次压缩未留下摘要。'}</div>}
    </div>
  )
}
