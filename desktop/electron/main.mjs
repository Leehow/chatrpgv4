import { app, BrowserWindow, Menu, dialog, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolvePaths, buildChildEnv, nodeBinary, uvBinary, preferredPort, waitHealth } from "./env.mjs";
import { mirrorStewardAgents, ensurePythonEnv } from "./bootstrap.mjs";
import { loadSettings } from "./settings.mjs";
import { agentDirConfigured } from "./agentconfig.mjs";
import { register as registerIpc } from "./ipc.mjs";
import { buildWizardWindowOptions, existingWizardNeedsRebuild } from "./wizard-window-options.mjs";
import { buildMainWindowOptions } from "./main-window-options.mjs";
import { clearPidRecord, reapStaleBridges, writePidRecord } from "./bridge-lifecycle.mjs";
import { APP_DISPLAY_NAME, resolveAppIconPath } from "./app-icon.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The onboarding/settings wizard ships inside the single web frontend build
// (web/frontend/dist/wizard.html); the shell links to that one artifact in
// both dev (repo checkout) and packaged (resources/payload) layouts.
function wizardIndex() {
  const root = currentPaths?.payloadRoot ?? path.resolve(app.getAppPath(), "..");
  return path.join(root, "web", "frontend", "dist", "wizard.html");
}
const PRELOAD = path.join(__dirname, "preload.cjs");
const DESKTOP_ROOT = path.resolve(__dirname, "..");

function currentAppIcon() {
  return resolveAppIconPath({
    packaged: app.isPackaged,
    appDir: DESKTOP_ROOT,
  });
}

function applyDockIcon() {
  const icon = currentAppIcon();
  if (icon && process.platform === "darwin" && app.dock) {
    app.dock.setIcon(icon);
  }
}
// Click-away dismiss delay: long enough that refocusing the settings window
// (设置 button click) cancels it, short enough to feel immediate.
const PARENT_FOCUS_DISMISS_MS = 80;

let mainWindow = null;
let wizardWindow = null;
let serverChild = null;
let serverPort = 0;
let quitting = false;
let logStream = null;
let currentPaths = null;
/** PDF path picked from a native entry (menu / wizard) before the bridge is
 * up; the main window pulls it via app:consumePdfImport once mounted. */
let pendingPdfImportPath = null;

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  if (logStream) logStream.write(stamped + "\n");
}

function settingsParent() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  if (mainWindow.isMinimized()) mainWindow.restore();
  return mainWindow;
}

/**
 * Open the wizard/settings UI. After the main window exists, settings attach
 * as a parented dialog the main window's next click dismisses — a native
 * modal sheet would swallow every parent click and has no close button of
 * its own, leaving the settings trapped on screen. First-run onboarding has
 * no parent yet and stays a standalone window. `edit` (re)opens the settings
 * window with the 编辑模型 editor already open (top-bar pencil button).
 */
function openWizardWindow({ asSheet = false, edit = false } = {}) {
  const indexFile = wizardIndex();
  if (!fs.existsSync(indexFile)) {
    dialog.showErrorBox(APP_DISPLAY_NAME, `配置界面未构建：${indexFile}\n请在 web/frontend/ 下运行 npm run build`);
    return null;
  }
  const parent = asSheet ? settingsParent() : null;
  if (wizardWindow && !wizardWindow.isDestroyed()) {
    if (!existingWizardNeedsRebuild(wizardWindow, { asSheet, parent }) && !edit) {
      wizardWindow.focus();
      return wizardWindow;
    }
    wizardWindow.close();
    wizardWindow = null;
  }
  const opts = buildWizardWindowOptions({ asSheet, parent, edit, icon: currentAppIcon() });
  const { loadQuery, ...windowOpts } = opts;
  wizardWindow = new BrowserWindow({
    ...windowOpts,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD,
    },
  });
  const win = wizardWindow;
  // Click-away dismiss: a beat after the main window regains focus, close
  // the settings dialog. Refocusing it within that beat (e.g. the in-app
  // 设置 button while it is already open) cancels the pending close. Focus
  // events that arrive before the wizard itself ever gained focus are app
  // activation settling (e.g. after a menu-open), not a click-away — ignoring
  // them keeps the freshly opened settings from instantly closing itself.
  let wizardHadFocus = false;
  let dismissTimer = null;
  const cancelDismiss = () => {
    if (dismissTimer) clearTimeout(dismissTimer);
    dismissTimer = null;
  };
  const dismiss = () => {
    if (!wizardHadFocus) return;
    cancelDismiss();
    dismissTimer = setTimeout(() => {
      dismissTimer = null;
      if (wizardWindow === win && !win.isDestroyed()) win.close();
    }, PARENT_FOCUS_DISMISS_MS);
  };
  if (parent) parent.on("focus", dismiss);
  win.on("focus", () => {
    wizardHadFocus = true;
    cancelDismiss();
  });
  win.on("closed", () => {
    cancelDismiss();
    if (parent) parent.removeListener("focus", dismiss);
    // Guarded so a rebuilt window's own "closed" cannot null a newer one.
    if (wizardWindow === win) wizardWindow = null;
  });
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });
  win.loadFile(indexFile, { query: loadQuery });
  return win;
}

