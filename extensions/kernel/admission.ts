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
 * service status, not fail-open fiction (§32.2); nothing here reaches the next capsule — a
 * refusal is a tool result on this turn and a telemetry row, not a debt.
 */

import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runLane } from "../lanes/subsession.ts";
import { KernelError } from "./client.ts";
import { createDecisionAdapter } from "../../runtime/jev/decision-adapter.ts";
import type { DecisionPort } from "../../runtime/jev/decision-port.ts";
import { preparationBudget } from "../../runtime/jev/preparation-budget.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import {
	ADMISSION_JEV_DEFAULT_MIN_CONFIDENCE,
	ADMISSION_JEV_FAMILY,
	ADMISSION_JEV_MODEL,
	admissionJevBindings,
	runAdmissionJev,
	batchVerdict,
	type AdmissionJevInput,
} from "../../runtime/jev/admission-domain.ts";
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

export interface AdmissionVerdict {
	verdict: string;
	grounds: string;
	missing?: string;
	/** Which reviewer gave this verdict (§32.10); absent on verdicts from before the typed route. */
	reviewer?: AdmissionReviewer;
	/** Whose verdict stood (§32.11, §32.12), kept so a reused row names it too. */
	path?: AdmissionPath;
	/** `review_timeout` only: the cap the review ran into (§32.12). */
	capMs?: number;
}
/** Which path decided an admission row (§32.12, §32.12.2): the compile's evidence, the typed reviewer (at once, or late at the cap), the lane, or no review at all. */
export type AdmissionPath = "compile" | "typed" | "typed_late" | "lane" | "none";

/**
 * The primary reviewer (§32.10), `PI_COC_ADMISSION_REVIEWER`. `lane` is the §32.2 completion and
 * stays the default until live agreement evidence exists; `jev` puts the typed family first and
 * falls back to the lane for every non-verdict. Read per call: a process loads this once per table.
 */
export type AdmissionReviewer = "jev" | "lane" | "compile";
export function admissionReviewer(env: NodeJS.ProcessEnv = process.env): AdmissionReviewer {
	return env.PI_COC_ADMISSION_REVIEWER?.trim() === "jev" ? "jev" : "lane";
}

/** Cap on the typed attempt, `PI_COC_ADMISSION_JEV_TIMEOUT_MS`; its expiry falls back to the lane, never admits. */
const DEFAULT_ADMISSION_JEV_TIMEOUT_MS = 4_000;
export function admissionJevTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
	const value = Number(env.PI_COC_ADMISSION_JEV_TIMEOUT_MS?.trim() || NaN);
	return Number.isFinite(value) && value > 0 ? value : DEFAULT_ADMISSION_JEV_TIMEOUT_MS;
}

/** Family minimum verdict confidence, `PI_COC_ADMISSION_JEV_MIN_CONFIDENCE`, in (0, 1]. Uncalibrated policy. */
export function admissionJevMinConfidence(env: NodeJS.ProcessEnv = process.env): number {
	const value = Number(env.PI_COC_ADMISSION_JEV_MIN_CONFIDENCE?.trim() || NaN);
	return Number.isFinite(value) && value > 0 && value <= 1 ? value : ADMISSION_JEV_DEFAULT_MIN_CONFIDENCE;
}

/**
 * The bookkeeping fast path (§32.11): the `apply` kinds a typed admission may settle on its own, a closed contract
 * enum. A batch whose every triggering kind is one of these is a bookkeeping batch; any other triggering kind (cash,
 * item, object, usage, map) keeps the batch with the configured reviewer. Never a reading of the prose.
 */
export const FAST_PATH_KINDS: ReadonlySet<string> = new Set(["move", "clue", "handout", "time"]);
/**
 * `PI_COC_ADMISSION_FAST_MIN_CONFIDENCE`: the review confidence at which a typed admission of a bookkeeping batch
 * stands alone. Default 0.87, measured (§32.11): the lowest threshold at which no lane refusal of the retained bank
 * was typed-admitted. `off` turns the fast path off. Read per review.
 */
