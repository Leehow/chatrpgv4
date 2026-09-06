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
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type CocMode = "play" | "setup";

/** Defaults to play: an unknown value (a typo, an old script) still opens a table rather than a toolless shell. */
export function cocMode(): CocMode {
	return process.env.PI_COC_MODE?.trim() === "setup" ? "setup" : "play";
}

/** Append one JSON line, creating the directory if needed. Every failure is swallowed. */
export async function appendJsonl(path: string, line: Record<string, unknown>): Promise<void> {
	try {
		await mkdir(dirname(path), { recursive: true });
		await appendFile(path, `${JSON.stringify(line)}\n`, "utf8");
	} catch {
		/* a log line that cannot be written must not escape */
	}
}
