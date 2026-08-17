import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import {
  DESKTOP_APP_DIR_NAME,
  armProductAgentEnv,
  defaultDesktopUserData,
  resolveProductAgentDir,
  resolveProductSettingsPath,
} from "../agent-dir.mjs";

const home = os.homedir();
const terminalAgent = path.join(home, ".pi", "agent");
const desktopUserData = defaultDesktopUserData();
const desktopAgent = path.join(desktopUserData, "pi-agent");

test("default userData matches Electron app.getPath('userData') layout", () => {
  assert.equal(
    defaultDesktopUserData({ platform: "darwin", home: "/Users/ada" }),
    path.join("/Users/ada", "Library", "Application Support", DESKTOP_APP_DIR_NAME),
  );
  assert.equal(
    defaultDesktopUserData({ platform: "linux", home: "/home/ada", xdgConfig: "" }),
    path.join("/home/ada", ".config", DESKTOP_APP_DIR_NAME),
  );
  assert.equal(
    defaultDesktopUserData({ platform: "win32", home: "C:\\Users\\ada", appData: "C:\\Users\\ada\\AppData\\Roaming" }),
    path.join("C:\\Users\\ada\\AppData\\Roaming", DESKTOP_APP_DIR_NAME),
  );
});

test("unset env uses the desktop pi-agent, never ~/.pi/agent", () => {
  assert.equal(resolveProductAgentDir({ agentDir: "", userData: "" }), desktopAgent);
  assert.notEqual(resolveProductAgentDir({ agentDir: "", userData: "" }), terminalAgent);
  assert.equal(
    resolveProductSettingsPath({ settingsPath: "", userData: "", agentDir: "" }),
    path.join(desktopUserData, "coc-desktop-settings.json"),
  );
});

test("explicit PI_AGENT_DIR and userData still win", () => {
  assert.equal(resolveProductAgentDir({ agentDir: "/tmp/override/pi-agent" }), "/tmp/override/pi-agent");
  assert.equal(
    resolveProductAgentDir({ agentDir: "", userData: "/tmp/qa-data" }),
    path.join("/tmp/qa-data", "pi-agent"),
  );
  assert.equal(
    resolveProductSettingsPath({ userData: "/tmp/qa-data" }),
    path.join("/tmp/qa-data", "coc-desktop-settings.json"),
  );
});

test("a terminal ~/.pi/agent override is not a settings write target", () => {
  assert.equal(resolveProductSettingsPath({ agentDir: terminalAgent, userData: "" }), null);
});

test("armProductAgentEnv fills only missing keys", () => {
  const env = {};
  const armed = armProductAgentEnv(env);
  assert.equal(armed.agentDir, desktopAgent);
  assert.equal(env.PI_AGENT_DIR, desktopAgent);
  assert.equal(env.PI_CODING_AGENT_DIR, desktopAgent);
  assert.equal(env.COC_DESKTOP_USER_DATA, desktopUserData);

  const kept = { PI_AGENT_DIR: "/tmp/keep/pi-agent", COC_DESKTOP_USER_DATA: "/tmp/keep" };
  armProductAgentEnv(kept);
  assert.equal(kept.PI_AGENT_DIR, "/tmp/keep/pi-agent");
  assert.equal(kept.PI_CODING_AGENT_DIR, "/tmp/keep/pi-agent");
  assert.equal(kept.COC_DESKTOP_USER_DATA, "/tmp/keep");
});
