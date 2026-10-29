/**
 * Contract §276: the host's Jev question over plain carried rows, run just before the background equipment preparation.
 * `mods.equipment.surfaces` lists the rows no verdict covers yet; Jev answers one Choice per row
 * (`runtime/jev/writing-surfaces.ts`); every answered row goes back through `mods.equipment.surfaces.submit`, and the kernel
 * keeps it, so a row is asked once. Jev unconfigured or failed submits nothing: those rows are not registered, and the
 * campaign is not asked again for a pause, so an outage does not cost every committed turn a call.
 */
import { TaskLease } from "../../runtime/jev/task-context.ts";
import type { DecisionPort } from "../../runtime/jev/decision-port.ts";
import { createDecisionAdapter } from "../../runtime/jev/decision-adapter.ts";
import { WRITING_SURFACES_FAMILY, WRITING_SURFACES_JUDGE_MS, WRITING_SURFACES_PER_BATCH, judgeWritingSurfaces, writingSurfaceBindings,
	type CarriedRow } from "../../runtime/jev/writing-surfaces.ts";
import type { Json } from "../../runtime/jev/contracts.ts";
import { readJevApiKey } from "../jev/agent/config.js";

type Row = Record<string, any>;
type Call = (method: string, params: Row) => Promise<any>;
export const WRITING_SURFACES_PAUSE_MS = 10 * 60_000;

export function createWritingSurfaceJudge(deps: { record: (row: Row) => void; decision?: () => DecisionPort | undefined; pauseMs?: number; judgeMs?: number }) {
	let port: DecisionPort | undefined;
	const decision = deps.decision ?? (() => readJevApiKey(process.env)
		? port ??= createDecisionAdapter({ env: process.env, maxConcurrency: 2, retryPolicies: { [WRITING_SURFACES_FAMILY]: { maxRetries: 1, backoffInitialMs: 200, backoffMaxMs: 2_000 } } })
		: undefined);
	const paused = new Map<string, number>();
	const note = (row: Row) => { try { deps.record({ lane: "writing-surfaces", ...row }); } catch { /* telemetry decides nothing */ } };
	/** Judge and submit the campaign's unjudged rows; the number of verdicts the kernel kept. Never throws. */
	return async function judge(campaign: string, call: Call, signal?: AbortSignal): Promise<number> {
		if ((paused.get(campaign) ?? 0) > Date.now()) return 0;
		try {
			const job = await call("mods.equipment.surfaces", { campaign });
			const rows: Row[] = Array.isArray(job?.rows) ? job.rows.filter((value: Row) => typeof value?.id === "string" && typeof value.name === "string") : [];
			if (!rows.length) return 0;
			let judgePort: DecisionPort | undefined;
			try { judgePort = decision(); } catch { judgePort = undefined; }
			if (!judgePort) { note({ event: "skipped", campaign, rows: rows.length, reason: "unconfigured" }); paused.set(campaign, Date.now() + (deps.pauseMs ?? WRITING_SURFACES_PAUSE_MS)); return 0; }
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
				paused.set(campaign, Date.now() + (deps.pauseMs ?? WRITING_SURFACES_PAUSE_MS));
				note({ event: "fallback", campaign, rows: asked.length, reason: judged.reason, ms, jev_calls: 1 });
				return 0;
			}
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
