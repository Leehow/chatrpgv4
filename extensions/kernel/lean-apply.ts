/**
 * Contract §154 (prototype, 2026-09-29): lean `apply` arguments behind `PI_COC_LEAN_APPLY=1`.
 *
 * Measured the same day: the Keeper spends more output on `apply` arguments than on prose, and the player waits for
 * every token of it. Much of it is read by nobody (a `why` the kernel files on a receipt no projection shows), or
 * repeats what the kernel already derives (`object.definition` equal to `name`, `define.category` item), or
 * double-books what another effect already did (a `time` effect for the journey a `move` already put on the clock).
 *
 * The flag changes what the Keeper is told, never what the tool accepts: the schema's shape (types, required fields,
 * bounds) is the ordinary one, byte for byte, and only descriptions of the fields below differ. What the Keeper then
 * leaves out is either audit-only or derived where it is read (the kernel's own `definition ?? name`, `category ??
 * item`, and -- with the host's `_lean` on `table.apply` -- the origin line of a person established without a `why`).
 * Every `why` a projection, the NPC act lane or the obligation ledger reads is still asked for, by name.
 *
 * Unset or any value other than `1` is today's behaviour: the ordinary `COC_TOOLS` are registered and no `table.apply`
 * carries `_lean`.
 */

import {TURN_IR_PARAMETERS,TURN_IR_GUIDANCE} from '../../runtime/turn-ir.ts';
import type { CocToolSpec } from "./tools.ts";
import { SENTENCE_MAX } from "./tools.ts";
import { readJevApiKey } from "../jev/agent/config.js";
import {SAME_KEEPER_AFTER_RESULT_GUIDANCE} from '../../runtime/keeper-output-guidance.ts';
import {TURN_PACKET_PARAMETERS,TURN_PACKET_ROUTINE_PARAMETERS,TURN_PACKET_GUIDANCE} from '../../runtime/turn-packet-prototype.ts';

export const LEAN_APPLY_ENV = "PI_COC_LEAN_APPLY";

export function finalDeliveryAction(env:Readonly<Record<string,string|undefined>>=process.env):string {
  // §264.9: under the decision packet the delivery is the output packet; naming {{compose}} there sent the Keeper looking
  // for which of two delivery forms the table wanted.
  if(env.PI_COC_TURN_PACKET_PROTOTYPE==='1')return 'submit the output packet';
  if(env.PI_COC_ISOLATED_OUTPUT==='1')return 'return a private expression brief beginning with {{compose}}';
  return env.PI_COC_LOOP_ENGINE==='hybrid-v1'?'return your public response beginning with {{public}}':'select output';
}

/**
 * Whether this process runs with lean `apply` arguments. On by default since 2026-09-29 (user: merge
 * to the mainline, on by default): only an explicit `0` turns it off, kept as the operator's escape hatch.
 */
export function leanApplyEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
	return env[LEAN_APPLY_ENV]?.trim() !== "0";
}

const sentence = (text: string) => `${text}; one sentence, at most ${SENTENCE_MAX} characters`;

/**
 * What the Keeper is told instead, per effect kind and field (`kind` is the effect's own kind property). A string
 * replaces the field's description; `{append}` keeps the ordinary description and adds to it. Closed and keyed by
 * schema field names: nothing here reads the Keeper's words.
 */
