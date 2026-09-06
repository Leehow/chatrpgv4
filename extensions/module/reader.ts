/**
 * The reader: one child `pi` process per section (contract §14.5).
 *
 * The user's law of 2026-09-04: model work that reads a book runs as an agent with tools, not as one
 * completion — it opens the extraction packet itself, writes the shard over several turns itself, and runs
 * the gates itself. The lanes' single-completion road (`extensions/lanes/subsession.ts`) is not enough here,
  * so what is started is a real `pi` process:
 *
 *   pi -p --no-session --no-context-files --no-extensions --tools read,write,edit,bash
 *      --system-prompt content/setup/reader.md [--model <provider/id>] -- <brief>
 *
 * The working directory is `work/<section_id>/`, and `module.packet` gives the `brief` (contract §14.3).
 * Everything the reader produces stays in `work/`; only what passes review and is accepted by `module.accept` reaches `shards/`.
 *
 * Three details settled on this side rather than in the contract, with the reasons in docs/pi-host-contract.md §3.2:
 * - `--no-extensions` is required. Without it the subprocess loads this package's extensions all over again,
 *   which starts a second kernel subprocess (breaking contract §1's one kernel per Pi session), and
 *   `setActiveTools` overrides the `--tools` allow list, leaving the reader without read/write/bash.
 * - `PI_CODING_AGENT_DIR` is inherited verbatim: auth and the model catalogue live there. `PI_COC_CAMPAIGN`
 *   and `PI_COC_MODE` are removed explicitly, so that a loaded extension cannot go and open a table.
 * - `PI_COC_READER_CMD` (a JSON array of strings) replaces the whole command; tests point it at a fake
 *   reader, the same trick as `PI_COC_KERNEL_CMD`, and `brief` is still passed as the last argument.
 */

import { spawn } from "node:child_process";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** How long one reader round may run; a timeout counts as a round that did not pass, and leaves its mark in the findings. */
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const STDERR_KEEP = 2000;

export interface ReaderRequest {
	/** The working directory: `work/<section_id>/`. */
	cwd: string;
	/** The standard brief `module.packet` returns. */
	brief: string;
	/** `provider/model`; without one, pi's own default model is used. */
	model?: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}

export interface ReaderOutcome {
	ok: boolean;
	/** The exit code; null when killed by a signal. */
	code: number | null;
	signal?: string;
	timedOut: boolean;
	ms: number;
	/** The tail of stderr, for the telemetry. */
	stderr: string;
	command: string[];
	/** A failure other than not passing (a spawn error). */
	error?: string;
}

/** The reader's command line, without the final `brief` argument. */
export function readerCommand(model?: string): string[] {
	const override = process.env.PI_COC_READER_CMD?.trim();
	if (override) {
		const parsed: unknown = JSON.parse(override);
		if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((part) => typeof part !== "string")) {
			throw new Error("PI_COC_READER_CMD must be a non-empty JSON array of strings");
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
		// Everything after `--` is the prompt: a brief starting with `-` is not taken for an option.
		"--",
	];
}

/** Run one reader round. Any failure is only a failed round, never a throw. */
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
	// The subprocess is not a table: it must not think it should open one.
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
				/* already gone */
			}
			setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {
					/* same as above */
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

		// stdout is the reader's last sentence and we do not read it: whether it wrote correctly is `module.review`'s call.
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
