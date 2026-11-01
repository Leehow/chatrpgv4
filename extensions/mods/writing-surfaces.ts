/**
 * Contract §277: the host's Jev question over plain carried rows, run just before the background equipment preparation.
 * `mods.equipment.surfaces` lists the rows no verdict covers yet; Jev answers one Choice per row
 * (`runtime/jev/writing-surfaces.ts`); every answered row goes back through `mods.equipment.surfaces.submit`, and the kernel
 * keeps it, so a row is asked once. Jev unconfigured or failed submits nothing: those rows are not registered. The pause
 * exists only so an outage does not cost every committed turn a call (d3cd95801): one or two failures in a row pause
 * nothing, the third pauses one minute and each further one doubles it up to ten; an answer resets the count.
 */
import { TaskLease } from "../../runtime/jev/task-context.ts";
import type { DecisionPort } from "../../runtime/jev/decision-port.ts";
import { createDecisionAdapter } from "../../runtime/jev/decision-adapter.ts";
import { WRITING_SURFACES_FAMILY, WRITING_SURFACES_JUDGE_MS, WRITING_SURFACES_PER_BATCH, judgeWritingSurfaces, writingSurfaceBindings,
	type CarriedRow } from "../../runtime/jev/writing-surfaces.ts";
import type { Json } from "../../runtime/jev/contracts.ts";
import { readJevApiKey } from "../jev/agent/config.js";
/** Audit 1101: a failed connection is retried too, inside the 30 s judgement bound. */
export const WRITING_SURFACES_RETRY = { maxRetries: 1, backoffInitialMs: 200, backoffMaxMs: 2_000, retryNetwork: true };

type Row = Record<string, any>;
type Call = (method: string, params: Row) => Promise<any>;
/** Jev not configured: the key does not appear mid-session, so the campaign is not listed again for ten minutes. */
export const WRITING_SURFACES_PAUSE_MS = 10 * 60_000;
/**
 * §277 failure backoff (audit 1101: one network blip paused a campaign's surface verdicts for ten minutes). The first
 * WRITING_SURFACES_FREE_FAILURES failures in a row pause nothing: a committed turn comes every minute or few, so the next
 * one asks again and a single bad connection costs one turn. From the third, the pause is one minute, doubling per further
 * failure, at most ten minutes (the old pause, the cost bound of a long outage: at most six asks an hour). An answered
 * question resets the count.
 */
export const WRITING_SURFACES_FREE_FAILURES = 2, WRITING_SURFACES_BACKOFF_MS = 60_000;
export const writingSurfacesBackoff = (failures: number): number => failures <= WRITING_SURFACES_FREE_FAILURES ? 0
	: Math.min(WRITING_SURFACES_PAUSE_MS, WRITING_SURFACES_BACKOFF_MS * 2 ** (failures - WRITING_SURFACES_FREE_FAILURES - 1));

export function createWritingSurfaceJudge(deps: { record: (row: Row) => void; decision?: () => DecisionPort | undefined; pauseMs?: number; judgeMs?: number; now?: () => number }) {
	let port: DecisionPort | undefined;
	const decision = deps.decision ?? (() => readJevApiKey(process.env)
		? port ??= createDecisionAdapter({ env: process.env, maxConcurrency: 2, retryPolicies: { [WRITING_SURFACES_FAMILY]: WRITING_SURFACES_RETRY } })
		: undefined);
	const paused = new Map<string, number>(), failures = new Map<string, number>(), now = deps.now ?? Date.now;
	const note = (row: Row) => { try { deps.record({ lane: "writing-surfaces", ...row }); } catch { /* telemetry decides nothing */ } };
	/** Judge and submit the campaign's unjudged rows; the number of verdicts the kernel kept. Never throws. */
	return async function judge(campaign: string, call: Call, signal?: AbortSignal): Promise<number> {
		if ((paused.get(campaign) ?? 0) > now()) return 0;
		try {
			const job = await call("mods.equipment.surfaces", { campaign });
			const rows: Row[] = Array.isArray(job?.rows) ? job.rows.filter((value: Row) => typeof value?.id === "string" && typeof value.name === "string") : [];
			if (!rows.length) return 0;
			let judgePort: DecisionPort | undefined;
			try { judgePort = decision(); } catch { judgePort = undefined; }
			if (!judgePort) { note({ event: "skipped", campaign, rows: rows.length, reason: "unconfigured" }); paused.set(campaign, now() + (deps.pauseMs ?? WRITING_SURFACES_PAUSE_MS)); return 0; }
			const asked: CarriedRow[] = rows.slice(0, WRITING_SURFACES_PER_BATCH).map(value => ({ name: value.name, row: value.row as Json }));
			const bound = deps.judgeMs ?? WRITING_SURFACES_JUDGE_MS, began = Date.now();
			const lease = new TaskLease({ owner: WRITING_SURFACES_FAMILY, goal: "Judge whether each carried row is something the investigator can write in",
				...writingSurfaceBindings(asked, campaign), capabilities: ["decision"],
				signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(bound)]) : AbortSignal.timeout(bound),
				budget: { deadlineAt: began + bound, remainingInputTokens: 100_000, remainingOutputTokens: 20_000, remainingCostUsd: 0.02, remainingActions: 1 } });
			let judged;
			try { judged = await judgeWritingSurfaces(asked, judgePort, lease, campaign); } finally { lease.close(); }
			const ms = Date.now() - began;
			if (judged.status !== "judged") {
				const count = (failures.get(campaign) ?? 0) + 1, pause = writingSurfacesBackoff(count);
				failures.set(campaign, count);
				if (pause) paused.set(campaign, now() + pause);
				note({ event: "fallback", campaign, rows: asked.length, reason: judged.reason, ms, jev_calls: 1, failures: count, pause_ms: pause });
				return 0;
			}
			failures.delete(campaign);
			const verdicts = judged.verdicts.map((verdict, i) => ({ id: rows[i].id, surface: verdict.surface }));
			const answer = await call("mods.equipment.surfaces.submit", { campaign, version: job.version, verdicts });
			note({ event: "judged", campaign, rows: asked.length, written: answer?.written ?? null, ms, jev_calls: 1,
				surfaces: judged.verdicts.map((verdict, i) => ({ name: asked[i].name, surface: verdict.surface, confidence: Math.round(verdict.confidence * 100) / 100 })) });
			return Number(answer?.written) || 0;
		} catch (error) {
			note({ event: "fallback", campaign, reason: "error", message: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
			return 0;
		}
	};
}
