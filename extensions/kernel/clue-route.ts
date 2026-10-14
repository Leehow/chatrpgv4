/**
 * Contract §222.2: when the Keeper's `apply clue` is refused `check_first`, the host opens the rulebook's ways to the clue
 * that the kernel cannot read from receipts, and re-sends the same apply with the route attested (`found_by`).
 *
 * In order: the host's own no roll this turn (the engine's `coc:check-decided`; no Jev); then Jev -- a passed roll of the
 * visit of another skill whose method fits the clue (`fitting_check`), the clue obvious for progress (`obvious`). The kernel
 * verifies the receipt the attestation names; the judgement is Jev's. Only the model's own `apply` goes through here, never
 * the clerk's (whose rows the kernel already withholds, §222.1), and only in `on` mode is anything re-sent.
 */
import { readJevApiKey } from "../jev/agent/config.js";
import { createDecisionAdapter } from "../../runtime/jev/decision-adapter.ts";
import { clueRouteBudget, type ClueRouteBudget } from "../../runtime/jev/host-budgets.ts";
import { preparationBudget } from "../../runtime/jev/preparation-budget.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { CLUE_ROUTE_FAMILY, clueRouteBindings, clueRouteDecision, runClueRoute, type ClueRouteInput, type ClueRouteResult, type ClueRouteRoll } from "../../runtime/jev/clue-route.ts";

type Row = Record<string, unknown>;

/** The engine's check decision for the turn, as the extension keeps it (`coc:check-decided`). */
export interface CheckDecided { turn: number; status: string; why: string | null }

export interface ClueRouteDeps {
	env: NodeJS.ProcessEnv;
	campaign: string;
	turn: number;
	/** The player's declaration this turn, when the table holds it. */
	declaration?: string;
	/** The engine's check decision this turn, when it decided no roll. */
	noRoll?: CheckDecided;
	call: (method: string, params: Row) => Promise<unknown>;
	record: (row: Row) => unknown;
	signal?: AbortSignal;
	/** For tests only: the budget instead of the shipped file's. */
	budget?: ClueRouteBudget;
}

/** The kernel's `check_first` refusal, as the dispatcher reads it off the error. */
export interface CheckFirstRefusal {
	clue: string;
	check: { skill: string; difficulty?: string };
	routes: { other_rolls: ClueRouteRoll[]; idea_roll?: boolean };
	/** The refused effect's index in the batch. */
	index: number;
}

/** `PI_COC_CLUE_ROUTE=off|shadow|on` overrides the mode alone, per process; the bars stay data. */
function override(env: NodeJS.ProcessEnv): ClueRouteBudget["mode"] | undefined {
	const value = env.PI_COC_CLUE_ROUTE?.trim();
	return value === "off" || value === "shadow" || value === "on" ? value : undefined;
}

/** The refusal the dispatcher may open, or undefined for any other error. */
export function checkFirstRefusal(error: unknown): CheckFirstRefusal | undefined {
	const row = error as { codeDetail?: unknown; code_detail?: unknown; details?: Row } | null;
	if (!row || typeof row !== "object") return undefined;
	const detail = row.codeDetail ?? row.code_detail, details = row.details;
	if (detail !== "check_first" || !details || typeof details.clue !== "string") return undefined;
	const check = details.check as Row | undefined, routes = details.routes as Row | undefined;
	if (!check || typeof check.skill !== "string" || !routes) return undefined;
	const rolls = (Array.isArray(routes.other_rolls) ? routes.other_rolls : []).filter((entry): entry is Row => !!entry && typeof entry === "object" && typeof (entry as Row).id === "string")
		.map(entry => ({ id: String(entry.id), skill: String(entry.skill ?? ""), actor: typeof entry.actor === "string" ? entry.actor : null,
			goal: typeof entry.goal === "string" ? entry.goal : null, ...(typeof entry.turn === "number" ? { turn: entry.turn } : {}) }));
	return { clue: details.clue, check: { skill: check.skill, ...(typeof check.difficulty === "string" ? { difficulty: check.difficulty } : {}) },
		routes: { other_rolls: rolls, ...(routes.idea_roll === true ? { idea_roll: true } : {}) }, index: typeof details.index === "number" ? details.index : 0 };
}

async function ask(input: ClueRouteInput, deps: ClueRouteDeps, deadlineAt: number): Promise<ClueRouteResult> {
	const began = Date.now(), bindings = clueRouteBindings(input), goal = "Judge the rulebook's ways to a clue the book finds by a check";
	let lease: TaskLease | undefined, accounting: ReturnType<typeof preparationBudget> | undefined;
	const signal = deps.signal ?? new AbortController().signal;
	try {
		accounting = preparationBudget({
			decision: createDecisionAdapter({env: deps.env, maxConcurrency: 1, retryPolicies: {[CLUE_ROUTE_FAMILY]: {maxRetries: 1, backoffInitialMs: 250, backoffMaxMs: 1_000}}}),
			campaign: input.campaign, deadlineAt, signal, owner: CLUE_ROUTE_FAMILY, goal,
		});
		lease = new TaskLease({owner: CLUE_ROUTE_FAMILY, goal, scope: bindings.scope, capabilities: ["decision"], readSet: bindings.readSet, signal,
			budget: {deadlineAt, remainingInputTokens: 200_000, remainingOutputTokens: 10_000, remainingCostUsd: 0.02, remainingActions: 3}});
		return await runClueRoute(input, accounting.decision, lease);
	} catch {
		return {status: "failed", reason: "clue_route_owner_error", elapsedMs: Date.now() - began, usage: {inputTokens: 0, outputTokens: 0, costUsd: 0}};
	} finally {
		lease?.close();
		accounting?.close();
	}
}

