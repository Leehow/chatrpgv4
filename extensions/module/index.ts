/**
 * The module extension: the driver loop of the unattended build (contract §14.5) and the on-demand deepening lane (contract §14.6).
 *
 * It registers no tools. Each mode runs one thing:
 * - setup: onboarding's `build-opening` step puts `coc:module-build` on the bus, this runs
 *   `buildModule`, emits `coc:module-opening-ready` the moment `opening_ready` arrives, and emits
 *   `coc:module-build-done` when the whole book is read (`coc:module-build-failed` on failure, so the
 *   setup step is not left waiting for nothing).
 * - play: a background lane claims the section `module.deepen.claim` hands it, runs the same reader,
 *   reviews, accepts, assembles, then `module.deepen.complete`. One at a time, none started while a
 *   turn is in flight (contract §14.6: it never blocks a turn), and stopped at shutdown.
 *
 * There is only one kernel RPC (contract §1), taken from the bus's `coc:kernel-bridge` as the memory extension does.
 */

import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendJsonl, cocMode } from "../lanes/host.ts";
import { type BuildContext, buildModule, type KernelCall, readSection, resetReviewProbe } from "./build.ts";

/** The build concurrency cap (contract §14.5); 1 by default. */
function buildParallel(): number {
	const raw = Number.parseInt(process.env.PI_COC_BUILD_PARALLEL?.trim() ?? "", 10);
	return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/** The cap on one reader round; tests use it to bring the fake reader's wait down to seconds. */
function readerTimeoutMs(): number | undefined {
	const raw = Number.parseInt(process.env.PI_COC_READER_TIMEOUT_MS?.trim() ?? "", 10);
	return Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

/** The reader's model (contract §14.5): the one the environment variable names, else the table's own model. */
function readerModel(ctx: ExtensionContext | undefined): string | undefined {
	const raw = process.env.PI_COC_BUILD_MODEL?.trim();
	if (raw) return raw;
	const current = ctx?.model;
	return current ? `${current.provider}/${current.id}` : undefined;
}

function errorText(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export default function (pi: ExtensionAPI) {
	const setupMode = cocMode() === "setup";

	let ctx: ExtensionContext | undefined;
	let bridge: { campaign?: string; call: KernelCall } | undefined;
	let lanes = new AbortController();
	let stopped = false;
	/** Only one thing runs at a time: the build loop or one deepening. */
	let busy = false;
	/** A turn is in flight (the host has handed the player input to the kernel and the assistant has not finished): no new deepening starts. */
	let turnInFlight = false;
	/** A turn was just committed and the queue may have grown; claim once this run has ended. */
	let pendingClaim = false;
	/** In play mode, the current campaign's module, from `coc:table-open`. */
	let moduleId: string | undefined;
	let campaign: string | undefined;

	// ---- Telemetry --------------------------------------------------------

	/** Build telemetry: the module's `build.jsonl` (contract §14.1), plus one line each in the session record and the campaign telemetry. */
	function record(module: string, row: Record<string, unknown>): void {
		const line = { lane: "module", module_id: module, at: new Date().toISOString(), ...row };
		try {
			pi.appendEntry("coc-telemetry", line);
		} catch {
			/* telemetry must not break a lane */
		}
		let cwd: string | undefined;
		try {
			// After the session is disposed the ctx getters throw (docs/pi-host-contract.md §5).
			cwd = ctx?.cwd;
		} catch {
			cwd = undefined;
		}
		if (!cwd) return;
		void appendJsonl(join(cwd, ".coc", "modules", module, "build.jsonl"), line);
		if (campaign) void appendJsonl(join(cwd, ".coc", "campaigns", campaign, "telemetry.jsonl"), line);
	}

	/**
	 * The context a lane needs. The whole body sits in a try: after the session is disposed every ctx
	 * getter throws (docs/pi-host-contract.md §5), and a lane may well only get its turn after that.
	 */
	function context(call: KernelCall): BuildContext | undefined {
		try {
			const cwd = ctx?.cwd;
			if (!cwd) return undefined;
			const timeout = readerTimeoutMs();
			const model = readerModel(ctx);
			return {
				call,
				workspace: cwd,
				...(model ? { model } : {}),
				signal: lanes.signal,
				record,
				stopped: () => stopped,
				...(timeout ? { readerTimeoutMs: timeout } : {}),
			};
		} catch {
			return undefined;
		}
	}

	// ---- Building (setup mode) --------------------------------------------

	async function runBuild(request: { module_id: string; campaign?: string }): Promise<void> {
		const current = bridge;
		const build = current ? context(current.call) : undefined;
		if (!current || !build) {
			pi.events.emit("coc:module-build-failed", { module_id: request.module_id, detail: "the kernel bridge is gone; the build cannot start" });
			return;
		}
		if (busy) return;
		busy = true;
		try {
			const report = await buildModule(build, request.module_id, {
				parallel: buildParallel(),
				onOpeningReady: (status) => {
					pi.events.emit("coc:module-opening-ready", {
						module_id: request.module_id,
						...(request.campaign ? { campaign: request.campaign } : {}),
						status,
					});
				},
			});
			pi.events.emit("coc:module-build-done", { module_id: request.module_id, report });
		} catch (error) {
			const detail = errorText(error);
			record(request.module_id, { section_id: null, round: 0, reason: "build", accepted: false, detail });
			pi.events.emit("coc:module-build-failed", { module_id: request.module_id, detail });
		} finally {
			busy = false;
		}
	}

	// ---- On-demand deepening (play mode) ----------------------------------

	/**
	 * Claim a section, read it, then claim the next; stop the moment a turn opens, and stop at shutdown.
	 * No second claim between a claim and its completion: contract §14.6's one at a time.
	 */
	async function pumpDeepen(): Promise<void> {
		if (busy || stopped || turnInFlight) return;
		const current = bridge;
		if (!current) return;
		const deepen = context(current.call);
		if (!deepen) return;
		busy = true;
		try {
			while (!stopped && !turnInFlight && !lanes.signal.aborted) {
				let claim: Record<string, unknown>;
				try {
					claim = asRecord(
						await current.call("module.deepen.claim", moduleId ? { module_id: moduleId } : { campaign }),
					);
				} catch (error) {
					record(moduleId ?? "unknown", {
						section_id: null,
						round: 0,
						reason: "deepen",
						accepted: false,
						detail: `module.deepen.claim ${errorText(error)}`,
					});
					return;
				}
				const sectionId = asString(claim.section_id);
				if (!sectionId) return;
				const target = asString(claim.module_id) ?? moduleId;
				if (!target) return;
				const outcome = await readSection(deepen, target, sectionId, "deepen");
				try {
					await current.call("module.deepen.complete", {
						module_id: target,
						section_id: sectionId,
						status: outcome.accepted ? "accepted" : "failed",
						...(outcome.detail ? { detail: outcome.detail } : {}),
					});
				} catch (error) {
					record(target, {
						section_id: sectionId,
						round: outcome.rounds,
						reason: "deepen",
						accepted: outcome.accepted,
						detail: `module.deepen.complete ${errorText(error)}`,
					});
					return;
				}
			}
		} finally {
			busy = false;
		}
	}

	/** Claim only after something queued, and only at `agent_end`: the kernel is touched once the turn has really ended. */
	function kickDeepen(): void {
		if (setupMode || !pendingClaim) return;
		pendingClaim = false;
		void pumpDeepen().catch(() => undefined);
	}

	// ---- Bus --------------------------------------------------------------

	// The kernel extension emits the bridge in session_start; this extension subscribes at load time, so both load orders are caught.
	pi.events.on("coc:kernel-bridge", (data) => {
		const payload = asRecord(data) as { campaign?: string; call?: KernelCall };
		bridge = typeof payload.call === "function" ? { ...(payload.campaign ? { campaign: payload.campaign } : {}), call: payload.call } : undefined;
		if (bridge?.campaign) campaign = bridge.campaign;
	});

	pi.events.on("coc:table-open", (data) => {
		const payload = asRecord(data);
		campaign = asString(payload.campaign) ?? campaign;
		const open = asRecord(payload.open);
		moduleId = asString(asRecord(open.campaign).module_id) ?? moduleId;
	});

	/**
	 * A claim is only queued after a turn has been committed (contract §14.6: the kernel enqueues after a successful `move`).
	 * The section enqueued at opening (the starting scene, reason `opening`) can wait too: its turn comes
	 * as soon as the opening turn commits, which keeps one kernel round trip off the opening path and stops a lane from cutting into a turn.
	 */
	pi.events.on("coc:turn-committed", () => {
		pendingClaim = true;
	});

	// The setup process's `build-opening` step starts the build (step five of contract §14.4).
	pi.events.on("coc:module-build", (data) => {
		const payload = asRecord(data);
		const target = asString(payload.module_id);
		if (!target || stopped) return;
		campaign = asString(payload.campaign) ?? campaign;
		void runBuild({
			module_id: target,
			...(asString(payload.campaign) ? { campaign: asString(payload.campaign) as string } : {}),
		}).catch(() => undefined);
	});

	// No new deepening during a turn (contract §14.6: it never blocks a turn). The turn boundary comes from
	// the host's own hooks, not the bus: `before_agent_start` is the moment the player input enters the kernel, and `agent_end` is this run really ending.
	pi.on("before_agent_start", async () => {
		turnInFlight = true;
	});

	pi.on("agent_end", async () => {
		turnInFlight = false;
		kickDeepen();
	});

	pi.on("session_start", async (_event, sessionCtx) => {
		ctx = sessionCtx;
		stopped = false;
		turnInFlight = false;
		pendingClaim = false;
		lanes = new AbortController();
		resetReviewProbe();
	});

	pi.on("session_shutdown", async () => {
		// Shutdown does not wait for the build: reader subprocesses in flight are cut off, and unread sections stay in `sections.json` for next time.
		stopped = true;
		lanes.abort();
		bridge = undefined;
		ctx = undefined;
	});
}
