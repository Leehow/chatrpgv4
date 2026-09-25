/** Per-owner runtime composition. Game state and request ordering stay in the kernel. */
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";
import { KernelClient, KernelError, type KernelClientOptions } from "../extensions/kernel/client.ts";
import type { ReaderOutcome, ReaderRequest } from "../extensions/module/reader.ts";
import { runtimeCapabilities } from "./tasks.ts";
import { assertWritableLocation, compiledEnvironment, readDeployment, resourcePath, resourceRootFrom,
  runtimeEntrypoints, type RuntimeEntrypoints, type RuntimeLayout } from "./deployment.mjs";

export interface RuntimeBinding {
	owner: "session" | "preparation" | "check";
	home: string;
	campaign?: string;
	signal?: AbortSignal;
}

/** Supplied by host entrypoints; ordinary tasks receive an already composed runtime. */
export interface RuntimeHostOptions {
	layout?: RuntimeLayout;
	backend?: "typescript";
	kernelEntrypoint?: string;
	resourceRoot?: string;
	contentRoot?: string;
	agentHome?: string;
	nodeExecutable?: string;
	env?: NodeJS.ProcessEnv;
	capabilities?: RuntimeCapabilities;
}

export type RuntimeTask = { kind: "reader" | "mod"; request: Omit<ReaderRequest, "signal"> };
export type RuntimeCheck = { kind: "source-draft"; packet: string; draft: string }
	| { kind: "mod-definition" | "object-usage"; draft: string };
export type RuntimeSource = { pdf: string; cache: string };
export type RuntimeSourceSearch = { pdf: string } & import('../extensions/module/source.ts').SourceSearchOptions;
export type RuntimeSourceText = { pdf: string } & import('../extensions/module/source.ts').SourceTextOptions;
export type RuntimeSourceWindow = { pdf: string } & import('../extensions/module/source.ts').SourceWindowOptions;
export type RuntimePage = RuntimeSource & { page: number; box?: number[]; pixels?: number; format?: "png" | "jpeg" };
type SourceInfo = Awaited<ReturnType<typeof import("../extensions/module/source.ts").sourceInfo>>;
type SourcePage = Awaited<ReturnType<typeof import("../extensions/module/source.ts").sourcePage>>;
type SourceSearch = Awaited<ReturnType<typeof import('../extensions/module/source.ts').sourceSearch>>;
type SourceText = Awaited<ReturnType<typeof import('../extensions/module/source.ts').sourceText>>;
type SourceWindow = Awaited<ReturnType<typeof import('../extensions/module/source.ts').sourceWindow>>;

/** Captured deployment inputs are visible only to the host's fixed capability adapters. */
export interface RuntimeContext {
	readonly layout: RuntimeLayout;
	readonly entrypoints: RuntimeEntrypoints;
	readonly backend: "typescript";
	readonly resourceRoot: string;
	readonly contentRoot: string;
	readonly agentHome: string;
	readonly nodeExecutable: string;
	readonly home: string;
	readonly env: Readonly<NodeJS.ProcessEnv>;
}

export interface RuntimeCapabilities {
	runTask?(context: RuntimeContext, task: RuntimeTask, signal: AbortSignal): Promise<ReaderOutcome>;
	check?(context: RuntimeContext, request: RuntimeCheck, signal: AbortSignal): Promise<{ ok: boolean; [key: string]: unknown }>;
	sourceInfo?(context: RuntimeContext, source: RuntimeSource, signal: AbortSignal): Promise<SourceInfo>;
	sourcePage?(context: RuntimeContext, page: RuntimePage, signal: AbortSignal): Promise<SourcePage>;
	sourceSearch?(context: RuntimeContext, request: RuntimeSourceSearch, signal: AbortSignal): Promise<SourceSearch>;
	sourceText?(context: RuntimeContext, request: RuntimeSourceText, signal: AbortSignal): Promise<SourceText>;
	sourceWindow?(context: RuntimeContext, request: RuntimeSourceWindow, signal: AbortSignal): Promise<SourceWindow>;
}

type ConnectionOptions = Pick<KernelClientOptions, "timeoutMs" | "onDiagnostic" | "onRestart">;

