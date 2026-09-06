/**
 * The zero-tool subsession the lanes use (contract §12.3, §12.5).
 *
 * Both lanes want the same thing: hand a model one block of text, get one short JSON back,
 * with no tools, nothing written to the session record, and nothing blocking the Keeper's
 * delivery. The surface in Pi that reaches this is `ctx.modelRegistry.complete(model, context)`:
 * the extension-side completion facade, reusing the current session's model registry and auth,
 * and zero-tool as long as `context.tools` is not given. Why not `createAgentSession`, and where
 * the limits of this road are, is in docs/pi-host-contract.md §3 and §5.
 */

import { parseJsonWithRepair } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** The closed set of lane failure reasons; the memory lane maps it onto `memory.fail`'s reason. */
export type LaneFailureReason = "model_unavailable" | "model_error" | "bad_output";

export type LaneResult<T> =
	| { ok: true; value: T; ms: number; model: string; raw: string }
	| { ok: false; reason: LaneFailureReason; detail: string; ms: number; model?: string };

/** `provider/model`. A model id may contain slashes itself, so split on the first one only. */
export function parseModelRef(raw: string): { provider: string; id: string } | undefined {
	const trimmed = raw.trim();
	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash >= trimmed.length - 1) return undefined;
	return { provider: trimmed.slice(0, slash), id: trimmed.slice(slash + 1) };
}

/** The lane model: the one the environment variable names, else the table's own model (contract §12.5, §12.8). */
export function resolveLaneModel(
	ctx: ExtensionContext,
	envName: string,
): { ok: true; model: NonNullable<ExtensionContext["model"]> } | { ok: false; detail: string } {
	const raw = process.env[envName]?.trim();
	if (!raw) {
		const current = ctx.model;
		if (!current) return { ok: false, detail: `${envName} is unset and the current session has no model` };
		return { ok: true, model: current };
	}
	const ref = parseModelRef(raw);
	if (!ref) return { ok: false, detail: `${envName}=${raw} is not provider/model` };
	const found = ctx.modelRegistry.find(ref.provider, ref.id);
	if (!found) return { ok: false, detail: `${envName}=${raw} is not in the model registry` };
	return { ok: true, model: found };
}

export function modelLabel(model: { provider: string; id: string }): string {
	return `${model.provider}/${model.id}`;
}

/** Models like to wrap JSON in a code fence or pad it with prose: take the first `{` through the last `}`. */
function extractJsonObject(text: string): string | undefined {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	return text.slice(start, end + 1);
}

export interface LaneRequest<T> {
	ctx: ExtensionContext;
	/** Name of the environment variable the model comes from: `PI_COC_VERIFIER_MODEL` or `PI_COC_MEMORY_MODEL`. */
	envName: string;
	systemPrompt: string;
	input: string;
	signal?: AbortSignal;
	/**
	 * Shape check: narrow the parsed object down to the closed shape the lane wants, or undefined.
	 * Only fields and closed enums are checked here; every semantic judgement belongs to the model
	 * (contract §12.5: the lanes use neither keywords nor regexes).
	 */
	shape: (parsed: unknown) => T | undefined;
}

/** Run one lane: resolve the model, one completion, take the JSON, check the shape. Any step failing returns a failure, never throws. */
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
				// tools omitted: that is what makes this a zero-tool session.
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
			return { ok: false, reason: "bad_output", detail: "the reply held no JSON object", ms: Date.now() - began, model: label };
		}
		let parsed: unknown;
		try {
			parsed = parseJsonWithRepair(json);
		} catch (error) {
			return {
				ok: false,
				reason: "bad_output",
				detail: `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
				ms: Date.now() - began,
				model: label,
			};
		}
		const value = request.shape(parsed);
		if (value === undefined) {
			return { ok: false, reason: "bad_output", detail: "the JSON is not the shape this lane asked for", ms: Date.now() - began, model: label };
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
