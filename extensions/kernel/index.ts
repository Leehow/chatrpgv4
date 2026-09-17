/**
 * The pi-coc kernel extension: it starts the Python kernel, wires the seven verbs onto RPC,
 * and mirrors the turn state machine on the extension side. Responsibilities in
 * docs/kernel-rpc.md §8.
 */

import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRuntime, type HostRuntime } from "../../runtime/host.ts";
import { adaptationService } from './adaptation.ts';
export { kernelCommand } from "../../runtime/host.ts";
import { cocHome, cocMode } from "../lanes/host.ts";
import { agentHomeOf, openingHelp } from "../ui/hints.ts";
import { extensionSurface } from "../ui/words.ts";
import { type KernelClient, KernelError, type KernelProgressFrame, isKernelError } from "./client.ts";
import { progressPartial } from "./progress.ts";
import { MAP_DOCUMENT_NONE, renderMapView, type MapAttachment } from './map-view.ts';
import { AUTHORED_MAP_WORDS, KEEPER_MAP_WORDS, mapCardTexts, type MapWordsOptions, prepareMapWords, projectMapCard, readMapWords } from '../module/map-presentation.ts';
import { COC_TOOLS, COC_TOOL_NAMES, type CocToolSpec, WRITE_TOOLS } from "./tools.ts";
import { RecallPages } from "./recall-pages.ts";
import { randomUUID } from "node:crypto";
import { type CommitPayload, runVerifierLane } from "./verifier.ts";
import {
	type AdmissionContext,
	type AdmissionDestination,
	type AdmissionVerdict,
	ADMITTING_VERDICTS,
	admissionRefusal,
	admissionRequest,
	admissionUnavailable,
	keyDigest,
	registeredDestination,
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
  /** Contract §39.2: the module's own map captions, for the host's play-language projection. Absent when the module publishes no player map. */
  authored_map_words?: unknown;
  /** Contract §28.9: packages on disk this kernel build cannot read, each naming what it asked for. */
  mods_unreadable?: Array<Record<string, unknown>>;
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
	recallPages: RecallPages;
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
	/**
	 * The turn a `narrate` or `ask` actually delivered (§86). Unlike `closedThisRun` this is a fact
	 * about the *turn*, so it survives the `agent_start` of a continuation run. It is what separates
	 * "the player has read this turn" from "this turn never opened": both are closed and both refuse
	 * every write, but only the first can have left the player holding something the host now has to
	 * correct, so only the first owes §34.17's and §78's notices.
	 */
	deliveredTurn?: number;
	/** The host cut this run itself (§34.16): pi never resends a cancellation, so no later leg is coming. */
	runCut: boolean;
	steeredThisTurn: boolean;
	/**
	 * COC tool calls the Keeper attempted this turn, refused ones included (turn floor, D4). A turn
	 * that ends on prose with none is steered once toward the capsule before the host closes it.
	 */
	toolCallsThisTurn: number;
	/** The Keeper tried a delivery (narrate or ask) this turn, refused or not: a repair flow owns the turn from there, and the speech steer stays out (§40). */
	deliveryTriedThisTurn: boolean;
	/**
	 * Tool calls blocked because this turn has no door left (§34.16, widened by §86).
	 *
	 * Counted per *turn*, not per run. It used to reset at `agent_start`, and a continuation run --
	 * which pi starts for any message queued from `agent_end` -- put it back to zero on a turn that
	 * was still just as closed, so the cut never arrived. It resets with the next player input.
	 */
	blockedAfterClose: number;
	/** Blocked calls after the refusal budget was spent (§70): the same runaway
	 *  escalation as §34.16, for a turn that never opened rather than one that closed. */
	blockedAfterExhausted: number;
	/** The prose the floor steer dropped; if the second leg brings no prose and no narrate, this closes the turn as before. */
	floorDraft?: string;
	/**
	 * The recovery this turn's capsule said the Director is owed (contract §40), or null when none is.
	 * A Director beat was advice: `directorAdoption` is telemetry and says so, and on campaign
	 * game-83177d61 the Keeper declined 43 of 52 signals, six consecutive RECOVERs among them, while
	 * the player was failing the same STR check against the same nailed cupboard for the third time.
	 * The host is the only layer that can make a signal a step, and this is where it does it.
	 */
	recoveryOwed?: { blocked: number; steps: string[] } | null;
	/** Whether a receipt that discharges the recovery has landed this turn. */
	recoveryLanded: boolean;
	/** The recovery refusal is spent once per turn: a second narrate closes the turn whatever it brings. */
	recoverySteered: boolean;
	/** A retained *adaptation* preparation owns the rest of this turn until the Keeper briefly yields to the
	 * player: it is a named job with its own control verb (`lookup kind=adaptation action=status`), so the
	 * Keeper can always find out where it stands. A source reading has no such verb and is not put here. */
	preparationWait?: { kind: "adaptation"; name?: string; status?: string };
	/** §36.15, §60: a named proposal the kernel has reported over — `stale`, or `failed` with the
	 * reviewer's own cause. It is not a wait: the job holds nothing back, and the table is free the
	 * moment the Keeper has been told. Armed by the turn-boundary refresh and spent on the first tool
	 * call of the turn, which is refused once so the call that revives the proposal is read before the
	 * turn is spent waiting for it again. Once spent it is never re-armed: the boundary returns early
	 * with no wait in hand, and §60 retired the job from the kernel's cold-recovery scan, so no later
	 * process rediscovers it either. */
	adaptationOver?: { name: string; status: string; cause?: string };
	/** Contract §22: one unread piece of source material, named. An unread page is a fact about that
	 * material, not about the campaign, so this never blocks a verb — it only supplies the Keeper's
	 * wording, the audit's `preparation_wait` basis, and the steer that closes this turn. It dies with
	 * the turn that raised it: the next player input is a new context. */
	sourceWait?: { focus?: string; question?: string };
	/** Contract §37.6: the independent source review refused the placement this turn's reentry needs.
	 * Host-owned, from the kernel's own adaptation result — never prose — and cleared when a later
	 * proposal is pending, ready or accepted, or when the next turn opens. */
	rebindingRefused?: { name: string; summary?: string };
	/** Cold recovery scans the retained adaptation surface once; later jobs are tracked in memory. */
	adaptationScanned: boolean;
	readingWait?: boolean;
	/** Failed material reads automatically retried once in this player turn, keyed by the kernel's exact read identity. */
	readingRetries: Set<string>;
	/** Read identities already refused this player turn, each with the refusal the Keeper was given:
	 * asking for the same unread material again buys another full reading wait and can answer nothing
	 * the first attempt could not, so the same answer comes straight back. Cleared with the turn. */
	readingRefused: Map<string, unknown>;
	/** A host note owed to the Keeper at agent_end rather than delivered as prose. */
	deliveryFix?: { kind: string; text: string };
	/** §47: the turn whose delivery already carried the host's preparation-wait notice. The wait
	 * itself survives later inputs (§36.15); the sentence about it is said once per delivered turn. */
	waitNoticeTurn?: number;
	/** A review operation stopped; only genuine new player input can start a linked retry. */
	reviewUnavailable?: string;
	/** Which kind of pause that was (§38.9): a service outage, or the reviewer reaching a conclusion.
	 * The streak is service-only, so it can no longer be read backwards to tell the player which of the
	 * two happened -- a verdict pause on a table that already carried two outages would otherwise be
	 * announced as a dead lane. Set once per run, from the pause that actually stopped the review. */
	reviewPauseService?: boolean;
	/** Consecutive continuity-review outages (contract §38), counted like the admission lane's own
	 * (§32.2): the first reads as transient, a streak turns the player's service notice persistent and
	 * notifies the operator out of fiction, once per streak. A landed narrate resets it; a turn
	 * boundary does not -- an outage is a service condition, not a turn context. */
	reviewOutage: number;
	/** §91: consecutive deliveries no reviewer judged. Zeroed by the next review that answers. */
	unreviewedStreak: number;
	unreviewedNotified?: boolean;
	reviewOutageNotified?: boolean;
	/** This run already told the player the turn could not be published: one service notice per run. */
	reviewNoticeSent?: boolean;
	/** Consecutive provider calls that ended in error with nothing delivered (contract §38.7), counted
	 * like the review's own. A completed assistant message resets it; a turn boundary does not. */
	providerOutage: number;
	providerOutageNotified?: boolean;
	/** The failed provider call of this run the player is still owed a word about, when it hung long
	 * enough that the wait was visibly an outage rather than the Keeper thinking. */
	providerFailure?: { ms: number; streak: number };
	/** The last provider call in this run ended in error. Any later completed assistant message clears
	 * this: only a terminal, unrecovered infrastructure failure may strand the turn (contract §38.3). */
	terminalProviderFailure?: { ms: number | null; streak: number };
	/** This run already told the player the model connection dropped: one service notice per run. */
	providerNoticeSent?: boolean;
	/** This settled run already scheduled the generic no-delivery notice. */
	turnNoticeSent?: boolean;
	/** Consecutive `commit_failed` refusals with the same cause (contract §38.11), counted like the
	 * review's and the provider's. A successful call resets it; a turn boundary does not -- a Git
	 * that cannot write is a service condition, not a turn context. */
	commitOutage?: { cause: string; count: number };
	commitOutageNotified?: boolean;
	/** The table cannot write its history at all: the same commit failure has repeated. The run is
	 * terminated rather than retried, and the player is told as a service notice. Cleared at the
	 * start of the next run, so new player input still buys one honest attempt. */
	commitUnavailable?: { cause: string; detail: string; streak: number };
	/** This run already told the player the history store is down: one service notice per run. */
	commitNoticeSent?: boolean;
	/** Contract §34.17: the narrate calls of one assistant message that carries more than one. The
	 * first would close the turn and the rest would be blocked after close, so a delivery written in
	 * two halves would reach the player as its first half only. */
	splitDelivery?: Set<string>;
	/** The split-delivery refusal is spent once per turn: a Keeper that writes two halves again gets
	 * its first half delivered, and the player is told the rest was refused. */
	splitDeliveryRefused?: boolean;
	/** A narrate was blocked because the turn had already closed: the delivery the player read is the
	 * Keeper's first half and the continuation never landed (contract §34.17). */
	deliveryCutShort?: boolean;
	/** Contract §78: the calls of one assistant message that put the closing `narrate` ahead of an
	 * effect verb. The narrate would close the turn and the effect behind it could never land, so
	 * the message is refused whole and the Keeper sends the effect first. */
	deliveryAheadOfEffect?: Set<string>;
	/** Contract §78: the `narrate` calls of one assistant message that also carries an effect verb
	 * ahead of them. The delivery was composed before the host answered that effect, so a refusal
	 * makes it a delivery written without its answer; it is refused so the Keeper writes it again. */
	deliveryBehindEffect?: Set<string>;
	/** Contract §78: an effect in this message was refused while the delivery behind it was still
	 * pending. Read by the `narrate` call that follows, once. */
	effectRefusedBeforeDelivery?: boolean;
	/** Contract §78: each ordering refusal is spent once per turn, like §34.17's, so a Keeper that
	 * writes the same shape again is never left unable to deliver at all. */
	deliveryOrderRefused?: boolean;
	/** Contract §78: an effect verb the host refused whose answer this turn's delivery could not
	 * carry -- it was blocked after the delivery had already closed the turn, or it was refused in
	 * the same message as a delivery that then landed. Nothing can be repaired, so the player is
	 * told at `agent_end`. */
	refusedEffectUntold?: boolean;
	/** §78's notice is one per turn and §34.17's is too: the turn each was already sent for, so a
	 *  later run on the same closed turn does not say the same thing to the player twice. */
	refusedEffectToldTurn?: number;
	cutShortToldTurn?: number;
	/** Contract §38: an agent run ended leaving this turn open with nothing delivered, so no one can
	 * finish it any more. The next player input releases it instead of being refused turn_state. */
	strandedTurn?: boolean;
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
	/** Player-safe derivatives prepared by apply map or look focus=map for the next delivery. */
	mapAttachments: MapAttachment[];
	/**
	 * The module's authored map words projected into this campaign's `play_language` (contract
	 * §39.2), source word to projected word. Held here rather than read at delivery because the
	 * delivery hop is synchronous and a first-arrival card must never wait on a file, let alone on
	 * a model.
	 */
	mapWords: Record<string, string>;
	/** Source words a lane run has already been asked for, so a word it could not project is not asked again every turn. */
	mapWordsAsked: Set<string>;
	/** The lane runs one at a time per table: two arrivals in one turn share a cache file and would otherwise race it. */
	mapWordsJob?: Promise<void>;
	/** Cut off lane completions still in flight when the session ends; they must not hold up the exit. */
	lanes: AbortController;
	/** The exact current player text (contract §32.3); a turn with none — the opening — puts nothing to review. */
	playerText?: string;
	/**
	 * Contract §71: a resend held because it repeats, byte for byte, the words the running turn is
	 * already working on. Held, never dropped: if that turn delivers, the resend is spent; if it
	 * settles with nothing delivered, this is the retry the player meant and it is sent then.
	 */
	resend?: { text: string; turn: number };
	/** The turn whose resend the player has already been told about: one sentence per turn, not per click. */
	resendNoticeTurn?: number;
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
	/** Consecutive failed reviews (contract §32.2's outage): the first failure reads as transient, a
	 * streak turns the service notice persistent and notifies the operator out of fiction, once per
	 * streak. A live verdict resets it; a turn boundary does not -- an outage is a service condition,
	 * not a turn context. */
	admissionOutage: number;
	admissionOutageNotified?: boolean;
	/** What this turn has already settled through the kernel, one line each, so an entailed step is visible as such. */
	landed: string[];
	/** The options of the `ask` that closed the last turn, and, once the next input arrives, the ones this turn answers (contract §32.1). */
	lastAsk?: string[];
	answering?: string[];
	/** §50: the turn whose settled facts have already been projected for an undelivered run. One
	 *  card per turn, whatever the cause and however many runs end on it. */
	settledToldTurn?: number;
}

const CLOSED_STATES: ReadonlySet<TurnState> = new Set<TurnState>(["awaiting_player", "committed", "asked"]);
/**
 * §86: the one condition. A turn has **no door** when nothing the Keeper can call will close it --
 * it was delivered, it was handed back with `ask`, or it never opened at all. The single exception
 * is the opening: `awaiting_player` with the opening still owed is a turn whose delivery is still
 * ahead of it, where `narrate` and `ask` are doors, reads are worth making, and §67/§70's refusals
 * apply instead.
 *
 * This replaced `state.closedThisRun`, which is a fact about the *run*: the same closed turn
 * answered one way inside the run that closed it and another way in every run after, with a
 * different sentence, a different code, a different counter and none of §78's flags.
 */
function turnHasNoDoor(state: { state: TurnState; openingPending: boolean }): boolean {
	if (!CLOSED_STATES.has(state.state)) return false;
	return !(state.state === "awaiting_player" && state.openingPending);
}
const TURN_CLOSED_REASON = "the turn is closed, waiting for the player";
/** §34.16: a run that keeps calling tools after its turn closed is told to stop at the third blocked call and cut at the sixth. */
const TURN_CLOSED_STOP = "The turn is closed and the player has the move. Call no tool and write nothing more; the next player input opens a new turn.";
const RUNAWAY_STOP_AT = 3;
const RUNAWAY_ABORT_AT = 6;
/**
 * Contract §78: the verbs that change the world the player was told about. A refusal of one of these
 * leaves the fiction and the books apart; a refused `look`, `lookup` or `recall` leaves nothing at
 * all behind, and a refused `ask` or `narrate` is §34.17's, which already has its own answer.
 */
const EFFECT_TOOLS: ReadonlySet<string> = new Set(["resolve", "apply"]);
/** §78's one sentence: the order the Keeper is asked for, and why. */
const DELIVERY_ORDER_REASON = "One narrate delivers the whole turn and closes it, so an effect behind it can never land and the player"
	+ " would read it as done. Send resolve and apply before the narrate, and write the delivery once you have their answers.";
/** Refusals of one class (tool, code, the field the kernel named) a turn tolerates before that tool is shut for the turn. */
/** Contract §38.11: the same commit failure twice is the service, not the text. One retry, then stop --
 *  the streak that escalates elsewhere in this host (§32.2, §38, §38.7) is also two. */
const COMMIT_FAILURE_LIMIT = 2;
const REFUSAL_CLASS_LIMIT = 3;

/**
 * Score one refusal against its class (contract §67).
 *
 * The budget used to count only refusals that came back from the kernel as a
 * `coc_error`. The host's own pre-tool gate returns `{ block: true, reason }`
 * without ever reaching the kernel, so those refusals were free: a Keeper was
 * told `turn_state: wait for the player to speak` twenty-three times in one
 * turn, every three seconds, and nothing stopped it -- a fifteen-minute turn
 * for a one-line question. The rule is three strikes per class, whoever refused.
 */
function strikeRefusalClass(
	state: { refusalClasses: Map<string, { count: number; last: string; round: number }>; exhausted: Map<string, string>; refusalsThisTurn: number; roundTrips: number; callRounds: Map<string, number> },
	tool: string,
	cls: string,
	last: string,
	round: number,
	/**
	 * Whether the turn this refusal belongs to has already closed (§77).
	 *
	 * `narrate` and `ask` are exempt from the budget because they are the two doors out of a
	 * turn, and shutting the doors would strand it. A *closed* turn has no doors: narrate ends
	 * nothing there, it is refused like any other write, and exempting it only guarantees the
	 * Keeper can hammer the one tool nothing counts.
	 */
	closed = false,
): { count: number; tripped: boolean } {
	const previous = state.refusalClasses.get(cls);
	// A strike is an attempt, not a call: calls written in one message are answered
	// after the Keeper wrote them, so a batch takes one strike between them.
	const batched = previous !== undefined && previous.round === round;
	const count = (previous?.count ?? 0) + (batched ? 0 : 1);
	state.refusalClasses.set(cls, { count, last, round });
	state.refusalsThisTurn += 1;
	const closing = "Nothing refused has happened. Stop trying it: close the turn with narrate on what landed with a receipt, or hand the player the pending choice with ask.";
	let tripped = false;
	const isDoor = !closed && ["narrate", "ask"].includes(tool);
	if (count >= REFUSAL_CLASS_LIMIT && !state.exhausted.has(tool) && !isDoor) {
		state.exhausted.set(tool, `${tool} has been refused ${count} times this turn for the same reason (${last}). ${closing}`);
		tripped = true;
	}
	if (state.refusalsThisTurn >= REFUSAL_BUDGET) {
		// The global sweep never touches narrate and ask. A strike can come from a turn whose
		// opening is still pending -- `resolve` refused while the opening waits to be delivered --
		// and shutting narrate there would take away the door the sweep's own advice points at.
		for (const name of ["resolve", "apply", "look", "lookup", "recall"])
			if (!state.exhausted.has(name))
				state.exhausted.set(name, `${state.refusalsThisTurn} refusals this turn. ${closing}`);
	}
	return { count, tripped };
}
/** Refusals of any class a turn tolerates before every write but narrate and ask is shut. */
const REFUSAL_BUDGET = 8;
/**
 * How long a provider call must have hung, before dying with nothing, for the player to be owed a
 * word about it (contract §38.7). Below this a failed-and-retried call is a blip the player never
 * noticed; above it, it is most of what they sat through, and the retained case is 300 s. The
 * operator record is written for every failed call regardless -- this line is only about interrupting
 * the table's own fiction with a service message.
 *
 * Read per call, like the lane timeouts, so a host that knows its own provider can move it; the
 * default is what a table runs with.
 */
const PROVIDER_OUTAGE_NOTICE_MS = 60_000;
function providerNoticeAfterMs(): number {
	const configured = Number(process.env.PI_COC_PROVIDER_NOTICE_MS);
	return configured > 0 ? configured : PROVIDER_OUTAGE_NOTICE_MS;
}
/**
 * Adaptation statuses the host keeps as a `preparationWait` (§36.15). `pending`/`reviewing` are work in
 * flight; `ready` is the one decision the table owes an answer to before it acts, because there is
 * something there to accept. Everything else — `failed`, `stale`, `cancelled`, `accepted`, `none` — is
 * over, and an over job is not a wait: it holds nothing back and must not be described as running.
 *
 * §60 took `failed` out. `ready` and `failed` were held for the same stated reason — the table owes
 * them an answer — but they are not the same kind of thing: `ready` has reviewed changes waiting for
 * `apply`, and `failed` has nothing at all. Holding it made the host block *every* verb including
 * `narrate` until the Keeper looked the corpse up by name. On `game-1c0faba5` that cost turn 40 two
 * calls, a `lookup` and a `look`, for a street of neighbours that had failed on turn 24 and had
 * nothing to do with the upstairs room the player was standing in; on `game-ef8e60aa` it cost turn 45
 * an `apply` for a sanatorium that failed on turn 22. A failure is a result. It is said once, with
 * its cause, and then the table is free.
 */
