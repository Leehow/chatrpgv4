import { CocOnboarding } from './CocOnboarding'
import { CocGameIntro } from './CocGameIntro'
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { PlanApprovalBar } from './PlanApprovalBar'
import { makeSubagentStatusCheckPrompt } from './subagent-status-check'
import { composerDocumentName, consumeFileDropEvent, DEFAULT_COMPOSER_DOCUMENT_PROMPT, fileDragHasFiles, filterSupportedDocumentPaths, ignoreComposerFileDrag, supportedDocumentPathsFromFiles } from './document-drop'
import { resolveThinkingLevel, thinkingLevelsForHydratedModel, thinkingLevelsForModel, TRANSPORT_DISCONNECTED } from '@pipi/host-api'
import type { AgentSummary, ExtensionDescriptor, HistoryEntry, Model, ModelState, PipiHostAPI, Project, PromptAttachment, Session, SessionLease, SessionPreloadSnapshot, StreamEvent, TerminalEvent, TerminalSession, ThinkingLevel, TurnTelemetryRendererSample } from '@pipi/host-api'
import { ModelVisibilityModal } from './ModelVisibilityModal'
import { EXT_CONFIRM_SLOT_ID, ExtensionUiHost } from './ExtensionUiHost'
import { RemoteConnectionPanel } from './RemoteConnectionPanel'
import { SubagentModelModal } from './SubagentModelModal'
import { createMockHost } from './mock-host'
import { SESSION_ORDER_VERSION } from './session-order'
import { ModelQuickMenu } from './ModelQuickMenu'
import { ProviderLogo } from './ProviderLogo'
import { type ProjectMenuAction, type ProjectMenuUnavailable, type SidebarProject, type SidebarProps, type SidebarSession, type SessionStatus } from './Sidebar'
import { BaseWorkbenchProvider } from './base-workbench-adapter'
import { WorkbenchRegion } from './workbench/WorkbenchRegion'
import { createProductWorkbenchRuntime, ProductWorkbenchProvider, type ProductWorkbenchRuntime, useActiveWorkbenchPlan, useProductExtensionEnabled, useProductWorkbenchRuntime } from './workbench/workbench-runtime'
import { useHeaderActions } from './workbench/header-actions'
import { SlashMenu } from './SlashMenu'
import { ThinkingChip } from './thinking-chip'
import type { WaitingPhase } from './WaitingPlaceholder'
import { StreamEventCoalescer } from './StreamEventCoalescer'
import { freezeProbe, freezeProbeHistoryIpcEnd, freezeProbeHistoryIpcStart } from './freeze-probe'
import { QuotaPill } from './QuotaPill'
import { SessionBranchHeader } from './session-workspace-ui'
import { subscribeExt } from './subscribe-ext'
import { BalancePill } from './BalancePill'
import { SessionStatsPill } from './SessionStatsPill'
import { MessageQueue } from './MessageQueue'
import { useSessionQueue } from './useSessionQueue'
import { InlineSessionTitleEditor } from './InlineSessionTitleEditor'
export { parseSubagentNotice } from './subagent-notice'
import { compactionNotice, compactionPillLabel } from './compaction-notice'
import { applySlashPrompt, filterSlashCommands, parseSlashInvocation, planPromptFromArgs, selfdevPromptFromArgs, slashCommandByName, slashPaletteQuery, useSlashCommands, type SlashCommandDef } from './slash-commands'
import { useDeclarativeContributionLoader } from './contribution-loader'
import { DEFAULT_PANEL_TAB, DOCUMENT_PANEL_TAB, usePanels, type PanelRailContext, type PanelTab } from './ui-registries'
import { useModelVisibility, type ModelVisibilityController } from './useModelVisibility'
import { useUpdateCenter } from './useUpdateCenter'
import { chatImagesFromAttachments, fileToPromptAttachment, filesFromClipboard, imageFilesFromClipboard, imageFilesFromFileList, stripAttachmentPathsForDisplay, validateAttachment } from './attachments'
import { composerInputFilesFromList, DEFAULT_COMPOSER_INPUT_FILES_PROMPT, EMPTY_INPUT_FILE_GATE, InputFileAttachments, modelHasInputFiles, type InputFileAttachmentsHandle, type InputFileGate } from './InputFileAttachments'
import { LiveSubagentBindingProvider } from './LiveSubagentBinding'
import { Transcript, type IllustrationState } from './Transcript'
import { EmptySetupGuide } from './EmptySetupGuide'
import { parseSubagentSignal } from './subagent-signal'
import { appendLiveUserMessage, applySecretRedact, applyStreamEvent, assistantEndedAwaitingModel, assistantLooksSettled, finishStreamingMessage, reopenAssistantForNextCompletion, reconcileHistorySnapshot, transcriptFingerprint, withoutMechanicsMarkers, type ChatMessage } from './transcript-model'
import { DismissibleError } from './DismissibleError'
import { displaySecretPlaceholders } from './secret-display'
import { toolDisplaySummary } from './tool-summary'
import { useExtensionThemeSync } from './theme-contribution-loader'
import { installThemeCss } from './theme-css'
import { useShellTheme } from './useShellTheme'
import './app.css'
import './message-actions.css'
import './subagent.css'

// Install runtime-generated theme token rules (core + extension packs) before
// the first render; first paint itself is covered by the index.html boot cache.
installThemeCss()

type PaneWidths = { sidebar: number; tools: number; browserTools: number; sidebarCollapsed: boolean; toolsCollapsed: boolean }
type SidebarPreferences = { expandedIds: string[]; pinnedSessionIds: string[]; archivedSessionIds: string[]; archivedSessionTimestamps?: Record<string, number>; visibleLimit: number }
type SessionWithSidebarMetadata = Session & { provider?: unknown; modelId?: unknown; modelRef?: unknown; model?: unknown }
type RuntimeSessionLease = SessionLease & { canWrite?: unknown; ownerLabel?: unknown }
type LazySessionPageState = { nextCursor?: string; hasMore: boolean; loading: boolean }

/** Accept both the current host-api shape and lease payloads from older running Electron hosts.
 *  `null` means the lease has not loaded yet. The composer is already writable in that
 *  state (`leaseReadOnly` only locks after a loaded non-writable lease), so send must
 *  match — otherwise the first click after mount silently no-ops. */
export function leaseCanWrite(lease: SessionLease | null): boolean {
  if (!lease) return true
  const runtime = lease as RuntimeSessionLease
  if (typeof runtime.canWrite === 'boolean') return runtime.canWrite
  return lease.writable === true
}

export function leaseOwnerLabel(lease: SessionLease | null): string {
  if (!lease) return '另一客户端'
  const runtime = lease as RuntimeSessionLease
  if (typeof runtime.ownerLabel === 'string' && runtime.ownerLabel.trim()) return runtime.ownerLabel.trim()
  return lease.holder?.holder || '另一客户端'
}

export const PANE_HANDLE_TRACKS = 12
export const CHAT_MIN_WIDTH = 360
export const BROWSER_TOOLS_MIN = 320
export const BROWSER_TOOLS_PREFERRED_MIN = 520
export const BROWSER_TOOLS_MAX = 920

/** Shrink a remembered/preferred browser pane so the chat column stays usable.
 *  An overflowing --tools-w is clipped by CSS, but the native WebContentsView
 *  still paints the unclipped rect and covers the transcript. */
export function fitBrowserToolsWidth(viewportWidth: number, sidebar: number, requested: number): number {
  const maxFit = viewportWidth - sidebar - PANE_HANDLE_TRACKS - CHAT_MIN_WIDTH
  const ceiling = Math.min(BROWSER_TOOLS_MAX, Math.max(BROWSER_TOOLS_MIN, maxFit))
  const floor = Math.min(BROWSER_TOOLS_PREFERRED_MIN, ceiling)
  return clamp(requested, floor, ceiling)
}

function initialBrowserToolsWidth(sidebar = 258): number {
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  const preferred = Math.round((viewportWidth - sidebar - PANE_HANDLE_TRACKS) * 0.58)
  return fitBrowserToolsWidth(viewportWidth, sidebar, preferred)
}
const defaultWidths: PaneWidths = { sidebar: 258, tools: 368, browserTools: initialBrowserToolsWidth(), sidebarCollapsed: false, toolsCollapsed: false }
const storageKey = 'pipiui:eui-pane-widths'
const sidebarPreferencePrefix = 'pipiui:eui:sidebar:v1'
const sidebarSemanticMigrationKey = 'pipiui:eui:sidebar-semantic-host:v1'
export const LAST_SESSION_STORAGE_KEY = 'pipiui:eui:last-session:v1'
const TOOL_QUICK_RAIL_COLLAPSED_KEY = 'pipiui:eui:tool-quick-rail-collapsed:v1'
const HISTORY_PAGE_SIZE = 500

