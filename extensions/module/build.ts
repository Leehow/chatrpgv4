/**
 * `module.build`: the driver loop of the unattended build (contract §14.5).
 *
 * This is not a kernel method but an extension-side loop:
 * plan, then one reader giving every section of the book its kind and priority, then `module.plan.accept`,
 * then section by section in priority order: `module.packet`, the reader subprocess, `module.review`,
 * (a round that does not pass restarts with the findings verbatim, at most three rounds), `module.accept`,
 * `module.assemble`, `coc:module-opening-ready` the moment `opening_ready` arrives, the remaining sections, and finally `module.install`.
 *
 * The stretch for one section (packet, reader, review, accept, assemble) is reused verbatim by the
 * on-demand deepening lane (contract §14.6), which is why it is a function of its own.
 */

import { mkdir, rename } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { runReader } from "./reader.ts";

export type KernelCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** Contract §14.5: at most three rounds per section, and beyond that it is recorded failed. */
export const MAX_ROUNDS = 3;
/** The shard the reader writes, and where a previous pass's shard is kept when it is read again. */
export const SHARD_FILE = "shard.json";
export const PREVIOUS_SHARD_FILE = "shard.previous.json";

export interface Finding {
	gate?: string;
	code?: string;
	path?: string;
	message?: string;
}

export interface BuildContext {
	call: KernelCall;
	/** The workspace (`ctx.cwd`): `.coc/modules/<id>/` sits under it. */
	workspace: string;
	/** The reader's model, `provider/model`; without one, pi's default is used. */
	model?: string;
	signal: AbortSignal;
	/** One line of build telemetry (the `build.jsonl` of contract §14.1). */
	record: (moduleId: string, row: Record<string, unknown>) => void;
	/** Once shut down, start no new round. */
	stopped: () => boolean;
	readerTimeoutMs?: number;
}

export interface SectionOutcome {
	section_id: string;
	accepted: boolean;
	rounds: number;
	findings: Finding[];
	detail?: string;
}

export interface SectionRow {
	id: string;
	title?: string;
	kind?: string;
	priority?: number;
	status?: string;
}

export interface BuildReport {
	module_id: string;
	planned: number;
	accepted: string[];
	failed: string[];
	opening_ready: boolean;
	installed: boolean;
	detail?: string;
}

