/** Closed adaptation operation fields shared by kernel validation and private tool schemas. */
export const ADAPTATION_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    scene: ['scene', 'name', 'description'], clue_at: ['clue', 'scene'], route: ['from', 'to'],
    add_scene: ['name', 'description', 'based_on'], add_npc: ['name', 'description', 'agenda'],
    add_clue: ['name', 'description', 'scene'],
    npc_knows: ['npc', 'clue'], handout: ['name', 'text', 'based_on']
});
