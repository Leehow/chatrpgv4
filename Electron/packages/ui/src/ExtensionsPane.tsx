import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AgentCatalogDiagnostic, AgentDefinition, ExtensionCategory, ExtensionDescriptor, PipiHostAPI, UserMcpServer } from '@pipi/host-api'
import {
  agentAvailabilityLabel,
  agentSourceLabel,
  collectCatalogDiagnostics,
  contributedAgentsFor,
  diagnosticKey,
  diagnosticsForExtension,
  formatDiagnostic,
  formatPatchOperations,
  isBlockingCatalogDiagnostic,
  isRequestedPatch,
  patchesForExtension,
  redactDiagnosticMessage,
} from './agent-catalog-ui'
import { DismissibleError } from './DismissibleError'
import { MCP_ADD_PROMPT, PI_EXTENSION_ADD_PROMPT } from './extension-add-copy'
import {
  blocksEnableForL2,
  capabilityLabel,
  EXTENSION_SOURCE_LABEL,
  EXTENSION_STATE_LABEL,
  grantNeedsConfirmation,
  L2_CAPABILITY_HINT,
} from './extension-capabilities'
import { ExtensionAuthCard } from './ExtensionAuthCard'
import { CORE_MCP_EXTENSION_IDS, CORE_SKILLS_EXTENSION_IDS } from './core-extensions'
import { MCP_IMPORT_EXAMPLE, mcpServerSummary, mcpServerTransport, parseMcpServersJson } from './mcp-import'
import { SchemaSettingsForm } from './schema-settings-form'

/**
 * DOM node hosting the pack sub-nav (核心扩展 / 其他扩展 / 扩展包) when
 * ExtensionsPane is embedded in the settings modal — ModelVisibilityModal
 * provides the slot under its 扩展 tab so the sub-nav indents into the main
 * sidebar. Null (tests, standalone usage) → the sub-nav renders inline as a
 * second column.
 */
export const ExtensionsSubnavSlotContext = createContext<HTMLElement | null>(null)
import { useOptionalProductWorkbenchRuntime } from './workbench/workbench-runtime'

const LAST_SESSION_STORAGE_KEY = 'pipiui:eui:last-session:v1'
type DisplayExtensionCategory = ExtensionCategory | 'other' | 'outside'

const EXTENSION_CATEGORY_ORDER: readonly DisplayExtensionCategory[] = [
  'foundation',
  'workflow',
  'knowledge',
  'automation',
  'integration',
  'developer',
  'other',
  'outside',
]

const EXTENSION_CATEGORY_LABEL: Record<DisplayExtensionCategory, string> = {
  foundation: '基础能力',
  workflow: '工作流与效率',
  knowledge: '文档与知识',
  automation: '自动化与设备',
  integration: '模型与外部服务',
  developer: '开发者',
  other: '其它扩展',
  outside: '包外扩展',
}

const EXTENSION_CATEGORY_DESCRIPTION: Record<DisplayExtensionCategory, string> = {
  foundation: 'PipiUI 启动、会话与基本交互所需的核心能力',
  workflow: '任务、计划、协作与日常效率工具',
  knowledge: '文档、记忆、知识整理与内容处理',
  automation: '浏览器、电脑控制与设备自动化',
  integration: '模型接入、MCP 与外部服务连接',
  developer: '创建、调试和维护 PipiUI 扩展',
  other: '尚未归入专门类别的扩展',
  outside: '已安装但不属于当前扩展包的核心能力与独立扩展',
}

type ExtensionStatusFilter = 'all' | 'enabled' | 'disabled'

const EXTENSION_STATUS_FILTERS: readonly { id: ExtensionStatusFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'enabled', label: '已启用' },
  { id: 'disabled', label: '未启用' },
]

function extensionCategory(ext: ExtensionDescriptor): DisplayExtensionCategory {
  return ext.category ?? 'other'
}

/**
 * A form the user can switch to. A product pack is an ordinary extension that
 * declares `app.ui.layout`; `base` is the synthetic entry for "no pack", which
 * is what a plain base project runs.
 */
type PackView = {
  id: string
  name: string
  description?: string
  /** The pack extension itself plus its required closure, for the detail list. */
  memberIds: string[]
  requiredIds: string[]
  active: boolean
  /** True only for the synthetic `base` entry, which has no extension behind it. */
  synthetic: boolean
}

const BASE_PACK_ID = 'base'

function isProductPack(ext: ExtensionDescriptor): boolean {
  return Boolean(ext.ui?.layout)
}

function packViewsFrom(items: readonly ExtensionDescriptor[]): PackView[] {
  // Nothing listed (a failed scan, or a host without extensions) means there is
  // no form to describe either — not even the base one.
  if (!items.length) return []
  const packs = items.filter(isProductPack)
  const byId = new Map(items.map(item => [item.id, item]))
  const views = packs.map(pack => {
    const requiredIds = (pack.dependencies?.required ?? []).map(item => item.id)
    const optionalIds = (pack.dependencies?.optional ?? []).map(item => item.id)
    // Members are the same closure the enablement resolver turns on (pi-backend
    // extension-enablement.ts): `required` walks transitively, so a dependency's
    // own dependency (agent-orchestration → git-capability) belongs to the form
    // instead of masquerading as a pack-less extension behind the base card.
    const members = new Set([pack.id])
    const queue = [...requiredIds]
    while (queue.length) {
      const id = queue.shift()!
      if (members.has(id)) continue
      members.add(id)
      for (const dep of byId.get(id)?.dependencies?.required ?? []) queue.push(dep.id)
    }
    return {
      id: pack.id,
      name: pack.name ?? pack.id,
      description: pack.description,
      // Optional dependencies belong to the form but stay the user's call: they
      // are listed inside the pack and never enabled by the closure.
      memberIds: [...new Set([...members, ...optionalIds])],
      requiredIds,
      active: pack.state === 'enabled',
      synthetic: false,
    }
  })
  const packOwned = new Set(views.flatMap(view => view.memberIds))
  const baseMembers = items.filter(item => !packOwned.has(item.id)).map(item => item.id)
  // A product whose packs own every installed extension has no "no pack" form to
  // switch to: the synthetic base card would be an empty entry, so hide it. The
  // workbench runtime's own base fallback (workbench-runtime.ts) is unaffected.
  if (views.length && baseMembers.length === 0) return views
  return [{
    id: BASE_PACK_ID,
    name: '基础版',
    description: '不启用任何扩展包：基础能力扩展全部可用，可逐个开关。',
    memberIds: baseMembers,
    requiredIds: [],
    active: views.every(view => !view.active),
    synthetic: true,
  }, ...views]
}

function hostFromWindow(): PipiHostAPI | undefined {
  return typeof window === 'undefined' ? undefined : (window as Window & { pipiHost?: PipiHostAPI }).pipiHost
}

function lastProjectId(): string | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LAST_SESSION_STORAGE_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return undefined
    const projectId = (value as { projectId?: unknown }).projectId
    return typeof projectId === 'string' && projectId ? projectId : undefined
  } catch {
    return undefined
  }
}

