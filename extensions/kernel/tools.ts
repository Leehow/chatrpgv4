/**
 * The seven verbs the Keeper sees. Parameters mirror docs/kernel-rpc.md §5,
 * except `campaign` and `call_id`, which the extension fills in: the model
 * neither sees nor writes them.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { type TSchema, Type } from "typebox";

export const COC_TOOL_NAMES = ["look", "lookup", "recall", "resolve", "apply", "ask", "narrate"] as const;
export type CocToolName = (typeof COC_TOOL_NAMES)[number];

/** State-changing calls: they mint a `call_id`, and they are refused once the turn is closed. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(["resolve", "apply", "ask", "narrate"]);

export interface CocToolSpec {
	name: CocToolName;
	label: string;
	method: string;
	description: string;
	promptSnippet: string;
	parameters: TSchema;
}

const EndingEffect = Type.Object({
    kind: StringEnum(["ending"] as const),
    scope: StringEnum(["chapter", "campaign"] as const, { description: "chapter leaves the same campaign playable; campaign is only the final end of the entire adventure, never a pause or a chapter boundary. For an incorrectly completed legacy chapter, scope chapter reclassifies the existing ending without repeating its accounting; narrate commits the correction before continuing" }),
    summary: Type.String({ description: "the ending reached; read source rewards and resolve development:end-session first. An already-accounted legacy correction retains the original summary, turn and rewards. Narrate commits this effect" }),
});

const MoveEffect = Type.Object({
	kind: StringEnum(["move"] as const, { description: "walk to another scene" }),
	to: Type.String({ description: "destination scene name; must be one of the exits reachable from the current scene. Naming the scene they are already in is a rename, not a move: pass label with it and nothing else happens" }),
	travel_minutes: Type.Optional(Type.Integer({ description: "minutes spent on the way; omitted means the value on the graph edge" })),
	via: Type.Optional(Type.String({ description: "how they got there when the way is not one of the exits you were given — through an unlatched upper window, down a coal chute, following someone in. Say it and the move lands; without it an unlisted destination is refused, and then the world stays where it was while your narration moves on" })),
	label: Type.Optional(Type.String({ description: "short name of the destination in the player's language; omitted means the scene name. It becomes that scene's name from then on, so pass to = the scene underfoot with a label once at the start to name the place the party opens in" })),
});

const ClueEffect = Type.Object({
	kind: StringEnum(["clue"] as const, { description: "the investigator obtains one clue" }),
	clue: Type.String({
		description:
			"clue name; must be a clue obtainable in the current scene. An echo id from the capsule's worldlines.echoes (it starts with echo:) reveals what another worldline left standing here — you decide whether to show it and how to tell it, never what it says",
	}),
	how: Type.Optional(Type.String({ description: "one sentence: how they got it" })),
	from: Type.Optional(Type.String({ description: "the NPC who handed it over, when someone did; it goes on their ledger as something they disclosed" })),
	label: Type.Optional(Type.String({ description: "short name of this clue in the player's language; omitted means the clue name" })),
});

const DamageEffect = Type.Object({
	kind: StringEnum(["damage"] as const, { description: "damage with no attacker: a fall, fire, a falling object, suffocation" }),
	dice: Type.String({ description: "the damage dice from the rulebook, such as 1D6; the kernel rolls them" }),
	subject: Type.Optional(Type.String({ description: "who is hurt; defaults to the current investigator" })),
	why: Type.Optional(Type.String({ description: "one sentence: how they were hurt" })),
});

const TimeEffect = Type.Object({
	kind: StringEnum(["time"] as const, { description: "the world clock moves forward" }),
	minutes: Type.Integer({ description: "minutes advanced. Six hours or more is a day of rest and the party heals for it (1 HP a day with no major wound), an hour or more regenerates magic points; the result lists what came back in recovered, and your narration owes those numbers like any other change" }),
	why: Type.Optional(Type.String({ description: "one sentence: where the time went" })),
});

/** Things changing hands (contract §5 `item`, #19): what the narration gains or loses reaches the sheet here. */
const ItemEffect = Type.Object({
	kind: StringEnum(["item"] as const, { description: "something changes hands: gained, handed over, used up, taken away" }),
	name: Type.String({ description: "item name; weapons and rules-table entries use the name on the table" }),
	to: Type.Optional(Type.String({ description: "who ends up with it; defaults to the current investigator" })),
	from: Type.Optional(Type.String({ description: "who it came from: an NPC name. Name them whenever a person hands the thing over, sells it, or loses it — that is what puts the exchange on their account, and you are told it again the next time they are in the room" })),
	weapon: Type.Optional(
		Type.String({
			description:
				"when this thing is a weapon, the weapon profile name from the rules table (a .38 revolver, a shotgun, and so on); only then can the kernel read its damage, range and capacity, only then will a later resolve's weapon resolve it, and only then will combat set up its ammunition. When the table has no such profile the kernel reports needs and lists the available ones",
		}),
	),
	quantity: Type.Optional(Type.Integer({ description: "quantity, default 1; a negative number is a loss (used up, handed over, taken away)" })),
	label: Type.Optional(Type.String({ description: "short name of this thing in the player's language; omitted means the item name" })),
	why: Type.Optional(Type.String({ description: "one sentence: how it was gained, or how it was lost" })),
});

