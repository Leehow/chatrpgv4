/**
 * The pi-coc kernel extension: it starts the Python kernel, wires the seven verbs onto RPC,
 * and mirrors the turn state machine on the extension side. Responsibilities in
 * docs/kernel-rpc.md §8.
 */

import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRuntime, type HostRuntime } from "../../runtime/host.ts";
export { kernelCommand } from "../../runtime/host.ts";
import { cocHome, cocMode } from "../lanes/host.ts";
import { extensionSurface } from "../ui/words.ts";
import { type KernelClient, KernelError, type KernelProgressFrame, isKernelError } from "./client.ts";
import { progressPartial } from "./progress.ts";
import { COC_TOOLS, COC_TOOL_NAMES, type CocToolSpec, WRITE_TOOLS } from "./tools.ts";
import { type CommitPayload, runVerifierLane } from "./verifier.ts";

type TurnState = "awaiting_player" | "open" | "acting" | "asked" | "committed";

interface OpenResult {
	campaign?: { id?: string; title?: string; play_language?: string };
	turn?: { number?: number; state?: TurnState };
	investigators?: Array<Record<string, unknown>>;
	scene?: { name?: string; display_name?: string };
	pending_turn?: {
		player_text?: string;
		receipts?: unknown[];
		owed?: string[];
		since?: string;
		last_call_ordinal?: number;
	} | null;
	/** The resume checkpoint (contract §12.2): after a restart the first capsule carries this section itself, so the extension sends no separate host message for it. */
	resume?: { turn?: number; commit?: string; one_line?: string; rebuilt?: boolean } | null;
	opening_needed?: boolean;
  mod_context?: unknown;
  setup_prologue?: unknown;
}

/**
 * The session summary (contract §11.5) and the pending choice (§11.3, §11.5) in a `resolve` result.
 * The extension reads them only for the status line and telemetry; it interprets no rules, and a
 * missing field is treated as "none".
 */
type SessionSummary = {
	kind?: string;
	round?: number;
	status?: string;
	ended?: boolean;
	/** Whose turn it is; the contract does not fix the field name, so both spellings are accepted. */
	turn_of?: string;
	active_actor?: string;
	pending_defense?: { for?: string; defender?: string; options?: string[] } | null;
};

type PendingChoice = {
	name?: string;
	for?: string;
	prompt?: string;
	options?: string[];
};

type ResolveResult = {
	outcome?: { kind?: string };
	session?: SessionSummary | null;
	pending_choice?: PendingChoice | null;
};

/**
 * The attachment a `handout` effect returns from `apply` (contract §14.8).
 * A Pi assistant message holds only text / thinking / toolCall blocks, and there is no outbound
 * attachment channel (see docs/pi-host-contract.md §4, §5), so the path travels in the
 * `coc-mechanics` projection instead of in the player's prose.
 */
interface HandoutAttachment {
	path: string;
	media_type?: string;
	name?: string;
	receipt?: string;
}

interface CampaignRow {
	id: string;
	title?: string;
	module_id?: string;
	status?: string;
	turn?: number;
}

interface TableState {
	kernel: KernelClient;
	campaign: string;
	telemetryPath: string;
	/** The campaign's play_language, used to tell the verifier lane which language to write `why` in; not mentioned when the kernel gives none. */
	playLanguage?: string;
	turn: number;
	state: TurnState;
	/** The ordinal of state-changing calls minted this turn. */
	callOrdinal: number;
	/** Turn 0: the table has opened but not yet narrated, so narrate is allowed straight out of awaiting_player. */
	openingPending: boolean;
	/** narrate/ask has returned rendered_text and is waiting to replace the assistant message. */
	renderedText?: string;
	deliveryToolCallId?: string;
	/** The most recent session (combat, chase, sanity bout) from resolve; null means no session is running. */
	session: SessionSummary | null;
	/** The pending choice left by the most recent resolve; when `for` is player the Keeper should hand it back with ask. */
	pendingChoice: PendingChoice | null;
	/** Whether this agent run has already closed the turn with narrate/ask. */
	closedThisRun: boolean;
	steeredThisTurn: boolean;
	readingWait?: boolean;
	/** The kernel's `fix` for a refused implicit delivery (`play_language_mismatch`); steered once at agent_end instead of delivering. */
	deliveryFix?: { kind: string; text: string };
	roundTrips: number;
	mintedCallIds: Map<string, string>;
	/** Calls the kernel rejected this turn: key of name+params to a count and the last error. Blocked on the third identical resend. */
	rejected: Map<string, { count: number; last: string }>;
	/** toolCallId to the key above; tool_result counts against it. */
	callKeys: Map<string, string>;
	/** The turn narrate has committed but the verifier lane has not yet started on (contract §12.5: it runs after the delivery replacement). */
	pendingCommit?: CommitPayload;
	/**
	 * A turn narrate has closed and the verifier lane still owes a telemetry row for (ticket #28).
	 * It is set the moment narrate succeeds, before anything about the lane is known, so that the
	 * ways the lane can fail to start — no `facts`, no session, a throw — each leave a row with a
	 * reason instead of leaving nothing at all. Real-table evidence (`toomany-s4` turns 3, 4 and 14)
	 * had three narrate-closed turns with no lane row and no way to see why.
	 */
	verifierOwed?: { turn: number };
	/** Handout attachments landed by `apply` this turn (contract §14.8), waiting to join the mechanics projection. */
	attachments: HandoutAttachment[];
	/** Cut off lane completions still in flight when the session ends; they must not hold up the exit. */
	lanes: AbortController;
}

const CLOSED_STATES: ReadonlySet<TurnState> = new Set<TurnState>(["awaiting_player", "committed", "asked"]);
const TURN_CLOSED_REASON = "the turn is closed, waiting for the player";
/** Used when the kernel refuses a delivery that carries none of the campaign's play_language script. */
const PLAY_LANGUAGE_MISMATCH_STEER =
	"The kernel refused this turn's delivery: play_language_mismatch. Rewrite every player-facing word in the campaign's play_language, then deliver it again.";

let table: TableState | undefined;
/** In setup mode there is no table, so the kernel subprocess hangs here on its own (contract §14.4). */
let soloKernel: KernelClient | undefined;
/**
 * The gate on the RPC closure that goes onto the bus (contract §12.8's `coc:kernel-bridge`).
 * The lanes are asynchronous: memory extraction and on-demand deepening may not get to send
 * their request until after shutdown, and by then the kernel client is closed — the next
 * request in its queue would spawn the subprocess all over again. Closing this gate first
 * makes a late call fail on the spot rather than wake a kernel nobody owns.
 */
let bridgeGate = { open: false };
/**
 * The captions this extension notifies with (contract §23), for the campaign's own play language.
 * `startupError` itself stays English: it is also thrown at the Keeper (`the kernel is not up`) and
 * given as a block reason, and the system language of everything the model reads is English.
 */
const surface = extensionSurface();
let startupError: string | undefined;
/** Every field of the session_start ctx is computed on access, so holding it is holding a live view of the session. */
let sessionCtx: ExtensionContext | undefined;

