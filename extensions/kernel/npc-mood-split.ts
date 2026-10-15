/**
 * Contract §161.1: a mood is its own npc effect. The kernel refuses one that shares its effect with another change to the
 * person (`npc.mood is its own effect`), and its fix is purely mechanical: the same two changes as two effects of the
 * same batch. On the installed App's Dust to Dust table (2026-10-02) the Keeper wrote `{to, stance, mood}` or
 * `{walk_on, to, stance, mood}` in one effect on two turns running, and each time spent a model round trip on the refusal
 * before sending exactly the split the fix describes.
 *
 * The host sends that split itself: the effect without its mood, then `{kind: "npc", name, mood}` right after it, so a
 * person the first effect brings in exists before their feeling is written. Nothing is read or judged; an npc effect
 * whose mood stands alone, or that has no mood, is left as it is.
 */
import { MOOD_CONFLICTS } from "../../kernel-ts/npc/mood-conflicts.ts";

type Effect = Record<string, unknown>;

const ORDINARY_KEYS = new Set(['kind','name','to','walk_on','why','activity','reunion','intends','outcome','_passage','_resolved_from']);

/** Expands mood conflicts and ordinary explicit NPC combinations in place; returns how many input effects it split. */
export function splitNpcMood(effects: unknown): number {
	if (!Array.isArray(effects)) return 0;
	let split = 0;
	for (let index = 0; index < effects.length; index++) {
		const effect = effects[index] as Effect | null;
		if (!effect || typeof effect !== "object" || effect.kind !== "npc" || effect.mood == null) continue;
		if (!MOOD_CONFLICTS.some((key) => effect[key] != null)) continue;
		const { mood, ...rest } = effect;
		effects.splice(index, 1, rest, { kind: "npc", name: effect.name, mood });
		index++;
		split++;
	}
	// The same structural adapter sends ordinary explicit changes to their existing owners. References and other
	// variants keep their original shape: assigning their causal fields to a new owner would require judgement.
	for (let index = 0; index < effects.length; index++) {
		const effect = effects[index] as Effect | null;
		if (!effect || typeof effect !== 'object' || effect.kind !== 'npc' || effect.to == null
			|| Object.keys(effect).some(key=>!ORDINARY_KEYS.has(key))) continue;
		const activity = effect.activity != null, reunion = effect.reunion != null,
			undertaking = effect.intends != null || effect.outcome != null;
		if (!activity && !reunion && !undertaking) continue;
		if (['activity','reunion','intends','outcome'].some(key=>Object.hasOwn(effect,key)&&effect[key]==null)) continue;
		const {activity:_activity,reunion:_reunion,intends:_intends,outcome:_outcome,...position}=effect;
		const common={kind:'npc',name:effect.name,...(Object.hasOwn(effect,'why')?{why:effect.why}:{})};
		const parts:Effect[]=[position];
		if(activity)parts.push({...common,activity:effect.activity});
		if(reunion)parts.push({...common,reunion:effect.reunion});
		if(undertaking)parts.push({...common,...(Object.hasOwn(effect,'intends')?{intends:effect.intends}:{}),
			...(Object.hasOwn(effect,'outcome')?{outcome:effect.outcome}:{})});
		effects.splice(index,1,...parts);
		index+=parts.length-1;
		split++;
	}
	return split;
}
