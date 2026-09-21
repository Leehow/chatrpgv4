/** Read-only views over pinned audit JSON; names are matched, never semantically classified. */
import {auditEvidenceBindings} from '../../kernel-ts/mods/audit-references.ts';

const rows = (value: any): any[] => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
const indexed = (value: any, path: string[]) => Array.isArray(value)
    ? value.map((item, index) => ({item, path: [...path, String(index)]}))
    : value && typeof value === 'object'
        ? Object.entries(value).map(([name, item]) => ({item, path: [...path, name]}))
        : [];
const key = (value: any) => typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : '';
const pick = (value: any, keys: string[]) => Object.fromEntries(keys.filter(k => Object.hasOwn(value ?? {}, k)).map(k => [k, value[k]]));
const within = (path: string[], prefix: string[]) => prefix.length <= path.length && prefix.every((part, index) => path[index] === part);
export function auditEvidenceView(kind: string, files: Record<string, any>, names: string[] = [], turns: number[] = [], schema = 1) {
    const wanted = new Set(names.map(key)), matches = (values: any[]) => !wanted.size || values.some(v => wanted.has(key(v)));
    let entries: Array<{value: any; file: string; paths: string[][]}> = [], known: string[] = [], source = '';
    if (kind === 'objects') {
        source = 'world.json';
        const data = files[source]?.objects ?? {};
        const definitions = indexed(data.definitions, ['objects', 'definitions']);
        const instances = indexed(data.instances, ['objects', 'instances']);
        const weapons = indexed(files['current.json']?.party, ['party']).flatMap(person => indexed((person.item as any)?.weapons, [...person.path, 'weapons'])
            .map(weapon => ({item: {owner: (person.item as any)?.name, ...(weapon.item as any)}, path: weapon.path, ownerPath: [...person.path, 'name']})));
        known = [...instances, ...definitions, ...weapons].map(v => v.item?.name).filter(v => typeof v === 'string');
        entries = [
            ...instances.filter(v => matches([v.item.name, data.definitions?.[v.item.definition]?.name])).map(v => {
                const definition = indexed(data.definitions, ['objects', 'definitions']).find(row => row.path.at(-1) === String(v.item.definition));
                return {file: source, paths: [v.path, ...(definition ? [definition.path] : [])], value: {kind: 'instance',
                    name: v.item.name, owner: pick(v.item.owner, ['kind', 'name']), state: v.item.state,
                    definition: data.definitions?.[v.item.definition]?.name ?? null, document: v.item.document ?? null}};
            }),
            ...definitions.filter(v => matches([v.item.name])).map(v => ({file: source, paths: [v.path],
                value: {kind: 'definition', ...pick(v.item, ['name', 'category', 'parameters', 'traits', 'document'])}})),
            ...weapons.filter(v => matches([v.item.name, v.item.display_name])).map(v => ({file: 'current.json', paths: [v.path, v.ownerPath],
                value: {kind: 'sheet_weapon', evidence_file: 'current.json',
                    ...pick(v.item, ['name', 'display_name', 'owner', 'skill', 'damage', 'ammo', 'magazine'])}}))
        ];
    } else if (kind === 'history') {
        source = 'history.json';
        const history = indexed(files[source], []);
        entries = (turns.length ? history.filter(v => turns.includes(v.item.turn)) : history.slice(-6))
            .map(v => ({file: source, paths: [v.path], value: {...pick(v.item, ['turn', 'player_text', 'rendered_text', 'warnings']),
                receipts: rows(v.item.receipts).map(r => pick(r, ['kind', 'name', 'label', 'summary', 'how', 'why', 'actor_label', 'passed', 'before', 'after', 'delta']))}}));
        known = history.map(v => String(v.item.turn));
    } else if (kind === 'memory') {
        source = 'memory.json';
        const memory = indexed(files[source], []);
        entries = memory.filter(v => matches([v.item.subject, ...rows(v.item.entities), ...rows(v.item.knowers)]))
            .sort((a, b) => Number(b.item.kind === 'keeper_correction') - Number(a.item.kind === 'keeper_correction') || (b.item.valid_from_turn ?? 0) - (a.item.valid_from_turn ?? 0))
            .map(v => ({file: source, paths: [v.path], value: {...pick(v.item, ['kind', 'subject', 'statement', 'state', 'status', 'entities', 'valid_from_turn']), superseded: v.item.superseded_by != null}}));
        known = memory.flatMap(v => [v.item.subject, ...rows(v.item.entities)]).filter(v => typeof v === 'string');
    } else if (kind === 'source') {
        source = 'effective.json';
        const nodes = indexed(files[source]?.graph?.nodes, ['graph', 'nodes']);
        const aliases = (v: any) => [v.name, v.properties?.runtime_projection?.record?.handle,
            ...rows(v.properties?.runtime_projection?.record?.aliases)];
        known = nodes.map(v => v.item.name).filter(v => typeof v === 'string');
        entries = nodes.filter(v => matches(aliases(v.item))).map(v => ({file: source, paths: [v.path], value: {name: v.item.name ?? null, kind: v.item.node_kind,
            summary: v.item.summary, record: v.item.properties?.runtime_projection?.record ?? null}}));
    } else throw new Error('Choose objects, history, memory or source');
    const total = entries.length;
    const bindings = schema === 2 ? auditEvidenceBindings(files) : [];
    let view = entries.slice(0, 24).map(entry => {
        if (schema !== 2) return entry.value;
        const sources = bindings.filter(binding => binding.file === entry.file && entry.paths.some(path => within(binding.path, path)))
            .map(({alias, file, text}) => ({alias, file, text}));
        return {...entry.value, sources};
    });
    while (view.length && JSON.stringify(view).length > 20000) view.pop();
    return {evidence_file: source, entries: view, matching_count: total, truncated: view.length < total,
        known_names: view.length ? [] : [...new Set(known)].slice(0, 80),
        note: schema === 2
            ? 'This is a read-only view of pinned evidence. Select sources[].alias in the review artifact; do not copy source text or paths. Empty matches do not prove absence under a different name; use a supplied name. Full retained files remain available for omitted detail.'
            : 'This is a read-only view of the named retained file, not a new fact. Cite exact string values from that file. Empty matches do not prove absence under a different name; use a supplied name. Full retained files remain available for omitted detail.'};
}
