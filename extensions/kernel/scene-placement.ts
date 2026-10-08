/**
 * Contract §187.2.3: the host lane that places a place the Keeper is about to mint, before `table.apply` sees it.
 *
 * For each `move` effect of a model-origin `apply` that carries `establish`, the host reads the book places the kernel
 * enumerates (`table.apply.placement`), asks Jev the placement questions (`runtime/jev/scene-placement.ts`) and writes one
 * `lane: "scene-placement"` row. In `shadow` mode (the shipped mode) the row is written beside the move and the effect is
 * unchanged; the question runs in the background and never holds the turn. In `on` mode the outcome rewrites the effect
 * (`same`: a move to the book place, `establish` dropped; `inside`: `establish.within`), within `timeout_ms`; an outage,
 * a late answer or a low one is `mint`, and the move goes through as written. The lane never refuses a move.
 */
import { readJevApiKey } from "../jev/agent/config.js";
import { createDecisionAdapter } from "../../runtime/jev/decision-adapter.ts";
import { preparationBudget } from "../../runtime/jev/preparation-budget.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { SCENE_PLACEMENT_FAMILY, placedEffect, placementBindings, placementOutcome, runScenePlacement, scenePlacementBudget,
	type PlacementCandidate, type PlacementInput, type PlacementResult, type ScenePlacementBudget } from "../../runtime/jev/scene-placement.ts";

type Row = Record<string, unknown>;

export interface PlacementDeps {
	env: NodeJS.ProcessEnv;
	campaign: string;
	turn: number;
	callId: string;
	call: (method: string, params: Row) => Promise<unknown>;
	record: (row: Row) => unknown;
	signal?: AbortSignal;
	/** For tests only: the budget instead of the shipped file's. */
	budget?: ScenePlacementBudget;
}

/** The effects of a model-origin `apply` the lane asks about: a `move` with an `establish` object and a `to`. */
export function placementTargets(effects: unknown): number[] {
	if (!Array.isArray(effects)) return [];
	return effects.flatMap((value, index) => {
		const effect = value as Row | null;
		return effect && typeof effect === "object" && effect.kind === "move" && typeof effect.to === "string" && effect.to.trim()
			&& effect.establish && typeof effect.establish === "object" && !Array.isArray(effect.establish) ? [index] : [];
	});
}

async function ask(input: PlacementInput, deps: PlacementDeps, deadlineAt: number): Promise<PlacementResult> {
	const began = Date.now(), bindings = placementBindings(input), goal = "Place the destination the Keeper is about to mint";
	let lease: TaskLease | undefined, accounting: ReturnType<typeof preparationBudget> | undefined;
	const signal = deps.signal ?? new AbortController().signal;
	try {
		accounting = preparationBudget({
			decision: createDecisionAdapter({env: deps.env, maxConcurrency: 2, retryPolicies: {[SCENE_PLACEMENT_FAMILY]: {maxRetries: 0, backoffInitialMs: 100, backoffMaxMs: 1_000}}}),
			campaign: input.campaign, deadlineAt, signal, owner: SCENE_PLACEMENT_FAMILY, goal,
		});
		lease = new TaskLease({owner: SCENE_PLACEMENT_FAMILY, goal, scope: bindings.scope, capabilities: ["decision"], readSet: bindings.readSet, signal,
			budget: {deadlineAt, remainingInputTokens: 200_000, remainingOutputTokens: 10_000, remainingCostUsd: 0.02, remainingActions: 3}});
		return await runScenePlacement(input, accounting.decision, lease);
	} catch {
		return {status: "failed", reason: "placement_owner_error", elapsedMs: Date.now() - began, usage: {inputTokens: 0, outputTokens: 0, costUsd: 0}};
	} finally {
		lease?.close();
		accounting?.close();
	}
}

/** One placement: the kernel read, the question, the row; answers the effect to send. Never throws. */
async function placeOne(effect: Row, index: number, deps: PlacementDeps, budget: ScenePlacementBudget, wait: boolean): Promise<Row> {
	const base = {lane: "scene-placement", turn: deps.turn, call_id: deps.callId, index, to: effect.to, mode: budget.mode};
	const began = Date.now();
	try {
		if (!readJevApiKey(deps.env)) { await deps.record({...base, ok: true, skipped: "unconfigured", outcome: "mint"}); return effect; }
		const read = await deps.call("table.apply.placement", {campaign: deps.campaign, limit: budget.maxCandidates}) as Row;
		const scene = (read?.scene ?? {}) as PlacementInput["scene"], candidates = (Array.isArray(read?.candidates) ? read.candidates : []) as PlacementCandidate[];
		const establish = effect.establish as Row;
		const input: PlacementInput = {campaign: deps.campaign, turn: deps.turn, callId: deps.callId, index, to: String(effect.to),
			via: typeof effect.via === "string" ? effect.via : "", summary: typeof establish.summary === "string" ? establish.summary : "",
			scene: {name: String(scene.name ?? ""), ...(scene.display_name ? {display_name: String(scene.display_name)} : {}), summary: String(scene.summary ?? "")}, candidates};
		const result = await ask(input, deps, began + (wait ? budget.timeoutMs : Math.max(budget.timeoutMs, 10_000)));
		const decided = placementOutcome(result, budget, input.scene.name, candidates);
		const applied = budget.mode === "on" ? decided : undefined;
		await deps.record({...base, ok: result.status === "answered",
			question: {place: "choice", candidates: candidates.map(candidate => candidate.name), nouls: ["same", "inside"]},
			...(result.status === "answered" ? {chosen: result.chosen, distribution: result.distribution, confidence: result.confidence,
				same: result.same, inside: result.inside} : {reason: result.reason}),
			outcome: applied ? applied.outcome : "shadow", decision: decided.outcome,
			...(decided.outcome === "mint" ? {why: decided.reason} : 'handle' in decided ? {handle: decided.handle} : {within: null}), window: read?.window ?? null,
			ms: Date.now() - began});
		return applied ? placedEffect(effect, applied) : effect;
	} catch (error) {
		await deps.record({...base, ok: false, reason: "lane_crashed", outcome: "mint", detail: (error instanceof Error ? error.message : String(error)).slice(0, 200)});
		return effect;
	}
}

/**
 * §187.2.3: run the lane over a model-origin `apply` payload. `on` mode awaits each placement and replaces the effect
 * in `payload.effects`; `shadow` schedules the questions and returns at once; `off` does nothing.
 */
export async function placeEstablishedMoves(payload: Row, deps: PlacementDeps): Promise<void> {
	const targets = placementTargets(payload.effects);
	if (!targets.length) return;
	const shipped = deps.budget ?? await scenePlacementBudget(), override = deps.env.PI_COC_SCENE_PLACEMENT?.trim();
	// The mode alone may be overridden per process (`PI_COC_SCENE_PLACEMENT=off|shadow|on`); the bars stay data.
	const budget = override === "off" || override === "shadow" || override === "on" ? {...shipped, mode: override} as ScenePlacementBudget : shipped;
	if (budget.mode === "off") return;
	const effects = payload.effects as Row[];
	if (budget.mode === "shadow") {
		const snapshot = targets.map(index => [index, structuredClone(effects[index]!)] as const);
		const timer = setTimeout(() => { void (async () => {
			for (const [index, effect] of snapshot) { if (deps.signal?.aborted) return; await placeOne(effect, index, deps, budget, false); }
		})(); }, 0);
		(timer as {unref?: () => void}).unref?.();
		return;
	}
	for (const index of targets) effects[index] = await placeOne(effects[index]!, index, deps, budget, true);
}
