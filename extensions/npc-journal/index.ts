/**
 * The player-side NPC journal lane (contract §17.10, scheduling shared with §12.8).
 *
 * Same shape as the memory lane: the kernel extension's narrate commit puts `coc:turn-committed`
 * on the bus, and this catches it: `journal.job` takes a closed job packet, a zero-tool subsession
 * writes the player-safe entries, `journal.submit` merges them into `npc-journal.json`. One retry
 * on failure, then `journal.fail`, and the job goes to the backlog to await a later default
 * dispatch.
 *
 * The boundaries are the memory lane's own: the lane never blocks narrate (everything here is
 * after the delivery and is not awaited); only one job runs at a time and the rest queue; whatever
 * has not finished at process exit is left to the next default dispatch of `journal.job`. The lane
 * records only who actually appeared this turn; the deterministic recordable set is the kernel's,
 * and this lane neither widens nor second-guesses it.
 *
 * Backfill: at `session_start`, once the bridge is up, jobs are asked for one at a time with a
 * `journal.job` carrying no `turn`, at most `PI_COC_NPCJOURNAL_BACKFILL` of them (5 by default),
 * and the kernel answering `job_id: null` ends it. Backfill yields to the table: no new job starts
 * while a turn is open, and a freshly committed turn always goes ahead of it.
 *
 * After a successful submit the open sheet panel is told to re-read (`sheet-changed`), the same
 * push the ui-words lane and the turn commit use; the push carries no data, the panel re-reads
 * `table.view`. In a terminal there is no panel and the emit is a no-op.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { cocMode } from "../lanes/host.ts";
import { resolveLaneModel, runLane } from "../lanes/subsession.ts";
import { createLaneQueue, type KernelCall, type LaneJob } from "../lanes/queue.ts";
import { createLaneTelemetry } from "../lanes/telemetry.ts";
import { emitToPanel } from "../../pipicoc/host-bridge.ts";

/** Fallbacks only: the kernel's job packet carries the real budget, and these stand in when it does not. */
const DEFAULT_MAX_ENTRIES = 6;
const DEFAULT_MAX_DESCRIPTION_CHARS = 300;
const DEFAULT_MAX_EXCHANGE_CHARS = 200;
/** The manifest id the sheet panel is mounted under; the same id the turn commit announces to. */
const PANEL_ID = "coc-keeper";

/** One journal entry; the closed fields of `journal.submit` (contract §17.10). No other key is ever sent to the kernel. */
interface Entry {
	name: string;
	description?: string;
	exchange?: string;
}

/** The job packet from `journal.job`; only the fields it lists are read, and nothing else reaches the prompt. */
interface JobPacket {
	job_id?: string | null;
	turn?: number;
	commit?: string;
	scene?: { name?: string; display_name?: string };
	present?: unknown[];
	investigators?: Array<{ id?: string; name?: string }>;
	player_text?: string;
	keeper_text?: string;
	recordable?: unknown[];
	prior?: Array<{ name?: string; description?: string; last_seen_turn?: number }>;
	budget?: { max_entries?: number; max_description_chars?: number; max_exchange_chars?: number };
	instruction?: string;
}

function names(rows: unknown): string {
	if (!Array.isArray(rows) || rows.length === 0) return "(none)";
	return rows
		.map((row) => {
			if (typeof row === "string") return row;
			const record = (row ?? {}) as Record<string, unknown>;
			const name = record.name ?? record.id;
			return typeof name === "string" ? name : JSON.stringify(row);
		})
		.join(", ");
}

function priorLines(rows: JobPacket["prior"]): string {
	if (!Array.isArray(rows) || rows.length === 0) return "(none)";
	return rows
		.map((row) => `- ${row.name ?? "?"}${row.description ? `: ${row.description}` : ""}`)
		.join("\n");
}

function systemPrompt(packet: JobPacket): string {
	const maxEntries = packet.budget?.max_entries ?? DEFAULT_MAX_ENTRIES;
	const maxDescription = packet.budget?.max_description_chars ?? DEFAULT_MAX_DESCRIPTION_CHARS;
	const maxExchange = packet.budget?.max_exchange_chars ?? DEFAULT_MAX_EXCHANGE_CHARS;
	return [
		// The instruction is the fixed passage the kernel writes (contract §17.10); the lane passes it
		// on verbatim, rewriting nothing and adding nothing.
		packet.instruction ??
			"Write an entry only for someone who truly appeared in this turn's narrative, and write it in the campaign's play language.",
		"",
		"Answer with one JSON object only, no code fence and no explanation:",
		'{"entries":[{"name":"...","description":"...","exchange":"..."}]}',
		"Field rules:",
		"- name must be one of the recordable names below, copied exactly.",
		`- description is 1 to ${maxDescription} characters and says only what the player can perceive; omit it to keep the stored one.`,
		`- exchange is 1 to ${maxExchange} characters, one sentence on what passed between this person and the player this turn; omit it when nothing passed.`,
		"- write no key other than name, description and exchange, and in particular no turn number, commit, receipt id or entry id.",
		`- at most ${maxEntries} rows; with nobody new to record, answer {"entries":[]}.`,
	].join("\n");
}