export interface HostRuntime {
	readonly owner: RuntimeBinding["owner"];
	readonly home: string;
	readonly resourceRoot: string;
	readonly contentRoot: string;
	readonly readerModel: string | undefined;
	readonly campaign: string | undefined;
	readonly signal: AbortSignal;
	openKernel(options?: ConnectionOptions): KernelClient;
	runTask(task: RuntimeTask, signal?: AbortSignal): Promise<ReaderOutcome>;
	check(request: RuntimeCheck, signal?: AbortSignal): Promise<{ ok: boolean; [key: string]: unknown }>;
	sourceInfo(source: RuntimeSource, signal?: AbortSignal): Promise<SourceInfo>;
	sourcePage(page: RuntimePage, signal?: AbortSignal): Promise<SourcePage>;
	sourceSearch(request: RuntimeSourceSearch, signal?: AbortSignal): Promise<SourceSearch>;
	sourceText(request: RuntimeSourceText, signal?: AbortSignal): Promise<SourceText>;
	/** Contract §14.16: extract a physical page window of an original PDF into its own file. */
	sourceWindow(request: RuntimeSourceWindow, signal?: AbortSignal): Promise<SourceWindow>;
	close(): Promise<void>;
}

function failure(reason: string, message: string): KernelError {
	return new KernelError({ code: "internal", message, details: { reason } });
}

function location(value: string, base: string): string {
	if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
		throw new Error("Runtime locations must be non-empty paths without null bytes");
	}
	const expanded = value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
	return resolve(base, expanded);
}

function executable(command: string, cwd: string, env: NodeJS.ProcessEnv): string {
	if (!command?.trim() || command.includes("\0")) throw new Error("Runtime executable is empty or invalid");
	const paths = isAbsolute(command) || command.includes("/") || command.includes("\\")
		? [resolve(cwd, command)]
		: (env.PATH ?? "").split(delimiter).filter(Boolean).map(path => resolve(cwd, path, command));
	for (const path of paths) {
		try {
			if (!statSync(path).isFile()) continue;
			accessSync(path, constants.X_OK);
			return path;
		} catch { /* Check only the host's captured search path. */ }
	}
	throw new Error(`Runtime executable is unavailable: ${command}`);
}

function backend(host: RuntimeHostOptions, env: NodeJS.ProcessEnv): "typescript" {
	const selected = host.backend ?? env.PI_COC_RUNTIME ?? "typescript";
	if (selected === "python") throw new Error("The Python runtime is retired; use TypeScript. Historical Python references are test-only.");
	if (selected !== "typescript") throw new Error(`Unknown runtime backend: ${selected}`);
	return selected;
}

/** Compatibility export for existing launch assertions; also used by composition. */
export function kernelCommand(home: string, host: RuntimeHostOptions = {}): string[] {
	const env = host.env ?? process.env;
	const root = resolve(host.resourceRoot ?? resourceRootFrom(import.meta.url, env));
	const compiled = host.layout === "compiled" || env.PI_COC_LAYOUT === "compiled" || existsSync(join(root, "deployment.json"));
	const deployment = compiled ? readDeployment(root) : undefined;
	backend(host, env);
	if (deployment && host.nodeExecutable && location(host.nodeExecutable, root) !== deployment.node) throw new Error("Standalone deployments require their managed Node executable");
	if (deployment && host.kernelEntrypoint && location(host.kernelEntrypoint, root) !== deployment.entrypoints.kernel) throw new Error("Standalone deployments require their emitted kernel entrypoint");
	if (env.PI_COC_KERNEL_CMD?.trim()) {
		if (compiled) throw new Error("Standalone deployments cannot override the kernel command");
		const command: unknown = JSON.parse(env.PI_COC_KERNEL_CMD);
		if (!Array.isArray(command) || !command.length || command.some(part => typeof part !== "string")) {
			throw new Error("PI_COC_KERNEL_CMD must be a non-empty JSON array of strings");
		}
		return [...command];
	}
	return [deployment?.node ?? host.nodeExecutable ?? env.PI_COC_NODE_EXECUTABLE ?? process.execPath, resolve(root, host.kernelEntrypoint ?? "build/kernel/rpc.mjs"), "--workspace", home,
		"--content", resolve(root, host.contentRoot ?? env.PI_COC_CONTENT_ROOT ?? "content")];
}

