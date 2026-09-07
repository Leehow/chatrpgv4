/**
 * The kernel subprocess client. Contract in docs/kernel-rpc.md §1:
 * one JSON object per line, `\n` separated, requests serialised, and on a crash
 * the subprocess is respawned and the table reopened.
 */

import { type ChildProcess, spawn } from "node:child_process";

export interface KernelErrorPayload {
	code: string;
	message: string;
	/** The narrower reason inside a coarse `code`, e.g. `mechanics_missing` under `invalid_params` (contract §5). */
	code_detail?: string;
	fix?: string;
	details?: Record<string, unknown>;
}

/** The `ok: false` envelope from the kernel, or the client's own equivalent when a call cannot be made. */
export class KernelError extends Error {
	readonly code: string;
	readonly codeDetail?: string;
	readonly fix?: string;
	readonly details?: Record<string, unknown>;

	constructor(payload: KernelErrorPayload) {
		super(payload.message);
		this.name = "KernelError";
		this.code = payload.code;
		this.codeDetail = payload.code_detail;
		this.fix = payload.fix;
		this.details = payload.details;
	}

	/** One line for the model: `code: message`, plus a line when there is a fix. */
	toToolText(): string {
		return this.fix ? `${this.code}: ${this.message}\nfix: ${this.fix}` : `${this.code}: ${this.message}`;
	}
}

/** Extension loaders may instantiate this module separately; preserve errors across their bridge. */
export function isKernelError(error: unknown): error is KernelError {
	const row = error as Partial<KernelError> | null;
	return !!row && typeof row.code === "string" && typeof row.message === "string" && typeof row.toToolText === "function";
}

export interface KernelClientOptions {
	/** The launch command, argv style. */
	command: string[];
	/** Working directory of the subprocess (the package root). */
	cwd: string;
	env?: Record<string, string>;
	/** Timeout for a single request, 30 seconds by default. */
	timeoutMs?: number;
	/** Diagnostics: stderr lines, protocol noise, restart notices. */
	onDiagnostic?: (message: string) => void;
	/** The reopening to replay after a respawn (`kernel.hello` + `table.open`). */
	onRestart?: () => Promise<void>;
}

interface Pending {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class KernelClient {
	private readonly options: KernelClientOptions;
	private readonly timeoutMs: number;
	private child: ChildProcess | undefined;
	private stdoutBuffer = "";
	private readonly pending = new Map<string, Pending>();
	private queue: Promise<unknown> = Promise.resolve();
	private seq = 0;
	private closing = false;
	private restartUsed = false;
	private dead = false;

	constructor(options: KernelClientOptions) {
		this.options = options;
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	}

	get running(): boolean {
		return this.child !== undefined && !this.dead;
	}

	start(): void {
		if (this.child) return;
		this.spawnChild();
	}

	/** Executed one at a time in arrival order: the extension serialises them. */
	call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		const run = () => this.dispatch<T>(method, params);
		const result = this.queue.then(run, run);
		this.queue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	/**
	 * Send one request straight past the serial queue. Only for reopening after a restart:
	 * the reopening is itself called from inside the queue, so queueing it would deadlock.
	 */
	callImmediate<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		return this.dispatch<T>(method, params);
	}

