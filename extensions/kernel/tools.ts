/**
 * The Keeper verbs. Preparation and final output have separate owners (§233.10).
 * except `campaign` and `call_id`, which the extension fills in: the model
 * neither sees nor writes them.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { type TSchema, Type } from "typebox";
import {TurnEvent} from "../../shared/turn-event.ts";
import {MOVE_ESTABLISHMENT_DEPENDENCIES} from '../../shared/move-protocol.ts';

export const COC_TOOL_NAMES = ["look", "lookup", "recall", "resolve", "apply", "ask", "narrate", "output"] as const;
export type CocToolName = (typeof COC_TOOL_NAMES)[number];

/** State-changing calls: they mint a `call_id`, and they are refused once the turn is closed. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(["resolve", "apply", "ask", "output"]);

/** A malformed document edit is an argument correction, not an unmade player choice. */
export function documentWriteRefusal(tool: string, args: Record<string, unknown>) {
	if (tool !== "apply" || !Array.isArray(args.effects)) return;
	for (const [index, effect] of args.effects.entries()) {
		if (effect?.kind !== "object" || !["write", "append"].includes(effect.document?.action)) continue;
		if (typeof effect.from === "string" && effect.from.trim()) continue;
		return {code: "invalid_params", message: "An existing document edit needs its current owner in from",
			fix: "Correct this argument using the carrier's current owner in both from and to; keep the player's chosen writing scope. For an addition that preserves old text, use document action append with only the new suffix, including any desired newline. This is not a request for another player authorization.",
			details: {field: `effects[${index}].from`, reason: "document_owner_missing"}};
	}
}

export interface CocToolSpec {
	name: CocToolName;
	label: string;
	method: string;
	description: string;
	promptSnippet: string;
	parameters: TSchema;
}

const UsingSkill = Type.Optional(Type.String({
	description: "Optional host-only annotation: copy an exact currently offered skills.cards name on the first relevant call if deliberately following it. Never grants authority; later calls need not repeat it.",
}));

/**
 * Contract §135.21: an argument that says why or how a write happened is one sentence, not prose. Every such field
 * (`how` on a clue, every `why`) declares this ceiling in its schema, and a call over it is refused before it runs
 * with a fix that says to shorten it (`argumentLimitRefusal`), on both loop engines; nothing is ever cut to fit. 200
 * characters is the workpad's one-sentence ceiling (§19.2); across 604 recorded `how`/`why` arguments of the App's and
 * the source tree's play sessions the longest was 99.
 */
export const SENTENCE_MAX = 200;
/** The fields `SENTENCE_MAX` bounds, wherever they sit in a call's arguments (schema field names, a closed list). */
export const SENTENCE_FIELDS: readonly string[] = Object.freeze(["how", "why"]);
const Sentence = (description?: string) =>
	Type.String({ maxLength: SENTENCE_MAX, description: `${description ? `${description}; ` : ""}one sentence, at most ${SENTENCE_MAX} characters` });

/**
 * The refusal of a call whose `how`/`why` argument is longer than one sentence (§135.21), or none: `invalid_params`
 * with `code_detail: argument_too_long`, every offending field with its length, and a fix that says to shorten it.
 * Lengths are counted in code points, as JSON Schema's `maxLength` counts them.
 */
export function argumentLimitRefusal(tool: string, args: unknown): { code: string; code_detail: string; message: string; fix: string; retryable: false; next: "change_input"; details: Record<string, unknown> } | undefined {
	const over: Array<{ field: string; length: number; max: number }> = [];
	const walk = (value: unknown, path: string): void => {
		if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`));
		else if (value && typeof value === "object") for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			const field = path ? `${path}.${key}` : key;
			if (SENTENCE_FIELDS.includes(key) && typeof item === "string") {
				const length = Array.from(item).length;
				if (length > SENTENCE_MAX) over.push({ field, length, max: SENTENCE_MAX });
			} else walk(item, field);
		}
	};
	walk(args, "");
	if (!over.length) return undefined;
	const named = over.map((row) => `${row.field} (${row.length} characters)`).join(", ");
	return {
		code: "invalid_params", code_detail: "argument_too_long", retryable: false, next: "change_input",
		message: `${tool}: ${named} ${over.length === 1 ? "is" : "are"} longer than one sentence of ${SENTENCE_MAX} characters`,
		fix: `Shorten ${over.map((row) => row.field).join(", ")} to one sentence of at most ${SENTENCE_MAX} characters and send the same call again; nothing in this call was written. What does not fit in one sentence belongs in the narration, not in the argument.`,
		details: { fields: over },
	};
}

/** One branch of `apply`'s `effects[]` union: its kind and the properties it requires (read off the schema itself). */
interface EffectBranch { kind: string; required: string[]; arrays: string[] }
const branchCache = new WeakMap<object, EffectBranch[]>();
function effectBranches(parameters: TSchema): EffectBranch[] {
	const cached = branchCache.get(parameters);
	if (cached) return cached;
	const items = (parameters as { properties?: { effects?: { items?: { anyOf?: unknown[] } } } }).properties?.effects?.items;
	const branches = (items?.anyOf ?? []).flatMap((branch): EffectBranch[] => {
		const shape = branch as { properties?: Record<string, { enum?: unknown[]; const?: unknown; type?: unknown }>; required?: unknown[] };
		const kind = shape.properties?.kind, names = [...(kind?.enum ?? []), ...(kind?.const !== undefined ? [kind.const] : [])];
		const required = (shape.required ?? []).filter((key): key is string => typeof key === "string" && key !== "kind");
		const arrays = Object.entries(shape.properties ?? {}).filter(([, field]) => field.type === "array").map(([name]) => name);
		return names.filter((name): name is string => typeof name === "string").map(name => ({ kind: name, required, arrays }));
	});
	branchCache.set(parameters, branches);
	return branches;
}
/** How a clue the prose gives is written, for a fix that must say it (§201.3). */
const CLUE_EFFECT_WORDS = 'a clue the book has is {kind: "clue", clue: <its name, as where.affordances or known.clues_here list it>}';

/**
 * Contract §201.3: an `apply` effect Pi's schema cannot take, refused before the schema check with how to write it -- the
 * schema's own message lists every branch of the effect union (T7 of TR-F2 run 3: eight lines about `scope`, `name`, `to`
 * and `clue` for an effect whose only fault was `kind: "narrate"`), and names no fix. These are shapes the schema check
 * refuses regardless of scalar coercion: a `kind` that is not an effect kind (a tool's name among them, closing prose put
 * in an effect), a known kind missing a required property, and an object supplied for a declared array. Other
 * conversions and validation remain owned by Pi. Malformed arrays are never unwrapped or partially applied.
 */
export function effectShapeRefusal(tool: string, parameters: TSchema, args: unknown): { code: string; code_detail: string; message: string; fix: string; retryable: false; next: "change_input"; details: Record<string, unknown> } | undefined {
	if (tool !== "apply" || !args || typeof args !== "object" || Array.isArray(args)) return undefined;
	const effects = (args as Record<string, unknown>).effects;
	if (!Array.isArray(effects)) return undefined;
	const branches = effectBranches(parameters), kinds = branches.map(branch => branch.kind);
	if (!kinds.length) return undefined;
	const unchanged = "Nothing in this call was written; send it again corrected.";
	for (const [index, value] of effects.entries()) {
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		const effect = value as Record<string, unknown>, kind = effect.kind, field = `effects[${index}]`;
		const branch = typeof kind === "string" ? branches.find(entry => entry.kind === kind) : undefined;
		if (!branch) {
			const shown = typeof kind === "string" ? JSON.stringify(kind) : "missing";
			const toolName = typeof kind === "string" && (COC_TOOL_NAMES as readonly string[]).includes(kind);
			const prose = kind === "narrate"
				? `Closing prose is material, not an effect: this apply's legacy narrate field only prepares/checks it after effects. Submit the finished material with narrate handoff:true. `
				: toolName ? `${kind} is a tool of its own, not an effect of apply: call it separately. ` : "";
			const semantic = kind === "event" || kind === "knowledge"
				? 'Record the occurrence in top-level apply.event beside effects, not inside effects: event: {name: <occurrence name>, ...}. Acquired knowledge belongs in event.knowledge: [{actor: <registered person>, statement: <what was learned>, mode: "observed" | "heard" | "read" | "belief", state: "accurate" | "uncertain" | "distorted", ...}]. Keep the existing event schema and its source/material requirements; do not turn knowledge into a clue. '
				: undefined;
			return { code: "invalid_params", code_detail: "effect_kind_unknown", retryable: false, next: "change_input",
				message: `apply: ${field}.kind is ${shown}, which is not an effect kind`,
				fix: semantic ? `${semantic}${unchanged}` : `${prose}What the prose gives the investigators lands as its own effect: ${CLUE_EFFECT_WORDS}; the effect kinds are ${kinds.join(", ")}. ${unchanged}`,
				details: { field: `${field}.kind`, reason: "effect_kind_unknown", kind: typeof kind === "string" ? kind : null, kinds } };
		}
		for (const key of branch.arrays) {
			const supplied = effect[key];
			if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) continue;
			const path = `${field}.${key}`;
			return { code: "invalid_params", code_detail: "effect_array_expected", retryable: false, next: "change_input",
				message: `apply: ${path} (${branch.kind}) must be a JSON array, not an object`,
				fix: `Write ${path} as a JSON array using square brackets, without an item wrapper object. Keep its entries and the existing schema unchanged. ${unchanged}`,
				details: { field: path, reason: "effect_array_expected", kind: branch.kind } };
		}
		const missing = branch.required.filter(key => effect[key] === undefined);
		if (missing.length) {
			const clue = branch.kind === "clue" ? ` For a clue: ${CLUE_EFFECT_WORDS}.` : "";
			return { code: "invalid_params", code_detail: "effect_field_missing", retryable: false, next: "change_input",
				message: `apply: ${field} (${branch.kind}) is missing ${missing.join(", ")}`,
				fix: `Give ${field} its ${missing.join(", ")}: a ${branch.kind} effect requires ${branch.required.join(", ")}.${clue} ${unchanged}`,
				details: { field, reason: "effect_field_missing", kind: branch.kind, missing } };
		}
	}
	return undefined;
}

/**
 * The workpad patch is deliberately schema-permissive: Pi validates tool arguments against this
 * schema before the tool runs, and a schema refusal would block the delivery that carried the
 * patch — exactly what the contract forbids (§19.2). The shape guidance lives in the description;
 * the host validates strictly after stripping and drops whatever does not conform.
 */
const WorkpadPatch = Type.Optional(Type.Unknown({
	description: "Host-only working notes. The host strips this before the table sees the call and files it only if this exact delivery lands; a malformed, oversized, refused, split, cancelled or stale patch is silently dropped and the delivery itself is unchanged — never rewrite the delivery to fix a patch. Shape: {focus?: string (one line, at most 200 chars), upserts?: array of at most 8 {id: short stable name you choose (letters, digits, dot, dash, underscore; reusing an id replaces that item), kind: \"open_question\" | \"hypothesis\" | \"conditional_continuation\", text: one short sentence in your own words, at most 200 chars, never a receipt number or a settled outcome, status?: \"tentative\" | \"needs_recheck\" | \"discarded\", defaults to tentative, evidence: array of 1–4 names from the current coc-workspace index this item rests on, such as npc:gardener or turn:12}, removes?: array of at most 8 earlier ids to remove; the whole patch stays under 1 KiB and every upsert must cite evidence the index actually showed you. Notes are your private scratchpad across turns: they never become facts, clues obtained, obligations, notes, rulings, admissions or player-visible anything, and they never replace a fresh lookup",
}));

/**
 * Contract §142.2: the result of what someone set out to do. Any effect below can carry it -- the porter comes up the
 * stairs (npc) or the clock moves (threat) because Knott shouted -- and the receipt says whose intention it settled.
 * Contract §143.7: ten effects spread these two fields, so their descriptions are one short line each and the
 * explanation is written once, in the apply tool's description (`INTENT_RESULT_EXPLAINED`). The long sentence repeated
 * in every effect was 4,330 bytes of every Keeper request's tool schema.
 */