function userInput(packet: JobPacket): string {
	return [
		`[Location] ${packet.scene?.display_name ?? packet.scene?.name ?? "(unknown)"}`,
		`[Present] ${names(packet.present)}`,
		`[Investigators] ${names(packet.investigators)}`,
		`[Recordable names] ${names(packet.recordable)}`,
		"",
		"[What the player said this turn]",
		packet.player_text?.trim() || "(nothing)",
		"",
		"[The prose the Keeper delivered this turn]",
		packet.keeper_text?.trim() || "(nothing)",
		"",
		"[Journal so far: do not restate a description that already holds]",
		priorLines(packet.prior),
	].join("\n");
}

/**
 * Shape check: closed fields only, and an entry carries at least one of description/exchange.
 * Whether a name belongs to this turn (recordable membership, ambiguity) is the kernel's check.
 */
function shapeEntries(parsed: unknown, packet: JobPacket): Entry[] | undefined {
	if (!parsed || typeof parsed !== "object") return undefined;
	const raw = Array.isArray(parsed) ? parsed : (parsed as { entries?: unknown }).entries;
	if (!Array.isArray(raw)) return undefined;
	const limit = packet.budget?.max_entries ?? DEFAULT_MAX_ENTRIES;
	const maxDescription = packet.budget?.max_description_chars ?? DEFAULT_MAX_DESCRIPTION_CHARS;
	const maxExchange = packet.budget?.max_exchange_chars ?? DEFAULT_MAX_EXCHANGE_CHARS;
	const entries: Entry[] = [];
	for (const row of raw) {
		if (!row || typeof row !== "object") continue;
		const record = row as Record<string, unknown>;
		if (typeof record.name !== "string" || record.name.trim().length === 0) continue;
		const entry: Entry = { name: record.name.trim() };
		if (typeof record.description === "string" && record.description.trim().length >= 1) {
			const description = record.description.trim();
			if (description.length > maxDescription) continue;
			entry.description = description;
		}
		if (typeof record.exchange === "string" && record.exchange.trim().length >= 1) {
			const exchange = record.exchange.trim();
			if (exchange.length > maxExchange) continue;
			entry.exchange = exchange;
		}
		if (!entry.description && !entry.exchange) continue;
		entries.push(entry);
		if (entries.length >= limit) break;
	}
	return entries;
}

/** The code of a kernel error envelope is read structurally: instanceof is unreliable across extensions (two module instances). */
function errorCode(error: unknown): string | undefined {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : undefined;
}

