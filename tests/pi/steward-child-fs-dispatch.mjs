#!/usr/bin/env node
// Focused real-dispatch test for the steward subagent tool-binding fix
// (round-5 acceptance BLOCKED_NO_FS). This spawns a real pi child process with
// the exact launch contract pi-subagents buildPiArgs + getPiSpawnCommand
// produce for a steward agent (verified against pi-subagents 0.45.2 source):
//   --mode json -p --model <agent model>:<thinking> --tools <agent allowlist>
//   --system-prompt <replace> --no-context-files --no-skills --no-session
//   env: PI_SUBAGENT_CHILD=1 (pi-subagents sets this on every child)
//   cwd: launch cwd, ambient package extensions loaded (no --no-extensions)
// Without the fix the coc-keeper extension's session_start wiped the child's
// allowlist via setActiveTools(kpActiveTools); with the fix the child keeps
// bash/read/grep/find on the host filesystem.
//
// Probe task proves, with real tool execution (tool_execution_start events):
//   1. host FS tools exist and run (bash cat of a file whose content the task
//      never reveals, so the secret cannot be fabricated),
//   2. the child can read a campaign pages-cache directory (host FS),
//   3. the child can run the canonical toolbox CLI steward.domain_put and
//      steward-state.json is created with the right content.
// This is a small focused probe; it does NOT start a full RPC play session.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const PI = process.env.PI_SUBAGENT_PI_BINARY || "/Users/haoli/.npm-global/bin/pi";
const AGENT_HOME = process.env.PI_SUBAGENT_CHILD_TEST_AGENT_DIR
  || path.join(root, ".pi", "coc-agent");
const stewardsAllowlist = "read,grep,find,bash,subagent,subagent_wait";

const work = mkdtempSync(path.join(tmpdir(), "steward-bind-fs-"));
const campaignId = `steward-bind-${Date.now()}`;
const campaignRoot = path.join(work, ".coc", "campaigns", campaignId);
mkdirSync(path.join(campaignRoot, "save"), { recursive: true });
const pagesCacheDir = path.join(campaignRoot, "assets", "pages-cache");
mkdirSync(pagesCacheDir, { recursive: true });
writeFileSync(path.join(pagesCacheDir, "probe.txt"), "probe page cache marker\n", "utf8");
const secret = `STEWARD_BIND_SECRET_${randomBytes(8).toString("hex")}`;
const secretFile = path.join(work, "secret.txt");
writeFileSync(secretFile, secret, "utf8");

const promptFile = path.join(work, "agent-prompt.md");
writeFileSync(
  promptFile,
  "你是 COC 模组解析管家（steward-init 探针）;本任务只做工具面验证，不改战役核心状态。\n",
  "utf8",
);

const decisionId = `steward-bind-probe-${Date.now()}`;
const stewardStatePath = path.join(campaignRoot, "save", "steward-state.json");
const toolbox = "uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py";
const putJson = JSON.stringify({
  decision_id: decisionId,
  domain: "init",
  status: "ready",
  content: { title: "bind-probe", source_refs: ["pages-cache/probe.txt:1"] },
});
const task = [
  "Task: steward tool-surface probe on the host filesystem.",
  `1. Use the bash tool to run exactly: cat ${secretFile}`,
  `   (the file content is a secret that is NOT written anywhere in this task; report it verbatim)`,
  `2. Use the bash tool to run exactly: ls ${pagesCacheDir}`,
  "   (list the campaign pages-cache directory; report the exact entry names)",
  `3. Use the bash tool to run exactly: ${toolbox} steward.domain_put --root ${work} --campaign ${campaignId} --json '${putJson}'`,
  "   (the command must exit 0 and print a JSON envelope with ok=true)",
  `4. Use the bash tool to run exactly: cat ${stewardStatePath}`,
  "   and report the returned domain status and content keys.",
  "Reply with ONLY one JSON object, no markdown fences, no commentary:",
  '{"bash_secret":"<verbatim secret from step 1>","pages_cache_entries":["<names from step 2>"],"domain_status":"<domains.init.status from the step 4 file>","content_keys":["<sorted keys of domains.init excluding status from the step 4 file>"]}',
].join("\n");

