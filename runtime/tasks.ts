/** Fixed host adapters; checking never opens a kernel or publishes an artifact. */
import { accessSync, constants, statSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { KernelError } from "../extensions/kernel/client.ts";
import { runReader, type ReaderRequest } from "../extensions/module/reader.ts";
import type { RuntimeCapabilities, RuntimeCheck, RuntimeContext } from "./host.ts";
import { runHostProcess } from "./process.ts";

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const cancelled = () => new KernelError({ code: "internal", message: "Runtime operation was cancelled", details: { reason: "runtime_cancelled" } });
function ensureActive(signal: AbortSignal) { if (signal.aborted) throw cancelled(); }

/** The standalone helper receives only deployment locations, never a serialized environment. */
function helperOptions(context: RuntimeContext) {
  return JSON.stringify({ layout: context.layout, backend: context.backend, resourceRoot: context.resourceRoot, contentRoot: context.contentRoot,
    agentHome: context.agentHome, nodeExecutable: context.nodeExecutable });
}

async function readerContext(context: RuntimeContext, request: ReaderRequest, signal: AbortSignal): Promise<RuntimeContext> {
  ensureActive(signal);
  const bin = join(request.cwd, "host-bin");
  await mkdir(bin, { recursive: true });
  const commands: Record<string, string[]> = {
    node: [context.nodeExecutable],
    "coc-read-check": [context.nodeExecutable, context.entrypoints.check],
    "coc-source": [context.nodeExecutable, context.entrypoints.source],
  };
  const env = { ...context.env };
  if (!request.maxRequests) delete env.PI_COC_READER_MAX_REQUESTS;
  for (const [name, command] of Object.entries(commands)) {
    const path = join(bin, name);
    await writeFile(path, `#!/bin/sh\nexec ${command.map(quote).join(" ")} "$@"\n`);
    await chmod(path, 0o755);
  }
  ensureActive(signal);
  // The session launcher leaves grok-build's image tools to image-gen; a lane mounts neither, and
  // says the same thing rather than depending on having inherited it.
  return Object.freeze({ ...context, env: Object.freeze({ ...env, PI_GROK_BUILD_IMAGE_TOOLS: "0", PATH: `${bin}${delimiter}${env.PATH ?? ""}`,
    ...(request.maxRequests ? {PI_COC_READER_MAX_REQUESTS: String(request.maxRequests)} : {}),
    PI_COC_RUNTIME_OPTIONS: helperOptions(context), PI_COC_READER_CHECK: join(bin, "coc-read-check") }) });
}

async function instructions(context: RuntimeContext, request: ReaderRequest): Promise<string | undefined> {
  if (request.prompt && request.systemPrompt) throw new Error("Conflicting reader instruction forms");
  if (!request.prompt) return request.systemPrompt;
  const { phase, guidance, answer } = request.prompt;
  if (!["index", "read", "verify"].includes(phase)) throw new Error("Unknown reader instruction phase");
  let text: string;
  if (answer) text = await readFile(join(context.contentRoot, "setup", "source-answer.md"), "utf8");
  else if (guidance) text = await readFile(join(context.contentRoot, "setup", "visual-guidance.md"), "utf8");
  else {
    const guide = await readFile(join(context.contentRoot, "setup", "visual-reader.md"), "utf8");
    const header = phase === "index" ? "## Index phase" : phase === "read" ? "## Read phase" : "## Verify phase";
    const introEnd = guide.indexOf("## Index phase"), start = guide.indexOf(header);
    if (introEnd < 0 || start < 0) throw new Error("Reader instructions are missing the selected phase");
    const end = guide.indexOf("\n## ", start + header.length);
    text = guide.slice(0, introEnd) + guide.slice(start, end < 0 ? undefined : end) + "\nComplete only this phase and then stop.\n";
  }
  const path = join(request.cwd, `instructions-${phase}.md`);
  await writeFile(path, text);
  return path;
}

function taskExecutable(context: RuntimeContext, command: string): string {
  const paths = isAbsolute(command) || command.includes("/") || command.includes("\\")
    ? [resolve(context.resourceRoot, command)]
    : (context.env.PATH ?? "").split(delimiter).filter(Boolean).map(path => resolve(context.resourceRoot, path, command));
  const found = paths.find(path => {
    try { accessSync(path, constants.X_OK); return statSync(path).isFile(); } catch { return false; }
  });
  if (!found) throw new Error(`Reader executable is unavailable: ${command}`);
  return found;
}

/** Both CLIs import the exact validators used by module.read.finish and mods.accept. */
export async function runCheck(context: RuntimeContext, request: RuntimeCheck, signal: AbortSignal): Promise<{ ok: boolean; [key: string]: unknown }> {
  const args = request.kind === "source-draft" ? ["--packet", resolve(context.home, request.packet)] : ["--kind", request.kind];
  const output = await runHostProcess([context.nodeExecutable, context.entrypoints.check, ...args, "--draft", resolve(context.home, request.draft)], {
    cwd: context.resourceRoot, env: {...context.env, PI_COC_RUNTIME_OPTIONS: helperOptions(context)}, signal, timeoutMs: 30_000,
  });
  const {parseCheckResult} = await import(pathToFileURL(context.entrypoints.kernelCheck).href);
  const result = parseCheckResult(output.stdout);
  if (!result || typeof result.ok !== "boolean" || (result.ok ? output.code !== 0 : output.code !== 1)) throw new Error("Runtime check returned an invalid result or exit code");
  return result;
}

/** Called in the selected Node helper; this is the same pure publication validator. */
export async function evaluateCheck(context: RuntimeContext, request: RuntimeCheck, signal: AbortSignal): Promise<{ ok: boolean; [key: string]: unknown }> {
  ensureActive(signal);
  if (request.kind === "source-draft" || request.kind === "mod-definition" || request.kind === "object-usage") {
    const checks = await import(pathToFileURL(context.entrypoints.kernelCheck).href);
    const result = request.kind === "source-draft"
      ? await checks.checkSourceDraft(context.contentRoot, resolve(context.home, request.packet), resolve(context.home, request.draft))
      : request.kind === "object-usage" ? await checks.checkObjectUsage(resolve(context.home, request.draft))
      : await checks.checkModDefinition(resolve(context.home, request.draft));
    ensureActive(signal);
    return result;
  }
  throw new KernelError({ code: "not_implemented", message: "Unknown runtime check" });
}

/**
 * The provider:model pairs a zero-extension lane child can actually run.
 *
 * The child loads no extensions beyond the provider ones it is handed, so this covers everything
 * else it can resolve: the agent home's `models-store.json` plus `models.json`, with auth from the
 * providers written to `auth.json`. Both registry files are optional; when neither reads, the map
 * is empty and the caller must not judge.
 */
async function childCatalog(agentHome: string): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const catalog = new Map<string, Set<string>>();
  let readable = false;
  const absorb = (provider: unknown, models: unknown) => {
    if (typeof provider !== "string" || !provider.trim() || !Array.isArray(models)) return;
    const ids = catalog.get(provider) ?? new Set<string>();
    for (const entry of models) {
      const id = (entry as { id?: unknown })?.id;
      if (typeof id === "string" && id.trim()) ids.add(id);
    }
    catalog.set(provider, ids);
    readable = true;
  };
  try {
    const store = JSON.parse(await readFile(join(agentHome, "models-store.json"), "utf8"));
    if (store && typeof store === "object" && !Array.isArray(store))
      for (const [provider, entry] of Object.entries(store)) absorb(provider, (entry as { models?: unknown })?.models);
  } catch { /* an absent or half-written store is one source fewer, never a failure */ }
  try {
    const custom = JSON.parse(await readFile(join(agentHome, "models.json"), "utf8"));
    const providers = custom?.providers;
    if (providers && typeof providers === "object" && !Array.isArray(providers))
      for (const [provider, entry] of Object.entries(providers)) absorb(provider, (entry as { models?: unknown })?.models);
  } catch { /* models.json is optional */ }
  return readable ? catalog : new Map();
}