function errorText(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

export default function (pi: ExtensionAPI) {
	// The setup process has no turns and so no journal to write: it registers nothing and subscribes to nothing.
	if (cocMode() === "setup") return;

	// ---- Telemetry --------------------------------------------------------

	// The shared writer, which also escalates a streak of failures to the operator (contract §56).
	const telemetry = createLaneTelemetry(pi, {
		lane: "journal", modelEnv: "PI_COC_NPCJOURNAL_MODEL", cwd: () => scheduler.ctx?.cwd,
	});
	const record = (campaign: string, row: Record<string, unknown>) => telemetry.record(campaign, row);

	const scheduler = createLaneQueue(pi, {
		backfillEnv: "PI_COC_NPCJOURNAL_BACKFILL",
		runJob,
		onError: (job, error) => record(job.campaign, {
			turn: job.turn, ok: false, reason: "lane_error", detail: errorText(error),
		}),
	});

	// ---- One job ----------------------------------------------------------

	/** One attempt: the subsession writes the entries, then `journal.submit`. Failure reasons use `journal.fail`'s closed enum. */
	async function attempt(
		packet: JobPacket,
		jobId: string,
		campaign: string,
		call: KernelCall,
		note: (row: Record<string, unknown>) => Promise<void>,
	): Promise<{ ok: true; entries: number; model: string } | { ok: false; reason: string; detail: string }> {
		const lane = await runLane<Entry[]>({
			ctx: scheduler.ctx as ExtensionContext,
			envName: "PI_COC_NPCJOURNAL_MODEL",
			// The four `lane: "lane-call"` rows this round leaves (contract §12.8.1) travel the job's own
			// telemetry, so a backfill round is marked as one there too.
			lane: "journal",
			record: (row) => note({ turn: packet.turn, job_id: jobId, ...row }),
			systemPrompt: systemPrompt(packet),
			input: userInput(packet),
			signal: scheduler.signal,
			shape: (parsed) => shapeEntries(parsed, packet),
		});
		if (!lane.ok) {
			return { ok: false, reason: lane.reason === "model_unavailable" ? "lane_error" : "model_error", detail: lane.detail };
		}
		try {
			await call("journal.submit", { campaign, job_id: jobId, entries: lane.value });
			// The panel re-reads `table.view` on this push; it carries no data on purpose.
			void emitToPanel(PANEL_ID, "sheet-changed");
			return { ok: true, entries: lane.value.length, model: lane.model };
		} catch (error) {
			const code = errorCode(error);
			return {
				ok: false,
				reason: code === "invalid_params" ? "invalid" : "lane_error",
				detail: `${code ?? "internal"}: ${errorText(error)}`,
			};
		}
	}

	async function runJob(job: LaneJob): Promise<void> {
		const began = Date.now();
		// Every backfill telemetry row carries `backfill: true`: writing at the table and filling holes stay apart.
		const note = (row: Record<string, unknown>) =>
			record(job.campaign, { ...(job.backfill ? { backfill: true } : {}), ...row });
		const current = scheduler.bridge;
		const ctx = scheduler.ctx;
		if (!current || !ctx) {
			await note({ turn: job.turn, ok: false, reason: "lane_error", detail: "the kernel bridge is gone; the lane cannot run" });
			return;
		}
		// Resolve the model first: if it cannot be resolved, do not take the job away from the kernel, or it lands in the backlog for nothing.
		const model = resolveLaneModel(ctx, "PI_COC_NPCJOURNAL_MODEL");
		if (!model.ok) {
			await note({ turn: job.turn, ok: false, reason: "model_unavailable", detail: model.detail });
			return;
		}

		let packet: JobPacket;
		try {
			// The default dispatch carries no `turn`: the kernel picks a turn not yet journaled and not in the backlog.
			packet = ((await current.call("journal.job", {
				campaign: job.campaign,
				...(typeof job.turn === "number" ? { turn: job.turn } : {}),
			})) ?? {}) as JobPacket;
		} catch (error) {
			await note({
				turn: job.turn,
				ok: false,
				ms: Date.now() - began,
				reason: "lane_error",
				detail: `journal.job ${errorCode(error) ?? "internal"}: ${errorText(error)}`,
			});
			return;
		}
		const jobId = typeof packet.job_id === "string" ? packet.job_id : undefined;
		if (!jobId) {
			if (job.backfill) {
				// The default dispatch came back empty: there are no holes left, so this session asks no more.
				// That is backfill's ordinary ending, and it writes no telemetry — one "nothing to do" line per opening is noise.
				scheduler.stopBackfill();
				return;
			}
			// Nothing to journal for this turn (already written, or in the backlog awaiting an explicit redispatch).
			await note({ turn: job.turn, ok: true, ms: Date.now() - began, skipped: "no_job" });
			return;
		}

		let last: { ok: false; reason: string; detail: string } | undefined;
		for (let tries = 0; tries < 2 && !scheduler.stopped; tries += 1) {
			const outcome = await attempt(packet, jobId, job.campaign, current.call, note);
			if (outcome.ok) {
				await note({
					turn: packet.turn ?? job.turn,
					job_id: jobId,
					ok: true,
					ms: Date.now() - began,
					model: outcome.model,
					entries: outcome.entries,
					...(tries > 0 ? { retried: true } : {}),
				});
				return;
			}
			last = outcome;
		}
		if (scheduler.stopped) return;
		const failure = last ?? { reason: "lane_error", detail: "the lane never started" };
		try {
			await current.call("journal.fail", {
				campaign: job.campaign,
				job_id: jobId,
				reason: failure.reason,
				detail: failure.detail,
			});
		} catch (error) {
			await note({
				turn: packet.turn ?? job.turn,
				job_id: jobId,
				ok: false,
				reason: "lane_error",
				detail: `journal.fail did not land either: ${errorText(error)}`,
			});
			return;
		}
		await note({
			turn: packet.turn ?? job.turn,
			job_id: jobId,
			ok: false,
			ms: Date.now() - began,
			model: `${model.model.provider}/${model.model.id}`,
			reason: failure.reason,
			detail: failure.detail.slice(0, 200),
			failed: true,
		});
	}
}
