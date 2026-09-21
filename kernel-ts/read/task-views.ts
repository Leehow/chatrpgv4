/** Closed owner-declared view partitions; unknown state remains an authoritative dependency. */
import {isJsonObject, jsonDigest} from '../json.js';
import {clone, row, type Row} from './values.js';
import {MOD, PRESENTATION_KEYS, isVoicePresentationField} from '../voice/fields.js';

const owners = [{id: 'npc-voice', mod: MOD, keys: PRESENTATION_KEYS, accepts: isVoicePresentationField}] as const;
export function taskViews(world: Row): {world: Row; presentation: Record<string, string>} {
    const core = clone(world), presentation: Record<string, string> = {};
    for (const owner of owners) {
        const view: Row = {}, mods = row(core.mods);
        if (isJsonObject(core.mods) && (mods.state === undefined || isJsonObject(mods.state))) {
            const states = (mods.state ??= {}), state = states[owner.mod];
            if (isJsonObject(state) && isJsonObject(state.dossier)) {
                for (const [npc, fields] of Object.entries(state.dossier)) {
                    if (!isJsonObject(fields)) continue;
                    for (const key of owner.keys) {
                        const value = fields[key];
                        if (!owner.accepts(key, value)) continue;
                        (view[npc] ??= {})[key] = clone(value);
                        delete fields[key];
                    }
                    if (!Object.keys(fields).length) delete state.dossier[npc];
                }
                if (!Object.keys(state.dossier).length) delete state.dossier;
            }
            if (isJsonObject(state) && !Object.keys(state).length) delete states[owner.mod];
        }
        presentation[owner.id] = jsonDigest(view);
    }
    return {world: core, presentation};
}