/**
 * The lane model and reasoning effort the operator has chosen **right now**.
 *
 * Read at task time, from the same directory `childCatalog` already reads its registries from,
 * because a process environment cannot change and this choice must. The host used to hand the
 * setting down as `PI_COC_MOD_MODEL`/`PI_COC_MOD_THINKING` in the session's spawn environment, so
 * the value a table ran with was the one that stood when its session started, hours earlier.
 * Retained live evidence (2026-09-14): the operator moved `laneModel` off `grok-build/grok-4.6` at
 * 06:42; the continuity-review child launched at 06:43 still ran `--model grok-build/grok-4.6`, and
 * `ps eww` on the session showed the old value baked in at 06:30. The change was visible in the
 * settings panel, correct, and inert — which reads from the outside exactly like "the faster model
 * did not help", and cost the operator the rest of the outage chasing the wrong thing.
 *
 * Only the *setting* moved here. A real `PI_COC_MOD_MODEL` in the host's own environment is the
 * operator's override and still wins over this, in `runTask` below.
 *
 * The store is the host's own settings document; there is no second copy of the choice to drift
 * from it. Every failure to read it — absent file, half-written JSON, another product's shape, a
 * deployment with no such host at all (the CLI table) — is one source fewer and never an error: the
 * lane then runs on whatever the caller asked for, which is the behaviour that predates the setting.
 */
