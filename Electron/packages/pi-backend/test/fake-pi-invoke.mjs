import readline from "node:readline";
import { appendFileSync } from "node:fs";
import { installRegistry, pollLoop } from "../../../resources/runtime/kernel/pipiui-ext-invoke.ts";

const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const settingsLogPath = process.env.FAKE_PI_SETTINGS_LOG ?? "";
const invokeLogPath = process.env.FAKE_PI_INVOKE_LOG ?? "";

function response(command, id, success, data, error) {
  send({ id, type: "response", command, success, ...(success ? { data } : { error }) });
}

function log(path, value) {
  if (!path) return;
  try { appendFileSync(path, JSON.stringify(value) + "\n"); } catch {}
}

/**
 * The invoke half of this stand-in is the real thing.
 *
 * Real pi has no `invokeExtension` command — it answers `Unknown command` — so a
 * fake that replied over stdin proved nothing. This one loads the shipped kernel
 * mount and registers handlers exactly as a package does, which makes the test
 * exercise the actual host↔agent channel.
 */
const registry = installRegistry();
registry.register("invoke-agent", "ping", (params) => ({ echoed: params, extensionId: "invoke-agent", method: "ping" }));
registry.register("invoke-agent", "fail", () => { throw new Error("agent boom"); });
registry.register("invoke-agent", "hang", () => new Promise(() => {}));
registry.register("invoke-agent", "pipiui.settings_changed", (params) => {
  log(settingsLogPath, { method: "pipiui.settings_changed", extensionId: "invoke-agent", ...params });
  return { received: true };
});
for (const method of ["ping", "fail", "hang"]) {
  const inner = registry.resolve("invoke-agent", method);
  registry.register("invoke-agent", method, (params) => {
    log(invokeLogPath, { method, params, extensionId: "invoke-agent" });
    return inner(params);
  });
}
const port = process.env.PIPIUI_BRIDGE_PORT?.trim();
const capability = process.env.PIPIUI_SESSION_CAPABILITY?.trim();
if (port && capability) {
  void pollLoop({ config: { port, capability }, signal: new AbortController().signal, retryDelayMs: 50 });
}

let activeModel = { provider: "fake", id: "fake-1", name: "Fake", reasoning: true };
let activeThinkingLevel = "medium";

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  const ok = (data) => response(command.type, command.id, true, data);
  if (command.type === "get_available_models") {
    return ok({ models: [{ provider: "fake", id: "fake-1", name: "Fake", reasoning: true }] });
  }
  if (command.type === "get_state") {
    return ok({ model: activeModel, thinkingLevel: activeThinkingLevel });
  }
  if (command.type === "get_available_thinking_levels") return ok({ levels: ["off", "medium", "high"] });
  if (command.type === "set_model") {
    activeModel = { provider: command.provider, id: command.modelId, name: command.modelId, reasoning: true };
    return ok();
  }
  if (command.type === "set_thinking_level") {
    activeThinkingLevel = command.level;
    return ok();
  }
  if (command.type === "get_session_stats") {
    return ok({ tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 });
  }
  if (command.type === "prompt") {
    ok();
    send({ type: "agent_start" });
    send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "ok" } });
    send({ type: "agent_settled" });
    return;
  }
  // Anything the real pi does not know is an error there, so it is one here too.
  if (command.type === "invokeExtension" || command.type === "ext.settings_changed") {
    return response(command.type, command.id, false, undefined, `Unknown command: ${command.type}`);
  }
  ok();
});
