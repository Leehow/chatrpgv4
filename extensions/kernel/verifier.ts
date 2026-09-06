/**
 * 校验车道（契约 §12.5）。交付替换完成之后跑：零工具子会话读已交付的正文与
 * 两份事实清单，报三类发现，结果交给 `table.warn`。
 *
 * 三条边界照契约写死：全部 advisory（不改状态、不拦交付、不重开回合）；
 * 车道不用关键词、不用正则做判断（下面的正则只切机制行，不判内容）；
 * 出错只写遥测，不催守秘人。
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runLane } from "../lanes/subsession.ts";

/** 三类发现的闭合枚举；认不出的那条整条丢掉。 */
const FINDING_KINDS: ReadonlySet<string> = new Set(["reveal", "uncommitted_state", "player_agency"]);

/** 内核最多收 10 条（§12.5），多的在这里就截掉，免得整批被判 invalid_params。 */
const MAX_FINDINGS = 10;

export interface Finding {
	kind: string;
	quote: string;
	why: string;
}

/** `narrate` 成功后总线上那份载荷（契约 §12.8）。 */
export interface CommitPayload {
	campaign: string;
	turn: number;
	commit?: string;
	job_id?: string;
	facts?: { committed?: unknown[]; keeper_only?: unknown[] };
	rendered_text: string;
}

/**
 * 机制行不是正文：【明骰】【变化】是内核按收据插的，【第 n 轮】是会话的轮次标。
 * 守秘人自写这些行时要剥掉再送内核，车道读正文时也要剥掉——同一件事，一份规则。
 */
export function stripMechanicsLines(text: string): string {
	return text
		.split("\n")
		.filter((line) => !/^\s*【(明骰|变化|第 ?\d+ ?轮)】/.test(line))
		.join("\n")
		.trim();
}

function factLines(facts: unknown[] | undefined): string {
	if (!Array.isArray(facts) || facts.length === 0) return "（空）";
	return facts.map((fact) => `- ${typeof fact === "string" ? fact : JSON.stringify(fact)}`).join("\n");
}

export function verifierSystemPrompt(playLanguage?: string): string {
	return [
		"你在给一位《克苏鲁的呼唤》守秘人做事后校验。你读到的正文已经交付给玩家了，改不了；你只报告，不改写。",
		"找三类问题，找不到就报空：",
		"- reveal：正文说出了「守秘人专属」清单里的事，玩家还没在桌上赚到它。",
		"- uncommitted_state：正文声称了「已提交事实」清单里没有的状态变化——走到别处、拿到线索、数值增减、时间流逝。",
		"- player_agency：正文替玩家做了他没有声明的自愿行为（自愿的选择、开口说的话、主动的动作）。",
		"只回一个 JSON 对象，不要代码块、不要解释：",
		'{"findings":[{"kind":"reveal"|"uncommitted_state"|"player_agency","quote":"<正文里一字不差的原句，≤120 字>","why":"<≤200 字>"}]}',
		"没有问题就回 {\"findings\":[]}。",
		"quote 必须逐字取自正文：改一个字、拼接两句、加一个标点，这条都会被丢弃。",
		playLanguage ? `why 用 ${playLanguage} 写。` : "",
	]
		.filter(Boolean)
		.join("\n");
}

export function buildVerifierInput(payload: CommitPayload): string {
	return [
		"【已交付的正文】",
		stripMechanicsLines(payload.rendered_text),
		"",
		"【已提交事实：这一回合真的发生了的，全部在这里】",
		factLines(payload.facts?.committed),
		"",
		"【守秘人专属事实：玩家还没赚到的，正文里出现就是越权揭示】",
		factLines(payload.facts?.keeper_only),
	].join("\n");
}

/** 形状校验：闭合枚举与三个字符串字段，其余一律丢。内容判断全在模型那边。 */
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
		findings.push({ kind: row.kind, quote: row.quote, why: row.why });
		if (findings.length >= MAX_FINDINGS) break;
	}
	return findings;
}

export interface VerifierLaneOptions {
	ctx: ExtensionContext;
	payload: CommitPayload;
	playLanguage?: string;
	/** 内核 RPC；`table.warn` 不带 call_id、不看回合状态（契约 §12.8）。 */
	call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
	record: (row: Record<string, unknown>) => Promise<void> | void;
	signal?: AbortSignal;
}

/**
 * 跑一次校验车道。永不抛：任何失败都落一行 `lane: "verifier", ok: false` 的遥测就结束。
 * 调用方 fire-and-forget，交付不等它。
 */
export async function runVerifierLane(options: VerifierLaneOptions): Promise<void> {
	const { ctx, payload, call, record } = options;
	const began = Date.now();
	const lane = await runLane<Finding[]>({
		ctx,
		envName: "PI_COC_VERIFIER_MODEL",
		systemPrompt: verifierSystemPrompt(options.playLanguage),
		input: buildVerifierInput(payload),
		...(options.signal ? { signal: options.signal } : {}),
		shape: shapeFindings,
	});
	if (!lane.ok) {
		await record({
			lane: "verifier",
			turn: payload.turn,
			ok: false,
			ms: lane.ms,
			reason: lane.reason,
			detail: lane.detail.slice(0, 200),
			...(lane.model ? { model: lane.model } : {}),
		});
		return;
	}
	try {
		const result = (await call("table.warn", {
			campaign: payload.campaign,
			turn: payload.turn,
			lane: "verifier",
			findings: lane.value,
		})) as { recorded?: number; dropped?: number } | undefined;
		await record({
			lane: "verifier",
			turn: payload.turn,
			ok: true,
			ms: Date.now() - began,
			model: lane.model,
			findings: lane.value.length,
			...(typeof result?.recorded === "number" ? { recorded: result.recorded } : {}),
			...(typeof result?.dropped === "number" ? { dropped: result.dropped } : {}),
		});
	} catch (error) {
		await record({
			lane: "verifier",
			turn: payload.turn,
			ok: false,
			ms: Date.now() - began,
			model: lane.model,
			reason: "warn_failed",
			detail: (error instanceof Error ? error.message : String(error)).slice(0, 200),
		});
	}
}
