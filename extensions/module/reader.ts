/**
 * 读者：一段 section 一个子 `pi` 进程（契约 §14.5）。
 *
 * 用户 2026-09-04 的法则：读书的模型工作跑成带工具的 agent，不是一次补全——
 * 它要自己开抽取包、自己分多次写分片、自己跑闸门。车道（`extensions/lanes/subsession.ts`）
 * 那条一次补全的路在这里不够用，所以这里起的是一个真的 `pi` 进程：
 *
 *   pi -p --no-session --no-context-files --no-extensions --tools read,write,edit,bash
 *      --system-prompt content/setup/reader.md [--model <provider/id>] -- <brief>
 *
 * 工作目录是 `work/<section_id>/`，`brief` 由 `module.packet` 给（契约 §14.3）。
 * 读者产出的一切只留在 `work/` 里，进 `shards/` 的只有 review 通过并 `module.accept` 的。
 *
 * 三个不在契约里、由这一侧定下的细节，理由见 docs/pi-host-contract.md 第 3.2 节：
 * - `--no-extensions`：不加它的话子进程会把本包的扩展再加载一遍，于是又拉起一个内核子进程
 *   （违反契约 §1「一个 Pi 会话一个内核子进程」），而且 `setActiveTools` 会把 `--tools` 的
 *   允许清单顶掉，读者反而拿不到 read/write/bash。
 * - `PI_CODING_AGENT_DIR` 原样继承：鉴权、模型目录都在那儿。`PI_COC_CAMPAIGN`／`PI_COC_MODE`
 *   显式摘掉，免得万一扩展被加载时它去开桌。
 * - `PI_COC_READER_CMD`（JSON 字符串数组）替换整条命令，测试用它换成一个假读者，
 *   跟 `PI_COC_KERNEL_CMD` 同一个套路；`brief` 仍作为最后一个参数传进去。
 */

import { spawn } from "node:child_process";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 一轮读者最多跑多久；超时按失败的一轮算，findings 里留下超时的记号。 */
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const STDERR_KEEP = 2000;

export interface ReaderRequest {
	/** 工作目录：`work/<section_id>/`。 */
	cwd: string;
	/** `module.packet` 返回的标准命令。 */
	brief: string;
	/** `provider/model`；不给就用 pi 自己的缺省模型。 */
	model?: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}

export interface ReaderOutcome {
	ok: boolean;
	/** 退出码；被信号杀掉时为 null。 */
	code: number | null;
	signal?: string;
	timedOut: boolean;
	ms: number;
	/** stderr 尾巴，进遥测用。 */
	stderr: string;
	command: string[];
	/** 起不起得来之外的失败（spawn 出错）。 */
	error?: string;
}

/** 读者的命令行，不含最后那个 `brief` 参数。 */
export function readerCommand(model?: string): string[] {
	const override = process.env.PI_COC_READER_CMD?.trim();
	if (override) {
		const parsed: unknown = JSON.parse(override);
		if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((part) => typeof part !== "string")) {
			throw new Error("PI_COC_READER_CMD 必须是非空的字符串 JSON 数组");
		}
		return parsed as string[];
	}
	return [
		join(PKG_ROOT, "node_modules", ".bin", "pi"),
		"-p",
		"--no-session",
		"--no-context-files",
		"--no-extensions",
		"--tools",
		"read,write,edit,bash",
		"--system-prompt",
		join(PKG_ROOT, "content", "setup", "reader.md"),
		...(model ? ["--model", model] : []),
		// `--` 之后的都是提示：brief 以 `-` 开头也不会被当成参数。
		"--",
	];
}

/** 跑一轮读者。任何失败都只是一轮失败，不抛。 */
export async function runReader(request: ReaderRequest): Promise<ReaderOutcome> {
	const began = Date.now();
	let command: string[];
	try {
		command = [...readerCommand(request.model), request.brief];
	} catch (error) {
		return {
			ok: false,
			code: null,
			timedOut: false,
			ms: 0,
			stderr: "",
			command: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}
	const [bin, ...args] = command;
	const env = { ...process.env };
	// 子进程不是一张桌子：别让它以为自己该开桌。
	delete env.PI_COC_CAMPAIGN;
	delete env.PI_COC_MODE;

	return await new Promise<ReaderOutcome>((resolve) => {
		let settled = false;
		let stderr = "";
		let timedOut = false;
		const child = spawn(bin, args, { cwd: request.cwd, env, stdio: ["ignore", "pipe", "pipe"] });

		const finish = (outcome: Omit<ReaderOutcome, "ms" | "command" | "stderr">) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			request.signal?.removeEventListener("abort", onAbort);
			resolve({ ...outcome, ms: Date.now() - began, stderr: stderr.slice(-STDERR_KEEP), command });
		};

		const kill = () => {
			try {
				child.kill();
			} catch {
				/* 已经没了 */
			}
			setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {
					/* 同上 */
				}
			}, 2000).unref?.();
		};

		const timer = setTimeout(() => {
			timedOut = true;
			kill();
		}, request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
		timer.unref?.();

		const onAbort = () => {
			kill();
		};
		request.signal?.addEventListener("abort", onAbort, { once: true });

		// stdout 是读者最后那句话，我们不读它：它写没写对，看的是 `module.review`。
		child.stdout?.resume();
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
			if (stderr.length > STDERR_KEEP * 2) stderr = stderr.slice(-STDERR_KEEP);
		});
		child.on("error", (error: Error) => {
			finish({ ok: false, code: null, timedOut, error: error.message });
		});
		child.on("exit", (code, signal) => {
			finish({
				ok: !timedOut && code === 0,
				code: code ?? null,
				timedOut,
				...(signal ? { signal } : {}),
			});
		});
	});
}
