/**
 * Contract §201.2 and §222.1: the check the book puts in front of finding a clue, and the route by which the table found it.
 *
 * A clue's own profile (`clueProfile`, the clue-owned row or the legacy conclusion entry) states how the book has it
 * found. When that is `delivery_kind: "skill_check"` with an authored skill, the book's way is that check; the Keeper
 * Rulebook has more ways to the same information (ch. 10, pp. 199-202), and `clueRoute` names the one that stands:
 *
 * 1. `check`: a passed roll of the book's skill on this visit -- this turn or an earlier turn since the party arrived -- by
 *    an investigator or an NPC helper (whoever the Keeper let roll made the roll, ch. 5).
 * 2. `idea_roll`: an Idea roll naming this clue, passed or failed (the roll decides how the clue comes, not whether).
 * 3. `fitting_check`: the host attests (`found_by`) that Jev judged a passed roll of another skill fits the method; the
 *    receipt must be a passed roll of the visit.
 * 4. `obvious`: the host attests Jev judged the clue obvious for progress.
 * 5. `no_roll`: the host attests its check selection decided no roll this turn; the Keeper gives it by judgement.
 *
 * A `skill_check` whose skill the graph does not carry (`check required (skill unspecified)`, §30.12) is not gated here:
 * which roll would satisfy it is the Keeper's judgement, not a comparison the kernel can make.
 *
 * Nothing here reads prose. The comparison is of one rules skill identifier (NFKC, case and spacing folded) against the
 * `skill` of roll receipts; everything semantic (fit, obviousness) was judged by Jev before the host wrote `found_by`.
 */
import type { ModuleGraph } from './module-graph.js';
import { array, normalize, row, string, type Row } from './values.js';

/** Existing undiscovered clue attachments, current scene first and then the visited trail. */
export function ideaClues(graph: ModuleGraph, world: Row): Row[] {
    const found = new Set(array(world.discovered_clues).map(String)), candidates = new Map<string, Row>();
    for (const name of [world.active_scene, ...[...array(world.scene_trail)].reverse()]) {
        const scene = graph.find(string(name), ['scene']);
        if (!scene) continue;
        for (const id of graph.sceneClueIds(scene)) {
            const node = graph.nodes.get(id);
            if (node && !found.has(graph.handle(node))) candidates.set(graph.handle(node), node);
        }
    }
    return [...candidates.values()];
}

/** The book's check for a clue, when the book makes finding it a check of a named skill. */
export interface ClueCheck { skill: string; difficulty?: string }

/** The rulebook's ways to a checked clue. Closed: each names one owner of the judgement that opened it. */
export type ClueRouteKind = 'check' | 'idea_roll' | 'fitting_check' | 'obvious' | 'no_roll';
/** The routes only the host may attest (`found_by` on the effect); the kernel verifies the receipt, never the judgement. */
export const ATTESTED_ROUTES: ReadonlySet<string> = new Set<ClueRouteKind>(['fitting_check', 'obvious', 'no_roll']);

/** How a checked clue was found, as its receipt records it. */
export interface ClueRoute {
    route: ClueRouteKind;
    /** The roll receipt that opened it (routes 1-3). */
    roll?: string;
    /** Whether that roll passed (always true but for the Idea roll, which lands either way). */
    passed?: boolean;
    /** The earlier turn of the visit the roll was made on, when not this turn. */
    turn?: number;
    /** The roll was an NPC helper's. */
    helper?: boolean;
    /** Who judged the route open: Jev (fit, obvious) or the host (no roll). */
    judged?: 'jev' | 'host';
}

/** A visit's receipt with the turn it belongs to; the current turn's and the staged ones carry no `turn`. */
export interface VisitReceipt { receipt: Row; turn?: number }

/** An authored string, trimmed; anything else (absent, null, a number) is no value. Never `string()`: it spells null "None". */
const named = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export function clueCheck(graph: ModuleGraph, node: Row): ClueCheck | null {
    const profile = graph.clueProfile(node);
    if (profile.delivery_kind !== 'skill_check') return null;
    const skill = named(profile.skill);
    if (!skill) return null;
    const difficulty = named(profile.difficulty);
    return { skill, ...(difficulty ? { difficulty } : {}) };
}

const skillOf = (receipt: Row): string[] => [receipt.skill, row(receipt.check).skill].filter((value): value is string => typeof value === 'string');
const isRoll = (receipt: Row): boolean => receipt.kind === 'roll' && receipt.form !== 'dice';
const passedRoll = (receipt: Row): boolean => isRoll(receipt) && receipt.passed === true;

/**
 * Whether `receipts` hold a passed roll of the check's skill (§201.2's reading, kept for `table.owe`'s `check_skipped` count
 * and for callers that hold one turn's receipts). Any actor's: an NPC helper's roll is the Keeper's choice of roller.
 */
export function checkPassed(check: ClueCheck, receipts: readonly unknown[]): boolean {
    const wanted = normalize(check.skill);
    return array(receipts).map(row).some(receipt => passedRoll(receipt) && skillOf(receipt).some(skill => normalize(skill) === wanted));
}

/** The receipts as a visit: the current turn's (no `turn`) after the earlier turns' (each with its turn). */
export function asVisit(current: readonly unknown[], earlier: ReadonlyArray<{ turn: number; receipts: readonly unknown[] }> = []): VisitReceipt[] {
    return [...earlier.flatMap(entry => array(entry.receipts).map(receipt => ({ receipt: row(receipt), turn: entry.turn }))),
        ...array(current).map(receipt => ({ receipt: row(receipt) }))];
}

