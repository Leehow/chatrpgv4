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
import { MOOD_CONFLICTS } from "../../kernel-ts/npc/mood.ts";

type Effect = Record<string, unknown>;

/** Splits, in place, each npc effect whose mood shares the effect with a conflicting change; returns how many it split. */
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
	return split;
}
