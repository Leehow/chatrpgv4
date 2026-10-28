/**
 * Contract §259.4: what a person present can be asked for, and how far each thing is from being given -- grant, check
 * (the candidate social skills, each with the difficulty the rules give it) or impossible.
 *
 * Structure only, read from the graph and the ledger: the obligations the book states for this person (§134), the
 * clues they know that the investigators have not found (hidden when they hide or would lie about it), and one row for
 * an ordinary favour. Nothing here reads what the player said or which row their words are; the Keeper chooses a row
 * and a skill. Every tier and step is `npc-requests.json`'s; the difficulty thresholds are the social rule's own
 * (`socialDifficulty`). A thing this person does not know has no row: it is impossible, and saying so once in the
 * capsule note is the whole of that rule.
 */
import {join} from 'node:path';
import type {KernelContext} from '../context.js';
import {RpcError} from '../errors.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {sceneObligations, activeScene} from '../read/obligations.js';
import {array, entries, integer, number, row, string, type Row} from '../read/values.js';
import {SOCIAL_APPROACH_SKILLS} from '../resolve/arithmetic.js';
import {npcProfileOf} from '../resolve/context.js';
import {socialDifficulty} from '../resolve/social.js';
import {stanceNow} from '../combat/standing.js';
import {askKey, emptyLedgerEntry, foldNpcTurn} from '../write/contributions.js';

export const DIFFICULTIES = ['regular', 'hard', 'extreme'] as const;
const TIERS = ['grant', 'check', 'impossible'];
const KINDS = ['obligation', 'hidden_clue', 'open_clue', 'ordinary'];

/** The requests table (§259.4), checked whole when it loads. */
export async function requestsTable(context: KernelContext): Promise<Row> {
    const table = row(await context.snapshots.readJson(join(context.content, 'rulesets', 'coc7', 'rules-json', 'npc-requests.json')));
    const refuse = (message: string): never => {
        throw new RpcError('campaign_not_ready', message, {fix: 'restore content/rulesets/coc7/rules-json/npc-requests.json',
            details: {requests: {declared: table.contract_id ?? null}}});
    };
    if (table.contract_id !== 'coc.npc-requests.v1') refuse('npc-requests does not declare coc.npc-requests.v1');
    for (const kind of KINDS)
        for (const [word, tier] of entries(row(row(table.tier_by_attitude)[kind])))
            if (!TIERS.includes(string(tier))) refuse(`npc-requests tier_by_attitude.${kind}.${word} is not grant, check or impossible`);
    for (const [word, step] of entries(row(table.difficulty_shift_by_attitude)))
        if (!integer(step)) refuse(`npc-requests difficulty_shift_by_attitude.${word} is not a whole number`);
    if (!integer(table.ease_max_steps) || number(table.ease_max_steps) < 0) refuse('npc-requests ease_max_steps is a whole number');
    return table;
}

/** The difficulty `steps` from the rule's own for this opponent value, or null past extreme. */
export function shiftedDifficulty(base: string, steps: number): string | null {
    const at = DIFFICULTIES.indexOf(base as typeof DIFFICULTIES[number]) + steps;
    return at > DIFFICULTIES.length - 1 ? null : DIFFICULTIES[Math.max(0, at)];
}

/** The attitude shift for a word (§259.4), 0 when the table says nothing. */
export function attitudeShift(table: Row, word: string | null): number {
    const step = word ? row(table.difficulty_shift_by_attitude)[word] : 0;
    return integer(step) ? number(step) : 0;
}

/** Each social skill with the difficulty the rule gives it against this person, moved by `steps`; none past extreme. */
function socialSkills(graph: ModuleGraph, world: Row, handle: string, steps: number): Row[] {
    const skills = row(npcProfileOf(graph, world, handle)?.skills);
    return entries(SOCIAL_APPROACH_SKILLS).flatMap(([approach, skill]) => {
        const values = ['Psychology', string(skill)].map(key => skills[key]).filter(value => integer(value)).map(number);
        const base = string(socialDifficulty({approach}, values.length ? Math.max(...values) : null).base_difficulty);
        const difficulty = shiftedDifficulty(base, steps);
        return difficulty ? [{skill, difficulty}] : [];
    });
}

/**
 * The rows for one person (§259.4), in a fixed order -- obligations, hidden clues, open clues, the ordinary favour -- so
 * the same state numbers them the same way at `resolve` as in the capsule. `word` is their attitude toward the
 * investigator (the ledger's, §259.2).
 */
