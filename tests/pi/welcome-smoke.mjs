#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const mod = await import(pathToFileURL(resolve(root, "plugins/coc-keeper/pi/lib/welcome.ts")).href);

const full = mod.fullWelcomeGuide();
const resume = mod.resumeWelcomeGuide();
const forResume = mod.welcomeBodyForReason("resume");
const forNew = mod.welcomeBodyForReason("new");

const theme = {
  fg: (_k, s) => s,
  bold: (s) => s,
};
const header = mod.cocHeaderLines(theme);

const open = mod.tableOpenInstruction();
process.stdout.write(JSON.stringify({
  ok: true,
  fullHasWelcome: full.includes("欢迎使用 COC Keeper"),
  fullHasAlreadyActive: full.includes("即已进入 COC 模式"),
  fullNoActivatePrompt: !full.includes("激活 COC」或「继续"),
  fullHasTools: full.includes("coc_capabilities"),
  fullHasNew: full.includes("pi-coc --new"),
  resumeIsShort: resume.length < full.length && resume.includes("已续接"),
  resumeAlreadyActive: resume.includes("模式已激活"),
  resumeReason: forResume === resume,
  newReasonIsFull: forNew === full,
  headerHasTitle: header.some((l) => l.includes("COC Keeper")),
  headerSaysActive: header.some((l) => l.includes("已激活")),
  customType: mod.WELCOME_CUSTOM_TYPE,
  tableOpenNoAskActivate: open.includes("already active") && open.includes("Do not ask"),
  autoOpenFreshStartup: mod.shouldAutoOpenTable("startup", true) === true,
  noAutoOpenResumeHistory: mod.shouldAutoOpenTable("startup", false) === false,
}, null, 2));
process.stdout.write("\n");
