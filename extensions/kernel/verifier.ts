/**
 * The verifier lane (contract §12.5). It runs after the delivery replacement is done: a
 * zero-tool subsession reads the delivered prose and the fact lists, reports six kinds
 * of finding, and hands the result to `table.warn`.
 *
 * Three boundaries written down straight from the contract: everything is advisory (it changes
 * no state, blocks no delivery, reopens no turn); the lane judges with neither keywords nor
 * regexes; a failure only writes telemetry and never nags the Keeper.
 *
 * `play_language_mismatch` arrived with the open-language ruling (§23,
 * 2026-09-09). The kernel used to refuse a delivery whose player-facing fields carried none of the
 * campaign's script, which is a character-class detector and an open set has no table to look in.
 * Whether the prose is written in the player's language is a reading, so it is this lane's reading,
 * and it is advisory like the other findings: a warning on the turn, never a refused delivery.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { playLanguageTag } from "../../runtime/ui-words.ts";
import { modelLabel, resolveLaneModel, runLane } from "../lanes/subsession.ts";
import { extensionContentRoot } from "../ui/words.ts";
import { createDecisionAdapter } from "../../runtime/jev/decision-adapter.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import {
	POST_DELIVERY_VERIFIER_FAMILY,
	POST_DELIVERY_FINDING_KINDS,
	POST_DELIVERY_MAX_FINDINGS,
	POST_DELIVERY_VERIFIER_MODEL,
	postDeliveryVerifierFallbackBindings,
	postDeliveryVerifierBindings,
	runPostDeliveryVerifier,
} from "../../runtime/jev/post-delivery-verifier-domain.ts";

/** The closed set of finding kinds; a row of any other kind is dropped whole. */
const FINDING_KINDS: ReadonlySet<string> = new Set(POST_DELIVERY_FINDING_KINDS);

/** The kernel takes at most 10 (§12.5), so trim here rather than have the whole batch judged invalid_params. */
const MAX_FINDINGS = POST_DELIVERY_MAX_FINDINGS;

/** Cap on one verifier round, `PI_COC_LANE_TIMEOUT_MS`. Read per call: one process loads this several times. */
const DEFAULT_LANE_TIMEOUT_MS = 120_000;

export function laneTimeoutMs(): number {
	const raw = process.env.PI_COC_LANE_TIMEOUT_MS?.trim();
	if (!raw) return DEFAULT_LANE_TIMEOUT_MS;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 ? value : DEFAULT_LANE_TIMEOUT_MS;
}

export interface Finding {
	kind: string;
	quote: string;
	why: string;
	/**
	 * Which clue a `reveal` is about, when it is about one (contract §51.3).
	 *
	 * The lane already knew: on campaign `game-ef8e60aa` turn 11 its `why` said, in the play language,
	 * that the unearned clue chapel-ruins-location had been pointed out by Dooley in so many words --
	 * the handle was there, inside a prose sentence, where nothing downstream could read it.
	 * The prose the Keeper delivered had given the player a whole new place to go and the clue
	 * ledger never heard of it. Naming the handle in its own field is what lets the kernel compare
	 * the finding against `discovered_clues` at all; the judgement stays the lane's.
	 */
	clue?: string;
}

/** The payload put on the bus after a successful `narrate` (contract §12.8). */
export interface CommitPayload {
	campaign: string;
	turn: number;
	commit?: string;
	job_id?: string;
	facts?: { committed?: unknown[]; keeper_only?: unknown[]; public?: unknown[] };
	/** The Keeper's prose, verbatim (contract §5: the kernel renders no mechanics lines into it). */
	rendered_text: string;
	/** The language-neutral projection of this turn's receipts (contract §16.2); not sent to the lane. */
	mechanics?: unknown[];
	/** The spoken lines the say tokens marked (contract §40.2): `[{who, text}]`; absent on old kernels. */
	speech?: unknown[];
}

