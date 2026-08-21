import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  isOfficialXaiKeeper,
  portraitImageCandidates,
} from "../portrait-image-prefs.ts";

const REM = 16;
const SPACE = {
  0: 0,
  0.5: 0.125 * REM,
  5: 1.25 * REM,
  6: 1.5 * REM,
  11: 2.75 * REM,
};

function parseSwitchGeometry(source) {
  const track = source.match(
    /role="switch"[\s\S]*?className=\{cn\(\s*"([^"]+)"/,
  );
  const thumb = source.match(
    /<span\s+className=\{cn\(\s*"([^"]+)",\s*vision\.enabled \? "([^"]+)" : "([^"]+)",/,
  );
  assert.ok(track, "vision switch track className");
  assert.ok(thumb, "vision switch thumb className");
  return {
    track: track[1],
    thumbBase: thumb[1],
    thumbOn: thumb[2],
    thumbOff: thumb[3],
  };
}

function box(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function assertInside(inner, outer, label) {
  assert.ok(inner.left >= outer.left, `${label} left inside track`);
  assert.ok(inner.top >= outer.top, `${label} top inside track`);
  assert.ok(inner.right <= outer.right, `${label} right inside track`);
  assert.ok(inner.bottom <= outer.bottom, `${label} bottom inside track`);
}

test("vision switch thumb is left-anchored and stays inside the 44x24 track off and on", () => {
  const source = fs.readFileSync(new URL("./SettingsGeneralPane.tsx", import.meta.url), "utf8");
  const { track, thumbBase, thumbOn, thumbOff } = parseSwitchGeometry(source);

  assert.match(track, /\bh-6\b/);
  assert.match(track, /\bw-11\b/);
  assert.match(thumbBase, /\babsolute\b/);
  assert.match(thumbBase, /\bleft-0\.5\b/);
  assert.match(thumbBase, /\btop-0\.5\b/);
  assert.match(thumbBase, /\bsize-5\b/);
  assert.equal(thumbOff, "translate-x-0");
  assert.equal(thumbOn, "translate-x-5");
  assert.doesNotMatch(thumbBase + thumbOff + thumbOn, /translate-x-0\.5/);

  const trackBox = box(0, 0, SPACE[11], SPACE[6]);
  assert.deepEqual([trackBox.width, trackBox.height], [44, 24]);

  const thumbSize = SPACE[5];
  assert.equal(thumbSize, 20);

  const origin = { left: SPACE[0.5], top: SPACE[0.5] };
  const off = box(origin.left + SPACE[0], origin.top, thumbSize, thumbSize);
  const on = box(origin.left + SPACE[5], origin.top, thumbSize, thumbSize);

  assert.deepEqual(off, box(2, 2, 20, 20));
  assert.deepEqual(on, box(22, 2, 20, 20));
  assertInside(off, trackBox, "off");
  assertInside(on, trackBox, "on");
  assert.equal(trackBox.right - on.right, origin.left);
  assert.equal(trackBox.bottom - on.bottom, origin.top);
});

const MODELS = {
  providers: {
    xai: { label: "xAI", models: [{ id: "grok-4.6", label: "Grok 4.6" }] },
    openai: { label: "OpenAI", models: [{ id: "gpt-4.1", label: "GPT-4.1" }, { id: "gpt-image-1", label: "GPT Image" }] },
    anthropic: { label: "Anthropic", models: [{ id: "claude-opus", label: "Opus" }] },
  },
  default: { provider: "xai", model: "grok-4.6" },
};

test("portrait candidates list every visible model, not only image-capable ones", () => {
  const rows = portraitImageCandidates(MODELS, ["anthropic"], { provider: "", model: "" });
  assert.deepEqual(
    rows.map((row) => `${row.provider}/${row.model}`),
    ["xai/grok-4.6", "openai/gpt-4.1", "openai/gpt-image-1"],
  );
  assert.equal(rows.every((row) => row.retained === false), true);
});

test("hidden selected portrait model is retained with a hint flag", () => {
  const rows = portraitImageCandidates(MODELS, ["anthropic"], {
    provider: "anthropic",
    model: "claude-opus",
  });
  const retained = rows.find((row) => row.retained);
  assert.equal(retained?.provider, "anthropic");
  assert.equal(retained?.model, "claude-opus");
});

test("xAI keeper bypasses the portrait dropdown copy", () => {
  assert.equal(isOfficialXaiKeeper("xai"), true);
  assert.equal(isOfficialXaiKeeper("openai"), false);
  const source = fs.readFileSync(new URL("./SettingsGeneralPane.tsx", import.meta.url), "utf8");
  assert.match(source, /使用 xAI Grok Imagine/);
  assert.match(source, /所选模型\/供应商需支持图像生成/);
  assert.match(source, /WebSearchKeysPane/);
  assert.match(source, /OcrSecretsPane/);
});