const IntentResult = {
	intent_ref: Type.Optional(Type.String({ description: "the intention this effect is a result of (see apply)" })),
	intent_outcome: Type.Optional(StringEnum(["attempted", "done", "failed", "abandoned"] as const, { description: "where it stands after; default done" })),
};
/**
 * Contract §162: the form of a string argument that carries prose the player reads. grok-4.7-build-fast, writing
 * prose inside or beside a structured write, sometimes sends its own JSON encoding of the text as the value (9 of 33
 * such arguments since 2026-09-30, against 1 of 112 for a narrate on its own); with this sentence on the field the
 * probe's rebuilt request went from 3/5 to 0/7. The backslashes are characters of the description: the model reads
 * `\n` and `\u`, not a line break. Every prose-carrying parameter ends with it, through `withPlainProse`.
 */
export const PLAIN_PROSE = "Write the prose itself: not a quoted or JSON-encoded string, no \\n or \\u escapes";
/** Contract §162: a prose parameter's description, ending with `PLAIN_PROSE` as one more sentence. */

const Delivery = Type.Object({
  version: Type.Literal(1),
  materials: Type.Optional(Type.Array(Type.Object({name: Type.String({maxLength:120}), text:Type.Optional(Type.String({maxLength:4000,description:'Permitted fictional notes, not finished narration. Omit only for exact reuse of explicitly player-safe text via source. Private sources require your permitted excerpt. OOC replies stay direct.'})), kind:StringEnum(['fact','description','context'] as const), visibility:StringEnum(['player','keeper'] as const), required:Type.Optional(Type.Boolean()), source:Type.Optional(Type.String())},{anyOf:[{required:['text']},{required:['source']}]}),{maxItems:48})),
  utterances: Type.Optional(Type.Array(Type.Object({speaker:Type.String(),audience:Type.Array(Type.String(),{maxItems:16}),meaning:Type.String({maxLength:4000,description:'The propositions this NPC intends to communicate, in note form, including what they know, what they only heard, and what they cannot answer. This is a semantic brief, not finished dialogue; the final author chooses the spoken wording.'}),stance:Type.Optional(Type.String()),source:Type.Optional(Type.String())}),{maxItems:48})),
  sources:Type.Optional(Type.Array(Type.String(),{maxItems:48})),
  required:Type.Optional(Type.Array(Type.String(),{maxItems:48})),
  presentation:Type.Optional(Type.String({maxLength:2000})),
},{description:'Permitted fiction and NPC intentions; keeper-only rows excluded. Use sources issued by current keeper_support/look/lookup/recall, or receipts. Only explicitly player-safe text permits reuse without an excerpt. Private sources need a player material with text and source. Never invent source names or copy receipt IDs. Checking neither settles nor publishes. OOC replies stay direct.'});

const CarriedDelivery = Type.Object({version:Type.Literal(1)},{additionalProperties:true,description:'Same plan as narrate: materials need name, kind, visibility and text or source. Only player-safe sources allow omitted text; private sources need an excerpt. Output selects the author.'});
export const withPlainProse = (description: string): string =>
	`${description}${description.endsWith(".") ? " " : ". "}${PLAIN_PROSE}`;

/** The one place the effects' `intent_ref` / `intent_outcome` are explained (§143.7). */
export const INTENT_RESULT_EXPLAINED = "Any effect may carry intent_ref when it is the result of what someone set out to do: the ref of that intention (present[].history.intents[].ref, director.offer), which may be someone else's than the effect's subject (the porter comes up because someone shouted); intent_outcome is where that intention stands after the effect, default done (the effect is what happened).";

const EndingEffect = Type.Object({
    kind: StringEnum(["ending"] as const),
    scope: StringEnum(["chapter", "campaign"] as const, { description: "chapter leaves the same campaign playable; campaign is only the final end of the entire adventure, never a pause or a chapter boundary. For an incorrectly completed legacy chapter, scope chapter reclassifies the existing ending without repeating its accounting; final publication commits the correction before continuing" }),
    summary: Type.String({ description: "the ending reached; read source rewards and resolve development:end-session first. An already-accounted legacy correction retains the original summary, turn and rewards. Output commits this effect" }),
});
const AdaptationEffect = Type.Object({
    kind: StringEnum(['adaptation'] as const),
    name: Type.String({description: 'Accept a ready independently reviewed proposal by its semantic name, alone in this batch. This grants no clue, movement, NPC presence, or player action.'}),
});

/** §158.5: the owed row this effect lands -- what an earlier delivered turn told the player and the ledger lacked. */
const OwedRef = Type.Optional(Type.String({ description: "the name of a row of the capsule's owed section that this effect lands: what an earlier turn already told the player happened. Send that row's own effect with it, unchanged; the kernel refuses a name that is not open or an effect that does not land it. Leave it out for anything the player chose this turn" }));

const MoveEffect = Type.Object({
	...IntentResult,
	kind: StringEnum(["move"] as const, { description: "change the persistent gameplay locus; ordinary spatial description inside the current locus needs no move" }),
	to: Type.String({ description: "the persistent gameplay locus chosen by the player, or the one an owed row says they were already told they reached. Reuse an existing place for its rooms or counters. For an ordinary new place consistent with established facts, supply establish and via in this same move; no source reading or adaptation job is required just because the graph lacks it. Do not substitute or relabel another place" }),
	establish: Type.Optional(Type.Object({summary: Type.String({description: "brief description of a new campaign place; preserve known causes and access conditions. This declares an addition, not a replacement of a registered source place"})})),
	travel_minutes: Type.Optional(Type.Integer({ description: "minutes spent on the way; omitted means the road's own minutes (the book's, or the ones this table already travelled it in). The move itself advances the clock by the journey: add no time effect for the same journey. Give them (or travel_band) for a way no road has timed yet, or the clock does not move for it" })),
	travel_band: Type.Optional(StringEnum(["adjacent", "local_travel", "long_travel"] as const, { description: "instead of travel_minutes: adjacent for two parts of one building or place (0 minutes), local_travel within one town or just outside it, long_travel between towns; the kernel takes the row's usual minutes and keeps them as this road's length" })),
	via: Type.Optional(Type.String({ description: "how they got there when the way is not one of the exits you were given — through an unlatched upper window, down a coal chute, following someone in. Say it and the move lands; without it an unlisted destination is refused, and then the world stays where it was while your narration moves on" })),
	label: Type.Optional(Type.String({ description: "a public display name for the SAME registered gameplay locus in the player's language. Use only what the player has learned; a private source heading is not a public name. Omitted reuses the recorded public label or an explicitly public source identity, otherwise a neutral scene caption. It cannot substitute a different locus" })),
	owed: OwedRef,
}, {dependentRequired: MOVE_ESTABLISHMENT_DEPENDENCIES});

const ClueEffect = Type.Object({
	...IntentResult,
	kind: StringEnum(["clue"] as const, { description: "the investigator obtains one clue" }),
	clue: Type.String({
		description:
			"clue name; must be a clue obtainable in the current scene, or the one an owed row says the player was already told. An echo id from the capsule's worldlines.echoes (it starts with echo:) reveals what another worldline left standing here — you decide whether to show it and how to tell it, never what it says",
	}),
	establish: Type.Optional(Type.Object({summary: Type.String({description: "new evidence discovered in this scene, consistent with established causes and the holder's knowledge; include how it was obtained. Existing authored clues use their existing names without establish. This records a campaign fact, not a quotation from the module"})})),
	how: Type.Optional(Sentence("how this clue was actually obtained here, or under its issued owed row; ordinary remote NPC reports use event.knowledge with heard/source/state, without an additional investigator action")),
	from: Type.Optional(Type.String({ description: "the NPC who supplied this obtainable-here or issued owed clue; attribution only, not permission to obtain a distant authored clue. Name the known speaker so the disclosure goes on their ledger. Ordinary remote reports use event.knowledge with mode heard and actual source/state; NPC answers need no separate player selection" })),
	label: Type.Optional(Type.String({ description: "short name of this clue in the player's language; omitted means the clue name" })),
	owed: OwedRef,
});

/** Contract §136.22: the book's amount, named instead of the Keeper's own. */
const StatedAmount = Type.Optional(Type.String({ description: "instead of your own amount: the name of the stated rule whose book amount this is (a where.rules row with a mech line; for threat also the threat whose clock the book advances). The kernel takes the amount from what this turn's resolve with action.rule on it reached, else from the rule's own shape, and records basis stated. Never give an amount as well: that is refused. Without stated the amount is yours and is recorded as yours" }));

/** Contract §138: a row of a band table, named instead of the Keeper's own amount; the kernel rolls inside it. */
const TimeBand = Type.Optional(Type.String({ description: "instead of minutes: the time-cost category this took, by the handle of a row of the rules' time-costs table (a search of one room, library research, a night's sleep); the kernel rolls the minutes inside that row's range with its own dice and records basis banded, and a wrong handle is refused with the rows in details.options. Never give minutes or stated as well: that is refused. A road's time is the route's own and is never a band" }));
const DamageBand = Type.Optional(Type.String({ description: "instead of dice: the severity of harm with no attacker, by the handle of a rung of the rulebook's other-forms-of-damage ladder (Keeper Rulebook p.124); the kernel rolls that rung's dice and records basis banded, and a wrong handle is refused with the rungs in details.options. Never give dice or stated as well: that is refused" }));

const DamageEffect = Type.Object({
	...IntentResult,
	kind: StringEnum(["damage"] as const, { description: "harm outside ordinary weapon damage: a fall, fire, suffocation, an overdose, or the stated loss after a resolved check. A source-defined POW attack uses the existing opposed POW check, then resource pow if the target loses; never substitute an unarmed HP attack" }),
	resource: Type.Optional(StringEnum(['hp','pow'] as const, { description: "defaults to hp; use pow only when the applicable source rule explicitly removes POW. The kernel rolls the loss and changes that body's current characteristic, not HP or a caster's cost" })),
	dice: Type.Optional(Type.String({ description: "the damage dice from the rulebook, such as 1D6; the kernel rolls them. Required unless stated or band supplies them" })),
	stated: StatedAmount,
	band: DamageBand,
	subject: Type.Optional(Type.String({ description: "who is hurt: an investigator or an NPC who is in the scene; defaults to the current investigator. An NPC whose numbers the book never printed needs an archetype pinned first (npc.archetype); until someone has hit points, nothing that happens to them can be settled, healed or clocked — it is only prose" })),
	why: Type.Optional(Sentence("how they were hurt")),
});

const ClockEffect = Type.Object({
	kind: Type.Literal('clock'),
	local_datetime: Type.String({ description: "Pin the opening datetime once when the book gives no full date: YYYY-MM-DDTHH:MM, no timezone; preserve any declared start_time" }),
	why: Type.Optional(Sentence("why this opening date was chosen")),
});

const ActivityFields = {
    summary:Sentence('English account of current local activity, not a historical census'),
    basis:StringEnum(['observed','established','inferred'] as const,{description:'Observed or established local facts outrank an inferred routine; describe a supported actual transition with why'}),
    review_after_minutes:Type.Optional(Type.Integer({minimum:1,description:'Game minutes until this context should be reassessed, such as a known closing boundary; not a universal schedule'})),
};
const SceneEffect = Type.Object({
    kind:Type.Literal('scene'),
    name:Type.String({description:'Existing scene name or here; this changes context only, never movement, access, discovery or ownership'}),
    activity:Type.Object({...ActivityFields,
        service:Type.Optional(StringEnum(['open','closed','limited','unknown'] as const,{description:'Public service availability, separate from physical entry'})),
        crowd:Type.Optional(StringEnum(['empty','quiet','active','crowded','unknown'] as const,{description:'Plausible street/place activity at this local time; preserve era, land use and exceptions'})),
    }),
    why:Sentence('The local basis or cause of this contextual change'),
});

