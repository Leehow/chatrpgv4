/**
 * The NPC speech edit lane (contract §165).
 *
 * The Keeper's NPC lines read like stitched written sentences; an editing pass anchored on the owner's own rewrites
 * made them read like speech without changing a fact. This lane runs that pass after a narrate delivery, off the
 * player's path: the player reads the Keeper's lines at once, and the edited lines replace them on the card in place
 * when they arrive (owner, 2026-10-01).
 *
 * The base owns the mechanism and no wording. The instruction and the demonstrations come from the one enabled package
 * that contributes `speech_edit_lane` (§165.2); the kernel resolves it and hands it over with the turn in `speech.job`.
 * One zero-tool completion per turn (the owner's exception to the single-completion rule) writes one edited line per
 * NPC line; the host then checks the shape, keeps each line's quotation marks, and asks Jev of every changed line
 * whether a fact changed (§165.4). What survives lands twice: the kernel's `speech_edit` overlay on the turn record
 * (`speech.edit`, audit and history) and one §132 card patch for the player. The delivered record -- `text`,
 * `rendered_text`, `marked_text`, `speech`, the transcript row -- is never rewritten, so the Keeper and every kernel
 * reader keep the original lines.
 *
 * One `coc-telemetry` row per run, `lane: "speech-edit"` (§165.7). A lane with no contributing package does not run and
 * writes nothing.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cocMode } from "../lanes/host.ts";
import { createLaneQueue, type KernelCall, type LaneJob } from "../lanes/queue.ts";
import { runLane } from "../lanes/subsession.ts";
import { createLaneTelemetry } from "../lanes/telemetry.ts";
import { patchCard } from "../table/card-patch.ts";
import { readJevApiKey } from "../jev/agent/config.js";
import { createDecisionAdapter, JEV_INPUT_USD_PER_MILLION } from "../../runtime/jev/decision-adapter.ts";
import { packDecisionBatch } from "../../runtime/jev/question-packing.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import {
	SPEECH_EDIT_FACT_GATE, SPEECH_EDIT_FACTS_FAMILY, runSpeechEditFacts, speechEditFactsBatch, speechEditFactsBindings,
	type SpeechEditFactLine, type SpeechEditFactsResult,
} from "../../runtime/jev/speech-edit-facts-domain.ts";
import { keepQuotationMarks, shapeLines, speechEditPatch, type SpeechRow } from "./lines.ts";

export const LANE = "speech-edit";
export const MODEL_ENV = "PI_COC_SPEECH_EDIT_MODEL";
/** §165.3: one round, cut at a minute; the speed test's every arm answered in 15-17 s at the median. */
export const LANE_TIMEOUT_MS = 60_000;
/** §165.3: the effort the owner judged the lane on (grok-4.7 has no level below it). */
const LANE_THINKING = "low" as const;
/** The Jev round of one edit: a few nouls in one request, one retry on a dropped connection, then the edit is dropped. */
export const JEV_TIMEOUT_MS = 15_000;
const JEV_RETRY = { maxRetries: 1, backoffInitialMs: 200, backoffMaxMs: 1_000, retryNetwork: true, retryTimeout: false };
/** The answer shape is the host's, so a package's words never have to carry it. */
const ANSWER_SHAPE = 'Answer with JSON only, no code fence: {"lines": ["<line 1>", "<line 2>", ...]} with exactly as many lines as given, in the same order.';

/** One NPC row of `speech.job`: its index in `speech`, who said it, their mask when the dossier has one, the line as delivered. */
interface LaneLine { index: number; speaker: string; voice_mask?: string; text: string }
interface LanePacket {
	turn?: number;
	lane?: { mod: string; version: string } | null;
	reason?: string;
	contributors?: Array<{ mod: string; version: string }>;
	instruction?: string;
	player_text?: string;
	rendered_text?: string;
	marked_text?: string;
	speech?: SpeechRow[];
	lines?: LaneLine[];
}

/** §165.3: the trigger reads the bus payload alone -- a delivery with at least one NPC row in its `speech`. */
export function hasNpcLine(payload: Record<string, unknown>): boolean {
	return Array.isArray(payload.speech) && payload.speech.some(row => {
		const who = (row as { who?: { npc?: unknown } } | null)?.who;
		return typeof who?.npc === "string" && who.npc.length > 0;
	});
}