/** The code of a kernel error envelope is read structurally: instanceof is unreliable across modules. */
function errorCode(error: unknown): string | undefined {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : undefined;
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

/**
 * The reader's working directory. Whatever the kernel gives is used (`work_dir`, or the directory of the
 * `packet` file); with neither, it is composed from the layout of contract §14.1. Relative paths resolve against the workspace.
 */
export function workDirFor(
	workspace: string,
	moduleId: string,
	sectionId: string,
	packet: Record<string, unknown>,
): string {
	const declared = asString(packet.work_dir) ?? (asString(packet.packet) ? dirname(String(packet.packet)) : undefined);
	if (declared) return isAbsolute(declared) ? declared : resolvePath(workspace, declared);
	return join(workspace, ".coc", "modules", moduleId, "work", sectionId);
}

function findingCodes(findings: Finding[]): string[] {
	return findings.map((finding) => finding.code ?? finding.gate ?? "unknown").slice(0, 20);
}

/**
 * One review through the three gates.
 *
 * Contract §14.3 gives only `{module_id, section_id}`, but the kernel must know the round or it cannot
 * write `sections.json`'s `rounds` or the last round's `failed` (contract §14.1, §14.5).
 * So `round` is sent too (with `final` on the last round), with a way back: if the kernel does not know
 * those two keys, call again with the bare parameters; only if the bare call really passes is this kernel taken not to accept rounds, and none are sent afterwards.
 */
let reviewTakesRound = true;

export function resetReviewProbe(): void {
	reviewTakesRound = true;
}

async function reviewSection(
	call: KernelCall,
	moduleId: string,
	sectionId: string,
	round: number,
	final: boolean,
): Promise<{ accepted: boolean; findings: Finding[] }> {
	const bare = { module_id: moduleId, section_id: sectionId };
	const read = (result: unknown) => {
		const row = asRecord(result);
		const findings = Array.isArray(row.findings) ? (row.findings as Finding[]) : [];
		return { accepted: row.accepted === true, findings };
	};
	if (reviewTakesRound) {
		try {
			return read(await call("module.review", { ...bare, round, ...(final ? { final: true } : {}) }));
		} catch (error) {
			if (errorCode(error) !== "invalid_params") throw error;
			// It may be a kernel that does not take `round`, or a shard that is simply not good enough: only a bare call that passes means the former.
			const fallback = read(await call("module.review", bare));
			reviewTakesRound = false;
			return fallback;
		}
	}
	return read(await call("module.review", bare));
}

/**
 * One section: the extraction packet, the reader, the three gates, acceptance, incremental assembly (contract §14.5).
 * The build loop and the on-demand deepening lane share this stretch.
 */
export async function readSection(
	ctx: BuildContext,
	moduleId: string,
	sectionId: string,
	reason: string,
): Promise<SectionOutcome> {
	let packet: Record<string, unknown>;
	try {
		packet = asRecord(await ctx.call("module.packet", { module_id: moduleId, section_id: sectionId }));
	} catch (error) {
		const detail = `module.packet ${errorCode(error) ?? "internal"}: ${errorText(error)}`;
		ctx.record(moduleId, { section_id: sectionId, round: 0, reason, accepted: false, ok: false, detail });
		return { section_id: sectionId, accepted: false, rounds: 0, findings: [], detail };
	}

	const workDir = workDirFor(ctx.workspace, moduleId, sectionId, packet);
	await mkdir(workDir, { recursive: true }).catch(() => undefined);
	// A re-read must not inherit its own previous answer. The work directory is reused, so a
	// section read once already has `shard.json` sitting in it, and the cheapest way to satisfy
	// "read this again" is to leave that file alone -- which is exactly what a deepening pass
	// must not do (observed: a second pass over the-haunting returned in 97s having written
	// nothing, its DONE.json naming the strategy "verify-existing-shard-still-passes"). The
	// previous shard is moved aside rather than deleted: it is evidence, and the roster the new
	// pass must keep is in the packet's `skeleton.known_nodes`. Rounds 2 and 3 of one pass are
	// inside the loop below and still build on the shard that round 1 wrote.
	await rename(join(workDir, SHARD_FILE), join(workDir, PREVIOUS_SHARD_FILE)).catch(() => undefined);
	const baseBrief = asString(packet.brief) ?? `Read the extraction packet packet.json of ${sectionId} and write the shard into shard.json.`;

	let findings: Finding[] = [];
	let round = 0;
	let detail: string | undefined;
	while (round < MAX_ROUNDS && !ctx.stopped() && !ctx.signal.aborted) {
		round += 1;
		const final = round === MAX_ROUNDS;
		// A repeated round carries the previous round's findings verbatim (contract §14.5): not summarised, not translated.
		const brief =
			findings.length === 0
				? baseBrief
				: `${baseBrief}\n\nThe last review did not pass. Its findings, verbatim, are below: fix them and run the gates again.\n${JSON.stringify(findings, null, 2)}`;
		const run = await runReader({
			cwd: workDir,
			brief,
			...(ctx.model ? { model: ctx.model } : {}),
			signal: ctx.signal,
			...(ctx.readerTimeoutMs ? { timeoutMs: ctx.readerTimeoutMs } : {}),
		});

		let accepted = false;
		try {
			const review = await reviewSection(ctx.call, moduleId, sectionId, round, final);
			accepted = review.accepted;
			findings = review.findings;
		} catch (error) {
			// A gate that failed to run at all is also a round that did not pass: leave one traceable finding and let the loop go on.
			findings = [
				{ gate: "call", code: errorCode(error) ?? "internal", path: "module.review", message: errorText(error) },
			];
		}

		ctx.record(moduleId, {
			section_id: sectionId,
			round,
			reason,
			...(ctx.model ? { model: ctx.model } : {}),
			ms: run.ms,
			reader_ok: run.ok,
			...(run.timedOut ? { reader_timed_out: true } : {}),
			...(run.error ? { reader_error: run.error } : {}),
			findings_codes: findingCodes(findings),
			accepted,
		});

		if (!accepted) {
			detail = run.ok ? "the review did not pass" : `the reader did not run this round: ${run.error ?? `exit code ${run.code}`}`;
			continue;
		}
		try {
			await ctx.call("module.accept", { module_id: moduleId, section_id: sectionId });
		} catch (error) {
			detail = `module.accept ${errorCode(error) ?? "internal"}: ${errorText(error)}`;
			ctx.record(moduleId, { section_id: sectionId, round, reason, accepted: false, ok: false, detail });
			return { section_id: sectionId, accepted: false, rounds: round, findings, detail };
		}
		// Assemble incrementally after every acceptance (contract §14.5): the graph grows, and opening readiness may arrive.
		try {
			await ctx.call("module.assemble", { module_id: moduleId });
		} catch (error) {
			ctx.record(moduleId, {
				section_id: sectionId,
				round,
				reason,
				accepted: true,
				assembled: false,
				detail: `module.assemble ${errorCode(error) ?? "internal"}: ${errorText(error)}`,
			});
		}
		return { section_id: sectionId, accepted: true, rounds: round, findings: [] };
	}
	return {
		section_id: sectionId,
		accepted: false,
		rounds: round,
		findings,
		...(detail ? { detail } : {}),
	};
}

/** The section roster in `module.status`; an empty list when the kernel gives none, which the caller reports on. */
async function sectionsOf(ctx: BuildContext, moduleId: string): Promise<{ status: Record<string, unknown>; sections: SectionRow[] }> {
	const status = asRecord(await ctx.call("module.status", { module_id: moduleId }));
	const roster = status.sections;
	const rows = Array.isArray(roster) ? roster : Array.isArray(asRecord(roster).rows) ? (asRecord(roster).rows as unknown[]) : [];
	const sections: SectionRow[] = [];
	for (const row of rows) {
		const record = asRecord(row);
		const id = asString(record.id) ?? asString(record.section_id);
		if (!id) continue;
		sections.push({
			id,
			...(asString(record.title) ? { title: asString(record.title) } : {}),
			...(asString(record.kind) ? { kind: asString(record.kind) } : {}),
			...(typeof record.priority === "number" ? { priority: record.priority } : {}),
			...(asString(record.status) ? { status: asString(record.status) } : {}),
		});
	}
	return { status, sections };
}

/** Higher priority first, ties in roster order (contract §14.3: front, keeper truth and the opening scene come first). */
function byPriority(sections: SectionRow[]): SectionRow[] {
	return sections
		.map((section, index) => ({ section, index }))
		.sort((a, b) => (b.section.priority ?? 0) - (a.section.priority ?? 0) || a.index - b.index)
		.map((entry) => entry.section);
}

/**
 * Planning: the mechanical cutting is the kernel's, the classification is one reader's (contract §14.3).
 * The reader is only started when `module.plan` gives a packet and a brief for classification, followed by
 * `module.plan.accept`; when the kernel has already written `sections.json` itself (no brief), this step is a formality.
 */
async function planModule(ctx: BuildContext, moduleId: string): Promise<number> {
	const plan = asRecord(await ctx.call("module.plan", { module_id: moduleId }));
	const brief = asString(plan.brief);
	if (!brief) return typeof plan.sections === "number" ? plan.sections : 0;
	const workDir = workDirFor(ctx.workspace, moduleId, "plan", plan);
	await mkdir(workDir, { recursive: true }).catch(() => undefined);
	const began = Date.now();
	const run = await runReader({
		cwd: workDir,
		brief,
		...(ctx.model ? { model: ctx.model } : {}),
		signal: ctx.signal,
		...(ctx.readerTimeoutMs ? { timeoutMs: ctx.readerTimeoutMs } : {}),
	});
	const accepted = asRecord(await ctx.call("module.plan.accept", { module_id: moduleId }));
	const count = typeof accepted.sections === "number" ? accepted.sections : 0;
	ctx.record(moduleId, {
		section_id: "plan",
		round: 1,
		reason: "plan",
		...(ctx.model ? { model: ctx.model } : {}),
		ms: Date.now() - began,
		reader_ok: run.ok,
		findings_codes: [],
		accepted: count > 0,
		sections: count,
	});
	return count;
}

/**
 * The unattended build (contract §14.5). `onOpeningReady` is called once, the first time
 * `module.status.opening_ready` is true — that is what setup's `build-opening` step waits for.
 */
export async function buildModule(
	ctx: BuildContext,
	moduleId: string,
	options: { parallel?: number; onOpeningReady?: (status: Record<string, unknown>) => void } = {},
): Promise<BuildReport> {
	const report: BuildReport = {
		module_id: moduleId,
		planned: 0,
		accepted: [],
		failed: [],
		opening_ready: false,
		installed: false,
	};

	let listed = await sectionsOf(ctx, moduleId);
	// A book with no sections yet is cut first; one already cut (a restarted process continuing a build) is not cut again.
	if (listed.sections.length === 0) {
		await planModule(ctx, moduleId);
		listed = await sectionsOf(ctx, moduleId);
	}
	report.planned = listed.sections.length;
	if (listed.status.opening_ready === true) {
		report.opening_ready = true;
		options.onOpeningReady?.(listed.status);
	}

	const pending = byPriority(listed.sections).filter(
		(section) => section.status !== "accepted" && section.status !== "skipped",
	);
	const queue = [...pending];
	const parallel = Math.max(1, options.parallel ?? 1);

	const worker = async (): Promise<void> => {
		while (!ctx.stopped() && !ctx.signal.aborted) {
			const section = queue.shift();
			if (!section) return;
			const outcome = await readSection(ctx, moduleId, section.id, "build");
			if (outcome.accepted) report.accepted.push(section.id);
			else report.failed.push(section.id);
			if (report.opening_ready) continue;
			// Signal the moment the opening is ready: setup need not wait for the whole book (contract §14.3).
			try {
				const status = asRecord(await ctx.call("module.status", { module_id: moduleId }));
				if (status.opening_ready === true) {
					report.opening_ready = true;
					options.onOpeningReady?.(status);
				}
			} catch {
				/* an unreadable status must not stop the build */
			}
		}
	};
	await Promise.all(Array.from({ length: parallel }, () => worker()));

	if (ctx.stopped() || ctx.signal.aborted) {
		report.detail = "the build was cut short by shutdown; the remaining sections are left for next time";
		return report;
	}

	// Install only when everything has finished (contract §14.5). A graph below the playability standard needs
	// force to install (contract §14.3); the report is already in `module.json`, and the capsule's `where` tells the Keeper the material is incomplete.
	try {
		await ctx.call("module.install", { module_id: moduleId });
		report.installed = true;
	} catch (error) {
		try {
			await ctx.call("module.install", { module_id: moduleId, force: true });
			report.installed = true;
			ctx.record(moduleId, { section_id: null, round: 0, reason: "install", accepted: true, forced: true });
		} catch (forced) {
			report.detail = `module.install ${errorCode(forced) ?? "internal"}: ${errorText(forced)}`;
			ctx.record(moduleId, {
				section_id: null,
				round: 0,
				reason: "install",
				accepted: false,
				detail: report.detail,
			});
		}
	}
	return report;
}
