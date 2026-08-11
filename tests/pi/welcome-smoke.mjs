#!/usr/bin/env node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const mod = await import(pathToFileURL(resolve(root, "plugins/coc-keeper/pi/lib/welcome.ts")).href);

const full = mod.fullWelcomeGuide();
const loadingFresh = mod.startupLoadingMessage(null);
const loadingResume = mod.startupLoadingMessage("startup-campaign");
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
const lifecycleOrder = [];
const lifecycleSent = [];
const lifecyclePi = {
  registerCommand: () => {},
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
let startupInstructionTriggered = false;
let resumedHiddenResumeInstruction = false;
let loadingFirst = false;
let welcomeAfterLoading = false;
let resumeLoadingFirst = false;
try {
  const startWelcome = mod.registerCocWelcome(
    lifecyclePi,
    () => lifecycleClient,
    lifecycleAgentDir,
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
  await startWelcome({ reason: "startup" }, ctx, "startup-campaign");
  const firstSend = lifecycleSent[0];
  loadingFirst = (
    firstSend?.message?.customType === mod.LOADING_CUSTOM_TYPE
    && firstSend?.options?.triggerTurn === false
  );
  welcomeAfterLoading = (
    lifecycleSent.find((entry) => (
      entry.message.customType === mod.WELCOME_CUSTOM_TYPE
    ))?.options?.triggerTurn === false
  );
  const tableOpenEntry = lifecycleSent.find((entry) => (
    entry.message.customType === mod.TABLE_OPEN_CUSTOM_TYPE
  ));
  startupInstructionTriggered = (
    tableOpenEntry?.options?.triggerTurn === true
    && tableOpenEntry?.message?.content.includes(
      '"operation":"session.resume"',
    )
  );

  lifecycleSent.length = 0;
  await startWelcome(
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
    "startup-campaign",
  );
  const resumedFirst = lifecycleSent[0];
  resumeLoadingFirst = (
    resumedFirst?.message?.customType === mod.LOADING_CUSTOM_TYPE
    && resumedFirst?.message?.content.includes("正在恢复战役")
    && resumedFirst?.message?.content.includes("startup-campaign")
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
  fullHasAlreadyActive: full.includes("COC 模式已激活"),
  fullNoActivatePrompt: !full.includes("激活 COC」或「继续"),
  fullShort: (
    full.split("\n").filter((line) => line.trim()).length <= 5
    && full.length < 200
  ),
  fullHasContinueList: (
    full.includes("继续之前的战役")
    && full.includes("列出已有战役")
  ),
  fullNoGuessId: full.includes("不会让你报 ID"),
  fullHasNew: full.includes("pi-coc --new"),
  loadingFreshText: loadingFresh.includes("正在加载"),
  loadingResumeText: loadingResume.includes("正在恢复战役 startup-campaign"),
  loadingFirst,
  welcomeAfterLoading,
  resumeLoadingFirst,
  resumeIsShort: resume.length < full.length && resume.includes("已续接"),
  resumeAlreadyActive: resume.includes("模式已激活"),
  resumeReason: forResume === resume,
  newReasonIsFull: forNew === full,
  headerHasTitle: header.some((l) => l.includes("COC Keeper")),
  headerSaysActive: header.some((l) => l.includes("已激活")),
  customType: mod.WELCOME_CUSTOM_TYPE,
  tableOpenNoAskActivate: open.includes("already active") && open.includes("Do not ask"),
  noEnvTableOpenListsCampaigns: (
    open.includes("result.campaigns")
    && open.includes("never guess")
    && open.includes("session.resume")
    && !open.includes("offer continue / built-in starter")
  ),
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
  startupInstructionTriggered,
  resumedHiddenResumeInstruction,
  autoOpenFreshStartup: mod.shouldAutoOpenTable("startup", true) === true,
  noAutoOpenResumeHistory: mod.shouldAutoOpenTable("startup", false) === false,
}, null, 2));
process.stdout.write("\n");
