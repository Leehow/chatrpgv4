/**
 * The verifier lane (contract §12.5). It runs after the delivery replacement is done: a
 * zero-tool subsession reads the delivered prose and the two fact lists, reports three kinds
 * of finding, and hands the result to `table.warn`.
 *
 * Three boundaries written down straight from the contract: everything is advisory (it changes
 * no state, blocks no delivery, reopens no turn); the lane judges with neither keywords nor
 * regexes; a failure only writes telemetry and never nags the Keeper.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runLane } from "../lanes/subsession.ts";

/** The closed set of three finding kinds; a row of any other kind is dropped whole. */
const FINDING_KINDS: ReadonlySet<string> = new Set(["reveal", "uncommitted_state", "player_agency"]);

/** The kernel takes at most 10 (§12.5), so trim here rather than have the whole batch judged invalid_params. */
const MAX_FINDINGS = 10;

export interface Finding {
	kind: string;
	quote: string;
	why: string;
}

/** The payload put on the bus after a successful `narrate` (contract §12.8). */
export interface CommitPayload {
	campaign: string;
	turn: number;
	commit?: string;
	job_id?: string;
	facts?: { committed?: unknown[]; keeper_only?: unknown[] };
	/** The Keeper's prose, verbatim (contract §5: the kernel renders no mechanics lines into it). */
	rendered_text: string;
	/** The language-neutral projection of this turn's receipts (contract §16.2); not sent to the lane. */
	mechanics?: unknown[];
}

function factLines(facts: unknown[] | undefined): string {
	if (!Array.isArray(facts) || facts.length === 0) return "(none)";
	return facts.map((fact) => `- ${typeof fact === "string" ? fact : JSON.stringify(fact)}`).join("\n");
}

export function verifierSystemPrompt(playLanguage?: string): string {
	return [
		"You are doing an after-the-fact verification pass for a Call of Cthulhu Keeper. The prose you read has already been delivered to the player and cannot be changed; you only report, you never rewrite.",
		"Look for three kinds of problem, and report none if you find none:",
		"- reveal: the prose says something from the Keeper-only list that the player has not yet earned at the table.",
		"- uncommitted_state: the prose claims a state change that is not on the committed-facts list — moving somewhere, gaining a clue, a number going up or down, time passing.",
		"- player_agency: the prose makes a voluntary choice for the player that he did not declare (a choice, something he said, an action he took).",
		"Answer with one JSON object only, no code fence and no explanation:",
		'{"findings":[{"kind":"reveal"|"uncommitted_state"|"player_agency","quote":"<the sentence from the prose, word for word, <=120 chars>","why":"<=200 chars>"}]}',
		'With no problems, answer {"findings":[]}.',
		"The quote must be taken verbatim from the prose: change one character, splice two sentences, or add a mark of punctuation, and the row is dropped.",
		playLanguage ? `Write why in ${playLanguage}.` : "",
	]
		.filter(Boolean)
		.join("\n");
}

export function buildVerifierInput(payload: CommitPayload): string {
	return [
		"[Delivered prose]",
		payload.rendered_text.trim(),
		"",
		"[Committed facts: everything that really happened this turn is here]",
		factLines(payload.facts?.committed),
		"",
		"[Keeper-only facts: what the player has not earned; saying it in the prose is an over-reveal]",
		factLines(payload.facts?.keeper_only),
	].join("\n");
}

/** Shape check: a closed enum and three string fields; everything else is dropped. Content is the model's call. */
export function shapeFindings(parsed: unknown): Finding[] | undefined {
	if (!parsed || typeof parsed !== "object") return undefined;
	const raw = (parsed as { findings?: unknown }).findings;
	if (!Array.isArray(raw)) return undefined;
	const findings: Finding[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const row = entry as Record<string, unknown>;
		if (typeof row.kind !== "string" || !FINDING_KINDS.has(row.kind)) continue;
		if (typeof row.quote !== "string" || row.quote.length === 0) continue;
		if (typeof row.why !== "string" || row.why.length === 0) continue;
		findings.push({ kind: row.kind, quote: row.quote, why: row.why });
		if (findings.length >= MAX_FINDINGS) break;
	}
	return findings;
}

export interface VerifierLaneOptions {
	ctx: ExtensionContext;
	payload: CommitPayload;
	playLanguage?: string;
	/** Kernel RPC; `table.warn` carries no call_id and does not look at turn state (contract §12.8). */
	call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
	record: (row: Record<string, unknown>) => Promise<void> | void;
	signal?: AbortSignal;
}

/**
 * Run the verifier lane once. It never throws: any failure writes one
 * `lane: "verifier", ok: false` telemetry row and stops there.
 * The caller fires and forgets; the delivery does not wait for it.
 */
export async function runVerifierLane(options: VerifierLaneOptions): Promise<void> {
	const { ctx, payload, call, record } = options;
	const began = Date.now();
	const lane = await runLane<Finding[]>({
		ctx,
		envName: "PI_COC_VERIFIER_MODEL",
		systemPrompt: verifierSystemPrompt(options.playLanguage),
		input: buildVerifierInput(payload),
		...(options.signal ? { signal: options.signal } : {}),
		shape: shapeFindings,
	});
	if (!lane.ok) {
		await record({
			lane: "verifier",
			turn: payload.turn,
			ok: false,
			ms: lane.ms,
			reason: lane.reason,
			detail: lane.detail.slice(0, 200),
			...(lane.model ? { model: lane.model } : {}),
		});
		return;
	}
	try {
		const result = (await call("table.warn", {
			campaign: payload.campaign,
			turn: payload.turn,
			lane: "verifier",
			findings: lane.value,
		})) as { recorded?: number; dropped?: number } | undefined;
		await record({
			lane: "verifier",
			turn: payload.turn,
			ok: true,
			ms: Date.now() - began,
			model: lane.model,
			findings: lane.value.length,
			...(typeof result?.recorded === "number" ? { recorded: result.recorded } : {}),
			...(typeof result?.dropped === "number" ? { dropped: result.dropped } : {}),
		});
	} catch (error) {
		await record({
			lane: "verifier",
			turn: payload.turn,
			ok: false,
			ms: Date.now() - began,
			model: lane.model,
			reason: "warn_failed",
			detail: (error instanceof Error ? error.message : String(error)).slice(0, 200),
		});
	}
}