/** Host adapters reuse the same immutable locations and environment without starting a kernel. */
export function composeRuntimeContext(binding: RuntimeBinding, host: RuntimeHostOptions = {}): RuntimeContext {
	if (binding.signal?.aborted) throw failure("runtime_cancelled", "The runtime owner is cancelled");
	try {
		if (!["session", "preparation", "check"].includes(binding.owner)) throw new Error("Unknown runtime owner kind");
		let env = { ...(host.env ?? process.env) };
		const cwd = location(host.resourceRoot ?? resourceRootFrom(import.meta.url, env), process.cwd());
		const layout = host.layout ?? env.PI_COC_LAYOUT ?? (existsSync(join(cwd, "deployment.json")) ? "compiled" : "source");
		if (layout !== "source" && layout !== "compiled") throw new Error(`Unknown runtime layout: ${layout}`);
		if (layout === "source" && existsSync(join(cwd, "deployment.json"))) throw new Error("A standalone deployment cannot use source launch paths");
		const deployment = layout === "compiled" ? readDeployment(cwd) : undefined;
		const contentRoot = location(host.contentRoot ?? env.PI_COC_CONTENT_ROOT ?? "content", cwd);
		const home = location(binding.home, process.cwd());
		for (const path of [cwd, contentRoot]) {
			if (!statSync(path).isDirectory()) throw new Error(`Runtime resource is not a directory: ${path}`);
			accessSync(path, constants.R_OK | constants.X_OK);
		}
		const selected = backend({ ...host, layout }, env);
		const agentHome = location(host.agentHome ?? env.PI_CODING_AGENT_DIR ?? join(cwd, ".pi", "coc-agent"), cwd);
		let entrypoints = deployment?.entrypoints ?? runtimeEntrypoints(cwd, layout);
		if (deployment) {
			if (env.PI_COC_KERNEL_CMD?.trim() || env.PI_COC_READER_CMD?.trim()) throw new Error("Standalone deployments cannot override runtime process commands");
			if (host.nodeExecutable && location(host.nodeExecutable, cwd) !== deployment.node) throw new Error("Standalone deployments require their managed Node executable");
			if (host.kernelEntrypoint && location(host.kernelEntrypoint, cwd) !== entrypoints.kernel) throw new Error("Standalone deployments require their emitted kernel entrypoint");
			resourcePath(cwd, relative(cwd, contentRoot), "directory");
			assertWritableLocation(cwd, home);
			assertWritableLocation(cwd, agentHome);
			env = compiledEnvironment(deployment, env);
		}
		if (host.kernelEntrypoint) entrypoints = Object.freeze({ ...entrypoints, kernel: location(host.kernelEntrypoint, cwd) });
		const nodeExecutable = executable(deployment?.node ?? host.nodeExecutable ?? env.PI_COC_NODE_EXECUTABLE ?? process.execPath, cwd, env);
		return Object.freeze({ layout, entrypoints, backend: selected, resourceRoot: cwd, contentRoot, home, agentHome, nodeExecutable,
			env: Object.freeze({ ...env, PI_COC_RESOURCE_ROOT: cwd, PI_COC_CONTENT_ROOT: contentRoot, PI_COC_LAYOUT: layout,
				PI_COC_RUNTIME: selected, PI_COC_NODE_EXECUTABLE: nodeExecutable, PI_COC_HOME: home, PI_CODING_AGENT_DIR: agentHome,
				PI_COC_CAMPAIGN: binding.campaign }) });
	} catch (error) {
		throw failure("runtime_configuration", `Runtime configuration failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function createRuntime(binding: RuntimeBinding, host: RuntimeHostOptions = {}): HostRuntime {
	const context = composeRuntimeContext(binding, host);
	const { home, resourceRoot, contentRoot, nodeExecutable, env } = context;
	let launch: Pick<KernelClientOptions, "command" | "cwd" | "env" | "inheritEnv">;
	try {
		const command = kernelCommand(home, { ...host, layout: context.layout, backend: context.backend,
			kernelEntrypoint: context.entrypoints.kernel, resourceRoot, contentRoot, nodeExecutable, env });
		command[0] = executable(command[0], resourceRoot, env);
		if (!env.PI_COC_KERNEL_CMD?.trim()) accessSync(command[1], constants.R_OK);
		launch = { command, cwd: resourceRoot, inheritEnv: false, env: { ...env } };
	} catch (error) {
		throw failure("runtime_configuration", `Runtime configuration failed: ${error instanceof Error ? error.message : String(error)}`);
	}

	const controller = new AbortController();
	const signal = binding.signal ? AbortSignal.any([binding.signal, controller.signal]) : controller.signal;
	let client: KernelClient | undefined;
	let closed = false;
	let closing: Promise<void> | undefined;
	const capabilities = Object.freeze({ ...runtimeCapabilities, ...host.capabilities });
	const active = new Set<Promise<unknown>>();
	function operation<T>(name: string, run: ((signal: AbortSignal) => Promise<T>) | undefined, cancellation?: AbortSignal): Promise<T> {
		const operationSignal = cancellation ? AbortSignal.any([signal, cancellation]) : signal;
		const ensureOpen = () => {
			if (closed || operationSignal.aborted) throw failure("runtime_closed", "The runtime owner or operation is closed or cancelled");
		};
		const pending = Promise.resolve().then(() => {
			ensureOpen();
			if (!run) throw new KernelError({ code: "not_implemented", message: `Runtime capability is unavailable: ${name}` });
			return run(operationSignal);
		}).then(result => { ensureOpen(); return result; });
		active.add(pending);
		void pending.then(() => active.delete(pending), () => active.delete(pending));
		return pending;
	}
	function drain(): Promise<void> {
		if (!active.size) return Promise.resolve();
		let timer: NodeJS.Timeout;
		const deadline = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => reject(failure("runtime_shutdown", "Runtime tasks did not stop after cancellation")), 5000);
		});
		return Promise.race([Promise.allSettled([...active]).then(() => undefined), deadline]).finally(() => clearTimeout(timer));
	}
	function close(): Promise<void> {
		if (closing) return closing;
		closed = true;
		signal.removeEventListener("abort", cancelled);
		controller.abort();
		closing = Promise.all([client?.close(), drain()]).then(() => undefined);
		return closing;
	}
	function cancelled(): void { void close().catch(() => undefined); }
	signal.addEventListener("abort", cancelled, { once: true });
	return Object.freeze({ owner: binding.owner, home, resourceRoot, contentRoot,
		readerModel: env.PI_COC_BUILD_MODEL?.trim(), campaign: binding.campaign, signal,
		openKernel(options: ConnectionOptions = {}) {
			if (closed || signal.aborted) throw failure("runtime_closed", "The runtime owner is closed or cancelled");
			client ??= new KernelClient({ ...options, ...launch });
			client.start();
			return client;
		},
		runTask: (task, cancellation) => operation("runTask", capabilities.runTask && (s => capabilities.runTask!(context, task, s)), cancellation),
		check: (request, cancellation) => operation("check", capabilities.check && (s => capabilities.check!(context, request, s)), cancellation),
		sourceInfo: (source, cancellation) => operation("sourceInfo", capabilities.sourceInfo && (s => capabilities.sourceInfo!(context, source, s)), cancellation),
		sourcePage: (page, cancellation) => operation("sourcePage", capabilities.sourcePage && (s => capabilities.sourcePage!(context, page, s)), cancellation),
		sourceSearch: (request, cancellation) => operation('sourceSearch', capabilities.sourceSearch && (s => capabilities.sourceSearch!(context, request, s)), cancellation),
		sourceText: (request, cancellation) => operation('sourceText', capabilities.sourceText && (s => capabilities.sourceText!(context, request, s)), cancellation),
		sourceWindow: (request, cancellation) => operation('sourceWindow', capabilities.sourceWindow && (s => capabilities.sourceWindow!(context, request, s)), cancellation),
		close,
	} satisfies HostRuntime);
}

// -- Provider model data corrections (contract §135.27.1, SL-61) --------------------------
//
// Provider model data the product knows to be wrong (e.g. a catalog entry that omits a thinking
// level the endpoint actually supports) is corrected as data: a corrections file shipped with the
// product (`content/providers/model-corrections.json` by default, Pi's own `models.json`
// `modelOverrides` field shapes) is merged into the agent home's `models.json` whenever the host
// prepares the home for a table (`runtime/launch.ts`'s `piLaunch`, right where it already
// creates the home directory and reconciles `settings.json`). A user's own override for the same
// provider+model always wins and is never replaced; every other provider and field in the user's
// file is left exactly as read.

export interface ProviderModelCorrectionEntry {
  readonly provider: string;
  readonly model: string;
}

/**
 * Strip `//` and `/* *\/` comments outside string literals, matching the tolerance Pi's own
 * `models.json` loader has (`stripJsonComments`) -- an operator's hand-edited file, or an earlier
 * run's own corrections note (below), may carry either.
 */
function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") { out += text[i + 1] ?? ""; i++; continue; }
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; quote = ch; out += ch; continue; }
    if (ch === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++; continue;
    }
    out += ch;
  }
  return out;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Drop `$comment`-prefixed documentation keys the corrections source file carries for maintainers. */
function stripDocumentationKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDocumentationKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith("$comment")) continue;
      out[key] = stripDocumentationKeys(entry);
    }
    return out;
  }
  return value;
}

