/**
 * Action admission (contract §32): before the Keeper may settle a voluntary investigator action —
 * roll for it, walk somewhere, spend time or money, land a clue or a document, take or give an
 * item — the host asks whether the player chose it. The question is put to an independent model
 * review of the exact player text and the player-visible context, never to the Keeper's own
 * rationale, and never to a keyword table: the lane judges meaning in context, the host only
 * decides *which* calls are put to it (closed contract enums) and what a verdict does.
 *
 * The guard runs in the kernel extension's tool path, ahead of every Mod hook and ahead of the
 * kernel, so a refused proposal reaches neither: no dice are drawn, nothing is written, and there
 * is nothing to replay. It is base host behaviour — no package switches it off (§32.1).
 *
 * Three boundaries: the verdict authorises the affected voluntary action, never its outcome, and
 * never asks the player to approve hidden dangers; an unavailable review is a refusal with a
 * service status, not fail-open fiction (§32.2; on the investigator's own declared action it first
 * takes §32.12.2's late admission or its one resend, §143.15); nothing here reaches the next
 * capsule — a refusal is a tool result on this turn and a telemetry row, not a debt.
 */

import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runLane, type LaneResult } from "../lanes/subsession.ts";
import { KernelError } from "./client.ts";
import { createDecisionAdapter, jevFailureTelemetry } from "../../runtime/jev/decision-adapter.ts";
import { HANDOVER_GROUND_NOTE } from "../../runtime/jev/action-field-semantics.ts";
import type { DecisionPort } from "../../runtime/jev/decision-port.ts";
import { preparationBudget } from "../../runtime/jev/preparation-budget.ts";
import { TaskLease, hostClock, type TaskClock } from "../../runtime/jev/task-context.ts";
import {
	ADMISSION_JEV_FAMILY,
	ADMISSION_JEV_MODEL,
	admissionJevBindings,
	runAdmissionJev,
	batchVerdict,
	type AdmissionJevInput,
	type AdmissionJevResult,
	type AdmissionTypedDesign,
} from "../../runtime/jev/admission-domain.ts";
import { ADMISSION_ROLES_FAMILY, admissionRolesBindings, runAdmissionRoles } from "../../runtime/jev/admission-roles-domain.ts";
import { admissionTypedBudget, type AdmissionTypedBudget } from "../../runtime/jev/host-budgets.ts";
import { COMPILE_PREDICATES } from "../../runtime/jev/route-compile.ts";

/** The closed set of verdicts; anything else is `bad_output`. The first three admit, the last two refuse. */
export const ADMITTING_VERDICTS: ReadonlySet<string> = new Set(["authorized", "entailed", "not_player_action"]);
export const REFUSING_VERDICTS: ReadonlySet<string> = new Set(["not_authorized", "uncertain"]);

/**
 * Cap on how long one call waits for its review, `PI_COC_ADMISSION_TIMEOUT_MS`, measured from the review's start (contract
 * §32.12, §32.12.2). It sat at the verifier's two minutes after the first real table lost two turns to 60 s; live gate #6
 * (2026-09-24) then paid 57 s for one review inside a turn the owner holds to 60 s, and SL-18 set 12 s -- which then
 * refused four legitimate Keeper writes on the long gate. SL-24 measured the lane the tables run
 * (`opencode-go/deepseek-v4.1-flash`: the long gate's 24 Keeper batches rerun uncapped three times, plus the retained
 * bank's 51 verdicts; 123 rounds): p50 3.6 s, p90 12.3 s, p97.5 21.4 s, max 85 s. The cap is the p90 rounded up to a
 * whole second, 13 s: about one review in eleven passes it. A cap bounds waiting and decides nothing: past it the lane
 * keeps running to the hard cap (`admissionHardCapMs`, 26 s, which 3 of the 123 rounds passed) for the Keeper's one resend.
 */
export const DEFAULT_ADMISSION_TIMEOUT_MS = 13_000;
/** The host's verdict for a lane review cut at its cap (§32.12): not one of the lane's five, never an admit. */
export const REVIEW_TIMEOUT = "review_timeout";

export function admissionTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env.PI_COC_ADMISSION_TIMEOUT_MS?.trim();
	if (!raw) return DEFAULT_ADMISSION_TIMEOUT_MS;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 ? value : DEFAULT_ADMISSION_TIMEOUT_MS;
}
/**
 * The lane round's own deadline (§32.12.2): twice the cap. The cap bounds how long one call waits; past it the review keeps
 * running so the Keeper's one resend can collect it, and the hard cap bounds that too.
 */
export function admissionHardCapMs(capMs: number): number {
	return capMs * 2;
}
/** The host's answer to a call whose review has not answered by the cap and cannot be admitted late (§32.12.2). */
export const REVIEW_PENDING = "review_pending";
/** A lane answer whose grounds are empty: no verdict, not an outage (§32.12.2). */
export const NO_GROUNDS = "no_grounds";
/**
 * §143.15 (ticket 16): a lane round asks its model at most twice, and the second time only when the first answer was not a
 * verdict at all (`bad_output`: no JSON object, JSON that does not parse, or not the verdict shape). Live table C3, turn 3:
 * one malformed answer in 2.1 s refused a player's punch and left the turn with no mechanics. Both attempts share the
 * round's one deadline; the second bad answer is the lane's failure, as one was before.
 */
export const ADMISSION_LANE_ATTEMPTS = 2;
/** The one line the second attempt adds to the review's input: the first answer was not a valid verdict, and why. */
export function admissionRetryInput(input: string, detail: string): string {
	return `${input}\n\nYour previous answer was not valid JSON for this review (${detail.slice(0, 160)}); answer again with the one JSON object only.`;
}

export interface AdmissionVerdict {
	verdict: string;
	grounds: string;
	missing?: string;
	/** A rejected representation of an already chosen act; never authorization. */
	recovery?: "correct_proposal";
	/** Which reviewer gave this verdict (§32.10); absent on verdicts from before the typed route. */
	reviewer?: AdmissionReviewer;
	/** Whose verdict stood (§32.11, §32.12), kept so a reused row names it too. */
	path?: AdmissionPath;
	/** `review_timeout` only: the cap the review ran into (§32.12). */
	capMs?: number;
}
/** Which path decided an admission row (§32.12, §32.12.2): the compile's evidence, the typed reviewer (at once, or late at the cap), the lane, or no review at all. */
export type AdmissionPath = "compile" | "consequence" | "told" | "typed" | "typed_late" | "lane" | "none";

/**
 * Which reviewer gave a verdict (§32.10): the typed family, the lane, or the compile's evidence (§32.12). Since §32.12.3.2
 * (SL-97 phase 2b) no setting picks the reviewer: `PI_COC_ADMISSION_REVIEWER` and `PI_COC_ADMISSION_JEV_MIN_CONFIDENCE`
 * (§32.10's family rule, under which a v1 verdict at 0.9 stood, refusals included) are read by nothing.
 */
export type AdmissionReviewer = "jev" | "lane" | "compile" | "consequence" | "told";

/** Cap on the typed attempt, `PI_COC_ADMISSION_JEV_TIMEOUT_MS`; its expiry leaves every line to the lane, never admits. */
const DEFAULT_ADMISSION_JEV_TIMEOUT_MS = 4_000;
export function admissionJevTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
	const value = Number(env.PI_COC_ADMISSION_JEV_TIMEOUT_MS?.trim() || NaN);
	return Number.isFinite(value) && value > 0 ? value : DEFAULT_ADMISSION_JEV_TIMEOUT_MS;
}

/**
 * The closed set of line classes a typed admission may ever settle (§32.11's four kinds; §32.12.3.2). The data's class
 * list (`admission.typed_settle.classes` in `content/rulesets/coc7/host-budgets.json`) is kept only inside it, so data can
 * narrow the rule and never widen it to `cash` (§32.10's numeric commitment), `item`, `object`, `usage`, `map` (§32.11's
 * consent-bearing kinds) or a `resolve` (an investigator's method and target). A closed contract enum, never the prose.
 */
export const FAST_PATH_KINDS: ReadonlySet<string> = new Set(["move", "clue", "handout", "time"]);
/**
 * The settle confidence when neither the data nor the environment gives one: SL-97's pre-registered threshold, at which
 * revision 2a.3 settled 23 `time` batches of the holdout with no false admission against today's lane (§32.12.3.2).
 */
export const ADMISSION_FAST_DEFAULT_MIN_CONFIDENCE = 0.87;
/**
 * `PI_COC_ADMISSION_FAST_MIN_CONFIDENCE`: an operator's override of the data's settle confidence
 * (`admission.typed_settle.min_confidence`), read per review; `off` turns typed settling off (every line to the lane).
 */
export function admissionFastMinConfidence(env: NodeJS.ProcessEnv = process.env, dataDefault = ADMISSION_FAST_DEFAULT_MIN_CONFIDENCE): number | undefined {
	const raw = env.PI_COC_ADMISSION_FAST_MIN_CONFIDENCE?.trim();
	if (raw === "off") return undefined;
	const value = Number(raw || NaN);
	return Number.isFinite(value) && value > 0 && value <= 1 ? value : dataDefault;
}

/** The typed settle rule one review applies (§32.12.3.2), resolved once per review from data and the environment. */
export interface TypedSettlePolicy {
	/** The typed design every review reads (`admission.typed_design`). */
	design: AdmissionTypedDesign;
	/** The line classes whose typed admission may settle the line alone: the data's list inside `FAST_PATH_KINDS`; none under `v1`. */
	classes: readonly string[];
	/** The line confidence at or above which such a line settles; `undefined` when typed settling is off. */
	minConfidence: number | undefined;
}
/** Pure (§32.12.3.2): the rule a review applies, from the data file's `admission` entry and the environment. */
export function typedSettlePolicy(budget: AdmissionTypedBudget, env: NodeJS.ProcessEnv = process.env): TypedSettlePolicy {
	// A `v1` reading is kept for comparison and settles nothing; only the measured design's may.
	const classes = budget.design === "roles-2a.3" ? budget.settleClasses.filter((cls) => FAST_PATH_KINDS.has(cls)) : [];
	return { design: budget.design, classes, minConfidence: admissionFastMinConfidence(env, budget.settleMinConfidence) };
}
/** The class of proposal line `index` (§32.12.3.2): its closed effect kind, `resolve` for a `resolve`. Never the prose. */
export function lineClass(proposal: AdmissionProposal, index: number): string {
	return proposal.tool === "resolve" ? "resolve" : proposal.kinds?.[index] ?? "?";
}
/**
 * Whether a typed reading could ever settle line `index` under `policy`: its class is on the list, and inside §32.11's
 * closed set whatever the list says (a hand-built policy naming `resolve` or `cash` still settles neither).
 */
export function settleableLine(proposal: AdmissionProposal, index: number, policy: TypedSettlePolicy): boolean {
	const cls = lineClass(proposal, index);
	return FAST_PATH_KINDS.has(cls) && policy.classes.includes(cls);
}
/**
 * Pure (§32.12.3.2): whether the typed reading settles line `index` alone, without the lane. Its class is on the list,
 * typed settling is on, the reading is a complete answer over the proposal's own lines, the line's verdict admits, and its
 * confidence is at the settle confidence or above. A typed refusal never settles a line: the lane decides refusals.
 */
export function typedSettles(proposal: AdmissionProposal, typed: AdmissionJevResult | undefined, index: number, policy: TypedSettlePolicy): boolean {
	if (policy.minConfidence === undefined || !settleableLine(proposal, index, policy)) return false;
	if (typed?.status !== "decided" || typed.lines.length !== proposal.lines.length) return false;
	const line = typed.lines[index];
	return !!line && ADMITTING_VERDICTS.has(line.verdict) && line.confidence >= policy.minConfidence;
}

/** One proposal put to review: the tool, a host-owned reuse key, and the lines the reviewer reads. */
export interface AdmissionProposal {
	tool: "resolve" | "apply";
	/** Canonical form of what is proposed, for verdict reuse within a turn; never shown to a model. */
	key: string;
	lines: string[];
	/** An `apply` batch's effect kinds, in order: closed contract enums the typed route reads (§32.10). */
	kinds?: string[];
	/**
	 * §32.12.3: `lines[i]` is the batch's effect `effects[i]`. An `apply` proposal's lines are only the effects §32.1 puts to
	 * review; the others (a `person`, a `threat`, a scene rename, ...) are not shown to either reviewer and land with the batch.
	 */
	effects?: number[];
	/** An `apply` proposal's `effectSignature` per line, in the lines' order (§32.12.3.1.1 keys a line by its batch-mates' ones). */
	signatures?: string[];
	/**
	 * §32.12.3.1.1 (SL-104): the call's other reviewed lines, which this proposal does not itself propose -- a line's
	 * batch-mates. Read-only context for the lane, rendered under their own heading; their signatures are part of the key
	 * (`besideBatch`). Absent on a proposal that is its whole call.
	 */
	beside?: { lines: string[]; signatures: string[] };
}