const args = [
  "--mode", "json", "-p",
  "--model", "xai/grok-4.5:medium",
  "--tools", stewardsAllowlist,
  "--system-prompt", promptFile,
  "--no-context-files",
  "--no-skills",
  "--no-session",
  task,
];
const env = {
  ...process.env,
  PI_SUBAGENT_CHILD: "1",
  PI_CODING_AGENT_DIR: AGENT_HOME,
  PATH: [path.dirname(process.env.PI_SUBAGENT_TEST_UV || "/Users/haoli/.local/bin/uv"), process.env.PATH].join(":"),
};

const child = spawn(PI, args, {
  cwd: root, env, stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });

const timeout = setTimeout(() => child.kill("SIGKILL"), 300000);
const exitCode = await new Promise((resolve) => child.on("close", (code) => {
  clearTimeout(timeout);
  resolve(code);
}));

const executedTools = [];
const messages = [];
for (const line of stdout.split("\n")) {
  if (!line.trim()) continue;
  let event;
  try { event = JSON.parse(line); } catch { continue; }
  if (event.type === "tool_execution_start") executedTools.push(event.toolName);
  if (event.type === "agent_end") {
    for (const message of event.messages || []) {
      for (const part of message.content || []) {
        if (part.type === "text") messages.push(part.text);
      }
    }
  }
}
const finalText = messages.join("\n");
const persisted = existsSync(stewardStatePath)
  ? JSON.parse(readFileSync(stewardStatePath, "utf8"))
  : null;

const report = {
  exitCode,
  executedTools,
  finalText,
  secretReported: finalText.includes(secret),
  stewardStateOnDisk: persisted
    ? {
        campaign_id: persisted.campaign_id,
        init_status: persisted.domains?.init?.status,
        content_keys: persisted.domains?.init
          ? Object.keys(persisted.domains.init).filter((k) => k !== "status").sort()
          : [],
      }
    : null,
  stderrTail: stderr.slice(-400),
};
if (exitCode !== 0) {
  throw new Error(`pi child exited ${exitCode}: ${JSON.stringify(report)}`);
}

const hostFsToolExecuted = executedTools.some((name) => (
  ["bash", "read", "grep", "find", "write"].includes(name)
));
const parsed = (() => {
  const marker = "{\"bash_secret\"";
  const start = finalText.lastIndexOf(marker);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < finalText.length; i++) {
    const ch = finalText[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(finalText.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
})();

const failures = [];
if (!hostFsToolExecuted) failures.push(`no host FS tool executed; executed=${JSON.stringify(executedTools)}`);
if (!report.secretReported) failures.push("child could not read the secret file (no working host FS read)");
if (!parsed || parsed.bash_secret !== secret) failures.push("child reply did not carry the verbatim bash secret");
if (!parsed || !Array.isArray(parsed.pages_cache_entries) || !parsed.pages_cache_entries.includes("probe.txt")) {
  failures.push(`child could not list pages-cache; entries=${JSON.stringify(parsed?.pages_cache_entries)}`);
}
if (!report.stewardStateOnDisk) {
  failures.push("steward-state.json was not created on the host FS");
} else {
  if (report.stewardStateOnDisk.campaign_id !== campaignId) {
    failures.push(`steward-state campaign_id mismatch: ${report.stewardStateOnDisk.campaign_id}`);
  }
  if (report.stewardStateOnDisk.init_status !== "ready") {
    failures.push(`steward-state init status: ${report.stewardStateOnDisk.init_status}`);
  }
}
if (failures.length > 0) {
  throw new Error(`steward child FS probe failed: ${failures.join("; ")}; ${JSON.stringify(report)}`);
}

process.stdout.write(JSON.stringify({
  ok: true,
  executedTools,
  stewardState: report.stewardStateOnDisk,
  secretReported: true,
}));
