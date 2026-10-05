/** Per-owner runtime composition. Game state and request ordering stay in the kernel. */
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";
import { KernelClient, KernelError, type KernelClientOptions } from "../extensions/kernel/client.ts";
import type { ReaderOutcome, ReaderRequest } from "../extensions/module/reader.ts";
import { runtimeCapabilities } from "./tasks.ts";
import {readJevApiKey} from '../extensions/jev/agent/config.js';
import { parseModelsJson, stripLineComments } from "./json-comments.ts";
import { assertWritableLocation, compiledEnvironment, readDeployment, resourcePath, resourceRootFrom,
  runtimeEntrypoints, type RuntimeEntrypoints, type RuntimeLayout } from "./deployment.mjs";

// Profile installation loads manifest discovery from this shipped bundle.
export { agentExtensionManifests } from "./deployment.mjs";

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
	| { kind: "mod-definition" | "object-usage" | "module-cast"; draft: string };
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

type ConnectionOptions = Pick<KernelClientOptions, "timeoutMs" | "onDiagnostic" | "onRestart" | "prepareCall" | "hostOnlyParams">;

export interface HostRuntime {
	readonly sourceReferences?: boolean;
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
		sourceReferences:!!readJevApiKey(context.env),
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
// creates the home directory and reconciles `settings.json`). A user's own value always wins and is
// never replaced -- key by key: an override the user wrote for the same provider+model keeps every
// key it sets, and only the keys it never mentions are filled from the correction. Every other
// provider and field in the user's file is left exactly as read. The file is written as strict JSON
// (§135.27.1.1): the App reads and rewrites it with plain `JSON.parse`/`JSON.stringify`.

export interface ProviderModelCorrectionEntry {
  readonly provider: string;
  readonly model: string;
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
 * Fill `target` with the keys of `source` it does not have, descending into objects both sides hold.
 * A key `target` already has -- whatever its value, `null` included -- is the user's and stays.
 */
function fillMissingKeys(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) { target[key] = value; continue; }
    const mine = target[key];
    if (mine && typeof mine === "object" && !Array.isArray(mine) && value && typeof value === "object" && !Array.isArray(value))
      fillMissingKeys(mine as Record<string, unknown>, value as Record<string, unknown>);
  }
}

/**
 * Pure merge: for every provider+model the corrections data names, merge its override into the
 * user's `providers.<id>.modelOverrides.<model>` key by key. A key the user already set -- in
 * `thinkingLevelMap` or anywhere else, `null` included -- is the user's and is never replaced; a
 * key the user never mentions is filled from the correction. (09-29: a hand-written
 * `thinkingLevelMap: {low: "low"}` used to shadow the whole `off: "off"` correction, so a fast
 * model set to `off` ran on the catalog's `off: null`.) No other provider or field the existing
 * config carries is touched. Takes and returns plain JSON values so it needs no filesystem access
 * and is safe to call from a test with fixtures held only in memory.
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
      const correction = jsonObject(stripDocumentationKeys(override));
      if (!Object.prototype.hasOwnProperty.call(modelOverrides, modelId)) { modelOverrides[modelId] = correction; continue; }
      const mine = modelOverrides[modelId];
      if (mine && typeof mine === "object" && !Array.isArray(mine)) fillMissingKeys(mine as Record<string, unknown>, correction);
    }
  }
  return { config, entries };
}

/**
 * The product-owned top-level key that carries the merge's note (§135.27.1.1). The App's own
 * readers and writers of `models.json` are strict JSON, so the note is data, not a comment: every
 * writer round-trips it, and Pi's schema accepts an extra top-level key. `$comment`-prefixed like the
 * corrections source's own documentation keys.
 */
export const PRODUCT_NOTE_KEY = "$comment-chatrpgv4";

/** The `//` header this merge wrote from 2026-09-25 to 2026-10-03 (§135.27.1.1): these lines, then one `//   - p/m` per entry. */
const LEGACY_HEADER_LINES = [
  "// Product corrections merged by chatrpgv4 (contract §135.27.1; source",
  "// content/providers/model-corrections.json). A key below is filled in only where your own",
  "// override for that exact provider+model does not set it; a key you set is never replaced. The",
  "// product currently knows a correction for:",
];
const LEGACY_HEADER_ENTRY = "//   - ";

