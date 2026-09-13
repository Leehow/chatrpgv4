/** Read-only views over pinned audit JSON; names are matched, never semantically classified. */
const rows = (value: any): any[] => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
const key = (value: any) => typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : '';
const pick = (value: any, keys: string[]) => Object.fromEntries(keys.filter(k => Object.hasOwn(value ?? {}, k)).map(k => [k, value[k]]));
export function auditEvidenceView(kind: string, files: Record<string, any>, names: string[] = [], turns: number[] = []) {
    const wanted = new Set(names.map(key)), matches = (values: any[]) => !wanted.size || values.some(v => wanted.has(key(v)));
    let entries: any[] = [], known: string[] = [], source = '';
    if (kind === 'objects') {
        source = 'world.json';
        const data = files[source]?.objects ?? {}, definitions = rows(data.definitions), instances = rows(data.instances);
        const weapons = rows(files['current.json']?.party).flatMap(p => rows(p.weapons).map(w => ({owner: p.name, ...w})));
        known = [...instances, ...definitions, ...weapons].map(v => v.name).filter(v => typeof v === 'string');
        entries = [
            ...instances.filter(v => matches([v.name, data.definitions?.[v.definition]?.name])).map(v => ({kind: 'instance',
                name: v.name, owner: pick(v.owner, ['kind', 'name']), state: v.state,
                definition: data.definitions?.[v.definition]?.name ?? null, document: v.document ?? null})),
            ...definitions.filter(v => matches([v.name])).map(v => ({kind: 'definition', ...pick(v, ['name', 'category', 'parameters', 'traits', 'document'])})),
            ...weapons.filter(v => matches([v.name, v.display_name])).map(v => ({kind: 'sheet_weapon', evidence_file: 'current.json',
                ...pick(v, ['name', 'display_name', 'owner', 'skill', 'damage', 'ammo', 'magazine'])}))
        ];
    } else if (kind === 'history') {
        source = 'history.json';
        const history = rows(files[source]);
        entries = (turns.length ? history.filter(v => turns.includes(v.turn)) : history.slice(-6))
            .map(v => ({...pick(v, ['turn', 'player_text', 'rendered_text', 'warnings']),
                receipts: rows(v.receipts).map(r => pick(r, ['kind', 'name', 'label', 'summary', 'how', 'why', 'actor_label', 'passed', 'before', 'after', 'delta']))}));
        known = history.map(v => String(v.turn));
    } else if (kind === 'memory') {
        source = 'memory.json';
        const memory = rows(files[source]);
        entries = memory.filter(v => matches([v.subject, ...rows(v.entities), ...rows(v.knowers)]))
            .sort((a, b) => Number(b.kind === 'keeper_correction') - Number(a.kind === 'keeper_correction') || (b.valid_from_turn ?? 0) - (a.valid_from_turn ?? 0))
            .map(v => ({...pick(v, ['kind', 'subject', 'statement', 'state', 'status', 'entities', 'valid_from_turn']), superseded: v.superseded_by != null}));
        known = memory.flatMap(v => [v.subject, ...rows(v.entities)]).filter(v => typeof v === 'string');
    } else if (kind === 'source') {
        source = 'effective.json';
        const nodes = rows(files[source]?.graph?.nodes);
        const aliases = (v: any) => [v.name, v.properties?.runtime_projection?.record?.handle,
            ...rows(v.properties?.runtime_projection?.record?.aliases)];
        known = nodes.map(v => v.name).filter(v => typeof v === 'string');
        entries = nodes.filter(v => matches(aliases(v))).map(v => ({name: v.name ?? null, kind: v.node_kind,
            summary: v.summary, record: v.properties?.runtime_projection?.record ?? null}));
    } else throw new Error('Choose objects, history, memory or source');
    const total = entries.length;
    entries = entries.slice(0, 24);
    while (entries.length && JSON.stringify(entries).length > 20000) entries.pop();
    return {evidence_file: source, entries, matching_count: total, truncated: entries.length < total,
        known_names: entries.length ? [] : [...new Set(known)].slice(0, 80),
        note: 'This is a read-only view of the named retained file, not a new fact. Cite exact string values from that file. Empty matches do not prove absence under a different name; use a supplied name. Full retained files remain available for omitted detail.'};
}