const TimeEffect = Type.Object({
	...IntentResult,
	kind: StringEnum(["time"] as const, { description: "the world clock moves forward for actual fictional activity, waiting or consequences. A pure OOC/reference question spends no world time, including to reconcile earlier prose; respect a current pause before continuing an earlier action. Never invent a historical clock correction. A move already advances the clock by its journey: never send time for the same journey; send time only for time that passes beyond it" }),
	stated: StatedAmount,
	band: TimeBand,
	// §218.9: how much of the band's row the kernel rolls in.
	band_reach: Type.Optional(StringEnum(["full", "typical", "least"] as const, { description: "only beside band: full (the default) rolls the whole row, typical rolls from its min to its default, least lands its min; for a reading of the act you are unsure of" })),
	// §145.1: the time the fiction reaches; the kernel counts the minutes from the clock.
	until: Type.Optional(Type.Object({
		days: Type.Optional(Type.Integer({ minimum: 0, description: "counted from the day this turn began: 0 = that day, 1 = the day after, and so on; left out, the next occurrence of the time at or after the clock (that day when not yet past, else the day after)" })),
		time: Type.String({ description: "the local 24-hour time the fiction reaches, HH:MM" }),
		either_half: Type.Optional(Type.Boolean({ description: "true when the time was named on a twelve-hour clock and nothing says which half of the day: give the twelve-hour reading (01:00-12:59, twelve o'clock as 12:MM) and no days; the kernel takes whichever of that time and twelve hours later the clock reaches first" })),
		journeys: Type.Optional(StringEnum(["before", "after"] as const, { description: "the player's order of this time against this turn's journeys: before when they travel first and the time is reached after arriving (a later move this turn is inside it and moves the clock no further), after when they travel after the time (the journeys already landed this turn are counted after it)" })),
	}, { description: "instead of minutes, for a skip to a time of day (the next morning, that evening): the kernel counts the minutes from the clock" })),
	minutes: Type.Optional(Type.Integer({ description: "required unless stated, band or until gives them: additional minutes for activity or waiting outside any journey, which its move already counts. Six hours or more is a day of rest and the party heals for it (1 HP a day with no major wound), an hour or more regenerates magic points; the result lists what came back in recovered, and your narration owes those numbers like any other change" })),
	why: Type.Optional(Sentence("where the time went")),
	// §237.102: compatibility metadata; explicit time is additional to a move's journey.
	beyond_travel: Type.Optional(Type.Boolean({ description: "Optional compatibility marker for additional activity outside travel. A move already counts its journey; do not repeat that journey as a time effect. Additional activity needs no marker." })),
	owed: OwedRef,
});

/** Things changing hands (contract §5 `item`, #19): what the narration gains or loses reaches the sheet here. */
const ItemEffect = Type.Object({
	...IntentResult,
	kind: StringEnum(["item"] as const, { description: "Change legacy equipment quantity: positive adds newly acquired units; negative removes lost or consumed units. Do not grant an already-owned item again for installation, repair, inspection or return after work. Record quantity-preserving facts in event, or use same-owner object.condition for a managed instance." }),
	name: Type.String({ description: "item name; weapons and rules-table entries use the name on the table" }),
	to: Type.Optional(Type.String({ description: "the investigator whose inventory quantity changes; defaults to the current investigator. This selects the inventory, not an ownership label to restate." })),
	from: Type.Optional(Type.String({ description: "source attribution for this quantity change: an NPC name. This records their part in an actual gain or loss; it does not debit their inventory or turn work on an already-owned item into a new acquisition." })),
	weapon: Type.Optional(
		Type.String({
			description:
				"when this thing is a weapon, the weapon profile name from the rules table (a .38 revolver, a shotgun, and so on); only then can the kernel read its damage, range and capacity, only then will a later resolve's weapon resolve it, and only then will combat set up its ammunition. When the table has no such profile the kernel reports needs and lists the available ones",
		}),
	),
	quantity: Type.Optional(Type.Integer({ description: "signed quantity delta, not the final total; omitted means +1 new unit. A negative number removes units (used up, handed over, taken away). Ownership unchanged during installation or repair needs no item delta." })),
	label: Type.Optional(Type.String({ description: "short name of this thing in the player's language; omitted means the item name" })),
	why: Type.Optional(Sentence("how it was gained, or how it was lost")),
});

const DefineEffect = Type.Object({
  kind: StringEnum(["define"] as const),
  name: Type.String({description:"Stable natural name of the new definition, in the campaign's play_language"}),
  category: Type.Optional(StringEnum(["weapon", "spell", "item"] as const, {description:"Defaults to item for a physical object; legacy weapon and spell definitions remain supported"})),
  description: Type.String({description:"Established appearance, function, era and constraints, in the campaign's play_language; the Mod agent derives executable parameters from these and presets"}),
  template: Type.Optional(Type.String({description:"Optional rulebook or existing definition to use as evidence"})),
});
const UsageEffect = Type.Object({
  kind: StringEnum(["usage"] as const),
  object: Type.String({description:"Existing held or same-batch staged physical instance name; inspect its usages with look first when it already exists, never duplicate or redefine the object"}),
  name: Type.String({description:"Natural usage name; reuse an accepted name for the same use and physical basis"}),
  description: Type.String({description:"Actual chosen use and established context; the creator derives parameters, never ask the player to supply numbers. In a batch with usage include only define/object/usage, wait for acceptance, then continue the original action with resolve"}),
});
const ObjectEffect = Type.Object({
  owed: OwedRef,
  kind: StringEnum(["object"] as const),
  adopt: Type.Optional(Type.String({description:"Exact existing unmanaged equipment name to enrich in place for the investigator in to; no from, no new acquisition, preserve quantity and state"})),
  name: Type.String({description:"Unique natural name of this physical instance, in the campaign's play_language; keep it when ownership changes"}),
  document: Type.Optional(Type.Union([
    Type.Object({text:Type.String({maxLength:64000,description:"Established readable text in the campaign's play_language, or empty for blank stationery; never undiscovered source truth"}),
      presentation:StringEnum(["paper","notebook","book"] as const)}),
    Type.Object({handout:Type.String({description:"Name of an already revealed handout; paper/notebook/book copies exact text, map/image captures its read-only original image. Only initialize an actually acquired carrier, never grant possession merely for showing an image"}),
      presentation:StringEnum(["paper","notebook","book","map","image"] as const)}),
    Type.Object({action:StringEnum(["write"] as const,{description:"Replace text on an existing writable carrier only. For a newly acquired note, omit action and supply initial document.text with its acquisition instead."}),text:Type.String({maxLength:64000,description:"The carrier's current text after this writing, in the campaign's play_language"})}),
    Type.Object({action:StringEnum(["append"] as const),text:Type.String({maxLength:64000,description:"Only the exact new suffix, including any desired leading newline; the kernel preserves all existing text. Use when adding writing without changing old content"})}),
    Type.Object({action:StringEnum(["open","close"] as const)}),
    Type.Object({action:StringEnum(["show"] as const),reader:Type.String({description:"The present person to whom the owner actually shows this writing; asking to inspect does not authorize showing"})}),
    Type.Object({action:StringEnum(["observe"] as const),reader:Type.String({description:"Person who actually read this writing after visibility, comprehension and any required check were established"}),
      access:StringEnum(["held","shown","glimpse"] as const),quote:Type.Optional(Type.String({maxLength:64000,description:"One exact unique visible passage; mandatory for a partial glimpse. The kernel captures its bytes, not a rewritten report"}))}),
    Type.Object({action:StringEnum(["requested_edit"] as const),method:StringEnum(["erase","cross_out","rewrite"] as const),
      implements:Type.Array(Type.String(),{minItems:1,maxItems:8,description:"Actual directly available carried implements; judge suitability from their physical facts and the scene"}),
      marks:Type.String({maxLength:2000,description:"Established physical appearance of the changed surface, in English; retain erasure/cross-out traces without inventing words"}),
      legibility:StringEnum(["legible","illegible","unknown"] as const,{description:"Whether overwritten writing remains visibly readable, from the actual method/outcome. Settle editing time before this operation"})}),
    Type.Object({action:StringEnum(["cancel_edit"] as const)}),
    Type.Object({action:StringEnum(["divide"] as const),
      part_text:Type.String({maxLength:64000,description:"Complete current text carried by the separated part after a document-bearing stack is divided, in the campaign's play_language"}),
      remainder_text:Type.String({maxLength:64000,description:"Complete current text carried by the original remainder after a document-bearing stack is divided, in the campaign's play_language"})}),
  ],{description:"Physical writing and reading. First acquisition: use an accepted definition (or define plus object in the same batch), and initialize with document.text and presentation; omit document.action. write/append modify an existing carrier only. Use the same from/to owner for open, close, show, observe, write, append or requested_edit. NPC reading needs show plus observe with actual reader and exact visible quote before narration; a glimpse requires an open surface and its actual quote. Initialize a carrier once; divide text atomically with its physical stack. Acquisition originals are retained"})),
  definition: Type.Optional(Type.String({description:"Accepted definition name when first placing the instance"})),
  source_object: Type.Optional(Type.String({description:"On first placement/adoption only: exact source_object handle supplied by lookup module when this is that authored physical thing. Never infer it from a display name or a similar weapon; omit for ordinary objects. Transfers preserve its identity"})),
  to: Type.String({description:"New owner: investigator, NPC, scene or existing container instance; here means the current scene"}),
  condition: Type.Optional(StringEnum(["intact","damaged","jammed","broken"] as const, {description:"Initial condition, or an explicit existing-object state change with the same from/to owner and a causal why; ownership transfers preserve state"})),
  from: Type.Optional(Type.String({description:"Required actual current owner for any existing-instance transfer or physical document operation; reading/editing surface operations use that owner in both from and to. On a first placement that a person hands over, name that person here too, with its handover: the giver is recorded, and the action review reads them as the one acting"})),
  // Contract §88.5: the kernel requires `handover` the moment it is rebuilt, and this schema is read
  // once at server start. Rebuild without restarting and the Keeper is refused for a field its tool
  // does not declare, on every retry, on every table. These three ship with the kernel half or not at all.
  offer: Type.Optional(StringEnum(["made","accepted","declined"] as const, {description:"Holding a thing out is not giving it: made records that from is offering it to to and moves nothing, declined closes that and leaves it exactly where it was, accepted closes it and moves it. Use made whenever a check is about to decide whether they take it, then close it with the result"})),
  handover: Type.Optional(StringEnum(["given","taken","check"] as const, {description:"Required when this moves a thing between two different people: given when both sides were willing and no dice were asked, taken when one side's leave was neither sought nor needed, check when a roll already settled in this turn decided it"})),
  check: Type.Optional(Type.String({description:"With handover check, the call_id of a resolve already settled in this turn. It must have passed; a roll that has not settled yet cannot be named, so settle the check first or hold the thing out with offer made"})),
  // Contract §97.4: this field is the schema half of the division, and it ships first. The kernel is
  // rebuilt live while this schema is read once at server start, so a kernel without it refuses a
  // short quantity exactly as before, and a schema without the kernel sends a key the kernel ignores
  // and gets that same refusal. Neither direction closes a door, because every call this touches is
  // refused today.
  part: Type.Optional(Type.String({description:"Name for the portion that separates when only some of a stack moves, in the campaign's play_language: with quantity short of what the instance holds, that many become their own thing under this name and go to to, while the rest keep the old name and stay where they are. Use it for two of four photographs left in a drawer, a handful of cartridges given away, one of a bundle set down. When the stack has readable text, also send document action divide with the complete part_text and remainder_text; leave part out to move the whole stack"})),
  quantity: Type.Optional(Type.Integer({minimum:1})),
  why: Type.Optional(Sentence()),
});
const AbilityEffect = Type.Object({
  kind: StringEnum(["ability"] as const), name: Type.String(), to: Type.String(),
  source: Type.String({description:"Established source of an NPC's spell knowledge; investigators learn through resolve"}),
  why: Type.Optional(Sentence()),
});

/** One unit price, with a precise decimal spelling for provider tool generation. Numbers remain a compatibility input. */
const UnitPrice=Type.String({pattern:'^[0-9]+(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$',minLength:1,maxLength:100,
    description:'Use an exact decimal STRING in the purse currency, e.g. "0.55" for fifty-five cents, never "0" for a covered purchase. This is the actual merchandise unit price, not the cash debit. Supply this price once; speech references the bill'});
const PricedLine=Type.Object({name:Type.String(),quantity:Type.Number({exclusiveMinimum:0}),unit_price:UnitPrice});