export const ADMISSION_FAST_DEFAULT_MIN_CONFIDENCE = 0.87;
export function admissionFastMinConfidence(env: NodeJS.ProcessEnv = process.env): number | undefined {
	const raw = env.PI_COC_ADMISSION_FAST_MIN_CONFIDENCE?.trim();
	if (raw === "off") return undefined;
	const value = Number(raw || NaN);
	return Number.isFinite(value) && value > 0 && value <= 1 ? value : ADMISSION_FAST_DEFAULT_MIN_CONFIDENCE;
}
/** A bookkeeping batch (§32.11): an `apply` whose triggering kinds are all fast-path kinds. */
export function bookkeepingBatch(proposal: AdmissionProposal): boolean {
	if (proposal.tool !== "apply" || !proposal.kinds?.length) return false;
	const triggering = proposal.kinds.filter((kind) => TRIGGER_KINDS.has(kind));
	return triggering.length > 0 && triggering.every((kind) => FAST_PATH_KINDS.has(kind));
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
const TRIGGER_KINDS: ReadonlySet<string> = new Set(["move", "clue", "time", "cash", "item", "handout", "map", "object", "usage"]);

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
 * One effect's identifying fields as the reuse key reads them (§32.4): `why`, `how` and the other rationale fields are
 * outside it. Also how a resend of a split batch recognises the lines that already landed (§32.12.3).
 */
export function effectSignature(effect: Record<string, unknown>): string {
	const kind = text(effect.kind) ?? "?";
	const keys = ["to", "label", "travel_minutes", "clue", "minutes", "delta", "name", "regions", "region_labels", "level_labels", "subject", "from", "with", "quantity", "dice", "scope", "object", "description", "category", "adopt", "condition", "weapon", "definition", "offer", "handover", "check", "settlement", "source", "price_id", "currency"];
	return canonical({ kind, ...Object.fromEntries(keys.map((k) => [k, effect[k]]).filter(([, v]) => v !== undefined && v !== null && v !== "")) });
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
		const shown = pick(["actor", "intent", "goal", "method", "skill", "target", "weapon", "spell", "object", "usage", "stakes", "push", "luck", "defense", "outcome"]);
		const lines = [`resolve (roll the dice for an action): ${Object.entries(shown).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("; ")}`];
		const key = canonical({ tool, action: pick(["actor", "intent", "goal", "method", "skill", "target", "weapon", "spell", "object", "usage", "push", "luck", "defense"]) });
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
			return `apply ${kind}: ${fields.join("; ")}${registered ? `; registered_destination=${JSON.stringify({handle: registered.handle, label: registered.label, summary: registered.summary,
					...(registered.canonical_name ? {canonical_name: registered.canonical_name} : {}), ...(registered.aliases?.length ? {also_called: registered.aliases} : {}),
					...(registered.access ? {access: registered.access} : {})})}` : ''}`;
		};
		const signatures = effects.map(effectSignature);
		const ordered = effects.some(effect => effect.kind === 'object' || effect.kind === 'usage');
		const key = canonical({ tool, effects: ordered ? signatures : signatures.sort(), destinations: scope.destinations ?? [] });
		// The key stays the whole batch's (§32.4); the lines are only the reviewed effects (§32.12.3).
		return { tool: "apply", key, lines: shown.map((index) => describe(effects[index]!)), kinds: shown.map((index) => text(effects[index]!.kind) ?? "?"), effects: shown };
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
}

const KEEPER_WINDOW_CHARS = 1500;

function clip(value: string, limit: number): string {
	return value.length <= limit ? value : `${value.slice(0, limit)} […]`;
}

