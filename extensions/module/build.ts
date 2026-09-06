/**
 * `module.build`：无人值守构建的驱动循环（契约 §14.5）。
 *
 * 这不是内核方法，是扩展侧的循环：
 * plan → 一次读者给全书 section 定 kind 与 priority → `module.plan.accept` →
 * 按 priority 逐 section：`module.packet` → 读者子进程 → `module.review` →
 * （不过就带着 findings 原样重起一轮，至多三轮）→ `module.accept` → `module.assemble` →
 * `opening_ready` 一到发 `coc:module-opening-ready` → 其余 section 继续 → `module.install`。
 *
 * 一段 section 的那一截（packet → 读者 → review → accept → assemble）被按需深读车道
 * （契约 §14.6）原样复用，所以它单独是一个函数。
 */

import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { runReader } from "./reader.ts";

export type KernelCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** 契约 §14.5：每 section 至多三轮，超过记 failed。 */
export const MAX_ROUNDS = 3;

export interface Finding {
	gate?: string;
	code?: string;
	path?: string;
	message?: string;
}

export interface BuildContext {
	call: KernelCall;
	/** 工作区（`ctx.cwd`）：`.coc/modules/<id>/` 在它下面。 */
	workspace: string;
	/** 读者的模型，`provider/model`；不给就用 pi 的缺省。 */
	model?: string;
	signal: AbortSignal;
	/** 一行构建遥测（契约 §14.1 的 `build.jsonl`）。 */
	record: (moduleId: string, row: Record<string, unknown>) => void;
	/** 关机了就别开新的一轮。 */
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

/** 内核错误信封的 code 用鸭子类型读：跨模块 instanceof 靠不住。 */
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
 * 读者的工作目录。内核给什么就用什么（`work_dir`，或 `packet` 那个文件所在的目录），
 * 都没有时按契约 §14.1 的布局自己拼。相对路径按工作区解。
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
 * 三道门的一次 review。
 *
 * 契约 §14.3 只给了 `{module_id, section_id}`；轮次得让内核知道，否则它写不出
 * `sections.json` 的 `rounds` 与最后一轮的 `failed`（契约 §14.1、§14.5）。
 * 所以这里多送 `round`（与最后一轮的 `final`），并留一条退路：内核要是认不出这两个键，
 * 用裸参数再调一次；裸的真过了才认定这个内核不收轮次，之后不再多送。
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
			// 可能是内核不收 `round`，也可能是这一片本来就不合格：裸参数过了才是前者。
			const fallback = read(await call("module.review", bare));
			reviewTakesRound = false;
			return fallback;
		}
	}
	return read(await call("module.review", bare));
}

/**
 * 一段 section：抽取包 → 读者 → 三道门 → 接受 → 增量合并（契约 §14.5）。
 * 构建循环与按需深读车道共用这一截。
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
	const baseBrief = asString(packet.brief) ?? `读 ${sectionId} 的抽取包 packet.json，把分片写进 shard.json。`;

	let findings: Finding[] = [];
	let round = 0;
	let detail: string | undefined;
	while (round < MAX_ROUNDS && !ctx.stopped() && !ctx.signal.aborted) {
		round += 1;
		const final = round === MAX_ROUNDS;
		// 重来的一轮把上一轮的 findings 原样带上（契约 §14.5）：不总结、不翻译。
		const brief =
			findings.length === 0
				? baseBrief
				: `${baseBrief}\n\n上一轮 review 没过，findings 原样如下，照着改再跑一遍闸门：\n${JSON.stringify(findings, null, 2)}`;
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
			// 闸门本身没跑成也是这一轮没过：留一条能追的 finding，循环照走。
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
			detail = run.ok ? "review 没过" : `读者这一轮没跑成：${run.error ?? `退出码 ${run.code}`}`;
			continue;
		}
		try {
			await ctx.call("module.accept", { module_id: moduleId, section_id: sectionId });
		} catch (error) {
			detail = `module.accept ${errorCode(error) ?? "internal"}: ${errorText(error)}`;
			ctx.record(moduleId, { section_id: sectionId, round, reason, accepted: false, ok: false, detail });
			return { section_id: sectionId, accepted: false, rounds: round, findings, detail };
		}
		// 每接受一片就增量合并（契约 §14.5）：图长一点，开桌就绪就可能到。
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

/** `module.status` 里的 section 名册；内核没给就回空表，调用方据此报错。 */
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

/** 先高 priority，同 priority 按名册顺序（契约 §14.3：front／keeper-truth／开场场景先）。 */
function byPriority(sections: SectionRow[]): SectionRow[] {
	return sections
		.map((section, index) => ({ section, index }))
		.sort((a, b) => (b.section.priority ?? 0) - (a.section.priority ?? 0) || a.index - b.index)
		.map((entry) => entry.section);
}

/**
 * 计划：机器切法归内核，分类归一次读者（契约 §14.3）。
 * `module.plan` 给分类用的抽取包与 brief 时才起读者，再 `module.plan.accept`；
 * 内核自己就把 `sections.json` 写好了（没有 brief）时这一步只是过一下。
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
 * 无人值守构建（契约 §14.5）。`onOpeningReady` 在 `module.status.opening_ready`
 * 第一次为真时被叫一次——建卡的 `build-opening` 那一步等的就是它。
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
	// 还没切 section 的书先切；已经切过的（重开进程接着构建）不再切。
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
			// 开场就绪一到就发信号：建卡不必等整本读完（契约 §14.3）。
			try {
				const status = asRecord(await ctx.call("module.status", { module_id: moduleId }));
				if (status.opening_ready === true) {
					report.opening_ready = true;
					options.onOpeningReady?.(status);
				}
			} catch {
				/* 状态查不到不该弄停构建 */
			}
		}
	};
	await Promise.all(Array.from({ length: parallel }, () => worker()));

	if (ctx.stopped() || ctx.signal.aborted) {
		report.detail = "构建被关机打断，剩下的 section 留给下次";
		return report;
	}

	// 全部结束才安装（契约 §14.5）。图不达可玩性标准时安装要 force（契约 §14.3），
	// 报告已经写在 `module.json` 里，胶囊的 `where` 会告诉守秘人材料不全。
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
