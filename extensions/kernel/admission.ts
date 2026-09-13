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

/** The closed set of verdicts; anything else is `bad_output`. The first three admit, the last two refuse. */
export const ADMITTING_VERDICTS: ReadonlySet<string> = new Set(["authorized", "entailed", "not_player_action"]);
export const REFUSING_VERDICTS: ReadonlySet<string> = new Set(["not_authorized", "uncertain"]);

/**
 * Cap on one review, `PI_COC_ADMISSION_TIMEOUT_MS`. The first real table (`admission-e2e-1`,
 * grok-4.6 reviewing) answered in 13–45 s and lost two turns to a 60 s cap; a cap that refuses
 * costs the player the action, so it sits at the verifier's two minutes rather than below it.
 */
const DEFAULT_ADMISSION_TIMEOUT_MS = 120_000;

export function admissionTimeoutMs(): number {
	const raw = process.env.PI_COC_ADMISSION_TIMEOUT_MS?.trim();
	if (!raw) return DEFAULT_ADMISSION_TIMEOUT_MS;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 ? value : DEFAULT_ADMISSION_TIMEOUT_MS;
}

export interface AdmissionVerdict {
	verdict: string;
	grounds: string;
	missing?: string;
}

/** One proposal put to review: the tool, a host-owned reuse key, and the lines the reviewer reads. */
export interface AdmissionProposal {
	tool: "resolve" | "apply";
	/** Canonical form of what is proposed, for verdict reuse within a turn; never shown to a model. */
	key: string;
	lines: string[];
}

export interface AdmissionScope {
	/** Investigator names at this table; an action by anyone else is NPC initiative, not a player action. */
	party: string[];
	/** The current scene's handle and player-facing label: a `move` to it is a rename, not travel. */
	scene?: { handle?: string; label?: string };
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
const TRIGGER_KINDS: ReadonlySet<string> = new Set(["move", "clue", "time", "cash", "item", "handout", "map"]);

/** `resolve` decision families that are never a voluntary player action: the rules or the table run them. */
const EXEMPT_DECISION_PREFIXES: readonly string[] = ["sanity:", "development:"];

const norm = (value: unknown): string => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const text = (value: unknown): string | undefined => {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
};

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
		const shown = pick(["actor", "intent", "goal", "method", "skill", "target", "weapon", "spell", "object", "stakes", "push", "luck", "defense", "outcome"]);
		const lines = [`resolve (roll the dice for an action): ${Object.entries(shown).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("; ")}`];
		const key = canonical({ tool, action: pick(["actor", "intent", "goal", "method", "skill", "target", "weapon", "spell", "object", "push", "luck", "defense"]) });
		return { tool: "resolve", key, lines };
	}
	if (tool === "apply") {
		const effects = Array.isArray(payload.effects) ? (payload.effects as Array<Record<string, unknown>>) : [];
		const here = [scope.scene?.handle, scope.scene?.label].filter(Boolean).map(norm);
		const triggers = effects.some((effect) => {
			const kind = text(effect?.kind);
			if (!kind || !TRIGGER_KINDS.has(kind)) return false;
			if (kind === "move" && here.includes(norm(effect.to))) return false;
			return true;
		});
		if (!triggers) return null;
		const describe = (effect: Record<string, unknown>): string => {
			const kind = text(effect.kind) ?? "?";
			const fields = Object.entries(effect)
				.filter(([k, v]) => k !== "kind" && !k.startsWith("_") && v !== undefined && v !== null && v !== "")
				.map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v)}`);
			return `apply ${kind}: ${fields.join("; ")}`;
		};
		const signature = (effect: Record<string, unknown>): Record<string, unknown> => {
			const kind = text(effect.kind) ?? "?";
			const keys = ["to", "clue", "minutes", "delta", "name", "regions", "region_labels", "level_labels", "subject", "from", "quantity", "dice", "scope"];
			return { kind, ...Object.fromEntries(keys.map((k) => [k, effect[k]]).filter(([, v]) => v !== undefined && v !== null && v !== "")) };
		};
		const key = canonical({ tool, effects: effects.map(signature).map(canonical).sort() });
		return { tool: "apply", key, lines: effects.map(describe) };
	}
	return null;
}

export interface AdmissionContext {
	turn: number;
	/** The exact current player text; the review has no authority without it. */
	playerText: string;
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
		"You are the action-admission reviewer at a Call of Cthulhu table. The Keeper (the game master, an AI) is about to settle an action on the investigator's behalf: roll dice for it, move the investigator somewhere, spend their time or money, hand them a clue or a document, or take or give an item. Answer one question: did the player choose this?",
		"Judge only from the player's exact current words, what the player was already told (the earlier deliveries), and any still-valid earlier instruction the player gave and did not withdraw. The Keeper's own goal, method, why, how and stakes text describes the proposal; it is not evidence of the player's consent. A Keeper suggestion in earlier narration is not acceptance. Interest in a subject is not a trip to a place. Risk in an action the player chose does not license a different method, destination or target.",
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
		},
	});
}

/** No review, no authority (contract §32.2): the Keeper is told the service status, and tells the player as such. */
export function admissionUnavailable(proposal: AdmissionProposal, reason: string, detail: string): KernelError {
	return new KernelError({
		code: "needs",
		message: "The action review is unavailable, so this action cannot be settled now",
		fix: "Only this batch is unsettled: whatever this turn already settled with a receipt (a roll made, an effect that landed) did happen and is narrated as usual. For this batch, do not roll or land anything, do not narrate its effects as having happened, and do not retry it this turn; tell the player plainly in narrate, as a service notice and not as fiction, that the table could not settle that part for the moment. The player's next input can try again.",
		details: { reason: "admission_unavailable", cause: reason, detail: detail.slice(0, 200), proposed: proposal.lines, tool: proposal.tool },
	});
}

export type AdmissionOutcome =
	| { ok: true; verdict: AdmissionVerdict; ms: number; model: string }
	| { ok: false; reason: string; detail: string; ms: number; model?: string };

export interface AdmissionReviewOptions {
	ctx: ExtensionContext;
	proposal: AdmissionProposal;
	context: AdmissionContext;
	record: (row: Record<string, unknown>) => Promise<void> | void;
	signal?: AbortSignal;
	timeoutMs?: number;
}

/** One review round through the shared lane runner (contract §12.5's pattern, §32's remit). Never throws. */
export async function reviewAdmission(options: AdmissionReviewOptions): Promise<AdmissionOutcome> {
	const lane = await runLane<AdmissionVerdict>({
		ctx: options.ctx,
		envName: "PI_COC_ADMISSION_MODEL",
		lane: "admission",
		record: options.record,
		systemPrompt: admissionSystemPrompt(),
		input: buildAdmissionInput(options.proposal, options.context),
		...(options.signal ? { signal: options.signal } : {}),
		timeoutMs: options.timeoutMs ?? admissionTimeoutMs(),
		shape: shapeVerdict,
	});
	if (!lane.ok) return { ok: false, reason: lane.reason, detail: lane.detail, ms: lane.ms, ...(lane.model ? { model: lane.model } : {}) };
	return { ok: true, verdict: lane.value, ms: lane.ms, model: lane.model };
}
