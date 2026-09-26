/**
 * Contract §139.3: the host-only marks of the table's own act of a person.
 *
 * The clerk's `npc_act` calls (`runtime/jev/npc-act-step.ts`) are what a person did, generated from their situation and
 * bound to the kernel's ways -- not the Keeper's writes. Only the host says so, after the tool schema has validated the
 * call: `_generated: true` rides on every intention such a call names (an `intends` or `intent_ref` on an effect, an
 * `action.intent_ref` on a roll), and `_draws` (spec D9, the severe stakes allowance) on the bare npc effect of the one
 * call whose basis names the weapon the act draws. Every other call has both removed, so a model-sent mark never reaches
 * the kernel.
 */
type Row = Record<string, unknown>;

/** The npc fields that make an effect something other than the bare carrier of a draw. */
const NOT_BARE = ["intends", "outcome", "to", "stance", "dead", "skill", "archetype", "conditions", "defense", "action", "disposition", "reunion", "spend_turn"];

export function markNpcAct(tool: string, params: Row, origin: {clerk?: unknown; basis?: unknown} | undefined): void {
	const npcAct = origin?.clerk === "npc_act";
	const drawn = npcAct ? (origin?.basis as {draw?: {weapon?: unknown; price_id?: unknown}} | undefined)?.draw : undefined;
	if (tool === "apply" && Array.isArray(params.effects)) {
		for (const effect of params.effects as Row[]) {
			if (!effect || typeof effect !== "object") continue;
			delete effect._generated;
			delete effect._draws;
			if (npcAct && (effect.intends != null || effect.intent_ref != null)) effect._generated = true;
			const bare = effect.kind === "npc" && NOT_BARE.every((key) => effect[key] == null);
			if (npcAct && bare && drawn && typeof drawn.weapon === "string" && drawn.weapon)
				effect._draws = {weapon: drawn.weapon, ...(typeof drawn.price_id === "string" && drawn.price_id ? {price_id: drawn.price_id} : {})};
		}
	}
	if (tool === "resolve" && params.action && typeof params.action === "object") {
		const action = params.action as Row;
		delete action._generated;
		if (npcAct && action.intent_ref != null) action._generated = true;
	}
}
