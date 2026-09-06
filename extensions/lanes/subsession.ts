/**
 * 车道用的零工具子会话（契约 §12.3、§12.5）。
 *
 * 两条车道要的都是同一件事：把一段文字交给一个模型，收回一段短 JSON，
 * 不给工具、不进会话记录、不阻塞守秘人的交付。Pi 里够得着这件事的面是
 * `ctx.modelRegistry.complete(model, context)`：它是扩展侧的补全门面，
 * 复用当前会话的模型注册表与鉴权，`context.tools` 不给就是零工具。
 * 为什么不是 `createAgentSession`、这条路的边界在哪，见
 * docs/pi-host-contract.md 第 3 节与第 5 节。
 */

import { parseJsonWithRepair } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** 车道失败的闭合原因；记忆车道把它映射成 `memory.fail` 的 reason。 */
export type LaneFailureReason = "model_unavailable" | "model_error" | "bad_output";

export type LaneResult<T> =
	| { ok: true; value: T; ms: number; model: string; raw: string }
	| { ok: false; reason: LaneFailureReason; detail: string; ms: number; model?: string };

/** `provider/model`。模型 id 自己可能带斜杠，所以只在第一个斜杠上切。 */
export function parseModelRef(raw: string): { provider: string; id: string } | undefined {
	const trimmed = raw.trim();
	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash >= trimmed.length - 1) return undefined;
	return { provider: trimmed.slice(0, slash), id: trimmed.slice(slash + 1) };
}

/** 车道模型：环境变量点名的那个，没点名就跟桌子同模型（契约 §12.5、§12.8）。 */
export function resolveLaneModel(
	ctx: ExtensionContext,
	envName: string,
): { ok: true; model: NonNullable<ExtensionContext["model"]> } | { ok: false; detail: string } {
	const raw = process.env[envName]?.trim();
	if (!raw) {
		const current = ctx.model;
		if (!current) return { ok: false, detail: `${envName} 没设，当前会话也没有模型` };
		return { ok: true, model: current };
	}
	const ref = parseModelRef(raw);
	if (!ref) return { ok: false, detail: `${envName}=${raw} 不是 provider/model` };
	const found = ctx.modelRegistry.find(ref.provider, ref.id);
	if (!found) return { ok: false, detail: `${envName}=${raw} 在模型注册表里找不到` };
	return { ok: true, model: found };
}

export function modelLabel(model: { provider: string; id: string }): string {
	return `${model.provider}/${model.id}`;
}

/** 模型爱把 JSON 裹进代码块或前后垫话：只认第一个 `{` 到最后一个 `}`。 */
function extractJsonObject(text: string): string | undefined {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	return text.slice(start, end + 1);
}

export interface LaneRequest<T> {
	ctx: ExtensionContext;
	/** 模型来源的环境变量名：`PI_COC_VERIFIER_MODEL` 或 `PI_COC_MEMORY_MODEL`。 */
	envName: string;
	systemPrompt: string;
	input: string;
	signal?: AbortSignal;
	/**
	 * 形状校验：把解析出来的对象收窄成车道要的闭合形状，认不出回 undefined。
	 * 这里只查字段与闭合枚举，语义一律由模型判断（契约 §12.5：车道不用关键词、不用正则）。
	 */
	shape: (parsed: unknown) => T | undefined;
}

/** 跑一次车道：解析模型 → 一次补全 → 取 JSON → 形状校验。任何一步失败都只返回失败，不抛。 */
export async function runLane<T>(request: LaneRequest<T>): Promise<LaneResult<T>> {
	const began = Date.now();
	let label: string | undefined;
	try {
		const resolved = resolveLaneModel(request.ctx, request.envName);
		if (!resolved.ok) {
			return { ok: false, reason: "model_unavailable", detail: resolved.detail, ms: Date.now() - began };
		}
		label = modelLabel(resolved.model);
		const reply = await request.ctx.modelRegistry.complete(
			resolved.model,
			{
				systemPrompt: request.systemPrompt,
				messages: [{ role: "user", content: [{ type: "text", text: request.input }] }],
				// tools 不给：这就是零工具会话。
			},
			request.signal ? { signal: request.signal } : {},
		);
		if (reply.stopReason === "error" || reply.stopReason === "aborted") {
			return {
				ok: false,
				reason: "model_error",
				detail: reply.errorMessage ?? reply.stopReason,
				ms: Date.now() - began,
				model: label,
			};
		}
		const raw = (reply.content ?? [])
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.join("")
			.trim();
		const json = extractJsonObject(raw);
		if (!json) {
			return { ok: false, reason: "bad_output", detail: "回复里没有 JSON 对象", ms: Date.now() - began, model: label };
		}
		let parsed: unknown;
		try {
			parsed = parseJsonWithRepair(json);
		} catch (error) {
			return {
				ok: false,
				reason: "bad_output",
				detail: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
				ms: Date.now() - began,
				model: label,
			};
		}
		const value = request.shape(parsed);
		if (value === undefined) {
			return { ok: false, reason: "bad_output", detail: "JSON 形状不是车道要的那个", ms: Date.now() - began, model: label };
		}
		return { ok: true, value, ms: Date.now() - began, model: label, raw };
	} catch (error) {
		return {
			ok: false,
			reason: "model_error",
			detail: error instanceof Error ? error.message : String(error),
			ms: Date.now() - began,
			...(label ? { model: label } : {}),
		};
	}
}