function openSettingsWindow(opts) {
  return openWizardWindow({ asSheet: true, ...opts });
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    ...buildMainWindowOptions({ icon: currentAppIcon() }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload-main.cjs"),
    },
  });
  // The bridge is the only origin this window should ever show; everything
  // else (handout links, model docs, anything external) goes to the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(`http://127.0.0.1:${serverPort}/`)) {
      event.preventDefault();
      if (/^https?:/i.test(target)) shell.openExternal(target);
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  if (url) mainWindow.loadURL(url);
  return mainWindow;
}

function spawnServer(paths, env) {
  const nodeBin = nodeBinary(paths);
  // detached: own process group — on quit we SIGTERM the whole tree so warm
  // keeper workers and MCP children do not outlive the app (the bridge only
  // kills its direct sidecar child).
  const child = spawn(
    nodeBin,
    [paths.serverMjs, "--workspace", paths.workspace, "--port", String(serverPort)],
    { cwd: paths.workspace, env, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  const take = (stream, prefix) => {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      for (const line of chunk.split("\n")) {
        if (line.trim()) log(`${prefix} ${line}`);
      }
    });
  };
  take(child.stdout, "[server]");
  take(child.stderr, "[server:err]");
  child.once("exit", (code) => {
    log(`[server] exited code=${code}`);
    if (!quitting && !restarting && mainWindow) {
      log(`[fatal] bridge died; startupComplete=${startupComplete}`);
      notifyFatal({
        message: "后台服务已退出。",
        detail: `web 桥进程退出（code ${code}）。日志见 ${paths.logsDir}。`,
      });
    }
  });
  return child;
}

/**
 * Runtime fatal notice. Prefer the in-app styled modal (same look as the
 * main UI, with a self-heal "restart bridge" action); fall back to the
 * native box only before the web UI is live (boot/loading stage) — native
 * alerts are jarring next to the themed app.
 */
function notifyFatal({ message, detail }) {
  if (mainWindow && !mainWindow.isDestroyed() && startupComplete) {
    log("[fatal] showing in-app modal");
    mainWindow.webContents.send("app:fatal", { title: APP_DISPLAY_NAME, message, detail });
    return;
  }
  log("[fatal] falling back to native box");
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showMessageBoxSync(mainWindow, {
      type: "error",
      title: APP_DISPLAY_NAME,
      message,
      detail,
      buttons: ["退出"],
    });
  } else {
    dialog.showErrorBox(APP_DISPLAY_NAME, `${message}\n${detail || ""}`);
  }
  app.quit();
}

function rememberBridgePid(paths) {
  if (!paths || !serverChild?.pid) return;
  writePidRecord(paths.userData, {
    workspace: paths.workspace,
    pid: serverChild.pid,
    port: serverPort,
  });
}

function killServerTree() {
  if (currentPaths) {
    try {
      clearPidRecord(currentPaths.userData);
    } catch {
      // pid file is bookkeeping only
    }
  }
  if (!serverChild) return Promise.resolve();
  const child = serverChild;
  serverChild = null;
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    try {
      // Negative pid = process group; takes down bridge, sidecar, warm
      // keeper workers, and MCP children in one signal.
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    setTimeout(resolve, 4000);
  });
}

let restarting = false;
// Zero windows are expected during startup (wizard gate, bridge boot):
// closing the onboarding wizard must resolve the gate and continue, not
// trigger window-all-closed quit. start() quits on its own failures.
let startupComplete = false;

async function restartBridge() {
  if (!currentPaths) return { ok: false, error: "not started" };
  restarting = true;
  log("[restart] stopping bridge");
  await killServerTree();
  serverPort = await preferredPort();
  log(`[restart] bridge port=${serverPort}`);
  serverChild = spawnServer(currentPaths, buildChildEnv(currentPaths));
  rememberBridgePid(currentPaths);
  const healthy = await waitHealth(serverPort, 60_000);
  restarting = false;
  if (!healthy) return { ok: false, error: "health timeout" };
  if (mainWindow) await mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);
  log("[restart] bridge healthy");
  return { ok: true };
}

/** First-run onboarding gate; resolves when the wizard window closes. */
function runWizardGate() {
  return new Promise((resolve) => {
    const win = openWizardWindow();
    if (!win) {
      resolve();
      return;
    }
    win.once("closed", () => resolve());
  });
}

/**
 * Native「导入 PDF 模组…」entry shared by the app menu and the wizard button.
 * The shell can only produce a filesystem path, never a browser File object —
 * the main window hands the path to the bridge's /api/uploads/pdf/from-path
 * endpoint and the standard ingest chain takes over from there. The path is
 * always staged; when the main window is live it is also pushed, and the
 * renderer clears the staged copy after consuming it (pull covers pushes that
 * arrive before React mounts).
 */