/**
 * One proposed move target as the graph projects it. `handle` is a file name, not a name: the
 * module authors the place's own name and the names a table calls it by, and until 2026-09-15
 * neither reached here -- the reviewer read `{handle: "newspaper-morgue", label:
 * "newspaper-morgue", summary: "scene newspaper morgue"}` (the slug, the slug again, and the slug
 * de-slugged) and refused a walk into the Boston Globe three turns running, then refused it twice
 * more from the other side, reading the one node as the single room its slug is named after.
 */
export interface AdmissionDestination {
	requested: string;
	handle?: string;
	label?: string;
	summary?: string;
	/** The module's own name for the place this scene is. */
	canonical_name?: string;
	/** Other authored names for that same place. */
	aliases?: string[];
	/** The module's own answer to "can they walk in": `public`/`independent` and their opposites. */
	access?: Record<string, string>;
}

export interface AdmissionScope {
	/** Investigator names at this table; an action by anyone else is NPC initiative, not a player action. */
	party: string[];
	/** The current scene's handle and player-facing label: a `move` to it is a rename, not travel. */
	scene?: { handle?: string; label?: string };
	/** Exact read-only graph projections for proposed move targets. */
	destinations?: AdmissionDestination[];
	/** Current kernel-owned purchase ledger and saved terms for this call's cash effects. */
	cash?: Record<string, unknown>;
	/**
	 * The closed options of the `ask` the player is answering this turn (dodge, fight_back, push,
	 * spend_luck, ...). A `resolve` that settles one of them carries the player's own answer, in
	 * whatever words it came, and is not a new proposal (contract §32.1).
	 */
	answered?: string[];
}

/**
 * `apply` kinds whose landing settles a voluntary investigator action (contract §32.1). A batch
 * that carries one of them is reviewed whole and refused whole; a batch of only the other kinds
 * (Keeper bookkeeping, NPC movement, pacing, world switches, Mod registration) is not reviewed.
 */
export const TRIGGER_KINDS: ReadonlySet<string> = new Set(["move", "clue", "time", "cash", "item", "handout", "map", "object", "usage"]);

/** `resolve` decision families that are never a voluntary player action: the rules or the table run them. */
const EXEMPT_DECISION_PREFIXES: readonly string[] = ["sanity:", "development:"];

const norm = (value: unknown): string => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const text = (value: unknown): string | undefined => {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
};

/**
 * The reviewer's view of one move target, built from the graph's entity view and nothing else.
 * Keep it tight: the place's names are what tells a reviewer *where* the move goes, and the rest
 * of the projection record is module truth that the review has no business reading.
 */
export function registeredDestination(requested: string, entity: Record<string, unknown>): AdmissionDestination {
	const identity = (entity.destination_identity ?? {}) as Record<string, unknown>;
	const canonical = text(identity.canonical_name);
	const aliases = (Array.isArray(identity.aliases) ? identity.aliases : [])
		.map((value) => text(value))
		.filter((value): value is string => value !== undefined)
		.slice(0, 8);
	// `discoverability` and `direct_entry`: the module's own answer to whether walking in is a
	// thing the investigator can simply choose. It is a fact about the place, not about a hidden
	// outcome, which is the line §32.2 draws around what a review may be told.
	const declared = (entity.destination_access ?? {}) as Record<string, unknown>;
	const access = Object.fromEntries(["discoverability", "direct_entry"]
		.map((key) => [key, text(declared[key])])
		.filter((pair): pair is [string, string] => pair[1] !== undefined));
	return {
		requested,
		...(text(entity.name) ? { handle: text(entity.name) } : {}),
		...(text(entity.display_name) ? { label: text(entity.display_name) } : {}),
		...(text(entity.summary) ? { summary: text(entity.summary) } : {}),
		...(canonical ? { canonical_name: canonical } : {}),
		...(aliases.length ? { aliases } : {}),
		...(Object.keys(access).length ? { access } : {}),
	};
}

/** Stable JSON: keys sorted, so the same proposal in a different field order reuses its verdict. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
	}
	return JSON.stringify(value ?? null);
}

export function keyDigest(key: string): string {
	return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

/**
 * The fields that identify an effect (§32.4.1): every field a reviewed kind declares in the `apply` schema except the
 * rationale sentences `why` and `how` (`SENTENCE_FIELDS`). One list for every kind. It is kept by hand, so a field added
 * to a reviewed kind's schema must land here or in `SENTENCE_FIELDS`; `admission-effect-signature.test.mjs` walks the
 * schema and fails on a field that is in neither. Until 2026-09-29 the list had missed every field added after it was
 * written (`time`'s band, until, stated and beyond_travel among them), and a verdict on one time cost was reused for another.
 */
const IDENTIFYING_FIELDS: readonly string[] = [
	"to", "establish", "label", "travel_minutes", "via", "clue", "minutes", "band", "until", "stated", "beyond_travel", "delta",
	"name", "regions", "region_labels", "level_labels", "subject", "from", "with", "quantity", "dice", "scope", "object",
	"description", "category", "adopt", "condition", "weapon", "definition", "source_object", "document", "part", "offer", "handover", "check",
	"settlement", "source", "price_id", "currency", "mode", "quote", "bill", "items", "intent_ref", "intent_outcome", "owed",
];

/**
 * What a reviewer reads of a `resolve`, in the order its line gives them (§32.4.2): what the investigator chooses -- who
 * acts, which rule operation it is (`decision`, §159.5), what they try, how, against whom or what, with what, what they put on the table, which book check or scene
 * obligation the roll is, which intention it settles, whether they push, spend Luck or defend, and how a fight ends. The
 * rules parameters of the result (`modifiers`, `coercion`, `surprise`, `motive`, `mode`, `step`, `san_loss`, ...) are not
 * read: the reviewer judges the choice, never the result. A field added to the action must land here or be named as one
 * of those in `admission-effect-signature.test.mjs`, which walks the schema.
 */
export const RESOLVE_REVIEWED_FIELDS: readonly string[] = [
    "chase_roster",
	"actor", "decision", "intent", "goal", "method", "skill", "skills", "target", "weapon", "spell", "object", "usage", "support", "rule",
	"obligation", "intent_ref", "intent_outcome", "stakes", "push", "luck", "defense", "outcome",
];
/** The Keeper's rationale among them (§32.3): shown to the reviewer, outside the reuse key (§32.4). */
export const RESOLVE_RATIONALE_FIELDS: readonly string[] = ["stakes"];

/**
 * One effect's identifying fields as the reuse key reads them (§32.4, §32.4.1): `why` and `how` are outside it. Also how a
 * resend of a split batch recognises the lines that already landed (§32.12.3), and a line's batch-mates in its key
 * (§32.12.3.1.1).
 */
export function effectSignature(effect: Record<string, unknown>): string {
	const kind = text(effect.kind) ?? "?";
	return canonical({ kind, ...Object.fromEntries(IDENTIFYING_FIELDS.map((k) => [k, effect[k]]).filter(([, v]) => v !== undefined && v !== null && v !== "")) });
}

/**
 * Decide whether a call is put to review, and if so, what the reviewer reads. `null` means the
 * call is not a proposed voluntary investigator action and goes straight on: a pending choice
 * being settled (the player's own answer), a sanity or development settlement, an NPC actor, an
 * `apply` batch with no triggering kind, or a move that only renames the scene underfoot.
 */
