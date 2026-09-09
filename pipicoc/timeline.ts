/**
 * The memory-line panel's pack side (contract §29): the right sidebar draws the campaign's whole
 * worldline graph and offers "branch from here" on any committed node.
 *
 * Like the sheet (§23), this is a projection, not a second source of truth: every answer is one
 * kernel call verbatim plus the chrome's words. `table.graph` is read-only and `table.branch` is
 * the host-level fork; neither is a Keeper verb, so the panel never touches the turn state machine
 * a `look` would move.
 *
 * Two channels, both host-mediated (`host-bridge.ts`):
 * - the panel asks (`invoke("timeline.graph")` / `invoke("timeline.branch")`) when it mounts, when
 *   it is told something changed, and when the player confirms a branch;
 * - the panel is told (`ext.emit "timeline-changed"`) when a turn commits or a branch lands,
 *   because a graph the player just watched change has to redraw without them poking it.
 *
 * A successful branch also writes the watershed into the transcript: one `coc-mechanics` entry
 * carrying the worldline projection, so the fork reads as a divider in the session's own history
 * (the kernel's one-time `branched` capsule section is for the Keeper; this entry is for the
 * player). The cold path (no live session) writes the same row from the host side.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { emitToPanel, registerInvokeHandlers } from "./host-bridge.ts";
import { loadUiWords, type UiWords } from "../runtime/ui-words.ts";
import { PACK_ID } from "./sheet.ts";

type KernelCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;

interface KernelBridgeEvent {
	campaign?: string;
	call?: KernelCall;
	/** The composed runtime, for the content root its words are read from. */
	runtime?: { contentRoot?: string };
}

export interface TimelineAnswer {
	status?: "ready" | "error" | "unbound";
	/** Which campaign the answer came from, so a panel left open across tables can tell. */
	campaign: string | null;
	/** Why there is no answer, when there is none. English: this string is for the log, not the player. */
	reason?: string;
	/** The word the panel shows for that refusal is looked up by this (contract §23). */
	code?: string;
	/** The product's own captions for this session's play language, so no renderer keeps a table. */
	ui?: UiWords;
	/** The kernel's own fields ride at the top level, unwrapped. */
	[key: string]: unknown;
}

/** A lock refusal arrives as `internal` with `details.reason === "campaign_locked"` (kernel-ts
 * `guardCampaign`); the panel's word for it is the same as an open turn's: try again later. */
function answerCode(error: unknown): string {
	const code = (error as { code?: unknown })?.code;
	const reason = (error as { details?: { reason?: unknown } })?.details?.reason;
	if (code === "internal" && reason === "campaign_locked") return "operation_in_progress";
	return typeof code === "string" && code ? code : "kernel_error";
}

