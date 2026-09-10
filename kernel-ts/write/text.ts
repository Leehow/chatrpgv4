/**
 * Existing receipt facts and marker binding, without semantic interpretation. No delivery guard
 * reads the prose: whether a delivery is in the play language is the verifier lane's finding
 * (`play_language_mismatch` through `table.warn`), never a kernel refusal (contract section 23).
 */
import { RpcError } from '../errors.js';
import { pythonJsonDumps } from '../json.js';
import { ModuleGraph, recordOf } from '../read/module-graph.js';
import { mechanicsOf } from '../read/mechanics.js';
import { npcsPresent } from '../read/capsule.js';
import { array, row, values, truth, number, string, integer, kebab, chars, words, type Row } from '../read/values.js';
export const asciiSlug = (text: string, limit = 24): string => text.normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).join('-').slice(0, limit).replace(/-+$/, '');
const MARKER = /\{\{([a-z0-9][a-z0-9:_-]*)\}\}/g;
function markerName(receipt: Row): string | null {
    const part = (prefix: string, value: any) => { const slug = kebab(string(value || '')).replace(/[^a-zA-Z0-9-]/g, '').replace(/^-+|-+$/g, ''); return slug ? `${prefix}:${slug}` : prefix; };
    switch (receipt.kind) {
        case 'roll': return part(receipt.form === 'dice' ? 'dice' : 'check', receipt.skill);
        case 'delta': return part('change', receipt.resource);
        case 'move': return receipt.renamed ? null : part('scene', receipt.to);
        case 'clue': return part('clue', receipt.clue);
        case 'item': return part('item', receipt.name);
        case 'handout': return part('handout', receipt.handout || receipt.name);
        case 'session': return part('session', receipt.family);
        case 'worldline': return part('worldline', receipt.operation);
        case 'time':
        case 'cash':
        case 'choice': return receipt.kind;
        default: return null;
    }
}
export function markersFor(receipts: Row[]): Map<string, string> {
    const counts = new Map<string, number>(), names = new Map<string, string>();
    for (const receipt of receipts) {
        const base = markerName(receipt);
        if (!base || typeof receipt.id !== 'string' || !mechanicsOf(receipt))
            continue;
        const n = (counts.get(base) ?? 0) + 1;
        counts.set(base, n);
        names.set(receipt.id, n === 1 ? base : `${base}-${n}`);
    }
    return names;
}
export function bindMarkers(text: string, receipts: Row[]): Row {
    const names = markersFor(receipts);
    const available = new Map([...names].map(([id, marker]) => [marker, id])), seen: Row = {}, unknown: string[] = [], duplicate: string[] = [];
    for (const match of text.matchAll(MARKER)) {
        const marker = match[1];
        if (!available.has(marker)) {
            if (!unknown.includes(marker))
                unknown.push(marker);
        }
        else if (Object.hasOwn(seen, marker)) {
            if (!duplicate.includes(marker))
                duplicate.push(marker);
        }
        else
            seen[marker] = available.get(marker);
    }
    if (unknown.length)
        throw new RpcError('invalid_params', `no receipt in this turn is named by ${unknown.join(', ')}`, {
            fix: 'place only the markers resolve and apply handed back, or none',
            codeDetail: 'unknown_marker',
            details: {
                unknown,
                markers: [...available.keys()].sort()
            },
        });
    if (duplicate.length)
        throw new RpcError('invalid_params', `${duplicate.join(', ')} is placed more than once`, {
            fix: 'a receipt happened once: place its marker at one point in the text',
            codeDetail: 'duplicate_marker',
            details: {
                duplicate
            },
        });
    return seen;
}
export const stripMarkers = (text: string): string => text.replace(MARKER, '').replace(/[ \t]{2,}/g, ' ').trim();
export function committedFacts(receipts: Row[], snapshot: Row, label: (id: any) => string, player: any): string[] {
    const committed: string[] = [];
    if (typeof player === 'string' && player.trim())
        committed.push(`Player declared: ${words(player)}`);
    for (const r of receipts) {
        if (r.kind === 'roll') {
            const actor = r.actor_label || label(r.actor), skill = string(r.skill ?? null);
            if (r.form === 'dice')
                committed.push(`${actor} rolls ${skill} ${string(r.expression ?? null)}: ${string(r.total ?? null)}`);
            else
                committed.push(`${actor}'s ${skill} check ${truth(r.passed) ? 'passed' : 'failed'} (${string(r.level ?? null)}${r.visibility === 'keeper' ? '; hidden' : ''})`);
        }
        else if (r.kind === 'move')
            committed.push(`Scene: ${string(r.from_label || r.from || null)} -> ${string(r.to_label || r.to || null)}${number(r.minutes) > 0 ? ` (${Math.trunc(number(r.minutes))} min)` : ''}`);
        else if (r.kind === 'clue')
            committed.push(`Clue found: ${string(r.label || r.clue || null)}`);
        else if (r.kind === 'delta' || r.kind === 'cash')
            committed.push(`${string(r.resource ?? null)}: ${string(r.item || r.subject_label || r.subject || null)} ${string(r.before ?? null)} -> ${string(r.after ?? null)}`);
        else if (r.kind === 'item') {
            const quantity = Math.trunc(number(r.quantity || 1));
            committed.push(`Item: ${string(r.subject_label || r.subject || null)} ${quantity < 0 ? 'loses' : 'gains'} ${string(r.label || r.name || null)}${Math.abs(quantity) > 1 ? ` x${Math.abs(quantity)}` : ''}`);
        }
        else if (r.kind === 'time')
            committed.push(`Time advances ${Math.trunc(number(r.minutes))} min`);
        else if (r.kind === 'choice')
            committed.push(`Player chose: ${string(r.option ?? null)}`);
        else if (r.kind === 'session') {
            const names: Row = {
                combat: ['Combat begins', 'Combat ends'],
                chase: ['Chase begins', 'Chase ends'],
                sanity_bout: ['Bout of madness begins', 'Bout of madness ends']
            };
            const [start, end] = names[r.family] || [string(r.family), string(r.family)];
            if (r.transition === 'start')
                committed.push(start + (r.summary ? `: ${r.summary}` : ''));
            else if (r.transition === 'end')
                committed.push(end + (r.summary || r.outcome ? `: ${r.summary || r.outcome}` : ''));
            else
                committed.push(`${start} enters round ${string(r.round ?? null)}`);
        }
    }
    committed.push(`Location: ${string(row(snapshot.scene).display_name || row(snapshot.scene).name || null)}`);
    committed.push(array(snapshot.present).length ? `Present: ${snapshot.present.map(string).join(', ')}` : 'Present: nobody');
    return committed;
}
export function facts(graph: ModuleGraph, world: Row, party: Row[], receipts: Row[], snapshot: Row, player: any): Row {
    const committed = committedFacts(receipts, snapshot, id => party.find(s => string(s.id) === string(id))?.name || string(id ?? null), player);
    const scene = graph.scene(world.active_scene), keeper: string[] = [];
    for (const id of graph.sceneClueIds(scene)) {
        const node = graph.nodes.get(id)!;
        if (!array(world.discovered_clues).includes(graph.handle(node)))
            keeper.push(`Undiscovered clue: ${graph.handle(node)} -- ${graph.summary(node)}`);
    }
    for (const node of npcsPresent(graph, world, scene)) {
        const record = recordOf(node);
        if (record.agenda || record.secret)
            keeper.push(`${graph.displayName(node)}'s secret -- agenda: ${record.agenda || '-'}; secret: ${record.secret || '-'}`);
    }
    for (const node of graph.kind('secret'))
        keeper.push(`Module secret: ${graph.handle(node)} -- ${graph.summary(node)}`);
    while (keeper.length && Buffer.byteLength(pythonJsonDumps(keeper), 'utf8') > 2048)
        keeper.pop();
    return {
        committed,
        keeper_only: keeper
    };
}
export function oneLine(turn: number, snapshot: Row, text: any): string {
    const session = row(snapshot.session), label = truth(session) ? `${string(session.kind ?? null)} in progress (round ${string(session.round ?? null)})` : 'no session';
    return `Turn ${turn}: ${string(row(snapshot.scene).display_name || row(snapshot.scene).name || null)}, clock ${Math.trunc(number(row(snapshot.clock).minutes))} min, ${label}; last turn: ${chars(words(typeof text === 'string' ? text : ''), 60) || '(no delivery)'}`;
}
export function directorAdoption(graph: ModuleGraph, turn: Row, snapshot: Row, closedBy: string): Row | null {
    const director = row(row(turn.capsule).director);
    if (!director.beat)
        return null;
    const receipts = array(turn.receipts), beat = director.beat;
    const ids = (kind: string, test: (r: Row) => boolean = () => true) => receipts.filter(r => r.kind === kind && test(r)).map(r => string(r.id));
    const families = (names: string[]) => values(row(turn.calls)).flatMap(c => names.includes(row(c.result).family) ? array(c.result.receipts).map(string) : []);
    const moves = ids('move');
    let evidence: string[] = [], adopted = false;
    if (beat === 'REVEAL') {
        evidence = ids('clue', r => array(director.reveal).some(wanted => wanted.clue === r.clue));
        adopted = evidence.length > 0;
    }
    else if (beat === 'PRESSURE') {
        evidence = [...ids('time'), ...ids('roll', r => r.form === 'dice'), ...ids('delta', r => integer(r.before) && integer(r.after) && number(r.after) < number(r.before)), ...ids('session', r => r.transition === 'start')];
        adopted = evidence.length > 0;
    }
    else if (beat === 'CHOICE')
        adopted = closedBy === 'ask';
    else if (beat === 'SUBSYSTEM') {
        evidence = [...ids('session'), ...ids('roll', r => truth(r.session_kind) || r.roll_kind === 'combat_check')];
        adopted = evidence.length > 0;
    }
    else if (beat === 'CHARACTER') {
        const social = families(['social', 'psychology']);
        evidence = ids('roll', r => social.includes(r.id));
        adopted = evidence.length > 0 || array(snapshot.present).length > 0 && !moves.length;
    }
    else if (beat === 'RECOVER') {
        evidence = families(['healing', 'development']);
        adopted = evidence.length > 0 || values(row(turn.calls)).some(c => ['healing', 'development'].includes(row(c.result).family));
    }
    else if (beat === 'CUT' || beat === 'ADVANCE') {
        evidence = moves;
        adopted = evidence.length > 0;
    }
    else if (beat === 'MONTAGE') {
        evidence = ids('time');
        adopted = receipts.filter(r => r.kind === 'time').reduce((total, r) => total + Math.trunc(number(r.minutes)), 0) >= 60;
    }
    else if (beat === 'DEEPEN') {
        const core = families(['core-check']);
        evidence = ids('roll', r => core.includes(r.id));
        adopted = evidence.length > 0 && !moves.length;
    }
    else if (beat === 'PAYOFF') {
        const supporting = new Set(graph.kind('conclusion').flatMap(c => (graph.incoming.get(c.node_id) ?? []).filter(r => r.relation_kind === 'supports' && graph.nodes.has(r.from_node_id)).map(r => graph.handle(graph.nodes.get(r.from_node_id)!))));
        evidence = ids('clue', r => supporting.has(r.clue));
        adopted = evidence.length > 0;
    }
    return {
        beat,
        adopted,
        evidence
    };
}