export function admissionRequest(tool: string, payload: Record<string, unknown>, scope: AdmissionScope): AdmissionProposal | null {
	if (tool === "resolve") {
		const action = (payload.action ?? {}) as Record<string, unknown>;
		if (action.choice && typeof action.choice === "object") return null;
		const decision = norm(action.decision);
		if (EXEMPT_DECISION_PREFIXES.some((prefix) => decision.startsWith(prefix))) return null;
		const actor = text(action.actor);
		const party = scope.party.map(norm);
		if (actor && party.length && !party.includes(norm(actor))) return null;
		const answered = (scope.answered ?? []).map(norm);
		if (answered.length) {
			const defense = norm(action.defense);
			if (defense && answered.includes(defense)) return null;
			if (action.push === true && answered.includes("push")) return null;
			if (typeof action.luck === "number" && action.luck > 0 && answered.includes("spend_luck")) return null;
		}
		const pick = (keys: readonly string[]): Record<string, unknown> =>
			Object.fromEntries(keys.map((k) => [k, action[k]]).filter(([, v]) => v !== undefined && v !== null && v !== ""));
		const lines = [`resolve (settle the specified rule operation): ${Object.entries(pick(RESOLVE_REVIEWED_FIELDS)).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("; ")}`];
		// §32.4.2: the key is what the reviewer read, less the Keeper's rationale.
		const key = canonical({ tool, action: pick(RESOLVE_REVIEWED_FIELDS.filter((field) => !RESOLVE_RATIONALE_FIELDS.includes(field))) });
		return { tool: "resolve", key, lines };
	}
	if (tool === "apply") {
		const effects = Array.isArray(payload.effects) ? (payload.effects as Array<Record<string, unknown>>) : [];
		const here = [scope.scene?.handle, scope.scene?.label].filter(Boolean).map(norm);
		const destination = (effect: Record<string, unknown>) => scope.destinations?.find(value => norm(value.requested) === norm(effect.to));
		// §32.1: whether one effect is put to review on its own. Since §32.12.3's amendment (the owner's ruling after SL-30's
		// measurement) this also decides which lines the reviewers read: the others land with the batch unreviewed.
		const reviewed = (effect: Record<string, unknown>): boolean => {
			const kind = text(effect?.kind);
			if (!kind || !TRIGGER_KINDS.has(kind)) return false;
			if (kind === "cash" && effect.mode === "quote") return false;
			if (kind === "move" && here.includes(norm(effect.to)) && !text(effect.label)) return false;
			if (kind === "object") {
				// Adoption enriches an owned row; same-owner edits record state rather than transfer it.
				if (!text(effect.to) || text(effect.adopt) || text(effect.from) && norm(effect.from) === norm(effect.to)) return false;
			}
			return true;
		};
		const shown = effects.flatMap((effect, index) => reviewed(effect) ? [index] : []);
		if (!shown.length) return null;
		const describe = (effect: Record<string, unknown>): string => {
			const kind = text(effect.kind) ?? "?";
			const fields = Object.entries(effect)
				.filter(([k, v]) => k !== "kind" && !k.startsWith("_") && v !== undefined && v !== null && v !== "")
				.map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v)}`);
			const registered = kind === 'move' ? destination(effect) : undefined;
			return `apply ${kind}: ${fields.join("; ")}${kind === 'cash' && scope.cash ? `; registered_cash_context=${JSON.stringify(scope.cash)}` : ''}${registered ? `; registered_destination=${JSON.stringify({handle: registered.handle, label: registered.label, summary: registered.summary,
					...(registered.canonical_name ? {canonical_name: registered.canonical_name} : {}), ...(registered.aliases?.length ? {also_called: registered.aliases} : {}),
					...(registered.access ? {access: registered.access} : {})})}` : ''}`;
		};
		const signatures = effects.map(effectSignature);
		// Each line's own signature, taken before the sort below reorders `signatures` in place.
		const lineSignatures = shown.map((index) => signatures[index]!);
		const ordered = effects.some(effect => effect.kind === 'object' || effect.kind === 'usage');
		const key = canonical({ tool, effects: ordered ? signatures : signatures.sort(), destinations: scope.destinations ?? [], ...(scope.cash ? {cash:scope.cash} : {}) });
		// The key stays the whole batch's (§32.4); the lines are only the reviewed effects (§32.12.3).
		return { tool: "apply", key, lines: shown.map((index) => describe(effects[index]!)), kinds: shown.map((index) => text(effects[index]!.kind) ?? "?"), effects: shown,
			signatures: lineSignatures };
	}
	return null;
}

export interface AdmissionContext {
	turn: number;
	/** The exact current player text; the review has no authority without it. */
	playerText: string;
	/** The immediately preceding declaration when that turn ended stranded and delivered nothing. */
	interruptedPlayerText?: string;
	investigators: Array<{ name: string; occupation?: string }>;
	scene?: string;
	present: string[];
	/** What the player has already been told, oldest first: the setup prologue, then earlier deliveries. */
	delivered: Array<{ turn: number | string; player?: string | null; keeper: string }>;
	/** What this turn has already settled through the kernel, in order. */
	landed: string[];
	/** Proposals already refused this turn, so a rewording is read as the same action. */
	refused: string[];
	/** Earlier argument mismatches, not withdrawn player declarations or missing choices. */
	corrections?: string[];
	/**
	 * §11.5.4 (SL-51): the book's own text the host carried to the Keeper this turn (Keeper-only; never what the player was
	 * told). Read by the typed reviewer only; the lane's prompt is unchanged.
	 */
	bookText?: Array<{ where: string; text: string }>;
}

const KEEPER_WINDOW_CHARS = 1500;

function clip(value: string, limit: number): string {
	return value.length <= limit ? value : `${value.slice(0, limit)} […]`;
}

/** Host-owned policy beside computed preview facts; typed Jev reads it in the proposal line too. */
export const CASH_CONSENT_POLICY = "Use the kernel preview's actual delta, not a unit price or nominal amount. Zero cash delta under living-standard or daily Spending Level coverage needs only the player's choice of the complete service/item, without prior price disclosure or second confirmation. Actual cash debits and new commitments need accepted terms or applicable delegation. Coverage never authorizes an unchosen service or extras.";

export function admissionSystemPrompt(): string {
	return [
		HANDOVER_GROUND_NOTE,
		"When the player already chose an act but the proposed arguments misrepresent it, refuse that proposal with recovery correct_proposal. This does not authorize the proposal. State the mismatch in grounds, not a choice already made in missing. A corrected proposal is judged afresh; earlier argument mismatches do not withdraw the player's declaration. Actual unchosen actions, methods, targets or commitments retain the ordinary refusal and missing choice.",
		"You are the action-admission reviewer at a Call of Cthulhu table. The Keeper (the game master, an AI) proposes a resolution or effects. First classify each component: is it the investigator's voluntary action, or genuine NPC initiative, environmental force, rules acting on the investigator, or a consequence of something already chosen and settled? The latter are not_player_action: an involuntary destination, elapsed time, hidden danger or outcome does not require the player to know, name or choose it beforehand. You judge agency and consent, not whether a consequence is true or supported by the module.",
		"Only for voluntary investigator actions, answer: did the player choose this? In a mixed batch, every voluntary component still needs authorization; non-voluntary components do not authorize the rest. Calling something a 'consequence' or 'forced' is not evidence that it is involuntary and cannot disguise a new voluntary route, method, purchase or cost. An NPC demanding payment is not the investigator choosing to pay.",
		"For that consent judgment, judge only from the player's exact current words, what the player was already told (the earlier deliveries), and any still-valid earlier instruction the player gave and did not withdraw. The Keeper's own goal, method, why, how and stakes text describes the proposal; it is not evidence of the player's consent. A Keeper suggestion in earlier narration is not acceptance. Interest in a subject is not a trip to a place. Risk in an action the player chose does not license a different method, destination or target.",
		"When an immediately preceding declaration is labeled unfinished, its turn ended without a Keeper delivery and the action was not thereby withdrawn. Read it together with the current words: a bare request to continue may resume it; current words may instead narrow, replace or withdraw it. The unfinished declaration is context, not automatic authorization. Judge that relationship semantically.",
		"Explicit limits on money, quantity, duration and scope are binding. Compare proposed debits and commitments with the chosen limit; do not round a budget upward, add a deposit, buy extra nights, or use an earlier offer to override the latest choice. A request for one night with a budget of 2.50 does not authorize a debit of 3.00 described as a deposit or two nights. A goal such as lodging authorizes only its chosen scope. If a proposed value exceeds a stated limit, answer not_authorized and identify both values in grounds; the Keeper's why cannot make the excess entailed.",
		"For a cash proposal, registered_cash_context.previews carries the kernel-computed actual delta beside purchase_amount. Use that actual debit for cash-budget consent; do not add the ledger yourself or substitute the item's price. A price of 1 can debit 11 when earlier covered spending reaches the daily limit. A zero actual delta is covered bookkeeping for the chosen expense, not a new cash commitment.",
		"Structured quotation drafts in narrate.quotes or beside apply's closing prose are also offers only, outside the proposed action lines. They cannot turn a proposed move or conversation into a purchase; judge the actual proposed effects, without importing an unproposed payment from their offer context. Cash mode=quote only records the Keeper's priced offer: it spends no money and transfers no object, so it is Keeper bookkeeping, not player acceptance. For a payment, category=living claims ordinary food, accommodation or incidental travel within the investigator's established living standard; judge this contextual claim, never accept an unrelated luxury or transfer as living expenses. Category=purchase is additional daily spending: the kernel enforces the current day's cumulative limit and charges its full total when exceeded, accounting for cash already charged. Coverage never authorizes an unchosen item or service. A covered chosen expense does not need an earlier price disclosure or a second confirmation. Still judge whether the player chose the service, item or activity itself. Actual cash commitments still need disclosed accepted terms or applicable delegation. A player's explicit request to pay the price the NPC names is a delegation, while asking the price alone is not. Do not invent or recompute a saved quote's amount.",
		"Only for an actual cash debit, surrender of possessions or other new resource commitment, find terms in what the player was told and subsequently accepted, or a still-valid delegation. A chosen service with kernel-previewed zero actual cash delta needs no earlier price disclosure or second confirmation. 'Fill it up' chooses filling the tank; judge that full service, not an unproposed extra purchase. For an actual five-dollar cash debit, that request before any quote does not accept the price; accepting an earlier five-dollar quote does. A source price, affordability, custom or the Keeper's rationale is not consent. Quoting a price in the same delivery as an actual debit is too late. Routine time and effort of the chosen covered service stay entailed. An unchosen service or meaningful new scope still needs the player's choice. Without acceptance or delegation for actual cash commitments, answer not_authorized, or uncertain if genuinely unclear, and identify the missing acceptance.",
		"An object pickup or transfer is a real proposed action, even beside definition or usage preparation. A usage describes the chosen way an object will be used; preparing it must not invent an attack the player only contemplated. Choosing to take a chair and swing it entails the necessary pickup and parameter preparation, not a different target or method. A different object's or usage's permission is not reusable. Pure owned-equipment adoption and same-owner state recording are bookkeeping; an NPC's own initiative remains not_player_action. Preparing parameters does not settle the attack or grant an extra action.",
		"For a voluntary move, the following destination-choice and commitment restrictions apply; they do not require consent to an involuntary displacement or its hidden destination or elapsed time. registered_destination is authoritative evidence of what the target scene physically is. Read it by its names, not by its handle: handle is a file name, often the slug of one room, while canonical_name is the module's own name for the place and also_called lists the other names it is known by. A player who names the place by any of those names, in any language, has named this destination. A label may present that same place in the player's language; it cannot substitute a different city, building or destination. If the player chooses Athens but the registered target is a Boston hotel, answer not_authorized even when label says Athens. A genuinely new chosen destination can be registered atomically by move.establish with a summary and via. This addition does not require source publication or adaptation review. Judge whether the player chose that destination and the proposed action; missing graph coverage is not missing player authorization.",
		"For that voluntary move, a part, entrance, room, floor, counter or aspect of a registered place is that place; only a genuinely different physical place is a different destination. A registered scene is the module's whole grain for a place, so a move to it is arrival at that place's threshold -- its street door, its lobby, the counter or desk on the way in. It is never a claim about how far inside the investigator gets: whoever waits inside, and any permission, price, gate, search or danger staged there, remain proposals of their own, judged on their own when the Keeper puts them. So a player who names the outside of the place and a player who names a room inside it while saying they will first deal with the person at the door are both choosing this same move. Do not refuse it as reaching too far in, and do not refuse it as not naming the registered room: a place refused from both sides cannot be reached by any wording the player has, and a player who describes where they are going in more detail must not be refused for the detail.",
		"Verdicts:",
		"- authorized: the player's words, read in context, choose this actor, goal, method, target, destination and any meaningful cost or commitment.",
		"- entailed: the player chose the meaningful goal, and this is a routine step that goal requires — crossing the room they asked to search, the minutes a chosen search takes, the roll the chosen method calls for, the way back they already took.",
		"- not_player_action: this is not the investigator's voluntary action — an NPC acting on their own, the world or the rules acting on the investigator, a consequence of something already chosen and settled, Keeper bookkeeping.",
		"- not_authorized: the Keeper is choosing for the player — a new destination, a new method (picking a lock the player only looked at; bribing or threatening a guard the player only asked), a new target, a cost or commitment, a route the Keeper offered that the player has said nothing about, or an action the player only showed interest in.",
		"Picking one of the options the delivery itself named is a choice: where an NPC has just said which archives to try, \"then the newspapers\" chooses that destination and the travel it takes comes with it. This holds only for what the player was actually told; when the delivery named no such place, the same words are interest in a subject and choose nothing. And it never reaches the situation waiting there -- a gatekeeper to get past, a price, a danger staged on arrival are proposals of their own, judged on their own.",
		"- uncertain: the words and context do not settle it.",
		"You judge the choice, never the result: do not ask that the player knew or approved hidden dangers, surprises or outcomes. A short, quiet or plain reply is still a reply — read what it says. An action already refused this turn and proposed again in other words is the same action.",
		"Answer with one JSON object only, no code fence and no explanation:",
		'{"verdict":"authorized"|"entailed"|"not_player_action"|"not_authorized"|"uncertain","grounds":"<=200 chars: the words you relied on","missing":"<only for not_authorized or uncertain: the choice the player has not made, <=160 chars, as a plain description of the choice, not a menu>"}',
		"Only for a refused representation of an already chosen act, include recovery: correct_proposal instead of missing. Never include recovery on an admitting verdict.",
		"Write grounds and missing in English: they are read by the Keeper, who writes to the player in the player's own language. Quote the player's words as they are.",
	].join("\n");
}

/**
 * §32.12.3.1.1 (SL-104): the heading a line's batch-mates are read under, just before `[The Keeper now proposes]`. The line
 * is still judged alone; the batch-mates are what the same call does beside it, each judged in its own review.
 */
export const BESIDE_HEADING = "[Also proposed in the same call, beside the line you judge -- read only; each is judged in its own review, not in yours]";

export function buildAdmissionInput(proposal: AdmissionProposal, context: AdmissionContext): string {
	const who = context.investigators.length
		? context.investigators.map((i) => (i.occupation ? `${i.name} (${i.occupation})` : i.name)).join(", ")
		: "(unknown)";
	const told = context.delivered.length
		? context.delivered
				.map((row) => {
					const player = text(row.player) ? `player said: ${clip(String(row.player), 400)}\n` : "";
					return `[turn ${row.turn}] ${player}Keeper delivered: ${clip(row.keeper, KEEPER_WINDOW_CHARS)}`;
				})
				.join("\n\n")
		: "(nothing yet)";
	return [
		`[Investigator${context.investigators.length > 1 ? "s" : ""}] ${who}`,
		`[Scene, as the player knows it] ${context.scene ?? "(unnamed)"}${context.present.length ? `; present: ${context.present.join(", ")}` : ""}`,
		"",
		"[What the player was already told, oldest first]",
		told,
		"",
		`[The player's exact words this turn (turn ${context.turn})]`,
		context.playerText,
		...(context.interruptedPlayerText ? [
			"",
			"[Immediately preceding unfinished player declaration]",
			context.interruptedPlayerText,
		] : []),
		"",
		"[Already settled this turn]",
		context.landed.length ? context.landed.map((line) => `- ${line}`).join("\n") : "(nothing)",
		"",
		"[Already refused this turn]",
		context.refused.length ? context.refused.map((line) => `- ${line}`).join("\n") : "(nothing)",
		...(context.corrections?.length ? ["", "[Earlier mismatched proposals; the player's declaration still stands, and a corrected proposal requires fresh review]", ...context.corrections] : []),
		"",
		...(proposal.beside?.lines.length ? [BESIDE_HEADING, proposal.beside.lines.map((line) => `- ${line}`).join("\n"), ""] : []),
		"[The Keeper now proposes]",
		proposal.lines.map((line) => `- ${line}`).join("\n"),
	].join("\n");
}

/** Shape check only: a closed enum and two strings; every judgement is the model's. */
export function shapeVerdict(parsed: unknown): AdmissionVerdict | undefined {
	if (!parsed || typeof parsed !== "object") return undefined;
	const row = parsed as Record<string, unknown>;
	const verdict = typeof row.verdict === "string" ? row.verdict.trim().toLowerCase() : "";
	if (!ADMITTING_VERDICTS.has(verdict) && !REFUSING_VERDICTS.has(verdict)) return undefined;
	const grounds = typeof row.grounds === "string" ? row.grounds.trim().slice(0, 300) : "";
	const missing = typeof row.missing === "string" && row.missing.trim() ? row.missing.trim().slice(0, 240) : undefined;
	if (row.recovery !== undefined && (row.recovery !== "correct_proposal" || ADMITTING_VERDICTS.has(verdict) || missing !== undefined)) return undefined;
	return { verdict, grounds, ...(missing ? { missing } : {}), ...(row.recovery === "correct_proposal" ? {recovery: "correct_proposal" as const} : {}) };
}