/** §165.3: the v2 prompt -- the package's words, then the player's text, the turn's prose and every NPC line in order. */
export function lanePrompt(packet: LanePacket): { systemPrompt: string; input: string } {
	const body = ["[Player this turn]", packet.player_text ?? "", "", "[Turn prose]", packet.rendered_text ?? "", "", "[Spoken lines to edit]"];
	for (const [at, line] of (packet.lines ?? []).entries()) {
		body.push(`${at + 1}. speaker: ${line.speaker}` + (line.voice_mask ? ` | how they are heard: ${line.voice_mask}` : ""));
		body.push(`   line: ${line.text}`);
	}
	return { systemPrompt: `${(packet.instruction ?? "").trim()}\n\n${ANSWER_SHAPE}`, input: body.join("\n") };
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 200);
const errorCode = (error: unknown): string | undefined => {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : undefined;
};

export default function speechEdit(pi: ExtensionAPI) {
	// Character creation has no deliveries and so no lines to edit.
	if (cocMode() === "setup") return;

	const telemetry = createLaneTelemetry(pi, { lane: LANE, modelEnv: MODEL_ENV, cwd: () => scheduler.ctx?.cwd });
	const scheduler = createLaneQueue(pi, {
		accept: hasNpcLine,
		runJob,
		onError: (job, error) => telemetry.record(job.campaign, {
			...(job.turn !== undefined ? { turn: job.turn } : {}), ok: false, outcome: "dropped:lane_failed", reason: "lane_error", detail: errorText(error),
		}),
	});

	/** The facts gate (§165.4 gate 3) for the changed lines of one edit; never throws. */
	async function askJev(campaign: string, turn: number, lines: SpeechEditFactLine[]): Promise<SpeechEditFactsResult> {
		const input = { campaign, turn, lines }, bindings = speechEditFactsBindings(input);
		let lease: TaskLease | undefined;
		try {
			const bound = packDecisionBatch(speechEditFactsBatch(input, bindings)).estimate, attempts = JEV_RETRY.maxRetries + 1;
			const inputTokens = bound.totalUpperBound * attempts;
			lease = new TaskLease({ owner: SPEECH_EDIT_FACTS_FAMILY, goal: "Check that an edit of NPC lines changed no fact",
				scope: bindings.scope, capabilities: ["decision"], readSet: bindings.readSet, signal: scheduler.signal,
				budget: { deadlineAt: Date.now() + JEV_TIMEOUT_MS, remainingInputTokens: inputTokens,
					remainingOutputTokens: bound.responseUpperBound * attempts,
					remainingCostUsd: inputTokens * JEV_INPUT_USD_PER_MILLION / 1_000_000 + 0.001, remainingActions: attempts } });
			const decision = createDecisionAdapter({ env: process.env, maxConcurrency: 2, retryPolicies: { [SPEECH_EDIT_FACTS_FAMILY]: JEV_RETRY } });
			return await runSpeechEditFacts(input, decision, lease);
		} catch (error) {
			return { status: "unavailable", reason: errorCode(error) ?? "speech_edit_facts_owner_error", calls: 0, elapsedMs: 0,
				usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
		} finally {
			lease?.close();
		}
	}

	async function runJob(job: LaneJob): Promise<void> {
		const began = Date.now(), turn = job.turn, bridge = scheduler.bridge, ctx = scheduler.ctx;
		if (turn === undefined) return;
		const base: Record<string, unknown> = { turn };
		const finish = (outcome: string, row: Record<string, unknown> = {}) => telemetry.record(job.campaign, {
			...base, ok: !["dropped:lane_failed", "dropped:shape", "dropped:jev_unavailable", "dropped:conflict"].includes(outcome),
			outcome, wall_ms: Date.now() - began, ...row,
		});
		if (!bridge || !ctx) return void await finish("dropped:lane_failed", { reason: "lane_error", detail: "the kernel bridge is gone; the lane cannot run" });
		const call: KernelCall = bridge.call;

		// The turn as the kernel holds it, and the one package whose words the lane speaks with.
		let packet: LanePacket;
		try {
			packet = ((await call("speech.job", { campaign: job.campaign, turn })) ?? {}) as LanePacket;
		} catch (error) {
			return void await finish("dropped:lane_failed", { reason: "lane_error", detail: `speech.job ${errorCode(error) ?? "internal"}: ${errorText(error)}` });
		}
		if (!packet.lane) {
			// No enabled package contributes the lane: it does not run, and that is not an event.
			if (packet.reason === "none") return;
			if (packet.reason === "conflict")
				return void await finish("dropped:conflict", { reason: "conflict", contributors: packet.contributors ?? [],
					detail: `${(packet.contributors ?? []).map(row => `${row.mod} ${row.version}`).join(", ")} each contribute speech_edit_lane` });
			return void await finish("dropped:stale", { reason: packet.reason ?? "no_record" });
		}
		const lines = packet.lines ?? [], speech = packet.speech ?? [];
		base.mod = packet.lane.mod;
		base.lines = lines.length;
		// Without Jev there is no facts gate, and without the gate there is no edit (§165.4): no model call is spent on one.
		if (!readJevApiKey(process.env))
			return void await finish("dropped:jev_unavailable", { reason: "jev_unavailable", detail: "unconfigured" });

		const { systemPrompt, input } = lanePrompt(packet);
		const lane = await runLane<Record<string, unknown>>({
			ctx, envName: MODEL_ENV, lane: LANE, systemPrompt, input, signal: scheduler.signal, timeoutMs: LANE_TIMEOUT_MS,
			thinking: LANE_THINKING, record: row => telemetry.record(job.campaign, { turn, ...row }),
			shape: parsed => parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined,
		});
		if (lane.model) base.model = lane.model;
		if (!lane.ok)
			return void await finish(lane.reason === "bad_output" ? "dropped:shape" : "dropped:lane_failed",
				{ reason: lane.reason === "bad_output" ? "invalid" : lane.reason, detail: lane.detail.slice(0, 200) });

		// Gate 1: one non-empty line per NPC row, no marker syntax; anything else drops the whole edit.
		const shaped = shapeLines(lane.value, lines.length);
		if (!shaped.ok) return void await finish("dropped:shape", { reason: "invalid", detail: shaped.detail });

		// Gate 2: each line keeps its own quotation marks; a line that does not keeps its original.
		const quoteReverted: number[] = [], proposed: SpeechEditFactLine[] = [];
		for (const [at, line] of lines.entries()) {
			const kept = keepQuotationMarks(line.text, shaped.lines[at]);
			if (kept === undefined) { quoteReverted.push(line.index); continue; }
			if (kept !== line.text) proposed.push({ index: line.index, original: line.text, edited: kept });
		}
		const quoted = quoteReverted.length ? { quote_reverted: quoteReverted } : {};
		if (!proposed.length)
			return void await finish(quoteReverted.length ? "dropped:quotes" : "nothing_changed", { changed: 0, ...quoted });

		// Gate 3: one Noul per changed line; unchanged lines are never asked. Jev unavailable drops the whole edit.
		const facts = await askJev(job.campaign, turn, proposed);
		if (facts.status !== "answered")
			return void await finish("dropped:jev_unavailable", { reason: "jev_unavailable", detail: facts.reason, ...quoted });
		const noul = new Map(facts.nouls.map(row => [row.index, row.noul]));
		const verdicts = proposed.map(line => ({ index: line.index, noul: noul.get(line.index)!,
			verdict: noul.get(line.index)! >= SPEECH_EDIT_FACT_GATE ? "kept_original" : "edited" }));
		const asked = { verdicts, jev_ms: facts.elapsedMs, ...quoted };
		const landing = proposed.filter(line => noul.get(line.index)! < SPEECH_EDIT_FACT_GATE);
		if (!landing.length) return void await finish("nothing_changed", { changed: 0, ...asked });

		// The patch is built before anything lands: a card whose spans cannot be paired takes no overlay either.
		const patch = typeof packet.marked_text === "string"
			? speechEditPatch(packet.marked_text, speech, new Map(landing.map(line => [line.index, line.edited])))
			: undefined;
		if (!patch) return void await finish("dropped:no_card", { reason: "unpaired_spans", ...asked });
		if (scheduler.stopped) return;
		let landed: { ok?: unknown; reason?: unknown };
		try {
			landed = ((await call("speech.edit", { campaign: job.campaign, turn, lines: landing, model: lane.model })) ?? {}) as typeof landed;
		} catch (error) {
			return void await finish("dropped:lane_failed", { reason: "lane_error", detail: `speech.edit ${errorCode(error) ?? "internal"}: ${errorText(error)}`, ...asked });
		}
		if (landed.ok !== true) return void await finish("dropped:stale", { reason: typeof landed.reason === "string" ? landed.reason : "stale", ...asked });
		if (!patchCard(pi, { campaign: job.campaign, card: { turn }, patch, source: LANE }))
			return void await finish("dropped:no_card", { reason: "patch_not_written", ...asked });
		await finish("applied", { changed: landing.length, ...asked });
	}
}
