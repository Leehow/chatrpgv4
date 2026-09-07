import { documentKindForName, thinkingLevelsForModel } from '@pipi/host-api'
import type { AgentDefinition, AgentSummary, BrowserEvent, BrowserHostAPI, BrowserSnapshot, BrowserTab, BrowserTabsSnapshot, BrowserViewBounds, ExtensionDescriptor, GitStatus, HistoryEntry, HostCapabilities, Model, ModelState, PipiHostAPI, PlanSnapshot, Project, Session, SidebarSessionPreferences, StreamEvent, SubagentModelSetting } from '@pipi/host-api'
import { chatImagesFromAttachments } from './attachments'
import { SESSION_ORDER_VERSION } from './session-order'
import { DEMO_BOSS_TOOL_NAMES, DEMO_SKILL_NAMES } from './subagent-debug-demo'

/**
 * Browser-preview / test fixture host. Production injects the Electron
 * preload/IPC host; nothing here is reachable from the real shell.
 */

/** Mock/demo host only: survives browser-demo reloads because the demo has no pi session to own model state. The real host never reads/writes this key. */
export const DEMO_MODEL_STORAGE_KEY = 'pipiui.demoModel'
/** Demo-only per-session model map (sessionId → {provider, id}); the real host binds models per session via JSONL `model_change`, this key only survives browser-demo reloads. */
export const DEMO_SESSION_MODELS_STORAGE_KEY = 'pipiui.demoSessionModels'

function metadataString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

type MockBrowserTab = BrowserTab & { history: string[]; historyIndex: number }

function mockBrowserURL(value: string): string {
  const input = value.trim()
  if (!input) return ''
  if (/^(about:|file:|https?:\/\/)/i.test(input)) return input
  if (/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(input)) return `http://${input}`
  if (/\s/.test(input) || !input.includes('.')) return `https://www.google.com/search?q=${encodeURIComponent(input)}`
  return `https://${input}`
}

function mockBrowserTitle(url: string): string {
  if (!url || url === 'about:blank') return '新标签页'
  try { return new URL(url).hostname || url } catch { return url }
}

function createMockBrowserHost(): BrowserHostAPI {
  let sequence = 0
  let lastBounds: BrowserViewBounds | undefined
  const listeners = new Set<(event: BrowserEvent) => void>()
  // Each chat session owns its own tab space (BrowserTab.partition is the
  // real-world storage partition; the mock mirrors that isolation with a
  // per-session tab list). Events carry the sessionId so the panel can drop
  // tab events from other sessions.
  const spaces = new Map<string, { tabs: MockBrowserTab[]; activeTabId?: string }>()
  const copy = (tab: MockBrowserTab): BrowserTab => {
    const { history: _history, historyIndex: _historyIndex, ...publicTab } = tab
    return { ...publicTab }
  }
  const space = (sessionId: string) => {
    let existing = spaces.get(sessionId)
    if (!existing) {
      const first: MockBrowserTab = { id: `mock-browser-${++sequence}`, title: '新标签页', url: '', isLoading: false, canGoBack: false, canGoForward: false, history: [], historyIndex: -1 }
      existing = { tabs: [first], activeTabId: first.id }
      spaces.set(sessionId, existing)
    }
    return existing
  }
  const state = (sessionId: string): BrowserTabsSnapshot => {
    const target = space(sessionId)
    return { tabs: target.tabs.map(copy), activeTabId: target.activeTabId }
  }
  const emit = (sessionId: string) => listeners.forEach(listener => listener({ type: 'tabs', sessionId, snapshot: state(sessionId) } satisfies BrowserEvent))
  const create = (sessionId: string, url = '') => {
    const target = space(sessionId)
    const tab: MockBrowserTab = { id: `mock-browser-${++sequence}`, title: mockBrowserTitle(url), url, isLoading: false, canGoBack: false, canGoForward: false, history: url ? [url] : [], historyIndex: url ? 0 : -1 }
    target.tabs.push(tab)
    target.activeTabId ??= tab.id
    return tab
  }
  const tabFor = (sessionId: string, id?: string) => {
    const target = space(sessionId)
    const tab = id ? target.tabs.find(item => item.id === id) : target.tabs.find(item => item.id === target.activeTabId)
    if (!tab) throw new Error(`unknown browser tab: ${id ?? target.activeTabId ?? ''}`)
    return tab
  }
  const activate = (sessionId: string, id?: string) => {
    const tab = tabFor(sessionId, id)
    space(sessionId).activeTabId = tab.id
    return tab
  }
  const updateButtons = (tab: MockBrowserTab) => {
    tab.canGoBack = tab.historyIndex > 0
    tab.canGoForward = tab.historyIndex >= 0 && tab.historyIndex < tab.history.length - 1
  }
  const settle = async (sessionId: string, tab: MockBrowserTab) => {
    tab.isLoading = true
    emit(sessionId)
    await Promise.resolve()
    tab.isLoading = false
    emit(sessionId)
    return copy(tab)
  }
  return {
    selectSession: async sessionId => { void space(sessionId) },
    listTabs: async sessionId => state(sessionId),
    getActiveTab: async sessionId => { const target = space(sessionId); return target.activeTabId ? copy(tabFor(sessionId, target.activeTabId)) : undefined },
    newTab: async (sessionId, options) => {
      const url = options?.url ? mockBrowserURL(options.url) : ''
      const tab = create(sessionId, url)
      space(sessionId).activeTabId = tab.id
      emit(sessionId)
      return copy(tab)
    },
    switchTab: async (sessionId, id) => {
      const tab = activate(sessionId, id)
      emit(sessionId)
      return copy(tab)
    },
    closeTab: async (sessionId, id) => {
      const target = space(sessionId)
      const index = target.tabs.findIndex(tab => tab.id === id)
      if (index < 0) throw new Error(`unknown browser tab: ${id}`)
      const wasActive = target.activeTabId === id
      target.tabs.splice(index, 1)
      if (target.tabs.length === 0) {
        const fresh = create(sessionId)
        target.activeTabId = fresh.id
      } else if (wasActive) {
        target.activeTabId = target.tabs[Math.min(index, target.tabs.length - 1)].id
      }
      emit(sessionId)
      return state(sessionId)
    },
    loadURL: async (sessionId, value, id) => {
      const url = mockBrowserURL(value)
      if (!url) throw new Error('请输入网址或搜索内容。')
      const tab = activate(sessionId, id)
      if (tab.history[tab.historyIndex] !== url) {
        tab.history.splice(tab.historyIndex + 1)
        tab.history.push(url)
        tab.historyIndex = tab.history.length - 1
      }
      tab.url = url
      tab.title = mockBrowserTitle(url)
      updateButtons(tab)
      return settle(sessionId, tab)
    },
    goBack: async (sessionId, id) => {
      const tab = activate(sessionId, id)
      if (tab.historyIndex > 0) {
        tab.historyIndex -= 1
        tab.url = tab.history[tab.historyIndex]
        tab.title = mockBrowserTitle(tab.url)
        updateButtons(tab)
        return settle(sessionId, tab)
      }
      emit(sessionId)
      return copy(tab)
    },
    goForward: async (sessionId, id) => {
      const tab = activate(sessionId, id)
      if (tab.historyIndex < tab.history.length - 1) {
        tab.historyIndex += 1
        tab.url = tab.history[tab.historyIndex]
        tab.title = mockBrowserTitle(tab.url)
        updateButtons(tab)
        return settle(sessionId, tab)
      }
      emit(sessionId)
      return copy(tab)
    },
    reload: async (sessionId, id) => settle(sessionId, activate(sessionId, id)),
    snapshot: async (sessionId, id) => {
      const tab = tabFor(sessionId, id)
      const snapshot: BrowserSnapshot = { tabId: tab.id, url: tab.url, title: tab.title, isLoading: tab.isLoading, text: 'mock browser snapshot' }
      return snapshot
    },
    setViewBounds: async (_sessionId, bounds) => { lastBounds = { ...bounds }; void lastBounds },
    setZoomFactor: async (_sessionId, factor) => {
      const next = Number.isFinite(factor) ? factor : 1
      return Math.min(5, Math.max(0.25, Math.round(next * 100) / 100))
    },
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) }
  }
}