/** Only measurements cross the renderer→host telemetry boundary; never bodies or paths. */
function base64ByteLength(value: string): number | undefined {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return undefined
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

function createRendererTurnTelemetry(prompt: string, attachmentCount: number, documentCount: number): TurnTelemetryRendererSample {
  const submittedAt = Date.now()
  return {
    turnId: `turn-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
    submittedAt,
    promptBytes: new TextEncoder().encode(prompt).byteLength,
    attachmentCount,
    documentCount,
  }
}

function finishRendererPreflight(telemetry: TurnTelemetryRendererSample, attachments?: PromptAttachment[]): void {
  telemetry.attachmentBytes = attachments
    ?.map(attachment => base64ByteLength(attachment.dataBase64))
    .reduce<number | undefined>((total, bytes) => total === undefined || bytes === undefined ? undefined : total + bytes, 0)
  telemetry.preflightEndedAt = Date.now()
}

export const SIDEBAR_PROJECT_PAGE_SIZE = 6
export const ARCHIVE_RETENTION_MS = 24 * 60 * 60 * 1000
const ARCHIVE_CLEANUP_RETRY_MS = 60 * 1000

/** Workspace scope is derived from project paths; localStorage itself is renderer-profile (user) scoped. */
export function sidebarPreferencesKey(projects: readonly Project[]): string {
  const workspace = projects.map(project => project.path || project.id).sort().join('\u0000') || 'empty-workspace'
  let hash = 2_166_136_261
  for (let index = 0; index < workspace.length; index += 1) {
    hash ^= workspace.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return `${sidebarPreferencePrefix}:${(hash >>> 0).toString(36)}`
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function timestampRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] =>
    Boolean(entry[0]) && typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0
  ))
}

/** Keep only live archive keys; legacy archives start a fresh retention window. */
export function normalizeArchiveTimestamps(archivedSessionIds: readonly string[], timestamps: Record<string, number> | undefined, now = Date.now()): Record<string, number> {
  const source = timestampRecord(timestamps)
  return Object.fromEntries(archivedSessionIds.map(id => [id, source[id] ?? now]))
}

export function expiredArchivedSessionIds(archivedSessionIds: readonly string[], timestamps: Record<string, number>, now = Date.now()): string[] {
  return archivedSessionIds.filter(id => now - timestamps[id] >= ARCHIVE_RETENTION_MS)
}

function isUnknownSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /^unknown session(?:\s|$)/.test(message)
}

function readSidebarPreferences(key: string): SidebarPreferences | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const candidate = value as { expandedIds?: unknown; pinnedSessionIds?: unknown; archivedSessionIds?: unknown; archivedSessionTimestamps?: unknown; visibleLimit?: unknown }
    const visibleLimit = typeof candidate.visibleLimit === 'number' && Number.isFinite(candidate.visibleLimit)
      ? Math.max(1, Math.floor(candidate.visibleLimit))
      : SIDEBAR_PROJECT_PAGE_SIZE
    return { expandedIds: stringArray(candidate.expandedIds), pinnedSessionIds: stringArray(candidate.pinnedSessionIds), archivedSessionIds: stringArray(candidate.archivedSessionIds), archivedSessionTimestamps: timestampRecord(candidate.archivedSessionTimestamps), visibleLimit }
  } catch { return null }
}

function writeSidebarPreferences(key: string, preferences: SidebarPreferences) {
  try { localStorage.setItem(key, JSON.stringify(preferences)) } catch { /* storage can be disabled by the host */ }
}

function readLastSessionSelection(): { projectId: string; sessionId: string } | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LAST_SESSION_STORAGE_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const candidate = value as { projectId?: unknown; sessionId?: unknown }
    return typeof candidate.projectId === 'string' && candidate.projectId && typeof candidate.sessionId === 'string' && candidate.sessionId
      ? { projectId: candidate.projectId, sessionId: candidate.sessionId }
      : null
  } catch {
    try { localStorage.removeItem(LAST_SESSION_STORAGE_KEY) } catch { /* storage can be disabled by the host */ }
    return null
  }
}

function metadataString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Read optional future session metadata without widening the host-api v2 contract. */
export function sidebarModelForSession(session: Session, selectedSessionId: string, currentModel: Model | null, knownModels?: Readonly<Record<string, { provider: string; modelId?: string }>>): { provider: string; modelId?: string } {
  // The selected row mirrors the live composer model state: a mid-session model
  // switch updates modelState instantly while the sessions metadata (listSessions
  // snapshot / JSONL model_change) lags, so the live state must win here or the
  // sidebar keeps advertising the pre-switch model.
  if (session.id === selectedSessionId && currentModel) {
    return { provider: currentModel.provider, modelId: currentModel.id }
  }
  const known = knownModels?.[session.id]
  if (known?.provider) return { provider: known.provider, modelId: known.modelId }
  const metadata = session as SessionWithSidebarMetadata
  let provider = metadataString(metadata.provider)
  let modelId = metadataString(metadata.modelId)
  const nested = metadata.model
  if (nested && typeof nested === 'object') {
    const model = nested as { provider?: unknown; id?: unknown; modelId?: unknown }
    provider ??= metadataString(model.provider)
    modelId ??= metadataString(model.id) ?? metadataString(model.modelId)
  }
  const modelRef = metadataString(metadata.modelRef) ?? (typeof nested === 'string' ? metadataString(nested) : undefined)
  if (modelRef) {
    const slash = modelRef.indexOf('/')
    if (slash > 0) {
      provider ??= modelRef.slice(0, slash)
      modelId ??= modelRef.slice(slash + 1) || undefined
    } else modelId ??= modelRef
  }
  return { provider: provider ?? '', modelId }
}

/** Build an immediate display snapshot from listSessions metadata. */
function modelStateFromSession(session: Session | undefined, catalog: readonly Model[]): ModelState | null {
  if (!session) return null
  const ref = sidebarModelForSession(session, '', null)
  if (!ref.provider || !ref.modelId) return null
  const known = catalog.find(model => model.provider === ref.provider && model.id === ref.modelId)
  const model: Model = known ?? { provider: ref.provider, id: ref.modelId, name: ref.modelId }
  return {
    model,
    thinkingLevel: 'off',
    availableThinkingLevels: thinkingLevelsForModel(model)
  }
}

/** Replace provisional/cached session capability data once the authenticated catalog is ready. */
function reconcileModelStateWithCatalog(state: ModelState, catalog: readonly Model[]): ModelState {
  const known = catalog.find(model => model.provider === state.model.provider && model.id === state.model.id)
  if (!known) return state
  const availableThinkingLevels = thinkingLevelsForHydratedModel(known, state.availableThinkingLevels)
  return {
    ...state,
    model: known,
    thinkingLevel: resolveThinkingLevel(state.thinkingLevel, availableThinkingLevels) ?? state.thinkingLevel,
    availableThinkingLevels,
  }
}

function fallbackModelIfMissing(state: ModelState, catalog: readonly Model[]): { state: ModelState; fellBack: boolean } {
  if (catalog.length === 0) return { state, fellBack: false }
  const known = catalog.find(model => model.provider === state.model.provider && model.id === state.model.id)
  if (known) {
    const availableThinkingLevels = thinkingLevelsForHydratedModel(known, state.availableThinkingLevels)
    return {
      state: {
        ...state,
        model: known,
        thinkingLevel: resolveThinkingLevel(state.thinkingLevel, availableThinkingLevels) ?? state.thinkingLevel,
        availableThinkingLevels,
      },
      fellBack: false,
    }
  }
  const next = catalog[0]
  return {
    state: {
      model: next,
      thinkingLevel: resolveThinkingLevel(state.thinkingLevel, thinkingLevelsForModel(next)) ?? 'off',
      availableThinkingLevels: thinkingLevelsForModel(next),
    },
    fellBack: true,
  }
}

/** Swift-style priority: live activity (selected streaming / observed running / running subagents)
 *  > terminal agent attention badges (failed/stalled/interrupted)
 *  > observed terminal status > completed > idle.
 *  observed is live-updated for every session via `subscribeAllStreams` (older hosts stay selected-only).
 *  A leftover `running` on a non-selected row must not hide a background subagent badge. */
export function sidebarStatusForSession(sessionId: string, selectedSessionId: string, streaming: boolean, observedStatus: SessionStatus | undefined, agents: readonly AgentSummary[]): { status: SessionStatus; subagentCount?: number } {
  const selected = sessionId === selectedSessionId
  if (selected && (streaming || observedStatus === 'running')) return { status: 'running' }
  const linked = agents.filter(agent => agent.sessionId === sessionId)
  const runningCount = linked.filter(agent => agent.state === 'running').length
  if (runningCount > 0) return { status: 'subagents-running', subagentCount: runningCount }
  if (observedStatus === 'running') return { status: 'running' }
  // Selected session: the user is viewing it, so terminal-status notifications
  // (red dot) are consumed — only live activity (running / subagents) stays visible.
  if (selected) return { status: 'idle' }
  if (linked.some(agent => agent.state === 'failed')) return { status: 'failed' }
  if (linked.some(agent => agent.stalled || agent.state === 'stalled')) return { status: 'stalled' }
  if (linked.some(agent => agent.state === 'interrupted' || agent.state === 'aborted')) return { status: 'interrupted' }
  if (observedStatus && observedStatus !== 'idle') return { status: observedStatus }
  if (linked.some(agent => agent.state === 'ok')) return { status: 'completed' }
  return { status: 'idle' }
}

/** Global sidebar snapshot keeps session identity; transcripts receive only the selected slice.
 *  Rows are episodes ({sessionId, agentId, runId}): a second run of one agentId
 *  ADDS a sibling row instead of replacing, so a late terminal from a retired
 *  run cannot repaint the current run's row (and vice versa). Only legacy
 *  runId-less rows fall back to an agentId-level replace. */
export function mergeAgentSummary(current: AgentSummary[], incoming: AgentSummary): AgentSummary[] {
  const index = current.findIndex(agent => agent.agentId === incoming.agentId && (
    incoming.runId
      ? agent.runId === incoming.runId && (incoming.sessionId ? agent.sessionId === incoming.sessionId : true)
      : incoming.sessionId ? agent.sessionId === incoming.sessionId : true
  ))
  if (index < 0) return [...current, incoming]
  const previous = current[index]
  // Within ONE episode a reached terminal verdict must not be reopened by a
  // late running event or an older snapshot row captured before the verdict.
  const isTerminal = (agent: AgentSummary) => agent.state !== 'running' && agent.state !== 'stalled'
  if (isTerminal(previous) && !isTerminal(incoming)) return current
  const next = { ...incoming, sessionId: incoming.sessionId ?? previous.sessionId }
  return current.map((agent, candidate) => candidate === index ? next : agent)
}

/** Overlay live agent events on a listAgents snapshot so a stale/empty snapshot cannot drop a running row.
 *  Episode-scoped: observed rows replace only the snapshot row of the SAME run.
 *  A fresh snapshot terminal for a run whose end event was missed wins over the
 *  stale observed running row; rows of other runs are kept as siblings. */
export function mergeAgentSnapshot(current: AgentSummary[], snapshot: readonly AgentSummary[]): AgentSummary[] {
  return current.reduce((items, agent) => mergeAgentSummary(items, agent), snapshot.slice())
}

export interface SessionSnapshotMergeContext {
  titleRevisionsAtRequest: ReadonlyMap<string, number>
  currentTitleRevisions: ReadonlyMap<string, number>
  retainIds?: ReadonlySet<string>
}

/** Reconcile an authoritative list response without allowing an older request
 *  to roll back newer stream/local metadata already visible in the sidebar.
 *  Equal timestamps are ambiguous, so a response wins only when no title
 *  mutation happened after that exact request began. Without request context,
 *  preserving current remains the fail-safe default. */
export function mergeSessionSnapshot(
  current: readonly Session[],
  snapshot: readonly Session[],
  context?: SessionSnapshotMergeContext,
): Session[] {
  const currentById = new Map(current.map(session => [session.id, session]))
  const merged = snapshot.map(session => {
    const known = currentById.get(session.id)
    if (!known || known.updatedAt < session.updatedAt) return session
    if (known.updatedAt > session.updatedAt) return known
    if (!context) return known
    const requestRevision = context.titleRevisionsAtRequest.get(session.id) ?? 0
    const currentRevision = context.currentTitleRevisions.get(session.id) ?? 0
    return currentRevision > requestRevision ? known : session
  })
  if (!context?.retainIds?.size) return merged
  const listed = new Set(merged.map(session => session.id))
  const retained = current.filter(session => context.retainIds!.has(session.id) && !listed.has(session.id))
  return retained.length ? [...retained, ...merged] : merged
}

export function selectedSessionAgentSummaries(agents: readonly AgentSummary[], sessionId: string): AgentSummary[] {
  return agents.filter(agent => agent.sessionId === sessionId)
}

type SidebarDropPlacement = 'before' | 'after'

function movedIds(ids: string[], sourceId: string, targetId: string, placement: SidebarDropPlacement): string[] {
  if (sourceId === targetId) return ids
  const without = ids.filter(id => id !== sourceId)
  const target = without.indexOf(targetId)
  if (target < 0) return ids
  without.splice(target + (placement === 'after' ? 1 : 0), 0, sourceId)
  return without
}

/** Sessions sort by recency only. Manual drag order was removed in sessionOrderVersion 3. */
export function sessionsByActivityAndManualOrder<T extends Pick<Session, 'id' | 'updatedAt'>>(items: T[]): T[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt)
}

function readWidths(): PaneWidths {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '') as Partial<PaneWidths>
    return {
      sidebar: clamp(parsed.sidebar ?? defaultWidths.sidebar, 190, 440),
      tools: clamp(parsed.tools ?? defaultWidths.tools, 270, 620),
      browserTools: clamp(parsed.browserTools ?? initialBrowserToolsWidth(parsed.sidebar ?? defaultWidths.sidebar), BROWSER_TOOLS_PREFERRED_MIN, BROWSER_TOOLS_MAX),
      sidebarCollapsed: parsed.sidebarCollapsed === true,
      toolsCollapsed: parsed.toolsCollapsed === true
    }
  } catch { return defaultWidths }
}
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)) }
function elapsed(startedAt: number) { return `${Math.max(0, Math.round((Date.now() - startedAt) / 1000))}s` }

/** Hidden-inset macOS chrome only applies inside the Electron shell. */
export function isElectronChrome(): boolean {
  return typeof navigator !== 'undefined' && /Electron/.test(navigator.userAgent)
}

/** Swift parity: below 720pt the sidebar collapses and the right pane becomes an overlay. */
const NARROW_VIEWPORT_QUERY = '(max-width: 720px)'
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() => {
    const media = typeof window === 'undefined' ? undefined : window.matchMedia?.(NARROW_VIEWPORT_QUERY)
    return media ? media.matches : false
  })
  useEffect(() => {
    const media = typeof window === 'undefined' ? undefined : window.matchMedia?.(NARROW_VIEWPORT_QUERY)
    // Some test/embedding hosts answer every query from one shared matchMedia
    // stub; only subscribe when the object is really ours.
    if (!media || (media.media && media.media !== NARROW_VIEWPORT_QUERY)) return
    const update = (event: MediaQueryListEvent) => setNarrow(event.matches)
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
  return narrow
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => typeof window === 'undefined' ? 1280 : window.innerWidth)
  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return width
}

export function App({ host: injectedHost }: { host?: PipiHostAPI }) {
  const productWorkbenchRuntimeRef = useRef<ProductWorkbenchRuntime | null>(null)
  const productWorkbenchRuntime = productWorkbenchRuntimeRef.current ?? (productWorkbenchRuntimeRef.current = createProductWorkbenchRuntime())
  return <ProductWorkbenchProvider runtime={productWorkbenchRuntime}><AppContent host={injectedHost} /></ProductWorkbenchProvider>
}

function AppContent({ host: injectedHost }: { host?: PipiHostAPI }) {
  const { theme, scheme: themeScheme, toggleTheme } = useShellTheme()
  const productWorkbench = useProductWorkbenchRuntime()
  // Do not allocate a default mock during every render: its changing identity
  // re-ran all host effects on each composer keystroke.
  const mockHost = useRef<PipiHostAPI>()
  const host = injectedHost ?? (mockHost.current ??= createMockHost())
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedProject, setSelectedProject] = useState('')
  const [defaultProductPanel, setDefaultProductPanel] = useState<PanelTab>(DEFAULT_PANEL_TAB)
  // One extension list drives both the contributions and the shell: the enabled
  // extension that declares `app.ui.layout` is this project's form, and every
  // enabled id is what may show its contributions. Applying REPLACES the whole
  // plan in one emit (store.apply and applyActiveExtensionIds both overwrite),
  // so switching projects never drops the shell to empty in between.
  const applyWorkbenchFromExtensions = useCallback((extensions: readonly ExtensionDescriptor[]) => {
    const enabled = extensions.filter(item => item.state === 'enabled')
    const pack = enabled.find(item => item.ui?.layout)
    const enabledIds = enabled.map(item => item.id)
    const sidebar = pack?.ui?.layout?.auxiliarySidebar
    setDefaultProductPanel(sidebar && pack?.ui?.panels?.some(panel => panel.id === sidebar) ? sidebar : DEFAULT_PANEL_TAB)
    if (pack) productWorkbench.activateProductPack({ id: pack.id, layout: pack.ui?.layout }, enabledIds)
    else productWorkbench.activateBaseWorkbench(enabledIds)
  }, [productWorkbench])
  useDeclarativeContributionLoader(host, selectedProject || undefined, applyWorkbenchFromExtensions)
  useExtensionThemeSync(host, selectedProject || undefined)
  const [timeline, setTimeline] = useState<any>(null)
  const [timelineRefresh, setTimelineRefresh] = useState(0)
  const [branchBusy, setBranchBusy] = useState(false)
  const [timelineNavigation, setTimelineNavigation] = useState<{sessionId:string; messageId:string; nonce:number} | null>(null)
  const [selectedSession, setSelectedSession] = useState('')
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const sessionTitleRevisionByIdRef = useRef(new Map<string, number>())
  const sessionListGenerationByProjectRef = useRef(new Map<string, number>())
  const beginSessionListRequest = useCallback((projectId: string) => {
    const generation = (sessionListGenerationByProjectRef.current.get(projectId) ?? 0) + 1
    sessionListGenerationByProjectRef.current.set(projectId, generation)
    return { generation, titleRevisions: new Map(sessionTitleRevisionByIdRef.current) }
  }, [])
  const isCurrentSessionListRequest = useCallback((projectId: string, generation: number) => (
    sessionListGenerationByProjectRef.current.get(projectId) === generation
  ), [])
  const markSessionTitleMutation = useCallback((sessionId: string) => {
    const revisions = sessionTitleRevisionByIdRef.current
    revisions.set(sessionId, (revisions.get(sessionId) ?? 0) + 1)
  }, [])
  const selectedProjectRef = useRef(selectedProject)
  selectedProjectRef.current = selectedProject
  const selectedSessionRef = useRef(selectedSession)
  selectedSessionRef.current = selectedSession
  const restoredLastSessionRef = useRef(false)
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const [lazyStartupReady, setLazyStartupReady] = useState(() => !host.listSessionPage)
  const [lazySessionPages, setLazySessionPages] = useState<Record<string, LazySessionPageState>>({})
  const lazySessionPagesRef = useRef(lazySessionPages)
  lazySessionPagesRef.current = lazySessionPages
  const lazyPageLoadsRef = useRef(new Set<string>())
  const [sidebarSessionIdsByProject, setSidebarSessionIdsByProject] = useState<Record<string, string[]>>({})
  const [lazyVisibleSessionLimits, setLazyVisibleSessionLimits] = useState<Record<string, number>>({})
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [modelState, setModelState] = useState<ModelState | null>(null)
  const modelStatesBySessionRef = useRef(new Map<string, ModelState>())
  const modelWriteGenRef = useRef(0)
  const [sessionModels, setSessionModels] = useState<Record<string, { provider: string; modelId?: string }>>({})
  const rememberSessionModel = (sessionId: string, model: Model) => {
    if (!sessionId || !model.provider || !model.id) return
    setSessionModels(current => {
      const previous = current[sessionId]
      if (previous?.provider === model.provider && previous.modelId === model.id) return current
      return { ...current, [sessionId]: { provider: model.provider, modelId: model.id } }
    })
  }
  const draftsBySessionRef = useRef(new Map<string, string>())
  /** Unsent composer image attachments per session; cleared on send or when the list empties. */
  const attachmentsBySessionRef = useRef(new Map<string, ComposerAttachment[]>())
  /** Unsent composer document chips per session; cleared on send or when the list empties. */
  const documentsBySessionRef = useRef(new Map<string, ComposerDocument[]>())
  const [streaming, setStreaming] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [compactingLabel, setCompactingLabel] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [statsRefreshKey, setStatsRefreshKey] = useState(0)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const [waitingStartedAt, setWaitingStartedAt] = useState<number | null>(null)
  const [waitingVisible, setWaitingVisible] = useState(false)
  const [waitingPhase, setWaitingPhase] = useState<WaitingPhase>('awaiting')
  const [waitingDetail, setWaitingDetail] = useState<string | undefined>(undefined)
  const [modsProgress, setModsProgress] = useState<string | undefined>(undefined)
  const [stoppingSessionId, setStoppingSessionId] = useState<string | null>(null)
  const [stopError, setStopError] = useState<{ sessionId: string; message: string } | null>(null)
  const [lease, setLease] = useState<SessionLease | null>(null)
  const [activeTab, setActiveTab] = useState<PanelTab>(DEFAULT_PANEL_TAB)
  const [toolReturnTab, setToolReturnTab] = useState<PanelTab | null>(null)
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const activeTabBySessionRef = useRef<Record<string, PanelTab>>({})
  const applyActiveTab = useCallback((tab: PanelTab) => {
    const sessionId = selectedSessionRef.current
    if (sessionId) activeTabBySessionRef.current[sessionId] = tab
    setActiveTab(tab)
  }, [])
  const rememberToolReturn = useCallback((tab: PanelTab) => {
    const current = activeTabRef.current
    if (tab !== current) setToolReturnTab(tab === 'Subagents' ? null : current)
    applyActiveTab(tab)
  }, [applyActiveTab])
  // Keyed by session like the terminals: the right panel belongs to one
  // conversation, so switching sessions must not leave the previous session's
  // document open in the reader.
  /** Per session: document tabs in open order plus the active one. */
  const [openedDocuments, setOpenedDocuments] = useState<Record<string, { paths: string[]; active: string | null }>>({})
  const [announcedTerminals, setAnnouncedTerminals] = useState<Record<string, TerminalSession>>({})
  const [revealedTerminalIds, setRevealedTerminalIds] = useState<Record<string, string>>({})
  const [widths, setWidths] = useState<PaneWidths>(readWidths)
  const viewportWidth = useViewportWidth()
  const narrowViewport = useNarrowViewport()
  // Narrow-viewport override (not persisted): both panes start collapsed and the
  // header toggles / quick rail flip these to show the panes as overlays.
  const [narrowPanes, setNarrowPanes] = useState<{ sidebar: boolean; tools: boolean }>({ sidebar: false, tools: false })
  const [subagentsRunningCount, setSubagentsRunningCount] = useState(0)
  const subagentRunEpochRef = useRef({ sessionId: '', count: 0, turnEpoch: 0 })
  /** Turn-start anchor for the background-subagent tail indicator (phase=tool, no stop). */
  const [subagentWaitingStartedAt, setSubagentWaitingStartedAt] = useState<number | null>(null)
  const [sidebarExpandedIds, setSidebarExpandedIds] = useState<string[]>([])
  const [pinnedSessionIds, setPinnedSessionIds] = useState<string[]>([])
  const [archivedSessionIds, setArchivedSessionIds] = useState<string[]>([])
  const [archivedSessionTimestamps, setArchivedSessionTimestamps] = useState<Record<string, number>>({})

  const [sidebarVisibleLimit, setSidebarVisibleLimit] = useState(SIDEBAR_PROJECT_PAGE_SIZE)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [sidebarAgents, setSidebarAgents] = useState<AgentSummary[]>([])
  // Latest committed transcript for the stream effect's first-response-wait
  // decisions. Read via ref so the subscription closure never goes stale (that
  // effect does not re-run per message).
  const messagesRef = useRef<ChatMessage[]>(messages)
  messagesRef.current = messages
  const messagesBySessionRef = useRef(new Map<string, ChatMessage[]>())
  const historyEntriesBySessionRef = useRef(new Map<string, HistoryEntry[]>())
  const historyCursorBySessionRef = useRef(new Map<string, string>())
  const historyOlderLoadInFlightRef = useRef(new Set<string>())
  const historyCompleteBySessionRef = useRef(new Map<string, boolean>())
  const preloadedSessionDetailsRef = useRef(new Map<string, SessionPreloadSnapshot>())
  const historyFingerprintBySessionRef = useRef(new Map<string, string>())
  const historySettledReplacementRef = useRef(new Map<string, { fingerprint: string; liveRevision: number }>())
  const locallyCreatedSessionIdsRef = useRef(new Set<string>())
  const skippedInitialEmptyHistoryRef = useRef(new Set<string>())
  const transcriptLiveRevisionRef = useRef(0)
  const mutateLocalTranscript = useCallback((mutation: (current: ChatMessage[]) => ChatMessage[]) => {
    const current = messagesRef.current
    const next = mutation(current)
    if (next === current) return current
    transcriptLiveRevisionRef.current += 1
    messagesRef.current = next
    const sessionId = selectedSessionRef.current
    if (sessionId) messagesBySessionRef.current.set(sessionId, next)
    setMessages(next)
    return next
  }, [])
  useEffect(() => {
    if (selectedSession && messagesBySessionRef.current.has(selectedSession)) {
      messagesBySessionRef.current.set(selectedSession, messages)
    }
  }, [selectedSession, messages])
  const [hasPlansBySession, setHasPlansBySession] = useState<Record<string, boolean>>({})
  const handleHasPlansChange = useCallback((sessionId: string, hasPlans: boolean) => {
    setHasPlansBySession(current => current[sessionId] === hasPlans ? current : { ...current, [sessionId]: hasPlans })
  }, [])
  const selectedHasPlans = selectedSession ? hasPlansBySession[selectedSession] === true : false
  useEffect(() => {
    if (!selectedSession) return
    const remembered = activeTabBySessionRef.current[selectedSession] ?? defaultProductPanel
    // When the last live plan settles, drop the Plan tab and leave the page so
    // the user is not stranded on a hidden/blank Plan surface.
    if ((remembered === 'Plan' || activeTabRef.current === 'Plan') && !selectedHasPlans) {
      setToolReturnTab(current => current === 'Plan' ? null : current)
      applyActiveTab(DEFAULT_PANEL_TAB)
      return
    }
    setActiveTab(remembered)
  }, [applyActiveTab, selectedSession, selectedHasPlans, defaultProductPanel])
  const [observedSessionStatuses, setObservedSessionStatuses] = useState<Record<string, SessionStatus>>({})
  const [loadedSidebarPreferencesKey, setLoadedSidebarPreferencesKey] = useState('')
  const [canRevealInFinder, setCanRevealInFinder] = useState(false)
  const [gitAvailable, setGitAvailable] = useState(false)
  const [browserAvailable, setBrowserAvailable] = useState<boolean | undefined>(host.browser ? undefined : false)
  const [browserWorkspaceFullscreen, setBrowserWorkspaceFullscreen] = useState(false)
  useEffect(() => {
    if (activeTab !== 'Browser') setBrowserWorkspaceFullscreen(false)
  }, [activeTab])
  const [terminalAvailable, setTerminalAvailable] = useState<boolean | undefined>(host.terminal ? undefined : false)
  const [retainedWorktreeDispositionAvailable, setRetainedWorktreeDispositionAvailable] = useState(false)
  const [planAvailable, setPlanAvailable] = useState<boolean | undefined>(host.getPlans ? undefined : false)
  const planTabVisible = planAvailable !== false && Boolean(host.getPlans) && selectedHasPlans
  const [planProgressBadge, setPlanProgressBadge] = useState<{ completed: number; total: number } | null>(null)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalInitialView, setModalInitialView] = useState<'manage' | 'add'>('manage')
  const [gitBinary, setGitBinary] = useState<boolean | 'unknown'>('unknown')
  const updates = useUpdateCenter(host)
  const openModelManager = () => { setModalInitialView('manage'); setModalOpen(true) }
  const openAddProvider = () => { setModalInitialView('add'); setModalOpen(true) }
  const closeModelManager = () => setModalOpen(false)
  const [remoteOpen, setRemoteOpen] = useState(false)
  const [subagentModelsOpen, setSubagentModelsOpen] = useState(false)
  const browserOccluded = modalOpen || remoteOpen || subagentModelsOpen
  const modalVisibility = useModelVisibility(host, modelState?.model)
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null)
  const lastCatalogFallbackKeyRef = useRef('')
  const announceCatalogFallback = useCallback((sessionId: string, previous: Model, next: ModelState) => {
    const key = `${sessionId}:${previous.provider}/${previous.id}->${next.model.provider}/${next.model.id}`
    if (lastCatalogFallbackKeyRef.current === key) return
    lastCatalogFallbackKeyRef.current = key
    setCatalogNotice(`当前模型已不可用，已切换到 ${next.model.name}`)
    if (!sessionId) return
    // Persist the fallback for future turns. Never stop an in-flight response.
    void host.setModel(sessionId, next.model.provider, next.model.id).catch(() => {
      // Local chip already shows the fallback; a host persist miss must not abort the turn.
    })
  }, [host])
  const copiedTimerRef = useRef<number | null>(null)
  const archiveCleanupInFlightRef = useRef(new Set<string>())
  const sidebarStorageKey = useMemo(() => sidebarPreferencesKey(projects), [projects])
  // Any active main turn — a local send, a host-driven/resumed/read-only turn, or a
  // queue dispatch — owns the waiting placeholder from `started` until
  // `settled`/`stopped`. The ref is a same-tick guard so repeated started
  // status events keep the first waitingStartedAt stable.
  const activeUserTurnRef = useRef(false)
  // Monotonic renderer-local generation for the selected main turn. Terminal
  // subagent projection may be the only close signal we receive; binding its
  // reconciliation to this epoch prevents a late prior-task terminal from
  // closing a newer prompt.
  const mainTurnEpochRef = useRef(0)
  // True only between an authoritative `started` and `settled`/`stopped`.
  // A late `streaming` (pi queue_update after settle) must not reopen the turn.
  const mainTurnOpenRef = useRef(false)
  // Set on settled/stopped. A bare `started` with no new prompt after this is a
  // ghost turn (JSONL already idle). Real follow-ups advance the host epoch or
  // carry pendingFollowUps/a new user row and still open the wait.
  const turnJustSettledRef = useRef(false)
  /** Host `turnEpoch` of the started turn now shown as live. A later
   *  `settled`/`stopped` from an older epoch is the previous empty-stop
   *  reconciliation and must not freeze the silent next hop. */
  const openedTurnEpochBySessionRef = useRef(new Map<string, number>())
  /** The optimistic user bubble of the in-flight direct send. The server's
   *  `user_message` echo merges back into this bubble by id, so an assistant
   *  placeholder that already streamed past it cannot wedge a duplicate below. */
  const pendingLocalUserRef = useRef<{ id: string; content: string } | null>(null)
  const stoppingSessionRef = useRef<string | null>(null)
  const historyLoadRef = useRef(0)
  const historyContextRef = useRef<{ host: PipiHostAPI; sessionId: string } | null>(null)
  /** Caps empty-page history retries per selection. The 250ms retry used to bump
   *  `historyRefreshKey`, re-run this effect, and reset the local scheduled flag,
   *  so a session whose JSONL page stayed empty (21MB+ files that parse to no
   *  visible rows, or a wedged host) rescanned forever and pinned the main process. */
  const emptyPageRetriesBySessionRef = useRef(new Map<string, number>())
  /** Send from the empty "新会话" state creates the session first; the pending
   *  prompt is dispatched by the auto-send effect once the new session's history
   *  load and stream subscription are live (a direct sendPrompt would race them). */
  const pendingAutoSendRef = useRef<{ sessionId: string; prompt: string; attachments?: ComposerAttachment[]; documents?: ComposerDocument[]; telemetry: TurnTelemetryRendererSample } | null>(null)
  // Mirror of observedSessionStatuses for the history-load effect. Adding the map
  // itself to that effect's deps would re-load history on every status event.
  const observedSessionStatusesRef = useRef(observedSessionStatuses)
  useEffect(() => { observedSessionStatusesRef.current = observedSessionStatuses }, [observedSessionStatuses])
  const applyObservedStatus = useCallback((sessionId: string, status: SessionStatus) => {
    if (observedSessionStatusesRef.current[sessionId] === status) return
    observedSessionStatusesRef.current = { ...observedSessionStatusesRef.current, [sessionId]: status }
    setObservedSessionStatuses(current => current[sessionId] === status ? current : { ...current, [sessionId]: status })
  }, [])
  // Anchor the subagent tail indicator on the first 0→>0 transition of the selected
  // session's running count. SubagentPanel clears its agents on session switch (the
  // count dips to 0), which resets the anchor so the elapsed clock never carries over
  // from the previous session; later count changes inside a run keep the anchor.
  useEffect(() => {
    if (subagentsRunningCount > 0) setSubagentWaitingStartedAt(current => current ?? Date.now())
    else setSubagentWaitingStartedAt(null)
  }, [subagentsRunningCount])
  useEffect(() => {
    const previous = subagentRunEpochRef.current
    if (previous.sessionId !== selectedSession) {
      subagentRunEpochRef.current = { sessionId: selectedSession, count: subagentsRunningCount, turnEpoch: mainTurnEpochRef.current }
      return
    }
    if (previous.count === 0 && subagentsRunningCount > 0) {
      subagentRunEpochRef.current = { sessionId: selectedSession, count: subagentsRunningCount, turnEpoch: mainTurnEpochRef.current }
      return
    }
    subagentRunEpochRef.current = { ...previous, count: subagentsRunningCount }
    if (
      previous.count > 0
      && subagentsRunningCount === 0
      && previous.turnEpoch === mainTurnEpochRef.current
      && mainTurnOpenRef.current
    ) {
      // A subagent tree can durably settle all of its agents even when the
      // selected main-stream `settled` event is lost. Re-read the authoritative
      // JSONL; the existing history/live-revision gates decide whether this
      // exact turn is terminal and refuse to close a newer one.
      freezeProbe('history_refresh', { reason: 'subagents_idle', session: selectedSession, turnEpoch: mainTurnEpochRef.current })
      setHistoryRefreshKey(key => key + 1)
    }
  }, [selectedSession, subagentsRunningCount])
  const sessionQueue = useSessionQueue(host, selectedSession, streaming)
  const selectedObservedStatus = observedSessionStatuses[selectedSession]
  const selectedObservedRunning = selectedObservedStatus === 'running'
  const selectedObservedClosed = selectedObservedStatus === 'completed' || selectedObservedStatus === 'interrupted'
  const messageStreaming = messages.some(message => message.role === 'assistant' && message.streaming)
  const selectedStopping = stoppingSessionId === selectedSession
  // Leftover `queued` after a UI settle/stop means the host never went idle.
  // Keep stop and insert-on-send. Leftover `sending` after settle/stop must not
  // lock: host stop is authoritative, and `sending` is only meaningful while the
  // turn is still open.
  const leftoverQueued = sessionQueue.items.some(item => item.status === 'queued')
  const strandedHostBusy = leftoverQueued && selectedObservedClosed
  const queueLocksComposer = strandedHostBusy || (sessionQueue.busy && !selectedObservedClosed)
  // A leftover streaming assistant after settle (late text/tool) must not keep
  // the stop button once the authoritative turn is already closed.
  const sessionWorking = streaming || selectedObservedRunning || (messageStreaming && !selectedObservedClosed) || queueLocksComposer || compacting || selectedStopping
  const lastUserForPlanApproval = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message.role !== 'user') continue
      return { content: message.content, timestamp: message.timestamp }
    }
    return undefined
  }, [messages])
  const closeOpenTurn = useCallback((sessionId: string, status: 'completed' | 'interrupted', options?: { keepStopGuard?: boolean }) => {
    applyObservedStatus(sessionId, status)
    if (!options?.keepStopGuard && stoppingSessionRef.current === sessionId) stoppingSessionRef.current = null
    setStoppingSessionId(current => current === sessionId ? null : current)
    setStopError(current => current?.sessionId === sessionId ? null : current)
    if (selectedSessionRef.current !== sessionId) return
    mainTurnOpenRef.current = false
    turnJustSettledRef.current = true
    pendingLocalUserRef.current = null
    setStreaming(false)
    setCompacting(false)
    setStatsRefreshKey(key => key + 1)
    void sessionQueue.resync()
    transcriptLiveRevisionRef.current += 1
    const next = finishStreamingMessage(messagesRef.current)
    messagesRef.current = next
    setMessages(next)
    activeUserTurnRef.current = false
    setWaitingVisible(false)
    setWaitingStartedAt(null)
    setWaitingDetail(undefined)
  }, [applyObservedStatus, sessionQueue])
  const closeOpenTurnRef = useRef(closeOpenTurn)
  closeOpenTurnRef.current = closeOpenTurn
  const canWriteLease = leaseCanWrite(lease)
  const activeWorkbenchPlan = useActiveWorkbenchPlan()
  const activeProductPackId = activeWorkbenchPlan.packId
  const productHasPrimarySidebar = activeWorkbenchPlan.containers.some(item => item.location === 'primarySidebar')
  const selectedConversationPackId = sessions.find(item => item.id === selectedSession)?.productProfile?.id ?? activeProductPackId
  const packSnapshotMismatch = Boolean(selectedSession) && selectedConversationPackId !== activeProductPackId
  const leaseReadOnly = packSnapshotMismatch || (lease !== null && !canWriteLease)
  const leaseConflictError = sessionQueue.items.find(item =>
    item.status === 'failed' && typeof item.error === 'string' && item.error.includes('session is read-only'),
  )?.error
  const cacheSessionPreload = useCallback((sessionId: string, snapshot: SessionPreloadSnapshot) => {
    preloadedSessionDetailsRef.current.set(sessionId, snapshot)
    historyEntriesBySessionRef.current.set(sessionId, snapshot.history)
    historyCompleteBySessionRef.current.set(sessionId, true)
    historyCursorBySessionRef.current.delete(sessionId)
    const reconciled = reconcileHistorySnapshot(snapshot.history, 0, 0)
    messagesBySessionRef.current.set(sessionId, reconciled.messages)
    historyFingerprintBySessionRef.current.set(sessionId, reconciled.fingerprint)
  }, [])
  /** SubagentPanel receives already-warmed snapshots/logs on the first click,
   * then its normal live subscriptions keep the selected session current. */
  const preloadedHost = useMemo<PipiHostAPI>(() => ({
    ...host,
    listAgents: async (sessionId, scope) => {
      const cached = sessionId ? preloadedSessionDetailsRef.current.get(sessionId) : undefined
      const cachedLive = cached?.agents.some(agent => agent.state === 'running' || agent.state === 'stalled') === true
      // A startup snapshot can freeze workers as `running` after they have already
      // reached a terminal verdict. Live index wins whenever the cache still looks active.
      if (cached && scope === 'history' && !cachedLive) return cached.agents
      const live = await host.listAgents(sessionId, scope)
      if (cached && sessionId && scope === 'history') preloadedSessionDetailsRef.current.set(sessionId, { ...cached, agents: live })
      return live
    },
    getAgentLogs: async (agentId, sessionId, runId, scope) => {
      // Match the host-api convention: an omitted scope stays a 3-argument read.
      const readLive = () => scope
        ? host.getAgentLogs(agentId, sessionId, runId, scope)
        : host.getAgentLogs(agentId, sessionId, runId)
      const cached = preloadedSessionDetailsRef.current.get(sessionId)
      if (!cached) return readLive()
      if (scope === 'agent') {
        const cachedEntries = cached.agentLogs
          .filter(item => item.agentId === agentId)
          .flatMap(item => item.entries)
        if (cachedEntries.length > 0) return cachedEntries
      } else {
        const cachedEntry = cached.agentLogs.find(item => item.agentId === agentId && item.runId === runId)
        // The snapshot is a startup-time slice: a nested agent registered early
        // can carry an empty (or still-growing) prefetch entry even though its
        // transcript landed afterwards. An empty cached entry is never
        // authoritative — fall back to the live host, whose cache is keyed by
        // the exact {sessionId, agentId, runId} triple, so no other run's or
        // parent's logs can leak in.
        if (cachedEntry && cachedEntry.entries.length > 0) return cachedEntry.entries
      }
      return readLive()
    },
  }), [host])
  const loadLazySessionPage = useCallback(async (projectId: string, cursor?: string) => {
    if (!host.listSessionPage) return
    const loadKey = `${projectId}\u0000${cursor ?? 'first'}`
    if (lazyPageLoadsRef.current.has(loadKey)) return
    lazyPageLoadsRef.current.add(loadKey)
    setLazySessionPages(current => ({
      ...current,
      [projectId]: { ...current[projectId], loading: true, hasMore: current[projectId]?.hasMore ?? false },
    }))
    try {
      const page = await host.listSessionPage(projectId, cursor, 10)
      setSessions(current => {
        const merged = new Map(current.map(session => [session.id, session]))
        for (const session of page.sessions) merged.set(session.id, session)
        return [...merged.values()]
      })
      setSidebarSessionIdsByProject(current => ({
        ...current,
        [projectId]: [...new Set([...(current[projectId] ?? []), ...page.sessions.map(session => session.id)])],
      }))
      setLazySessionPages(current => ({
        ...current,
        [projectId]: { nextCursor: page.nextCursor, hasMore: page.hasMore, loading: false },
      }))
      setLazyVisibleSessionLimits(current => ({
        ...current,
        [projectId]: cursor ? (current[projectId] ?? 10) + 10 : Math.max(current[projectId] ?? 0, 10),
      }))
      if (!selectedSessionRef.current && page.sessions[0]) {
        setSelectedProject(projectId)
        setSelectedSession(page.sessions[0].id)
      }
    } catch (error) {
      setLazySessionPages(current => ({
        ...current,
        [projectId]: { ...current[projectId], loading: false, hasMore: current[projectId]?.hasMore ?? false },
      }))
      setProjectError(`加载会话列表失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      lazyPageLoadsRef.current.delete(loadKey)
    }
  }, [host])
  const warmInitialSessionPages = useCallback(async (items: readonly Project[]) => {
    for (const project of items) await loadLazySessionPage(project.id)
  }, [loadLazySessionPage])
  /** The explicit path read performs the one-time backend migration; listProjects supplies matching UI metadata. */
  const refreshProjects = useCallback(async () => {
    const paths = host.getProjectPaths ? await host.getProjectPaths() : undefined
    const listed = await host.listProjects()
    const explicitPaths = paths ? new Set(paths) : undefined
    const items = explicitPaths ? listed.filter(project => explicitPaths.has(project.path)) : listed
    if (host.listSessionPage && host.getSession && host.preloadSession) {
      const validProjectIds = new Set(items.map(project => project.id))
      const remembered = restoredLastSessionRef.current ? null : readLastSessionSelection()
      restoredLastSessionRef.current = true
      setProjects(items)
      setProjectsLoaded(true)
      let rememberedReady = false
      if (remembered && validProjectIds.has(remembered.projectId)) {
        try {
          const session = await host.getSession(remembered.projectId, remembered.sessionId)
          const snapshot = await host.preloadSession(session.id)
          cacheSessionPreload(session.id, snapshot)
          const messages = messagesBySessionRef.current.get(session.id) ?? []
          messagesRef.current = messages
          setMessages(messages)
          setSessions(current => current.some(item => item.id === session.id) ? current : [session, ...current])
          setSelectedProject(session.projectId)
          setSelectedSession(session.id)
          rememberedReady = true
        } catch {
          /* Deleted/renamed remembered session: first lazy page chooses a replacement. */
        }
      }
      if (!rememberedReady) setSelectedProject(current => validProjectIds.has(current) ? current : items[0]?.id ?? '')
      setLazyStartupReady(true)
      // Schedule only after the remembered render cache is ready. This timeout
      // yields a paint opportunity before any page starts parsing full histories.
      window.setTimeout(() => { void warmInitialSessionPages(items) }, 0)
      return items
    }
    const groupedSessions = await Promise.all(items.map(async project => {
      const request = beginSessionListRequest(project.id)
      try {
        return { projectId: project.id, sessions: await host.listSessions(project.id), ...request }
      } catch (error) {
        return { projectId: project.id, error, ...request }
      }
    }))
    const titleRevisionsAtRequest = new Map<string, number>()
    const listedSessions: Session[] = groupedSessions.flatMap(result => {
      if ('error' in result || !isCurrentSessionListRequest(result.projectId, result.generation)) {
        return sessionsRef.current.filter(session => session.projectId === result.projectId)
      }
      result.titleRevisions.forEach((revision, sessionId) => titleRevisionsAtRequest.set(sessionId, revision))
      return result.sessions
    })
    const retainIds = new Set(locallyCreatedSessionIdsRef.current)
    if (selectedSessionRef.current) retainIds.add(selectedSessionRef.current)
    const nextSessions = mergeSessionSnapshot(sessionsRef.current, listedSessions, {
      titleRevisionsAtRequest,
      currentTitleRevisions: sessionTitleRevisionByIdRef.current,
      retainIds,
    })
    const failures = groupedSessions.flatMap(result => 'error' in result ? [result] : [])
    if (failures.length) {
      const details = failures.map(({ projectId, error }) => `${items.find(project => project.id === projectId)?.name ?? projectId}：${error instanceof Error ? error.message : String(error)}`).join('；')
      setProjectError(`加载会话列表失败：${details}`)
    }
    const validProjectIds = new Set(items.map(project => project.id))
    const remembered = restoredLastSessionRef.current ? null : readLastSessionSelection()
    restoredLastSessionRef.current = true
    const validSessionIds = new Set(nextSessions.map(session => session.id))
    const rememberedSession = remembered && validProjectIds.has(remembered.projectId)
      ? nextSessions.find(session => session.id === remembered.sessionId && session.projectId === remembered.projectId)
      : undefined
    const currentSession = nextSessions.find(session => session.id === selectedSessionRef.current)
    const nextSession = currentSession ?? rememberedSession ?? nextSessions[0]
    const nextProject = nextSession?.projectId
      ? nextSession.projectId
      : (validProjectIds.has(selectedProjectRef.current) ? selectedProjectRef.current : items[0]?.id ?? '')
    setProjects(items)
    setSessions(nextSessions)
    setSelectedProject(nextProject)
    setSelectedSession(validSessionIds.has(nextSession?.id ?? '') ? nextSession!.id : '')
    setProjectsLoaded(true)
    return items
  }, [beginSessionListRequest, cacheSessionPreload, host, isCurrentSessionListRequest, warmInitialSessionPages])

  useEffect(() => { void refreshProjects().catch(error => setProjectError(`加载项目失败：${error instanceof Error ? error.message : String(error)}`)); void host.capabilities().then(capabilities => { setCanRevealInFinder(capabilities.revealInFinder && typeof host.revealProject === 'function'); setBrowserAvailable(Boolean(capabilities.browser && host.browser)); setTerminalAvailable(Boolean(capabilities.terminal && host.terminal)); setGitAvailable(Boolean(capabilities.git && host.gitStatus)); setRetainedWorktreeDispositionAvailable(Boolean(capabilities.retainedWorktreeDisposition)); setPlanAvailable(Boolean(capabilities.plan && host.getPlans)) }).catch(() => { setCanRevealInFinder(false); setBrowserAvailable(false); setTerminalAvailable(false); setGitAvailable(false); setRetainedWorktreeDispositionAvailable(false); setPlanAvailable(false) }); if (!host.probeGitBinary) { setGitBinary('unknown'); return } void host.probeGitBinary().then(installed => setGitBinary(Boolean(installed))).catch(() => setGitBinary('unknown')) }, [host, refreshProjects])
  // Session-workspace bind/unbind lands mid-session (boss's first write); the
  // host announces it on the git-capability channel so the header dual-branch
  // pair appears without an app restart. One refresh per notice; reloads merge by id.
  const refreshProjectsForWorkspaceRef = useRef(refreshProjects)
  refreshProjectsForWorkspaceRef.current = refreshProjects
  const workspaceNoticeInFlightRef = useRef(false)
  useEffect(() => subscribeExt(host, 'git-capability', event => {
    if (event?.type !== 'session_workspace_changed' || workspaceNoticeInFlightRef.current) return
    workspaceNoticeInFlightRef.current = true
    void refreshProjectsForWorkspaceRef.current().catch(() => undefined).finally(() => { workspaceNoticeInFlightRef.current = false })
  }), [host])
  useEffect(() => {
    if (!selectedSession || !host.invokeExtension) { setTimeline(null); return }
    let cancelled = false
    setTimeline(null)
    void host.invokeExtension('coc-keeper','timeline.graph',{}, {sessionId:selectedSession}).then(result => {
      if (!cancelled && result.ok) setTimeline({...result.data as any, hostSessionId:selectedSession})
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [host, selectedSession, timelineRefresh, historyRefreshKey])
  const timelineLineBySession = useRef(new Map<string,string>())
  const timelineFollowInFlight = useRef(false)
  useEffect(() => {
    const active = timeline?.active
    if (!selectedSession || timeline?.hostSessionId !== selectedSession || typeof active !== 'string') return
    const previousLine = timelineLineBySession.current.get(selectedSession)
    if (!previousLine) { timelineLineBySession.current.set(selectedSession, active); return }
    if (previousLine === active || sessionWorking || branchBusy || timelineFollowInFlight.current || !host.invokeExtension) return
    timelineFollowInFlight.current = true
    void host.invokeExtension('coc-keeper','timeline.follow',{previousLine},{sessionId:selectedSession}).then(result => {
      if (!result.ok) throw new Error(result.error?.message || 'Could not follow the worldline')
      timelineLineBySession.current.set(selectedSession, active)
    }).catch(error => setProjectError(error instanceof Error ? error.message : String(error)))
      .finally(() => { timelineFollowInFlight.current = false })
  }, [host, selectedSession, timeline, sessionWorking, branchBusy])
  useEffect(() => subscribeExt(host, 'coc-keeper', event => {
    if (event.type === 'timeline-changed') setTimelineRefresh(value => value + 1)
    if (event.type !== 'timeline-navigate') return
    const payload = event.payload as {originSessionId:string; session:Session; parent?:Session; messageId?:string}
    if (payload.originSessionId !== selectedSessionRef.current) return
    const additions = [payload.session, ...(payload.parent ? [payload.parent] : [])]
    setSessions(current => [...current.filter(s => !additions.some(a => a.id === s.id)), ...additions])
    setSidebarSessionIdsByProject(current => ({...current,[payload.session.projectId]:[...new Set([...(current[payload.session.projectId] ?? []), ...additions.map(s => s.id)])]}))
    setSelectedProject(payload.session.projectId)
    setSidebarExpandedIds(current => current.includes(payload.session.projectId) ? current : [...current,payload.session.projectId])
    setSelectedSession(payload.session.id)
    if (payload.messageId) setTimelineNavigation({sessionId:payload.session.id,messageId:payload.messageId,nonce:Date.now()})
    else setTimelineNavigation(null)
    setTimelineRefresh(value => value + 1)
  }), [host])
  // A CoC apply that defines new objects spends its whole tool call on host-side Mod agents and
  // streams nothing, so the transcript has no way to say what the minutes are going into. The pack
  // reports its own progress on the D4 channel it already owns; the waiting line is the one surface
  // that keeps ticking through a silent tool call, so it carries it. Cleared whenever the turn
  // leaves the tool phase, so a stale count can never outlive the call it belongs to.
  useEffect(() => subscribeExt(host, 'coc-keeper', event => {
    if (event?.type !== 'mods-progress') return
    const payload = (event.payload ?? {}) as { done?: unknown; total?: unknown }
    const done = typeof payload.done === 'number' ? payload.done : null
    const total = typeof payload.total === 'number' ? payload.total : null
    if (done === null || total === null || total <= 0) return
    setModsProgress(done >= total ? undefined : `生成物品定义 ${done}/${total}`)
  }), [host])
  useEffect(() => { if (waitingPhase !== 'tool') setModsProgress(undefined) }, [waitingPhase])
  useEffect(() => {
    if (!host.setEventProjectionSession) return
    void host.setEventProjectionSession(selectedSession || undefined).catch(() => undefined)
  }, [host, selectedSession])
  useEffect(() => {
    if (!host.browser || !selectedSession) return
    void host.browser.selectSession(selectedSession)
  }, [host, selectedSession])
  useEffect(() => {
    if (!host.browser) return
    return host.browser.subscribe(event => {
      if (event.type === 'reveal' && event.sessionId === selectedSession) rememberToolReturn('Browser')
    })
  }, [host, rememberToolReturn, selectedSession])
  useEffect(() => {
    if (!host.terminal?.subscribeAll) return
    return host.terminal.subscribeAll((event: TerminalEvent) => {
      if (event.type === 'opened') setAnnouncedTerminals(current => ({ ...current, [event.sessionId]: event.terminal }))
      if (event.type === 'reveal' && event.sessionId === selectedSession) { setRevealedTerminalIds(current => ({ ...current, [event.sessionId]: event.terminalId })); rememberToolReturn('Terminal') }
    })
  }, [host, rememberToolReturn, selectedSession])
  useEffect(() => {
    let mounted = true
    const refresh = () => {
      void host.listAgents().then(snapshot => {
        if (mounted) setSidebarAgents(current => mergeAgentSnapshot(current, snapshot))
      }).catch(() => undefined)
    }
    const unsubscribe = host.subscribeAgents(event => {
      const eventSessionId = event.type === 'agent'
        ? event.agent.sessionId
        : event.type === 'agent_log'
          ? event.sessionId
          : event.type === 'worktree' ? event.status.sessionId : undefined
      if (eventSessionId) preloadedSessionDetailsRef.current.delete(eventSessionId)
      if (event.type !== 'agent') return
      setSidebarAgents(current => mergeAgentSummary(current, event.agent))
    })
    refresh()
    // subscribeAgents is a fire-and-forget broadcast with no replay: lifecycle
    // events that fired while the window was hidden, or while the subscription
    // was silently lost, never come back. Background subagents can outlive the
    // Boss turn, so reconcile from the durable host index whenever the user
    // returns to the window — this both recovers a missed `running` and clears
    // a running row whose terminal event was missed.
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      mounted = false
      unsubscribe()
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [host])
  useEffect(() => {
    if (!selectedSession) return
    let mounted = true
    void host.listAgents(selectedSession, 'history').then(snapshot => {
      if (!mounted) return
      setSidebarAgents(current => mergeAgentSnapshot(current, snapshot))
      const cached = preloadedSessionDetailsRef.current.get(selectedSession)
      if (cached) preloadedSessionDetailsRef.current.set(selectedSession, { ...cached, agents: snapshot })
    }).catch(() => undefined)
    return () => { mounted = false }
  }, [host, selectedSession])
  useEffect(() => {
    if (!projects.length || loadedSidebarPreferencesKey === sidebarStorageKey) return
    let active = true
    const saved = readSidebarPreferences(sidebarStorageKey)
    const projectIds = new Set(projects.map(project => project.id))
    if (saved) {
      setSidebarExpandedIds(saved.expandedIds.filter(id => projectIds.has(id)))
      setSidebarVisibleLimit(saved.visibleLimit)
    } else if (!loadedSidebarPreferencesKey) {
      setSidebarExpandedIds(projects.map(project => project.id))
      setSidebarVisibleLimit(SIDEBAR_PROJECT_PAGE_SIZE)
    } else {
      // A durable project mutation changes the workspace key. Keep UI-only
      // disclosure/pin/page preferences instead of treating it as a reset.
      setSidebarExpandedIds(current => current.filter(id => projectIds.has(id)))
    }
    void (async () => {
      let pinned = saved?.pinnedSessionIds ?? []
      let archived = saved?.archivedSessionIds ?? []
      let archivedTimestamps = saved?.archivedSessionTimestamps ?? {}
      if (host.getSidebarSessionPreferences && host.setSidebarSessionPreferences) {
        const remote = await host.getSidebarSessionPreferences()
        const migrated = localStorage.getItem(sidebarSemanticMigrationKey) === '1'
        if (migrated) {
          pinned = remote.pinnedSessionIds
          archived = remote.archivedSessionIds
          archivedTimestamps = remote.archivedSessionTimestamps ?? {}
        } else {
          archived = [...new Set([...remote.archivedSessionIds, ...archived])]
          archivedTimestamps = { ...archivedTimestamps, ...(remote.archivedSessionTimestamps ?? {}) }
          const archivedSet = new Set(archived)
          pinned = [...new Set([...remote.pinnedSessionIds, ...pinned])].filter(id => !archivedSet.has(id))
          archivedTimestamps = normalizeArchiveTimestamps(archived, archivedTimestamps)
          await host.setSidebarSessionPreferences({ pinnedSessionIds: pinned, archivedSessionIds: archived, archivedSessionTimestamps: archivedTimestamps, orderedSessionIds: [], sessionOrderVersion: SESSION_ORDER_VERSION })
          localStorage.setItem(sidebarSemanticMigrationKey, '1')
        }
      }
      if (!active) return
      archivedTimestamps = normalizeArchiveTimestamps(archived, archivedTimestamps)
      setPinnedSessionIds(pinned)
      setArchivedSessionIds(archived)
      setArchivedSessionTimestamps(archivedTimestamps)
      setLoadedSidebarPreferencesKey(sidebarStorageKey)
    })().catch(error => {
      if (!active) return
      setProjectError(`加载侧栏偏好失败：${error instanceof Error ? error.message : String(error)}`)
      setPinnedSessionIds(saved?.pinnedSessionIds ?? [])
      setArchivedSessionIds(saved?.archivedSessionIds ?? [])
      setArchivedSessionTimestamps(normalizeArchiveTimestamps(saved?.archivedSessionIds ?? [], saved?.archivedSessionTimestamps))
      setLoadedSidebarPreferencesKey(sidebarStorageKey)
    })
    return () => { active = false }
  }, [host, loadedSidebarPreferencesKey, projects, sidebarStorageKey])
  useEffect(() => {
    if (!projects.length || loadedSidebarPreferencesKey !== sidebarStorageKey) return
    writeSidebarPreferences(sidebarStorageKey, { expandedIds: sidebarExpandedIds, pinnedSessionIds, archivedSessionIds, archivedSessionTimestamps, visibleLimit: sidebarVisibleLimit })
    if (host.setSidebarSessionPreferences) {
      void host.setSidebarSessionPreferences({ pinnedSessionIds, archivedSessionIds, archivedSessionTimestamps, orderedSessionIds: [], sessionOrderVersion: SESSION_ORDER_VERSION }).catch(error => setProjectError(`保存侧栏偏好失败：${error instanceof Error ? error.message : String(error)}`))
    }
  }, [host, loadedSidebarPreferencesKey, pinnedSessionIds, archivedSessionIds, archivedSessionTimestamps, projects.length, sidebarExpandedIds, sidebarStorageKey, sidebarVisibleLimit])
  useEffect(() => {
    if (!projects.length || loadedSidebarPreferencesKey !== sidebarStorageKey || archivedSessionIds.length === 0) return
    const cleanup = async () => {
      const expired = expiredArchivedSessionIds(archivedSessionIds, archivedSessionTimestamps)
      for (const sessionId of expired) {
        if (archiveCleanupInFlightRef.current.has(sessionId)) continue
        archiveCleanupInFlightRef.current.add(sessionId)
        try {
          try {
            await host.deleteSession(sessionId)
          } catch (error) {
            // Already-gone sessions are the cleanup goal. Keep retrying only for
            // transient host/filesystem failures, not for a missing session file.
            if (!isUnknownSessionError(error)) {
              setProjectError(`自动删除过期归档失败：${error instanceof Error ? error.message : String(error)}`)
              continue
            }
          }
          locallyCreatedSessionIdsRef.current.delete(sessionId)
          skippedInitialEmptyHistoryRef.current.delete(sessionId)
          const archivedSet = new Set(archivedSessionIds)
          const fallback = sessions.find(session => session.id !== sessionId && !archivedSet.has(session.id))
          setSessions(current => current.filter(session => session.id !== sessionId))
          setArchivedSessionIds(current => current.filter(id => id !== sessionId))
          setArchivedSessionTimestamps(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== sessionId)))
          setPinnedSessionIds(current => current.filter(id => id !== sessionId))
          if (selectedSession === sessionId) {
            setSelectedSession(fallback?.id ?? '')
            if (fallback) setSelectedProject(fallback.projectId)
          }
        } finally {
          archiveCleanupInFlightRef.current.delete(sessionId)
        }
      }
    }
    void cleanup()
    const timer = window.setInterval(() => { void cleanup() }, ARCHIVE_CLEANUP_RETRY_MS)
    return () => window.clearInterval(timer)
  }, [archivedSessionIds, archivedSessionTimestamps, host, loadedSidebarPreferencesKey, projects.length, selectedSession, sessions, sidebarStorageKey])
  useEffect(() => {
    if (!projectsLoaded || !selectedProject) return
    if (host.listSessionPage && host.preloadSession) return
    const request = beginSessionListRequest(selectedProject)
    void host.listSessions(selectedProject).then(items => {
      if (!isCurrentSessionListRequest(selectedProject, request.generation)) return
      setSessions(current => {
        // Read the retain set inside the updater, not when this response landed:
        // a session the user created between the two is already in `current`, and
        // a set captured earlier would drop it (and clear the selection with it).
        const retainIds = new Set(locallyCreatedSessionIdsRef.current)
        if (selectedSessionRef.current) retainIds.add(selectedSessionRef.current)
        const existing = current.filter(session => session.projectId === selectedProject)
        const merged = mergeSessionSnapshot(existing, items, {
          titleRevisionsAtRequest: request.titleRevisions,
          currentTitleRevisions: sessionTitleRevisionByIdRef.current,
          retainIds,
        })
        // A session this App just created outranks any list response: the reply
        // may have been in flight since before it existed, and dropping the
        // selection would bounce the user back to the empty state.
        setSelectedSession(previous => merged.some(item => item.id === previous)
          || locallyCreatedSessionIdsRef.current.has(previous)
          ? previous
          : merged[0]?.id ?? '')
        return [
          ...current.filter(session => session.projectId !== selectedProject),
          ...merged,
        ]
      })
    }).catch(error => setProjectError(`加载会话列表失败：${error instanceof Error ? error.message : String(error)}`))
  }, [beginSessionListRequest, host, isCurrentSessionListRequest, projectsLoaded, selectedProject])
  useEffect(() => {
    if (!projectsLoaded || !selectedProject || !selectedSession) return
    const known = sessions.some(session => session.id === selectedSession && session.projectId === selectedProject)
    if (!known) return
    try { localStorage.setItem(LAST_SESSION_STORAGE_KEY, JSON.stringify({ projectId: selectedProject, sessionId: selectedSession })) } catch { /* storage can be disabled by the host */ }
  }, [projectsLoaded, selectedProject, selectedSession, sessions])
  // The same shell ships in PipiUI and in every product built on it, so the brand comes
  // from the host rather than a literal. Falls back to the base name on an older host.
  const [productName, setProductName] = useState('PipiUI')
  const [productId, setProductId] = useState('')
  useEffect(() => {
    if (!host.getProduct) return
    let current = true
    void host.getProduct().then(product => { if (current && product?.name) {setProductName(product.name);setProductId(product.id)} }).catch(() => undefined)
    return () => { current = false }
  }, [host])
  useEffect(() => {
    document.title = sessions.find(session => session.id === selectedSession)?.name ?? productName
  }, [productName, selectedSession, sessions])
  useEffect(() => {
    let current = true
    const sessionId = selectedSession
    const provisional = modelStatesBySessionRef.current.get(sessionId)
      ?? modelStateFromSession(sessionsRef.current.find(session => session.id === sessionId), modalVisibility.models)
    const immediate = provisional && reconcileModelStateWithCatalog(provisional, modalVisibility.models)
    if (immediate) {
      if (sessionId) {
        modelStatesBySessionRef.current.set(sessionId, immediate)
        rememberSessionModel(sessionId, immediate.model)
      }
      setModelState(immediate)
    }
    const writeGen = modelWriteGenRef.current
    void host.getModelState(selectedSession || undefined)
      .then(state => {
        if (!current || modelWriteGenRef.current !== writeGen) return
        const reconciled = reconcileModelStateWithCatalog(state, modalVisibility.models)
        if (sessionId) {
          modelStatesBySessionRef.current.set(sessionId, reconciled)
          rememberSessionModel(sessionId, reconciled.model)
        }
        setModelState(reconciled)
      })
      // Failure fallback: the session's own model (from listSessions) keeps the
      // chip/row per-session even when the host model query itself failed.
      .catch(() => {
        if (!current || !selectedSession || modelWriteGenRef.current !== writeGen) return
        const ref = sessionsRef.current.find(session => session.id === selectedSession)?.model
        if (ref) {
          const model: Model = { provider: ref.provider, id: ref.modelId, name: ref.modelId }
          rememberSessionModel(selectedSession, model)
          setModelState({ model, thinkingLevel: 'off', availableThinkingLevels: thinkingLevelsForModel(model) })
        }
      })
    return () => { current = false }
  }, [host, modalVisibility.models, selectedSession])
  useEffect(() => {
    if (modalVisibility.catalogEpoch === 0 || modalVisibility.loading) return
    const sessionId = selectedSessionRef.current
    if (!sessionId) return
    const current = modelStatesBySessionRef.current.get(sessionId) ?? modelState
    if (!current) return
    const { state, fellBack } = fallbackModelIfMissing(current, modalVisibility.models)
    if (!fellBack) return
    modelStatesBySessionRef.current.set(sessionId, state)
    rememberSessionModel(sessionId, state.model)
    setModelState(state)
    announceCatalogFallback(sessionId, current.model, state)
  }, [announceCatalogFallback, modalVisibility.catalogEpoch, modalVisibility.loading, modalVisibility.models, modelState])
  useEffect(() => {
    const request = ++historyLoadRef.current
    const requestLiveRevision = transcriptLiveRevisionRef.current
    let staleRetryScheduled = false
    let staleRetryTimer: number | undefined
    let emptyPageRetryTimer: number | undefined
    let settleConfirmRetryTimer: number | undefined
    const previousContext = historyContextRef.current
    const contextChanged = previousContext?.host !== host || previousContext.sessionId !== selectedSession
    historyContextRef.current = { host, sessionId: selectedSession }
    if (contextChanged && selectedSession) emptyPageRetriesBySessionRef.current.delete(selectedSession)
    if (!selectedSession) {
      setMessages([])
      setLease(null)
      return
    }
    const cached = messagesBySessionRef.current.get(selectedSession)
    // Skip the first JSONL read for a session this UI just created. An empty
    // in-memory cache is not proof the file is still empty: the host may have
    // written the turn while this renderer missed stream events. Skipping again
    // on a later select would hide on-disk history forever.
    const knownNewEmptySession = contextChanged
      && locallyCreatedSessionIdsRef.current.has(selectedSession)
      && cached?.length === 0
      && historyCompleteBySessionRef.current.get(selectedSession) === true
      && !skippedInitialEmptyHistoryRef.current.has(selectedSession)
    if (knownNewEmptySession) skippedInitialEmptyHistoryRef.current.add(selectedSession)
    if (contextChanged) {
      activeUserTurnRef.current = false
      mainTurnOpenRef.current = false
      mainTurnEpochRef.current += 1
      turnJustSettledRef.current = false
      // Restore a visited transcript this tick so switching back does not flash
      // empty and wait for another JSONL parse on the host.
      messagesRef.current = cached ?? []
      setMessages(cached ?? [])
      setCompacting(false)
      setWaitingVisible(false)
      setWaitingStartedAt(null)
      setWaitingDetail(undefined)
      setSubagentWaitingStartedAt(null)
    }
    // A session still observed as running may be a lost settle: JSONL already
    // has the conclusion, but `agent_settled` never arrived. Do not flash
    // "模型仍在处理" until history confirms the turn is still open.
    const resumedRunning = observedSessionStatusesRef.current[selectedSession] === 'running'
    if (contextChanged) {
      setStreaming(resumedRunning)
      if (resumedRunning) {
        mainTurnOpenRef.current = true
        activeUserTurnRef.current = true
      }
      setLease(null)
    }
    const closeLostSettle = () => {
      historySettledReplacementRef.current.delete(selectedSession)
      mainTurnOpenRef.current = false
      activeUserTurnRef.current = false
      turnJustSettledRef.current = true
      setStreaming(false)
      setWaitingVisible(false)
      setWaitingStartedAt(null)
      setWaitingDetail(undefined)
      applyObservedStatus(selectedSession, 'completed')
      void sessionQueue.resync()
      const settled = finishStreamingMessage(messagesRef.current)
      if (settled !== messagesRef.current) {
        transcriptLiveRevisionRef.current += 1
        messagesRef.current = settled
        messagesBySessionRef.current.set(selectedSession, settled)
        setMessages(settled)
      }
    }
    const openResumeWait = (liveMessages: ChatMessage[], historyMessages: ChatMessage[]) => {
      const last = liveMessages[liveMessages.length - 1] ?? historyMessages[historyMessages.length - 1]
      setStreaming(true)
      setWaitingStartedAt(Date.now())
      setWaitingVisible(true)
      setWaitingPhase(last && assistantEndedAwaitingModel(last) ? 'thinking' : waitingPhaseForTurn(liveMessages.length ? liveMessages : historyMessages))
      setWaitingDetail(undefined)
    }
    const resumeOrCloseLostSettle = (historyMessages: ChatMessage[], liveMessages = messagesRef.current) => {
      if (!resumedRunning) return
      const candidate = historySettledReplacementRef.current.get(selectedSession)
      const replacementConfirmed = Boolean(candidate
        && candidate.liveRevision === transcriptLiveRevisionRef.current
        && candidate.fingerprint === transcriptFingerprint(liveMessages)
        && candidate.fingerprint === transcriptFingerprint(historyMessages))
      if (candidate && !replacementConfirmed) historySettledReplacementRef.current.delete(selectedSession)
      if (historyConfirmsLostSettle(historyMessages, liveMessages, replacementConfirmed)) {
        closeLostSettle()
        return
      }
      openResumeWait(liveMessages, historyMessages)
    }
    const scheduleSettledReplacementConfirmation = (snapshot: ChatMessage[]) => {
      if (!resumedRunning || !mainTurnOpenRef.current) return
      const last = assistantBeforeTrailingCompactions(snapshot)
      if (!last || last.role !== 'assistant' || !assistantLooksSettled(last) || assistantEndedAwaitingModel(last)) return
      const fingerprint = transcriptFingerprint(snapshot)
      const existing = historySettledReplacementRef.current.get(selectedSession)
      if (existing?.fingerprint === fingerprint && existing.liveRevision === transcriptLiveRevisionRef.current) return
      historySettledReplacementRef.current.set(selectedSession, {
        fingerprint,
        liveRevision: transcriptLiveRevisionRef.current,
      })
      if (settleConfirmRetryTimer !== undefined) window.clearTimeout(settleConfirmRetryTimer)
      settleConfirmRetryTimer = window.setTimeout(() => {
        if (historyLoadRef.current === request
          && historyContextRef.current?.host === host
          && historyContextRef.current.sessionId === selectedSession) {
          setHistoryRefreshKey(key => key + 1)
        }
      }, 250)
    }
    const restoreOpenHop = (snapshot: ChatMessage[], live: ChatMessage[]): ChatMessage[] => {
      if (!mainTurnOpenRef.current) return snapshot
      if (historyConfirmsLostSettle(snapshot, live)) return snapshot
      const liveLast = live[live.length - 1]
      if (!liveLast || liveLast.role !== 'assistant' || !assistantEndedAwaitingModel(liveLast)) return snapshot
      return reopenAssistantForNextCompletion(snapshot, { includeHistoryMergedToolHop: true })
    }
    const applyRestoredOpenHop = (snapshot: ChatMessage[]) => {
      const restored = restoreOpenHop(snapshot, messagesRef.current)
      if (restored === messagesRef.current) return
      messagesBySessionRef.current.set(selectedSession, restored)
      messagesRef.current = restored
      setMessages(restored)
    }
    const applyHistory = (entries: HistoryEntry[]) => {
      if (historyLoadRef.current !== request) return
      const previousFingerprint = historyFingerprintBySessionRef.current.get(selectedSession)
      const reconciliation = reconcileHistorySnapshot(
        entries,
        requestLiveRevision,
        transcriptLiveRevisionRef.current,
        previousFingerprint,
        messagesRef.current,
      )
      if (reconciliation.status === 'retained-longer-live') {
        resumeOrCloseLostSettle(messagesRef.current)
        applyRestoredOpenHop(messagesRef.current)
        return
      }
      if (reconciliation.status === 'stale-request') {
        // A stream mutation supersedes this request generation. While a turn is
        // open its terminal event owns the retry; otherwise schedule one bounded
        // exact-context retry instead of letting the old response win.
        // Exception: an empty (or user-less) live pane must still accept durable
        // history. Otherwise a lost settle / stale running resume keeps the
        // middle column blank forever because mainTurnOpen blocks the retry.
        const liveLacksUser = !messagesRef.current.some(message => message.role === 'user')
        const historyHasUser = reconciliation.messages.some(message => message.role === 'user')
        if (!(liveLacksUser && historyHasUser)) {
          if (!mainTurnOpenRef.current && !staleRetryScheduled) {
            staleRetryScheduled = true
            staleRetryTimer = window.setTimeout(() => {
              if (historyLoadRef.current === request
                && historyContextRef.current?.host === host
                && historyContextRef.current.sessionId === selectedSession) {
                freezeProbe('history_refresh', { reason: 'stale_request_retry', session: selectedSession })
                setHistoryRefreshKey(key => key + 1)
              }
            }, 0)
          }
          return
        }
      }
      if (reconciliation.status === 'unchanged') {
        resumeOrCloseLostSettle(reconciliation.messages)
        applyRestoredOpenHop(messagesRef.current)
        return
      }
      const next = reconciliation.messages
      historyFingerprintBySessionRef.current.set(selectedSession, reconciliation.fingerprint)
      if (transcriptFingerprint(messagesRef.current) === reconciliation.fingerprint) {
        resumeOrCloseLostSettle(next)
        // The first accepted durable final may already be byte-for-byte equal
        // to the live transcript (the D exact-abort trace did this). It is still
        // a newly advanced disk snapshot, so require one bounded unchanged pull
        // before closing the scalar turn instead of waiting forever for a
        // replacement which will never occur.
        if (previousFingerprint !== reconciliation.fingerprint) scheduleSettledReplacementConfirmation(next)
        applyRestoredOpenHop(messagesRef.current)
        return
      }
      const liveBefore = messagesRef.current
      const restored = restoreOpenHop(next, liveBefore)
      const retained = restored
      messagesBySessionRef.current.set(selectedSession, retained)
      setMessages(retained)
      messagesRef.current = retained
      if (resumedRunning) {
        if (historyConfirmsLostSettle(next, liveBefore)) closeLostSettle()
        else {
          openResumeWait(liveBefore, retained)
          scheduleSettledReplacementConfirmation(retained)
        }
      } else {
        const last = assistantBeforeTrailingCompactions(retained)
        turnJustSettledRef.current = Boolean(last && last.role === 'assistant' && !last.streaming)
      }
    }
    // Cache is an immediate rendering optimization, never the source of truth.
    // Re-read JSONL on every selection/reconnect and after terminal status so
    // missed/coalesced stream events converge without another live token.
    if (!knownNewEmptySession) {
      historyCompleteBySessionRef.current.set(selectedSession, false)
      void (async () => {
        try {
          freezeProbeHistoryIpcStart({ session: selectedSession, page: 'latest' })
          let page: HistoryEntry[]
          try {
            page = await host.getSessionHistory(selectedSession)
          } finally {
            freezeProbeHistoryIpcEnd({ session: selectedSession })
          }
          if (historyLoadRef.current !== request) return
          if (page.length === 0) {
            const cachedMessages = messagesBySessionRef.current.get(selectedSession)
            const hasCached = (cachedMessages?.length ?? 0) > 0
            const emptyRetries = emptyPageRetriesBySessionRef.current.get(selectedSession) ?? 0
            if (!hasCached && emptyRetries < 1) {
              emptyPageRetriesBySessionRef.current.set(selectedSession, emptyRetries + 1)
              emptyPageRetryTimer = window.setTimeout(() => {
                if (historyLoadRef.current === request
                  && historyContextRef.current?.host === host
                  && historyContextRef.current.sessionId === selectedSession) {
                  freezeProbe('history_refresh', { reason: 'empty_page_retry', session: selectedSession })
                  setHistoryRefreshKey(key => key + 1)
                }
              }, 250)
              return
            }
            if (!hasCached) {
              historyEntriesBySessionRef.current.set(selectedSession, [])
              applyHistory([])
            }
            historyCursorBySessionRef.current.delete(selectedSession)
            historyCompleteBySessionRef.current.set(selectedSession, true)
            return
          }

          emptyPageRetriesBySessionRef.current.delete(selectedSession)
          // Preserve already fetched older pages only when the refreshed newest
          // page overlaps the same branch. A rewrite/branch switch with no
          // overlap deliberately drops the stale prefix.
          const existing = historyEntriesBySessionRef.current.get(selectedSession) ?? []
          const overlap = existing.findIndex(entry => entry.id === page[0]?.id)
          const accumulated = page.length === HISTORY_PAGE_SIZE && overlap >= 0
            ? [...existing.slice(0, overlap), ...page]
            : page
          historyEntriesBySessionRef.current.set(selectedSession, accumulated)
          applyHistory(accumulated)
          if (page.length < HISTORY_PAGE_SIZE) {
            historyCursorBySessionRef.current.delete(selectedSession)
            historyCompleteBySessionRef.current.set(selectedSession, true)
            return
          }
          const nextBefore = accumulated[0]?.id
          if (!nextBefore) throw new Error('主机返回了无效的会话历史游标')
          historyCursorBySessionRef.current.set(selectedSession, nextBefore)
          historyCompleteBySessionRef.current.set(selectedSession, false)
        } catch (error) {
          if (historyLoadRef.current !== request) return
          historyCompleteBySessionRef.current.set(selectedSession, false)
          setProjectError(`读取会话记录失败：${error instanceof Error ? error.message : String(error)}`)
          // Keep a cached transcript or any successfully loaded newer pages.
        }
      })()
    }
    void host.getSessionLease(selectedSession).then(lease => { if (historyLoadRef.current === request) setLease(lease) }).catch(() => { if (historyLoadRef.current === request) setLease(null) })
    return () => {
      if (staleRetryTimer !== undefined) window.clearTimeout(staleRetryTimer)
      if (emptyPageRetryTimer !== undefined) window.clearTimeout(emptyPageRetryTimer)
      if (settleConfirmRetryTimer !== undefined) window.clearTimeout(settleConfirmRetryTimer)
    }
  }, [historyRefreshKey, host, selectedSession, sessionQueue.resync])
  const loadOlderHistory = useCallback(() => {
    const sessionId = selectedSessionRef.current
    if (!sessionId) return
    if (mainTurnOpenRef.current || historyCompleteBySessionRef.current.get(sessionId) === true) return
    if (historyOlderLoadInFlightRef.current.has(sessionId)) return
    const before = historyCursorBySessionRef.current.get(sessionId)
    if (!before) return

    const request = historyLoadRef.current
    const requestLiveRevision = transcriptLiveRevisionRef.current
    historyOlderLoadInFlightRef.current.add(sessionId)
    freezeProbeHistoryIpcStart({ session: sessionId, page: before })
    void host.getSessionHistory(sessionId, before, HISTORY_PAGE_SIZE).then(page => {
      if (historyLoadRef.current !== request || selectedSessionRef.current !== sessionId) return
      if (page.length === 0) {
        historyCursorBySessionRef.current.delete(sessionId)
        historyCompleteBySessionRef.current.set(sessionId, true)
        return
      }
      const currentEntries = historyEntriesBySessionRef.current.get(sessionId) ?? []
      if (currentEntries[0]?.id !== before) return
      const accumulated = [...page, ...currentEntries]
      const previousFingerprint = historyFingerprintBySessionRef.current.get(sessionId)
      const reconciliation = reconcileHistorySnapshot(
        accumulated,
        requestLiveRevision,
        transcriptLiveRevisionRef.current,
        previousFingerprint,
        messagesRef.current,
      )
      if (reconciliation.status === 'stale-request' || reconciliation.status === 'retained-longer-live') return

      historyEntriesBySessionRef.current.set(sessionId, accumulated)
      if (page.length < HISTORY_PAGE_SIZE) {
        historyCursorBySessionRef.current.delete(sessionId)
        historyCompleteBySessionRef.current.set(sessionId, true)
      } else {
        const nextBefore = page[0]?.id
        if (!nextBefore || nextBefore === before) throw new Error('主机返回了无效的会话历史游标')
        historyCursorBySessionRef.current.set(sessionId, nextBefore)
        historyCompleteBySessionRef.current.set(sessionId, false)
      }
      if (reconciliation.status === 'unchanged') return
      historyFingerprintBySessionRef.current.set(sessionId, reconciliation.fingerprint)
      const retained = reconciliation.messages
      messagesBySessionRef.current.set(sessionId, retained)
      messagesRef.current = retained
      setMessages(retained)
    }).catch(error => {
      if (historyLoadRef.current !== request || selectedSessionRef.current !== sessionId) return
      if (error instanceof Error && error.message.includes('history cursor no longer exists')) {
        setHistoryRefreshKey(key => key + 1)
        return
      }
      setProjectError(`读取更早会话记录失败：${error instanceof Error ? error.message : String(error)}`)
    }).finally(() => {
      freezeProbeHistoryIpcEnd({ session: sessionId })
      historyOlderLoadInFlightRef.current.delete(sessionId)
    })
  }, [host])
  useEffect(() => {
    if (!selectedSession || !leaseConflictError) return
    let cancelled = false
    void host.getSessionLease(selectedSession).then(next => {
      if (!cancelled) setLease(next)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [host, selectedSession, leaseConflictError])
  useEffect(() => {
    // Runs after the history-load effect above and the stream-subscription effect
    // below: by the next macrotask the new session's transcript and live events
    // are wired, so the pending auto-send prompt can be dispatched safely.
    const pending = pendingAutoSendRef.current
    if (!pending || pending.sessionId !== selectedSession) return
    pendingAutoSendRef.current = null
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          mutateLocalTranscript(items => [...items, { id: crypto.randomUUID(), role: 'user', content: pending.prompt, images: pending.attachments?.length ? pending.attachments.map(attachment => ({ data: attachment.url, mimeType: attachment.mimeType })) : undefined, timestamp: Date.now() }])
          activeUserTurnRef.current = true
          mainTurnOpenRef.current = true
          mainTurnEpochRef.current += 1
          applyObservedStatus(pending.sessionId, 'running')
          setStreaming(true)
          setWaitingStartedAt(Date.now())
          setWaitingVisible(true)
          setWaitingPhase('awaiting')
          setWaitingDetail(undefined)
          setSessions(current => current.map(session => session.id === pending.sessionId ? { ...session, updatedAt: Date.now() } : session))
          pending.telemetry.preflightStartedAt = Date.now()
          const payload = pending.attachments?.length ? await Promise.all(pending.attachments.map(toPromptAttachment)) : undefined
          if (payload?.length) {
            const converted = chatImagesFromAttachments(payload)
            mutateLocalTranscript(items => items.map(message => message.images?.some(image => image.data.startsWith('blob:')) ? { ...message, images: converted } : message))
          }
          const documentPaths = pending.documents?.map(document => document.path).filter(Boolean) ?? []
          if (documentPaths.length) await host.notifyComposerDocumentsDropped?.(pending.sessionId, documentPaths)?.catch(error => console.warn('[composer-docs]', error))
          finishRendererPreflight(pending.telemetry, payload)
          if (payload?.length) await host.sendPrompt(pending.sessionId, pending.prompt, payload, pending.telemetry)
          else await host.sendPrompt(pending.sessionId, pending.prompt, undefined, pending.telemetry)
        } catch (error) {
          activeUserTurnRef.current = false
          mainTurnOpenRef.current = false
          if (observedSessionStatusesRef.current[pending.sessionId] === 'running') applyObservedStatus(pending.sessionId, 'completed')
          setStreaming(false)
          setWaitingVisible(false)
          setWaitingStartedAt(null)
          setWaitingDetail(undefined)
          setProjectError(`发送失败：${hostOperationError(error)}`)
        }
      })()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [host, mutateLocalTranscript, selectedSession])
  useEffect(() => {
    if (!selectedSession) return
    let active = true
    let terminalReconcileTimer: number | undefined
    let terminalReconcilePending = false
    const scheduleTerminalReconciliation = () => {
      if (terminalReconcilePending) return
      terminalReconcilePending = true
      freezeProbe('history_refresh', { reason: 'terminal_immediate', session: selectedSession })
      setHistoryRefreshKey(key => key + 1)
      terminalReconcileTimer = window.setTimeout(() => {
        terminalReconcilePending = false
        if (active
          && selectedSessionRef.current === selectedSession
          && historyContextRef.current?.host === host) {
          freezeProbe('history_refresh', { reason: 'terminal_trailing', session: selectedSession })
          setHistoryRefreshKey(key => key + 1)
        }
      }, 250)
    }
    const coalescer = new StreamEventCoalescer({ onEvent: event => {
      if (event.type === 'queue_update') {
        sessionQueue.acceptStreamEvent(event)
        return
      }
      if (event.type === 'session_title') {
        markSessionTitleMutation(event.sessionId)
        setSessions(current => current.map(session => session.id === event.sessionId
          ? { ...session, name: event.title, updatedAt: Date.now() }
          : session))
        return
      }
      if (event.type === 'compaction') {
        // Notice-only events (compaction check / idle-fold nudge / skip) never
        // ran anything: no transcript line, no pill — and never “已压缩”.
        if (event.executed === false) return
        if (event.phase === 'start') {
          // In-progress state lives in the pill only; the transcript gets one
          // completion line per compaction instead of a start+end pair.
          setCompacting(true)
          setCompactingLabel(compactionPillLabel(event))
          return
        }
        setCompacting(false)
        setCompactingLabel(null)
        transcriptLiveRevisionRef.current += 1
        const next = [...messagesRef.current, { id: crypto.randomUUID(), role: 'tool' as const, content: compactionNotice(event) }]
        messagesRef.current = next
        setMessages(next)
        // Post-compaction pi reports null tokens until the next assistant usage;
        // pull one authoritative snapshot so the pill drops the stale number.
        setStatsRefreshKey(key => key + 1)
        return
      }
      if (event.type === 'secret_redact') {
        const next = applySecretRedact(messagesRef.current, event.messages)
        if (next !== messagesRef.current) {
          transcriptLiveRevisionRef.current += 1
          messagesRef.current = next
          messagesBySessionRef.current.set(event.sessionId, next)
          setMessages(next)
        }
        return
      }
      if (event.type === 'user_message') {
        const pendingEcho = pendingLocalUserRef.current
        pendingLocalUserRef.current = null
        const next = appendLiveUserMessage(messagesRef.current, event, pendingEcho ?? undefined)
        if (next !== messagesRef.current) transcriptLiveRevisionRef.current += 1
        messagesRef.current = next
        setMessages(next)
        // A real follow-up (queue drain or a triggerTurn wake) can land after a
        // bare `started` was ignored as a ghost. Reopen the turn so later
        // tools in the same tick are not dropped as `turnClosed`. A late
        // terminal/heartbeat/stalled `[subagent-*]` row after a closed turn is
        // only a projection — it has no new epoch or later settle.
        const subagentSignal = parseSubagentSignal(event.content)
        const drainedPrompt = !pendingEcho && Boolean(event.content.trim())
        const alreadyRunning = mainTurnOpenRef.current
          || activeUserTurnRef.current
          || observedSessionStatusesRef.current[event.sessionId] === 'running'
        if ((subagentSignal || drainedPrompt) && shouldOpenTurnOnUserMessage(event.content, alreadyRunning)) {
          // A host-drained prompt is a new completion epoch even if a lost
          // settle left the prior turn marked open. Its later agent terminal
          // must never reconcile the new prompt against old history.
          if (!pendingEcho) mainTurnEpochRef.current += 1
          // A host-drained prompt is a new completion epoch even if a lost
          // settle left the prior turn marked open. Its later agent terminal
          // must never reconcile the new prompt against old history.
          if (!activeUserTurnRef.current) {
            activeUserTurnRef.current = true
            mainTurnOpenRef.current = true
            turnJustSettledRef.current = false
            applyObservedStatus(event.sessionId, 'running')
            setStreaming(true)
            setWaitingStartedAt(Date.now())
            setWaitingVisible(true)
          }
          setWaitingPhase(subagentSignal ? 'followup' : waitingPhaseForTurn(next, [event.content]))
        }
        return
      }
      if (event.type === 'status') {
        const terminal = event.status === 'settled' || event.status === 'stopped'
        const openedTurnEpoch = openedTurnEpochBySessionRef.current.get(event.sessionId)
        // Durable history recovery is independent of whether this terminal is
        // allowed to mutate the currently open turn. A renderer which missed
        // the matching start must still pull the persisted final assistant.
        if (terminal) scheduleTerminalReconciliation()
        // A late `streaming` after settle is a follow-up-list update, not a new
        // turn. Ignoring it keeps the composer idle instead of 生成中 with no work.
        if (event.status === 'streaming' && !mainTurnOpenRef.current) return
        // Bare started after a finished assistant is a ghost turn (duplicate
        // agent_start, or App restart which resets turnJustSettledRef). A newer
        // backend epoch is authoritative even when its triggerTurn user row has
        // not arrived yet and pendingFollowUps is empty.
        if (event.status === 'started' && !shouldOpenWaitOnStarted(messagesRef.current, event.pendingFollowUps, event.turnEpoch, openedTurnEpoch)) return
        if (staleTurnTerminal(event, openedTurnEpoch)) return
        const sidebarStatus: SessionStatus = event.status === 'started' || event.status === 'streaming'
          ? 'running'
          : event.status === 'settled' ? 'completed' : 'interrupted'
        applyObservedStatus(event.sessionId, sidebarStatus)
        if (event.status === 'started' || event.status === 'streaming') {
          if (event.status === 'started') {
            if (!mainTurnOpenRef.current) mainTurnEpochRef.current += 1
            if (event.turnEpoch !== undefined) openedTurnEpochBySessionRef.current.set(event.sessionId, event.turnEpoch)
            mainTurnOpenRef.current = true
            turnJustSettledRef.current = false
            const continued = reopenAssistantForNextCompletion(messagesRef.current)
            if (continued !== messagesRef.current) {
              transcriptLiveRevisionRef.current += 1
              messagesRef.current = continued
              setMessages(continued)
            }
          }
          setStreaming(true)
          setSessions(current => current.map(session => session.id === event.sessionId ? { ...session, updatedAt: Date.now() } : session))
          // Any active main turn owns the wait, not just a local send. Follow-ups
          // after visible assistant output use `continuing` so the copy does not
          // claim to wait for the first response. A tool-ended hop is thinking.
          if (!activeUserTurnRef.current) {
            const last = messagesRef.current[messagesRef.current.length - 1]
            activeUserTurnRef.current = true
            setWaitingStartedAt(Date.now())
            setWaitingVisible(true)
            setWaitingPhase(last && assistantEndedAwaitingModel(last)
              ? 'thinking'
              : waitingPhaseForTurn(messagesRef.current, event.pendingFollowUps))
            setWaitingDetail(undefined)
          }
        }
        if (terminal) {
          closeOpenTurnRef.current(event.sessionId, sidebarStatus === 'completed' ? 'completed' : 'interrupted')
        }
        return
      }
      // Thinking and tool runs live inside folded cards — keep the placeholder
      // visible with an appropriate phase so the user never sees a silent gap
      // between the turn start and the first readable text. Only real text
      // output ends the first-token wait (streaming itself keeps going until
      // settled/stopped, which the Composer reflects). After the last tool
      // finishes, openai-completions providers often generate the next step
      // with no thinking/text deltas — reopen a thinking wait so the tail
      // does not look idle while the composer still says 生成中.
      const turnClosed = !mainTurnOpenRef.current && (
        observedSessionStatusesRef.current[event.sessionId] === 'completed'
        || observedSessionStatusesRef.current[event.sessionId] === 'interrupted'
      )
      if (turnClosed) {
        // Do not drop late live events after settle — they would otherwise wait
        // for the 250ms history reconcile and appear as "stuck then flood".
        // Apply them to the live transcript only. Reloading JSONL on every
        // thinking/text delta stacked overlapping full-file scans on large
        // sessions and froze the main process.
        const isLiveContent = event.type === 'presentation' || event.type === 'text' || event.type === 'thinking' || event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'hosted_search' || event.type === 'hosted_code_interpreter' || event.type === 'citations' || event.type === 'input_file_sources' || event.type === 'error'
        if (isLiveContent) {
          const lateNext = applyStreamEvent(messagesRef.current, event)
          if (lateNext !== messagesRef.current) {
            transcriptLiveRevisionRef.current += 1
            messagesRef.current = lateNext
            setMessages(lateNext)
          }
          if (event.type === 'text' && event.delta.trim()) setWaitingVisible(false)
          else if (event.type === 'thinking') { setWaitingVisible(true); setWaitingPhase('thinking'); setWaitingDetail(undefined) }
          else if (event.type === 'tool_call') { setWaitingVisible(true); setWaitingPhase('tool'); if (event.name === 'subagent') setWaitingDetail('子任务执行中'); else setWaitingDetail(toolDisplaySummary(event.name, event.delta ?? '')) }
          else if (event.type === 'hosted_search') { setWaitingVisible(true); setWaitingPhase('tool'); setWaitingDetail(toolDisplaySummary(event.kind, JSON.stringify({ query: event.query, phase: event.phase }))) }
          else if (event.type === 'hosted_code_interpreter' && event.phase !== 'completed' && event.phase !== 'failed') { setWaitingVisible(true); setWaitingPhase('tool'); setWaitingDetail(toolDisplaySummary('code_interpreter', JSON.stringify({ code: event.code, phase: event.phase }))) }
          else if (event.type === 'tool_result') { if (streamingAssistantToolsAllFinished(messagesRef.current)) { setWaitingVisible(true); setWaitingStartedAt(Date.now()); setWaitingPhase('thinking'); setWaitingDetail(undefined) } else setWaitingPhase('tool') }
          freezeProbe('late_live_applied', { session: event.sessionId, type: event.type })
          return
        }
        return
      }
      const next = applyStreamEvent(messagesRef.current, event)
      if (next !== messagesRef.current) {
        transcriptLiveRevisionRef.current += 1
        messagesRef.current = next
        setMessages(next)
      }
      if (event.type === 'text') {
        if (event.delta.trim()) setWaitingVisible(false)
      } else if (event.type === 'thinking') {
        setWaitingVisible(true)
        setWaitingPhase('thinking')
        setWaitingDetail(undefined)
      } else if (event.type === 'tool_call') {
        setWaitingVisible(true)
        setWaitingPhase('tool')
        if (event.name === 'subagent') setWaitingDetail('子任务执行中')
        else setWaitingDetail(toolDisplaySummary(event.name, event.delta ?? ''))
      } else if (event.type === 'hosted_search') {
        setWaitingVisible(true)
        setWaitingPhase('tool')
        setWaitingDetail(toolDisplaySummary(event.kind, JSON.stringify({ query: event.query, phase: event.phase })))
      } else if (event.type === 'hosted_code_interpreter') {
        if (event.phase === 'completed' || event.phase === 'failed') {
          if (streamingAssistantToolsAllFinished(messagesRef.current)) {
            setWaitingVisible(true)
            setWaitingStartedAt(Date.now())
            setWaitingPhase('thinking')
            setWaitingDetail(undefined)
          } else {
            setWaitingPhase('tool')
          }
        } else {
          setWaitingVisible(true)
          setWaitingPhase('tool')
          setWaitingDetail(toolDisplaySummary('code_interpreter', JSON.stringify({ code: event.code, phase: event.phase })))
        }
      } else if (event.type === 'tool_result') {
        if (streamingAssistantToolsAllFinished(messagesRef.current)) {
          setWaitingVisible(true)
          setWaitingStartedAt(Date.now())
          setWaitingPhase('thinking')
          setWaitingDetail(undefined)
        } else {
          setWaitingPhase('tool')
        }
      } else if (event.type === 'auto_retry') {
        // pi is backing off and retrying a failed provider call inside the open
        // turn. The turn is NOT over (queued messages correctly keep waiting for
        // its settle); surface the retry so the silence never reads as a wedged
        // send. End reverts to thinking: the model restarts, or the turn's error
        // message lands right after retries are exhausted.
        if (event.phase === 'start') {
          setWaitingVisible(true)
          const span = event.attempt !== undefined && event.maxAttempts !== undefined
            ? `第 ${event.attempt}/${event.maxAttempts} 次重试`
            : undefined
          setWaitingDetail([span, event.error].filter(Boolean).join(' · ') || undefined)
          setWaitingPhase('retrying')
        } else {
          setWaitingPhase('thinking')
          setWaitingDetail(undefined)
        }
      }
    } })
    // Background (non-selected) sessions still owe the sidebar their main-agent
    // status: a settle that lands while another session is selected must not
    // leave a sticky 「进行中」 row, and a turn started elsewhere must show. This
    // is a side channel only — the filtered subscription below keeps delivering
    // the selected stream, and every transcript/waiting mutation in this effect
    // assumes that one stream. Old hosts without subscribeAllStreams simply
    // keep the previous selected-only behavior.
    const unsubscribeBackground = host.subscribeAllStreams?.(event => {
      if (event.sessionId === selectedSession) return
      if (event.type === 'secret_redact') {
        const current = messagesBySessionRef.current.get(event.sessionId)
        if (current) {
          const next = applySecretRedact(current, event.messages)
          if (next !== current) messagesBySessionRef.current.set(event.sessionId, next)
        }
        return
      }
      if (event.type === 'user_message') {
        if (shouldOpenTurnOnUserMessage(event.content, observedSessionStatusesRef.current[event.sessionId] === 'running')) {
          applyObservedStatus(event.sessionId, 'running')
        }
        return
      }
      if (event.type === 'status') {
        const openedTurnEpoch = openedTurnEpochBySessionRef.current.get(event.sessionId)
        // Late `streaming` after settle is a follow-up-list update, not a new turn.
        if (event.status === 'streaming' && observedSessionStatusesRef.current[event.sessionId] !== 'running') return
        // Bare started after a finished assistant is a ghost (duplicate agent_start).
        if (event.status === 'started' && !shouldOpenWaitOnStarted(messagesBySessionRef.current.get(event.sessionId) ?? [], event.pendingFollowUps, event.turnEpoch, openedTurnEpoch)) return
        if (staleTurnTerminal(event, openedTurnEpoch)) return
        if (event.status === 'started' && event.turnEpoch !== undefined) {
          openedTurnEpochBySessionRef.current.set(event.sessionId, event.turnEpoch)
        }
        const backgroundStatus: SessionStatus = event.status === 'started' || event.status === 'streaming'
          ? 'running'
          : event.status === 'settled' ? 'completed' : 'interrupted'
        applyObservedStatus(event.sessionId, backgroundStatus)
        // The cached transcript of a backgrounded session is restored verbatim
        // on the next select. A terminal status has to close its assistant rows
        // here — `closeOpenTurn` only ever runs for the selected session, so an
        // unswept row keeps spinning behind an idle composer forever.
        if (backgroundStatus !== 'running') {
          const cached = messagesBySessionRef.current.get(event.sessionId)
          if (cached) {
            const settled = finishStreamingMessage(cached)
            if (settled !== cached) messagesBySessionRef.current.set(event.sessionId, settled)
          }
        }
        return
      }
      if (event.type === 'session_title') {
        markSessionTitleMutation(event.sessionId)
        setSessions(current => current.map(session => session.id === event.sessionId
          ? { ...session, name: event.title, updatedAt: Date.now() }
          : session))
      }
    })
    const unsubscribe = host.subscribeStream(selectedSession, event => {
      if (event.sessionId !== selectedSessionRef.current) return
      coalescer.push(event)
    })
    return () => {
      active = false
      if (terminalReconcileTimer !== undefined) window.clearTimeout(terminalReconcileTimer)
      unsubscribeBackground?.()
      unsubscribe()
      coalescer.dispose()
    }
  }, [applyObservedStatus, host, markSessionTitleMutation, selectedSession, sessionQueue.acceptStreamEvent])
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(widths)) }, [widths])
  // A pack that names an `auxiliarySidebar` is saying that panel is where the right pane
  // lives in this product -- PipiCOC's investigator sheet is part of the table, not a tool
  // the player has to go find. So the pane opens on it every time the pack becomes active,
  // even when a collapse persisted from another product or an earlier run. It is a starting
  // position, not a lock: collapsing it during the run still sticks.
  const openedAuxiliaryPanelRef = useRef('')
  useEffect(() => {
    if (defaultProductPanel === DEFAULT_PANEL_TAB) return
    if (openedAuxiliaryPanelRef.current === defaultProductPanel) return
    openedAuxiliaryPanelRef.current = defaultProductPanel
    setWidths(current => current.toolsCollapsed ? { ...current, toolsCollapsed: false } : current)
  }, [defaultProductPanel])
  // Auto-collapse is the narrow-width default on every entry (Swift sidebarCollapseWidth).
  useEffect(() => { if (narrowViewport) setNarrowPanes({ sidebar: false, tools: false }) }, [narrowViewport])

  // Overlay-scrollbar scroll tracking (Swift OverlayScrollers parity).
  // Adds .pipiui-scrolling to any element that is actively scrolling so the
  // CSS overlay scrollbar brightens during scroll.  Uses capture phase on
  // both document and window because the native scroll event does not bubble
  // and some containers (e.g. react-virtuoso internals) may target either.
  useEffect(() => {
    const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>()
    const onScroll = (event: Event) => {
      const target = event.target
      if (!target || target === document || target === window) return
      if (!(target instanceof Element)) return
      target.classList.add('pipiui-scrolling')
      const prev = timers.get(target)
      if (prev !== undefined) clearTimeout(prev)
      timers.set(target, setTimeout(() => { target.classList.remove('pipiui-scrolling') }, 1200))
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [])

  const sidebarCollapsed = narrowViewport ? !narrowPanes.sidebar : widths.sidebarCollapsed
  const toolsCollapsed = narrowViewport ? !narrowPanes.tools : widths.toolsCollapsed
  const selectedProjectPath = projects.find(project => project.id === selectedProject)?.path
  useEffect(() => () => { if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current) }, [])

  const stopSelectedSession = useCallback(() => {
    const targetSession = selectedSession
    if (!targetSession || stoppingSessionRef.current === targetSession) return
    stoppingSessionRef.current = targetSession
    setStopError(current => current?.sessionId === targetSession ? null : current)
    closeOpenTurn(targetSession, 'interrupted', { keepStopGuard: true })
    void host.stop(targetSession).then(() => {
      if (stoppingSessionRef.current === targetSession) stoppingSessionRef.current = null
    }).catch(error => {
      if (stoppingSessionRef.current !== targetSession) return
      stoppingSessionRef.current = null
      setStopError({ sessionId: targetSession, message: `停止失败：${error instanceof Error ? error.message : String(error)}` })
    })
  }, [closeOpenTurn, host, selectedSession])

  /** First-open / empty "新会话" has no session id. Send, model, and thinking
   *  chips still mount, so create the session before any 3-arg host call.
   *  `beforeSelect` runs before setSelectedSession so callers can arm effects
   *  that key on the new id (auto-send must not race the render). */
  const ensureSession = async (beforeSelect?: (sessionId: string) => void): Promise<string | null> => {
    if (selectedSession) return selectedSession
    if (!selectedProject) return null
    const resolvedProject = await resolvePendingProjectId(selectedProject)
    if (!resolvedProject) {
      setProjectError('项目还在添加中，请稍后再试')
      return null
    }
    const session = await host.newSession(resolvedProject)
    locallyCreatedSessionIdsRef.current.add(session.id)
    messagesBySessionRef.current.set(session.id, [])
    historyEntriesBySessionRef.current.set(session.id, [])
    historyCursorBySessionRef.current.delete(session.id)
    historyCompleteBySessionRef.current.set(session.id, true)
    beforeSelect?.(session.id)
    setSessions(items => [session, ...items])
    setSidebarSessionIdsByProject(current => ({ ...current, [resolvedProject]: [session.id, ...(current[resolvedProject] ?? []).filter(id => id !== session.id)] }))
    setSelectedProject(resolvedProject)
    setSelectedSession(session.id)
    setSidebarExpandedIds(current => current.includes(resolvedProject) ? current : [...current, resolvedProject])
    return session.id
  }

  const send = async (draft: string, attachments?: ComposerAttachment[], documents?: ComposerDocument[], hasReadyInputFiles = false) => {
    const documentPaths = documents?.map(document => document.path).filter(Boolean) ?? []
    const prompt = draft.trim() || (documentPaths.length ? DEFAULT_COMPOSER_DOCUMENT_PROMPT : hasReadyInputFiles ? DEFAULT_COMPOSER_INPUT_FILES_PROMPT : '')
    if (!prompt && !attachments?.length) return false
    const telemetry = createRendererTurnTelemetry(prompt, attachments?.length ?? 0, documentPaths.length)
    let targetSession: string | null = selectedSession
    if (!targetSession) {
      // Empty "新会话" state used to make Send a silent no-op; create the session
      // in the selected project and dispatch the prompt as soon as it is selected.
      // No lease exists yet in this state, so the write gate below must not apply.
      targetSession = await ensureSession(sessionId => {
        pendingAutoSendRef.current = { sessionId, prompt, attachments, documents, telemetry }
      })
      if (!targetSession) return false
      return true
    }
    if (!canWriteLease) return false
    const beginDirectTurn = () => {
      const localUserId = crypto.randomUUID()
      pendingLocalUserRef.current = { id: localUserId, content: prompt }
      mutateLocalTranscript(items => [...items, { id: localUserId, role: 'user', content: prompt, images: attachments?.length ? attachments.map(attachment => ({ data: attachment.url, mimeType: attachment.mimeType })) : undefined, timestamp: Date.now() }])
      activeUserTurnRef.current = true
      mainTurnOpenRef.current = true
      mainTurnEpochRef.current += 1
      // The sidebar row of a backgrounded session must flip to 进行中 before the
      // first status event arrives — a send followed by an immediate switch away
      // would otherwise look idle for the whole turn.
      applyObservedStatus(targetSession, 'running')
      setStreaming(true)
      setWaitingStartedAt(Date.now())
      setWaitingVisible(true)
      setWaitingPhase('awaiting')
      setWaitingDetail(undefined)
      setSessions(current => current.map(session => session.id === targetSession ? { ...session, updatedAt: Date.now() } : session))
    }
    const resetFailedDirectTurn = () => {
      activeUserTurnRef.current = false
      mainTurnOpenRef.current = false
      if (observedSessionStatusesRef.current[targetSession] === 'running') applyObservedStatus(targetSession, 'completed')
      setStreaming(false)
      setWaitingVisible(false)
      setWaitingStartedAt(null)
      setWaitingDetail(undefined)
    }

    // The optimistic bubble previews pasted images via their object URLs; once
    // the base64 payload is read, swap the previews for the durable data URLs.
    // (The bubble id may already have been replaced by the server echo, so match
    // by the blob: preview marker instead of the local id.)
    const patchOptimisticImages = (payload: PromptAttachment[]) => {
      const converted = chatImagesFromAttachments(payload)
      mutateLocalTranscript(items => items.map(message => message.images?.some(image => image.data.startsWith('blob:')) ? { ...message, images: converted } : message))
    }

    if (sessionQueue.busy || leftoverQueued) {
      // Ordinary Send while the Boss is busy is FIFO-only. The explicit
      // “立即发送” action on a queue row owns interruption; composing a new
      // message must never abort or steer the current Boss turn.
      // The message stays in the queue panel only; it enters the transcript
      // when the queue actually sends it and the real user echo lands.
      try {
        telemetry.preflightStartedAt = Date.now()
        const payload = attachments?.length ? await Promise.all(attachments.map(toPromptAttachment)) : undefined
        if (documentPaths.length) await host.notifyComposerDocumentsDropped?.(targetSession, documentPaths)?.catch(error => console.warn('[composer-docs]', error))
        finishRendererPreflight(telemetry, payload)
        await sessionQueue.enqueue(prompt, payload, telemetry)
        return true
      } catch {
        return false
      }
    }

    beginDirectTurn()
    try {
      telemetry.preflightStartedAt = Date.now()
      if (documentPaths.length) await host.notifyComposerDocumentsDropped?.(targetSession, documentPaths)?.catch(error => console.warn('[composer-docs]', error))
      const payload = attachments?.length ? await Promise.all(attachments.map(toPromptAttachment)) : undefined
      if (payload?.length) patchOptimisticImages(payload)
      finishRendererPreflight(telemetry, payload)
      if (payload?.length) await host.sendPrompt(targetSession, prompt, payload, telemetry)
      else await host.sendPrompt(targetSession, prompt, undefined, telemetry)
      return true
    } catch (error) {
      resetFailedDirectTurn()
      throw error
    }
  }
  const requestUpdate = (prompt: string) => {
    closeModelManager()
    void send(prompt).catch(error => setProjectError(`发送失败：${error instanceof Error ? error.message : String(error)}`))
  }
  /**
   * `/compact`. Progress and the outcome normally arrive as `compaction` stream
   * events; a refusal ("Nothing to compact") never produces one, so the
   * rejection is what the transcript reports.
   */
  const compact = async () => {
    if (!selectedSession || !canWriteLease || !host.compact) return
    setCompacting(true)
    try {
      await host.compact(selectedSession)
    } catch (error) {
      setCompacting(false)
      mutateLocalTranscript(items => [...items, { id: crypto.randomUUID(), role: 'tool', content: `上下文压缩失败：${error instanceof Error ? error.message : String(error)}` }])
    }
  }
  const handleCopy = async (message: ChatMessage) => {
    const text = displaySecretPlaceholders(message.role === 'user' ? stripAttachmentPathsForDisplay(message.content) : message.content)
    if (!text.trim()) return
    await navigator.clipboard.writeText(text)
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
    setCopiedId(message.id)
    copiedTimerRef.current = window.setTimeout(() => {
      setCopiedId(current => current === message.id ? null : current)
      copiedTimerRef.current = null
    }, 1200)
  }
  const handleBranch = async (message: ChatMessage) => {
    if (!selectedSession || !host.invokeExtension || branchBusy) return
    setBranchBusy(true)
    try {
      const result = await host.invokeExtension('coc-keeper','timeline.branch',{messageId:message.id},{sessionId:selectedSession})
      if (!result.ok) throw new Error(result.error?.message || 'Could not create branch')
    } catch (error) { setProjectError(error instanceof Error ? error.message : String(error)) }
    finally { setBranchBusy(false) }
  }
  const branchMessageIds = useMemo<ReadonlySet<string>>(() => new Set<string>((timeline?.anchors ?? []).filter((a:any) => a.sessionId === selectedSession).map((a:any) => a.messageId)), [timeline, selectedSession])
  /* §35 turn illustration. The invoke channel has a 15s ceiling, so only the
   * `generating` answer (or a refusal) ever comes back from illustration.generate;
   * the image itself always arrives via the `illustration-changed` push below. */
  const [illustrations, setIllustrations] = useState<Record<string, IllustrationState>>({})
  const illustrationListLoadedForRef = useRef<string | null>(null)
  // A session switch wipes the map; clearing the seed guard lets a switch-back reseed it.
  useEffect(() => { setIllustrations({}); illustrationListLoadedForRef.current = null }, [selectedSession])
  const messageActionWordsRef = useRef<Record<string,string> | undefined>(undefined)
  messageActionWordsRef.current = timeline?.ui?.words?.['message-actions']
  // Bound, not "ready": a cold graph answer (no live agent yet) carries neither `status` nor
  // `campaign`, while every unbound answer from either path names status "unbound".
  const illustrationGate = Boolean(productId === 'pipicoc' && selectedSession && timeline?.hostSessionId === selectedSession && timeline?.status !== 'unbound' && host.invokeExtension)
  useEffect(() => {
    if (!illustrationGate || !selectedSession || !host.invokeExtension) return
    if (illustrationListLoadedForRef.current === selectedSession) return
    illustrationListLoadedForRef.current = selectedSession
    let cancelled = false
    void host.invokeExtension('coc-keeper','illustration.list',{}, {sessionId:selectedSession}).then(result => {
      if (cancelled || !result.ok) return
      const images = (result.data as {images?: Array<{messageId?: unknown; image?: unknown}>})?.images ?? []
      setIllustrations(current => {
        const next = {...current}
        for (const entry of images) {
          if (typeof entry.messageId === 'string' && typeof entry.image === 'string' && !next[entry.messageId]) next[entry.messageId] = {status:'ready', image:entry.image}
        }
        return next
      })
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [host, selectedSession, illustrationGate])
  useEffect(() => subscribeExt(host, 'coc-keeper', event => {
    if (event?.type !== 'illustration-changed') return
    const payload = (event.payload ?? {}) as {messageId?: unknown; status?: unknown; code?: unknown}
    if (typeof payload.messageId !== 'string') return
    const messageId = payload.messageId
    if (payload.status === 'ready') {
      const sessionId = selectedSessionRef.current
      if (!sessionId || !host.invokeExtension) return
      void host.invokeExtension('coc-keeper','illustration.get',{messageId},{sessionId}).then(result => {
        const image = result.ok ? (result.data as {image?: unknown})?.image : undefined
        if (typeof image === 'string') setIllustrations(current => ({...current, [messageId]: {status:'ready', image}}))
      }).catch(() => undefined)
      return
    }
    if (payload.status === 'error') {
      setIllustrations(current => ({...current, [messageId]: {status:'error', code:typeof payload.code === 'string' ? payload.code : 'unknown'}}))
      setProjectError(messageActionWordsRef.current?.['illustrate_failed'] ?? 'Illustration failed')
    }
  }), [host])
  const handleIllustrate = (message: ChatMessage) => {
    if (!selectedSession || !host.invokeExtension || sessionWorking || branchBusy) return
    if (illustrations[message.id]?.status === 'busy') return
    setIllustrations(current => ({...current, [message.id]: {status:'busy'}}))
    const marked = (message.presentation?.details as { marked_text?: unknown } | undefined)?.marked_text
    const source = typeof marked === 'string' && marked.trim() ? withoutMechanicsMarkers(marked) : message.content
    void host.invokeExtension('coc-keeper','illustration.generate',{messageId:message.id, text:displaySecretPlaceholders(source)}, {sessionId:selectedSession}).then(result => {
      if (result.ok) return // {status:'generating'} — the push settles the row.
      setIllustrations(current => ({...current, [message.id]: {status:'error', code:result.error?.code ?? 'unknown'}}))
      setProjectError(result.error?.message || 'Illustration failed')
    }).catch(error => {
      setIllustrations(current => ({...current, [message.id]: {status:'error', code:'invoke_failed'}}))
      setProjectError(error instanceof Error ? error.message : String(error))
    })
  }
  const illustrationsById = useMemo<ReadonlyMap<string, IllustrationState>>(() => new Map(Object.entries(illustrations)), [illustrations])
  const handleResend = (message: ChatMessage) => {
    // Electron has no fork/resend RPC yet: this deliberately sends a new prompt.
    const text = displaySecretPlaceholders(message.role === 'user' ? stripAttachmentPathsForDisplay(message.content) : message.content)
    void send(text).catch(() => undefined)
  }
  const resendDisabled = Boolean(!canWriteLease || streaming || sessionQueue.busy)

  /** completeAddProject inserts an optimistic `pending-project:<path>` row
   *  before the backend registers the folder. A 新建会话 click in that window
   *  (onboarding button uses `selectedProject || projects[0]?.id`, and the
   *  sidebar row menu passes the pending id) would call host.newSession with
   *  the fake id and fail with `unknown project`. Resolve it by path, waiting
   *  for the in-flight registration to land. */
  const resolvePendingProjectId = async (projectId: string): Promise<string | null> => {
    if (!projectId.startsWith('pending-project:')) return projectId
    const path = projectId.slice('pending-project:'.length)
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const listed = await host.listProjects()
        const found = listed.find(project => project.path === path)
        if (found) return found.id
      } catch { /* transient list failure: keep waiting */ }
      await new Promise(resolve => window.setTimeout(resolve, 250))
    }
    return null
  }
  const newSession = async (projectId = selectedProject) => {
    if (!projectId) return
    if (selectedSession) messagesBySessionRef.current.set(selectedSession, messagesRef.current)
    let session
    try {
      const resolvedId = await resolvePendingProjectId(projectId)
      if (!resolvedId) {
        setProjectError('创建会话失败：项目还在添加中，请稍后再试')
        return
      }
      session = await host.newSession(resolvedId)
      projectId = resolvedId
    } catch (error) {
      setProjectError(`创建会话失败：${hostOperationError(error)}`)
      return
    }
    locallyCreatedSessionIdsRef.current.add(session.id)
    messagesBySessionRef.current.set(session.id, [])
    historyEntriesBySessionRef.current.set(session.id, [])
    historyCursorBySessionRef.current.delete(session.id)
    historyCompleteBySessionRef.current.set(session.id, true)
    setSessions(items => [session, ...items])
    setSidebarSessionIdsByProject(current => ({ ...current, [projectId]: [session.id, ...(current[projectId] ?? []).filter(id => id !== session.id)] }))
    setSelectedProject(projectId)
    setSelectedSession(session.id)
    setSidebarExpandedIds(current => current.includes(projectId) ? current : [...current, projectId])
    setMessages([])
    messagesRef.current = []
    if (narrowViewport) setNarrowPanes(current => ({ ...current, sidebar: false }))
  }
  const completeAddProject = async (normalizedPath: string): Promise<boolean> => {
    // Adding a folder must not silently `git init` it. Non-git projects stay
    // plain folders; writable workers then run in the project directory.
    const snapshot = { projects, sessions, selectedProject, selectedSession }
    const name = normalizedPath.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() || normalizedPath
    const optimistic: Project = { id: `pending-project:${normalizedPath}`, name, path: normalizedPath }
    setProjects(current => current.some(project => project.path === normalizedPath) ? current : [optimistic, ...current])
    setSidebarExpandedIds(current => current.includes(optimistic.id) ? current : [...current, optimistic.id])
    setProjectError(null)
    try {
      await host.addProject!(normalizedPath)
    } catch (error) {
      setProjects(snapshot.projects)
      setSessions(snapshot.sessions)
      setSelectedProject(snapshot.selectedProject)
      setSelectedSession(snapshot.selectedSession)
      setSidebarExpandedIds(current => current.filter(id => id !== optimistic.id))
      setProjectError(`添加项目失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
    try {
      const items = await refreshProjects()
      const added = items.find(project => project.path === normalizedPath)
      if (added) {
        const existing = await host.listSessions(added.id)
        if (existing.length === 0) await newSession(added.id)
      }
      return true
    } catch (error) {
      setProjectError(`添加项目后刷新失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }
  const addProject = async (): Promise<boolean> => {
    if (!host.pickProjectDirectory || !host.addProject) {
      setProjectError('当前连接不支持添加项目')
      return false
    }
    let path: string | null
    try {
      path = await host.pickProjectDirectory()
    } catch (error) {
      setProjectError(`选择项目文件夹失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
    if (!path) return false
    const normalizedPath = path.trim()
    if (!normalizedPath) return false
    return completeAddProject(normalizedPath)
  }
  const removeProject = async (projectId: string) => {
    if (!host.removeProject) {
      setProjectError('当前连接不支持移除项目')
      return
    }
    const snapshot = { projects, sessions, selectedProject, selectedSession }
    const remainingProjects = projects.filter(project => project.id !== projectId)
    const remainingSessions = sessions.filter(session => session.projectId !== projectId)
    const fallbackProjectId = remainingProjects[0]?.id ?? ''
    const fallbackSessionId = remainingSessions.find(session => session.projectId === fallbackProjectId)?.id ?? remainingSessions[0]?.id ?? ''
    setProjects(remainingProjects)
    setSessions(remainingSessions)
    setSidebarExpandedIds(current => current.filter(id => id !== projectId))
    setPinnedSessionIds(current => current.filter(id => remainingSessions.some(session => session.id === id)))
    if (selectedProject === projectId) setSelectedProject(fallbackProjectId)
    if (!remainingSessions.some(session => session.id === selectedSession)) setSelectedSession(fallbackSessionId)
    setProjectError(null)
    try {
      await host.removeProject(projectId)
    } catch (error) {
      setProjects(snapshot.projects)
      setSessions(snapshot.sessions)
      setSelectedProject(snapshot.selectedProject)
      setSelectedSession(snapshot.selectedSession)
      setProjectError(`移除项目失败：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    try {
      await refreshProjects()
    } catch (error) {
      setProjectError(`移除项目后刷新失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const sidebarSessionById = useMemo(() => {
    const mapped = new Map<string, SidebarSession>()
    for (const session of sessions) {
      const model = sidebarModelForSession(session, selectedSession, modelState?.model ?? null, sessionModels)
      const status = sidebarStatusForSession(session.id, selectedSession, streaming, observedSessionStatuses[session.id], sidebarAgents)
      mapped.set(session.id, { id: session.id, projectId: session.projectId, title: session.name, parentSessionId: session.cocWorldline?.parentSessionId, provider: model.provider, modelId: model.modelId, status: status.status, subagentCount: status.subagentCount, updatedAt: session.updatedAt, ...(session.workspace ? { aheadOfMain: session.workspace.aheadOfMain } : {}) })
    }
    return mapped
  }, [modelState, observedSessionStatuses, selectedSession, sessionModels, sessions, sidebarAgents, streaming])
  const pinnedSessionIdSet = useMemo(() => new Set(pinnedSessionIds), [pinnedSessionIds])
  const archivedSessionIdSet = useMemo(() => new Set(archivedSessionIds), [archivedSessionIds])
  const pinnedSidebarSessions = useMemo(() => sessionsByActivityAndManualOrder(
    pinnedSessionIds.flatMap(id => {
      const session = sidebarSessionById.get(id)
      return session ? [session] : []
    })
  ), [pinnedSessionIds, sidebarSessionById])
  // Archived sessions are global (not per-project), Swift archivedSessionsSection parity.
  const archivedSidebarSessions = useMemo(() => archivedSessionIds.flatMap(id => {
    const session = sidebarSessionById.get(id)
    return session ? [session] : []
  }), [archivedSessionIds, sidebarSessionById])
  const sidebarProjects = useMemo<SidebarProject[]>(() => projects.map(project => ({
    id: project.id,
    name: project.name,
    path: project.path,
    // Pinned sessions live in the dedicated section; archived ones in the global archive.
    sessions: sessionsByActivityAndManualOrder([
      ...sessions.filter(session => session.projectId === project.id
        && (!host.listSessionPage || (sidebarSessionIdsByProject[project.id] ?? []).includes(session.id))
        && !pinnedSessionIdSet.has(session.id)
        && !archivedSessionIdSet.has(session.id)),
    ]).flatMap(session => {
      const mapped = sidebarSessionById.get(session.id)
      return mapped ? [mapped] : []
    })
  })), [archivedSessionIdSet, host.listSessionPage, pinnedSessionIdSet, projects, sessions, sidebarSessionById, sidebarSessionIdsByProject])
  const sidebarProjectMenuUnavailable = useMemo<ProjectMenuUnavailable>(() => ({
    ...(!host.renameProject ? { rename: '待宿主支持' } : {}),
    ...(!host.removeProject ? { remove: '当前连接不支持移除项目' } : {}),
    ...(!canRevealInFinder ? { reveal: '当前连接不支持在 Finder 中显示' } : {})
  }), [canRevealInFinder, host.removeProject, host.renameProject])
  const toggleSidebarProject = (projectId: string) => {
    setSidebarExpandedIds(current => current.includes(projectId) ? current.filter(id => id !== projectId) : [...current, projectId])
  }
  const selectSidebarSessionNow = (sessionId: string, options?: { expandProject?: boolean }) => {
    setTimelineNavigation(null)
    if (selectedSession && selectedSession !== sessionId) {
      messagesBySessionRef.current.set(selectedSession, messagesRef.current)
    }
    const cached = messagesBySessionRef.current.get(sessionId)
    if (cached !== undefined) {
      messagesRef.current = cached
      setMessages(cached)
    } else {
      messagesRef.current = []
      setMessages([])
    }
    const session = sessions.find(item => item.id === sessionId)
    const allowExpandProject = options?.expandProject !== false
    const expandProjectIfSessionHidden = (projectId: string, status: SessionStatus) => {
      setSidebarExpandedIds(current => {
        if (current.includes(projectId)) return current
        // Peeked working rows stay visible under a collapsed folder; don't auto-expand.
        if (status === 'running' || status === 'subagents-running') return current
        return [...current, projectId]
      })
    }
    if (session) {
      setSelectedProject(session.projectId)
      if (allowExpandProject) {
        const status = sidebarStatusForSession(session.id, selectedSession, streaming, observedSessionStatuses[session.id], sidebarAgents).status
        expandProjectIfSessionHidden(session.projectId, status)
      }
    }
    const provisional = modelStatesBySessionRef.current.get(sessionId)
      ?? modelStateFromSession(session, modalVisibility.models)
    const immediate = provisional && reconcileModelStateWithCatalog(provisional, modalVisibility.models)
    if (immediate) {
      modelStatesBySessionRef.current.set(sessionId, immediate)
      rememberSessionModel(sessionId, immediate.model)
      setModelState(immediate)
    } else {
      setModelState(null)
    }
    setSelectedSession(sessionId)
    if (narrowViewport) setNarrowPanes(current => ({ ...current, sidebar: false }))
  }

  const selectSidebarSession = (sessionId: string, options?: { expandProject?: boolean }) => {
    const session = sessions.find(item => item.id === sessionId)
    if (!session?.cocWorldline || !host.invokeExtension) { selectSidebarSessionNow(sessionId, options); return }
    void host.invokeExtension('coc-keeper','timeline.select',{}, {sessionId}).then(result => {
      if (!result.ok) throw new Error(result.error?.message || 'Could not switch conversation')
      selectSidebarSessionNow(sessionId, options)
    }).catch(error => setProjectError(error instanceof Error ? error.message : String(error)))
  }
  const applySelectedModelState = (state: ModelState) => {
    modelWriteGenRef.current += 1
    const previous = selectedSession
      ? modelStatesBySessionRef.current.get(selectedSession)
      : modelState
    if (selectedSession) {
      modelStatesBySessionRef.current.set(selectedSession, state)
      rememberSessionModel(selectedSession, state.model)
    }
    setModelState(state)
    // Model identity changes the context window and per-model accounting.
    // Thinking-only switches must not refresh stats/quota/balance.
    const sameModel = previous
      && previous.model.provider === state.model.provider
      && previous.model.id === state.model.id
    if (!sameModel) setStatsRefreshKey(key => key + 1)
  }
  const persistComposerDraft = (draft: string) => {
    if (!selectedSession) return
    if (draft === '') draftsBySessionRef.current.delete(selectedSession)
    else draftsBySessionRef.current.set(selectedSession, draft)
  }
  const persistComposerAttachments = (attachments: ComposerAttachment[]) => {
    if (!selectedSession) return
    if (attachments.length === 0) attachmentsBySessionRef.current.delete(selectedSession)
    else attachmentsBySessionRef.current.set(selectedSession, attachments)
  }
  const persistComposerDocuments = (documents: ComposerDocument[]) => {
    if (!selectedSession) return
    if (documents.length === 0) documentsBySessionRef.current.delete(selectedSession)
    else documentsBySessionRef.current.set(selectedSession, documents)
  }
  // App unmount: revoke object URLs parked for every session (the Composer only
  // ever sees the selected session's attachments, so it cannot clean them all).
  useEffect(() => () => {
    for (const parked of attachmentsBySessionRef.current.values()) {
      for (const attachment of parked) URL.revokeObjectURL(attachment.url)
    }
  }, [])
  const onSidebarProjectMenu = (projectId: string, action: ProjectMenuAction) => {
    if (action === 'newSession') { void newSession(projectId); return }
    if (action === 'reveal' && canRevealInFinder) {
      void host.revealProject?.(projectId).catch(error => setProjectError(`在文件管理器中显示失败：${error instanceof Error ? error.message : String(error)}`))
    }
    if (action === 'remove') void removeProject(projectId)
  }
  const renameSidebarProject = async (projectId: string, name: string) => {
    if (!host.renameProject) {
      setProjectError('当前连接不支持重命名项目')
      return
    }
    const previous = projects.find(project => project.id === projectId)
    if (!previous || previous.name === name) return
    setProjects(current => current.map(project => project.id === projectId ? { ...project, name } : project))
    try {
      const renamed = await host.renameProject(projectId, name)
      setProjects(current => current.map(project => project.id === projectId ? renamed : project))
    } catch (error) {
      setProjects(current => current.map(project => project.id === projectId ? previous : project))
      setProjectError(`修改项目名称失败：${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }
  const pinSidebarSession = (sessionId: string) => {
    setPinnedSessionIds(current => current.includes(sessionId) ? current.filter(id => id !== sessionId) : [...current, sessionId])
  }
  const renameSidebarSession = async (sessionId: string, title: string) => {
    const previous = sessions.find(session => session.id === sessionId)
    if (!previous || previous.name === title) return
    markSessionTitleMutation(sessionId)
    setSessions(current => current.map(session => session.id === sessionId ? { ...session, name: title, updatedAt: Date.now() } : session))
    try {
      const renamed = await host.renameSession(sessionId, title)
      markSessionTitleMutation(sessionId)
      setSessions(current => current.map(session => session.id === sessionId ? renamed : session))
    } catch (error) {
      markSessionTitleMutation(sessionId)
      setSessions(current => current.map(session => session.id === sessionId ? previous : session))
      setProjectError(`修改会话名称失败：${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }
  const archiveSidebarSession = (sessionId: string) => {
    setArchivedSessionIds(current => current.includes(sessionId) ? current : [...current, sessionId])
    setArchivedSessionTimestamps(current => current[sessionId] === undefined ? { ...current, [sessionId]: Date.now() } : current)
    setPinnedSessionIds(current => current.filter(id => id !== sessionId))
    if (selectedSession === sessionId) {
      const archived = new Set([...archivedSessionIds, sessionId])
      const fallback = sessions.find(session => !archived.has(session.id))
      setSelectedSession(fallback?.id ?? '')
      if (fallback) setSelectedProject(fallback.projectId)
    }
  }
  const unarchiveSidebarSession = (sessionId: string) => {
    setArchivedSessionIds(current => current.filter(id => id !== sessionId))
    setArchivedSessionTimestamps(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== sessionId)))
  }
  const moveSidebarProject = async (sourceId: string, targetId: string, placement: SidebarDropPlacement) => {
    if (!host.setProjectPaths || sourceId === targetId) return
    const snapshot = projects
    const ids = movedIds(projects.map(project => project.id), sourceId, targetId, placement)
    const byId = new Map(projects.map(project => [project.id, project]))
    const next = ids.flatMap(id => byId.get(id) ?? [])
    setProjects(next)
    try {
      await host.setProjectPaths(next.map(project => project.path))
    } catch (error) {
      setProjects(snapshot)
      setProjectError(`调整项目顺序失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const moveSidebarSession = async (sessionId: string, targetProjectId: string) => {
    const source = sessions.find(session => session.id === sessionId)
    if (!source || source.projectId === targetProjectId) return
    const snapshot = sessions
    const snapshotPinned = pinnedSessionIds
    const snapshotSidebarIds = sidebarSessionIdsByProject
    setSessions(current => current.map(session => session.id === sessionId ? { ...session, projectId: targetProjectId } : session))
    setSidebarSessionIdsByProject(current => Object.fromEntries(Object.entries(current).map(([projectId, ids]) => [
      projectId,
      projectId === targetProjectId
        ? [sessionId, ...ids.filter(id => id !== sessionId)]
        : ids.filter(id => id !== sessionId),
    ])))
    setPinnedSessionIds(current => current.filter(id => id !== sessionId))
    setSidebarExpandedIds(current => current.includes(targetProjectId) ? current : [...current, targetProjectId])
    try {
      const moved = await host.moveSession(sessionId, targetProjectId)
      setSessions(current => current.map(session => session.id === sessionId ? moved : session))
      if (selectedSession === sessionId) setSelectedProject(targetProjectId)
    } catch (error) {
      setSessions(snapshot)
      setSidebarSessionIdsByProject(snapshotSidebarIds)
      setPinnedSessionIds(snapshotPinned)
      setProjectError(`移动会话失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const moveSidebarSessionToPinned = (sessionId: string) => {
    setPinnedSessionIds(current => current.includes(sessionId) ? current : [...current, sessionId])
  }
  const resize = (pane: keyof PaneWidths, start: number) => (event: React.PointerEvent) => { const origin = event.clientX; const onMove = (move: PointerEvent) => setWidths(current => ({ ...current, [pane]: clamp(start + (pane === 'sidebar' ? move.clientX - origin : origin - move.clientX), pane === 'sidebar' ? 190 : 270, pane === 'sidebar' ? 440 : 620) })); const done = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', done) }; window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', done) }
  const resizeTools = (event: React.PointerEvent) => {
    const origin = event.clientX
    const browser = activeTab === 'Browser'
    const key: 'tools' | 'browserTools' = browser ? 'browserTools' : 'tools'
    const start = widths[key]
    const onMove = (move: PointerEvent) => setWidths(current => {
      const sidebar = current.sidebarCollapsed ? 0 : current.sidebar
      const fittedMax = browser ? fitBrowserToolsWidth(window.innerWidth, sidebar, BROWSER_TOOLS_MAX) : 620
      const fittedMin = browser ? Math.min(BROWSER_TOOLS_PREFERRED_MIN, fittedMax) : 270
      return { ...current, [key]: clamp(start + origin - move.clientX, fittedMin, fittedMax) }
    })
    const done = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', done) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', done)
  }
  const toggleSidebar = () => {
    // Phone overlays are mutually exclusive (≤720px): opening the drawer must
    // close the tool panel, otherwise both fixed panes stack and the
    // later-in-DOM .tool-panel swallows taps meant for drawer footer buttons.
    // Only narrowPanes changes here — persisted widths.* desktop preferences
    // are separate state and stay untouched by transient phone interactions.
    if (narrowViewport) setNarrowPanes(current => ({ sidebar: !current.sidebar, tools: false }))
    else setWidths(current => ({ ...current, sidebarCollapsed: !current.sidebarCollapsed }))
  }
  const toggleTools = () => {
    if (narrowViewport) setNarrowPanes(current => ({ sidebar: false, tools: !current.tools }))
    else setWidths(current => ({ ...current, toolsCollapsed: !current.toolsCollapsed }))
  }
  const expandTools = useCallback(() => {
    if (narrowViewport) setNarrowPanes(current => ({ sidebar: false, tools: true }))
    else setWidths(current => current.toolsCollapsed ? { ...current, toolsCollapsed: false } : current)
  }, [narrowViewport])
  const navigateTool = useCallback((tab: PanelTab) => {
    rememberToolReturn(tab)
    expandTools()
  }, [expandTools, rememberToolReturn])
  const goBackTool = useCallback(() => {
    const target = toolReturnTab ?? DEFAULT_PANEL_TAB
    setToolReturnTab(null)
    applyActiveTab(target)
  }, [applyActiveTab, toolReturnTab])
  /** Swift panelQuickRail behavior: switching opens the panel, re-clicking the active tool closes it. */
  const selectTool = (tab: PanelTab) => {
    if (!toolsCollapsed && activeTab === tab) {
      if (narrowViewport) setNarrowPanes(current => ({ ...current, tools: false }))
      else setWidths(current => ({ ...current, toolsCollapsed: true }))
      return
    }
    navigateTool(tab)
  }
  const revealSubagentsForNewRun = useCallback(() => {
    if (narrowViewport) return
    // Match Swift: reveal a new run only when the right pane is closed. An
    // already-open Browser/Document/Terminal tab remains under user control.
    if (!toolsCollapsed) return
    navigateTool('Subagents')
  }, [narrowViewport, navigateTool, toolsCollapsed])
  /** Subagent tool-card click: always open the Subagents pane (Swift card tap parity). */
  const openSubagents = useCallback(() => {
    navigateTool('Subagents')
  }, [navigateTool])
  const announceOpenedDocuments = useCallback((paths: string[]) => {
    const supported = filterSupportedDocumentPaths(paths)
    if (!supported.length) return supported
    const sessionId = selectedSessionRef.current
    if (sessionId) {
      void host.notifyDocumentsDropped?.(sessionId, supported)?.catch(error => console.warn('[document-drop]', error))
    }
    return supported
  }, [host])
  const rememberOpenedDocument = useCallback((path: string) => {
    const sessionId = selectedSessionRef.current
    if (!sessionId) return
    setOpenedDocuments(current => {
      const existing = current[sessionId] ?? { paths: [], active: null }
      if (existing.active === path && existing.paths.includes(path)) return current
      const paths = existing.paths.includes(path) ? existing.paths : [...existing.paths, path]
      return { ...current, [sessionId]: { paths, active: path } }
    })
  }, [])
  const activateDocument = useCallback((path: string) => {
    const sessionId = selectedSessionRef.current
    if (!sessionId) return
    setOpenedDocuments(current => {
      const existing = current[sessionId]
      if (!existing || !existing.paths.includes(path) || existing.active === path) return current
      return { ...current, [sessionId]: { ...existing, active: path } }
    })
  }, [])
  const closeDocument = useCallback((path: string) => {
    const sessionId = selectedSessionRef.current
    if (!sessionId) return
    setOpenedDocuments(current => {
      const existing = current[sessionId]
      if (!existing || !existing.paths.includes(path)) return current
      const index = existing.paths.indexOf(path)
      const paths = existing.paths.filter(item => item !== path)
      const active = existing.active === path ? paths[Math.min(index, paths.length - 1)] ?? null : existing.active
      return { ...current, [sessionId]: { paths, active } }
    })
  }, [])
  const openDocument = useCallback((path: string) => {
    const supported = announceOpenedDocuments([path])
    rememberOpenedDocument(supported[supported.length - 1] ?? path)
    navigateTool('Document')
  }, [announceOpenedDocuments, navigateTool, rememberOpenedDocument])
  const openDroppedDocuments = useCallback((paths: string[]) => {
    const supported = announceOpenedDocuments(paths)
    if (!supported.length) return
    rememberOpenedDocument(supported[supported.length - 1]!)
    navigateTool('Document')
  }, [announceOpenedDocuments, navigateTool, rememberOpenedDocument])

  const browserWorkspaceActive = activeTab === 'Browser' && !toolsCollapsed
  const productPanels = usePanels()
  const onboardingActive = productId === 'pipicoc' && !!selectedSession && messages.length === 0 && !streaming
  const onboardingModTab = onboardingActive && productPanels.some(panel => panel.id === 'coc.mods') ? 'coc.mods' : null
  const rightPaneAvailable = productPanels.length > 0 && (!onboardingActive || onboardingModTab !== null)
  const productToolsCollapsed = toolsCollapsed || !rightPaneAvailable
  const productSidebarCollapsed = sidebarCollapsed || !productHasPrimarySidebar
  const planProductEnabled = useProductExtensionEnabled('plan-extension')
  const orchestrationEnabled = useProductExtensionEnabled('agent-orchestration')
  const remoteControlEnabled = useProductExtensionEnabled('remote-control')
  const productBrowserWorkspaceActive = !onboardingActive && browserWorkspaceActive && !productToolsCollapsed
  const browserFullscreenActive = productBrowserWorkspaceActive && browserWorkspaceFullscreen
  const shellClass = `pipiui-shell${isElectronChrome() ? ' electron-chrome' : ''}${productSidebarCollapsed ? ' sidebar-collapsed' : ''}${productToolsCollapsed ? ' tools-collapsed' : ''}${productBrowserWorkspaceActive ? ' browser-workspace' : ''}${browserFullscreenActive ? ' browser-workspace-fullscreen' : ''}`
  // The first-response wait (any active main turn) takes precedence at the
  // transcript tail; while it is hidden, a running background subagent keeps the
  // tail alive with a stable-timed phase=tool indicator and no stop button.
  const waitingDetailShown = modsProgress && waitingPhase === 'tool'
    ? waitingDetail ? `${waitingDetail} · ${modsProgress}` : modsProgress
    : waitingDetail
  const firstResponseWaiting = waitingVisible && waitingStartedAt !== null
    ? { startedAt: waitingStartedAt, phase: waitingPhase, detail: waitingDetailShown, onStop: stopSelectedSession }
    : undefined
  const subagentWaiting = !firstResponseWaiting && subagentsRunningCount > 0 && subagentWaitingStartedAt !== null
    ? { startedAt: subagentWaitingStartedAt, phase: 'tool' as const, detail: `${subagentsRunningCount} 个子任务执行中` }
    : undefined
  const headerSession = sessions.find(item => item.id === selectedSession)
  const dismissNarrowOverlays = () => setNarrowPanes({ sidebar: false, tools: false })
  const toolsTrack = productBrowserWorkspaceActive
    ? fitBrowserToolsWidth(viewportWidth, productSidebarCollapsed ? 0 : widths.sidebar, widths.browserTools)
    : widths.tools
  const baseSidebarProps: SidebarProps = { productName, projects: sidebarProjects, pinnedSessions: pinnedSidebarSessions, archivedSessions: archivedSidebarSessions, expandedIds: sidebarExpandedIds, selectedSessionId: selectedSession || null, searchQuery: sidebarSearch, visibleLimit: sidebarVisibleLimit, collapsed: sidebarCollapsed, onToggleCollapsed: toggleSidebar, onToggleProject: toggleSidebarProject, onSelectSession: selectSidebarSession, onNewSession: projectId => void newSession(projectId), onProjectMenu: onSidebarProjectMenu, onRenameProject: host.renameProject ? renameSidebarProject : undefined, projectMenuUnavailable: sidebarProjectMenuUnavailable, onMoveProject: host.setProjectPaths ? moveSidebarProject : undefined, onMoveSession: moveSidebarSession, onMoveSessionToPinned: moveSidebarSessionToPinned, onAddProject: addProject, projectAddUnavailable: host.pickProjectDirectory && host.addProject ? undefined : '当前连接不支持添加项目', projectError, onDismissProjectError: () => setProjectError(null), onSearch: setSidebarSearch, onShowMore: () => setSidebarVisibleLimit(limit => limit + SIDEBAR_PROJECT_PAGE_SIZE), sessionHasMoreByProject: host.listSessionPage ? Object.fromEntries(Object.entries(lazySessionPages).map(([id, page]) => [id, page.hasMore])) : undefined, sessionPageLoadingByProject: host.listSessionPage ? Object.fromEntries(Object.entries(lazySessionPages).map(([id, page]) => [id, page.loading])) : undefined, sessionVisibleLimitByProject: host.listSessionPage ? lazyVisibleSessionLimits : undefined, onShowMoreSessions: host.listSessionPage ? projectId => { const page = lazySessionPagesRef.current[projectId]; if (page?.hasMore && page.nextCursor) void loadLazySessionPage(projectId, page.nextCursor); else setLazyVisibleSessionLimits(current => ({ ...current, [projectId]: (current[projectId] ?? 10) + 10 })) } : undefined, onPinSession: pinSidebarSession, onRenameSession: renameSidebarSession, onArchiveSession: archiveSidebarSession, onUnarchiveSession: unarchiveSidebarSession, onOpenSettings: openModelManager, theme: themeScheme, onToggleTheme: toggleTheme,
    // Neither footer action belongs to the base. Remote pairing is the remote-control
    // package's surface (the Relay client behind it stays in the Electron host, the way
    // the browser package's WebContentsView does), and the subagent model picker only
    // means something while the orchestration package is there to run subagents.
    ...(remoteControlEnabled ? { onOpenRemote: () => setRemoteOpen(true) } : {}),
    ...(orchestrationEnabled ? { onOpenSubagentModels: () => setSubagentModelsOpen(true) } : {}) }
  return <main className={shellClass} data-theme={theme} data-scheme={themeScheme} style={{ '--sidebar-w': `${widths.sidebar}px`, '--tools-w': `${toolsTrack}px` } as React.CSSProperties}>
    {narrowViewport && (!productSidebarCollapsed || !productToolsCollapsed) && <div className="pane-overlay-backdrop" data-testid="pane-overlay-backdrop" onMouseDown={dismissNarrowOverlays} />}
    <BaseWorkbenchProvider sidebar={baseSidebarProps}><WorkbenchRegion store={productWorkbench.store} location="primarySidebar" /></BaseWorkbenchProvider>
    {productHasPrimarySidebar && <ResizeHandle label="调整左栏宽度" side="left" onPointerDown={resize('sidebar', widths.sidebar)} />}
    <section className="chat-column">
      <ChatHeader productName={productName} session={headerSession} project={projects.find(item => item.id === selectedProject)} lease={lease} host={host} gitAvailable={gitAvailable} sidebarCollapsed={productSidebarCollapsed} toolsCollapsed={productToolsCollapsed} onToggleSidebar={toggleSidebar} onToggleTools={toggleTools} onRename={renameSidebarSession} onTakeover={async () => { if (selectedSession) setLease(await host.forceTakeoverSessionLease(selectedSession)) }} />
      <div className="chat-viewport" data-testid="chat-viewport">
        <WorkbenchRegion store={productWorkbench.store} location="overlay" sessionId={selectedSession || undefined} />
        {productPanels.length > 0 && !onboardingActive && productToolsCollapsed && <ToolQuickRail variant="float" collapsible={narrowViewport} activeTab={activeTab} toolsCollapsed={productToolsCollapsed} onSelect={selectTool} host={host} browserAvailable={browserAvailable} terminalAvailable={terminalAvailable} planTabVisible={planTabVisible} planProgress={planProgressBadge} subagentsRunningCount={subagentsRunningCount} />}
        {projectsLoaded && lazyStartupReady && !selectedSession ? (
          <div className="empty-setup-viewport">
            <EmptySetupGuide
              productName={productName}
              modelsLoading={modalVisibility.loading}
              hasModels={modalVisibility.models.length > 0}
              hasProjects={projects.length > 0}
              gitInstalled={gitBinary}
              onAddApiKey={openAddProvider}
              onAddProject={() => { void addProject() }}
              onNewSession={() => { const projectId = selectedProject || projects[0]?.id; if (projectId) void newSession(projectId) }}
            />
          </div>
        ) : (
        <LiveSubagentBindingProvider host={host} sessionId={selectedSession}>
          {selectedSession ? (
            <div key={selectedSession} className="session-transcript-slot" data-session-transcript={selectedSession}>
              {onboardingActive
                ? <CocOnboarding host={host} sessionId={selectedSession} />
                : <>
                  {productId === 'pipicoc' && <CocGameIntro words={timeline?.ui?.words?.['intro']} conversationStarted={messages.some(message => message.role === 'user')} />}
                  <Transcript
                stateKey={selectedSession}
                navigation={timelineNavigation?.sessionId === selectedSession ? timelineNavigation : undefined}
                onBranch={message => void handleBranch(message)}
                branchMessageIds={branchMessageIds}
                branchDisabled={branchBusy || sessionWorking}
                onIllustrate={illustrationGate ? handleIllustrate : undefined}
                illustrations={illustrationsById}
                illustrateDisabled={sessionWorking || branchBusy}
                actionWords={timeline?.ui?.words?.['message-actions']}
                onChoose={async (entry,option)=>{
                  if(entry.renderer==='coc-character-draft'){const ack=await host.invokeExtension!("coc-keeper",option==='presentation'?"draft-presentation":"draft-previewed",{revision:(entry.details as any).revision},{sessionId:selectedSession});if(!ack.ok)throw new Error(ack.error?.message||"Preview acknowledgment failed");return ack.data;}
                  const result=await host.invokeExtension!("coc-keeper","choose",{choice:(entry.details as any).name,option},{sessionId:selectedSession});
                  if(!result.ok)throw new Error(result.error?.message || "Choice failed");
                }}
                onDraftOverride={async (entry,request)=>{
                  const ack=await host.invokeExtension!("coc-keeper","draft-override",request,{sessionId:selectedSession});
                  // A `needs` refusal is the edit control's validation answer, not a transport
                  // failure: hand it to the modal so it can mark the offending input.
                  if(!ack.ok){
                    if((ack.error as any)?.code==='needs')return {ok:false,error:ack.error};
                    throw new Error(ack.error?.message||"Draft override failed");
                  }
                  const result=ack.data as Record<string,any>;
                  // A saved override returns the fresh draft payload; show it in place of the
                  // revision the player edited. A superseded answer carries the current draft for
                  // the same swap. The old revision's projected words must not survive the swap,
                  // or the card would never poll the new presentation.
                  const fresh=result?.superseded?result.draft:result;
                  if(fresh?.sheet&&!request.dry_run)
                    mutateLocalTranscript(current=>current.map(message=>{
                      const presentation=message.presentation;
                      if(presentation?.renderer!=='coc-character-draft')return message;
                      const details=presentation.details as any;
                      if(details?.revision!==(entry.details as any)?.revision)return message;
                      const merged={...details,...fresh};
                      delete merged.presentation;
                      return {...message,presentation:{...presentation,details:merged}};
                    }));
                  return result;
                }}
                messages={messages}
                onLoadOlder={loadOlderHistory}
                documentBasePath={selectedProjectPath}
                onOpenDocument={openDocument}
                onOpenSubagents={openSubagents}
                onCopy={handleCopy}
                onResend={handleResend}
                resendDisabled={resendDisabled}
                copiedId={copiedId}
                waiting={firstResponseWaiting ?? subagentWaiting}
              />
              </>}
            </div>
          ) : (
            <Transcript messages={messages} documentBasePath={selectedProjectPath} onOpenDocument={openDocument} onOpenSubagents={openSubagents} onCopy={handleCopy} onResend={handleResend} resendDisabled={resendDisabled} copiedId={copiedId} waiting={firstResponseWaiting ?? subagentWaiting} />
          )}
        </LiveSubagentBindingProvider>
        )}
      </div>
      {selectedSession ? <div className="chat-composer-stack" data-testid="chat-composer-stack">
        {sessionQueue.error && <div className="queue-operation-error" role="alert" data-testid="queue-operation-error"><span>{sessionQueue.error}</span><button aria-label="关闭队列错误" onClick={sessionQueue.dismissError}>×</button></div>}
        {/* 扩展的 confirm 就地渲染在这里（ExtensionUiHost 通过 portal 填入），
            和「计划待确认」同一条带；插槽不在时它会退回居中弹层。 */}
        <div id={EXT_CONFIRM_SLOT_ID} data-testid="extui-confirm-slot" />
        {planProductEnabled && <PlanApprovalBar host={host} sessionId={selectedSession} readOnly={leaseReadOnly} busy={sessionWorking} lastUser={lastUserForPlanApproval} onSend={send} />}
        <MessageQueue items={sessionQueue.items} expanded={sessionQueue.expanded} pending={sessionQueue.pending} mutationsDisabled={leaseReadOnly} canSteer={sessionQueue.busy || leftoverQueued} onToggle={() => sessionQueue.setExpanded(!sessionQueue.expanded)} onPromote={id => { if (!leaseReadOnly) void sessionQueue.promote(id).catch(() => undefined) }} onEdit={(id, text) => { if (!leaseReadOnly) void sessionQueue.edit(id, text).catch(() => undefined) }} onRemove={id => { if (!leaseReadOnly) void sessionQueue.remove(id).catch(() => undefined) }} onRetry={id => { if (!leaseReadOnly) void sessionQueue.retry(id).catch(() => undefined) }} onSteer={id => { if (!leaseReadOnly) void sessionQueue.cutIn(id).catch(() => undefined) }} />
        <Composer onboarding={onboardingActive} streaming={streaming} working={sessionWorking} stopping={selectedStopping} stopError={stopError?.sessionId === selectedSession ? stopError.message : null} compacting={compacting} compactingLabel={compactingLabel} queueBusy={queueLocksComposer} readOnly={leaseReadOnly} leaseOwner={packSnapshotMismatch ? undefined : (leaseReadOnly ? leaseOwnerLabel(lease) : undefined)} onTakeover={packSnapshotMismatch ? undefined : async () => { if (selectedSession) setLease(await host.forceTakeoverSessionLease(selectedSession)) }} readOnlyMessage={packSnapshotMismatch ? `此会话使用 ${selectedConversationPackId} 扩展包；当前项目是 ${activeProductPackId}。请用当前扩展包新建会话继续。` : undefined} modelState={modelState} host={host} sessionId={selectedSession} initialDraft={selectedSession ? (draftsBySessionRef.current.get(selectedSession) ?? '') : ''} initialAttachments={selectedSession ? (attachmentsBySessionRef.current.get(selectedSession) ?? EMPTY_COMPOSER_ATTACHMENTS) : EMPTY_COMPOSER_ATTACHMENTS} initialDocuments={selectedSession ? (documentsBySessionRef.current.get(selectedSession) ?? EMPTY_COMPOSER_DOCUMENTS) : EMPTY_COMPOSER_DOCUMENTS} onDraftChange={persistComposerDraft} onAttachmentsChange={persistComposerAttachments} onDocumentsChange={persistComposerDocuments} statsRefreshKey={statsRefreshKey} visibility={modalVisibility} catalogNotice={catalogNotice} onDismissCatalogNotice={() => setCatalogNotice(null)} onOpenModelManager={openModelManager} onCompact={compact} onSend={send} onStop={stopSelectedSession} onDismissStopError={() => setStopError(current => current?.sessionId === selectedSession ? null : current)} onModel={applySelectedModelState} onEnsureSession={ensureSession} />
      </div> : null}
    </section>
    {rightPaneAvailable && <ResizeHandle label="调整工具栏宽度" side="right" onPointerDown={resizeTools} />}
    {rightPaneAvailable && <ToolPanel activeTab={onboardingModTab ?? activeTab} collapsed={productToolsCollapsed} onToggleCollapsed={toggleTools} rail={!productToolsCollapsed && !onboardingActive ? <ToolQuickRail variant="header" activeTab={activeTab} toolsCollapsed={productToolsCollapsed} onSelect={selectTool} host={host} browserAvailable={browserAvailable} terminalAvailable={terminalAvailable} planTabVisible={planTabVisible} planProgress={planProgressBadge} subagentsRunningCount={subagentsRunningCount} /> : null} canGoBack={!onboardingActive && activeTab !== DEFAULT_PANEL_TAB} onBack={goBackTool} host={preloadedHost} theme={themeScheme} sessionId={selectedSession} announcedTerminal={selectedSession ? announcedTerminals[selectedSession] : undefined} revealedTerminalId={selectedSession ? revealedTerminalIds[selectedSession] : undefined} onSubagentsRunningCountChange={setSubagentsRunningCount} onSubagentStarted={revealSubagentsForNewRun} onManualSubagentStatusCheck={agentIDs => { void send(makeSubagentStatusCheckPrompt(agentIDs)) }} browserAvailable={browserAvailable} browserOccluded={browserOccluded} terminalAvailable={terminalAvailable} planAvailable={planAvailable} onPlanProgressChange={setPlanProgressBadge} onHasPlansChange={handleHasPlansChange} retainedWorktreeDispositionAvailable={retainedWorktreeDispositionAvailable} projectId={selectedProject} projectPath={selectedProjectPath} openedDocumentPath={selectedSession ? openedDocuments[selectedSession]?.active ?? null : null} openedDocumentPaths={selectedSession ? openedDocuments[selectedSession]?.paths ?? [] : []} onOpenDocument={openDocument} onActivateDocument={activateDocument} onCloseDocument={closeDocument} onDropDocuments={openDroppedDocuments} workspaceFullscreen={browserWorkspaceFullscreen} onToggleWorkspaceFullscreen={() => setBrowserWorkspaceFullscreen(value => !value)} />}
    {modalOpen && <ModelVisibilityModal host={host} productName={productName} visibility={modalVisibility} updates={updates} current={modelState?.model ?? null} onModelState={applySelectedModelState} onRequestUpdate={requestUpdate} onClose={closeModelManager} initialView={modalInitialView} projectId={selectedProject} />}
    {remoteControlEnabled && remoteOpen && <RemoteConnectionPanel onClose={() => setRemoteOpen(false)} onAskPipiui={text => { setRemoteOpen(false); void send(text) }} onOpenDebugUrl={url => {
      if (!selectedSession || !host.browser) return
      void host.browser.newTab(selectedSession, { url }).then(() => navigateTool('Browser')).catch(() => undefined)
    }} />}
    {subagentModelsOpen && <SubagentModelModal host={host} current={modelState?.model ?? null} visibility={modalVisibility} onClose={() => setSubagentModelsOpen(false)} projectId={selectedProject} sessionId={selectedSession || undefined} />}
    <ExtensionUiHost host={host} sessionId={selectedSession || undefined} />
  </main>
}

function hostOperationError(error: unknown): string {
  if (error && typeof error === 'object' && (error as { code?: string }).code === TRANSPORT_DISCONNECTED) {
    return '连接已断开，操作未完成。请恢复连接后重试，已发出的消息不会自动重发。'
  }
  return error instanceof Error ? error.message : String(error)
}

/** A transcript already showing assistant output (text or a thinking/tool card)
 *  has no first-token wait left. A new `started` after that uses phase
 *  `continuing` so the placeholder still names the wait. */
function hasVisibleAssistantOutput(messages: ChatMessage[]): boolean {
  return messages.some(message => message.role === 'assistant' && (
    Boolean(message.content) ||
    Boolean(message.error) ||
    (message.tools?.length ?? 0) > 0 ||
    Boolean(message.thinking) ||
    (message.activities?.length ?? 0) > 0
  ))
}

/** Host JSONL already has the same text conclusion the live transcript showed.
 *  That is a lost `settled` only when this assistant was still marked
 *  streaming. A finished historical conclusion plus a new `started` is a
 *  first-token wait — closing it is the idle-composer side of the seesaw. */
function historyConfirmsLostSettle(historyMessages: ChatMessage[], liveMessages: ChatMessage[], settledReplacementConfirmed = false): boolean {
  const historyLast = assistantBeforeTrailingCompactions(historyMessages)
  if (!historyLast || !assistantLooksSettled(historyLast)) return false
  const liveLast = assistantBeforeTrailingCompactions(liveMessages)
  if (!liveLast) return true
  // Text-then-tools is still the silent next hop. JSONL stores that as
  // content+finished tools, which looks settled and must not close the wait.
  if (assistantEndedAwaitingModel(liveLast)) return false
  if ((liveLast.content ?? '').trim() !== (historyLast.content ?? '').trim()) return false
  // An immediate history pull may already have replaced the streaming live
  // row with this exact settled snapshot while the independent scalar status
  // remains running. Only the bounded, revision-stable replacement candidate
  // may close that split state; an unchanged old final cannot close a new wait.
  return Boolean(liveLast.streaming || settledReplacementConfirmed)
}

/** Compaction is durable metadata for the preceding transcript, not a new
 * turn boundary. Only peel an uninterrupted compaction suffix: a later user
 * or tool row still blocks terminal-assistant recovery. */
function assistantBeforeTrailingCompactions(messages: ChatMessage[]): ChatMessage | undefined {
  let index = messages.length - 1
  while (index >= 0 && messages[index]?.role === 'compaction') index -= 1
  const candidate = messages[index]
  return candidate?.role === 'assistant' ? candidate : undefined
}

function streamingAssistantToolsAllFinished(messages: ChatMessage[]): boolean {
  const last = [...messages].reverse().find(message => message.role === 'assistant' && message.streaming)
  const tools = last?.tools ?? []
  return tools.length > 0 && tools.every(tool => Boolean(tool.finished))
}

/** A `[subagent-*]` injection — already in the transcript or still pending on
 *  the just-emitted `started` — is a follow-up wait, not a leftover first-token
 *  or generic "等待模型响应" after the worker card already says 已完成. */
function waitingPhaseForTurn(messages: ChatMessage[], pendingFollowUps?: string[]): WaitingPhase {
  const lastUser = [...messages].reverse().find(message => message.role === 'user')
  if (lastUser && parseSubagentSignal(lastUser.content)) return 'followup'
  if (pendingFollowUps?.some(text => parseSubagentSignal(text))) return 'followup'
  return hasVisibleAssistantOutput(messages) ? 'continuing' : 'awaiting'
}

/** An older terminal must not close the turn now on screen. A newer terminal
 *  is authoritative when the renderer missed its matching `started`. */
function staleTurnTerminal(event: Extract<StreamEvent, { type: 'status' }>, openedEpoch?: number): boolean {
  return (event.status === 'settled' || event.status === 'stopped')
    && event.turnEpoch !== undefined
    && openedEpoch !== undefined
    && event.turnEpoch < openedEpoch
}

/** A `started` after a finished assistant is real when it advances the backend
 *  epoch or a new prompt is already visible/queued. Otherwise bare started is
 *  the ghost-turn path, except when the last assistant ended on tools — that is
 *  the next silent model hop (xAI/xhigh often omits thinking_delta). */
function shouldOpenWaitOnStarted(messages: ChatMessage[], pendingFollowUps?: string[], turnEpoch?: number, openedEpoch?: number): boolean {
  if (turnEpoch !== undefined && openedEpoch !== undefined && turnEpoch > openedEpoch) return true
  if (pendingFollowUps?.some(text => text.trim().length > 0)) return true
  const last = messages[messages.length - 1]
  if (!last) return true
  if (last.role === 'user') return true
  const assistant = assistantBeforeTrailingCompactions(messages)
  if (assistant?.streaming) return true
  return Boolean(assistant && assistantEndedAwaitingModel(assistant))
}

/** After a closed turn these kinds are transcript projections, not a Boss wake. */
function isSettledSubagentProjection(signal: { kind: string } | null | undefined): boolean {
  return signal?.kind === 'done' || signal?.kind === 'heartbeat' || signal?.kind === 'stalled' || signal?.kind === 'blocked'
}

/** Queue-drain text and already-running turns still open processing. A late
 *  terminal/heartbeat/stalled/blocked `[subagent-*]` after idle must wait for `started`. */
function shouldOpenTurnOnUserMessage(content: string, alreadyRunning: boolean): boolean {
  const signal = parseSubagentSignal(content)
  if (isSettledSubagentProjection(signal) && !alreadyRunning) return false
  return Boolean(signal || content.trim())
}

function ResizeHandle({ label, side, onPointerDown }: { label: string; side?: 'left' | 'right'; onPointerDown: (event: React.PointerEvent) => void }) { return <div className={`resize-handle${side ? ` resize-handle-${side}` : ''}`} role="separator" aria-label={label} onPointerDown={onPointerDown} /> }
function RightPaneToggleIcon({ expanded }: { expanded: boolean }) {
  return expanded
    ? <svg className="right-pane-toggle-icon" data-pane-icon="collapse" aria-hidden="true" viewBox="0 0 20 20"><rect x="2.5" y="3" width="15" height="14" rx="2" /><path className="right-pane-toggle-fill" d="M11 3h4.5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H11z" /><path d="M9.5 10h5m-2-2 2 2-2 2" /></svg>
    : <svg className="right-pane-toggle-icon" data-pane-icon="expand" aria-hidden="true" viewBox="0 0 20 20"><rect x="2.5" y="3" width="15" height="14" rx="2" /><path d="M11.5 3v14" /><path d="M14.5 7.5v5" /></svg>
}
function ChatHeader({ productName = 'PipiUI', session, project, lease, host, gitAvailable, sidebarCollapsed, toolsCollapsed, onToggleSidebar, onToggleTools, onRename, onTakeover }: { productName?: string; session?: Session; project?: Project; lease: SessionLease | null; host: PipiHostAPI; gitAvailable: boolean; sidebarCollapsed: boolean; toolsCollapsed: boolean; onToggleSidebar: () => void; onToggleTools: () => void; onRename: (sessionId: string, title: string) => Promise<void> | void; onTakeover: () => void }) {
  const [renaming, setRenaming] = useState(false)
  const headerActions = useHeaderActions()
  useEffect(() => setRenaming(false), [session?.id])
  const readOnly = lease !== null && !leaseCanWrite(lease)
  const canRename = Boolean(session)
  return <header className="chat-header">{sidebarCollapsed && <button className="pane-toggle pane-restore pane-restore-sidebar" data-testid="toggle-sidebar" title="展开左栏" aria-label="展开左栏" aria-expanded="false" onClick={onToggleSidebar}>≡</button>}<div className="chat-header-title">{renaming && canRename && session ? <InlineSessionTitleEditor value={session.name} ariaLabel="会话名称" className="chat-header-title-input" onCommit={async title => { await onRename(session.id, title); setRenaming(false) }} onCancel={() => setRenaming(false)} /> : <strong className="chat-header-title-label" role={canRename ? 'button' : undefined} tabIndex={canRename ? 0 : undefined} title={session ? '双击修改会话名称' : undefined} onDoubleClick={() => { if (canRename) setRenaming(true) }} onKeyDown={event => { if (canRename && (event.key === 'Enter' || event.key === 'F2')) { event.preventDefault(); setRenaming(true) } }}>{session?.name ?? productName}</strong>}{readOnly && <span className="lease-detail">由 {leaseOwnerLabel(lease)} 运行中 · 只读 <button data-testid="lease-takeover-header" onClick={onTakeover}>强制接管</button></span>}</div><div className="chat-header-actions"><SessionBranchHeader host={host} projectId={project?.id} workspace={session?.workspace} gitAvailable={gitAvailable} />{headerActions.map(action => <Fragment key={action.id}>{action.render({ host, workspaceId: project?.id, hostCapabilities: { git: gitAvailable } })}</Fragment>)}{toolsCollapsed && <button className="pane-toggle" data-testid="toggle-tools" title="展开右栏" aria-label="展开右栏" aria-expanded="false" onClick={onToggleTools}><RightPaneToggleIcon expanded={false} /></button>}</div></header>
}
const MIN_COMPOSER_HEIGHT = 29
const MAX_COMPOSER_HEIGHT = 150
/** jsdom has no layout engine (scrollHeight is 0), so fall back to a line-based estimate there. */
function estimatedTextareaHeight(value: string): number {
  const lines = value ? value.split('\n').length : 1
  return Math.min(MAX_COMPOSER_HEIGHT, Math.max(MIN_COMPOSER_HEIGHT, lines * 29))
}

type ComposerAttachment = {
  id: string
  name: string
  mimeType: string
  size: number
  /** Object URL for preview; revoked on remove / App unmount / successful send. */
  url: string
  /** Pasted/clipboard attachment; base64 is read at send time only. */
  file: File
}

type ComposerDocument = {
  id: string
  name: string
  path: string
}

/** Shared empty list so no render allocates a fresh array for the default. */
const EMPTY_COMPOSER_ATTACHMENTS: ComposerAttachment[] = []
const EMPTY_COMPOSER_DOCUMENTS: ComposerDocument[] = []

function toPromptAttachment(a: ComposerAttachment): Promise<PromptAttachment> {
  return fileToPromptAttachment(a.file).catch(() => { throw new Error('无法读取图片') })
}

/** Stable composer chrome (model chip, quick menu, thinking control, stats/quota/balance
 * pills). Memoized with useCallback-backed handlers so per-keystroke draft updates,
 * which re-render only the Composer, never re-render this row. */
const ComposerOptions = memo(function ComposerOptions({ readOnly, streaming, compacting, compactingLabel, statsRefreshKey, host, sessionId, modelState, visibility, quickOpen, onSelectModel, onThinkingChange, onQuickOpenChange }: { readOnly: boolean; streaming: boolean; compacting: boolean; compactingLabel?: string | null; statsRefreshKey: number; host: PipiHostAPI; sessionId: string; modelState: ModelState | null; visibility: ModelVisibilityController; quickOpen: boolean; onSelectModel: (model: Model) => void; onThinkingChange: (level: ThinkingLevel) => void; onQuickOpenChange: (value: boolean | ((previous: boolean) => boolean)) => void }) {
  return <div className="composer-options"><div className="composer-options-left"><div className="quick-menu-anchor"><button className="model-chip" aria-label="当前模型" title="切换模型" data-testid="model-chip" disabled={readOnly} onClick={() => { if (!readOnly) onQuickOpenChange(value => !value) }}>{modelState?.model && <ProviderLogo provider={modelState.model.provider} modelId={modelState.model.id} size={13} />}<span className="model-chip-name">{modelState?.model.name ?? '加载模型…'}</span></button>{quickOpen && !readOnly && <ModelQuickMenu groups={visibility.quickGroups} current={modelState?.model ?? null} onSelect={model => void onSelectModel(model)} onClose={() => onQuickOpenChange(false)} />}</div><ThinkingChip level={modelState?.thinkingLevel ?? 'off'} levels={modelState?.availableThinkingLevels ?? []} onChange={level => void onThinkingChange(level)} /></div><div className="composer-stats" data-testid="composer-session-stats"><SessionStatsPill host={host} sessionId={sessionId} isStreaming={streaming} isCompacting={compacting} compactingLabel={compactingLabel ?? undefined} refreshKey={statsRefreshKey} /><QuotaPill host={host} sessionId={sessionId} provider={modelState?.model.provider} modelId={modelState?.model.id} refreshKey={statsRefreshKey} /><BalancePill host={host} sessionId={sessionId} provider={modelState?.model.provider} refreshKey={statsRefreshKey} /></div></div>
})

function Composer({ onboarding = false, streaming, working, stopping, stopError, compacting, compactingLabel, queueBusy, readOnly, leaseOwner, onTakeover, readOnlyMessage, modelState, host, sessionId, initialDraft = '', initialAttachments = EMPTY_COMPOSER_ATTACHMENTS, initialDocuments = EMPTY_COMPOSER_DOCUMENTS, onDraftChange, onAttachmentsChange, onDocumentsChange, statsRefreshKey, visibility, catalogNotice, onDismissCatalogNotice, onOpenModelManager, onCompact, onSend, onStop, onDismissStopError, onModel, onEnsureSession }: { onboarding?: boolean; streaming: boolean; working: boolean; stopping: boolean; stopError: string | null; compacting: boolean; compactingLabel?: string | null; queueBusy: boolean; readOnly: boolean; leaseOwner?: string; onTakeover?: () => void; readOnlyMessage?: string; modelState: ModelState | null; host: PipiHostAPI; sessionId: string; initialDraft?: string; initialAttachments?: ComposerAttachment[]; initialDocuments?: ComposerDocument[]; onDraftChange?: (draft: string) => void; onAttachmentsChange?: (attachments: ComposerAttachment[]) => void; onDocumentsChange?: (documents: ComposerDocument[]) => void; statsRefreshKey: number; visibility: ModelVisibilityController; catalogNotice?: string | null; onDismissCatalogNotice?: () => void; onOpenModelManager: () => void; onCompact: () => void; onSend: (draft: string, attachments?: ComposerAttachment[], documents?: ComposerDocument[], hasReadyInputFiles?: boolean) => Promise<boolean>; onStop: () => void; onDismissStopError: () => void; onModel: (state: ModelState) => void; onEnsureSession: () => Promise<string | null> }) {
  const [draft, setDraft] = useState(initialDraft)
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(initialAttachments)
  const [documents, setDocuments] = useState<ComposerDocument[]>(initialDocuments)
  const [draftSessionId, setDraftSessionId] = useState(sessionId)
  if (sessionId !== draftSessionId) {
    setDraftSessionId(sessionId)
    setDraft(initialDraft)
    setAttachments(initialAttachments)
    setDocuments(initialDocuments)
  }
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [inputFileGate, setInputFileGate] = useState<InputFileGate>(EMPTY_INPUT_FILE_GATE)
  const [inputFilesEpoch, setInputFilesEpoch] = useState(0)
  const [quickOpen, setQuickOpen] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashHidden, setSlashHidden] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputFilesApiRef = useRef<InputFileAttachmentsHandle>(null)

  // Session switch resets composer chrome only. Attachments (and their object
  // URLs) belong to the session in the parent's attachmentsBySessionRef; they
  // are restored from there when this session is selected again and must never
  // be revoked here, or a parked session's thumbnails would die on switch.
  useEffect(() => {
    setLightboxIndex(null)
    setAttachError(null)
    setSendError(null)
    setQuickOpen(false)
    setInputFileGate(EMPTY_INPUT_FILE_GATE)
  }, [sessionId])
  // Esc closes the lightbox and the quick menu.
  useEffect(() => {
    if (lightboxIndex === null && !quickOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setLightboxIndex(null); setQuickOpen(false) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxIndex, quickOpen])

  const registeredSlashCommands = useSlashCommands()
  // Memoized on the draft so re-renders that don't change the text (palette
  // navigation, streaming flags, error states) skip re-parsing the draft.
  const slashQuery = useMemo(() => slashPaletteQuery(draft), [draft])
  const slashMatches = useMemo(() => (slashQuery === null ? [] : filterSlashCommands(slashQuery)), [slashQuery, registeredSlashCommands])
  const slashVisible = slashQuery !== null && !slashHidden

  useEffect(() => { setSlashIndex(0) }, [slashQuery])
  useEffect(() => { setSlashIndex(i => Math.min(i, Math.max(0, slashMatches.length - 1))) }, [slashMatches.length])
  // Auto-grow: typing, paste, deletion and programmatic clears all flow through `draft`.
  // The cheap line estimate is applied during render (textarea style below) so the
  // height tracks the draft without layout; the exact scrollHeight measurement is
  // coalesced into one animation frame per input burst, and the effect cleanup cancels
  // the pending frame whenever a newer draft arrives. The frame after the final change
  // (last keystroke, IME composition end, post-send reset) settles the height.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.style.height = 'auto'
      const measured = el.scrollHeight > 0 ? el.scrollHeight : estimatedTextareaHeight(draft)
      el.style.height = `${Math.min(measured, MAX_COMPOSER_HEIGHT)}px`
    })
    return () => cancelAnimationFrame(frame)
  }, [draft])

  const persistDraft = (value: string) => { setDraft(value); onDraftChange?.(value) }
  const changeDraft = (value: string) => { persistDraft(value); setSlashHidden(false) }
  const dismissSlash = () => setSlashHidden(true)
  const executeSlash = (command: SlashCommandDef) => {
    setSlashHidden(true)
    if (command.action.kind === 'open-model-manager') {
      onOpenModelManager()
      persistDraft('') // Swift executeSlash clears the draft before running the command
    } else if (command.action.kind === 'compact') {
      onCompact()
      persistDraft('')
    } else if (command.action.kind === 'send-plan' || command.action.kind === 'send-prompt' || command.action.kind === 'send-selfdev') {
      const invocation = parseSlashInvocation(draft)
      const args = invocation?.name === command.name ? invocation.args : ''
      const outgoing = command.action.kind === 'send-plan'
        ? planPromptFromArgs(args)
        : command.action.kind === 'send-selfdev'
          ? selfdevPromptFromArgs(args)
          : command.prompt
            ? applySlashPrompt(command.prompt, args)
            : (draft.trim() || `/${command.name}`)
      void dispatchSend(outgoing)
    }
  }

  const removeAttachment = (id: string) => {
    if (readOnly) return
    const next = attachments.filter(a => a.id !== id)
    const target = attachments.find(a => a.id === id)
    if (target) URL.revokeObjectURL(target.url)
    setAttachments(next)
    onAttachmentsChange?.(next)
    if (lightboxIndex !== null) setLightboxIndex(null)
  }
  const addFiles = (files: File[]) => {
    if (readOnly || !files.length) return
    let firstError: string | null = null
    const accepted: ComposerAttachment[] = []
    for (const file of files) {
      const problem = validateAttachment(file)
      if (problem) { firstError ??= problem; continue }
      accepted.push({ id: crypto.randomUUID(), name: file.name, mimeType: file.type, size: file.size, url: URL.createObjectURL(file), file })
    }
    if (accepted.length) {
      const next = [...attachments, ...accepted]
      setAttachments(next)
      onAttachmentsChange?.(next)
    }
    if (firstError) setAttachError(firstError)
  }
  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (readOnly) return
    const pasted = filesFromClipboard(event.clipboardData)
    const imageFiles = imageFilesFromClipboard(event.clipboardData)
    const inputFiles = modelHasInputFiles(modelState?.model) ? composerInputFilesFromList(pasted) : []
    if (!imageFiles.length && !inputFiles.length) return
    event.preventDefault()
    setAttachError(null)
    if (imageFiles.length) addFiles(imageFiles)
    if (inputFiles.length) void inputFilesApiRef.current?.stageFiles(inputFiles)
  }
  const addDocuments = (paths: string[]) => {
    if (readOnly || !paths.length) return
    const existing = new Set(documents.map(document => document.path))
    const accepted: ComposerDocument[] = []
    for (const path of paths) {
      if (existing.has(path)) continue
      existing.add(path)
      accepted.push({ id: crypto.randomUUID(), name: composerDocumentName(path) || path, path })
    }
    if (!accepted.length) return
    const next = [...documents, ...accepted]
    setDocuments(next)
    onDocumentsChange?.(next)
  }
  const removeDocument = (id: string) => {
    if (readOnly) return
    const next = documents.filter(document => document.id !== id)
    setDocuments(next)
    onDocumentsChange?.(next)
  }
  const onComposerFileDrag = (event: DragEvent) => {
    if (!fileDragHasFiles(event)) return
    consumeFileDropEvent(event)
  }
  const onComposerFileDrop = (event: DragEvent) => {
    if (!fileDragHasFiles(event)) return
    if (readOnly) {
      ignoreComposerFileDrag(event)
      return
    }
    const dropped = event.dataTransfer?.files
    const imageFiles = imageFilesFromFileList(dropped)
    const inputFiles = modelHasInputFiles(modelState?.model) ? composerInputFilesFromList(dropped ?? []) : []
    if (imageFiles.length || inputFiles.length) {
      consumeFileDropEvent(event)
      setAttachError(null)
      if (imageFiles.length) addFiles(imageFiles)
      if (inputFiles.length) void inputFilesApiRef.current?.stageFiles(inputFiles)
      return
    }
    const getPath = typeof window !== 'undefined' ? window.pipiPathForFile : undefined
    if (!getPath) {
      ignoreComposerFileDrag(event)
      return
    }
    const paths = supportedDocumentPathsFromFiles(dropped ?? [], getPath)
    if (!paths.length) {
      ignoreComposerFileDrag(event)
      return
    }
    consumeFileDropEvent(event)
    addDocuments(paths)
  }

  const dispatchSend = async (outgoing: string) => {
    if (readOnly) return
    const hasText = outgoing.trim() !== ''
    if (!hasText && attachments.length === 0 && documents.length === 0 && !inputFileGate.hasReady) return
    if (inputFileGate.blockingReason) {
      setSendError(inputFileGate.blockingReason)
      return
    }
    if (attachments.length > 0 && modelState?.model && modelState.model.supportsImages === false) {
      setSendError(`当前模型 ${modelState.model.name} 不支持图片附件`)
      return
    }
    setSendError(null)
    const outgoingAttachments = attachments.slice()
    const outgoingDocuments = documents.slice()
    // Clear immediately. sendPrompt/enqueue can sit on ensure+RPC for seconds
    // while the optimistic bubble is already visible; waiting to clear after
    // that promise leaves the same text in the composer.
    persistDraft('')
    setAttachments([])
    onAttachmentsChange?.([])
    setDocuments([])
    onDocumentsChange?.([])
    setAttachError(null)
    try {
      const ok = await onSend(outgoing, outgoingAttachments.length ? outgoingAttachments : undefined, outgoingDocuments.length ? outgoingDocuments : undefined, inputFileGate.hasReady)
      if (ok) setInputFilesEpoch(value => value + 1)
      if (!ok) {
        persistDraft(outgoing)
        setAttachments(outgoingAttachments)
        onAttachmentsChange?.(outgoingAttachments)
        setDocuments(outgoingDocuments)
        onDocumentsChange?.(outgoingDocuments)
        return
      }
      for (const attachment of outgoingAttachments) URL.revokeObjectURL(attachment.url)
    } catch (err) {
      persistDraft(outgoing)
      setAttachments(outgoingAttachments)
      onAttachmentsChange?.(outgoingAttachments)
      setDocuments(outgoingDocuments)
      onDocumentsChange?.(outgoingDocuments)
      setSendError(`发送失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const submit = async () => {
    if (readOnly) return
    const invocation = parseSlashInvocation(draft)
    const command = invocation ? slashCommandByName(invocation.name) : undefined
    if (command) { executeSlash(command); return }
    await dispatchSend(draft.trim() !== '' ? draft : '')
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      if (slashVisible) { event.preventDefault(); dismissSlash() }
      return
    }
    if (event.key === 'ArrowDown' && slashVisible && slashMatches.length) { event.preventDefault(); setSlashIndex(i => Math.min(i + 1, slashMatches.length - 1)); return }
    if (event.key === 'ArrowUp' && slashVisible && slashMatches.length) { event.preventDefault(); setSlashIndex(i => Math.max(i - 1, 0)); return }
    if (event.key === 'Tab' && slashVisible && slashMatches.length) { event.preventDefault(); persistDraft(`/${slashMatches[Math.min(slashIndex, slashMatches.length - 1)].name} `); setSlashHidden(true); return }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (slashVisible && slashMatches.length > 0) { executeSlash(slashMatches[Math.min(slashIndex, slashMatches.length - 1)]); return }
      void submit()
    }
  }
  const setThinking = useCallback(async (level: ThinkingLevel) => {
    const previous = modelState
    if (previous) onModel({ ...previous, thinkingLevel: level })
    try {
      const targetSession = sessionId || await onEnsureSession()
      if (!targetSession) throw new Error('没有可用会话')
      onModel(await host.setThinkingLevel(targetSession, level))
      setSendError(null)
    } catch (err) {
      if (previous) onModel(previous)
      setSendError(`切换思考级别失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [modelState, host, sessionId, onEnsureSession, onModel])
  const handleQuickSelect = useCallback(async (model: Model) => {
    setQuickOpen(false)
    const previous = modelState
    const availableThinkingLevels = thinkingLevelsForModel(model)
    onModel({
      model,
      thinkingLevel: resolveThinkingLevel(previous?.thinkingLevel, availableThinkingLevels) ?? 'off',
      availableThinkingLevels,
    })
    try {
      const targetSession = sessionId || await onEnsureSession()
      if (!targetSession) throw new Error('没有可用会话')
      onModel(await host.setModel(targetSession, model.provider, model.id))
      setSendError(null)
    } catch (err) {
      if (previous) onModel(previous)
      setSendError(`切换模型失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [modelState, host, sessionId, onEnsureSession, onModel])
  const canSend = !readOnly && !onboarding && (draft.trim() !== '' || attachments.length > 0 || documents.length > 0 || inputFileGate.hasReady || inputFileGate.hasUnsent)
  // Chromium's AXObjectCache invalidates an existing text field on `class`
  // changes but not on `placeholder` changes. Keep the same textarea (and thus
  // draft/focus/IME ownership) while making busy → idle dirty the AX node.
  const inputStateClass = queueBusy ? 'composer-input queue-busy' : working ? 'composer-input working' : 'composer-input idle'
  return <footer className="composer" onDragEnter={onComposerFileDrag} onDragOver={onComposerFileDrag} onDrop={onComposerFileDrop}>
    {readOnly && <div className="composer-read-only" data-testid="composer-read-only" role="status"><span>{readOnlyMessage ?? `当前由 ${leaseOwner ?? '另一客户端'} 持有，会话只读。`}</span>{onTakeover && <button type="button" data-testid="composer-lease-takeover" onClick={onTakeover}>强制接管</button>}</div>}
    {slashVisible && <SlashMenu commands={slashMatches} selectedIndex={Math.min(slashIndex, Math.max(0, slashMatches.length - 1))} onHighlight={setSlashIndex} onSelect={executeSlash} onDismiss={dismissSlash} />}
    {attachments.length > 0 && <div className="composer-thumbs" data-testid="composer-thumbs">
      {attachments.map((attachment, index) => (
        <div key={attachment.id} className="composer-thumb" data-testid={`composer-thumb-${index}`}>
          <img src={attachment.url} alt={attachment.name} onClick={() => setLightboxIndex(index)} />
          <button className="composer-thumb-remove" aria-label={`移除图片 ${attachment.name}`} disabled={readOnly} onClick={() => removeAttachment(attachment.id)}>×</button>
        </div>
      ))}
    </div>}
    {documents.length > 0 && <div className="composer-doc-chips" data-testid="composer-doc-chips">
      {documents.map((document, index) => (
        <div key={document.id} className="composer-doc-chip" data-testid={`composer-doc-chip-${index}`} title={document.path}>
          <span className="composer-doc-chip-name">{document.name}</span>
          <button className="composer-doc-chip-remove" aria-label={`移除文件 ${document.name}`} disabled={readOnly} onClick={() => removeDocument(document.id)}>×</button>
        </div>
      ))}
    </div>}
    <InputFileAttachments ref={inputFilesApiRef} host={host} sessionId={sessionId} model={modelState?.model} readOnly={readOnly} working={working} refreshKey={inputFilesEpoch} onEnsureSession={onEnsureSession} onGateChange={setInputFileGate} onNotice={setAttachError} />
    {catalogNotice && onDismissCatalogNotice && (
      <div data-testid="catalog-fallback-notice">
        <DismissibleError className="composer-catalog-notice" message={catalogNotice} onDismiss={onDismissCatalogNotice} />
      </div>
    )}
    {(attachError || sendError || stopError) && <div className="composer-error" data-testid="composer-error"><span>{stopError ?? sendError ?? attachError}</span><button className="composer-error-close" aria-label="关闭错误提示" data-testid="composer-error-close" onClick={() => { setSendError(null); setAttachError(null); onDismissStopError() }}>×</button></div>}
    <div className="composer-card"><div className="composer-shell"><textarea ref={textareaRef} className={inputStateClass} aria-label="消息输入框" disabled={readOnly || onboarding} value={draft} placeholder={onboarding ? '先在上方选择剧本，准备好后开始游戏' : readOnly ? '会话由另一版本运行中' : queueBusy ? 'Boss 正在工作，发送将进入队列，待当前回复完成后处理…' : '给 PipiUI 发送消息…'} rows={1} style={{ height: `${estimatedTextareaHeight(draft)}px` }} onChange={event => changeDraft(event.target.value)} onKeyDown={onKeyDown} onPaste={onPaste} />{working && <button aria-label={stopping ? '正在停止' : '停止生成'} className="send stop" disabled={stopping} onClick={onStop}>{stopping ? '…' : '■'}</button>}<button aria-label="发送消息" title={queueBusy ? '加入队列，待 Boss 当前回复完成后发送' : undefined} className="send" disabled={!canSend} onClick={() => void submit()}>↑</button></div></div>
    <ComposerOptions readOnly={readOnly} streaming={streaming} compacting={compacting} compactingLabel={compactingLabel} statsRefreshKey={statsRefreshKey} host={host} sessionId={sessionId} modelState={modelState} visibility={visibility} quickOpen={quickOpen} onSelectModel={handleQuickSelect} onThinkingChange={setThinking} onQuickOpenChange={setQuickOpen} />
    {lightboxIndex !== null && attachments[lightboxIndex] && <div className="lightbox-backdrop" data-testid="lightbox" onMouseDown={event => { if (event.target === event.currentTarget) setLightboxIndex(null) }}><img src={attachments[lightboxIndex].url} alt="图片预览" /><button className="lightbox-close" aria-label="关闭预览" onClick={() => setLightboxIndex(null)}>×</button></div>}
  </footer>
}
function ToolQuickRail({ variant, collapsible = false, activeTab, toolsCollapsed, onSelect, host, browserAvailable, terminalAvailable, planTabVisible, planProgress, subagentsRunningCount }: { variant: 'header' | 'float'; collapsible?: boolean; activeTab: PanelTab; toolsCollapsed: boolean; onSelect: (tab: PanelTab) => void; host: PipiHostAPI; browserAvailable: boolean | undefined; terminalAvailable: boolean | undefined; planTabVisible: boolean; planProgress: { completed: number; total: number } | null; subagentsRunningCount: number }) {
  const panels = usePanels()
  const railCtx: PanelRailContext = { host, browserAvailable, terminalAvailable, planTabVisible, planProgress, subagentsRunningCount }
  const [floatCollapsed, setFloatCollapsed] = useState(() => {
    if (variant !== 'float') return false
    try { return localStorage.getItem(TOOL_QUICK_RAIL_COLLAPSED_KEY) === 'true' } catch { return false }
  })
  const visiblePanels = panels.filter(panel => !panel.visibleInRail || panel.visibleInRail(railCtx))
  const compact = variant === 'float' && collapsible && floatCollapsed
  const displayedPanels = compact
    ? [visiblePanels.find(panel => panel.id === activeTab) ?? visiblePanels[0]].filter(Boolean)
    : visiblePanels
  const toggleCompact = () => {
    const next = !floatCollapsed
    setFloatCollapsed(next)
    try { localStorage.setItem(TOOL_QUICK_RAIL_COLLAPSED_KEY, String(next)) } catch { /* local layout preference is best-effort */ }
  }
  return <nav className={`tool-quick-rail tool-quick-rail-${variant}${compact ? ' is-collapsed' : ''}`} aria-label="工具面板" data-testid="tool-quick-rail">
    {displayedPanels.map(panel => {
      const unavailableTitle = panel.railUnavailable?.(railCtx)
      const unavailable = Boolean(unavailableTitle)
      const active = activeTab === panel.id && !toolsCollapsed
      return <button key={panel.id} className={`tool-rail-button${active ? ' active' : ''}`} aria-label={panel.id} aria-current={active ? 'page' : undefined} aria-disabled={unavailable || undefined} disabled={unavailable} title={unavailable ? unavailableTitle : panel.id} onClick={() => onSelect(panel.id)}>
        <span className="tool-rail-icon" aria-hidden="true" style={{ width: 13 * panel.icon.ratio, WebkitMaskImage: `url(${panel.icon.src})`, maskImage: `url(${panel.icon.src})` }} />
        {panel.railBadge?.(railCtx)}
      </button>
    })}
    {variant === 'float' && collapsible && <button type="button" className="tool-rail-button tool-rail-collapse" aria-label={compact ? '展开工具快捷栏' : '收起工具快捷栏'} aria-expanded={!compact} title={compact ? '展开工具快捷栏' : '收起工具快捷栏'} onClick={toggleCompact}><span aria-hidden="true">{compact ? '‹' : '›'}</span></button>}
  </nav>
}
/** Exported for the drop-ownership tests; the shell renders it internally. */
export function ToolPanel({ activeTab, collapsed, onToggleCollapsed, rail, canGoBack, onBack, host, theme, sessionId, announcedTerminal, revealedTerminalId, onSubagentsRunningCountChange, onSubagentStarted, onManualSubagentStatusCheck, browserAvailable, browserOccluded, terminalAvailable, planAvailable, onPlanProgressChange, onHasPlansChange, retainedWorktreeDispositionAvailable, projectId, projectPath, openedDocumentPath, openedDocumentPaths, onOpenDocument, onActivateDocument, onCloseDocument, onDropDocuments, workspaceFullscreen = false, onToggleWorkspaceFullscreen }: { activeTab: PanelTab; collapsed: boolean; onToggleCollapsed: () => void; rail?: ReactNode; canGoBack: boolean; onBack: () => void; host: PipiHostAPI; theme: 'light' | 'dark'; sessionId?: string; announcedTerminal?: TerminalSession; revealedTerminalId?: string; onSubagentsRunningCountChange: (count: number) => void; onSubagentStarted: () => void; onManualSubagentStatusCheck: (agentIDs: string[]) => void; browserAvailable: boolean | undefined; browserOccluded: boolean; terminalAvailable: boolean | undefined; planAvailable: boolean | undefined; onPlanProgressChange: (progress: { completed: number; total: number } | null) => void; onHasPlansChange: (sessionId: string, hasPlans: boolean) => void; retainedWorktreeDispositionAvailable: boolean; projectId?: string; projectPath?: string; openedDocumentPath?: string | null; openedDocumentPaths?: readonly string[]; onOpenDocument: (path: string) => void; onActivateDocument?: (path: string) => void; onCloseDocument?: (path: string) => void; onDropDocuments: (paths: string[]) => void; workspaceFullscreen?: boolean; onToggleWorkspaceFullscreen?: () => void }) {
  const panels = usePanels()
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null)
  const [mountedIds, setMountedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    for (const panel of panels) {
      if (!panel.lazy || panel.id === activeTab) initial.add(panel.id)
    }
    return initial
  })
  const [dropActive, setDropActive] = useState(false)
  const dropDepthRef = useRef(0)
  useEffect(() => {
    setMountedIds(current => current.has(activeTab) ? current : new Set(current).add(activeTab))
  }, [activeTab])
  // A panel that collects files resolves them through the host, never through a
  // browser global of its own (contract: PanelProps.resolveDroppedPaths).
  const resolveDroppedPaths = useCallback((files: ArrayLike<File>): string[] => {
    const getPath = typeof window !== 'undefined' ? window.pipiPathForFile : undefined
    return getPath ? supportedDocumentPathsFromFiles(files, getPath) : []
  }, [])
  /**
   * A drop belongs to the tab you are looking at.
   *
   * The shell used to open anything dropped anywhere in the right rail as a
   * document, whichever panel was showing. That made a panel with its own drop
   * targets — a reference shelf, say — nearly unusable: miss the small zone by a
   * few pixels and the file opened in the Document tab instead. So the shell now
   * only claims drops while the Document panel is the one on screen; any other
   * panel owns its own, and a panel that wants none simply ignores them.
   */
  const shellOwnsDrop = activeTab === DOCUMENT_PANEL_TAB
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
  const onDragEnter = (event: DragEvent) => {
    if (!shellOwnsDrop || !hasFiles(event)) return
    consumeFileDropEvent(event)
    dropDepthRef.current += 1
    setDropActive(true)
  }
  const onDragOver = (event: DragEvent) => {
    if (!shellOwnsDrop || !hasFiles(event)) return
    consumeFileDropEvent(event)
  }
  const onDragLeave = (event: DragEvent) => {
    if (!shellOwnsDrop || !hasFiles(event)) return
    consumeFileDropEvent(event)
    dropDepthRef.current = Math.max(0, dropDepthRef.current - 1)
    if (dropDepthRef.current === 0) setDropActive(false)
  }
  const onDrop = (event: DragEvent) => {
    if (!shellOwnsDrop) return
    consumeFileDropEvent(event)
    dropDepthRef.current = 0
    setDropActive(false)
    const getPath = typeof window !== 'undefined' ? window.pipiPathForFile : undefined
    if (!getPath) return
    onDropDocuments(supportedDocumentPathsFromFiles(event.dataTransfer.files, getPath))
  }
  return <aside className={`tool-panel${dropActive ? ' drop-target' : ''}`} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    <div className="tool-panel-drop-overlay" aria-hidden="true" />
    {!collapsed && <header className="tool-panel-header">{rail}{canGoBack && <button type="button" className="tool-panel-back" data-testid="tool-panel-back" aria-label="返回上一栏" onClick={onBack}>‹ 返回</button>}<div className="tool-panel-header-slot" ref={el => setHeaderSlot(el)} /><button className="pane-toggle" data-testid="toggle-tools" title="收起右栏" aria-label="收起右栏" aria-expanded="true" onClick={onToggleCollapsed}><RightPaneToggleIcon expanded /></button></header>}
    <div className="tool-content">
      {panels.map(panel => {
        if (panel.lazy && !mountedIds.has(panel.id) && panel.id !== activeTab) return null
        return <Fragment key={panel.id}>{panel.render({
          host, theme, sessionId, collapsed, active: activeTab === panel.id, headerSlot,
          announcedTerminal, revealedTerminalId, onSubagentsRunningCountChange, onSubagentStarted,
          onManualSubagentStatusCheck, browserAvailable, browserOccluded, terminalAvailable, planAvailable,
          onPlanProgressChange, onHasPlansChange, retainedWorktreeDispositionAvailable, projectId, projectPath,
          openedDocumentPath, openedDocumentPaths, onOpenDocument, onActivateDocument, onCloseDocument,
          resolveDroppedPaths, workspaceFullscreen, onToggleWorkspaceFullscreen,
        })}</Fragment>
      })}
    </div>
  </aside>
}