/** A priced transaction (contract §5 `cash`, #19; §58 source and Spending Level settlement). */
const QuotationDrafts = Type.Optional(Type.Array(Type.Object({
    quote: Type.String({maxLength:200,description:"offer name reused on acceptance and in {{price:NAME:unit}}, {{price:NAME:quantity}}, {{price:NAME:total}} speech references; submit prices once"}),
    category: StringEnum(["living","purchase"] as const),
    items: Type.Array(PricedLine,{minItems:1,maxItems:24}),
    subject: Type.Optional(Type.String({description:"omit for one investigator; otherwise use their exact capsule name/id"})),
    with: Type.Optional(Type.String({description:"seller name/role; required unless source price"})),
    source: Type.Optional(StringEnum(["quote","price"] as const)),
    price_id: Type.Optional(Type.String()),
    currency: Type.Optional(Type.String({description:"omit for the held cash currency; never translate its code"})),
    why: Type.Optional(Sentence("brief player-visible quotation purpose in play_language")),
}),{maxItems:8,description:"Offers only. Write closing prose first, then these priced lines in the same call. Background registration computes totals and updates the card after delivery. No payment or item transfer"}));

// Both delivery schemas carry the same bounded drafts; describe their fields once in narrate. Spreading the optional
// schema keeps its shape but not its optional mark, and `Type.Object` then lists the property as required: every
// apply without quotes -- the clerk's move, the Keeper's ordinary write -- failed validation ("quotes: must have
// required properties quotes"), 35 loop tests on 2026-10-02. Type.Optional restores the mark.
const EmbeddedQuotationDrafts = Type.Optional({
    ...QuotationDrafts,
    description: "Background offers only; the same fields as narrate.quotes",
    items: {...QuotationDrafts.items, properties: Object.fromEntries(Object.entries(QuotationDrafts.items.properties).map(([name,schema])=>{
        const {description:_description,...fields}=schema as TSchema & {description?:string};
        return [name,fields];
    }))},
} as unknown as typeof QuotationDrafts);

const CashEffect = Type.Object({
	owed: OwedRef,
	...IntentResult,
	kind: StringEnum(["cash"] as const, { description: "record an exact itemized quote, settle a chosen purchase under the living-standard/daily-spending rules, or transfer actual cash" }),
	bill: Type.Optional(Type.String({maxLength:200,description:"local bill name for price references in closing prose: {{price:NAME:unit}}, {{price:NAME:quantity}}, {{price:NAME:total}}. Multi-line bills use {{price:NAME:1:unit}}. Supply items once; never write a second price in prose. This is not a saved quote name. Write effects before embedded narrate for early bound price display"})),
	mode: Type.Optional(StringEnum(["quote", "settle", "cancel"] as const, {description:"settle (default) completes a chosen expense. quote registers an unchosen offer synchronously; prefer narrate.quotes for ordinary offers so prose does not wait. cancel withdraws a pending bill or unaccepted quote only when the player cancelled it; give its bill or quote name, omit amount/items, and do not deliver its goods. It never reverses a payment. Quoting does not pay or transfer items"})),
	quote: Type.Optional(Type.String({maxLength:200,description:"human-readable offer name. With mode quote this names the offer being registered; with settle it reuses that saved offer's exact terms and computed amount once. Always omit items when settling a saved quote. Omit delta/source/category/with/currency too, or supply only unchanged values"})),
	category: Type.Optional(StringEnum(["living", "purchase", "transfer"] as const, {description:"required for a negative price/quote: living is ordinary accommodation, food or incidental travel within the investigator's living standard; purchase is additional daily spending, including an incidental gratuity when appropriate; transfer is actual non-purchase cash movement. Refundable deposits/holds and their returns are transfers, including itemized quotes: actual cash leaves and returns without consumption coverage. Make the contextual judgement, never use the purchase amount alone to classify it. The kernel chooses whether any cash is debited"})),
	items: Type.Optional(Type.Array(PricedLine,{minItems:1,maxItems:24,description:"quoted priced lines; write unit_price as an exact decimal string. The kernel multiplies quantity by unit_price and sums exactly. Omit delta to use that total. A saved quote already contains its lines"})),
	subject: Type.Optional(Type.String({ description: "whose cash balance changes; defaults to the current investigator. Interpret delta from this person's purse, not from the counterparty's perspective" })),
	stated: StatedAmount,
	delta: Type.Optional(Type.Number({ description: "signed finite change to subject's cash balance: positive means subject receives money; negative means subject pays or returns money. First identify the giver and recipient. Returning an advance to its payer is negative; receiving a refund from a merchant is positive. A direct purchase is negative. Omit when items, a saved quote or stated provides it. A supplied purchase delta must equal the negative computed line total. Purchase input is its price, while the receipt delta is the actual cash movement after coverage and daily aggregation" })),
	source: Type.Optional(StringEnum(["price", "quote", "found"] as const, { description: "required unless stated gives the amount, which is then a quote: where the amount came from, before you say how much. price: the rulebook prints this price — give its price_id, and run lookup kind=catalog kinds=[\"item\"] for the thing being bought if you do not have one. quote: someone in the fiction named this amount — name them in `with`. found: no price is involved (found, stolen, wages, a gift, a debt settled); this does not mean income and permits either cash direction. A figure the player said about their own purse is a balance, not a price: the capsule tells you the balance, so charge what the thing is worth, not what they have" })),
	settlement: Type.Optional(StringEnum(["cash", "spending_level"] as const, { description: "legacy assertion; normally omit it. The kernel applies living-standard coverage and the cumulative daily Spending Level automatically. cash cannot debit a covered purchase; spending_level refuses a daily total over the limit. Always obtain the player's choice of the item/service; a cash commitment still requires accepted terms or applicable delegation" })),
	price_id: Type.Optional(Type.String({ description: "required with source price: the price_id of the printed record you are charging, exactly as lookup kind=catalog returned it. An invented one is refused" })),
	currency: Type.Optional(Type.String({ description: "the unit this amount is counted in, when the fiction named one. It must be the unit the balance is held in — the kernel does not convert between units. If a price was quoted in another currency, settle the exchange in the fiction and record what actually left the purse" })),
	with: Type.Optional(Type.String({ description: "the other party, who pays subject for a positive delta or receives subject's money for a negative delta; naming them does not determine the sign. Use a known NPC name or a player-visible name/role for a one-off counterparty such as a counter clerk. This label records the transaction without creating an NPC profile; registered people keep their canonical identity" })),
	why: Type.Optional(Sentence("brief player-visible payment purpose in the campaign's play_language: what was paid for, or where received money came from. This is shown on its cash card; omit private motives and internal reasoning")),
});

/** The Keeper's pacing instrument (contract §30.9): the book writes the clock, only this moves it. */
const ThreatEffect = Type.Object({
	...IntentResult,
	kind: StringEnum(["threat"] as const, { description: "advance a threat's clock: the danger has come one step closer because of what just happened; or start a clock of this table's own for a consequence the book never paced (mint)" }),
	name: Type.Optional(Type.String({ description: "the threat, as pressures names it; required unless stated names it. With mint: the name you give this table's new clock, the word you advance it by afterwards" })),
	stated: StatedAmount,
	clock: Type.Optional(Type.String({ description: "which of its clocks; only needed when the threat has more than one" })),
	segments: Type.Optional(Type.Integer({ description: "omitted means one segment forward; a negative number gives ground back. With mint: how far it starts advanced (default 1, 0 allowed)" })),
	mint: Type.Optional(Type.Literal(true, { description: "start a clock of this table's own: something set in motion that will land if it keeps being fed -- the neighbours who heard the fight, the telephone call someone made. Needs length and on_full; the book's own threats are advanced, never minted" })),
	length: Type.Optional(Type.Integer({ minimum: 2, maximum: 12, description: "with mint: how many segments until it lands" })),
	on_full: Type.Optional(Type.String({ description: "with mint: one Keeper-facing line saying what a full clock means (\"a patrolman comes up the stairs\")" })),
	why: Type.Optional(Sentence("what moved it")),
});

/** The Keeper's bookkeeping (contract §18, #27): world switches, debts owed, table rulings. */
const FlagEffect = Type.Object({
	...IntentResult,
	kind: StringEnum(["flag"] as const, { description: "set a world switch: something is now barred, lit, alarmed, opened" }),
	name: Type.Optional(Type.String({ description: "the switch's name; a name the book uses for a gate reads back on the exits that gate on it. Required unless stated names it" })),
	stated: StatedAmount,
	value: Type.Optional(Type.String({ description: 'omitted means true; "false" clears it; any other short string is kept as the switch\'s value' })),
	why: Type.Optional(Sentence("what set it")),
});

const NoteEffect = Type.Object({
	kind: StringEnum(["note"] as const, {
		description: "record continuity you owe the fiction later: a thread left hanging, someone waiting for an answer, a detail you must honour",
	}),
	name: Type.Optional(Type.String({ description: "a short name for a manual note; required when opening one with text, omitted when only closing an existing note" })),
	text: Type.Optional(Type.String({ description: "one sentence: what is owed. Required when opening a note" })),
	entities: Type.Optional(Type.Array(Type.String(), { description: "who or what it concerns; the capsule raises the note when they are present" })),
	closes: Type.Optional(Type.String({ description: "an exact manual open-note name from the capsule; give it alone to close, or with text to replace. Memory record IDs are not note names. Background memory maintenance owns remembered-plan status; do not close memory references through this effect" })),
});

/**
 * Contract §28.7: the table door for a package's own dossier words (`graph.vocabulary.table.v1`). The kernel writes the
 * value into the package's namespace, never the book, and refuses a word no active package contributes, a value the
 * source already gives and a lane-written word (`kernel-ts/mods/stage.ts`); a value is one line of at most 200 characters.
 * §180.9's `weaknesses` is a list of `{book, needs?}`.
 */
export const DOSSIER_VALUE_MAX = 200;
const DossierEffect = Type.Object({
	kind: StringEnum(["dossier"] as const, { description: "record, for a person or creature, a value of a package's word the book does not give, as the table established it" }),
	name: Type.String({ description: "the person or creature, by the name you already use" }),
	values: Type.Record(Type.String(), Type.Union([
		Type.String({ minLength: 1, maxLength: DOSSIER_VALUE_MAX, pattern: "\\S" }),
		Type.Array(Type.Object({ book: Type.String({ minLength: 1 }), needs: Type.Optional(Type.Array(Type.String())) }), { minItems: 1 }),
	]), { minProperties: 1, description: "the package's words (mods.vocabulary) and what the table established: one line each; weaknesses is a list of {book, needs?}" }),
	why: Type.Optional(Sentence("what in the fiction established it")),
});

const RulingEffect = Type.Object({
	kind: StringEnum(["ruling"] as const, {
		description: "record how you ruled something at this table, so the same judgement comes back to you next time it arises",
	}),
	name: Type.String({ description: "a short name for the ruling" }),
	statement: Type.String({ description: "one sentence: how you ruled" }),
	anchor: Type.Object(
		{
			family: Type.Optional(Type.String({ description: "a rule family this ruling governs, such as combat or social" })),
			decision: Type.Optional(Type.String({ description: "one decision's semantic name, such as combat:attack" })),
			skill: Type.Optional(Type.String({ description: "a skill name this ruling governs" })),
			entities: Type.Optional(Type.Array(Type.String(), { description: "the people or things it is about" })),
		},
		{
			description:
				"what brings the ruling back. Give at least one; every field you give must match for it to be raised again, so name only what the ruling really depends on",
		},
	),
	scope: Type.Optional(StringEnum(["campaign", "module", "scene"] as const, { description: "how far it reaches; defaults to campaign" })),
});

/**
 * Contract §161.5: the longest line `apply npc mood` takes, in characters. The kernel repeats the check
 * (`kernel-ts/npc/mood.ts` `MOOD_TEXT_LIMIT`), so a path that skips this schema still refuses.
 */
export const MOOD_MAX = 120;

