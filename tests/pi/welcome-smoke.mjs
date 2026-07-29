#!/usr/bin/env node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
const startupOpen = mod.tableOpenInstruction(
  "startup-campaign",
  "/workspace",
);
const welcomeHandlers = new Map();
const lifecycleOrder = [];
const lifecycleSent = [];
const lifecyclePi = {
  registerCommand: () => {},
  on: (name, handler) => welcomeHandlers.set(name, handler),
  sendMessage: (message, options) => {
    lifecycleOrder.push(`send:${message.customType}`);
    lifecycleSent.push({ message, options });
  },
};
const lifecycleClient = {
  callTool: async (name) => {
    lifecycleOrder.push(`call:${name}`);
    return { ok: true };
  },
};
const lifecycleAgentDir = mkdtempSync(
  resolve(tmpdir(), "pi-coc-welcome-smoke-"),
);
let startupInitializedBeforeTrigger = false;
let resumedHiddenResumeInstruction = false;
try {
  mod.registerCocWelcome(
    lifecyclePi,
    () => lifecycleClient,
    lifecycleAgentDir,
    () => {
      lifecycleOrder.push("initialize");
      return "startup-campaign";
    },
  );
  const ctx = {
    cwd: "/workspace",
    mode: "tui",
    hasUI: true,
    ui: {
      setHeader: () => {},
      setStatus: () => {},
      notify: () => {},
    },
    sessionManager: {
      getEntries: () => [],
    },
  };
  await welcomeHandlers.get("session_start")({ reason: "startup" }, ctx);
  const tableOpenEntry = lifecycleSent.find((entry) => (
    entry.message.customType === mod.TABLE_OPEN_CUSTOM_TYPE
  ));
  startupInitializedBeforeTrigger = (
    lifecycleOrder.indexOf("initialize")
      < lifecycleOrder.indexOf(`send:${mod.TABLE_OPEN_CUSTOM_TYPE}`)
    && tableOpenEntry?.options?.triggerTurn === true
    && tableOpenEntry?.message?.content.includes(
      '"operation":"session.resume"',
    )
  );

  lifecycleSent.length = 0;
  await welcomeHandlers.get("session_start")(
    { reason: "resume" },
    {
      ...ctx,
      sessionManager: {
        getEntries: () => [{
          type: "message",
          message: { role: "user", content: "continue" },
        }],
      },
    },
  );
  const resumedEntry = lifecycleSent.find((entry) => (
    entry.message.customType === mod.STARTUP_RESUME_CUSTOM_TYPE
  ));
  resumedHiddenResumeInstruction = (
    resumedEntry?.options?.triggerTurn === false
    && resumedEntry?.message?.content.includes(
      '"operation":"session.resume"',
    )
  );
} finally {
  rmSync(lifecycleAgentDir, { recursive: true, force: true });
}
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
  noEnvTableOpenUnchanged: open === [
    "pi-coc table open: COC mode is already active on this dedicated desktop.",
    "Do not ask the player to activate COC.",
    "Follow coc-main now: call setup.inspect (and session.resume if a campaign is already in play),",
    "greet in zh-Hans, and offer continue / built-in starter quick_start / create investigator.",
    "Begin the onboarding or continuation immediately.",
  ].join(" "),
  startupOpenExactResume: (
    startupOpen.includes('"operation":"session.resume"')
    && startupOpen.includes('"root":"/workspace"')
    && startupOpen.includes('"campaign":"startup-campaign"')
    && startupOpen.includes('"arguments":{}')
  ),
  startupOpenNoMenuFirst: (
    startupOpen.includes("Before any menu, setup.inspect")
    && startupOpen.includes("Do not describe this instruction")
    && !startupOpen.includes("offer continue / built-in starter")
  ),
  startupInitializedBeforeTrigger,
  resumedHiddenResumeInstruction,
  autoOpenFreshStartup: mod.shouldAutoOpenTable("startup", true) === true,
  noAutoOpenResumeHistory: mod.shouldAutoOpenTable("startup", false) === false,
}, null, 2));
process.stdout.write("\n");