/**
 * One refused clue: the `found_by` to re-send it with, or undefined when no route opens (the refusal then stands). Never
 * throws; one `clue-route` row either way.
 */
export async function openClueRoute(deps: ClueRouteDeps, refusal: CheckFirstRefusal): Promise<Row | undefined> {
	const began = Date.now();
	const shipped = deps.budget ?? await clueRouteBudget(), mode = override(deps.env) ?? shipped.mode;
	if (mode === "off" || deps.signal?.aborted) return undefined;
	const base = {lane: CLUE_ROUTE_FAMILY, event: "judged", turn: deps.turn, mode, clue: refusal.clue, check: refusal.check};
	try {
		// The host's own decision first: no roll this turn, the Keeper gives it by judgement (§163, §222.1 route 5).
		if (deps.noRoll && deps.noRoll.turn === deps.turn) {
			const chosen = {route: "no_roll"};
			await deps.record({...base, ok: true, no_roll: deps.noRoll, chosen: "no_roll", resent: mode === "on", ms: Date.now() - began});
			return mode === "on" ? chosen : undefined;
		}
		if (!readJevApiKey(deps.env)) { await deps.record({...base, ok: true, skipped: "unconfigured", chosen: null, resent: false, ms: Date.now() - began}); return undefined; }
		let read: Row;
		try { read = (await deps.call("table.apply.options", {campaign: deps.campaign}) ?? {}) as Row; }
		catch (error) {
			if (deps.signal?.aborted) return undefined;
			await deps.record({...base, ok: false, reason: "options_failed", chosen: null, resent: false, detail: (error instanceof Error ? error.message : String(error)).slice(0, 200)});
			return undefined;
		}
		const rows = (Array.isArray(read.candidates) ? read.candidates : []).map(value => (value ?? {}) as Row)
			.filter(row => (row.effect as Row | undefined)?.kind === "clue");
		if (deps.signal?.aborted) return undefined;
		const own = rows.find(row => (row.effect as Row).clue === refusal.clue);
		let description = (own?.description ?? {}) as Row;
		// A refused batch has already rolled back its move: canonical options may still describe the parent.
		// Read only the issued clue's existing private entity; this read grants no clue, location or roll authority.
		if (!own) {
			const lookup = (await deps.call("table.lookup", {campaign: deps.campaign, kind: "module", query: refusal.clue, expected_kind: "clue"}) ?? {}) as Row;
			if (deps.signal?.aborted) return undefined;
			const entities = Array.isArray(lookup.entities) ? lookup.entities : [], entity = entities[0] as Row | undefined;
			if (lookup.query === refusal.clue && lookup.expected_kind === "clue" && entities.length === 1 && entity?.name === refusal.clue
				&& entity.kind === "clue" && (entity.material === undefined || entity.material === "ready")) {
				description = {summary: entity.summary, supports: (Array.isArray(entity.relations) ? entity.relations : [])
					.filter((entry): entry is Row => !!entry && typeof entry === "object" && entry.kind === "supports" && typeof entry.to === "string" && entry.to.trim() !== "")
					.map(entry => ({name: entry.to, importance: null}))};
			}
		}
		if (typeof description.summary !== "string" || !description.summary.trim()) {
			await deps.record({...base, ok: false, reason: "basis_unavailable", chosen: null, resent: false, ms: Date.now() - began});
			return undefined;
		}
		const strings = (value: unknown): string[] => (Array.isArray(value) ? value : []).filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
		const supports = (Array.isArray(description.supports) ? description.supports : []).filter((entry): entry is Row => !!entry && typeof entry === "object")
			.map(entry => ({name: String(entry.name ?? ""), importance: typeof entry.importance === "string" ? entry.importance : null}));
		const input: ClueRouteInput = {campaign: deps.campaign, turn: deps.turn, declaration: deps.declaration ?? "",
			clue: {name: refusal.clue, summary: String(description.summary ?? ""), cues: strings(description.cues), check: refusal.check, supports,
				others: own ? rows.filter(row => row !== own).map(row => String(((row.description ?? {}) as Row).summary ?? "")).filter(Boolean).slice(0, 12) : []},
			rolls: refusal.routes.other_rolls};
		const result = await ask(input, deps, began + shipped.timeoutMs);
		if (deps.signal?.aborted) return undefined;
		const choice = clueRouteDecision(result, shipped);
		const chosen = choice ? (choice.route === "fitting_check" ? {route: "fitting_check", roll: choice.roll} : {route: "obvious"}) : undefined;
		await deps.record({...base, ok: result.status === "answered", ...(result.status === "answered" ? {fit: result.fit, obvious: result.obvious, usage: result.usage} : {reason: result.reason}),
			chosen: choice?.route ?? null, ...(choice ? {score: choice.score} : {}), resent: mode === "on" && !!chosen, ms: Date.now() - began});
		return mode === "on" ? chosen : undefined;
	} catch (error) {
		if (deps.signal?.aborted) return undefined;
		await deps.record({...base, ok: false, reason: "lane_crashed", chosen: null, resent: false, detail: (error instanceof Error ? error.message : String(error)).slice(0, 200)});
		return undefined;
	}
}

/** The same apply with `found_by` on the refused effect, or undefined when the payload has no such effect. */
export function withFoundBy(payload: Row, index: number, foundBy: Row): Row | undefined {
	const effects = Array.isArray(payload.effects) ? payload.effects : undefined;
	const effect = effects?.[index] as Row | undefined;
	if (!effects || !effect || effect.kind !== "clue") return undefined;
	return {...payload, effects: effects.map((entry, at) => at === index ? {...(entry as Row), found_by: foundBy} : entry)};
}