async function loadUserMcpServers(host: PipiHostAPI | undefined, preferredProjectId?: string): Promise<UserMcpServer[]> {
  if (!host?.listUserMcpServers) return []
  let projectId = preferredProjectId || lastProjectId()
  if (!projectId) {
    const projects = await host.listProjects()
    projectId = projects[0]?.id
  }
  if (!projectId) return []
  return await host.listUserMcpServers(projectId)
}

type CopiedKey = 'mcp' | 'pi' | 'selfdev' | null

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function CopyRow({ label, text, copied, onCopy }: {
  label: string
  text: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="extensions-copy-row" data-testid={`extensions-copy-${label}`}>
      <pre className="extensions-copy-text">{text}</pre>
      <button type="button" className="extensions-copy-btn" data-testid={`extensions-copy-btn-${label}`} onClick={() => void onCopy()}>
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  )
}

/** Copy prompt for tweaking an already-installed extension via /selfdev. Keep in sync with the add-extension skill. */
export const SELFDEV_MODIFY_PROMPT = '/selfdev 把【扩展名】的【某项】改成【值】'

export function ExtensionsAddDialog({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState<CopiedKey>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const copy = async (key: CopiedKey, text: string) => {
    if (!await copyText(text)) return
    setCopied(key)
  }

  return (
    <div
      className="extensions-add-backdrop"
      data-testid="extensions-add-backdrop"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <section className="extensions-add-dialog" role="dialog" aria-modal="true" aria-labelledby="extensions-add-title" data-testid="extensions-add-dialog">
        <header>
          <h3 id="extensions-add-title">添加 MCP 或 Pi 扩展</h3>
          <button type="button" className="model-modal-close" aria-label="关闭添加说明" onClick={onClose}>×</button>
        </header>
        <div className="extensions-add-body">
          <p>不用在这里填命令、URL 或密钥。</p>
          <p>PipiUI 已经接好了 Pi 的 MCP 能力。要加某家的 MCP，或某个 Pi 插件，回到主界面直接说就行——可以说厂商和名字，也可以贴官网、npm 包名或配置链接。</p>
          <p>手里已经有 <code>{'{"mcpServers": {…}}'}</code> 配置的话，不用绕这一步：到左侧「MCP 连接」点“粘贴 JSON 导入”即可。</p>
          <ul className="extensions-add-examples">
            <li>请把 Context7 的 MCP 加到 PipiUI</li>
            <li>请把 Notion 家的这个 MCP 加进来，链接我贴下面</li>
            <li>请把这个 Pi 扩展加到 PipiUI：https://pi.dev/packages/xxx</li>
            <li>用 /selfdev 把某个扩展的默认上下文窗口改成 700</li>
          </ul>
          <p>复制下面一句，改成你要的名字或链接，贴到主界面发送。PipiUI 会去查该怎么装，并写到本机配置里。</p>
          <CopyRow label="mcp" text={MCP_ADD_PROMPT} copied={copied === 'mcp'} onCopy={() => copy('mcp', MCP_ADD_PROMPT)} />
          <CopyRow label="pi" text={PI_EXTENSION_ADD_PROMPT} copied={copied === 'pi'} onCopy={() => copy('pi', PI_EXTENSION_ADD_PROMPT)} />
          <p>想改某个已装扩展的行为，或给它加功能？直接说，或打 /selfdev 开头——改完自动热重载，下一条消息即生效，改崩了可一键还原。</p>
          <CopyRow label="selfdev" text={SELFDEV_MODIFY_PROMPT} copied={copied === 'selfdev'} onCopy={() => copy('selfdev', SELFDEV_MODIFY_PROMPT)} />
          <p>手里已经有 .zip 扩展包？不用填任何配置，点左侧「安装扩展包 (.zip)」选文件直接装，装好即对当前项目启用。</p>
          {copied && <p className="extensions-add-copied" data-testid="extensions-add-copied">已复制。关掉设置，贴到主界面发送即可。</p>}
        </div>
      </section>
    </div>
  )
}

function requestedCapabilities(ext: ExtensionDescriptor): readonly string[] {
  return ext.capabilities ?? []
}

function readableError(ext: ExtensionDescriptor): string | undefined {
  if (ext.state !== 'error') return undefined
  const reason = ext.errorReason ?? ext.error
  return reason && reason.trim() ? reason : '加载失败'
}

function ConfirmDialog({
  testId,
  title,
  children,
  confirmLabel,
  confirmTestId,
  cancelTestId,
  onConfirm,
  onCancel,
  confirmDisabled = false,
}: {
  testId: string
  title: string
  children: ReactNode
  confirmLabel: string
  confirmTestId: string
  cancelTestId: string
  onConfirm: () => void
  onCancel: () => void
  confirmDisabled?: boolean
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div
      className="extensions-add-backdrop"
      data-testid={`${testId}-backdrop`}
      onMouseDown={event => { if (event.target === event.currentTarget) onCancel() }}
    >
      <section className="extensions-add-dialog" role="dialog" aria-modal="true" aria-labelledby={`${testId}-title`} data-testid={testId}>
        <header>
          <h3 id={`${testId}-title`}>{title}</h3>
          <button type="button" className="model-modal-close" aria-label="关闭" onClick={onCancel}>×</button>
        </header>
        <div className="extensions-add-body">
          {children}
          <div className="extensions-dialog-actions">
            <button type="button" className="model-modal-refresh" data-testid={cancelTestId} onClick={onCancel}>取消</button>
            <button type="button" className="model-modal-add" data-testid={confirmTestId} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </div>
      </section>
    </div>
  )
}

function ExtensionContributionSummary({
  ext,
  agents,
  catalogDiagnostics,
  dismissed,
  onDismiss,
}: {
  ext: ExtensionDescriptor
  agents: AgentDefinition[]
  catalogDiagnostics: AgentCatalogDiagnostic[]
  dismissed: Set<string>
  onDismiss: (next: Set<string> | ((current: Set<string>) => Set<string>)) => void
}) {
  const contributed = contributedAgentsFor(agents, ext.id)
  const patches = patchesForExtension(agents, ext.id)
  const acceptedPatches = patches.filter(({ patch }) => !isRequestedPatch(patch))
  const requestedPatches = patches.filter(({ patch }) => isRequestedPatch(patch))
  const related = diagnosticsForExtension(ext.id, agents, catalogDiagnostics).filter(entry => (
    isBlockingCatalogDiagnostic(entry) && !dismissed.has(diagnosticKey(entry))
  ))
  if (contributed.length === 0 && acceptedPatches.length === 0 && requestedPatches.length === 0 && related.length === 0) return null
  return (
    <div className="extensions-pkg-contrib" data-testid={`extensions-pkg-contrib-${ext.id}`}>
      {contributed.length > 0 && (
        <>
          <div className="extensions-pkg-contrib-heading">贡献的 Agent</div>
          <ul className="extensions-pkg-agents" data-testid={`extensions-pkg-agents-${ext.id}`}>
            {contributed.map(agent => {
              const sourceLabel = agentSourceLabel(agent)
              const availabilityLabel = agentAvailabilityLabel(agent)
              return (
                <li key={agent.name} data-testid={`extensions-pkg-agent-${ext.id}-${agent.name}`}>
                  <strong>{agent.name}</strong>
                  <span className="extensions-pkg-agent-meta">
                    {sourceLabel}{availabilityLabel ? ` · ${availabilityLabel}` : ''}{agent.permissionSummary ? ` · ${agent.permissionSummary}` : ''}
                  </span>
                  {agent.description && <span className="extensions-pkg-agent-desc">{agent.description}</span>}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {acceptedPatches.length > 0 && (
        <>
          <div className="extensions-pkg-contrib-heading">应用的补丁</div>
          <ul className="extensions-pkg-patches" data-testid={`extensions-pkg-patches-${ext.id}`}>
            {acceptedPatches.map(({ agentName, patch }, index) => (
              <li key={`${agentName}-${patch.operations.join('-')}-${index}`} data-testid={`extensions-pkg-patch-${ext.id}-${agentName}`}>
                <strong>{agentName}</strong>
                <span className="extensions-pkg-agent-meta">{formatPatchOperations(patch)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {requestedPatches.length > 0 && (
        <>
          <div className="extensions-pkg-contrib-heading">请求的补丁</div>
          <ul className="extensions-pkg-requested" data-testid={`extensions-pkg-requested-${ext.id}`}>
            {requestedPatches.map(({ agentName, patch }, index) => (
              <li key={`${agentName}-${patch.operations.join('-')}-requested-${index}`} data-testid={`extensions-pkg-requested-${ext.id}-${agentName}`}>
                <strong>{agentName}</strong>
                <span className="extensions-pkg-agent-meta">{formatPatchOperations(patch)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {related.length > 0 && (
        <div className="extensions-pkg-contrib-diagnostics" data-testid={`extensions-pkg-contrib-diag-${ext.id}`}>
          <div className="extensions-pkg-contrib-heading">贡献诊断</div>
          {related.map(entry => (
            <DismissibleError
              key={diagnosticKey(entry)}
              message={formatDiagnostic(entry)}
              onDismiss={() => onDismiss(current => new Set(current).add(diagnosticKey(entry)))}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ExtensionPackageRow({
  ext,
  host,
  projectId,
  busy,
  agents,
  catalogDiagnostics,
  dismissedDiagnostics,
  onDismissDiagnostics,
  onToggle,
  onUninstall,
  packActive,
  membership,
}: {
  ext: ExtensionDescriptor
  host: PipiHostAPI
  projectId?: string
  busy: boolean
  agents: AgentDefinition[]
  catalogDiagnostics: AgentCatalogDiagnostic[]
  dismissedDiagnostics: Set<string>
  onDismissDiagnostics: (next: Set<string> | ((current: Set<string>) => Set<string>)) => void
  onToggle: (ext: ExtensionDescriptor) => void
  onUninstall: (ext: ExtensionDescriptor) => void
  packActive: boolean
  membership: 'required' | 'optional' | 'outside'
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const enabled = ext.state === 'enabled'
  const caps = requestedCapabilities(ext)
  const settingsSchema = ext.contributions?.settings?.schema
  const declaresAuth = Boolean(ext.contributions?.auth?.provider?.id)
  const declaresSettings = Boolean(ext.contributions?.settingsSections?.length || settingsSchema)
  // Every extension gets the same generic editor for what its manifest declares.
  const canEditSettings = enabled && declaresSettings && !declaresAuth && Boolean(host.getExtensionSettings && host.updateExtensionSettings)
  const canShowAuth = enabled && declaresAuth
  const l2Blocked = blocksEnableForL2(ext.source, caps)
  const errorText = readableError(ext)
  // 包外扩展不属于包成员关系，独立于整包激活状态，随时可按项目开关。
  const canToggle = (membership === 'outside' || packActive) && membership !== 'required' && !busy && ext.state !== 'error' && !(l2Blocked && !enabled)
  const sourceLabel = EXTENSION_SOURCE_LABEL[ext.source] ?? ext.source
  const stateLabel = EXTENSION_STATE_LABEL[ext.state] ?? ext.state
  const category = extensionCategory(ext)

  return (
    <div className="extensions-pkg-row" data-testid={`extensions-pkg-${ext.id}`}>
      <div className="extensions-pkg-top">
        <div className="extensions-pkg-identity">
          <div className="extensions-pkg-title-line">
            <strong>{ext.name ?? ext.id}</strong>
            <span className="extensions-pkg-category">{EXTENSION_CATEGORY_LABEL[category]}</span>
            <span className={`extensions-membership-pill ${membership}`}>{membership === 'required' ? '包必需' : membership === 'outside' ? '包外' : '可选'}</span>
          </div>
          <div className="extensions-pkg-meta" data-testid={`extensions-pkg-meta-${ext.id}`}>
            <span>{ext.version ?? '—'}</span>
            <span>{sourceLabel}</span>
            <span className={`extensions-state-pill state-${ext.state}`}>{stateLabel}</span>
          </div>
        </div>
        <div className="extensions-pkg-actions">
          <button
            type="button"
            role="switch"
            className={`computer-use-switch${enabled ? ' enabled' : ''}`}
            aria-checked={enabled}
            aria-label={enabled ? `禁用 ${ext.name ?? ext.id}` : `启用 ${ext.name ?? ext.id}`}
            disabled={!canToggle}
            data-testid={`extensions-pkg-toggle-${ext.id}`}
            onClick={() => onToggle(ext)}
          >
            <span />
          </button>
          {ext.source !== 'builtin' && (
            <button
              type="button"
              className="model-modal-refresh"
              disabled={busy}
              data-testid={`extensions-pkg-uninstall-${ext.id}`}
              onClick={() => onUninstall(ext)}
            >
              卸载
            </button>
          )}
        </div>
      </div>
      {ext.description && (
        <p className="extensions-pkg-desc" data-testid={`extensions-pkg-desc-${ext.id}`}>{ext.description}</p>
      )}
      {canShowAuth && <ExtensionAuthCard host={host} extensionId={ext.id} />}
      {canEditSettings && (
        <div className="extensions-pkg-settings" data-testid={`extensions-pkg-settings-${ext.id}`}>
          <button
            type="button"
            className="model-modal-refresh"
            data-testid={`extensions-pkg-settings-toggle-${ext.id}`}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(open => !open)}
          >
            {settingsOpen ? '收起设置' : '设置'}
          </button>
          {settingsOpen && (
            <SchemaSettingsForm host={host} extensionId={ext.id} projectId={projectId} schema={settingsSchema} />
          )}
        </div>
      )}
      {caps.length > 0 && (
        <div className="extensions-badges" data-testid={`extensions-pkg-caps-${ext.id}`}>
          {caps.map(capability => (
            <span
              key={capability}
              className={`extensions-badge${blocksEnableForL2(ext.source, [capability]) ? ' l2' : ''}`}
              title={capabilityLabel(capability)}
            >
              {capability}
            </span>
          ))}
        </div>
      )}
      {l2Blocked && (
        <p className="extensions-pkg-hint" data-testid={`extensions-pkg-l2-${ext.id}`}>{L2_CAPABILITY_HINT}</p>
      )}
      {errorText && (
        <p className="model-modal-error" role="alert" data-testid={`extensions-pkg-error-${ext.id}`}>{errorText}</p>
      )}
      <ExtensionContributionSummary
        ext={ext}
        agents={agents}
        catalogDiagnostics={catalogDiagnostics}
        dismissed={dismissedDiagnostics}
        onDismiss={onDismissDiagnostics}
      />
    </div>
  )
}

function SkillsHub({ items }: { items: ExtensionDescriptor[] }) {
  const builtIn = items.find(item => item.id === CORE_SKILLS_EXTENSION_IDS[0])
  const loader = items.find(item => item.id === CORE_SKILLS_EXTENSION_IDS[1])
  const builtInEnabled = builtIn?.state === 'enabled'
  const loaderEnabled = loader?.state === 'enabled'
  return (
    <section className="extensions-skills-hub" data-testid="extensions-skills-hub">
      <div className="extensions-hub-hero">
        <span className="extensions-overview-eyebrow">核心扩展</span>
        <h3>Skills</h3>
        <p>Skill 是 Agent 在需要时加载的说明、流程和资源。基础版只启用 Built-in Skills 与 Skill Loader；Coding 等扩展包再带上各自领域的 Skills。</p>
      </div>
      <div className="extensions-hub-grid">
        <article className="extensions-hub-card">
          <span className="extensions-support-kicker">运行状态</span>
          <div className="extensions-hub-card-title">
            <h4>Built-in Skills</h4>
            <span className={`extensions-state-pill state-${builtInEnabled ? 'enabled' : 'disabled'}`} data-testid="extensions-skills-builtin-state">{builtInEnabled ? '已启用' : '未启用'}</span>
          </div>
          <div className="extensions-hub-card-title">
            <h4>Skill Loader</h4>
            <span className={`extensions-state-pill state-${loaderEnabled ? 'enabled' : 'disabled'}`} data-testid="extensions-skills-loader-state">{loaderEnabled ? '已启用' : '未启用'}</span>
          </div>
          <p>内置技能集由 <code>built-in-skills</code> 提供；搜索与按需加载由 <code>skill-loader-extension</code> 提供。每个扩展包可以带自己的 Skill 根目录。</p>
        </article>
        <article className="extensions-hub-card extensions-hub-card-accent" data-testid="extensions-skill-create">
          <span className="extensions-support-kicker">内置创建工具</span>
          <h4>创建 PipiUI 扩展</h4>
          <p><code>create-pipiui-extension</code> Skill 可以生成扩展骨架，<code>--pack</code> 生成产品扩展包骨架。</p>
          <div className="extensions-skill-prompt">在主会话里直接说：创建一个包含左栏、工具和结果卡片的扩展。</div>
        </article>
        <article className="extensions-hub-card">
          <span className="extensions-support-kicker">组织方式</span>
          <h4>Skill 跟随扩展包</h4>
          <p>启用 Coding、COC 或 ET 扩展包时，对应领域的 Skills 一起可用；关闭扩展包后不会污染其它项目。</p>
        </article>
      </div>
    </section>
  )
}

function McpImportDialog({ host, projectId, existing, onClose, onDone }: {
  host: PipiHostAPI
  projectId: string
  existing: UserMcpServer[]
  onClose: () => void
  onDone: (notice: string) => void
}) {
  const [text, setText] = useState('')
  const [fallbackName, setFallbackName] = useState('custom-mcp')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const parsed = useMemo(() => parseMcpServersJson(text, fallbackName), [text, fallbackName])
  const existingNames = useMemo(() => new Set(existing.map(server => server.name)), [existing])

  const doImport = async () => {
    const addUser = host.addUserMcpServer
    if (!addUser || busy || parsed.servers.length === 0) return
    setBusy(true)
    setError(null)
    try {
      for (const { name, spec } of parsed.servers) {
        await addUser(projectId, name, spec)
      }
      const overwritten = parsed.servers.filter(server => existingNames.has(server.name)).length
      const suffix = overwritten > 0 ? `其中 ${overwritten} 个为同名覆盖。` : ''
      onDone(`已导入 ${parsed.servers.length} 个 MCP 连接到当前项目，新会话生效。${suffix}`)
    } catch (importError) {
      setError(`导入失败：${importError instanceof Error ? importError.message : String(importError)}`)
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      testId="extensions-mcp-import"
      title="粘贴 JSON 导入 MCP"
      confirmLabel={busy ? '导入中…' : `导入 ${parsed.servers.length} 个连接`}
      confirmTestId="extensions-mcp-import-confirm"
      cancelTestId="extensions-mcp-import-cancel"
      confirmDisabled={busy || parsed.servers.length === 0}
      onConfirm={() => { void doImport() }}
      onCancel={() => { if (!busy) onClose() }}
    >
      <p>把 Claude、Cursor、Cline 等客户端的 <code>mcpServers</code> JSON 原样贴进来，也支持只贴一个服务器。</p>
      <textarea
        className="extensions-mcp-json"
        data-testid="extensions-mcp-json-input"
        rows={11}
        spellCheck={false}
        placeholder={MCP_IMPORT_EXAMPLE}
        value={text}
        onChange={event => setText(event.target.value)}
      />
      {parsed.shape === 'bare' && (
        <label className="extensions-pack-name-field">
          <span>连接名称</span>
          <input value={fallbackName} maxLength={128} data-testid="extensions-mcp-name" onChange={event => setFallbackName(event.target.value)} />
        </label>
      )}
      {parsed.error && <p className="model-modal-error" role="alert" data-testid="extensions-mcp-import-error">{parsed.error}</p>}
      {parsed.servers.length > 0 && (
        <div className="extensions-mcp-preview" data-testid="extensions-mcp-preview">
          {parsed.servers.map(server => (
            <div className="extensions-user-row" key={server.name} data-testid={`extensions-mcp-preview-${server.name}`}>
              <strong>
                {server.name}
                {existingNames.has(server.name) && <span className="extensions-membership-pill outside">覆盖同名</span>}
              </strong>
              <span>{mcpServerTransport(server.spec)} · {mcpServerSummary(server.spec)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="extensions-mcp-json-hint">写入当前项目的 <code>.pi/mcp.json</code>，对新会话生效；密钥只保存在这份本机文件里。</p>
    </ConfirmDialog>
  )
}

function McpHub({ host, projectId, servers, onChanged }: {
  host?: PipiHostAPI
  projectId?: string
  servers: UserMcpServer[]
  onChanged: () => void
}) {
  const [importOpen, setImportOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<UserMcpServer | null>(null)
  const canImport = Boolean(host?.addUserMcpServer && projectId)
  const canRemove = Boolean(host?.removeUserMcpServer && projectId)

  const confirmRemove = async () => {
    const target = removeTarget
    const removeUser = host?.removeUserMcpServer
    if (!target || !removeUser || !projectId) return
    setRemoveTarget(null)
    try {
      await removeUser(projectId, target.name)
      setNotice(`已移除 MCP 连接「${target.name}」，新会话生效。`)
      onChanged()
    } catch (removeError) {
      setError(`移除失败：${removeError instanceof Error ? removeError.message : String(removeError)}`)
    }
  }

  return (
    <section className="extensions-mcp-hub" data-testid="extensions-mcp-hub">
      <div className="extensions-hub-hero">
        <span className="extensions-overview-eyebrow">核心扩展</span>
        <h3>MCP 连接</h3>
        <p>PipiUI 内置 MCP 宿主；第三方服务作为当前项目的连接显示在这里。</p>
      </div>
      {notice && (
        <div className="extensions-archive-notice" data-testid="extensions-mcp-notice">
          <span>{notice}</span>
          <button type="button" aria-label="关闭 MCP 提示" onClick={() => setNotice(null)}>×</button>
        </div>
      )}
      {error && <DismissibleError message={error} onDismiss={() => setError(null)} />}
      <div className="extensions-mcp-builtin" data-testid="extensions-builtin">
        <div data-testid="extensions-item-pi-mcp">
          <strong>{CORE_MCP_EXTENSION_IDS[0]}</strong>
          <span>连接外部 MCP · 1 项</span>
        </div>
        <span className="extensions-state-pill state-enabled">已内置</span>
      </div>
      <div className="extensions-user-connections" data-testid="extensions-user">
        <div className="extensions-user-connections-heading">
          <strong>项目连接</strong>
          <span>{servers.length} 项</span>
          {canImport && (
            <button type="button" className="model-modal-refresh" data-testid="extensions-mcp-import-open" onClick={() => setImportOpen(true)}>粘贴 JSON 导入</button>
          )}
        </div>
        {servers.length === 0
          ? (
            <p className="extensions-user-empty" data-testid="extensions-user-empty">
              {canImport
                ? '还没有添加的 MCP。点击「粘贴 JSON 导入」，把主流客户端的 mcpServers 配置贴进来即可。'
                : '还没有额外添加的 MCP 或 Pi 扩展。使用右上角“添加扩展”即可开始。'}
            </p>
          )
          : (
            <div className="extensions-user-list" data-testid="extensions-user-list">
              {servers.map(server => (
                <div className="extensions-user-row" key={server.name} data-testid={`extensions-item-mcp-${server.name}`}>
                  <strong>{server.name}</strong>
                  <span>{server.transport} · {server.summary}</span>
                  {canRemove && (
                    <button
                      type="button"
                      className="extensions-mcp-remove"
                      data-testid={`extensions-mcp-remove-${server.name}`}
                      onClick={() => setRemoveTarget(server)}
                    >移除</button>
                  )}
                </div>
              ))}
            </div>
          )}
      </div>
      {importOpen && host && projectId && (
        <McpImportDialog
          host={host}
          projectId={projectId}
          existing={servers}
          onClose={() => setImportOpen(false)}
          onDone={message => {
            setImportOpen(false)
            setNotice(message)
            onChanged()
          }}
        />
      )}
      {removeTarget && (
        <ConfirmDialog
          testId="extensions-mcp-remove"
          title={`移除 ${removeTarget.name}`}
          confirmLabel="确认移除"
          confirmTestId="extensions-mcp-remove-confirm"
          cancelTestId="extensions-mcp-remove-cancel"
          onConfirm={() => { void confirmRemove() }}
          onCancel={() => setRemoveTarget(null)}
        >
          <p>会从当前项目的 <code>.pi/mcp.json</code> 删除这条连接。新会话不再加载它的工具。</p>
        </ConfirmDialog>
      )}
    </section>
  )
}

function ExtensionPackagesSection({ host, projectId, servers, onServersChanged }: {
  host: PipiHostAPI
  projectId?: string
  servers: UserMcpServer[]
  onServersChanged: () => void
}) {
  const productWorkbench = useOptionalProductWorkbenchRuntime()
  const [items, setItems] = useState<ExtensionDescriptor[]>([])
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null)
  const [selectedView, setSelectedView] = useState<'packs' | 'skills' | 'mcp'>('packs')
  const [packsOpen, setPacksOpen] = useState(true)
  const [packBusy, setPackBusy] = useState<string | null>(null)
  const [packError, setPackError] = useState<string | null>(null)
  const [archiveBusy, setArchiveBusy] = useState<'export' | 'import' | 'zip' | null>(null)
  const [archiveNotice, setArchiveNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [grantTarget, setGrantTarget] = useState<ExtensionDescriptor | null>(null)
  const [uninstallTarget, setUninstallTarget] = useState<ExtensionDescriptor | null>(null)
  const [dismissedDiagnostics, setDismissedDiagnostics] = useState<Set<string>>(() => new Set())
  const [loadDiagnostics, setLoadDiagnostics] = useState<AgentCatalogDiagnostic[]>([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ExtensionStatusFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<DisplayExtensionCategory | 'all'>('all')
  const resolvedProjectId = projectId || lastProjectId()
  const catalogDiagnostics = useMemo(() => collectCatalogDiagnostics(agents), [agents])
  const canSwitchPacks = Boolean(resolvedProjectId && host.setExtensionEnabled)
  const packs = useMemo(() => packViewsFrom(items), [items])
  const selectedPack = packs.find(pack => pack.id === selectedPackId) ?? packs.find(pack => pack.active) ?? packs[0]
  const packExtensionIds = useMemo(() => new Set(selectedPack?.memberIds ?? []), [selectedPack])
  const requiredExtensionIds = useMemo(() => new Set(selectedPack?.requiredIds ?? []), [selectedPack])
  const packItems = useMemo(() => items.filter(item => packExtensionIds.has(item.id)), [items, packExtensionIds])
  const outsideItems = useMemo(() => items.filter(item => !packExtensionIds.has(item.id)), [items, packExtensionIds])
  const listableCount = packItems.length + outsideItems.length
  const packActive = Boolean(selectedPack?.active)
  const categories = useMemo(() => {
    const grouped = new Map<DisplayExtensionCategory, ExtensionDescriptor[]>()
    for (const item of packItems) {
      const category = extensionCategory(item)
      const bucket = grouped.get(category) ?? []
      bucket.push(item)
      grouped.set(category, bucket)
    }
    if (outsideItems.length > 0) {
      grouped.set('outside', [...outsideItems].sort((left, right) => (left.name ?? left.id).localeCompare(right.name ?? right.id)))
    }
    return EXTENSION_CATEGORY_ORDER
      .map(category => ({ category, items: (grouped.get(category) ?? []).sort((left, right) => (left.name ?? left.id).localeCompare(right.name ?? right.id)) }))
      .filter(group => group.items.length > 0)
  }, [items, packExtensionIds, outsideItems, packItems])
  const enabledCount = packItems.filter(item => item.state === 'enabled').length
  const filteredCategories = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return categories
      .filter(group => categoryFilter === 'all' || group.category === categoryFilter)
      .map(group => ({
        ...group,
        items: group.items.filter(item => {
          const statusMatches = statusFilter === 'all'
            || (statusFilter === 'enabled' ? item.state === 'enabled' : item.state !== 'enabled')
          if (!statusMatches) return false
          if (!needle) return true
          return [item.name, item.id, item.description, EXTENSION_CATEGORY_LABEL[group.category]]
            .some(value => value?.toLocaleLowerCase().includes(needle))
        }),
      }))
      .filter(group => group.items.length > 0)
  }, [categories, categoryFilter, query, statusFilter])
  const filteredCount = filteredCategories.reduce((total, group) => total + group.items.length, 0)
  const visibleCatalogDiagnostics = [...loadDiagnostics, ...catalogDiagnostics].filter(entry => {
    if (!isBlockingCatalogDiagnostic(entry)) return false
    if (dismissedDiagnostics.has(diagnosticKey(entry))) return false
    return !packItems.some(ext => diagnosticsForExtension(ext.id, agents, [entry]).length > 0)
  })

  const refresh = useCallback(async () => {
    const nextLoad: AgentCatalogDiagnostic[] = []
    if (!host.listExtensions) {
      setItems([])
      setAgents([])
      setLoadDiagnostics([])
      return
    }
    try {
      const listed = await (resolvedProjectId ? host.listExtensions(resolvedProjectId) : host.listExtensions())
      setItems(listed)
      // The pane and the shell read the same list: the enabled extension that
      // declares a layout is the form, everything enabled is what is visible.
      const enabled = listed.filter(item => item.state === 'enabled')
      const activePack = enabled.find(item => item.ui?.layout)
      const enabledIds = enabled.map(item => item.id)
      if (activePack) productWorkbench?.activateProductPack({ id: activePack.id, layout: activePack.ui?.layout }, enabledIds)
      else productWorkbench?.activateBaseWorkbench(enabledIds)
    } catch (error) {
      setItems([])
      nextLoad.push({
        severity: 'error',
        code: 'extensions-load-failed',
        message: redactDiagnosticMessage(`无法加载扩展列表：${error instanceof Error ? error.message : String(error)}`),
      })
    }
    if (!host.listAgentDefinitions) {
      setAgents([])
    } else {
      try {
        setAgents(await host.listAgentDefinitions(resolvedProjectId || undefined))
        setDismissedDiagnostics(new Set())
      } catch (error) {
        setAgents([])
        nextLoad.push({
          severity: 'error',
          code: 'agent-catalog-load-failed',
          message: redactDiagnosticMessage(`无法加载 Agent 目录：${error instanceof Error ? error.message : String(error)}`),
        })
      }
    }
    setLoadDiagnostics(nextLoad)
  }, [host, productWorkbench, resolvedProjectId])

  useEffect(() => { void refresh() }, [refresh])

  const choosePack = (pack: PackView) => {
    setSelectedPackId(pack.id)
    setSelectedView('packs')
    setCategoryFilter('all')
    setQuery('')
  }

  /**
   * Switching forms is the ordinary extension toggle on the pack. Turning the
   * synthetic base entry on means turning off whichever pack is on; the closure
   * releases the rest by itself.
   */
  const setPackActive = async (pack: PackView, enabled: boolean) => {
    if (!resolvedProjectId || !host.setExtensionEnabled) return
    setPackBusy(pack.id)
    setPackError(null)
    try {
      if (pack.synthetic) {
        if (!enabled) return
        for (const active of packs.filter(item => !item.synthetic && item.active)) {
          await host.setExtensionEnabled(active.id, false, 'project', resolvedProjectId)
        }
      } else {
        await host.setExtensionEnabled(pack.id, enabled, 'project', resolvedProjectId)
      }
      setSelectedPackId(pack.id)
      await refresh()
    } catch (error) {
      setPackError(`扩展包切换失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setPackBusy(null)
    }
  }

  const exportPack = async (pack: PackView) => {
    if (!resolvedProjectId || !host.saveProductPackArchive || !host.exportProductPackArchive || pack.synthetic) return
    setArchiveBusy('export')
    setPackError(null)
    setArchiveNotice(null)
    try {
      const destination = await host.saveProductPackArchive(`${pack.id}.pipiui-pack.zip`)
      if (!destination) return
      const result = await host.exportProductPackArchive(resolvedProjectId, pack.id, destination)
      const filename = result.archivePath.split(/[\\/]/).pop() ?? result.archivePath
      setArchiveNotice(`已导出 ${pack.name} 扩展包：${filename}`)
    } catch (error) {
      setPackError(`导出扩展包失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setArchiveBusy(null)
    }
  }

  const importPack = async () => {
    if (!resolvedProjectId || !host.pickProductPackArchive || !host.installProductPackArchive) return
    setArchiveBusy('import')
    setPackError(null)
    setArchiveNotice(null)
    try {
      const source = await host.pickProductPackArchive()
      if (!source) return
      const next = await host.installProductPackArchive(resolvedProjectId, source)
      setSelectedPackId(next.packId)
      setSelectedView('packs')
      await refresh()
      setArchiveNotice('扩展包已加载并应用到当前项目。新会话会使用这个扩展包。')
    } catch (error) {
      setPackError(`加载扩展包失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setArchiveBusy(null)
    }
  }

  const importExtensionZip = async () => {
    if (!resolvedProjectId || !host.pickProductPackArchive || !host.installExtensionZip) return
    setArchiveBusy('zip')
    setPackError(null)
    setArchiveNotice(null)
    try {
      const source = await host.pickProductPackArchive()
      if (!source) return
      const installed = await host.installExtensionZip(resolvedProjectId, source)
      await refresh()
      setArchiveNotice(`扩展「${installed.name ?? installed.id}」已安装并对当前项目启用，新会话将加载它。`)
    } catch (error) {
      setPackError(`安装扩展包失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setArchiveBusy(null)
    }
  }

  const applyEnable = async (ext: ExtensionDescriptor, enabled: boolean) => {
    if (!host.setExtensionEnabled) return
    setBusyId(ext.id)
    try {
      if (resolvedProjectId) await host.setExtensionEnabled(ext.id, enabled, 'project', resolvedProjectId)
      else await host.setExtensionEnabled(ext.id, enabled, 'project')
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const onToggle = async (ext: ExtensionDescriptor) => {
    if (ext.state === 'enabled') {
      await applyEnable(ext, false)
      return
    }
    const requested = requestedCapabilities(ext)
    if (blocksEnableForL2(ext.source, requested)) return
    let granted = ext.grantedCapabilities
    if (granted === undefined && host.getCapabilityGrant) {
      try {
        granted = (await host.getCapabilityGrant(ext.id)).capabilities
      } catch {
        granted = []
      }
    }
    if (grantNeedsConfirmation(requested, granted ?? [])) {
      setGrantTarget(ext)
      return
    }
    await applyEnable(ext, true)
  }

  const confirmGrant = async () => {
    const ext = grantTarget
    if (!ext) return
    const requested = requestedCapabilities(ext)
    setGrantTarget(null)
    setBusyId(ext.id)
    try {
      await host.confirmCapabilityGrant?.(ext.id, requested)
      if (resolvedProjectId) await host.setExtensionEnabled?.(ext.id, true, 'project', resolvedProjectId)
      else await host.setExtensionEnabled?.(ext.id, true, 'project')
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const confirmUninstall = async () => {
    const ext = uninstallTarget
    if (!ext) return
    setUninstallTarget(null)
    setBusyId(ext.id)
    try {
      await host.uninstallExtension?.(ext.id)
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const subnavSlot = useContext(ExtensionsSubnavSlotContext)
  const packSubnav = (
    <aside className="extensions-pack-sidebar">
      <div className="extensions-pack-sidebar-heading">核心扩展</div>
      <button
        type="button"
        className={`extensions-capability-nav${selectedView === 'skills' ? ' active' : ''}`}
        data-testid="extensions-nav-skills"
        onClick={() => setSelectedView('skills')}
      >
        <strong>Skills</strong>
        <span>内置技能集 · Skill Loader</span>
      </button>
      <button
        type="button"
        className={`extensions-capability-nav${selectedView === 'mcp' ? ' active' : ''}`}
        data-testid="extensions-nav-mcp"
        onClick={() => setSelectedView('mcp')}
      >
        <strong>MCP 连接</strong>
        <span>{CORE_MCP_EXTENSION_IDS[0]} · {servers.length} 个项目连接</span>
      </button>
      <div className="extensions-pack-sidebar-divider" />
      <div className="extensions-pack-sidebar-heading">其他扩展</div>
      {host.pickProductPackArchive && host.installExtensionZip && resolvedProjectId && (
        <>
          <button
            type="button"
            className="extensions-pack-import"
            disabled={archiveBusy !== null || packBusy !== null}
            title="安装单个扩展 ZIP：包根（或唯一顶层文件夹）内需包含 pipiui-extension.json 与 agent/ 或 app/ 目录"
            data-testid="extensions-zip-install"
            onClick={() => void importExtensionZip()}
          >{archiveBusy === 'zip' ? '正在安装…' : '安装扩展 ZIP'}</button>
          <p className="extensions-zip-hint" data-testid="extensions-zip-hint">单个扩展 ZIP：包根（或唯一顶层文件夹）内需有 pipiui-extension.json 与 agent/ 或 app/；安装后自动对当前项目启用。</p>
        </>
      )}
      <div className="extensions-pack-sidebar-divider" />
      <button
        type="button"
        className="extensions-pack-dropdown"
        aria-expanded={packsOpen}
        data-testid="extensions-pack-dropdown"
        onClick={() => setPacksOpen(open => !open)}
      >
        <span>扩展包</span>
        <span aria-hidden="true">{packsOpen ? '▾' : '▸'}</span>
      </button>
      {packsOpen && (
        <div className="extensions-pack-list" data-testid="extensions-pack-list">
          {packs.map(pack => {
            const selected = selectedView === 'packs' && selectedPack?.id === pack.id
            return (
              <div key={pack.id} className={`extensions-pack-item${selected ? ' selected' : ''}`} data-testid={`extensions-pack-${pack.id}`}>
                <button type="button" className="extensions-pack-select" onClick={() => choosePack(pack)}>
                  <strong>{pack.name}</strong>
                  <span>{pack.synthetic ? '无扩展包' : '扩展包'} · {pack.memberIds.length} 个扩展</span>
                </button>
                <button
                  type="button"
                  role="switch"
                  className={`computer-use-switch extensions-pack-switch${pack.active ? ' enabled' : ''}`}
                  aria-checked={pack.active}
                  aria-label={pack.active ? `关闭 ${pack.name} 扩展包` : `启用 ${pack.name} 扩展包`}
                  disabled={packBusy !== null || !canSwitchPacks || (pack.synthetic && pack.active)}
                  data-testid={`extensions-pack-toggle-${pack.id}`}
                  onClick={() => void setPackActive(pack, !pack.active)}
                ><span /></button>
              </div>
            )
          })}
          {host.pickProductPackArchive && host.installProductPackArchive && resolvedProjectId && (
            <button type="button" className="extensions-pack-import" disabled={archiveBusy !== null || packBusy !== null} data-testid="extensions-pack-import" onClick={() => void importPack()}>{archiveBusy === 'import' ? '正在加载…' : '加载 ZIP'}</button>
          )}
        </div>
      )}
    </aside>
  )
  return (
    <section className="extensions-library" data-testid="extensions-packages">
      {subnavSlot && createPortal(packSubnav, subnavSlot)}
      <div className="extensions-library-shell">
        {!subnavSlot && packSubnav}
        <div className="extensions-library-content">
          {packError && <DismissibleError message={packError} onDismiss={() => setPackError(null)} />}
          {archiveNotice && <div className="extensions-archive-notice" data-testid="extensions-archive-notice"><span>{archiveNotice}</span><button type="button" aria-label="关闭扩展包提示" onClick={() => setArchiveNotice(null)}>×</button></div>}
          {visibleCatalogDiagnostics.length > 0 && (
            <div className="extensions-catalog-diagnostics" data-testid="extensions-catalog-diagnostics">
              {visibleCatalogDiagnostics.map(entry => (
                <DismissibleError
                  key={diagnosticKey(entry)}
                  message={formatDiagnostic(entry)}
                  onDismiss={() => setDismissedDiagnostics(current => new Set(current).add(diagnosticKey(entry)))}
                />
              ))}
            </div>
          )}
          {selectedView === 'skills' ? <SkillsHub items={items} /> : selectedView === 'mcp' ? (
            <McpHub host={host} projectId={resolvedProjectId} servers={servers} onChanged={onServersChanged} />
          ) : selectedPack ? (
            <>
              <div className="extensions-pack-detail">
                <div className="extensions-pack-detail-copy">
                  <span className="extensions-overview-eyebrow">{selectedPack.synthetic ? '基础形态' : '产品扩展包'}</span>
                  <h3>{selectedPack.name} 扩展包</h3>
                  <p>{selectedPack.description ?? '组合当前产品所需的界面、工具和运行时扩展。'}</p>
                  <div className="extensions-pack-detail-actions">
                    {!selectedPack.synthetic && host.saveProductPackArchive && host.exportProductPackArchive && (
                      <button type="button" className="model-modal-refresh" disabled={archiveBusy !== null || packBusy !== null} data-testid="extensions-pack-export" onClick={() => void exportPack(selectedPack)}>{archiveBusy === 'export' ? '正在导出…' : '导出 ZIP'}</button>
                    )}
                    {!packActive && <span className="extensions-pack-inactive-note">{canSwitchPacks ? '启用后可在下方调整个别扩展' : '选择项目后可以启用扩展包'}</span>}
                  </div>
                </div>
                <div className="extensions-pack-master">
                  <span>{packActive ? '整包已启用' : '整包未启用'}</span>
                  <button
                    type="button"
                    role="switch"
                    className={`computer-use-switch extensions-pack-master-switch${packActive ? ' enabled' : ''}`}
                    aria-checked={packActive}
                    aria-label={packActive ? `关闭 ${selectedPack.name} 扩展包` : `启用 ${selectedPack.name} 扩展包`}
                    disabled={packBusy !== null || !canSwitchPacks || (selectedPack.synthetic && packActive)}
                    data-testid="extensions-pack-master-toggle"
                    onClick={() => void setPackActive(selectedPack, !packActive)}
                  ><span /></button>
                </div>
                <dl className="extensions-overview-stats" aria-label="扩展包概览">
                  <div data-testid="extensions-stat-total"><dt>包内扩展</dt><dd>{packItems.length}</dd></div>
                  <div data-testid="extensions-stat-enabled"><dt>当前运行</dt><dd>{enabledCount}</dd></div>
                  <div data-testid="extensions-stat-categories"><dt>分类</dt><dd>{categories.length}</dd></div>
                  <div data-testid="extensions-stat-connections"><dt>必需扩展</dt><dd>{requiredExtensionIds.size}</dd></div>
                </dl>
              </div>
              <div className="extensions-library-toolbar">
                <label className="extensions-search">
                  <input
                    type="search"
                    value={query}
                    aria-label="搜索扩展"
                    placeholder="搜索扩展"
                    data-testid="extensions-search"
                    onChange={event => setQuery(event.target.value)}
                  />
                </label>
                <div className="extensions-status-filters" role="group" aria-label="扩展状态">
                  {EXTENSION_STATUS_FILTERS.map(filter => (
                    <button
                      key={filter.id}
                      type="button"
                      className={statusFilter === filter.id ? 'active' : ''}
                      aria-pressed={statusFilter === filter.id}
                      data-testid={`extensions-status-filter-${filter.id}`}
                      onClick={() => setStatusFilter(filter.id)}
                    >{filter.label}</button>
                  ))}
                </div>
              </div>
              <div className="extensions-category-filters" role="group" aria-label="扩展分类">
                <button
                  type="button"
                  className={categoryFilter === 'all' ? 'active' : ''}
                  aria-pressed={categoryFilter === 'all'}
                  data-testid="extensions-category-filter-all"
                  onClick={() => setCategoryFilter('all')}
                >全部 <span>{listableCount}</span></button>
                {categories.map(group => (
                  <button
                    key={group.category}
                    type="button"
                    className={categoryFilter === group.category ? 'active' : ''}
                    aria-pressed={categoryFilter === group.category}
                    data-testid={`extensions-category-filter-${group.category}`}
                    onClick={() => setCategoryFilter(group.category)}
                  >{EXTENSION_CATEGORY_LABEL[group.category]} <span>{group.items.length}</span></button>
                ))}
              </div>
              <div className="extensions-results-summary" aria-live="polite">
                <strong>{categoryFilter === 'all' ? (outsideItems.length > 0 ? '全部扩展' : '包内扩展') : EXTENSION_CATEGORY_LABEL[categoryFilter]}</strong>
                <span>显示 {filteredCount} / {listableCount} 项</span>
              </div>
              {packItems.length === 0
                ? <div className="extensions-filter-empty" data-testid="extensions-packages-empty">这个扩展包还没有可选扩展。</div>
                : filteredCount === 0
                  ? <div className="extensions-filter-empty" data-testid="extensions-filter-empty">没有符合当前分类或筛选条件的扩展。</div>
                  : (
                    <div className="extensions-categories" data-testid="extensions-packages-list">
                      {filteredCategories.map(group => (
                        <section key={group.category} className="extensions-category" data-testid={`extensions-category-${group.category}`}>
                          <header className="extensions-category-header">
                            <div>
                              <h4>{EXTENSION_CATEGORY_LABEL[group.category]}</h4>
                              <p>{EXTENSION_CATEGORY_DESCRIPTION[group.category]}</p>
                            </div>
                            <span>{group.items.length} 项</span>
                          </header>
                          <div className="extensions-category-items">
                            {group.items.map(ext => (
                              <ExtensionPackageRow
                                key={ext.id}
                                ext={ext}
                                host={host}
                                projectId={resolvedProjectId}
                                busy={busyId === ext.id}
                                agents={agents}
                                catalogDiagnostics={catalogDiagnostics}
                                dismissedDiagnostics={dismissedDiagnostics}
                                onDismissDiagnostics={setDismissedDiagnostics}
                                onToggle={ext => { void onToggle(ext) }}
                                onUninstall={setUninstallTarget}
                                packActive={packActive}
                                membership={group.category === 'outside' ? 'outside' : requiredExtensionIds.has(ext.id) ? 'required' : 'optional'}
                              />
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
            </>
          ) : (
            <div className="extensions-filter-empty" data-testid="extensions-packs-empty">还没有可用扩展包。用「加载 ZIP」导入一个，或安装带 app.ui.layout 的扩展。</div>
          )}
        </div>
      </div>
      {grantTarget && (
        <ConfirmDialog
          testId="extensions-grant-dialog"
          title={`授权 ${grantTarget.name ?? grantTarget.id}`}
          confirmLabel="确认并启用"
          confirmTestId="extensions-grant-confirm"
          cancelTestId="extensions-grant-cancel"
          onConfirm={() => { void confirmGrant() }}
          onCancel={() => setGrantTarget(null)}
        >
          <p>此扩展请求以下能力。确认后才会启用。</p>
          <ul className="extensions-grant-list" data-testid="extensions-grant-list">
            {requestedCapabilities(grantTarget).map(capability => (
              <li key={capability}>
                <code>{capability}</code>
                <span>{capabilityLabel(capability)}</span>
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
      {uninstallTarget && (
        <ConfirmDialog
          testId="extensions-uninstall-dialog"
          title={`卸载 ${uninstallTarget.name ?? uninstallTarget.id}`}
          confirmLabel="确认卸载"
          confirmTestId="extensions-uninstall-confirm"
          cancelTestId="extensions-uninstall-cancel"
          onConfirm={() => { void confirmUninstall() }}
          onCancel={() => setUninstallTarget(null)}
        >
          <p>卸载后将删除该扩展包，其界面贡献会立即消失。内置扩展不能卸载。</p>
        </ConfirmDialog>
      )}
    </section>
  )
}

export function ExtensionsPane({
  addOpen,
  onCloseAdd,
  host,
  projectId,
}: {
  addOpen: boolean
  onCloseAdd: () => void
  host?: PipiHostAPI
  projectId?: string
}) {
  const [servers, setServers] = useState<UserMcpServer[]>([])
  const resolvedHost = host ?? hostFromWindow()

  const reloadServers = useCallback(() => {
    let cancelled = false
    void loadUserMcpServers(resolvedHost, projectId).then(rows => {
      if (!cancelled) setServers(rows)
    }).catch(() => {
      if (!cancelled) setServers([])
    })
    return () => { cancelled = true }
  }, [resolvedHost, projectId])

  useEffect(() => reloadServers(), [reloadServers])

  const resolvedProjectId = projectId || lastProjectId()

  return (
    <div className="extensions-pane" data-testid="extensions-pane">
      {resolvedHost?.listExtensions
        ? <ExtensionPackagesSection host={resolvedHost} projectId={projectId} servers={servers} onServersChanged={reloadServers} />
        : <McpHub host={resolvedHost} projectId={resolvedProjectId} servers={servers} onChanged={reloadServers} />}
      {addOpen && <ExtensionsAddDialog onClose={onCloseAdd} />}
    </div>
  )
}