function correctionsNote(entries: readonly ProviderModelCorrectionEntry[]): string[] {
  return [
    "Provider model corrections merged by chatrpgv4 (contract §135.27.1; source content/providers/model-corrections.json).",
    "Each is merged into providers.<id>.modelOverrides.<model> key by key: a key is filled in only where your own override for that exact provider+model does not set it; a key you set is never replaced.",
    `Corrected: ${entries.map(({ provider, model }) => `${provider}/${model}`).join(", ")}.`,
    "This key is the product's and is rewritten at every launch. The product writes no comments into this file, and leaves a file that carries yours untouched.",
  ];
}

/** Drop the header this merge used to write, matched line by line against its own bytes, and nothing else. */
function withoutLegacyHeader(text: string): string {
  const lines = text.split("\n");
  if (!LEGACY_HEADER_LINES.every((line, index) => lines[index] === line)) return text;
  let index = LEGACY_HEADER_LINES.length;
  while (index < lines.length && lines[index].startsWith(LEGACY_HEADER_ENTRY)) index++;
  return lines.slice(index).join("\n");
}

function modelOverrideOf(config: unknown, { provider, model }: ProviderModelCorrectionEntry): unknown {
  return jsonObject(jsonObject(jsonObject(jsonObject(config).providers)[provider]).modelOverrides)[model];
}

export type ProviderModelCorrectionsOutcome =
  | { readonly status: "written" | "unchanged" | "no_corrections_file" }
  | { readonly status: "left_untouched"; readonly reason: "unparsable"; readonly error: string }
  | { readonly status: "left_untouched"; readonly reason: "operator_comments"; readonly missing: readonly ProviderModelCorrectionEntry[] };

/**
 * Merge the product's provider model corrections into `<agentHome>/models.json`. Called at host
 * preparation for a table, alongside the `settings.json` reconciliation in `runtime/launch.ts`'s
 * `piLaunch`; idempotent, so calling it on every launch is correct. A missing corrections file (a
 * fixture repo, a deployment that predates this file) is one correction fewer, never a failure,
 * matching `childCatalog`'s tolerance for `models-store.json`/`models.json` in `runtime/tasks.ts`.
 * The file is read in Pi's own grammar (§135.27.1.2, `parseModelsJson`). A `models.json` that does
 * not parse in it is left untouched rather than blocking the table: Pi's own loader fails on the same
 * text and degrades the same way (`ModelConfig.load` disables custom models and records `getError()`,
 * but still starts).
 *
 * The file written is strict JSON (§135.27.1.1): the note is `PRODUCT_NOTE_KEY`, the header the
 * merge used to write is dropped, and a file that still carries `//` comments after that is an
 * operator's, left byte for byte as it was, with the corrections that did not land reported. A
 * trailing comma or a BOM is not a comment: nothing is lost when the rewrite drops it.
 */
export async function applyProviderModelCorrections(agentHome: string, correctionsPath: string): Promise<ProviderModelCorrectionsOutcome> {
  let correctionsText: string;
  try { correctionsText = await readFile(correctionsPath, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "no_corrections_file" };
    throw error;
  }
  const corrections: unknown = JSON.parse(correctionsText);
  const modelsPath = join(agentHome, "models.json");
  let existingText = "";
  try { existingText = await readFile(modelsPath, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const source = withoutLegacyHeader(existingText);
  let existing: unknown = {};
  if (source.trim()) {
    try { existing = parseModelsJson(source); }
    catch (error) {
      // The operator's; Pi's own loader fails on the same text, with this message (§135.27.1.2).
      return { status: "left_untouched", reason: "unparsable", error: error instanceof Error ? error.message : String(error) };
    }
  }
  const { config, entries } = mergeProviderModelCorrections(existing, corrections);
  if (stripLineComments(source) !== source) {
    // An operator wrote these comments; no strict-JSON rewrite could keep them.
    const missing = entries.filter(entry =>
      JSON.stringify(modelOverrideOf(existing, entry)) !== JSON.stringify(modelOverrideOf(config, entry)));
    return { status: "left_untouched", reason: "operator_comments", missing };
  }
  const rest: Record<string, unknown> = { ...config };
  delete rest[PRODUCT_NOTE_KEY];
  const body = `${JSON.stringify(entries.length ? { [PRODUCT_NOTE_KEY]: correctionsNote(entries), ...rest } : rest, null, 2)}\n`;
  if (body === existingText) return { status: "unchanged" };
  await writeFile(modelsPath, body, "utf8");
  return { status: "written" };
}