/** The visit's passed rolls of another skill than the book's: what the host may judge to fit (`details.routes.other_rolls`). */
export function otherRolls(check: ClueCheck, visit: readonly VisitReceipt[]): Array<{ id: string; skill: string; actor: string | null; goal: string | null; turn?: number }> {
    const wanted = normalize(check.skill);
    return visit.filter(({ receipt }) => passedRoll(receipt) && receipt.roll_kind !== 'idea_roll' && !skillOf(receipt).some(skill => normalize(skill) === wanted)
        && typeof receipt.id === 'string')
        .map(({ receipt, turn }) => ({ id: string(receipt.id), skill: skillOf(receipt)[0] ?? string(receipt.skill_label ?? ''),
            actor: typeof receipt.actor_label === 'string' ? receipt.actor_label : typeof receipt.actor === 'string' ? receipt.actor : null,
            goal: typeof row(receipt.check).goal === 'string' && row(receipt.check).goal ? string(row(receipt.check).goal) : null,
            ...(turn !== undefined ? { turn } : {}) }));
}

/** `found_by` as the host sends it, or null when absent; a malformed one is the caller's refusal (`foundByProblem`). */
export function foundByOf(effect: Row): Row | null {
    const value = effect.found_by;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
}

/**
 * Why a `found_by` cannot be taken, or null when it can: an unknown route, or a `fitting_check` whose roll is not a passed
 * roll of the visit. The kernel verifies the receipt; the judgement was Jev's or the host's before the attestation.
 */
export function foundByProblem(foundBy: Row, visit: readonly VisitReceipt[]): string | null {
    const route = string(foundBy.route ?? '');
    if (!ATTESTED_ROUTES.has(route)) return `found_by.route must be one of ${[...ATTESTED_ROUTES].join(', ')}`;
    if (route !== 'fitting_check') return null;
    const id = foundBy.roll;
    if (typeof id !== 'string' || !id.trim()) return 'found_by.roll names the passed roll receipt the fit was judged on';
    const hit = visit.find(({ receipt }) => receipt.id === id);
    if (!hit) return `found_by.roll ${JSON.stringify(id)} is not a roll of this visit`;
    if (!passedRoll(hit.receipt)) return `found_by.roll ${JSON.stringify(id)} did not pass`;
    return null;
}

/**
 * The route that finds `clue` on this visit, or null. Routes 1 and 2 are read from the receipts alone; routes 3-5 need the
 * host's `found_by`, already checked by `foundByProblem`.
 */
export function clueRoute(check: ClueCheck, input: { clue: string; visit: readonly VisitReceipt[]; foundBy?: Row | null }): ClueRoute | null {
    const wanted = normalize(check.skill);
    const stamp = ({ receipt, turn }: VisitReceipt): Pick<ClueRoute, 'roll' | 'turn' | 'helper'> => ({
        ...(typeof receipt.id === 'string' ? { roll: receipt.id } : {}), ...(turn !== undefined ? { turn } : {}),
        ...(receipt.actor_is_investigator === false ? { helper: true } : {}) });
    const book = input.visit.find(({ receipt }) => passedRoll(receipt) && receipt.roll_kind !== 'idea_roll' && skillOf(receipt).some(skill => normalize(skill) === wanted));
    if (book) return { route: 'check', ...stamp(book), passed: true };
    const idea = input.visit.find(({ receipt }) => isRoll(receipt) && receipt.roll_kind === 'idea_roll' && receipt.clue === input.clue);
    if (idea) return { route: 'idea_roll', ...stamp(idea), passed: idea.receipt.passed === true };
    const foundBy = input.foundBy ?? null;
    if (!foundBy || foundByProblem(foundBy, input.visit)) return null;
    const route = string(foundBy.route) as ClueRouteKind;
    if (route === 'fitting_check') {
        const hit = input.visit.find(({ receipt }) => receipt.id === foundBy.roll)!;
        return { route, ...stamp(hit), passed: true, judged: 'jev' };
    }
    return { route, judged: route === 'obvious' ? 'jev' : 'host' };
}

/**
 * §222.1: the earlier turns of this visit -- from the turn the party last moved into `scene` up to the turn before
 * `currentTurn` -- oldest first, each with the receipts made while the party was here. A turn that moved in keeps only the
 * receipts after its arrival; a turn that moved away ends the walk. `read` answers a committed turn record or null.
 */
export async function earlierVisitTurns(read: (turn: number) => Promise<Row | null>, scene: string, currentTurn: number, limit = 64):
    Promise<Array<{ turn: number; receipts: unknown[] }>> {
    const out: Array<{ turn: number; receipts: unknown[] }> = [];
    for (let turn = currentTurn - 1; turn >= Math.max(0, currentTurn - limit); turn--) {
        const record = await read(turn);
        if (!record) break;
        const receipts = array(record.receipts).map(row);
        let arrival = -1;
        receipts.forEach((receipt, index) => { if (receipt.kind === 'move' && receipt.renamed !== true && receipt.from !== receipt.to && receipt.to === scene) arrival = index; });
        if (arrival >= 0) { out.unshift({ turn, receipts: receipts.slice(arrival + 1) }); break; }
        if (receipts.some(receipt => receipt.kind === 'move' && receipt.renamed !== true && receipt.from !== receipt.to)) break;
        out.unshift({ turn, receipts });
    }
    return out;
}