export const LANE_SETTINGS_FILE = "pipiui-settings.json";
const LANE_EXTENSION = "coc-keeper";

/**
 * The reasoning effort a `mod` lane child runs at when nobody has chosen one (contract §37.11).
 *
 * Not the table's. The table's reasoning effort is a Keeper-quality choice with no relation to a
 * background review. Before §110 the reviewer had a 40 s wall-clock allowance, so `high` could spend
 * the entire allowance inside one unfinished thinking stream; two campaigns died of exactly this on
 * 2026-09-14 (§37.11). §110 removed that interactive deadline in favour of an hour-scale process safety
 * ceiling, but the efforts remain separate: changing Keeper quality must not silently change review
 * latency and cost.
 *
 * `low` rather than `off` or `minimal`, on the authorized lane models' own thinking maps rather
 * than on taste: `grok-build/grok-4.6` maps `off` to null, so pi's `clampThinkingLevel` moves a
 * requested `off` *up* to `minimal`; the DeepSeek family maps `minimal` to null and moves that up
 * to `low`. `low` is the one level both support as written, so it is the only one whose meaning
 * does not change when the lane model does -- and a default that means different things on
 * different models is the same wrong coupling in another costume. It is also what the second
 * campaign was recovered with: set to `low`, the next turn settled in 40 s with `narrate` in 20.6 s.
 */
const LANE_THINKING_DEFAULT = "low";

/**
 * How long a lane child's provider connection may say nothing before its transport gives up
 * (contract §37.12).
 *
 * Not the table's, and not a fraction of the child's safety ceiling either. The agent home's
 * `httpIdleTimeoutMs` is 60 s -- chosen in `runtime/launch.ts` as twice the worst time-to-headers
 * across 15,942 retained table requests. Before §110 a continuity review had only 40 s of wall clock,
 * so that transport timeout could never fire: the child's own timer killed it first and a connection
 * that went quiet arrived as a SIGTERM with no reason instead of the retryable "terminated" that pi's
 * own auto-retry recovers from. Two retained runs are exactly this shape: `.coc/mods/jobs/f1336e40...` sent its request at
 * 04:08:20.656Z, received nothing at all, and was killed at 40,031 ms; `homes/m-main/.coc/mods/jobs/
 * b6242e2a...` took headers and its first chunks at 04:46:03, went silent for 38 s, and was killed at
 * 40,015 ms.
 *
 * **A fraction of `timeoutMs` would be the wrong rule.** How long a healthy stream goes quiet has
 * nothing to do with how much allowance is left, and the reservation shrinks: a second review under
 * `AUDIT_LIMITS.time_ms` reserves only what remains, so "half the budget" lands *inside* the healthy
 * distribution exactly when the allowance is tight, and turns reviews that would have finished into
 * aborted ones. The threshold is a property of the transport, so it is measured from the transport.
 *
 * **25 s, from the lane's own retained streams.** Across 103 continuity-review children and the 4,075
 * gaps between their streamed events (`audit-agent-*.jsonl`), the worst healthy mid-stream silence is
 * 16.42 s -- a real one, inside a thinking stream that went on to settle -- with p99.9 at 10.79 s and
 * the worst time-to-first-token at 10.49 s. 25 s clears the worst observed healthy silence by half
 * again while remaining far below §110's hour-scale process safety ceiling. It measures transport
 * liveness only; a productive stream may take as long as its work requires.
 */
