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
import { RECOVERY_TAKES } from '../read/offer.js';
import { array, chars, integer, kebab, normalize, number, row, string, truth, values, words, type Row } from '../read/values.js';
import { SAY_TOKENS, isSayMarker } from './speech.js';
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
        case 'map': return part('map', receipt.map || receipt.name);
        case 'condition': return part('condition', array(receipt.gained)[0] ?? array(receipt.lost)[0]);
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
/** What the markers in a draft bound to (contract §34.14). A marker is a rendering hint, never a
 *  reason to refuse a delivery: one that names no receipt of this turn, or repeats a receipt already
 *  placed, is dropped from the text and reported back, so the player never reads a brace and the turn
 *  is not spent on the mistake. */
export interface MarkerBinding {
    /** marker name to receipt id, in the order the text placed them */
    placed: Row;
    /** markers naming no receipt of this turn; dropped from the text */
    unknown: string[];
    /** markers placed more than once; every occurrence after the first is dropped */
    duplicate: string[];
    /** the draft with the dropped occurrences removed and the bound ones left where they stand */
    text: string;
}
/** Every projected mechanic needs a delivery position. Keep explicit placements where the Keeper wrote
 * them, then append every omitted receipt marker in receipt order (contract §16.6). */
export function placeUnplacedMechanics(text: string, receipts: Row[], placed: Row): { text: string; placed: Row } {
    const names = markersFor(receipts), nextPlaced = { ...placed };
    let next = text;
    for (const receipt of receipts) {
        if (typeof receipt.id !== 'string') continue;
        const marker = names.get(receipt.id);
        if (!marker || Object.values(nextPlaced).includes(receipt.id)) continue;
        next = next.trimEnd() ? `${next.trimEnd()}\n\n{{${marker}}}` : `{{${marker}}}`;
        nextPlaced[marker] = receipt.id;
    }
    return { text: next, placed: nextPlaced };
}
export function bindMarkers(text: string, receipts: Row[]): MarkerBinding {
    const names = markersFor(receipts);
    const available = new Map([...names].map(([id, marker]) => [marker, id])), placed: Row = {}, unknown: string[] = [], duplicate: string[] = [];
    const cleaned = text.replace(MARKER, (whole: string, marker: string) => {
        // A say token is not a mechanics marker (§40.2): it names a person, not a receipt, and it stands.
        if (isSayMarker(marker))
            return whole;
        if (!available.has(marker)) {
            if (!unknown.includes(marker))
                unknown.push(marker);
            return '';
        }
        if (Object.hasOwn(placed, marker)) {
            if (!duplicate.includes(marker))
                duplicate.push(marker);
            return '';
        }
        placed[marker] = available.get(marker);
        return whole;
    });
    return { placed, unknown, duplicate, text: cleaned };
}
/** What the kernel tells the Keeper about the markers it dropped, or null when it dropped none. */
export function droppedMarkers(binding: MarkerBinding, receipts: Row[]): Row | null {
    if (!binding.unknown.length && !binding.duplicate.length)
        return null;
    return {
        ...(binding.unknown.length ? { unknown: [...binding.unknown] } : {}),
        ...(binding.duplicate.length ? { duplicate: [...binding.duplicate] } : {}),
        markers: [...markersFor(receipts).values()].sort(),
        note: 'dropped from the delivery: a marker names a receipt this turn landed, and stands at one point in the text. What was dropped named nothing this turn, or repeated one already placed; the prose went out without it.'
    };
}
export const stripMarkers = (text: string): string => text.replace(SAY_TOKENS, '').replace(MARKER, '').replace(/[ \t]{2,}/g, ' ').trim();
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
                committed.push(`${actor}'s ${skill} check ${truth(r.passed) ? 'passed' : 'failed'} (${string(r.level ?? null)}${r.visibility === 'keeper' ? '; hidden' : r.visibility === 'concealed' ? '; die concealed, the attempt is visible' : ''})`);
        }
        else if (r.kind === 'move')
            committed.push(`Scene: ${string(r.from_label || r.from || null)} -> ${string(r.to_label || r.to || null)}${number(r.minutes) > 0 ? ` (${Math.trunc(number(r.minutes))} min)` : ''}`);
        else if (r.kind === 'clue')
            committed.push(`Clue found: ${string(r.label || r.clue || null)}`);
        else if (r.kind === 'cash' && r.settlement === 'spending_level')
            committed.push(`Spending level purchase: ${string(r.subject_label || r.subject || null)} ${string(r.purchase_amount ?? null)} ${string(r.currency ?? null)}; cash unchanged at ${string(r.after ?? null)}`);
        else if (r.kind === 'delta' || r.kind === 'cash')
            committed.push(`${string(r.resource ?? null)}: ${string(r.item || r.subject_label || r.subject || null)} ${string(r.before ?? null)} -> ${string(r.after ?? null)}`);
        else if (r.kind === 'item') {
            const quantity = Math.trunc(number(r.quantity || 1));
            // Contract §97: a division is told in one sentence, because the half that stayed behind is
            // the half the Keeper otherwise has to remember it still has.
            const divided = truth(r.divided_from)
                ? ` (divided from ${string(r.divided_from)}; ${Math.trunc(number(r.remaining))} still with ${string(r.from || null)})`
                : '';
            committed.push(`Item: ${string(r.subject_label || r.subject || null)} ${quantity < 0 ? 'loses' : 'gains'} ${string(r.label || r.name || null)}${Math.abs(quantity) > 1 ? ` x${Math.abs(quantity)}` : ''}${divided}`);
        }
        else if (r.kind === 'condition') {
            const who = string(r.subject_label || r.subject || null), parts: string[] = [];
            if (array(r.gained).length)
                parts.push(`is now ${array(r.gained).map(string).join(', ')}`);
            if (array(r.lost).length)
                parts.push(`is no longer ${array(r.lost).map(string).join(', ')}`);
            committed.push(`${who} ${parts.join('; ')}`);
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
/** What the player has already been told (contract §32.6): who they play, the setup's committed prologue, and the last deliveries.
 *
 *  These are the deterministic public record, not a judgement: the verifier reads them so that a name, a commission or a
 *  research lead the Keeper already put in front of the player is not filed as a reveal of an undiscovered clue. Nothing
 *  here makes an unknown fact public -- an undiscovered clue stays Keeper-only until its receipt lands. */
export function publicContext(party: Row[], prologue: any, earlier: Row[]): string[] {
    const lines: string[] = [];
    for (const sheet of party)
        if (typeof sheet.name === 'string' && sheet.name)
            lines.push(`Investigator: ${sheet.name}${typeof sheet.occupation === 'string' && sheet.occupation ? ` (${sheet.occupation})` : ''}${typeof sheet.sex === 'string' && sheet.sex.trim() ? `; sex: ${sheet.sex.trim()}` : ''}`);
    if (typeof prologue === 'string' && prologue.trim())
        lines.push(`Setup prologue told the player: ${chars(words(prologue), 600)}`);
    for (const record of earlier.filter(r => truth(r.rendered_text)).sort((a, b) => number(a.turn) - number(b.turn)).slice(-2))
        lines.push(`Told at turn ${string(record.turn)}: ${chars(words(string(record.rendered_text)), 600)}`);
    while (lines.length && Buffer.byteLength(pythonJsonDumps(lines), 'utf8') > 2048)
        lines.pop();
    return lines;
}
export function facts(graph: ModuleGraph, world: Row, party: Row[], receipts: Row[], snapshot: Row, player: any, pub: string[] = []): Row {
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
        keeper_only: keeper,
        public: pub
    };
}
export function oneLine(turn: number, snapshot: Row, text: any): string {
    const session = row(snapshot.session), label = truth(session) ? `${string(session.kind ?? null)} in progress (round ${string(session.round ?? null)})` : 'no session';
    return `Turn ${turn}: ${string(row(snapshot.scene).display_name || row(snapshot.scene).name || null)}, clock ${Math.trunc(number(row(snapshot.clock).minutes))} min, ${label}; last turn: ${chars(words(typeof text === 'string' ? text : ''), 60) || '(no delivery)'}`;
}
/** What this turn's capsule put within reach, and what the turn actually took (contract §31).
 *
 *  An offer is a row that names an action and what it would yield. Counting offers against takes is the one
 *  signal that separates a capability nobody uses from one nobody *can* use, and both have shipped here: the
 *  0.8.2a Director advised zero times in a live run, and this tree's threat clocks were offered on every turn
 *  of a twelve-turn table with no writer behind them. Both read the same way in this ledger -- offered, never
 *  taken -- and that is the point: the difference costs one investigation instead of one slice.
 *
 *  Telemetry only, on the same law as §13.7: nothing here reaches the next capsule. An offer the Keeper keeps
 *  declining is a fact about the offer, not a debt the Keeper owes. */
