import os from "node:os";
import path from "node:path";

// One agent home for the web UI and the Electron shell. Matches
// desktop/electron/env.mjs: <userData>/pi-agent. Never falls back to the
// terminal coding-agent home ~/.pi/agent.

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

/** Arm the process env so pi-coc children inherit the same agent home. */
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
  if (!(env.PI_CODING_AGENT_DIR || "").trim()) env.PI_CODING_AGENT_DIR = env.PI_AGENT_DIR;
  return { userData: env.COC_DESKTOP_USER_DATA, agentDir: env.PI_AGENT_DIR };
}