export function registerTimelinePanel(pi: ExtensionAPI): void {
	let bridge: KernelCall | undefined;
	let campaign: string | undefined;
	let contentRoot: string | undefined;
	let language: string | undefined;

	/** The chrome's words for this table's language, one read per content root and tag (§23). */
	const words = new Map<string, Promise<UiWords | undefined>>();
	function chrome(): Promise<UiWords | undefined> {
		if (!contentRoot) return Promise.resolve(undefined);
		const key = JSON.stringify([contentRoot, language ?? null]);
		let pending = words.get(key);
		if (!pending) {
			pending = loadUiWords(contentRoot, language).catch(() => {
				words.delete(key);
				return undefined;
			});
			words.set(key, pending);
		}
		return pending;
	}
	async function answer(row: TimelineAnswer): Promise<TimelineAnswer> {
		const ui = await chrome();
		return ui ? { ...row, ui } : row;
	}
	async function failure(error: unknown): Promise<TimelineAnswer> {
		return answer({
			status: "error",
			campaign: campaign ?? null,
			code: answerCode(error),
			reason: error instanceof Error ? error.message : String(error),
		});
	}

	pi.events.on("coc:kernel-bridge", (data) => {
		const event = (data ?? {}) as KernelBridgeEvent;
		bridge = event.call;
		if (event.campaign) campaign = event.campaign;
		if (event.runtime?.contentRoot) contentRoot = event.runtime.contentRoot;
	});
	pi.events.on("coc:table-open", (data) => {
		const opened = (data ?? {}) as { campaign?: string; open?: { campaign?: { play_language?: string } } };
		if (opened.campaign) campaign = opened.campaign;
		if (opened.open?.campaign?.play_language) language = opened.open.campaign.play_language;
	});
	pi.events.on("coc:session-bound", (data) => {
		const linked = data as { campaign?: string; play_language?: string };
		if (linked?.campaign) campaign = linked.campaign;
		if (linked?.play_language) language = linked.play_language;
	});

	/** The watershed a successful branch leaves in the transcript (contract §16.2 mechanics row). */
	function noteWatershed(result: Record<string, unknown>): void {
		const from = (result.branched_from ?? {}) as { line?: unknown; turn?: unknown };
		const line = (result.line ?? {}) as { name?: unknown };
		const mechanics = [{
			kind: "worldline",
			operation: "fork",
			line: typeof line.name === "string" ? line.name : undefined,
			from_line: typeof from.line === "string" ? from.line : undefined,
			from_turn: typeof from.turn === "number" ? from.turn : undefined,
		}];
		const turn = typeof from.turn === "number" ? from.turn : 0;
		try {
			pi.appendEntry("coc-mechanics", { turn, mechanics, ...(language ? { play_language: language } : {}) });
		} catch {
			/* the projection must never fail the branch it marks */
		}
		pi.events.emit("coc:mechanics", { campaign, turn, mechanics });
	}

	async function graph(raw: unknown): Promise<TimelineAnswer> {
		if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw)))
			return answer({ status: "error", campaign: campaign ?? null, code: "invalid_params", reason: "Expected timeline.graph parameters to be an object" });
		if (!bridge) return answer({ status: "error", campaign: campaign ?? null, code: "table_not_open", reason: "the table is not open" });
		if (!campaign) return answer({ status: "unbound", campaign: null });
		const params = { ...((raw ?? {}) as Record<string, unknown>) };
		delete params.campaign;
		try {
			const result = await bridge("table.graph", { ...params, campaign });
			return answer({ status: "ready", ...(result && typeof result === "object" ? result as Record<string, unknown> : {}), campaign });
		} catch (error) {
			return failure(error);
		}
	}

	async function branch(raw: unknown): Promise<TimelineAnswer> {
		if (raw === null || typeof raw !== "object" || Array.isArray(raw))
			return answer({ status: "error", campaign: campaign ?? null, code: "invalid_params", reason: "Expected timeline.branch parameters to be an object" });
		const params = { ...(raw as Record<string, unknown>) };
		delete params.campaign;
		if (typeof params.commit !== "string" || !params.commit.trim())
			return answer({ status: "error", campaign: campaign ?? null, code: "invalid_params", reason: "timeline.branch needs the commit to branch from" });
		for (const key of ["name", "label"] as const)
			if (params[key] !== undefined && typeof params[key] !== "string")
				return answer({ status: "error", campaign: campaign ?? null, code: "invalid_params", reason: `timeline.branch parameter ${key} must be a string` });
		if (!bridge) return answer({ status: "error", campaign: campaign ?? null, code: "table_not_open", reason: "the table is not open" });
		if (!campaign) return answer({ status: "unbound", campaign: null });
		try {
			const result = await bridge("table.branch", { ...params, campaign });
			const row = result && typeof result === "object" ? result as Record<string, unknown> : {};
			if (row.ok === true) {
				noteWatershed(row);
				void emitToPanel(PACK_ID, "timeline-changed");
			}
			return answer({ status: "ready", ...row, campaign });
		} catch (error) {
			return failure(error);
		}
	}

	registerInvokeHandlers(PACK_ID, {
		"timeline.graph": graph,
		"timeline.branch": branch,
	});

	// A committed turn is a new node on the graph; the push carries no data, the panel re-reads.
	pi.events.on("coc:turn-committed", () => {
		void emitToPanel(PACK_ID, "timeline-changed");
	});
}