/** Cash going up or down (contract §5 `cash`, #19): writes finance.cash on the investigator sheet. */
const CashEffect = Type.Object({
	kind: StringEnum(["cash"] as const, { description: "the money in hand goes up or down" }),
	subject: Type.Optional(Type.String({ description: "whose money; defaults to the current investigator" })),
	delta: Type.Integer({ description: "signed change, in the currency of the era; spent is negative, received is positive" }),
	with: Type.Optional(Type.String({ description: "the person on the other side of it: an NPC name. Name them whenever money is paid to or taken from someone — that is what puts it on their account, and you are told it again the next time they are in the room" })),
	why: Type.Optional(Type.String({ description: "one sentence: where the money went, or where it came from" })),
});

/** The Keeper's bookkeeping (contract §18, #27): world switches, debts owed, table rulings. */
const FlagEffect = Type.Object({
	kind: StringEnum(["flag"] as const, { description: "set a world switch: something is now barred, lit, alarmed, opened" }),
	name: Type.String({ description: "the switch's name; a name the book uses for a gate reads back on the exits that gate on it" }),
	value: Type.Optional(Type.String({ description: 'omitted means true; "false" clears it; any other short string is kept as the switch\'s value' })),
	why: Type.Optional(Type.String({ description: "one sentence: what set it" })),
});

