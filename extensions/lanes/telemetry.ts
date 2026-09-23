/**
 * One writer for the advisory lanes' telemetry, and the one consumer their failures never had
 * (contract §12.8, §56).
 *
 * The memory, journal and voice lanes each carried a byte-identical `record`: append a session entry
 * for the transcript, then append the same line to `.coc/campaigns/<id>/telemetry.jsonl`. Both halves
 * are writes. Nothing read them back. On campaign game-3d8ab658 the memory lane failed on every one of
 * a finished game's 31 turns with the same sentence, `ok: false` and `reason: "lane_error"` on every
 * row, and no surface anywhere -- not the player's, not the Keeper's, not the operator's -- said so;
 * `tests/play/kpi.py` skips every row that carries `lane`, which is all of them. The defect was found
 * by someone counting something else.
 *
 * So the writer watches its own rows. Consecutive failures are a streak, a success ends it, and from
 * `OUTAGE_STREAK` the lane says once, out of fiction, to the person who can act on it: a
 * `coc-lane-status` session entry and a `coc:lane-status` bus event, in the shape §32.2's
 * `coc-admission-status` and §38.7's provider notice already use, plus one `event: "outage"` row in
 * the campaign's own telemetry so the evidence path names it instead of repeating line 31.
 *
 * It is deliberately not the player's business. An advisory lane is the Keeper's bookkeeping; a table
 * whose memory lane is down still plays, and a service notice in the fiction would be noise for a
 * failure the player did not cause and cannot fix. `admissionUnavailable` speaks to the player
 * because admission blocks the turn. This one does not, so it does not.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendJsonl, cocHome } from "./host.ts";
import { join } from "node:path";

/**
 * Three, not §32.2's two. A lane job already spends its own retries before it writes one failed row
 * (the memory and journal lanes try twice), so a single row is not a single attempt; and unlike
 * admission, nothing is blocked while the streak runs, so there is room to let two rounds read as the
 * blip they usually are. The third consecutive failure is a condition, not weather.
 */
export const OUTAGE_STREAK = 3;

export interface LaneTelemetryOptions {
	/** The lane's own name: the `lane` field of every row it writes, and of its notice. */
	lane: string;
	/** The environment variable naming this lane's model, quoted in the notice when the model is the suspect. */
	modelEnv: string;
	/** Read live, never captured: the session may be replaced, and after shutdown it is simply gone. */
	cwd: () => string | undefined;
}

/** What the operator is told to do about it, chosen by the closed failure reason, never by reading the detail. */
function outageFix(lane: string, streak: number, reason: string, modelEnv: string): string {
	const opening = `The ${lane} lane has failed ${streak} times in a row. It records nothing while it is down and the table plays on without it, so no one at the table will report this.`;
	if (reason === "model_unavailable" || reason === "model_error")
		return `${opening} Its model is the suspect: choose a model this session can actually reach under Fast model in settings (read the next time the lane runs), or set ${modelEnv} to one.`;
	if (reason === "invalid")
		return `${opening} Its model keeps producing output the kernel refuses; the detail carries the kernel's own words. A different lane model is the usual repair.`;
	return `${opening} This is a host or kernel failure rather than anything the player did: the detail carries the kernel's error. The lane's rows are in .coc/campaigns/<campaign>/telemetry.jsonl.`;
}

export function createLaneTelemetry(pi: ExtensionAPI, options: LaneTelemetryOptions) {
	let outage = 0;
	let notified = false;

	async function write(campaign: string, line: Record<string, unknown>): Promise<void> {
		let cwd: string | undefined;
		try {
			pi.appendEntry("coc-telemetry", line);
			// After the session is disposed the ctx getters throw (docs/pi-host-contract.md §5), and the
			// lane's continuation may well land after that: read it, treat a throw as "no workspace",
			// and never let the exception out of the lane.
			cwd = options.cwd();
		} catch {
			/* telemetry must not break a lane */
		}
		if (!cwd) return;
		await appendJsonl(join(cocHome(cwd), ".coc", "campaigns", campaign, "telemetry.jsonl"), line);
	}

	/**
	 * Only this lane's own outcome rows count. A row that carries its own `lane` is a nested
	 * `lane: "lane-call"` round from `runLane` (contract §12.8.1) -- several per job, with an `ok` of
	 * their own -- and letting those in would both inflate a streak and end one, because a provider
	 * call can succeed on a job that still fails. A row without a boolean `ok` decides nothing.
	 */
	function observe(campaign: string, row: Record<string, unknown>): void {
		if (row.lane !== undefined || typeof row.ok !== "boolean") return;
		if (row.ok) {
			outage = 0;
			notified = false;
			return;
		}
		outage += 1;
		if (outage < OUTAGE_STREAK || notified) return;
		notified = true;
		const reason = typeof row.reason === "string" ? row.reason : "unknown";
		const detail = typeof row.detail === "string" ? row.detail.slice(0, 200) : "";
		const status = {
			lane: options.lane,
			campaign,
			...(typeof row.turn === "number" ? { turn: row.turn } : {}),
			status: "down",
			streak: outage,
			reason,
			...(detail ? { detail } : {}),
			fix: outageFix(options.lane, outage, reason, options.modelEnv),
		};
		try {
			pi.appendEntry("coc-lane-status", status);
		} catch {
			/* the notice must never break a lane */
		}
		pi.events.emit("coc:lane-status", status);
		// The same fact where the evidence already lives, once, and distinguishable from the failed
		// rows themselves: `event` rather than `ok`, so it is not counted back into its own streak.
		void write(campaign, { lane: options.lane, event: "outage", campaign, streak: outage, reason, ...(detail ? { detail } : {}) });
	}

	return {
		async record(campaign: string, row: Record<string, unknown>): Promise<void> {
			await write(campaign, { lane: options.lane, ...row });
			observe(campaign, row);
		},
		/** For tests and for a lane that wants to know: the current consecutive-failure count. */
		get outage() { return outage; },
	};
}
