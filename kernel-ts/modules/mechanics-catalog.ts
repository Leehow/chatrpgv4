/**
 * Contract §136.1: which mechanical shape may sit on which node kinds, in catalog order.
 *
 * Import-free on purpose: the validator (`mechanics-shape.ts`) and the one reader
 * (`ModuleGraph.mechanicsOf`, §136.10) both read it, and the reader's module is imported by the validator.
 */
export const SHAPE_KINDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    profile: ["npc", "creature"],
    check: ["rule", "hazard"],
    hazard: ["rule", "hazard"],
    damage: ["rule", "hazard"],
    sanity_loss: ["rule", "hazard", "object", "artifact"],
    time_cost: ["rule", "hazard"],
    resource_cost: ["rule", "hazard", "object", "artifact"],
    weapon: ["object", "artifact"],
    spell: ["spell"],
    tome: ["tome"],
    reward: ["rule"],
});
