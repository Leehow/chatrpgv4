import os from "node:os";
import path from "node:path";

// Desktop app data and the writable Pi-Coc runtime home are intentionally
// separate. The former may live under App Support; source/dev Pi-Coc always
// writes under the selected repository.

export const DESKTOP_APP_DIR_NAME = "coc-keeper-desktop";

export function defaultDesktopUserData({
  platform = process.platform,
  home = os.homedir(),
  appData = process.env.APPDATA,
  xdgConfig = process.env.XDG_CONFIG_HOME,
} = {}) {
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", DESKTOP_APP_DIR_NAME);
  }
  if (platform === "win32") {
    return path.join(appData || path.join(home, "AppData", "Roaming"), DESKTOP_APP_DIR_NAME);
  }
  return path.join(xdgConfig || path.join(home, ".config"), DESKTOP_APP_DIR_NAME);
}

export function resolveProductUserData({
  userData = process.env.COC_DESKTOP_USER_DATA,
  ...rest
} = {}) {
  const explicit = String(userData || "").trim();
  if (explicit) return explicit;
  return defaultDesktopUserData(rest);
}

export function resolveProductAgentDir({
  agentDir = process.env.PI_AGENT_DIR,
  userData,
  ...rest
} = {}) {
  const explicit = String(agentDir || "").trim();
  if (explicit) return explicit;
  return path.join(resolveProductUserData({ userData, ...rest }), "pi-agent");
}

export function resolvePiCocAgentDir({ repoRoot } = {}) {
  const root = String(repoRoot || "").trim();
  if (!root) throw new Error("repoRoot is required to resolve the Pi-Coc agent home");
  return path.join(path.resolve(root), ".pi", "coc-agent");
}

/** Dirs where a pi-coc host may have written sessions.
 *  Repo-local Pi-Coc first, then legacy desktop and `{workspace}/.pi/agent`
 *  (repo-root `node server.mjs --workspace .` historically wrote there because
 *  Pi defaults to cwd/.pi/agent when the child env is not pinned). */
export function resolveHostedSessionAgentDirs({
  repoRoot,
  workspace,
  agentDir = process.env.PI_AGENT_DIR,
  userData,
  ...rest
} = {}) {
  const dirs = [];
  const push = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return;
    const resolved = path.resolve(raw);
    if (!dirs.includes(resolved)) dirs.push(resolved);
  };
  if (String(repoRoot || "").trim()) {
    push(resolvePiCocAgentDir({ repoRoot }));
  }
  push(resolveProductAgentDir({ agentDir, userData, ...rest }));
  const ws = String(workspace || "").trim();
  if (ws) push(path.join(path.resolve(ws), ".pi", "agent"));
  return dirs;
}

/**
 * Desktop settings stay next to the app-owned pi-agent dir.
 * An explicit terminal PI_AGENT_DIR (~/.pi/agent) is not a write target.
 */
export function resolveProductSettingsPath({
  settingsPath = process.env.COC_DESKTOP_SETTINGS,
  userData = process.env.COC_DESKTOP_USER_DATA,
  agentDir = process.env.PI_AGENT_DIR,
  ...rest
} = {}) {
  const explicit = String(settingsPath || "").trim();
  if (explicit) return explicit;
  const data = String(userData || "").trim();
  if (data) return path.join(data, "coc-desktop-settings.json");
  const dir = String(agentDir || "").trim();
  if (dir && path.basename(dir) === "pi-agent") {
    return path.join(path.dirname(dir), "coc-desktop-settings.json");
  }
  if (dir) return null;
  return path.join(resolveProductUserData({ ...rest }), "coc-desktop-settings.json");
}

/** Arm app-owned data only. Pi-Coc children pin their repo-local home. */
export function armProductAgentEnv(env = process.env) {
  const userData = resolveProductUserData({
    userData: env.COC_DESKTOP_USER_DATA,
  });
  const agentDir = resolveProductAgentDir({
    agentDir: env.PI_AGENT_DIR,
    userData,
  });
  if (!(env.COC_DESKTOP_USER_DATA || "").trim()) env.COC_DESKTOP_USER_DATA = userData;
  if (!(env.PI_AGENT_DIR || "").trim()) env.PI_AGENT_DIR = agentDir;
  return { userData: env.COC_DESKTOP_USER_DATA, agentDir: env.PI_AGENT_DIR };
}
