/** Fixed host adapters; checking never opens a kernel or publishes an artifact. */
import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { KernelError } from "../extensions/kernel/client.ts";
import { runReader, type ReaderRequest } from "../extensions/module/reader.ts";
import type { RuntimeCapabilities, RuntimeCheck, RuntimeContext } from "./host.ts";

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const cancelled = () => new KernelError({ code: "internal", message: "Runtime operation was cancelled", details: { reason: "runtime_cancelled" } });
function ensureActive(signal: AbortSignal) { if (signal.aborted) throw cancelled(); }

/** Resolve the locked Python environment from the host's captured deployment inputs. */
function pythonConfiguration(context: RuntimeContext) {
  const paths = (context.env.PATH ?? "").split(delimiter).filter(Boolean).map(path => resolve(context.resourceRoot, path, "uv"));
  const uv = paths.find(path => {
    try { accessSync(path, constants.X_OK); return statSync(path).isFile(); } catch { return false; }
  });
  if (!uv) throw new KernelError({ code: "internal", message: "The managed Python launcher is unavailable", details: { reason: "runtime_configuration" } });
  return { command: [uv, "run", "--project", context.resourceRoot, "--frozen", "python"],
    env: { ...context.env, PYTHONPATH: join(context.resourceRoot, "kernel"), PYTHONDONTWRITEBYTECODE: "1" } };
}

/** The standalone helper receives only deployment locations, never a serialized environment. */
function helperOptions(context: RuntimeContext) {
  return JSON.stringify({ backend: context.backend, resourceRoot: context.resourceRoot, contentRoot: context.contentRoot,
    agentHome: context.agentHome, nodeExecutable: context.nodeExecutable });
}

async function readerContext(context: RuntimeContext, request: ReaderRequest, signal: AbortSignal): Promise<RuntimeContext> {
  ensureActive(signal);
  const bin = join(request.cwd, "host-bin");
  await mkdir(bin, { recursive: true });
  const commands: Record<string, string[]> = {
    "coc-read-check": [context.nodeExecutable, join(context.resourceRoot, "runtime", "check.ts")],
    "coc-source": [context.nodeExecutable, join(context.resourceRoot, "extensions", "module", "source.ts")],
  };
  let env = { ...context.env };
  if (context.backend === "python" && request.systemPrompt) {
    const python = pythonConfiguration(context);
    commands.python = commands.python3 = python.command;
    env = python.env;
  }
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
  ensureActive(signal);
  if (context.backend === "typescript" && (request.kind === "source-draft" || request.kind === "mod-definition")) {
    const checks = await import(pathToFileURL(join(context.resourceRoot, "build/kernel/check.mjs")).href);
    const result = request.kind === "source-draft"
      ? await checks.checkSourceDraft(context.contentRoot, resolve(context.home, request.packet), resolve(context.home, request.draft))
      : await checks.checkModDefinition(resolve(context.home, request.draft));
    ensureActive(signal);
    return result;
  }
  if (context.backend !== "python") throw new KernelError({ code: "not_implemented", message: `Runtime check is unavailable for ${context.backend}: ${request.kind}` });
  const args = request.kind === "source-draft"
    ? ["-m", "coc.modules.visual_check", "--packet", resolve(context.home, request.packet), "--draft", resolve(context.home, request.draft)]
    : request.kind === "mod-definition" ? ["-m", "coc.mods.check", resolve(context.home, request.draft)] : undefined;
  if (!args) throw new KernelError({ code: "not_implemented", message: "Unknown runtime check" });
  const python = pythonConfiguration(context);
  return new Promise((accept, reject) => {
    const grouped = process.platform !== "win32";
    let stdout = "", stderr = "", failure: Error | undefined, stopped = false;
    let hardKill: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(python.command[0], [...python.command.slice(1), ...args], {
      cwd: context.resourceRoot, env: python.env, stdio: ["ignore", "pipe", "pipe"], detached: grouped,
    });
    const kill = (signal: NodeJS.Signals) => {
      try { if (grouped && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* The owned process is already gone. */ }
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      kill("SIGTERM");
      hardKill = setTimeout(() => kill("SIGKILL"), 2000);
    };
    const timeout = setTimeout(() => { failure = new Error("Runtime check timed out"); stop(); }, 30_000);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (failure) return;
      stdout += chunk;
      if (Buffer.byteLength(stdout) > 4 * 1024 * 1024) { failure = new Error("Runtime check output exceeded its limit"); stop(); }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });
    child.on("error", error => { failure = error; });
    child.once("exit", () => {
      clearTimeout(timeout);
      // Stop descendants before waiting for the inherited output pipes to close.
      if (grouped && child.pid) stop();
    });
    child.on("close", code => {
      clearTimeout(timeout);
      if (hardKill) clearTimeout(hardKill);
      signal.removeEventListener("abort", stop);
      if (grouped && child.pid) kill("SIGKILL");
      if (signal.aborted) return reject(cancelled());
      if (failure) return reject(failure);
      try {
        const result = JSON.parse(stdout);
        if (!result || typeof result !== "object" || Array.isArray(result) || typeof result.ok !== "boolean" ||
          (result.ok ? code !== 0 : code !== 1)) throw new Error("Runtime check returned an invalid result or exit code");
        accept(result);
      } catch (error) { reject(new Error(`Runtime check failed: ${error instanceof Error ? error.message : String(error)}${stderr ? `; ${stderr}` : ""}`)); }
    });
  });
}

export const runtimeCapabilities: RuntimeCapabilities = Object.freeze({
  async runTask(context, task, signal) {
    ensureActive(signal);
    if (task.kind !== "reader" && task.kind !== "mod") throw new KernelError({ code: "not_implemented", message: "Unknown runtime task" });
    const request: ReaderRequest = { ...task.request, cwd: resolve(context.home, task.request.cwd), signal };
    if (task.kind === "mod") request.model = context.env.PI_COC_MOD_MODEL?.trim() || request.model;
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
    const { sourceInfo } = await import("../extensions/module/source.ts");
    const result = await sourceInfo(resolve(context.home, source.pdf));
    ensureActive(signal);
    return result;
  },
  async sourcePage(context, page, signal) {
    ensureActive(signal);
    const { sourcePage } = await import("../extensions/module/source.ts");
    const result = await sourcePage(resolve(context.home, page.pdf), resolve(context.home, page.cache), page.page, page);
    ensureActive(signal);
    return result;
  },
});
