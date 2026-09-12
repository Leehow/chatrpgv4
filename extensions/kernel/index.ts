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
import { adaptationService } from './adaptation.ts';
export { kernelCommand } from "../../runtime/host.ts";
import { cocHome, cocMode } from "../lanes/host.ts";
import { extensionSurface } from "../ui/words.ts";
import { type KernelClient, KernelError, type KernelProgressFrame, isKernelError } from "./client.ts";
import { progressPartial } from "./progress.ts";
import { COC_TOOLS, COC_TOOL_NAMES, type CocToolSpec, WRITE_TOOLS } from "./tools.ts";
import { type CommitPayload, runVerifierLane } from "./verifier.ts";
import {
	type AdmissionContext,
	type AdmissionVerdict,
	ADMITTING_VERDICTS,
	admissionRefusal,
	admissionRequest,
	admissionUnavailable,
	keyDigest,
	reviewAdmission,
} from "./admission.ts";

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
	/**
	 * COC tool calls the Keeper attempted this turn, refused ones included (turn floor, D4). A turn
	 * that ends on prose with none is steered once toward the capsule before the host closes it.
	 */
	toolCallsThisTurn: number;
	/** The prose the floor steer dropped; if the second leg brings no prose and no narrate, this closes the turn as before. */
	floorDraft?: string;
	readingWait?: boolean;
	/** A host note owed to the Keeper at agent_end rather than delivered as prose (the reading wait). */
	deliveryFix?: { kind: string; text: string };
	/** A review operation stopped; only genuine new player input can start a linked retry. */
	reviewUnavailable?: string;
	roundTrips: number;
	mintedCallIds: Map<string, string>;
	/** Calls the kernel rejected this turn: key of name+params to a count and the last error. Blocked on the third identical resend. */
	rejected: Map<string, { count: number; last: string }>;
	/** toolCallId to the key above; tool_result counts against it. */
	callKeys: Map<string, string>;
	/**
	 * Refusals this turn by class — tool, error code and the structural field the kernel named (turn_of,
	 * needs.field, reason) — however the parameters were reworded. The third of a class shuts that tool for
	 * the rest of the turn; a turn with REFUSAL_BUDGET refusals in all shuts every write but narrate and ask.
	 * Table F (2026-09-11): twenty-eight refusals of two classes in one turn, the identical-resend guard never
	 * fired because every retry was reworded, and the turn ran to its 300 s cap.
	 */
	refusalClasses: Map<string, { count: number; last: string; round: number }>;
	refusalsThisTurn: number;
	/** toolCallId to the name of the tool it called, for the class accounting in tool_result. */
	callTools: Map<string, string>;
	/**
	 * toolCallId to the round trip that issued it, so a strike is an attempt and not a call.
	 *
	 * Table (2026-09-12): a Keeper opened Masks in Bar Cordano and asked for three first
	 * impressions -- Larkin, Mendoza, Elias -- in one message. All three were refused `not_here`
	 * (the people are staged in the turn they are met on an imported book), and because the three
	 * answers came back before the model saw any of them, the third one shut `resolve` for the
	 * turn. The Keeper staged all three correctly one call later and could no longer roll; the
	 * turn delivered three NPCs and no mechanics. The rule is "stop banging on the same wall", and
	 * a batch issued before the first answer arrived is one attempt, whoever it names.
	 */
	callRounds: Map<string, number>;
	/** Tools shut for the rest of the turn by the refusal budget, with the reason read back to the Keeper. */
	exhausted: Map<string, string>;
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
	/** The exact current player text (contract §32.3); a turn with none — the opening — puts nothing to review. */
	playerText?: string;
	party: Array<{ name: string; occupation?: string }>;
	/** The scene underfoot as the player knows it; a `move` to it is a rename and is not reviewed. */
	scene?: { handle?: string; label?: string };
	present: string[];
	prologue?: string;
	/**
	 * Earlier deliveries as the player saw them (the last four), the review's player-visible
	 * context. After a restart the host has none, and the capsule's `recent` heads stand in.
	 */
	delivered: Array<{ turn: number | string; player?: string | null; keeper: string }>;
	recent: Array<{ turn: number | string; player?: string | null; keeper: string }>;
	/** Verdicts by proposal key (contract §32.4): valid for this turn only, cleared with the next player input. */
	admission: Map<string, AdmissionVerdict>;
	admissionRefused: string[];
	/** What this turn has already settled through the kernel, one line each, so an entailed step is visible as such. */
	landed: string[];
	/** The options of the `ask` that closed the last turn, and, once the next input arrives, the ones this turn answers (contract §32.1). */
	lastAsk?: string[];
	answering?: string[];
}

