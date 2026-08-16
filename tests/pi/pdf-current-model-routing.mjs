import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defaultPdfChildCommand } from "../../runtime/adapters/keeper/run_keeper_turn.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const keeperDir = path.join(root, "runtime", "adapters", "keeper");
const guard = path.join(keeperDir, "pi-visual-model-guard.mjs");
const cli = path.join(
  keeperDir,
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
  "dist",
  "cli.js",
);

assert.equal(
  defaultPdfChildCommand({ input: ["text", "image"] }, keeperDir),
  cli,
);
assert.equal(
  defaultPdfChildCommand({ input: ["text"] }, keeperDir),
  guard,
);
assert.equal(
  defaultPdfChildCommand({ input: undefined }, keeperDir),
  guard,
);

const ordinary = spawnSync(process.execPath, [guard, "--version"], {
  encoding: "utf8",
});
assert.equal(ordinary.status, 0);
assert.match(ordinary.stdout, /^\d+\.\d+\.\d+/);

const visual = spawnSync(
  process.execPath,
  [guard, "--mode", "text", "--model", "deepseek/deepseek-v4-flash", "--skill", "/pdf"],
  { encoding: "utf8" },
);
assert.equal(visual.status, 78);
assert.match(visual.stderr, /COC_PDF_VISUAL_MODEL_UNSUPPORTED/);
assert.match(visual.stderr, /deepseek\/deepseek-v4-flash/);
assert.match(visual.stderr, /右上角/);
assert.match(visual.stderr, /支持图片/);

process.stdout.write("pdf current-model routing: ok\n");