function normalizeName(value: unknown): unknown {
	if (typeof value !== "string") return value;
	return value.trim().replace(/\s+/g, " ");
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * `details` reaches only the extension and the interface; the model sees the tool result body.
 * So the options of a `needs` and the candidates of a `needs_choice` must land in that body,
 * or the Keeper is told there are candidates while unable to see them and cannot fill in a
 * decision (contract §11.3).
 */
function errorDetailLines(details: Record<string, unknown> | undefined): string[] {
	if (!details) return [];
	const lines: string[] = [];
	const needs = details.needs as { field?: string; options?: unknown[] } | undefined;
	if (needs?.field) {
		const options = (needs.options ?? []).map((option) => String(option)).join(", ");
		lines.push(options ? `missing ${needs.field}, one of: ${options}` : `missing ${needs.field}`);
	}
	const candidates = details.candidates;
	if (Array.isArray(candidates) && candidates.length > 0) {
		lines.push("candidates:");
		for (const candidate of candidates) {
			if (typeof candidate === "string") {
				lines.push(`- ${candidate}`);
				continue;
			}
			const row = (candidate ?? {}) as Record<string, unknown>;
			// The contract does not fix the candidate field names: several spellings of the name and of "when it applies" are accepted.
			const name = asString(row.name) ?? asString(row.id) ?? asString(row.decision) ?? "?";
			const when = asString(row.when) ?? asString(row.summary) ?? asString(row.description);
			lines.push(when ? `- ${name}: ${when}` : `- ${name}`);
		}
	}
	if (Array.isArray(details.conflicts) && details.conflicts.length > 0) {
		const conflicts = details.conflicts.map((conflict) => {
			if (conflict?.class !== "mod_state" && conflict?.class !== "engine_state") return conflict;
			const { values, ...summary } = conflict;
			return { ...summary, lines: Object.keys(values ?? {}) };
		});
		lines.push(`merge conflicts: ${JSON.stringify(conflicts)}`);
	}
	const exits = details.exits;
	if (Array.isArray(exits) && exits.length > 0) {
		lines.push(`reachable: ${exits.map((exit) => (typeof exit === "string" ? exit : JSON.stringify(exit))).join(", ")}`);
	}
	const fields = details.fields;
	if (Array.isArray(fields) && fields.length > 0) {
		// A `play_language_mismatch` refusal (contract §16.3): rewrite these player-facing fields.
		lines.push(`rewrite in the campaign's play_language: ${fields.map((field) => String(field)).join(", ")}`);
	}
	// A batch whose definition agent ran out of time is not the same refusal as one whose agent died:
	// the first says the batch itself is too big to retry unchanged, and `fix` alone cannot say which.
	if (details.reason === "mod_agent_failed") {
		lines.push(details.timed_out === true
			? "the definition agent ran out of time: retry with fewer define effects in this apply"
			: "the definitions already accepted are retained, so the retry resumes from where this one stopped");
	}
	if (details.reason === "mod_narrative_repair") {
		// The Mod audit already validates these lists; preserve its semantic repair verbatim.
		lines.push(`mod repair: ${JSON.stringify({
			missing: Array.isArray(details.missing) ? details.missing : [],
			findings: Array.isArray(details.findings) ? details.findings : [],
		})}`);
	}
	return lines;
}

/**
 * Read telemetry carries what was asked about (contract §17.6): `look focus=npc name=X` and
 * `lookup name=X` are the calls the capsule is supposed to make unnecessary, and a KPI that
 * cannot see the target cannot tell a lookup of someone in the room from one of a stranger.
 * Names only -- no prose, no free text from the model's other parameters.
 */
function readTelemetry(tool: string, params: Record<string, unknown>): Record<string, unknown> {
	if (tool !== "look" && tool !== "lookup") return {};
	const focus = asString(params.focus);
	const name = asString(params.name);
	return {
		...(focus ? { focus } : {}),
		...(name ? { about: name } : {}),
	};
}

/** resolve telemetry carries two extra columns: which family this adjudication belongs to and which session it fell in (contract §11.6). */
function resolveTelemetry(result: ResolveResult): Record<string, unknown> {
	const outcomeKind = asString(result.outcome?.kind);
	const sessionKind = asString(result.session?.kind ?? undefined);
	return {
		...(outcomeKind ? { outcome_kind: outcomeKind } : {}),
		...(sessionKind ? { session_kind: sessionKind } : {}),
	};
}

function errorText(error: unknown): string {
	if (!(isKernelError(error))) {
		return error instanceof Error ? error.message : String(error);
	}
	return [error.toToolText(), ...errorDetailLines(error.details)].join("\n");
}

/** The one floor §16.3 puts under a delivery: the play-language script. */
type FloorDetail = "play_language_mismatch";
const FLOOR_DETAILS: ReadonlySet<string> = new Set<string>(["play_language_mismatch"]);

/**
 * The kernel's delivery-floor refusal (contract §5 / §16.3): `invalid_params` with a
 * `code_detail` naming the floor the delivery fell through. The detail is read from all the
 * places it can travel, because it is one contract field and not a semantic judgement.
 *
 * There is no figure floor. The kernel never looks for a receipt's numbers in the prose
 * (2026-09-09 user decision): they travel as the mechanics projection and the frontend draws
 * them there, so a delivery that states none of them is a correct delivery. A steer that told
 * the Keeper to write "the roll and its target, minutes passed" into the prose is what put
 * "rolled 25 against 53, 15 minutes" under every dice card.
 */
function floorDetail(error: unknown): FloorDetail | undefined {
	if (!isKernelError(error)) return undefined;
	const detail =
		FLOOR_DETAILS.has(error.code)
			? error.code
			: (error.codeDetail ?? (error.details as { code_detail?: unknown } | undefined)?.code_detail);
	if (typeof detail === "string" && FLOOR_DETAILS.has(detail)) return detail as FloorDetail;
	return undefined;
}

function floorSteer(
	detail: FloorDetail,
	error: unknown,
): { kind: string; text: string } {
	const base = PLAY_LANGUAGE_MISMATCH_STEER;
	const kind = detail.replaceAll("_", "-");
	const fix =
		isKernelError(error) && error.fix ? `${base} The kernel says: ${error.fix}` : base;
	return { kind, text: fix };
}

/**
 * The handout attachments in an `apply` result (contract §14.8). One row or a list is accepted:
 * a single apply may show several handouts, and the contract only wrote the singular shape.
 */
function readAttachments(result: Record<string, unknown>): HandoutAttachment[] {
	const raw = result.attachments ?? result.attachment;
	const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
	const found: HandoutAttachment[] = [];
	for (const row of rows) {
		if (!row || typeof row !== "object") continue;
		const record = row as Record<string, unknown>;
		const path = asString(record.path);
		if (!path) continue;
		found.push({
			path,
			...(asString(record.media_type) ? { media_type: asString(record.media_type) } : {}),
			...(asString(record.name) ?? asString(record.label)
				? { name: asString(record.name) ?? asString(record.label) }
				: {}),
			...(asString(record.receipt) ? { receipt: asString(record.receipt) } : {}),
		});
	}
	return found;
}

/** The mechanics projection carried by a narrate/ask result (contract §16.2); missing or malformed means none. */
function readMechanics(result: Record<string, unknown>): Array<Record<string, unknown>> {
	const raw = result.mechanics;
	if (!Array.isArray(raw)) return [];
	return raw.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
}

export default function (pi: ExtensionAPI) {
	let runtime: HostRuntime | undefined;
  let mods: {prepare(method: string, payload: Record<string, any>, signal?: AbortSignal): Promise<void>} | undefined;
  pi.events.on("coc:mods-bridge", value => { mods = value as typeof mods; });
	let reading: { ensure(moduleId: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> } | undefined;
	let readingModule: string | undefined;
	pi.events.on("coc:reading-bridge", (value) => {
		reading = value && typeof (value as any).ensure === "function" ? value as any : undefined;
	});
	// The setup process needs the kernel too (`campaign.*`, `module.*` and `setup.*` all live there),
	// but it has no table: it registers none of the seven verbs, does not `table.open`, and runs no
	// verifier lane (contract §14.4). The mode is read in the factory rather than at module top level:
	// when one process loads this several times, a top-level constant freezes on the first value.
	const setupMode = cocMode() === "setup";

	// ---- Telemetry --------------------------------------------------------

	async function record(entry: Record<string, unknown>): Promise<void> {
		const line = { turn: table?.turn ?? null, ...entry };
		try {
			pi.appendEntry("coc-telemetry", line);
		} catch {
			/* telemetry must never break a turn */
		}
		const path = table?.telemetryPath;
		if (!path) return;
		try {
			await mkdir(dirname(path), { recursive: true });
			await appendFile(path, `${JSON.stringify(line)}\n`, "utf8");
		} catch {
			/* same as above */
		}
	}

	// ---- Host messages ----------------------------------------------------

	/** A message the host sends itself is marked as such: it is not player input and does not go to table.player_input. */
	function sendHost(content: string, kind: string): void {
		pi.sendMessage(
			{ customType: "coc-host", content, display: false, details: { coc_host: true, kind } },
			{ triggerTurn: true },
		);
	}

	// ---- Turn mirror ------------------------------------------------------

	function applyOpen(open: OpenResult): void {
		if (!table) return;
		readingModule = asString(open.campaign?.module_id);
		table.turn = typeof open.turn?.number === "number" ? open.turn.number : table.turn;
		table.state = open.turn?.state ?? table.state;
		table.openingPending = open.opening_needed === true;
		// A recovered turn goes on minting ordinals after the dead process, or the first write hits idempotency_conflict.
		table.callOrdinal = open.pending_turn?.last_call_ordinal ?? 0;
		table.mintedCallIds.clear();
		table.rejected.clear();
		table.callKeys.clear();
		table.renderedText = undefined;
		table.deliveryToolCallId = undefined;
		table.closedThisRun = false;
		table.steeredThisTurn = false;
		table.deliveryFix = undefined;
		table.attachments = [];
	}

	function mintCallId(state: TableState): string {
		state.callOrdinal += 1;
		return `t${state.turn}-c${state.callOrdinal}`;
	}

	/** Use the minted one when there is one; mint a fallback when tool_call did not run. */
	function takeCallId(state: TableState, toolCallId: string): string {
		const minted = state.mintedCallIds.get(toolCallId);
		if (minted) {
			state.mintedCallIds.delete(toolCallId);
			return minted;
		}
		return mintCallId(state);
	}

	/**
	 * A `resolve` result may carry a session and a pending choice (contract §11.5). The turn state
	 * machine gains no state for it: a session leaves the turn in `acting`, and the Keeper goes on
	 * to hand the player's defence back with ask, or answers for an NPC with actor plus defense.
	 * Only the summary is mirrored here, for the status line and telemetry.
	 */
	function noteResolve(state: TableState, result: ResolveResult): void {
		const session = result.session;
		state.session = session && typeof session === "object" ? session : null;
		const pending = result.pending_choice;
		state.pendingChoice = pending && typeof pending === "object" ? pending : null;
		pi.events.emit("coc:resolve", {
			campaign: state.campaign,
			turn: state.turn,
			result,
		});
	}

	/**
	 * narrate committed: put a `coc:turn-committed` on the bus (contract §12.8) for the memory
	 * extension to start its lane on, and keep the same payload for the verifier lane, which runs
	 * once the delivery replacement is done.
	 */
	function noteCommit(state: TableState, result: Record<string, unknown>, mechanics: Array<Record<string, unknown>>): void {
		const renderedText = asString(result.rendered_text);
		if (!renderedText) return;
		const extraction = (result.extraction ?? {}) as { job_id?: unknown };
		const payload: CommitPayload = {
			campaign: state.campaign,
			turn: typeof result.turn === "number" ? result.turn : state.turn,
			rendered_text: renderedText,
			...(mechanics.length > 0 ? { mechanics } : {}),
			...(asString(result.commit) ? { commit: asString(result.commit) } : {}),
			...(asString(extraction.job_id) ? { job_id: asString(extraction.job_id) } : {}),
			...(result.facts && typeof result.facts === "object" ? { facts: result.facts as CommitPayload["facts"] } : {}),
		};
		state.pendingCommit = payload;
		pi.events.emit("coc:turn-committed", payload);
	}

	/**
	 * The verifier lane (contract §12.5): fire-and-forget after the delivery replacement, never
	 * awaited, never blocking, never nagging. A kernel without `facts` (slices 0 and 1) does not
	 * run it: there is no fact list to read.
	 *
	 * Whatever happens, a turn that narrate closed leaves exactly one `lane: "verifier"` row
	 * (ticket #28). The lane not running is itself a result and carries its reason:
	 *
	 * | reason | what happened |
	 * | --- | --- |
	 * | `no_delivery` | narrate succeeded but returned no `rendered_text`, so there is nothing to read |
	 * | `no_facts` | the kernel returned no fact lists (slice 0 and 1 kernels): reading without them is guessing |
	 * | `session_gone` | the session was disposed before the lane could start |
	 * | `lane_crashed` | the lane itself threw where nothing else could catch it |
	 *
	 * The reasons for a lane that did start (`model_unavailable`, `model_error`, `bad_output`,
	 * `timeout`, `warn_failed`) are written by `runVerifierLane`.
	 */
	function settleVerifier(state: TableState): void {
		const owed = state.verifierOwed;
		state.verifierOwed = undefined;
		const payload = state.pendingCommit;
		state.pendingCommit = undefined;
		if (!owed) return;
		const miss = (reason: string, detail: string): void => {
			void record({ lane: "verifier", turn: payload?.turn ?? owed.turn, ok: false, ran: false, reason, detail });
		};
		if (!payload) {
			miss("no_delivery", "narrate returned no rendered_text, so the lane had nothing to read");
			return;
		}
		if (!payload.facts) {
			miss("no_facts", "the kernel returned no fact lists with this narrate, so the lane cannot judge anything");
			return;
		}
		const ctx = sessionCtx;
		if (!ctx) {
			miss("session_gone", "the session was gone before the lane could start");
			return;
		}
		const kernel = state.kernel;
		const signal = state.lanes.signal;
		const playLanguage = state.playLanguage;
		const timer = setTimeout(() => {
			// The lane is advisory: however it breaks, it must not surface as an unhandled rejection —
			// but it must not vanish either, so the last-resort catch writes the row itself.
			void runVerifierLane({
				ctx,
				payload,
				...(playLanguage ? { playLanguage } : {}),
				call: (method, params) => kernel.call(method, params),
				record,
				signal,
			}).catch((error) => {
				void record({
					lane: "verifier",
					turn: payload.turn,
					ok: false,
					ran: false,
					reason: "lane_crashed",
					detail: (error instanceof Error ? error.message : String(error)).slice(0, 200),
				});
			});
		}, 0);
		timer.unref?.();
	}

	/**
	 * The handouts of this turn joined onto the kernel's mechanics projection (contract §14.8,
	 * §16.2). Pi has no outbound attachment channel, so the file path travels as a `handout` row in
	 * the language-neutral projection rather than as a line injected into the Keeper's prose; the
	 * front end and the driver read it from there.
	 */
	function withHandouts(state: TableState, mechanics: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
		const pending = state.attachments;
		state.attachments = [];
		if (pending.length === 0) return mechanics;
		const rows = mechanics.map((row) => ({ ...row }));
		for (const attachment of pending) {
			void record({
				lane: "handout",
				event: "delivered",
				ok: true,
				path: attachment.path,
				...(attachment.name ? { name: attachment.name } : {}),
				delivered_as: "mechanics",
			});
			const existing = rows.find(
				(row) =>
					row.kind === "handout" &&
					(row.path === attachment.path || (attachment.name !== undefined && row.name === attachment.name)),
			);
			if (existing) {
				if (!asString(existing.path)) existing.path = attachment.path;
				if (attachment.media_type && !asString(existing.media_type)) existing.media_type = attachment.media_type;
				continue;
			}
			rows.push({
				kind: "handout",
				name: attachment.name ?? attachment.path,
				path: attachment.path,
				...(attachment.media_type ? { media_type: attachment.media_type } : {}),
				...(attachment.receipt ? { receipt: attachment.receipt } : {}),
			});
		}
		return rows;
	}

	/**
	 * The mechanics projection reaches the delivery channel as a `coc-mechanics` session entry plus
	 * a `coc:mechanics` bus event (contract §8, §16.2). The Pi RPC event stream carries it, so the
	 * driver lands it in the evidence and a future front end renders dice cards and change bars from
	 * it. It is never injected into the prose: the TUI shows only what the Keeper wrote.
	 */
	function noteMechanics(state: TableState, turn: number, mechanics: Array<Record<string, unknown>>,
		markedText?: string, labels?: unknown): void {
		if (mechanics.length === 0) return;
		// §16.6: `marked_text` rides here rather than in the assistant message, because that message
		// is also what a terminal reader sees and raw `{{...}}` is not prose. A frontend that has it
		// draws each marked row where the Keeper put it; one that does not reads the message as before.
		const entry = { turn, mechanics, ...(labels ? { labels } : {}), play_language: state.playLanguage, ...(markedText ? { marked_text: markedText } : {}) };
		try {
			pi.appendEntry("coc-mechanics", entry);
		} catch {
			/* the projection must never break a turn */
		}
		// The bus event keeps its shape: `marked_text` is a rendering hint for the delivery channel,
		// not a fact about the turn, and a bus subscriber that wanted it would want the entry.
		pi.events.emit("coc:mechanics", { campaign: state.campaign, turn, mechanics, ...(labels ? { labels } : {}) });
	}

	function applyToolSuccess(state: TableState, tool: string, toolCallId: string, result: Record<string, unknown>): void {
		switch (tool) {
			case "look":
			case "lookup":
			case "recall":
				if (state.state === "open") state.state = "acting";
				break;
			case "resolve":
				state.state = "acting";
				noteResolve(state, result as ResolveResult);
				break;
			case "apply": {
				state.state = "acting";
				// Handouts (contract §14.8): the kernel mints the receipt, and the attachment itself is the
				// extension's to hand on. Pi has no outbound attachment channel, so it is held until the
				// delivery and lands as a path in the mechanics projection.
				const found = readAttachments(result);
				if (found.length > 0) {
					state.attachments.push(...found);
					for (const attachment of found) {
						void record({
							lane: "handout",
							tool: "apply",
							ok: true,
							path: attachment.path,
							...(attachment.media_type ? { media_type: attachment.media_type } : {}),
							...(attachment.name ? { name: attachment.name } : {}),
							...(attachment.receipt ? { receipt: attachment.receipt } : {}),
						});
					}
				}
				break;
			}
			case "ask": {
				state.state = "asked";
				state.openingPending = false;
				// The pending choice has been handed back to the player, so the turn no longer owes an ask.
				state.pendingChoice = null;
				state.closedThisRun = true;
				state.renderedText = typeof result.rendered_text === "string" ? result.rendered_text : undefined;
				state.deliveryToolCallId = toolCallId;
                if (result.interaction) pi.appendEntry("coc-choice", result.interaction);
				noteMechanics(state, typeof result.turn === "number" ? result.turn : state.turn,
					withHandouts(state, readMechanics(result)), asString(result.marked_text), result.labels);
				break;
			}
			case "narrate": {
				state.state = "awaiting_player";
				state.openingPending = false;
				state.closedThisRun = true;
				state.renderedText = asString(result.rendered_text);
				state.deliveryToolCallId = toolCallId;
				// From here on this turn owes a verifier-lane row, whatever the lane turns out to do (ticket #28).
				state.verifierOwed = { turn: typeof result.turn === "number" ? result.turn : state.turn };
				const mechanics = withHandouts(state, readMechanics(result));
				noteMechanics(state, typeof result.turn === "number" ? result.turn : state.turn, mechanics,
					asString(result.marked_text), result.labels);
				noteCommit(state, result, mechanics);
				break;
			}
		}
	}

	// ---- Tools ------------------------------------------------------------

	async function runTool(
		spec: CocToolSpec,
		toolCallId: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<Record<string, unknown>>,
	): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }> {
		const state = table;
		if (!state) {
			throw new Error(startupError ?? "the kernel is not up, so this table cannot open");
		}
		if(spec.name==='ask' && params.kind!=='mechanics')throw new Error('Use narrate for ordinary story questions and await free input; ask only accepts mechanics');
    const payload: Record<string, unknown> = { campaign: state.campaign, ...params };
		if (WRITE_TOOLS.has(spec.name)) {
			payload.call_id = takeCallId(state, toolCallId);
		}
		const startedAt = new Date().toISOString();
		const began = Date.now();
		// Progress frames (contract §1) are requested only when the runtime gave us its
		// update channel; each frame becomes one partial result on the tool status line.
		const onProgress = onUpdate ? (frame: KernelProgressFrame) => onUpdate(progressPartial(frame)) : undefined;
		try {
			if (spec.name === "lookup" && params.kind === "source") {
				if (!asString(params.query)?.trim()) throw new KernelError({
					code: "invalid_params", message: "Source lookup needs a named query; question supplies additional scope",
					fix: "pass the place or entity as query and describe the unresolved source question" });
				if (!reading || !readingModule) throw new KernelError({ code: "needs", message: "the source reading service is unavailable",
					fix: "reopen the table with its module reading extension available", details: { reason: "reading_failed" } });
				await reading.ensure(readingModule, { purpose: "detail", focus: params.query,
					question: params.question ?? "", retry: params.retry === true, foreground: true }, signal);
				payload.kind = "module";
			}
			let result: Record<string, unknown>;
      if (mods) {
        if (Array.isArray(payload.effects)) payload.effects = payload.effects.map(effect => ({...(effect as Record<string, unknown>)}));
        await mods.prepare(spec.name, payload, signal);
      }
			try { result = (await state.kernel.call<Record<string, unknown>>(spec.method, payload, onProgress)) ?? {}; }
			catch (failure) {
				if (!(isKernelError(failure)) || failure.details?.reason !== "material_pending" || !reading || !readingModule) throw failure;
				await reading.ensure(readingModule, { ...(failure.details.read as Record<string, unknown>), foreground: true }, signal);
				result = (await state.kernel.call<Record<string, unknown>>(spec.method, payload, onProgress)) ?? {};
			}
			if (spec.name === "lookup" && params.kind === "module" && params.question) {
				result.note = "This is published graph material. Use lookup kind source only if an original-page recheck is needed.";
			}
			applyToolSuccess(state, spec.name, toolCallId, result);
			await record({
				tool: spec.name,
				call_id: payload.call_id ?? null,
				started_at: startedAt,
				ms: Date.now() - began,
				ok: true,
				...(spec.name === "resolve" ? resolveTelemetry(result as ResolveResult) : {}),
				...readTelemetry(spec.name, params),
			});
			if (spec.name === "narrate" || spec.name === "ask") {
				// A turn inside a session must be accountable on its own: round trips in combat are not the same as in investigation.
				await record({
					tool: spec.name,
					event: "turn-closed",
					round_trips: state.roundTrips,
					ok: true,
					...(state.session?.kind ? { session_kind: state.session.kind } : {}),
				});
			}
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				details: result,
			};
		} catch (error) {
			const code = isKernelError(error) ? error.code : "internal";
			if ((error as { details?: { reason?: string } })?.details?.reason === "reading_timeout") state.readingWait = true;
			const floor = floorDetail(error);
			// `code` alone collapses every refusal of one family into one word. The kernel's own
			// `reason` is a closed authored field, and without it a failure lane cannot tell a
			// definition agent that died from a batch the Keeper simply got wrong.
			const reason = asString((error as { details?: { reason?: unknown } })?.details?.reason);
			await record({
				tool: spec.name,
				call_id: payload.call_id ?? null,
				started_at: startedAt,
				ms: Date.now() - began,
				ok: false,
				code,
				...(reason ? { reason } : {}),
				...(floor ? { code_detail: floor } : {}),
			});
			return {
				content: [{ type: "text", text: errorText(error) }],
				details: {
					coc_error: {
						code,
						message: error instanceof Error ? error.message : String(error),
						...(isKernelError(error) && error.codeDetail ? { code_detail: error.codeDetail } : {}),
						...(isKernelError(error) && error.fix ? { fix: error.fix } : {}),
						...(isKernelError(error) && error.details ? { details: error.details } : {}),
					},
				},
			};
		}
	}

	// The setup process's tool surface is only onboarding's `setup`: not one of the seven verbs is registered (contract §14.4).
	for (const spec of setupMode ? [] : COC_TOOLS) {
		pi.registerTool({
			name: spec.name,
			label: spec.label,
			description: spec.description,
			promptSnippet: spec.promptSnippet,
			parameters: spec.parameters,
			// The actions of a turn are ordered: run them serially, so the calls after narrate in the same batch can be stopped.
			executionMode: "sequential",
			execute: async (toolCallId, params, signal, onUpdate) => runTool(spec, toolCallId, params as Record<string, unknown>, signal, onUpdate),
		});
	}

	// AgentToolResult has no isError field, so the error flag can only be raised in tool_result.
	pi.on("tool_result", async (event) => {
		if (!COC_TOOL_NAMES.includes(event.toolName as never)) return;
		const details = event.details as { coc_error?: { code?: unknown; message?: unknown } } | undefined;
		if (!details?.coc_error) return;
		const state = table;
		const key = state?.callKeys.get(event.toolCallId);
		if (state && key) {
			const previous = state.rejected.get(key);
			const last = `${String(details.coc_error.code ?? "error")}: ${String(details.coc_error.message ?? "")}`.slice(0, 160);
			state.rejected.set(key, { count: (previous?.count ?? 0) + 1, last });
		}
		return { isError: true };
	});

	// ---- Opening the table ------------------------------------------------

	async function pickCampaign(kernel: KernelClient, ctx: ExtensionContext): Promise<string> {
		const fromEnv = process.env.PI_COC_CAMPAIGN?.trim();
		if (fromEnv) return fromEnv;
		const listed = await kernel.call<{ campaigns?: CampaignRow[] }>("campaign.list");
		const campaigns = listed.campaigns ?? [];
		if (campaigns.length === 0) {
			throw new Error("This workspace has no campaigns yet: create one, or name an existing one with PI_COC_CAMPAIGN.");
		}
		const ids = campaigns.map((row) => row.id).join(", ");
		if (!ctx.hasUI) {
			throw new Error(`No interface to ask on: name a campaign with bin/pi-coc --campaign <id> or PI_COC_CAMPAIGN. Existing: ${ids}`);
		}
		const labels = campaigns.map(
			(row) => `${row.id}  ${row.title ?? ""} (turn ${row.turn ?? 0}, ${row.status ?? "?"})`,
		);
		const chosen = await ctx.ui.select("Pick a table", labels);
		const index = chosen ? labels.indexOf(chosen) : -1;
		if (index < 0) {
			throw new Error(`No campaign chosen, so no table is opening. Existing: ${ids}`);
		}
		return campaigns[index].id;
	}

	/** The RPC closure that goes onto the bus: once the gate is closed a late lane call fails on the spot instead of waking the kernel subprocess. */
	function bridgeCall(kernel: KernelClient): (method: string, params: Record<string, unknown>) => Promise<unknown> {
		const gate = bridgeGate;
		return (method, params) =>
			gate.open
				? kernel.call(method, params)
				: Promise.reject(new KernelError({ code: "internal", message: `the kernel is closed; ${method} is not sent` }));
	}

	async function shutdownKernel(): Promise<void> {
		bridgeGate.open = false;
		const current = table;
		table = undefined;
		if (current) {
			// Cut off lane completions still in flight first: an exiting process should not wait on a model round trip.
			current.lanes.abort();
			pi.events.emit("coc:kernel-bridge", { campaign: current.campaign, call: undefined, runtime: undefined });
		}
		// The setup process has no table, so its kernel hangs here on its own (contract §14.4).
		const solo = soloKernel;
		soloKernel = undefined;
		if (solo) {
			pi.events.emit("coc:kernel-bridge", { call: undefined, runtime: undefined });
		}
		const closing = runtime;
		runtime = undefined;
		await closing?.close();
	}

	pi.on("session_start", async (_event, ctx) => {
		await shutdownKernel();
		sessionCtx = ctx;
		// A new session gets a new gate: a closure handed out by the previous table can only fail, never touch this kernel.
		bridgeGate = { open: true };
		startupError = undefined;
		try {
			runtime = createRuntime({ owner: "session", home: cocHome(ctx.cwd),
				campaign: process.env.PI_COC_CAMPAIGN?.trim() || undefined });
			const kernel = runtime.openKernel({
				onDiagnostic: (message) => {
					// The kernel's stderr and restart notices can arrive after the session is disposed (the user
					// quits pi while a lane is still flying), and after that every ctx getter throws
					// (docs/pi-host-contract.md §5): one line of diagnostics must not become an unhandled rejection.
					//
					// This line is the kernel's own stderr, verbatim and English (contract §23: kernel prose
					// never reaches a player field). It is a log, not a caption: nothing is prefixed onto it,
					// nothing is translated, and it carries no key on the `extension` surface -- inventing a
					// caption for it would only put a play-language frame around an English stack trace.
					try {
						if (ctx.hasUI) ctx.ui.setStatus("coc-kernel", message.slice(0, 120));
					} catch {
						/* the session is gone */
					}
				},
				onRestart: async () => {
					const state = table;
					if (!state) return;
					await state.kernel.callImmediate("kernel.hello");
					const reopened = await state.kernel.callImmediate<OpenResult>("table.open", {
						campaign: state.campaign,
					});
					applyOpen(reopened);
				},
			});
			const hello = await kernel.call<Record<string, unknown>>("kernel.hello");
			if (setupMode) {
				// The setup process: the kernel is here, the table is not. Put the RPC closure on the bus for the
				// onboarding and module extensions; the campaign may not exist yet (`create-campaign` makes it),
				// so no campaign is picked and no table.open is made.
				soloKernel = kernel;
				const chosen = process.env.PI_COC_CAMPAIGN?.trim();
				pi.events.emit("coc:kernel-bridge", {
					mode: "setup",
					...(chosen ? { campaign: chosen } : {}),
					hello,
					call: bridgeCall(kernel),
					runtime,
				});
				return;
			}
			const campaign = await pickCampaign(kernel, ctx);
			table = {
				kernel,
				campaign,
				telemetryPath: join(cocHome(ctx.cwd), ".coc", "campaigns", campaign, "telemetry.jsonl"),
				turn: 0,
				state: "awaiting_player",
				callOrdinal: 0,
				openingPending: false,
				session: null,
				pendingChoice: null,
				closedThisRun: false,
				steeredThisTurn: false,
				roundTrips: 0,
				mintedCallIds: new Map(),
				rejected: new Map(),
				callKeys: new Map(),
				attachments: [],
				lanes: new AbortController(),
			};
			const open = await kernel.call<OpenResult>("table.open", { campaign });
			applyOpen(open);
			table.playLanguage = asString(open.campaign?.play_language);
			pi.appendEntry("coc-session", {campaign, home: cocHome(ctx.cwd), play_language: table.playLanguage, mode: "play"});
			// The tool surface is fixed: these seven and no reshaping afterwards.
			pi.setActiveTools([...COC_TOOL_NAMES]);
			// One Pi session, one kernel subprocess (contract §1), so there is only this one kernel RPC.
			// The memory extension's lane needs `memory.job` / `submit` / `fail`; it goes over this bridge
			// on the bus rather than starting a second process.
			pi.events.emit("coc:kernel-bridge", {
				campaign,
				call: bridgeCall(kernel),
				runtime,
			});
			pi.events.emit("coc:table-open", { campaign, open });

			if (ctx.hasUI) {
				// The campaign's own captions (contract §23): the one line saying the table is open reads
				// from `content/ui/<tag>/extension.json`, never from a word written here. The table is
				// already open by now, so a content root that cannot be read costs one line, never the
				// table -- letting it throw here would report an open table as a failed one.
				surface.speak(table.playLanguage);
				try {
					const words = await surface.words();
					ctx.ui.notify(
						words.line("kernel_table_open", {
							title: open.campaign?.title ?? campaign,
							turn: table.turn,
							state: table.state,
							scene: open.scene?.display_name ?? open.scene?.name ?? words.word("table_scene_unknown"),
						}),
						"info",
					);
				} catch {
					/* one welcome line is not worth refusing the table */
				}
			}

			const pending = open.pending_turn;
			if (pending) {
				const owed = (pending.owed ?? []).join(", ") || "narrate";
				// The checkpoint's one line (contract §12.2) says where the last committed turn stopped;
				// carrying it in the recovery message means the Keeper knows what he is following on from
				// without having to recall first.
				const oneLine = asString(open.resume?.one_line);
				sendHost(
					`The last session broke mid-turn and this turn was never delivered. ` +
						(oneLine ? `The last commit stopped at: ${oneLine}. ` : "") +
						`The player said: ${pending.player_text ?? "(nothing)"}. ` +
						`Receipts already landed: ${JSON.stringify(pending.receipts ?? [])}. Still owed: ${owed}. ` +
						`Use look to see the scene as it stands, finish this turn, then deliver it with narrate.`,
					"recovery",
				);
			} else if (open.opening_needed) {
				sendHost(
					`Opening the table: ${open.setup_prologue ? "The setup context records a prior meeting only when it contains an opening. In that case continue without repeating arrival, greeting or identity questions; otherwise begin the scene normally. No keys or money were granted. If pending_action exists, preserve that player request instead of asking for the same decision again; carry it forward through normal rules and state receipts, never claim unrecorded resources. Committed prologue: "+JSON.stringify(open.setup_prologue) : ""} this turn has no player input. Write all player-facing words in play_language=${table.playLanguage}. Use look to see the opening scene (lookup for background). Close with narrate and wait for free player input. NPC questions belong naturally in the prose. Do not generate story action menus or options. ` +
            (open.mod_context && mods ? `The opening may settle registered Mod first-contact checks and define/place new objects when the fiction requires them; ordinary adventure actions wait for the player. Active Mod context: ${JSON.stringify(open.mod_context)}` : `Do not call apply or resolve before the first player turn; the only opening writes are ask and narrate.`),
					"opening",
				);
			}
		} catch (error) {
			const detail = errorText(error);
			startupError = `The kernel could not open the table: ${detail}`;
			await runtime?.close();
			runtime = undefined;
			table = undefined;
			if (ctx.hasUI) {
				// The table never opened, so its language may be unknown; the surface then reads the
				// language `content/languages.json` defaults to, and never guesses one from the message.
				let line = startupError;
				try {
					line = (await surface.words()).line("kernel_table_failed", { detail });
				} catch {
					/* an unreadable content root still owes the person the English message */
				}
				ctx.ui.notify(line, "error");
			}
		}
	});

	pi.on("session_shutdown", async () => {
		await shutdownKernel();
		sessionCtx = undefined;
	});

	// Keep player messages out of the host-driven opening/recovery loop. Pi's streaming
	// queue bypasses before_agent_start, so replay only after the run fully settles.
	const waitingInputs: Array<{ text: string; images?: ImageContent[] }> = [];
	pi.on("input", (event, ctx) => {
		if (setupMode || !table || ctx.isIdle()) return;
		waitingInputs.push({ text: event.text, images: event.images });
		return { action: "handled" };
	});
	pi.on("agent_settled", () => {
		if (!table || !CLOSED_STATES.has(table.state)) return;
		const next = waitingInputs.shift();
		if (next) pi.sendUserMessage([{ type: "text", text: next.text }, ...(next.images ?? [])]);
	});

	// ---- Turns ------------------------------------------------------------

	pi.on("before_agent_start", async (event) => {
		const state = table;
		if (!state) return;
		const text = event.prompt;
		const startedAt = new Date().toISOString();
		const began = Date.now();
		try {
			const result = await state.kernel.call<{ turn?: number; state?: TurnState; capsule?: unknown }>(
				"table.player_input",
				{ campaign: state.campaign, text },
			);
			state.turn = typeof result.turn === "number" ? result.turn : state.turn + 1;
			state.state = result.state ?? "open";
			state.callOrdinal = 0;
			state.mintedCallIds.clear();
			state.rejected.clear();
			state.callKeys.clear();
			state.renderedText = undefined;
			state.deliveryToolCallId = undefined;
			state.closedThisRun = false;
			state.steeredThisTurn = false;
			state.readingWait = false;
			state.deliveryFix = undefined;
			state.roundTrips = 0;
			state.attachments = [];
			await record({
				tool: "table.player_input",
				started_at: startedAt,
				ms: Date.now() - began,
				ok: true,
			});
			// Contract §13.9: the capsule enters the model context verbatim. Another extension that wants to
			// see it (the table display reads the director beat) takes it off the bus rather than parsing that
			// host message a second time, and never alters its JSON.
			pi.events.emit("coc:capsule", {
				campaign: state.campaign,
				turn: state.turn,
				capsule: result.capsule ?? {},
			});
			return {
				message: {
					customType: "coc-capsule",
					content: JSON.stringify(result.capsule ?? {}),
					display: false,
					details: { coc_host: true, turn: state.turn },
				},
			};
		} catch (error) {
			await record({
				tool: "table.player_input",
				started_at: startedAt,
				ms: Date.now() - began,
				ok: false,
				code: isKernelError(error) ? error.code : "internal",
			});
			return {
				message: {
					customType: "coc-host",
					content: `The kernel did not accept that player input: ${errorText(error)}`,
					display: false,
					details: { coc_host: true, kind: "player-input-failed" },
				},
			};
		}
	});

	pi.on("agent_start", async () => {
		if (table) table.closedThisRun = false;
	});

	pi.on("turn_start", async () => {
		if (table) table.roundTrips += 1;
	});

	pi.on("tool_call", async (event) => {
		const name = event.toolName;
		if (!COC_TOOL_NAMES.includes(name as never)) return;
		const input = event.input as Record<string, unknown>;
		normalizeToolInput(name, input);

		const state = table;
		if (!state) {
			return { block: true, reason: startupError ?? "the kernel is not up, so this table has not opened" };
		}
		if (state.closedThisRun) {
			await record({ tool: name, started_at: new Date().toISOString(), ok: false, code: "blocked", reason: TURN_CLOSED_REASON });
			return { block: true, reason: TURN_CLOSED_REASON };
		}
		if (state.readingWait && name !== "narrate") {
			return { block: true, reason: "Source reading is still pending. Use narrate with an honest preparation notice and return control without a story menu; do not start another query, narrate a result, or imply that the refused action or elapsed game time happened. A new player input can continue the existing reading." };
		}
		// The same call with the same parameters, resent unchanged: the kernel's answer will not change.
		// A Keeper once sent one set of parameters thirteen times and was refused every time; after two
		// refusals the third is blocked here, with the last error read back to it.
		const key = `${name}\u0000${JSON.stringify(input)}`;
		state.callKeys.set(event.toolCallId, key);
		const strikes = state.rejected.get(key);
		if (strikes && strikes.count >= 2) {
			const reason = `The kernel has refused these parameters ${strikes.count} times (${strikes.last}). Resending them unchanged will not give a different answer: change the parameters as the fix says, or take another approach.`;
			await record({ tool: name, started_at: new Date().toISOString(), ok: false, code: "blocked", reason });
			return { block: true, reason };
		}
		if (!WRITE_TOOLS.has(name)) return;

		// A session (combat, chase, sanity bout) is not a turn state: it leaves the turn in acting, so the
		// ask that hands a pending defence back to the player takes the ordinary road and is not blocked here.
		const openingNarrate = (name === "narrate" || name === "ask") && state.openingPending && state.state === "awaiting_player";
    const openingMod = mods && state.openingPending && state.state === "awaiting_player" && (
      (name === "resolve" && typeof (input.action as any)?.decision === "string") ||
      (name === "apply" && Array.isArray(input.effects) && input.effects.length > 0 && input.effects.every((e:any) => ["define","object","ability"].includes(e?.kind))));
		if (!openingNarrate && !openingMod && CLOSED_STATES.has(state.state)) {
			const reason =
				state.state === "asked"
					? "the turn was already handed to the player with ask; wait for the answer"
					: `the turn state is ${state.state}, so nothing may change state: wait for the player to speak, or use only look, lookup and recall`;
			await record({ tool: name, started_at: new Date().toISOString(), ok: false, code: "turn_state", reason });
			return { block: true, reason };
		}
		if (name === "ask" && !input.binds && state.pendingChoice?.for === "player" && state.pendingChoice.name) {
			// Contract §11.9: when the Keeper leaves binds out, fill it with the kernel's latest pending choice for the player.
			input.binds = state.pendingChoice.name;
		}
		state.mintedCallIds.set(event.toolCallId, mintCallId(state));
	});

	/** Entity names get whitespace normalisation; case is left to the kernel, which matches the names and aliases on the graph. */
	function normalizeToolInput(name: string, input: Record<string, unknown>): void {
		if (name === "look") {
			if (input.name !== undefined) input.name = normalizeName(input.name);
			return;
		}
		if (name === "resolve") {
			const action = input.action as Record<string, unknown> | undefined;
			if (!action) return;
			// actor may now be an NPC name too, and weapon/spell must match the graph and the equipment table (contract §11.1, §11.4).
			for (const key of ["actor", "target", "skill", "decision", "weapon", "spell"]) {
				if (action[key] !== undefined) action[key] = normalizeName(action[key]);
			}
			const choice = action.choice as Record<string, unknown> | undefined;
			if (choice) {
				for (const key of ["pending", "option"]) {
					if (choice[key] !== undefined) choice[key] = normalizeName(choice[key]);
				}
			}
			return;
		}
		if (name === "apply") {
			const effects = input.effects;
			if (!Array.isArray(effects)) return;
			for (const effect of effects) {
				if (!effect || typeof effect !== "object") continue;
				const row = effect as Record<string, unknown>;
				// item and cash (#19) also match by name on the graph and the rules table: to whom, from whom, which weapon, whose money.
				for (const key of ["to", "clue", "name", "from", "weapon", "subject"]) {
					if (row[key] !== undefined) row[key] = normalizeName(row[key]);
				}
			}
		}
	}

	pi.on("message_end", async (event) => {
		const state = table;
		if (!state || event.message.role !== "assistant") return;
		const blocks = (event.message.content ?? []) as Array<Record<string, unknown>>;
		const hasToolCalls = blocks.some((b) => b.type === "toolCall");
		if (hasToolCalls) {
			// An assistant message with tool calls keeps only the calls: the Keeper's process talk before a
			// call ("let me check the clues first") is not a line, and player-visible text comes only from
			// narrate and ask.
			const withoutText = blocks.filter((b) => b.type !== "text");
			if (withoutText.length !== blocks.length) {
				return { message: { ...event.message, content: withoutText } };
			}
			return;
		}
		let rendered = state.renderedText;
		if (rendered === undefined) {
			// The Keeper wrote his lines but never called narrate: that prose is the narration. The host closes
			// the turn for him, sending the prose verbatim through the play-language guard.
			const prose = blocks
				.filter((b) => b.type === "text" && typeof b.text === "string")
				.map((b) => String(b.text))
				.join("")
				.trim();
			const canClose = state.state === "open" || state.state === "acting"
				|| (state.state === "awaiting_player" && state.openingPending);
			if (!prose || !canClose || state.closedThisRun) return;
			if (state.readingWait) {
				state.deliveryFix = { kind: "reading-wait", text: "Source preparation is pending. Use narrate to explain the preparation wait briefly and await free input; do not offer story options." };
				return { message: { ...event.message, content: blocks.filter(block => block.type !== "text") } };
			}
			// The kernel left a pending choice for the player (a defence in combat) and the Keeper only wrote
			// narration: the turn owes an ask, and the question belongs to the Keeper. The kernel's own prompt
			// is English keeper-facing text (contract §16.1), so the host must not put it in front of the
			// player: drop this draft and let agent_end steer once. If the Keeper writes prose without an ask
			// a second time (the steer is spent), close with narrate rather than hang the turn — the pending
			// survives in the capsule and the next turn owes it again.
			const pending = state.pendingChoice;
			const owesAsk = pending?.for === "player" && Array.isArray(pending.options) && pending.options.length >= 2;
			if (owesAsk && !state.steeredThisTurn) {
				const kept = blocks.filter((block) => block.type !== "text");
				return { message: { ...event.message, content: kept } };
			}
			const tool = "narrate";
			const callId = mintCallId(state);
			const startedAt = new Date().toISOString();
			const began = Date.now();
			try {
				const params: Record<string, unknown> = { campaign: state.campaign, call_id: callId, text: prose };
				const result = (await state.kernel.call<Record<string, unknown>>(`table.${tool}`, params)) ?? {};
				applyToolSuccess(state, tool, "implicit", result);
				await record({ tool, call_id: callId, started_at: startedAt, ms: Date.now() - began, ok: true, implicit: true });
				await record({ tool, event: "turn-closed", round_trips: state.roundTrips, ok: true, implicit: true });
				rendered = asString(result.rendered_text);
			} catch (error) {
				const floor = floorDetail(error);
				await record({
					tool, call_id: callId, started_at: startedAt, ms: Date.now() - began, ok: false, implicit: true,
					code: isKernelError(error) ? error.code : "internal",
					...(floor ? { code_detail: floor } : {}),
				});
				// The kernel refused the delivery (none of the play_language script):
				// steer once with its own fix at agent_end rather than delivering, and the next run's
				// narrate closes the turn.
				if (floor) {
					state.deliveryFix = floorSteer(floor, error);
					// Player-visible text comes only from narrate and ask: prose the kernel refused is
					// not a delivery, so it is dropped from the record rather than left standing as one.
					const kept = blocks.filter((block) => block.type !== "text");
					return { message: { ...event.message, content: kept } };
				}
				return;
			}
			if (!rendered) return;
		}
		const next: Array<Record<string, unknown>> = [];
		let placed = false;
		for (const block of blocks) {
			if (block.type === "text") {
				if (!placed) {
					next.push({ type: "text", text: rendered });
					placed = true;
				}
				continue;
			}
			next.push(block);
		}
		if (!placed) next.push({ type: "text", text: rendered });

		state.renderedText = undefined;
		state.deliveryToolCallId = undefined;
		state.callOrdinal = 0;
		state.mintedCallIds.clear();
		state.rejected.clear();
		state.callKeys.clear();
		state.steeredThisTurn = false;
		state.deliveryFix = undefined;
		// The delivery replacement takes effect when this message is returned, and the lane queues behind it:
		// a zero-millisecond timer only runs after that.
		settleVerifier(state);
		return { message: { ...event.message, content: next } };
	});

	pi.on("before_provider_request", async (event, ctx) => {
		const payload = event.payload as {model?: string; reasoning?: {effort?: string}; reasoning_effort?: string};
		await record({lane: "provider-request", model: payload?.model, provider: ctx.model?.provider,
			reasoning_effort: payload?.reasoning?.effort ?? payload?.reasoning_effort ?? null});
	});

	pi.on("agent_end", async () => {
		const state = table;
		if (!state) return;
		// When the Keeper ends on the message that carried the narrate call there is no second assistant
		// message, and so no delivery replacement to wait for; this run ending is the lane's starting gun.
		// This is also the backstop for the accounting: a narrate-closed turn cannot leave this run
		// without a verifier row, even when the lane never ran (ticket #28).
		if (state.verifierOwed) settleVerifier(state);
		if (state.closedThisRun || state.renderedText) return;
		if (state.steeredThisTurn) return;
		// The kernel refused the implicit delivery: hand its own fix back, once.
		const deliveryFix = state.deliveryFix;
		state.deliveryFix = undefined;
		if (deliveryFix) {
			state.steeredThisTurn = true;
			sendHost(deliveryFix.text, deliveryFix.kind);
			return;
		}
		if (state.state !== "open" && state.state !== "acting") return;
		state.steeredThisTurn = true;
		// When a session has left a pending choice for the player (a defence in combat), the turn owes an ask, not a narrate.
		const pending = state.pendingChoice;
		if (pending?.for === "player") {
			sendHost(
				`The kernel is waiting for the player to choose: ${pending.prompt ?? pending.name ?? "the pending choice from the last adjudication"}. ` +
					`Use ask kind=mechanics with the available option identifiers and no prompt. The frontend renders the controls.`,
				"steer",
			);
			return;
		}
		sendHost("This turn is not closed yet: deliver it to the player with one narrate, or hand the choice back with one ask.", "steer");
	});
}