export const LEAN_FIELD_DESCRIPTIONS: Readonly<Record<string, Readonly<Record<string, string | { append: string }>>>> = Object.freeze({
	time: {
		why: sentence("leave it out: nothing reads it back (the receipt keeps the minutes)"),
	},
	person: {
		name: { append: ". A word already recorded for them is not sent again" },
		why: sentence("leave it out: nothing reads it back"),
	},
	npc: {
		why: sentence("required with activity, defense, action or disposition (an activity change is refused without its cause, §208.1); keep it with stance, skill, conditions, dead, walk_on or intent_outcome abandoned (you and their own next act read it back); leave it out when the effect only moves them (to), reports a done result or writes a mood (the line is its own reason)"),
    activity: {append:' Keep movement, activity and intention in separate effects in the same apply batch; move first when place changes. Ordinary dialogue needs no activity record.'},
    intends: 'This variant stands alone in one npc effect, with outcome. Keep movement, activity and intention in separate effects in the same apply batch, moving first when place changes. Use planned for a real future undertaking, or done for a completed nonmechanical act when intention tracking is useful. Reuse an existing intention\'s exact text to update it without copying a hashed reference. Ordinary dialogue needs no intention. Do not add attempted and done rows solely to narrate a routine completed act.',
		outcome: 'planned has not begun; attempted is genuinely under way; done, failed and abandoned are settled outcomes. Use only the state that actually holds now.',
	},
	object: {
		definition: "Accepted definition name when first placing the instance; leave it out when it is the same as name (the kernel reads name)",
	why: sentence("required for a condition change or any physical document operation; keep it when an NPC gives, takes or is offered the thing (their next act reads it back); otherwise leave it out, and never on adopt, which records none"),
	},
	define: {
		category: { append: "; leave it out for an ordinary item" },
	},
	flag: {
		why: sentence("leave it out, except when this flag is a scene obligation's and you are waiving it: why is what makes it a waiver (without it the obligation reads as settled)"),
	},
	threat: {
		why: sentence("leave it out: nothing reads it back"),
	},
	clock: {
		why: sentence("leave it out: nothing reads it back"),
	},
	ability: {
		why: sentence("leave it out: the receipt records none"),
	},
});

/** Added to the apply tool's own description under the flag. */
export const LEAN_APPLY_NOTE =
	" Lean arguments (§154): write only what something reads. Each effect's why says whether it is read; leave out the ones that say so, object.definition when it is the object's own name, and define.category for an ordinary item: the kernel fills them.";

/**
 * A copy of a TypeBox schema that keeps every own property with its descriptor: TypeBox 1.x marks a schema's kind and
 * optionality with non-enumerable keys (`~kind`, `~optional`), which a spread or `structuredClone` would drop, and Pi
 * validates arguments against them.
 */
function cloneSchema<T>(value: T): T {
	if (Array.isArray(value)) return value.map((item) => cloneSchema(item)) as T;
	if (!value || typeof value !== "object") return value;
	const copy = Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>;
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
		if ("value" in descriptor) descriptor.value = cloneSchema(descriptor.value);
		Object.defineProperty(copy, key, descriptor);
	}
	return copy as T;
}

/** The kind an effect variant of the apply union declares (`enum: [kind]` or `const: kind`). */
function variantKind(variant: Record<string, any>): string | undefined {
	const kind = variant?.properties?.kind;
	return typeof kind?.const === "string" ? kind.const : Array.isArray(kind?.enum) && kind.enum.length === 1 ? kind.enum[0] : undefined;
}

/**
 * The tool list a lean process registers: the ordinary list with the apply tool's description and the field
 * descriptions above replaced, on a copy. Throws when a field it names is not in the schema, so a renamed field
 * cannot silently leave the Keeper with the old instruction.
 */
export function leanTools(tools: readonly CocToolSpec[]): readonly CocToolSpec[] {
	return tools.map((spec) => {
		if (spec.name !== "apply") return spec;
		const parameters = cloneSchema(spec.parameters) as Record<string, any>;
		const variants: Array<Record<string, any>> = parameters.properties.effects.items.anyOf;
		for (const [kind, fields] of Object.entries(LEAN_FIELD_DESCRIPTIONS)) {
			const variant = variants.find((candidate) => variantKind(candidate) === kind);
			if (!variant) throw new Error(`lean apply: no ${kind} effect in the apply schema`);
			for (const [field, text] of Object.entries(fields)) {
				const property = variant.properties[field];
				if (!property) throw new Error(`lean apply: the ${kind} effect has no ${field}`);
				property.description = typeof text === "string" ? text : `${property.description ?? ""}${text.append}`;
			}
		}
		return { ...spec, description: `${spec.description}${LEAN_APPLY_NOTE}`, parameters: parameters as CocToolSpec["parameters"] };
	});
}

