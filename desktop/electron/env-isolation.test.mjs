import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./env.mjs", import.meta.url), "utf8");
const settingsSource = fs.readFileSync(new URL("./settings.mjs", import.meta.url), "utf8");
const ipcSource = fs.readFileSync(new URL("./ipc.mjs", import.meta.url), "utf8");
const preloadSource = fs.readFileSync(new URL("./preload.cjs", import.meta.url), "utf8");
const wizardSource = fs.readFileSync(
  new URL("../../web/frontend/src/wizard/App.tsx", import.meta.url),
  "utf8",
);

test("desktop Pi state is always rooted under app-owned userData", () => {
  assert.doesNotMatch(source, /COC_DESKTOP_AGENT_DIR/);
  assert.match(
    source,
    /const userData = process\.env\.COC_DESKTOP_USER_DATA \|\| app\.getPath\("userData"\)/,
  );
  assert.match(source, /agentDir: path\.join\(userData, "pi-agent"\)/);
  assert.match(source, /env\.PI_AGENT_DIR = paths\.agentDir/);
  assert.match(source, /env\.PI_CODING_AGENT_DIR = paths\.agentDir/);
});

test("desktop has no separately configurable PDF child model", () => {
  assert.doesNotMatch(source, /pdfVisionModel|COC_PI_PDF_MODEL/);
  assert.doesNotMatch(ipcSource, /pdfVisionModel|savePdfVisionModel/);
  assert.doesNotMatch(preloadSource, /savePdfVisionModel/);
  assert.doesNotMatch(wizardSource, /pdfVisionModel|savePdfVisionModel|视觉解析模型/);
  assert.equal(
    settingsSource.match(/delete next\.pdfVisionModel/g)?.length,
    2,
    "load and save both discard the obsolete PDF visual-model key",
  );
});