export function admissionSystemPrompt(): string {
	return [
		"You are the action-admission reviewer at a Call of Cthulhu table. The Keeper (the game master, an AI) proposes a resolution or effects. First classify each component: is it the investigator's voluntary action, or genuine NPC initiative, environmental force, rules acting on the investigator, or a consequence of something already chosen and settled? The latter are not_player_action: an involuntary destination, elapsed time, hidden danger or outcome does not require the player to know, name or choose it beforehand. You judge agency and consent, not whether a consequence is true or supported by the module.",
		"Only for voluntary investigator actions, answer: did the player choose this? In a mixed batch, every voluntary component still needs authorization; non-voluntary components do not authorize the rest. Calling something a 'consequence' or 'forced' is not evidence that it is involuntary and cannot disguise a new voluntary route, method, purchase or cost. An NPC demanding payment is not the investigator choosing to pay.",
		"For that consent judgment, judge only from the player's exact current words, what the player was already told (the earlier deliveries), and any still-valid earlier instruction the player gave and did not withdraw. The Keeper's own goal, method, why, how and stakes text describes the proposal; it is not evidence of the player's consent. A Keeper suggestion in earlier narration is not acceptance. Interest in a subject is not a trip to a place. Risk in an action the player chose does not license a different method, destination or target.",
		"When an immediately preceding declaration is labeled unfinished, its turn ended without a Keeper delivery and the action was not thereby withdrawn. Read it together with the current words: a bare request to continue may resume it; current words may instead narrow, replace or withdraw it. The unfinished declaration is context, not automatic authorization. Judge that relationship semantically.",
		"Explicit limits on money, quantity, duration and scope are binding. Compare proposed debits and commitments with the chosen limit; do not round a budget upward, add a deposit, buy extra nights, or use an earlier offer to override the latest choice. A request for one night with a budget of 2.50 does not authorize a debit of 3.00 described as a deposit or two nights. A goal such as lodging authorizes only its chosen scope. If a proposed value exceeds a stated limit, answer not_authorized and identify both values in grounds; the Keeper's why cannot make the excess entailed.",
		"A proposed cash effect with settlement=spending_level is the rulebook's quick settlement: the kernel verifies that this occasional purchase is no greater than the investigator's printed Spending Level, records its price, and leaves cash unchanged. It is not a resource debit and does not need an earlier price disclosure or a second confirmation. Still judge whether the player chose the service, item or activity itself; a Spending Level cannot authorize the Keeper to invent a purchase. Repeated stacking is for the Keeper to consolidate into a real cash debit, not a reason to refuse one valid quick settlement.",
		"For any other voluntary payment, surrender of possessions or resource commitment, find the relevant terms in what the player was already told and their subsequent acceptance, or an explicit still-valid delegation covering those terms. A request for a service is not acceptance of an undisclosed price. 'Fill it up' before any quote does not authorize a five-dollar debit; accepting an earlier five-dollar quote does. A source price, affordability, customary payment, the Keeper's rationale or an NPC demanding money is not consent. Quoting the price in the same delivery as the debit, or proceeding after a quote without new player acceptance, is too late. Routine time and effort inherent in an already-chosen action stay entailed; this requirement concerns a new voluntary bargain or commitment, not every minute or movement. Even if the Keeper already landed a related service this turn, that cannot retroactively authorize payment. Without disclosure and acceptance or applicable delegation, answer not_authorized; if the evidence is incomplete, answer uncertain. Name the missing terms and choice. An unchanged accepted bargain needs no second confirmation. This rule does not require consent to hidden dangers, involuntary rule consequences or genuine NPC initiative; an NPC asking to be paid does not make the investigator's payment NPC initiative.",
		"An object pickup or transfer is a real proposed action, even beside definition or usage preparation. A usage describes the chosen way an object will be used; preparing it must not invent an attack the player only contemplated. Choosing to take a chair and swing it entails the necessary pickup and parameter preparation, not a different target or method. A different object's or usage's permission is not reusable. Pure owned-equipment adoption and same-owner state recording are bookkeeping; an NPC's own initiative remains not_player_action. Preparing parameters does not settle the attack or grant an extra action.",
		"For a voluntary move, the following destination-choice and commitment restrictions apply; they do not require consent to an involuntary displacement or its hidden destination or elapsed time. registered_destination is authoritative evidence of what the target scene physically is. Read it by its names, not by its handle: handle is a file name, often the slug of one room, while canonical_name is the module's own name for the place and also_called lists the other names it is known by. A player who names the place by any of those names, in any language, has named this destination. A label may present that same place in the player's language; it cannot substitute a different city, building or destination. If the player chooses Athens but the registered target is a Boston hotel, answer not_authorized even when label says Athens. A genuinely missing chosen destination must be registered through the reviewed adaptation path before movement.",
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
		"Write grounds and missing in English: they are read by the Keeper, who writes to the player in the player's own language. Quote the player's words as they are.",
	].join("\n");
}

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
		"",
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
	return { verdict, grounds, ...(missing ? { missing } : {}) };
}