/** A person moved on or off the stage, or where you read them as standing (contract §17.3). */
const NpcEffect = Type.Object({
    activity:Type.Optional(Type.Object({...ActivityFields,
        wakefulness:StringEnum(['awake','asleep','resting','unknown'] as const,{description:'Current ordinary activity, not a combat condition. A routine inference cannot erase an observed awakening. Standalone variant; other changes go in separate effects.'}),
    },{description:'Standalone temporal state. Record material waking or sleeping transitions, with this effect\'s why. Seat or move the person first, then record activity in a separate effect so it is stamped at their resulting place.'})),
	kind: StringEnum(["npc"] as const, { description: "move someone on or off the stage, set where they stand with the party, record a rules condition, record that they died, change how they defend, or what they do in a fight; report what they set out to do and how it went; or write what they feel right now (mood)" }),
	name: Type.String({ description: "for an existing NPC, use the exact supplied current view.id semantic handle; private refusal candidates[].name contains tool handles, while display_name is a display label. For someone genuinely new that the book never had, use what you are calling them, a description like \"the clerk at the archive window\" included, with walk_on. A person this table mints is named in play_language; apply person decides the word the player sees. Reuse the existing handle rather than creating another person under a display label" }),
	walk_on: Type.Optional(Type.Boolean({ description: "true only on the effect that brings in someone the book never had -- a porter called up the stairs, a passer-by, a constable arriving -- establishing them at this table under name. Anyone this table already has -- the book's people included, introduced or not -- needs none: write to them by name, with to: here to bring them in (walk_on on them is read as exactly that, their arrival). A word nobody here carries is refused without it, and the refusal hands back both calls ready to send" })),
	creature: Type.Optional(Type.Union([Type.String(), Type.Literal(true)], { description: "an animal or monster, not a person: a rules-catalog creature's name (lookup kind=catalog kinds=[\"creature\"]), whose stat block the kernel pins once, or true for one with no stat block yet. With walk_on it brings the creature in; alone it pins a block on a creature that has none, or completes a block that lacks what a fight reads (the refusal names what is missing; every number the block states is kept)" })),
	reunion: Type.Optional(Type.Object({
		background:Type.Optional(Type.Array(Type.String(),{maxItems:4})),
		reports:Type.Optional(Type.Array(Type.String(),{maxItems:4})),
		open_threads:Type.Optional(Type.Array(Type.String(),{maxItems:4})),
		extend:Type.Optional(Type.Boolean()),
	},{description:"At a real return encounter offered by the NPC view, establish a modest compatible offstage continuation without simulating it. Write English Keeper-facing background, this NPC's attributed reports and optional open threads, at most four lines of 600 characters each. Empty arrays establish a quiet interval. Preserve personality, prior facts and player decisions. This changes no location, item, money, skill, condition or promise fulfillment; use the proper effects for those. Same-interval history cannot be replaced; extend true appends only genuinely new compatible detail without copying old lines. Keep reunion alone in its NPC effect. A fully known reunion may share the final private record with public text; it needs no separate tool continuation. Narrate naturally in play_language."})),
	to: Type.Optional(Type.String({ description: "where they are now: a scene name, `here` for this scene, or `away` when that NPC actually leaves; the investigator leaving alone does not move the NPC from their existing place" })),
	stance: Type.Optional(StringEnum(["hostile", "wary", "neutral", "warm"] as const, {
		description: "your own reading of where they stand with the party; the kernel keeps the settled checks' account on its own, so set this only when you decide something the dice did not",
	})),
	skill: Type.Optional(Type.Object({
		name: Type.String({ description: "the skill, as the rulebook names it" }),
		value: Type.Integer({ description: "what they have, 0 to 100" }),
	}, {
		description: "a number the book never printed for this person. Books rarely give a minor NPC a skill list, so when one of them does something on the party's behalf — a doctor stitching a wound, a locksmith on a lock — say what they have and it is theirs for the rest of the campaign. Pin it once; every later roll uses it",
	})),
	archetype: Type.Optional(Type.String({
		description: "a stat block for a person the book never gave one, so that they can be fought, chased or resisted: name one of the rulebook's NPC stat archetypes (the refusal lists them in details.needs.options — ordinary_adult, capable_adult, dangerous_actor) from who this person is, and the kernel rolls characteristics and skills inside that archetype's ranges with the turn's dice, once, for the rest of the campaign. Refused for anyone whose numbers the book prints in full; a printed block that lacks what a fight reads is completed, every printed number kept. Read the book with lookup kind=source first when the module has one",
	})),
	dead: Type.Optional(Type.Boolean({
		description: "true on the turn they died. Say it for every death the dice did not settle — killed outside a fight, destroyed by a ruling, dead of what the story did to them — or the table goes on treating them as someone the party can still meet",
	})),
	conditions: Type.Optional(Type.Object({
		gained: Type.Optional(Type.Array(Type.String(), { description: "rules conditions that became true of this NPC because of the settled fiction" })),
		lost: Type.Optional(Type.Array(Type.String(), { description: "rules conditions that stopped being true of this NPC because of the settled fiction" })),
	}, {
		description: "an explicit non-damage condition change, such as unconscious from poison or roused after its cause ends. Use the condition names the rules and current state expose. This variant stands alone in one npc effect; combine it with movement using two effects in the same batch. Death still uses dead: true",
	})),
	defense: Type.Optional(StringEnum(["dodge", "fight_back", "none"] as const, {
		description: "how this person now defends when attacked, from here on: the fiction changed their tactic (cornered, protecting someone, too hurt to swing back). Without it they defend as the book says, or by the rules default (fight back when their Fighting is at least their Dodge, otherwise dodge); each pending defence shows it as standing. This variant stands alone in one npc effect and needs why",
	})),
	action: Type.Optional(StringEnum(["attack", "hold"] as const, {
		description: "what this person does on their own turn in a fight, when the fiction decides it: attack from here on, or hold (does not attack this round -- hesitates, yields; lapses when the round ends). Without it their turn follows session.standing_action (the book's word, or the disposition table). This variant stands alone in one npc effect and needs why",
	})),
	disposition: Type.Optional(StringEnum(["fights_to_the_end", "fights_then_flees", "avoids_fighting", "surrenders"] as const, {
		description: "how this person behaves in a fight, when the fiction has shown it: it replaces the book's; each of their turns then reads the disposition table against their wounds, the odds and their stance (session.standing_action). This variant stands alone in one npc effect and needs why",
	})),
	intends: Type.Optional(Type.String({
		description: "Use for a genuine undertaking whose outcome remains unresolved. Ordinary dialogue, questions, and a routine service completed by normal effects need no intention record. A new thing this person sets out to do, in one short sentence: what they try, not what they say (\"shout down the stairs for the porter\", \"back to the door and bolt\", \"offer the key back if he stops\"). Write it the turn they start or announce it; every later result names it by intent_ref. This variant stands alone in one npc effect, with outcome. When the table has already written this person's act this turn (their history.intents row by: table), write one only to overrule it, beside a second npc effect that names theirs by intent_ref with intent_outcome abandoned",
	})),
	intent_ref: Type.Optional(Type.String({
		description: "the ref of an intention (present[].history.intents, director.offer). With outcome and nothing else: this person's own intention, and its next result. Beside to, stance or another change: that change is the result of the intention named, which may be someone else's (the porter comes up because Knott shouted)",
	})),
	intent_outcome: Type.Optional(StringEnum(["attempted", "done", "failed", "abandoned"] as const, { description: "with intent_ref: where the named intention stands -- alone, as that intention's result; beside another change, after that change (default done)" })),
	spend_turn: Type.Optional(Type.Literal(true, {
		description: "in a fight, on this person's own turn: they spend the turn on what intends or intent_ref names instead of a fight action, and the initiative passes on. Without it a person who does something other than attack, manoeuvre, aim, reload or flee leaves the fight waiting on them. action: hold on their own turn passes it too",
	})),
	outcome: Type.Optional(StringEnum(["planned", "attempted", "done", "failed", "abandoned"] as const, {
		description: "planned holds an intention without beginning it or spending time/resources/a combat turn. attempted means under way; done/failed/abandoned are settled. A plan is reassessed, never automatically executed or owed by the next turn. Execute it with the ordinary action owner and intent_ref, or abandon it. An attempted action cannot become planned. A roll or another effect reports its actual result; a settled intention is not tried again",
	})),
	mood: Type.Optional(Type.String({
		maxLength: MOOD_MAX,
		description: `what this person feels right now, in the fiction, as you would put it: one short line in play_language, at most ${MOOD_MAX} characters, no line break (the heat, the hour, what just happened, what was just said or done to them, what is on their mind besides you). Their card's present[].now shows it from the next turn; write it when it is missing or no longer true, before they speak: it needs no result, so this apply may share a response with narrate handoff:true, apply first and handoff last. A new line replaces the old. This variant stands alone in one npc effect: moving or re-standing them is a second effect of the same batch`,
	})),
	why: Type.Optional(Sentence("required with activity: what caused the activity change (§208.1); otherwise why they moved, why they now stand there, how they died, what changed how they defend, or why they attack, hold back or fight the way they do")),
	owed: OwedRef,
});

/**
 * What this table calls a person (contract §79). A place has `world.scene_labels` and a clue has
 * `world.clue_labels`; this is the same record for a person, and the only one, so the cards, the
 * capsule and the prose stop each answering with a different word for one human being.
 */
const PersonEffect = Type.Object({
	...IntentResult,
	kind: StringEnum(["person"] as const, { description: "record what this table calls someone: the name it uses for them, or what they are called to their face" }),
	who: Type.String({ description: "the person this is about: an investigator at the table or an NPC. Their canonical book name or current on-stage label identifies them internally without telling that name to the player" }),
	name: Type.Optional(Type.String({ description: "what this table calls this NPC in the player's language, used consistently on cards and in later turns. An investigator already carries the player's chosen name on their sheet. For an untold NPC, a first complete printed name is staged until this turn's successful delivery actually introduces them: say it in an NPC's {{say:<who>}}...{{/say}} line, or use their say_name token where it is said or shown. names_pending_delivery means the current public label remains in use until that disclosure commits; it never limits internal identity references or prevents an independent clue from landing. Otherwise keep the name present[] gives them, or record an established distinctive epithet built from something they carry or wear, a mark, habit or job, never age, height, build or sex alone. Partial undisclosed names and a word someone else already carries remain refused. Write the registration before the final material handoff" })),
	address: Type.Optional(Type.String({ description: "what this person is called to their face, when the table has established one \u2014 the player corrected a form of address and you accepted it in the fiction, or someone earned a title in play. Record what was said and accepted, not your reading of what suits them. Everyone at the table then owes it, including someone who walks in later and has never been corrected" })),
	why: Type.Optional(Sentence("where this word came from; why does not itself prove that a name was disclosed. A first complete printed name is staged until this turn actually says or shows it in a successful delivery; names_pending_delivery lists such requests. Internal identity references remain usable before disclosure")),
});

/**
 * The world's line of history changing (contract §15.3, #23). None of the three happens
 * during the batch: the kernel performs it after this turn's output publication commits, so the
 * narration of the change is delivered first and the player's next line lands on the new
 * line. One per turn, last in the batch, and never with ask.
 */
const ForkEffect = Type.Object({
	kind: StringEnum(["fork"] as const, {
		description: "branch the worldline: if leaves the world as it stands, loop rewinds it to the module's anchor",
	}),
	name: Type.String({ description: "a short kebab name for the new line, e.g. loop-2 or without-the-key" }),
	mode: StringEnum(["if", "loop"] as const, {
		description:
			"if branches the line as it stands and plays on from here; loop rewinds to the anchor the book declared (the capsule's worldlines.loop_available says whether that is possible here) and starts the next circuit",
	}),
	from_turn: Type.Optional(
		Type.Integer({ description: "if only: branch from an earlier committed turn of this line instead of this one" }),
	),
	label: Type.Optional(Type.String({ description: "short name of this line in the player's language" })),
});

const SwitchEffect = Type.Object({
	kind: StringEnum(["switch"] as const, { description: "resume another worldline the campaign already has" }),
	line: Type.String({ description: "the line's name, from the capsule's worldlines.lines; a merged line cannot be resumed" }),
	label: Type.Optional(Type.String({ description: "short name of this line in the player's language" })),
});

const MergeEffect = Type.Object({
	kind: StringEnum(["merge"] as const, { description: "flow two or more worldlines together into a new one" }),
	name: Type.String({ description: "a short kebab name for the line they flow into" }),
	lines: Type.Array(Type.String(), {
		minItems: 2,
		description: "the lines flowing together; the line at the table must be one of them",
	}),
	into: Type.Optional(Type.String({ description: "the scene the merged world stands in; omitted means where the first line stands" })),
	dispositions: Type.Optional(
		Type.Record(
			Type.String(),
			Type.Object({
				mode: StringEnum(["from", "min", "max", "sum", "drop"] as const, {
					description: "how to settle this conflict; each conflict lists the modes its class allows",
				}),
				line: Type.Optional(Type.String({ description: "mode from: which line's value stands" })),
				note: Type.Optional(Type.String({ description: "mode drop: one sentence saying why it is gone. Required" })),
			}),
			{
				description:
					"how each conflict is settled, keyed by the conflict id. Call once without it: the kernel reports needs and lists every conflict with the modes it allows, and writes nothing; send them back with this and the merge lands",
			},
		),
	),
	label: Type.Optional(Type.String({ description: "short name of this line in the player's language" })),
});

