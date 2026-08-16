#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const skillIndex = args.indexOf("--skill");

// coc-pdf-skill-adapter adds --skill only for the visual PDF producer. Its
// native inspector has already declined or was unavailable at this point.
// Opening text extraction has no --skill and is delegated unchanged below.
if (skillIndex >= 0) {
  const modelIndex = args.indexOf("--model");
  const model = modelIndex >= 0 && args[modelIndex + 1]
    ? args[modelIndex + 1]
    : "当前模型";
  process.stderr.write(
    "COC_PDF_VISUAL_MODEL_UNSUPPORTED: "
      + `本地 PDF 解析无法完成当前页面，必须使用视觉回退；右上角当前模型 ${model} `
      + "不支持图片输入。请切换到支持图片的模型后重试。\n",
  );
  process.exit(78);
}

const cli = path.resolve(
  import.meta.dirname,
  "node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
);
const result = spawnSync(process.execPath, [cli, ...args], {
  env: process.env,
  stdio: "inherit",
});
if (result.error) {
  process.stderr.write(`Pi CLI launch failed: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(Number.isInteger(result.status) ? result.status : 1);