/** The refusal the Keeper reads when the review did not admit the action (contract §32.2). */
export function admissionRefusal(proposal: AdmissionProposal, verdict: AdmissionVerdict, correctionAvailable = false): KernelError {
	if (verdict.recovery === "correct_proposal") return new KernelError({
		code: "needs", message: "The proposed arguments do not represent the action the player already chose",
		fix: correctionAvailable
			? "Nothing of this batch has happened. Preserve the player's declared act; do not ask them to choose it again. Correct the proposed arguments once to represent that same act, without adding a target, method, cost or commitment. The corrected batch must pass fresh admission. Do not resend the unchanged rejected proposal."
			: "Nothing of this batch has happened. The correction allowance for this turn is spent. Do not retry or narrate the refused effects. Preserve the player's declaration and any existing receipts; do not turn an internal argument mismatch into a new player choice.",
		details: {reason: "action_proposal_mismatch", verdict: verdict.verdict, recovery: verdict.recovery,
			correction_allowed: correctionAvailable, grounds: verdict.grounds, proposed: proposal.lines, tool: proposal.tool},
	});
	const missing = verdict.missing ?? (verdict.verdict === "uncertain"
		? "whether the player chose this action at all is not clear from their words"
		: "the player has not chosen this action");
	return new KernelError({
		code: "needs",
		message: verdict.verdict === "uncertain"
			? "It is not clear from the player's words that they chose this action"
			: "The player has not chosen this action",
		fix: "Do not roll, move, spend time or money, or land clues, documents or items for it, and do not resend the same action in other words. Whatever this turn already settled with a receipt (a roll made, an effect that landed) did happen and is still narrated; only this refused batch is not. Close the turn with narrate: take up what the player actually said, and put the choice named in details.missing in front of them in the fiction, without a menu, so that they can make it.",
		details: {
			reason: "action_not_authorized",
			verdict: verdict.verdict,
			missing,
			grounds: verdict.grounds,
			proposed: proposal.lines,
			tool: proposal.tool,
			...(verdict.reviewer ? { reviewer: verdict.reviewer } : {}),
		},
	});
}

/**
 * No review, no authority (contract §32.2): the Keeper is told the service status, and tells the
 * player as such. The first failure of a streak reads as transient — the player's next input may try
 * again. A repeated one drops that promise: the operator has been notified out of fiction, and the
 * player is not asked to resend words that were never the problem.
 */
export function admissionUnavailable(proposal: AdmissionProposal, reason: string, detail: string, streak = 1): KernelError {
	const landed = "Only this batch is unsettled: whatever this turn already settled with a receipt (a roll made, an effect that landed) did happen and is narrated as usual. For this batch, do not roll or land anything, do not narrate its effects as having happened, and do not retry it";
	// §47 as amended by §22.4.4 (SL-37): a lane that did not answer is the clerk's business, never the prose. The Keeper is told what
	// is unsettled and what to do, never a sentence for the player; on SL-29A book A t7 "the service did not connect, go on next time" reached
	// the fiction from the line this used to hand over. The operator is told out of the game (`coc-admission-status`, streak 2).
	const fix = `${landed} this turn. Previously delivered fiction still stands; never retract it. The action review did not answer, and that is the clerk's business, not the player's:`
		+ " do not put the review, the service or its failure into the fiction or the prose, and do not ask the player to say their action again."
		+ " Close the turn with narrate: take up what the player actually said, without that batch's effects."
		+ (streak >= 2 ? ` The action review has failed ${streak} times in a row, so a resend will not fix it; the operator has been notified outside the game. Do not promise that the next input will work.`
			: " The player's next input can try again.");
	return new KernelError({
		code: "needs",
		message: "The action review is unavailable, so this action cannot be settled now",
		fix,
		details: { reason: "admission_unavailable", cause: reason, detail: detail.slice(0, 200), streak, proposed: proposal.lines, tool: proposal.tool },
	});
}

/**
 * The lane review ran into its cap (§32.12). It judged nothing about the player's choice, so the Keeper is told that, not
 * a missing choice; and it is not an outage, so there is no service notice. The identical proposal is refused again at
 * once this turn (§32.4), and the player's next input is free to try.
 */
export function admissionTimedOut(proposal: AdmissionProposal, capMs: number, ms: number): KernelError {
	const seconds = Math.round(capMs / 100) / 10;
	return new KernelError({
		code: "needs",
		message: `The action review did not answer within its ${seconds} s cap, so this action is not settled this turn`,
		fix: "Nothing of this refused batch happened: do not roll, move, spend time or money, or land clues, documents or items for it, do not narrate its effects as having happened, and do not resend it this turn. The review judged nothing about the player's choice. Whatever this turn already settled with a receipt did happen and is narrated as usual. Close the turn with narrate: take up what the player actually said; the player's next input can try again.",
		details: { reason: REVIEW_TIMEOUT, cap_ms: capMs, ms, proposed: proposal.lines, tool: proposal.tool },
	});
}

/**
 * §32.12.2: the review did not answer within the cap, and nothing that did answer can stand. The Keeper is told the
 * review is still running and may resend the identical call once to collect it; nothing of the batch has happened. The
 * typed reviewer's early reading travels as information, never as a verdict.
 */
export function admissionPending(proposal: AdmissionProposal, capMs: number, ms: number, waitMs: number, typed?: TypedReading): KernelError {
	const seconds = (value: number) => Math.round(value / 100) / 10;
	return new KernelError({
		code: "needs",
		message: `The action review has not answered within its ${seconds(capMs)} s cap; it is still running, so this action is not settled yet`,
		fix: `Nothing of this batch has happened yet: do not narrate its effects. Resend this identical call once, unchanged, as your next tool call: the host keeps this review and answers the resend with its verdict, waiting at most ${seconds(waitMs)} s more. A reworded call is a new review, not the resend. details.typed is the typed reviewer's early reading, not a verdict. If the resend is refused, close the turn with narrate taking up what the player actually said; whatever this turn already settled with a receipt did happen and is narrated as usual.`,
		details: { reason: REVIEW_PENDING, cap_ms: capMs, ms, resend: "once", wait_ms: waitMs, typed: typed ? typedDetails(typed) : null, proposed: proposal.lines, tool: proposal.tool },
	});
}

/** The typed reviewer's answer as the concurrent review keeps it (§32.12.2): what Jev said, never whether it stood. */
export interface TypedReading {
	status: "decided" | "fallback";
	reason?: string;
	verdict?: string;
	confidence?: number;
	lineVerdicts?: string[];
	grounds?: string;
	missing?: string;
}
export function typedDetails(typed: TypedReading): Record<string, unknown> {
	return typed.status === "decided"
		? { verdict: typed.verdict, confidence: typed.confidence, line_verdicts: typed.lineVerdicts ?? [], grounds: typed.grounds ?? "", ...(typed.missing ? { missing: typed.missing } : {}) }
		: { verdict: null, reason: typed.reason ?? "no_answer", ...(typed.confidence === undefined ? {} : { confidence: typed.confidence }) };
}

export type AdmissionOutcome =
	| { ok: true; verdict: AdmissionVerdict; ms: number; model: string; reviewer?: AdmissionReviewer; meta?: Record<string, unknown> }
	/** `typed`: the typed reviewer's reading when it had answered (§143.15 reads it for a declared action's late admission). */
	| { ok: false; reason: string; detail: string; ms: number; model?: string; reviewer?: AdmissionReviewer; meta?: Record<string, unknown>; typed?: TypedReading }
	/**
	 * §32.12.2: no sufficient verdict -- the cap passed (`cause: "cap"`, and `lane` is the review still running, until the
	 * hard cap) or the lane answered without grounds (`cause: "no_grounds"`, nothing running). The caller decides between
	 * the late admission and `review_pending`. Never an admit by itself.
	 */
	| { ok: "late"; cause: "cap" | "no_grounds"; ms: number; capMs: number; hardCapMs: number; typed?: TypedReading; lane?: Promise<AdmissionOutcome>; meta: Record<string, unknown>;
		/** §32.12.3.2: the line classes the typed reading may settle; the late admission is confined to them. */
		settleClasses: readonly string[] }
	/**
	 * §32.12.3: the typed answer admitted some lines of an `apply` batch and not the rest, and the caller reviews the
	 * remainder on its own. Since §32.12.3.2 (SL-97 phase 2b) `reviewAdmissionPrimary` no longer returns it: a typed-settled
	 * line is one line's outcome inside `ok: "lines"`, and the batch lands whole or not at all. Kept for the caller's
	 * remainder machinery, which nothing reaches.
	 */
	| { ok: "split"; cleared: number[]; ms: number; attempt: TypedAttempt; capMs: number; hardCapMs: number; startedAt: number; meta: Record<string, unknown> }
	/**
	 * §32.12.3.1 (SL-101): an `apply` batch of more than one reviewed line was put to the lane one line per call, all at
	 * once. `lines[i]` is line i's own outcome, exactly what a review of that line alone gives: a lane verdict, a lane
	 * failure, `late` (its cap passed with its round still running, or it answered without grounds), or since §32.12.3.2 a
	 * typed verdict (`path: "typed"`) when the typed reading settled that line and its lane call was cancelled. The caller
	 * settles each line on its own (§32.4 keyed by line) and combines them into the batch's verdict (§32.10's mapping, as
	 * §32.12.3 maps a remainder). `attempt` is the batch's typed answer when it came in.
	 */
	| { ok: "lines"; lines: AdmissionOutcome[]; ms: number; capMs: number; hardCapMs: number; startedAt: number; attempt?: TypedAttempt; meta: Record<string, unknown>;
		/** Stops the rounds still running: a line already refused decides the batch (§32.10), so the rest need not answer. */
		abort: () => void };

export interface AdmissionReviewOptions {
	providerBudget?: import('../../runtime/jev/provider-budget.ts').TaskProviderBudget;
	ctx: ExtensionContext;
	proposal: AdmissionProposal;
	context: AdmissionContext;
	record: (row: Record<string, unknown>) => Promise<void> | void;
	signal?: AbortSignal;
	timeoutMs?: number;
	/**
	 * SL-87, tests only: the clock the review is timed on -- its start, the cap, the hard cap (the lane round's deadline)
	 * and every `ms` it reports, and the typed attempt's deadline. Absent: the host's own clock and timers, exactly as before.
	 */
	clock?: TaskClock;
}

/**
 * One review round through the shared lane runner (contract §12.5's pattern, §32's remit). Never throws. A round cut at
 * `timeoutMs` is the host's `review_timeout` verdict; an answer whose grounds are empty is no verdict (`no_grounds`,
 * §32.12.2): it neither admits nor refuses, and it is not an outage.
 *
 * §143.15 (ticket 16): an answer that is not a verdict at all (`bad_output`) is asked for once more inside the same round,
 * with one line saying why, under the round's one deadline; the second bad answer is the lane's `bad_output`. Only a
 * malformed answer is retried: a provider error, a missing model or a timeout is not something asking again repairs.
 * The outcome's `meta.attempts` says how many completions the round sent.
 */