const HandoutEffect = Type.Object({
	...IntentResult,
	kind: Type.Literal("handout"),
	name: Type.String({ description: "the name of a player-safe or revealable handout or image in the module graph" }),
	label: Type.Optional(Type.String({ description: "an optional player-facing title" })),
});

const MapEffect = Type.Object({
	kind: Type.Literal("map"),
	name: Type.String({ description: "the semantic name of a source-backed map" }),
	regions: Type.Array(Type.String({ description: "a semantic region name returned by look focus map" }), { minItems: 1 }),
	region_labels: Type.Record(Type.String(),Type.String({description:"every chosen region id's player-facing name in play_language"})),
	level_labels: Type.Record(Type.String(),Type.String({description:"every chosen source level name's player-facing name in play_language; use an empty object when none has a level"})),
	label: Type.String({ description: "the player-facing map title in play_language" }),
	why: Sentence("what established that the investigators know these regions"),
});

const ResolveAction = Type.Object({
    chase_roster: Type.Optional(Type.Array(Type.Object({
        actor: Type.String({description: 'Registered participant name, never an id.'}),
        role: StringEnum(['foot', 'driver', 'passenger'] as const),
        vehicle: Type.Optional(Type.String({description: 'Driver only: published vehicle profile name issued by the check catalog.'})),
        riding_with: Type.Optional(Type.String({description: 'Passenger only: the name of a driver in this roster.'})),
    }), {minItems: 2, maxItems: 16, description: 'Chase start mobility bindings. The host and Jev bind this roster; numbers and identifiers remain kernel-owned.'})),
	coercion: Type.Optional(Type.String({ description: "on a roll of an investigator a person present pressed (Charm, Fast Talk, Intimidate or Persuade; pressures lists it): the player refused to do what was wanted, so the coercer puts one penalty die on this roll. Name the pressure's receipt; each is spent once" })),
	surprise: Type.Optional(Type.Literal(true, { description: "with a person present as actor, intent combat and an investigator as target, when no fight is running: they strike the first blow, and the investigator did not see it coming (your ruling, usually after their Listen, Spot Hidden or Psychology). No dodge, no fighting back, one bonus die. Without it the investigator saw it coming and answers with a defence. The rounds then run in DEX order" })),
	intent_ref: Type.Optional(Type.String({ description: "when this roll is the result of what an NPC set out to do: the ref of that intention (present[].history.intents, director.offer). A passed check makes it done and a failed one failed, unless intent_outcome says otherwise; a settled intention is refused before any die is thrown" })),
	intent_outcome: Type.Optional(StringEnum(["attempted", "done", "failed", "abandoned"] as const, { description: "with intent_ref: where the intention stands after this roll, when the pass or failure alone does not say (a first step that leaves it under way)" })),
	actor: Type.Optional(
		Type.String({
			description:
				"the person performing the uncertain action, not its beneficiary or patient: for an NPC use the exact supplied current view.id semantic handle, also supplied as private refusal candidates[].name, when they help, haul, treat, guide, attack or defend, including outside combat. An investigator uses their registered name; target names the helped investigator or patient when applicable; omit only when the sole investigator performs the action",
		}),
	),
	intent: StringEnum(
		[
			"investigate",
			"social",
			"move",
			"combat",
			"flee",
			"cast",
			"idle",
			"meta",
			"stuck",
			"ambiguous",
			"montage",
		] as const,
		{ description: "which class this action belongs to; the kernel picks the rule family from it" },
	),
	goal: Type.String({ description: "For combat:maneuver, use exactly disarm, ongoing_disadvantage, escape or push, never a sentence; put the full physical intent in method. For other decisions, one sentence describing what the actor wants to achieve" }),
	method: Type.String({ description: "one sentence: how he does it; usually names a skill" }),
	target: Type.Optional(Type.String({ description: "against whom or what: an NPC name or an object name. For treatment it is the patient — First Aid or Medicine with an NPC here is settled on that NPC's hit points and conditions, not on the rescuer's" })),
	stakes: Type.Optional(Type.String({ description: "one sentence: what failure costs" })),
	modifiers: Type.Optional(
		Type.Object({
			bonus_dice: Type.Optional(
				Type.Integer({
					description:
						"0 to 2 bonus dice: how you say this attempt is favoured. Give one when the fiction genuinely helps the person doing it, two when the advantage is overwhelming — several of them at it together, a companion steadying the thing, a prepared tool, surprise, an opponent already busy fending someone else off are usual shapes of it, examples rather than a list to match against; you judge the situation. On a social attempt (charm, persuade, fast talk, intimidate) the die is what the player's own words earned: one when the story is specific, fits what this person wants or fears and gives them a reason; two when they already trust the speaker or the claim is backed by something they can see; none when 'I lie to him' has nothing behind it. difficulty only makes an attempt harder, so this is the only way to say it is easier, and an advantage you do not put here never reaches the dice",
				}),
			),
			penalty_dice: Type.Optional(
				Type.Integer({ description: "0 to 2 penalty dice: the situation works against the attempt (bad light, poor footing, a hurried try) without raising the difficulty" }),
			),
			difficulty: Type.Optional(StringEnum(["regular", "hard", "extreme"] as const)),
			reason: Type.Optional(Type.String({ description: "one clause: what in the fiction earned this modifier. Required on a social attempt whenever you give dice or raise the difficulty; it is written on the roll receipt and the player reads it there" })),
		}),
	),
	skill: Type.Optional(Type.String({ description: "an explicit skill or characteristic name for a check; takes precedence over inference from method. It does not override a combat attack weapon's skill or HP damage" })),
	weapon: Type.Optional(
		Type.String({
			description:
				"For combat:attack or combat:maneuver, select the held weapon from session.actions.weapons; bare hands is unarmed. Compatible alias for action.object when attacking. If object and weapon are both supplied they must identify the same physical object, otherwise the kernel refuses",
		}),
	),
	spell: Type.Optional(Type.String({ description: "spell name; give it when casting (intent cast) or when learning a spell from a tome" })),
  object: Type.Optional(Type.String({description:"Unified held physical instance name for an attack or objects:use/objects:repair; target names the attack target or consumable recipient. Attacks use this or the compatible weapon alias"})),
  usage: Type.Optional(Type.String({description:"Accepted attack usage name on this instance; required when several applicable usages exist. Reuse a suitable existing usage or prepare a missing one with apply usage before resolving; never changes the instance's identity"})),
	defense: Type.Optional(
		StringEnum(["dodge", "fight_back", "none"] as const, {
			description:
				"with an attack target and weapon, none resolves a non-resisting target in the same call; otherwise answers the pending defence from the previous result: dodge, fight back, or give up the defence; the host automatically resolves a live investigator defense using the campaign standing preference, so never ask the player for or repeat that defense; an NPC's defense is its pending_defense.standing, given together with actor, unless the fiction changed their tactic (then write apply npc defense)",
		}),
	),
	push: Type.Optional(
		Type.Boolean({ description: "invoke the active Pushed Roll Mod after the player's explicit declaration; it binds the previous failed action and draws its risk without another method or confirmation question" }),
	),
	push_context: Type.Optional(StringEnum(["same_goal", "goal_obsolete", "source_ambiguous", "judgment_unavailable"] as const, {
		description: "host-bound continuation judgment for the Pushed Roll Mod; the host selects this value from the canonical failed action and current situation",
	})),
	san_loss: Type.Optional(
		Type.String({
			description:
				"the loss expression for a sanity check, success/failure, such as 0/1D6; required when doing sanity:check at the sight of something horrible, and omissible when the target NPC's profile already declares it",
		}),
	),
	involuntary: Type.Optional(
		Type.String({
			description:
				"the out-of-control behaviour on a failed sanity check, one of five: faint, flee, scream, freeze, attack; required for sanity:check, and yours to pick from the situation",
		}),
	),
	// §221.8 / §221.4 / §222.3: arguments the host's check catalog binds (the bout of madness chosen for a SAN roll, the clue a
	// SAN roll or an Idea roll is about). The Keeper does not call resolve in the driven engine;
	// the host's own resolve goes through this same schema, so every key the catalog binds must be here.
	bout: Type.Optional(Type.String({ description: "with sanity:check: the bout of madness to use if this roll drives the investigator insane, or roll to roll the table" })),
	clue: Type.Optional(Type.String({ description: "with sanity:check, the filed clue whose stated loss this roll is for; with core-check:idea-roll, use a clue from needs.options or the current action catalog when one is offered; omit when no eligible clue is offered, so the same INT roll supports a connection from known facts without granting a new clue" })),
	// §224.7 (Enhanced Items, weapons.improvised.v1): the host's first blow with a held object whose own attack usage is not prepared yet: the weapons-table row it is rolled as.
	improvised: Type.Optional(Type.String({ description: "with combat:attack and weapon naming a held object: the weapons-table row (id) that object is rolled as, an improvised weapon (Keeper Rulebook p.104); set by the host where the Enhanced Items Mod is enabled" })),
	outcome: Type.Optional(
		StringEnum(["investigators_win", "monsters_win", "fled", "stalemate"] as const, {
			description: "give it when ending a combat: who won, who fled, or a stalemate",
		}),
	),
	skills: Type.Optional(
		Type.Array(Type.String(), { description: "the two or more skill or characteristic names used in a combined check" }),
	),
	mode: Type.Optional(StringEnum(["any", "all"] as const, { description: "a combined check passes on one, or needs them all" })),
	motive: Type.Optional(
		Type.Object({
			direction: StringEnum(["support", "neutral", "oppose"] as const, { description: "whether the NPC supports, is neutral to, or opposes this goal" }),
			intensity: Type.Optional(Type.Integer({ description: "0 to 2; higher is stronger" })),
		}, { description: "in a social adjudication, the NPC's leaning towards the player's goal; omitted counts as neutral" }),
	),
	support: Type.Optional(Type.String({ description: "the evidence the player puts on the table in a social adjudication: the name of a discovered clue" })),
	interrupted: Type.Optional(Type.Boolean({ description: "the casting was interrupted" })),
	rest: Type.Optional(
		Type.Object({
			complete_rest: Type.Optional(Type.Boolean()),
			poor_environment: Type.Optional(Type.Boolean()),
		}, { description: "the convalescence conditions for weekly major-wound recovery" }),
	),
	ending: Type.Optional(Type.String({ description: "the ending kind when closing a session; omitted counts as conclusion" })),
	scenario_san_reward_expr: Type.Optional(Type.String({ description: "source-authored SAN reward dice expression for development:end-session, after checking which conclusion rewards apply; the kernel rolls and caps it, never supply a calculated amount" })),
	luck: Type.Optional(Type.Integer({ description: "Luck points spent to revise the existing check result. Preserve that action's already settled elapsed time; do not perform or charge another observation or journey merely to realize its corrected outcome. Additional actions need a separate player choice." })),
	choice: Type.Optional(
		Type.Object({
			pending: Type.String({ description: "the pending choice name, from the previous turn's ask pending_choice" }),
			option: Type.String({ description: "the option the player picked" }),
		}),
	),
	decision: Type.Optional(Type.String({ description: "the existing rule decision you choose, including on the first call; also resolves needs_choice. For diagnosis, examination or observation without treatment, use core-check:ordinary-check with Medicine or First Aid as appropriate; healing decisions treat a patient and require their body state. The skill name alone does not mean treatment" })),
	rule: Type.Optional(
		Type.String({
			description:
				"a stated rule, hazard or tome the capsule's where.rules lists with a mech line, by its name: the kernel binds the check the book states (the skill among its approaches, its difficulty, its person, the hazard step), rolls it, and returns stated -- the level reached and the book's effects for that level as arguments you may apply with stated, or not. It applies none of them. With decision sanity:check it fills san_loss from the node's stated sanity loss instead. Leave it out to roll your own check: the book is reference",
		}),
	),
	step: Type.Optional(Type.Integer({ minimum: 0, description: "with rule naming a hazard: which of its steps to roll, from 0 (default 0); a result's next_step names the step the book says follows, and whether it happens is yours" })),
	obligation: Type.Optional(
		Type.String({
			description:
				"the handle of a scene obligation (the capsule's obligations of kind scene, their name) whose check this roll is: the kernel checks it is open here and its next step is a check, binds the skill among its approaches, its stated difficulty and its person, rolls the ordinary check, and on a settling level sets its flag in the same call; otherwise the result carries the book's line for you to realise or not. The kernel applies no consequence and no cost. An ordinary check without it, against the obligation's person with one of its approaches, counts as its attempt and the result says so (obligation.counted: folded); a push or Luck spend continues whatever the check it continues claimed",
		}),
	),
});

