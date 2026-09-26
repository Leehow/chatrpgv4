/**
 * SL-76 (contract §135.32, §135.3.1; design `docs/specs/jev-driven-steps.md` D1): the three consequence candidate
 * classes -- `npc_reaction`, `clue_follow_up`, `time_cost` -- under the new clerk authority
 * `consequence_bookkeeping`. Every one of them is read from the same kernel rows `runtime/jev/candidates.ts`
 * already reads (`table.capsule`, `table.apply.options`, `table.resolve.options`) plus the SL-76 structural read
 * `capsule.where.rules[].time_cost`/`handle` (§136.10 addendum); nothing here classifies text or invents a
 * meaning `basis` does not already carry.
 *
 * Shadow only (`COC_JEV_STEPS=shadow`, the default): `runtime/jev/consequence-route.ts` routes these candidates
 * through Jev and logs the outcome, but the run driver (`hybrid-engine.ts`) never executes a cleared one while
 * shadow is on. `on` (SL-78) runs a cleared one through the same `clerkStep` gateway any other clerk candidate
 * uses (§135.4): nothing here changes for that, since a `ConsequenceCandidate` already carries everything
 * `keeperCall`/`clerkStep` need (`clerk`, `bound`, `unbound`, `basis`).
 */
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';
import type {Candidate, Json, Unbound} from './step-policy.ts';
import {guardsOf, preordainedContacts, type ObligationReads} from './obligation-candidates.ts';
import {composeSentence} from './composed-arguments.ts';

type Row = Record<string, any>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';

/** The three classes this ticket adds, plus the always-present `session_step` family name they never collide with. */
export type ConsequenceClass = 'npc_reaction' | 'clue_follow_up' | 'time_cost';
/**
 * A D1 candidate's own Noul question (design D1/D2.1): one condition, phrased so a high answer means yes. Absent
 * on a `time_cost` candidate whose shape states an amount -- that one is direct (§135.28's `stated` path), never
 * a question (D4).
 */
export interface ConsequenceNoul {instructions: string; criteria: {true: string; false: string}}
export interface ConsequenceCandidate extends Candidate {
  consequenceClass: ConsequenceClass;
  noul?: ConsequenceNoul;
}

/** The reads the three builders take: the same shape `ObligationReads` already names. */
export type ConsequenceReads = ObligationReads;

/**
 * The natural-npc package's own decision name (contract §135.2's "the natural-npc decisions in
 * `table.resolve.options`"): a fixed contract identifier, matched by equality like `core-check:ordinary-check`
 * (`runtime/jev/candidates.ts`), never a classification of text. `runtime/jev/candidates.ts`'s generic
 * `mod_contact` loop keeps reading a pending contact of this decision exactly as before SL-76 (SL-02's accepted,
 * tested candidate, `single-loop-candidates.test.mjs`); this module's `npc_reaction` reads the *same* row again,
 * additively, into the wholly separate shadow list `buildConsequenceCandidates` returns. The two candidates carry
 * different `family`/`key`/`clerk` and live in different lists (`buildCandidates` vs `buildConsequenceCandidates`);
 * only the live `mod_contact` one is ever offered to the route/compile fan-out or executed.
 */
export const NPC_REACTION_DECISION = 'natural-npc:first-impression';

/** The `resolve` tool's own closed `action.intent` vocabulary (the same source `candidates.ts`'s `resolveIntents` reads). */
function resolveIntents(): string[] {
  const tool = COC_TOOLS.find(value => value.name === 'resolve');
  const intent = object(object(object(object(tool?.parameters).properties).action).properties).intent;
  return array(intent?.enum).filter((value): value is string => typeof value === 'string');
}

/** The one investigator, when the table's profiles name exactly one; several are left unbound like `candidates.ts`'s `actorBinding`. */
function actorsOf(reads: ConsequenceReads): string[] {
  return [...new Set(array(object(reads.resolveOptions).profiles).map(row => text(object(row).actor)).filter(Boolean))];
}