/**
 * Pure merge: for every provider+model the corrections data names, add its override under the
 * user's `providers.<id>.modelOverrides.<model>` only if the user has none there yet. A model the
 * user already has an override for -- any keys, not just `thinkingLevelMap` -- is never touched;
 * neither is any other provider or field the existing config carries. Takes and returns plain
 * JSON values so it needs no filesystem access and is safe to call from a test with fixtures held
 * only in memory.
 */
export function mergeProviderModelCorrections(existingModelsJson: unknown, corrections: unknown):
  { config: Record<string, unknown>; entries: ProviderModelCorrectionEntry[] } {
  const config: Record<string, unknown> = structuredClone(jsonObject(existingModelsJson));
  const providers = jsonObject(config.providers);
  config.providers = providers;
  const correctionProviders = jsonObject(jsonObject(corrections).providers);
  const entries: ProviderModelCorrectionEntry[] = [];
  for (const [providerId, providerCorrection] of Object.entries(correctionProviders)) {
    const overrides = jsonObject(jsonObject(providerCorrection).modelOverrides);
    for (const [modelId, override] of Object.entries(overrides)) {
      entries.push({ provider: providerId, model: modelId });
      const providerEntry = jsonObject(providers[providerId]);
      providers[providerId] = providerEntry;
      const modelOverrides = jsonObject(providerEntry.modelOverrides);
      providerEntry.modelOverrides = modelOverrides;
      if (Object.prototype.hasOwnProperty.call(modelOverrides, modelId)) continue; // the user's own override wins, untouched
      modelOverrides[modelId] = stripDocumentationKeys(override);
    }
  }
  return { config, entries };
}

