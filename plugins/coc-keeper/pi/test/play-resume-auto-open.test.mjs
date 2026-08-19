#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const domainUrl = pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/domain-tools.ts"),
).href;
const welcomeUrl = pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/welcome.ts"),
).href;

async function loadDomain() {
  return import(`${domainUrl}?t=${Date.now()}-${Math.random()}`);
}

async function loadWelcome() {
  return import(`${welcomeUrl}?t=${Date.now()}-${Math.random()}`);
}

test("awaiting_player plus existing table_opening satisfies play auto-open", async () => {
  const mod = await loadDomain();
  const campaignId = "played-auto-open";
  const probeRoot = mkdtempSync(path.join(tmpdir(), "pi-coc-play-auto-open-"));
  mkdirSync(path.join(probeRoot, ".coc", "campaigns", campaignId, "logs"), {
    recursive: true,
  });
  writeFileSync(
    path.join(probeRoot, ".coc", "campaigns", campaignId, "logs", "table-transcript.jsonl"),
    `${JSON.stringify({ role: "keeper", turn: 5 })}\n`,
  );
  assert.equal(mod.resumeSatisfiesPlayAutoOpen({
    ok: true,
    tool: "session.resume",
    data: {
      mode: "awaiting_player",
      campaign_id: campaignId,
      evidence: { table_opening: { text: "既有开场" } },
      next_operations: ["interpret_current_player_message"],
      checkpoint: { turn_number: 5 },
    },
  }, { workspaceRoot: probeRoot, campaignId }), true);
  assert.equal(mod.resumeSatisfiesPlayAutoOpen({
    data: { mode: "table_opening", next_operations: ["evidence.table_opening"] },
  }), false);
  assert.equal(mod.resumeSatisfiesPlayAutoOpen({
    data: {
      mode: "awaiting_player",
      next_operations: ["evidence.table_opening"],
    },
  }), false);
});

test("play-role auto-open does not triggerTurn when resume already awaits player", async () => {
  const welcome = await loadWelcome();
  assert.equal(welcome.tableOpenShouldTriggerTurn({
    intent: "continue",
    resumeSatisfied: true,
  }), false);
  assert.equal(welcome.tableOpenShouldTriggerTurn({
    intent: "character-setup",
    resumeSatisfied: true,
  }), true);
  assert.equal(welcome.tableOpenShouldTriggerTurn({
    intent: "continue",
    resumeSatisfied: false,
  }), true);

  const prevAttached = process.env.COC_PI_ATTACHED_UI;
  const prevIntent = process.env.COC_PI_TABLE_INTENT;
  const prevRole = process.env.COC_PI_SESSION_ROLE;
  process.env.COC_PI_ATTACHED_UI = "1";
  process.env.COC_PI_TABLE_INTENT = "continue";
  process.env.COC_PI_SESSION_ROLE = "play";
  const sent = [];
  const fakePi = {
    registerCommand: () => {},
    sendMessage: (message, options) => {
      sent.push({ message, options });
    },
  };
  const campaignId = "web-the-haunting-qs-msyt48g3";
  const playedRoot = mkdtempSync(path.join(tmpdir(), "pi-coc-welcome-played-"));
  mkdirSync(path.join(playedRoot, ".coc", "campaigns", campaignId, "logs"), {
    recursive: true,
  });
  writeFileSync(
    path.join(playedRoot, ".coc", "campaigns", campaignId, "logs", "table-transcript.jsonl"),
    `${JSON.stringify({ role: "keeper", turn: 5 })}
`,
  );
  const handler = welcome.registerCocWelcome(
    fakePi,
    () => ({
      callTool: async (name) => {
        if (name === "coc_capabilities") return { ok: true };
        throw new Error(`unexpected ${name}`);
      },
    }),
    mkdtempSync(path.join(tmpdir(), "pi-coc-welcome-auto-open-")),
  );
  try {
    await handler({ reason: "startup" }, {
      cwd: playedRoot,
      mode: "rpc",
      hasUI: false,
      sessionManager: { getEntries: () => [] },
      ui: {
        setHeader: () => {},
        setStatus: () => {},
        notify: () => {},
      },
    }, campaignId);
  } finally {
    if (prevAttached === undefined) delete process.env.COC_PI_ATTACHED_UI;
    else process.env.COC_PI_ATTACHED_UI = prevAttached;
    if (prevIntent === undefined) delete process.env.COC_PI_TABLE_INTENT;
    else process.env.COC_PI_TABLE_INTENT = prevIntent;
    if (prevRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = prevRole;
  }
  const tableOpen = sent.filter((row) => (
    row.message?.customType === "coc-pi-table-open"
  ));
  assert.equal(tableOpen.length, 1);
  assert.equal(tableOpen[0].options?.triggerTurn, false);
  assert.equal(tableOpen[0].message?.details?.table_open_satisfied, true);
  assert.match(tableOpen[0].message?.content ?? "", /awaiting_player/);
});