const NoteEffect = Type.Object({
	kind: StringEnum(["note"] as const, {
		description: "record continuity you owe the fiction later: a thread left hanging, someone waiting for an answer, a detail you must honour",
	}),
	name: Type.String({ description: "a short name for this debt; you close it later by this name" }),
	text: Type.Optional(Type.String({ description: "one sentence: what is owed. Required when opening a note" })),
	entities: Type.Optional(Type.Array(Type.String(), { description: "who or what it concerns; the capsule raises the note when they are present" })),
	closes: Type.Optional(Type.String({ description: "the name of an open note this settles; give it alone to close, or with text to replace" })),
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

/** A person moved on or off the stage, or where you read them as standing (contract §17.3). */
const NpcEffect = Type.Object({
	kind: StringEnum(["npc"] as const, { description: "move someone on or off the stage, set where they stand with the party, or record that they died" }),
	name: Type.String({ description: "the NPC's name" }),
	to: Type.Optional(Type.String({ description: "where they are now: a scene name, `here` for this scene, or `away` to take them off stage" })),
	stance: Type.Optional(StringEnum(["hostile", "wary", "neutral", "warm"] as const, {
		description: "your own reading of where they stand with the party; the kernel keeps the settled checks' account on its own, so set this only when you decide something the dice did not",
	})),
	skill: Type.Optional(Type.Object({
		name: Type.String({ description: "the skill, as the rulebook names it" }),
		value: Type.Integer({ description: "what they have, 0 to 100" }),
	}, {
		description: "a number the book never printed for this person. Books rarely give a minor NPC a skill list, so when one of them does something on the party's behalf — a doctor stitching a wound, a locksmith on a lock — say what they have and it is theirs for the rest of the campaign. Pin it once; every later roll uses it",
	})),
	dead: Type.Optional(Type.Boolean({
		description: "true on the turn they died. Say it for every death the dice did not settle — killed outside a fight, destroyed by a ruling, dead of what the story did to them — or the table goes on treating them as someone the party can still meet",
	})),
	why: Type.Optional(Type.String({ description: "one sentence: why they moved, why they now stand there, or how they died" })),
});

/**
 * The world's line of history changing (contract §15.3, #23). None of the three happens
 * during the batch: the kernel performs it after this turn's narrate commits, so the
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
	kind: Type.Literal("handout"),
	name: Type.String({ description: "the name of a player-safe or revealable handout or image in the module graph" }),
	label: Type.Optional(Type.String({ description: "an optional player-facing title" })),
});

const ResolveAction = Type.Object({
	actor: Type.Optional(
		Type.String({
			description:
				"the person performing the uncertain action, not its beneficiary or patient: name the NPC when they help, haul, treat, guide, attack or defend, including outside combat; target names the helped investigator or patient when applicable; omit only when the sole investigator performs the action",
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
	goal: Type.String({ description: "one sentence: what the player wants to achieve" }),
	method: Type.String({ description: "one sentence: how he does it; usually names a skill" }),
	target: Type.Optional(Type.String({ description: "against whom or what: an NPC name or an object name" })),
	stakes: Type.Optional(Type.String({ description: "one sentence: what failure costs" })),
	modifiers: Type.Optional(
		Type.Object({
			bonus_dice: Type.Optional(Type.Integer({ description: "number of bonus dice, 0 to 2" })),
			penalty_dice: Type.Optional(Type.Integer({ description: "number of penalty dice, 0 to 2" })),
			difficulty: Type.Optional(StringEnum(["regular", "hard", "extreme"] as const)),
		}),
	),
	skill: Type.Optional(Type.String({ description: "an explicit skill or characteristic name; takes precedence over inference from method" })),
	weapon: Type.Optional(
		Type.String({
			description:
				"the weapon used to attack, bare hands is unarmed; required when intent is combat, and without it the kernel reports needs and lists the weapons he carries",
		}),
	),
	spell: Type.Optional(Type.String({ description: "spell name; give it when casting (intent cast) or when learning a spell from a tome" })),
	defense: Type.Optional(
		StringEnum(["dodge", "fight_back", "none"] as const, {
			description:
				"with an attack target and weapon, none resolves a non-resisting target in the same call; otherwise answers the pending defence from the previous result: dodge, fight back, or give up the defence; ask the player for his own defence first, and decide an NPC's yourself together with actor",
		}),
	),
	push: Type.Optional(
		Type.Boolean({ description: "push the previous failed roll only after the player's explicit choice and an announced risk; changing the executor or method does not itself choose a push; when true, stakes states the announced consequence" }),
	),
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
	luck: Type.Optional(Type.Integer({ description: "luck points spent to turn a near-miss check into a pass" })),
	choice: Type.Optional(
		Type.Object({
			pending: Type.String({ description: "the pending choice name, from the previous turn's ask pending_choice" }),
			option: Type.String({ description: "the option the player picked" }),
		}),
	),
	decision: Type.Optional(Type.String({ description: "when the kernel reports needs_choice, the name of the candidate you pick" })),
});

export const COC_TOOLS: readonly CocToolSpec[] = [
	{
		name: "look",
		label: "Look",
		method: "table.look",
		description:
			"See the side the turn capsule did not answer. The capsule already carries the current value of all of this: the world clock, the scene and its exits, the way back (the scenes walked through, nearest first), the clues here that are still undiscovered and how they are obtained, the agendas and secrets of those present, and what is pressing — do not look those up again, the capsule is current. Use this for what the capsule does not have: with no parameters it re-reads the scene (dramatic question, pressure moves, exits, affordances, who is present); focus npc with a name gives the Keeper view of an entity the capsule did not list (agenda, fear, secret, voice, relationships, known facts); focus investigator gives the detail of the investigator sheet; focus clues gives what is discovered and what is obtainable here; focus time gives the world clock; focus session gives the whole of a fight, a chase or a bout of madness that is underway — the round, whose turn it is, what may be done, what is owed — which is the one thing that survives a restart nowhere else. The opening turn has no capsule, so look at the opening scene first. Everything it returns is Keeper-only and must never be copied into the player's text.",
		promptSnippet: "See the side the capsule did not answer: scene, NPC, investigator, clues, the clock, or the session underway",
		parameters: Type.Object({
			focus: Type.Optional(
				StringEnum(["scene", "npc", "investigator", "clues", "time", "session"] as const, {
					description: "which side to look at; defaults to scene",
				}),
			),
			name: Type.Optional(Type.String({ description: "the entity name to look at when focus is npc" })),
		}),
	},
	{
		name: "lookup",
		label: "Lookup",
		method: "table.lookup",
		description:
			"Search the module graph for what the capsule did not answer. The briefing for kind secret with scope scene — the clues in this scene still undiscovered, the secrets and agendas of those present, the Keeper's notes — is already in the capsule; do not look it up again. Use scope module only when you want the whole book's secrets and ending nodes. With kind module it finds entities on the graph by name or alias, at most 8 rows, each with a summary, visibility and relations: use it to confirm whether a name the player mentioned exists in this book. It matches the names and handles on the graph, so search with the module's own names or a name that appeared in the capsule; a translated keyword will not find anything. The kinds rule and catalog answer not_implemented in this slice.",
		promptSnippet: "Look up an entity the capsule did not answer, or the whole book's secrets and endings",
		parameters: Type.Object({
			kind: StringEnum(["module", "source", "secret", "rule", "catalog"] as const, {
				description: "module reads the compiled graph immediately; source without question prepares missing material or rejoins its reading; source with question explicitly rechecks original pages, even when material exists",
			}),
			query: Type.Optional(Type.String({ description: "a name or a question; omissible when kind is secret" })),
			question: Type.Optional(Type.String({ description: "for source only: the precise original-page question; ordinary module queries do not start reading" })),
			retry: Type.Optional(Type.Boolean({ description: "explicitly retry a failed source reading" })),
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
			"Look back, three ways. memory: assertions extracted from past turns; by default the ones about those present and the investigators, narrowed with about for other names and with kinds for the kind. Assertions are candidates: they may be stale, they may be only someone's belief, and believing them is your judgement. transcript: the verbatim record; without read it gives candidate cards (which turn, who spoke, the first 80 characters), and once you see the one you want, read pulls that passage out whole and tells you whether it matches the turn record. history: the timeline — each turn's scene, clock, receipt count and the opening of the delivery — with types for only certain event kinds, and diff to ask what actually changed between two turns. Use it when the player says \"just now\" or \"you said\", or when you pick up a thread from several turns back; never invent from memory something that already happened.",
		promptSnippet: "Look back: memory assertions, verbatim transcript, history timeline",
		parameters: Type.Object({
			what: StringEnum(["transcript", "memory", "history"] as const, {
				description: "which way to look back: past assertions, verbatim text, or the timeline",
			}),
			turns: Type.Optional(
				Type.Array(Type.Integer(), {
					minItems: 2,
					maxItems: 2,
					description: "turn range [from, to]; transcript defaults to the last 3 turns",
				}),
			),
			role: Type.Optional(StringEnum(["player", "keeper"] as const, { description: "transcript: only one side's record" })),
			read: Type.Optional(
				Type.Object(
					{
						turn: Type.Integer({ description: "which turn" }),
						role: StringEnum(["player", "keeper"] as const, { description: "the player's words or the Keeper's delivery" }),
					},
					{ description: "transcript: pull one side of one turn out whole; without it you only get candidate cards" },
				),
			),
			about: Type.Optional(
				Type.Array(Type.String(), {
					description: "memory: only the past about these names; defaults to those present plus the investigators",
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
			limit: Type.Optional(Type.Integer({ description: "memory: at most this many rows, capped at 30" })),
			types: Type.Optional(
				Type.Array(
					StringEnum(
						[
							"turn-started",
							"player-declared",
							"roll-resolved",
							"scene-moved",
							"clue-discovered",
							"time-advanced",
							"resource-changed",
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
			"Hand one action to the rules. You only describe the action; the kernel picks the rule: say who, what he wants to achieve, how he does it, against whom, what is at stake, and it chooses the decision, takes the target value and rolls, returning receipts, the success level, and possibly a session (combat, chase, sanity bout) and available continuations. You do not roll, do not compute, do not change numbers; do not use it for ordinary uncontested actions. An attack is intent combat plus target and weapon (bare hands is unarmed). When the kernel reports needs_choice it has already listed the candidates and when each applies: pick one, write it into decision, and call again. When it would have reported needs_choice but exactly one candidate matches the beat suggested by this turn's capsule, the kernel settles it for you and writes decision_source director into the result — that call already counted, so do not make a second one for it. If the pending defence in the result is the player's, use ask to hand dodge-or-fight-back back to him and settle it next turn with defense; if it is an NPC's, decide it yourself with actor and defense. To push a failed check, set push true and write into stakes what failing the push costs; to spend luck, give luck. When it cannot recognise a skill the kernel reports needs with candidates: add skill and call again. With intent idle, meta, stuck or ambiguous it does not roll and only returns a judgement.",
		promptSnippet: "Roll one action against the rules; returns receipts, success level and session state",
		parameters: Type.Object({
			action: ResolveAction,
		}),
	},
	{
		name: "apply",
		label: "Apply",
		method: "table.apply",
		description:
			"Land this turn's changes to the world: move walks to another scene (the result carries the destination scene, so no second look is needed), clue gives the investigator a clue, time advances the world clock, damage hurts the investigator with the rulebook's dice (a fall, fire, suffocation — harm with no attacker), item makes something change hands, cash makes money go up or down, handout delivers a prepared card or image by name. Use handout to give the player the existing original-page image; no transcription or source recheck is needed to deliver it. The whole batch is validated before anything is written, and one bad effect writes none of them, so you can list everything that happened this turn in one call. What happens in your narration without an apply did not happen: walking is a move, seeing is a clue, time spent is a time, something gained or handed over is an item, money in or out is a cash. Everything picked up, bought, taken away or used up is an item and reaches the investigator sheet; if it is a weapon, put the profile name from the rules table in weapon, or that gun will never fire later. Money spent, earned or paid out is a cash with a signed delta, and the kernel works out the before and after itself. Someone walking into or out of the scene is an npc with to (a scene name, here, or away) — until you land it, they are not in the room and cannot be targeted; npc also takes stance when you decide where someone stands with the party for a reason the dice did not settle. A destination may be an exit of the current scene or any scene on the way in (where.back lists them nearest first, which is how you back out of a lair with no exits); an unreachable one reports not_reachable with both lists, and a clue that is not here reports not_here. fork, switch and merge change which worldline the table is playing: none of them happens during the call — the kernel performs it after this turn's narrate commits, so you narrate the change first and the player's next line lands on the new line. At most one of the three per turn, it must be the last effect of the batch, and a turn that carries one cannot be closed with ask. A merge called without dispositions reports needs and lists every conflict with the modes its class allows, having written nothing; settle them and call again.",
		promptSnippet: "Land this turn's world changes: move, clue, time, handout, item, cash",
		parameters: Type.Object({
			effects: Type.Array(
				Type.Union([EndingEffect, MoveEffect, ClueEffect, TimeEffect, DamageEffect, ItemEffect, CashEffect, FlagEffect, NoteEffect, RulingEffect, NpcEffect, ForkEffect, SwitchEffect, MergeEffect, HandoutEffect]),
				{ minItems: 1, description: "the changes to land this turn, in the order they happened" },
			),
		}),
	},
	{
		name: "ask",
		label: "Ask",
		method: "table.ask",
		description:
			"Close with a structured interaction only when a player decision is needed. kind story uses a fictional prompt and authored options. kind mechanics forbids a prompt and uses only closed action identifiers: push, spend_luck, accept, dodge, fight_back, flee. Never automatically ask how to handle a failed check; normally narrate its fictional consequence. Questions and options are JSON for frontend controls, never part of rendered prose. text contains fiction only, and takes the same {{marker}} placement narrate does. After the call write no more prose.",
		promptSnippet: "Hand one choice back to the player, and close the turn with it",
		parameters: Type.Object({
			text: Type.Optional(
				Type.String({
					description:
						"Fiction and observable consequences only. No roll results, numbers from receipts, or mechanical questions.",
				}),
			),
			kind: Type.Optional(Type.Union([Type.Literal("story"), Type.Literal("mechanics")])),
            prompt: Type.Optional(Type.String({ description: "Only for story choices. Mechanics choices forbid a prompt." })),
			options: Type.Array(Type.String(), { minItems: 2, description: "Story: authored options. Mechanics: only push, spend_luck, accept, dodge, fight_back, flee. Never automatically ask after a failed roll." }),
			binds: Type.Optional(Type.String({ description: "the name of the pending choice this binds to" })),
		}),
	},
	{
		name: "narrate",
		label: "Narrate",
		method: "table.narrate",
		description:
			"Deliver story text and close the turn. Describe fiction and observable consequences only. Roll values, targets, grades, resource accounting and rule options are exclusively mechanics JSON rendered by the frontend. Do not repeat them in text or ask how to handle a failed check. Use the campaign play_language. Mark where each mechanic happened: resolve and apply hand back markers, and writing {{that-marker}} at the point in the sentence where it happened lets the frontend draw the roll or the change there instead of after everything. Place only markers you were handed, each at most once; leaving one out is fine and simply groups it at the end. After delivery write no more prose.",
		promptSnippet: "Deliver this turn's narration and close the turn",
		parameters: Type.Object({
			text: Type.String({ description: "this turn's narration, delivered to the player verbatim, with each mechanic's {{marker}} at the point it happened" }),
		}),
	},
];
