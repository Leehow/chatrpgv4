// pi-coc multi-turn KP driver. Loads the coc-keeper extension via the Pi SDK,
// sends a sequence of player messages to a real model, and captures each KP
// turn's tool calls + text. Drives pi-coc as a genuine KP through the same
// SDK path the TUI uses, with structured event capture.
//
// Usage:
//   node --experimental-strip-types tests/pi/_lib/kp-driver.mjs <repoRoot> <msg1|msg2|...>
// Messages are split on "|". Each is one player turn.
import "./preload-embedded-pi.mjs";
import path from "node:path";
import process from "node:process";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "../../../runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent/dist/index.js";

const repoRoot = path.resolve(process.argv[2] || process.cwd());
const rawMessages = process.argv[3] || "用一句话确认就绪。";
const messages = rawMessages.split("|").map((s) => s.trim()).filter(Boolean);
const PER_TURN_TIMEOUT_MS = Number(process.env.KP_TURN_TIMEOUT_MS || 240000);

const agentDir = process.env.PI_COC_AGENT_DIR || path.join(process.env.HOME || "", ".pi/coc-agent");

const loader = new DefaultResourceLoader({
  cwd: repoRoot,
  agentDir,
  additionalExtensionPaths: [repoRoot],
  noExtensions: true,
  noSkills: false,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
});
await loader.reload();
const extensions = loader.getExtensions();
if (extensions.errors.length) {
  console.error(JSON.stringify({ error: "extension load failed", details: extensions.errors }));
  process.exit(2);
}

const { ModelRuntime } = await import("../../../runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js");
const runtime = await ModelRuntime.create({ agentDir });
const allModels = runtime.getModels();
const model = allModels.find((m) => m.id === "grok-4.5" && m.provider === "xai")
  || allModels.find((m) => m.id === "grok-4.5")
  || allModels[0];
if (!model) {
  console.error(JSON.stringify({ error: "no model available" }));
  process.exit(3);
}

const { session } = await createAgentSession({
  cwd: repoRoot,
  agentDir,
  model,
  thinkingLevel: process.env.KP_THINKING || "medium",
  resourceLoader: loader,
  sessionManager: SessionManager.inMemory(repoRoot),
  noTools: "builtin",
});

// Per-turn capture: reset accumulators before each sendUserMessage.
let curText = [];
let curTools = [];
let curToolResults = [];
function resetTurn() { curText = []; curTools = []; curToolResults = []; }

const unsub = session.subscribe((event) => {
  if (event.type === "message_end") {
    const msg = event.message || {};
    if (msg.role === "assistant") {
      const content = msg.content;
      if (typeof content === "string") curText.push(content);
      else if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === "text" && part.text) curText.push(part.text);
          if (part.type === "tool_use") {
            const inp = part.input || {};
            curTools.push({ name: part.name, operation: inp.operation || inp.name || "", campaign: inp.campaign || "" });
          }
        }
      }
    }
  }
});

function waitForSettled(timeoutMs) {
  // A KP turn completes when the agent stops emitting events for a quiet period
  // after having produced at least one assistant message_end. We poll lastEventAt.
  return new Promise((resolve) => {
    let lastEventAt = Date.now();
    let sawAssistant = false;
    const u = session.subscribe((ev) => {
      lastEventAt = Date.now();
      if (ev.type === "message_end" && (ev.message || {}).role === "assistant") sawAssistant = true;
      // agent_settled is the definitive "turn fully done" signal.
      if (ev.type === "agent_settled" && sawAssistant) { cleanup(); resolve("settled"); }
    });
    const cleanup = () => u();
    const interval = setInterval(() => {
      // Quiet for 8s after seeing assistant output => treat as settled.
      if (sawAssistant && Date.now() - lastEventAt > 8000) {
        clearInterval(interval); cleanup(); resolve("quiet");
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(interval); cleanup(); resolve("timeout");
      }
    }, 500);
    const startedAt = Date.now();
  });
}

const turns = [];
for (let i = 0; i < messages.length; i++) {
  resetTurn();
  const t0 = Date.now();
  let status = "unknown";
  try {
    await session.sendUserMessage(messages[i]);
    status = await waitForSettled(PER_TURN_TIMEOUT_MS);
  } catch (e) {
    status = `exception: ${e.message}`;
  }
  turns.push({
    turn: i + 1,
    player: messages[i],
    elapsed_ms: Date.now() - t0,
    settle_status: status,
    tool_calls: curTools,
    tool_result_count: curToolResults.length,
    kp_text: curText.join(""),
  });
}

unsub();
try { session.dispose(); } catch {}
try { await runtime.dispose?.(); } catch {}

const result = {
  ok: true,
  model: { id: model.id, provider: model.provider },
  thinking: process.env.KP_THINKING || "medium",
  turn_count: turns.length,
  total_elapsed_ms: turns.reduce((s, t) => s + t.elapsed_ms, 0),
  turns,
};
console.log(JSON.stringify(result, null, 2));