/** The refusal the Keeper reads when the review did not admit the action (contract §32.2). */
export function admissionRefusal(proposal: AdmissionProposal, verdict: AdmissionVerdict): KernelError {
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
	const fix = streak >= 2
		? `${landed}. The review service has failed ${streak} times in a row now, so a resend will not fix it: tell the player plainly in narrate, as a service notice and not as fiction, that the table cannot settle actions until the person running it restores the review service — they have been notified outside the game — and do not promise that the next input will work.`
		: `${landed} this turn; tell the player plainly in narrate, as a service notice and not as fiction, that the table could not settle that part for the moment. The player's next input can try again.`;
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
	| { ok: false; reason: string; detail: string; ms: number; model?: string; reviewer?: AdmissionReviewer; meta?: Record<string, unknown> }
	/**
	 * §32.12.2: no sufficient verdict -- the cap passed (`cause: "cap"`, and `lane` is the review still running, until the
	 * hard cap) or the lane answered without grounds (`cause: "no_grounds"`, nothing running). The caller decides between
	 * the late admission and `review_pending`. Never an admit by itself.
	 */
	| { ok: "late"; cause: "cap" | "no_grounds"; ms: number; capMs: number; hardCapMs: number; typed?: TypedReading; lane?: Promise<AdmissionOutcome>; meta: Record<string, unknown> }
	/**
	 * §32.12.3: the typed answer admitted some lines of an `apply` batch at the fast-path confidence and not the rest, and no
	 * sufficient verdict stood for the whole. `cleared` are the admitted lines' indices; the batch's lane round has been
	 * aborted, and the caller reviews the remainder on its own (`remainderAttempt` carries the typed answer to it).
	 */
	| { ok: "split"; cleared: number[]; ms: number; attempt: TypedAttempt; capMs: number; hardCapMs: number; startedAt: number; meta: Record<string, unknown> };

export interface AdmissionReviewOptions {
	providerBudget?: import('../../runtime/jev/provider-budget.ts').TaskProviderBudget;
	ctx: ExtensionContext;
	proposal: AdmissionProposal;
	context: AdmissionContext;
	record: (row: Record<string, unknown>) => Promise<void> | void;
	signal?: AbortSignal;
	timeoutMs?: number;
}

/**
 * One review round through the shared lane runner (contract §12.5's pattern, §32's remit). Never throws. A round cut at
 * `timeoutMs` is the host's `review_timeout` verdict; an answer whose grounds are empty is no verdict (`no_grounds`,
 * §32.12.2): it neither admits nor refuses, and it is not an outage.
 */
export async function reviewAdmission(options: AdmissionReviewOptions): Promise<AdmissionOutcome> {
	const capMs = options.timeoutMs ?? admissionTimeoutMs();
	const lane = await runLane<AdmissionVerdict>({
		providerBudget: options.providerBudget,
		ctx: options.ctx,
		envName: "PI_COC_ADMISSION_MODEL",
		lane: "admission",
		record: options.record,
		systemPrompt: admissionSystemPrompt(),
		input: buildAdmissionInput(options.proposal, options.context),
		...(options.signal ? { signal: options.signal } : {}),
		timeoutMs: capMs,
		shape: shapeVerdict,
	});
	const meta = { path: "lane", first_byte_ms: lane.firstByteMs ?? null };
	// §32.12: a round cut at its cap -- whether the provider never answered or answered and streamed past it -- is the
	// host's `review_timeout` verdict, a refusal; never an outage, and never an admit.
	if (!lane.ok && lane.reason === "timeout") return { ok: true,
		verdict: { verdict: REVIEW_TIMEOUT, grounds: `no verdict within the ${capMs} ms cap`, reviewer: "lane", path: "lane", capMs },
		ms: lane.ms, model: lane.model ?? "", reviewer: "lane", meta: { ...meta, timed_out: true, cap_ms: capMs } };
	if (!lane.ok) return { ok: false, reason: lane.reason, detail: lane.detail, ms: lane.ms, ...(lane.model ? { model: lane.model } : {}), reviewer: "lane", meta };
	// §32.12.2: only a verdict with grounds is a verdict. The prompt asks for the words relied on; an answer without them
	// cannot be read back by the Keeper or audited, so it is treated as no answer.
	if (!lane.value.grounds.trim()) return { ok: false, reason: NO_GROUNDS, detail: `the lane answered ${lane.value.verdict} with no grounds`, ms: lane.ms,
		model: lane.model, reviewer: "lane", meta: { ...meta, lane_verdict: lane.value.verdict } };
	return { ok: true, verdict: { ...lane.value, reviewer: "lane", path: "lane" }, ms: lane.ms, model: lane.model, reviewer: "lane", meta };
}

/**
 * `apply` kinds whose line carries a number the player may have limited (§32.2's explicit limits
 * and undisclosed prices). Jev reads numbers as text (docs.typesafe.ai model-jaggedness, jev-1.13),
 * so a typed answer on such a batch never stands as the primary verdict. A closed contract enum, never a reading of prose.
 */
const LANE_ONLY_KINDS: ReadonlySet<string> = new Set(["cash"]);

export interface PrimaryAdmissionReviewOptions extends AdmissionReviewOptions {
	campaign: string;
	env?: NodeJS.ProcessEnv;
	/** An explicit port for isolated tests and offline replay; production uses the shared adapter. */
	decision?: DecisionPort;
	/** §32.12.3: an `apply` batch's typed answer may admit its lines one by one (`ok: "split"`). The caller's top-level review only. */
	lineLevel?: boolean;
	/** §32.12.3: a typed answer already in hand (the remainder's share of the batch's); no typed call is made. */
	typedAttempt?: TypedAttempt;
	/** When the call's review began: the cap and the hard cap are measured from it (§32.12.2), across a split (§32.12.3). */
	startedAt?: number;
	/** The lane round's deadline, measured from `startedAt`; default twice the cap. */
	hardCapMs?: number;
}

/** One typed answer as the review keeps it: Jev's result (or none) and its telemetry. */
export type TypedAttempt = { typed: Awaited<ReturnType<typeof runAdmissionJev>> | undefined; meta: Record<string, unknown> };

/**
 * §32.12.3: the kinds whose line the typed reviewer may admit on its own inside a batch -- §32.11's fast-path kinds and
 * §32.1's non-triggering kinds (which need no review on their own). Never `cash` (§32.10's numeric commitment), `item`,
 * `object`, `usage` or `map` (§32.11). A closed contract enum, never a reading of the prose.
 */
export function lineClearable(kind: string): boolean {
	return FAST_PATH_KINDS.has(kind) || !TRIGGER_KINDS.has(kind);
}
/**
 * Pure (§32.12.3). The lines of an `apply` batch the typed answer admits on their own: a clearable kind, an admitting line
 * verdict, and a line confidence at the fast-path confidence or above. Empty when the batch is not an `apply`, the answer
 * has no lines, or the fast path is off.
 */
export function clearedLines(proposal: AdmissionProposal, typed: TypedAttempt["typed"] | undefined, minConfidence: number | undefined): number[] {
	if (proposal.tool !== "apply" || minConfidence === undefined || !proposal.kinds?.length) return [];
	const lines = typed?.lines;
	if (!lines || lines.length !== proposal.lines.length) return [];
	return lines.flatMap((line, index) => lineClearable(proposal.kinds![index] ?? "?") && ADMITTING_VERDICTS.has(line.verdict)
		&& line.confidence >= minConfidence ? [index] : []);
}
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

/** One typed attempt (§32.10's family) under the review's own signal, budget and deadline. Never throws. */
async function typedAttempt(options: PrimaryAdmissionReviewOptions, env: NodeJS.ProcessEnv, began: number, minConfidence: number): Promise<TypedAttempt> {
	const context = options.context;
	const input: AdmissionJevInput = {
		campaign: options.campaign,
		turn: context.turn,
		tool: options.proposal.tool,
		proposal: [...options.proposal.lines],
		playerText: context.playerText,
		...(context.interruptedPlayerText ? { interruptedPlayerText: context.interruptedPlayerText } : {}),
		investigators: context.investigators.map((row) => ({ name: row.name, ...(row.occupation ? { occupation: row.occupation } : {}) })),
		...(context.scene ? { scene: context.scene } : {}),
		present: [...context.present],
		delivered: context.delivered.map((row) => ({ turn: row.turn, player: row.player ?? null, keeper: row.keeper })),
		landed: [...context.landed],
		refused: [...context.refused],
	};
	let typed: Awaited<ReturnType<typeof runAdmissionJev>> | undefined;
	let lease: TaskLease | undefined, accounting: ReturnType<typeof preparationBudget> | undefined;
	try {
		const deadlineAt = Math.min(began + admissionJevTimeoutMs(env), options.providerBudget?.deadlineAt ?? Infinity);
		const outer = options.signal ?? new AbortController().signal;
		const signal = options.providerBudget ? AbortSignal.any([outer, options.providerBudget.signal]) : outer;
		const bindings = admissionJevBindings(input);
		accounting = preparationBudget({
			decision: options.decision ?? createDecisionAdapter({ env, maxConcurrency: 4, retryPolicies: {
				[ADMISSION_JEV_FAMILY]: { maxRetries: 0, backoffInitialMs: 100, backoffMaxMs: 1_000 } } }),
			campaign: options.campaign, deadlineAt, signal, ...(options.providerBudget ? { parent: options.providerBudget } : {}),
			owner: ADMISSION_JEV_FAMILY, goal: "Judge whether the player chose the proposed action",
		});
		lease = new TaskLease({ owner: ADMISSION_JEV_FAMILY, goal: "Judge whether the player chose the proposed action",
			scope: bindings.scope, capabilities: ["decision"], readSet: bindings.readSet, signal,
			budget: { deadlineAt, remainingInputTokens: 200_000, remainingOutputTokens: 20_000, remainingCostUsd: 0.02, remainingActions: 4 } });
		typed = await runAdmissionJev(input, accounting.decision, lease, { minConfidence });
	} catch {
		typed = undefined;
	} finally {
		lease?.close();
		accounting?.close();
	}
	const meta: Record<string, unknown> = typed ? {
		jev_ms: typed.elapsedMs,
		jev_calls: typed.calls,
		jev_input_tokens: typed.usage.inputTokens,
		...(typed.confidence === undefined ? {} : { jev_confidence: typed.confidence }),
		...(typed.lines ? { line_verdicts: typed.lines.map((line) => line.verdict) } : {}),
		// §32.12.3: each line's own confidence, so a line-level decision (and one that did not happen) can be read back.
		...(typed.lines ? { line_confidences: typed.lines.map((line) => line.confidence) } : {}),
	} : { jev_calls: 0, jev_ms: Date.now() - began };
	return { typed, meta };
}

function readingOf(typed: TypedAttempt["typed"]): TypedReading | undefined {
	if (!typed) return undefined;
	if (typed.status === "decided") return { status: "decided", verdict: typed.verdict, confidence: typed.confidence,
		lineVerdicts: typed.lines.map((line) => line.verdict), grounds: typed.grounds, ...(typed.missing ? { missing: typed.missing } : {}) };
	return { status: "fallback", reason: typed.reason, ...(typed.confidence === undefined ? {} : { confidence: typed.confidence }),
		...(typed.lines ? { lineVerdicts: typed.lines.map((line) => line.verdict) } : {}) };
}

/**
 * The primary review (§32.10, §32.11, §32.12.2). The lane (§32.2) and the typed family (§32.10) start at the same moment
 * and the first **sufficient** verdict wins; the other is abandoned (the lane's round is aborted).
 *
 * - The lane's verdict is sufficient when it carries grounds. A lane answer without grounds is no answer.
 * - A typed verdict is sufficient only where §32.10/§32.11 let it stand alone: on a bookkeeping batch, every line
 *   admitting at the fast-path confidence (§32.11); with Jev as the configured reviewer, any verdict at the family
 *   confidence, except on a batch carrying `cash` (§32.10's numeric commitment). A typed refusal never stands on the fast path.
 * - The lane's own failure is an outage (§32.2) unless a typed verdict stands.
 * - At the cap (`timeoutMs`, `PI_COC_ADMISSION_TIMEOUT_MS`) with nothing sufficient, or when the lane answered without
 *   grounds, the review returns `ok: "late"` with the typed reading and the lane still running (until the hard cap, twice
 *   the cap): the caller admits it late or returns it pending. This function never admits on a failure.
 *
 * Never throws; every outcome names its `path` (whose verdict stood).
 */
export async function reviewAdmissionPrimary(options: PrimaryAdmissionReviewOptions): Promise<AdmissionOutcome> {
	const env = options.env ?? process.env;
	const reviewer = admissionReviewer(env), familyMin = admissionJevMinConfidence(env);
	const fastMin = bookkeepingBatch(options.proposal) ? admissionFastMinConfidence(env) : undefined;
	const numeric = options.proposal.kinds?.some((kind) => LANE_ONLY_KINDS.has(kind)) ?? false;
	const capMs = options.timeoutMs ?? admissionTimeoutMs(env), hardCapMs = options.hardCapMs ?? admissionHardCapMs(capMs);
	const began = options.startedAt ?? Date.now();
	const fast = fastMin === undefined ? {} : { fast_path: true, fast_min_confidence: fastMin };
	// §32.12.3: the line threshold is the fast-path confidence, on any `apply` batch; the fast path's `off` turns it off too.
	const lineMin = options.lineLevel && options.proposal.tool === "apply" ? admissionFastMinConfidence(env) : undefined;
	// Whether a typed answer could stand at all on this batch; when it could not, the row names no typed fallback.
	const primary = fastMin !== undefined || reviewer === "jev" || lineMin !== undefined || options.typedAttempt !== undefined;
	const stop = new AbortController();
	const lane = reviewAdmission({ ...options, signal: options.signal ? AbortSignal.any([options.signal, stop.signal]) : stop.signal,
		timeoutMs: Math.max(1, hardCapMs - (Date.now() - began)) });
	// The typed attempt reads every answer (minimum 0) and this function applies each threshold itself: one call serves all.
	const typed = options.typedAttempt ? Promise.resolve(options.typedAttempt) : typedAttempt(options, env, began, 0);
	const stands = (attempt: TypedAttempt): string | undefined => {
		const answer = attempt.typed;
		if (answer?.status !== "decided") return undefined;
		if (fastMin !== undefined && ADMITTING_VERDICTS.has(answer.verdict) && answer.confidence >= fastMin) return "fast_path";
		if (reviewer === "jev" && !numeric && answer.confidence >= familyMin) return "family";
		return undefined;
	};
	const fallbackOf = (attempt?: TypedAttempt): string | undefined => {
		if (!primary) return undefined;
		if (!attempt) return "lane_first";
		const answer = attempt.typed;
		if (!answer) return "admission_owner_error";
		if (answer.status !== "decided") return answer.reason;
		if (fastMin === undefined && numeric) return "numeric_commitment";
		if (fastMin !== undefined) return ADMITTING_VERDICTS.has(answer.verdict) ? "low_confidence" : "typed_refusal";
		return "low_confidence";
	};
	const jevMeta = (attempt?: TypedAttempt) => {
		const fallback = fallbackOf(attempt);
		return { ...fast, ...(fallback ? { jev_fallback: fallback } : {}), ...(attempt?.meta ?? {}) };
	};
	const typedVerdict = (attempt: TypedAttempt, rule: string): AdmissionOutcome => {
		stop.abort();
		const answer = attempt.typed as Extract<NonNullable<TypedAttempt["typed"]>, { status: "decided" }>;
		return {
			ok: true,
			verdict: { verdict: answer.verdict, grounds: answer.grounds, ...(answer.missing ? { missing: answer.missing } : {}), reviewer: "jev", path: "typed" },
			ms: Date.now() - began,
			model: ADMISSION_JEV_MODEL,
			reviewer: "jev",
			meta: { path: "typed", ...fast, ...(fastMin !== undefined ? { typed_rule: rule } : {}), confidence: answer.confidence, ...attempt.meta },
		};
	};
	const late = (cause: "cap" | "no_grounds", attempt: TypedAttempt | undefined, laneDone?: AdmissionOutcome): AdmissionOutcome => {
		const reading = readingOf(attempt?.typed);
		return { ok: "late", cause, ms: Date.now() - began, capMs, hardCapMs, ...(reading ? { typed: reading } : {}), ...(cause === "cap" ? { lane } : {}),
			meta: { ...jevMeta(attempt), cap_ms: capMs, hard_cap_ms: hardCapMs,
				...(laneDone ? { lane_ms: laneDone.ms, ...(laneDone.meta ?? {}), path: "lane" } : { path: "lane" }),
				...(cause === "no_grounds" ? { lane_no_grounds: true } : {}) } };
	};
	// The lane finished with nothing sufficient and the typed answer is in and does not stand.
	const afterLane = (laneDone: AdmissionOutcome, attempt: TypedAttempt): AdmissionOutcome => {
		if (laneDone.ok === false && laneDone.reason === NO_GROUNDS) return late("no_grounds", attempt, laneDone);
		if (laneDone.ok === false) return { ...laneDone, ms: Date.now() - began, meta: { ...laneDone.meta, ...jevMeta(attempt), lane_ms: laneDone.ms } };
		return late("cap", attempt, laneDone);
	};
	// §32.12.3: some lines admitted on their own and not all -- the batch's lane round is dropped and the caller reviews the
	// rest. Only where nothing sufficient stood for the whole batch, and never after the lane has answered it.
	const split = (attempt: TypedAttempt): AdmissionOutcome | undefined => {
		const cleared = clearedLines(options.proposal, attempt.typed, lineMin);
		if (!cleared.length || cleared.length >= options.proposal.lines.length) return undefined;
		stop.abort();
		return { ok: "split", cleared, ms: Date.now() - began, attempt, capMs, hardCapMs, startedAt: began,
			meta: { ...jevMeta(attempt), line_min_confidence: lineMin } };
	};
	type Event = { kind: "lane"; value: AdmissionOutcome } | { kind: "typed"; value: TypedAttempt } | { kind: "cap" };
	let timer: ReturnType<typeof setTimeout> | undefined;
	const waiting = new Map<string, Promise<Event>>([
		["lane", lane.then((value): Event => ({ kind: "lane", value }))],
		["typed", typed.then((value): Event => ({ kind: "typed", value }))],
		["cap", new Promise<Event>((settle) => { timer = setTimeout(() => settle({ kind: "cap" }), Math.max(0, capMs - (Date.now() - began))); timer.unref?.(); })],
	]);
	let laneDone: AdmissionOutcome | undefined, typedDone: TypedAttempt | undefined;
	try {
		for (;;) {
			const event = await Promise.race(waiting.values());
			waiting.delete(event.kind);
			if (event.kind === "typed") {
				typedDone = event.value;
				const rule = stands(typedDone);
				if (rule) return typedVerdict(typedDone, rule);
				if (laneDone) return afterLane(laneDone, typedDone);
				const parted = split(typedDone);
				if (parted) return parted;
				continue;
			}
			if (event.kind === "lane") {
				laneDone = event.value;
				if (laneDone.ok === true && laneDone.verdict.verdict !== REVIEW_TIMEOUT)
					return { ...laneDone, ms: Date.now() - began, meta: { ...laneDone.meta, ...jevMeta(typedDone), lane_ms: laneDone.ms } };
				if (typedDone) return afterLane(laneDone, typedDone);
				continue;
			}
			// The cap. The typed attempt has its own, shorter cap: its answer is awaited, never raced away.
			typedDone ??= await typed;
			const rule = stands(typedDone);
			if (rule) return typedVerdict(typedDone, rule);
			if (laneDone) return afterLane(laneDone, typedDone);
			return split(typedDone) ?? late("cap", typedDone);
		}
	} finally {
		if (timer) clearTimeout(timer);
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
 * Pure (§32.12.2). At the cap, a bookkeeping-only batch whose typed verdict admits every line at the late threshold is
 * admitted on it (`path: "typed_late"`); anything else is not, and goes back to the Keeper pending.
 */
export function lateAdmission(proposal: AdmissionProposal, typed: TypedReading | undefined, env: NodeJS.ProcessEnv = process.env): LateAdmission {
	const minConfidence = admissionLateMinConfidence(env);
	if (minConfidence === undefined) return { ok: false, reason: "late_off" };
	if (!lateEligibleBatch(proposal)) return { ok: false, reason: "not_bookkeeping" };
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
