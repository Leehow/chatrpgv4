/** A tool-enabled Pi child for one visual reading or review phase. */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** How long one reader round may run; a timeout counts as a round that did not pass, and leaves its mark in the findings. */
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const STDERR_KEEP = 2000;

export interface ReaderRequest {
	/** The working directory: the claimed attempt directory. */
	cwd: string;
	/** The phase instruction for the claimed reading job. */
	brief: string;
	/** `provider/model`; without one, pi's own default model is used. */
	model?: string;
	signal?: AbortSignal;
	timeoutMs?: number;
	systemPrompt?: string;
	eventLog?: string;
	onEvent?: (event: Record<string, any>) => void;
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
export function readerCommand(model?: string, systemPrompt?: string): string[] {
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
		"--no-skills",
		...(systemPrompt ? ["--extension", join(PKG_ROOT, "extensions/module/reader-context.ts")] : []),
		"--tools",
		"read,write,edit,bash",
		"--system-prompt",
		systemPrompt ?? join(PKG_ROOT, "content", "setup", "visual-reader.md"),
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
		command = readerCommand(request.model, request.systemPrompt);
		if (request.eventLog && !process.env.PI_COC_READER_CMD) command.splice(command.length - 1, 0, "--mode", "json");
		command.push(request.brief);
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
	if (request.signal?.aborted) return { ok: false, code: null, timedOut: false, ms: 0, stderr: "", command, error: "cancelled" };
	if (request.eventLog) await mkdir(dirname(request.eventLog), { recursive: true });
	if (request.eventLog) env.PI_COC_READER_IMAGES_LOG = request.eventLog + ".images.jsonl";
	if (request.systemPrompt) {
		const binDir = join(request.cwd, "host-bin");
		await mkdir(binDir, { recursive: true });
		const quotedRoot = "'" + PKG_ROOT.replaceAll("'", "'\\''") + "'";
		for (const name of ["python", "python3"]) {
			const path = join(binDir, name);
			await writeFile(path, `#!/bin/sh\nexec uv run --project ${quotedRoot} --frozen python "$@"\n`);
			await chmod(path, 0o755);
		}
		env.PATH = `${binDir}:${env.PATH ?? ""}`;
	}

	return await new Promise<ReaderOutcome>((resolve) => {
		let settled = false;
		let stderr = "";
		let timedOut = false;
		let eventError: string | undefined;
		let hardKill: ReturnType<typeof setTimeout> | undefined;
		const log = request.eventLog ? createWriteStream(request.eventLog, { flags: "a" }) : undefined;
		log?.on("error", error => { eventError = error.message; });
		const grouped = process.platform !== "win32";
		const child = spawn(bin, args, { cwd: request.cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: grouped });

		const finish = (outcome: Omit<ReaderOutcome, "ms" | "command" | "stderr">) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (hardKill) clearTimeout(hardKill);
			request.signal?.removeEventListener("abort", onAbort);
			const done = () => resolve({ ...outcome, ...(eventError ? { ok: false, error: eventError } : {}), ms: Date.now() - began, stderr: stderr.slice(-STDERR_KEEP), command });
			if (log && !log.destroyed) log.end(done);
			else done();
		};

		const kill = () => {
			try {
				if (grouped && child.pid) process.kill(-child.pid, "SIGTERM");
				else child.kill();
			} catch {
				/* already gone */
			}
			hardKill = setTimeout(() => {
				try {
					if (grouped && child.pid) process.kill(-child.pid, "SIGKILL");
					else child.kill("SIGKILL");
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

		// JSON events provide image-use evidence; a final sentence alone never proves a valid graph.
		if (!request.eventLog) child.stdout?.resume();
		else {
			let pending = "";
			child.stdout?.setEncoding("utf8");
			child.stdout?.on("data", (chunk: string) => {
				pending += chunk;
				let end: number;
				while ((end = pending.indexOf("\n")) >= 0) {
					const line = pending.slice(0, end); pending = pending.slice(end + 1);
					try {
						const event = JSON.parse(line);
						request.onEvent?.(event);
						log?.write(JSON.stringify(event, (_key, value) => value?.type === "image" && typeof value.data === "string"
							? { type: "image", mimeType: value.mimeType, bytes: Buffer.byteLength(value.data, "base64"), sha256: createHash("sha256").update(Buffer.from(value.data, "base64")).digest("hex") }
							: value) + "\n");
					} catch (error) { eventError = `unreadable reader event: ${String(error)}`; }
				}
			});
		}
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
			if (stderr.length > STDERR_KEEP * 2) stderr = stderr.slice(-STDERR_KEEP);
		});
		child.on("error", (error: Error) => {
			finish({ ok: false, code: null, timedOut, error: error.message });
		});
		child.on("close", (code, signal) => {
			finish({
				ok: !timedOut && code === 0,
				code: code ?? null,
				timedOut,
				...(signal ? { signal } : {}),
			});
		});
	});
}