const ADAPTATION_HELD = ["pending", "reviewing", "ready"];
/** Terminal adaptation statuses the table is told about once, by name, and never held for (§60). */
const ADAPTATION_OVER = ["stale", "failed"];
/** Receipt kinds that discharge an owed recovery; mirrors `RECOVERY_TAKES` in kernel-ts/read/offer.ts. */
const RECOVERY_RECEIPT_KINDS = new Set(["clue", "move", "npc", "session", "handout", "map", "item"]);
/** The one host steer of the turn floor (docs/specs/turn-floor.md D4), sent when a turn is about to close on prose alone. */
const FLOOR_STEER =
	"This turn used no tool and nothing landed. Read director.offer and the people present: what changes in the world, apply; " +
	"what is uncertain, resolve. Then take up the player's words from the world's view, let the world answer, give someone " +
	"present a line in their own voice, and hand the move back to the player. Close with narrate.";
/** The one host steer of §40 (user ruling 2026-09-15): people are on stage and the draft wraps no spoken line. */
const SPEECH_STEER =
	"People are present and this draft wraps no spoken line. Every line anyone says aloud goes inside " +
	"{{say:Name}}\u2026{{/say}}, Name exactly as present[].name gives it (the investigator too, when you render " +
	"the player's words as theirs); a person not in present[] takes the label the prose uses for them. Rewrite " +
	"the same turn with every spoken line wrapped, and close with narrate. The braces never reach the player.";

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
/** Which model and provider that request named, so a call that dies can say what died (§38.7). */
let providerRequestModel: {model?: string; provider?: string} | undefined;
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
/** Durable host handoff; cleared only after table.player_input records the stranded release. */
let watchdogRecoveryFile: string | undefined;
type WatchdogBinding = "bound" | "stale" | "failed";
let watchdogTurnBinding: { turn: number; promise: Promise<WatchdogBinding> } | undefined;

async function bindWatchdogRecoveryTurn(turn: number): Promise<WatchdogBinding> {
	if (!watchdogRecoveryFile) return "bound"; // In-memory extension harness: the env flag is the whole handoff.
	try {
		const raw = JSON.parse(await readFile(watchdogRecoveryFile, "utf8")) as Record<string, unknown>;
		const sessionId = sessionCtx?.sessionManager.getSessionId?.();
		if (raw.version !== 1 || (typeof raw.sessionId === "string" && sessionId && raw.sessionId !== sessionId)) return "failed";
		if (typeof raw.turn === "number") {
			if (raw.turn === turn) return "bound";
			await rm(watchdogRecoveryFile, { force: true });
			delete process.env.PI_COC_WATCHDOG_RECOVERY;
			return "stale";
		}
		const temp = `${watchdogRecoveryFile}.tmp-${process.pid}`;
		await writeFile(temp, `${JSON.stringify({ ...raw, turn })}\n`, "utf8");
		await rename(temp, watchdogRecoveryFile);
		return "bound";
	} catch {
		return "failed";
	}
}

async function clearWatchdogRecovery(): Promise<void> {
	if (watchdogRecoveryFile) await rm(watchdogRecoveryFile, { force: true }).catch(() => undefined);
	delete process.env.PI_COC_WATCHDOG_RECOVERY;
}

function hasTurnTerminalNotice(turn: number): boolean {
	return sessionCtx?.sessionManager.getBranch().some((entry: any) =>
		entry?.type === "custom_message" && entry.customType === "coc-delivery"
		&& entry.details?.turn === turn
		&& (entry.details?.turn_unfinished === true
			|| (entry.details?.provider_outage === true && entry.details?.terminal === true))) === true;
}

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
 * Contract §47. The one sentence every host-state instruction ends on, and the reason the Keeper
 * no longer writes the wait into the fiction: the host owns the service notice, and it owns it because
 * it is the only party that can re-read the state at the moment the player is told.
 *
 * Three live tables on 2026-09-16 delivered the same failure in the Keeper's own voice. On
 * `game-1c0faba5` turn 3 the refusal the player was actually given was `action_not_authorized` — the
 * move destination was not registered — and the Keeper explained it with the *preparation* status it
 * had read 20 s earlier, then asked the player to say it again, which the admission `fix` expressly
 * forbids. On `game-b4cebfe0` turns 2 and 3 a `reading_timeout` became a sentence inside the scene
 * ("this part of the source is still being prepared, the boat cannot land"), and the reading finished
 * seconds after. The two paths are separate instructions but one seam: a host instruction that tells
 * the Keeper what to *say* turns host state into fiction, and stale fiction at that.
 */
const HOST_SAYS_THE_WAIT = " Do not put this preparation into the fiction at all, and do not ask the player to say their action again:"
	+ " the host itself tells them, out of fiction and beside the delivery, with the state re-read at the moment it is sent.";

/**
 * Contract §22. The reading service's own refusal is addressed to the host ("request the same reading
 * with retry: true", "the reader host shut down"): it names no material and offers the Keeper nothing
 * it can act on. Once the host has spent its one automatic repair, the Keeper gets this instead — which
 * material is unavailable, that only that material is unavailable, and what it may still settle. The
 * kernel's own `reason` and `read` survive so the failure lane and §34.12's refusal budget still see
 * the same class.
 */
function sourceMaterialRefusal(failure: unknown, read: Record<string, unknown>): unknown {
	if (!isKernelError(failure)) return failure;
	const reason = asString(failure.details?.reason);
	if (reason !== "reading_failed" && reason !== "reading_timeout") return failure;
	const focus = asString(read.focus) ?? "";
	const named = focus ? ` for ${focus}` : "";
	// The kernel's own message is accurate and is what the refusal budget classes on; only the fix is
	// rewritten, and it keeps the read identity (#65) the Keeper is told to reuse verbatim.
	return new KernelError({
		code: failure.code,
		message: failure.message,
		fix: `Only the source material${named} is unavailable: whatever this turn already settled with a receipt did happen and is narrated as usual, and nothing else at this table is blocked.`
			+ " What the investigators already carry, whoever is already on stage, the scenes and people the graph already knows, and ordinary narration all settle as usual, with their own receipts."
			+ ` Settle whatever the player's own action can reach without it and return control so they can act on something else.${HOST_SAYS_THE_WAIT}`
			+ ` Do not send this read again this turn and do not narrate what${named ? ` ${focus}` : " the unread material"} would have said;`
			+ " on a later player turn, retry the original action or lookup kind=source with the exact focus and question in details.read; do not invent another question",
		details: { ...failure.details, reason,
			read: { ...(read.purpose ? { purpose: read.purpose } : {}), ...(read.material ? { material: read.material } : {}),
				focus, ...(read.question ? { question: read.question } : {}) } },
	});
}

/**
 * Contract §38.11: what actually failed underneath a `commit_failed`, as a cause to count by and a
 * detail to quote. The kernel sends the Git verb, its exit code and what Git printed as fields
 * (`details.git`); a kernel too old to send them still yields a cause, from its own message.
 */
