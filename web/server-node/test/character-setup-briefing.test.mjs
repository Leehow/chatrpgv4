import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  BRIEFING_MAX_BYTES,
  readCharacterSetupBriefing,
} from "../character-setup-briefing.mjs";

function makeCampaign(workspace, campaignId, {
  title,
  briefingRel,
  briefingStoredPath,
  briefingBody,
  extraJson,
} = {}) {
  const root = path.join(workspace, ".coc", "campaigns", campaignId);
  fs.mkdirSync(path.join(root, "assets", "character-creation"), { recursive: true });
  const fileRel = briefingRel
    || path.join("assets", "character-creation", "scenario-briefing.md");
  if (briefingBody != null) {
    fs.writeFileSync(path.join(root, fileRel), briefingBody);
  }
  const stored = briefingStoredPath ?? fileRel;
  fs.writeFileSync(
    path.join(root, "campaign.json"),
    JSON.stringify({
      title: title || "Test Module",
      character_creation: briefingBody != null || extraJson || briefingStoredPath
        ? { briefing_path: stored, ...extraJson }
        : {},
    }),
  );
  return root;
}

test("readCharacterSetupBriefing loads an in-campaign briefing", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-brief-"));
  try {
    makeCampaign(workspace, "am-1", {
      title: "永不凋谢",
      briefingBody: "1920s Boston salon. Player-safe hooks only.\n",
    });
    const got = readCharacterSetupBriefing({ workspace, campaignId: "am-1" });
    assert.equal(got.title, "永不凋谢");
    assert.match(got.briefingText, /1920s Boston/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("readCharacterSetupBriefing rejects a path outside the campaign dir", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-brief-"));
  try {
    const root = makeCampaign(workspace, "am-2", { briefingBody: "inside" });
    const escape = path.join(workspace, "secret.md");
    fs.writeFileSync(escape, "LEAK");
    fs.writeFileSync(
      path.join(root, "campaign.json"),
      JSON.stringify({
        title: "X",
        character_creation: { briefing_path: path.join("..", "..", "..", "secret.md") },
      }),
    );
    const got = readCharacterSetupBriefing({ workspace, campaignId: "am-2" });
    assert.equal(got.briefingText, "");
    assert.equal(got.title, "X");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("readCharacterSetupBriefing silently degrades when campaign.json is missing", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-brief-"));
  try {
    const got = readCharacterSetupBriefing({ workspace, campaignId: "missing" });
    assert.deepEqual(got, { briefingText: "", title: "", campaignId: "missing" });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("readCharacterSetupBriefing caps briefing length", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-brief-"));
  try {
    makeCampaign(workspace, "am-3", {
      briefingBody: "A".repeat(BRIEFING_MAX_BYTES + 800),
    });
    const got = readCharacterSetupBriefing({ workspace, campaignId: "am-3" });
    assert.equal(got.briefingText.length, BRIEFING_MAX_BYTES);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("readCharacterSetupBriefing loads a production workspace-relative briefing_path", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-brief-"));
  try {
    makeCampaign(workspace, "am-4", {
      title: "永不凋谢",
      briefingBody: "Workspace-relative hook text.\n",
      briefingStoredPath:
        ".coc/campaigns/am-4/assets/character-creation/scenario-briefing.md",
    });
    const got = readCharacterSetupBriefing({ workspace, campaignId: "am-4" });
    assert.equal(got.title, "永不凋谢");
    assert.match(got.briefingText, /Workspace-relative hook/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("readCharacterSetupBriefing rejects workspace-relative sibling campaign path", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-brief-"));
  try {
    makeCampaign(workspace, "am-5", { briefingBody: "own" });
    makeCampaign(workspace, "sibling", {
      briefingBody: "SIBLING LEAK",
    });
    const root = path.join(workspace, ".coc", "campaigns", "am-5");
    fs.writeFileSync(
      path.join(root, "campaign.json"),
      JSON.stringify({
        title: "X",
        character_creation: {
          briefing_path:
            ".coc/campaigns/sibling/assets/character-creation/scenario-briefing.md",
        },
      }),
    );
    const got = readCharacterSetupBriefing({ workspace, campaignId: "am-5" });
    assert.equal(got.briefingText, "");
    assert.equal(got.title, "X");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("readCharacterSetupBriefing rejects workspace-relative escape via ..", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-brief-"));
  try {
    const root = makeCampaign(workspace, "am-6", { briefingBody: "inside" });
    fs.writeFileSync(path.join(workspace, "secret.md"), "LEAK");
    fs.writeFileSync(
      path.join(root, "campaign.json"),
      JSON.stringify({
        title: "X",
        character_creation: {
          briefing_path: ".coc/campaigns/am-6/../../../secret.md",
        },
      }),
    );
    const got = readCharacterSetupBriefing({ workspace, campaignId: "am-6" });
    assert.equal(got.briefingText, "");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("readCharacterSetupBriefing loads an absolute path inside the campaign dir", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-brief-"));
  try {
    const root = makeCampaign(workspace, "am-7", {
      briefingBody: "Absolute inside campaign.\n",
    });
    const abs = path.join(root, "assets", "character-creation", "scenario-briefing.md");
    fs.writeFileSync(
      path.join(root, "campaign.json"),
      JSON.stringify({
        title: "Abs",
        character_creation: { briefing_path: abs },
      }),
    );
    const got = readCharacterSetupBriefing({ workspace, campaignId: "am-7" });
    assert.match(got.briefingText, /Absolute inside campaign/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
