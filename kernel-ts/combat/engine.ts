/** One persisted combat session; all attacks and chase exchanges share this engine. */
import type { PythonRandom } from '../random.js';
import { isJsonObject, orderedObject } from '../json.js';
import { array, clone, entries, equal, integer, number, repr, row, sorted, string, truth, values, type Row } from '../read/values.js';
import { CheckArithmetic, valueError } from '../resolve/arithmetic.js';
import type { RuleTables } from '../rules/tables.js';
import type { HealingSavePort } from '../healing/session.js';
import { applyWoundConditions } from '../healing/resources.js';
import { fullAutoVolleySize, parseUsesPerRound, resolveModuleWeapons, UnknownWeaponError } from './catalog.js';
import { canonicalSkipSourceReceipt, damageBindingsForTurn, damageEvidenceRows, damageTransactionReceipt } from './evidence.js';
import { LEVELS, PERCENTILE_FIELDS, playerProjection, resolveOpposed, stampSkillOwnership } from './rolls.js';
import { restoreCombatSnapshot } from './snapshot.js';
export { resolveOpposed } from './rolls.js';
export const VALID_SIDES = new Set(['investigator', 'monster', 'npc']);
export const VALID_ACTIONS = new Set(['attack', 'maneuver', 'flee', 'cast', 'other', 'surprise_attack']);
export const VALID_DEFENSE = new Set<any>(['fight_back', 'dodge', 'dive_for_cover', 'maneuver', 'none', null]);
export const VALID_CONDITIONS = new Set(['major_wound', 'dying', 'stabilized', 'dead', 'unconscious', 'prone', 'grappled', 'surprised', 'outnumbered', 'fled']);
export const VALID_OUTCOMES = new Set<string | null>(['investigators_win', 'monsters_win', 'fled', 'stalemate', null]);
export const VALID_ARMOR_RULES = new Set<any>(['fixed', 'degrades_1_per_damage', null]);
export const RESOLUTION_HINTS = new Set(['skill_check', 'opposed_melee', 'firearm_attack', 'surprise_attack', 'maneuver', 'damage_only', 'spell', 'sanity_check', 'characteristic_roll', 'flee', 'aim', 'reload']);
export const MANEUVER_GOALS = new Set(['disarm', 'ongoing_disadvantage', 'escape', 'push']);
export const MANEUVER_ALIASES: Row = { grapple: 'ongoing_disadvantage', break_free: 'escape', other: 'push', restrain: 'ongoing_disadvantage', knockdown: 'push' };
const ACTION_HINTS: Row = { attack: null, surprise_attack: 'surprise_attack', maneuver: 'maneuver', cast: 'spell', flee: 'flee', other: 'skill_check', aim: 'aim', reload: 'reload' };
export interface ParticipantOptions {
    dex: number;
    combatSkill: number;
    build: number;
    hpMax: number;
    magicPoints?: number;
    armor?: number;
    armorRule?: string | null;
    weapons?: Array<Row | string> | null;
    conditions?: string[] | null;
    dodgeSkill?: number | null;
    firearmsSkill?: number | null;
    hasReadyFirearm?: boolean;
    damageBonus?: string;
    con?: number;
    mechanicsRevisionRef?: Row | null;
}
export interface CombatTurnOptions extends Row {
    action?: string | null;
    targetActorId?: string | null;
    defenseKind?: string | null;
    weaponId?: string | null;
    spell?: string | null;
    dexOverride?: number | null;
    dexReason?: string | null;
    rulebookException?: string | null;
    rangeBand?: string | null;
    pointBlank?: boolean;
    cover?: boolean;
    fastMoving?: boolean;
    maneuverKind?: string | null;
    targetWeaponId?: string | null;
    resolutionHint?: string | null;
    goal?: string | null;
    skill?: string | null;
    targetValue?: number | null;
    difficulty?: string;
    /**
     * The dice the keeper declared on this call, added to whatever the engine derives from the
     * state (aim, prone, point blank, outnumbering, build) before the one-for-one cancellation
     * in `CheckArithmetic.check` (§95). They belong to the person whose action the call resolves:
     * an attack or a maneuver is the attacker's, answering a pending attack is the defender's.
     */
    attackerBonus?: number;
    attackerPenalty?: number;
    defenderBonus?: number;
    defenderPenalty?: number;
    shots?: number | null;
    fireMode?: string | null;
    roundsFired?: number | null;
    loadAndFire?: boolean;
    suppressTargets?: string[] | null;
    diveForCoverActors?: string[] | null;
    defenderGoal?: string | null;
    luckPrecommit?: Row | null;
    resolutionCommandId?: string | null;
}
export class CombatNotStartedError extends Error {
    override name = 'CombatNotStartedError';
    readonly subsystem_error_code = 'combat_not_started';
    constructor() {
        super('no combat is underway (no canonical combat snapshot): settle decision:coc7:combat:attack against a present target to begin one -- it starts the exchange and declares the first action in the same settlement. A combat decision cannot be settled before one has started, and aim/reload/maneuver/flee/defend/end all require an exchange already in progress. (combat.context and combat.resolve are host-only operations; a Keeper cannot call either one.)');
    }
}
export function validateMechanicsRevisionRef(value: any, actorId: string): void {
    if (!isJsonObject(value) || !equal(sorted(Object.keys(value)), ['authority', 'content_sha256', 'revision', 'stable_id']))
        valueError('mechanics_revision_ref must use the exact schema');
    if (value.stable_id !== `npc:${actorId}:mechanics`)
        valueError('mechanics_revision_ref stable_id does not match actor');
    if (!integer(value.revision) || number(value.revision) <= 0)
        valueError('mechanics_revision_ref revision must be positive');
    if (typeof value.content_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.content_sha256) || value.content_sha256.length !== 64)
        valueError('mechanics_revision_ref content hash is invalid');
    if (!['source_authored', 'campaign_generated'].includes(value.authority as string))
        valueError('mechanics_revision_ref authority is invalid');
}
export class CombatSession {
    endedAtTurn: number | null = null;
    status = 'active';
    outcome: string | null = null;
    participants: Row = {};
    rounds: Row[] = [];
    damageChain: Row[] = [];
    jammedWeapons = new Set<string>();
    pendingRolls: Row[] = [];
    pendingEvents: Row[] = [];
    turnCounter = 0;
    rollCounter = 0;
    currentRound = 0;
    currentInitiative: Row[] = [];
    initiativeCursor = 0;
    initiativeProgress: Row[] = [];
    revision = 0;
    pendingAttack: Row | null = null;
    constructor(readonly combatId: string, readonly sceneRef: string, readonly startedAtTurn: number, readonly rng: PythonRandom, readonly tables: RuleTables, readonly arithmetic: CheckArithmetic, public weaponCatalog: Row) { }
    static async create(combatId: string, sceneRef: string, startedAtTurn: number, rng: PythonRandom, tables: RuleTables, moduleWeapons: Row[] = []): Promise<CombatSession> {
        const [arithmetic, catalog] = await Promise.all([CheckArithmetic.create(tables), resolveModuleWeapons(tables, moduleWeapons)]);
        return new CombatSession(combatId, sceneRef, startedAtTurn, rng, tables, arithmetic, catalog);
    }
    addParticipant(actorId: string, side: string, options: ParticipantOptions): void {
        const armorRule = options.armorRule ?? null;
        if (!VALID_SIDES.has(side))
            valueError(`invalid side ${repr(side)}`);
        if (!VALID_ARMOR_RULES.has(armorRule))
            valueError(`invalid armor_rule ${repr(armorRule)}`);
        if (Object.hasOwn(this.participants, actorId))
            valueError(`duplicate participant ${actorId}`);
        const participant: Row = { actor_id: actorId, side, dex: options.dex, combat_skill: options.combatSkill,
            dodge_skill: options.dodgeSkill ?? options.combatSkill, firearms_skill: options.firearmsSkill ?? 0, has_ready_firearm: options.hasReadyFirearm ?? false,
            build: options.build, damage_bonus: options.damageBonus ?? 'none', con: options.con ?? 50, hp_max: options.hpMax, hp_current: options.hpMax,
            magic_points: options.magicPoints ?? 0, armor: options.armor ?? 0, armor_rule: armorRule, weapons: options.weapons || [], conditions: [...options.conditions || []],
            active_effects: [], _defended_this_round: false, _dived_for_cover: false, _forfeit_next_attack: false, _aiming: false, _ammo: {}, _reload_remaining: {} };
        this.participants[actorId] = participant;
        if (options.mechanicsRevisionRef != null) {
            validateMechanicsRevisionRef(options.mechanicsRevisionRef, actorId);
            participant.mechanics_revision_ref = { ...options.mechanicsRevisionRef };
        }
    }
    beginRound(): number {
        this.currentRound++;
        for (const participant of values(this.participants))
            participant._defended_this_round = false;
        const ranked = values(this.participants).filter(p => p.hp_current > 0 && !['dying', 'unconscious', 'fled'].some(condition => p.conditions.includes(condition))).map(p => {
            const firearm = truth(p.has_ready_firearm) && number(p.firearms_skill) > 0;
            return { actor_id: p.actor_id, dex: p.dex + (firearm ? 50 : 0), dex_reason: firearm ? 'ready_firearm' : null };
        });
        ranked.sort((a, b) => b.dex - a.dex || this.participants[b.actor_id].combat_skill - this.participants[a.actor_id].combat_skill || (a.actor_id < b.actor_id ? -1 : a.actor_id > b.actor_id ? 1 : 0));
        this.currentInitiative = ranked;
        this.initiativeProgress = sorted(Object.keys(this.participants)).map(actorId => {
            const p = this.participants[actorId], initiative = ranked.find(item => item.actor_id === actorId);
            return { actor_id: actorId, round_start_eligibility: { hp_current: p.hp_current, conditions: [...p.conditions], dex: p.dex,
                    combat_skill: p.combat_skill, firearms_skill: p.firearms_skill, has_ready_firearm: p.has_ready_firearm },
                initiative: initiative ? { ...initiative } : null, status: initiative ? 'pending' : 'excluded_at_round_start', skip_evidence: null };
        });
        this.rounds.push({ round: this.currentRound, initiative_order: this.currentInitiative.map(item => ({ ...item })), initiative_progress: this.initiativeProgress.map(item => ({ ...item })), turns: [] });
        this.initiativeCursor = 0;
        return this.currentRound;
    }
    markCurrentInitiativeActed(): void {
        if (this.initiativeCursor >= this.currentInitiative.length)
            valueError('initiative cursor has no current actor');
        const id = this.currentInitiative[this.initiativeCursor].actor_id, item = this.initiativeProgress.find(item => item.actor_id === id)!;
        if (item.status !== 'pending')
            valueError('initiative actor is not pending');
        item.status = 'acted';
        this.syncInitiativeProgressHistory();
    }
    markCurrentInitiativeSkipped(): void {
        if (this.initiativeCursor >= this.currentInitiative.length)
            valueError('initiative cursor has no current actor');
        const id = this.currentInitiative[this.initiativeCursor].actor_id, participant = this.participants[id], item = this.initiativeProgress.find(item => item.actor_id === id)!;
        if (item.status !== 'pending')
            valueError('initiative actor is not pending');
        const receipt = canonicalSkipSourceReceipt(id, this.rounds.at(-1)!, this.damageChain);
        if (!receipt)
            valueError('initiative skip lacks an authoritative source transition');
        item.status = 'skipped_ineligible';
        item.skip_evidence = { hp_current: participant.hp_current, conditions: [...participant.conditions], source_receipt: receipt };
        this.syncInitiativeProgressHistory();
    }
    private syncInitiativeProgressHistory(): void { if (this.rounds.length)
        this.rounds.at(-1)!.initiative_progress = this.initiativeProgress.map(item => ({ ...item })); }
    private markDefended(id: string | null): void { if (id !== null && this.participants[id])
        this.participants[id]._defended_this_round = true; }
    private markDivedForCover(id: string): void { if (this.participants[id]) {
        this.participants[id]._dived_for_cover = true;
        this.participants[id]._forfeit_next_attack = true;
    } }
    hasDefendedThisRound(id: string): boolean { return row(this.participants[id])._defended_this_round ?? false; }
    isForfeitingAttack(id: string): boolean { return truth(row(this.participants[id])._forfeit_next_attack); }
    clearForfeit(id: string): void { if (this.participants[id]) {
        this.participants[id]._forfeit_next_attack = false;
        this.participants[id]._dived_for_cover = false;
    } }
    getAmmo(actor: string, weaponId: string): number | null {
        const weapon = this.weapon(actor, weaponId), magazine = weapon.magazine;
        if (magazine == null)
            return null;
        const ammo = this.participants[actor]._ammo ??= {}, resource = string(weapon.object_id ?? weaponId);
        if (!Object.hasOwn(ammo, resource))
            ammo[resource] = weapon.object_id ? number(weapon.ammo ?? 0) : Math.trunc(number(magazine));
        return Math.trunc(number(ammo[resource]));
    }
    setAmmo(actor: string, weaponId: string, rounds: number): void {
        const weapon = this.weapon(actor, weaponId), magazine = weapon.magazine, value = Math.max(0, Math.trunc(rounds));
        (this.participants[actor]._ammo ??= {})[string(weapon.object_id ?? weaponId)] = magazine != null ? Math.min(value, Math.trunc(number(magazine))) : value;
    }
    private consumeAmmo(actor: string, id: string, count = 1): number {
        const current = this.getAmmo(actor, id);
        if (current === null)
            return count;
        const spent = Math.min(current, Math.max(0, Math.trunc(count)));
        this.setAmmo(actor, id, current - spent);
        return spent;
    }
    private clearAiming(actor: string): void { if (this.participants[actor])
        this.participants[actor]._aiming = false; }
    private turn(actor: string, dex: number | null = null, reason: string | null = null): Row {
        return { turn_id: `t${this.currentRound}-${++this.turnCounter}`, actor_id: actor, dex: dex ?? this.participants[actor].dex, dex_reason: reason,
            declared_intent: null, action: null, target_actor_id: null, roll_id: null, opposed_roll_id: null, opposed_outcome: null, defense_kind: null, outcome: null, effect_applied: null, damage_roll_id: null };
    }
    private bindDamageProvenance(turn: Row): void {
        const bindings = new Map(damageBindingsForTurn(turn).map(value => [value.damage_roll_id, value]));
        for (const damage of this.damageChain) {
            if (damage.source_turn_id !== turn.turn_id || typeof damage.damage_roll_id !== 'string')
                continue;
            const binding = bindings.get(damage.damage_roll_id);
            if (!binding)
                valueError('damage roll is not owned by its combat turn');
            damage.provenance = damageTransactionReceipt(this.currentRound, turn, damage, binding);
        }
    }
    damageEvidenceRows(_commandActorId: string): Row[] { return damageEvidenceRows(this.combatId, this.rounds, this.damageChain); }
    private rollId(): string { return `${this.combatId}:cr${++this.rollCounter}`; }
    percentile(actor: string, skill: string, target: number, goal: string, difficulty = 'regular', bonus = 0, penalty = 0, ranged = false): [
        string,
        Row
    ] {
        target = Math.max(1, Math.min(99, target));
        const result = this.arithmetic.check(target, difficulty, bonus, penalty, this.rng), id = this.rollId();
        const mods = [...(bonus ? [`+${bonus}bonus`] : []), ...(penalty ? [`-${penalty}penalty`] : [])];
        const tens = array(result.tens_values).map(number), units = result.units;
        let unmodified: number | null = null, bonusOnly = false;
        if (number(result.bonus) > 0 && number(result.penalty) === 0 && tens.length >= 2 && units !== null) {
            unmodified = tens[0] * 10 + number(units) || 100;
            bonusOnly = truth(result.passed) && !truth(this.arithmetic.resolve(unmodified, result.base_target, result.required_level).passed);
        }
        else if (tens.length && units !== null)
            unmodified = tens[0] * 10 + number(units) || 100;
        const record: Row = { roll_id: id, roll_role: 'percentile_check', actor_id: actor, skill, goal,
            ...Object.fromEntries(PERCENTILE_FIELDS.map(field => [field, result[field]])), roll: result.roll, bonus, penalty,
            effective_modifier: { bonus: number(result.bonus), penalty: number(result.penalty), net: number(result.bonus) - number(result.penalty) },
            tens_values: tens, units: units === null ? null : number(units), unmodified_roll: unmodified, bonus_die_only_success: bonusOnly,
            excluded_outcome: bonusOnly ? 'bonus_die_only_success' : null, ranged,
            marker: `[roll]${actor} ${skill}${target}${mods.length ? '[' + mods.join(',') + ']' : ''}:(d100->${result.roll})->${result.outcome}[/roll]` };
        const side = row(this.participants[actor]).side;
        if (VALID_SIDES.has(side))
            record.subject = { kind: side, id: actor };
        stampSkillOwnership(record, actor, null);
        record.player_projection = playerProjection(record);
        this.pendingRolls.push(record);
        return [result.outcome, record];
    }
    private applyLuckToRoll(record: Row, points: number, currentLuck: number): [
        string,
        Row
    ] {
        const original = number(record.roll), adjusted = this.arithmetic.spendLuck({ roll: original, ...Object.fromEntries(PERCENTILE_FIELDS.map(field => [field, record[field]])) }, points, currentLuck, 'skill');
        Object.assign(record, { original_roll: original, roll: number(adjusted.roll), adjusted_roll: number(adjusted.roll), luck_spent: number(adjusted.luck_spent), luck_before: currentLuck, luck_after: number(adjusted.luck_remaining), luck_remaining: number(adjusted.luck_remaining) });
        for (const field of PERCENTILE_FIELDS)
            record[field] = adjusted[field];
        record.improvement_tick_eligible = false;
        record.rule_ref = 'core.optional.spending_luck';
        record.player_projection = playerProjection(record);
        record.marker = `[roll]${record.actor_id} ${record.skill}${record.target}:(d100->${original}; Luck-${points}->${record.adjusted_roll})->${record.outcome}[/roll]`;
        const event = { event_type: 'combat_luck_spent', actor_id: record.actor_id, source_roll_id: record.roll_id, original_roll: original,
            adjusted_roll: record.adjusted_roll, luck_spent: points, luck_before: currentLuck, luck_after: adjusted.luck_remaining, outcome: record.outcome,
            required_level: record.required_level, required_target: record.required_target, achieved_level: record.achieved_level, passed: record.passed,
            surplus_levels: record.surplus_levels, rule_ref: 'core.optional.spending_luck' };
        this.pendingEvents.push(event);
        return [record.outcome, event];
    }
    private opposedLuck(attacker: string, defender: string, attack: string, attackRecord: Row, defense: string, defenseRecord: Row, kind: string, precommit: Row | null): [
        string,
        string,
        string,
        Row | null
    ] {
        const opposed = resolveOpposed(attack, defense, kind), unchanged: [
            string,
            string,
            string,
            null
        ] = [attack, defense, opposed, null];
        if (!isJsonObject(precommit))
            return unchanged;
        const actor = precommit.actor_id, isAttack = actor === attacker;
        if (!isAttack && actor !== defender)
            return unchanged;
        const record = isAttack ? attackRecord : defenseRecord, wins = new Set(['attacker_higher', 'tie_attacker_wins']);
        if ((isAttack ? wins.has(opposed) : !wins.has(opposed)) || ['critical', 'fumble'].includes(record.outcome))
            return unchanged;
        const luck = number(precommit.current_luck), cap = Math.min(number(precommit.max_points), luck), original = number(record.roll);
        for (let points = 1; points <= Math.min(cap, original - 2); points++) {
            const next = this.arithmetic.resolve(original - points, number(record.base_target), string(record.required_level)).outcome;
            const candidate = resolveOpposed(isAttack ? next : attack, isAttack ? defense : next, kind);
            if (!(isAttack ? wins.has(candidate) : !wins.has(candidate)))
                continue;
            const [adjusted, event] = this.applyLuckToRoll(record, points, luck);
            return [isAttack ? adjusted : attack, isAttack ? defense : adjusted, candidate, event];
        }
        return unchanged;
    }
    weapon(actor: string, weaponId: string | null = null): Row {
        const participant = this.participants[actor];
        const unarmed = () => ({ weapon_id: 'unarmed', skill: 'Fighting (Brawl)', damage: '1D3', adds_damage_bonus: true, impales: false, special: null, ...row(this.weaponCatalog.unarmed) });
        if (weaponId === null) {
            if (!participant.weapons.length)
                return { ...unarmed(), weapon_id: 'unarmed' };
            weaponId = isJsonObject(participant.weapons[0]) ? participant.weapons[0].weapon_id : participant.weapons[0];
        }
        const found = participant.weapons.find((weapon: any) => (isJsonObject(weapon) ? weapon.weapon_id : weapon) === weaponId), override = row(found);
        if (string(weaponId) === 'unarmed')
            return { ...unarmed(), ...override, weapon_id: 'unarmed' };
        const hit = Object.hasOwn(this.weaponCatalog, string(weaponId)), entry: Row = { ...row(this.weaponCatalog[string(weaponId)]), ...override, weapon_id: weaponId };
        const complete = string(entry.skill || '').trim() && string(entry.damage || '').trim();
        if (!hit && !complete)
            throw new UnknownWeaponError(string(weaponId));
        if (complete) {
            if (!Object.hasOwn(entry, 'adds_damage_bonus'))
                entry.adds_damage_bonus = true;
            if (!Object.hasOwn(entry, 'impales'))
                entry.impales = false;
        }
        if (!Object.hasOwn(entry, 'special'))
            entry.special = null;
        return entry;
    }
    private weaponDbExpression(attacker: Row, weapon: Row, half: boolean | null = null): string | null {
        if (!truth(weapon.adds_damage_bonus))
            return null;
        const db = attacker.damage_bonus ?? 'none';
        if (!truth(db) || ['none', '0', ''].includes(string(db).toLowerCase()))
            return null;
        const special = string(weapon.special || '').toLowerCase(), skill = string(weapon.skill || '');
        const useHalf = half ?? (special.includes('half db') || special.includes('half damage bonus') || skill.startsWith('Throw'));
        return useHalf ? `half:${string(db)}` : string(db);
    }
    private malfunction(actor: string, weapon: Row, roll: number, turnId: string): Row | null {
        if (weapon.malfunction == null)
            return null;
        const threshold = Math.trunc(number(weapon.malfunction));
        if (!Number.isFinite(threshold) || roll < threshold)
            return null;
        const id = weapon.weapon_id ?? '', resource = string(weapon.object_id ?? id);
        this.jammedWeapons.add(`${actor}:${resource}`);
        const event = { malfunction_roll_id: this.rollId(), source_turn_id: turnId, source_actor_id: actor, weapon_id: id,
            weapon_display_name: weapon.display_name ?? id, roll, malfunction_threshold: threshold, effect: 'jammed_until_repaired',
            marker: `[malfunction]${id} roll ${roll} >= ${threshold}: jammed, unusable until repaired[/malfunction]` };
        this.damageChain.push(event);
        this.pendingEvents.push({ event_type: 'weapon_malfunction', actor_id: actor, weapon_id: id, roll, threshold,
            summary: `${actor} ${id} malfunction (roll ${roll} >= ${threshold}); jammed.` });
        return event;
    }
    private rollDamageExpression(expression: string): [
        number,
        number[],
        string
    ] {
        let total = 0;
        const dice: number[] = [], breakdown: string[] = [];
        for (const part of expression.replaceAll('-', '+-').split('+').map(value => value.trim()).filter(Boolean)) {
            const match = /^(\d+)D(\d+)$/.exec(part);
            if (match) {
                const rolls = Array.from({ length: Number(match[1]) }, () => this.rng.randint(1, Number(match[2]))), sum = rolls.reduce((a, b) => a + b, 0);
                dice.push(...rolls);
                total += sum;
                breakdown.push(`${part}(${rolls.join('+')}=${sum})`);
            }
            else {
                if (!/^[+-]?\d+(?:_\d+)*$/.test(part))
                    valueError(`unsupported damage token: ${repr(part)} in ${repr(expression)}`);
                const modifier = Number(part.replaceAll('_', ''));
                total += modifier;
                breakdown.push(String(modifier));
            }
        }
        return [total, dice, breakdown.join('+')];
    }
    private maxDamage(expression: string): number {
        let total = 0;
        for (const raw of expression.replaceAll('-', '+-').split('+')) {
            const part = raw.trim(), match = /^(\d+)D(\d+)$/.exec(part);
            if (match)
                total += Number(match[1]) * Number(match[2]);
            else if (/^[+-]?\d+(?:_\d+)*$/.test(part))
                total += Number(part.replaceAll('_', ''));
        }
        return total;
    }
    private damageRoll(expression: string, source: string, targetId: string, weaponId: string | null, turnId: string, bypass = false, exception: string | null = null, dbExpression: string | null = null): [
        number,
        string,
        Row
    ] {
        let full = expression, halfDb: Row | null = null;
        if (dbExpression) {
            let db = dbExpression.trim(), half = false;
            if (db.toLowerCase().startsWith('half:')) {
                half = true;
                db = db.slice(5).trim();
            }
            if (db && !['none', '0'].includes(db.toLowerCase())) {
                if (!db.startsWith('+') && !db.startsWith('-'))
                    db = '+' + db;
                if (half) {
                    const [raw, rolls] = this.rollDamageExpression(db.startsWith('+') ? db.slice(1) : db), value = Math.floor(raw / 2);
                    halfDb = { db_raw: raw, db_rolls: rolls, half: value };
                    if (value !== 0)
                        full = `${expression}${value >= 0 ? '+' : ''}${value}`;
                }
                else
                    full = expression + db;
            }
        }
        const [rolledTotal, dice, breakdown] = this.rollDamageExpression(full);
        let metadata: Row = {};
        try {
            metadata = this.weapon(source, weaponId);
        }
        catch (error) {
            if (!(error instanceof UnknownWeaponError) && (error as Error).name !== 'ValueError' && (error as Error).name !== 'KeyError')
                throw error;
        }
        const multiplier = metadata.active_damage_multiplier ?? 1, effects = metadata.active_weapon_effect_ids || [];
        if (!integer(multiplier) || number(multiplier) < 1 || number(multiplier) > 10)
            valueError('active weapon damage multiplier is invalid');
        if (!Array.isArray(effects) || effects.some(value => typeof value !== 'string' || !value))
            valueError('active weapon effect ids are invalid');
        const raw = rolledTotal * number(multiplier), id = this.rollId(), target = this.participants[targetId], before = target.hp_current, armorBefore = target.armor;
        let absorbed = 0, remaining = raw;
        if (!bypass && armorBefore > 0) {
            absorbed = Math.min(armorBefore, remaining);
            remaining -= absorbed;
            if (target.armor_rule === 'degrades_1_per_damage')
                target.armor = Math.max(0, armorBefore - absorbed);
        }
        const after = Math.max(0, before - remaining);
        target.hp_current = after;
        if (remaining > 0)
            this.clearAiming(targetId);
        const record = { damage_roll_id: id, source_turn_id: turnId, source_actor_id: source, target_actor_id: targetId, weapon_id: weaponId,
            die: full, die_rolls: dice, rolled_total: rolledTotal, raw_damage: raw, damage_multiplier: multiplier, weapon_effect_ids: [...effects],
            hp_before: before, hp_delta: after - before, hp_after: after, armor_absorbed: absorbed, armor_before: armorBefore, armor_after: target.armor,
            rulebook_exception: exception, bypass_armor: bypass, half_damage_bonus: halfDb, marker: `[roll]${expression}:${breakdown}${multiplier !== 1 ? 'x' + multiplier : ''}->${raw}:damage[/roll]` };
        this.damageChain.push(record);
        this.pendingRolls.push({ roll_id: id, roll_role: 'amount', actor_id: source, skill: 'HP Damage', kind: 'hp_damage', goal: `damage ${targetId} with ${string(weaponId)}`,
            target_actor_id: targetId, die: full, rolled_total: rolledTotal, effect_total: raw, damage_multiplier: multiplier, weapon_effect_ids: [...effects],
            dice: { expression: full, raw: [...dice], total: raw }, outcome: 'damage_applied', marker: record.marker });
        return [raw, id, record];
    }
    private extremeDamage(record: Row, weapon: Row, attacker: Row): void {
        const target = this.participants[record.target_actor_id];
        if (!truth(target))
            return;
        const weaponMax = this.maxDamage(weapon.damage), db = this.weaponDbExpression(attacker, weapon), dbMax = db ? this.maxDamage(db) : 0;
        const impale = weapon.impales ?? false, multiplier = number(weapon.active_damage_multiplier || 1);
        let raw = (weaponMax + dbMax) * multiplier, breakdown = `extreme: max_weapon(${weaponMax})+max_db(${dbMax})`;
        if (multiplier !== 1)
            breakdown += `*effect_multiplier(${multiplier})`;
        if (truth(impale)) {
            const [extra] = this.rollDamageExpression(weapon.damage);
            raw += extra * multiplier;
            breakdown += `+impale_extra_roll(${extra})`;
        }
        const before = record.hp_before, armorBefore = record.armor_before ?? target.armor ?? 0;
        let absorbed = 0, remaining = raw;
        if (!truth(record.bypass_armor) && armorBefore > 0) {
            absorbed = Math.min(armorBefore, remaining);
            remaining -= absorbed;
            if (target.armor_rule === 'degrades_1_per_damage')
                target.armor = Math.max(0, armorBefore - absorbed);
        }
        const after = Math.max(0, before - remaining);
        target.hp_current = after;
        Object.assign(record, { raw_damage: raw, hp_delta: after - before, hp_after: after, armor_absorbed: absorbed, armor_after: target.armor,
            impale_or_max: true, extreme_damage: true, extreme_breakdown: breakdown, is_impale: impale });
    }
    applyEffect(target: string, effect: string, source: string, remainingRounds: number, metadata: Row = {}): void {
        this.participants[target].active_effects.push({ effect, source_actor_id: source, applied_round: this.currentRound, remaining_rounds: remainingRounds, metadata: truth(metadata) ? metadata : {} });
    }
    tickEffects(): void {
        for (const participant of values(this.participants)) {
            for (const effect of participant.active_effects)
                effect.remaining_rounds = Math.max(0, effect.remaining_rounds - 1);
            participant.active_effects = participant.active_effects.filter((effect: Row) => effect.remaining_rounds > 0);
        }
    }
    isDominated(actor: string): boolean { return this.participants[actor].active_effects.some((effect: Row) => effect.effect === 'dominated'); }
    private updateConditions(targetId: string | null): void {
        if (targetId === null || !this.participants[targetId])
            return;
        const participant = this.participants[targetId];
        let worst = 0;
        for (const damage of this.damageChain)
            if (damage.target_actor_id === targetId)
                worst = Math.max(worst, number(damage.raw_damage) - number(damage.armor_absorbed));
        applyWoundConditions(participant, worst, () => this.percentile(targetId, 'CON', number(participant.con ?? 50), 'remain conscious after a major wound'));
    }
    conclude(outcome: string | null): void { if (!VALID_OUTCOMES.has(outcome))
        valueError(`invalid outcome ${repr(outcome)}`); this.status = 'concluded'; this.outcome = outcome; }
    snapshot(): Row {
        return { schema_version: 2, combat_id: this.combatId, scene_ref: this.sceneRef, started_at_turn: this.startedAtTurn, ended_at_turn: this.endedAtTurn,
            status: this.status, outcome: this.outcome, participants: values(this.participants).map(value => ({ ...value })), rounds: this.rounds.map(value => ({ ...value })),
            damage_chain: this.damageChain.map(value => ({ ...value })), revision: this.revision, current_round: this.currentRound,
            current_initiative: this.currentInitiative.map(value => ({ ...value })), initiative_cursor: this.initiativeCursor,
            initiative_progress: this.initiativeProgress.map(value => ({ ...value })), jammed_weapons: sorted(this.jammedWeapons),
            weapon_catalog: orderedObject(entries(this.weaponCatalog).map(([key, value]) => [key, { ...value }])), turn_counter: this.turnCounter, roll_counter: this.rollCounter,
            pending_attack: isJsonObject(this.pendingAttack) ? { ...this.pendingAttack } : null };
    }
    async save(port: HealingSavePort): Promise<void> { await port.writeSave('combat.json', this.snapshot()); }
    static async load(port: HealingSavePort, rng: PythonRandom, tables: RuleTables, options: {
        damageEvidence?: Row[] | null;
        damageEvidenceActor?: string | null;
        trustedInMemory?: boolean;
    } = {}): Promise<CombatSession> {
        const data = await port.readSave('combat.json');
        if (data === null)
            throw new CombatNotStartedError();
        if (!isJsonObject(data) || data.schema_version !== 2)
            valueError('unsupported combat snapshot schema');
        const session = await CombatSession.create(string(data.combat_id), string(data.scene_ref), number(data.started_at_turn), rng, tables);
        restoreCombatSnapshot(session, data, options);
        return session;
    }
    drainPending(): [
        Row[],
        Row[]
    ] { const result: [
        Row[],
        Row[]
    ] = [this.pendingRolls, this.pendingEvents]; this.pendingRolls = []; this.pendingEvents = []; return result; }
    declareAndResolveTurn(actorId: string, intent: string, options: CombatTurnOptions = {}): Row {
        const action = options.action ?? null, target = options.targetActorId ?? null, defense = options.defenseKind ?? null, weaponId = options.weaponId ?? null;
        let hint = options.resolutionHint ?? null, goal = options.goal ?? null, defenderGoal = options.defenderGoal ?? null;
        if (hint === null) {
            if (action === null)
                valueError('provide either resolution_hint or action');
            if (!Object.hasOwn(ACTION_HINTS, action) && !VALID_ACTIONS.has(action))
                valueError(`invalid action ${repr(action)}`);
            if (action === 'attack') {
                const weapon = weaponId || this.participants[actorId].weapons.length ? this.weapon(actorId, weaponId) : {};
                hint = string(weapon.skill ?? '').startsWith('Firearms') ? 'firearm_attack' : 'opposed_melee';
            }
            else
                hint = ACTION_HINTS[action] ?? action;
        }
        if (hint === null || !RESOLUTION_HINTS.has(hint))
            valueError(`invalid resolution_hint ${repr(hint)}`);
        if (!VALID_DEFENSE.has(defense))
            valueError(`invalid defense_kind ${repr(defense)}`);
        if (goal === null && options.maneuverKind != null)
            goal = options.maneuverKind;
        if (goal !== null) {
            const normalized: string = MANEUVER_ALIASES[goal] ?? goal;
            goal = normalized;
            if (!MANEUVER_GOALS.has(normalized))
                valueError(`invalid goal ${repr(goal)}; expected one of {'disarm', 'ongoing_disadvantage', 'escape', 'push'}`);
        }
        if (defenderGoal !== null) {
            const normalized: string = MANEUVER_ALIASES[defenderGoal] ?? defenderGoal;
            defenderGoal = normalized;
            if (!MANEUVER_GOALS.has(normalized))
                valueError(`invalid defender_goal ${repr(defenderGoal)}; expected one of {'disarm', 'ongoing_disadvantage', 'escape', 'push'}`);
        }
        const turn = this.turn(actorId, options.dexOverride ?? null, options.dexReason ?? null);
        Object.assign(turn, { declared_intent: intent, resolution_hint: hint, action: action || hint, target_actor_id: target });
        if (options.resolutionCommandId != null) {
            if (typeof options.resolutionCommandId !== 'string' || !options.resolutionCommandId)
                valueError('resolution_command_id must be a non-empty string');
            turn.resolution_command_id = options.resolutionCommandId;
        }
        if (goal)
            turn.goal = goal;
        const outnumbered = !!target && this.hasDefendedThisRound(target);
        if (hint === 'spell')
            this.resolveCast(turn, actorId, target, options.spell ?? null);
        else if (hint === 'aim')
            this.resolveAim(turn, actorId, weaponId);
        else if (hint === 'reload')
            this.resolveReload(turn, actorId, weaponId);
        else if (['opposed_melee', 'firearm_attack'].includes(hint))
            this.resolveAttack(turn, actorId, target, defense, weaponId, { ...options, outnumberedPenalty: outnumbered, defenderGoal });
        else if (hint === 'surprise_attack')
            this.resolveSurpriseAttack(turn, actorId, target, weaponId);
        else if (hint === 'maneuver')
            this.resolveManeuver(turn, actorId, target, defense, goal || 'ongoing_disadvantage', options.targetWeaponId ?? null, outnumbered, defenderGoal, options);
        else if (hint === 'flee')
            this.resolveFlee(turn, actorId);
        else if (hint === 'skill_check')
            this.resolveSkillCheck(turn, actorId, options.skill || 'Spot Hidden', options.targetValue || 50, options.difficulty ?? 'regular', intent);
        else if (hint === 'characteristic_roll')
            this.resolveSkillCheck(turn, actorId, options.skill || 'STR', options.targetValue || 50, 'regular', intent);
        else if (hint === 'sanity_check') {
            if (options.targetValue == null)
                turn.outcome = 'sanity_check_no_target_value';
            else
                this.resolveSkillCheck(turn, actorId, 'SAN', options.targetValue, 'regular', intent);
        }
        else if (hint === 'damage_only')
            this.resolveDamageOnly(turn, actorId, target, weaponId, options.rulebookException ?? null);
        this.updateConditions(target);
        for (const damage of this.damageChain)
            if (damage.source_turn_id === turn.turn_id) {
                const participant = this.participants[damage.target_actor_id];
                if (isJsonObject(participant))
                    damage.status_after = { hp_current: participant.hp_current, conditions: [...array(participant.conditions)] };
            }
        this.bindDamageProvenance(turn);
        this.rounds.at(-1)!.turns.push(turn);
        return turn;
    }
    private resolveAim(turn: Row, actor: string, weaponId: string | null): void {
        this.participants[actor]._aiming = true;
        Object.assign(turn, { defense_kind: 'none', opposed_outcome: 'unopposed', outcome: 'aiming', weapon_id: weaponId, effect_applied: { effect: 'aiming', target_actor_id: actor } });
    }
    private resolveReload(turn: Row, actor: string, weaponId: string | null): void {
        if (!weaponId)
            for (const item of this.participants[actor].weapons) {
                const id = isJsonObject(item) ? item.weapon_id : item;
                if (this.weapon(actor, id).magazine != null) {
                    weaponId = id;
                    break;
                }
            }
        const weapon = this.weapon(actor, weaponId), magazine = weapon.magazine;
        if (magazine == null) {
            Object.assign(turn, { outcome: 'reload_not_applicable', defense_kind: 'none', opposed_outcome: 'unopposed' });
            return;
        }
        const rounds = number(weapon.reload_rounds || 1), per = number(weapon.ammo_per_reload_round || magazine), remaining = this.participants[actor]._reload_remaining ??= {};
        const id = string(weaponId), resource = string(weapon.object_id ?? id), left = number(remaining[resource] ?? rounds) - 1, current = this.getAmmo(actor, id) || 0, loaded = Math.min(number(magazine) - current, per);
        this.setAmmo(actor, id, current + loaded);
        Object.assign(turn, { defense_kind: 'none', opposed_outcome: 'unopposed', weapon_id: weaponId, ammo_loaded: loaded, ammo_after: this.getAmmo(actor, id) });
        this.clearAiming(actor);
        if (left <= 0 || this.getAmmo(actor, id)! >= number(magazine)) {
            delete remaining[resource];
            turn.outcome = 'reload_complete';
        }
        else {
            remaining[resource] = left;
            turn.outcome = 'reload_in_progress';
            turn.reload_rounds_remaining = left;
        }
    }
    private firearmSkill(attacker: Row, weapon: Row): number {
        const skill = string(weapon.skill ?? '');
        return number(skill.startsWith('Firearms') ? attacker.firearms_skill ?? attacker.combat_skill : skill.startsWith('Throw') ? attacker.throw_skill ?? attacker.combat_skill : attacker.combat_skill);
    }
    private proneAimModifiers(attacker: Row, target: Row | null, firearm: boolean, thrown: boolean, melee: boolean, pointBlank: boolean, bonus: number, penalty: number, mods: Row): [
        number,
        number
    ] {
        if (truth(attacker._aiming) && (firearm || thrown)) {
            bonus++;
            mods.aimed = true;
            attacker._aiming = false;
        }
        if (firearm && array(attacker.conditions).includes('prone')) {
            bonus++;
            mods.prone_shooter = true;
        }
        if (target) {
            const prone = array(target.conditions).includes('prone');
            if (prone && melee) {
                bonus++;
                mods.vs_prone_melee = true;
            }
            if (prone && firearm && !pointBlank) {
                penalty++;
                mods.vs_prone_ranged = true;
            }
        }
        return [bonus, penalty];
    }
    private resolveAttack(turn: Row, actor: string, targetId: string | null, rawDefense: string | null, weaponId: string | null, options: CombatTurnOptions): void {
        const attacker = this.participants[actor], weapon = this.weapon(actor, weaponId), id = weapon.weapon_id || weaponId, skill = string(weapon.skill ?? '');
        const firearm = skill.startsWith('Firearms'), thrown = skill.startsWith('Throw'), melee = !firearm && !thrown;
        let defense = rawDefense;
        const pointBlank = options.pointBlank ?? false, cover = options.cover ?? false, fast = options.fastMoving ?? false, outnumbered = options.outnumberedPenalty ?? false;
        const defenderBonus = Math.max(0, Math.trunc(number(options.defenderBonus ?? 0))), defenderPenalty = Math.max(0, Math.trunc(number(options.defenderPenalty ?? 0)));
        const exception = options.rulebookException ?? null;
        if (options.fireMode === 'suppressive' && firearm) {
            this.resolveSuppression(turn, actor, weapon, id, options);
            return;
        }
        if (options.fireMode === 'full_auto' && firearm) {
            this.resolveFullAuto(turn, actor, targetId!, weapon, id, defense, options);
            return;
        }
        const uses = parseUsesPerRound(weapon.uses_per_round), shots = options.shots == null ? 1 : Math.trunc(options.shots);
        if (firearm && shots > 1) {
            if (uses.max_shots <= 0 || shots > uses.max_shots)
                valueError(`shots=${shots} exceeds uses_per_round max_shots=${uses.max_shots} for ${id} (${repr(weapon.uses_per_round)})`);
            this.resolveMultiShot(turn, actor, targetId!, weapon, id, defense, shots, options);
            return;
        }
        if (firearm && weapon.magazine != null && !options.loadAndFire) {
            const ammo = this.getAmmo(actor, id);
            if (ammo !== null && ammo <= 0) {
                Object.assign(turn, { defense_kind: 'none', opposed_outcome: 'unopposed', outcome: 'out_of_ammo', attack_modifiers: { bonus: 0, penalty: 0 } });
                return;
            }
        }
        if (options.loadAndFire && firearm)
            this.setAmmo(actor, id, Math.max(this.getAmmo(actor, id) || 0, 0) + 1);
        let bonus = Math.max(0, Math.trunc(number(options.attackerBonus ?? 0))), penalty = Math.max(0, Math.trunc(number(options.attackerPenalty ?? 0)));
        const mods: Row = { range_band: options.rangeBand ?? null, point_blank: pointBlank, cover, outnumbered_penalty: outnumbered,
            keeper_bonus: bonus, keeper_penalty: penalty }, target = targetId ? this.participants[targetId] : null;
        if (firearm || thrown) {
            if (pointBlank && firearm)
                bonus++;
            if (cover)
                penalty++;
            if (fast)
                penalty++;
        }
        if (outnumbered && melee)
            bonus++;
        if (options.loadAndFire) {
            penalty++;
            mods.load_and_fire = true;
        }
        [bonus, penalty] = this.proneAimModifiers(attacker, target, firearm, thrown, melee, pointBlank, bonus, penalty, mods);
        const difficulty = (firearm || thrown) && options.rangeBand === 'long' ? 'hard' : (firearm || thrown) && options.rangeBand === 'very_long' ? 'extreme' : 'regular';
        const skillValue = this.firearmSkill(attacker, weapon);
        let [attackOutcome, attack] = this.percentile(actor, weapon.skill, skillValue, `attack ${string(targetId)}`, difficulty, bonus, penalty, firearm || thrown);
        stampSkillOwnership(attack, actor, weapon);
        turn.roll_id = attack.roll_id;
        Object.assign(mods, { bonus, penalty });
        turn.attack_modifiers = mods;
        if (firearm) {
            const malfunction = this.malfunction(actor, weapon, attack.roll, turn.turn_id);
            if (malfunction)
                turn.malfunction = malfunction;
            this.consumeAmmo(actor, id);
        }
        if (firearm && ![null, 'none', 'dive_for_cover'].includes(defense))
            defense = 'dive_for_cover';
        if (thrown && defense === 'fight_back' && !pointBlank)
            defense = 'dodge';
        const land = () => { const [, damage] = this.damageRoll(weapon.damage, actor, targetId!, id, turn.turn_id, exception !== null, exception, this.weaponDbExpression(attacker, weapon)); turn.damage_roll_id = damage; };
        if (defense === null || defense === 'none') {
            Object.assign(turn, { defense_kind: 'none', opposed_outcome: 'unopposed', outcome: truth(attack.passed) ? 'hit' : 'miss' });
            if (truth(attack.passed))
                land();
            if (targetId)
                this.markDefended(targetId);
            return;
        }
        if (defense === 'dive_for_cover') {
            turn.defense_kind = 'dive_for_cover';
            const [, defended] = this.percentile(targetId!, 'Dodge', target.dodge_skill || target.combat_skill, `dive for cover vs ${actor}`, 'regular', defenderBonus, defenderPenalty);
            turn.opposed_roll_id = defended.roll_id;
            if (truth(defended.passed)) {
                turn.opposed_outcome = 'dived_for_cover';
                const [, retry] = this.percentile(actor, weapon.skill, skillValue, `re-attack ${string(targetId)} after dive for cover`, difficulty, bonus, penalty + 1, true);
                turn.cover_reroll_roll_id = retry.roll_id;
                this.markDivedForCover(targetId!);
                turn.outcome = truth(retry.passed) ? 'hit_after_cover' : 'miss_cover';
                if (truth(retry.passed))
                    land();
            }
            else {
                turn.opposed_outcome = 'dive_failed';
                turn.outcome = truth(attack.passed) ? 'hit' : 'miss';
                if (truth(attack.passed))
                    land();
            }
            this.markDefended(targetId);
            return;
        }
        turn.defense_kind = defense;
        let defenseOutcome: string, defended: Row, opposedKind: string;
        if (defense === 'maneuver') {
            const goal = options.defenderGoal || 'ongoing_disadvantage';
            turn.defender_goal = goal;
            [defenseOutcome, defended] = this.percentile(targetId!, 'Fighting', target.combat_skill, `maneuver counter (${goal}) vs ${actor}`, 'regular', defenderBonus, defenderPenalty);
            opposedKind = 'fight_back';
        }
        else if (defense === 'fight_back') {
            [defenseOutcome, defended] = this.percentile(targetId!, 'Fighting', target.combat_skill, `fight back vs ${actor}`, 'regular', defenderBonus, defenderPenalty);
            opposedKind = 'fight_back';
        }
        else {
            [defenseOutcome, defended] = this.percentile(targetId!, 'Dodge', target.dodge_skill || target.combat_skill, `dodge vs ${actor}`, 'regular', defenderBonus, defenderPenalty);
            opposedKind = 'dodge';
        }
        turn.opposed_roll_id = defended.roll_id;
        let opposed: string, luck: Row | null;
        [attackOutcome, defenseOutcome, opposed, luck] = this.opposedLuck(actor, targetId!, attackOutcome, attack, defenseOutcome, defended, opposedKind, options.luckPrecommit ?? null);
        if (luck)
            turn.luck_spend = { ...luck };
        turn.opposed_outcome = opposed;
        if (['attacker_higher', 'tie_attacker_wins'].includes(opposed)) {
            turn.outcome = 'hit';
            const [, damageId, damage] = this.damageRoll(weapon.damage, actor, targetId!, id, turn.turn_id, exception !== null, exception, this.weaponDbExpression(attacker, weapon));
            if (truth(attack.passed) && LEVELS[attack.achieved_level] >= LEVELS.extreme)
                this.extremeDamage(damage, weapon, attacker);
            turn.damage_roll_id = damageId;
        }
        else if (defense === 'maneuver' && ['defender_higher', 'tie_defender_wins'].includes(opposed))
            this.applyManeuverGoal(turn, targetId!, actor, options.defenderGoal || 'ongoing_disadvantage', null, true);
        else if (defense === 'fight_back' && opposed === 'defender_higher') {
            const counter = this.weapon(targetId!), counterId = string(counter.weapon_id || 'unarmed');
            const [, damageId] = this.damageRoll(string(counter.damage || '1D3'), targetId!, actor, counterId, turn.turn_id, false, null, this.weaponDbExpression(target, counter));
            this.updateConditions(actor);
            Object.assign(turn, { outcome: 'fight_back_hit', fight_back_damage_roll_id: damageId, fight_back_weapon_id: counterId });
        }
        else
            turn.outcome = opposed === 'both_fail' ? 'no_damage' : 'miss';
        this.markDefended(targetId);
    }
    private resolveMultiShot(turn: Row, actor: string, targetId: string, weapon: Row, id: string, defense: string | null, shots: number, options: CombatTurnOptions): void {
        const attacker = this.participants[actor], target = this.participants[targetId], skill = this.firearmSkill(attacker, weapon);
        const difficulty = options.rangeBand === 'long' ? 'hard' : options.rangeBand === 'very_long' ? 'extreme' : 'regular';
        const records: Row[] = [];
        let hits = 0;
        for (let i = 0; i < shots; i++) {
            const ammo = this.getAmmo(actor, id);
            if (ammo !== null && ammo <= 0 && !(options.loadAndFire && i === 0)) {
                records.push({ shot: i + 1, outcome: 'out_of_ammo' });
                break;
            }
            let bonus = options.pointBlank ? 1 : 0, penalty = 1 + Number(!!options.cover) + Number(!!options.fastMoving);
            const mods: Row = { multi_shot: true, shot_index: i + 1, point_blank: options.pointBlank ?? false, cover: options.cover ?? false };
            if (options.loadAndFire && i === 0) {
                penalty++;
                mods.load_and_fire = true;
            }
            [bonus, penalty] = this.proneAimModifiers(attacker, target, true, false, false, options.pointBlank ?? false, bonus, penalty, mods);
            const [outcome, rolled] = this.percentile(actor, weapon.skill, skill, `multi-shot ${i + 1}/${shots} vs ${targetId}`, difficulty, bonus, penalty, true);
            Object.assign(mods, { bonus, penalty });
            const malfunction = this.malfunction(actor, weapon, rolled.roll, turn.turn_id);
            this.consumeAmmo(actor, id);
            const shot: Row = { shot: i + 1, roll_id: rolled.roll_id, attack_modifiers: mods, outcome_level: outcome };
            if (malfunction)
                shot.malfunction = malfunction;
            if (truth(rolled.passed)) {
                shot.outcome = 'hit';
                hits++;
                shot.damage_roll_id = this.damageRoll(weapon.damage, actor, targetId, id, turn.turn_id, options.rulebookException != null, options.rulebookException ?? null)[1];
            }
            else
                shot.outcome = 'miss';
            records.push(shot);
        }
        Object.assign(turn, { shots: records, defense_kind: defense || 'none', opposed_outcome: 'unopposed', outcome: 'multi_shot_resolved', hits });
        if (records.length) {
            turn.roll_id = records[0].roll_id ?? null;
            turn.attack_modifiers = records[0].attack_modifiers ?? {};
        }
        this.markDefended(targetId);
    }
    private autoPenalty(index: number): [
        number,
        string
    ] {
        if (index < 3)
            return [index, 'regular'];
        const steps = index - 2;
        return [2, steps > 3 ? 'impossible' : ['regular', 'hard', 'extreme', 'critical'][steps]];
    }
    private resolveFullAuto(turn: Row, actor: string, targetId: string, weapon: Row, id: string, defense: string | null, options: CombatTurnOptions): void {
        const attacker = this.participants[actor], uses = parseUsesPerRound(weapon.uses_per_round);
        if (!uses.allows_full_auto)
            valueError(`weapon ${id} does not allow full auto (${repr(weapon.uses_per_round)})`);
        const skill = this.firearmSkill(attacker, weapon), size = fullAutoVolleySize(skill), ammo = this.getAmmo(actor, id), fired = Math.trunc(options.roundsFired || 0), total = Math.min(fired, ammo ?? fired);
        if (total <= 0) {
            Object.assign(turn, { outcome: 'out_of_ammo', defense_kind: 'none', opposed_outcome: 'unopposed', volleys: [] });
            return;
        }
        const base = options.rangeBand === 'long' ? 'hard' : options.rangeBand === 'very_long' ? 'extreme' : 'regular', volleys: Row[] = [], target = this.participants[targetId];
        let remaining = total, index = 0;
        while (remaining > 0) {
            const bullets = Math.min(size, remaining), [extra, bump] = this.autoPenalty(index), ladder = ['regular', 'hard', 'extreme', 'critical', 'impossible'];
            const difficulty = bump === 'regular' ? base : ladder[Math.min(4, Math.max(ladder.indexOf(base), ladder.indexOf(bump)))];
            let bonus = options.pointBlank ? 1 : 0, penalty = extra + Number(!!options.cover) + Number(!!options.fastMoving);
            const mods: Row = { volley_index: index + 1, full_auto: true, bonus, penalty };
            [bonus, penalty] = this.proneAimModifiers(attacker, target, true, false, false, options.pointBlank ?? false, bonus, penalty, mods);
            Object.assign(mods, { bonus, penalty });
            const [outcome, rolled] = this.percentile(actor, weapon.skill, skill, `full-auto volley ${index + 1} (${bullets} rds) vs ${targetId}`, difficulty, bonus, penalty, true);
            const malfunction = this.malfunction(actor, weapon, rolled.roll, turn.turn_id);
            this.consumeAmmo(actor, id, bullets);
            const volley: Row = { volley: index + 1, bullets, roll_id: rolled.roll_id, attack_modifiers: mods, difficulty, outcome_level: outcome };
            if (malfunction)
                volley.malfunction = malfunction;
            if (truth(rolled.passed)) {
                const extreme = LEVELS[rolled.achieved_level] >= LEVELS.extreme && difficulty !== 'extreme', hits = extreme ? bullets : Math.max(1, Math.floor(bullets / 2)), impales = extreme ? Math.max(1, Math.floor(bullets / 2)) : 0;
                Object.assign(volley, { outcome: 'hit', hits, impales });
                const damageIds: string[] = [];
                for (let hit = 0; hit < hits; hit++) {
                    const [, damageId, damage] = this.damageRoll(weapon.damage, actor, targetId, id, turn.turn_id, options.rulebookException != null, options.rulebookException ?? null);
                    if (hit < impales)
                        this.extremeDamage(damage, weapon, attacker);
                    damageIds.push(damageId);
                }
                volley.damage_roll_ids = damageIds;
            }
            else
                Object.assign(volley, { outcome: 'miss', hits: 0 });
            volleys.push(volley);
            remaining -= bullets;
            index++;
        }
        Object.assign(turn, { volleys, rounds_fired: total, defense_kind: defense || 'none', opposed_outcome: 'unopposed', outcome: 'full_auto_resolved' });
        if (volleys.length) {
            turn.roll_id = volleys[0].roll_id;
            turn.attack_modifiers = volleys[0].attack_modifiers;
        }
        this.markDefended(targetId);
    }
    private resolveSuppression(turn: Row, actor: string, weapon: Row, id: string, options: CombatTurnOptions): void {
        const attacker = this.participants[actor], targets = array(options.suppressTargets).filter(target => Object.hasOwn(this.participants, target)), dived: string[] = [];
        if (!targets.length) {
            Object.assign(turn, { outcome: 'suppressive_fire_no_targets', defense_kind: 'none', opposed_outcome: 'unopposed' });
            return;
        }
        for (const targetId of array(options.diveForCoverActors))
            if (targets.includes(targetId)) {
                const target = this.participants[targetId], [, rolled] = this.percentile(targetId, 'Dodge', target.dodge_skill || target.combat_skill, 'dive for cover under suppression');
                if (truth(rolled.passed)) {
                    dived.push(targetId);
                    this.markDivedForCover(targetId);
                    (turn.dive_rolls ??= {})[targetId] = rolled.roll_id;
                }
            }
        const skill = this.firearmSkill(attacker, weapon), size = fullAutoVolleySize(skill), ammo = this.getAmmo(actor, id);
        let remaining = options.roundsFired ?? size * Math.max(1, targets.length);
        if (ammo !== null)
            remaining = Math.min(remaining, ammo);
        const chosen = [...targets];
        this.rng.shuffle(chosen);
        const results: Row[] = [];
        for (const [index, targetId] of chosen.entries()) {
            if (remaining <= 0)
                break;
            const bullets = Math.min(size, remaining), penalty = Math.min(index, 2) + Number(dived.includes(targetId)) + Number(!!options.cover);
            const [outcome, rolled] = this.percentile(actor, weapon.skill, skill, `suppressive volley vs ${targetId}`, 'regular', 0, penalty, true);
            this.consumeAmmo(actor, id, bullets);
            const entry: Row = { target_actor_id: targetId, bullets, roll_id: rolled.roll_id, dived: dived.includes(targetId), outcome_level: outcome };
            if (truth(rolled.passed)) {
                const hits = Math.max(1, Math.floor(bullets / 2));
                Object.assign(entry, { outcome: 'hit', hits });
                entry.damage_roll_ids = Array.from({ length: hits }, () => this.damageRoll(weapon.damage, actor, targetId, id, turn.turn_id)[1]);
            }
            else
                Object.assign(entry, { outcome: 'miss', hits: 0 });
            results.push(entry);
            remaining -= bullets;
            this.markDefended(targetId);
        }
        Object.assign(turn, { dived_for_cover: dived, suppression_targets: results, defense_kind: 'none', opposed_outcome: 'unopposed', outcome: 'suppressive_fire' });
        if (results.length)
            turn.roll_id = results[0].roll_id;
    }
    private applyManeuverGoal(turn: Row, actor: string, targetId: string | null, goal: string, targetWeaponId: string | null = null, counter = false): void {
        const attacker = this.participants[actor], target = targetId ? this.participants[targetId] : null, prefix = counter ? 'counter_' : '';
        if (goal === 'disarm' && targetId) {
            const id = targetWeaponId || (target.weapons.length ? isJsonObject(target.weapons[0]) ? target.weapons[0].weapon_id : target.weapons[0] : null);
            if (id) {
                let taken: Row | null = null;
                const remaining: any[] = [];
                for (const weapon of target.weapons) {
                    if ((isJsonObject(weapon) ? weapon.weapon_id : weapon) === id && taken === null)
                        taken = isJsonObject(weapon) ? { ...weapon } : { weapon_id: string(weapon) };
                    else
                        remaining.push(weapon);
                }
                target.weapons = remaining;
                taken ??= { weapon_id: string(id) };
                attacker.weapons.push(taken);
                turn.effect_applied = { effect: 'disarmed', target_actor_id: targetId, weapon_id: id, weapon: { ...taken }, transferred_to: actor, counter };
                turn.outcome = prefix + 'disarm_success';
            }
            else
                turn.outcome = prefix + 'disarm_nothing_to_take';
        }
        else if (goal === 'ongoing_disadvantage' && targetId) {
            this.applyEffect(targetId, 'restrained', actor, 999, { goal: 'ongoing_disadvantage', counter });
            turn.effect_applied = { effect: 'restrained', target_actor_id: targetId, held_by: actor, counter };
            turn.outcome = prefix + 'restrain_success';
        }
        else if (goal === 'escape') {
            const effects = array(attacker.active_effects), restraint = effects.find(effect => effect.effect === 'restrained');
            if (restraint) {
                attacker.active_effects = effects.filter(effect => effect !== restraint);
                turn.effect_applied = { effect: 'broke_free', target_actor_id: actor, counter };
                turn.outcome = prefix + 'escape_success';
            }
            else
                turn.outcome = prefix + 'escape_nothing_to_escape';
        }
        else if (goal === 'push') {
            if (targetId && !target.conditions.includes('prone'))
                target.conditions.push('prone');
            turn.effect_applied = { effect: 'pushed', target_actor_id: targetId, counter };
            turn.outcome = prefix + 'push_success';
        }
        else {
            turn.effect_applied = { effect: goal, target_actor_id: targetId, counter };
            turn.outcome = prefix + 'maneuver_success';
        }
    }
    private resolveFlee(turn: Row, actor: string): void {
        this.participants[actor].conditions = [...this.participants[actor].conditions.filter((value: string) => value !== 'fled'), 'fled'];
        Object.assign(turn, { defense_kind: 'none', opposed_outcome: 'unopposed', outcome: 'fled' });
    }
    private resolveSkillCheck(turn: Row, actor: string, skill: string, target: number, difficulty: string, intent: string): void {
        const [outcome, rolled] = this.percentile(actor, skill, target, intent, difficulty);
        Object.assign(turn, { roll_id: rolled.roll_id, defense_kind: 'none', opposed_outcome: 'unopposed', outcome });
    }
    private resolveDamageOnly(turn: Row, actor: string, target: string | null, weaponId: string | null, exception: string | null): void {
        if (!target) {
            turn.outcome = 'damage_only_no_target';
            return;
        }
        const attacker = this.participants[actor], weapon = weaponId ? this.weapon(actor, weaponId) : { damage: '1D6', adds_damage_bonus: false };
        const [, id] = this.damageRoll(weapon.damage, actor, target, weaponId || 'environmental', turn.turn_id, exception !== null, exception, this.weaponDbExpression(attacker, weapon));
        Object.assign(turn, { roll_id: id, damage_roll_id: id, defense_kind: 'none', opposed_outcome: 'unopposed', outcome: 'damage_applied' });
    }
    private resolveSurpriseAttack(turn: Row, actor: string, target: string | null, weaponId: string | null): void {
        const attacker = this.participants[actor], weapon = this.weapon(actor, weaponId), [, rolled] = this.percentile(actor, weapon.skill, attacker.combat_skill, `surprise attack ${string(target)}`);
        Object.assign(turn, { roll_id: rolled.roll_id, defense_kind: 'none', opposed_outcome: 'unopposed', outcome: truth(rolled.passed) ? 'hit' : 'miss' });
        if (truth(rolled.passed))
            turn.damage_roll_id = this.damageRoll(weapon.damage, actor, target!, weaponId, turn.turn_id, false, null, this.weaponDbExpression(attacker, weapon))[1];
    }
    private resolveCast(turn: Row, actor: string, targetId: string | null, spell: string | null): void {
        const caster = this.participants[actor];
        if (spell !== 'dominate') {
            turn.outcome = `unknown_spell:${string(spell)}`;
            return;
        }
        if (caster.magic_points < 1) {
            turn.outcome = 'insufficient_magic_points';
            return;
        }
        caster.magic_points--;
        const [attack, rolled] = this.percentile(actor, 'POW', caster.pow ?? 90, `Dominate ${string(targetId)}`), target = this.participants[targetId!];
        const [defense, resisted] = this.percentile(targetId!, 'POW', target.pow ?? target.combat_skill, `resist Dominate from ${actor}`), opposed = resolveOpposed(attack, defense, 'fight_back');
        Object.assign(turn, { roll_id: rolled.roll_id, opposed_roll_id: resisted.roll_id, defense_kind: 'none', opposed_outcome: opposed });
        if (['attacker_higher', 'tie_attacker_wins'].includes(opposed)) {
            const rounds = this.rng.randint(1, 6) + 1;
            this.applyEffect(targetId!, 'dominated', actor, rounds, { source_spell: 'dominate' });
            turn.outcome = 'dominate_success';
            turn.effect_applied = { effect: 'dominated', target_actor_id: targetId, remaining_rounds: rounds };
        }
        else
            turn.outcome = 'dominate_resisted';
    }
    private resolveManeuver(turn: Row, actor: string, targetId: string | null, defense: string | null, goal = 'ongoing_disadvantage', targetWeaponId: string | null = null, outnumbered = false, defenderGoal: string | null = null, options: CombatTurnOptions = {}): void {
        const declaredBonus = Math.max(0, Math.trunc(number(options.attackerBonus ?? 0))), declaredPenalty = Math.max(0, Math.trunc(number(options.attackerPenalty ?? 0)));
        const defenderBonus = Math.max(0, Math.trunc(number(options.defenderBonus ?? 0))), defenderPenalty = Math.max(0, Math.trunc(number(options.defenderPenalty ?? 0)));
        const attacker = this.participants[actor], target = targetId ? this.participants[targetId] : null, difference = (target?.build ?? 0) - (attacker.build ?? 0);
        if (difference >= 3 && goal !== 'escape') {
            Object.assign(turn, { outcome: 'maneuver_impossible_build', opposed_outcome: 'impossible', defense_kind: 'none', maneuver_build_difference: difference });
            return;
        }
        // `maneuver_penalty_dice` stays the build difference alone -- it is what the rule derived,
        // and a reader comparing builds must not find the keeper's declaration folded into it (§95).
        const buildPenalty = Math.min(2, Math.max(0, difference));
        Object.assign(turn, { maneuver_build_difference: difference, maneuver_penalty_dice: buildPenalty, keeper_bonus: declaredBonus, keeper_penalty: declaredPenalty });
        const [attack, rolled] = this.percentile(actor, 'Fighting', attacker.combat_skill, `${goal} maneuver vs ${string(targetId)}`, 'regular', (outnumbered ? 1 : 0) + declaredBonus, buildPenalty + declaredPenalty);
        turn.roll_id = rolled.roll_id;
        const kind = defense === null || defense === 'none' ? 'none' : defense;
        if (kind === 'none') {
            Object.assign(turn, { defense_kind: 'none', opposed_outcome: 'unopposed' });
            if (truth(rolled.passed))
                this.applyManeuverGoal(turn, actor, targetId, goal, targetWeaponId);
            else
                turn.outcome = 'maneuver_failed';
            if (targetId)
                this.markDefended(targetId);
            return;
        }
        turn.defense_kind = kind;
        let defenseOutcome: string, opposedKind: string;
        if (targetId) {
            let defended: Row;
            if (kind === 'maneuver') {
                const goal = defenderGoal || 'ongoing_disadvantage';
                turn.defender_goal = goal;
                [defenseOutcome, defended] = this.percentile(targetId, 'Fighting', target.combat_skill, `maneuver counter (${goal}) vs ${actor}`, 'regular', defenderBonus, defenderPenalty);
                opposedKind = 'fight_back';
            }
            else if (kind === 'fight_back') {
                [defenseOutcome, defended] = this.percentile(targetId, 'Fighting', target.combat_skill, `resist ${goal} maneuver`, 'regular', defenderBonus, defenderPenalty);
                opposedKind = 'fight_back';
            }
            else {
                [defenseOutcome, defended] = this.percentile(targetId, 'Dodge', target.dodge_skill || target.combat_skill, `dodge ${goal} maneuver`, 'regular', defenderBonus, defenderPenalty);
                opposedKind = 'dodge';
            }
            turn.opposed_roll_id = defended.roll_id;
        }
        else {
            defenseOutcome = 'failure';
            opposedKind = ['fight_back', 'dodge'].includes(kind) ? kind : 'fight_back';
        }
        const opposed = resolveOpposed(attack, defenseOutcome, opposedKind);
        turn.opposed_outcome = opposed;
        if (kind === 'maneuver' && opposed === 'defender_higher') {
            this.applyManeuverGoal(turn, targetId!, actor, defenderGoal || 'ongoing_disadvantage', null, true);
            this.markDefended(targetId);
            return;
        }
        if (!['attacker_higher', 'tie_attacker_wins'].includes(opposed)) {
            if (kind === 'fight_back' && opposed === 'defender_higher') {
                turn.damage_roll_id = this.damageRoll('1D3', targetId!, actor, 'unarmed', turn.turn_id, false, null, this.weaponDbExpression(target, { adds_damage_bonus: true }))[1];
                turn.outcome = 'maneuver_failed_fight_back_damage';
            }
            else
                turn.outcome = 'maneuver_failed';
            if (targetId)
                this.markDefended(targetId);
            return;
        }
        this.applyManeuverGoal(turn, actor, targetId, goal, targetWeaponId);
        if (targetId)
            this.markDefended(targetId);
    }
}
export type CombatAttackPort = Pick<CombatSession, 'participants' | 'rounds' | 'combatId' | 'addParticipant' | 'beginRound' | 'declareAndResolveTurn' | 'drainPending'>;
export function combatAttack(session: CombatAttackPort, actorId: string, intent: string, options: Omit<CombatTurnOptions, 'action'>): Row {
    return session.declareAndResolveTurn(actorId, intent, { ...options, action: 'attack' });
}
export const rebaseCombatClock = (state: Row, _delta: number): Row => clone(state);
export const CLOCK_SAVE_PATHS = ['save/combat.json'] as const;
export const rebaseClock = rebaseCombatClock;
