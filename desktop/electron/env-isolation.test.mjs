import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./env.mjs", import.meta.url), "utf8");
const settingsSource = fs.readFileSync(new URL("./settings.mjs", import.meta.url), "utf8");
const ipcSource = fs.readFileSync(new URL("./ipc.mjs", import.meta.url), "utf8");
const preloadSource = fs.readFileSync(new URL("./preload.cjs", import.meta.url), "utf8");
const preloadMainSource = fs.readFileSync(new URL("./preload-main.cjs", import.meta.url), "utf8");
const wizardSource = fs.readFileSync(
  new URL("../../web/frontend/src/wizard/App.tsx", import.meta.url),
  "utf8",
);
const projectionsSource = fs.readFileSync(
  new URL("../../web/server-node/projections.mjs", import.meta.url),
  "utf8",
);
const appSource = fs.readFileSync(new URL("../../web/frontend/src/App.tsx", import.meta.url), "utf8");
const dialogSource = fs.readFileSync(
  new URL("../../web/frontend/src/components/EditModelsDialog.tsx", import.meta.url),
  "utf8",
);

test("desktop Pi state is always rooted under app-owned userData", () => {
  assert.doesNotMatch(source, /COC_DESKTOP_AGENT_DIR/);
  assert.match(source, /coc-keeper-desktop/);
  assert.match(source, /process\.env\.COC_DESKTOP_USER_DATA/);
  assert.doesNotMatch(source, /app\.getPath\("userData"\)/);
  assert.match(settingsSource, /coc-keeper-desktop/);
  assert.doesNotMatch(settingsSource, /app\.getPath\("userData"\)/);
  assert.match(source, /agentDir: path\.join\(userData, "pi-agent"\)/);
  assert.match(source, /env\.PI_AGENT_DIR = paths\.agentDir/);
  assert.match(source, /env\.PI_CODING_AGENT_DIR = paths\.agentDir/);
  assert.match(source, /env\.COC_DESKTOP_USER_DATA = paths\.userData/);
  assert.match(projectionsSource, /resolveProductAgentDir/);
  assert.doesNotMatch(projectionsSource, /\.pi["'`].*agent|homedir\(\).*agent/);
});

test("edit-models editor can expand the bundled pi catalog", () => {
  assert.match(wizardSource, /更多（\$\{catalogProviders\.length\} 个 Pi 提供方）/);
  assert.match(dialogSource, /更多 · \$\{state\.catalogProviders\.length\}/);
  assert.match(appSource, /EditModelsDialog/);
  assert.match(appSource, /setEditModelsOpen\(true\)/);
  assert.doesNotMatch(appSource, /编辑模型<\/span>/);
  assert.match(preloadMainSource, /getWizardState/);
  assert.match(preloadMainSource, /saveProviderList/);
  assert.match(ipcSource, /catalogProviders/);
  assert.match(ipcSource, /extraProviderIds/);
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
