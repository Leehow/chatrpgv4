import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canViewSetupHistory,
  setupHistoryDescription,
  setupHistoryTitle,
} from "./setup-history.ts";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

test("建卡记录 button is only for an already-opened play session", () => {
  assert.equal(canViewSetupHistory({ hasSession: false, sessionRole: "play" }), false);
  assert.equal(canViewSetupHistory({
    hasSession: true,
    sessionRole: "setup",
    setupPending: true,
  }), false);
  assert.equal(canViewSetupHistory({
    hasSession: true,
    sessionRole: "setup",
    setupPending: false,
  }), false);
  assert.equal(canViewSetupHistory({
    hasSession: true,
    sessionRole: "play",
    setupPending: true,
  }), false);
  assert.equal(canViewSetupHistory({
    hasSession: true,
    sessionRole: "play",
    transitioning: true,
  }), false);
  assert.equal(canViewSetupHistory({
    hasSession: true,
    sessionRole: "play",
    setupPending: false,
    transitioning: false,
  }), true);
  assert.equal(canViewSetupHistory({
    hasSession: true,
    sessionRole: null,
    setupPending: false,
    transitioning: false,
  }), true);
});

test("titles stay honest when the host session has no machine boundary", () => {
  assert.equal(setupHistoryTitle("setup"), "建卡记录");
  assert.equal(setupHistoryTitle("setup_and_table_join"), "建卡及开桌衔接记录");
  assert.match(setupHistoryDescription("setup"), /只读/);
  assert.match(setupHistoryDescription("setup_and_table_join"), /未找到可靠的开桌分界/);
});

test("App header wires a 建卡记录 entry that does not reuse /transcript", () => {
  const app = fs.readFileSync(path.join(ROOT, "App.tsx"), "utf8");
  const api = fs.readFileSync(path.join(ROOT, "api.ts"), "utf8");
  assert.match(app, /showSetupHistory/);
  assert.match(app, /建卡记录/);
  assert.match(app, /SetupHistorySheet/);
  assert.match(app, /setSetupHistoryOpen\(true\)/);
  const buttonRegion = app.slice(
    app.indexOf("{showSetupHistory &&"),
    app.indexOf("<SetupHistorySheet"),
  );
  assert.match(buttonRegion, /建卡记录/);
  assert.doesNotMatch(buttonRegion, /fetchTranscript\(/);
  assert.match(api, /\/api\/sessions\/\$\{sessionId\}\/setup-transcript/);
  assert.match(api, /export function fetchSetupTranscript/);
});