/** Demo-only persistence of the selected model ({provider, id}); invalid/missing values return null so the caller falls back to the default. */
function readDemoModel(): { provider: string; id: string } | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DEMO_MODEL_STORAGE_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const candidate = value as { provider?: unknown; id?: unknown }
    const provider = metadataString(candidate.provider)
    const id = metadataString(candidate.id)
    return provider && id ? { provider, id } : null
  } catch { return null }
}

function writeDemoModel(model: Model) {
  try { localStorage.setItem(DEMO_MODEL_STORAGE_KEY, JSON.stringify({ provider: model.provider, id: model.id })) } catch { /* storage can be disabled by the host */ }
}

function readDemoSessionModels(): Record<string, { provider: string; modelId: string }> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DEMO_SESSION_MODELS_STORAGE_KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const out: Record<string, { provider: string; modelId: string }> = {}
    for (const [sessionId, raw] of Object.entries(value)) {
      if (!sessionId || !raw || typeof raw !== 'object') continue
      const candidate = raw as { provider?: unknown; id?: unknown }
      const provider = metadataString(candidate.provider)
      const id = metadataString(candidate.id)
      if (provider && id) out[sessionId] = { provider, modelId: id }
    }
    return out
  } catch { return {} }
}

function writeDemoSessionModel(sessionId: string, model: Model) {
  try {
    const all = readDemoSessionModels()
    all[sessionId] = { provider: model.provider, modelId: model.id }
    const storageShape = Object.fromEntries(Object.entries(all).map(([sid, ref]) => [sid, { provider: ref.provider, id: ref.modelId }]))
    localStorage.setItem(DEMO_SESSION_MODELS_STORAGE_KEY, JSON.stringify(storageShape))
  } catch { /* storage can be disabled by the host */ }
}

/** Demo-only plan so the browser preview shows the Plan panel populated. */
function mockPlans(): PlanSnapshot[] {
  const base = Date.now() - 9 * 60_000
  const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString()
  return [{
    id: 'plan-electron-ui',
    title: '让 Electron 前端跟上 plan 运行时',
    lifecycle: 'approved',
    createdAt: at(0),
    approvedAt: at(1),
    updatedAt: at(8),
    active: true,
    tasks: [
      { id: 'contract', title: '在 host-api 里定义 plan 快照与事件通道', state: 'completed' },
      { id: 'store', title: '后端镜像 plan 事件并读回 .pi/plans', state: 'completed', note: '冷会话从磁盘补水一次' },
      { id: 'panel', title: '实现 Plan 面板与进度展示', state: 'in_progress' },
      { id: 'rail', title: '工具栏显示计划进度角标', state: 'pending' },
      { id: 'tests', title: '补面板与后端测试', state: 'pending' }
    ]
  }]
}

const MOCK_CAPABILITIES: Partial<HostCapabilities> = { revealInFinder: true, terminal: false, documents: true, browser: true, git: true, plan: true, retainedWorktreeDisposition: false }

/**
 * Capability snapshot for the mock host and tests. The literal is used as-is
 * (no defaults merged in) and only cast, so fixtures stay valid while the
 * host-api capability set changes shape.
 */
export function mockCapabilities(capabilities: Partial<HostCapabilities> = MOCK_CAPABILITIES): HostCapabilities {
  return capabilities as HostCapabilities
}