export const LANE_HTTP_IDLE_TIMEOUT_MS = 25_000;

async function laneChoice(agentHome: string): Promise<{ model?: string; thinking?: string }> {
  let document: unknown;
  try { document = JSON.parse(await readFile(join(agentHome, LANE_SETTINGS_FILE), "utf8")); }
  catch { /* no host settings document, or an unreadable one: the caller's own choice stands */ }
  return laneChoiceOf(document);
}

/**
 * The lane choice held in a parsed host settings document, or nothing for any shape that is not one.
 * Shared with the zero-tool lanes (`extensions/lanes/subsession.ts`, contract §107.3), which read the
 * same document at the moment they run: one setting, one store, every lane.
 */
export function laneChoiceOf(document: unknown): { model?: string; thinking?: string } {
  const slot = (document as { extensions?: Record<string, { settings?: unknown }> } | undefined)?.extensions?.[LANE_EXTENSION];
  const stored = slot && typeof slot === "object" ? slot.settings : undefined;
  const pick = (key: string, field: string): string | undefined => {
    const value = (stored as Record<string, unknown> | undefined)?.[key] as Record<string, unknown> | undefined;
    const chosen = value && typeof value === "object" ? value[field] : undefined;
    return typeof chosen === "string" && chosen.trim() ? chosen.trim() : undefined;
  };
  const model = pick("ext.coc-keeper.laneModel", "model");
  const thinking = pick("ext.coc-keeper.laneThinking", "level");
  return { ...(model ? { model } : {}), ...(thinking ? { thinking } : {}) };
}

/**
 * Refuse a lane model the child could not resolve, instead of letting it die unexplained.
 *
 * The child mounts the provider extensions (`providerExtensions`) and reads the agent home's
 * `models-store.json` plus `models.json`; a provider in neither is a model this lane cannot run,
 * and the child's own "Model not found" arrives after the run is already counted as a failure with
 * no events. This used to silently re-point such a model at the alphabetically first other
 * provider carrying the same id, which quietly moved the lane to another account and dropped the
 * extension's own request rewriting: `grok-build/grok-4.6` became `xai/grok-4.6` with nothing said.
 * A lane model is never re-named. Either it runs as written or the caller is told which part of it
 * is unavailable. When neither registry file reads, the catalog is unknown, not empty: the string
 * passes through unjudged and the child's own error stands.
 */
async function ensureChildRunnableModel(context: RuntimeContext, model: string | undefined): Promise<void> {
  if (!model) return;
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return;
  const provider = model.slice(0, slash), id = model.slice(slash + 1);
  const mounted = context.entrypoints.providerExtensionIds;
  if (mounted.includes(provider)) return;
  const catalog = await childCatalog(context.agentHome);
  if (!catalog.size || catalog.get(provider)?.has(id)) return;
  throw new KernelError({ code: "invalid_params", details: { reason: "lane_model_unavailable", model },
    message: `A lane cannot run "${model}": ${catalog.has(provider)
      ? `provider "${provider}" lists no model "${id}"`
      : `no provider "${provider}" is registered for lane children`}. Choose a model from a provider in the agent model registry, or one registered by a mounted provider extension (${mounted.join(", ") || "none are installed"}).` });
}

