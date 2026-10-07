/**
 * Contract §151.2.4: what one reading job spent, on the existing reading telemetry lane, so a saving is measured on the
 * real path rather than claimed from component timings. One `job_accounting` row per job run.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

type Row = Record<string, any>;
export interface JevSpend { calls: number; ms: number; input_tokens: number; output_tokens: number }
export interface ReadingAccounting {
	/** Author (read, index, index-audit) child time, every pass and round. */
	author_ms: number;
	/** Wall time of the verify phases, every round. */
	review_wall_ms: number;
	/** Review units a reviewer child answered (or failed) and units whose retained review was reused. */
	units_run: number;
	units_reused: number;
	/** Jev decisions by family: the reader children's own (from their traces) and the host's (`jev_decision` rows). */
	jev: Record<string, JevSpend>;
	/** §151.2.3: this run's read was salvaged from an interrupted attempt. */
	salvaged: boolean;
	/** §151.2.2: the repair round's kind, when a round repaired a reviewed candidate. */
	repair?: "targeted" | "append" | "full";
	/** §151.4: the need's disposition, when the job was queued from a retained source need and the host settled it. */
	need?: "answered" | "unlocated" | "carried" | "read";
	/**
	 * §186.2: per phase (`read`, `index`, `index-audit`, `verify`), the Pi children whose first call reported usage and the
	 * sum of those first calls' uncached input tokens -- what a shared cache identity per round is meant to bring down.
	 */
	first_call_uncached: Record<string, { children: number; tokens: number }>;
	/** §187.5.3: the bytes of the task the author is handed, whether `readerInput` inlines it, and its node and claim counts. */
	packet_bytes?: number;
	inlined?: boolean;
	known_nodes?: number;
	known_claims?: number;
	/** §187.5.3: the bytes of the author's assembled instructions. */
	instruction_bytes?: number;
}

export function readingAccounting(): ReadingAccounting {
	return { author_ms: 0, review_wall_ms: 0, units_run: 0, units_reused: 0, jev: {}, salvaged: false, first_call_uncached: {} };
}

/** §186.2: count one Pi child's first-call uncached input under its phase; a child that reported no usage is not counted. */
export function tallyFirstCall(accounting: ReadingAccounting, phase: string, uncached: number | undefined): void {
	if (typeof uncached !== "number" || !Number.isFinite(uncached) || uncached < 0) return;
	const slot = accounting.first_call_uncached[phase] ??= { children: 0, tokens: 0 };
	slot.children++; slot.tokens += uncached;
}

function spend(accounting: ReadingAccounting, family: string): JevSpend {
	return accounting.jev[family] ??= { calls: 0, ms: 0, input_tokens: 0, output_tokens: 0 };
}
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * Tally a row the job writes. A verify unit row counts as run or reused. A host-side Jev decision made for this job is
 * written as `{event: "jev_decision", family, attempts, ms, input_tokens, output_tokens}` on the job's rows and counted here.
 */
export function tallyReadingRow(accounting: ReadingAccounting, row: Row): void {
	if (row?.phase === "verify" && row.unit !== undefined) {
		if (row.reused === true) accounting.units_reused++;
		else accounting.units_run++;
	}
	if (row?.event === "jev_decision" && typeof row.family === "string" && row.family) {
		const family = spend(accounting, row.family);
		family.calls += count(row.attempts) || 1; family.ms += count(row.ms);
		family.input_tokens += count(row.input_tokens); family.output_tokens += count(row.output_tokens);
	}
	// §151.3's host check reports its own spend on its `claim_support` row (requests, Jev ms, tokens), not as a jev_decision.
	if (row?.event === "claim_support" && typeof row.family === "string" && row.family && count(row.calls)) {
		const family = spend(accounting, row.family);
		family.calls += count(row.calls); family.ms += count(row.jev_ms);
		family.input_tokens += count(row.input_tokens); family.output_tokens += count(row.output_tokens);
	}
}

/** Add one reader child's Jev traffic from its `source-driver.jsonl` (`jev_transport` attempt and usage events). */
async function childTrace(accounting: ReadingAccounting, file: string): Promise<void> {
	let text: string;
	try { text = await readFile(file, "utf8"); } catch { return; }
	const families = new Map<string, string>();
	for (const line of text.split("\n")) {
		if (!line.includes('"jev_transport"')) continue;
		let event: Row;
		try { event = JSON.parse(line)?.event; } catch { continue; }
		if (event?.kind === "attempt" && typeof event.family === "string") {
			families.set(event.batchId, event.family);
			const family = spend(accounting, event.family);
			family.calls++; family.ms += count(event.ms);
		} else if (event?.kind === "usage" && families.has(event.batchId)) {
			const family = spend(accounting, families.get(event.batchId)!);
			family.input_tokens += count(event.inputTokens); family.output_tokens += count(event.outputTokens);
		}
	}
}

/**
 * The reader children of one attempt directory: its authors write `source-driver.jsonl` in the attempt itself, its
 * reviewers in `verify-<round>/unit-<n>/attempt-<k>-*`. Only this attempt's own directories are read.
 */
export async function tallyChildJev(accounting: ReadingAccounting, attempt: string): Promise<void> {
	await childTrace(accounting, join(attempt, "source-driver.jsonl"));
	const list = async (dir: string) => { try { return await readdir(dir); } catch { return []; } };
	for (const round of (await list(attempt)).filter(name => name.startsWith("verify-")))
		for (const unit of (await list(join(attempt, round))).filter(name => name.startsWith("unit-")))
			for (const run of (await list(join(attempt, round, unit))).filter(name => name.startsWith("attempt-")))
				await childTrace(accounting, join(attempt, round, unit, run, "source-driver.jsonl"));
}

/** The row's fields, in a stable shape. */
export function accountingFields(accounting: ReadingAccounting): Row {
	return { author_ms: accounting.author_ms, review_wall_ms: accounting.review_wall_ms, units_run: accounting.units_run, units_reused: accounting.units_reused,
		jev: accounting.jev, salvaged: accounting.salvaged, ...(accounting.repair ? { repair: accounting.repair } : {}), ...(accounting.need ? { need: accounting.need } : {}),
		first_call_uncached: accounting.first_call_uncached,
		...Object.fromEntries((["packet_bytes", "inlined", "known_nodes", "known_claims", "instruction_bytes"] as const)
			.filter(key => accounting[key] !== undefined).map(key => [key, accounting[key]])) };
}