export const COC_TOOLS: readonly CocToolSpec[] = [
	{
		name: "look",
		label: "Look",
		method: "table.look",
		description:
			"See the side the turn capsule did not answer. The capsule already carries the current value of all of this: the world clock, the scene and its exits, the way back (the scenes walked through, nearest first), the clues here that are still undiscovered and how they are obtained, the agendas and secrets of those present, and what is pressing — do not look those up again, the capsule is current. Use this for what the capsule does not have: with no parameters it re-reads the scene (dramatic question, pressure moves, exits, affordances, who is present); focus npc with a name gives the Keeper view of an entity the capsule did not list (agenda, fear, secret, voice, relationships, known facts); focus investigator gives the detail of the investigator sheet; focus clues gives what is discovered and what is obtainable here; focus time gives the world clock; focus session gives the whole of a fight, a chase or a bout of madness that is underway — the round, whose turn it is, what may be done, what is owed — which is the one thing that survives a restart nowhere else. The opening turn has no capsule, so look at the opening scene first. Everything it returns is Keeper-only and must never be copied into the player's text.",
		promptSnippet: "See missing current evidence. For a document, object name plus document_query locates exact words; document_page reads bounded current pages for semantic questions. A 200-character preview never proves absence. For public evidence across earlier days, focus knowledge lists all acquired clues, revealed handouts and committed Keeper accounts. Follow its issued read or next arguments verbatim for bounded original text; scores are advice, incomplete previews never prove absence.",
		parameters: Type.Object({
			using_skill: UsingSkill,
			focus: Type.Optional(
				StringEnum(["scene", "npc", "investigator", "clues", "time", "session", "object", "map", "knowledge"] as const, {
					description: "which side to look at; defaults to scene",
				}),
			),
			name: Type.Optional(Type.String({ description: "The entity to look at when focus is npc, object, or map. For an NPC prefer its id from the current view, or an exact candidate name returned by an ambiguity error; use a display alias only when unique" })),
            knowledge_page: Type.Optional(Type.Object({offset:Type.Integer({minimum:0}),limit:Type.Integer({minimum:1,maximum:4096}),context:Type.Object({turn:Type.Integer(),view:Type.Integer(),line:Type.String(),loop:Type.Integer()})},{description:"Public knowledge only: issued catalogue or original-text continuation. Follow returned context and offset; stale reads require refreshing the catalogue"})),
            document_query: Type.Optional(Type.String({minLength:1,maxLength:256,description:"Object documents only: one exact case-sensitive literal to locate in ALL current readable writing, with original surrounding passages. No match means literal absence only; use document_page for a semantic question"})),
            document_page: Type.Optional(Type.Integer({minimum:1,description:"Object documents only: bounded current text page, or result page with document_query. Start at 1; follow the returned next call. Do not claim semantic absence from incomplete page coverage"})),
            document_revision: Type.Optional(Type.Integer({minimum:1,description:"Issued document revision; required after page 1. A changed revision needs fresh reading rather than an absence claim"})),
		}),
	},
	{
		name: "lookup",
		label: "Lookup",
		method: "table.lookup",
		description:
			"Search the module graph for what the capsule did not answer. The briefing for kind secret with scope scene — the clues in this scene still undiscovered, the secrets and agendas of those present, the Keeper's notes — is already in the capsule; do not look it up again. Use scope module only when you want the whole book's secrets and ending nodes. With kind module it finds entities on the graph by name or alias, at most 8 rows, each with a summary, visibility and relations. Say expected_kind when the role matters; only a missing scene advertises adaptation. A physical object uses define/object/item, while compatible scenery and a first-appearance supporting person may remain narration. Promote a recurring NPC only when persistent identity or sourced knowledge is needed. Adaptation is reserved for persistent graph topology, not ordinary detail. With kind catalog it searches the rulebook's own printed records — including the equipment and price lists, each row carrying its printed amount, currency and page provenance — so a price you are about to charge can come from the book rather than from the air; narrow it with kinds, and pass the returned price_id to apply cash (contract §58). With kind rule it searches the rule index. With kind support and one query, ask the configured Jev agent to retrieve and connect missing evidence across indexes; it returns keeper_support v1 with actual material, gaps and advisory check parameters. Use direct lookup/recall for simple known targets or when Jev is unavailable.",
		promptSnippet: "Look up module evidence, original source pages, rules, named-entity connections, support or missing capability detail. Provider-hosted historical search is offered separately by the host.",
		parameters: Type.Object({
			using_skill: UsingSkill,
			kind: StringEnum(["module", "source", "secret", "rule", "catalog", "continuity", "adaptation", "support", "capability"] as const, {
					description: "module searches known names; use expected_kind scene for a possible absent destination. continuity reads connections for one known entity name or named anchors; it does not search keywords or questions. adaptation prepare requires a purpose and drafts persistent source-connected graph topology; status is nonblocking, cancel stops it. source defaults to preparing graph material; source_mode answer checks one question against original pages without updating the graph. A module without an original document (a built-in starter) answers source with no_source_document: its authored graph, read through module and look, is its whole source",
			}),
			query: Type.Optional(Type.String({ description: "support: required evidence question, at most 2048 characters; use only kind and query. Jev follows read-only indexes and returns keeper_support v1 with material slots, actual evidence, gaps and advisory check suggestions bound to the player's current action. Partial is not proof of absence; ordinary resolve/apply still own authorization and settlement. module: one known name or alias, or exact issued handles separated by spaces; never combine several names, a location and a question into one search phrase. Reuse returned material and the capsule before searching again. rule/catalog: a name or search text. continuity: one known entity name or registered unique alias, never keywords or a question; omit when using anchors. For an evidence question use support. source: required entity name in query even when question is supplied; detail in question. Omissible for secret." })),
			expected_kind: Type.Optional(StringEnum(['scene', 'npc', 'clue', 'object', 'handout'] as const, {description: 'module only: the graph role being sought. Only an explicit scene miss may offer a new-destination adaptation'})),
			anchors: Type.Optional(Type.Array(Type.String(), {maxItems: 12, description: "continuity/adaptation: known entity, clue or conclusion names to connect; each entry must resolve as one registered name or unique alias, never a search phrase"})),
			kinds: Type.Optional(Type.Array(Type.String(), {maxItems: 8, description: "catalog only: which kinds of printed record to search — item for the equipment and price lists, and weapon, spell, creature, skill, vehicle, rule, artifact, tome, poison, occupation, phobia, mania, hazard. Omitted searches all of them"})),
			limit: Type.Optional(Type.Integer({minimum: 1, maximum: 12})),
			action: Type.Optional(StringEnum(["prepare", "status", "cancel"] as const)),
			name: Type.Optional(Type.String({description: "adaptation: a memorable proposal name, reused for status, cancel or acceptance"})),
			purpose: Type.Optional(StringEnum(['new_destination', 'persistent_npc', 'source_rebinding', 'handout', 'rebase'] as const, {description: 'required for adaptation prepare. Physical objects have no adaptation purpose, and neither does a supporting person you only need on stage -- apply npc with walk_on establishes them at the table with no proposal and no turn spent. persistent_npc is for someone who must persist as a source-connected figure'})),
			request: Type.Optional(Type.String({description: "adaptation: the player's actual direction and the source-connected change to prepare; never an instruction to force a player choice"})),
			rebase: Type.Optional(Type.Boolean({description: "prepare review of the latest source with the existing accepted adaptations, at a safe start of turn"})),
			source_mode: Type.Optional(StringEnum(['answer', 'prepare'] as const, {description: 'source only: prefer answer for a narrow Keeper factual consultation (requires question); it returns source evidence, not graph readiness or a player document-reading receipt. For a chosen physical reading, use the actual carrier with look object/document_page, or prepare the authored document and reveal its actual handout. Preserve ownership; source excerpts do not authorize inventing a player-owned document. It waits only a short allowance: past it the result is pending and the answer is carried to you once it lands; a focus this campaign already consulted answers from its memo at once. Use prepare for playable entities/rules, changes to accepted material or revealable assets. Omitted preserves prepare. Unresolved/conflicting answers are not facts and never authorize actions'})),
			material: Type.Optional(StringEnum(['map'] as const, {description: 'source prepare only: map image preparation or crop repair. Use material map to prepare actual original-PDF map assets rather than text excerpts or an ordinary place. Include a precise correction question and retry true to repair a failed map request'})),
			question: Type.Optional(Type.String({ description: "for source only: the precise original-page question; ordinary module queries do not start reading" })),
			answer_part: Type.Optional(Type.Integer({minimum: 0, description: "source answer only: the next fixed part issued by a partial cached answer. Preserve its focus and original question. Reads retained original material locally; missing or evicted parts do not start another source reading. Never combine with retry."})),
			retry: Type.Optional(Type.Boolean({ description: "explicitly retry a failed source reading (with source_mode answer, also read the book for your question past the campaign memo), or, with adaptation prepare, start a fresh attempt at a proposal that failed instead of receiving that same failure again" })),
			scope: Type.Optional(
				StringEnum(["scene", "module"] as const, { description: "the scope when kind is secret; defaults to scene" }),
			),
		}),
	},
	{
		name: "recall",
		label: "Recall",
		method: "table.recall",
		description:
			"Look back, three ways, always bounded: at most 12 KiB of JSON including metadata, 20 listing rows, and 4096 Unicode code points per text page; byte pressure may shorten a page further. memory: assertions extracted from past turns, ranked by those present and the investigators; narrow with about and kinds, including promise. These are conversation_report candidates, not module truth: retain status, state, correction and supersession/source annotations; an old belief or superseded statement is not a current fact. transcript: without read, cards only (turn, role, size, bounded original head and read reference), even for one-to-three-turn ranges; never automatic entries of full text. read returns one bounded original-text page, total characters, actual range, truncated and next. verified with verification_scope record_integrity_only means the complete original matches the canonical turn record before slicing, not that the statement is module truth. history: defaults to the latest 20 turns; the default section is diff if diff is supplied, events if types is supplied, otherwise timeline. Select other sections with page.section. Timeline keeps scene, clock, receipts and delivery head; events retain types filters; diff shows receipt-derived changes between two turns. Follow returned next, read or detail references as complete recall arguments, preserving their query filters. page uses a stable listing offset; detail reads one oversized structured row as bounded original JSON text pages, not a summary. A stale or unknown continuation requires the returned page-0 refresh, never reuse its old offset on changed sources. There is no all-text escape; follow pages to reconstruct an original. Use recall for earlier wording or threads; never invent an unavailable original.",
		promptSnippet: "Look back: memory assertions, verbatim transcript, history timeline",
		parameters: Type.Object({
			using_skill: UsingSkill,
			query: Type.Optional(Type.String({minLength: 1, maxLength: 2048, description: "memory only: optional semantic retrieval question when the typed memory host is enabled. It searches retained evidence and canonical context; never combine with read/detail or an unissued listing offset. Without query the existing direct recall behavior is unchanged."})),
			what: StringEnum(["transcript", "memory", "history"] as const, {
				description: "which way to look back: past assertions, verbatim text, or the timeline",
			}),
			turns: Type.Optional(
				Type.Array(Type.Integer(), {
					minItems: 2,
					maxItems: 2,
					description: "turn range [from, to]; transcript defaults to the last 3 turns, history to the last 20 turns",
				}),
			),
			role: Type.Optional(StringEnum(["player", "keeper"] as const, { description: "transcript: only one side's record" })),
			read: Type.Optional(
				Type.Object(
					{
						turn: Type.Integer({ description: "which turn" }),
						role: StringEnum(["player", "keeper"] as const, { description: "the player's words or the Keeper's delivery" }),
						offset: Type.Optional(Type.Integer({ minimum: 0, description: "Unicode code-point offset, defaults to 0" })),
						limit: Type.Optional(Type.Integer({ minimum: 1, description: "requested code points, defaults to and is capped at 4096; response bytes may reduce it" })),
					},
					{ description: "transcript: one bounded original-text page; without read, cards only, never implicit full entries" },
				),
			),
			page: Type.Optional(
				Type.Object({
					offset: Type.Optional(Type.Integer({ minimum: 0, description: "zero-based listing offset in this source snapshot, defaults to 0" })),
					limit: Type.Optional(Type.Integer({ minimum: 1, description: "requested listing rows, defaults to 20 and capped at 20; response bytes may reduce it; overrides memory limit" })),
					section: Type.Optional(StringEnum(["cards", "timeline", "events", "diff", "hits"] as const, {
						description: "transcript uses cards; memory uses hits; history defaults to diff if diff is supplied, events if types is supplied, otherwise timeline",
					})),
				}, { description: "bounded listing page; follow the complete next arguments returned by recall" }),
			),
			detail: Type.Optional(
				Type.Object({
					section: StringEnum(["cards", "timeline", "events", "diff", "hits"] as const),
					index: Type.Integer({ minimum: 0, description: "zero-based row index in the bound section; use the returned detail reference" }),
					offset: Type.Optional(Type.Integer({ minimum: 0, description: "Unicode code-point offset in the original row's JSON text, defaults to 0" })),
					limit: Type.Optional(Type.Integer({ minimum: 1, description: "requested code points, defaults to and is capped at 4096; response bytes may reduce it" })),
				}, { description: "one oversized structured row as bounded original JSON text pages, with total/range, truncated and next" }),
			),
			about: Type.Optional(
				Type.Array(Type.String(), {
					description: "memory: use one issued semantic handle per person, from a current view id or continuity anchor. Otherwise use one known unique name or registered unique alias. Do not add that person's display aliases as more entries: an ambiguous alias rejects the query even beside a unique full name. Never keywords or guessed truncations; defaults to those present plus investigators. Use query for a semantic question only when offered",
				}),
			),
			kinds: Type.Optional(
				Type.Array(
					StringEnum(
						[
							"world_event",
							"knowledge",
							"belief",
							"relationship",
							"promise",
							"player_assertion",
							"player_preference",
							"keeper_correction",
						] as const,
					),
					{ description: "memory: only these kinds of assertion" },
				),
			),
			include_superseded: Type.Optional(
				Type.Boolean({ description: "memory: include the old rows a later relation has closed out" }),
			),
			limit: Type.Optional(Type.Integer({ minimum: 1, description: "memory: requested page rows, defaults to 12, capped at 20; page.limit takes precedence" })),
			types: Type.Optional(
				Type.Array(
					StringEnum(
						[
							"turn-started",
							"player-declared",
							"roll-resolved",
							"semantic-event",
							"scene-moved",
							"clue-discovered",
							"time-advanced",
							"resource-changed",
							"purchase-settled",
							"decision-settled",
							"session-changed",
							"choice-asked",
							"memory-written",
							"turn-finalized",
						] as const,
					),
					{ description: "history: only these event types" },
				),
			),
			diff: Type.Optional(
				Type.Array(Type.Integer(), {
					minItems: 2,
					maxItems: 2,
					description: "history: what changed between two turns [from, to]",
				}),
			),
		}),
	},
	{
		name: "resolve",
		label: "Resolve",
		method: "table.resolve",
		description:
			"Hand one action to the rules. Choose the applicable existing action.decision when known, including on the first call, and describe who acts, what they want to achieve, how, against whom and what is at stake. The kernel validates applicability, binds the target value and rolls, returning receipts, the success level, and possibly a session (combat, chase, sanity bout) and available continuations. You do not roll, do not compute, do not change numbers; do not use it for ordinary uncontested actions. An attack is intent combat plus target and weapon (bare hands is unarmed). When the kernel reports needs_choice it has already listed the candidates and when each applies: pick one, write it into action.decision, and call again. When it would have reported needs_choice but exactly one candidate matches the beat suggested by this turn's capsule, the kernel settles it for you and writes decision_source director into the result — that call already counted, so do not make a second one for it. If the pending defence in the result is the player's, use ask to hand dodge-or-fight-back back to him and settle it next turn with defense; if it is an NPC's, decide it yourself with actor and defense. A declared pushed roll is bound and settled through the active Pushed Roll Mod without another method or risk confirmation; to spend luck, give luck. When the fiction gives the person an edge — several of them at it together, a prepared approach, an opponent already occupied — say so with modifiers.bonus_dice; nothing else on the action carries an advantage to the dice, and difficulty only ever makes the attempt harder. On an attack the dice go to the attacker, on a defence to the defender. When it cannot recognise a skill the kernel reports needs with candidates: add skill and call again. With intent idle, meta, stuck or ambiguous it does not roll and only returns a judgement.",
		promptSnippet: "Roll one action against the rules; returns receipts, success level and session state",
		parameters: Type.Object({
			using_skill: UsingSkill,
			action: ResolveAction,
		}),
	},
	{
		name: "apply",
		label: "Apply",
		method: "table.apply",
		description:
			"When this interaction establishes a nonnumeric occurrence, changes what someone knows or changes a directed relationship, include event in this same apply. Separate private summary and actual recipients from permitted materials. New heard knowledge bound to speech awaits accepted output; an unexecuted NPC intention uses outcome planned. The background memory lane extracts reports and cannot replace this canonical write. Unchanged atmosphere needs no event. Land this turn's changes to the world: move walks to another scene, clue gives the investigator a clue, time advances the clock, clock pins the opening datetime once when the book gives no full date, damage hurts, item and cash change possessions, handout displays a document without taking a physical object or transferring ownership, and map reveals only named source-backed regions the investigators learned. NPC answers and unsolicited disclosures may give clues or show handouts; their contents need no separate player selection. Do not add an item effect merely because a handout is shown. Use look focus map to inspect semantic map and region names; map why states what established that knowledge. The whole batch is validated before anything is written, and one bad effect writes none of them. What happens in narration without an apply did not happen. Viewing an already delivered map is a UI action and changes nothing. Worldline changes take effect after the canonical publication commit. Optional delivery or legacy narrate prepares and checks material only after all effects land; neither starts an author nor publishes prose. Use narrate with handoff:true when ready to publish the checked material. " + INTENT_RESULT_EXPLAINED,
		promptSnippet: "Record established semantic changes with event, actor-specific knowledge and directed relationships; keep unexecuted NPC intentions planned. Land this turn's world changes: move, clue, time, handout, map, item, cash; apply clock pins the opening datetime once when the book gives no full date",
		parameters: Type.Object({
			using_skill: UsingSkill,
			effects: Type.Array(
				Type.Union([EndingEffect, AdaptationEffect, MoveEffect, ClueEffect, ClockEffect,SceneEffect, TimeEffect, DamageEffect, ItemEffect, DefineEffect, UsageEffect, ObjectEffect, AbilityEffect, CashEffect, FlagEffect, NoteEffect, RulingEffect, DossierEffect, NpcEffect, PersonEffect, ThreatEffect, ForkEffect, SwitchEffect, MergeEffect, HandoutEffect, MapEffect]),
				{ minItems: 0, description: "the changes to land this turn, in order; empty only for a meaningful semantic event" },
			),
			event:Type.Optional(TurnEvent),
			delivery: Type.Optional(CarriedDelivery),
			narrate: Type.Optional(Type.String({ description: withPlainProse("Legacy untrusted draft material to prepare/check after effects land; never published by apply. Use narrate handoff:true to submit the checked material for final expression. If an effect is refused, already settled effects still stand") })),
			quotes: EmbeddedQuotationDrafts,
		}),
	},
	{
		name: "ask",
		label: "Ask",
		method: "table.ask",
		description:
			"Close with a structured interaction only for a required mechanical decision. Ordinary story questions belong in final prose and await free input. kind mechanics forbids a prompt and uses only closed action identifiers: push, spend_luck, accept, flee. Investigator combat defense is automatic under the campaign standing preference, never an ask; an NPC's defense is a resolve with its pending_defense.standing. Never automatically ask how to handle a failed check; normally submit its fictional consequence through narrate handoff:true. Questions and options are JSON for frontend controls, never part of rendered prose. Optional text or delivery prepares/checks private material only; no author or prose publication runs here. Use narrate handoff:true with choice for an authored preface and the same canonical mechanical choice. After closing a mechanical choice write no more story prose.",
		promptSnippet: "Hand one choice back to the player, and close the turn with it",
		parameters: Type.Object({
            delivery: Type.Optional(CarriedDelivery),
			handoff:Type.Optional(Type.Boolean({description:'With a fictional preface, submit it to the final-expression phase before publishing this same mechanical choice.'})),
			using_skill: UsingSkill,
			text: Type.Optional(
				Type.String({
					description: withPlainProse(
						"Fiction and observable consequences only, in the campaign's play_language. No roll results, numbers from receipts, or mechanical questions.",
					),
				}),
			),
			kind: Type.Literal("mechanics"),

			options: Type.Array(Type.String(), { minItems: 2, description: "Mechanics: only push, spend_luck, accept, flee. Never ask for combat defense: the host uses the investigator's standing preference, and an NPC defends by its pending_defense.standing. Never automatically ask after a failed roll." }),
			binds: Type.Optional(Type.String({ description: "For a cash confirmation, the exact formal quotation name from cash recovery, with options accept/flee; never an earlier ask name. Other mechanics use their actual pending rule choice. Missing or mismatched held-cash bindings are refused before a new choice is created." })),
			quotes: QuotationDrafts,
			workpad_patch: WorkpadPatch,
		}),
	},
	{
        name: "narrate", label: "Check materials", method: "table.delivery.check",
        description: "Validate and prepare a fictional material plan. You may check and revise it repeatedly. No prose author, player publication, turn close, Git commit or memory promotion runs here. Call output explicitly if you want final story text. Only in-fiction events, scene/character portrayal and NPC speech belong in delivery. Exclude rules explanations, tool/process commentary and OOC answers from every material and presentation preference. For mixed input, place the direct OOC reply in a closed {{ooc}}...{{/ooc}} span beside the tool call; only story material goes to output.",
        promptSnippet: "Check materials privately; never publish",
        parameters: Type.Object({delivery: Type.Optional(Delivery), handoff:Type.Optional(Type.Boolean({description:'True submits the final checked material to this run\'s final-expression phase after this tool returns. Omit or false only checks. Finish all world effects first.'})),
            choice:Type.Optional(Type.Object({kind:Type.Literal('mechanics'),options:Type.Array(Type.String(),{minItems:2}),binds:Type.Optional(Type.String({description:'For cash confirmation use the exact formal quotation name from recovery, never an earlier ask name; other mechanics use their pending rule choice.'}))})),
            quotes:QuotationDrafts,workpad_patch:WorkpadPatch,
            text: Type.Optional(Type.String({deprecated:true,description:withPlainProse("Legacy draft to check as untrusted material; never published here.")})), using_skill: UsingSkill},
            {anyOf:[{type:"object",required:["delivery"]},{type:"object",required:["text"]},{type:"object",required:["handoff"],properties:{handoff:{const:true}}}]}),
    },
    {
        name: "output", label: "Final output", method: "table.narrate",
        description: "OPTIONAL: explicitly author and publish this turn's story once from prepared materials. Supply delivery or reuse the last checked plan for this input. No preceding check call is required. Only this tool starts the final author. Legacy text is untrusted material and always goes through that author. This artifact contains in-fiction story only. OOC replies, rules explanations and system commentary stay in direct assistant text, never in delivery materials or presentation. On mixed input emit a closed {{ooc}}...{{/ooc}} span beside this call for the direct explanation. Supplied choice preserves existing mechanics options. After successful publication write no more story prose.",
        promptSnippet: "Optionally author and publish one final story artifact",
        parameters: Type.Object({delivery:Type.Optional(CarriedDelivery), text:Type.Optional(Type.String({maxLength:32000,deprecated:true,description:withPlainProse("Legacy untrusted draft material, never directly published.")})),
            choice:Type.Optional(Type.Object({kind:Type.Literal("mechanics"),options:Type.Array(Type.String(),{minItems:2}),binds:Type.Optional(Type.String({description:'For cash confirmation use the exact formal quotation name from recovery, never an earlier ask name; other mechanics use their pending rule choice.'}))})),
            quotes:QuotationDrafts,workpad_patch:WorkpadPatch,using_skill:UsingSkill}),
    },
];
