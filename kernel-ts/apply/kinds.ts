/** The effect kinds `table.apply` accepts. Shared with the read side, which names them in package section triggers (§183.1). */
export const APPLY_KINDS: readonly string[] = ['ability', 'adaptation', 'cash', 'clock', 'clue', 'damage', 'define', 'dossier', 'ending', 'flag', 'fork', 'handout', 'item', 'map', 'merge', 'move', 'note', 'npc', 'object', 'person', 'ruling', 'scene', 'switch', 'threat', 'time', 'usage'];
/** Closed schema capability names, not semantic classification rules (§209). */
export const CORE_CAPABILITY_NAMES: readonly string[] = [
    'look','lookup','recall','resolve','ask','narrate',
    ...APPLY_KINDS.filter(kind=>kind!=='npc'&&kind!=='object'),
    'npc-presence','npc-activity','npc-mood','npc-disposition','npc-intention','npc-combat','npc-reunion',
    'object-acquisition','object-document','object-transfer','object-state',
];