	async close(): Promise<void> {
		this.closing = true;
		const child = this.child;
		this.child = undefined;
		this.rejectAllPending(new KernelError({ code: "internal", message: "the kernel is closed" }));
		if (!child) return;
		await new Promise<void>((resolve) => {
			const done = () => resolve();
			child.once("exit", done);
			try {
				child.stdin?.end();
				child.kill();
			} catch {
				done();
				return;
			}
			setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {
					/* already gone */
				}
				done();
			}, 2000).unref?.();
		});
	}

	private spawnChild(): void {
		const [command, ...args] = this.options.command;
		if (!command) {
			this.dead = true;
			throw new KernelError({ code: "internal", message: "the kernel launch command is empty" });
		}
		const child = spawn(command, args, {
			cwd: this.options.cwd,
			env: { ...process.env, ...(this.options.env ?? {}) },
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.child = child;
		this.stdoutBuffer = "";

		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => this.consumeStdout(chunk));
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			for (const line of String(chunk).split("\n")) {
				if (line.trim()) this.options.onDiagnostic?.(`kernel stderr: ${line}`);
			}
		});
		child.on("error", (error: Error) => {
			this.options.onDiagnostic?.(`kernel spawn error: ${error.message}`);
			this.handleExit(error.message);
		});
		child.on("exit", (code, signal) => {
			if (this.child !== child) return;
			this.child = undefined;
			this.handleExit(`exit code ${code ?? "null"}, signal ${signal ?? "null"}`);
		});
	}

	/** stdout is split on `\n` only, no readline: the kernel guarantees one JSON object per line. */
	private consumeStdout(chunk: string): void {
		this.stdoutBuffer += chunk;
		let index = this.stdoutBuffer.indexOf("\n");
		while (index >= 0) {
			const line = this.stdoutBuffer.slice(0, index);
			this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
			this.handleLine(line);
			index = this.stdoutBuffer.indexOf("\n");
		}
	}

	private handleLine(raw: string): void {
		const line = raw.trim();
		if (!line) return;
		let payload: {
			id?: string;
			ok?: boolean;
			result?: unknown;
			error?: KernelErrorPayload;
		};
		try {
			payload = JSON.parse(line);
		} catch {
			this.options.onDiagnostic?.(`kernel stdout is not JSON: ${line.slice(0, 200)}`);
			return;
		}
		const id = typeof payload.id === "string" ? payload.id : undefined;
		if (!id) {
			this.options.onDiagnostic?.(`kernel response has no id: ${line.slice(0, 200)}`);
			return;
		}
		const pending = this.pending.get(id);
		if (!pending) {
			// A response that arrived after its timeout: dropped.
			return;
		}
		this.pending.delete(id);
		clearTimeout(pending.timer);
		this.restartUsed = false;
		if (payload.ok === true) {
			pending.resolve(payload.result ?? {});
			return;
		}
		const error = payload.error;
		pending.reject(
			new KernelError(
				error && typeof error.code === "string"
					? error
					: { code: "internal", message: `the kernel returned an unreadable error envelope: ${line.slice(0, 200)}` },
			),
		);
	}

	private dispatch<T>(method: string, params: Record<string, unknown>): Promise<T> {
		if (this.dead) {
			return Promise.reject(new KernelError({ code: "internal", message: "the kernel has stopped and cannot be restarted" }));
		}
		// After close, whatever is left in the queue is not sent: the "spawn one if there is no
		// child" below would bring the kernel back up with nobody left to close it — an orphan
		// kernel holding the workspace and holding a pipe that keeps the host from exiting.
		// The lanes (memory extraction, on-demand deepening) are asynchronous, so at shutdown
		// their calls may well still be sitting in the queue.
		if (this.closing) {
			return Promise.reject(new KernelError({ code: "internal", message: `the kernel is closed; ${method} is not sent` }));
		}
		if (!this.child) {
			try {
				this.spawnChild();
			} catch (error) {
				return Promise.reject(error as Error);
			}
		}
		const child = this.child;
		if (!child?.stdin) {
			return Promise.reject(new KernelError({ code: "internal", message: "kernel stdin is not writable" }));
		}
		this.seq += 1;
		const id = `x${this.seq}`;
		const line = `${JSON.stringify({ id, method, params })}\n`;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(
					new KernelError({
						code: "internal",
						message: `kernel ${method} did not answer within ${this.timeoutMs} ms`,
					}),
				);
			}, this.timeoutMs);
			timer.unref?.();
			this.pending.set(id, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timer,
			});
			child.stdin?.write(line, (error) => {
				if (!error) return;
				const entry = this.pending.get(id);
				if (!entry) return;
				this.pending.delete(id);
				clearTimeout(entry.timer);
				entry.reject(new KernelError({ code: "internal", message: `writing to kernel stdin failed: ${error.message}` }));
			});
		});
	}

	private handleExit(reason: string): void {
		this.rejectAllPending(new KernelError({ code: "internal", message: `the kernel process ended: ${reason}` }));
		if (this.closing) return;
		if (this.restartUsed) {
			this.dead = true;
			this.options.onDiagnostic?.(`the kernel ended again (${reason}); not restarting`);
			return;
		}
		this.restartUsed = true;
		this.options.onDiagnostic?.(`the kernel ended (${reason}); respawning and reopening the table`);
		try {
			this.spawnChild();
		} catch (error) {
			this.dead = true;
			this.options.onDiagnostic?.(`respawning the kernel failed: ${(error as Error).message}`);
			return;
		}
		const restart = this.options.onRestart;
		if (!restart) return;
		this.queue = this.queue.then(
			() => restart(),
			() => restart(),
		);
	}

	private rejectAllPending(error: KernelError): void {
		for (const [, entry] of this.pending) {
			clearTimeout(entry.timer);
			entry.reject(error);
		}
		this.pending.clear();
	}
}