/**
 * D1's `npc_reaction`: an authored NPC present in the scene this table has no first-impression receipt for. Read
 * from `capsule.mods.pending_contacts`, filtered to the natural-npc decision -- the same rows `candidates.ts`'s
 * generic `mod_contact` loop also reads and keeps offering live; this is an additional, shadow-only reading of
 * the same row, in the separate consequence list, never a replacement for that candidate. Withheld exactly as a
 * `mod_contact` candidate would be: a book that preordains this person's reaction (owner ruling Q2), or a person
 * an open obligation's guard withholds.
 */
export function npcReactionCandidates(reads: ConsequenceReads, rawInput = ''): ConsequenceCandidate[] {
  const guards = guardsOf(reads), preordained = preordainedContacts(reads);
  const actors = actorsOf(reads), out: ConsequenceCandidate[] = [];
  for (const [index, contact] of array(object(object(reads.capsule).mods).pending_contacts).map(object).entries()) {
    const decision = text(contact.decision);
    if (decision !== NPC_REACTION_DECISION) continue;
    const target = text(contact.target), rowActor = text(contact.actor);
    if (!target) continue;
    if (preordained.get(target)?.has(decision) || guards.people.has(target)) continue;
    const actor = rowActor || (actors.length === 1 ? actors[0] : '');
    const unbound: Unbound[] = [{name: 'intent', required: true, vocabulary: 'closed', options: resolveIntents()}];
    if (!actor) unbound.push({name: 'actor', required: true, vocabulary: 'closed', options: actors});
    out.push({
      key: `consequence:npc_reaction:${actor || 'unbound'}:${target}`, verb: 'resolve', family: 'npc_reaction',
      label: `${actor || 'The investigator'} engages ${target} for the first time`, source: 'capsule.mods.pending_contacts',
      bound: {decision, ...(actor ? {actor} : {}), target, goal: rawInput, method: rawInput},
      unbound, composed: ['goal', 'method'], consequenceClass: 'npc_reaction', clerk: 'consequence_bookkeeping',
      basis: {read: 'table.capsule', path: `mods.pending_contacts[${index}]`, row: contact as Json},
      noul: {
        instructions: 'Judge one fact about the player\'s declared action, not the Keeper\'s narration that may follow it: does the investigator engage '
          + `this person now -- speaks to them, approaches them, is received by them -- rather than merely notice or name them? Engaging ${target} for the `
          + 'first time is enough; how the engagement goes is not this question.',
        criteria: {true: `The declared action has the investigator engage ${target} now (${text(contact.when) || 'first meaningful contact'}).`,
          false: `The declared action does not engage ${target} now, or only notices or names them.`},
      },
    });
  }
  return out;
}

/**
 * D1's `clue_follow_up`: a scene clue the kernel already offers (its gate -- data, evaluated by the kernel before
 * it ever reached `table.apply.options.candidates` -- holds) and that is not yet discovered. Read from the same
 * `apply.options` clue rows `candidates.ts`'s plain `apply:clue` family reads; withheld the same way, by an open
 * obligation's guard. Keyed apart from that family (`consequence:clue_follow_up:…`) so the two are never confused:
 * this class is judged against what the run has *settled* this turn, the live family against the player's
 * *declared* sentence (§135.30's compile), and shadow mode never executes either of this class's rows.
 */
export function clueFollowUpCandidates(reads: ConsequenceReads): ConsequenceCandidate[] {
  const guards = guardsOf(reads), out: ConsequenceCandidate[] = [];
  for (const [index, row] of array(object(reads.applyOptions).candidates).map(object).entries()) {
    const effect = object(row.effect), description = object(row.description);
    if (text(effect.kind) !== 'clue') continue;
    const clue = text(effect.clue);
    if (!clue || text(row.guarded_by) || guards.clues.has(clue)) continue;
    const summary = text(description.summary);
    out.push({
      key: `consequence:clue_follow_up:${clue}`, verb: 'apply', family: 'clue_follow_up',
      label: `Clue ${clue} as a consequence of the settled action${summary ? `: ${summary}` : ''}`, source: 'table.apply.options',
      bound: {kind: 'clue', clue, how: composeSentence('Reached as the direct consequence of the action this run already settled')},
      composed: ['how'], unbound: [{name: 'label', required: false, vocabulary: 'open'}],
      consequenceClass: 'clue_follow_up', clerk: 'consequence_bookkeeping',
      basis: {read: 'table.apply.options', path: `candidates[${index}]`, row: row as Json},
      noul: {
        instructions: 'Judge one fact: does the action the host has already settled this turn -- the place searched, the person asked, the thing examined '
          + '-- reach this clue where the book places it? Judge only what was settled, not what the player merely said or what the Keeper might add.',
        criteria: {true: `The settled action reaches clue ${clue}${summary ? ` (${summary})` : ''}.`, false: 'The settled action does not reach this clue.'},
      },
    });
  }
  return out;
}