/** Local development host; production injects the Electron preload/IPC host. */
export function createMockHost(options: { productPacks?: boolean } = {}): PipiHostAPI {
  const projects: Project[] = [
    { id: 'pipiui', name: 'PipiUI', path: '/Users/demo/code/pipiui' },
    { id: 'website', name: 'Website', path: '/Users/demo/code/website' },
    { id: 'design', name: 'Design System', path: '/Users/demo/code/design-system' }
  ]
  const demoSessionModels = readDemoSessionModels()
  const sessions: Session[] = [
    { id: 'welcome', projectId: 'pipiui', name: 'Electron 三栏界面', updatedAt: Date.now(), model: demoSessionModels['welcome'] ?? { provider: 'anthropic', modelId: 'claude-sonnet-4' } },
    { id: 'layout', projectId: 'pipiui', name: '布局与流式消息', updatedAt: Date.now() - 2 * 3_600_000, model: demoSessionModels['layout'] ?? { provider: 'openai', modelId: 'gpt-5' } },
    { id: 'agent-run', projectId: 'pipiui', name: 'Subagent 面板验收', updatedAt: Date.now() - 5 * 60_000, model: demoSessionModels['agent-run'] ?? { provider: 'deepseek', modelId: 'deepseek-v3' } },
    { id: 'tool-burst', projectId: 'pipiui', name: '工具回合合并', updatedAt: Date.now() - 60_000, model: demoSessionModels['tool-burst'] ?? { provider: 'anthropic', modelId: 'claude-sonnet-4' } },
    { id: 'site', projectId: 'website', name: 'Landing page', updatedAt: Date.now() - 86_400_000, model: demoSessionModels['site'] ?? { provider: 'moonshot', modelId: 'moonshot-v8-32k' } },
    { id: 'analytics', projectId: 'website', name: '指标仪表盘', updatedAt: Date.now() - 3 * 86_400_000, model: demoSessionModels['analytics'] ?? { provider: 'xai', modelId: 'grok-4' } },
    // No model data: the row falls back to the neutral logo (unknown) until one is set.
    { id: 'tokens', projectId: 'design', name: '浅色主题 Token', updatedAt: Date.now() - 4 * 3_600_000, model: null }
  ]
  const history: Record<string, HistoryEntry[]> = {
    welcome: [
      { id: 'u1', role: 'user', content: '请实现 Electron 三栏主界面。', timestamp: Date.now() - 60_000 },
      { id: 'a1', role: 'assistant', content: '我会先检查现有结构，然后完成 UI。说明见 [README](README.md)。\n\n```tsx\nexport function App() {\n  return <MainLayout />\n}\n```', timestamp: Date.now() - 50_000 }
    ],
    layout: [{ id: 'u2', role: 'user', content: '左栏宽度要能持久化。', timestamp: Date.now() - 86_400_000 }],
    // pi emits one assistant message per tool round; 6 bash + 1 browser turns
    // must coalesce into a single folded card on resume (tool-cards-collapse).
    'tool-burst': [
      { id: 'tb-u', role: 'user', content: '把目录结构调整成 src 布局，并在浏览器里确认一下。', timestamp: Date.now() - 70_000 },
      { id: 'tb-a1', role: 'assistant', content: '', tools: [{ id: 'tb-call-1', name: 'bash', input: '{"command":"ls -la","cwd":"/Users/demo/code/pipiui"}' }], timestamp: Date.now() - 69_000 },
      { id: 'tb-r1', role: 'tool', content: 'drwxr-xr-x  Sources  Tests  Package.swift', toolCallId: 'tb-call-1', toolName: 'bash', timestamp: Date.now() - 68_000 },
      { id: 'tb-a2', role: 'assistant', content: '', tools: [{ id: 'tb-call-2', name: 'bash', input: '{"command":"mkdir -p Sources/App Sources/Core","cwd":"/Users/demo/code/pipiui"}' }], timestamp: Date.now() - 67_000 },
      { id: 'tb-r2', role: 'tool', content: 'ok', toolCallId: 'tb-call-2', toolName: 'bash', timestamp: Date.now() - 66_000 },
      { id: 'tb-a3', role: 'assistant', content: '', tools: [{ id: 'tb-call-3', name: 'bash', input: '{"command":"git status --short","cwd":"/Users/demo/code/pipiui"}' }], timestamp: Date.now() - 65_000 },
      { id: 'tb-r3', role: 'tool', content: '?? Sources/App/  ?? Sources/Core/', toolCallId: 'tb-call-3', toolName: 'bash', timestamp: Date.now() - 64_000 },
      { id: 'tb-a4', role: 'assistant', content: '', tools: [{ id: 'tb-call-4', name: 'bash', input: '{"command":"swift build","cwd":"/Users/demo/code/pipiui"}' }], timestamp: Date.now() - 63_000 },
      { id: 'tb-r4', role: 'tool', content: 'Build complete! (7.2s)', toolCallId: 'tb-call-4', toolName: 'bash', timestamp: Date.now() - 60_000 },
      { id: 'tb-a5', role: 'assistant', content: '', tools: [{ id: 'tb-call-5', name: 'bash', input: '{"command":"./scripts/build-app.sh --skip-tests","cwd":"/Users/demo/code/pipiui"}' }], timestamp: Date.now() - 59_000 },
      { id: 'tb-r5', role: 'tool', content: '打包完成 → build/PipiUI.app', toolCallId: 'tb-call-5', toolName: 'bash', timestamp: Date.now() - 55_000 },
      { id: 'tb-a6', role: 'assistant', content: '', tools: [{ id: 'tb-call-6', name: 'bash', input: '{"command":"stat -f \"%Sm %N\" build/PipiUI.app/Contents/MacOS/PipiUI","cwd":"/Users/demo/code/pipiui"}' }], timestamp: Date.now() - 54_000 },
      { id: 'tb-r6', role: 'tool', content: '2025-06-12 10:23:11 build/PipiUI.app/Contents/MacOS/PipiUI', toolCallId: 'tb-call-6', toolName: 'bash', timestamp: Date.now() - 53_000 },
      { id: 'tb-a7', role: 'assistant', content: '', tools: [{ id: 'tb-call-7', name: 'browser', input: '{"action":"navigate","url":"http://localhost:5176"}' }], timestamp: Date.now() - 52_000 },
      { id: 'tb-r7', role: 'tool', content: '页面已加载', toolCallId: 'tb-call-7', toolName: 'browser', timestamp: Date.now() - 50_000 },
      { id: 'tb-a8', role: 'assistant', content: '调整完成：src 布局就位，浏览器确认无回归。', timestamp: Date.now() - 49_000 },
    ],
    site: [{ id: 'u3', role: 'user', content: 'Review the landing page.', timestamp: Date.now() - 86_400_000 }]
  }
  const listeners = new Map<string, Set<(event: StreamEvent) => void>>()
  const allStreamListeners = new Set<(event: StreamEvent) => void>()
  const catalogListeners = new Set<(event: { type: 'catalog_changed'; reason: 'auth' | 'extension' | 'refresh' }) => void>()
  // Subagent fixtures are per-session, mirroring the real backend's
  // `filter(agent => !sessionId || agent.sessionId === sessionId)`:
  // switching sessions in the right panel shows that session's own tree.
  let mockAgents: AgentSummary[] = [
    { agentId: 'research', runId: 'mock-1', sessionId: 'welcome', name: 'explore', role: 'explore', title: '调研 UI', task: '调研 Electron UI 结构', state: 'running', depth: 1, createdAt: Date.now() - 20_000, cost: 0.03, costUnit: 'CNY', exchangeRate: 7.2, turns: 2, provider: 'anthropic', model: 'anthropic/claude-sonnet-4', contextTokens: 38_200, contextWindowTokens: 200_000, inputTokens: 12_400, outputTokens: 2_130, cacheTokens: 8_900, listSubtitle: '正在梳理右侧面板组件边界' },
    { agentId: 'review', runId: 'mock-2', sessionId: 'welcome', parentId: 'research', name: 'reviewer', role: 'review', title: '检查实现', task: '检查三栏实现', state: 'failed', depth: 2, createdAt: Date.now() - 10_000, endedAt: Date.now() - 2_000, cost: 0.01, costUnit: 'CNY', exchangeRate: 7.2, turns: 1, provider: 'openai', model: 'openai/gpt-5', contextTokens: 9_700, contextWindowTokens: 128_000, inputTokens: 4_200, outputTokens: 970, finalResult: '审查暂未通过：需要补齐右侧 rail 与执行记录的折叠卡对齐。' },
    { agentId: 'ui-check', runId: 'mock-3', sessionId: 'agent-run', name: 'operator', role: 'operator', title: 'UI 验收', task: '验收三栏布局与流式渲染', state: 'ok', depth: 1, createdAt: Date.now() - 30_000, endedAt: Date.now() - 5_000, cost: 0.05, costUnit: 'CNY', exchangeRate: 7.2, turns: 3, provider: 'anthropic', model: 'anthropic/claude-sonnet-4', contextTokens: 24_100, contextWindowTokens: 200_000, inputTokens: 8_300, outputTokens: 1_400, cacheTokens: 3_200, listSubtitle: '截图核对三栏对齐', finalResult: '布局验收通过：三栏对齐、消息流式渲染正常。' },
    { agentId: 'closeout', runId: 'mock-4', sessionId: 'agent-run', name: 'secretary', role: 'secretary', title: '收尾审计', task: '核对 worktree 与残留产物', state: 'ok', depth: 1, createdAt: Date.now() - 15_000, endedAt: Date.now() - 3_000, cost: 0.01, costUnit: 'CNY', exchangeRate: 7.2, turns: 1, provider: 'anthropic', model: 'anthropic/claude-sonnet-4', closeout: '已确认无残留', listSubtitle: '无未合并分支' }
  ]
  // Realistic multi-provider catalog so the picker exercises provider grouping.
  // supportsImages mirrors Swift ModelInfo.supportsImages (deepseek → false).
  let mockModels: Model[] = [
    { provider: 'anthropic', id: 'claude-sonnet-4', name: 'Claude Sonnet 4', reasoning: true, supportsImages: true },
    { provider: 'anthropic', id: 'claude-opus-4-1', name: 'Claude Opus 4.1', reasoning: true, supportsImages: true },
    { provider: 'openai', id: 'gpt-5', name: 'GPT-5', reasoning: true, supportsImages: true },
    { provider: 'openai', id: 'openai-codex', name: 'OpenAI Codex', reasoning: true, supportsImages: false },
    { provider: 'deepseek', id: 'deepseek-v3', name: 'DeepSeek V3', reasoning: false, supportsImages: false },
    { provider: 'moonshot', id: 'moonshot-v8-32k', name: 'Moonshot v8 32k', reasoning: false, supportsImages: false },
    { provider: 'xai', id: 'grok-4', name: 'Grok 4', reasoning: true, supportsImages: true },
    { provider: 'zai', id: 'glm-4v-plus', name: 'GLM-4V-Plus', reasoning: true, supportsImages: true },
    { provider: 'volcengine', id: 'doubao-1-5-pro', name: 'Doubao 1.5 Pro', reasoning: true, supportsImages: true },
    { provider: 'qwen', id: 'qwen-vl-max', name: 'Qwen-VL-Max', reasoning: true, supportsImages: true },
    { provider: 'acme', id: 'mystery-1', name: 'Mystery One', reasoning: false, supportsImages: true }
  ]
  let hiddenModelIds: string[] = []
  let sidebarSessionPreferences: SidebarSessionPreferences = { pinnedSessionIds: [], archivedSessionIds: [], archivedSessionTimestamps: {}, orderedSessionIds: [], sessionOrderVersion: SESSION_ORDER_VERSION }
  // Demo-only: restore the reload-persisted model when it is still in the catalog;
  // fall back to mockModels[0] otherwise (real host model state is owned by pi sessions).
  const savedDemoModel = readDemoModel()
  const restoredModel = savedDemoModel ? mockModels.find(model => model.provider === savedDemoModel.provider && model.id === savedDemoModel.id) : undefined
  const initialModel = restoredModel ?? mockModels[0]
  let modelState: ModelState = { model: initialModel, thinkingLevel: 'medium', availableThinkingLevels: thinkingLevelsForModel(initialModel) }
  // Demo-only per-session context occupancy: switching sessions visibly moves
  // the context ring/window in the browser demo (the real host returns live
  // get_session_stats and rehydrates last-known from the token ledger).
  const sessionContextFixtures: Record<string, { tokens: number; window: number }> = {
    welcome: { tokens: 76_000, window: 200_000 },
    layout: { tokens: 40_000, window: 128_000 },
    'agent-run': { tokens: 118_400, window: 200_000 },
    site: { tokens: 12_600, window: 128_000 },
    analytics: { tokens: 203_000, window: 400_000 }
  }
  // Fixture auth metadata (providerId → credential type). Never holds key values.
  let mockAuthCredentials = new Map<string, 'oauth' | 'api_key'>([['anthropic', 'oauth'], ['openai', 'api_key']])
  const mockAuthProviders = [
    { id: 'anthropic', name: 'Anthropic', authTypes: ['oauth', 'api_key'] as const, loginLabel: '登录 Anthropic 账号' },
    { id: 'openai', name: 'OpenAI', authTypes: ['api_key'] as const },
    { id: 'deepseek', name: 'DeepSeek', authTypes: ['api_key'] as const },
    { id: 'github-copilot', name: 'GitHub Copilot', authTypes: ['oauth', 'api_key'] as const, loginLabel: '授权 GitHub 账号' }
  ]
  let loginSeq = 0
  const loginSessions = new Map<string, { providerId: string; authType: 'oauth' | 'api_key'; phase: number }>()
  const mockExtensions: ExtensionDescriptor[] = [
    {
      id: 'skill-loader-extension',
      name: 'PipiUI Skill Loader',
      description: '按需搜索和加载当前扩展包提供的 Skills。',
      version: '1.0.0',
      category: 'foundation',
      state: 'enabled',
      source: 'builtin',
      capabilities: [],
    },
    {
      id: 'file-tools',
      name: 'File Tools',
      description: '文件读写与编辑的运行时工具。',
      version: '1.0.0',
      category: 'foundation',
      state: 'enabled',
      source: 'builtin',
      capabilities: [],
    },
    {
      id: 'document-workbench',
      name: 'Document Workbench',
      description: '文档读取、预览和知识处理。',
      version: '1.0.0',
      category: 'knowledge',
      state: 'enabled',
      source: 'builtin',
      capabilities: [],
    },
    {
      id: 'workbench-panels',
      name: 'Workbench Panels',
      description: '子代理编排与工作台面板。',
      version: '1.0.0',
      category: 'workflow',
      state: 'enabled',
      source: 'builtin',
      capabilities: [],
    },
    {
      id: 'plan-extension',
      name: 'Plan',
      description: '会话计划的发布、审批与追踪。',
      version: '1.0.0',
      category: 'workflow',
      state: 'enabled',
      source: 'builtin',
      capabilities: [],
    },
    {
      id: 'terminal-extension',
      name: 'Terminal',
      description: '项目内终端会话。',
      version: '1.0.0',
      category: 'workflow',
      state: 'enabled',
      source: 'builtin',
      capabilities: [],
    },
    {
      id: 'webview-browser-extension',
      name: 'WebView Browser',
      description: '受管浏览器会话与自动化。',
      version: '1.0.0',
      category: 'automation',
      state: 'enabled',
      source: 'builtin',
      capabilities: [],
    },
    {
      id: 'remote-control',
      name: 'Remote Control',
      description: '配对链接与二维码远程控制。',
      version: '1.0.0',
      category: 'automation',
      state: 'enabled',
      source: 'builtin',
      capabilities: [],
    },
    {
      // A form: an ordinary extension that declares a layout. The base ships
      // no form of its own (see docs/extension-architecture-v1.md) — this
      // fixture stands in for whatever product's own form would be installed
      // here, so the demo/test shell has something to switch on and off.
      id: 'demo-workbench',
      name: 'Demo Workbench',
      description: 'Demo 形态：项目与会话导航与完整工作流示例。',
      version: '1.0.0',
      category: 'workflow',
      state: 'enabled',
      source: 'builtin',
      capabilities: [],
      dependencies: {
        required: [
          { id: 'workbench-panels', version: '^1.0.0' },
          { id: 'file-tools', version: '^1.0.0' },
          { id: 'document-workbench', version: '^1.0.0' },
          { id: 'plan-extension', version: '^1.0.0' },
          { id: 'skill-loader-extension', version: '^1.0.0' },
          { id: 'terminal-extension', version: '^1.0.0' },
          { id: 'webview-browser-extension', version: '^1.0.0' },
          { id: 'remote-control', version: '^1.0.0' },
        ],
      },
      ui: {
        layout: {
          primarySidebar: 'pipi.sessions',
          center: 'pipi.conversation',
          activity: ['pipi.sessions'],
        },
      },
    },
  ]
  // Explicit user toggles; everything else follows manifest defaults plus the
  // required closure of whatever pack is on — the same additive rule the host uses.
  const mockExtensionOverrides = new Map<string, boolean>()
  const mockExtensionDefaults = new Map(mockExtensions.map(item => [item.id, item.state === 'enabled']))
  const resolveMockExtensionStates = () => {
    const enabled = new Set(mockExtensions
      .filter(item => mockExtensionOverrides.get(item.id) ?? mockExtensionDefaults.get(item.id) ?? false)
      .map(item => item.id))
    const queue = [...enabled]
    while (queue.length) {
      const current = mockExtensions.find(item => item.id === queue.shift())
      for (const requirement of current?.dependencies?.required ?? []) {
        if (enabled.has(requirement.id) || mockExtensionOverrides.get(requirement.id) === false) continue
        enabled.add(requirement.id)
        queue.push(requirement.id)
      }
    }
    for (const item of mockExtensions) item.state = enabled.has(item.id) ? 'enabled' : 'disabled'
  }
  let subagentModels: Record<string, SubagentModelSetting[]> = {}
  let memoryReviewModel: string | null = null
  const agentDefinitions: AgentDefinition[] = [
    { name: 'explore', description: 'Research agent. Searches the web and the repository, reads, greps, and runs shell, but does not edit files.', origin: 'bundled', source: 'bundled', mode: 'read-only', available: true, availability: 'available' },
    { name: 'general-purpose', description: 'Full-capability worker. Uses an isolated worktree by default; runs directly only when the Boss supplies an explicit reason.', origin: 'bundled', source: 'bundled', mode: 'worker', worktree: 'isolated', available: true, availability: 'available' },
    { name: 'reviewer', description: 'Read-only code review specialist for quality and security.', origin: 'bundled', source: 'bundled', mode: 'read-only', available: true, availability: 'available' },
    { name: 'secretary', description: 'Boss closeout secretary. Reconciles agent outcomes, worktrees, branches, verification, temporary artifacts, and the existing Boss ledger without creating another worktree.', origin: 'bundled', source: 'bundled', canonical: true, canonicalRole: 'secretary', available: true, availability: 'available' },
  ]
  const emit = (sessionId: string, event: StreamEvent) => {
    listeners.get(sessionId)?.forEach(listener => listener(event))
    allStreamListeners.forEach(listener => listener(event))
  }
  const browser = createMockBrowserHost()
  let mockGit: GitStatus = { isRepo: true, currentBranch: 'pipiui/electron-git-branch', isDetached: false, shortSHA: '408cf26', localBranches: ['main', 'pipiui/electron-git-branch', 'pipiui/tunnel-reconnect'], upstream: 'origin/main', ahead: 2, behind: 0, isDirty: true, staged: 1, unstaged: 3, untracked: 2, githubURL: 'https://github.com/demo/pipiui' }
  const mock: PipiHostAPI = {
    protocolVersion: 2,
    listProjects: async () => projects,
    listSessions: async projectId => sessions.filter(session => session.projectId === projectId),
    newSession: async (projectId, name = '新会话') => { const session = { id: crypto.randomUUID(), projectId, name, updatedAt: Date.now() }; sessions.unshift(session); history[session.id] = []; return session },
    resumeSession: async sessionId => sessions.find(session => session.id === sessionId)!,
    renameSession: async (sessionId, name) => {
      const index = sessions.findIndex(session => session.id === sessionId)
      if (index < 0) throw new Error(`unknown session ${sessionId}`)
      sessions[index] = { ...sessions[index], name, updatedAt: Date.now() }
      emit(sessionId, { type: 'session_title', sessionId, title: name, source: 'manual' })
      return sessions[index]
    },
    deleteSession: async () => undefined,
    // Session-workspace extension point: the dev mock has no worktree binding to enforce.
    setSessionWorkspace: async () => undefined,
    clearSessionWorkspace: async () => undefined,
    sessionWorkspaceStatus: async () => null,
    moveSession: async (sessionId, targetProjectId) => {
      const index = sessions.findIndex(session => session.id === sessionId)
      if (index < 0) throw new Error(`unknown session ${sessionId}`)
      sessions[index] = { ...sessions[index], projectId: targetProjectId }
      return sessions[index]
    },
    getSessionHistory: async sessionId => history[sessionId] ?? [],
    readDocument: async path => {
      const name = path.split('/').at(-1) ?? path
      const kind = documentKindForName(path)
      if (!kind) throw new Error('unsupported document type')
      if (kind === 'markdown') return { id: path, name, path, kind, content: `# ${name}\n\nMock host preview for ${path}.` }
      if (kind === 'plain') return { id: path, name, path, kind, content: `Mock text preview for ${path}.` }
      return { id: path, name, path, kind, bytes: new Uint8Array([1, 2, 3]) }
    },
    getSessionLease: async sessionId => ({ sessionId, writable: true }),
    forceTakeoverSessionLease: async sessionId => ({ sessionId, writable: true }),
    sendPrompt: async (sessionId, prompt, attachments) => {
      const item = { id: crypto.randomUUID(), role: 'user' as const, content: prompt, images: chatImagesFromAttachments(attachments), timestamp: Date.now() }
      ;(history[sessionId] ??= []).push(item)
      emit(sessionId, { type: 'status', sessionId, status: 'started' })
      emit(sessionId, { type: 'thinking', sessionId, contentIndex: 0, delta: '正在分析请求与当前项目结构…' })
      emit(sessionId, { type: 'tool_call', sessionId, toolCallId: 'read-package', name: 'read', delta: 'Electron/packages/ui/package.json' })
      window.setTimeout(() => emit(sessionId, { type: 'tool_result', sessionId, toolCallId: 'read-package', content: '已读取 package.json' }), 350)
      window.setTimeout(() => {
        ;(history[sessionId] ??= []).push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '已开始处理。流式 Markdown 会在完成后使用 Shiki 高亮代码块。',
          thinking: '正在分析请求与当前项目结构…',
          tools: [{ id: 'read-package', name: 'read', input: 'Electron/packages/ui/package.json' }],
          timestamp: Date.now(),
        })
        emit(sessionId, { type: 'text', sessionId, contentIndex: 0, delta: '已开始处理。流式 Markdown 会在完成后使用 Shiki 高亮代码块。' })
      }, 500)
      window.setTimeout(() => emit(sessionId, { type: 'status', sessionId, status: 'settled' }), 750)
    },
    stop: async sessionId => emit(sessionId, { type: 'status', sessionId, status: 'stopped' }),
    queueFollowUp: async () => undefined,
    compact: async sessionId => {
      emit(sessionId, { type: 'compaction', sessionId, phase: 'start', reason: 'manual', operation: 'context_compaction', trigger: 'manual', executed: true })
      await new Promise(resolve => window.setTimeout(resolve, 300))
      emit(sessionId, { type: 'compaction', sessionId, phase: 'end', reason: 'manual', operation: 'context_compaction', trigger: 'manual', executed: true })
    },
    // The Composer still sends directly; queue controls are hosted elsewhere.
    listQueue: async () => [],
    enqueueMessage: async () => { throw new Error('mock queue is unavailable') },
    updateQueuedMessage: async () => { throw new Error('mock queue is unavailable') },
    removeQueuedMessage: async () => { throw new Error('mock queue is unavailable') },
    promoteQueuedMessage: async () => { throw new Error('mock queue is unavailable') },
    steerQueuedMessage: async () => { throw new Error('mock queue is unavailable') },
    cutInQueuedMessage: async () => { throw new Error('mock queue is unavailable') },
    retryQueuedMessage: async () => { throw new Error('mock queue is unavailable') },
    subscribeStream: (sessionId, listener) => { const bucket = listeners.get(sessionId) ?? new Set(); bucket.add(listener); listeners.set(sessionId, bucket); return () => bucket.delete(listener) },
    subscribeAllStreams: listener => { allStreamListeners.add(listener); return () => allStreamListeners.delete(listener) },
    listModels: async () => mockModels,
    subscribeModelCatalog: listener => {
      catalogListeners.add(listener)
      return () => { catalogListeners.delete(listener) }
    },
    getModelState: async sessionId => {
      // Per-session binding, mirroring the real host: each session answers with
      // its own model (JSONL-backed there, fixture/localStorage here).
      if (sessionId) {
        const session = sessions.find(item => item.id === sessionId)
        const ref = session?.model
        if (ref) {
          const found = mockModels.find(model => model.provider === ref.provider && model.id === ref.modelId)
          if (found) return { model: found, thinkingLevel: 'medium', availableThinkingLevels: thinkingLevelsForModel(found) }
        }
      }
      return modelState
    },
    setModel: async (sessionId, provider, id) => {
      if (!sessionId) throw new Error(`unknown session ${sessionId}`)
      const found = mockModels.find(model => model.provider === provider && model.id === id)
      if (!found) throw new Error(`unknown model ${provider}/${id}`)
      modelState = { ...modelState, model: found, availableThinkingLevels: thinkingLevelsForModel(found) }
      // Session-scoped: keep the session's own model in sync so the sidebar row (and
      // future listSessions consumers) shows the same provider the chat uses.
      const target = sessions.find(session => session.id === sessionId)
      if (target) target.model = { provider: found.provider, modelId: found.id }
      writeDemoSessionModel(sessionId, found)
      writeDemoModel(found)
      return modelState
    },
    setThinkingLevel: async (sessionId, level) => {
      if (!sessionId) throw new Error(`unknown session ${sessionId}`)
      modelState = { ...modelState, thinkingLevel: level }
      return modelState
    },
    authProviders: async () => mockAuthProviders.map(p => ({ id: p.id, name: p.name, authTypes: [...p.authTypes], loginLabel: p.loginLabel, authenticated: mockAuthCredentials.has(p.id), authType: mockAuthCredentials.get(p.id) })),
    beginProviderLogin: async (providerId, authType) => {
      const loginId = `mock-login-${++loginSeq}`
      loginSessions.set(loginId, { providerId, authType, phase: 0 })
      return { loginId }
    },
    continueProviderLogin: async (loginId, input) => {
      const session = loginSessions.get(loginId)
      if (!session) return { kind: 'failed', error: '登录会话不存在或已结束' }
      if (session.authType === 'api_key') {
        if (session.phase === 0 && input === undefined) { session.phase = 1; return { kind: 'prompt', promptType: 'secret', message: `输入 ${session.providerId} API Key`, placeholder: 'sk-…' } }
        if (session.phase === 1 && input !== undefined) { session.phase = 2; mockAuthCredentials.set(session.providerId, 'api_key'); return { kind: 'completed', providerId: session.providerId } }
      } else {
        if (session.phase === 0 && input === undefined) { session.phase = 1; return { kind: 'auth_url', url: `https://auth.example.com/${session.providerId}`, code: 'ABCD-1234' } }
        if (session.phase === 1 && input === undefined) { session.phase = 2; mockAuthCredentials.set(session.providerId, 'oauth'); return { kind: 'completed', providerId: session.providerId } }
      }
      return { kind: 'failed', error: 'unexpected login state' }
    },
    cancelProviderLogin: async loginId => { loginSessions.delete(loginId) },
    addOpenAICompatibleProvider: async input => {
      const id = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'custom-openai'
      mockModels = [...mockModels, { provider: id, id: input.modelId.trim(), name: input.modelId.trim(), reasoning: true }]
      mockAuthCredentials.set(id, 'api_key')
      return { providerId: id }
    },
    listOpenAICompatibleModels: async input => {
      if (!/^https?:\/\//i.test(input.baseUrl.trim()) || !input.apiKey.trim()) throw new Error('参数无效')
      return { models: [{ id: 'gpt-4o-mini', contextWindow: 128000 }, { id: 'gpt-4o' }] }
    },
    testOpenAICompatibleModel: async input => {
      if (!/^https?:\/\//i.test(input.baseUrl.trim()) || !input.apiKey.trim() || !input.modelId.trim()) throw new Error('参数无效')
      await new Promise(resolve => setTimeout(resolve, 50))
      return { ok: true, firstTokenMs: 320, totalMs: 1450, tokens: 8, tokensPerSecond: 42.3, preview: 'OK' }
    },
    removeProviderCredentials: async providerId => {
      mockAuthCredentials.delete(providerId)
      mockModels = mockModels.filter(model => model.provider !== providerId)
      hiddenModelIds = hiddenModelIds.filter(id => !id.startsWith(`${providerId}/`))
      if (modelState.model.provider === providerId) {
        const next = mockModels[0] ?? { provider: 'unknown', id: 'unknown', name: '无可用模型', reasoning: false }
        modelState = { ...modelState, model: next, availableThinkingLevels: thinkingLevelsForModel(next) }
      }
      return modelState
    },
    openExternal: async () => undefined,
    getHiddenModelIds: async () => [...hiddenModelIds],
    setHiddenModelIds: async ids => { hiddenModelIds = [...new Set(ids)].sort(); return [...hiddenModelIds] },
    getSidebarSessionPreferences: async () => ({ pinnedSessionIds: [...sidebarSessionPreferences.pinnedSessionIds], archivedSessionIds: [...sidebarSessionPreferences.archivedSessionIds], archivedSessionTimestamps: { ...(sidebarSessionPreferences.archivedSessionTimestamps ?? {}) }, orderedSessionIds: [], sessionOrderVersion: SESSION_ORDER_VERSION }),
    setSidebarSessionPreferences: async preferences => {
      const archived = new Set(preferences.archivedSessionIds)
      const archivedSessionTimestamps = Object.fromEntries(Object.entries(preferences.archivedSessionTimestamps ?? {}).filter(([id]) => archived.has(id)))
      sidebarSessionPreferences = { pinnedSessionIds: [...new Set(preferences.pinnedSessionIds)].filter(id => !archived.has(id)), archivedSessionIds: [...archived], archivedSessionTimestamps, orderedSessionIds: [], sessionOrderVersion: SESSION_ORDER_VERSION }
      return { pinnedSessionIds: [...sidebarSessionPreferences.pinnedSessionIds], archivedSessionIds: [...sidebarSessionPreferences.archivedSessionIds], archivedSessionTimestamps: { ...archivedSessionTimestamps }, orderedSessionIds: [], sessionOrderVersion: SESSION_ORDER_VERSION }
    },
    checkForUpdates: async () => ({ checkedAt: Date.now(), items: [
      { id: 'pi', name: 'Pi', packageName: '@earendil-works/pi-coding-agent', currentVersion: '0.84.0', latestVersion: '0.84.2', status: 'updateAvailable' },
    ] }),
    listExtensions: async () => mockExtensions.map(item => ({ ...item, contributions: item.contributions ? { ...item.contributions } : undefined })),
    setExtensionEnabled: async (id, enabled) => {
      const extension = mockExtensions.find(item => item.id === id)
      if (!extension) throw new Error(`unknown extension ${id}`)
      mockExtensionOverrides.set(id, enabled)
      resolveMockExtensionStates()
      return { ...extension }
    },
    getSubagentModels: async () => Object.fromEntries(Object.entries(subagentModels).map(([name, chain]) => [name, chain.map(entry => ({ ...entry }))])),
    setSubagentModel: async (agentName, chain) => { if (chain.length) subagentModels[agentName] = chain.map(entry => ({ ...entry })); else delete subagentModels[agentName]; return Object.fromEntries(Object.entries(subagentModels).map(([name, saved]) => [name, saved.map(entry => ({ ...entry }))])) },
    getSubagentDebugInfo: async sessionId => sessionId ? {
      available: true,
      source: 'demo',
      sessionId,
      capturedAt: Date.now(),
      bossTools: DEMO_BOSS_TOOL_NAMES.map(name => ({ name, description: '' })),
      toolCatalog: DEMO_BOSS_TOOL_NAMES.map(name => ({ name, description: '' })),
      skills: DEMO_SKILL_NAMES.map(name => ({ name, description: '' })),
      subagents: [
        { name: 'explore', toolPolicy: 'allowlist', tools: ['read', 'bash', 'grep', 'find', 'ls', 'web_search', 'fetch_content', 'source_check', 'get_search_content', 'arxiv_fetch', 'memory_query', 'memory_status', 'session_recall', 'skill_search', 'skill_load'] },
        { name: 'general-purpose', toolPolicy: 'allowlist', tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'fetch_content', 'source_check', 'get_search_content', 'arxiv_fetch', 'memory_query', 'memory_status', 'session_recall', 'skill_search', 'skill_load', 'subagent', 'subagent_chain', 'subagent_abort', 'subagent_resolve', 'subagent_status'] },
        { name: 'reviewer', toolPolicy: 'allowlist', tools: ['read', 'bash', 'grep', 'find', 'ls', 'fetch_content', 'source_check', 'get_search_content', 'arxiv_fetch', 'memory_query', 'memory_status', 'session_recall', 'skill_search', 'skill_load'] },
        { name: 'secretary', toolPolicy: 'allowlist', tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'skill_search', 'skill_load', 'session_recall', 'secretary_commit'] },
      ],
    } : { available: false, reason: 'no-session', bossTools: [], toolCatalog: [], skills: [], subagents: [] },
    getMemoryReviewModel: async () => memoryReviewModel,
    setMemoryReviewModel: async model => { memoryReviewModel = model; return memoryReviewModel },
    listAgentDefinitions: async (_projectId?: string) => agentDefinitions.map(agent => ({ ...agent })),
    getSessionStats: async sessionId => {
      const id = sessionId ?? sessions[0]?.id ?? 'mock-session'
      const fixture = sessionContextFixtures[id] ?? { tokens: 0, window: 200_000 }
      const percent = fixture.window > 0 ? Math.min(100, (fixture.tokens / fixture.window) * 100) : 0
      return { sessionId: id, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0, contextUsage: { tokens: fixture.tokens, contextWindow: fixture.window, percent }, model: { provider: modelState.model.provider, id: modelState.model.id, name: modelState.model.name } }
    },
    // Browser/dev fallback fixture: selecting OpenAI Codex exercises the same
    // session/provider-dependent quota UI without an Electron preload.
    getQuotaSnapshot: async sessionId => {
      // Session-scoped, matching the real host: a sidebar switch must not keep
      // asking the previously selected (or globally configured) model.
      const session = sessionId ? sessions.find(item => item.id === sessionId) : undefined
      const provider = session?.model?.provider ?? modelState.model.provider
      if (provider.includes('openai')) {
        return { provider: 'openai', accountLabel: 'Codex 账号额度', windows: [
          { id: 'primary', usedPercent: 4, label: '5h', title: '5小时额度' },
          { id: 'secondary', usedPercent: 12, label: '周', title: '周额度' }
        ] }
      }
      return null
    },
    subscribeSessionStats: () => () => undefined,
    listAgents: async sessionId => mockAgents.filter(agent => !sessionId || agent.sessionId === sessionId),
    // The demo agents have no run behind them, so there is no cached log to replay;
    // subscribeAgentLog below is what populates the panel.
    getAgentLogs: async () => [],
    subscribeAgents: () => () => undefined,
    subscribeAgentLog: (agentId, listener, sessionId, runId) => {
      const selected = mockAgents.find(agent => agent.agentId === agentId && agent.sessionId === sessionId && agent.runId === runId)
      if (!selected || selected.agentId !== 'research') return () => undefined
      const timers: number[] = []
      // Stream cumulative log_delta snapshots (same contentIndex) so the demo shows one
      // progressively-updated row per entry — not a new line per chunk.
      const stream = (contentIndex: number, itemType: 'text' | 'thinking' | 'tool' | 'toolResult', name: string | undefined, chunks: string[]) => {
        let acc = ''
        chunks.forEach((chunk, i) => {
          timers.push(window.setTimeout(() => {
            acc += chunk
            listener({ type: 'agent_log', sessionId, agentId, runId, itemType, text: acc, name, contentIndex })
          }, 300 * (i + 1)))
        })
      }
      stream(0, 'thinking', undefined, ['正在梳理 packages/ui 的组件边界', '，对照 App 与 SubagentPanel 的日志渲染路径…'])
      stream(1, 'tool', 'read', ['Electron/packages/ui/src/App.tsx'])
      stream(2, 'toolResult', undefined, ['已读取主界面实现', '，确认流式更新逻辑位于 SubagentPanel。'])
      return () => timers.forEach(window.clearTimeout)
    },
    abortAgent: async (_sessionId: string, _agentId: string, _runId: string) => undefined, resolveAgent: async (_sessionId: string, _agentId: string, _runId: string) => undefined,
    checkAgent: async (sessionId: string, agentId: string, runId: string) => ({ sessionId, agentId, runId, name: 'Mock agent', task: '', state: 'ok' }),
    getWorktreeStatus: async (sessionId: string, agentId: string, runId: string) => ({ sessionId, agentId, runId, lifecycle: 'none', merge: 'unavailable', discard: 'unavailable' }),
    mergeWorktree: async (sessionId: string, agentId: string, runId: string) => ({ sessionId, agentId, runId, lifecycle: 'merged', merge: 'merged', discard: 'unavailable' }),
    discardWorktree: async (sessionId: string, agentId: string, runId: string) => ({ sessionId, agentId, runId, lifecycle: 'discarded', merge: 'unavailable', discard: 'discarded' }),
    getPlans: async sessionId => sessionId ? mockPlans() : [],
    subscribePlans: () => () => undefined,
    capabilities: async () => mockCapabilities(),
    probeGitBinary: async () => true,
    gitStatus: async projectId => projectId === 'pipiui' ? { ...mockGit } : { isRepo: false, isDetached: false, localBranches: [], ahead: 0, behind: 0, isDirty: false, staged: 0, unstaged: 0, untracked: 0 },
    gitCheckout: async (_projectId, branch) => { mockGit = { ...mockGit, currentBranch: branch, isDetached: false }; return { ...mockGit } },
    revealProject: async () => undefined,
    renameProject: async (projectId, name) => {
      const project = projects.find(item => item.id === projectId)
      if (!project) throw new Error(`unknown project ${projectId}`)
      project.name = name
      return { ...project }
    },
    browser
  }
  if (options.productPacks) Object.assign(mock, {
    saveProductPackArchive: async suggestedName => `/tmp/${suggestedName}`,
    exportProductPackArchive: async (_projectId, packId, destinationArchivePath) => ({
      archivePath: destinationArchivePath,
      packId,
      bytes: 24_576,
      extensionCount: (mockExtensions.find(item => item.id === packId)?.dependencies?.required?.length ?? 0) + 1,
    }),
    pickProductPackArchive: async () => '/tmp/coc.pipiui-pack.zip',
    installProductPackArchive: async () => {
      if (!mockExtensions.some(item => item.id === 'coc-workbench')) {
        mockExtensions.push({
          id: 'coc-workbench',
          name: 'COC Workbench',
          description: 'COC 跑团工作台、战役资料与骰子能力。',
          version: '1.0.0',
          category: 'workflow',
          state: 'disabled',
          source: 'project',
          capabilities: [],
          dependencies: { required: [{ id: 'document-workbench', version: '^1.0.0' }] },
          ui: { layout: { primarySidebar: 'pipi.sessions', center: 'pipi.conversation', activity: ['pipi.sessions'] } },
        })
        mockExtensionDefaults.set('coc-workbench', false)
      }
      mockExtensionOverrides.set('demo-workbench', false)
      mockExtensionOverrides.set('coc-workbench', true)
      resolveMockExtensionStates()
      return { packId: 'coc-workbench', extensionIds: mockExtensions.filter(item => item.state === 'enabled').map(item => item.id) }
    },
  } satisfies Partial<PipiHostAPI>)
  return mock
}
