/** The existing schema-v4 chase audit: receipts must replay to the saved positions. */
import { isJsonObject, jsonDigest } from '../json.js';
import { array, entries, equal, integer, number, row, string, truth, type Row } from '../read/values.js';
import { valueError } from '../resolve/arithmetic.js';
import { CHASE_CONDITIONS, CHASE_OUTCOMES, CHASE_SCHEMA_VERSION, int } from './model.js';
const keys = (value: Row): Set<string> => new Set(Object.keys(value));
const sameKeys = (value: any, required: string[]): boolean => isJsonObject(value) && Object.keys(value).length === required.length && required.every(key => Object.hasOwn(value, key));
const subset = (values: Iterable<string>, allowed: Set<string>): boolean => [...values].every(value => allowed.has(value));
const nonnegative = (value: any): boolean => integer(value) && number(value) >= 0;
const pythonInt = (value: any): boolean => integer(value) || typeof value === 'boolean';
export function validateActionReceipt(action: any, turnActor: string, actorIds: Set<string>, locations: Row[]): [
    string[],
    number | null,
    number | null
] {
    if (!isJsonObject(action) || typeof action.type !== 'string')
        valueError('chase snapshot turn action is invalid');
    const value = action as Row;
    const rolls: string[] = [];
    let newPosition: number | null = null;
    let before: number | null = null;
    const exact = (required: string[], optional: string[] = []) => {
        if (!required.every(key => Object.hasOwn(value, key)) || !subset(Object.keys(value), new Set([...required, ...optional])))
            valueError('chase snapshot turn action contract is invalid');
    };
    const cost = (expected: number | number[]) => {
        if (!integer(value.actions_spent) || !(Array.isArray(expected) ? expected : [expected]).some(n => equal(n, value.actions_spent)))
            valueError('chase snapshot action cost is invalid');
    };
    const roll = (key = 'roll_id') => {
        if (typeof value[key] !== 'string' || !value[key])
            valueError('chase snapshot action roll evidence is invalid');
        rolls.push(value[key]);
    };
    const position = (label?: string): number => {
        if (!integer(value.new_position) || number(value.new_position) < 0 || number(value.new_position) >= locations.length)
            valueError('chase snapshot action position is invalid');
        if (label && !equal(value[label], locations[number(value.new_position)].label))
            valueError('chase snapshot action location transition is invalid');
        return number(value.new_position);
    };
    const predecessor = (): number => {
        if (!integer(value.position_before) || number(value.position_before) < 0 || number(value.position_before) >= locations.length)
            valueError('chase snapshot action predecessor is invalid');
        return number(value.position_before);
    };
    if (value.type === 'advance') {
        if (value.result === 'end_of_chain') {
            exact(['type', 'result', 'actions_spent']);
            cost(0);
            return [rolls, newPosition, before];
        }
        if (value.result === 'outdistanced') {
            exact(['type', 'result', 'position_before', 'escaped', 'actions_spent']);
            cost(1);
            if (value.escaped !== true)
                valueError('chase snapshot outdistanced receipt is invalid');
            return [rolls, newPosition, predecessor()];
        }
        if (value.result === 'blocked_by_barrier') {
            exact(['type', 'result', 'barrier_id', 'actions_spent']);
            cost(0);
            return [rolls, newPosition, before];
        }
        exact(['type', 'position_before', 'new_position', 'location_label', 'actions_spent'], ['escaped']);
        cost(1);
        before = predecessor();
        newPosition = position('location_label');
    }
    else if (value.type === 'hazard') {
        exact(['type', 'hazard_id', 'passed', 'roll_id', 'bonus', 'penalty', 'actions_spent', 'position_before', 'new_position', 'location_label'], ['escaped', 'damage', 'collision', 'movement_debt']);
        if (typeof value.passed !== 'boolean')
            valueError('chase snapshot hazard result is invalid');
        if (!integer(value.bonus) || ![0, 1, 2].some(n => equal(n, value.bonus)))
            valueError('chase snapshot hazard bonus is invalid');
        cost(1 + number(value.bonus));
        roll();
        before = predecessor();
        newPosition = position('location_label');
        if (value.passed && ['damage', 'collision', 'movement_debt'].some(key => Object.hasOwn(value, key)))
            valueError('chase snapshot hazard result is inconsistent');
        if (!value.passed && !Object.hasOwn(value, 'movement_debt'))
            valueError('chase snapshot hazard failure is incomplete');
    }
    else if (value.type === 'barrier') {
        exact(['type', 'position_before', 'passed', 'roll_id', 'actions_spent', 'barrier_id'], ['new_position', 'escaped']);
        cost(1);
        roll();
        before = predecessor();
        if (typeof value.passed !== 'boolean')
            valueError('chase snapshot barrier result is invalid');
        if (value.passed !== Object.hasOwn(value, 'new_position'))
            valueError('chase snapshot barrier transition is inconsistent');
        if (Object.hasOwn(value, 'new_position'))
            newPosition = position();
    }
    else if (value.type === 'break_barrier') {
        exact(['type', 'position_before', 'damage_to_barrier', 'barrier_hp_before', 'barrier_hp_after', 'destroyed', 'actions_spent', 'vehicle_wrecked', 'vehicle_damage'], ['new_position']);
        cost(1);
        before = predecessor();
        for (const key of ['damage_to_barrier', 'barrier_hp_before', 'barrier_hp_after', 'vehicle_damage'])
            if (!nonnegative(value[key]))
                valueError('chase snapshot barrier damage is invalid');
        if (!equal(value.barrier_hp_after, Math.max(0, number(value.barrier_hp_before) - number(value.damage_to_barrier))) || !equal(value.destroyed, equal(value.barrier_hp_after, 0)))
            valueError('chase snapshot barrier damage transition is inconsistent');
        if (Object.hasOwn(value, 'new_position'))
            newPosition = position();
    }
    else if (value.type === 'conflict') {
        if (Object.hasOwn(value, 'combat_receipt')) {
            exact(['type', 'attacker_id', 'defender_id', 'combat_command_id', 'combat_revision', 'combat_id', 'combat_receipt', 'actions_spent']);
            cost(1);
            if (value.attacker_id !== turnActor || !actorIds.has(value.defender_id))
                valueError('chase snapshot conflict actors are invalid');
        }
        else {
            exact(['type', 'result', 'target', 'roll_id', 'actions_spent']);
            cost(1);
            if (!['grabbed', 'missed'].includes(value.result) || !actorIds.has(value.target))
                valueError('chase snapshot legacy conflict is invalid');
            roll();
        }
    }
    else if (value.type === 'conflict_melee') {
        exact(['type', 'delegated', 'combat_turn', 'actions_spent', 'attacker_id', 'defender_id', 'position']);
        cost(1);
        if (value.delegated !== true || value.attacker_id !== turnActor || !actorIds.has(value.defender_id) || !isJsonObject(value.combat_turn))
            valueError('chase snapshot melee conflict is invalid');
    }
    else if (value.type === 'conflict_vehicle') {
        const common = ['type', 'actions_spent', 'attacker_skill'];
        if (value.result === 'impossible')
            exact([...common, 'result', 'reason']);
        else {
            exact([...common, 'attacker_outcome', 'defender_outcome', 'opposed', 'attacker_roll_id', 'defender_roll_id', 'winner', 'damage_to_loser'], ['both_fail', 'loser', 'damage_to_winner', 'build_loss', 'collision', 'movement_debt']);
            roll('attacker_roll_id');
            roll('defender_roll_id');
        }
        cost(1);
    }
    else if (value.type === 'hide') {
        exact(['type', 'success', 'roll_id', 'actions_spent']);
        cost(1);
        roll();
    }
    else if (value.type === 'pedal_to_the_metal') {
        exact(['type', 'locations_requested', 'locations_moved', 'penalty', 'assist_applied', 'actions_spent', 'position_before', 'new_position', 'hazard_results', 'escaped']);
        cost(1);
        before = predecessor();
        if (![2, 3, 4, 5].some(n => equal(n, value.locations_requested)) || !pythonInt(value.locations_moved) || number(value.locations_moved) < 0 || number(value.locations_moved) > number(value.locations_requested) || !Array.isArray(value.hazard_results))
            valueError('chase snapshot pedal result is invalid');
        newPosition = position();
        for (const nested of value.hazard_results)
            rolls.push(...validateActionReceipt(nested, turnActor, actorIds, locations)[0]);
    }
    else if (value.type === 'assist_driver') {
        exact(['type', 'success', 'roll_id', 'vehicle_id', 'actions_spent']);
        cost(0);
        roll();
        if (!actorIds.has(value.vehicle_id))
            valueError('chase snapshot passenger assist vehicle is invalid');
    }
    else if (value.type === 'fire_while_moving') {
        exact(['type', 'moving', 'penalty', 'movement_action_cost', 'delegated', 'weapon_id', 'combat_turn', 'actions_spent', 'target_id']);
        const expected = value.moving === true ? 0 : 1;
        if (value.delegated !== true || typeof value.weapon_id !== 'string' || !value.weapon_id || !isJsonObject(value.combat_turn) || !equal(value.movement_action_cost, expected) || !actorIds.has(value.target_id))
            valueError('chase snapshot firearm action is invalid');
        cost(expected);
        for (const key of ['roll_id', 'opposed_roll_id', 'damage_roll_id'])
            if (typeof value.combat_turn[key] === 'string' && value.combat_turn[key])
                rolls.push(value.combat_turn[key]);
    }
    else
        valueError('chase snapshot turn action discriminator is invalid');
    return [rolls, newPosition, before];
}
export function locationChainIdentity(locations: Row[]): Row[] {
    return locations.map(location => ({
        index: location.index ?? null,
        label: location.label ?? null,
        kind: location.kind ?? null,
        route_id: location.route_id ?? null,
        hazard_id: row(location.hazard).hazard_id ?? null,
        barrier_id: row(location.barrier).barrier_id ?? null
    }));
}
export function validateGenesisEvidence(data: Row, evidence: any): void {
    const required = ['record_type', 'sequence', 'command_id', 'command_hash', 'command_provenance', 'command', 'chase_id', 'participants', 'location_chain', 'location_chain_identity', 'genesis_hash'];
    if (!sameKeys(evidence, required))
        valueError('chase genesis evidence contract is invalid');
    const material = Object.fromEntries(entries(evidence).filter(([key]) => key !== 'genesis_hash'));
    if (evidence.record_type !== 'chase_genesis_v1' || !integer(evidence.sequence) || number(evidence.sequence) < 1 || evidence.chase_id !== data.chase_id || evidence.genesis_hash !== jsonDigest(material))
        valueError('chase genesis evidence identity is invalid');
    const participants = evidence.participants;
    const fields = ['actor_id', 'side', 'move_rate', 'build', 'dex', 'hp', 'conditions', 'position_origin'];
    if (!Array.isArray(participants) || !participants.length || participants.some(value => !sameKeys(value, fields)) || new Set(participants.map(value => value.actor_id)).size !== participants.length)
        valueError('chase genesis participant evidence is invalid');
    const persisted = new Map(array(data.participants).map(value => [value.actor_id, value]));
    if (persisted.size !== participants.length || participants.some(value => !persisted.has(value.actor_id)))
        valueError('chase genesis participant identity diverges');
    for (const origin of participants) {
        const current = persisted.get(origin.actor_id)!;
        const expected = {
            actor_id: current.actor_id,
            side: current.side,
            move_rate: current.mov_base,
            build: current.build_max,
            dex: current.dex,
            hp: current.hp_max,
            position_origin: current.position_origin
        };
        if (entries(expected).some(([key, value]) => !equal(origin[key], value)))
            valueError('chase genesis participant origin diverges');
        if (!Array.isArray(origin.conditions) || new Set(origin.conditions).size !== origin.conditions.length || origin.conditions.some((value: any) => !CHASE_CONDITIONS.has(value)))
            valueError('chase genesis participant conditions are invalid');
    }
    if (!Array.isArray(evidence.location_chain) || !equal(evidence.location_chain_identity, locationChainIdentity(evidence.location_chain)) || !equal(evidence.location_chain_identity, locationChainIdentity(data.location_chain)))
        valueError('chase genesis location chain identity diverges');
}
export function validateSnapshot(data: any): void {
    const rootKeys = ['schema_version', 'chase_id', 'status', 'outcome', 'revision', 'initiative_cursor', 'roll_counter', 'turn_counter', 'current_round', 'roll_history', 'participants', 'location_chain', 'rounds', 'sudden_hazard_last_caller', 'play_language', 'consumed_combat_receipts'];
    if (!sameKeys(data, rootKeys))
        valueError('chase snapshot root contract is invalid');
    if (!equal(data.schema_version, CHASE_SCHEMA_VERSION))
        valueError('chase snapshot schema_version is unsupported');
    if (typeof data.chase_id !== 'string' || !data.chase_id)
        valueError('chase snapshot chase_id is invalid');
    if (!['active', 'concluded'].includes(data.status) || !CHASE_OUTCOMES.includes(data.outcome))
        valueError('chase snapshot status/outcome is invalid');
    if ((data.status === 'active') !== (data.outcome === null))
        valueError('chase snapshot status/outcome is inconsistent');
    for (const key of ['revision', 'initiative_cursor', 'roll_counter', 'turn_counter', 'current_round'])
        if (!nonnegative(data[key]))
            valueError(`chase snapshot ${key} is invalid`);
    const participants = data.participants;
    if (!Array.isArray(participants) || !participants.length)
        valueError('chase snapshot participants are invalid');
    const actorIds = new Set<string>();
    const participantKeys = ['actor_id', 'side', 'role', 'mov_base', 'mov_adjusted', 'dex', 'con', 'drive_auto', 'is_vehicle', 'vehicle_key', 'vehicle_actor_id', 'position', 'position_origin', 'build', 'build_max', 'armor', 'hp', 'hp_max', 'fight', 'dodge', 'firearms', 'luck', 'conditions', 'spot_hidden', 'navigate', 'movement_actions', 'movement_actions_remaining', 'movement_debt', 'assist_penalty_reduction', 'captured', 'escaped', 'wrecked'];
    for (const participant of participants) {
        if (!sameKeys(participant, participantKeys) && !sameKeys(participant, [...participantKeys, '_build_damage_bank']))
            valueError('chase snapshot participant is invalid');
        const id = participant.actor_id;
        if (typeof id !== 'string' || !id || actorIds.has(id))
            valueError('chase snapshot actor identity is invalid');
        actorIds.add(id);
        if (!['quarry', 'pursuer', 'passenger', 'neutral'].includes(participant.side))
            valueError('chase snapshot participant side is invalid');
        if (!['driver', 'passenger'].includes(participant.role))
            valueError('chase snapshot participant role is invalid');
        if (typeof participant.is_vehicle !== 'boolean')
            valueError('chase snapshot participant vehicle marker is invalid');
        if (['captured', 'escaped', 'wrecked'].some(key => typeof participant[key] !== 'boolean'))
            valueError('chase snapshot participant flags are invalid');
        const conditions = participant.conditions;
        if (!Array.isArray(conditions) || new Set(conditions).size !== conditions.length || conditions.some(value => !CHASE_CONDITIONS.has(value)))
            valueError('chase snapshot participant conditions are invalid');
        for (const key of ['hp', 'hp_max', 'mov_base', 'mov_adjusted', 'dex', 'build', 'build_max', 'armor'])
            if (!nonnegative(participant[key]))
                valueError(`chase snapshot participant ${key} is invalid`);
        if (number(participant.hp) > number(participant.hp_max) || number(participant.build) > number(participant.build_max))
            valueError('chase snapshot participant health/build is invalid');
        if (conditions.includes('dead') && !equal(participant.hp, 0))
            valueError('chase snapshot dead participant HP is inconsistent');
        if (conditions.includes('dying') && (number(participant.hp) > 1 || !conditions.includes('major_wound')))
            valueError('chase snapshot dying participant is inconsistent');
        for (const key of ['position', 'position_origin', 'movement_actions', 'movement_actions_remaining', 'movement_debt'])
            if (!nonnegative(participant[key]))
                valueError(`chase snapshot participant ${key} is invalid`);
        if (number(participant.movement_actions_remaining) > number(participant.movement_actions))
            valueError('chase snapshot participant action budget is invalid');
    }
    const locations = data.location_chain;
    if (!Array.isArray(locations))
        valueError('chase snapshot location chain is invalid');
    const locationRequired = new Set(['index', 'label', 'hazard', 'barrier']);
    const allowed = new Set([...locationRequired, 'kind', 'route_id', 'notes']);
    if (locations.some((loc, index) => !isJsonObject(loc) || !subset(Object.keys(loc), allowed) || Object.keys(loc).length < locationRequired.size && subset(Object.keys(loc), locationRequired) || !equal(loc.index, index)))
        valueError('chase snapshot location indexes are invalid');
    const hazardKeys = new Set(['hazard_id', 'skill', 'target', 'difficulty', 'damage_dice', 'collision_severity', 'from_wreck', 'from_debris', 'sudden']);
    const barrierKeys = new Set(['barrier_id', 'hp', 'hp_max', 'skill', 'target', 'difficulty', 'damage_dice', 'description']);
    for (const location of locations) {
        if (typeof location.label !== 'string' || !location.label)
            valueError('chase snapshot location label is invalid');
        const hazard = location.hazard;
        const barrier = location.barrier;
        if (hazard != null && (!isJsonObject(hazard) || !subset(Object.keys(hazard), hazardKeys) || typeof hazard.hazard_id !== 'string'))
            valueError('chase snapshot hazard is invalid');
        if (barrier != null && (!isJsonObject(barrier) || !subset(Object.keys(barrier), barrierKeys) || typeof barrier.barrier_id !== 'string'))
            valueError('chase snapshot barrier is invalid');
        if (isJsonObject(barrier)) {
            for (const key of ['hp', 'hp_max'])
                if (!nonnegative(barrier[key]))
                    valueError('chase snapshot barrier HP is invalid');
            if (number(barrier.hp) > number(barrier.hp_max))
                valueError('chase snapshot barrier HP is inconsistent');
        }
    }
    if (locations.length && participants.some(p => number(p.position) >= locations.length))
        valueError('chase snapshot participant position is invalid');
    const byId = new Map<string, Row>(participants.map(p => [p.actor_id, p]));
    for (const participant of participants)
        if (participant.role === 'passenger') {
            const vehicle = byId.get(participant.vehicle_actor_id);
            if (participant.side !== 'passenger' || !vehicle || vehicle.is_vehicle !== true || !equal(participant.position, vehicle.position) || !equal(participant.movement_actions, 0) || !equal(participant.movement_actions_remaining, 0))
                valueError('chase snapshot passenger state is inconsistent');
        }
    const rounds = data.rounds;
    if (!Array.isArray(rounds) || !equal(data.current_round, rounds.length))
        valueError('chase snapshot round counter is invalid');
    const conflictReceipts: Row[] = [];
    const actionRollIds: string[] = [];
    const positions = new Map<string, number>(participants.map(p => [p.actor_id, number(p.position_origin)]));
    const receiptKeys = ['combat_command_id', 'combat_id', 'combat_revision', 'command_hash', 'receipt_hash'];
    for (let index = 0; index < rounds.length; index++) {
        const round = rounds[index];
        if (!sameKeys(round, ['round', 'dex_order', 'turns']) || !equal(round.round, index + 1) || !Array.isArray(round.dex_order) || new Set(round.dex_order).size !== round.dex_order.length || round.dex_order.some((id: any) => !actorIds.has(id)) || !Array.isArray(round.turns))
            valueError('chase snapshot round contract is invalid');
        const turnActors: string[] = [];
        for (const turn of round.turns) {
            if (!sameKeys(turn, ['turn_id', 'actor_id', 'dex', 'movement_actions', 'actions_taken']) || !round.dex_order.includes(turn.actor_id) || !Array.isArray(turn.actions_taken) || typeof turn.turn_id !== 'string')
                valueError('chase snapshot turn history is invalid');
            turnActors.push(turn.actor_id);
            const participant = byId.get(turn.actor_id)!;
            if (!equal(turn.dex, participant.dex) || !nonnegative(turn.movement_actions))
                valueError('chase snapshot turn actor state is inconsistent');
            for (const action of turn.actions_taken) {
                const [receiptRolls, nextPosition, priorPosition] = validateActionReceipt(action, turn.actor_id, actorIds, locations);
                actionRollIds.push(...receiptRolls);
                if (action.type === 'advance' && action.result != null) {
                    const standing = positions.get(turn.actor_id)!;
                    const next = locations[standing + 1] ?? null;
                    if (['end_of_chain', 'outdistanced'].includes(action.result)) {
                        if (next)
                            valueError('chase snapshot end-of-chain claim is inconsistent');
                        if (action.result === 'outdistanced' && participant.side !== 'quarry')
                            valueError('chase snapshot outdistanced claim is inconsistent');
                    }
                    else {
                        const barrier = next?.barrier;
                        if (!isJsonObject(barrier) || int(barrier.hp || 0) <= 0 || !equal(barrier.barrier_id, action.barrier_id))
                            valueError('chase snapshot barrier-block claim is inconsistent');
                    }
                }
                if (priorPosition !== null) {
                    const previous = positions.get(turn.actor_id)!;
                    if (priorPosition !== previous)
                        valueError('chase snapshot action position history is inconsistent');
                    if (action.type === 'pedal_to_the_metal') {
                        const expected = previous + number(action.locations_moved);
                        if (nextPosition !== expected || expected >= locations.length)
                            valueError('chase snapshot action position history is inconsistent');
                        const special = new Set<number>();
                        for (let at = previous + 1; at <= expected; at++)
                            if (locations[at].hazard != null || locations[at].barrier != null && int(locations[at].barrier.hp || 0) > 0)
                                special.add(at);
                        const covered = new Set<number>();
                        for (const nested of action.hazard_results) {
                            const [, next, before] = validateActionReceipt(nested, turn.actor_id, actorIds, locations);
                            if (before === null || before < previous || before > expected || next !== null && (next !== before + 1 || next > expected) || next === null && !['barrier', 'break_barrier'].includes(nested.type))
                                valueError('chase snapshot action position history is inconsistent');
                            if (next !== null)
                                covered.add(next);
                        }
                        if (![...special].every(at => covered.has(at)))
                            valueError('chase snapshot action position history is inconsistent');
                    }
                    else if (action.result !== 'outdistanced' && ['advance', 'hazard'].includes(action.type)) {
                        if (nextPosition !== previous + 1)
                            valueError('chase snapshot action position history is inconsistent');
                        const destination = locations[nextPosition!];
                        if (action.type === 'advance' && (destination.hazard != null || destination.barrier != null && int(destination.barrier.hp || 0) > 0))
                            valueError('chase snapshot action position history is inconsistent');
                        if (action.type === 'hazard' && (!isJsonObject(destination.hazard) || !equal(destination.hazard.hazard_id, action.hazard_id)))
                            valueError('chase snapshot action position history is inconsistent');
                    }
                    else if (['barrier', 'break_barrier'].includes(action.type)) {
                        const destination = previous + 1;
                        if (destination >= locations.length)
                            valueError('chase snapshot action position history is inconsistent');
                        const barrier = locations[destination].barrier;
                        if (!isJsonObject(barrier) || action.barrier_id != null && !equal(barrier.barrier_id, action.barrier_id))
                            valueError('chase snapshot action position history is inconsistent');
                        if (nextPosition !== null && nextPosition !== previous + 1)
                            valueError('chase snapshot action position history is inconsistent');
                    }
                    positions.set(turn.actor_id, nextPosition === null ? previous : nextPosition);
                }
                if (action.type === 'conflict' && Object.hasOwn(action, 'combat_receipt')) {
                    const receipt = action.combat_receipt;
                    if (!sameKeys(receipt, receiptKeys) || ['combat_command_id', 'combat_id', 'combat_revision'].some(key => !equal(receipt[key], action[key])) || !equal(action.actions_spent, 1) || action.attacker_id !== turn.actor_id || !pythonInt(receipt.combat_revision) || number(receipt.combat_revision) < 0 || receiptKeys.filter(key => key !== 'combat_revision').some(key => typeof receipt[key] !== 'string' || !receipt[key]))
                        valueError('chase snapshot combat receipt is invalid');
                    conflictReceipts.push(receipt);
                }
            }
            if (turn.actions_taken.reduce((sum: number, action: Row) => sum + number(action.actions_spent), 0) > number(turn.movement_actions))
                valueError('chase snapshot turn action budget is inconsistent');
        }
        if (!equal(turnActors, round.dex_order.slice(0, turnActors.length)))
            valueError('chase snapshot turn order is inconsistent');
        if (index + 1 < rounds.length && turnActors.length !== round.dex_order.length)
            valueError('chase snapshot historical round is incomplete');
    }
    const order = rounds.at(-1)?.dex_order ?? [];
    if (number(data.initiative_cursor) > order.length)
        valueError('chase snapshot initiative_cursor is invalid');
    if (rounds.length && !equal(rounds.at(-1).turns.length, data.initiative_cursor))
        valueError('chase snapshot initiative history is inconsistent');
    const turns = rounds.flatMap(r => r.turns);
    const turnIds: string[] = [];
    let offset = 0;
    for (const round of rounds)
        for (const _turn of round.turns)
            turnIds.push(`t${round.round}-${++offset}`);
    if (!equal(data.turn_counter, turns.length) || !equal(turns.map(t => t.turn_id), turnIds))
        valueError('chase snapshot turn counter/history is inconsistent');
    if (!equal(data.revision, number(data.current_round) + turns.length + (data.status === 'concluded' ? 1 : 0)))
        valueError('chase snapshot revision/history is inconsistent');
    if (!equal(data.roll_history, Array.from({
        length: number(data.roll_counter)
    }, (_, i) => `chr${i + 1}`)))
        valueError('chase snapshot roll counter/history is inconsistent');
    if (![null, 'keeper', 'players'].includes(data.sudden_hazard_last_caller))
        valueError('chase snapshot sudden hazard caller is invalid');
    if (typeof data.play_language !== 'string' || !data.play_language)
        valueError('chase snapshot play language is invalid');
    const receipts = data.consumed_combat_receipts;
    if (!Array.isArray(receipts) || receipts.some(receipt => !sameKeys(receipt, receiptKeys)) || new Set(receipts.map(receipt => receipt.combat_command_id)).size !== receipts.length || receipts.some(receipt => !pythonInt(receipt.combat_revision) || number(receipt.combat_revision) < 0 || receiptKeys.filter(key => key !== 'combat_revision').some(key => typeof receipt[key] !== 'string' || !receipt[key])))
        valueError('chase snapshot combat receipts are invalid');
    if (!equal(conflictReceipts, receipts))
        valueError('chase snapshot combat receipt/action history diverges');
    const indexes = actionRollIds.map(id => data.roll_history.indexOf(id));
    if (new Set(actionRollIds).size !== actionRollIds.length || indexes.some(index => index < 0) || !equal(indexes, [...indexes].sort((a, b) => a - b)))
        valueError('chase snapshot action roll history diverges');
    for (const participant of participants)
        if (participant.role === 'passenger')
            positions.set(participant.actor_id, positions.get(participant.vehicle_actor_id)!);
    if (participants.some(participant => !equal(participant.position, positions.get(participant.actor_id))))
        valueError('chase snapshot action/final position diverges');
}
