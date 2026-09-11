/** One investigator's current SAN engine; the campaign transaction owns persistence. */
import { createHash } from 'node:crypto';
import { isJsonObject, orderedObject, PythonFloat, compareUnicode } from '../json.js';
import type { PythonRandom } from '../random.js';
import type { RuleTables } from '../rules/tables.js';
import type { SettleContext } from '../resolve/context.js';
import { CheckArithmetic, rollExpression, valueError } from '../resolve/arithmetic.js';
import { array, clone, entries, integer, number, row, string, truth, type Row } from '../read/values.js';
import { closeSanityDays, scheduleSanityTreatment } from '../healing/day.js';
import { sanityInt as int, validateSanLossExpression } from './expression.js';

export const INVOLUNTARY_KINDS = Object.freeze(['cry_out', 'flee', 'freeze', 'involuntary_combat_action', 'involuntary_movement', 'jump_in_fright']);
export const BACKSTORY_FIELDS = Object.freeze(['personal_description', 'ideology_beliefs', 'significant_people', 'meaningful_locations',
    'treasured_possessions', 'traits', 'injuries_scars', 'phobias_manias', 'encounters']);
const safeId = (id: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) && !id.endsWith('\n');
const field = (value: Row, key: string, fallback: any): any => Object.hasOwn(value, key) ? value[key] : fallback;
export function sanitySnapshotName(investigator: string): string {
    if (!safeId(investigator)) { const error = new Error('investigator_id is not a stable safe id'); error.name = 'SanityStateIdentityError'; throw error; }
    return `sanity-state/${investigator}.json`;
}
export function sanityGainPendingName(investigator: string): string { return sanitySnapshotName(investigator).replace('sanity-state/', 'sanity-gain-pending/'); }
export function rebaseSanityClock(input: Row, delta: number): Row {
    const moved = clone(input), id = string(moved.investigator_id || '');
    for (const [key, prefix] of [['recovery_trigger', 'recover-temporary'], ['treatment_trigger', 'apply-treatment']]) {
        const trigger = moved[key];
        if (!isJsonObject(trigger) || !integer(trigger.due_elapsed_minutes)) continue;
        const due = trigger.due_elapsed_minutes;
        trigger.due_elapsed_minutes = typeof due === 'bigint' ? due + BigInt(delta) : number(due) + delta;
        if (trigger.trigger_id === `${prefix}:${id}:${due}`) trigger.trigger_id = `${prefix}:${id}:${trigger.due_elapsed_minutes}`;
    }
    return moved;
}
export const CLOCK_SAVE_PATHS = ['save/sanity-state','save/sanity-gain-pending'] as const;
export const rebaseClock = rebaseSanityClock;
export async function writeSanityGainPending(context: Pick<SettleContext, 'writeSave'>, investigator: string, sanGain: any, gainSource: any): Promise<void> {
    if (!integer(sanGain) || sanGain <= 0) valueError('san_gain must be a positive integer');
    const source = string(truth(gainSource) ? gainSource : '').trim();
    if (!source) valueError('gain_source must be non-empty');
    await context.writeSave(sanityGainPendingName(investigator), { schema_version: 1, investigator_id: investigator, san_gain: sanGain, gain_source: source });
}
export async function recordPsychoanalysisGainPending(context: Pick<SettleContext, 'writeSave'>, investigator: string, recovered: any, succeeded = false): Promise<boolean> {
    const amount = integer(recovered) && recovered > 0 ? recovered : succeeded ? 1 : null;
    if (amount === null) return false;
    await writeSanityGainPending(context, investigator, amount, 'psychoanalysis');
    return true;
}

