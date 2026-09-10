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
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { emitToPanel, registerInvokeHandlers } from "./host-bridge.ts";
import { uiWordsSurface } from "./ui-words.ts";
import type { UiWords } from "../runtime/ui-words.ts";
import type { HostRuntime } from "../runtime/host.ts";
import { PACK_ID } from "./sheet.ts";

type KernelCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;

interface KernelBridgeEvent {
	campaign?: string;
	call?: KernelCall;
	/** The composed runtime: the content root the words are read from, the home they cache in, and the lane that projects them. */
	runtime?: HostRuntime;
}

export interface TimelineAnswer {
	status?: "ready" | "unbound";
	/** Which campaign the answer came from, so a panel left open across tables can tell. */
	campaign: string | null;
	/** The product's own captions for this session's play language, so no renderer keeps a table. */
	ui?: UiWords;
	/** The kernel's own fields ride at the top level, unwrapped. */
	[key: string]: unknown;
}

/**
 * A refusal in the envelope the panel reads (`data.error.{code,message}`; the cold path reaches
 * the same shape through the host's `cocDenied`). The ext-invoke mount forwards this envelope's
 * code and message untouched, while a thrown handler error would be flattened to `agent_error` —
 * so a refusal is returned, never thrown. `message` is English and for the log; the word the
 * player reads is looked up by `code` (contract §23).
 */
export interface TimelineFailure {
	ok: false;
	error: { code: string; message: string };
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
	let runtime: HostRuntime | undefined;
	let context: ExtensionContext | undefined;
	let language: string | undefined;

	/**
	 * The chrome's words for this table's language (§23): a seed or a cached projection when there
	 * is one, and otherwise the authored words at once plus one background projection for the tag.
	 */
	const words = uiWordsSurface((tag) => {
		pi.events.emit("coc:ui-words", { tag });
		void emitToPanel(PACK_ID, "timeline-changed");
	});
	function chrome(): Promise<UiWords | undefined> {
		return words.words(language, runtime ? {
			runtime,
			model: context?.model ? `${context.model.provider}/${context.model.id}` : undefined,
			thinking: context?.thinkingLevel,
		} : undefined);
	}
	async function answer(row: TimelineAnswer): Promise<TimelineAnswer> {
		const ui = await chrome();
		return ui ? { ...row, ui } : row;
	}
	function refuse(code: string, message: string): TimelineFailure {
		return { ok: false, error: { code, message } };
	}
	function failure(error: unknown): TimelineFailure {
		return refuse(answerCode(error), error instanceof Error ? error.message : String(error));
	}

	pi.events.on("coc:kernel-bridge", (data) => {
		const event = (data ?? {}) as KernelBridgeEvent;
		bridge = event.call;
		if (event.campaign) campaign = event.campaign;
		if (event.runtime?.contentRoot) runtime = event.runtime;
	});
	pi.on("session_start", async (_event, ctx) => { context = ctx; });
	pi.on("before_agent_start", async (_event, ctx) => { context = ctx; });
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

	async function graph(raw: unknown): Promise<TimelineAnswer | TimelineFailure> {
		if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw)))
			return refuse("invalid_params", "Expected timeline.graph parameters to be an object");
		if (!bridge) return refuse("table_not_open", "the table is not open");
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

	async function branch(raw: unknown): Promise<TimelineAnswer | TimelineFailure> {
		if (raw === null || typeof raw !== "object" || Array.isArray(raw))
			return refuse("invalid_params", "Expected timeline.branch parameters to be an object");
		const params = { ...(raw as Record<string, unknown>) };
		delete params.campaign;
		if (typeof params.commit !== "string" || !params.commit.trim())
			return refuse("invalid_params", "timeline.branch needs the commit to branch from");
		for (const key of ["name", "label"] as const)
			if (params[key] !== undefined && typeof params[key] !== "string")
				return refuse("invalid_params", `timeline.branch parameter ${key} must be a string`);
		if (!bridge) return refuse("table_not_open", "the table is not open");
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
	pi.events.on("coc:turn-committed", (data) => {
		const row = data as {commit?: string; turn?: number};
		try {
			if (row?.commit && Number.isInteger(row.turn)) pi.appendEntry("coc-turn-anchor", {commit: row.commit, turn: row.turn});
		} catch { /* Legacy tool-result anchors remain available if this projection cannot append. */ }
		void emitToPanel(PACK_ID, "timeline-changed");
	});
}