export async function reviewAdmission(options: AdmissionReviewOptions): Promise<AdmissionOutcome> {
	const capMs = options.timeoutMs ?? admissionTimeoutMs();
	// SL-87: the round is timed on the review's clock (a test's own clock when one is given), as the lane runner is.
	const clock = options.clock ?? hostClock;
	const began = clock.now(), deadline = began + capMs;
	const input = buildAdmissionInput(options.proposal, options.context);
	let lane: LaneResult<AdmissionVerdict> | undefined, model: string | undefined, firstByteMs: number | undefined, previous: string | undefined;
	let attempts = 0;
	for (let attempt = 1; attempt <= ADMISSION_LANE_ATTEMPTS; attempt++) {
		const startedAt = clock.now(), left = deadline - startedAt;
		// No time left for the second attempt: the round produced no verdict by its deadline, which is a timeout (§32.12).
		if (left <= 0) { lane = { ok: false, reason: "timeout", detail: `the lane did not answer within ${capMs} ms: none was left for another attempt`, ms: startedAt - began }; break; }
		attempts = attempt;
		lane = await runLane<AdmissionVerdict>({
			providerBudget: options.providerBudget,
			ctx: options.ctx,
			envName: "PI_COC_ADMISSION_MODEL",
			lane: "admission",
			record: options.record,
			systemPrompt: admissionSystemPrompt(),
			input: previous === undefined ? input : admissionRetryInput(input, previous),
			...(options.signal ? { signal: options.signal } : {}),
			timeoutMs: left,
			...(options.clock ? { clock: options.clock } : {}),
			shape: shapeVerdict,
		});
		model = lane.model ?? model;
		// From the round's first request to the first response headers any attempt received (§32.12's `first_byte_ms`).
		if (firstByteMs === undefined && lane.firstByteMs !== undefined) firstByteMs = startedAt - began + lane.firstByteMs;
		if (lane.ok || lane.reason !== "bad_output" || options.signal?.aborted) break;
		previous = lane.detail;
	}
	const ms = clock.now() - began;
	const meta = { path: "lane", first_byte_ms: firstByteMs ?? null, attempts };
	// §32.12: a round cut at its cap -- whether the provider never answered or answered and streamed past it -- is the
	// host's `review_timeout` verdict, a refusal; never an outage, and never an admit.
	if (!lane!.ok && lane!.reason === "timeout") return { ok: true,
		verdict: { verdict: REVIEW_TIMEOUT, grounds: `no verdict within the ${capMs} ms cap`, reviewer: "lane", path: "lane", capMs },
		ms, model: model ?? "", reviewer: "lane", meta: { ...meta, timed_out: true, cap_ms: capMs } };
	if (!lane!.ok) return { ok: false, reason: lane!.reason, detail: lane!.detail, ms, ...(model ? { model } : {}), reviewer: "lane", meta };
	const answer = lane!.value;
	// §32.12.2: only a verdict with grounds is a verdict. The prompt asks for the words relied on; an answer without them
	// cannot be read back by the Keeper or audited, so it is treated as no answer.
	if (!answer.grounds.trim()) return { ok: false, reason: NO_GROUNDS, detail: `the lane answered ${answer.verdict} with no grounds`, ms,
		model: model ?? "", reviewer: "lane", meta: { ...meta, lane_verdict: answer.verdict } };
	return { ok: true, verdict: { ...answer, reviewer: "lane", path: "lane" }, ms, model: model ?? "", reviewer: "lane", meta };
}

export interface PrimaryAdmissionReviewOptions extends AdmissionReviewOptions {
	campaign: string;
	env?: NodeJS.ProcessEnv;
	/** An explicit port for isolated tests and offline replay; production uses the shared adapter. */
	decision?: DecisionPort;
	/** §32.12.3: a typed answer already in hand (the remainder's share of the batch's); no typed call is made. */
	typedAttempt?: TypedAttempt;
	/** When the call's review began: the cap and the hard cap are measured from it (§32.12.2), across a split (§32.12.3). */
	startedAt?: number;
	/** The lane round's deadline, measured from `startedAt`; default twice the cap. */
	hardCapMs?: number;
}

/** One typed answer as the review keeps it: Jev's result (or none) and its telemetry. */
export type TypedAttempt = { typed: AdmissionJevResult | undefined; meta: Record<string, unknown> };

/**
 * §32.12.3: the typed answer the remainder of a split batch is reviewed with -- the batch's own answer on the lines that
 * stayed behind, mapped as §32.10 maps a batch (the first refusing line decides; the confidence is the lowest). Where the
 * batch's deciding line is among them, its host-derived grounds and missing choice are kept. No new typed call.
 */
export function remainderAttempt(attempt: TypedAttempt, keep: number[]): TypedAttempt {
	const answer = attempt.typed;
	if (!answer?.lines || !keep.length) return { typed: undefined, meta: { jev_calls: 0 } };
	const lines = keep.map((index) => answer.lines![index]!);
	const verdict = batchVerdict(lines.map((line) => line.verdict));
	const confidence = Math.min(...lines.map((line) => line.confidence));
	const deciding = answer.lines.findIndex((line) => line.verdict === verdict);
	const inherited = answer.status === "decided" && answer.verdict === verdict && keep.includes(deciding);
	const described = lines.map((line, n) => `line ${keep[n]! + 1} ${line.verdict} ${line.confidence}`).join("; ");
	const grounds = inherited && answer.status === "decided" ? answer.grounds : `typed review of the lines still under review: ${described}`;
	const missing = REFUSING_VERDICTS.has(verdict) ? (inherited && answer.status === "decided" && answer.missing ? answer.missing
		: verdict === "uncertain" ? "whether the player chose this is not clear from their words" : "the player has not chosen this action") : undefined;
	return {
		typed: { status: "decided", verdict, grounds, ...(missing ? { missing } : {}), confidence, lines, calls: 0, elapsedMs: 0, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } },
		meta: { jev_calls: 0, jev_confidence: confidence, line_verdicts: lines.map((line) => line.verdict), line_confidences: lines.map((line) => line.confidence), jev_carried: true },
	};
}

/**
 * §32.12.3.1 (SL-101): whether a proposal's lane review is one call per line. Only an `apply` batch with more than one
 * reviewed line: a `resolve` is one line, and a one-line batch is reviewed exactly as before.
 */
export function reviewedPerLine(proposal: AdmissionProposal): boolean {
	return proposal.tool === "apply" && proposal.lines.length > 1;
}
/**
 * §32.12.3.1: line `index` of a batch as the lane reads it -- the batch's proposal with exactly that one line (and its
 * kind, effect index and signature). The key is the batch's: the lane never reads it, and the caller keys each line's
 * verdict by the key a call of only that line would have (§32.4), extended by its batch-mates (`besideBatch`).
 *
 * §32.12.3.1.1 (SL-104): the line's `beside` is every other reviewed line of the call -- the batch's other lines and those
 * the batch itself was proposed beside -- so its call reads what the same call does beside it.
 */
export function lineProposal(proposal: AdmissionProposal, index: number): AdmissionProposal {
	const others = <T>(values: T[]) => values.filter((_, at) => at !== index);
	// A hand-built proposal with no signatures is keyed by its lines' text, which only ever makes reuse rarer.
	const signatures = proposal.signatures ?? proposal.lines;
	const lines = [...others(proposal.lines), ...(proposal.beside?.lines ?? [])];
	const besideSignatures = [...others(signatures), ...(proposal.beside?.signatures ?? [])];
	const { beside: _batchBeside, ...rest } = proposal;
	return { ...rest, lines: [proposal.lines[index]!], ...(proposal.kinds ? { kinds: [proposal.kinds[index] ?? "?"] } : {}),
		...(proposal.effects ? { effects: [proposal.effects[index]!] } : {}), signatures: [signatures[index]!],
		...(lines.length ? { beside: { lines, signatures: besideSignatures } } : {}) };
}
/**
 * §32.12.3.1.1 (SL-104), pure: `proposal` as proposed beside `beside` -- the other reviewed lines of its call. It carries
 * them for the lane to read, and its key is extended by their signatures, order-free, so a verdict given beside them is
 * reused only beside the same lines (§32.4's `why` and the other rationale fields stay outside, as `effectSignature` has
 * them). With no batch-mates the proposal is returned as it is: a one-line call keeps the key it always had.
 */
export function besideBatch(proposal: AdmissionProposal, beside: AdmissionProposal["beside"]): AdmissionProposal {
	if (!beside?.lines.length) return proposal;
	return { ...proposal, beside: { lines: [...beside.lines], signatures: [...beside.signatures] },
		key: canonical({ line: proposal.key, beside: [...beside.signatures].sort() }) };
}
/**
 * §32.12.3.1: the batch's typed answer as line `index` reads it on its own -- that line's verdict and confidence, which
 * is what its late admission (§32.12.2, per call) and its pending details read. A typed non-verdict stays one.
 */
export function lineReading(attempt: TypedAttempt | undefined, index: number): TypedReading | undefined {
	const answer = attempt?.typed;
	if (!answer) return undefined;
	if (answer.status !== "decided" || !answer.lines?.[index]) return readingOf(answer);
	return readingOf(remainderAttempt(attempt!, [index]).typed);
}

/**
 * §32.12.3.1: the refusal of a proposal whose lines were reviewed one per call, from the refusals of the lines that were
 * not admitted -- §32.10's mapping, under which a batch is admitted only when every line admits. A line refused on grounds
 * decides (`not_authorized` before `uncertain`, the first such line in the batch's order, as §32.10 names line k);
 * otherwise a line whose review was unavailable (§32.2), then one whose resend ran out of its hard cap (`review_timeout`),
 * then the lines still under review (`review_pending`, §32.12.2), on which alone the batch is pending. The deciding line's
 * refusal is the batch's (its code, message, fix and details), with every line of the batch proposed, `line_outcomes`
 * naming each line that was not admitted and why, and for a pending batch `pending_lines` and the longest `wait_ms`.
 */
export function batchRefusal(tool: AdmissionProposal["tool"], proposed: string[], entries: Array<{ line: string; error: KernelError }>): KernelError {
	const reasonOf = (error: KernelError) => String(error.details?.reason ?? error.code);
	const find = (test: (error: KernelError) => boolean) => entries.find((entry) => test(entry.error));
	const deciding = find((error) => reasonOf(error) === "action_not_authorized" && error.details?.verdict === "not_authorized")
		?? find((error) => reasonOf(error) === "action_not_authorized")
		?? find((error) => reasonOf(error) === "action_proposal_mismatch")
		?? find((error) => reasonOf(error) === "admission_unavailable")
		?? find((error) => reasonOf(error) === REVIEW_TIMEOUT)
		?? find((error) => reasonOf(error) === REVIEW_PENDING)
		?? entries[0]!;
	const error = deciding.error;
	const pick = ["verdict", "missing", "grounds", "cause", "streak", "cap_ms", "wait_ms"];
	const outcomes = entries.map((entry) => ({ line: entry.line, reason: reasonOf(entry.error),
		...Object.fromEntries(pick.filter((key) => entry.error.details?.[key] !== undefined).map((key) => [key, entry.error.details![key]])) }));
	const pending = reasonOf(error) === REVIEW_PENDING ? entries.filter((entry) => reasonOf(entry.error) === REVIEW_PENDING) : [];
	const waits = pending.map((entry) => Number(entry.error.details?.wait_ms)).filter(Number.isFinite);
	return new KernelError({ code: error.code, message: error.message, ...(error.fix ? { fix: error.fix } : {}), retryable: error.retryable, next: error.next,
		details: { ...(error.details ?? {}), proposed, tool, line_outcomes: outcomes,
			...(pending.length ? { pending_lines: pending.map((entry) => entry.line), ...(waits.length ? { wait_ms: Math.max(...waits) } : {}) } : {}) } });
}

/**
 * §32.12.3.2 (SL-97 phase 2b): the typed designs behind §32.10's family interface -- the family id each sends under, its
 * bindings and its run. Which one reads a review is data (`admission.typed_design`).
 */
const TYPED_DESIGNS: Record<AdmissionTypedDesign, { family: string; bindings: typeof admissionJevBindings; run: typeof runAdmissionJev }> = {
	"roles-2a.3": { family: ADMISSION_ROLES_FAMILY, bindings: admissionRolesBindings, run: runAdmissionRoles },
	v1: { family: ADMISSION_JEV_FAMILY, bindings: admissionJevBindings, run: runAdmissionJev },
};

/**
 * One typed attempt (§32.10's family interface, §32.12.3.2's design) under the review's own signal, budget and deadline.
 * It reads every answer (minimum confidence 0); the review applies the settle rule itself. Never throws.
 */
