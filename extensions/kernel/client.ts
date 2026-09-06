/**
 * 内核子进程客户端。契约见 docs/kernel-rpc.md 第 1 节：
 * 一行一个 JSON，`\n` 分隔，请求串行，崩溃后重新拉起并重开桌。
 */

import { type ChildProcess, spawn } from "node:child_process";

export interface KernelErrorPayload {
	code: string;
	message: string;
	fix?: string;
	details?: Record<string, unknown>;
}

/** 内核返回的 `ok: false` 信封，或者客户端自己无法完成调用时的等价错误。 */
export class KernelError extends Error {
	readonly code: string;
	readonly fix?: string;
	readonly details?: Record<string, unknown>;

	constructor(payload: KernelErrorPayload) {
		super(payload.message);
		this.name = "KernelError";
		this.code = payload.code;
		this.fix = payload.fix;
		this.details = payload.details;
	}

	/** 给模型看的一行：`code: message`，有 fix 时补一行。 */
	toToolText(): string {
		return this.fix ? `${this.code}: ${this.message}\n修正：${this.fix}` : `${this.code}: ${this.message}`;
	}
}

export interface KernelClientOptions {
	/** 启动命令，argv 形式。 */
	command: string[];
	/** 子进程工作目录（包根）。 */
	cwd: string;
	env?: Record<string, string>;
	/** 单个请求的超时，缺省 30 秒。 */
	timeoutMs?: number;
	/** 诊断输出：stderr 行、协议噪音、重启通告。 */
	onDiagnostic?: (message: string) => void;
	/** 重新拉起后要重放的开桌动作（`kernel.hello` + `table.open`）。 */
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

	/** 按到达顺序逐个执行：扩展负责序列化。 */
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
	 * 绕过串行队列直接发一个请求。只给重启后的重开桌用：
	 * 重开桌本身就是从队列里被调起来的，再排队会自锁。
	 */
	callImmediate<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		return this.dispatch<T>(method, params);
	}

	async close(): Promise<void> {
		this.closing = true;
		const child = this.child;
		this.child = undefined;
		this.rejectAllPending(new KernelError({ code: "internal", message: "内核已关闭" }));
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
					/* 已经没了 */
				}
				done();
			}, 2000).unref?.();
		});
	}

	private spawnChild(): void {
		const [command, ...args] = this.options.command;
		if (!command) {
			this.dead = true;
			throw new KernelError({ code: "internal", message: "内核启动命令为空" });
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
			this.handleExit(`退出码 ${code ?? "null"}，信号 ${signal ?? "null"}`);
		});
	}

	/** stdout 只按 `\n` 切分，不走 readline：内核保证一行一个 JSON 对象。 */
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
			this.options.onDiagnostic?.(`kernel stdout 不是 JSON：${line.slice(0, 200)}`);
			return;
		}
		const id = typeof payload.id === "string" ? payload.id : undefined;
		if (!id) {
			this.options.onDiagnostic?.(`kernel 响应缺少 id：${line.slice(0, 200)}`);
			return;
		}
		const pending = this.pending.get(id);
		if (!pending) {
			// 超时后迟到的响应：丢弃。
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
					: { code: "internal", message: `内核返回了无法解析的错误信封：${line.slice(0, 200)}` },
			),
		);
	}

	private dispatch<T>(method: string, params: Record<string, unknown>): Promise<T> {
		if (this.dead) {
			return Promise.reject(new KernelError({ code: "internal", message: "内核已停止且无法重启" }));
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
			return Promise.reject(new KernelError({ code: "internal", message: "内核 stdin 不可写" }));
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
						message: `内核 ${method} 超过 ${this.timeoutMs} 毫秒没有回应`,
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
				entry.reject(new KernelError({ code: "internal", message: `写内核 stdin 失败：${error.message}` }));
			});
		});
	}

	private handleExit(reason: string): void {
		this.rejectAllPending(new KernelError({ code: "internal", message: `内核进程结束：${reason}` }));
		if (this.closing) return;
		if (this.restartUsed) {
			this.dead = true;
			this.options.onDiagnostic?.(`内核再次结束（${reason}），不再重启`);
			return;
		}
		this.restartUsed = true;
		this.options.onDiagnostic?.(`内核结束（${reason}），重新拉起并重开桌`);
		try {
			this.spawnChild();
		} catch (error) {
			this.dead = true;
			this.options.onDiagnostic?.(`重新拉起内核失败：${(error as Error).message}`);
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