export function asksFor(graph: ModuleGraph, world: Row, node: Row, word: string | null, table: Row, blocked: Row[] = []): Row[] {
    const handle = graph.handle(node), name = graph.displayName(node), shift = attitudeShift(table, word);
    const tierOf = (kind: string) => string(row(row(table.tier_by_attitude)[kind])[string(word)] || 'check');
    const grantable = (kind: string) => word !== null && array(row(table.attitude_can_grant)[kind]).includes(word);
    const rows: Row[] = [];
    const add = (what: Row, tier: string, check?: Row) =>
        rows.push({ask: `ask_${rows.length + 1}`, what, tier, ...(check ? {check} : {})});
    for (const issued of sceneObligations(graph, world, activeScene(graph, world))) {
        const next = row(issued.next);
        if (issued.who !== name || issued.state !== 'open' || next.kind !== 'check') continue;
        const what = {kind: 'obligation', obligation: issued.handle};
        if (grantable('obligation')) { add(what, 'grant'); continue; }
        add(what, 'check', {skills: array(next.approaches).map(value => string(row(value).skill)),
            difficulty: next.difficulty_unstated === true ? null : next.difficulty, via: 'action.obligation'});
    }
    const discovered = new Set(array(world.discovered_clues));
    const hidden = new Set([...graph.npcClaims(node, 'hides'), ...graph.npcClaims(node, 'asserts')
        .filter(claim => ['authored-lie', 'authored-rumor'].includes(string(claim.truth_status)))]
        .map(claim => string(row(claim.object).node_id)));
    const clues = graph.npcKnows(node).filter(item => !discovered.has(item.handle));
    const ordered = [...clues.filter(item => hidden.has(string(item.node.node_id))), ...clues.filter(item => !hidden.has(string(item.node.node_id)))];
    for (const item of ordered.slice(0, Math.max(0, number(table.max_clue_rows)))) {
        const kind = hidden.has(string(item.node.node_id)) ? 'hidden_clue' : 'open_clue';
        clueOrFavour(graph, world, handle, {kind, clue: item.handle}, tierOf(kind), shift + kindShift(table, kind), add);
    }
    clueOrFavour(graph, world, handle, {kind: 'ordinary'}, tierOf('ordinary'), shift + kindShift(table, 'ordinary'), add);
    // §259.5: a target a failed request froze stays a row, marked with the freeze, whatever its tier would be.
    for (const item of rows) {
        const block = blocked.find(entry => entry.key === askKey(item.what));
        if (block && item.tier !== 'impossible') item.blocked = {skill: block.skill ?? null, turn: block.turn ?? null, receipt: block.receipt ?? null};
    }
    return rows;
}
const kindShift = (table: Row, kind: string): number => integer(row(table.kind_difficulty_shift)[kind]) ? number(row(table.kind_difficulty_shift)[kind]) : 0;
function clueOrFavour(graph: ModuleGraph, world: Row, handle: string, what: Row, tier: string, steps: number,
    add: (what: Row, tier: string, check?: Row) => void): void {
    if (tier !== 'check') { add(what, tier); return; }
    const skills = socialSkills(graph, world, handle, steps);
    if (skills.length) add(what, 'check', {skills});
    else add(what, 'impossible');
}

/** What one row asks for, as the card names it: the clue's handle, the obligation's, or the ordinary favour. */
const askLabel = (what: Row): string => what.kind === 'ordinary' ? 'ordinary favour' : string(what.clue || what.obligation);
/**
 * The card's compact view (§259.4): grant and impossible rows by name only (nothing is resolved for them), check rows
 * with their `ask` ref and each skill's difficulty, the way `resolve` binds them.
 */
export function asksView(rows: Row[]): Row | null {
    const open = rows.filter(item => !item.blocked), frozen = rows.filter(item => item.blocked);
    const view: Row = {}, named = (tier: string) => open.filter(item => item.tier === tier).map(item => askLabel(row(item.what)));
    const checks = open.filter(item => item.tier === 'check').map(item => {
        const check = row(item.check), what = row(item.what);
        return {ask: item.ask, for: askLabel(what), ...(what.kind === 'obligation'
            ? {via: 'action.obligation', skills: array(check.skills), difficulty: check.difficulty ?? null}
            : {skills: Object.fromEntries(array(check.skills).map(skill => [string(row(skill).skill), row(skill).difficulty]))})};
    });
    if (named('grant').length) view.grant = named('grant');
    // §259.5: frozen by a failed request: another skill, the player's push or a rise in attitude is the way back.
    if (frozen.length) view.blocked = frozen.map(item => ({ask: item.ask, for: askLabel(row(item.what)), failed: row(item.blocked).skill ?? null,
        since_turn: row(item.blocked).turn ?? null}));
    if (checks.length) view.check = checks;
    if (named('impossible').length) view.impossible = named('impossible');
    return Object.keys(view).length ? view : null;
}
/** The one line the capsule carries beside the rows. */
export const ASKS_NOTE = 'asks: grant needs no roll; check: resolve with action.ask and one of its skills (eased_by: one step easier); impossible: no roll. A good impression is not consent; what they do not know is not listed.';

