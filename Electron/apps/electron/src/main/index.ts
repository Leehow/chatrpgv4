import { app, BaseWindow, dialog, ipcMain, nativeImage, protocol, shell, WebContentsView, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { basename, join } from 'node:path'
import { createPanelAssetHandler } from './panel-asset-protocol.js'
import { appendFileSync, writeFileSync } from 'node:fs'
import { BrowserWatchCallbackRegistry, createCanonicalModelsWriteQueue, createPiHostBackend, handleBrowserWatchEvent, installRuntimeTree, projectPiAgentDir, readProjectExtensionGrants, QuotaStore, FREEZE_PROBE_FILE, FREEZE_PROBE_PREFIX } from '@pipi/pi-backend'

import {
  PIPI_HOST_IPC_CHANNEL,
  PIPI_HOST_PROTOCOL_VERSION,
  type HostBackend,
  type HostEvent,
  type HostRequest,
  type HostResponse,
  type HostWireFrame
} from '@pipi/host-api'
import { BrowserSessionHost, installBrowserNativeTrace, mountBrowserShellView, routeBrowserView, withBrowserTabsHost } from './browser-host.js'
import { BrowserMobileWindowController } from './browser-mobile-window.js'
import { installOwnedRuntimeShutdown } from './app-lifecycle.js'
import { resolveSystemProxyEnvironment } from './system-proxy.js'
import { loadProductIdentity } from './product-identity.js'
import { withProjectDirectoryPicker } from './project-directory-picker.js'
import { withProductPackFileDialogs } from './product-pack-file-dialogs.js'
import { EMBEDDED_NODE_VERSION, installRuntimeProfile, PI_RUNTIME_PACKAGE, resolveRuntimeAssets, UPDATE_CENTER_RUNTIME_PACKAGE_VERSIONS } from './runtime-assets.js'
import { createUpdateCenterService, extensionUpdateCatalogItems, UPDATE_CENTER_FRAMEWORK_VERSIONS, withUpdateCenter, type UpdateCatalogItem } from './update-center.js'
import { withOpenDocumentExternally } from './external-document.js'
import { withOpenExternal } from './external-url.js'
import { createPtyTerminalBackend, TerminalSessionHost } from './terminal-host.js'
import { createElectronHostCapabilityBroker } from './host-capability-host.js'
import {
  createRemoteControlService,
  PIPI_REMOTE_CONTROL_EVENT_CHANNEL,
  PIPI_REMOTE_CONTROL_IPC_CHANNEL,
  registerRemoteControlIpc
} from './remote-control.js'
import { createRemoteDebugService, resolveRemoteDebugStaticDir } from './remote-debug.js'
import { normalizeEventProjectionSession, shouldForwardRendererEvent } from './renderer-event-projection.js'
export { createPtyTerminalBackend, resolveTerminalCwd, resolveTerminalShell } from './terminal-host.js'

export interface IpcMainLike {
  handle(
    channel: string,
    listener: (
      event: { sender: { send(channel: string, frame: HostWireFrame): void } },
      request: HostRequest
    ) => Promise<HostResponse>
  ): void
}

/** Registers main-process IPC without coupling the reusable contract to Electron runtime types. */
export function registerPipiHostIpc(
  ipc: IpcMainLike,
  backend: HostBackend,
  channel = PIPI_HOST_IPC_CHANNEL
): void {
  type RendererSender = { send(channel: string, frame: HostWireFrame): void }
  const renderers = new Map<RendererSender, string | undefined>()
  backend.subscribe((frame) => {
    if (process.env.PIPIUI_STREAM_DEBUG) console.log(`[stream-debug] ipc-send ch=${(frame as { channel?: string }).channel} t=${Date.now()}`)
    for (const [renderer, selectedSession] of renderers) {
      if (shouldForwardRendererEvent(frame, selectedSession)) renderer.send(channel, { type: 'event', ...frame })
    }
  })
  ipc.handle(channel, async (event, request) => {
    if (!renderers.has(event.sender)) renderers.set(event.sender, undefined)
    if (request.protocolVersion !== PIPI_HOST_PROTOCOL_VERSION || request.type !== 'request') {
      return { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: request.id ?? '', type: 'response', ok: false, error: 'unsupported protocol' }
    }
    if (request.method === 'setEventProjectionSession') {
      renderers.set(event.sender, normalizeEventProjectionSession(request.params[0]))
      return { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: request.id, type: 'response', ok: true, result: undefined }
    }
    try {
      return { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: request.id, type: 'response', ok: true, result: await backend.handle(request.method, request.params) }
    } catch (error) {
      const errorCode = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined
      return { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: request.id, type: 'response', ok: false, error: error instanceof Error ? error.message : String(error), ...(errorCode ? { errorCode } : {}) }
    }
  })
}

function createWindow(
  browser: BrowserSessionHost,
  onClosed: () => void,
  productName: string,
  freezeProbeFile?: string,
  isAppQuitting: () => boolean = () => false
): void {
  const window = new BaseWindow({
    width: 1280,
    height: 800,
    title: productName,
    // Pre-paint base color: matches the shell's dark default (--bg in app.css)
    // so the window never shows the system-white behind the renderer during
    // first paint or a heavy remount (project/session switch).
    backgroundColor: '#17181c',
    // Like VS Code/Notion on macOS: no system title strip, only the traffic
    // lights remain. The renderer reserves a draggable strip via
    // env(titlebar-area-*). Keep the default framed titlebar elsewhere.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'
  })
  const shellView = new WebContentsView({
    backgroundColor: '#17181c',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const unmountShellView = mountBrowserShellView(window as any, shellView as any)
  if (freezeProbeFile) {
    shellView.webContents.on('console-message', (...args: unknown[]) => {
      const details = args[1]
      const message = typeof details === 'object' && details && details !== null && 'message' in details
        ? String((details as { message: unknown }).message)
        : typeof args[2] === 'string' ? args[2] : ''
      if (!message.includes(FREEZE_PROBE_PREFIX)) return
      try {
        appendFileSync(freezeProbeFile, message.endsWith('\n') ? message : `${message}\n`)
      } catch {
        /* probe must not affect the window */
      }
    })
  }
  const mobileWindows = new BrowserMobileWindowController(
    window,
    options => new BaseWindow(options as any) as any,
    (sessionId, size) => browser.mobileWindowResized(sessionId, size),
    sessionId => browser.mobileWindowClosed(sessionId),
    isAppQuitting
  )
  browser.attachToWindow(
    (sessionId, rawView, placement, kind, device) => {
      if (kind === 'mobile') return mobileWindows.present(sessionId, rawView, placement, device)
      routeBrowserView(rawView, placement, window as any)
    },
    () => shellView.webContents.getZoomFactor()
  )
  window.on('close', () => {
    browser.detachWindow()
    mobileWindows.dispose()
    unmountShellView()
    if (!shellView.webContents.isDestroyed()) shellView.webContents.close()
  })
  window.on('closed', () => {
    onClosed()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void shellView.webContents.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void shellView.webContents.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Electron's package exports no runtime app object under Vitest; keep IPC registration importable.
/**
 * The panel asset scheme. A panel's only file channel was `app.data.read`, a utf8 log-tail
 * reader capped at 512 KiB — fine for JSONL shards, wrong for bytes, and an image squeezed
 * through it as base64 is both mangled and needlessly capped. This scheme streams a
 * declared data file straight into an `<img>`/`<video>` instead.
 *
 * `standard` gives it an origin so it is subject to the normal same-origin rules rather
 * than being an opaque one-off; `secure` keeps it out of mixed-content blocking;
 * `supportFetchAPI` + `stream` let a panel `fetch()` or stream large media. It does NOT
 * get `bypassCSP` or `allowServiceWorkers`: the point is to move bytes, not to widen what
 * a panel may execute.
 */
export const PANEL_ASSET_SCHEME = 'pipiui-asset'

if (protocol?.registerSchemesAsPrivileged) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PANEL_ASSET_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ])
}

if (app) {
  // `Electron/product.json` (or PIPIUI_PRODUCT_CONFIG for a downstream product) is the only
  // place the app's identity — display name, userData directory, default product pack,
  // shared-credentials directory — comes from. The core never hardcodes one product.
  const product = loadProductIdentity({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    dirname: __dirname,
    env: process.env
  })
  // Overriding the process name so Dock / About / menus show the product's display name also
  // changes Electron's default userData folder, so pin it back to the product's own directory
  // immediately — setName must never be allowed to move userData implicitly.
  app.setName(product.name)
  app.setPath('userData', join(app.getPath('appData'), product.userDataDirname))
  app.whenReady().then(async () => {
    // A packaged build gets its icon from the app bundle. A product running from a base
    // checkout has no bundle of its own, so the dock icon is the only place its identity
    // shows while it is unpackaged; without this every product is a generic Electron icon.
    if (product.icon && app.dock) {
      const icon = nativeImage.createFromPath(product.icon)
      if (icon.isEmpty()) console.warn(`[pipiui] product icon unreadable: ${product.icon}`)
      else app.dock.setIcon(icon)
    }
    const browserDebugPath = process.env.PIPIUI_BROWSER_NATIVE_DEBUG
    let browserDebugCaptureSequence = 0
    if (browserDebugPath) {
      writeFileSync(browserDebugPath, '')
      installBrowserNativeTrace(entry => appendFileSync(browserDebugPath, `${JSON.stringify(entry)}\n`))
    }
    // Each browser session owns one real target-site WebContentsView per
    // viewport: desktop embeds in the IDE split and mobile lives in its child
    // window. Both views share the session partition and synchronized tab URL.
    const browser = new BrowserSessionHost(options => {
      const view = new WebContentsView(options)
      if (browserDebugPath) view.setBackgroundColor('#ff00ff')
      if (browserDebugPath) {
        view.webContents.on('did-stop-loading', () => {
          void view.webContents.capturePage(undefined, { stayHidden: true }).then(image => {
            writeFileSync(`${browserDebugPath}.capture-${++browserDebugCaptureSequence}.png`, image.toPNG())
          }).catch(error => appendFileSync(browserDebugPath, `${JSON.stringify({ timestamp: Date.now(), stage: 'capture:error', error: String(error) })}\n`))
        })
      }
      // The default UA advertises "PipiUI/… Electron/…" tokens; some sites
      // (e.g. DuckDuckGo's HTML search endpoint) answer such framework UAs with
      // bot-challenge pages instead of content. Keep the standard Chrome tokens only.
      view.webContents.session.setUserAgent(
        view.webContents.getUserAgent().replace(/\s*[\w ]*Electron\/[\d.]+/g, '')
      )
      return view
    }, { certificateErrorApp: app })
    const watchCallbacks = new BrowserWatchCallbackRegistry()
    browser.setWatchTrigger((watch, reason, pageSummary) => {
      void watchCallbacks.deliver(watch.sessionKey, {
        watchId: watch.watchId,
        reason,
        waitedMs: Date.now() - watch.createdAt,
        url: pageSummary.url,
        title: pageSummary.title,
      })
    })
    const userData = app.getPath('userData')
    const piProcessEnv = await resolveSystemProxyEnvironment(url => app.resolveProxy(url), process.env)
    const assets = resolveRuntimeAssets({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      dirname: __dirname,
      env: piProcessEnv,
      userData
    })
    // Source profiles stay repo-local; packaged profiles live outside immutable resources.
    const runtimeRoot = assets.runtimeRoot
    const piProfile = {
      agentDir: assets.agentDir,
      sessionsRoot: assets.sessionsRoot
    }
    // Preserve the canonical model and credential files; only explicit UI edits may change them.
    const modelsWriteQueue = createCanonicalModelsWriteQueue()
    const profileInstall = installRuntimeProfile(assets, piProcessEnv)
    // The constructor's first extension scan must see the installed UI and provider manifests.
    await profileInstall
    // Runtime tree install overlaps with window load and the first list-models load.
    // It is a warm-up only: refreshRuntimeTree re-runs it before every spawn.
    void Promise.resolve().then(() => {
      const reinstall = installRuntimeTree(assets, runtimeRoot)
      if (reinstall.installed.length)
        console.info(`[pipi-install] refreshed ${reinstall.installed.length} runtime asset(s) under ${runtimeRoot}`)
      for (const failure of reinstall.failures) console.warn(`[pipi-install] ${failure}`)
    })
    const terminalHost = new TerminalSessionHost()
    const quotaStore = new QuotaStore(process.env, { agentDir: piProfile.agentDir })
    const piBackend = createPiHostBackend({
      piCommand: assets.piCommand,
      env: {...piProcessEnv, ...assets.piCommand?.env},
      authNodePath: assets.authNodePath,
      managedNodeModulesRoot: assets.managedNodeModulesRoot,
      cocRuntime: assets.cocRuntime,
      browserAction: (request, sessionId) => browser.toolAction(sessionId, request as any),
      browserWatch: (request, sessionId) => handleBrowserWatchEvent(request, sessionId, browser, watchCallbacks),
      terminalAction: (request, sessionId) => terminalHost.toolAction(sessionId, request as any),
      terminalSessionDeleted: sessionId => terminalHost.disposeSession(sessionId),
      authHelperPath: assets.sourceRoot ? join(assets.sourceRoot, 'auth', 'pi-auth-helper.mjs') : undefined,
      runtimeRoot,
      agentDir: piProfile.agentDir,
      vaultDir: piProfile.agentDir,
      sessionsRoot: piProfile.sessionsRoot,
      canonicalModelsWrite: modelsWriteQueue,
      profileInitialization: profileInstall,
      defaultPack: product.defaultPack,
      product: { id: product.id, name: product.name, agentMaxDepth: product.agentMaxDepth },
      sharedProfileDir: piProfile.agentDir,
      profileMode: 'default',
      resourceMode: 'explicit',
      quotaStore,
      // Refreshed again before every spawn, so editing a philosophy layer or a subagent file
      // reaches the next session without relaunching the app.
      runtimeAssets: assets,
      revealPath: async (path) => {
        const error = await shell.openPath(path)
        if (error.trim()) throw new Error(error)
      },
      // Versioned Host Capability API: extensions reach native hosts only through
      // this gated broker (hostApi handshake + per-project permission + one-time token).
      hostCapabilityAction: (request, sessionId) => hostCapability.dispatch(request, sessionId),
      hostCapabilityTokenAction: (request) => hostCapability.mint(request),
    })
    // Safe TDZ-forward reference: the arrow above only runs once bridge traffic
    // arrives, long after this binding. Declared permissions resolve lazily from
    // the bundled/app extension snapshot; project grants come from the project's
    // own `.pi/agent/ext-grants.json` — both fail closed.
    const hostCapability = createElectronHostCapabilityBroker({
      browser,
      browserWatch: (request, sessionId) => handleBrowserWatchEvent(request, sessionId, browser, watchCallbacks),
      policy: {
        declaredPermissions: async (extensionId) =>
          (await piBackend.listBundledUpdateExtensions()).find(item => item.id === extensionId)?.permissions ?? [],
        projectAllows: async (extensionId, projectRoot, permission) => {
          try {
            const grants = await readProjectExtensionGrants(projectPiAgentDir(projectRoot))
            return grants[extensionId]?.grantedCapabilities.includes(permission) ?? false
          } catch {
            return false
          }
        },
      },
    })
    // The byte channel for panels. Same two gates as `app.data.read` (installed for the
    // project, path under a declared root); this only changes the transport, so a panel can
    // point an <img> at a declared file instead of squeezing base64 through a log reader.
    if (protocol?.handle) {
      protocol.handle(
        PANEL_ASSET_SCHEME,
        createPanelAssetHandler(async (extensionId, projectId, path) =>
          piBackend.readExtensionAsset(extensionId, path, projectId),
        ),
      )
    }
    const terminalBackend = terminalHost.wrapBackend(piBackend)
    const pickProjectDirectory = async (): Promise<string | null> => {
      const options: OpenDialogOptions = { title: '选择项目文件夹', buttonLabel: '选择', properties: ['openDirectory', 'createDirectory'] }
      const owner = BaseWindow.getFocusedWindow() ?? BaseWindow.getAllWindows()[0]
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : result.filePaths[0] ?? null
    }
    const pickProductPackArchive = async (): Promise<string | null> => {
      const options: OpenDialogOptions = {
        title: '加载扩展包 ZIP',
        buttonLabel: '加载',
        properties: ['openFile'],
        filters: [{ name: 'PipiUI 扩展包', extensions: ['zip'] }],
      }
      const owner = BaseWindow.getFocusedWindow() ?? BaseWindow.getAllWindows()[0]
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : result.filePaths[0] ?? null
    }
    const saveProductPackArchive = async (suggestedName: string): Promise<string | null> => {
      const leaf = basename(suggestedName.trim()) || 'pipiui-extension-pack.zip'
      const defaultPath = leaf.toLowerCase().endsWith('.zip') ? leaf : `${leaf}.zip`
      const options: SaveDialogOptions = {
        title: '导出扩展包 ZIP',
        buttonLabel: '导出',
        defaultPath,
        filters: [{ name: 'PipiUI 扩展包', extensions: ['zip'] }],
      }
      const owner = BaseWindow.getFocusedWindow() ?? BaseWindow.getAllWindows()[0]
      const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
      return result.canceled ? null : result.filePath ?? null
    }
    // The host's own runtime, and nothing else. Build tooling (vite, electron-vite) does
    // not exist in a packaged product, and a managed npm package belongs to the extension
    // that bundles it — listing either here offered a product updates for things it does
    // not run, and for extensions it does not have installed. Extension-owned components
    // arrive below, from the manifests of the extensions actually present.
    const updateCatalog: UpdateCatalogItem[] = [
      { id: 'electron', name: 'Electron', category: 'platform', currentVersion: process.versions.electron ?? UPDATE_CENTER_FRAMEWORK_VERSIONS.electron, source: { type: 'npm', packageName: 'electron' } },
      { id: 'node', name: 'Node.js 内置 Pi 运行时', category: 'runtime', currentVersion: EMBEDDED_NODE_VERSION, source: { type: 'nodeDist' } },
      { id: PI_RUNTIME_PACKAGE, name: 'Pi', category: 'runtime', currentVersion: UPDATE_CENTER_RUNTIME_PACKAGE_VERSIONS[PI_RUNTIME_PACKAGE], source: { type: 'npm', packageName: PI_RUNTIME_PACKAGE } },
    ]
    // The fixed catalog above holds only platform/runtime/toolchain rows. Every extension-owned
    // component is discovered per check from bundled (builtin/app) extension manifests
    // (`updateComponents`) and contributes namespaced items on top of the fixed catalog. Discovery is a read-only snapshot (never a rescan,
    // so the active project's loaded extensions and context stay untouched); checks are read-only
    // lookups at fixed registries. Discovery failures degrade to the fixed catalog and never
    // affect extension function.
    const resolveUpdateCatalog = async (): Promise<readonly UpdateCatalogItem[]> => {
      try {
        const listed = await piBackend.listBundledUpdateExtensions()
        return [...updateCatalog, ...extensionUpdateCatalogItems(listed)]
      } catch {
        return updateCatalog
      }
    }
    const backend = withUpdateCenter(withProductPackFileDialogs(withProjectDirectoryPicker(withOpenDocumentExternally(withOpenExternal(withBrowserTabsHost(terminalBackend, browser), url => shell.openExternal(url)), path => shell.openPath(path)), pickProjectDirectory), { pickArchive: pickProductPackArchive, saveArchive: saveProductPackArchive }), createUpdateCenterService({ catalog: resolveUpdateCatalog }), (extensionId, componentId) => piBackend.updateExtensionComponent(extensionId, componentId))
    registerPipiHostIpc(ipcMain, backend)
    const remoteControl = createRemoteControlService({
      backend,
      userDataDir: userData,
      relayOrigin: process.env.PIPIUI_RELAY_ORIGIN || 'https://remote.deepwood.cn'
    })
    const remoteDebug = createRemoteDebugService({
      backend,
      staticDir: resolveRemoteDebugStaticDir({
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath
      })
    })
    registerRemoteControlIpc(
      ipcMain,
      remoteControl,
      PIPI_REMOTE_CONTROL_IPC_CHANNEL,
      PIPI_REMOTE_CONTROL_EVENT_CHANNEL,
      remoteDebug
    )
    void remoteControl.restore()
    let appQuitting = false
    app.on('before-quit', () => {
      appQuitting = true
      void remoteDebug.close()
    })
    createWindow(browser, () => terminalHost.closeAll(), product.name, join(piProfile.agentDir, FREEZE_PROBE_FILE), () => appQuitting)
    // Capability is the first models-write job. Isolated backend init then migrates
    // project catalogs and refreshes the model catalog; do not refresh here or the
    // UI can observe pre-migration canonical state.
    installOwnedRuntimeShutdown(app, terminalHost, piBackend)
    app.on('activate', () => {
      if (BaseWindow.getAllWindows().length === 0) {
        createWindow(browser, () => terminalHost.closeAll(), product.name, join(piProfile.agentDir, FREEZE_PROBE_FILE), () => appQuitting)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