/** A time-cost shape's stated amount and unit, when both are given (never `round`: combat rounds do not move the clock). */
const statedAmount = (shape: Row): boolean => typeof shape.amount === 'string' && typeof shape.unit === 'string' && shape.unit !== 'round';

/**
 * D1's `time_cost`: a rule of the current scene whose own `mechanicsOf` states a time cost (SL-76's structural
 * read, `capsule.where.rules[].time_cost`/`handle`; never the rendered `mech` line). A stated amount is direct
 * (§135.28's `stated` path: `apply {kind: "time", stated: <handle>}` lets the kernel's own `stated` resolution
 * convert the unit) and carries no `noul` -- D4 never asks a question over a stated fact. An `amount_unstated`
 * shape has no closed vocabulary and no rules default for `minutes` (D2.4: a required open parameter is not
 * issued to the clerk), so this candidate carries only the `noul` -- "did this take table time" -- for shadow's
 * telemetry; a clerk that ever tried to bind it would find `minutes` unbound and open, and hand it to the Keeper
 * exactly as `clerk_unbound` already does for any other candidate (§135.28) -- SL-77/78's to wire, not this ticket's.
 */
export function timeCostCandidates(reads: ConsequenceReads): ConsequenceCandidate[] {
  const rules = array(object(object(reads.capsule).where).rules).map(object), out: ConsequenceCandidate[] = [];
  for (const [index, rule] of rules.entries()) {
    const shape = object(rule.time_cost);
    if (!Object.keys(shape).length) continue;
    const handle = text(rule.handle), label = text(rule.name) || handle || `rule ${index + 1}`;
    const basis = {read: 'table.capsule', path: `where.rules[${index}].time_cost`, row: shape as Json};
    if (statedAmount(shape)) {
      out.push({
        key: `consequence:time_cost:${handle || index}`, verb: 'apply', family: 'time_cost',
        label: `Advance the clock for "${label}" (${shape.amount} ${shape.unit})`, source: 'capsule.where.rules',
        bound: {kind: 'time', stated: handle, why: composeSentence(`"${label}" states its own time cost`)},
        composed: ['why'], unbound: [], consequenceClass: 'time_cost', clerk: 'consequence_bookkeeping', basis,
      });
    } else if (shape.amount_unstated === true) {
      out.push({
        key: `consequence:time_cost:${handle || index}`, verb: 'apply', family: 'time_cost',
        label: `"${label}" states no amount; advance the clock only if this action took table time`, source: 'capsule.where.rules',
        bound: {kind: 'time'}, unbound: [{name: 'minutes', required: true, vocabulary: 'open'}],
        consequenceClass: 'time_cost', clerk: 'consequence_bookkeeping', basis,
        noul: {
          instructions: `Judge one fact: did the action the host has already settled this turn take table time the way "${label}" does, `
            + 'whose own amount the book leaves unstated? Judge only whether time passed, not how much.',
          criteria: {true: `The settled action took table time under "${label}".`, false: 'The settled action took no table time under this rule, or none was settled.'},
        },
      });
    }
  }
  return out;
}

/** Every D1 candidate this read offers, in class order. Duplicated keys across classes never happen: each class's key is prefixed with its own class name. */
export function buildConsequenceCandidates(reads: ConsequenceReads, rawInput = ''): ConsequenceCandidate[] {
  return [...npcReactionCandidates(reads, rawInput), ...clueFollowUpCandidates(reads), ...timeCostCandidates(reads)];
}
