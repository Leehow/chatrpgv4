/** One chase owns positions, movement economy and its existing schema-v4 snapshot. */
import type { PythonRandom } from '../random.js';
import type { RuleTables } from '../rules/tables.js';
import { orderedObject } from '../json.js';
import { defaultPlayLanguage } from '../read/languages.js';
import { array, clone, entries, number, repr, row, string, truth, values, type Row } from '../read/values.js';
import { CheckArithmetic, valueError } from '../resolve/arithmetic.js';
import { CombatSession, combatAttack, resolveOpposed, type CombatAttackPort } from '../combat/engine.js';
import { CHASE_SCHEMA_VERSION, CHASE_OUTCOMES, DEFAULT_GAP, DEFAULT_LOCATION_COUNT, LEVELS, generateLocationChain, get, int, loadChaseRules, normalizeLocation, normalizeParticipantConditions, or, rollChaseDice, vehicleCollision, vehicleStats, type ChaseSavePort } from './model.js';
import { validateGenesisEvidence, validateSnapshot } from './validation.js';
export interface ParticipantOptions {
    con?: number | null;
    driveAuto?: number | null;
    isVehicle?: boolean;
    currentPosition?: number;
    build?: number;
    hp?: number | null;
    fight?: number | null;
    dodge?: number | null;
    firearms?: number | null;
    luck?: number | null;
    conditions?: string[] | null;
    vehicleKey?: string | null;
    armor?: number;
    role?: string;
    vehicleActorId?: string | null;
    spotHidden?: number | null;
    navigate?: number | null;
}
export class ChaseSession {
    status = 'active';
    outcome: string | null = null;
    participants: Row = orderedObject([]);
    locationChain: Row[] = [];
    rounds: Row[] = [];
    pendingRolls: Row[] = [];
    pendingEvents: Row[] = [];
    rollCounter = 0;
    rollHistory: string[] = [];
    turnCounter = 0;
    currentRound = 0;
    suddenHazardLastCaller: string | null = null;
    activeCombat: CombatAttackPort | null = null;
    revision = 0;
    initiativeCursor = 0;
    consumedCombatReceipts: Row[] = [];
    /** `playLanguage` is the campaign's; a session created without one carries the data default, never a literal. */
    constructor(readonly chaseId: string, readonly rng: PythonRandom, readonly tables: RuleTables, readonly arithmetic: CheckArithmetic, readonly rules: Row, readonly playLanguage: string, readonly glossary: Row = {}) { }
    static async create(chaseId: string, rng: PythonRandom, tables: RuleTables, arithmetic?: CheckArithmetic, options: {
        playLanguage?: string;
        glossary?: Row;
    } = {}): Promise<ChaseSession> {
        return new ChaseSession(chaseId, rng, tables, arithmetic ?? await CheckArithmetic.create(tables), await loadChaseRules(tables), options.playLanguage ?? await defaultPlayLanguage(tables.context), options.glossary ?? {});
    }
    private participant(id: string): Row {
        const participant = this.participants[id];
        if (!participant) {
            const error = new Error(repr(id));
            error.name = 'KeyError';
            throw error;
        }
        return participant;
    }
    private check(target: any, difficulty = 'regular', bonus = 0, penalty = 0): Row { return this.arithmetic.check(int(target), difficulty, bonus, penalty, this.rng); }
    addParticipant(actorId: string, side: string, mov: number, dex: number, options: ParticipantOptions = {}): void {
        if (Object.hasOwn(this.participants, actorId))
            valueError(`duplicate participant ${actorId}`);
        if (!['quarry', 'pursuer', 'passenger', 'neutral'].includes(side))
            valueError(`invalid side ${repr(side)}`);
        const isVehicle = options.isVehicle ?? false;
        const vehicleKey = options.vehicleKey ?? null;
        let build = options.build ?? 0;
        let armor = options.armor ?? 0;
        if (vehicleKey && isVehicle) {
            const stats = vehicleStats(this.rules, vehicleKey);
            mov = int(get(stats, 'mov', mov));
            build = int(get(stats, 'build', build));
            armor = int(get(stats, 'armor', armor));
        }
        const position = options.currentPosition ?? 0;
        const hp = options.hp ?? 10;
        const participant = {
            actor_id: actorId,
            side,
            role: options.role ?? 'driver',
            mov_base: mov,
            mov_adjusted: mov,
            dex,
            con: options.con ?? null,
            drive_auto: options.driveAuto ?? null,
            is_vehicle: isVehicle,
            vehicle_key: vehicleKey,
            vehicle_actor_id: options.vehicleActorId ?? null,
            position,
            position_origin: position,
            build,
            build_max: build,
            armor,
            hp,
            hp_max: hp,
            fight: options.fight ?? null,
            dodge: options.dodge ?? null,
            firearms: options.firearms ?? null,
            luck: options.luck ?? null,
            conditions: [...(options.conditions ?? [])],
            spot_hidden: options.spotHidden ?? null,
            navigate: options.navigate ?? null,
            movement_actions: 1,
            movement_actions_remaining: 1,
            movement_debt: 0,
            assist_penalty_reduction: 0,
            captured: false,
            escaped: false,
            wrecked: false
        };
        this.participants = orderedObject([...entries(this.participants), [actorId, participant]]);
    }
    addPassenger(actorId: string, vehicleId: string, dex: number, options: Pick<ParticipantOptions, 'firearms' | 'spotHidden' | 'navigate' | 'luck' | 'hp'> = {}): void {
        if (!Object.hasOwn(this.participants, vehicleId))
            valueError(`unknown vehicle ${repr(vehicleId)}`);
        this.addParticipant(actorId, 'passenger', 0, dex, {
            ...options,
            isVehicle: false,
            role: 'passenger',
            vehicleActorId: vehicleId,
            hp: options.hp ?? 10,
            currentPosition: this.participants[vehicleId].position
        });
    }
    setLocationChain(locations: Array<Row | string>): void { this.locationChain = locations.map(normalizeLocation); }
    establish(): Row {
        const results: Array<[
            string,
            Row
        ]> = [];
        for (const [id, participant] of entries(this.participants)) {
            if (participant.role === 'passenger') {
                results.push([id, {
                        mov_delta: 0,
                        mov_adjusted: participant.mov_base,
                        skipped: 'passenger'
                    }]);
                continue;
            }
            let target: any;
            let skill: string;
            if (truth(participant.is_vehicle) && participant.drive_auto != null) {
                target = participant.drive_auto;
                skill = 'Drive Auto';
            }
            else if (participant.con != null) {
                target = participant.con;
                skill = 'CON';
            }
            else {
                results.push([id, {
                        mov_delta: 0,
                        mov_adjusted: participant.mov_base
                    }]);
                continue;
            }
            const result = this.check(target);
            const delta = LEVELS[result.outcome] >= LEVELS.extreme ? 1 : ['failure', 'fumble'].includes(result.outcome) ? -1 : 0;
            participant.mov_adjusted = Math.max(1, number(participant.mov_base) + delta);
            const rollId = this.rollId();
            this.pendingRolls.push({
                roll_id: rollId,
                actor_id: id,
                skill,
                target,
                roll: result.roll,
                outcome: result.outcome,
                mov_delta: delta,
                kind: 'speed_roll'
            });
            results.push([id, {
                    skill,
                    outcome: result.outcome,
                    mov_delta: delta,
                    mov_adjusted: participant.mov_adjusted,
                    roll_id: rollId
                }]);
        }
        let quarries = values(this.participants).filter(p => p.side === 'quarry');
        let pursuers = values(this.participants).filter(p => p.side === 'pursuer');
        const excluded: Row = {
            escaped_quarries: [],
            left_behind_pursuers: []
        };
        if (quarries.length && pursuers.length && (quarries.length > 1 || pursuers.length > 1)) {
            const fastest = Math.max(...pursuers.map(p => p.mov_adjusted));
            excluded.escaped_quarries = quarries.filter(p => p.mov_adjusted > fastest).map(p => p.actor_id).sort();
            const remaining = quarries.filter(p => !excluded.escaped_quarries.includes(p.actor_id));
            if (remaining.length) {
                const slowest = Math.min(...remaining.map(p => p.mov_adjusted));
                excluded.left_behind_pursuers = pursuers.filter(p => p.mov_adjusted < slowest).map(p => p.actor_id).sort();
            }
            for (const id of [...excluded.escaped_quarries, ...excluded.left_behind_pursuers])
                delete this.participants[id];
            quarries = values(this.participants).filter(p => p.side === 'quarry');
            pursuers = values(this.participants).filter(p => p.side === 'pursuer');
        }
        if (quarries.length && pursuers.length) {
            if (Math.min(...quarries.map(p => p.mov_adjusted)) > Math.max(...pursuers.map(p => p.mov_adjusted))) {
                this.conclude('escaped');
                for (const quarry of quarries)
                    quarry.escaped = true;
            }
        }
        else if (excluded.escaped_quarries.length)
            this.conclude('escaped');
        return {
            speed_rolls: orderedObject(results),
            excluded_participants: excluded,
            chase_proceeds: this.status === 'active'
        };
    }
    cutToTheChase(gap = DEFAULT_GAP, locations: Array<Row | string> | null = null, locationCount: number | null = null): Row {
        if (gap < 1)
            valueError('gap must be >= 1');
        if (locations !== null)
            this.setLocationChain(locations);
        else if (!this.locationChain.length)
            this.setLocationChain(generateLocationChain(locationCount || Math.max(DEFAULT_LOCATION_COUNT, gap + 4)));
        else if (locationCount && this.locationChain.length < locationCount) {
            const extra = generateLocationChain(locationCount - this.locationChain.length + 1);
            const base = this.locationChain.at(-1)?.label === 'escape' ? this.locationChain.slice(0, -1) : this.locationChain;
            this.locationChain = [...base, ...extra.slice(1).map((loc, i) => normalizeLocation(loc, base.length + i))].map(normalizeLocation);
        }
        for (const participant of values(this.participants)) {
            if (participant.side === 'quarry')
                participant.position = Math.min(gap, this.locationChain.length - 1);
            else if (participant.side === 'pursuer')
                participant.position = 0;
            else if (participant.side === 'passenger' && participant.vehicle_actor_id && this.participants[participant.vehicle_actor_id])
                participant.position = this.participants[participant.vehicle_actor_id].position;
            if (!this.rounds.length)
                participant.position_origin = participant.position;
        }
        this.pendingEvents.push({
            kind: 'cut_to_the_chase',
            gap,
            location_count: this.locationChain.length,
            rule_ref: 'core.chase.cut_to_the_chase'
        });
        return {
            gap,
            location_count: this.locationChain.length,
            quarry_positions: orderedObject(entries(this.participants).filter(([, p]) => p.side === 'quarry').map(([id, p]) => [id, p.position])),
            pursuer_positions: orderedObject(entries(this.participants).filter(([, p]) => p.side === 'pursuer').map(([id, p]) => [id, p.position]))
        };
    }
    computeMovementActions(): void {
        const movers = values(this.participants).filter(p => p.role !== 'passenger' && !truth(p.captured) && !truth(p.escaped) && !truth(p.wrecked));
        if (!movers.length)
            return;
        const slowest = Math.min(...movers.map(p => p.mov_adjusted));
        for (const participant of movers) {
            const actions = Math.max(0, 1 + Math.max(0, participant.mov_adjusted - slowest) - int(or(participant.movement_debt, 0)));
            participant.movement_actions = actions;
            participant.movement_actions_remaining = actions;
            participant.movement_debt = 0;
        }
        for (const participant of values(this.participants))
            if (participant.role === 'passenger') {
                participant.movement_actions = 0;
                participant.movement_actions_remaining = 0;
            }
    }
    beginRound(): number {
        if (this.status !== 'active')
            valueError('cannot begin a round for a concluded chase');
        if (this.rounds.length && this.initiativeCursor < this.rounds.at(-1)!.dex_order.length)
            valueError('current chase round still has unresolved initiative actors');
        if (!this.rounds.length)
            for (const participant of values(this.participants))
                participant.position_origin = participant.position;
        this.currentRound++;
        this.computeMovementActions();
        const groups = new Map<number, Row[]>();
        for (const participant of values(this.participants).filter(p => !truth(p.captured) && !truth(p.escaped) && !truth(p.wrecked))) {
            const dex = int(participant.dex);
            groups.set(dex, [...(groups.get(dex) ?? []), participant]);
        }
        const order = [...groups].sort(([a], [b]) => b - a).flatMap(([, group]) => group.length === 1 ? group : this.resolveDexTie(group));
        this.rounds.push({
            round: this.currentRound,
            dex_order: order.map(p => p.actor_id),
            turns: []
        });
        this.initiativeCursor = 0;
        this.revision++;
        return this.currentRound;
    }
    private resolveDexTie(participants: Row[]): Row[] {
        const buckets = new Map<number, Row[]>();
        for (const participant of participants) {
            const result = this.check(participant.dex);
            this.pendingRolls.push({
                roll_id: this.rollId(),
                actor_id: participant.actor_id,
                skill: 'DEX',
                target: participant.dex,
                roll: result.roll,
                outcome: result.outcome,
                kind: 'chase_dex_tiebreak',
                round: this.currentRound
            });
            const rank = LEVELS[result.outcome];
            buckets.set(rank, [...(buckets.get(rank) ?? []), participant]);
        }
        return [...buckets].sort(([a], [b]) => b - a).flatMap(([, group]) => group.length === 1 ? group : this.resolveDexTie(group));
    }
    private spend(participant: Row, amount: number): void { participant.movement_actions_remaining = Math.max(0, int(get(participant, 'movement_actions_remaining', 0)) - amount); }
    private syncPassengers(vehicleId: string): void {
        const position = this.participant(vehicleId).position;
        for (const participant of values(this.participants))
            if (participant.vehicle_actor_id === vehicleId)
                participant.position = position;
    }
    moveParticipant(actorId: string, actions: Row[]): Row {
        if (this.status !== 'active' || !this.rounds.length)
            valueError('active chase round required');
        const order = this.rounds.at(-1)!.dex_order;
        if (this.initiativeCursor >= order.length || order[this.initiativeCursor] !== actorId)
            valueError('actor is out of chase initiative order');
        if (!Array.isArray(actions) || !actions.length)
            valueError('at least one structured chase action is required');
        const participant = this.participant(actorId);
        if (participant.role === 'passenger')
            valueError('passengers use passenger_action(), not move_participant()');
        const budget = int(get(participant, 'movement_actions_remaining', get(participant, 'movement_actions', 0)));
        const turn: Row = {
            turn_id: `t${this.currentRound}-${this.nextTurn()}`,
            actor_id: actorId,
            dex: participant.dex,
            movement_actions: participant.movement_actions,
            actions_taken: []
        };
        let spent = 0;
        for (const action of actions) {
            if (truth(participant.escaped) || truth(participant.captured) || truth(participant.wrecked))
                break;
            const type = get(action, 'type', 'advance');
            const preview = this.actionCostPreview(type, action);
            if (spent + preview > budget)
                valueError('chase action budget exceeded');
            const result = this.resolveMovementAction(actorId, action);
            turn.actions_taken.push(result);
            spent += int(get(result, 'actions_spent', preview));
            if (truth(participant.escaped) || truth(participant.captured) || truth(participant.wrecked))
                break;
        }
        if (this.rounds.length)
            this.rounds.at(-1)!.turns.push(turn);
        this.initiativeCursor++;
        this.revision++;
        return turn;
    }
    private actionCostPreview(type: string, action: Row): number {
        if (['advance', 'barrier', 'break_barrier', 'conflict', 'conflict_melee', 'conflict_vehicle', 'hide'].includes(type))
            return 1 + Math.max(0, Math.min(2, int(or(action.cautious_bonus_actions, 0))));
        if (type === 'pedal_to_the_metal')
            return 1;
        if (type === 'fire_while_moving')
            return truth(get(action, 'moving', true)) ? 0 : 1;
        return 1;
    }
    private resolveMovementAction(actorId: string, action: Row): Row {
        const type = get(action, 'type', 'advance');
        if (type === 'advance')
            return this.resolveAdvance(actorId, action);
        if (type === 'pedal_to_the_metal')
            return this.resolvePedal(actorId, action);
        if (type === 'barrier')
            return this.resolveBarrierSkill(actorId, action);
        if (type === 'break_barrier')
            return this.resolveBreakBarrier(actorId, action);
        if (type === 'hide')
            return this.resolveHide(actorId, action);
        if (type === 'conflict')
            return this.resolveGrab(actorId, action);
        if (type === 'conflict_melee') {
            const combat = action.combat_session || this.activeCombat;
            if (!combat)
                valueError('conflict_melee requires combat_session');
            return this.initiateMeleeConflict(actorId, action.target_actor_id, combat, {
                declaredIntent: get(action, 'declared_intent', 'attack'),
                defenseKind: get(action, 'defense_kind', 'dodge'),
                weaponId: action.weapon_id ?? null
            });
        }
        if (type === 'conflict_vehicle')
            return this.vehicleConflict(actorId, action.target_actor_id, get(action, 'defense_kind', 'dodge'));
        return {
            type,
            result: 'unknown'
        };
    }
    nextLocation(position: number): Row | null {
        const next = position + 1;
        if (next >= this.locationChain.length)
            return null;
        return this.locationChain[next < 0 ? this.locationChain.length + next : next] ?? null;
    }
    private resolveAdvance(actorId: string, action: Row): Row {
        const participant = this.participant(actorId);
        const before = participant.position;
        const next = this.nextLocation(participant.position);
        if (!next) {
            if (participant.side === 'quarry') {
                this.spend(participant, 1);
                participant.escaped = true;
                return {
                    type: 'advance',
                    result: 'outdistanced',
                    position_before: before,
                    escaped: true,
                    actions_spent: 1
                };
            }
            return {
                type: 'advance',
                result: 'end_of_chain',
                actions_spent: 0
            };
        }
        if (truth(next.barrier) && int(or(next.barrier.hp, 0)) > 0)
            return {
                type: 'advance',
                result: 'blocked_by_barrier',
                barrier_id: next.barrier.barrier_id ?? null,
                actions_spent: 0
            };
        if (truth(next.hazard))
            return this.negotiateHazard(actorId, next, next.hazard, action, Math.max(0, Math.min(2, int(or(action.cautious_bonus_actions, 0)))));
        this.spend(participant, 1);
        participant.position = Math.min(get(next, 'index', participant.position + 1), this.locationChain.length - 1);
        if (truth(participant.is_vehicle))
            this.syncPassengers(actorId);
        const result: Row = {
            type: 'advance',
            position_before: before,
            new_position: participant.position,
            location_label: get(next, 'label', '?'),
            actions_spent: 1
        };
        if (next.label === 'escape' && participant.side === 'quarry') {
            participant.escaped = true;
            result.escaped = true;
        }
        return result;
    }
    private negotiateHazard(actorId: string, location: Row, hazard: Row, action: Row, cautious = 0, extraPenalty = 0): Row {
        const participant = this.participant(actorId);
        const before = participant.position;
        const skill = or(action.skill, hazard.skill, participant.is_vehicle ? 'Drive Auto' : 'DEX');
        const target = int(or(action.target, hazard.target, 50));
        const difficulty = or(action.difficulty, hazard.difficulty, 'regular');
        let penalty = int(or(action.penalty, 0)) + extraPenalty;
        if (truth(participant.is_vehicle) && number(get(participant, 'build_max', 0)) > 0 && participant.build <= Math.floor(participant.build_max / 2))
            penalty++;
        this.spend(participant, 1 + cautious);
        const result = this.check(target, difficulty, cautious, penalty);
        const rollId = this.rollId();
        this.pendingRolls.push({
            roll_id: rollId,
            actor_id: actorId,
            skill,
            target,
            roll: result.roll,
            outcome: result.outcome,
            bonus: cautious,
            penalty,
            kind: 'hazard'
        });
        participant.position = get(location, 'index', participant.position + 1);
        if (truth(participant.is_vehicle))
            this.syncPassengers(actorId);
        const passed = !['failure', 'fumble'].includes(result.outcome);
        const output: Row = {
            type: 'hazard',
            position_before: before,
            hazard_id: hazard.hazard_id ?? null,
            passed,
            roll_id: rollId,
            bonus: cautious,
            penalty,
            actions_spent: 1 + cautious,
            new_position: participant.position,
            location_label: get(location, 'label', '?')
        };
        if (location.label === 'escape' && participant.side === 'quarry') {
            participant.escaped = true;
            output.escaped = true;
        }
        if (!passed) {
            if (truth(participant.is_vehicle)) {
                const severity = or(hazard.collision_severity, difficulty === 'hard' ? 'moderate' : difficulty === 'extreme' ? 'severe' : 'minor');
                const collision = this.applyVehicleCollision(actorId, severity, false);
                output.damage = collision.build_damage;
                output.collision = collision;
            }
            else {
                const damage = Math.max(0, rollChaseDice(or(hazard.damage_dice, '1D6'), this.rng));
                participant.hp = Math.max(0, int(participant.hp) - damage);
                normalizeParticipantConditions(participant);
                output.damage = damage;
            }
            const debt = this.rng.randint(1, 3);
            participant.movement_debt = int(or(participant.movement_debt, 0)) + debt;
            output.movement_debt = debt;
        }
        return output;
    }
    private resolveBarrierSkill(actorId: string, action: Row): Row {
        const participant = this.participant(actorId);
        const before = participant.position;
        const next = this.nextLocation(participant.position);
        let location: Row;
        if (!next || !truth(next.barrier)) {
            location = participant.position < this.locationChain.length ? this.locationChain[participant.position] : {};
            if (next && truth(next.barrier))
                location = next;
            else if (!truth(location.barrier) && next)
                location = next;
        }
        else
            location = next;
        const barrier = location?.barrier;
        if (!truth(barrier) || int(or(barrier.hp, 0)) <= 0)
            return this.resolveAdvance(actorId, {
                type: 'advance'
            });
        const skill = or(action.skill, barrier.skill, 'Climb');
        const target = int(or(action.target, barrier.target, 50));
        const difficulty = or(action.difficulty, barrier.difficulty, 'regular');
        this.spend(participant, 1);
        const result = this.check(target, difficulty);
        const rollId = this.rollId();
        this.pendingRolls.push({
            roll_id: rollId,
            actor_id: actorId,
            skill,
            target,
            roll: result.roll,
            outcome: result.outcome,
            kind: 'barrier'
        });
        const passed = !['failure', 'fumble'].includes(result.outcome);
        const output: Row = {
            type: 'barrier',
            position_before: before,
            passed,
            roll_id: rollId,
            actions_spent: 1,
            barrier_id: barrier.barrier_id ?? null
        };
        if (passed) {
            participant.position = get(location, 'index', participant.position + 1);
            if (truth(participant.is_vehicle))
                this.syncPassengers(actorId);
            output.new_position = participant.position;
            if (location.label === 'escape' && participant.side === 'quarry') {
                participant.escaped = true;
                output.escaped = true;
            }
        }
        return output;
    }
    private resolveBreakBarrier(actorId: string, _action: Row): Row {
        const participant = this.participant(actorId);
        const before = participant.position;
        const next = this.nextLocation(participant.position);
        if (!next || !truth(next.barrier))
            return {
                type: 'break_barrier',
                result: 'no_barrier',
                actions_spent: 0
            };
        const barrier = next.barrier;
        if (int(or(barrier.hp, 0)) <= 0)
            return {
                type: 'break_barrier',
                result: 'already_destroyed',
                actions_spent: 0
            };
        this.spend(participant, 1);
        const build = Math.max(0, int(or(participant.build, 0)));
        const hpBefore = int(barrier.hp);
        let damage = 0;
        if (truth(participant.is_vehicle) || build > 0)
            for (let i = 0; i < Math.max(1, build); i++)
                damage += this.rng.randint(1, 10);
        else
            damage = this.rng.randint(1, 3);
        barrier.hp = Math.max(0, hpBefore - damage);
        const destroyed = barrier.hp <= 0;
        const output: Row = {
            type: 'break_barrier',
            position_before: before,
            damage_to_barrier: damage,
            barrier_hp_before: hpBefore,
            barrier_hp_after: barrier.hp,
            destroyed,
            actions_spent: 1,
            vehicle_wrecked: false,
            vehicle_damage: 0
        };
        if (truth(participant.is_vehicle)) {
            if (!destroyed) {
                participant.wrecked = true;
                output.vehicle_wrecked = true;
                next.hazard = {
                    hazard_id: `wreck_${actorId}`,
                    skill: 'Drive Auto',
                    target: 50,
                    difficulty: 'regular',
                    damage_dice: '1D6',
                    collision_severity: 'moderate',
                    from_wreck: true
                };
                this.pendingEvents.push({
                    kind: 'vehicle_wrecked_on_barrier',
                    actor_id: actorId,
                    barrier_id: barrier.barrier_id ?? null
                });
            }
            else {
                output.vehicle_damage = Math.floor(hpBefore / 2);
                this.applyBuildHpDamage(participant, output.vehicle_damage);
                next.hazard = {
                    hazard_id: `debris_${get(barrier, 'barrier_id', 'barrier')}`,
                    skill: 'Drive Auto',
                    target: 50,
                    difficulty: 'regular',
                    damage_dice: '1D6',
                    from_debris: true
                };
                participant.position = get(next, 'index', participant.position + 1);
                this.syncPassengers(actorId);
                output.new_position = participant.position;
            }
        }
        else if (destroyed) {
            next.hazard = {
                hazard_id: `debris_${get(barrier, 'barrier_id', 'barrier')}`,
                skill: 'DEX',
                target: 50,
                difficulty: 'regular',
                damage_dice: '1D3',
                from_debris: true
            };
            participant.position = get(next, 'index', participant.position + 1);
            output.new_position = participant.position;
        }
        return output;
    }
    private applyBuildHpDamage(participant: Row, damage: number): number {
        if (damage <= 0)
            return 0;
        const pending = int(get(participant, '_build_damage_bank', 0)) + damage;
        const loss = Math.floor(pending / 10);
        participant._build_damage_bank = pending % 10;
        if (loss)
            participant.build = Math.max(0, int(participant.build) - loss);
        if (participant.build <= 0)
            participant.wrecked = true;
        return loss;
    }
    initiateMeleeConflict(attackerId: string, defenderId: string, combat: CombatAttackPort, options: {
        declaredIntent?: string;
        defenseKind?: string;
        weaponId?: string | null;
    } = {}): Row {
        const attacker = this.participant(attackerId);
        const defender = this.participant(defenderId);
        if (attacker.position !== defender.position)
            valueError('melee conflict requires same location');
        if (!this.rounds.length)
            this.beginRound();
        this.spend(attacker, 1);
        this.activeCombat = combat;
        const ensure = (id: string, side: string) => {
            if (Object.hasOwn(combat.participants, id))
                return;
            const participant = this.participant(id);
            combat.addParticipant(id, side === 'quarry' ? 'investigator' : 'npc', {
                dex: participant.dex,
                combatSkill: int(or(participant.fight, 50)),
                build: int(or(participant.build, 0)),
                hpMax: int(or(participant.hp_max, participant.hp, 10)),
                dodgeSkill: int(or(participant.dodge, participant.fight, 50)),
                firearmsSkill: int(or(participant.firearms, 0)),
                con: int(or(participant.con, 50))
            });
            combat.participants[id].hp_current = int(or(participant.hp, 10));
        };
        ensure(attackerId, attacker.side);
        ensure(defenderId, defender.side);
        if (!combat.rounds.length)
            combat.beginRound();
        const turn = combatAttack(combat, attackerId, options.declaredIntent ?? 'attack', {
            action: 'attack',
            targetActorId: defenderId,
            defenseKind: options.defenseKind ?? 'dodge',
            weaponId: options.weaponId ?? null
        });
        for (const id of [attackerId, defenderId])
            if (Object.hasOwn(combat.participants, id)) {
                this.participants[id].hp = combat.participants[id].hp_current;
                if (combat.participants[id].hp_current <= 0 && this.participants[id].side === 'quarry')
                    this.participants[id].captured = true;
            }
        const [rolls, events] = combat.drainPending();
        this.pendingRolls.push(...rolls);
        this.pendingEvents.push(...events);
        this.pendingEvents.push({
            kind: 'conflict_melee_delegated',
            attacker_id: attackerId,
            defender_id: defenderId,
            combat_id: combat.combatId ?? null,
            rule_ref: 'core.chase.conflict'
        });
        return {
            type: 'conflict_melee',
            delegated: true,
            combat_turn: turn,
            actions_spent: 1,
            attacker_id: attackerId,
            defender_id: defenderId,
            position: attacker.position
        };
    }
    recordExternalConflict(attackerId: string, defenderId: string, options: {
        combatCommandId: string;
        combatRevision: number;
        combatId: string;
        commandHash: string;
        receiptHash: string;
        hpAfter: Row;
        conditionsAfter: Row;
    }): Row {
        if (this.status !== 'active' || !this.rounds.length)
            valueError('active chase round required');
        const order = this.rounds.at(-1)!.dex_order;
        if (this.initiativeCursor >= order.length || order[this.initiativeCursor] !== attackerId)
            valueError('actor is out of chase initiative order');
        const attacker = this.participants[attackerId];
        const defender = this.participants[defenderId];
        if (!attacker || !defender)
            valueError('unknown chase conflict actor');
        if (attacker.position !== defender.position)
            valueError('melee conflict requires same location');
        if (int(get(attacker, 'movement_actions_remaining', 0)) < 1)
            valueError('chase action budget exceeded');
        if (this.consumedCombatReceipts.some(receipt => receipt.combat_command_id === options.combatCommandId))
            valueError('combat receipt was already consumed by this chase');
        this.spend(attacker, 1);
        for (const [id, hp] of entries(options.hpAfter))
            if (Object.hasOwn(this.participants, id)) {
                this.participants[id].hp = Math.max(0, int(hp));
                this.participants[id].conditions = [...array(options.conditionsAfter[id])];
                normalizeParticipantConditions(this.participants[id]);
            }
        const receipt = {
            combat_command_id: options.combatCommandId,
            combat_id: options.combatId,
            combat_revision: options.combatRevision,
            command_hash: options.commandHash,
            receipt_hash: options.receiptHash
        };
        this.consumedCombatReceipts.push(receipt);
        const event = {
            type: 'conflict',
            attacker_id: attackerId,
            defender_id: defenderId,
            combat_command_id: options.combatCommandId,
            combat_revision: options.combatRevision,
            combat_id: options.combatId,
            combat_receipt: clone(receipt),
            actions_spent: 1
        };
        this.rounds.at(-1)!.turns.push({
            turn_id: `t${this.currentRound}-${this.nextTurn()}`,
            actor_id: attackerId,
            dex: attacker.dex,
            movement_actions: attacker.movement_actions,
            actions_taken: [event]
        });
        this.initiativeCursor++;
        this.revision++;
        return event;
    }
    vehicleConflict(attackerId: string, defenderId: string, defenseKind = 'dodge'): Row {
        const attacker = this.participant(attackerId);
        const defender = this.participant(defenderId);
        if (attacker.position !== defender.position)
            valueError('vehicle conflict requires same location');
        if (!truth(attacker.is_vehicle) || !truth(defender.is_vehicle))
            valueError('vehicle_conflict requires two vehicles');
        if (!this.rounds.length)
            this.beginRound();
        this.spend(attacker, 1);
        const attackerSkill = int(or(attacker.drive_auto, 50));
        const defenderSkill = int(or(defender.drive_auto, 50));
        const difference = int(or(defender.build, 0)) - int(or(attacker.build, 0));
        if (difference >= 3)
            return {
                type: 'conflict_vehicle',
                result: 'impossible',
                reason: 'target_build_3_or_more_larger',
                actions_spent: 1,
                attacker_skill: 'Drive Auto'
            };
        const penalty = difference === 2 ? 2 : difference === 1 ? 1 : 0;
        const attack = this.check(attackerSkill, 'regular', 0, penalty);
        const defense = this.check(defenderSkill);
        const attackerRoll = this.rollId();
        const defenderRoll = this.rollId();
        this.pendingRolls.push({
            roll_id: attackerRoll,
            actor_id: attackerId,
            skill: 'Drive Auto',
            target: attackerSkill,
            roll: attack.roll,
            outcome: attack.outcome,
            penalty,
            kind: 'vehicle_conflict_attack'
        });
        this.pendingRolls.push({
            roll_id: defenderRoll,
            actor_id: defenderId,
            skill: 'Drive Auto',
            target: defenderSkill,
            roll: defense.roll,
            outcome: defense.outcome,
            kind: 'vehicle_conflict_defense'
        });
        const opposed = resolveOpposed(attack.outcome, defense.outcome, defenseKind === 'dodge' ? 'dodge' : 'fight_back');
        const output: Row = {
            type: 'conflict_vehicle',
            attacker_skill: 'Drive Auto',
            attacker_outcome: attack.outcome,
            defender_outcome: defense.outcome,
            opposed,
            actions_spent: 1,
            attacker_roll_id: attackerRoll,
            defender_roll_id: defenderRoll
        };
        if (opposed === 'both_fail') {
            output.both_fail = true;
            output.winner = null;
            output.damage_to_loser = 0;
            return output;
        }
        const attackWins = ['attacker_higher', 'tie_attacker_wins'].includes(opposed);
        const winner = attackWins ? attackerId : defenderId;
        const loser = attackWins ? defenderId : attackerId;
        output.winner = winner;
        output.loser = loser;
        const winning = this.participants[winner];
        const losing = this.participants[loser];
        const build = Math.max(1, int(or(winning.build, 1)));
        let damage = 0;
        for (let i = 0; i < build; i++)
            damage += this.rng.randint(1, 10);
        const selfDamage = Math.min(Math.floor(damage / 2), Math.max(0, int(or(losing.build, 0))) * 10);
        const loserLoss = this.applyBuildHpDamage(losing, damage);
        const winnerLoss = this.applyBuildHpDamage(winning, selfDamage);
        output.damage_to_loser = damage;
        output.damage_to_winner = selfDamage;
        output.build_loss = {
            loser: loserLoss,
            winner: winnerLoss
        };
        const collision = vehicleCollision(this.rules, damage >= 20 ? 'severe' : damage >= 10 ? 'moderate' : 'minor', this.rng);
        output.collision = collision;
        for (const participant of values(this.participants))
            if (participant.vehicle_actor_id === loser)
                participant.hp = Math.max(0, int(participant.hp) - collision.passenger_damage);
        const debt = this.rng.randint(1, 3);
        losing.movement_debt = int(or(losing.movement_debt, 0)) + debt;
        output.movement_debt = debt;
        return output;
    }
    applyVehicleCollision(actorId: string, severity = 'moderate', applyDebt = true): Row {
        const participant = this.participant(actorId);
        const raw = vehicleCollision(this.rules, severity, this.rng);
        const loss = this.applyBuildHpDamage(participant, raw.build_damage);
        const collision: Row = {
            ...raw,
            kind: 'vehicle_collision',
            actor_id: actorId,
            build_loss: loss,
            build_after: participant.build
        };
        participant.hp = Math.max(0, int(participant.hp) - collision.passenger_damage);
        for (const passenger of values(this.participants))
            if (passenger.vehicle_actor_id === actorId)
                passenger.hp = Math.max(0, int(passenger.hp) - collision.passenger_damage);
        if (applyDebt) {
            const debt = this.rng.randint(1, 3);
            participant.movement_debt = int(or(participant.movement_debt, 0)) + debt;
            collision.movement_debt = debt;
        }
        this.pendingRolls.push(collision);
        this.pendingEvents.push({
            kind: 'vehicle_collision',
            actor_id: actorId,
            severity: collision.severity,
            build_damage: collision.build_damage
        });
        return collision;
    }
    private resolveGrab(actorId: string, action: Row): Row {
        const participant = this.participant(actorId);
        const targetId = get(action, 'target_actor_id', '');
        const target = this.participants[targetId];
        if (!target)
            return {
                type: 'conflict',
                result: 'no_target',
                actions_spent: 0
            };
        if (participant.position !== target.position)
            return {
                type: 'conflict',
                result: 'not_same_location',
                actions_spent: 0
            };
        this.spend(participant, 1);
        const value = get(action, 'fight_target', or(participant.fight, 40));
        const result = this.check(value);
        const rollId = this.rollId();
        this.pendingRolls.push({
            roll_id: rollId,
            actor_id: actorId,
            skill: 'Fighting',
            target: value,
            roll: result.roll,
            outcome: result.outcome,
            kind: 'conflict_grab'
        });
        const grabbed = !['failure', 'fumble'].includes(result.outcome);
        if (grabbed)
            target.captured = true;
        return {
            type: 'conflict',
            result: grabbed ? 'grabbed' : 'missed',
            target: targetId,
            roll_id: rollId,
            actions_spent: 1
        };
    }
    private resolveHide(actorId: string, action: Row): Row {
        const participant = this.participant(actorId);
        this.spend(participant, 1);
        const target = int(or(action.stealth_target, 40));
        const result = this.check(target);
        const rollId = this.rollId();
        this.pendingRolls.push({
            roll_id: rollId,
            actor_id: actorId,
            skill: 'Stealth',
            target,
            roll: result.roll,
            outcome: result.outcome,
            kind: 'hide'
        });
        return {
            type: 'hide',
            success: !['failure', 'fumble'].includes(result.outcome),
            roll_id: rollId,
            actions_spent: 1
        };
    }
    private resolvePedal(actorId: string, action: Row): Row {
        const participant = this.participant(actorId);
        const before = participant.position;
        if (!truth(participant.is_vehicle))
            valueError('Pedal to the Metal requires a vehicle');
        const locations = int(or(action.locations, 2));
        if (locations < 2 || locations > 5)
            valueError('Pedal to the Metal moves 2 to 5 locations');
        const assist = int(or(participant.assist_penalty_reduction, 0));
        const penalty = Math.max(0, (locations <= 3 ? 1 : 2) - assist);
        participant.assist_penalty_reduction = 0;
        this.spend(participant, 1);
        let moved = 0;
        const hazards: Row[] = [];
        for (let i = 0; i < locations; i++) {
            const next = this.nextLocation(participant.position);
            if (!next)
                break;
            if (truth(next.barrier) && int(or(next.barrier.hp, 0)) > 0) {
                const broken = this.resolveBreakBarrier(actorId, {});
                participant.movement_actions_remaining = int(or(participant.movement_actions_remaining, 0)) + 1;
                hazards.push(broken);
                if (truth(participant.wrecked) || !truth(broken.destroyed))
                    break;
                moved++;
                continue;
            }
            if (truth(next.hazard)) {
                const result = this.negotiateHazard(actorId, next, next.hazard, action, 0, penalty);
                participant.movement_actions_remaining = int(or(participant.movement_actions_remaining, 0)) + 1;
                hazards.push(result);
                moved++;
                if (!truth(result.passed))
                    break;
            }
            else {
                participant.position = get(next, 'index', participant.position + 1);
                moved++;
                if (next.label === 'escape' && participant.side === 'quarry') {
                    participant.escaped = true;
                    break;
                }
            }
        }
        this.syncPassengers(actorId);
        return {
            type: 'pedal_to_the_metal',
            position_before: before,
            locations_requested: locations,
            locations_moved: moved,
            penalty,
            assist_applied: assist,
            actions_spent: 1,
            new_position: participant.position,
            hazard_results: hazards,
            escaped: get(participant, 'escaped', false)
        };
    }
    async passengerAction(actorId: string, action: Row): Promise<Row> {
        if (this.status !== 'active' || !this.rounds.length)
            valueError('active chase round required');
        const order = this.rounds.at(-1)!.dex_order;
        if (this.initiativeCursor >= order.length || order[this.initiativeCursor] !== actorId)
            valueError('actor is out of chase initiative order');
        const participant = this.participant(actorId);
        const type = get(action, 'type', 'assist_driver');
        if (participant.role !== 'passenger')
            valueError(`${actorId} is not a passenger`);
        if (type === 'assist_driver') {
            const skill = or(action.skill, 'Spot Hidden');
            const target = int(or(action.target, skill === 'Navigate' ? participant.navigate : participant.spot_hidden, 40));
            const result = this.check(target);
            const rollId = this.rollId();
            const success = !['failure', 'fumble'].includes(result.outcome);
            const vehicle = participant.vehicle_actor_id;
            this.pendingRolls.push({
                roll_id: rollId,
                actor_id: actorId,
                skill,
                target,
                roll: result.roll,
                outcome: result.outcome,
                kind: 'passenger_assist'
            });
            if (success && vehicle && this.participants[vehicle])
                this.participants[vehicle].assist_penalty_reduction = 1;
            const output = {
                type: 'assist_driver',
                success,
                roll_id: rollId,
                vehicle_id: vehicle ?? null,
                actions_spent: 0
            };
            this.rounds.at(-1)!.turns.push({
                turn_id: `t${this.currentRound}-${this.nextTurn()}`,
                actor_id: actorId,
                dex: participant.dex,
                movement_actions: 0,
                actions_taken: [output]
            });
            this.initiativeCursor++;
            this.revision++;
            return output;
        }
        if (type === 'fire')
            return this.fireWhileMoving(actorId, action.target_actor_id, int(or(action.firearms_target, participant.firearms, 40)), string(or(action.weapon_id, '')), true);
        return {
            type,
            result: 'unknown'
        };
    }
    async fireWhileMoving(attackerId: string, targetId: string, firearmsTarget: number, weaponId: string, moving = true): Promise<Row> {
        const attacker = this.participant(attackerId);
        if (!Object.hasOwn(this.participants, targetId))
            valueError(`unknown target ${targetId}`);
        if (!weaponId)
            valueError('chase firearm attack requires canonical weapon_id');
        if (!this.rounds.length)
            this.beginRound();
        const cost = moving ? 0 : 1;
        if (cost)
            this.spend(attacker, cost);
        const target = this.participant(targetId);
        const combat = await CombatSession.create(`${this.chaseId}-ranged-${this.currentRound}-${this.turnCounter + 1}`, 'chase', this.currentRound, this.rng, this.tables);
        combat.addParticipant(attackerId, attacker.side === 'quarry' ? 'investigator' : 'npc', {
            dex: Math.max(1, int(attacker.dex)),
            combatSkill: int(or(attacker.fight, 50)),
            build: int(or(attacker.build, 0)),
            hpMax: int(or(attacker.hp_max, attacker.hp)),
            weapons: [weaponId],
            firearmsSkill: firearmsTarget,
            dodgeSkill: int(or(attacker.dodge, 0)),
            con: int(or(attacker.con, 50))
        });
        combat.participants[attackerId].hp_current = int(attacker.hp);
        combat.addParticipant(targetId, target.side === 'quarry' ? 'investigator' : 'npc', {
            dex: 0,
            combatSkill: int(or(target.fight, 50)),
            build: int(or(target.build, 0)),
            hpMax: int(or(target.hp_max, target.hp)),
            armor: int(or(target.armor, 0)),
            dodgeSkill: int(or(target.dodge, 0)),
            firearmsSkill: int(or(target.firearms, 0)),
            con: int(or(target.con, 50))
        });
        combat.participants[targetId].hp_current = int(target.hp);
        combat.beginRound();
        const turn = combatAttack(combat, attackerId, 'fire during chase', {
            action: 'attack',
            targetActorId: targetId,
            defenseKind: 'none',
            weaponId,
            fastMoving: moving
        });
        target.hp = int(combat.participants[targetId].hp_current);
        normalizeParticipantConditions(target);
        const [rolls, events] = combat.drainPending();
        this.pendingRolls.push(...rolls);
        this.pendingEvents.push(...events);
        return {
            type: 'fire_while_moving',
            moving,
            penalty: int(get(row(turn.attack_modifiers), 'penalty', 0)),
            movement_action_cost: cost,
            delegated: true,
            weapon_id: weaponId,
            combat_turn: turn,
            actions_spent: cost,
            target_id: targetId
        };
    }
    chooseRoute(actorId: string, alternateLocations: Array<Row | string>): Row {
        const participant = this.participant(actorId);
        if (participant.side !== 'quarry')
            valueError('only the quarry chooses the route');
        const position = participant.position;
        const kept = this.locationChain.slice(0, position + 1).map(normalizeLocation);
        const tail = alternateLocations.map((loc, i) => normalizeLocation(loc, position + 1 + i));
        this.locationChain = [...kept, ...tail];
        this.locationChain.forEach((loc, index) => { loc.index = index; });
        this.pendingEvents.push({
            kind: 'choose_route',
            actor_id: actorId,
            from_position: position,
            new_tail_labels: tail.map(loc => loc.label),
            rule_ref: 'core.chase.choosing_a_route'
        });
        return {
            type: 'choose_route',
            actor_id: actorId,
            from_position: position,
            location_count: this.locationChain.length,
            new_tail_labels: tail.map(loc => loc.label)
        };
    }
    suddenHazard(caller: string, options: {
        luckTarget?: number;
        hazard?: Row | null;
        atPosition?: number | null;
    } = {}): Row {
        if (!['players', 'keeper'].includes(caller))
            valueError("caller must be 'players' or 'keeper'");
        if (this.suddenHazardLastCaller !== null && this.suddenHazardLastCaller === caller)
            valueError('sudden hazards must alternate between players and keeper');
        const target = options.luckTarget ?? 50;
        const result = this.check(target);
        const rollId = this.rollId();
        this.pendingRolls.push({
            roll_id: rollId,
            actor_id: caller,
            skill: 'Luck',
            target,
            roll: result.roll,
            outcome: result.outcome,
            kind: 'sudden_hazard_luck'
        });
        const passed = !['failure', 'fumble'].includes(result.outcome);
        const placer = passed ? caller : caller === 'players' ? 'keeper' : 'players';
        this.suddenHazardLastCaller = caller;
        const quarries = values(this.participants).filter(p => p.side === 'quarry');
        const lead = quarries.length ? Math.max(...quarries.map(p => p.position)) : 0;
        const position = options.atPosition ?? Math.min(lead + 1, Math.max(0, this.locationChain.length - 1));
        const hazard = truth(options.hazard) ? options.hazard! : {
            hazard_id: `sudden_${this.currentRound}_${caller}`,
            skill: 'DEX',
            target: 50,
            difficulty: 'regular',
            damage_dice: '1D6',
            sudden: true
        };
        if (this.locationChain.length && position >= 0 && position < this.locationChain.length)
            this.locationChain[position].hazard = hazard;
        const output = {
            type: 'sudden_hazard',
            caller,
            placer,
            luck_outcome: result.outcome,
            luck_passed: passed,
            roll_id: rollId,
            position,
            hazard
        };
        this.pendingEvents.push({
            ...output,
            kind: 'sudden_hazard'
        });
        return output;
    }
    rollRandomHazard(environment = 'normal'): Row {
        const result = this.check(100, 'regular', environment === 'safe' ? 1 : 0, environment === 'hazardous' ? 1 : 0);
        const roll = result.roll;
        return {
            type: 'random_hazard',
            roll,
            kind: roll >= 60 ? 'hazard_or_barrier' : 'clear',
            difficulty: roll >= 96 ? 'extreme' : roll >= 85 ? 'hard' : 'regular',
            environment
        };
    }
    checkOutcome(): string | null {
        if (this.status !== 'active')
            return this.outcome;
        const quarries = values(this.participants).filter(p => p.side === 'quarry');
        if (!quarries.length)
            return null;
        if (quarries.every(p => truth(p.escaped)))
            return 'escaped';
        if (quarries.every(p => truth(p.captured) || truth(p.wrecked)))
            return 'captured';
        return null;
    }
    conclude(outcome: string): void {
        if (outcome === null || !CHASE_OUTCOMES.includes(outcome))
            valueError('invalid chase outcome');
        this.status = 'concluded';
        this.outcome = outcome;
        this.revision++;
    }
    snapshot(): Row {
        return {
            schema_version: CHASE_SCHEMA_VERSION,
            chase_id: this.chaseId,
            status: this.status,
            outcome: this.outcome,
            revision: this.revision,
            initiative_cursor: this.initiativeCursor,
            roll_counter: this.rollCounter,
            roll_history: [...this.rollHistory],
            turn_counter: this.turnCounter,
            current_round: this.currentRound,
            participants: clone(values(this.participants)),
            location_chain: clone(this.locationChain),
            rounds: clone(this.rounds),
            sudden_hazard_last_caller: this.suddenHazardLastCaller,
            play_language: this.playLanguage,
            consumed_combat_receipts: clone(this.consumedCombatReceipts)
        };
    }
    async save(port: ChaseSavePort): Promise<void> { const snapshot = this.snapshot(); validateSnapshot(snapshot); await port.writeSave('chase.json', snapshot); }
    static async load(port: ChaseSavePort, rng: PythonRandom, tables: RuleTables, arithmetic?: CheckArithmetic, options: {
        genesisEvidence?: Row | null;
        trustedStandalone?: boolean;
    } = {}): Promise<ChaseSession> {
        let data: Row;
        try {
            data = clone(await port.readSave('chase.json'));
            validateSnapshot(data);
            if (options.genesisEvidence == null) {
                if (!options.trustedStandalone)
                    valueError('chase genesis evidence is required');
            }
            else
                validateGenesisEvidence(data, options.genesisEvidence);
        }
        catch (error) {
            if ((error as Error).name === 'ValueError' && /^(chase snapshot|chase genesis)/.test((error as Error).message))
                throw error;
            return valueError(`chase snapshot is invalid: ${(error as Error).message}`);
        }
        const session = await ChaseSession.create(data.chase_id, rng, tables, arithmetic, {
            ...(typeof data.play_language === 'string' && data.play_language ? { playLanguage: data.play_language } : {})
        });
        session.status = get(data, 'status', 'active');
        session.outcome = data.outcome ?? null;
        session.revision = data.revision;
        session.initiativeCursor = data.initiative_cursor;
        session.rollCounter = data.roll_counter;
        session.rollHistory = [...data.roll_history];
        session.turnCounter = data.turn_counter;
        session.locationChain = clone(data.location_chain);
        session.rounds = [...array(data.rounds)];
        session.suddenHazardLastCaller = data.sudden_hazard_last_caller ?? null;
        session.currentRound = data.current_round;
        session.consumedCombatReceipts = [...data.consumed_combat_receipts];
        session.participants = orderedObject(array(data.participants).map(p => [p.actor_id, clone(p)]));
        return session;
    }
    drainPending(): Row[] { const pending = this.pendingRolls; this.pendingRolls = []; return pending; }
    drainEvents(): Row[] { const pending = this.pendingEvents; this.pendingEvents = []; return pending; }
    rollId(): string { const id = `chr${++this.rollCounter}`; this.rollHistory.push(id); return id; }
    nextTurn(): number { return ++this.turnCounter; }
}