async function typedAttempt(options: PrimaryAdmissionReviewOptions, env: NodeJS.ProcessEnv, began: number, design: AdmissionTypedDesign): Promise<TypedAttempt> {
	const context = options.context, proposal = options.proposal;
	const input: AdmissionJevInput = {
		campaign: options.campaign,
		turn: context.turn,
		tool: proposal.tool,
		proposal: [...proposal.lines],
		// The closed effect kind of each line, beside it in the role-first design's state (never read from the prose).
		...(proposal.tool === "apply" && proposal.kinds ? { kinds: [...proposal.kinds] } : {}),
		playerText: context.playerText,
		...(context.interruptedPlayerText ? { interruptedPlayerText: context.interruptedPlayerText } : {}),
		investigators: context.investigators.map((row) => ({ name: row.name, ...(row.occupation ? { occupation: row.occupation } : {}) })),
		...(context.scene ? { scene: context.scene } : {}),
		present: [...context.present],
		delivered: context.delivered.map((row) => ({ turn: row.turn, player: row.player ?? null, keeper: row.keeper })),
		landed: [...context.landed],
		refused: [...context.refused],
		...(context.corrections?.length ? {corrections: [...context.corrections]} : {}),
		...(context.bookText?.length ? { bookText: context.bookText.map((row) => ({ ...row })) } : {}),
	};
	const family = TYPED_DESIGNS[design];
	let typed: AdmissionJevResult | undefined;
	let lease: TaskLease | undefined, accounting: ReturnType<typeof preparationBudget> | undefined;
	try {
		const deadlineAt = Math.min(began + admissionJevTimeoutMs(env), options.providerBudget?.deadlineAt ?? Infinity);
		const clocked = options.clock ? { clock: options.clock } : {};
		const outer = options.signal ?? new AbortController().signal;
		const signal = options.providerBudget ? AbortSignal.any([outer, options.providerBudget.signal]) : outer;
		const bindings = family.bindings(input);
		accounting = preparationBudget({
			// SL-84 (contract §122 addendum): the adapter's own trace, otherwise unrecorded, writes the
			// `attempt_failed`/`batch_failed` rows through this call's own telemetry sink.
			decision: options.decision ?? createDecisionAdapter({ env, maxConcurrency: 4, retryPolicies: {
				[family.family]: { maxRetries: 0, backoffInitialMs: 100, backoffMaxMs: 1_000 } }, trace: jevFailureTelemetry((row) => { void options.record(row); }),
				// The adapter measures what is left of the lease's deadline, so it reads the clock the deadline is on.
				...(options.clock ? { now: () => options.clock!.now() } : {}) }),
			campaign: options.campaign, deadlineAt, signal, ...(options.providerBudget ? { parent: options.providerBudget } : {}),
			owner: family.family, goal: "Judge whether the player chose the proposed action", ...clocked,
		});
		lease = new TaskLease({ owner: family.family, goal: "Judge whether the player chose the proposed action",
			scope: bindings.scope, capabilities: ["decision"], readSet: bindings.readSet, signal, ...clocked,
			budget: { deadlineAt, remainingInputTokens: 200_000, remainingOutputTokens: 20_000, remainingCostUsd: 0.02, remainingActions: 4 } });
		typed = await family.run(input, accounting.decision, lease, { minConfidence: 0 });
	} catch {
		typed = undefined;
	} finally {
		lease?.close();
		accounting?.close();
	}
	const meta: Record<string, unknown> = typed ? {
		typed_design: design,
		jev_ms: typed.elapsedMs,
		jev_calls: typed.calls,
		jev_input_tokens: typed.usage.inputTokens,
		...(typed.confidence === undefined ? {} : { jev_confidence: typed.confidence }),
		...(typed.lines ? { line_verdicts: typed.lines.map((line) => line.verdict) } : {}),
		// §32.12.3: each line's own confidence, so a line-level decision (and one that did not happen) can be read back.
		...(typed.lines ? { line_confidences: typed.lines.map((line) => line.confidence) } : {}),
		// SL-84: the last attempt's HTTP status or network/timeout code, so a `service_error` fallback reason is legible.
		...(typed.status === "fallback" && typed.jevStatus !== undefined ? { jev_status: typed.jevStatus } : {}),
	} : { typed_design: design, jev_calls: 0, jev_ms: (options.clock ?? hostClock).now() - began };
	return { typed, meta };
}

function readingOf(typed: TypedAttempt["typed"]): TypedReading | undefined {
	if (!typed) return undefined;
	if (typed.status === "decided") return { status: "decided", verdict: typed.verdict, confidence: typed.confidence,
		lineVerdicts: typed.lines.map((line) => line.verdict), grounds: typed.grounds, ...(typed.missing ? { missing: typed.missing } : {}) };
	return { status: "fallback", reason: typed.reason, ...(typed.confidence === undefined ? {} : { confidence: typed.confidence }),
		...(typed.lines ? { lineVerdicts: typed.lines.map((line) => line.verdict) } : {}) };
}

const isLaneVerdict = (value?: AdmissionOutcome): boolean => value?.ok === true && value.verdict.verdict !== REVIEW_TIMEOUT;
const isNoGrounds = (value?: AdmissionOutcome): boolean => value?.ok === false && value.reason === NO_GROUNDS;

/**
 * The primary review (§32.10, §32.12.2, §32.12.3.1, §32.12.3.2). The lane (§32.2) -- one call per line for an `apply` batch
 * of more than one reviewed line -- and one typed attempt over the whole proposal start at the same moment.
 *
 * - A line's lane verdict is sufficient when it carries grounds; it stands whatever the typed reading says. A lane answer
 *   without grounds is no answer.
 * - The typed reading settles a line alone only under §32.12.3.2's rule (`typedSettles`): the line's class on the data's
 *   list and its admitting confidence at the settle confidence or above, while that line's lane has given no verdict. Its
 *   lane call is then cancelled, and only its own: the other lines' calls run on. A typed refusal never stands: the lane
 *   decides refusals. A batch partly typed-settled and partly lane-reviewed lands whole or not at all (§32.10's mapping,
 *   applied by the caller).
 * - A line's lane failure is §32.2's outage unless the typed reading settles that line. The review waits for the typed
 *   answer (bounded by its own cap) only where it can still matter: a line it could settle, or one whose lane answered
 *   without grounds (its late admission and pending details read the typed reading). Nowhere else does a line wait for it,
 *   so a line the typed reading does not settle costs no wall time over the lane alone.
 * - At the cap (`timeoutMs`) a line with nothing sufficient, or a line whose lane answered without grounds, is `late`, with
 *   the typed reading and its lane still running (until the hard cap): the caller admits it late or returns it pending.
 *   This function never admits on a failure.
 *
 * Never throws; every outcome names its `path` (whose verdict stood), and every line's row its reviewer, its class, its
 * typed confidence and whether its lane call was cancelled.
 */
export async function reviewAdmissionPrimary(options: PrimaryAdmissionReviewOptions): Promise<AdmissionOutcome> {
	const env = options.env ?? process.env;
	// §32.12.3.2: the design and the settle rule are data (`admission` in host-budgets.json), read once per process.
	const policy = typedSettlePolicy(await admissionTypedBudget(), env);
	const proposal = options.proposal;
	const capMs = options.timeoutMs ?? admissionTimeoutMs(env), hardCapMs = options.hardCapMs ?? admissionHardCapMs(capMs);
	const clock = options.clock ?? hostClock;
	const began = options.startedAt ?? clock.now();
	const settles = (attempt: TypedAttempt | undefined, index: number) => typedSettles(proposal, attempt?.typed, index, policy);
	const settleable = (index: number) => policy.minConfidence !== undefined && settleableLine(proposal, index, policy);
	const stop = new AbortController();
	// A review that began here waits its whole cap; a remainder resumed from a split waits only what is left of the batch's
	// (§32.12.3).
	const left = (ms: number) => options.startedAt === undefined ? ms : Math.max(1, ms - (clock.now() - began));
	// §32.12.3.1 (SL-101): a batch of more than one reviewed line goes to the lane one line per call, all at once, on the
	// same model, each with the same §32.3 context and exactly one proposed line. Every round has its own hard cap, measured
	// from this review's start like the batch's single round was; a one-line batch and a `resolve` keep the one round.
	const perLine = reviewedPerLine(proposal);
	// §32.12.3.2: every round has its own stop beside the review's, so the line the typed reading settles cancels its own
	// lane call and no other.
	const lineStops = proposal.lines.map(() => new AbortController());
	const roundSignal = (index: number) => AbortSignal.any([...(options.signal ? [options.signal] : []), stop.signal, lineStops[index]!.signal]);
	const rounds = perLine
		? proposal.lines.map((_, index) => reviewAdmission({ ...options, proposal: lineProposal(proposal, index), signal: roundSignal(index), timeoutMs: left(hardCapMs) }))
		: [reviewAdmission({ ...options, signal: roundSignal(0), timeoutMs: left(hardCapMs) })];
	const lane = rounds[0]!;
	const typed = options.typedAttempt ? Promise.resolve(options.typedAttempt) : typedAttempt(options, env, began, policy.design);
	/**
	 * What one line's row says of the typed reading (§32.12.3.2): the design, the line's class, its typed confidence and
	 * whether its lane call was cancelled; for a class the reading may settle, the settle confidence and -- when it did not
	 * settle -- why (`jev_fallback`: `lane_first`, `typed_refusal`, `low_confidence`, or the typed non-verdict's reason).
	 */
	const lineMeta = (index: number, attempt: TypedAttempt | undefined, how: { settled?: boolean; cancelled?: boolean; laneFirst?: boolean } = {}): Record<string, unknown> => {
		const answer = attempt?.typed;
		const line = answer?.status === "decided" ? answer.lines[index] : undefined;
		const base = { ...(attempt?.meta ?? {}), typed_design: policy.design, line_class: lineClass(proposal, index),
			typed_confidence: line?.confidence ?? null, lane_cancelled: how.cancelled === true };
		if (!settleable(index)) return base;
		const fallback = how.settled ? undefined : how.laneFirst || !attempt ? "lane_first" : !answer ? "admission_owner_error"
			: answer.status !== "decided" ? answer.reason : !line ? "invalid_typed_answer"
			: !ADMITTING_VERDICTS.has(line.verdict) ? "typed_refusal" : "low_confidence";
		return { ...base, settle_min_confidence: policy.minConfidence, ...(fallback ? { jev_fallback: fallback } : {}) };
	};
	/** Line `index` settled by the typed reading (§32.12.3.2): an admitting verdict, `path: "typed"`, reviewer `jev`. */
	const typedLine = (attempt: TypedAttempt, index: number, cancelled: boolean): AdmissionOutcome => {
		const answer = attempt.typed as Extract<AdmissionJevResult, { status: "decided" }>;
		const line = answer.lines[index]!;
		// A one-line reading's grounds are about this line; a batch's name the line the host settled on its own reading.
		const grounds = answer.lines.length === 1 ? answer.grounds
			: `typed review admitted line ${index + 1} of ${answer.lines.length} (${lineClass(proposal, index)}): ${line.verdict} at ${line.confidence}`;
		return { ok: true, verdict: { verdict: line.verdict, grounds, reviewer: "jev", path: "typed" }, ms: clock.now() - began, model: ADMISSION_JEV_MODEL,
			reviewer: "jev", meta: { ...lineMeta(index, attempt, { settled: true, cancelled }), path: "typed", confidence: line.confidence } };
	};
	const late = (cause: "cap" | "no_grounds", attempt: TypedAttempt | undefined, laneDone?: AdmissionOutcome): AdmissionOutcome => {
		const reading = readingOf(attempt?.typed);
		return { ok: "late", cause, ms: clock.now() - began, capMs, hardCapMs, ...(reading ? { typed: reading } : {}), ...(cause === "cap" ? { lane } : {}),
			settleClasses: policy.classes,
			meta: { ...lineMeta(0, attempt), cap_ms: capMs, hard_cap_ms: hardCapMs,
				...(laneDone ? { lane_ms: laneDone.ms, ...(laneDone.meta ?? {}), path: "lane" } : { path: "lane" }),
				...(cause === "no_grounds" ? { lane_no_grounds: true } : {}) } };
	};
	// The lane finished with no verdict and the typed answer is in (or cannot matter) and did not settle the line.
	const afterLane = (laneDone: AdmissionOutcome, attempt: TypedAttempt | undefined): AdmissionOutcome => {
		if (isNoGrounds(laneDone)) return late("no_grounds", attempt, laneDone);
		if (laneDone.ok === false) {
			// §143.15: the typed reading travels with the failure; a declared action's late admission reads it (never a verdict here).
			const reading = attempt ? readingOf(attempt.typed) : undefined;
			return { ...laneDone, ms: clock.now() - began, ...(reading ? { typed: reading } : {}), meta: { ...laneDone.meta, ...lineMeta(0, attempt), lane_ms: laneDone.ms } };
		}
		return late("cap", attempt, laneDone);
	};
	/**
	 * §32.12.3.1 with §32.12.3.2: the per-line review. Each line's outcome is its own lane verdict with grounds, or the typed
	 * reading's admission of that line under the settle rule (its lane call then cancelled), or its lane failure, or late.
	 * The review returns when every line has its outcome, when a line is refused `not_authorized` on grounds (the batch's
	 * verdict is then decided), or at the cap with the lines still running left `late` (their rounds kept running to the
	 * hard cap, one per line). It never waits for the slowest line longer than the cap: its wall time is the slowest line's,
	 * not the sum.
	 */
	async function perLineReview(): Promise<AdmissionOutcome> {
		type LineEvent = { kind: "line"; index: number; value: AdmissionOutcome } | { kind: "typed"; value: TypedAttempt } | { kind: "cap" };
		const waiting = new Map<string, Promise<LineEvent>>([
			...rounds.map((round, index): [string, Promise<LineEvent>] => [`line:${index}`, round.then((value): LineEvent => ({ kind: "line", index, value }))]),
			["typed", typed.then((value): LineEvent => ({ kind: "typed", value }))],
			["cap", capReached.then((): LineEvent => ({ kind: "cap" }))],
		]);
		const laneOut: Array<AdmissionOutcome | undefined> = rounds.map(() => undefined);
		const typedOut: Array<AdmissionOutcome | undefined> = rounds.map(() => undefined);
		const laneFirst: boolean[] = rounds.map(() => false);
		const allIn = () => rounds.every((_, index) => typedOut[index] !== undefined || laneOut[index] !== undefined);
		// Still worth waiting for the typed answer once every line is in: a line with no lane verdict that it could settle,
		// or one whose lane answered without grounds (that line's late admission reads its typed reading, §32.12.2).
		const wantsTyped = () => rounds.some((_, index) => !typedOut[index] && !isLaneVerdict(laneOut[index])
			&& (settleable(index) || isNoGrounds(laneOut[index])));
		// The typed reading settles every line it may and whose lane has given no verdict; a line whose lane is still running
		// has that call cancelled (and only that call).
		const settleOpen = (attempt: TypedAttempt) => {
			rounds.forEach((_, index) => {
				if (typedOut[index] || isLaneVerdict(laneOut[index]) || !settles(attempt, index)) return;
				const cancelled = laneOut[index] === undefined;
				if (cancelled) {
					lineStops[index]!.abort();
					waiting.delete(`line:${index}`);
				}
				typedOut[index] = typedLine(attempt, index, cancelled);
			});
		};
		const lines = (attempt: TypedAttempt | undefined): AdmissionOutcome => {
			const now = clock.now() - began;
			const outcomes = rounds.map((round, index): AdmissionOutcome => {
				const settled = typedOut[index];
				if (settled) return settled;
				const value = laneOut[index];
				const reading = lineReading(attempt, index);
				const typedPart = reading ? { typed: reading } : {};
				const meta = lineMeta(index, attempt, { laneFirst: laneFirst[index] });
				const lateMeta = { ...meta, cap_ms: capMs, hard_cap_ms: hardCapMs };
				// Not answered by the cap: this line alone is late, its round still running to the hard cap.
				if (value === undefined || !isLaneVerdict(value) && value.ok === true)
					return { ok: "late", cause: "cap", ms: now, capMs, hardCapMs, ...typedPart, lane: round, settleClasses: policy.classes,
						meta: { ...lateMeta, ...(value ? { lane_ms: value.ms, ...(value.meta ?? {}) } : {}), path: "lane" } };
				if (isNoGrounds(value))
					return { ok: "late", cause: "no_grounds", ms: value.ms, capMs, hardCapMs, ...typedPart, settleClasses: policy.classes,
						meta: { ...lateMeta, lane_ms: value.ms, ...(value.meta ?? {}), path: "lane", lane_no_grounds: true } };
				// A verdict with grounds or a failure: the line's own, timed from the review's start.
				return { ...value, meta: { ...(value.meta ?? {}), ...meta, lane_ms: value.ms } } as AdmissionOutcome;
			});
			return { ok: "lines", lines: outcomes, ms: now, capMs, hardCapMs, startedAt: began, ...(attempt ? { attempt } : {}), abort: () => stop.abort(),
				meta: { ...(attempt?.meta ?? {}), typed_design: policy.design, line_calls: rounds.length,
					// Each lane call's own time; `null` for one still running at the cap, cancelled, or stopped by a batch-mate's refusal.
					line_ms: laneOut.map((value) => isLaneVerdict(value) || value?.ok === false ? value!.ms : null) } };
		};
		let typedDone: TypedAttempt | undefined;
		for (;;) {
			const event = await Promise.race(waiting.values());
			waiting.delete(event.kind === "line" ? `line:${event.index}` : event.kind);
			if (event.kind === "typed") {
				typedDone = event.value;
				settleOpen(typedDone);
				if (allIn()) return lines(typedDone);
				continue;
			}
			if (event.kind === "line") {
				laneOut[event.index] = event.value;
				if (!typedDone && isLaneVerdict(event.value)) laneFirst[event.index] = true;
				// A line refused `not_authorized` on grounds decides the batch whatever the others say (§32.10's mapping puts it
				// first): the review returns at once, and the caller stops the rounds still running.
				const refused = event.value.ok === true && event.value.verdict.verdict === "not_authorized";
				if (refused || allIn() && (typedDone || !wantsTyped())) return lines(typedDone);
				continue;
			}
			// The cap. The typed attempt has its own, shorter cap: its answer is awaited, never raced away.
			typedDone ??= await typed;
			settleOpen(typedDone);
			return lines(typedDone);
		}
	}
	type Event = { kind: "lane"; value: AdmissionOutcome } | { kind: "typed"; value: TypedAttempt } | { kind: "cap" };
	let cancelCap: (() => void) | undefined;
	const capReached = new Promise<void>((settle) => {
		// SL-87: a timer can fire early against the clock that measures the review (Node's run on the event loop's cached
		// time, which lags `Date.now()` on a loaded machine): the cap stands only once the review's clock says it has
		// passed, and is re-armed for what is left otherwise, so no call is returned at the cap before its cap.
		const arm = (ms: number) => { cancelCap = clock.schedule(() => {
			const rest = capMs - (clock.now() - began);
			if (rest > 0) arm(rest); else settle();
		}, ms); };
		arm(left(capMs));
	});
	if (perLine) {
		try {
			return await perLineReview();
		} finally {
			cancelCap?.();
		}
	}
	const waiting = new Map<string, Promise<Event>>([
		["lane", lane.then((value): Event => ({ kind: "lane", value }))],
		["typed", typed.then((value): Event => ({ kind: "typed", value }))],
		["cap", capReached.then((): Event => ({ kind: "cap" }))],
	]);
	let laneDone: AdmissionOutcome | undefined, typedDone: TypedAttempt | undefined;
	// §32.12.3.2: the one line settled by the typed reading; its lane call is cancelled if it is still running.
	const settleOne = (attempt: TypedAttempt): AdmissionOutcome => {
		const cancelled = laneDone === undefined;
		if (cancelled) stop.abort();
		return typedLine(attempt, 0, cancelled);
	};
	try {
		for (;;) {
			const event = await Promise.race(waiting.values());
			waiting.delete(event.kind);
			if (event.kind === "typed") {
				typedDone = event.value;
				if (!isLaneVerdict(laneDone) && settles(typedDone, 0)) return settleOne(typedDone);
				if (laneDone) return afterLane(laneDone, typedDone);
				continue;
			}
			if (event.kind === "lane") {
				laneDone = event.value;
				if (isLaneVerdict(laneDone))
					return { ...laneDone, ms: clock.now() - began, meta: { ...laneDone.meta, ...lineMeta(0, typedDone, { laneFirst: !typedDone }), lane_ms: laneDone.ms } };
				// No verdict from the lane: wait for the typed answer only where it can still matter (a line it could settle, or
				// a lane answer without grounds, whose late admission and pending details read it).
				if (typedDone || !(settleable(0) || isNoGrounds(laneDone))) return afterLane(laneDone, typedDone);
				continue;
			}
			// The cap. The typed attempt has its own, shorter cap: its answer is awaited, never raced away.
			typedDone ??= await typed;
			if (!isLaneVerdict(laneDone) && settles(typedDone, 0)) return settleOne(typedDone);
			if (laneDone) return afterLane(laneDone, typedDone);
			return late("cap", typedDone);
		}
	} finally {
		cancelCap?.();
	}
}