function correctionsNote(entries: readonly ProviderModelCorrectionEntry[]): string {
  if (!entries.length) return "";
  const lines = entries.map(({ provider, model }) => `//   - ${provider}/${model}`);
  return [
    "// Product corrections merged by chatrpgv4 (contract §135.27.1; source",
    "// content/providers/model-corrections.json). An entry below is added only where you had none",
    "// of your own for that exact provider+model; your own overrides are never replaced. The",
    "// product currently knows a correction for:",
    ...lines,
    "",
  ].join("\n");
}

/**
 * Merge the product's provider model corrections into `<agentHome>/models.json`. Called at host
 * preparation for a table, alongside the `settings.json` reconciliation in `runtime/launch.ts`'s
 * `piLaunch`; idempotent, so calling it on every launch is correct. A missing corrections file (a
 * fixture repo, a deployment that predates this file) is one correction fewer, never a failure,
 * matching `childCatalog`'s tolerance for `models-store.json`/`models.json` in `runtime/tasks.ts`.
 * A `models.json` that fails to parse even after stripping comments is left untouched rather than
 * blocking the table: Pi's own loader degrades the same way (`ModelConfig.load` disables custom
 * models and records `getError()`, but still starts).
 */
export async function applyProviderModelCorrections(agentHome: string, correctionsPath: string): Promise<void> {
  let correctionsText: string;
  try { correctionsText = await readFile(correctionsPath, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const corrections: unknown = JSON.parse(correctionsText);
  const modelsPath = join(agentHome, "models.json");
  let existingText = "";
  try { existingText = await readFile(modelsPath, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let existing: unknown = {};
  if (existingText.trim()) {
    try { existing = JSON.parse(stripJsonComments(existingText)); }
    catch { return; } // a hand-broken models.json is the operator's; Pi's own loader will also flag it
  }
  const { config, entries } = mergeProviderModelCorrections(existing, corrections);
  const body = `${correctionsNote(entries)}${JSON.stringify(config, null, 2)}\n`;
  if (body === existingText) return;
  await writeFile(modelsPath, body, "utf8");
}