/** The tools this process offers the Keeper. */
export function offeredTools(tools: readonly CocToolSpec[], env: Readonly<Record<string, string | undefined>> = process.env,
  capabilities:{memoryQueryAvailable?:boolean;routineSummary?:boolean}={}): readonly CocToolSpec[] {
  if(!readJevApiKey(env))tools=tools.map(spec=>{
    if(spec.name!=='lookup')return spec;
    const parameters=cloneSchema(spec.parameters) as Record<string,any>;
    parameters.properties.kind.enum=parameters.properties.kind.enum.filter((kind:string)=>kind!=='support');
    return {...spec,parameters,description:`${spec.description} Jev support is unavailable in this session and is not an offered kind; use direct lookup and recall.`};
  });
	if(capabilities.memoryQueryAvailable===false)tools=tools.map(spec=>{
    if(spec.name!=='recall')return spec;
    const parameters=cloneSchema(spec.parameters) as Record<string,any>;
    delete parameters.properties.query;
    return {...spec,parameters};
  });
	const current=env.PI_COC_LOOP_ENGINE==='hybrid-v1'?tools.filter(tool=>tool.name!=='narrate'&&(tool.name!=='output'||env.PI_COC_TURN_PACKET_PROTOTYPE==='1')).map(spec=>{
    if(!['apply','ask'].includes(spec.name))return spec;
    const parameters=cloneSchema(spec.parameters) as Record<string,any>;
    for(const field of ['delivery','narrate','handoff','quotes',...(env.PI_COC_TURN_PACKET_PROTOTYPE==='1'?['event','text']:[])])delete parameters.properties[field];
    if(spec.name==='apply'&&env.PI_COC_TURN_PACKET_PROTOTYPE==='1'){delete parameters.anyOf;parameters.required=[...new Set([...(parameters.required??[]),'effects'])];parameters.additionalProperties=false;}
    if(spec.name==='apply')for(const variant of parameters.properties.effects.items.anyOf){
      const kind=variantKind(variant),fields=variant.properties;
      if(kind==='npc'){
        fields.mood.description='Optional changed emotional state, one short line in play_language. Record it when useful for later play; ordinary speech does not require a mood write. This variant stands alone in an NPC effect.';
        fields.intends.description=LEAN_FIELD_DESCRIPTIONS.npc.intends;
        fields.outcome.description=LEAN_FIELD_DESCRIPTIONS.npc.outcome;
      }
      if(kind==='person')fields.name.description='The established public name or distinctive epithet this table uses for an NPC, in play_language. Record a new name when the fiction establishes it; reuse existing names. An investigator keeps the player-selected name. Unrevealed identities stay private.';
      if(kind==='ending')fields.summary.description='The ending reached. Read source rewards and resolve development:end-session first. An already-accounted legacy correction retains the original summary, turn and rewards. Final publication commits this effect.';
      if(kind==='cash'&&env.PI_COC_TURN_PACKET_PROTOTYPE==='1'){
        fields.mode.description='settle (default) completes a chosen expense. quote records the established supplier\'s exact itemized offer without payment or physical delivery; use this existing cash effect when an unaccepted quotation must be recorded. cancel withdraws only an unaccepted quotation the player cancelled and never reverses payment. An inquiry or budget alone does not select a purchase or consumption.';
        fields.bill.description='Optional local bill name for the canonical itemized amount. Supply its items once; the author receives the actual public financial outcome. This is not a saved quote name.';
      }
    }
    return {...spec,parameters,...(env.PI_COC_TURN_PACKET_PROTOTYPE==='1'&&spec.name==='apply'?{promptSnippet:'Apply actual canonical mechanical effects only; communication selections belong in output.'}:{}),description:spec.name==='apply'
      ?(env.PI_COC_TURN_PACKET_PROTOTYPE==='1'?'Apply only canonical mechanical effects through the existing kernel. Speech and event prose are not apply capabilities; select communication content through output. A clue, a mood and a name are output commands; apply is for objects, notes, clocks, cash and other mechanics. Never submit event, delivery, quotes or narration. ':'Apply authoritative world changes and canonical event records. Include only actual changes; future NPC intentions use planned. A clue must be obtainable here or cover information already told under an issued owed row; from records attribution and cannot relocate an authored clue. Ordinary remote NPC reports use event.knowledge with mode heard and actual source/state; a written record actually obtained here uses the existing dossier path. Effects and event use the existing schema. This tool never writes or publishes prose. '+(env.PI_COC_TURN_PACKET_PROTOTYPE==='1'?'After reading its result, submit the final private packet through the native output tool. ':env.PI_COC_ISOLATED_OUTPUT==='1'?'After reading its result, return {{compose}} followed immediately by one private JSON expression brief with scene, narrative_content and npc_turns; no public prose or prefix. ':SAME_KEEPER_AFTER_RESULT_GUIDANCE+' ')
        +(env.PI_COC_TURN_PACKET_PROTOTYPE==='1'?'':INTENT_APPLY_NOTE))
      :(env.PI_COC_TURN_PACKET_PROTOTYPE==='1'?'Stage a required mechanical choice using its issued options and binding. It publishes with this turn\'s output prose and closes the turn then, so submit output after it. Ordinary dialogue uses the native output packet and its isolated author.':'Publish a required mechanical choice using its issued options and binding. '+(env.PI_COC_ISOLATED_OUTPUT==='1'?'Ordinary dialogue is selected in the private {{compose}} JSON expression brief; the host invokes the isolated author. Use text only for an optional public preface.':'Ordinary dialogue belongs in the final {{public}} reply. Use text only for an optional public preface; no other author is called.'))};
  }):tools;
    const declared=env.PI_COC_TURN_PACKET_PROTOTYPE==='1'?current.map(spec=>{
      // §247.3: only an active routine-summary package declares the routine element.
      // §270: a Turn IR session declares the IR and its guidance instead of the v4 packet.
      if(spec.name==='output'&&env.PI_COC_TURN_IR==='1')return {...spec,parameters:TURN_IR_PARAMETERS,description:TURN_IR_GUIDANCE};
      if(spec.name==='output')return {...spec,parameters:capabilities.routineSummary===true?TURN_PACKET_ROUTINE_PARAMETERS:TURN_PACKET_PARAMETERS,description:TURN_PACKET_GUIDANCE+' Arriving at another place also assesses its scene; an omitted assessment is recorded as unknown. Moves inside the current place need none.',promptSnippet:'Submit one private turn packet for settlement and final authoring'};
      if(spec.name==='place'){
        const parameters=cloneSchema(spec.parameters) as Record<string,any>;
        // §264.39: a move's travel_minutes stays declared beside travel_band (§250.5 bounds it by the band's range); the host drops
        // minutes sent without a band (place-operation.ts), so no invented arithmetic reaches the kernel.
        // §270.10: a Turn IR session moves, waits and looks in output actions; a rule action already settles an arrival first.
        if(env.PI_COC_TURN_IR==='1')return {...spec,parameters,description:'Read a place (inspect). Moves, waits and looks are output actions (move, time, perceive); a rule action after a move settles the arrival first.',
          promptSnippet:'Read a place.'};
        return {...spec,parameters,description:'Read a place (inspect), or commit one location step before a roll that needs the arrival. Every other move, wait and look goes into output commands in order. Example: {action:"move",to:"here",spot:"by the window",relation:"standing"}.',
          promptSnippet:'Read a place, or commit an arrival a roll depends on.'};
      }
      if(spec.name==='apply'){
        const parameters=cloneSchema(spec.parameters) as Record<string,any>;
        parameters.properties.effects.items.anyOf=parameters.properties.effects.items.anyOf.filter((branch:any)=>variantKind(branch)!=='place');
        if(env.PI_COC_TURN_IR==='1')return {...spec,parameters,description:'Apply rare canonical mechanics the output actions do not cover (damage, cash, clocks, notes, defining a new object). People arriving or leaving, moves, findings, moods, names, relationships, papers shown or handed over and speech are output actions, never apply.',
          promptSnippet:'Rare mechanics only; ordinary play is output actions.'};
        return {...spec,parameters,description:spec.description+' Enhanced location actions use the separate place tool or remaining output.commands. The existing mechanical move effect remains available for issued owed recovery and mixed atomic transactions.'};
      }
      return spec;
    }):current;
	return leanApplyEnabled(env) ? leanTools(declared) : declared;
}

const INTENT_APPLY_NOTE='Record actor-specific knowledge and directed relationships separately. Heard knowledge must name its actual source and audience; bind prospective speech to its event material so it activates only after delivery. Empty effects are valid when recording a meaningful event. Never repeat a settled effect.';