/**
 * §32.12.2's late admission: the kinds a bookkeeping-only batch may carry among §32.1's triggering kinds (the owner's
 * list; `threat`, `define`, `person` and the other non-triggering kinds ride along, as in §32.11). A closed contract
 * enum, never a reading of the prose.
 */
export const LATE_KINDS: ReadonlySet<string> = new Set(["move", "clue", "handout", "time", "cash"]);
export function lateEligibleBatch(proposal: AdmissionProposal): boolean {
	if (proposal.tool !== "apply" || !proposal.kinds?.length) return false;
	const triggering = proposal.kinds.filter((kind) => TRIGGER_KINDS.has(kind));
	return triggering.length > 0 && triggering.every((kind) => LATE_KINDS.has(kind));
}
/**
 * `PI_COC_ADMISSION_LATE_MIN_CONFIDENCE`: the typed review confidence at which a late admission stands. Default 0.70,
 * measured (§32.12.2): the lowest threshold at which lane refusals are at most 2% of the typed admissions over the
 * retained bank's late-eligible batches. `off` turns the late admission off (every cap expiry is then pending).
 */
export const ADMISSION_LATE_DEFAULT_MIN_CONFIDENCE = 0.7;
export function admissionLateMinConfidence(env: NodeJS.ProcessEnv = process.env): number | undefined {
	const raw = env.PI_COC_ADMISSION_LATE_MIN_CONFIDENCE?.trim();
	if (raw === "off") return undefined;
	const value = Number(raw || NaN);
	return Number.isFinite(value) && value > 0 && value <= 1 ? value : ADMISSION_LATE_DEFAULT_MIN_CONFIDENCE;
}
export type LateAdmission = { ok: true; verdict: AdmissionVerdict; minConfidence: number } | { ok: false; reason: string };
/**
 * Pure (§32.12.2, §32.12.3.2). At the cap, a bookkeeping-only batch whose typed verdict admits every line at the late
 * threshold is admitted on it (`path: "typed_late"`); anything else is not, and goes back to the Keeper pending. Since
 * §32.12.3.2 the typed reading admits late only the line classes it may settle (`settleClasses`, the review's
 * `TypedSettlePolicy.classes`: the data's list, none under design `v1`); a caller that names none admits nothing late.
 */
export function lateAdmission(proposal: AdmissionProposal, typed: TypedReading | undefined, env: NodeJS.ProcessEnv = process.env,
	settleClasses: readonly string[] = []): LateAdmission {
	const minConfidence = admissionLateMinConfidence(env);
	if (minConfidence === undefined) return { ok: false, reason: "late_off" };
	if (!lateEligibleBatch(proposal)) return { ok: false, reason: "not_bookkeeping" };
	if (!proposal.kinds!.filter((kind) => TRIGGER_KINDS.has(kind)).every((kind) => settleClasses.includes(kind))) return { ok: false, reason: "class_not_listed" };
	if (typed?.status !== "decided" || !typed.verdict) return { ok: false, reason: "no_typed_verdict" };
	if (!ADMITTING_VERDICTS.has(typed.verdict)) return { ok: false, reason: "typed_refusal" };
	if (!(typeof typed.confidence === "number" && typed.confidence >= minConfidence)) return { ok: false, reason: "low_confidence" };
	return { ok: true, minConfidence, verdict: { verdict: typed.verdict, grounds: typed.grounds ?? "", reviewer: "jev", path: "typed_late" } };
}

/** The four ways a clerk parameter gets its value (§135.28); the compile's evidence admits only a write bound these ways. */
export const EXEMPT_BINDING_PATHS: ReadonlySet<string> = new Set(["stated", "composed", "rule-default", "jev"]);

/** What the dispatcher's host origin carries for a clerk write (§135.4, §32.12); never read from tool arguments. */
export interface ClerkEvidence {
	origin?: string;
	basis?: unknown;
	/** The engine's bind records for this call, computed before the dispatch: `path: null` for a parameter with no record. */
	bindings?: unknown;
	/** The clerk authority the candidate ran under (§135.3), from the same host origin. */
	clerk?: string;
}

/** Read only the dispatcher-owned kernel contact row; neither intent nor model prose defines this rule. */
export function registeredContactProposal(proposal: AdmissionProposal, payload: Record<string, unknown>, evidence: ClerkEvidence): AdmissionProposal {
	if (proposal.tool !== "resolve" || evidence.origin !== "policy" || evidence.clerk !== "mod_contact") return proposal;
	const basis = record(evidence.basis), contact = record(basis?.row), rule = record(contact?.rule), action = record(payload.action);
	if (basis?.read !== "table.capsule" || rule?.trigger !== "contact" || rule.scope !== "actor-target" || rule.reusable !== true
		|| !action || !contact || !["decision", "actor", "target"].every(key => typeof contact[key] === "string" && contact[key] === action[key])) return proposal;
	const registered = { decision: contact.decision, actor: contact.actor, target: contact.target, rule,
		settles: "The NPC's initial reaction to meaningful contact. This is a reusable contact rule, not the investigator persuading, deceiving or bargaining. Invocation intent does not prescribe an influence method. Meaningful contact must follow from the current declaration or an earlier chosen contact with this NPC; mere presence does not establish it." };
	return { ...proposal, key: canonical({ proposal: proposal.key, registered_contact_check: registered }),
		lines: proposal.lines.map(line => `${line}; registered_contact_check=${JSON.stringify(registered)}`) };
}

