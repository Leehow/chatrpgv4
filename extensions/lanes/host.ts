/**
 * Two small host-environment chores shared by the extensions. Not an extension itself;
 * only imported.
 *
 * One: what this process is doing. `bin/pi-coc` exports `PI_COC_MODE=play` when opening a
 * table and `setup` for `bin/pi-coc setup` (contract §14.4). The tool surface forks on it:
 * play has only the Keeper's seven verbs, setup has only the one `setup` verb. The mode is
 * read inside the extension factory, not at module top level — one process may run several
 * tables (the test harness), and a top-level constant would freeze on the first load.
 *
 * Two: appending one JSONL line to the workspace (telemetry, build logs). The caller gives
 * the path; a write that fails is dropped, because one log line must never break a turn.
 *
 * Three: where `.coc/` lives (contract §20.7). It used to be `ctx.cwd` and nothing else, so a book
 * parsed in one directory was invisible from another and an installed application would keep its
 * library wherever it happened to be started. `PI_COC_HOME` names it instead, with `ctx.cwd` as the
 * default, so nothing changes for a developer running from the repository. Modules are a library and
 * campaigns are saves; splitting those into two roots is a later slice, so both still sit under this
 * one root.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type CocMode = "play" | "setup";

/** Defaults to play: an unknown value (a typo, an old script) still opens a table rather than a toolless shell. */
export function cocMode(): CocMode {
	return process.env.PI_COC_MODE?.trim() === "setup" ? "setup" : "play";
}

/**
 * The workspace root that `.coc/` sits under (contract §20.7): `PI_COC_HOME` when it is set,
 * otherwise the session's working directory. `~` is expanded and a relative value resolves against
 * `cwd`, so `PI_COC_HOME=.coc-home` and `PI_COC_HOME=~/Library/pi-coc` both mean what they look like.
 * Read on every call, never frozen at module load: one process may bind several sessions (the test harness).
 */
export function cocHome(cwd: string): string {
	const raw = process.env.PI_COC_HOME?.trim();
	if (!raw) return cwd;
	const expanded = raw === "~" ? homedir() : raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
	return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

/**
 * Appends still being written, so a host that owns the process can wait for them to land before it reads the file
 * back (the test harness does, after each prompt). Callers fire telemetry without awaiting it, and a reader that
 * lands mid-append sees half a line. Kept on `globalThis` because one process can load this module more than once.
 */
const APPENDS_IN_FLIGHT = Symbol.for("pi-coc.jsonl-appends-in-flight");
function appendsInFlight(): Set<Promise<void>> {
	const scope = globalThis as { [APPENDS_IN_FLIGHT]?: Set<Promise<void>> };
	return (scope[APPENDS_IN_FLIGHT] ??= new Set());
}

/** Append one JSON line, creating the directory if needed. Every failure is swallowed. */
export function appendJsonl(path: string, line: Record<string, unknown>): Promise<void> {
	const write = (async () => {
		try {
			await mkdir(dirname(path), { recursive: true });
			await appendFile(path, `${JSON.stringify(line)}\n`, "utf8");
		} catch {
			/* a log line that cannot be written must not escape */
		}
	})();
	const pending = appendsInFlight();
	pending.add(write);
	void write.finally(() => pending.delete(write));
	return write;
}