export const runtimeCapabilities: RuntimeCapabilities = Object.freeze({
  async runTask(context, task, signal) {
    ensureActive(signal);
    if (task.kind !== "reader" && task.kind !== "mod") throw new KernelError({ code: "not_implemented", message: "Unknown runtime task" });
    const request: ReaderRequest = { ...task.request, cwd: resolve(context.home, task.request.cwd), signal };
    // What a lane child runs as is decided here, and only here. The model still falls back to the
    // table's when nobody has chosen one -- a slow model is paid by the player, but any model can
    // finish. The effort does not fall back to the table at all (`LANE_THINKING_DEFAULT`): a review
    // has a fixed wall-clock budget and the table's effort is a Keeper-quality choice with no
    // relation to it, so inheriting one from the other is a wrong coupling rather than a default.
    // The choice is read now rather than inherited from the session's environment, so a change under
    // a running table reaches the next lane child instead of the next session.
    if (task.kind === "mod") {
      const chosen = await laneChoice(context.agentHome);
      request.model = context.env.PI_COC_MOD_MODEL?.trim() || chosen.model || request.model;
      request.thinking = context.env.PI_COC_MOD_THINKING?.trim() || chosen.thinking || LANE_THINKING_DEFAULT;
      // Same shape as the budget knob below: the host's own environment is the operator's override.
      const idle = Number(context.env.PI_COC_MOD_HTTP_IDLE_TIMEOUT_MS);
      request.httpIdleTimeoutMs ??= idle > 0 ? idle : LANE_HTTP_IDLE_TIMEOUT_MS;
    }
    // A fully overridden command is not a Pi child, so its `--model` is never read and the agent
    // registry says nothing about what it can run.
    if (!context.env.PI_COC_READER_CMD?.trim()) await ensureChildRunnableModel(context, request.model);
    request.systemPrompt = await instructions(context, request);
    const configured = Number(context.env[task.kind === "mod" ? "PI_COC_MOD_TIMEOUT_MS" : "PI_COC_READER_TIMEOUT_MS"]);
    request.timeoutMs ??= configured > 0 ? configured : task.kind === "mod" ? 180_000 : undefined;
    let captured = context;
    if (context.env.PI_COC_READER_CMD?.trim()) {
      const command: unknown = JSON.parse(context.env.PI_COC_READER_CMD);
      if (!Array.isArray(command) || !command.length || command.some(part => typeof part !== "string")) throw new Error("PI_COC_READER_CMD must be a non-empty JSON array of strings");
      command[0] = taskExecutable(context, command[0]);
      captured = { ...context, env: { ...context.env, PI_COC_READER_CMD: JSON.stringify(command) } };
    }
    return runReader(request, await readerContext(captured, request, signal));
  },
  check: runCheck,
  async sourceInfo(context, source, signal) {
    ensureActive(signal);
    return sourceOperation(context, "info", {...source, pdf: resolve(context.home, source.pdf)}, signal);
  },
  async sourcePage(context, page, signal) {
    ensureActive(signal);
    return sourceOperation(context, "page", {...page, pdf: resolve(context.home, page.pdf), cache: resolve(context.home, page.cache)}, signal);
  },
});

async function sourceOperation(context: RuntimeContext, kind: "info" | "page", request: object, signal: AbortSignal) {
  const output = await runHostProcess([context.nodeExecutable, context.entrypoints.sourceWorker, kind, JSON.stringify(request)], {
    cwd: context.resourceRoot, env: {...context.env}, signal, outputLimit: 32 * 1024 * 1024,
  });
  const envelope = JSON.parse(output.stdout);
  if (output.code !== 0 || envelope.ok !== true) throw new Error(envelope.error ?? "Source helper failed");
  ensureActive(signal);
  return envelope.result;
}
