/**
 * The module extension: the driver loop of the unattended build (contract §14.5), the on-demand
 * deepening lane (contract §14.6) and the PDF ingest job (contract §20.2).
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
 * Both modes also answer `coc:module-ingest`: a PDF path in, an installed module out, with
 * `coc:module-ingest-progress` per stage and `-done`/`-failed` at the end. No logic lives in the
 * command that starts it (contract §20.4) — the terminal and a future Electron front end put the same
 * request on the same channel and read the same progress.
 *
 * There is only one kernel RPC (contract §1), taken from the bus's `coc:kernel-bridge` as the memory extension does.
 */

import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendJsonl, cocHome, cocMode } from "../lanes/host.ts";
import { type BuildContext, type BuildReport, buildModule, type KernelCall, readSection, resetReviewProbe } from "./build.ts";
import { ingest, IngestError, type IngestRequest } from "./ingest.ts";
import { ReadingService } from "./reading-service.ts";

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
	let reading: ReadingService | undefined;
	let visualModule = false;
	function shareReader(): void {
		if (!ctx || !bridge) return;
		reading?.dispose();
		const current = bridge;
		reading = new ReadingService({
			call: current.call, home: cocHome(ctx.cwd),
			model: () => {
				const id = readerModel(ctx) ?? "";
				const slash = id.indexOf("/");
				const model = ctx?.modelRegistry.find(id.slice(0, slash), id.slice(slash + 1));
				return { id, vision: model?.input?.includes("image") === true };
			},
			progress: row => pi.events.emit("coc:module-ingest-progress", row),
			record: row => { void appendJsonl(join(cocHome(ctx!.cwd), ".coc", "reading-telemetry.jsonl"), row); },
		});
		pi.events.emit("coc:reading-bridge", reading);
	}
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

	/** The workspace root (contract §20.7); undefined once the session is disposed and its getters throw. */
	function home(): string | undefined {
		try {
			// After the session is disposed the ctx getters throw (docs/pi-host-contract.md §5).
			const cwd = ctx?.cwd;
			return cwd ? cocHome(cwd) : undefined;
		} catch {
			return undefined;
		}
	}

	/** Build telemetry: the module's `build.jsonl` (contract §14.1), plus one line each in the session record and the campaign telemetry. */
	function record(module: string, row: Record<string, unknown>): void {
		const line = { lane: "module", module_id: module, at: new Date().toISOString(), ...row };
		try {
			pi.appendEntry("coc-telemetry", line);
		} catch {
			/* telemetry must not break a lane */
		}
		const root = home();
		if (!root) return;
		void appendJsonl(join(root, ".coc", "modules", module, "build.jsonl"), line);
		if (campaign) void appendJsonl(join(root, ".coc", "campaigns", campaign, "telemetry.jsonl"), line);
	}

	/**
	 * Ingest telemetry (contract §20.2): `lane: "ingest"`, one row per stage. It goes to the job's own
	 * work directory as well as the session record, because an ingest may well have no campaign and no
	 * module id yet. The OCR credential is never part of a row: only whether the adapter could see one.
	 */
	function recordIngest(row: Record<string, unknown>): void {
		const line = { lane: "ingest", at: new Date().toISOString(), ...row };
		try {
			pi.appendEntry("coc-telemetry", line);
		} catch {
			/* telemetry must not break a lane */
		}
		const root = home();
		const workDir = typeof row.work_dir === "string" ? row.work_dir : undefined;
		if (workDir) void appendJsonl(join(workDir, "ingest.jsonl"), line);
		if (root && campaign) void appendJsonl(join(root, ".coc", "campaigns", campaign, "telemetry.jsonl"), line);
	}

	/**
	 * The context a lane needs. The whole body sits in a try: after the session is disposed every ctx
	 * getter throws (docs/pi-host-contract.md §5), and a lane may well only get its turn after that.
	 */
	function context(call: KernelCall): BuildContext | undefined {
		try {
			const workspace = home();
			if (!workspace) return undefined;
			const timeout = readerTimeoutMs();
			const model = readerModel(ctx);
			return {
				call,
				workspace,
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

	/**
	 * One unattended build, with the four bus channels of contract §14.5. It throws on failure (after
	 * emitting `coc:module-build-failed`, so a waiting setup step is never left hanging), because the
	 * ingest job of contract §20.2 runs the very same build and has to know whether it finished.
	 */
	async function runBuild(request: { module_id: string; campaign?: string }): Promise<BuildReport> {
		const current = bridge;
		const build = current ? context(current.call) : undefined;
		// An ingest already holds the lane for its own build; anything else waits for its turn rather than colliding.
		const holds = ingestHoldsLane;
		if (!current || !build || (busy && !holds)) {
			const detail = busy
				? "another build is already running in this session"
				: "the kernel bridge is gone; the build cannot start";
			pi.events.emit("coc:module-build-failed", { module_id: request.module_id, detail });
			throw new Error(detail);
		}
		if (!holds) busy = true;
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
			return report;
		} catch (error) {
			const detail = errorText(error);
			record(request.module_id, { section_id: null, round: 0, reason: "build", accepted: false, detail });
			pi.events.emit("coc:module-build-failed", { module_id: request.module_id, detail });
			throw error;
		} finally {
			if (!holds) busy = false;
		}
	}

	// ---- PDF ingest (contract §20.2) --------------------------------------

	/** One ingest at a time per file: the job is reentrant across runs, not concurrent with itself. */
	const ingesting = new Set<string>();
	/** The ingest holds the single lane for its whole run, so no deepening cuts in and its own build is not refused. */
	let ingestHoldsLane = false;

	async function runIngest(request: IngestRequest): Promise<void> {
		const pdf = request.pdf?.trim() ?? "";
		const current = bridge;
		const root = home();
		const fail = (reason: string, detail: string) => {
			recordIngest({ stage: "classify", ok: false, reason, detail, pdf });
			pi.events.emit("coc:module-ingest-failed", { pdf, reason, detail });
		};
		if (!current || !root) {
			fail("kernel_unavailable", "the kernel bridge is gone; the book cannot be read in");
			return;
		}
		if (ingesting.has(pdf)) {
			fail("already_running", `${pdf} is already being read in`);
			return;
		}
		ingesting.add(pdf);
		busy = true;
		ingestHoldsLane = true;
		try {
			const report = await ingest(
				{
					call: current.call,
					home: root,
					signal: lanes.signal,
					stopped: () => stopped,
					record: (row) => recordIngest({ ...row, pdf }),
					progress: (row) => pi.events.emit("coc:module-ingest-progress", { ...row, pdf }),
					build: (moduleId) => runBuild({ module_id: moduleId, ...(campaign ? { campaign } : {}) }),
				},
				request,
			);
			pi.events.emit("coc:module-ingest-done", { pdf, ...report });
		} catch (error) {
			const reason = error instanceof IngestError ? error.reason : "internal";
			const stage = error instanceof IngestError ? error.stage : "classify";
			const detail = errorText(error);
			recordIngest({ stage, ok: false, reason, detail, pdf });
			pi.events.emit("coc:module-ingest-failed", { pdf, reason, detail, stage });
		} finally {
			ingestHoldsLane = false;
			busy = false;
			ingesting.delete(pdf);
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
		if (moduleId && reading && visualModule) { await reading.prefetch(moduleId); return; }
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
		if (!bridge) { reading?.dispose(); reading = undefined; pi.events.emit("coc:reading-bridge", null); }
		else shareReader();
	});

	pi.events.on("coc:table-open", (data) => {
		const payload = asRecord(data);
		campaign = asString(payload.campaign) ?? campaign;
		const open = asRecord(payload.open);
		visualModule = open.module_reading === true;
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

	// `/coc module parse` (and, later, a front end's file picker) starts the ingest job the same way (contract §20.4).
	pi.events.on("coc:module-ingest", (data) => {
		const payload = asRecord(data);
		const pdf = asString(payload.pdf);
		if (!pdf || stopped) return;
		if (!reading) { pi.events.emit("coc:module-ingest-failed", { pdf, detail: "the reading service is unavailable" }); return; }
		void reading.prepare({
			pdf,
			...(asString(payload.module_id) ? { module_id: asString(payload.module_id) as string } : {}),
			...(asString(payload.title) ? { title: asString(payload.title) as string } : {}),
			...(asString(payload.language) ? { language: asString(payload.language) as string } : {}),
		}).then(result => pi.events.emit("coc:module-ingest-done", { pdf, ...result }))
			.catch(error => pi.events.emit("coc:module-ingest-failed", { pdf, detail: errorText(error) }));
	});

	// No new deepening during a turn (contract §14.6: it never blocks a turn). The turn boundary comes from
	// the host's own hooks, not the bus: `before_agent_start` is the moment the player input enters the kernel, and `agent_end` is this run really ending.
	pi.on("before_agent_start", async (_event, currentCtx) => {
		ctx = currentCtx;
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
		shareReader();
	});

	pi.on("session_shutdown", async () => {
		reading?.dispose();
		pi.events.emit("coc:reading-bridge", null);
		// Shutdown does not wait for the build: reader subprocesses in flight are cut off, and unread sections stay in `sections.json` for next time.
		stopped = true;
		lanes.abort();
		bridge = undefined;
		ctx = undefined;
	});
}
