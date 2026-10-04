/**
 * Contract §143.3: the host-only marks of the table's own act of a person.
 *
 * The clerk's `npc_act` calls (`runtime/jev/npc-act-step.ts`) are what a person did, generated from their situation and
 * bound to the kernel's ways -- not the Keeper's writes. Only the host says so, after the tool schema has validated the
 * call: `_generated: true` rides on every intention such a call names (an `intends` or `intent_ref` on an effect, an
 * `action.intent_ref` on a roll), and what the act brings out (§143.19, spec D10: allowed by a surprise of the stakes
 * die) on the bare npc effect of the one call whose basis names it -- `_draws` for a rulebook weapon (`basis.draw`),
 * `_produces` for anything else (`basis.produce`). Every other call has all three removed, so a model-sent mark never
 * reaches the kernel.
 */
type Row = Record<string, unknown>;

/** The npc fields that make an effect something other than the bare carrier of what the act brings out. */
const NOT_BARE = ["intends", "outcome", "to", "stance", "dead", "skill", "archetype", "creature", "conditions", "defense", "action", "disposition", "reunion", "spend_turn", "mood"];

export function markNpcAct(tool: string, params: Row, origin: {clerk?: unknown; basis?: unknown} | undefined): void {
	const npcAct = origin?.clerk === "npc_act";
	const basis = npcAct ? origin?.basis as {draw?: {weapon?: unknown; price_id?: unknown}; produce?: {price_id?: unknown; name?: unknown; description?: unknown}} | undefined : undefined;
	const drawn = basis?.draw, produce = basis?.produce;
	const text = (value: unknown): string | undefined => typeof value === "string" && value ? value : undefined;
	if (tool === "apply" && Array.isArray(params.effects)) {
		for (const effect of params.effects as Row[]) {
			if (!effect || typeof effect !== "object") continue;
			delete effect._generated;
			delete effect._draws;
			delete effect._produces;
			if (npcAct && (effect.intends != null || effect.intent_ref != null)) effect._generated = true;
			const bare = effect.kind === "npc" && NOT_BARE.every((key) => effect[key] == null);
			if (npcAct && bare && drawn && text(drawn.weapon))
				effect._draws = {weapon: drawn.weapon, ...(text(drawn.price_id) ? {price_id: drawn.price_id} : {})};
			else if (npcAct && bare && produce && text(produce.description) && (text(produce.price_id) || text(produce.name)))
				effect._produces = {...(text(produce.price_id) ? {price_id: produce.price_id} : {name: produce.name}), description: produce.description};
		}
	}
	if (tool === "resolve" && params.action && typeof params.action === "object") {
		const action = params.action as Row;
		delete action._generated;
		if (npcAct && action.intent_ref != null) action._generated = true;
	}
}
