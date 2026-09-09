/** Per-owner runtime composition. Game state and request ordering stay in the kernel. */
import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KernelClient, KernelError, type KernelClientOptions } from "../extensions/kernel/client.ts";
import type { ReaderOutcome, ReaderRequest } from "../extensions/module/reader.ts";
import { runtimeCapabilities } from "./tasks.ts";

const RESOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface RuntimeBinding {
	owner: "session" | "preparation" | "check";
	home: string;
	campaign?: string;
	signal?: AbortSignal;
}

/** Supplied by host entrypoints; ordinary tasks receive an already composed runtime. */
export interface RuntimeHostOptions {
	backend?: "python" | "typescript";
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
	| { kind: "mod-definition"; draft: string };
export type RuntimeSource = { pdf: string; cache: string };
export type RuntimePage = RuntimeSource & { page: number; box?: number[]; pixels?: number; format?: "png" | "jpeg" };
type SourceInfo = Awaited<ReturnType<typeof import("../extensions/module/source.ts").sourceInfo>>;
type SourcePage = Awaited<ReturnType<typeof import("../extensions/module/source.ts").sourcePage>>;

/** Captured deployment inputs are visible only to the host's fixed capability adapters. */
export interface RuntimeContext {
	readonly backend: "python" | "typescript";
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

function backend(host: RuntimeHostOptions, env: NodeJS.ProcessEnv): "python" | "typescript" {
	const selected = host.backend ?? env.PI_COC_RUNTIME ?? "python";
	if (selected !== "python" && selected !== "typescript") throw new Error(`Unknown runtime backend: ${selected}`);
	return selected;
}

/** Compatibility export for existing launch assertions; also used by composition. */
export function kernelCommand(home: string, host: RuntimeHostOptions = {}): string[] {
	const env = host.env ?? process.env;
	if (env.PI_COC_KERNEL_CMD?.trim()) {
		const command: unknown = JSON.parse(env.PI_COC_KERNEL_CMD);
		if (!Array.isArray(command) || !command.length || command.some(part => typeof part !== "string")) {
			throw new Error("PI_COC_KERNEL_CMD must be a non-empty JSON array of strings");
		}
		return [...command];
	}
	const root = resolve(host.resourceRoot ?? RESOURCE_ROOT);
	if (backend(host, env) === "typescript") {
		return [host.nodeExecutable ?? process.execPath, resolve(root, host.kernelEntrypoint ?? "build/kernel/rpc.mjs"),
			"--workspace", home, "--content", resolve(root, host.contentRoot ?? "content")];
	}
	return ["uv", "run", "--frozen", "python", "-m", "coc.rpc", "--workspace", home,
		"--content", resolve(root, host.contentRoot ?? "content")];
}

/** Host adapters reuse the same immutable locations and environment without starting a kernel. */
export function composeRuntimeContext(binding: RuntimeBinding, host: RuntimeHostOptions = {}): RuntimeContext {
	if (binding.signal?.aborted) throw failure("runtime_cancelled", "The runtime owner is cancelled");
	try {
		if (!["session", "preparation", "check"].includes(binding.owner)) throw new Error("Unknown runtime owner kind");
		const cwd = location(host.resourceRoot ?? RESOURCE_ROOT, process.cwd());
		const contentRoot = location(host.contentRoot ?? "content", cwd);
		const home = location(binding.home, process.cwd());
		for (const path of [cwd, contentRoot]) {
			if (!statSync(path).isDirectory()) throw new Error(`Runtime resource is not a directory: ${path}`);
			accessSync(path, constants.R_OK | constants.X_OK);
		}
		const env = { ...(host.env ?? process.env) };
		const selected = backend(host, env);
		const agentHome = location(host.agentHome ?? env.PI_CODING_AGENT_DIR ?? join(cwd, ".pi", "coc-agent"), cwd);
		const nodeExecutable = executable(host.nodeExecutable ?? process.execPath, cwd, env);
		return Object.freeze({ backend: selected, resourceRoot: cwd, contentRoot, home, agentHome, nodeExecutable,
			env: Object.freeze({ ...env, PI_COC_HOME: home, PI_CODING_AGENT_DIR: agentHome,
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
		const command = kernelCommand(home, { ...host, backend: context.backend, resourceRoot, contentRoot, nodeExecutable, env });
		command[0] = executable(command[0], resourceRoot, env);
		if (context.backend === "typescript" && !env.PI_COC_KERNEL_CMD?.trim()) accessSync(command[1], constants.R_OK);
		launch = { command, cwd: resourceRoot, inheritEnv: false, env: { ...env, PYTHONPATH: join(resourceRoot, "kernel") } };
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
		close,
	} satisfies HostRuntime);
}