async function importPdfViaDialog() {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : wizardWindow;
  const opts = {
    title: "导入 PDF 模组",
    properties: ["openFile"],
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  };
  const picked = parent
    ? await dialog.showOpenDialog(parent, opts)
    : await dialog.showOpenDialog(opts);
  const pickedPath = picked.canceled ? "" : picked.filePaths[0] || "";
  if (!pickedPath) return { ok: true, canceled: true };
  pendingPdfImportPath = pickedPath;
  const filename = path.basename(pickedPath);
  if (mainWindow && !mainWindow.isDestroyed() && startupComplete) {
    mainWindow.webContents.send("app:importPdf", { path: pickedPath });
    mainWindow.focus();
    return { ok: true, path: pickedPath, filename, delivered: true };
  }
  return { ok: true, path: pickedPath, filename, staged: true };
}

function consumePdfImport() {
  const pickedPath = pendingPdfImportPath;
  pendingPdfImportPath = null;
  return { path: pickedPath };
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "设置…",
          accelerator: "CmdOrCtrl+,",
          click: () => openSettingsWindow(),
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "文件",
      submenu: [
        {
          label: "导入 PDF 模组…",
          accelerator: "CmdOrCtrl+O",
          click: () => void importPdfViaDialog(),
        },
      ],
    },
    { role: "editMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function start() {
  applyDockIcon();
  buildMenu();
  const settings = loadSettings();
  const paths = resolvePaths();
  currentPaths = paths;
  fs.mkdirSync(paths.workspace, { recursive: true });
  fs.mkdirSync(paths.logsDir, { recursive: true });
  logStream = fs.createWriteStream(path.join(paths.logsDir, "desktop.log"), { flags: "a" });

  log(`mode=${paths.packaged ? "packaged" : "dev"} payload=${paths.payloadRoot}`);
  log(`workspace=${paths.workspace} agentDir=${paths.agentDir}`);

  mirrorStewardAgents(paths.payloadRoot, paths.workspace, log);

  // First-run gate: a fresh install has no playable provider configured.
  if (!settings.onboarded && !agentDirConfigured(paths.agentDir)) {
    log("first run: opening onboarding wizard");
    await runWizardGate();
  }

  const env = buildChildEnv(paths);

  if (paths.packaged) {
    log("[bootstrap] uv sync --frozen (first run may take a moment)");
    await ensurePythonEnv({ uvBin: uvBinary(paths), payloadRoot: paths.payloadRoot, env }, log);
  }

  const reaped = reapStaleBridges({
    userData: paths.userData,
    workspace: paths.workspace,
    log,
  });
  if (reaped.killed.length) {
    log(`[bootstrap] reaped stale bridge pids=${reaped.killed.join(",")}`);
  }

  serverPort = await preferredPort();
  log(`bridge port=${serverPort}`);
  serverChild = spawnServer(paths, env);
  rememberBridgePid(paths);

  const win = createWindow(`file://${path.join(__dirname, "loading.html")}`);
  const healthy = await waitHealth(serverPort);
  if (!healthy) {
    log("bridge health check failed");
    if (!quitting && mainWindow) {
      dialog.showMessageBoxSync(mainWindow, {
        type: "error",
        title: APP_DISPLAY_NAME,
        message: "后台服务启动超时。",
        detail: `http://127.0.0.1:${serverPort}/api/health 未就绪。日志见 ${paths.logsDir}。`,
        buttons: ["退出"],
      });
      app.quit();
    }
    return;
  }
  log("bridge healthy; loading UI");
  if (!mainWindow) return; // window closed during startup
  await win.loadURL(`http://127.0.0.1:${serverPort}/`);
  startupComplete = true;
}

app.setName(APP_DISPLAY_NAME);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  registerIpc({
    getPaths: () => currentPaths,
    restartBridge,
    openSettings: openSettingsWindow,
    pickPdfImport: importPdfViaDialog,
    consumePdfImport,
    notifyProviderList: (hidden) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("app:hiddenProviders", { hidden });
      }
    },
    notifyModelsChanged: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("app:modelsChanged", {});
      }
    },
  });

  app.whenReady().then(start).catch((err) => {
    console.error(err);
    dialog.showErrorBox(`${APP_DISPLAY_NAME} 启动失败`, String(err?.stack || err));
    app.quit();
  });

  app.on("window-all-closed", () => {
    if (startupComplete) app.quit();
  });

  app.on("activate", () => {
    if (!mainWindow && serverPort) {
      createWindow(`http://127.0.0.1:${serverPort}/`);
    }
  });

  app.on("before-quit", () => {
    quitting = true;
    if (currentPaths) {
      try {
        clearPidRecord(currentPaths.userData);
      } catch {
        // pid file is bookkeeping only
      }
    }
    if (serverChild) {
      try {
        // Negative pid = process group; takes down bridge, sidecar, warm
        // keeper workers, and MCP children in one signal.
        process.kill(-serverChild.pid, "SIGTERM");
      } catch {
        serverChild.kill("SIGTERM");
      }
      serverChild = null;
    }
  });
}