function commitCause(error: unknown): { cause: string; detail: string } {
	const git = isKernelError(error)
		? (error.details?.git as { step?: unknown; code?: unknown; output?: unknown } | undefined)
		: undefined;
	const step = asString(git?.step);
	const exit = typeof git?.code === "number" ? git.code : undefined;
	const message = error instanceof Error ? error.message : String(error);
	const output = asString(git?.output);
	return {
		// The cause is what a streak is counted by, so it must not carry anything that varies between
		// two identical failures -- the turn number and the narrate text both would.
		cause: step && exit !== undefined ? `git ${step} exited ${exit}` : message.slice(0, 120),
		detail: (output || message).slice(0, 200),
	};
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
	/**
	 * The Mods extension announces its bridge during extension loading, so on a slow load an opening
	 * Mod call can land before it. The opening lane waits briefly for the bridge (PI_COC_MODS_WAIT_MS,
	 * default 1500 ms, 0 disables) instead of refusing a roll the opening is meant to allow; when the
	 * wait expires the refusal says the bridge is pending -- retryable -- and not the closed-state text.
	 */
	function modsBridgeWaitMs(): number {
		const raw = process.env.PI_COC_MODS_WAIT_MS?.trim();
		if (!raw) return 1500;
		const value = Number(raw);
		return Number.isFinite(value) && value >= 0 ? value : 1500;
	}
	async function modsBridgeWait(timeoutMs: number): Promise<boolean> {
		if (mods) return true;
		if (timeoutMs <= 0) return false;
		const deadline = Date.now() + timeoutMs;
		while (!mods && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
		return Boolean(mods);
	}
	// A background projection has written this tag's captions (contract §23): drop the authored
	// words this extension was standing on, so the next line it notifies with is the player's.
	pi.events.on("coc:ui-words", (data) => { surface.refresh((data as { tag?: unknown } | undefined)?.tag); });
	let reading: { ensure(moduleId: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
		reading?(moduleId: string, params: Record<string, unknown>): boolean } | undefined;
	let readingModule: string | undefined;
	/** Contract §28.9: the build-skew notice is the operator's, once per session, not once per reopen. */
	let modSkewNotified = false;
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
			{ customType: "coc-host", content, display: false, details: { coc_host: true, kind, scope: "turn", campaign: table?.campaign, turn: table?.turn } },
			{ triggerTurn: true },
		);
	}

	// ---- Turn mirror ------------------------------------------------------

	function recoveredReceiptLabel(receipt: unknown): string {
		if (typeof receipt === "string" && receipt) return receipt;
		if (receipt && typeof receipt === "object" && !Array.isArray(receipt)) {
			const record = receipt as Record<string, unknown>;
			const id = asString(record.id);
			if (id) return id;
			try { return JSON.stringify(record); } catch { return "unreadable receipt"; }
		}
		return String(receipt);
	}

	/**
	 * Contract §28.9: a package this kernel build cannot read, said once, out of fiction, to the
	 * person who can fix it -- shaped like §32.2's `coc-admission-status` and §38.7's provider notice.
	 *
	 * 2026-09-15, live: `mods/npc-voice` was merged into the branch after the running kernel had been
	 * built, and the older build's manifest reader did not know the profile key's `shape` field. It
	 * threw out of the catalog read, so every `table.open` and every `table.player_input` failed, and
	 * the player was told to repair a configuration file that was perfectly correct. Nothing named the
	 * package, the version, the key, or the one fact that decides the case -- that the kernel is a
	 * build artifact and `mods/` is not. Both halves are repaired: the package now refuses only
	 * itself, and this says why, where someone can act on it.
	 */
	function noteModSkew(campaign: string, gaps: Array<Record<string, unknown>>): void {
		if (modSkewNotified || !gaps.length) return;
		modSkewNotified = true;
		const packages = gaps.map((gap) => ({
			package: asString(gap.package) ?? "?",
			version: asString(gap.version) ?? "?",
			reason: asString(gap.reason) ?? "unreadable",
			...(asString(gap.key) ? { key: asString(gap.key) } : {}),
			...(asString(gap.field) ? { field: asString(gap.field) } : {}),
			...(Array.isArray(gap.unknown) ? { unknown: gap.unknown } : {}),
			...(Array.isArray(gap.accepts) ? { accepts: gap.accepts } : {}),
			...(asString(gap.message) ? { detail: asString(gap.message) } : {}),
		}));
		const status = {
			campaign,
			status: "skew",
			packages,
			fix: `This kernel build cannot read ${packages.length === 1 ? "one installed package" : `${packages.length} installed packages`}`
				+ `: ${packages.map((row) => `${row.package} ${row.version}`).join(", ")}. They stay disabled and the table plays without them.`
				+ " The kernel is a build artifact and mods/ is read live from disk, so a package updated after the kernel was built reads exactly like this:"
				+ " rebuild the kernel (npm run build:runtime) and reopen the table. If a rebuilt kernel still cannot read them, they need a newer kernel than this source.",
		};
		try { pi.appendEntry("coc-mods-status", status); }
		catch { /* the notice must never break an opening */ }
		pi.events.emit("coc:mods-status", status);
		void record({ lane: "mods", campaign, ok: false, reason: "kernel_build_skew",
			packages: packages.map((row) => `${row.package} ${row.version}`) });
	}

	function applyOpen(open: OpenResult): void {
		if (!table) return;
		readingModule = asString(open.campaign?.module_id);
		if (open.mods_unreadable?.length) noteModSkew(table.campaign, open.mods_unreadable);
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
		table.strandedTurn = undefined;
		table.rebindingRefused = undefined;
		table.steeredThisTurn = false;
		table.toolCallsThisTurn = 0;
		table.deliveryTriedThisTurn = false;
		table.blockedAfterClose = 0;		table.blockedAfterExhausted = 0;
		table.floorDraft = undefined;
		table.recoveryOwed = null;
		table.recoveryLanded = false;
		table.recoverySteered = false;
		table.readingWait = false;
		table.sourceWait = undefined;
		table.readingRetries.clear();
		table.readingRefused.clear();
		table.deliveryFix = undefined;
		table.attachments = [];
		table.mapAttachments = [];
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
		// A cold recovered turn still owes the consequences already written by
		// its dead process. Feed those retained receipts into the same wait and
		// admission context as live noteLanded calls; otherwise a later pending
		// preparation can falsely tell the Keeper that nothing happened.
		table.landed = (open.pending_turn?.receipts ?? []).map((receipt) => `receipt already landed: ${recoveredReceiptLabel(receipt)}`);
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
			// Contract §40.2: the spans the delivery actually marked, so the verifier reads what was
			// said rather than guessing it back out of the prose. A kernel without the pass omits it.
			...(Array.isArray(result.speech) ? { speech: result.speech } : {}),
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
		const pendingMaps = state.mapAttachments;
		state.mapAttachments = [];
		if (pending.length === 0 && pendingMaps.length === 0) return mechanics;
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
		for (const pending of pendingMaps) {
			// The last hop before the player. A card the Keeper wrote is already in the play
			// language; a first-arrival card is the module's own words (contract §39.2), and it is
			// projected here rather than when it was minted, so it has the whole Keeper round trip
			// between `apply move` and the delivery to become ready in. If it is not ready, the card
			// still goes -- a picture of the place is worth more than a withheld one -- but it goes
			// saying `words: "source"`, and a telemetry row says which map and how many labels.
			const map = mapForDelivery(state, pending);
			const hasReceipt = typeof map.receipt === "string" && map.receipt.length > 0;
			const existing = rows.find(row => {
				if (row.kind !== "map") return false;
				if (hasReceipt) return typeof row.receipt === "string" && row.receipt === map.receipt;
				return typeof row.receipt !== "string" && row.map === map.map && row.view_id === map.view_id;
			});
			if (existing) Object.assign(existing, map);
			else rows.push({...map});
		}
		return rows;
	}

	/** The authored words of one prepared card replaced with the projected ones, or the card marked as still owing them. */
	function mapForDelivery(state: TableState, card: MapAttachment): MapAttachment {
		if (card.words !== AUTHORED_MAP_WORDS) return card;
		const projection = projectMapCard(card, state.mapWords);
		if (projection.projected) return { ...projection.card, words: KEEPER_MAP_WORDS };
		const texts = mapCardTexts(card);
		void record({ lane: "map-words", event: "delivered", ok: false, reason: "not_projected", map: card.map,
			...(card.receipt ? { receipt: card.receipt } : {}), texts: texts.length,
			missing: texts.filter(text => !state.mapWords[text]).length, ...(state.playLanguage ? { play_language: state.playLanguage } : {}) });
		return card;
	}

	/**
	 * Start the projection a set of authored map words still needs, beside the turn (contract §39.2).
	 *
	 * Never awaited by anything on the turn's path: the words are wanted for the delivery, and the
	 * delivery is one Keeper round trip away, so the lane has that long. A word two rounds could not
	 * project is not asked for again on this table -- a lane that cannot answer answers no faster the
	 * fourth time, and the card it is owed to has already gone out saying so.
	 */
	function ensureMapWords(state: TableState, texts: readonly string[], why: string): void {
		const tag = state.playLanguage, owner = runtime;
		if (!tag || !owner) return;
		const wanted = [...new Set(texts)].filter(text => !state.mapWords[text] && !state.mapWordsAsked.has(text));
		if (!wanted.length) return;
		for (const text of wanted) state.mapWordsAsked.add(text);
		let model: string | undefined, thinking: string | undefined;
		try {
			const chosen = sessionCtx?.model;
			model = chosen ? `${chosen.provider}/${chosen.id}` : undefined;
			thinking = pi.getThinkingLevel?.();
		} catch { /* the session is gone; the lane still runs on the host's own defaults */ }
		const began = Date.now();
		const options: MapWordsOptions = { home: owner.home, resourceRoot: owner.resourceRoot, play_language: tag, model, thinking,
			signal: state.lanes.signal, runner: request => owner.runTask({ kind: "mod", request }, request.signal) };
		// One run at a time per table: two arrivals in one turn write the same cache file.
		state.mapWordsJob = (state.mapWordsJob ?? Promise.resolve()).then(async () => {
			try {
				state.mapWords = { ...state.mapWords, ...await prepareMapWords(options, wanted) };
				await record({ lane: "map-words", ok: true, why, texts: wanted.length, ms: Date.now() - began,
					play_language: tag, ...(model ? { model } : {}) });
			} catch (error) {
				// Whatever the lane kept before it failed is still worth having; the rest of the run is
				// a projection losing a projection, never a turn.
				state.mapWords = { ...await readMapWords(options).catch(() => ({})), ...state.mapWords };
				await record({ lane: "map-words", ok: false, why, texts: wanted.length, ms: Date.now() - began,
					play_language: tag, reason: String(error instanceof Error ? error.message : error).slice(0, 200) });
			}
		}).catch(() => undefined);
	}

	/**
	 * The module's map words, projected when the table opens rather than when a card is minted.
	 *
	 * A first-arrival card is minted inside `apply move` and is on screen at the end of that same
	 * turn, which is not room for a model round trip. The words are knowable long before then --
	 * they are the module's, not the campaign's -- so `table.open` hands them over (contract §39.2)
	 * and the whole module's labels are projected while the player is still reading the opening
	 * scene. They ride the open result rather than a read of the map catalog because the open
	 * sequence is the one thing on this connection nothing else is allowed to interleave with.
	 */
	function warmMapWords(state: TableState, open: OpenResult): void {
		const tag = state.playLanguage, owner = runtime;
		if (!tag || !owner) return;
		const authored = (Array.isArray(open.authored_map_words) ? open.authored_map_words : []).filter(
			(word): word is string => typeof word === "string" && word.trim().length > 0);
		void (async () => {
			try {
				state.mapWords = { ...await readMapWords({ home: owner.home, resourceRoot: owner.resourceRoot, play_language: tag }), ...state.mapWords };
			} catch { /* nothing projected for this tag yet */ }
			ensureMapWords(state, authored, "open");
		})();
	}

	/** Private source layers end here; only a flattened derivative is retained in the conversation row. */
	async function prepareMapViews(state: TableState, result: Record<string, unknown>): Promise<void> {
		if (!Array.isArray(result.map_views)) return;
		const campaignDir=dirname(state.telemetryPath),modulesRoot=resolve(campaignDir,'../../modules'),prepared:MapAttachment[]=[];
		for(const value of result.map_views) {
			const receipt=value&&typeof value==='object'&&typeof (value as Record<string,unknown>).receipt==='string'?(value as Record<string,unknown>).receipt as string:undefined;
			try {
				const map=await renderMapView(value,{modulesRoot,campaignDir,...(receipt?{receipt}:{})});
				if(map)prepared.push(map);
			} catch {
				const row=value&&typeof value==='object'?value as Record<string,unknown>:{};
				if(typeof row.map==='string')prepared.push({kind:'map',...(receipt?{receipt}:{}),map:row.map,name:typeof row.name==='string'?row.name:row.map,
					view_id:'unavailable',regions:Array.isArray(row.regions)?row.regions as Record<string,unknown>[]:[],levels:[],document:MAP_DOCUMENT_NONE});
			}
		}
		delete result.map_views;
		if(prepared.length){
			state.mapAttachments.push(...prepared);
			// Whatever the open-time warm did not cover -- a map published after it, a label the
			// catalog did not carry -- is asked for now, so the next card is right even when this
			// one goes out authored.
			ensureMapWords(state, prepared.filter(map => map.words === AUTHORED_MAP_WORDS).flatMap(map => mapCardTexts(map)), "arrival");
			// The tool result is Keeper-visible. Keep only the short public summary here;
			// rendered bytes remain host-only and are delivered through the mechanics entry.
			result.views=prepared.map(map => {
				const {image: _image, path: _path, render: _render, level_images, ...summary}=map as MapAttachment & Record<string, unknown>;
				if (Array.isArray(level_images)) summary.level_images=level_images
					.filter(level => level && typeof level.level === "string")
					.map(level => ({level: level.level}));
				return summary;
			});
		}
	}

	/**
	 * The mechanics projection reaches the delivery channel as a `coc-mechanics` session entry plus
	 * a `coc:mechanics` bus event (contract §8, §16.2). The Pi RPC event stream carries it, so the
	 * driver lands it in the evidence and a future front end renders dice cards and change bars from
	 * it. It is never injected into the prose: the TUI shows only what the Keeper wrote.
	 */
	function noteMechanics(state: TableState, turn: number, mechanics: Array<Record<string, unknown>>,
		markedText?: string, labels?: unknown, speech?: unknown[], extra?: Record<string, unknown>): void {
		// §40.2: a delivery may mark say spans and no mechanics at all, and that turn still owes the
		// host an entry -- the card colours its speakers from this one.
		const spoken = Array.isArray(speech) && speech.length > 0 ? speech : undefined;
		if (mechanics.length === 0 && !spoken) return;
		// §16.6: `marked_text` rides here rather than in the assistant message, because that message
		// is also what a terminal reader sees and raw `{{...}}` is not prose. A frontend that has it
		// draws each marked row where the Keeper put it; one that does not reads the message as before.
		const entry = { turn, mechanics, ...(labels ? { labels } : {}), play_language: state.playLanguage, ...(markedText ? { marked_text: markedText } : {}), ...(spoken ? { speech: spoken } : {}), ...(extra ?? {}) };
		try {
			pi.appendEntry("coc-mechanics", entry);
		} catch {
			/* the projection must never break a turn */
		}
		// The bus event keeps its shape: `marked_text` is a rendering hint for the delivery channel,
		// not a fact about the turn, and a bus subscriber that wanted it would want the entry.
		pi.events.emit("coc:mechanics", { campaign: state.campaign, turn, mechanics, ...(labels ? { labels } : {}) });
	}

	/**
	 * Contract §50. A run ended with the turn still open and nothing delivered, so §38 will strand
	 * it — and §38.5's service sentence is the only thing the player gets. That sentence says the
	 * settled work is kept without saying what it was.
	 *
	 * Retained live evidence (`game-b4cebfe0`, turn 8, 2026-09-16): a campaign ruling, an NPC stance,
	 * a Swim check the investigator *passed* (54 against 70) and a +2 minute clock advance all landed
	 * with receipts; the continuity review then timed out. The record went to disk as
	 * `closed_how: null` with `rendered_text` empty, the player read one sentence naming none of it,
	 * and the retry opened a clean turn 9 — so those four receipts were never told to anyone. The
	 * state surface was whole and the delivery surface was gone.
	 *
	 * What is sent is not a substitute narration and is not the rejected draft (§34.14): it is the
	 * §16.2 mechanics projection, the same JSON a delivered turn's card is drawn from, read back from
	 * the kernel's own `table.status` rather than reconstructed here. The kernel decides what a row
	 * is and what visibility it carries (§16.5), so a keeper-only receipt stays keeper-only exactly as
	 * it would on a delivered turn, and the host neither writes prose nor reads receipts for meaning.
	 *
	 * Three ends (§31). *Writer:* here, once per turn, at the same `agent_settled` that owns §38.3's
	 * stranding predicate. *Reader:* the delivery channel that already draws every turn's card — the
	 * `coc-mechanics` entry and `coc:mechanics` bus event, with `undelivered: true` so a consumer that
	 * requires a delivery can still tell the two apart. *Actor:* the player, who can see that the dice
	 * fell and the clock moved before deciding what to say next.
	 */
	async function tellWhatSettled(state: TableState, turn: number): Promise<void> {
		let rows: Array<Record<string, unknown>> = [];
		let labels: unknown;
		try {
			const status = await state.kernel.call<Record<string, unknown>>("table.status", { campaign: state.campaign });
			rows = Array.isArray(status?.mechanics) ? (status.mechanics as Array<Record<string, unknown>>) : [];
			labels = status?.labels;
		} catch (error) {
			void record({ lane: "delivery", turn, ok: false, reason: "settled_without_delivery",
				detail: error instanceof Error ? error.message : String(error) });
			return;
		}
		// An empty card is a visibility verdict of its own, so a turn that settled nothing projectable
		// is given none. The row is still written: zero is a fact about that turn, and a lane that
		// wrote nothing at all could not be told from one that never ran.
		noteMechanics(state, turn, rows, undefined, labels, undefined, { undelivered: true });
		void record({ lane: "delivery", turn, ok: true, reason: "settled_without_delivery", rows: rows.length });
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
		// The one part of the Director section that is not advice (contract §40): when it is present the
		// player is blocked and the capsule names the operations that unblock them. Read once per capsule.
		const recovery = (capsule as { director?: { recovery?: unknown } }).director?.recovery as
			{ blocked?: unknown; steps?: unknown; note?: unknown; takes?: unknown } | undefined;
		if (recovery && typeof recovery === "object") {
			const steps = Array.isArray(recovery.steps)
				? recovery.steps.flatMap((row) => {
					const step = row as Record<string, unknown> | null;
					const operation = asString(step?.operation), line = asString(step?.line);
					return operation || line ? [[operation, line].filter(Boolean).join(" — ")] : [];
				})
				: [];
			state.recoveryOwed = { blocked: typeof recovery.blocked === "number" ? recovery.blocked : 0, steps };
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

	/**
	 * What discharges a recovery the Director asked for (contract §40), read from receipts alone.
	 *
	 * The keeper-pacing ladder in receipt form: information reached the player (`clue`, `handout`, `map`,
	 * `item`), a present person acted (`npc`), the place changed (`move`), a subsystem opened (`session`).
	 * Plus the rulebook's own retry: a pushed roll restates the stakes and takes the player's confirmation,
	 * so it is a step, while the same ordinary check opened fresh again is not — the Keeper Rulebook allows
	 * one retry of a failed check and only as a push. A check that simply went the player's way discharges
	 * it too: the obstacle moved, whatever the Director was told a turn earlier.
	 */
	function noteRecovery(state: TableState, result: Record<string, unknown>): void {
		if (state.recoveryLanded) return;
		const ids = Array.isArray(result.receipts) ? result.receipts.map(String) : [];
		if (ids.some((id) => RECOVERY_RECEIPT_KINDS.has(id.split(":")[0]))) {
			state.recoveryLanded = true;
			return;
		}
		const outcome = result.outcome as { passed?: unknown; pushed?: unknown } | undefined;
		if (outcome?.passed === true || outcome?.pushed === true) state.recoveryLanded = true;
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

	/**
	 * The one `lane: "speech"` row a delivery leaves (contract §40.3): how many spans were marked,
	 * how many resolved to a person, how many stayed a label, and how many people the capsule had on
	 * stage. This is what "every spoken line is wrapped" is measured against, per model; nothing here
	 * reads the spoken words, and a kernel that emits no `speech` leaves no row.
	 */
	function noteSpeech(state: TableState, result: Record<string, unknown>, turn: number): void {
		if (!Array.isArray(result.speech)) return;
		let resolved = 0, unresolved = 0;
		for (const row of result.speech) {
			const who = (row as { who?: unknown } | null)?.who;
			if (!who || typeof who !== "object") continue;
			const speaker = who as Record<string, unknown>;
			if (asString(speaker.npc) || asString(speaker.investigator)) resolved += 1;
			else if (asString(speaker.label)) unresolved += 1;
		}
		void record({ lane: "speech", turn, lines: result.speech.length, resolved, unresolved, present: state.present.length });
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
		const destinations: AdmissionDestination[] = [];
		if (tool === 'apply' && Array.isArray(payload.effects)) for (const effect of payload.effects as Array<Record<string, unknown>>) {
			if (effect.kind !== 'move' || typeof effect.to !== 'string' || destinations.some(value => value.requested === effect.to)) continue;
			try {
				const found = await state.kernel.call<{entities?: Array<Record<string, unknown>>}>('table.lookup',
					{campaign: state.campaign, kind: 'module', query: effect.to, expected_kind: 'scene', limit: 1});
				const entity = found.entities?.[0];
				// The place's authored names travel with the projection: without them the reviewer
				// reads the handle's slug as the place and refuses a move into the building the
				// player just named (contract 32; 2026-09-15, turns 83 and 86).
				if (entity) destinations.push(registeredDestination(effect.to, entity));
			} catch { /* The authoritative apply path will report a missing or invalid destination. */ }
		}
		const proposal = admissionRequest(tool, payload, { party: state.party.map((member) => member.name), scene: state.scene,
			...(destinations.length ? {destinations} : {}), ...(state.answering ? { answered: state.answering } : {}) });
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
			// A refusal costs the player the whole batch, and until now the row said only which verdict
			// came back: the reviewer's own reasons and the effects it was judging lived in the thrown
			// KernelError (which the Keeper reads and nobody keeps) and in a turn record whose `calls`
			// stay empty for a refused call. That left "the reviewer misread plain words" and "the batch
			// carried an effect nobody chose" indistinguishable after the fact -- 2026-09-15 turn 2,
			// where a player asked in plain words for the keys and the address he had just been
			// promised and the batch was refused whole. The grounds and the proposed effects are
			// what decide between those two readings, so a refusal now carries them.
			await record({ lane: "admission", verb: tool, ok: true, verdict: verdict.verdict, admitted, reused, ms, key: digest, ...(model ? { model } : {}),
				...(admitted ? {} : { grounds: verdict.grounds.slice(0, 200), ...(verdict.missing ? { missing: verdict.missing.slice(0, 160) } : {}), proposed: proposal.lines }) });
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
			state.admissionOutage += 1;
			const streak = state.admissionOutage;
			if (streak >= 2 && !state.admissionOutageNotified) {
				state.admissionOutageNotified = true;
				// The operator's surface (contract §32.2): out of fiction, once per streak, with the fix.
				const status = {
					campaign: state.campaign,
					turn: state.turn,
					status: "down",
					streak,
					cause: outcome.reason,
					detail: outcome.detail.slice(0, 200),
					...(outcome.model ? { model: outcome.model } : {}),
					fix: "The action review keeps failing, so player actions keep being refused. Switch the table to another model, or set PI_COC_ADMISSION_MODEL to a healthy provider/model and start a new session.",
				};
				try {
					pi.appendEntry("coc-admission-status", status);
				} catch {
					/* the notice must never break a turn */
				}
				pi.events.emit("coc:admission-status", status);
			}
			throw admissionUnavailable(proposal, outcome.reason, outcome.detail, streak);
		}
		// A live verdict, admitting or refusing, proves the review is back: the outage streak ends.
		state.admissionOutage = 0;
		state.admissionOutageNotified = false;
		await settle(outcome.verdict, false, outcome.ms, outcome.model);
	}

	function applyToolSuccess(state: TableState, tool: string, toolCallId: string, result: Record<string, unknown>): void {
		// A landed narrate is the proof that the review is back: it is the only verb the continuity
		// review gates, so its success -- not a turn boundary -- is what ends an outage streak.
		if (tool === "narrate") { state.reviewOutage = 0; state.reviewOutageNotified = false; }
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
				noteRecovery(state, result);
				break;
			case "apply": {
				state.state = "acting";
				noteLanded(state, tool, result);
				noteRecovery(state, result);
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
				// §86: the turn, not the run. A later run finds this and knows the player has read something.
				state.deliveredTurn = typeof result.turn === "number" ? result.turn : state.turn;
				state.renderedText = typeof result.rendered_text === "string" ? result.rendered_text : undefined;
				state.deliveryToolCallId = toolCallId;
				noteDelivered(state, result);
				noteSpeech(state, result, typeof result.turn === "number" ? result.turn : state.turn);
                if (result.interaction) pi.appendEntry("coc-choice", result.interaction);
				noteMechanics(state, typeof result.turn === "number" ? result.turn : state.turn,
					withHandouts(state, readMechanics(result)), asString(result.marked_text), result.labels,
					Array.isArray(result.speech) ? result.speech : undefined);
				noteStanding(state, result, typeof result.turn === "number" ? result.turn : state.turn);
				notePreparationWait(state, typeof result.turn === "number" ? result.turn : state.turn);
				break;
			}
			case "narrate": {
				state.state = "awaiting_player";
				state.openingPending = false;
				state.closedThisRun = true;
				// §86: the turn, not the run. A later run finds this and knows the player has read something.
				state.deliveredTurn = typeof result.turn === "number" ? result.turn : state.turn;
				state.renderedText = asString(result.rendered_text);
				state.deliveryToolCallId = toolCallId;
				noteDelivered(state, result);
				noteSpeech(state, result, typeof result.turn === "number" ? result.turn : state.turn);
				// From here on this turn owes a verifier-lane row, whatever the lane turns out to do (ticket #28).
				state.verifierOwed = { turn: typeof result.turn === "number" ? result.turn : state.turn };
				const mechanics = withHandouts(state, readMechanics(result));
				noteMechanics(state, typeof result.turn === "number" ? result.turn : state.turn, mechanics,
					asString(result.marked_text), result.labels, Array.isArray(result.speech) ? result.speech : undefined);
				noteCommit(state, result, mechanics);
				noteStanding(state, result, typeof result.turn === "number" ? result.turn : state.turn);
				notePreparationWait(state, typeof result.turn === "number" ? result.turn : state.turn);
				break;
			}
		}
	}

	// ---- Tools ------------------------------------------------------------
	/**
	 * Contract §91. The continuity review did not answer about this draft, so it did not refuse it:
	 * the Mod bridge let the delivery through and reports it here.
	 *
	 * Nothing about the turn changes -- it renders, commits and reaches the player like any other --
	 * so this is a record and an escalation, never a pause. `pauseReview` is the opposite branch and
	 * stays exactly as it is: a verdict the reviewer's own reading stands behind still ends the input.
	 *
	 * The streak is its own counter and not §38.5's. A landed `narrate` zeroes `reviewOutage`
	 * (§38.10), and every unreviewed delivery is a landed `narrate` -- counting these there would
	 * erase itself on the very turn it was meant to count. What zeroes this one is a review that
	 * answered: the next `narrate` or `ask` whose `prepare` returns without an unreviewed report.
	 */
	function noteUnreviewedDelivery(state: TableState, unreviewed: {cause: string; service: boolean}): void {
		const streak = (state.unreviewedStreak += 1);
		void record({ lane: "continuity-review", turn: state.turn, ok: true, reason: "delivered_unreviewed",
			cause: unreviewed.cause, service: unreviewed.service, streak });
		if (streak < 2 || state.unreviewedNotified) return;
		state.unreviewedNotified = true;
		// The operator surface of §38.5 and §56, with the one lever that is real: the lane model is
		// read when the lane runs (§37.10), so a change reaches the next review without a restart.
		// The player is told nothing: their turn arrived, and a table that plays is not a notice.
		const status = { campaign: state.campaign, turn: state.turn, status: "unreviewed", streak,
			cause: unreviewed.cause, service: unreviewed.service,
			fix: `The continuity review has not judged the last ${streak} deliveries (${unreviewed.cause}), so those turns`
				+ " were published without it. Play is unaffected. To get the review back, choose a quicker model under"
				+ " Lane model in settings: the lane reads that choice each time it runs, so a change reaches this table"
				+ " on its next review. PI_COC_MOD_MODEL still overrides the setting for the life of a session." };
		pi.appendEntry("coc-review-status", status);
		pi.events.emit("coc:review-status", status);
	}

	/** §91: a review that answered clears the unreviewed streak; only `narrate`/`ask` carry one. */
	function noteReviewAnswered(state: TableState): void {
		state.unreviewedStreak = 0;
		state.unreviewedNotified = false;
	}

	function pauseReview(state: TableState, error: unknown): void {
		const cause = isKernelError(error) ? String(error.details?.cause ?? error.message) : String(error);
		// Contract §38.9: the streak counts *service* outages, never the guard doing its job. A review
		// that ran, submitted and refused the one bounded repair `max_rewrites` permits ends the input
		// exactly as designed, and a table is not "down" because its reviewer disagreed twice. Retained
		// evidence (game-83177d61): turn 42's `max_rewrites` end became streak 1 and turn 43's dead
		// child streak 2, so the player was told another attempt was pointless and the operator was
		// handed a lane-model fix for a problem one of the two halves did not have.
		const observed = !isKernelError(error) || error.details?.service !== false;
		// Only the first pause of a run is an outage. Once the review is paused every later tool call
		// re-throws the same reason from the guard above, and counting those would turn one dead lane
		// into a streak inside a single run.
		const outage = state.reviewUnavailable === undefined;
		// §38.10: the kind belongs to the pause that stopped the review, and is pinned by the same first
		// pause that owns the streak. The guard's re-throw carries `cause` but no `service` at all, so
		// every later verb in the run reads as an outage; a verdict pause would otherwise be relabelled
		// a dead lane by its own second symptom -- in the player's notice, and on the operator entry,
		// which announced `service: true` for a review that had already answered.
		if (outage) state.reviewPauseService = observed;
		const service = state.reviewPauseService ?? observed;
		state.reviewUnavailable = cause; state.deliveryFix = undefined; state.floorDraft = undefined;
		if (outage && service) state.reviewOutage += 1;
		const streak = state.reviewOutage;
		const escalate = streak >= 2 && !state.reviewOutageNotified;
		if (escalate) state.reviewOutageNotified = true;
		// The operator's surface (contract §38, shaped like §32.2's): out of fiction, once per streak,
		// with the fix. The fix used to end "and then start a new session", because the lane model was
		// read into the session environment at spawn; it is now read when the lane starts its child
		// (contract §37.10), so the instruction is the one that actually works -- change it and send
		// again. Telling an operator to restart a table they could have kept is its own lost turn.
		const status = {campaign: state.campaign, turn: state.turn, status: escalate ? 'down' : 'unavailable', streak, cause, service,
			...(escalate ? {fix: 'The continuity review keeps failing, so finished turns cannot be published. ' +
				'Choose a faster review model in the Lane model setting: the lane reads that choice each time it runs, ' +
				'so a change reaches this table on its next review. ' +
				'PI_COC_MOD_MODEL still overrides the setting, but an environment variable is fixed for the life of a session.'} : {})};
		pi.appendEntry('coc-review-status', status);
		pi.events.emit('coc:review-status', status);
	}

	/**
	 * A provider call that ended in error, and what it owes whoever was waiting (contract §38.7).
	 *
	 * Retained live evidence (campaign `game-5779d0fd`, turn 3, 2026-09-14, from its own telemetry):
	 * one call hung for 300011 ms and came back `stop_reason: "error"` with no blocks at all; the
	 * immediate retry answered in 2.6 s and the turn then finished normally. The only thing the player
	 * ever saw was a spinner reading "still working, 3min49s", and afterwards nothing anywhere said
	 * that five of those six minutes had been an outage rather than the model thinking. That is the
	 * §38.5 defect in another lane: an infrastructure failure must not be indistinguishable from
	 * normal slowness, and a retry that succeeds is not a reason to erase the one that did not.
	 *
	 * The 300 s ceiling is not ours to move -- it is not set in this repository, pi gives an extension
	 * only the observational provider hooks, and there is no interception point at which a shorter
	 * deadline could be imposed. What is ours is the record. Nothing here may block or fail the turn:
	 * the entry is written best-effort and the player's word is sent at `agent_end`, after delivery.
	 */
	function noteProviderCall(stopReason: string | null, ms: number | null, detail: string | undefined,
		named: {model?: string; provider?: string} | undefined): void {
		const state = table;
		if (!state) return;
		// A completed assistant message is the proof the provider answered end to end, body stream
		// included -- so it, and not a turn boundary, is what ends a streak and clears a terminal failure.
		if (stopReason !== "error") {
			state.terminalProviderFailure = undefined;
			state.providerOutage = 0;
			state.providerOutageNotified = false;
			return;
		}
		state.providerOutage += 1;
		const streak = state.providerOutage;
		state.terminalProviderFailure = { ms, streak };
		const escalate = streak >= 2 && !state.providerOutageNotified;
		if (escalate) state.providerOutageNotified = true;
		// The player is told only about a call that hung long enough to be the wait they sat through.
		// A provider that errors in a second and is retried successfully is a blip, and a service
		// notice for it would be noise on a turn that went fine; the operator record is written either way.
		if (ms !== null && ms >= providerNoticeAfterMs()) state.providerFailure = {ms, streak};
		const status = {campaign: state.campaign, turn: state.turn, status: escalate ? "down" : "unavailable",
			streak, ...(ms === null ? {} : {ms}), ...(named?.model ? {model: named.model} : {}),
			...(named?.provider ? {provider: named.provider} : {}),
			...(detail ? {detail: detail.slice(0, 200)} : {}),
			...(escalate ? {fix: "Provider calls for this table keep dying with no answer, and a dead call is " +
				"charged to the player as waiting. Check the provider's status and this machine's route to it, " +
				"or move the table to another provider/model."} : {})};
		try { pi.appendEntry("coc-provider-status", status); }
		catch { /* the notice must never break a turn */ }
		pi.events.emit("coc:provider-status", status);
	}

	async function emitProviderNotice(state: TableState, failure: { ms: number; streak: number }, terminal: boolean,
		turn: number): Promise<void> {
		const seconds = Math.round(failure.ms / 1000);
		let line = terminal
			? `This turn could not finish because the connection to the model returned no result. Nothing you did was lost — send anything to continue.`
			: failure.streak >= 2
				? `The connection to the model has now dropped ${failure.streak} times in a row, the last after about ${seconds}s with nothing returned. That wait was an outage, not the Keeper thinking, and the person running this table has been told.`
				: `The connection to the model dropped during this turn: about ${seconds}s of the wait returned nothing at all, and the request had to be made again. That was an outage, not the Keeper thinking, and nothing you did was lost.`;
		try {
			// All keys are written out here: the caption inventory is found by scanning these call
			// sites, and a key held in a variable is a shipped word nothing asks for.
			line = (await surface.words()).line(terminal ? "provider_failed_notice"
				: failure.streak >= 2 ? "provider_down_notice" : "provider_outage_notice",
				{ seconds, streak: failure.streak });
		} catch {
			/* an unreadable content root still owes the player the English line */
		}
		pi.sendMessage({ customType: "coc-delivery", content: line, display: true,
			details: { coc_delivery: true, turn, provider_outage: true, terminal, streak: failure.streak, ms: failure.ms } });
		void record({ lane: "delivery", turn, ok: true, reason: "provider_outage_notice",
			streak: failure.streak, ms: failure.ms, terminal });
	}

	function scheduleProviderNotice(state: TableState, failure: { ms: number; streak: number }, terminal: boolean,
		turn = state.turn): void {
		if (state.providerNoticeSent) return;
		// Reserve synchronously so review/provider overlap cannot schedule two messages. Emitting on the
		// next task keeps pi.sendMessage outside agent_settled; a queued next turn may reset the flag, but
		// this captured notice neither reads nor writes that new run's state.
		state.providerNoticeSent = true;
		setTimeout(() => void emitProviderNotice(state, failure, terminal, turn), 0);
	}

	/**
	 * Contract §38.11: the table cannot write its history, said to the player as a service notice.
	 * The generic "this turn ended without a delivered result" is true and useless here -- the host
	 * knows exactly what failed, and a player who is told only that the turn ended will send again.
	 */
	async function emitCommitDownNotice(state: TableState, failure: { cause: string; streak: number }, turn: number): Promise<void> {
		const streak = failure.streak;
		let line = `This turn could not be saved: the table's history store has refused to write ${streak} times in a row, so nothing can be`
			+ " recorded and no turn can be delivered until it is repaired. Nothing you did was lost, and the person running this table has"
			+ " been told what to fix.";
		try { line = (await surface.words()).line("commit_down_notice", { streak }); }
		catch { /* an unreadable content root still owes the player the English line */ }
		pi.sendMessage({ customType: "coc-delivery", content: line, display: true,
			details: { coc_delivery: true, turn, commit_unavailable: true, streak } });
		void record({ lane: "delivery", turn, ok: true, reason: "commit_down_notice", streak, cause: failure.cause });
	}

	/**
	 * Contract §34.17: the delivery the player just read was the first half of one the Keeper wrote in
	 * two, and the second half was refused because the first had already closed the turn.
	 *
	 * A-MAIN turn 39, 2026-09-16: one assistant message carried two `narrate` calls; the first landed
	 * and closed the turn ending, verbatim, on a colon, and the second -- which carried the line of
	 * speech -- was correctly blocked (`blocked_after_close: 1`). Receipts landed, so nothing said the
	 * turn was empty; nothing said it was truncated either, and the player was left reading a sentence
	 * that stops. The counter proves the host knew. This is the host saying it.
	 */
	async function emitCutShortNotice(state: TableState, turn: number): Promise<void> {
		let line = "The Keeper wrote this turn in two parts and the second was refused after the turn had already closed, so what you just"
			+ " read stops early. Everything already settled is kept — send anything and the Keeper picks it up from there.";
		try { line = (await surface.words()).line("delivery_cut_short_notice"); }
		catch { /* an unreadable content root still owes the player the English line */ }
		// §50, §86: `triggerTurn: false`. This notice is sent from `agent_end`; without the flag pi
		// queues it as a steer and continues the run for it, and that continuation lands on a turn that
		// is still closed with nothing it may do. On `t10` turn 0 the notice below did exactly that and
		// bought 15 more refusals and a runaway cut. The host's own notice is not a prompt.
		pi.sendMessage({ customType: "coc-delivery", content: line, display: true,
			details: { coc_delivery: true, turn, delivery_cut_short: true } },
			{ triggerTurn: false });
		void record({ lane: "delivery", turn, ok: true, reason: "delivery_cut_short_notice" });
	}

	/**
	 * Contract §78: an effect the host refused, and a delivery that could not carry the answer.
	 *
	 * H-SIDE `t4` turn 103, 2026-09-17: one assistant message carried the closing `narrate` and,
	 * behind it, the `apply` that turns 95-103 existed for -- writing one precise location onto an
	 * already-filed complaint. The narrate closed the turn, the apply was correctly blocked
	 * (`blocked_after_close: 1`, the only one of the four on that build that happened in play), and
	 * `object-item-15` kept `changed_turn: 92`. The prose said it was filed. Nothing on any surface a
	 * player can see said otherwise, and the cost of that lands whenever someone acts on the record.
	 *
	 * This says only what the host knows for certain: an effect was refused, and the turn the player
	 * just read was written before that was known. It does not say what the prose claimed -- nothing
	 * here reads the prose, and the ban on doing so is what makes the ordering the whole signal.
	 */
	async function emitRefusedEffectNotice(state: TableState, turn: number): Promise<void> {
		let line = "Something the Keeper tried to record this turn was refused, and this turn’s text was written before that was known — so"
			+ " take what you just read about it as uncertain. Nothing else settled was lost; say anything and the Keeper can put it right.";
		try { line = (await surface.words()).line("refused_effect_notice"); }
		catch { /* an unreadable content root still owes the player the English line */ }
		// §50, §86: `triggerTurn: false` -- see `emitCutShortNotice`. This is the notice that was
		// measured doing it: `t10` turn 0, 2026-09-17, the notice at 05:00:53 and the Keeper's next
		// blocked call at 05:00:58, on a turn that had been closed since 04:59:55.
		pi.sendMessage({ customType: "coc-delivery", content: line, display: true,
			details: { coc_delivery: true, turn, refused_effect: true } },
			{ triggerTurn: false });
		void record({ lane: "delivery", turn, ok: true, reason: "refused_effect_notice" });
	}

	/**
	 * Contract §47: the host's own preparation state, said by the host, out of fiction, and only
	 * while it is still true.
	 *
	 * The two waits differ in how freshness is read and in nothing else. An adaptation is a named job
	 * with a status verb, so the notice asks the kernel; a source reading has no such verb, so it asks
	 * the reading service whether that material is still in flight. Either answer arriving as "no
	 * longer waiting" cancels the notice outright rather than softening it — on `game-1c0faba5` turn 3
	 * the Keeper's own sentence was 20 s stale when the player read it, and on `game-b4cebfe0` the
	 * reading landed seconds after the wait it was still being described by.
	 *
	 * Nothing here reads prose, and nothing here decides a language: the line is one authored English
	 * caption projected for this table's play language by the words lane, like every other notice.
	 */
	async function emitPreparationWaitNotice(state: TableState, wait: { kind: string; name?: string }, turn: number): Promise<void> {
		const standing = await preparationStanding(state, wait);
		if (!standing) {
			void record({ lane: "delivery", turn, ok: true, reason: "preparation_wait_notice_withheld",
				kind: wait.kind, ...(wait.name ? { name: wait.name } : {}) });
			return;
		}
		const landed = standing === "landed";
		let line = landed
			? "The place the Keeper needed is ready now, so the next turn can take you there. Nothing you did was lost — say anything to go on."
			: wait.kind === "source"
			? "Part of the source this table needs is still being read, so the Keeper could not use it this turn. Nothing you did was lost, and nothing else at the table is blocked — send anything to continue."
			: "This table is still preparing a place the Keeper needed, so it could not take you there this turn. Nothing you did was lost — send anything to continue, and the Keeper picks it up once the preparation lands.";
		// The key is written at the call site, not held in a variable: the caption registry is found by
		// a static scan of quoted identifiers inside `.line(...)`, so a key in a variable is a shipped
		// word nothing asks for (`extension-words`, "caption keys are found by static scan").
		try {
			const words = await surface.words();
			line = landed ? words.line("adaptation_ready_notice")
				: wait.kind === "source" ? words.line("source_wait_notice") : words.line("adaptation_wait_notice");
		}
		catch { /* an unreadable content root still owes the player the English line */ }
		// §50: `triggerTurn: false`. This notice is scheduled from `applyToolSuccess`, on a turn that
		// delivered, so on a live table it is sent while that run is still streaming — and
		// `sendCustomMessage` turns a send with the flag left off into `agent.steer()`, which reopens
		// the agent loop and buys the Keeper a provider call to answer the host's own out-of-fiction
		// sentence with. The flag says what this message is either way: not a prompt.
		//
		// **Not measured, and the seam suite cannot measure it.** The notice does its own async work
		// first (here a kernel read, in `emitStandingNotice` a content read), and the faux provider
		// finishes a whole run without ever yielding to the macrotask queue, so in the harness the
		// send always lands after the run and reads as a plain append. A real provider call takes
		// seconds of socket I/O, so there the timer fires mid-run. The proven case is §38.5's notice,
		// which is sent inline from `agent_end` (`settled-turn-is-told.test.mjs`).
		pi.sendMessage({ customType: "coc-delivery", content: line, display: true,
			details: { coc_delivery: true, turn, preparation_wait: { kind: wait.kind, ...(wait.name ? { name: wait.name } : {}), ...(landed ? { landed: true } : {}) } } },
			{ triggerTurn: false });
		void record({ lane: "delivery", turn, ok: true, reason: landed ? "preparation_ready_notice" : "preparation_wait_notice",
			kind: wait.kind, ...(wait.name ? { name: wait.name } : {}) });
	}

	/**
	 * The re-read §47 exists for: the state as it stands now, not as the Keeper last saw it.
	 *
	 * §75. "Not still running" has two meanings and the notice needs both. `landed` is the answer
	 * arriving — the place exists, reviewed, waiting only for the table's `apply` — and `null` is the
	 * work being gone (accepted, cancelled, failed, stale, none, or a kernel that will not answer).
	 * Collapsing them is what silenced the player: on `game-1c0faba5` all four preparations reached
	 * `ready` within seconds of the delivery that was waiting for them, so all four notices were
	 * withheld and four zero-receipt turns arrived with no word of why.
	 */
	async function preparationStanding(state: TableState, wait: { kind: string; name?: string }): Promise<"waiting" | "landed" | null> {
		if (wait.kind === "source") {
			// A bridge too old to answer cannot be made to lie: with no way to re-read, the host does
			// not claim the reading is still running. A reading has no `ready` of its own to report --
			// it has no status verb and nothing to accept -- so it answers this question in two states.
			if (!reading?.reading || !readingModule) return null;
			try { return reading.reading(readingModule, { focus: wait.name ?? "", question: state.sourceWait?.question ?? "" }) ? "waiting" : null; }
			catch { return null; }
		}
		// The kernel, because the kernel is the authority §36.15 already re-derives the wait from. This
		// host's own task map would be cheaper and is not the same question: a child that has exited
		// here says nothing about a job the kernel still holds as `pending`. So the notice costs one
		// `adaptation.status` per delivered turn that carries a wait, and none otherwise.
		try {
			const current = await state.kernel.call<Record<string, unknown>>("adaptation.status",
				wait.name ? { campaign: state.campaign, name: wait.name } : { campaign: state.campaign });
			const status = asString(current.status) ?? "";
			// Strictly narrower than `ADAPTATION_HELD`: `ready` is a decision the Keeper owes an answer
			// to, and it is not, to the player, "still being prepared". It is still something the player
			// is owed a line about, so it answers `landed` rather than nothing (§75).
			if (["pending", "reviewing"].includes(status)) return "waiting";
			return status === "ready" ? "landed" : null;
		} catch { return null; }
	}

	/**
	 * §47. A delivery landed while the host was holding a preparation wait, so the player is owed
	 * the host's half of it. On the next task, for the same reason the provider and standing notices
	 * are: `pi.sendMessage` stays outside the tool result, and the player reads the delivery first.
	 * Once per turn — the wait outlives the turn (§36.15) but the sentence about it does not.
	 */
	function notePreparationWait(state: TableState, turn: number): void {
		const wait = state.preparationWait
			? { kind: state.preparationWait.kind, ...(state.preparationWait.name ? { name: state.preparationWait.name } : {}) }
			: state.sourceWait
				? { kind: "source", ...(state.sourceWait.focus ? { name: state.sourceWait.focus } : {}) }
				: undefined;
		if (!wait || state.waitNoticeTurn === turn) return;
		state.waitNoticeTurn = turn;
		setTimeout(() => void emitPreparationWaitNotice(state, wait, turn).catch(() => {
			/* the notice must never break a turn */
		}), 0);
	}

	/**
	 * Contract §71. The player pressed the resend button on words the table is still working on. Nothing
	 * is semantic: it is the same string, in the same session, while the turn carrying it is alive, and
	 * a machine can say so without reading a word of it. What the product could not do until now was
	 * *say* so — on the retained table the duplicate ran as a second turn and the player was told
	 * nothing, anywhere.
	 *
	 * So the resend is held rather than run, and the holding is said out loud at once, on the channel
	 * the other service notices use: the player is looking at the screen they just pressed a button on.
	 */
	async function emitResendHeldNotice(state: TableState, turn: number): Promise<void> {
		let line = "That is the message the table is already working on, word for word, so it was not started a second time. The turn you sent it for is still running.";
		try { line = (await surface.words()).line("resend_held_notice"); }
		catch { /* an unreadable content root still owes the player the English line */ }
		pi.sendMessage({ customType: "coc-delivery", content: line, display: true,
			details: { coc_delivery: true, turn, resend_held: true } },
			{ triggerTurn: false });
		void record({ lane: "delivery", turn, ok: true, reason: "resend_held_notice" });
	}

	/**
	 * Contract §71: is this arrival a resend of the turn that is running?
	 *
	 * Exact equality, and nothing else. No similarity, no normalisation, no prefix — a resend is the
	 * same bytes because the button sends the same bytes, and any looser test would be a reading of
	 * what the player meant. An arrival carrying images is never one: the button sends text alone, so
	 * images mean the player composed something, however identical the words.
	 */
	function isResendOfRunningTurn(state: TableState, event: { text: string; images?: ImageContent[] }): boolean {
		if (event.images?.length) return false;
		if (state.state !== "open" && state.state !== "acting") return false;
		return typeof state.playerText === "string" && state.playerText.length > 0 && event.text === state.playerText;
	}

	async function emitTurnUnfinishedNotice(state: TableState, turn: number): Promise<void> {
		let line = "This turn ended without a delivered result. Anything already settled is kept — send anything to continue.";
		try { line = (await surface.words()).line("turn_unfinished_notice"); }
		catch { /* an unreadable content root still owes the player the English line */ }
		pi.sendMessage({ customType: "coc-delivery", content: line, display: true,
			details: { coc_delivery: true, turn, turn_unfinished: true } });
		void record({ lane: "delivery", turn, ok: true, reason: "turn_unfinished_notice" });
	}

	function scheduleTurnUnfinishedNotice(state: TableState, turn = state.turn): void {
		if (state.turnNoticeSent) return;
		state.turnNoticeSent = true;
		setTimeout(() => void emitTurnUnfinishedNotice(state, turn), 0);
	}

	/**
	 * Contract §42.6: a state that takes the action away stays in front of the player for as long as
	 * it stands, said by the host and not left to the Keeper's prose.
	 *
	 * `game-83177d61` turn 107 settled `unconscious` and the card said so. Turns 108 to 114 settled
	 * nothing, so they carried no condition row at all, and what finally reached the player hours
	 * later was the Keeper choosing to write the state into the fiction -- that he could not move.
	 * That works and it is not guaranteed: it depends on a Keeper being diligent with the capsule's
	 * `cannot_act`, and a less diligent one puts the table straight back into three turns of
	 * declaring actions for an unconscious man.
	 *
	 * So it rides the channel the service notices already use -- out of fiction, beside the delivery,
	 * where the player is already looking when they decide what to say next. That is the difference
	 * between this and the character sheet, which carries the same states (§42.6) and which the player
	 * of the retained table never opened.
	 *
	 * Said every turn the state stands, and never on the turn it changed: the kernel withholds
	 * `standing` for a subject whose conditions this turn settled, because the delivery card's own
	 * `condition` row already names the state and stamps `cannot act`.
	 */
	async function emitStandingNotice(state: TableState, standing: Array<Record<string, unknown>>, turn: number): Promise<void> {
		// The condition names are the delivery card's vocabulary, read from the surface that owns them
		// rather than copied onto this one. Which names arrive is the rules engine's answer
		// (`INCAPACITATING_CONDITIONS`), decided when the delivery was projected: nothing here reads a
		// condition's name to judge what it does.
		const words = await surface.words();
		const lines = standing.map((row) => {
			const named = (Array.isArray(row.conditions) ? row.conditions : [])
				.map((value) => (typeof value === "string" && value ? words.wordOn("mechanics", `condition.${value}`) : ""))
				.filter(Boolean);
			return words.line("standing_condition_notice", { name: asString(row.name) ?? asString(row.investigator) ?? "", state: named.join(" / ") });
		}).filter(Boolean);
		if (lines.length === 0) return;
		// §50: `triggerTurn: false`, for the same reason and with the same caveat as the preparation-wait
		// notice above — scheduled from `applyToolSuccess`, so on a live table it is sent inside the
		// delivered turn's run, where a send without the flag is `agent.steer()` and costs one provider
		// call for every turn the state stands. Not measured: see the note on that send.
		pi.sendMessage({ customType: "coc-delivery", content: lines.join("\n"), display: true,
			details: { coc_delivery: true, turn, standing_conditions: standing } },
			{ triggerTurn: false });
		void record({ lane: "delivery", turn, ok: true, reason: "standing_condition_notice", standing: standing.length });
	}

	/** The states standing on the party that a delivery says take the action away (§42.6). */
	function noteStanding(state: TableState, result: Record<string, unknown>, turn: number): void {
		const standing = (Array.isArray(result.standing) ? result.standing : [])
			.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
		if (standing.length === 0) return;
		// On the next task, for the same reason the provider notice is: `pi.sendMessage` stays outside
		// the tool result, and the player reads the delivery before the line about it.
		setTimeout(() => void emitStandingNotice(state, standing, turn).catch(() => {
			/* the notice must never break a turn */
		}), 0);
	}

	/**
	 * §36.15. Re-derive the adaptation wait from the kernel at the turn boundary, rather than trusting
	 * the status captured when the proposal was prepared.
	 *
	 * A job is pinned to the world it was prepared against, so it can die between turns with nobody
	 * told: the background creator's next kernel call is refused `adaptation_stale`, `adaptation.fail`
	 * declines to touch an already-stale job, and nothing else ever looks. On campaign game-ef7545c5
	 * (2026-09-16) the captured status stayed `pending` for the rest of the session, and the gate went
	 * on telling the Keeper that the preparation "is still running" on every later turn.
	 * The player, a pawnbroker walking into his own shop, was refused twice for a job that had been
	 * over for three minutes, and no call anywhere in the product would have restarted it.
	 *
	 * The boundary is where it is re-read because the boundary is where it can change: the pin is
	 * world/party/worldline plus source generation, and the gate fires on every tool call of every
	 * turn. So this costs one `adaptation.status` per player input while a wait stands, and nothing at
	 * all when none does — the once-per-session scan for a job this process never saw is the same call.
	 */
	async function refreshAdaptationWait(state: TableState): Promise<void> {
		const held = state.preparationWait;
		if (!held && state.adaptationScanned) return;
		state.adaptationScanned = true;
		try {
			const current = await state.kernel.call<Record<string, unknown>>('adaptation.status',
				held?.name ? {campaign: state.campaign, name: held.name} : {campaign: state.campaign});
			const status = asString(current.status) ?? '', name = asString(current.name) ?? held?.name;
			// §60. `stale` and `failed` are terminal, and terminal is not a wait. Holding the turn for
			// a job that will never finish is what made the detour unreachable; the Keeper is told
			// once, by name and with the kernel's own cause, in the gate.
			const cause = asString(current.reason);
			// `ADAPTATION_HELD` is asked first on purpose: it is the list that decides whether a status
			// holds the table, so putting a terminal status back into it has to change behaviour and
			// fail a test. Asking `ADAPTATION_OVER` first would have made the two lists overlap
			// silently, and a later edit could have restored §60's defect without anything noticing.
			if (name && ADAPTATION_HELD.includes(status)) {
				state.preparationWait = { kind: 'adaptation', name, status };
			} else if (name && ADAPTATION_OVER.includes(status)) {
				state.preparationWait = undefined;
				// Only a wait this process was actually holding is worth a notice. The notice exists to
				// correct a belief the Keeper holds — "the place I asked for is being built" — and a
				// Keeper that has just come up holds no such belief: it has never heard of this job.
				// So the cold scan never announces a corpse, and the second half of §60 costs nothing
				// even if a store somewhere still offers one.
				if (held) state.adaptationOver = { name, status, ...(cause ? { cause } : {}) };
			} else state.preparationWait = undefined;
			// §47. `held` is the wait as it stood on the way *in*, so this used to record nothing on the
			// turn a wait was first taken up — the one turn whose behaviour changes most. Six tables
			// read as "zero failures" partly for that reason: the suspension itself was invisible.
			// Recording whenever a wait stands on either side of the re-read makes the first one legible.
			// §60. The cause was on disk and in this very result all along -- `status: "failed"` with no
			// `cause` beside it is every adaptation row three retained tables recorded, and it is why
			// nobody could say why any of those proposals failed.
			if (held || state.preparationWait || state.adaptationOver) await record({ lane: 'adaptation', turn: state.turn, proposal: name ?? null,
				status: status || 'none', held: state.preparationWait !== undefined, first: !held && state.preparationWait !== undefined,
				...(cause ? { cause } : {}) });
		} catch { /* Named status remains the diagnostic path; recovery discovery never blocks player input. */ }
	}

	/**
	 * The one call that revives a proposal that is over, named in full (Agents.md: a Keeper executes the
	 * `fix` text literally, and this repo has already been burned by a vague one). Preparation, not a
	 * status poll: `status` only reports, and there is nothing left to report.
	 */
	function overAdaptationInstruction(over: NonNullable<TableState["adaptationOver"]>): string {
		const { name, status, cause } = over;
		// §60. A failed proposal is the other half of this notice, and it is not stale: the pin never
		// moved, the work was attempted and refused. The difference matters in the one place a Keeper
		// acts on -- the call that revives it. `prepare` alone answers a retained non-stale job with
		// its own dead view (kernel-ts/adaptation/jobs.ts), so a failed proposal needs `retry=true` or
		// the instruction is a loop, which is exactly the trap Agents.md records for `fix` text.
		const head = status === "failed"
			? `The adaptation preparation for ${name} has failed, not stalled and not still running: the retained attempt was made and gave up.`
				+ (cause ? ` The reason it gave is: ${cause}.` : ``)
			: `The adaptation preparation for ${name} is stale, not running: it was pinned to the world it was prepared against, that world has moved, and the retained work was abandoned.`;
		const revive = status === "failed"
			? `call lookup kind=adaptation action=prepare name=${JSON.stringify(name)} retry=true with the same purpose, anchors and request; retry=true is what starts a fresh attempt instead of handing back this same failure.`
			: `call lookup kind=adaptation action=prepare name=${JSON.stringify(name)} with the same purpose, anchors and request; that is the only call that revives it and it starts a fresh attempt pinned to this turn.`;
		return head
			+ ` Nothing was built — no scene, person or handout from it exists — and nothing will finish it.`
			+ ` If the player is still going there, ${revive}`
			+ ` Otherwise settle this turn without that destination and do not tell the player anything is still being prepared.`
			+ ` This one call was refused so you would read this first; send it again if it is still what you want.`;
	}

	/**
	 * Contract 41.1: `table.player_input` refused, so no turn opened and nothing at the table moved. The
	 * only part of that call the player writes is a non-empty `text`, which the host checked before
	 * calling, so this refusal is never something the player can reword away -- and telling them to say it
	 * again is an instruction that cannot work. The player gets the one fact they can act on; the reason,
	 * which is an operator's repair and not a player's, goes to the operator entry beside it.
	 */
	async function emitInputRefusedNotice(state: TableState, error: unknown, turn: number): Promise<void> {
		let line = "The table could not take that input. This is a fault at the table, not your wording — saying it again "
			+ "will fail the same way. Nothing moved: the story is exactly where it was, and the person running this table "
			+ "has been given the reason.";
		// All keys are written out here: the caption inventory is found by scanning these call sites,
		// and a key held in a variable is a shipped word nothing asks for.
		try { line = (await surface.words()).line("table_input_refused_notice"); }
		catch { /* an unreadable content root still owes the player the English line */ }
		pi.sendMessage({ customType: "coc-delivery", content: line, display: true,
			details: { coc_delivery: true, turn, input_refused: true, code: isKernelError(error) ? error.code : "internal" } });
		try {
			pi.appendEntry("coc-table-status", {
				kind: "player-input-refused", campaign: state.campaign, turn,
				code: isKernelError(error) ? error.code : "internal",
				message: error instanceof Error ? error.message : String(error),
				...(isKernelError(error) && error.fix ? { fix: error.fix } : {}),
				...(isKernelError(error) && error.details !== undefined ? { details: error.details } : {}),
			});
		}
		catch { /* the notice must never break a turn */ }
		void record({ lane: "delivery", turn, ok: true, reason: "input_refused_notice",
			code: isKernelError(error) ? error.code : "internal" });
	}

	function scheduleInputRefusedNotice(state: TableState, error: unknown, turn = state.turn): void {
		if (state.turnNoticeSent) return;
		// Reserve the run's one player notice: a refused input already told the player the turn produced
		// nothing, so `agent_settled` must not follow it with the generic unfinished-turn line.
		state.turnNoticeSent = true;
		setTimeout(() => void emitInputRefusedNotice(state, error, turn), 0);
	}

	/**
	 * Contract 41.1: the empty message is the one refusal the player can actually repair, so the host
	 * answers it itself rather than spending a kernel call to be told the same thing in the one error code
	 * a bad manifest also uses.
	 */
	async function emitEmptyInputNotice(state: TableState, turn: number): Promise<void> {
		let line = "That message had no text in it, so nothing reached the table. Say what you want to do.";
		try { line = (await surface.words()).line("empty_input_notice"); }
		catch { /* an unreadable content root still owes the player the English line */ }
		pi.sendMessage({ customType: "coc-delivery", content: line, display: true,
			details: { coc_delivery: true, turn, empty_input: true } });
		void record({ lane: "delivery", turn, ok: true, reason: "empty_input_notice" });
	}

	function preparationWaitInstruction(state: TableState, wait: NonNullable<TableState["preparationWait"]>): string {
		if (wait.status && !['pending', 'reviewing'].includes(wait.status))
			// §47. `ADAPTATION_HELD` keeps `ready` as a wait because the table owes it an answer before
			// it acts — there are reviewed changes there for `apply` to accept. That is a fact about
			// the Keeper's obligations and not about the work, and the difference is not cosmetic: on
			// campaign game-ef7545c5 (t7) the single `lane: "adaptation"` row in 785 lines reads
			// `{"proposal":"<the camera shop>","status":"ready","held":true}` — the place had been built,
			// reviewed and marked ready — and the player was told the table was "still checking it
			// against the original book". A finished job described as unfinished is not a rough edge in
			// the wording, it is false. So this branch says, in the same breath as the status, that the
			// work is over.
			return `Retained adaptation preparation${wait.name ? ` for ${wait.name}` : ''} is ${wait.status}, which means it has finished: nothing is still being prepared and nothing is still running.`
				+ ` Use lookup kind=adaptation action=status${wait.name ? ` name=${JSON.stringify(wait.name)}` : ''} before any other tool, then follow that result. Do not invent or restart it under another name.`
				+ ` Never tell the player this is still being prepared, still being checked, or still pending — it is not, and the host has already told them whatever they needed to know out of fiction.`;
		if (state.landed.length > 0) {
			return `Adaptation preparation${wait.name ? ` for ${wait.name}` : ""} is still running, but this turn already settled: ${state.landed.join("; ")}. Use narrate to deliver exactly those settled consequences. Do not erase, repeat, or extend the settled effects, and do not introduce any fact the pending preparation has not supplied.${HOST_SAYS_THE_WAIT} Then return control without a story menu.`;
		}
		// "Inspect the same proposal after new player input" named no call, and on campaign
		// game-ef7545c5 the Keeper answered it by repeating `lookup kind=module` and being blocked
		// twice. The verb that reports on a proposal is named here in full; the host re-reads the
		// status at every turn boundary anyway, so this is for a Keeper that wants to look, not a poll
		// it owes.
		return `Adaptation preparation${wait.name ? ` for ${wait.name}` : ""} is still running. Use narrate to take up what the player actually said and close the turn on it, without moving, charging, or introducing the destination.${HOST_SAYS_THE_WAIT}`
			+ ` The only call that reports on it is lookup kind=adaptation action=status${wait.name ? ` name=${JSON.stringify(wait.name)}` : ""}; no module or source lookup can say anything about it.`;
	}

	/**
	 * Contract §22. An unread page is a fact about *that* material, not about the table, and this
	 * instruction says so in both directions: the named material is unavailable, and everything else
	 * still settles. It replaces a session-wide "source preparation is pending, use narrate only"
	 * that, on campaign game-3dd94f0a (2026-09-15), made the Keeper refuse a player who went to his
	 * own hotel room to hold his own negatives up to the window -- the reading that was pending was of
	 * a museum he was not in. Shaped after §32.2's `admissionUnavailable`: name what is unsettled,
	 * keep what already settled, and never ask the player to resend words that were never the problem.
	 */
	function sourceWaitInstruction(state: TableState, wait: NonNullable<TableState["sourceWait"]>): string {
		const named = wait.focus ? ` for ${wait.focus}` : "";
		const landed = state.landed.length > 0
			? ` This turn already settled: ${state.landed.join("; ")} — deliver exactly those consequences and do not erase, repeat or extend them.`
			: "";
		return `The source material${named} is still being read, so only what that reading would supply is unavailable.${landed}`
			+ " Nothing else at this table is blocked: what the investigators already carry, whoever is already on stage, the scenes and people the graph already knows, and ordinary narration all settle as usual, with their own receipts."
			+ " Do not request that same material again this turn, do not narrate what it would have said, and do not imply that the unsettled part happened or that game time passed for it."
			+ ` Settle whatever the player's own action can reach without it and return control without a story menu.${HOST_SAYS_THE_WAIT}`;
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
		// Whether this narrate closes the opening turn, read before the success path clears the flag: the
		// Keeper's opening is the one delivery that carries the beginner's "?" fold (opening-guidance §4).
		const closesOpening = spec.name === "narrate" && state.openingPending;
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
			if (spec.name === "recall") {
				delete payload._snapshot;
				delete payload._context_read;
				const {_context_read: _privateRead, ...publicParams} = params;
				Object.assign(payload, state.recallPages.prepare(publicParams));
			}
			if (state.reviewUnavailable) throw new KernelError({code: 'needs', message: 'The review is paused until new player input',
				details: {reason: 'continuity_review_unavailable', cause: state.reviewUnavailable}});
			// The recovery gate (contract §40). The Director asked for a recovery this turn and nothing that
			// counts as one has landed, so the first narrate is refused once and the capsule's own operations
			// come back as the fix. Spent once per turn and never on `ask`: whatever the second leg brings
			// closes the turn, so a Keeper that cannot find a step cannot hang the table on this.
			// It is the only thing in the system that makes a Director signal a step instead of a line --
			// campaign game-83177d61 declined 43 of 52 of them, 17 RECOVERs among them, at no cost.
			if (spec.name === "narrate" && state.recoveryOwed && !state.recoveryLanded && !state.recoverySteered && !state.steeredThisTurn) {
				state.recoverySteered = true;
				await record({ lane: "recovery", turn: state.turn, blocked: state.recoveryOwed.blocked,
					steps: state.recoveryOwed.steps.length, round_trips: state.roundTrips });
				throw new KernelError({ code: "needs",
					message: "This turn owes the player a recovery and nothing that counts as one has landed",
					fix: "Take one of the Director's recovery steps, then narrate: "
						+ (state.recoveryOwed.steps.join(" | ") || "hand the player something a present person, this room or a way out already holds")
						+ ". One receipt of kind clue, move, npc, session, handout, map or item discharges it, and so does a pushed roll or a check the player passes."
						+ " Do not choose for the player, do not skip a risk the book gates with a check, and do not answer this by describing the same state in new words:"
						+ " put the way forward within reach and let them take it. Nothing has happened yet; this draft was not delivered.",
					details: { reason: "recovery_owed", blocked: state.recoveryOwed.blocked, steps: state.recoveryOwed.steps } });
			}
			if (spec.name === "lookup" && params.kind === "source") {
				if (!asString(params.query)?.trim()) throw new KernelError({
					code: "invalid_params", message: "Source lookup needs a named query; question supplies additional scope",
					fix: "pass the place or entity as query and describe the unresolved source question" });
				if (!reading || !readingModule) throw new KernelError({ code: "needs", message: "the source reading service is unavailable",
					fix: "reopen the table with its module reading extension available", details: { reason: "reading_failed" } });
				const sourceRead = { purpose: "detail", focus: params.query, question: params.question ?? "" };
				try { await reading.ensure(readingModule, { ...sourceRead, retry: params.retry === true, foreground: true }, signal); }
				catch (readFailure) { throw sourceMaterialRefusal(readFailure, sourceRead); }
				payload.kind = "module";
                payload.canonical_source = true;
			}
			let result: Record<string, unknown>;
			// Action admission (contract §32) runs ahead of every Mod hook and of the kernel: a refused
			// proposal pays for no definition agent and reaches no transaction.
			if (spec.name === "resolve" || spec.name === "apply") await admitAction(state, spec.name, payload, signal);
      if (mods) {
        if (Array.isArray(payload.effects)) payload.effects = payload.effects.map(effect => ({...(effect as Record<string, unknown>)}));
        if (spec.name === 'narrate' && state.preparationWait) payload.preparation_wait = {
          kind: state.preparationWait.kind, ...(state.preparationWait.name ? {name: state.preparationWait.name} : {})};
        else if (spec.name === 'narrate' && state.sourceWait) payload.preparation_wait = {
          kind: 'source', ...(state.sourceWait.focus ? {name: state.sourceWait.focus} : {})};
        if (spec.name === 'narrate' && state.rebindingRefused) payload.rebinding_refused = {...state.rebindingRefused};
        const prepared = await mods.prepare(spec.name, payload, signal);
        // §91. Only a delivery carries a continuity review, so only a delivery can report one missing.
        if (spec.name === 'narrate' || spec.name === 'ask') {
          if (prepared?.unreviewed) noteUnreviewedDelivery(state, prepared.unreviewed);
          else noteReviewAnswered(state);
        }
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
				const read = { ...(failure.details.read as Record<string, unknown>), foreground: true };
				const readKey = JSON.stringify([read.purpose ?? "", read.material ?? "", read.focus ?? "", read.question ?? "", read.guidance_key ?? ""]);
				// This exact material already refused this turn: refuse again at once rather than rejoining
				// the same pending job for another full wait. The Keeper was told not to ask again.
				const priorRefusal = state.readingRefused.get(readKey);
				if (priorRefusal !== undefined) throw priorRefusal;
				const refuse = (cause: unknown): never => {
					const refusal = sourceMaterialRefusal(cause, read);
					if (isKernelError(refusal)) state.readingRefused.set(readKey, refusal);
					throw refusal;
				};
				try {
					await reading.ensure(readingModule, read, signal);
				} catch (readFailure) {
					if (!isKernelError(readFailure) || readFailure.details?.reason !== "reading_failed" || signal?.aborted) refuse(readFailure);
					if (state.readingRetries.has(readKey)) refuse(readFailure);
					state.readingRetries.add(readKey);
					try { await reading.ensure(readingModule, { ...read, retry: true }, signal); }
					catch (repairFailure) { refuse(repairFailure); }
				}
				result = (await state.kernel.call<Record<string, unknown>>(spec.method, payload, onProgress)) ?? {};
			}
			if (spec.name === "recall") result = state.recallPages.accept(result);
			// Deferred Mod bookkeeping completes after the verb that opened this turn, never before it.
			if (mods?.after) await mods.after(spec.name, payload, signal);
			if (spec.name === "lookup" && params.kind === "module" && params.question) {
				result.note = "This is published graph material. Use lookup kind source only if an original-page recheck is needed.";
			}
			await prepareMapViews(state,result);
			applyToolSuccess(state, spec.name, toolCallId, result);
			if (closesOpening && sessionCtx) {
				// Words in the play language from the extension surface; whether the fold starts open is
				// decided and recorded by the hints module (once per home, only while the setting is on).
				try {
					const words = await surface.words();
					(result as Record<string, unknown>).help = await openingHelp("play-opening", words.line("play_help_title"),
						[words.line("play_help_1"), words.line("play_help_2"), words.line("play_help_3")],
						{ home: cocHome(sessionCtx.cwd), agentHome: agentHomeOf(sessionCtx.cwd) });
				} catch { /* a hint that cannot be worded is a hint not drawn; the delivery stands */ }
			}
			const adaptationPending = spec.name === 'lookup' && params.kind === 'adaptation' && ['pending', 'reviewing'].includes(String(result.status));
			if (adaptationPending) {
				state.preparationWait = { kind: "adaptation", name: asString(result.name), status: asString(result.status) };
				const status = {campaign: state.campaign, turn: state.turn, name: result.name, status: result.status,
					message: result.service_status};
				pi.appendEntry('coc-adaptation-status', status);
				pi.events.emit('coc:adaptation-status', status);
			}
			else if (spec.name === 'lookup' && params.kind === 'adaptation') state.preparationWait = undefined;
			if (spec.name === 'lookup' && params.kind === 'adaptation' && asString(result.purpose) === 'source_rebinding') {
				// §37.6: remember a refused placement so the Keeper is not told to prepare it again, and so an
				// honest turn that continues the chosen action without the evidence has a lawful basis.
				if (asString(result.status) === 'failed') {
					const refused = result.refused as Record<string, unknown> | undefined;
					const summary = asString(refused?.summary) || asString((refused?.contradicted as string[] | undefined)?.[0])
						|| asString((refused?.issues as string[] | undefined)?.[0]);
					state.rebindingRefused = { name: asString(result.name), ...(summary ? { summary } : {}) };
				}
				else if (['pending', 'reviewing', 'ready', 'accepted'].includes(asString(result.status))) state.rebindingRefused = undefined;
			}
			// A call that came back is proof the history store answered: the commit streak ends here
			// (contract §38.11), not at a turn boundary.
			state.commitOutage = undefined;
			state.commitOutageNotified = false;
			await record({
				tool: spec.name,
				call_id: payload.call_id ?? null,
				started_at: startedAt,
				ms: Date.now() - began,
				ok: true,
				...(spec.name === "resolve" ? resolveTelemetry(result as ResolveResult) : {}),
				...readTelemetry(spec.name, params),
				...(spec.name === "recall" ? {response_bytes: Buffer.byteLength(JSON.stringify(result), "utf8")} : {}),
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
			// Contract §78: this effect did not happen, and the delivery behind it in the same message
			// was written before anyone knew that. While that narrate is still pending the repair is
			// available and the `tool_call` gate takes it; once that gate is spent for this turn the
			// delivery lands carrying an answer it never had, and the player is the only one who can be
			// told. `action_not_authorized` (§32) reaches this the same way any other refusal does --
			// the mechanism is the ordering, not the reason.
			if (EFFECT_TOOLS.has(spec.name) && state.deliveryBehindEffect?.size) state.effectRefusedBeforeDelivery = true;
			if (spec.name === "recall") error = state.recallPages.diagnostic(error);
			if (spec.name === "recall" && isKernelError(error) && error.details?.reason === "recall_page_stale") state.recallPages.forget(params);
			const code = isKernelError(error) ? error.code : "internal";
			// §22: the table now knows which material is unread. It does not know that the campaign is
			// unplayable, and must not act as if it did -- this used to set a session-wide preparationWait
			// that no later turn ever cleared, so from the first timed-out read every verb but narrate was
			// blocked for the rest of the session (campaign game-3dd94f0a, turns 35-36 and everything after).
			{
				const reason = (error as { details?: { reason?: string } })?.details?.reason;
				if (reason === "reading_timeout" || reason === "reading_failed") {
					const read = (error as { details?: { read?: Record<string, unknown> } })?.details?.read ?? {};
					const focus = asString(read.focus), question = asString(read.question);
					state.sourceWait = { ...(focus ? { focus } : {}), ...(question ? { question } : {}) };
					state.readingWait = true;
				}
			}
			// Contract §38.11. A commit that fails twice for the same reason is not a move to retry: it
			// is the table's history store being unavailable, and every further attempt costs a model
			// call and a continuity review for a turn that cannot land. 2026-09-15, live: an
			// `xcode-select` pointing at an unlicensed Xcode made /usr/bin/git exit 69, and turn 103
			// spent eight narrate attempts and six continuity reviews on `commit_failed` before the
			// turn gave up; the player was told only that the turn "ended without a delivered result".
			// So: bound the retries, keep the Git text, and escalate once -- §32.2's shape exactly.
			if (code === "commit_failed") {
				const { cause, detail: gitDetail } = commitCause(error);
				const streak = state.commitOutage?.cause === cause ? state.commitOutage.count + 1 : 1;
				state.commitOutage = { cause, count: streak };
				if (streak >= COMMIT_FAILURE_LIMIT) {
					state.commitUnavailable = { cause, detail: gitDetail, streak };
					if (!state.commitOutageNotified) {
						state.commitOutageNotified = true;
						const status = { campaign: state.campaign, turn: state.turn, status: "down", streak, cause, detail: gitDetail,
							fix: `This table's history store keeps refusing to write (${cause}: ${gitDetail}), so no turn can be committed and`
								+ " none can be delivered. Repair Git for this workspace -- on macOS an `xcode-select` pointing at an"
								+ " unlicensed or missing Xcode makes /usr/bin/git exit 69 for every command; `git -v` in the workspace"
								+ " reproduces it. Point PI_COC_GIT at a working git, or repair the one on PATH, then send again." };
						try { pi.appendEntry("coc-commit-status", status); }
						catch { /* the notice must never break a turn */ }
						pi.events.emit("coc:commit-status", status);
					}
					// The Keeper is told the same thing the operator was: this is the service, not the text.
					error = new KernelError({
						code,
						message: error instanceof Error ? error.message : String(error),
						retryable: false,
						next: "stop",
						fix: `This has now failed ${streak} times in a row for the same reason (${cause}), so it is not the text and a`
							+ " resend cannot fix it: the table cannot write its history at all. Call no further tool and write nothing"
							+ " more. Whatever already settled with a receipt is kept, the player has been told as a service notice,"
							+ " and the person running this table has been notified outside the game.",
						details: { ...(isKernelError(error) && error.details ? error.details : {}), reason: "commit_unavailable", cause, streak },
					});
				}
			}
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
				...(state.reviewUnavailable || state.commitUnavailable ? {terminate: true} : {}),
				details: {
					coc_error: {
						code,
						message: error instanceof Error ? error.message : String(error),
						...(isKernelError(error) ? { retryable: error.retryable, next: error.next } : {}),
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
			const round = state.callRounds.get(event.toolCallId) ?? state.roundTrips;
			const before = state.refusalsThisTurn;
			const { count, tripped } = strikeRefusalClass(state, tool, cls, last, round);
			if (tripped) await record({ lane: "refusals", turn: state.turn, tool, count, reason: "class_limit", last });
			if (before < REFUSAL_BUDGET && state.refusalsThisTurn >= REFUSAL_BUDGET)
				await record({ lane: "refusals", turn: state.turn, count: state.refusalsThisTurn, reason: "turn_budget", last });
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
		return async (method, params) => {
			if (!gate.open) throw new KernelError({code: "internal", message: `the kernel is closed; ${method} is not sent`});
			const result = await kernel.call(method, params);
			// Register public references, but retain the original host-only snapshot. accept returns a separate model view.
			if (method === "table.recall" && table && result && typeof result === "object") table.recallPages.accept(result as Record<string, unknown>);
			return result;
		};
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
		// A watchdog kill cannot emit agent_settled in the dead process. The
		// Electron host arms this one-process handoff before abort escalation;
		// consume it exactly once so a retained pending turn is stranded before
		// queued player input reaches the ordinary turn-state guard.
		const watchdogRecovery = process.env.PI_COC_WATCHDOG_RECOVERY === "1";
		const sessionFile = ctx.sessionManager.getSessionFile();
		watchdogRecoveryFile = sessionFile ? `${sessionFile}.coc-watchdog-recovery.json` : undefined;
		watchdogTurnBinding = undefined;
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
				recallPages: new RecallPages(),
				openingPending: false,
				session: null,
				pendingChoice: null,
				closedThisRun: false,
				runCut: false,
				steeredThisTurn: false,
				toolCallsThisTurn: 0,
				deliveryTriedThisTurn: false,
				blockedAfterClose: 0,
				blockedAfterExhausted: 0,
				recoveryOwed: null,
				recoveryLanded: false,
				recoverySteered: false,
				readingRetries: new Set(),
				readingRefused: new Map(),
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
				mapAttachments: [],
				mapWords: {},
				mapWordsAsked: new Set(),
				lanes: new AbortController(),
				party: [],
				present: [],
				delivered: [],
				recent: [],
				admission: new Map(),
				admissionRefused: [],
				admissionOutage: 0,
				reviewOutage: 0,
				unreviewedStreak: 0,
				providerOutage: 0,
				landed: [],
				adaptationScanned: false,
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
				// The campaign's telemetry file (contract §12.8). The Mod bridge runs the continuity review
				// inside the Keeper's own tool call, so its rows belong on this turn's line like any other;
				// a bridge consumer that writes its own path would have to guess the turn as well.
				record: (row: Record<string, unknown>) => void record(row),
			});
			pi.events.emit("coc:table-open", { campaign, open });
			// Contract §39.2: the module's own map labels, projected into this campaign's play
			// language before the first arrival can need them.
			warmMapWords(table, open);

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
				if (watchdogRecovery) {
					const promise = bindWatchdogRecoveryTurn(table.turn);
					watchdogTurnBinding = { turn: table.turn, promise };
					const binding = await promise;
					if (binding !== "stale") {
						// A failed write remains a barrier, not a route into the
						// paused-review release path. Player input retries the same
						// binding before it may change the kernel turn.
						table.strandedTurn = true;
						if (!hasTurnTerminalNotice(table.turn)) scheduleTurnUnfinishedNotice(table, table.turn);
						return;
					}
					watchdogTurnBinding = undefined;
				}
				const review = await mods?.reviewStatus?.(campaign);
				// §91: a retained block no verdict stands behind cannot decide this turn either. The
				// recovery run goes ahead; its own delivery meets the same review and, if that review
				// is still down, is published unreviewed rather than stranding a turn twice over.
				if (review?.paused && review.reviewed === true) {
					// §38.9: the retained accounting already records which kind blocked it, so a recovered
					// turn replays that kind instead of re-reading a verdict end as a fresh outage.
					pauseReview(table, new KernelError({code: 'needs', message: 'The retained review is paused',
						details: {reason: 'continuity_review_unavailable', cause: review.reason, service: review.service !== false}}));
					// Contract §38: the retained review cannot approve any draft, so this recovered turn can
					// never be delivered. It is stranded; the player's next input opens a new turn.
					table.strandedTurn = true;
					return;
				}
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
			} else {
				// A retained marker with no retained kernel turn is stale (the
				// release landed before the previous process died). It must not
				// authorize stranding some later turn in this process.
				if (watchdogRecovery) await clearWatchdogRecovery();
				if (open.opening_needed) sendHost(
					`Opening the table: ${open.setup_prologue ? "The setup context records the prior meeting, and the investigator now exists: the guide already knows who the visitor is, so do not ask it again, and do not restage the arrival or the greeting. Open with one short paragraph that tells the player plainly where they stand now -- who this person is to them, what they were asked to do, what is on the table -- then let the guide react in their own words to who the visitor turned out to be and put one concrete question or offer to the player. Talk over atmosphere: one sentence of room at most, one gesture per line of speech, and the whole opening shorter than the prologue. Introduce at most two new proper names, each with what it is; the rest of the book's names wait until the player asks or goes there. No keys or money were granted. If pending_action exists, preserve that player request instead of asking for the same decision again; carry it forward through normal rules and state receipts, never claim unrecorded resources. Committed prologue: "+JSON.stringify(open.setup_prologue) : "There is no prior meeting. Begin the scene, orientation first: in two or three plain sentences a newcomer can follow, when and where this is, who the investigator is here in public terms, and why they are here; then the scene, with talk over atmosphere and at most two proper names, each with what it is."} This turn has no player input. Write all player-facing words in play_language=${table.playLanguage}. Use look to see the opening scene (lookup for background). Close with narrate and wait for free player input. NPC questions belong naturally in the prose. Do not generate story action menus or options. ` +
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
		watchdogRecoveryFile = undefined;
		watchdogTurnBinding = undefined;
	});

	// Keep player messages out of the host-driven opening/recovery loop. Pi's streaming
	// queue bypasses before_agent_start, so replay only after the run fully settles.
	const waitingInputs: Array<{ text: string; images?: ImageContent[] }> = [];
	pi.on("input", (event, ctx) => {
		if (setupMode || !table || ctx.isIdle()) return;
		// Contract §71. A resend is not a second turn. Held under its own name rather than queued, so
		// that the turn it duplicates decides what it was: a duplicate if that turn delivers, the
		// player's retry if it does not. Either way the player is told now, not never.
		if (isResendOfRunningTurn(table, event)) {
			const state = table, turn = table.turn;
			state.resend = { text: event.text, turn };
			void record({ lane: "turn", event: "resend_held", turn, ok: true });
			if (state.resendNoticeTurn !== turn) {
				state.resendNoticeTurn = turn;
				setTimeout(() => void emitResendHeldNotice(state, turn).catch(() => {
					/* the notice must never break a turn */
				}), 0);
			}
			return { action: "handled" };
		}
		waitingInputs.push({ text: event.text, images: event.images });
		return { action: "handled" };
	});
	pi.on("agent_settled", () => {
		if (!table) return;
		// Contract §38: the run itself is the structural boundary. If it settled with the turn still
		// open/acting and no narrate/ask delivery, there is no actor left who can finish it before the
		// player's next input — which the state guard would otherwise reject. The cause is irrelevant.
		const undelivered = (table.state === "open" || table.state === "acting")
			&& !table.closedThisRun && table.renderedText === undefined;
		if (undelivered) {
			table.strandedTurn = true;
			// If this was the host watchdog's normal abort path, bind its
			// already-armed sidecar to the kernel turn. The marker remains until
			// table.player_input durably records the stranded release.
			if (!watchdogRecoveryFile || existsSync(watchdogRecoveryFile)) {
				const promise = bindWatchdogRecoveryTurn(table.turn);
				watchdogTurnBinding = { turn: table.turn, promise };
			}
		}
		// Contract §50. Whatever the cause, and before the sentence is chosen, the settled facts of
		// this turn go out on the delivery channel. §38.5 gave the player a sentence; this gives them
		// the turn. Once per turn: a second run that ends on the same open turn adds no second card.
		//
		// The read starts here rather than on a timer: a player input queued during the run is sent a
		// few lines below, and its `release: "stranded"` closes the turn the receipts belong to. Issuing
		// `table.status` first puts it ahead of that release on the wire, so the card is drawn from the
		// turn that paid for it and never from the one that follows it.
		if (undelivered && table.settledToldTurn !== table.turn) {
			const state = table, turn = table.turn;
			state.settledToldTurn = turn;
			void tellWhatSettled(state, turn).catch(() => {
				/* the projection must never break a turn */
			});
		}
		// Choose exactly one player notice. A paused-review notice may already have landed at agent_end;
		// terminal provider wording outranks the generic fallback; recovered long outages remain a
		// footnote only when the turn actually delivered.
		const longFailure = table.providerFailure;
		table.providerFailure = undefined;
		// A commit outage has already told the player exactly why nothing was delivered (§38.11); the
		// generic "this turn ended without a delivered result" on top of it would be noise, and worse,
		// it invites the resend that cannot work.
		if (!table.reviewNoticeSent && !table.commitNoticeSent) {
			if (undelivered && table.terminalProviderFailure) {
				const failure = table.terminalProviderFailure;
				scheduleProviderNotice(table, { ms: failure.ms ?? 0, streak: failure.streak }, true, table.turn);
			} else if (undelivered) {
				scheduleTurnUnfinishedNotice(table, table.turn);
			} else if (longFailure) {
				scheduleProviderNotice(table, longFailure, false, table.turn);
			}
		}
		if (!CLOSED_STATES.has(table.state) && !undelivered) return;
		// Contract §71: the held resend is settled here, by the turn it repeated. A turn that delivered
		// answered those words already, so running them again would only cost the player a turn of clock
		// and budget for prose about repeating himself. A turn that delivered nothing did not, and the
		// resend is exactly the retry the player pressed the button for -- it goes, and §38's stranded
		// release rides with it.
		const held = table.resend;
		if (held) {
			table.resend = undefined;
			if (undelivered) waitingInputs.push({ text: held.text });
			void record({ lane: "turn", event: undelivered ? "resend_released" : "resend_folded", turn: held.turn, ok: true });
		}
		const next = waitingInputs.shift();
		if (next) pi.sendUserMessage([{ type: "text", text: next.text }, ...(next.images ?? [])]);
		// Contract §73. Nothing is waiting to speak, so nothing else is going to close this turn. §38 left
		// the close welded to the next `table.player_input`, which made the declaration a promise held in
		// this process's memory: the turn stayed `acting` on disk, a restart found it `acting`, and only
		// the player's next utterance redeemed it. Complete it here instead. The mark stays set until the
		// kernel confirms, so a kernel that cannot answer right now -- the exact condition that strands
		// most turns -- still gets the §38 release on the next input.
		else if (undelivered) void releaseStrandedTurn(table);
	});

	/**
	 * Close a turn this run left stranded, without a player utterance attached to it.
	 *
	 * Failure is not escalated anywhere: the §38 path is still armed behind it, and a second notice for a
	 * turn the player has already been told about would be noise. The telemetry row is the trace.
	 */
	async function releaseStrandedTurn(state: TableState): Promise<void> {
		const turn = state.turn;
		if (state.strandedTurn !== true || !(state.state === "open" || state.state === "acting")) return;
		try {
			// The same completion barrier §38.3 puts in front of the input-carried release: the marker must
			// name this kernel turn durably before the turn is closed, or a failed replacement could strand
			// its successor instead.
			if (watchdogTurnBinding?.turn === turn && (await watchdogTurnBinding.promise) !== "bound") return;
			const result = await state.kernel.call<{ turn?: number }>("table.release", { campaign: state.campaign, release: "stranded" });
			state.turn = typeof result.turn === "number" ? result.turn : turn + 1;
			state.state = "awaiting_player";
			state.strandedTurn = undefined;
			await clearWatchdogRecovery();
			watchdogTurnBinding = undefined;
			void record({ lane: "turn", event: "released", turn, ok: true });
		} catch (error) {
			void record({ lane: "turn", event: "released", turn, ok: false,
				code: isKernelError(error) ? error.code : "internal",
				detail: error instanceof Error ? error.message : String(error) });
		}
	}

	// ---- Turns ------------------------------------------------------------

	pi.on("before_agent_start", async (event) => {
		const state = table;
		if (!state) return;
		state.reviewUnavailable = undefined;
		state.reviewNoticeSent = false;
		state.providerNoticeSent = false;
		state.turnNoticeSent = false;
		// The streak survives the turn boundary (§38.11) but the block does not: new player input buys
		// one honest attempt, so a Git that has been repaired between turns is found by the next turn
		// rather than by a restart. A second failure of the same cause stops that run immediately.
		state.commitUnavailable = undefined;
		state.commitNoticeSent = false;
		state.deliveryCutShort = false;
		state.splitDelivery = undefined;
		state.splitDeliveryRefused = false;
		// §78: the ordering refusal and the notice it falls back to are the turn's, like §34.17's.
		state.deliveryAheadOfEffect = undefined;
		state.deliveryBehindEffect = undefined;
		state.effectRefusedBeforeDelivery = false;
		state.deliveryOrderRefused = false;
		state.refusedEffectUntold = false;
		state.providerFailure = undefined;
		state.terminalProviderFailure = undefined;
		const text = event.prompt;
		const startedAt = new Date().toISOString();
		const began = Date.now();
		// Contract §38: the previous run left this turn open with nothing delivered, so it is stranded and
		// can no longer be finished by anyone. Release it so the player can act again. This is the host's
		// own run state — not prose, not a verdict — and it neither narrates nor commits anything.
		const strandedTurn = state.strandedTurn === true && (state.state === "open" || state.state === "acting");
		// Contract 41.1: `text` is the only part of this call the player writes, and its only rule is that it
		// is not blank. Checking it here is what makes the refusal path honest: after this line, anything the
		// kernel refuses is a fault at the table, and no rewording reaches it.
		if (!text?.trim()) {
			state.turnNoticeSent = true;
			setTimeout(() => void emitEmptyInputNotice(state, state.turn), 0);
			return {
				message: {
					customType: "coc-host",
					content: "That player message carried no text, so no turn was opened and there is nothing to deliver. "
						+ "The player has been asked to say what they want to do. Do not call narrate or ask: the turn state "
						+ "is unchanged and a delivery would be refused. End this run without output.",
					display: false,
					details: { coc_host: true, kind: "player-input-empty", scope: "turn", campaign: state.campaign, turn: state.turn },
				},
			};
		}
		try {
			if (strandedTurn && watchdogTurnBinding?.turn === state.turn) {
				let binding = await watchdogTurnBinding.promise;
				if (binding === "failed") {
					const promise = bindWatchdogRecoveryTurn(state.turn);
					watchdogTurnBinding = { turn: state.turn, promise };
					binding = await promise;
				}
				if (binding !== "bound") throw new KernelError({
					code: "runtime_unavailable",
					message: "The watchdog recovery handoff could not be bound to this turn",
					fix: "retry after the session storage becomes writable",
				});
			}
			const result = await state.kernel.call<{ turn?: number; state?: TurnState; capsule?: unknown; _context?: unknown }>(
				"table.player_input",
				{ campaign: state.campaign, text, ...(strandedTurn ? { release: "stranded" } : {}) },
			);
			if (strandedTurn) {
				await clearWatchdogRecovery();
				watchdogTurnBinding = undefined;
			}
			state.turn = typeof result.turn === "number" ? result.turn : state.turn + 1;
			state.state = result.state ?? "open";
			state.callOrdinal = 0;
			state.strandedTurn = undefined;
			state.rebindingRefused = undefined;
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
			state.deliveryTriedThisTurn = false;
			state.blockedAfterClose = 0;			state.blockedAfterExhausted = 0;
			// §78: a new player turn is a new delivery, so it starts with its one ordering refusal intact.
			state.deliveryAheadOfEffect = undefined;
			state.deliveryBehindEffect = undefined;
			state.effectRefusedBeforeDelivery = false;
			state.deliveryOrderRefused = false;
			state.refusedEffectUntold = false;
			state.floorDraft = undefined;
			state.recoveryOwed = null;
			state.recoveryLanded = false;
			state.recoverySteered = false;
			state.readingWait = false;
			// §22: an unread page belongs to the turn that reached for it. A new player input is a new
			// context, so the wait it left behind dies with it rather than outliving the whole session.
			state.sourceWait = undefined;
			state.readingRetries.clear();
			state.readingRefused.clear();
			state.deliveryFix = undefined;
			state.roundTrips = 0;
			state.attachments = [];
			state.mapAttachments = [];
			// A new player input is a new context (contract §32.4): no verdict outlives it.
			state.playerText = text;
			// §71: a hold belongs to the turn that was running when it arrived and never outlives it.
			state.resend = undefined;
			state.admission = new Map();
			state.admissionRefused = [];
			state.landed = [];
			// This input answers the ask that closed the last turn, if one did: a resolve settling one
			// of its options is the player's own answer and is not put to review.
			state.answering = state.lastAsk;
			state.lastAsk = undefined;
			noteCapsule(state, result.capsule);
			await refreshAdaptationWait(state);
			await record({
				tool: "table.player_input",
				started_at: startedAt,
				ms: Date.now() - began,
				ok: true,
			});
			// Contract §13.9: the capsule enters the model context verbatim. Another extension that wants to
			// see it (the table display reads the director beat) takes it off the bus rather than parsing that
			// host message a second time, and never alters its JSON.
			const contextEpoch = randomUUID();
			pi.events.emit("coc:capsule", {
				epoch: contextEpoch,
				campaign: state.campaign,
				turn: state.turn,
				capsule: result.capsule ?? {},
				context: result._context,
				answering: state.answering,
			});
			return {
				message: {
					customType: "coc-capsule",
					content: JSON.stringify(result.capsule ?? {}),
					display: false,
					details: { coc_host: true, turn: state.turn, epoch: contextEpoch, context: result._context },
				},
			};
		} catch (error) {
			if (isKernelError(error) && error.code === "turn_state" && state.readingWait
				&& (state.state === "open" || state.state === "acting")) {
				// The prior source-wait correction belongs to the run that timed out. A later player
				// input cannot enter until that kernel turn closes, so give this run a fresh, bounded
				// chance to narrate the wait instead of inheriting the spent steer forever.
				state.closedThisRun = false;
				state.steeredThisTurn = false;
				state.floorDraft = undefined;
				state.deliveryFix = {
					kind: "reading-wait",
					text: "The previous player turn is still open after source preparation paused. Close that existing turn now with narrate: briefly explain that the source is not ready, do not imply the pending action happened, and await free player input.",
				};
			}
			await record({
				tool: "table.player_input",
				started_at: startedAt,
				ms: Date.now() - began,
				ok: false,
				code: isKernelError(error) ? error.code : "internal",
			});
			// The context lane latched `inputPending` when this message arrived and only a capsule clears it.
			// No turn opened, so no capsule is coming: say so, or every lane request until the next accepted
			// input runs degraded (retained evidence: campaign game-3dd94f0a, 2026-09-16T00:14).
			pi.events.emit("coc:input-refused", { campaign: state.campaign, turn: state.turn });
			// A turn the Keeper may still finish is the one case where a delivery is still owed: the
			// reading-wait branch above hands it a `deliveryFix` for exactly that, and that delivery is the
			// player's answer -- a service notice beside it would be a second, contradictory one.
			const deliverable = state.state === "open" || state.state === "acting";
			// Contract 41.1: report -- never retry, never repair. The request is deterministic, so the same
			// bytes refuse the same way, and the kernel must not rewrite a package or a campaign to make a
			// refusal go away. The player is told at once, by the host, in words they can act on.
			if (!deliverable) scheduleInputRefusedNotice(state, error);
			return {
				message: {
					customType: "coc-host",
					content: `The kernel did not accept that player input, so no turn opened for it: ${errorText(error)}\n`
						+ "This is not the player's wording -- the host checked the only field they write -- so do not tell them "
						+ "to say it again.\n"
						+ (deliverable
							? "The previous turn is still open: close that turn with narrate, and say that the new input has not "
								+ "been taken up yet."
							: "There is no open turn, so narrate and ask will be refused `turn_state`. The player has already been "
								+ "told the table refused the input; end this run without output."),
					display: false,
					details: { coc_host: true, kind: "player-input-failed", scope: "turn", campaign: state.campaign, turn: state.turn,
						code: isKernelError(error) ? error.code : "internal", deliverable },
				},
			};
		}
	});

	pi.on("agent_start", async () => {
		if (table) {
			table.closedThisRun = false;
			table.runCut = false;
			// §86: `blockedAfterClose` is NOT reset here any more. pi starts a continuation run for any
			// message queued from `agent_end` (`runAgentLoopContinue` re-emits `agent_start`), and this
			// line put the closed-turn cut back to zero on a turn that was every bit as closed -- which
			// is how one table spent 17 refusals and 32 steps on a turn nobody could act on. The turn's
			// own boundary (`table.player_input`, and `applyOpen`) is what clears it.
			table.blockedAfterExhausted = 0;
		}
	});

	pi.on("turn_start", async () => {
		if (table) table.roundTrips += 1;
	});

	pi.on("tool_call", async (event, ctx) => {
		const name = event.toolName;
		if (!COC_TOOL_NAMES.includes(name as never)) return;
		const input = event.input as Record<string, unknown>;
		normalizeToolInput(name, input);

		const state = table;
		if (!state) {
			return { block: true, reason: startupError ?? "the kernel is not up, so this table has not opened" };
		}
		state.toolCallsThisTurn += 1;
		if (name === "narrate" || name === "ask") state.deliveryTriedThisTurn = true;
		// Contract §34.17: a delivery written in two halves, refused before either half lands. Both
		// calls of the batch are refused, so nothing of a split delivery reaches the player in pieces.
		if (state.splitDelivery?.has(event.toolCallId)) {
			const calls = state.splitDelivery.size;
			state.splitDeliveryRefused = true;
			await record({ tool: name, started_at: new Date().toISOString(), ok: false, code: "blocked",
				reason: "split_delivery", narrate_calls: calls });
			return { block: true, reason: `One narrate delivers the whole turn and closes it, and this message carries ${calls}:`
				+ " the first would close the turn and the rest would be refused, so the player would read only the first part."
				+ " Send the delivery again as a single narrate carrying all of it." };
		}
		// Contract §78, first shape: the delivery is ahead of an effect verb in this same message. The
		// narrate would close the turn and every effect behind it would be blocked after close, so the
		// message is refused whole -- refusing only the effect would publish exactly the turn this
		// exists to prevent. Spent once per turn, like §34.17's.
		if (state.deliveryAheadOfEffect?.has(event.toolCallId)) {
			state.deliveryOrderRefused = true;
			await record({ tool: name, started_at: new Date().toISOString(), ok: false, code: "blocked", reason: "effect_behind_delivery" });
			return { block: true, reason: DELIVERY_ORDER_REASON };
		}
		// Contract §78, second shape: an effect in this message was refused, and this narrate was
		// written before that answer existed. The turn has not closed yet, so the repair is available
		// and is taken: the delivery is refused, and the Keeper writes it again knowing what landed.
		// Once the turn has spent its one ordering refusal the delivery goes through, and what goes
		// through is a delivery carrying an answer it never had -- nothing is left to repair, so the
		// player is told instead (`agent_end`).
		if (state.deliveryBehindEffect?.has(event.toolCallId) && state.effectRefusedBeforeDelivery) {
			state.effectRefusedBeforeDelivery = false;
			if (state.deliveryOrderRefused) state.refusedEffectUntold = true;
			else {
				state.deliveryOrderRefused = true;
				await record({ tool: name, started_at: new Date().toISOString(), ok: false, code: "blocked", reason: "delivery_behind_refused_effect" });
				return { block: true, reason: "An effect this message asked for was refused, and this narrate was written before that answer existed, so it"
					+ " cannot be what the player reads. Write the delivery again for what actually landed: nothing refused has happened." };
			}
		}
		// Contract §38.11: the history store is down for this run. Terminating the run is the intent,
		// but a run that has already written its next call must not be allowed to spend another model
		// call and another continuity review on a turn that cannot land.
		if (state.commitUnavailable) {
			const { cause, streak } = state.commitUnavailable;
			await record({ tool: name, started_at: new Date().toISOString(), ok: false, code: "blocked", reason: "commit_unavailable", cause, streak });
			return { block: true, terminate: true, reason: `The table cannot write its history (${cause}), and it has failed ${streak} times in a row:`
				+ " no call can land and no turn can be delivered until it is repaired. Call no further tool and write nothing more."
				+ " The player has been told as a service notice, and the person running this table has been notified outside the game." };
		}
		// §86: the one gate for the one condition. This turn has no door -- delivered, handed back with
		// `ask`, or never opened -- so nothing any run calls can change its state, and every refusal of
		// it is this refusal: one sentence, one code, one counter, one set of flags. It used to be
		// `state.closedThisRun`, a property of the run, and a continuation run (pi starts one for any
		// message queued from `agent_end`) put the same closed turn on the other road below.
		if (turnHasNoDoor(state)) {
			// §34.16 (2026-09-15): grok-4.6 kept calling look/resolve/apply after the opening closed — 178
			// blocked calls in seventeen minutes on one table — and the run never settled, so the next player
			// input timed out waiting for it. Three blocked calls get a firmer answer; the sixth cuts the run.
			state.blockedAfterClose += 1;
			const blocked = state.blockedAfterClose;
			// §34.17 and §78 speak about what the player has already read, so they are owed only by a turn
			// that actually delivered something. A turn that never opened is just as closed and refuses
			// just as hard, and there is no published prose behind it to cast doubt on.
			const delivered = state.deliveredTurn === state.turn;
			// Contract §34.17: a *narrate* refused after close is the other half of a delivery that has
			// already been published. The counter proved the host knew; now the player is told (agent_end).
			const cutShort = name === "narrate" && delivered && state.cutShortToldTurn !== state.turn;
			if (cutShort) state.deliveryCutShort = true;
			// Contract §78: an effect verb refused after close is the turn's own account arriving behind
			// a door the delivery already shut. `t4` turn 103: nine turns of work went into one `apply`
			// that was to write a location onto a filed complaint, it came after the narrate in the same
			// message, and the object's `changed_turn` stayed eleven turns stale with nobody told. No
			// repair is left here -- the prose is published -- so the player is (agent_end).
			const untold = EFFECT_TOOLS.has(name) && delivered && state.refusedEffectToldTurn !== state.turn;
			if (untold) state.refusedEffectUntold = true;
			await record({ tool: name, started_at: new Date().toISOString(), ok: false, code: "blocked", reason: TURN_CLOSED_REASON,
				turn_state: state.state, blocked_after_close: blocked,
				...(cutShort ? { delivery_cut_short: true } : {}), ...(untold ? { effect_untold: true } : {}) });
			// §67 and §77: whoever refused, it counts, and the class budget is the only counter here kept
			// per turn -- which is what holds when the run restarts underneath a turn that did not. Every
			// strike from this gate is a refusal on a turn with no door, so narrate and ask are struck
			// here like any other write.
			const round = state.callRounds.get(event.toolCallId) ?? state.roundTrips;
			const { count, tripped } = strikeRefusalClass(state, name, `${name}\u0000turn_state\u0000${state.state}`,
				`turn_state: ${TURN_CLOSED_REASON}`.slice(0, 160), round, true);
			if (tripped) await record({ lane: "refusals", turn: state.turn, tool: name, count, reason: "class_limit", last: `turn_state: ${state.state}` });
			if (blocked >= RUNAWAY_ABORT_AT) {
				await record({ lane: "runaway", turn: state.turn, blocked, aborted: true });
				// The cut reaches message_end as `stopReason: "error"` like any dead call, and only the host
				// knows the difference: a cancellation is never resent, so nothing may be held for a later leg.
				state.runCut = true;
				try { ctx?.abort(); } catch { /* an abort that cannot be delivered leaves the driver's timeout as the last resort */ }
			}
			// The exhausted-class instruction is deliberately not read here. It says *close the turn with
			// narrate, or hand the player the choice with ask*, and on a turn with no door that is an
			// instruction to do the one thing this gate refuses -- the advice that kept a Keeper calling
			// narrate seventeen times (§77).
			return { block: true, reason: blocked >= RUNAWAY_STOP_AT ? TURN_CLOSED_STOP : TURN_CLOSED_REASON };
		}
		const adaptationControl = name === 'lookup' && input.kind === 'adaptation' && ['status', 'cancel'].includes(String(input.action));
		// Only an adaptation wait owns the rest of the turn: it is one named job with its own control verb,
		// and nothing else can advance while the destination it is building is undecided. A source wait is
		// not here on purpose -- one unread page never stopped the rest of the table from settling (§22).
		const retainedTerminal = state.preparationWait?.status && !['pending', 'reviewing'].includes(state.preparationWait.status);
		if (state.preparationWait && ((retainedTerminal && !adaptationControl) || (!retainedTerminal && name !== "narrate" && !adaptationControl))) {
			// §47. This was the one tool-level block in this gate that recorded nothing — every other
			// one writes `ok: false, code: "blocked"` — and the silence is why the defect it causes was
			// unreadable for a day. On `game-1c0faba5` turn 12 and `game-3dd94f0a` turn 52 the shape is
			// identical and, in telemetry alone, invisible: `lookup kind=adaptation action=prepare`
			// returns ok:true after ~20 s, the very next `toolCall` block leaves no row at all, and the
			// turn closes on a narrate about preparation. Both tables read as *zero* failures, so the
			// Keeper looked as if it had invented the reason; it had not, it was relaying this block's
			// own instruction. The UI step bar counted the block (11 steps, 1 failed) and telemetry did
			// not, and that disagreement was the only visible trace.
			await record({ tool: name, started_at: new Date().toISOString(), ok: false, code: "blocked",
				reason: "preparation_wait", kind: state.preparationWait.kind,
				...(state.preparationWait.name ? { proposal: state.preparationWait.name } : {}),
				...(state.preparationWait.status ? { status: state.preparationWait.status } : {}) });
			return { block: true, terminate: true, reason: preparationWaitInstruction(state, state.preparationWait) };
		}
		// §36.15, §60. A proposal that is over — stale, or failed — owns nothing: it is said once, by
		// name, with the call that revives it, and then this table is free, including for the repeat of
		// the very action the dead job was prepared for. The refusal is not terminated and not repeated:
		// whatever the Keeper sends next, including this same call again, goes through. Any adaptation
		// verb passes untouched, because `prepare` is the answer the instruction asks for and must never
		// be refused by the notice that asked for it. Said once means once for the campaign, not once a
		// turn and not once a process: the boundary cannot re-arm what it no longer holds, and §60 took
		// the dead job out of the kernel's cold-recovery scan so no later process finds it either.
		const over = state.adaptationOver;
		if (over) {
			const adaptationVerb = name === "lookup" && input.kind === "adaptation";
			state.adaptationOver = undefined;
			if (!adaptationVerb) {
				await record({ tool: name, started_at: new Date().toISOString(), ok: false, code: "blocked",
					reason: over.status === "failed" ? "adaptation_failed" : "adaptation_stale", proposal: over.name,
					...(over.cause ? { cause: over.cause } : {}) });
				return { block: true, reason: overAdaptationInstruction(over) };
			}
		}
		// A source wait refuses exactly one verb, and only the one whose whole purpose is to reach unread
		// source. A second source query in the same turn buys another full reading wait and can answer
		// nothing the first could not; every other verb, including resolve and apply, is untouched.
		if (state.sourceWait && name === "lookup" && input.kind === "source") {
			await record({ tool: name, started_at: new Date().toISOString(), ok: false, code: "blocked", reason: "reading_wait" });
			return { block: true, reason: sourceWaitInstruction(state, state.sourceWait) };
		}
		// The same call with the same parameters, resent unchanged: the kernel's answer will not change.
		// A Keeper once sent one set of parameters thirteen times and was refused every time; after two
		// refusals the third is blocked here, with the last error read back to it.
		state.callTools.set(event.toolCallId, name);
		state.callRounds.set(event.toolCallId, state.roundTrips);
		const shut = state.exhausted.get(name);
		if (shut) {
			// §70: the same escalation §34.16 gives a closed turn, for a turn that never
			// opened. The budget already told the Keeper to close with narrate; if it keeps
			// calling anyway, the third block says so harder and the sixth cuts the run.
			// Without this the refusals were bounded but the turn was not: a Keeper burned
			// five minutes of blocked calls on a table that could not move.
			state.blockedAfterExhausted += 1;
			const blocked = state.blockedAfterExhausted;
			await record({ tool: name, started_at: new Date().toISOString(), ok: false, code: "blocked", reason: "refusal_budget", blocked_after_exhausted: blocked });
			if (blocked >= RUNAWAY_ABORT_AT) {
				await record({ lane: "runaway", turn: state.turn, blocked, aborted: true, after: "refusal_budget" });
				state.runCut = true;
				try { ctx?.abort(); } catch { /* an abort that cannot be delivered leaves the driver's timeout as the last resort */ }
			}
			return { block: true, reason: blocked >= RUNAWAY_STOP_AT ? `${shut} Call no further tool and write nothing more.` : shut };
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
		const openingModShape = state.openingPending && state.state === "awaiting_player" && (
			(name === "resolve" && typeof (input.action as any)?.decision === "string") ||
			(name === "apply" && Array.isArray(input.effects) && input.effects.length > 0 && input.effects.every((e:any) => ["define","object","ability"].includes(e?.kind))));
		const openingMod = openingModShape && (mods ? true : await modsBridgeWait(modsBridgeWaitMs()));
		// §86: what is left here is the *opening*, and only the opening. Every state with no door was
		// answered by the one gate above, so reaching this line means `awaiting_player` with the opening
		// still owed: a write that is not the opening's own is refused, the reads named below really are
		// available, and narrate and ask really are the doors (§67, §70). The sentence must stay true of
		// that turn -- it is the only place it ever was.
		if (!openingNarrate && !openingMod && CLOSED_STATES.has(state.state)) {
			const bridgePending = openingModShape && !mods;
			const reason = bridgePending
				? "the Mod layer has not announced itself yet, so this opening Mod call cannot be judged: retry the same call; the opening's Mod checks become available as soon as it does"
				: `the turn state is ${state.state}, so nothing may change state: wait for the player to speak, or use only look, lookup and recall`;
			await record({ tool: name, started_at: new Date().toISOString(), ok: false, code: "turn_state", reason, ...(bridgePending ? { cause: "mods_bridge_pending" } : {}) });
			// A refusal the host issued is still a refusal (§67). Without this the
			// Keeper could be told "wait for the player" forever inside its own turn.
			const round = state.callRounds.get(event.toolCallId) ?? state.roundTrips;
			// The opening's doors are the `openingNarrate` exemption above, so a narrate or ask that
			// reaches this line is not one of them and is struck like any other write (§77).
			const { count, tripped } = strikeRefusalClass(state, name, `${name}\u0000turn_state\u0000${state.state}`, `turn_state: ${reason}`.slice(0, 160), round, true);
			if (tripped) await record({ lane: "refusals", turn: state.turn, tool: name, count, reason: "class_limit", last: `turn_state: ${state.state}` });
			return { block: true, reason: state.exhausted.get(name) ?? reason };
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
			// A Keeper sometimes hangs `decision` off the call instead of off `action`, where the schema
			// puts it (tools.ts) and where the opening Mod lane checks it. Hoist it: a legitimate Mod roll
			// must not die on field placement, and the kernel reads `action.decision` to match the Mod's
			// contributed check. The stray key is dropped so nothing downstream sees two homes for it.
			if (input.decision !== undefined) {
				if (action.decision === undefined) action.decision = input.decision;
				delete input.decision;
			}
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
			const stopReason = (event.message as {stopReason?: string}).stopReason ?? null;
			const ms = mark === undefined ? null : now - mark;
			const named = providerRequestModel;
			providerRequestModel = undefined;
			void record({lane: "provider-call", at: new Date().toISOString(), from, ms, stop_reason: stopReason,
				blocks: blocks.map((block) => block?.type ?? "?")});
			noteProviderCall(stopReason, ms, (event.message as {errorMessage?: string}).errorMessage, named);
		}
		const state = table;
		if (!state || event.message.role !== "assistant") return;
		const blocks = (event.message.content ?? []) as Array<Record<string, unknown>>;
		const hasToolCalls = blocks.some((b) => b.type === "toolCall");
		// Contract §34.17. One message, two `narrate` calls: the first closes the turn and every later
		// one is blocked after close, so the player reads the Keeper's first half and nothing says the
		// rest was refused (A-MAIN turn 39, 2026-09-16 -- a delivery that ends on a colon). This hook
		// runs before the calls execute, so the half-delivery can be stopped before it lands. The
		// signal is the shape of the message, not anything about the words: no punctuation is read and
		// no language is detected. Spent once per turn, so a Keeper that writes two halves again is not
		// left unable to deliver at all -- the second time the first half lands and the player is told.
		const narrates = blocks.filter((b) => b.type === "toolCall" && b.name === "narrate");
		state.splitDelivery = narrates.length > 1 && !state.splitDeliveryRefused
			? new Set(narrates.map((b) => String(b.id)))
			: undefined;
		// Contract §78. The delivery and the host's answer to an effect, written in one breath. Read
		// off the same message shape and in the same place, because it is the same seam: `blocks` is
		// the order the calls will execute in, and that order is the whole signal. `t4` turn 103 is the
		// first half of it -- narrate, then the `apply` that was nine turns of work -- and the second
		// half is its mirror, an effect whose refusal arrives while the delivery behind it is already
		// written. Neither reads a word of the prose.
		const calls = blocks.filter((b) => b.type === "toolCall");
		const delivery = calls.findIndex((b) => b.name === "narrate");
		const effects = calls.map((b, index) => ({ name: String(b.name), index }))
			.filter((call) => EFFECT_TOOLS.has(call.name));
		// The shape is recorded whether or not the refusal is still available to spend: once spent, the
		// same shape is what says the delivery that lands carried no answer, and the player is told.
		const ahead = delivery >= 0 && effects.some((call) => call.index > delivery);
		// The spend is read here and not at each call, so that one message is refused as one message:
		// setting the flag on the first refusal would let the second call of the same batch through,
		// which is the very turn this prevents (§34.17 keeps its own spend the same way).
		state.deliveryAheadOfEffect = ahead && !state.deliveryOrderRefused ? new Set(calls.map((b) => String(b.id))) : undefined;
		state.deliveryBehindEffect = !ahead && delivery >= 0 && effects.some((call) => call.index < delivery)
			? new Set(narrates.map((b) => String(b.id)))
			: undefined;
		state.effectRefusedBeforeDelivery = false;
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
		/** Player-visible text comes only from narrate and ask: a draft the host did not adopt leaves with the message. */
		const dropText = (reason: string) => {
			const kept = blocks.filter((block) => block.type !== "text");
			if (kept.length === blocks.length) return undefined;
			void record({ lane: "delivery", turn: state.turn, ok: false, reason, dropped: blocks.length - kept.length });
			return { message: { ...event.message, content: kept } };
		};
		// pi declares this value (`StopReason`, @earendil-works/pi-ai) and resends on it -- and only on it,
		// because auto-retrying a cancellation would defeat the cancellation (runtime/launch.ts). A run the
		// host cut itself arrives here wearing the same stop reason, so `runCut` is what tells them apart:
		// nothing is held for a leg that is never coming.
		const failedLeg = (event.message as { stopReason?: string }).stopReason === "error" && !state.runCut;
		// Contract §34.18. A leg that ended in error is a remnant, not a delivery surface. Two things
		// went wrong on one live turn (A-MAIN turn 113, 2026-09-16): the call hung 61 s and came back
		// `stop_reason: "error"` with `blocks: []`, the host placed the rendered delivery on that dead
		// message, and pi's resend replaced it -- so the narration the kernel had already rendered went
		// nowhere. Then the resend answered with a single text block holding the provider's own
		// end-of-sequence token, which arrived where the story should have been. Holding `renderedText`
		// for the leg that actually completes fixes both: the delivery lands on the resend (or on the
		// agent_end backstop when there is none), and the resend's text block is replaced by it rather
		// than read. The signal is `stopReason`, which pi declares as data (`StopReason` in
		// @earendil-works/pi-ai); nothing here inspects the words, and no token vocabulary is assumed.
		if (failedLeg && state.renderedText !== undefined) {
			void record({ lane: "delivery", turn: state.turn, ok: false, reason: "failed_leg_not_delivered", held: true,
				dropped: blocks.filter((block) => block.type === "text").length });
			const kept = blocks.filter((block) => block.type !== "text");
			return kept.length === blocks.length ? undefined : { message: { ...event.message, content: kept } };
		}
		let rendered = state.renderedText;
		if (rendered === undefined) {
			if (state.reviewUnavailable) return {message: {...event.message, content: blocks.filter(block => block.type !== 'text')}};
			// The Keeper wrote his lines but never called narrate: that prose is the narration. The host closes
			// the turn for him, sending the prose verbatim through the play-language guard.
			// A leg that died mid-stream contributes nothing of its own: half a sentence is not a delivery
			// (§34.17, §34.18). The fallback below still stands -- a draft the host itself dropped and
			// steered about is the Keeper's finished prose from an earlier leg, not this leg's remnant.
			const written = failedLeg ? "" : blocks
				.filter((b) => b.type === "text" && typeof b.text === "string")
				.map((b) => String(b.text))
				.join("")
				.trim();
			// The floor steer is additive: a second leg that brings nothing falls back to the draft it dropped.
			const prose = written || (state.steeredThisTurn && state.floorDraft) || "";
			const canClose = state.state === "open" || state.state === "acting"
				|| (state.state === "awaiting_player" && state.openingPending);
			// Nothing here can become a delivery: the turn is already closed, or handed to the player, or
			// there is no prose at all. Returning bare left whatever the model wrote on screen as if the
			// Keeper had said it -- the one path by which raw model output reached the player without
			// passing through narrate or ask. It leaves with the message, like the drafts below it.
			if (!prose || !canClose || state.closedThisRun) return dropText(failedLeg ? "failed_leg_not_delivered" : "text_not_a_delivery");
			const sourceWait = state.readingWait || state.sourceWait !== undefined;
			if (state.preparationWait && !sourceWait) {
				state.deliveryFix = { kind: `${state.preparationWait.kind}-wait`, text: preparationWaitInstruction(state, state.preparationWait) };
				return { message: { ...event.message, content: blocks.filter(block => block.type !== "text") } };
			}
			// A source wait asks the Keeper to say so through narrate itself. That steer is spent once, like
			// the two below it: prose on the second leg closes the turn implicitly, which is still a narrate
			// and still records its receipt. Without the guard the drop repeated for every leg, agent_end
			// stopped steering once the first steer was spent, and the turn stayed open with nothing
			// delivered -- so every later player input failed turn_state and the campaign could not continue.
			if (sourceWait && !state.steeredThisTurn) {
				state.deliveryFix = { kind: "reading-wait", text: sourceWaitInstruction(state, state.sourceWait ?? {}) };
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
			// §40 (2026-09-15): people are on stage and the draft carries no say token. Once, the host drops
			// the draft and asks for the same turn with its lines wrapped; the second leg is honoured however it
			// comes, and a second leg that brings nothing falls back to this draft like the floor steer's.
			// Nothing here reads the prose: a machine token is searched for, and present[] is the capsule's.
			// PI_COC_SPEECH_STEER=0 turns the steer off for an experiment (a control arm); the product default is on.
			// A fix already pending (an explicit delivery this turn was refused and its repair steer waits) wins:
			// the draft goes through the audit like any other, one concern per steer.
			if (process.env.PI_COC_SPEECH_STEER?.trim() !== "0" && !state.deliveryFix && !state.deliveryTriedThisTurn && state.present.length > 0 && !opening && !state.steeredThisTurn && !/\{\{say:/.test(prose)) {
				state.floorDraft = prose;
				state.deliveryFix = { kind: "speech", text: SPEECH_STEER };
				await record({ lane: "speech", turn: state.turn, steered: true, present: state.present.length });
				return { message: { ...event.message, content: blocks.filter((block) => block.type !== "text") } };
			}
			const tool = "narrate";
			const callId = mintCallId(state);
			const startedAt = new Date().toISOString();
			const began = Date.now();
			try {
				const params: Record<string, unknown> = { campaign: state.campaign, call_id: callId, text: prose, implicit: true,
					...(state.preparationWait ? {preparation_wait: {kind: state.preparationWait.kind,
						...(state.preparationWait.name ? {name: state.preparationWait.name} : {})}}
						: state.sourceWait ? {preparation_wait: {kind: 'source',
							...(state.sourceWait.focus ? {name: state.sourceWait.focus} : {})}} : {}),
					...(state.rebindingRefused ? {rebinding_refused: {...state.rebindingRefused}} : {}) };
				const prepared = await mods?.prepare(tool, params, state.lanes.signal);
				// §91: the host's own closing delivery is reviewed on the same terms as an explicit one.
				if (prepared?.unreviewed) noteUnreviewedDelivery(state, prepared.unreviewed);
				else noteReviewAnswered(state);
				const result = (await state.kernel.call<Record<string, unknown>>(`table.${tool}`, params)) ?? {};
				// `applyToolSuccess`'s own `narrate` case already projected the mechanics and noted the
				// commit. Projecting again here wrote the `coc-mechanics` entry twice for every turn the
				// host closed implicitly, and the frontend drew what the session held: the player saw the
				// same "this turn's mechanics" block twice (campaign game-5779d0fd turn 3, two entries of
				// identical bytes against one row in the turn record). An explicit `narrate` went through
				// one path and was never affected, which is why only some cards doubled.
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
				// The draft does not stay on screen (contract §34.14). A refused delivery is a turn that did
				// not happen, and its raw prose can contain machine tokens that only a successful narrate
				// strips. Continuity review unavailability pauses the run; other review failures get one
				// targeted repair steer. Both paths remove the rejected text before agent_end acts.
				state.floorDraft = undefined;
				if (isKernelError(error) && error.details?.reason === 'continuity_review_unavailable') {
					pauseReview(state, error);
					return {message: {...event.message, content: blocks.filter(block => block.type !== 'text')}};
				}
				state.deliveryFix = {kind: "audit-repair", text: `This draft was not delivered. ${isKernelError(error) ? error.message : "Delivery preparation failed"}. ` +
					`${isKernelError(error) ? error.fix ?? "" : ""} ${isKernelError(error) ? JSON.stringify(error.details ?? {}).slice(0, 8000) : detail ?? ""} Keep settled actions; repair with narrate, without rerolling or inventing a reconciliation.`};
				return {message: {...event.message, content: blocks.filter(block => block.type !== "text")}};
			}
			// The implicit narrate landed but the kernel rendered nothing to publish. The raw draft is not a
			// substitute: only a rendered delivery strips the machine tokens (§34.14).
			if (!rendered) return dropText("rendered_nothing");
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
		// Held for the message that ends this call: a call that dies produces no response row, so the
		// only place the model and provider it was made against still exist is here (§38.7).
		providerRequestModel = {...(payload?.model ? {model: payload.model} : {}),
			...(ctx.model?.provider ? {provider: ctx.model.provider} : {})};
		await record({lane: "provider-request", at: new Date().toISOString(), model: payload?.model, provider: ctx.model?.provider,
			reasoning_effort: payload?.reasoning?.effort ?? payload?.reasoning_effort ?? null});
	});
	pi.on("after_provider_response", async (event, ctx) => {
		const requestId = Object.entries(event.headers).find(([name]) => ["x-request-id", "request-id"].includes(name.toLowerCase()))?.[1];
		// Pi awaits this hook inside the adapter's `onResponse`, which runs *before* the first body
		// byte is read, so every millisecond spent here is a millisecond the response stream is not
		// being consumed. `at` is stamped on entry and says nothing about when the hook returned:
		// on a run that answers 200 and then produces no block at all (2026-09-15, turn 2: 200 in
		// 612 ms, then 126 s and `blocks: []` before the host watchdog aborted it), the rows on disk
		// cannot tell "the provider sent nothing" from "the host blocked before reading". This row
		// decides it -- absent or near zero and the silence was on the wire, not in here (§38.7).
		const at = Date.now();
		await record({lane: "provider-response", at: new Date(at).toISOString(), provider: ctx.model?.provider,
			status: event.status, ...(requestId ? {request_id: requestId} : {})});
		const hookMs = Date.now() - at;
		if (hookMs >= 1000) await record({lane: "provider-response-hook", at: new Date().toISOString(), hook_ms: hookMs});
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
			// §50: `triggerTurn: false`. A `sendMessage` from an `agent_end` handler with the flag
			// left off is `agent.steer()` while the run is still streaming, and AgentSession continues
			// that very run for it ("Any messages here were queued by agent_end extension handlers and
			// need a continuation"). The host's own delivery is not a prompt: steering it back hands the
			// Keeper a provider call to answer its own published words.
			pi.sendMessage({ customType: "coc-delivery", content: undelivered, display: true, details: { coc_delivery: true, turn: state.turn } },
				{ triggerTurn: false });
			void record({ lane: "delivery", turn: state.turn, ok: true, reason: "placed_by_host",
				detail: "the Keeper ended on the message carrying the call, so the replacement had nowhere to land" });
		}
		if (state.verifierOwed) settleVerifier(state);
		// Contract §34.17: a turn that closed on the first half of a two-part delivery closed normally
		// by every other measure -- receipts landed, the text was published -- so this notice has to be
		// sent before the "the turn closed, nothing more is owed" return below.
		if (state.deliveryCutShort) {
			const turn = state.turn;
			state.deliveryCutShort = false;
			state.cutShortToldTurn = turn;
			setTimeout(() => void emitCutShortNotice(state, turn), 0);
		}
		// Contract §78: same place, same reason -- a turn that closed normally by every other measure,
		// and an effect behind that close that the player was never told did not happen. Once per turn.
		if (state.refusedEffectUntold) {
			const turn = state.turn;
			state.refusedEffectUntold = false;
			// §86: once per turn, not once per run. The gate reads this before it raises the flag again,
			// so a second run on the same closed turn does not say the same sentence to the player twice.
			state.refusedEffectToldTurn = turn;
			setTimeout(() => void emitRefusedEffectNotice(state, turn), 0);
		}
		// Contract §38.11: the history store is down. This is not the generic no-delivery notice and
		// must not be replaced by it: the host knows the cause and the player is owed it.
		if (state.commitUnavailable && !state.commitNoticeSent) {
			state.commitNoticeSent = true;
			const failure = state.commitUnavailable, turn = state.turn;
			setTimeout(() => void emitCommitDownNotice(state, failure, turn), 0);
		}
		// Provider wording waits for agent_settled, which knows whether retries recovered and schedules
		// the one selected notice outside that lifecycle event.
		if (state.closedThisRun || state.renderedText) return;
		// Contract §38: the review, not the Keeper, is why this run ends with nothing delivered, and
		// returning here silently is the whole of what the player experiences. On the turn that found
		// this, a Persuade roll, a discovered clue and four registrations had all settled with receipts
		// and not one word reached the screen -- the engine moved and the fiction did not, which is the
		// drift the review exists to prevent. The draft cannot be published in its place: it never went
		// through narrate, so it still carries the machine tokens only a rendered delivery strips
		// (contract §34.14). What the player is owed is the plain fact that this turn could not be
		// published, in the table's own language, and whether trying again is worth anything.
		if (state.reviewUnavailable) {
			if (!state.reviewNoticeSent) {
				state.reviewNoticeSent = true;
				const streak = state.reviewOutage;
				// Contract §38.10. Three sentences, because the player is deciding one thing -- whether
				// to send again -- and the three situations answer it differently.
				//
				// A *verdict* pause (§38.9 `service: false`) is the reviewer having read the draft and
				// declined it, most often on `max_rewrites`. Saying the review "did not finish" there is
				// simply false: H-MAIN turn 42 ran two reviews that both submitted (23.2 s and 17.4 s).
				//
				// A service streak is not a locked table. `before_agent_start` clears
				// `reviewUnavailable`, every new input opens a turn with a fresh allowance, and a landed
				// narrate zeroes `reviewOutage`. The old line told the player "sending it again will not
				// help"; the run that found this defect stopped a live table on that sentence and then
				// delivered a complete turn from the very next message. What a repeated outage is
				// actually evidence for is the lane model, which the Lane model / Lane thinking settings
				// change for the next review without restarting the table (§37.10) -- so that, and not a
				// dead end, is what the streak line says.
				const verdict = state.reviewPauseService === false;
				// The key that is actually sent. This row used to name `review_unavailable_notice`
				// whichever of the three lines went out, so the one row that reports which notice the
				// player read said "the review did not finish" for a pause the reviewer had read and
				// refused. Retained live evidence (M-MAIN `game-3dd94f0a`, turns 92 and 107,
				// 2026-09-17): both ended on `The bounded Keeper repair did not resolve the review`
				// after two submitted reviews, both sent `review_verdict_notice`, and both were
				// recorded as `review_unavailable_notice` -- which is how a turn the guard did its job
				// on was read afterwards as a lane outage. §38.10 repaired the player's line and the
				// operator entry and left this one behind.
				const notice = verdict ? "review_verdict_notice" : streak >= 2 ? "review_down_notice" : "review_unavailable_notice";
				let line = verdict
					? "This turn could not be published: the continuity review read it and did not approve it. Everything already settled is kept — send anything and the Keeper writes this turn again."
					: streak >= 2
					? `This turn could not be published: its continuity review has failed ${streak} times in a row. Everything already settled is kept, and sending again does start a fresh attempt — but if it keeps failing, pick a quicker model under Lane model in settings; the next review uses it without restarting this table. The person running this table has been told.`
					: "This turn could not be published: its continuity review did not finish. Everything already settled is kept — send anything to try again.";
				try {
					const words = await surface.words();
					// `notice` above decides; the three keys are written out again here because the
					// caption inventory is found by scanning `.line(` call sites, and a key reachable
					// only through a variable is a shipped word nothing asks for.
					line = notice === "review_verdict_notice" ? words.line("review_verdict_notice", { streak })
						: notice === "review_down_notice" ? words.line("review_down_notice", { streak })
						: words.line("review_unavailable_notice", { streak });
				} catch {
					/* an unreadable content root still owes the player the English line */
				}
				// §50: `triggerTurn: false`, or this notice is the thing that spends the next provider
				// call. Retained live evidence (`game-b4cebfe0`, turn 8): the Keeper was continued after
				// the pause, called `narrate` again and was refused by the latched guard in 0 ms, which
				// bought the player one more empty bubble. The continuation is not a new run, so
				// `before_agent_start` never clears `reviewUnavailable` and the verb cannot succeed.
				pi.sendMessage({ customType: "coc-delivery", content: line, display: true,
					details: { coc_delivery: true, turn: state.turn, review_unavailable: true, streak, service: !verdict } },
					{ triggerTurn: false });
				void record({ lane: "delivery", turn: state.turn, ok: true, reason: notice, streak, service: !verdict });
			}
			return;
		}
		if (state.steeredThisTurn) return;
		if (state.preparationWait) {
			state.steeredThisTurn = true;
			sendHost(preparationWaitInstruction(state, state.preparationWait), `${state.preparationWait.kind}-wait`);
			return;
		}
		// A source wait does not own the turn, so it only speaks when the turn is still owed a delivery
		// and the kernel has left no fix of its own: say which material is unread, and let the Keeper close.
		if (state.sourceWait && !state.deliveryFix && (state.state === "open" || state.state === "acting")) {
			state.steeredThisTurn = true;
			sendHost(sourceWaitInstruction(state, state.sourceWait), "reading-wait");
			return;
		}
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
