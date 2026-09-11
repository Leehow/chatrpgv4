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
  for (const [name, command] of Object.entries(commands)) {
    const path = join(bin, name);
    await writeFile(path, `#!/bin/sh\nexec ${command.map(quote).join(" ")} "$@"\n`);
    await chmod(path, 0o755);
  }
  ensureActive(signal);
  return Object.freeze({ ...context, env: Object.freeze({ ...env, PATH: `${bin}${delimiter}${env.PATH ?? ""}`,
    PI_COC_RUNTIME_OPTIONS: helperOptions(context), PI_COC_READER_CHECK: join(bin, "coc-read-check") }) });
}

async function instructions(context: RuntimeContext, request: ReaderRequest): Promise<string | undefined> {
  if (request.prompt && request.systemPrompt) throw new Error("Conflicting reader instruction forms");
  if (!request.prompt) return request.systemPrompt;
  const { phase, guidance } = request.prompt;
  if (!["index", "read", "verify"].includes(phase)) throw new Error("Unknown reader instruction phase");
  let text: string;
  if (guidance) text = await readFile(join(context.contentRoot, "setup", "visual-guidance.md"), "utf8");
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
  const args = request.kind === "source-draft" ? ["--packet", resolve(context.home, request.packet)] : ["--kind", "mod-definition"];
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
  if (request.kind === "source-draft" || request.kind === "mod-definition") {
    const checks = await import(pathToFileURL(context.entrypoints.kernelCheck).href);
    const result = request.kind === "source-draft"
      ? await checks.checkSourceDraft(context.contentRoot, resolve(context.home, request.packet), resolve(context.home, request.draft))
      : await checks.checkModDefinition(resolve(context.home, request.draft));
    ensureActive(signal);
    return result;
  }
  throw new KernelError({ code: "not_implemented", message: "Unknown runtime check" });
}

/**
 * The provider:model pairs a zero-extension lane child can actually run.
 *
 * The child loads no extensions, so a provider an extension registered into the session's
 * registry (grok-build from grok-build-oauth, for instance) does not exist for it: its catalog
 * is the agent home's `models-store.json` plus `models.json`, its auth the providers written to
 * `auth.json`. Both registry files are optional; when neither reads, the map is empty and the
 * caller must not judge.
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
 * Re-resolve a lane's model against the child-visible catalog before a zero-extension child is
 * spawned with it. A request whose provider is registered only at runtime dies in the child with
 * "Model not found" before it emits a single event -- the 2026-09-11 draft card that never
 * appeared. The model id is the lane's choice and is never second-guessed; only the provider is
 * re-pointed, to the alphabetically first catalog entry that lists the same id and has written
 * credentials. When nothing qualifies -- including an unreadable pair of registry files -- the
 * original string passes through unchanged and the child's own error says why.
 */
async function childRunnableModel(context: RuntimeContext, model: string | undefined): Promise<string | undefined> {
  if (!model) return model;
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return model;
  const provider = model.slice(0, slash), id = model.slice(slash + 1);
  const catalog = await childCatalog(context.agentHome);
  if (!catalog.size) return model;
  if (catalog.get(provider)?.has(id)) return model;
  let authenticated: ReadonlySet<string> = new Set();
  try {
    const auth = JSON.parse(await readFile(join(context.agentHome, "auth.json"), "utf8"));
    if (auth && typeof auth === "object" && !Array.isArray(auth)) authenticated = new Set(Object.keys(auth));
  } catch { /* without the store there is nothing to prefer one candidate over another with */ }
  const candidate = [...catalog.keys()].filter(name => name !== provider && catalog.get(name)!.has(id) && authenticated.has(name)).sort()[0];
  return candidate ? `${candidate}/${id}` : model;
}

export const runtimeCapabilities: RuntimeCapabilities = Object.freeze({
  async runTask(context, task, signal) {
    ensureActive(signal);
    if (task.kind !== "reader" && task.kind !== "mod") throw new KernelError({ code: "not_implemented", message: "Unknown runtime task" });
    const request: ReaderRequest = { ...task.request, cwd: resolve(context.home, task.request.cwd), signal };
    if (task.kind === "mod") request.model = context.env.PI_COC_MOD_MODEL?.trim() || request.model;
    request.model = await childRunnableModel(context, request.model);
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