/** Keep clock matching independent of display text and delimiter-shaped names. */
function clockTargetKey(target: Row): string | null {
    const threat = normalize(string(target.threat || "")), clock = normalize(string(target.clock || ""));
    return threat && clock ? JSON.stringify([threat, clock]) : null;
}
function clockOfferId(kind: "clock" | "pressure", target: Row): string {
    return `${kind}:${string(target.threat)}/${string(target.clock)}`;
}
function tickedClockTargets(receipts: Row[]): Set<string | null> {
    return new Set(receipts.filter(receipt => receipt.kind === "threat").map(clockTargetKey).filter(Boolean));
}
export function offerLedger(turn: Row, obligationSettled: (handle: string) => boolean = () => false, statedHandle: (name: string) => string | null = () => null): Row | null {
    const capsule = row(turn.capsule), receipts = array(turn.receipts);
    if (!Object.keys(capsule).length)
        return null;
    const clues = new Set(receipts.filter(r => r.kind === "clue").flatMap(r => [r.clue, r.label].filter(truth).map(v => normalize(string(v))))),
        moved = new Set(receipts.filter(r => r.kind === "move").flatMap(r => [r.to, r.to_label].filter(truth).map(v => normalize(string(v))))),
        ticked = tickedClockTargets(receipts);
    const offers: Row[] = [];
    const offer = (id: string, taken: boolean) => { if (!offers.some(o => o.id === id)) offers.push({id, taken}); };
    for (const entry of array(row(capsule.director).reveal))
        offer(`reveal:${string(row(entry).clue)}`, clues.has(normalize(string(row(entry).clue))));
    // An affordance row (contract §32.5) is an offer once it names what it yields: taken when any clue it grants lands.
    for (const entry of array(row(capsule.where).affordances)) {
        const yields = array(row(entry).clues).map(c => normalize(string(row(c).clue)));
        if (yields.length && truth(row(entry).id))
            offer(`affordance:${string(row(entry).id)}`, yields.some(name => clues.has(name)));
    }
    const mods = row(capsule.mods);
    for (const line of array(row(mods.thread).lines)) {
        for (const entry of array(row(line).here))
            offer(`clue-here:${string(row(entry).clue)}`, clues.has(normalize(string(row(entry).clue))));
        for (const entry of array(row(line).next))
            offer(`route:${string(row(entry).scene)}`, moved.has(normalize(string(row(entry).scene))));
    }
    for (const entry of array(row(mods.pacing).threat_clocks))
        if (truth(row(entry).next))
            offer(clockOfferId("clock", row(entry)), ticked.has(clockTargetKey(row(entry))));
    // Contract §134.14: an open stated obligation is an offer, taken when its flag is set (or it is waived)
    // by the time the turn closes. Counted only; it never reaches the next capsule.
    for (const entry of array(capsule.obligations))
        if (row(entry).kind === "scene" && row(entry).state === "open" && truth(row(entry).name))
            offer(`obligation:${string(row(entry).name)}`, obligationSettled(string(row(entry).name)));
    // Contract §136.24: a rule row with a `mech` line is an offer of the book's numbers, taken when a receipt of the
    // turn was rolled on it (`basis.rule`) or took its amount (`stated`). Counted only.
    const named = new Set(receipts.flatMap(r => [row(r.basis).rule, r.stated]).filter(v => typeof v === "string"));
    for (const entry of array(row(capsule.where).rules)) {
        const handle = truth(row(entry).mech) ? statedHandle(string(row(entry).name)) : null;
        if (handle)
            offer(`stated:${handle}`, named.has(handle));
    }
    const connectionOffers = array(row(mods.thread).connections).map(connection => string(connection.name));
    if (!offers.length && !connectionOffers.length)
        return null;
    return {offered: offers.map(o => string(o.id)), taken: offers.filter(o => truth(o.taken)).map(o => string(o.id)),
        ...(connectionOffers.length ? {connections: {offered: connectionOffers, adoption: 'Inspect delivered text and source/receipt context; free clarification needs no new receipt.'}} : {})};
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
        // What recovery looks like is the keeper-pacing ladder -- the world answers, a present person acts,
        // more information comes within reach -- plus the rulebook's own retry, the push. The earlier test
        // read `healing` and `development` families, which are first aid and an experience check: no rung of
        // the ladder produces either, so a turn that recovered perfectly still reported `adopted: false`
        // (campaign game-83177d61 turn 49 landed a move, an npc receipt and a clue and read as declined).
        // Measuring the wrong thing is why 43 of 52 signals looked ignored and no one could tell which were.
        const pushed = values(row(turn.calls)).some(c => truth(row(c.result).outcome) && truth(row(row(c.result).outcome).pushed));
        evidence = [...receipts.filter(r => RECOVERY_TAKES.includes(string(r.kind))).map(r => string(r.id)), ...families(['healing', 'development'])];
        adopted = evidence.length > 0 || pushed;
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
    // Turn floor (docs/specs/turn-floor.md D2): which offer rows the receipts show were taken — a move to the
    // route, a clue credited to or a stance moved on the person, a tick on the pressure's clock. Telemetry only.
    const offer = array(director.offer), taken = new Set<string>(), ticked = tickedClockTargets(receipts);
    for (const item of offer) {
        const o = row(item), who = string(o.who || ""), where = string(o.where || ""), target = row(o.target);
        const hit = o.kind === 'route' ? receipts.some(r => r.kind === 'move' && string(r.to) === where)
            : o.kind === 'person' ? receipts.some(r => (r.kind === 'clue' && truth(r.from) && sameName(graph, string(r.from), who)) || (r.kind === 'npc' && sameName(graph, string(r.name || r.handle), who)) || (r.kind === 'roll' && truth(r.npc) && sameName(graph, string(r.npc), who)))
            : o.kind === 'pressure' ? ticked.has(clockTargetKey(target))
            : false;
        if (hit)
            taken.add(o.kind === 'pressure' ? clockOfferId('pressure', target) : `${string(o.kind)}:${o.kind === 'route' ? where : who || where}`);
    }
    return {
        beat,
        adopted,
        evidence,
        ...(offer.length ? { offer_taken: [...taken] } : {})
    };
}
function sameName(graph: ModuleGraph, ref: string, name: string): boolean {
    if (!ref || !name)
        return false;
    if (ref === name)
        return true;
    const node = graph.nodes.get(ref) ?? [...graph.nodes.values()].find(n => graph.handle(n) === ref);
    return node ? graph.displayName(node) === name || graph.handle(node) === name : false;
}
