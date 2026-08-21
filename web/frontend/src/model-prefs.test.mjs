import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { hydrateModelSelection, shouldPersistModelPrefs } from "./model-prefs.ts";

test("hydrate prefers the shared remote model over this browser's localStorage", () => {
  const hydrated = hydrateModelSelection({
    remoteProvider: "xai",
    remoteModel: "grok-4.6",
    remoteThinking: "low",
    localProvider: "jellytoken",
    localModel: "deepseek-v4-flash",
    localThinking: "off",
  });
  assert.deepEqual(hydrated, {
    provider: "xai",
    model: "grok-4.6",
    thinking: "low",
    shouldUpload: false,
  });
});

test("empty remote falls back to localStorage and asks for a one-time upload", () => {
  const hydrated = hydrateModelSelection({
    remoteProvider: "",
    remoteModel: "",
    remoteThinking: "",
    localProvider: "xai",
    localModel: "grok-4.6",
    localThinking: "high",
  });
  assert.deepEqual(hydrated, {
    provider: "xai",
    model: "grok-4.6",
    thinking: "high",
    shouldUpload: true,
  });
});

test("incomplete remote (provider without model) does not beat localStorage", () => {
  const hydrated = hydrateModelSelection({
    remoteProvider: "xai",
    remoteModel: "  ",
    localProvider: "jellytoken",
    localModel: "deepseek-v4-flash",
  });
  assert.equal(hydrated.provider, "jellytoken");
  assert.equal(hydrated.model, "deepseek-v4-flash");
  assert.equal(hydrated.shouldUpload, true);
});

test("a fresh browser with no local cache stays empty and does not upload", () => {
  const hydrated = hydrateModelSelection({
    remoteProvider: "",
    remoteModel: "",
    localProvider: null,
    localModel: null,
  });
  assert.deepEqual(hydrated, {
    provider: "",
    model: "",
    thinking: "",
    shouldUpload: false,
  });
});

test("do not persist a model to disk until prefs have loaded writable", () => {
  assert.equal(
    shouldPersistModelPrefs({
      prefsReady: false,
      prefsWritable: false,
      provider: "xai",
      model: "grok-4.6",
    }),
    false,
  );
  assert.equal(
    shouldPersistModelPrefs({
      prefsReady: true,
      prefsWritable: false,
      provider: "xai",
      model: "grok-4.6",
    }),
    false,
  );
  assert.equal(
    shouldPersistModelPrefs({
      prefsReady: true,
      prefsWritable: true,
      provider: "",
      model: "grok-4.6",
    }),
    false,
  );
  assert.equal(
    shouldPersistModelPrefs({
      prefsReady: true,
      prefsWritable: true,
      provider: "xai",
      model: "grok-4.6",
    }),
    true,
  );
});

test("App hydrates from /api/user-prefs and writes model selection back", () => {
  const appSource = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /hydrateModelSelection\(/);
  assert.match(appSource, /shouldPersistModelPrefs\(/);
  assert.match(appSource, /saveUserPrefs\(\{[\s\S]*provider,/);
});