/**
 * §143.15 (ticket 16): the clerk authorities (§135.3) whose writes carry out the investigator's own declaration -- the step
 * the compile or the route selected from the player's words: a declared move, clue or handout, the ordinary check, a stated
 * obligation's check, the first blow, a fight's or chase's step, a Mod's contact check. Not a consequence the host routed
 * (`consequence_bookkeeping`), a person's own act (`npc_act`) or an NPC's standing (`disposition_inference`). A closed
 * contract enum over where the call came from, never a reading of its words.
 */
export const DECLARED_CLERKS: ReadonlySet<string> = new Set(["declared_bookkeeping", "declared_check", "stated_obligation", "first_blow", "session_step", "mod_contact"]);
/**
 * Pure (§143.15). Whether a call is the investigator's own declared action as the clerk carries it out: policy origin and a
 * declared clerk authority, both read off the dispatcher's host origin. A Keeper-origin call, a host-dispatched call with
 * no origin and every other clerk write answer false, and keep §32.2's refusal on an unavailable review.
 */
export function declaredAction(evidence: ClerkEvidence | undefined): boolean {
	return evidence?.origin === "policy" && typeof evidence.clerk === "string" && DECLARED_CLERKS.has(evidence.clerk);
}

export type CompileAdmission =
	| { ok: true; predicate: string; features: Record<string, { row: unknown; confidence: unknown }>; bindingPaths: Record<string, string> }
	| { ok: false; reason: string };

const record = (value: unknown): Record<string, unknown> | undefined =>
	value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/**
 * Contract §32.12: a clerk write the compile selected is admitted on the compile's evidence. `undefined` when the call is
 * not a compile selection at all (the review runs, nothing to say); otherwise the exemption or the reason it is refused.
 * Pure, and it fails closed: every missing record is a refusal of the exemption, which means an ordinary review.
 */
export function compileAdmission(evidence: ClerkEvidence | undefined): CompileAdmission | undefined {
	if (evidence?.origin !== "policy") return undefined;
	const compile = record(record(evidence.basis)?.compile);
	if (!compile) return undefined;
	const predicate = COMPILE_PREDICATES.find((value) => value.name === compile.predicate);
	if (!predicate) return { ok: false, reason: "unknown_predicate" };
	const read = record(compile.read_features), fired = record(compile.features);
	if (!read || !fired) return { ok: false, reason: "features_unrecorded" };
	// Owner ruling (2026-09-24): the evidence is the features the predicate fired on -- those of its families among the
	// cleared rows `basis.compile.features` names -- and each must have cleared the gate. A guard that did not clear (an
	// `unclear` addressee) is not evidence against: the predicate already refuses to fire when it clears on someone else.
	const features: Record<string, { row: unknown; confidence: unknown }> = {};
	for (const family of predicate.features) {
		if (!Object.hasOwn(fired, family)) continue;
		const entry = record(read[family]);
		if (!entry) return { ok: false, reason: `feature_unrecorded:${family}` };
		if (entry.cleared !== true) return { ok: false, reason: `feature_not_cleared:${family}` };
		features[family] = { row: entry.row ?? null, confidence: entry.confidence ?? null };
	}
	if (!Object.keys(features).length) return { ok: false, reason: "features_unrecorded" };
	const bindings = Array.isArray(evidence.bindings) ? evidence.bindings : undefined;
	if (!bindings?.length) return { ok: false, reason: "bindings_unrecorded" };
	const bindingPaths: Record<string, string> = {};
	for (const raw of bindings) {
		const entry = record(raw), name = typeof entry?.name === "string" ? entry.name : "?";
		if (typeof entry?.path !== "string") return { ok: false, reason: `parameter_path_unrecorded:${name}` };
		if (!EXEMPT_BINDING_PATHS.has(entry.path)) return { ok: false, reason: `parameter_path_not_exempt:${name}` };
		// §135.30.3 (SL-26): a Jev answer executed under the gates (the ordinary binder's skill) is not the compile's evidence.
		if (entry.cleared === false) return { ok: false, reason: `parameter_not_cleared:${name}` };
		bindingPaths[name] = entry.path;
	}
	return { ok: true, predicate: predicate.name, features, bindingPaths };
}

// ---- §143.18: the Keeper's fight action for the investigator, against what the run's compile read ----------------------

/**
 * §143.18 (ticket 19 of docs/specs/npc-acts-first-tickets/, live table C4 turn 8): the investigator's fight actions a Keeper
 * proposes that the run's compile may already have read the player's words against -- its `act` rows (§135.30). A closed
 * set of the kernel's own decision names.
 */
export const KEEPER_FIGHT_ACTS: ReadonlySet<string> = new Set(["combat:attack", "combat:maneuver"]);

/**
 * Pure (§143.18). The fight action a `resolve` proposes, read off its closed fields the way the kernel reads them:
 * `action.decision`, with or without the `decision:<ruleset>:` prefix; with no decision, `intent: "combat"` is the kernel's
 * attack unless the call gives a defence or one is owed (then it is the defence). `undefined` for anything else. It reads
 * no goal, method or stakes: those are the Keeper's words, not the call's shape.
 */
export function proposedFightAct(tool: string, payload: Record<string, unknown>, defenceOwed: boolean): string | undefined {
	if (tool !== "resolve") return undefined;
	const action = (payload.action ?? {}) as Record<string, unknown>;
	const raw = norm(action.decision), parts = raw.split(":");
	const decision = parts.length >= 4 && parts[0] === "decision" ? parts.slice(2).join(":") : raw;
	if (decision) return KEEPER_FIGHT_ACTS.has(decision) ? decision : undefined;
	return norm(action.intent) === "combat" && action.defense == null && !defenceOwed ? "combat:attack" : undefined;
}

/** What one compile of a run read the player's declaration as, over the fight acts its `act` question offered (§135.30). */
export interface CompileActRead {
	run: string;
	step?: string;
	/** The act rows the question offered: the fight steps the session issued (`combat:attack`, ...). */
	rows: string[];
	/** The row it read, `null` when it read `none` or `unclear`. */
	row: string | null;
	choice: string;
	confidence: number | null;
	cleared: boolean;
}

/**
 * Pure (§143.18). The `act` record of a compile, as the engine writes it on its `lane: "route"`, `purpose: "compile"` row
 * (`features.act`: `rows`, `choice`, `row`, `confidence`, `cleared`). `undefined` for any other row or a compile that asked
 * no `act` question.
 */
export function compileActRead(entry: Record<string, unknown>): CompileActRead | undefined {
	if (entry.lane !== "route" || entry.purpose !== "compile" || typeof entry.run !== "string") return undefined;
	const act = record(record(entry.features)?.act);
	if (!act || typeof act.choice !== "string") return undefined;
	const rows = Object.values(record(act.rows) ?? {}).filter((value): value is string => typeof value === "string");
	return { run: entry.run, ...(typeof entry.step === "string" ? { step: entry.step } : {}), rows, choice: act.choice,
		row: typeof act.row === "string" && act.row ? act.row : null, confidence: typeof act.confidence === "number" ? act.confidence : null,
		cleared: act.cleared === true };
}

/**
 * Pure (§143.18). A Keeper's fight action for the investigator refused on the run's own typed evidence: a compile of this
 * run asked whether the player's words declare this very act (its `act` rows include it) and cleared on `none`, and no
 * compile of the run cleared `act` on any row. Then the words were already put to the question the review would ask, and
 * answered: nothing to send to the lane. `undefined` otherwise -- no compile, an `act` that did not clear, `unclear`,
 * another act, a question that did not offer this act -- and the lane reviews the call as any Keeper proposal.
 */
export function compileActRefusal(act: string | undefined, reads: readonly CompileActRead[]): (AdmissionVerdict & { read: CompileActRead }) | undefined {
	if (!act || !reads.length || reads.some((read) => read.cleared && read.row)) return undefined;
	const read = reads.find((value) => value.cleared && value.choice === "none" && value.rows.includes(act));
	if (!read) return undefined;
	const confidence = read.confidence === null ? "" : ` ${read.confidence}`;
	return {
		verdict: "not_authorized",
		grounds: `compile: the player's words this turn were read as none of the fight actions (act none${confidence}, cleared), ${act} among them`,
		missing: `a fight action the player declares; this turn's words declared none, so ${act} is the Keeper's choice, not the player's`,
		reviewer: "compile",
		path: "compile",
		read,
	};
}

export type ConsequenceAdmission =
	| { ok: true; class: string; key: string; confidence: number; distribution: { true: number; false: number }; gate: { rowMin: number; rowRatio: number } }
	| { ok: false; reason: string };

/** A finite probability in `[0, 1]`. */
const isProbability = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * Contract §32.12 addendum (SL-90): an executed consequence step is admitted on the consequence route's own
 * evidence -- its class, its Noul's confidence and distribution, and the class's own gate -- exactly as a
 * compile selection is admitted on `basis.compile` (`compileAdmission`, above). `undefined` when the call carries
 * no consequence evidence at all (not this call's business: the review runs, nothing to say); otherwise the
 * exemption or the reason it is refused. `executeClasses` is `jevStepsBudget().execute` (data, read by the
 * caller, never a literal here): a class the table does not currently list as executed is refused even when its
 * evidence is otherwise well-formed, because a shadow-only row was never meant to write at all (§135.32 addendum
 * 2's "only the listed classes execute"). Pure, and it fails closed: every missing or malformed field is a
 * refusal of the exemption, which means an ordinary lane review.
 */
/** §158.5: an owed write admitted on what was told; each row as the admission row names it. */
export type ToldAdmission = { ok: true; rows: Array<{ owed: string; turn: number | null; quote: string | null }> } | { ok: false; reason: string };
/**
 * Contract §158.5: a write whose every effect lands an owed row is admitted on basis `told` -- the question is whether
 * the delivered text established it, not whether the player chose it this turn. The final answer is the kernel's: it
 * lands a row only when it is open, the effect lands it, and its quote is still in the turn it came from, and it refuses
 * the whole batch otherwise; so a name the Keeper writes cannot carry anything the review did not find told. A policy
 * write must name the row its candidate carried (`basis.told`). `open` is the owed section of the last capsule the host
 * saw, for the row's turn and quote on the admission row. `undefined` when the call lands no owed row at all; a batch
 * that mixes owed and other effects is reviewed as any other.
 */
export function toldAdmission(tool: string, payload: Record<string, unknown>, evidence: ClerkEvidence | undefined, open: readonly Record<string, unknown>[]): ToldAdmission | undefined {
	if (tool !== "apply" || !Array.isArray(payload.effects) || !payload.effects.length) return undefined;
	const effects = payload.effects as unknown[];
	const named = effects.map((effect) => record(effect)?.owed);
	if (!named.every((name) => typeof name === "string" && name.trim())) return undefined;
	const told = record(record(evidence?.basis)?.told);
	if (evidence?.origin === "policy" && (!told || named.length !== 1 || told.owed !== named[0])) return { ok: false, reason: "told_basis_mismatch" };
	return { ok: true, rows: (named as string[]).map((name) => {
		const row = (told && told.owed === name ? told : undefined) ?? open.find((entry) => entry.name === name);
		const turn = row ? (row as Record<string, unknown>).turn : undefined, quote = row ? (row as Record<string, unknown>).quote : undefined;
		return { owed: name, turn: typeof turn === "number" ? turn : null, quote: typeof quote === "string" ? quote : null };
	}) };
}
export function consequenceAdmission(evidence: ClerkEvidence | undefined, executeClasses: readonly string[]): ConsequenceAdmission | undefined {
	if (evidence?.origin !== "policy") return undefined;
	const consequence = record(record(evidence.basis)?.consequence);
	if (!consequence) return undefined;
	const cls = consequence.class;
	if (typeof cls !== "string" || !cls) return { ok: false, reason: "class_unrecorded" };
	const key = consequence.key;
	if (typeof key !== "string" || !key) return { ok: false, reason: "key_unrecorded" };
	if (!executeClasses.includes(cls)) return { ok: false, reason: "class_not_executed" };
	const confidence = consequence.confidence;
	if (!isProbability(confidence)) return { ok: false, reason: "confidence_unrecorded" };
	const distribution = record(consequence.distribution);
	if (!distribution || !isProbability(distribution.true) || !isProbability(distribution.false)) return { ok: false, reason: "distribution_unrecorded" };
	const gate = record(consequence.gate), rowMin = gate?.row_min, rowRatio = gate?.row_ratio;
	if (typeof rowMin !== "number" || !Number.isFinite(rowMin) || rowMin <= 0 || rowMin >= 1) return { ok: false, reason: "gate_unrecorded" };
	if (typeof rowRatio !== "number" || !Number.isFinite(rowRatio) || rowRatio <= 0) return { ok: false, reason: "gate_unrecorded" };
	return { ok: true, class: cls, key, confidence, distribution: { true: distribution.true, false: distribution.false }, gate: { rowMin, rowRatio } };
}
