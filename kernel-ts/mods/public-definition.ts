/**
 * What a player may read of one accepted definition: its `player_view`, and nothing else (contract
 * §129). The sheet's possessions box (`publicItems`) and the delivery card's item row both draw from
 * here, so the two surfaces cannot come to disagree about what an object is. The basis, the hidden
 * traits and every parameter the view does not name stay Keeper material.
 *
 * Import-free on purpose: the Mod host computes the same view from an accepted draft before the
 * world holds it, and it loads this file from source.
 */
type Row = Record<string, any>;
const record = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];

export function publicDefinition(definition: unknown): Row {
    const value = record(definition), view = record(value.player_view), parameters = record(value.parameters), shown = list(view.traits);
    return {
        category: value.category ?? null,
        description: typeof view.description === 'string' ? view.description : '',
        traits: list(value.traits).filter(trait => shown.includes(record(trait).name)),
        parameters: Object.fromEntries(list(view.fields).map((key: string) => [key, parameters[key]])),
    };
}
/**
 * What a player may read of one accepted usage (contract §132): its name and the parameters its
 * `player_view` lists, and nothing else -- exactly what the sheet's weapon row shows for it
 * (`publicUsageWeapon` reads it from here). The basis, the description and every parameter the view
 * does not name stay Keeper material.
 */
export function publicUsage(usage: unknown): Row {
    const value = record(usage), parameters = record(value.parameters), fields = list(record(value.player_view).fields);
    return {
        name: value.name ?? null,
        parameters: Object.fromEntries(fields.filter(key => typeof key === 'string' && Object.hasOwn(parameters, key)).map(key => [key, parameters[key]])),
    };
}