const CLOSED_STATES: ReadonlySet<TurnState> = new Set<TurnState>(["awaiting_player", "committed", "asked"]);
const TURN_CLOSED_REASON = "the turn is closed, waiting for the player";
/** Refusals of one class (tool, code, the field the kernel named) a turn tolerates before that tool is shut for the turn. */
const REFUSAL_CLASS_LIMIT = 3;
/** Refusals of any class a turn tolerates before every write but narrate and ask is shut. */
const REFUSAL_BUDGET = 8;
/** The one host steer of the turn floor (docs/specs/turn-floor.md D4), sent when a turn is about to close on prose alone. */
const FLOOR_STEER =
	"This turn used no tool and nothing landed. Read director.offer and the people present: what changes in the world, apply; " +
	"what is uncertain, resolve. Then take up the player's words from the world's view, let the world answer, give someone " +
	"present a line in their own voice, and hand the move back to the player. Close with narrate.";

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
/** When the Keeper's current provider request went out, so `message_end` can time the whole call (§12.8.1). */
let providerRequestAt: number | undefined;
/** When the previous leg of this run finished, for the case where the provider hook does not run. */
let legMark: number | undefined;
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

/** The `details.<key>` names a `fix` text refers to, in the order it names them, each once. A deeper path names its first segment. */
function namedDetailKeys(fix: string | undefined): string[] {
	const keys: string[] = [];
	for (const match of (fix ?? "").matchAll(/\bdetails\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
		if (!keys.includes(match[1])) keys.push(match[1]);
	}
	return keys;
}

/** How much of one named value goes to the model on a single line. */
const NAMED_DETAIL_LIMIT = 2_000;

/** One line of compact JSON for a value the `fix` named. A long list is cut at an element and says what it left out; nothing is dropped silently. */
function namedDetailLine(key: string, value: unknown): string {
	const whole = JSON.stringify(value);
	if (whole.length <= NAMED_DETAIL_LIMIT) return `${key}: ${whole}`;
	if (Array.isArray(value)) {
		const kept: unknown[] = [];
		let size = 2;
		for (const item of value) {
			const piece = JSON.stringify(item).length + 1;
			if (size + piece > NAMED_DETAIL_LIMIT) break;
			kept.push(item);
			size += piece;
		}
		return `${key}: ${JSON.stringify(kept)} (${value.length - kept.length} more not shown)`;
	}
	return `${key}: ${whole.slice(0, NAMED_DETAIL_LIMIT)} (cut)`;
}

/**
 * `details` reaches only the extension and the interface; the model sees the tool result body.
 * So the options of a `needs` and the candidates of a `needs_choice` must land in that body,
 * or the Keeper is told there are candidates while unable to see them and cannot fill in a
 * decision (contract §11.3).
 *
 * The bespoke lines below cover the keys that have a shape of their own. Everything else the
 * `fix` text names (`details.<key>`) is rendered as a line of its own (contract §8, #66):
 * the producer chose what travels by naming it, and a list here would only be a second copy
 * of that choice to keep in step -- the copy that, for `details.read`, was never made.
 */
function errorDetailLines(details: Record<string, unknown> | undefined, fix?: string): string[] {
	if (!details) return [];
	const lines: string[] = [];
	const rendered = new Set<string>();
	const needs = details.needs as { field?: string; options?: unknown[] } | undefined;
	if (needs?.field) {
		const options = (needs.options ?? []).map((option) => String(option)).join(", ");
		lines.push(options ? `missing ${needs.field}, one of: ${options}` : `missing ${needs.field}`);
		rendered.add("needs");
	}
	const candidates = details.candidates;
	if (Array.isArray(candidates) && candidates.length > 0) {
		rendered.add("candidates");
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
		rendered.add("conflicts");
	}
	const exits = details.exits;
	if (Array.isArray(exits) && exits.length > 0) {
		lines.push(`reachable: ${exits.map((exit) => (typeof exit === "string" ? exit : JSON.stringify(exit))).join(", ")}`);
		rendered.add("exits");
	}
	const fields = details.fields;
	if (Array.isArray(fields) && fields.length > 0) {
		// A refusal that names the player-facing fields it is about: the kernel's own list, passed on.
		lines.push(`rewrite in the campaign's play_language: ${fields.map((field) => String(field)).join(", ")}`);
		rendered.add("fields");
	}
	// An agent that ran out of time is not the same refusal as one that died: the first says the work
	// asked of it was too much to retry unchanged, and `fix` alone cannot say which. What to do about
	// it depends on which agent it was -- a creator is told to ask for fewer definitions, and telling
	// an auditor's turn the same thing sends the Keeper to trim `define` effects it never had.
	if (details.reason === "mod_agent_failed") {
		const role = typeof details.role === "string" ? details.role : "";
		lines.push(details.timed_out !== true
			? "the work already accepted is retained, so the retry resumes from where this one stopped"
			: role === "create"
				? "the definition agent ran out of time: retry with fewer define effects in this apply"
				: role === "audit"
					? "the audit agent ran out of time: this delivery was not audited, and nothing about it needs changing to retry"
					: "the Mod agent ran out of time: retry the same request to resume its retained job");
	}
	if (details.reason === "mod_narrative_repair") {
		// The Mod audit already validates these lists; preserve its semantic repair verbatim.
		lines.push(`mod repair: ${JSON.stringify({
			missing: Array.isArray(details.missing) ? details.missing : [],
			findings: Array.isArray(details.findings) ? details.findings : [],
			...(details.source_review ? {source_review: details.source_review} : {}),
			...(details.continuity_review ? {continuity_review: details.continuity_review} : {}),
		})}`);
		rendered.add("missing");
		rendered.add("findings");
		rendered.add("source_review");
		rendered.add("continuity_review");
	}
	for (const key of namedDetailKeys(fix)) {
		if (rendered.has(key) || details[key] === undefined) continue;
		lines.push(namedDetailLine(key, details[key]));
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
	return [error.toToolText(), ...errorDetailLines(error.details, error.fix)].join("\n");
}

/**
 * The narrower reason a kernel refusal carries, for telemetry (contract §1: `code_detail` is an
 * authored refinement of `code`, not a judgement made here). It is read from every place it can
 * travel, because one contract field arrives under two spellings across the RPC boundary.
 *
 * There is no floor under a delivery any more. The kernel never looks for a receipt's numbers in
 * the prose (2026-09-09), and since §23 of the same day it no longer looks for the play language's
 * script either: an open tag set has no character class to check, so `play_language_mismatch` is
 * the verifier lane's advisory finding and never a refusal this loop has to answer. What is left
 * here is a record of what the kernel said, not a reason to steer the Keeper.
 */
function refusalDetail(error: unknown): string | undefined {
	if (!isKernelError(error)) return undefined;
	const detail = error.codeDetail ?? (error.details as { code_detail?: unknown } | undefined)?.code_detail;
	return typeof detail === "string" && detail ? detail : undefined;
}

/**
 * A refusal that waited on source reading says which job and which target it waited for
 * (contract §22, #65): the queue's `job_id` and the `purpose`/`focus` of the read, whichever
 * verb was refused. Ids and names only -- the read's `question` is the Keeper's prose and stays out.
 */
function readingRefusalTelemetry(error: unknown): Record<string, unknown> {
	if (!isKernelError(error) || !error.details) return {};
	const jobId = asString(error.details.job_id);
	const read = error.details.read as { purpose?: unknown; focus?: unknown } | undefined;
	const purpose = asString(read?.purpose);
	const focus = asString(read?.focus);
	return {
		...(jobId ? { job_id: jobId } : {}),
		...(purpose ? { read_purpose: purpose } : {}),
		...(focus ? { read_focus: focus } : {}),
	};
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
    let adaptations: ReturnType<typeof adaptationService> | undefined;
  let mods: {prepare(method: string, payload: Record<string, any>, signal?: AbortSignal): Promise<void>;
    after?(method: string, payload: Record<string, any>, signal?: AbortSignal): Promise<void>} | undefined;
  pi.events.on("coc:mods-bridge", value => { mods = value as typeof mods; });
	// A background projection has written this tag's captions (contract §23): drop the authored
	// words this extension was standing on, so the next line it notifies with is the player's.
	pi.events.on("coc:ui-words", (data) => { surface.refresh((data as { tag?: unknown } | undefined)?.tag); });
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
		table.refusalClasses.clear();
		table.refusalsThisTurn = 0;
		table.callTools.clear();
		table.callRounds.clear();
		table.exhausted.clear();
		table.renderedText = undefined;
		table.deliveryToolCallId = undefined;
		table.closedThisRun = false;
		table.steeredThisTurn = false;
		table.toolCallsThisTurn = 0;
		table.floorDraft = undefined;
		table.deliveryFix = undefined;
		table.attachments = [];
		// Action admission (contract §32.3): who plays, where they stand, what the setup already told
		// them, and — on a recovered turn — the words the broken turn was answering.
		table.party = (open.investigators ?? []).flatMap((sheet) => {
			const name = asString(sheet.name);
			const occupation = asString(sheet.occupation);
			return name ? [{ name, ...(occupation ? { occupation } : {}) }] : [];
		});
		table.scene = { ...(asString(open.scene?.name) ? { handle: asString(open.scene?.name) } : {}),
			...(asString(open.scene?.display_name) ? { label: asString(open.scene?.display_name) } : {}) };
		table.prologue = asString(open.setup_prologue);
		table.playerText = asString(open.pending_turn?.player_text);
		table.admission = new Map();
		table.admissionRefused = [];
		table.landed = [];
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

	// ---- Action admission (contract §32) ------------------------------------

	/** What the capsule says the player can see: the scene's name, who is on stage, who plays, and the recent exchange. */
	function noteCapsule(state: TableState, capsule: unknown): void {
		if (!capsule || typeof capsule !== "object") return;
		const view = capsule as { where?: Record<string, unknown>; present?: unknown; known?: { investigator?: Record<string, unknown> }; recent?: unknown };
		const handle = asString(view.where?.scene);
		const label = asString(view.where?.display_name);
		if (handle || label) state.scene = { ...(handle ? { handle } : {}), ...(label ? { label } : {}) };
		if (Array.isArray(view.present)) {
			state.present = view.present.flatMap((row) => {
				const name = asString((row as Record<string, unknown> | null)?.name);
				return name ? [name] : [];
			});
		}
		const sheet = view.known?.investigator;
		const name = asString(sheet?.name);
		if (name && !state.party.some((member) => member.name === name)) {
			const occupation = asString(sheet?.occupation);
			state.party.push({ name, ...(occupation ? { occupation } : {}) });
		}
		if (Array.isArray(view.recent)) {
			state.recent = view.recent.flatMap((row) => {
				const entry = row as Record<string, unknown> | null;
				const keeper = asString(entry?.keeper);
				if (!keeper) return [];
				const turn = typeof entry?.turn === "number" ? entry.turn : asString(entry?.turn) ?? "?";
				return [{ turn, player: asString(entry?.player) ?? null, keeper }];
			});
		}
	}

	/** One line per settled call, for the review's "already settled this turn" list. */
	function noteLanded(state: TableState, tool: string, result: Record<string, unknown>): void {
		if (tool === "resolve") {
			const outcome = asString((result.outcome as { kind?: unknown } | undefined)?.kind);
			state.landed.push(`resolve settled${outcome ? ` (${outcome})` : ""}`);
			return;
		}
		if (tool === "apply") {
			const receipts = Array.isArray(result.receipts) ? result.receipts.map(String) : [];
			state.landed.push(`apply landed: ${receipts.length ? receipts.join(", ") : "receipts"}`);
			const world = result.world as { active_scene?: unknown } | undefined;
			const scene = asString(world?.active_scene);
			if (scene && scene !== state.scene?.handle) state.scene = { handle: scene };
		}
	}

	/** A delivery joins the player-visible window the next review reads. */
	function noteDelivered(state: TableState, result: Record<string, unknown>): void {
		const keeper = asString(result.rendered_text);
		if (!keeper) return;
		const turn = typeof result.turn === "number" ? result.turn : state.turn;
		state.delivered.push({ turn, player: state.playerText ?? null, keeper });
		while (state.delivered.length > 4) state.delivered.shift();
	}

	/**
	 * Put a `resolve` or `apply` to review before it reaches a Mod hook or the kernel, and throw
	 * the refusal the Keeper reads when it is not admitted. A call that is not a proposed voluntary
	 * investigator action goes straight on; the opening turn, which has no player words, puts
	 * nothing to review and says so in telemetry. A verdict already given this turn for the same
	 * proposal is reused, admitting and refusing alike (contract §32.4).
	 */
	async function admitAction(state: TableState, tool: "resolve" | "apply", payload: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
		const proposal = admissionRequest(tool, payload, { party: state.party.map((member) => member.name), scene: state.scene, ...(state.answering ? { answered: state.answering } : {}) });
		if (!proposal) return;
		const digest = keyDigest(proposal.key);
		// Lane rows name the verb as `verb`: `tool` is the tool-call row's own column, and readers
		// (kpi.py, the tests) find a verb's call row by it.
		if (!state.playerText) {
			await record({ lane: "admission", verb: tool, ok: true, skipped: "no_player_text", key: digest });
			return;
		}
		const settle = async (verdict: AdmissionVerdict, reused: boolean, ms: number, model?: string): Promise<void> => {
			state.admission.set(proposal.key, verdict);
			const admitted = ADMITTING_VERDICTS.has(verdict.verdict);
			await record({ lane: "admission", verb: tool, ok: true, verdict: verdict.verdict, admitted, reused, ms, key: digest, ...(model ? { model } : {}) });
			if (admitted) return;
			state.admissionRefused.push(`${proposal.lines.join(" | ")} -> ${verdict.verdict}${verdict.missing ? `: ${verdict.missing}` : ""}`);
			throw admissionRefusal(proposal, verdict);
		};
		const remembered = state.admission.get(proposal.key);
		if (remembered) return settle(remembered, true, 0);
		const ctx = sessionCtx;
		if (!ctx) {
			await record({ lane: "admission", verb: tool, ok: false, reason: "session_gone", key: digest });
			throw admissionUnavailable(proposal, "session_gone", "the session was gone before the review could start");
		}
		const context: AdmissionContext = {
			turn: state.turn,
			playerText: state.playerText,
			investigators: state.party,
			...(state.scene?.label ?? state.scene?.handle ? { scene: state.scene.label ?? state.scene.handle } : {}),
			present: state.present,
			delivered: [
				...(state.prologue ? [{ turn: "setup", keeper: state.prologue }] : []),
				...(state.delivered.length ? state.delivered : state.recent),
			],
			landed: state.landed,
			refused: state.admissionRefused,
		};
		const outcome = await reviewAdmission({ ctx, proposal, context, record: (row) => record({ verb: tool, ...row }), ...(signal ? { signal } : {}) });
		if (!outcome.ok) {
			await record({ lane: "admission", verb: tool, ok: false, reason: outcome.reason, detail: outcome.detail.slice(0, 200), ms: outcome.ms, key: digest, ...(outcome.model ? { model: outcome.model } : {}) });
			throw admissionUnavailable(proposal, outcome.reason, outcome.detail);
		}
		await settle(outcome.verdict, false, outcome.ms, outcome.model);
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
				noteLanded(state, tool, result);
				break;
			case "apply": {
				state.state = "acting";
				noteLanded(state, tool, result);
				if (readingModule && Array.isArray(result.deepen_queued) && result.deepen_queued.length)
					pi.events.emit("coc:source-work-queued", {campaign:state.campaign,module_id:readingModule});
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
				{
					const interaction = result.interaction as { options?: unknown } | undefined;
					const options = Array.isArray(interaction?.options) ? interaction.options : Array.isArray(result.options) ? result.options : undefined;
					if (options) state.lastAsk = options.map(String);
				}
				state.openingPending = false;
				// The pending choice has been handed back to the player, so the turn no longer owes an ask.
				state.pendingChoice = null;
				state.closedThisRun = true;
				state.renderedText = typeof result.rendered_text === "string" ? result.rendered_text : undefined;
				state.deliveryToolCallId = toolCallId;
				noteDelivered(state, result);
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
				noteDelivered(state, result);
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
	function pauseReview(state: TableState, error: unknown): void {
		const cause = isKernelError(error) ? String(error.details?.cause ?? error.message) : String(error);
		state.reviewUnavailable = cause; state.deliveryFix = undefined; state.floorDraft = undefined;
		const status = {campaign: state.campaign, turn: state.turn, status: 'unavailable', cause};
		pi.appendEntry('coc-review-status', status);
		pi.events.emit('coc:review-status', status);
	}

	async function runTool(
		spec: CocToolSpec,
		toolCallId: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<Record<string, unknown>>,
	): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown>; terminate?: boolean }> {
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
			if (state.reviewUnavailable) throw new KernelError({code: 'needs', message: 'The review is paused until new player input',
				details: {reason: 'continuity_review_unavailable', cause: state.reviewUnavailable}});
			if (spec.name === "lookup" && params.kind === "source") {
				if (!asString(params.query)?.trim()) throw new KernelError({
					code: "invalid_params", message: "Source lookup needs a named query; question supplies additional scope",
					fix: "pass the place or entity as query and describe the unresolved source question" });
				if (!reading || !readingModule) throw new KernelError({ code: "needs", message: "the source reading service is unavailable",
					fix: "reopen the table with its module reading extension available", details: { reason: "reading_failed" } });
				await reading.ensure(readingModule, { purpose: "detail", focus: params.query,
					question: params.question ?? "", retry: params.retry === true, foreground: true }, signal);
				payload.kind = "module";
                payload.canonical_source = true;
			}
			let result: Record<string, unknown>;
			// Action admission (contract §32) runs ahead of every Mod hook and of the kernel: a refused
			// proposal pays for no definition agent and reaches no transaction.
			if (spec.name === "resolve" || spec.name === "apply") await admitAction(state, spec.name, payload, signal);
      if (mods) {
        if (Array.isArray(payload.effects)) payload.effects = payload.effects.map(effect => ({...(effect as Record<string, unknown>)}));
        await mods.prepare(spec.name, payload, signal);
      }
			try {
                if (spec.name === 'lookup' && params.kind === 'adaptation') {
                    if (!runtime) throw new KernelError({code: 'needs', message: 'The adaptation runtime is unavailable'});
                    adaptations ??= adaptationService(runtime, (method, args) => state.kernel.call(method, args), () => ({
                        name: process.env.PI_COC_ADAPTATION_MODEL || `${sessionCtx?.model?.provider}/${sessionCtx?.model?.id}`, thinking: pi.getThinkingLevel()
                    }));
                    result = await adaptations.lookup(payload, signal);
                } else result = (await state.kernel.call<Record<string, unknown>>(spec.method, payload, onProgress)) ?? {};
            }
			catch (failure) {
				if (!(isKernelError(failure)) || failure.details?.reason !== "material_pending" || !reading || !readingModule) throw failure;
				await reading.ensure(readingModule, { ...(failure.details.read as Record<string, unknown>), foreground: true }, signal);
				result = (await state.kernel.call<Record<string, unknown>>(spec.method, payload, onProgress)) ?? {};
			}
			// Deferred Mod bookkeeping completes after the verb that opened this turn, never before it.
			if (mods?.after) await mods.after(spec.name, payload, signal);
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
			const detail = refusalDetail(error);
			// `code` alone collapses every refusal of one family into one word. The kernel's own
			// `reason` is a closed authored field, and without it a failure lane cannot tell a
			// definition agent that died from a batch the Keeper simply got wrong.
			const reason = asString((error as { details?: { reason?: unknown } })?.details?.reason);
			if (reason === 'continuity_review_unavailable') pauseReview(state, error);
			await record({
				tool: spec.name,
				call_id: payload.call_id ?? null,
				started_at: startedAt,
				ms: Date.now() - began,
				ok: false,
				code,
				...(reason ? { reason } : {}),
				...(detail ? { code_detail: detail } : {}),
				...readingRefusalTelemetry(error),
			});
			return {
				content: [{ type: "text", text: errorText(error) }],
				...(state.reviewUnavailable ? {terminate: true} : {}),
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
		const last = `${String(details.coc_error.code ?? "error")}: ${String(details.coc_error.message ?? "")}`.slice(0, 160);
		if (state && key) {
			const previous = state.rejected.get(key);
			state.rejected.set(key, { count: (previous?.count ?? 0) + 1, last });
		}
		// The refusal budget (contract §34.12): count by class, not by parameters.
		const tool = state?.callTools.get(event.toolCallId);
		if (state && tool) {
			const inner = (details.coc_error as { details?: Record<string, unknown> }).details ?? {};
			const needs = (inner.needs as { field?: unknown } | undefined)?.field;
			const facet = [inner.turn_of, needs, inner.reason, inner.field].find((v) => typeof v === "string" && v) ?? "";
			const cls = `${tool}\u0000${String(details.coc_error.code ?? "error")}\u0000${String(facet)}`;
			// A strike is an attempt, not a call. Calls a Keeper issued in one message are answered
			// after it wrote them, so the second and third of a batch are not it ignoring the first
			// refusal -- it never saw one. Count the round trip that issued the call, and let a class
			// take at most one strike per round; the refusal is still recorded and still read back.
			const previous = state.refusalClasses.get(cls);
			const round = state.callRounds.get(event.toolCallId) ?? state.roundTrips;
			const batched = previous !== undefined && previous.round === round;
			const count = (previous?.count ?? 0) + (batched ? 0 : 1);
			state.refusalClasses.set(cls, { count, last, round });
			state.refusalsThisTurn += 1;
			const closing = "Nothing refused has happened. Stop trying it: close the turn with narrate on what landed with a receipt, or hand the player the pending choice with ask.";
			if (count >= REFUSAL_CLASS_LIMIT && !state.exhausted.has(tool) && !["narrate", "ask"].includes(tool)) {
				state.exhausted.set(tool, `${tool} has been refused ${count} times this turn for the same reason (${last}). ${closing}`);
				await record({ lane: "refusals", turn: state.turn, tool, count, reason: "class_limit", last });
			}
			if (state.refusalsThisTurn >= REFUSAL_BUDGET) {
				for (const name of ["resolve", "apply", "look", "lookup", "recall"])
					if (!state.exhausted.has(name))
						state.exhausted.set(name, `${state.refusalsThisTurn} refusals this turn. ${closing}`);
				await record({ lane: "refusals", turn: state.turn, count: state.refusalsThisTurn, reason: "turn_budget", last });
			}
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
		adaptations?.close(); adaptations = undefined;
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
				toolCallsThisTurn: 0,
				roundTrips: 0,
				mintedCallIds: new Map(),
				rejected: new Map(),
				callKeys: new Map(),
				refusalClasses: new Map(),
				refusalsThisTurn: 0,
				callTools: new Map(),
				callRounds: new Map(),
				exhausted: new Map(),
				attachments: [],
				lanes: new AbortController(),
				party: [],
				present: [],
				delivered: [],
				recent: [],
				admission: new Map(),
				admissionRefused: [],
				landed: [],
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
				// The call ordinal lives here, so anything that has to write on the Keeper's behalf mints its
				// id here too instead of inventing one the kernel refuses -- and never reuses a live ordinal,
				// which the kernel would read as a replay and answer with somebody else's result.
				mintCallId: () => (table ? mintCallId(table) : undefined),
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
		if (!table || (!CLOSED_STATES.has(table.state) && !table.reviewUnavailable)) return;
		const next = waitingInputs.shift();
		if (next) pi.sendUserMessage([{ type: "text", text: next.text }, ...(next.images ?? [])]);
	});

	// ---- Turns ------------------------------------------------------------

	pi.on("before_agent_start", async (event) => {
		const state = table;
		if (!state) return;
		state.reviewUnavailable = undefined;
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
			state.refusalClasses.clear();
			state.refusalsThisTurn = 0;
			state.callTools.clear();
			state.callRounds.clear();
			state.exhausted.clear();
			state.renderedText = undefined;
			state.deliveryToolCallId = undefined;
			state.closedThisRun = false;
			state.steeredThisTurn = false;
			state.toolCallsThisTurn = 0;
			state.floorDraft = undefined;
			state.readingWait = false;
			state.deliveryFix = undefined;
			state.roundTrips = 0;
			state.attachments = [];
			// A new player input is a new context (contract §32.4): no verdict outlives it.
			state.playerText = text;
			state.admission = new Map();
			state.admissionRefused = [];
			state.landed = [];
			// This input answers the ask that closed the last turn, if one did: a resolve settling one
			// of its options is the player's own answer and is not put to review.
			state.answering = state.lastAsk;
			state.lastAsk = undefined;
			noteCapsule(state, result.capsule);
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
		state.toolCallsThisTurn += 1;
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
		state.callTools.set(event.toolCallId, name);
		state.callRounds.set(event.toolCallId, state.roundTrips);
		const shut = state.exhausted.get(name);
		if (shut) {
			await record({ tool: name, started_at: new Date().toISOString(), ok: false, code: "blocked", reason: "refusal_budget" });
			return { block: true, reason: shut };
		}
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
		// How long the Keeper's own call actually took. The two rows above bracket the request and the
		// arrival of its headers, and neither carries a duration, so a turn with a six-minute hole in it
		// could not be attributed to the model, the host or anything else -- the evidence simply was not
		// kept (contract §12.8.1). A lane call records four phases and its `ms`; the Keeper's recorded
		// two and none. This row closes that: request assembled to message complete, which is the whole
		// call including the body stream, against the tool rows that already time everything else.
		if (event.message?.role === "assistant") {
			const now = Date.now();
			// `request` when the provider hook ran (the whole call, body stream included); `previous`
			// when it did not, which times this leg from whatever finished last. Either way a turn is
			// now partitioned: these legs plus the tool rows account for it, and a hole in one of them
			// is a hole somebody can point at.
			const from = providerRequestAt !== undefined ? "request" : "previous";
			const mark = providerRequestAt ?? legMark;
			providerRequestAt = undefined;
			legMark = now;
			const blocks = (event.message.content ?? []) as Array<{type?: string}>;
			void record({lane: "provider-call", at: new Date().toISOString(), from,
				ms: mark === undefined ? null : now - mark,
				stop_reason: (event.message as {stopReason?: string}).stopReason ?? null,
				blocks: blocks.map((block) => block?.type ?? "?")});
		}
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
			if (state.reviewUnavailable) return {message: {...event.message, content: blocks.filter(block => block.type !== 'text')}};
			// The Keeper wrote his lines but never called narrate: that prose is the narration. The host closes
			// the turn for him, sending the prose verbatim through the play-language guard.
			const written = blocks
				.filter((b) => b.type === "text" && typeof b.text === "string")
				.map((b) => String(b.text))
				.join("")
				.trim();
			// The floor steer is additive: a second leg that brings nothing falls back to the draft it dropped.
			const prose = written || (state.steeredThisTurn && state.floorDraft) || "";
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
			// Turn floor (docs/specs/turn-floor.md D4): the Keeper wrote prose and called no tool at all this
			// turn. Once, the host drops that draft and steers it back to the capsule; whatever the second leg
			// brings is honoured, an explicit narrate or prose closed implicitly as before. The opening is
			// exempt (it has its own instruction), and so is any turn in which a tool was tried, refused or not.
			const opening = state.state === "awaiting_player" && state.openingPending;
			if (state.toolCallsThisTurn === 0 && !opening && !state.steeredThisTurn) {
				state.floorDraft = prose;
				state.deliveryFix = { kind: "floor", text: FLOOR_STEER };
				await record({ lane: "floor", turn: state.turn, steered: true, round_trips: state.roundTrips });
				return { message: { ...event.message, content: blocks.filter((block) => block.type !== "text") } };
			}
			const tool = "narrate";
			const callId = mintCallId(state);
			const startedAt = new Date().toISOString();
			const began = Date.now();
			try {
				const params: Record<string, unknown> = { campaign: state.campaign, call_id: callId, text: prose, implicit: true };
				await mods?.prepare(tool, params, state.lanes.signal);
				const result = (await state.kernel.call<Record<string, unknown>>(`table.${tool}`, params)) ?? {};
				applyToolSuccess(state, tool, "implicit", result);
				await record({ tool, call_id: callId, started_at: startedAt, ms: Date.now() - began, ok: true, implicit: true });
				await record({ tool, event: "turn-closed", round_trips: state.roundTrips, ok: true, implicit: true });
				rendered = asString(result.rendered_text);
			} catch (error) {
				const detail = refusalDetail(error);
				await record({
					tool, call_id: callId, started_at: startedAt, ms: Date.now() - began, ok: false, implicit: true,
					code: isKernelError(error) ? error.code : "internal",
					...(detail ? { code_detail: detail } : {}),
				});
				state.floorDraft = undefined;
				if (isKernelError(error) && error.details?.reason === 'continuity_review_unavailable') {
					pauseReview(state, error);
					return {message: {...event.message, content: blocks.filter(block => block.type !== 'text')}};
				}
				state.deliveryFix = {kind: "audit-repair", text: `This draft was not delivered. ${isKernelError(error) ? error.message : "Delivery preparation failed"}. ` +
					`${isKernelError(error) ? error.fix ?? "" : ""} ${isKernelError(error) ? JSON.stringify(error.details ?? {}).slice(0, 8000) : detail ?? ""} Keep settled actions; repair with narrate, without rerolling or inventing a reconciliation.`};
				return {message: {...event.message, content: blocks.filter(block => block.type !== "text")}};
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
		state.floorDraft = undefined;
		state.deliveryFix = undefined;
		// The delivery replacement takes effect when this message is returned, and the lane queues behind it:
		// a zero-millisecond timer only runs after that.
		settleVerifier(state);
		return { message: { ...event.message, content: next } };
	});

	pi.on("agent_start", async () => { legMark = Date.now(); });
	pi.on("before_provider_request", async (event, ctx) => {
		const payload = event.payload as {model?: string; reasoning?: {effort?: string}; reasoning_effort?: string};
		providerRequestAt = Date.now();
		await record({lane: "provider-request", at: new Date().toISOString(), model: payload?.model, provider: ctx.model?.provider,
			reasoning_effort: payload?.reasoning?.effort ?? payload?.reasoning_effort ?? null});
	});
	pi.on("after_provider_response", async (event, ctx) => {
		const requestId = Object.entries(event.headers).find(([name]) => ["x-request-id", "request-id"].includes(name.toLowerCase()))?.[1];
		await record({lane: "provider-response", at: new Date().toISOString(), provider: ctx.model?.provider,
			status: event.status, ...(requestId ? {request_id: requestId} : {})});
	});

	pi.on("agent_end", async () => {
		const state = table;
		if (!state) return;
		// When the Keeper ends on the message that carried the narrate call there is no second assistant
		// message, and so no delivery replacement to wait for; this run ending is the lane's starting gun.
		// This is also the backstop for the accounting: a narrate-closed turn cannot leave this run
		// without a verifier row, even when the lane never ran (ticket #28).
		//
		// It is the backstop for the delivery itself, too. The replacement waits for a following
		// assistant message, and a Keeper that stops on the tool call never writes one: the kernel had
		// rendered the prose, and the player was shown nothing (`probe-willing` turn 1, one turn in the
		// 445 on disk). PipiCOC reads the delivery off the `narrate` result and never saw the gap; a
		// terminal reads the assistant message, and saw silence. Pi gives an extension no way to add an
		// assistant message, so the words go out as a displayed message of their own rather than not at
		// all, and the row says it happened (contract §8, §32.9).
		//
		// The seam suite cannot reach this branch: its faux provider always answers once more, and that
		// answer is somewhere for the replacement to land. The guard is what keeps it inert everywhere
		// else -- `renderedText` is undefined by this point on every turn the replacement did run -- and
		// the telemetry row is how a run that takes this path says so.
		const undelivered = state.renderedText;
		if (undelivered !== undefined) {
			state.renderedText = undefined;
			state.deliveryToolCallId = undefined;
			pi.sendMessage({ customType: "coc-delivery", content: undelivered, display: true, details: { coc_delivery: true, turn: state.turn } });
			void record({ lane: "delivery", turn: state.turn, ok: true, reason: "placed_by_host",
				detail: "the Keeper ended on the message carrying the call, so the replacement had nowhere to land" });
		}
		if (state.verifierOwed) settleVerifier(state);
		if (state.closedThisRun || state.renderedText) return;
		if (state.reviewUnavailable) return;
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