function factLines(facts: unknown[] | undefined): string {
	if (!Array.isArray(facts) || facts.length === 0) return "(none)";
	return facts.map((fact) => `- ${typeof fact === "string" ? fact : JSON.stringify(fact)}`).join("\n");
}

/**
 * The lane's instructions. The language its `why` is written in is always named: a campaign whose
 * `play_language` the kernel did not report reads as the tag the data calls the default, so the
 * findings never come back in whatever language the model felt like (contract §23). No tag is
 * written here; the data says which one the fallback is, and the tag itself is passed through.
 */
export async function verifierSystemPrompt(playLanguage?: string, contentRoot?: string): Promise<string> {
	const tag = await playLanguageTag(extensionContentRoot(contentRoot), playLanguage);
	return [
		"You are doing an after-the-fact verification pass for a Call of Cthulhu Keeper. The prose you read has already been delivered to the player and cannot be changed; you only report, you never rewrite.",
		"Look for six kinds of problem, and report none if you find none:",
		"- reveal: the prose says something from the Keeper-only list that the player has not yet earned at the table. What the already-public list shows the player was told before — their own name and occupation, the setup's prologue, earlier deliveries — is not a reveal when it is said again. When the thing revealed is one of the [Keeper-only facts] lines that begin \"Undiscovered clue:\", also answer clue with that line's name, copied exactly; leave clue out otherwise.",
		"- uncommitted_state: the prose claims a state change that is not on the committed-facts list — moving somewhere, gaining a clue, a number going up or down, time passing.",
		"- player_agency: the prose makes a voluntary choice for the player that he did not declare (a choice, something he said, an action he took).",
		`- play_language_mismatch: the player-facing prose is not written in ${tag}. Judge the prose as a reader of that language would, not by counting characters; proper names, quoted rules terms and dice notation are not a mismatch.`,
		"- unmarked_speech: a line someone speaks aloud that is not listed under [Spoken lines] below. Reported speech, thought, signage and a document's text are not lines.",
		"- investigator_identity_mismatch: the prose uses a pronoun, form of address, or identity description that explicitly conflicts with the investigator identity under [Already public]. Never infer identity from a name or occupation. If the supplied free-text sex is absent or does not settle the form in this language, do not report a mismatch.",
		"Answer with one JSON object only, no code fence and no explanation:",
		'{"findings":[{"kind":"reveal"|"uncommitted_state"|"player_agency"|"play_language_mismatch"|"unmarked_speech"|"investigator_identity_mismatch","quote":"<the sentence from the prose, word for word, <=120 chars>","why":"<=200 chars>","clue":"<the undiscovered clue name, on a reveal about one>"}]}',
		'With no problems, answer {"findings":[]}.',
		"The quote must be taken verbatim from the prose: change one character, splice two sentences, or add a mark of punctuation, and the row is dropped.",
		`Write why in ${tag}.`,
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
		"",
		"[Already public: what the player was told before this turn; a Keeper-only fact that this list shows was already told is not a reveal, and restating it is not an invention]",
		factLines(payload.facts?.public),
		"",
		"[Spoken lines: every line the Keeper marked as speech; a spoken line in the prose that is not here is unmarked_speech]",
		factLines(Array.isArray(payload.speech) ? payload.speech.map(line => {
			const row = line as { who?: { name?: string; label?: string }; text?: string };
			return `${row.who?.name ?? row.who?.label ?? "?"}: ${row.text ?? ""}`;
		}) : undefined),
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
		// The handle rides only on a reveal, and only when it is a nonempty string: a clue named on any
		// other kind is the model answering a question nobody asked (contract §51.3).
		const clue = row.kind === "reveal" && typeof row.clue === "string" && row.clue.trim() ? row.clue.trim() : undefined;
		findings.push({ kind: row.kind, quote: row.quote, why: row.why, ...(clue ? { clue } : {}) });
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

export interface VerifierFallbackAccounting {
	calls: number;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
}

/** Bind this verifier's incumbent completion to the same TaskLease without changing the shared lane runner. */
export function budgetedVerifierContext(ctx: ExtensionContext, lease: TaskLease, accounting: VerifierFallbackAccounting): ExtensionContext {
	const original = ctx.modelRegistry;
	const complete = async (model: NonNullable<ExtensionContext["model"]>, context: unknown, options: Record<string, unknown> = {}) => {
		lease.assertActive();
		const incumbent = lease.context.readSet.find(binding => binding.kind === "model"
			&& binding.resource === `${POST_DELIVERY_VERIFIER_FAMILY}:incumbent`);
		if (!incumbent || incumbent.revision !== modelLabel(model)) throw new Error("verifier_incumbent_model_changed");
		const inputTokens = Buffer.byteLength(JSON.stringify({ model: model.id, context }), "utf8");
		const requested = Number(options.maxTokens ?? model.maxTokens);
		const outputTokens = Math.min(requested, 8192);
		if (!Number.isSafeInteger(outputTokens) || outputTokens < 1) throw new Error("verifier_output_bound_unavailable");
		const rates = [model.cost, ...(model.cost.tiers ?? [])];
		const inputRate = Math.max(...rates.flatMap(rate => [rate.input, rate.cacheRead, rate.cacheWrite]));
		const outputRate = Math.max(...rates.map(rate => rate.output));
		if (![inputRate, outputRate].every(rate => Number.isFinite(rate) && rate >= 0)) throw new Error("verifier_cost_bound_unavailable");
		const costUsd = (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
		const reservation = lease.reserve({ inputTokens, outputTokens, costUsd, actions: 1 });
		accounting.calls++;
		let settled = false;
		const settle = (actual?: {inputTokens: number; outputTokens: number; costUsd: number; actions: number}) => {
			settled = true;
			if (actual) {
				accounting.inputTokens += actual.inputTokens;
				accounting.outputTokens += actual.outputTokens;
				accounting.costUsd += actual.costUsd;
				reservation.settle(actual);
			} else {
				accounting.inputTokens += inputTokens;
				accounting.outputTokens += outputTokens;
				accounting.costUsd += costUsd;
				reservation.settle();
			}
		};
		try {
			const reply = await original.complete(model, context as any, { ...options, maxTokens: outputTokens } as any);
			const usageKnown = [reply.usage.input, reply.usage.output, reply.usage.cacheRead, reply.usage.cacheWrite,
				reply.usage.totalTokens, reply.usage.cost.total].some(value => Number.isFinite(value) && value > 0);
			if (["error", "aborted"].includes(reply.stopReason) || !usageKnown) settle();
			else settle({ inputTokens: reply.usage.input + reply.usage.cacheRead + reply.usage.cacheWrite,
				outputTokens: reply.usage.output, costUsd: reply.usage.cost.total, actions: 1 });
			return reply;
		} catch (error) {
			if (!settled) settle();
			throw error;
		}
	};
	const registry = new Proxy(original, { get(target, property) {
		if (property === "complete") return complete;
		const value = Reflect.get(target, property, target);
		return typeof value === "function" ? value.bind(target) : value;
	} });
	return new Proxy(ctx, { get(target, property) {
		return property === "modelRegistry" ? registry : Reflect.get(target, property, target);
	} });
}

function createVerifierLease(bindings: ReturnType<typeof postDeliveryVerifierBindings>, deadlineAt: number, signal?: AbortSignal): TaskLease {
	return new TaskLease({
		owner: POST_DELIVERY_VERIFIER_FAMILY,
		goal: "Classify delivered prose against the closed advisory verifier families.",
		scope: bindings.scope,
		capabilities: ["decision"],
		readSet: bindings.readSet,
		signal,
		budget: { deadlineAt, remainingInputTokens: 1_000_000, remainingOutputTokens: 100_000,
			remainingCostUsd: 1, remainingActions: 32 },
	});
}

/**
 * Run the verifier lane once. It never throws: any failure writes one
 * `lane: "verifier", ok: false` telemetry row and stops there.
 * The caller fires and forgets; the delivery does not wait for it.
 *
 * Exactly one row is written, always, whichever way the round ends — the model reference not
 * resolving (`model_unavailable`), the completion erroring (`model_error`), the answer not being
 * the shape asked for (`bad_output`), the round running past its cap (`timeout`), or `table.warn`
 * refusing the findings (`warn_failed`). The two ways a lane can fail to start at all — the kernel
 * returning no `facts`, and the session being gone — are accounted for by the caller, which is the
 * only place that knows a turn was closed by narrate at all (ticket #28).
 */
export async function runVerifierLane(options: VerifierLaneOptions): Promise<void> {
	if (process.env.PI_COC_JEV_VERIFIER !== "1") {
		await runIncumbentVerifier(options, laneTimeoutMs());
		return;
	}
	const began = Date.now(), timeoutMs = laneTimeoutMs(), deadlineAt = began + timeoutMs;
	let lease: TaskLease | undefined;
	try {
		const playLanguage = await playLanguageTag(extensionContentRoot(), options.playLanguage);
		const incumbentModel = resolveLaneModel(options.ctx, "PI_COC_VERIFIER_MODEL");
		const input = {
			campaign: options.payload.campaign,
			turn: options.payload.turn,
			...(typeof options.payload.commit === "string" && options.payload.commit.trim() ? { commit: options.payload.commit.trim() } : {}),
			renderedText: options.payload.rendered_text,
			playLanguage,
			incumbentModel: incumbentModel.ok ? modelLabel(incumbentModel.model) : "unavailable",
			...(options.payload.facts ? { facts: options.payload.facts } : {}),
			...(options.payload.speech ? { speech: options.payload.speech } : {}),
		};
		if (!input.commit) {
			const bindings = postDeliveryVerifierFallbackBindings(input);
			lease = createVerifierLease(bindings, deadlineAt, options.signal);
			await runIncumbentVerifier(options, deadlineAt - Date.now(), lease.signal, { route: "incumbent", fallback: true,
				fallback_reason: "missing_commit", jev_model: POST_DELIVERY_VERIFIER_MODEL, jev_calls: 0,
				jev_input_tokens: 0, jev_output_tokens: 0, jev_cost_usd: 0, jev_ms: 0 }, began, lease);
			return;
		}
		const bindings = postDeliveryVerifierBindings(input);
		// This is an independent advisory root with no foreground TaskRuntime, plan, operation, or delivery authority.
		// The lease supplies one deadline and budget to every Jev round and the one permitted incumbent fallback.
		lease = createVerifierLease(bindings, deadlineAt, options.signal);
		const typed = await runPostDeliveryVerifier(input, createDecisionAdapter({
			apiKey: process.env.TYPESAFE_API_KEY,
			retryPolicies: { [POST_DELIVERY_VERIFIER_FAMILY]: {
				maxRetries: 0, backoffInitialMs: 100, backoffMaxMs: 1_000,
			} },
		}), lease);
		const typedMeta = { jev_model: POST_DELIVERY_VERIFIER_MODEL, jev_calls: typed.calls,
			jev_input_tokens: typed.usage.inputTokens, jev_output_tokens: typed.usage.outputTokens,
			jev_cost_usd: typed.usage.costUsd, jev_ms: typed.elapsedMs };
		if (typed.status === "complete") {
			await publishFindings(options, typed.findings, began, { route: "jev", model: POST_DELIVERY_VERIFIER_MODEL, ...typedMeta });
			return;
		}

		const remaining = deadlineAt - Date.now();
		if (remaining <= 0 || lease.signal.aborted) {
			await options.record({ lane: "verifier", turn: options.payload.turn, ok: false, ms: Date.now() - began,
				reason: remaining <= 0 ? "timeout" : "model_error",
				detail: remaining <= 0 ? `Jev did not complete and left no time for the incumbent verifier (${typed.reason})`
					: `The bounded verifier attempt was cancelled before incumbent fallback (${typed.reason})`,
				route: "jev", fallback: false, fallback_reason: typed.reason, ...typedMeta });
			return;
		}
		await runIncumbentVerifier(options, remaining, lease.signal, { route: "incumbent", fallback: true,
			fallback_reason: typed.reason, ...typedMeta }, began, lease);
	} catch (error) {
		await options.record({ lane: "verifier", turn: options.payload.turn, ok: false, ms: Date.now() - began,
			reason: Date.now() >= deadlineAt ? "timeout" : "model_error",
			detail: "The bounded verifier attempt failed before it could publish an advisory result",
			route: "jev", fallback: false, failure: error instanceof Error ? error.name : "unknown" });
	} finally {
		lease?.close();
	}
}

async function incumbent(options: VerifierLaneOptions, timeoutMs: number, signal = options.signal, lease?: TaskLease) {
	const accounting: VerifierFallbackAccounting = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
	const lane = await runLane<Finding[]>({
		ctx: lease ? budgetedVerifierContext(options.ctx, lease, accounting) : options.ctx,
		envName: "PI_COC_VERIFIER_MODEL",
		// The four `lane: "lane-call"` rows this round leaves (contract §12.8.1) go to the same
		// telemetry the one `lane: "verifier"` row does, carrying this turn like it.
		lane: "verifier",
		record: (row) => options.record({ turn: options.payload.turn, ...row }),
		systemPrompt: await verifierSystemPrompt(options.playLanguage),
		input: buildVerifierInput(options.payload),
		...(signal ? { signal } : {}),
		timeoutMs,
		shape: shapeFindings,
	});
	return { lane, accounting };
}

async function runIncumbentVerifier(options: VerifierLaneOptions, timeoutMs: number, signal = options.signal,
	meta: Record<string, unknown> = { route: "incumbent", fallback: false }, began = Date.now(), lease?: TaskLease): Promise<void> {
	const attempt = await incumbent(options, Math.max(1, timeoutMs), signal, lease), lane = attempt.lane;
	const incumbentMeta = lease ? { incumbent_calls: attempt.accounting.calls, incumbent_input_tokens: attempt.accounting.inputTokens,
		incumbent_output_tokens: attempt.accounting.outputTokens, incumbent_cost_usd: attempt.accounting.costUsd } : {};
	if (!lane.ok) {
		await options.record({
			lane: "verifier",
			turn: options.payload.turn,
			ok: false,
			ms: Date.now() - began,
			reason: lane.reason,
			detail: lane.detail.slice(0, 200),
			...(lane.model ? { model: lane.model } : {}),
			...meta,
			...incumbentMeta,
		});
		return;
	}
	await publishFindings(options, lane.value, began, { model: lane.model, ...meta, ...incumbentMeta });
}

async function publishFindings(options: VerifierLaneOptions, findings: Finding[], began: number,
	meta: Record<string, unknown>): Promise<void> {
	try {
		const result = (await options.call("table.warn", {
			campaign: options.payload.campaign,
			turn: options.payload.turn,
			lane: "verifier",
			findings,
		})) as { recorded?: number; dropped?: number } | undefined;
		await options.record({
			lane: "verifier",
			turn: options.payload.turn,
			ok: true,
			ms: Date.now() - began,
			findings: findings.length,
			...(typeof result?.recorded === "number" ? { recorded: result.recorded } : {}),
			...(typeof result?.dropped === "number" ? { dropped: result.dropped } : {}),
			...meta,
		});
	} catch (error) {
		await options.record({
			lane: "verifier",
			turn: options.payload.turn,
			ok: false,
			ms: Date.now() - began,
			reason: "warn_failed",
			detail: (error instanceof Error ? error.message : String(error)).slice(0, 200),
			...meta,
		});
	}
}
