/**
 * Live telemetry probe: boot a real agent session with the full pi-coc main
 * extension and a faux streaming provider, drive one player turn that
 * includes a thinking block, a real coc_capabilities tool call (MCP child),
 * and a final narration call — then assert the telemetry JSONL captured the
 * whole breakdown. Manual engineering probe (uv + MCP child required):
 *
 *   node --experimental-strip-types tests/pi/turn-telemetry-live-probe.mjs <repoRoot>
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "../../runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxThinking,
  fauxToolCall,
  fauxText,
} from "../../runtime/adapters/keeper/node_modules/@earendil-works/pi-ai/dist/providers/faux.js";

const root = path.resolve(process.argv[2] || process.cwd());
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-coc-turn-telemetry-live-"));
// Telemetry lands under the COC agent home; point it at the temp dir before
// the main extension activates.
process.env.PI_CODING_AGENT_DIR = temp;

const loader = new DefaultResourceLoader({
  cwd: root,
  agentDir: temp,
  additionalExtensionPaths: [root],
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
});
const faux = fauxProvider({
  provider: "pi-coc-telemetry-faux",
  models: [{ id: "kp" }],
  tokensPerSecond: 300,
});
const modelRuntime = await ModelRuntime.create({ modelsPath: null });
modelRuntime.registerNativeProvider(faux.provider);
faux.setResponses([
  fauxAssistantMessage(
    [fauxThinking("玩家推门：先查能力，再叙事。"), fauxToolCall("coc_capabilities", {})],
    { stopReason: "toolCalls" },
  ),
  fauxAssistantMessage([fauxText("门后是一条没有尽头的黑暗走廊。")], { stopReason: "stop" }),
]);

try {
  await loader.reload();
  const extensions = loader.getExtensions();
  if (extensions.errors.length) throw new Error(JSON.stringify(extensions.errors));
  const { session } = await createAgentSession({
    cwd: root,
    agentDir: temp,
    model: faux.getModel("kp"),
    modelRuntime,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(root),
    settingsManager: SettingsManager.inMemory(),
    noTools: "builtin",
  });
  await session.prompt("我推门进去看看。");
  session.dispose();

  const logPath = path.join(temp, "telemetry", "turns.jsonl");
  const lines = (await fs.readFile(logPath, "utf8")).trim().split("\n");
  const records = lines.map((line) => JSON.parse(line));
  const sessionLine = records.find((r) => r.record === "session");
  const turnRecords = records.filter((r) => r.record === "turn");
  const record = turnRecords.at(-1);
  const kinds = record.steps.map((step) => step.kind);
  const firstModel = record.steps.find((step) => step.kind === "model");
  const toolStep = record.steps.find((step) => step.kind === "tool");

  const out = {
    ok: true,
    sessionLine: sessionLine !== undefined,
    turnsLogged: turnRecords.length,
    kinds,
    promptExcerpt: record.prompt_excerpt,
    wallMs: record.wall_ms,
    modelMs: record.model_ms,
    toolMs: record.tool_ms,
    otherMs: record.other_ms,
    firstModelPhases: {
      request: firstModel?.phases.request?.offset_ms,
      response: firstModel?.phases.response?.offset_ms,
      stream_start: firstModel?.phases.stream_start?.offset_ms,
      first_delta: firstModel?.phases.first_delta?.offset_ms,
      first_nonthinking: firstModel?.phases.first_nonthinking?.offset_ms,
      stream_end: firstModel?.phases.stream_end?.offset_ms,
      http_status: firstModel?.phases.http_status,
    },
    firstModelThinkingMs: firstModel?.thinking_ms,
    firstModelTtftMs: firstModel?.ttft_ms,
    firstModelNetworkMs: firstModel?.network_ms,
    firstModelUpdates: firstModel?.updates,
    firstModelToolCalls: firstModel?.tool_calls,
    toolStep: {
      label: toolStep?.label,
      id: toolStep?.tool_call_id,
      durationMs: toolStep?.duration_ms,
      argsBytes: toolStep?.args_bytes,
      resultBytes: toolStep?.result_bytes,
    },
    contextUsage: record.context_usage,
    tokens: record.tokens,
  };
  const problems = [];
  // session_start does not fire on the in-memory SDK session path; the session
  // header line is written by real desktop/RPC sessions. Not an error here.
  if (turnRecords.length < 1) problems.push("no turn record");
  if (kinds.join(",") !== "model,tool,model") problems.push(`unexpected steps: ${kinds}`);
  const p = firstModel?.phases;
  // Provider request/response events depend on the host stream path; the
  // faux native provider does not invoke them. Stream-side phases must exist.
  if (!p?.stream_start || !p?.first_delta || !p?.stream_end) {
    problems.push(`stream phase chain incomplete: ${JSON.stringify(p)}`);
  }
  if (p?.request && p?.response && p?.response.offset_ms < p.request.offset_ms) {
    problems.push("response before request");
  }
  if (typeof firstModel?.thinking_ms !== "number") problems.push("thinking_ms missing");
  if (typeof firstModel?.ttft_ms !== "number") problems.push("ttft_ms missing");
  if (!(firstModel?.updates > 0)) problems.push("no delta updates counted");
  if (firstModel?.tool_calls !== 1) problems.push("toolCall part not counted");
  if (toolStep?.label !== "coc_capabilities") problems.push(`tool label: ${toolStep?.label}`);
  if (!(toolStep?.duration_ms > 0)) problems.push("tool duration not measured");
  if (typeof toolStep?.args_bytes !== "number") problems.push("args size missing");
  if (typeof toolStep?.result_bytes !== "number") problems.push("result size missing");
  if (!record.tokens || record.tokens.input <= 0 || record.tokens.output <= 0) {
    problems.push(`tokens not captured: ${JSON.stringify(record.tokens)}`);
  }
  if (record.context_usage === undefined) problems.push("context_usage key missing");
  if (record.model_ms <= 0 || record.wall_ms < record.model_ms + record.tool_ms) {
    problems.push("bucket math broken");
  }
  out.ok = problems.length === 0;
  out.problems = problems;
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
} finally {
  await fs.rm(temp, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 200);
}