export class SanitySession {
    state: Row;
    pendingRolls: Row[] = [];
    private rollCounter = 0;
    constructor(readonly investigatorId: string, readonly intValue: number, readonly rng: PythonRandom, readonly tables: RuleTables,
        readonly arithmetic: CheckArithmetic, readonly clockMinutes: number | null = null, sanMax = 99, cmValue = 0, state?: Row) {
        this.state = closeSanityDays(state ?? { investigator_id: investigatorId, san_max: sanMax, cm_value: cmValue }, investigatorId, cmValue, clockMinutes ?? 0, 0);
    }
    static async load(context: SettleContext, sheet = context.actor): Promise<SanitySession> {
        const id = string(sheet.id), name = sanitySnapshotName(id), characteristics = row(sheet.characteristics), skills = row(sheet.skills);
        const cm = int(skills['Cthulhu Mythos'] || 0), existed = await context.transaction.campaign.saveExists(name);
        const saved = existed ? await context.readSave(name) : undefined;
        if (existed && !isJsonObject(saved)) valueError('sanity snapshot root must be an object');
        const session = new SanitySession(id, int(field(characteristics, 'INT', 50)), context.rng, context.tables, context.arithmetic,
            context.clockMinutes, 99, cm, saved);
        if (!existed) {
            const formula = row(row(await context.tables.load('sanity')).max_san);
            session.state.san_max = Math.max(0, int(field(formula, 'base_max', 99)) - cm);
            const current = integer(sheet.current_san) ? int(sheet.current_san) : int(field(row(sheet.derived), 'SAN', field(characteristics, 'POW', 50)));
            session.state.san_current = current;
            session.state.day_start_san = current;
        }
        return session;
    }
    get isInsane(): boolean { return this.state.temporary_insane || this.state.indefinite_insane || this.state.permanently_insane; }
    snapshot(): Row { return clone(this.state); }
    async save(context: Pick<SettleContext, 'writeSave'>): Promise<void> { await context.writeSave(sanitySnapshotName(this.investigatorId), this.snapshot()); }
    drainPending(): Row[] { const pending = this.pendingRolls; this.pendingRolls = []; return pending; }
    private rollId(): string { return `sr${++this.rollCounter}`; }
    private event(type: string, payload: Row | string | null = null): Row {
        const event = { event_id: `se${this.state.events.length + 1}`, type, payload: typeof payload === 'string' ? { summary: payload } : payload };
        this.state.events.push(event); return event;
    }
    private lossDetail(expression: string): [number, number[]] {
        if (['0', ''].includes(string(expression).trim())) return [0, []];
        let parsed: Row;
        try { parsed = validateSanLossExpression(expression); }
        catch (error) { if ((error as Error).name === 'ValueError') return [1, []]; throw error; }
        if (parsed.kind === 'constant') return [parsed.value, []];
        const rolls = Array.from({ length: parsed.count }, () => this.rng.randint(1, parsed.sides));
        return [rolls.reduce((total, face) => total + face, parsed.modifier), rolls];
    }
    private maxLoss(expression: string): number {
        if (['0', ''].includes(string(expression).trim())) return 0;
        let parsed: Row;
        try { parsed = validateSanLossExpression(expression); }
        catch (error) { if ((error as Error).name === 'ValueError') return 1; throw error; }
        return parsed.kind === 'constant' ? parsed.value : parsed.count * parsed.sides + parsed.modifier;
    }
    private async afterLoss(source: string, lost: number, alone: boolean, override: Row | null): Promise<void> {
        const state = this.state;
        if ((state.temporary_insane || state.indefinite_insane) && lost >= 1) await this.startBout(source, alone, override);
        else if (lost >= 5) {
            const result = this.arithmetic.check(this.intValue, 'regular', 0, 0, this.rng);
            this.pendingRolls.push({ roll_id: this.rollId(), actor_id: this.investigatorId, skill: 'INT', goal: `determine temp insanity after ${source}`,
                target: this.intValue, roll: result.roll, outcome: result.outcome,
                marker: `[roll]${this.investigatorId} INT${this.intValue}:(d100->${result.roll})->${result.outcome}[/roll]` });
            if (!['failure', 'fumble'].includes(result.outcome)) {
                state.temporary_insane = true;
                const hours = this.rng.randint(1, 10);
                state.temporary_insane_remaining_hours = hours;
                await this.startBout(source, alone, override, hours);
                this.scheduleRecovery(hours);
            }
        }
        if (state.daily_san_lost >= Math.max(1, Math.floor(state.day_start_san / 5)) && !state.indefinite_insane) this.triggerIndefinite();
        if (state.san_current === 0 && !state.permanently_insane) {
            state.permanently_insane = true;
            this.event('permanent_insanity', { summary: `${this.investigatorId} SAN reached 0 → permanent insanity. Character retired.` });
        }
    }
    async sanityCheck(source: string, lossSuccess: number | string, lossFailure: string, options: {
        involuntaryKind?: string | null; involuntarySummary?: string; alone?: boolean; moduleBoutOverride?: Row | null; creatureType?: string | null;
    } = {}): Promise<Row> {
        const state = this.state;
        if (state.permanently_insane) return this.event('sanity_check_skipped', 'Investigator is permanently insane');
        if (state.bout_active) return this.event('sanity_check_skipped', 'No further SAN loss during an active bout of madness (p.157)');
        const before = state.san_current, result = this.arithmetic.check(before, 'regular', 0, 0, this.rng), rollId = this.rollId();
        let lost: number, rolls: number[] = [], resolution: string;
        if (result.outcome === 'fumble') { lost = this.maxLoss(lossFailure); resolution = 'fumble_maximum'; }
        else { [lost, rolls] = this.lossDetail(result.outcome === 'failure' ? lossFailure : string(lossSuccess)); resolution = rolls.length ? 'rolled' : 'constant'; }
        const raw = lost, hardened = state.cm_value > before, creature = options.creatureType ?? null;
        if (hardened && lost > 0) lost = Math.floor(lost / 2);
        if (creature !== null) {
            const maximum = this.maxLoss(string(lossSuccess)) + this.maxLoss(lossFailure), cumulative = state.awfulness_caps[creature] ?? 0;
            lost = Math.min(lost, Math.max(0, maximum - cumulative));
            const caps = entries(state.awfulness_caps), existing = caps.findIndex(([key]) => key === creature);
            if (existing < 0) caps.push([creature, cumulative + lost]); else caps[existing] = [creature, cumulative + lost];
            state.awfulness_caps = orderedObject(caps);
        }
        state.san_current = Math.max(0, state.san_current - lost); state.daily_san_lost += lost;
        if (lost >= 1) { state.delusion_resistant = false; state.symptoms_suppressed_until_next_san_loss = false; }
        const record: Row = { roll_id: rollId, actor_id: this.investigatorId, skill: 'SAN', goal: `withstand ${source}`, target: before,
            roll: result.roll, outcome: result.outcome, san_before: before, san_loss: lost, san_delta: -lost, san_after: state.san_current,
            mythos_hardened: hardened, san_loss_expression: ['failure', 'fumble'].includes(result.outcome) ? lossFailure : string(lossSuccess),
            san_loss_rolls: rolls, san_loss_raw_total: raw, san_loss_resolution: resolution,
            marker: `[san_check]SAN ${lossSuccess}/${lossFailure}|SAN${before}:(d100->${result.roll})->${result.outcome}|${lossFailure}->${lost}:sub(san,${lost})[/san_check]` };
        this.pendingRolls.push(record);
        const event = this.event('sanity', { source, san_before: before, san_loss: lost, san_after: state.san_current, roll_outcome: result.outcome,
            mythos_hardened: hardened, creature_type: creature, summary: `${this.investigatorId} ${source}: SAN ${before}->${state.san_current} (lost ${lost}).` });
        if (['failure', 'fumble'].includes(result.outcome) && options.involuntaryKind) {
            this.applyInvoluntary(options.involuntaryKind, options.involuntarySummary || '', source);
            record.involuntary_action = clone(state.involuntary_actions.at(-1)); event.payload.involuntary_action = clone(record.involuntary_action);
        }
        await this.afterLoss(source, lost, options.alone ?? false, options.moduleBoutOverride ?? null);
        return event;
    }
    async applyDirectLoss(source: string, expression: string, options: { multiplier?: number | bigint | PythonFloat; alone?: boolean; moduleBoutOverride?: Row | null } = {}): Promise<Row> {
        const state = this.state;
        if (state.permanently_insane) return this.event('sanity_loss_skipped', 'Investigator is permanently insane');
        if (state.bout_active) return this.event('sanity_loss_skipped', 'No further SAN loss during an active bout of madness (p.157)');
        const multiplier = options.multiplier === undefined ? new PythonFloat(1) : options.multiplier, factor = number(multiplier);
        if (typeof multiplier !== 'number' && typeof multiplier !== 'bigint' && !(multiplier instanceof PythonFloat)) valueError('direct SAN loss multiplier must be numeric');
        if (factor < 0 || factor > 1) valueError('direct SAN loss multiplier must be between 0 and 1');
        const parsed = validateSanLossExpression(expression), rolled = parsed.kind === 'constant' ? null : rollExpression(expression, this.rng);
        const raw = parsed.kind === 'constant' ? parsed.value : rolled!.total, rolls = parsed.kind === 'constant' ? [raw] : [...rolled!.rolls];
        let lost = int(raw * factor);
        const before = state.san_current, hardened = state.cm_value > before;
        if (hardened && lost > 0) lost = Math.floor(lost / 2);
        state.san_current = Math.max(0, state.san_current - lost); state.daily_san_lost += lost;
        if (lost >= 1) { state.delusion_resistant = false; state.symptoms_suppressed_until_next_san_loss = false; }
        this.pendingRolls.push({ roll_id: this.rollId(), actor_id: this.investigatorId, skill: 'SAN Loss', kind: 'san_loss', goal: source, die: expression, roll: raw, die_rolls: rolls,
            outcome: 'sanity_loss', san_before: before, san_loss: lost, san_delta: -lost, san_after: state.san_current, mythos_hardened: hardened,
            multiplier: new PythonFloat(factor), expression_kind: parsed.kind,
            marker: `[roll]SAN loss ${expression}->${raw}; multiplier=${string(multiplier)}; SAN ${before}->${state.san_current}[/roll]` });
        const event = this.event('sanity_loss', { source, loss_expr: expression, raw_loss: raw, multiplier: new PythonFloat(factor), san_before: before,
            san_loss: lost, san_after: state.san_current, mythos_hardened: hardened, summary: `${this.investigatorId} ${source}: SAN ${before}->${state.san_current} (lost ${lost}).` });
        await this.afterLoss(source, lost, options.alone ?? false, options.moduleBoutOverride ?? null);
        return event;
    }
    async startBout(source: string, alone = false, override: Row | null = null, durationHours?: number): Promise<Row> {
        const state = this.state, hours = durationHours ?? this.rng.randint(1, 10);
        const mode = truth(override?.force_mode) ? override!.force_mode : alone ? 'summary' : 'real_time';
        this.pendingRolls.push({ roll_id: this.rollId(), actor_id: this.investigatorId, skill: 'Bout Duration', kind: 'bout_duration_hours',
            goal: `bout of madness duration after ${source}`, die_expression: '1D10', roll: hours, outcome: 'rolled', target: null, bout_mode: mode,
            marker: `[die]Bout Duration 1D10:(roll->${hours})[/die]` });
        const roll = this.rng.randint(1, 10), tableKey = mode === 'summary' ? 'summary' : 'realtime';
        let table: any[] = [];
        try { table = array(row(await this.tables.load('bout-tables'))[tableKey]); } catch { /* The Python engine permits an unavailable bout table. */ }
        const entry = row(table.find(entry => int(field(entry, 'd10_roll', 0)) === roll));
        const result = truth(override?.result_description) ? override!.result_description : string(field(entry, 'result', '')), kind = string(field(entry, 'kind', ''));
        this.pendingRolls.push({ roll_id: this.rollId(), actor_id: this.investigatorId, skill: 'Bout of Madness', kind: 'bout_of_madness_table',
            goal: `bout of madness behavior (${tableKey} table) after ${source}`, die_expression: '1D10', roll, outcome: 'rolled', target: null,
            bout_mode: mode, bout_kind: kind, bout_result: result, marker: `[die]Bout of Madness (${tableKey}) 1D10:(roll->${roll})->${kind}[/die]` });
        const sequence = state.bouts_of_madness.length + 1, candidate = `${this.investigatorId}:bout:${sequence}`;
        const id = safeId(candidate) ? candidate : `bout:${createHash('sha256').update(`${this.investigatorId}\0${sequence}`, 'utf8').digest('hex')}`;
        const bout: Row = { bout_id: id, mode, summary_table: mode === 'summary' ? 'table_viii_summary' : 'table_vii_realtime', bout_roll: roll,
            bout_result: result, bout_kind: kind, duration_hours: hours, source };
        if (mode === 'real_time') {
            bout.duration_rounds = this.rng.randint(1, 10); state.bout_active = true; state.bout_rounds_remaining = bout.duration_rounds; state.active_bout_id = id;
            this.pendingRolls.push({ roll_id: this.rollId(), actor_id: this.investigatorId, skill: 'Bout Duration (rounds)', kind: 'bout_duration_rounds',
                goal: `real-time bout duration in rounds after ${source}`, die_expression: '1D10', roll: bout.duration_rounds, outcome: 'rolled', target: null,
                bout_mode: mode, marker: `[die]Bout Duration (rounds) 1D10:(roll->${bout.duration_rounds})[/die]` });
        }
        state.bouts_of_madness.push(bout);
        if (roll === 9 || roll === 10) {
            const trait = roll === 9 ? 'phobia' : 'mania', name = await this.rollTrait(trait);
            if (name) bout[trait] = name;
        }
        const amendMode = this.rng.randint(1, 4) <= 3 ? 'corrupt_existing' : 'add_irrational', backstory = this.rng.choice(BACKSTORY_FIELDS);
        bout.backstory_amend_suggestion = { mode: amendMode, backstory_field: backstory,
            keeper_note: `Tie the madness to this investigator's own story: ${amendMode === 'corrupt_existing' ? 'twist an existing entry in' : 'add a new irrational entry to'} the '${backstory}' backstory category, binding it to what just caused the bout. Negotiate the wording with the player (p.157).` };
        this.event('bout_of_madness', { ...bout, summary: `${this.investigatorId} bout of madness (${mode}): roll ${roll}, duration ${hours}h. ${result}` });
        return bout;
    }
    private async rollTrait(trait: 'phobia' | 'mania'): Promise<string | null> {
        const tableName = trait === 'phobia' ? 'phobias' : 'manias', raw = await this.tables.exists(tableName) ? row(await this.tables.load(tableName)) : {};
        const table = row(field(raw, tableName, raw)), names = entries(table).map(([name]) => name);
        if (!names.length) return null;
        const roll = this.rng.randint(1, 100), name = names[Math.min(roll - 1, names.length - 1)], entry = row(table[name]);
        const label = trait === 'phobia' ? 'Phobia' : 'Mania', roman = trait === 'phobia' ? 'IX' : 'X';
        this.pendingRolls.push({ roll_id: this.rollId(), actor_id: this.investigatorId, skill: label, kind: `${trait}_table`,
            goal: `${trait} gained from bout of madness (Table ${roman})`, die_expression: '1D100', roll, outcome: 'rolled', target: null,
            [trait]: name, marker: `[die]${label} (Table ${roman}) 1D100:(roll->${roll})->${name}[/die]` });
        this.state[trait] = name; this.state[`${trait}_tags`] = array(entry.trigger_tags).map(string);
        if (trait === 'mania') this.state.mania_unindulged = true;
        const condition = `${trait}:${name}`;
        if (!this.state.conditions.includes(condition)) this.state.conditions.push(condition);
        this.event(`${trait}_gained`, { [trait]: name, roll, trigger: field(entry, 'trigger', ''), trigger_tags: [...this.state[`${trait}_tags`]],
            summary: `${this.investigatorId} developed ${trait}: ${name} (Table ${roman} roll ${roll}).` });
        return name;
    }
    private applyInvoluntary(kind: string, summary: string, source: string): void {
        if (!INVOLUNTARY_KINDS.includes(kind)) kind = 'freeze';
        const action = { kind, summary: summary || `${kind} from ${source}`, source, rule_ref: 'core.sanity.failure_involuntary_action' };
        this.state.involuntary_actions.push(action);
        this.event('involuntary_action', { ...action, summary: `${this.investigatorId} ${kind}: ${summary || source}` });
    }
    tickBoutRound(): Row {
        if (!this.state.bout_active) return { bout_active: false, bout_rounds_remaining: 0 };
        this.state.bout_rounds_remaining = Math.max(0, this.state.bout_rounds_remaining - 1);
        if (!this.state.bout_rounds_remaining) this.endBout();
        return { bout_active: this.state.bout_active, bout_rounds_remaining: this.state.bout_rounds_remaining };
    }
    endBout(): void {
        const state = this.state;
        if (!state.bout_active) return;
        const id = state.active_bout_id;
        state.bout_active = false; state.bout_rounds_remaining = 0; state.active_bout_id = null;
        const payload: Row = { bout_id: id, summary: `${this.investigatorId} bout of madness ends; control returns to the player (underlying insanity continues).` };
        const suggestion = state.bouts_of_madness.at(-1)?.backstory_amend_suggestion;
        if (truth(suggestion)) payload.backstory_amend_suggestion = suggestion;
        this.event('bout_ended', payload);
    }
    plantDelusion(description: string, backstoryField: string | null = null): Row {
        if (!this.isInsane) valueError('Delusions may only be planted during the underlying-insanity phase (investigator must be insane).');
        if (this.state.bout_active) valueError('Cannot plant a delusion while a bout of madness is active.');
        const delusion = { description, backstory_field: backstoryField, resistant: false };
        this.state.active_delusion = delusion;
        this.event('delusion_planted', { description, backstory_field: backstoryField, summary: `${this.investigatorId} delusion planted: ${description}` });
        return delusion;
    }
    async realityCheck(rollResult: number | null = null): Promise<Row> {
        const roll = rollResult === null ? this.rng.randint(1, 100) : int(rollResult), success = roll <= this.state.san_current;
        if (success) { this.state.active_delusion = null; this.state.delusion_resistant = true; }
        else { this.state.san_current = Math.max(0, this.state.san_current - 1); this.state.daily_san_lost += 1; await this.startBout('reality_check'); }
        const result = { success, roll, rule_ref: 'core.sanity.reality_check' };
        this.event('reality_check', { ...result, summary: success
            ? `${this.investigatorId} reality check succeeds (roll ${roll} <= SAN ${this.state.san_current}); delusion cleared, resistance granted.`
            : `${this.investigatorId} reality check fails (roll ${roll}); -1 SAN, new bout triggered; delusion persists.` });
        return result;
    }
    indulgeMania(): Row {
        this.state.mania_unindulged = false;
        const result = { mania: this.state.mania, mania_unindulged: false, summary: `${this.investigatorId} indulged mania${this.state.mania ? ': ' + this.state.mania : ''}.` };
        this.event('mania_indulged', result); return result;
    }
    suppressInsanitySymptoms(): Row {
        this.state.symptoms_suppressed_until_next_san_loss = true;
        const result = { symptoms_suppressed_until_next_san_loss: true, summary: `${this.investigatorId} insanity symptoms suppressed until next SAN loss (Psychoanalysis, p.162).` };
        this.event('insanity_symptoms_suppressed', result); return result;
    }
    penaltyDieForExposure(exposureTags: Iterable<string> = []): Row {
        if (!this.isInsane) return { penalty_dice: 0, matched: [], reason: 'not_insane' };
        if (this.state.symptoms_suppressed_until_next_san_loss) return { penalty_dice: 0, matched: [], reason: 'symptoms_suppressed' };
        const owned = new Set([...this.state.phobia_tags, ...this.state.mania_tags]);
        const matched = [...new Set([...exposureTags].filter(truth).map(string))].filter(tag => owned.has(tag)).sort(compareUnicode);
        return { penalty_dice: matched.length ? 1 : 0, matched, reason: matched.length ? 'structured_exposure_match' : 'no_structured_exposure_evidence' };
    }
    private triggerIndefinite(): void {
        this.state.indefinite_insane = true;
        this.event('indefinite_insanity', { summary: `${this.investigatorId} lost >=1/5 SAN in one day → indefinite insanity.`,
            daily_san_lost: this.state.daily_san_lost, threshold: Math.max(1, Math.floor(this.state.day_start_san / 5)) });
        this.scheduleMonthlyTreatment();
    }
    scheduleMonthlyTreatment(): string | null { return this.clockMinutes === null ? null : scheduleSanityTreatment(this.state, this.clockMinutes); }
    private scheduleRecovery(hours: number): string | null {
        if (this.clockMinutes === null) return null;
        const due = int(this.clockMinutes || 0) + Math.max(0, int(hours)) * 60, id = `recover-temporary:${this.investigatorId}:${due}`;
        this.state.recovery_trigger = { trigger_id: id, handler: 'recover_temporary_insanity', due_elapsed_minutes: due, policy: 'auto_apply_if_safe', payload: { condition: 'temporary_insane' } };
        this.event('recovery_trigger_scheduled', { trigger_id: id, due_elapsed_minutes: due, remaining_hours: hours,
            summary: `${this.investigatorId} temporary-insanity recovery scheduled for elapsed>${due} (auto_apply_if_safe).` });
        return id;
    }
    recoverTemporary(): boolean {
        if (!this.state.temporary_insane) return false;
        this.state.temporary_insane = false; this.state.temporary_insane_remaining_hours = 0; this.state.recovery_trigger = null;
        this.event('sanity_recovered', { summary: `${this.investigatorId} recovered from temporary insanity.` }); return true;
    }
    endDay(): Row {
        this.state = closeSanityDays(this.state, this.investigatorId, this.state.cm_value, this.clockMinutes, 1);
        return this.state.events.at(-1);
    }
    gainSan(amount: number, source = 'reward'): void {
        const before = this.state.san_current;
        this.state.san_current = Math.min(this.state.san_max, this.state.san_current + amount);
        const actual = this.state.san_current - before;
        if (actual <= 0) return;
        this.pendingRolls.push({ roll_id: this.rollId(), actor_id: this.investigatorId, skill: 'SAN Reward', kind: 'san_reward', goal: source, die: string(amount), roll: amount,
            san_before: before, san_delta: actual, san_after: this.state.san_current, outcome: 'sanity_reward', marker: `[roll]SAN reward +${actual}: ${before}->${this.state.san_current}[/roll]` });
        this.event('sanity_gain', { amount: actual, source, san_before: before, san_after: this.state.san_current,
            summary: `${this.investigatorId} gained ${actual} SAN (${source}): ${before}->${this.state.san_current}.` });
    }
}