/** §259.5: the targets frozen for this person now, the open turn's receipts folded in. */
export function blockedNow(graph: ModuleGraph, ledger: Row, attitude: Row, turn: Row, handle: string): Row[] {
    const node = graph.actor(handle);
    if (!node) return [];
    let entry = row(ledger[string(node.node_id)]);
    if (['open', 'acting'].includes(string(turn.state)) && array(turn.receipts).length) {
        const scratch: Row = {[string(node.node_id)]: {...emptyLedgerEntry(), ...JSON.parse(JSON.stringify(entry))}};
        foldNpcTurn(scratch, graph, {turn: turn.turn, receipts: turn.receipts}, attitude);
        entry = row(scratch[string(node.node_id)]);
    }
    return array(entry.blocked);
}

/** The attitude word toward the investigator now (§259.2), the open turn's receipts folded in; the table's start without a row. */
export function attitudeNow(graph: ModuleGraph, ledger: Row, attitude: Row, turn: Row, handle: string): string | null {
    return stanceNow(graph, ledger, attitude, turn, handle);
}

/**
 * §259.4: a `resolve` that names `action.ask` is bound to that row of its target's asks. A grant or an impossible row
 * is refused (no roll either way); an obligation row is the obligation's own resolve; a check row needs one of its
 * skills. The returned action carries the row on a host-only key (`_ask`), and the Keeper's `eased_by` reason on
 * another (`_eased_by`), which the social binding reads as one step of leverage.
 */
export function bindAsk(graph: ModuleGraph, world: Row, action: Row, word: string | null, table: Row, blocked: Row[] = []): Row {
    const ref = string(action.ask).trim();
    if (string(action.intent) !== 'social')
        throw new RpcError('invalid_params', 'action.ask is a social request: send it with intent social', {
            fix: 'set intent to social, target to the person asked and skill to one of the row\'s skills', details: {field: 'action.ask'}});
    const node = typeof action.target === 'string' ? graph.find(action.target, ['npc']) : null;
    if (!node)
        throw new RpcError('needs', 'action.ask names a row of the asked person\'s asks: name that person in action.target', {
            details: {needs: {field: 'target'}}});
    const rows = asksFor(graph, world, node, word, table, blocked), chosen = rows.find(item => item.ask === ref);
    if (!chosen)
        throw new RpcError('invalid_params', `${graph.displayName(node)} has no ${ref || 'such'} row`, {
            fix: 'name one of details.options, from this person\'s present[].asks', details: {field: 'action.ask', options: rows.map(item => item.ask)}});
    const what = row(chosen.what);
    if (chosen.tier === 'grant')
        throw new RpcError('turn_state', `${graph.displayName(node)} gives this without a roll`, {
            fix: 'tell them giving it; a willing answer needs no roll (Keeper Rulebook p.93)', details: {reason: 'ask_granted', ask: ref, what}});
    if (chosen.tier === 'impossible')
        throw new RpcError('turn_state', `nothing makes this possible from ${graph.displayName(node)} now: no roll`, {
            fix: 'tell the refusal or what they give instead; a changed situation (new evidence, a debt, a trade) changes the row', details: {reason: 'ask_impossible', ask: ref, what}});
    if (what.kind === 'obligation')
        throw new RpcError('invalid_params', `this row is the book's obligation ${string(what.obligation)}: resolve it with action.obligation`, {
            fix: `send action.obligation: ${JSON.stringify(what.obligation)} with one of its skills`, details: {field: 'action.ask', obligation: what.obligation}});
    const skills = array(row(chosen.check).skills).map(item => string(row(item).skill));
    const asked = typeof action.skill === 'string' ? action.skill.trim() : '';
    if (!skills.includes(asked))
        throw new RpcError('invalid_params', `this row is settled by one of ${skills.join(', ')}`, {
            fix: 'set action.skill to one of details.options, the approach the player\'s words take', details: {field: 'action.skill', options: skills}});
    // §259.5: the same skill on a frozen target is the failure asked again; another skill or a declared push is not.
    if (chosen.blocked && string(row(chosen.blocked).skill) === asked && action.push !== true)
        throw new RpcError('turn_state', `${graph.displayName(node)} already refused this to ${asked}; the failure stands`, {
            fix: 'tell the refusal and what they still give; another approach (another skill), new evidence, a warmer attitude or the player\'s own declared push is the way back',
            details: {reason: 'ask_blocked', ask: ref, what, failed: row(chosen.blocked)}});
    const stillOpen = rows.filter(item => item.tier === 'grant' && !item.blocked).map(item => askLabel(row(item.what)));
    const eased = typeof action.eased_by === 'string' && action.eased_by.trim() && number(table.ease_max_steps) > 0 ? action.eased_by.trim() : null;
    const {ask: _ask, eased_by: _eased, ...rest} = action;
    return {...rest, goal: typeof action.goal === 'string' && action.goal.trim() ? action.goal : string(what.clue || what.kind),
        _ask: {ask: ref, what, difficulty: row(array(row(chosen.check).skills).find(item => row(item).skill === asked)).difficulty ?? null, still_open: stillOpen},
        ...(eased ? {_eased_by: eased} : {})};
}
