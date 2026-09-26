/** Combat session commands, pending defenses and canonical receipt publication. */
import { isJsonObject } from '../json.js';
import { RpcError } from '../errors.js';
import { array, clone, entries, equal, number, repr, row, sorted, string, truth, values, type Row } from '../read/values.js';
import { defenseOptions } from '../read/session-view.js';
import { rollExpression } from '../resolve/arithmetic.js';
import { OUT_OF_FIGHT_CONDITIONS } from '../healing/conditions.js';
import { presentOpponents, type SettleContext, type ExecutionResult } from '../resolve/context.js';
import { recordCombatRolls, recordCombatDamage, type DamageReceipt } from './receipts.js';
import { weaponRows } from '../mods/projection.js';
import { moveObject } from '../mods/objects.js';
import { objectTransferReceipt } from '../mods/object-transfer.js';
import { selectObjectWeapon } from '../mods/usages.js';
import { CombatSession, VALID_OUTCOMES } from './engine.js';
import { UnknownWeaponError } from './catalog.js';
import { combatOperationDestinations, combatOperationFor, investigatorCombatParticipant, moduleWeapons, npcCombatParticipant, resolveInvestigatorWeapon, sheetSkillValue, weaponOptions } from './profiles.js';
import { syncCombatants } from './resources.js';
import { archetypeIds } from '../apply/archetype.js';
const SELF_RESOLVING = ['aim', 'reload', 'maneuver', 'flee'];
export { presentOpponents } from '../resolve/context.js';
const turnState = (message: string, fix?: string, details?: Row): never => { throw new RpcError('turn_state', message, { ...(fix ? { fix } : {}), ...(details && Object.keys(details).length ? { details } : {}) }); };
export const eligibleParticipant = (participant: Row): boolean => number(participant.hp_current || 0) > 0 && ![...OUT_OF_FIGHT_CONDITIONS].some(value => array(participant.conditions).includes(value));
const cursorActor = (session: CombatSession): string | null => session.initiativeCursor >= 0 && session.initiativeCursor < session.currentInitiative.length ? string(session.currentInitiative[session.initiativeCursor].actor_id) : null;
function normalizeCursor(session: CombatSession): void {
    while (session.initiativeCursor < session.currentInitiative.length) {
        if (eligibleParticipant(session.participants[session.currentInitiative[session.initiativeCursor].actor_id]))
            return;
        session.markCurrentInitiativeSkipped();
        session.initiativeCursor++;
    }
    session.beginRound();
}
function conclusion(session: CombatSession, context: SettleContext, operation: Row): string | null {
    if (session.status !== 'active')
        return session.outcome;
    const participants = values(session.participants), investigators = participants.filter(value => value.side === 'investigator');
    if (investigators.length && investigators.every(value => array(value.conditions).includes('fled')))
        session.conclude('fled');
    else if (!participants.some(value => value.side === 'investigator' && eligibleParticipant(value)))
        session.conclude(string(operation.defeat_outcome || 'monsters_win'));
    else if (!participants.some(value => value.side !== 'investigator' && eligibleParticipant(value)))
        session.conclude(string(operation.victory_outcome || 'investigators_win'));
    else
        return null;
    session.endedAtTurn = context.turnNumber;
    return session.outcome;
}
function hpState(session: CombatSession): Row {
    const state: Row = {};
    for (const [id, participant] of entries(session.participants)) {
        const ammo: Row = {};
        for (const item of array(participant.weapons)) {
            const weapon = isJsonObject(item) ? item.weapon_id : string(item);
            let loaded: number | null;
            try {
                loaded = session.getAmmo(id, string(weapon));
            }
            catch (error) {
                if (!(error instanceof UnknownWeaponError) && !['KeyError', 'ValueError'].includes((error as Error).name))
                    throw error;
                loaded = null;
            }
            if (loaded !== null)
                ammo[string(session.weapon(id,string(weapon)).object_id ?? weapon)] = number(loaded);
        }
        state[id] = { hp: number(participant.hp_current), mp: number(participant.magic_points || 0), armor: number(participant.armor || 0), conditions: [...array(participant.conditions)], ammo };
    }
    return state;
}
async function emitDeltas(context: SettleContext, session: CombatSession, before: Row, damages: DamageReceipt[]): Promise<void> {
    const after = hpState(session), damagedHp = recordCombatDamage(context, damages);
    for (const [id, prior] of entries(before)) {
        const now = after[id];
        if (!now)
            continue;
        const priorHp = damagedHp.get(id) ?? prior.hp;
        if (now.hp !== priorHp) {
            const cause = [...damages].reverse().find(({damage}) => string(damage.target_actor_id) === id);
            const receiptId = context.addDelta('hp', id, priorHp, now.hp,
                cause ? { source_receipt: cause.receipt } : {});
            const receipt = context.receipts.find(row => row.id === receiptId);
            // A terminal effect such as destroy_target may change HP after the last damage record.
            // Keep the normal outcome effect and Keeper label intact; attribution is receipt-only.
            if (receipt) Object.assign(receipt, {
                public_combat: true,
                public_subject_label: context.publicCombatLabel(id),
                ...(cause ? { public_source_label: context.publicCombatLabel(string(cause.damage.source_actor_id)) } : {}),
            });
        }
        if (now.mp !== prior.mp)
            context.addDelta('mp', id, prior.mp, now.mp);
        if (!equal(now.conditions, prior.conditions))
            context.addEffect('condition', id, prior.conditions, now.conditions);
        for (const [weapon, loaded] of entries(now.ammo))
            if (prior.ammo[weapon] != null && prior.ammo[weapon] !== loaded)
                context.addDelta('ammo', id, prior.ammo[weapon], loaded, { weapon });
        if (now.armor !== prior.armor)
            context.addDelta('armor', id, prior.armor, now.armor);
    }
    await syncCombatants(context, session, session.status !== 'active');
}
const intentText = (args: Row, fallback: string) => string(args.goal_text || '').trim() || fallback;
export async function startCombat(context: SettleContext, args: Row): Promise<[
    CombatSession,
    Row
]> {
    const target = string(args.target_npc_id), present = new Map(presentOpponents(context).map(([handle, node, profile]) => [handle, [node, profile] as const]));
    if (!present.has(target))
        throw new RpcError('unknown_entity', `${target} is not in the current scene`, { details: { query: target, candidates: sorted(present.keys()) } });
    const [node, profile] = present.get(target)!;
    if (profile === null)
        throw new RpcError('needs', `${context.graph.displayName(node)} has no stat block in the module`, {
            fix: 'pin a stat block first: apply npc with archetype (one of details.needs.options, chosen from who this person is — ordinary_adult, capable_adult or dangerous_actor), then resolve again; when the module has a book that prints their numbers, read them with lookup kind=source instead. Or resolve it as an uncontested attempt against someone who cannot fight back. Nothing without a receipt has happened: do not narrate a blow as landed',
            details: { needs: { field: 'archetype', options: await archetypeIds(context.kernel), fightable: sorted([...present].filter(([, [, profile]]) => truth(profile)).map(([handle]) => handle)) } },
        });
    const sheet = context.actor, weaponId = args.weapon_id, weapon = truth(weaponId) ? await resolveInvestigatorWeapon(context.tables, sheet, string(weaponId)) : null;
    if (truth(weaponId) && weapon === null)
        throw new RpcError('needs', `${repr(weaponId)} is not a weapon the investigator carries`, {
            fix: `set action.weapon to one of details.needs.options, or arm ${string(weaponId)} first with apply item: its name plus the rules-table profile in weapon (a heavy blunt tool is club_large)`,
            details: { needs: { field: 'weapon', options: weaponOptions(sheet) } },
        });
    const activeScene = context.graph.scene(context.activeScene), [affordance, operation] = combatOperationFor(context.graph, activeScene, target, weapon?.weapon_id ?? null);
    if (!affordance) {
        const destinations = combatOperationDestinations(context.graph, context.world, activeScene, target, weapon?.weapon_id ?? null);
        if (destinations.length) {
            const publicDestinations = destinations.map(({ operation: _operation, ...destination }) => destination),
                choices = publicDestinations.map(destination => `${string(destination.name)} (${string(destination.scene)})`).join(', ');
            throw new RpcError('needs', `${context.graph.displayName(node)} has source-authored combat rules in ${choices}, not ${context.activeScene}`, {
                fix: `enter the authored encounter first: apply move with to set to one of details.destinations[].scene (${publicDestinations.map(destination => string(destination.scene)).join(', ')}); if ${context.graph.displayName(node)} is not present there, apply npc with that name and to: here; then retry this same chosen attack. Do not narrate a strike, roll damage or spend resources before those calls succeed`,
                details: { reason: 'combat_scene_required', target, current: context.activeScene, destinations: publicDestinations },
            });
        }
    }
    const opponent = row(operation.opponent);
    const extra = [...array(profile.weapons), ...array(opponent.weapons)].filter(value => isJsonObject(value) && (truth(value.extends) || truth(value.skill) && truth(value.damage || value.damage_die)));
    const catalog = await moduleWeapons(context.tables, context.graph, [...extra, ...weaponRows(context.world)]);
    const combatId = `${operation.combat_id || 'combat-' + context.activeScene}-t${context.turnNumber}`;
    const session = await CombatSession.create(combatId, `scene/${context.activeScene}`, context.turnNumber, context.rng, context.tables, catalog);
    const investigator = await investigatorCombatParticipant(context.tables, sheet, weapon), npc = await npcCombatParticipant(context.tables, target, profile), preferred = string(operation.opponent_weapon_id || '');
    if (preferred && Object.hasOwn(session.weaponCatalog, preferred))
        npc.weapons = [{ weapon_id: preferred }, ...npc.weapons.filter((value: Row) => value.weapon_id !== preferred)];
    for (const spec of [investigator, npc]) {
        session.addParticipant(spec.actor_id, spec.side, { dex: spec.dex, combatSkill: spec.combat_skill, build: spec.build, hpMax: spec.hp_max,
            characteristics: spec.characteristics,
            weapons: [...spec.weapons], conditions: [...spec.conditions], dodgeSkill: spec.dodge_skill, con: spec.con, firearmsSkill: spec.firearms_skill,
            hasReadyFirearm: spec.has_ready_firearm, damageBonus: spec.damage_bonus, magicPoints: spec.magic_points, armor: spec.armor, armorRule: spec.armor_rule });
        session.participants[spec.actor_id].hp_current = spec.hp_current;
        for (const owned of weaponRows(context.world, spec.actor_id))
            if (owned.ammo !== null)
                session.setAmmo(spec.actor_id, owned.weapon_id, owned.ammo);
    }
    const preparations: Row[] = [];
    for (const preparation of array(operation.preparations)) {
        if (!isJsonObject(preparation) || !Object.hasOwn(session.participants, string(preparation.actor_id)))
            continue;
        const participant = session.participants[string(preparation.actor_id)], before = number(participant.magic_points), cost = number(preparation.cost || 0);
        if (before < cost)
            continue;
        participant.magic_points = before - cost;
        if (cost)
            context.addDelta('mp', string(preparation.actor_id), before, participant.magic_points);
        const value: Row = { effect: preparation.effect_kind ?? null, actor: preparation.actor_id, mp_cost: cost, rule_ref: preparation.rule_ref ?? null };
        if (typeof preparation.armor_dice === 'string') {
            const rolled = rollExpression(preparation.armor_dice, context.rng);
            participant.armor = number(rolled.total);
            participant.armor_rule = preparation.armor_rule ?? null;
            value.armor = number(rolled.total);
            const id = context.addDiceRoll({ actor: string(preparation.actor_id), label: string(preparation.effect_kind || 'armor'), expression: rolled.expression, faces: rolled.rolls, total: rolled.total });
            context.addDelta('armor', string(preparation.actor_id), 0, number(rolled.total), { source_receipt: id });
        }
        session.applyEffect(string(preparation.actor_id), string(preparation.effect_kind || 'preparation'), string(preparation.actor_id), number(preparation.duration_rounds || 1), { rule_ref: preparation.rule_ref ?? null });
        preparations.push(value);
    }
    session.beginRound();
    session.revision = 1;
    context.addSessionReceipt('combat', 'start', { summary: context.graph.displayName(node) });
    return [session, { combat_id: combatId, affordance_id: affordance, operation, preparations, initiative: session.currentInitiative.map(value => ({ ...value })) }];
}
/**
 * The dice the keeper declared on this call, shaped for `CombatTurnOptions` (§95). Nothing is
 * returned when nothing was declared, so a plain call keeps the options object it always had.
 */
function declaredDice(args: Row, side: 'attacker' | 'defender'): Row {
    const bonus = Math.max(0, Math.trunc(number(args.bonus_dice ?? 0))), penalty = Math.max(0, Math.trunc(number(args.penalty_dice ?? 0)));
    if (!bonus && !penalty)
        return {};
    return side === 'attacker' ? { attackerBonus: bonus, attackerPenalty: penalty } : { defenderBonus: bonus, defenderPenalty: penalty };
}
function pendingAttack(session: CombatSession, context: SettleContext, actor: string, target: string, weaponId: string | null, operation: Row, intent: string, declared: Row = {}): Row {
    let weapon: Row;
    try {
        weapon = session.weapon(actor, weaponId);
    }
    catch (error) {
        if (!(error instanceof UnknownWeaponError))
            throw error;
        throw new RpcError('needs', error.message, { details: { needs: { field: 'weapon', options: [] } } });
    }
    const firearm = string(weapon.skill || '').startsWith('Firearms');
    const pending: Row = { attack_command_id: context.callId, actor_id: actor, target_actor_id: target, declared_intent: intent,
        resolution_hint: firearm ? 'firearm_attack' : 'opposed_melee', weapon_id: string(weapon.weapon_id || weaponId || 'unarmed'),
        ...(weapon.usage_id ? {usage_id:weapon.usage_id,object_id:weapon.object_id,usage:weapon.usage} : {}),
        rulebook_exception: null, on_success: null, victory_outcome: null, defeat_outcome: null,
        allowed_defenses: firearm ? ['dive_for_cover', 'none'] : ['dodge', 'fight_back'],
        // The attack is declared now and rolled on the defence call, so the keeper's dice wait here.
        ...(number(declared.bonus_dice) ? { bonus_dice: Math.trunc(number(declared.bonus_dice)) } : {}),
        ...(number(declared.penalty_dice) ? { penalty_dice: Math.trunc(number(declared.penalty_dice)) } : {}) };
    if (session.participants[actor].side === 'investigator') {
        if (typeof operation.rulebook_exception === 'string' && operation.investigator_weapon_id === pending.weapon_id) {
            pending.rulebook_exception = operation.rulebook_exception;
            if (isJsonObject(operation.on_success))
                pending.on_success = { ...operation.on_success };
        }
        if (typeof operation.victory_outcome === 'string')
            pending.victory_outcome = operation.victory_outcome;
    }
    else if (typeof operation.defeat_outcome === 'string')
        pending.defeat_outcome = operation.defeat_outcome;
    return pending;
}
function engineDefense(pending: Row, choice: string): string | null {
    return pending.resolution_hint === 'firearm_attack' ? ({ dodge: 'dive_for_cover', none: 'none' } as Row)[choice] ?? null : ({ dodge: 'dodge', fight_back: 'fight_back', none: 'none' } as Row)[choice] ?? null;
}
const loadCombat = (context: SettleContext) => CombatSession.load(context, context.rng, context.tables, { trustedInMemory: true });
const storedOperation = async (context: SettleContext): Promise<Row> => ({ ...row(row(await context.readSave('combat-operation.json')).operation) });
async function bindUsageSkill(context: SettleContext, session: CombatSession, actor: string, weaponId: any): Promise<void> {
    const sheet = context.sheetById(actor), profile = sheet ?? context.npcProfile(actor);
    if (profile && session.participants[actor])
        session.participants[actor].characteristics = Object.fromEntries(entries(row(profile.characteristics)).filter(([, value]) => Number.isInteger(value)));
    if (!weaponId) return;
    const weapon = row(session.weaponCatalog[string(weaponId)]);
    if (!weapon.usage_id) return;
    if (!profile) throw new RpcError('needs','The acting person needs a profile before using this object');
    const skills = {...row(profile.skills)};
    if (skills['Fighting (Brawl)'] == null && skills.Brawl != null) skills['Fighting (Brawl)'] = skills.Brawl;
    const value = await sheetSkillValue(context.tables,{...profile,skills},string(weapon.skill));
    if (value === null) throw new RpcError('needs','The usage skill is not available to this actor');
    const field = weapon.usage_mode === 'thrown' ? 'throw_skill' : weapon.usage_mode === 'firearm' ? 'firearms_skill' : 'combat_skill';
    session.participants[actor][field] = value;
    session.participants[actor].damage_bonus = string(row(profile.derived).DB ?? profile.damage_bonus ?? session.participants[actor].damage_bonus ?? 'none');
}
function validatePendingObjectUsage(context: SettleContext, session: CombatSession, pending: Row): void {
    const used = row(session.weaponCatalog[string(pending.weapon_id || '')]);
    if (!truth(used.object_id)) return;
    const current = selectObjectWeapon(context.world, string(used.object_id), used.usage ?? null, string(pending.actor_id));
    if (!current || current.weapon_id !== used.weapon_id || current.usage_id !== used.usage_id || current.object_id !== used.object_id)
        throw new RpcError('needs','The pending attack object usage is stale; restore the original holder and physical state before resolving its defense',
            {details:{reason:'usage_stale', object:used.object_id, usage:used.usage ?? null}});
}
function landThrownUsage(context: SettleContext, session: CombatSession, turn: Row | null, weaponId: any, actor: string): void {
    if (!turn) return;
    const used = row(session.weaponCatalog[string(weaponId || '')]);
    if (used.usage_mode !== 'thrown' || !truth(used.object_id)) return;
    const item = row(row(row(context.world.objects).instances)[string(used.object_id)]);
    if (!truth(item.id)) throw new RpcError('needs','The thrown object no longer exists in the world state');
    const scene = context.graph.scene(context.activeScene), owner = {kind:'scene', id:context.graph.handle(scene), name:context.graph.displayName(scene)};
    if (equal(item.owner, owner)) return;
    if (string(row(item.owner).id) !== actor) throw new RpcError('needs','The thrown object is no longer held by the original attacker', {details:{reason:'usage_stale', object:used.object_id}});
    const source = clone(row(item.owner));
    const moved = moveObject(context.world,string(item.name),null,owner,{source,turn:context.turnNumber,quantity:item.quantity});
    const definition = row(row(row(context.world.objects).definitions)[moved.definition]);
    const {receipt} = objectTransferReceipt({world:context.world, id:context.mint(`item:${context.callId}`), callId:context.callId, name:string(moved.name), owner, source, quantity:moved.quantity, item:moved, definition, why:'Thrown during combat resolution'});
    context.receipts.push(receipt);
    context.effects.push({kind:'object', object:moved.name, instance:moved.id, from:source.name ?? null, to:owner.name, reason:'thrown_landed'});
}
export async function executeCombatResolve(context: SettleContext, input: Row): Promise<ExecutionResult> {
    let args = input, kind = string(args.action_kind || 'attack'), actor = string(args.actor_id || context.actorId), started: Row | null = null;
    const hints: string[] = [], warnings: string[] = [], sessions = context.sessions();
    let operation: Row = {}, session: CombatSession;
    if (sessions.combat?.status === 'active') {
        session = await loadCombat(context);
        operation = await storedOperation(context);
    }
    else if (['attack', 'maneuver'].includes(kind)) {
        // §138.11: an NPC strikes the first blow.
        if (actor !== context.actorId && kind === 'attack' && context.npcNode(actor) !== null)
            return npcFirstBlow(context, args, actor);
        if (actor !== context.actorId)
            return turnState(`no combat is underway for ${actor} to act in`,
                'a fight opens on someone\'s attack: resolve with intent combat, the attacker as actor (an investigator or a person present), a target and a weapon; a manoeuvre comes once the fight is running');
        [session, started] = await startCombat(context, args);
        operation = { ...row(started.operation) };
        await context.writeSave('combat-operation.json', { combat_id: session.combatId, affordance_id: started.affordance_id, operation });
        const first = cursorActor(session);
        if (first !== null && first !== actor) {
            // The exchange is open and the rulebook's DEX order gives the first action to someone else. Until
            // 2026-09-11 this fell through to the "it is X's turn" refusal, the unsaved session vanished with
            // the failed call, and the next call for X met "no combat is underway": a fight against anyone
            // faster than the investigator could never start (table F, contract §34.11). The session is kept,
            // the start receipt lands, and the turn is handed to the first actor.
            session.revision++;
            await session.save(context);
            const view = context.sessions(), order = session.currentInitiative.map(value => `${value.actor_id} (DEX ${value.dex})`).join(', ');
            hints.push(`the exchange is open and ${first} acts first (DEX order: ${order}): resolve with actor: ${first}, intent combat, a target and a weapon; ${actor}'s own strike comes when the order reaches them`);
            const data: Row = { combat_id: session.combatId, revision: session.revision, round: session.currentRound, action: 'open', actor_id: actor, turn: null,
                pending_attack: null, status: session.status, outcome: session.outcome, session: view.combatView(), pending_choice: view.pendingChoice(),
                started: true, initiative: started.initiative, preparations: started.preparations, turn_of: first };
            return { data, warnings, hints };
        }
    }
    else
        return turnState('no combat is underway', 'start one: intent combat with a present target and a weapon');
    if (!Object.hasOwn(session.participants, actor))
        throw new RpcError('unknown_entity', `${actor} is not in this combat`, { details: { query: actor, candidates: sorted(Object.keys(session.participants)) } });
    if (kind === 'attack') await bindUsageSkill(context,session,actor,args.weapon_id);
    const before = hpState(session);
    let pending = session.pendingAttack, turn: Row | null = null, rolls: Row[] = [];
    if (pending && kind !== 'defend')
        return turnState(`an attack on ${pending.target_actor_id} awaits its defense`, `resolve with actor: ${pending.target_actor_id} and defense (one of ${defenseOptions(pending).join(', ')})`, { pending_defense: string(pending.target_actor_id) });
    if (kind === 'attack' && truth(args.unopposed)) {
        const holder = cursorActor(session);
        if (holder !== actor)
            return turnState(`it is ${string(holder)}'s turn, not ${actor}'s`, undefined, { turn_of: holder });
        const target = string(args.target_npc_id || '');
        if (!Object.hasOwn(session.participants, target))
            throw new RpcError('unknown_entity', `${target} is not in this combat`);
        pending = pendingAttack(session, context, actor, target, args.weapon_id ?? null, operation, intentText(args, `${actor} attacks ${target}`), args);
        session.pendingAttack = pending;
        actor = target;
        kind = 'defend';
        // A target who does not resist rolls nothing, so the dice declared on this one call are the
        // attacker's: they are already on the pending attack, and must not be read again as the
        // defender's or they would be counted twice (§95).
        args = { ...args, defense_kind: 'none', bonus_dice: 0, penalty_dice: 0 };
    }
    if (kind === 'defend') {
        if (!pending)
            return turnState('no attack awaits a defense', 'declare an attack first');
        const defender = string(pending.target_actor_id);
        if (actor !== defender)
            return turnState(`the pending defense belongs to ${defender}`, `resolve with actor: ${defender}`);
        const choice = string(args.defense_kind || ''), engine = engineDefense(pending, choice);
        if (engine === null || !pending.allowed_defenses.includes(engine) && engine !== 'none')
            throw new RpcError('invalid_params', `defense ${repr(choice)} is not legal against this attack`, { fix: 'set action.defense to one of details.options', details: { options: defenseOptions(pending) } });
        validatePendingObjectUsage(context, session, pending);
        await bindUsageSkill(context, session, string(pending.actor_id), pending.weapon_id ?? null);
        try {
            turn = session.declareAndResolveTurn(string(pending.actor_id), string(pending.declared_intent), { targetActorId: defender, defenseKind: engine,
                weaponId: pending.weapon_id ?? null, rulebookException: pending.rulebook_exception ?? null, resolutionHint: string(pending.resolution_hint), resolutionCommandId: context.callId,
                // This call resolves the defender's action, so the dice the keeper declared on it
                // are the defender's; the attack was declared -- and modified -- a call ago (§95).
                ...declaredDice(pending, 'attacker'), ...declaredDice(args, 'defender') });
        }
        catch (error) {
            if (!(error instanceof UnknownWeaponError))
                throw error;
            throw new RpcError('needs', error.message, { details: { needs: { field: 'weapon', options: [] } } });
        }
        [rolls] = session.drainPending();
        session.pendingAttack = null;
        // §138.11: the first blow is struck outside the rounds; it spends nobody's turn, and round 1 runs in DEX order.
        if (!truth(pending.first_blow)) {
            session.markCurrentInitiativeActed();
            session.initiativeCursor++;
        }
        const success = pending.on_success;
        if (isJsonObject(success) && success.kind === 'destroy_target' && ['hit', 'hit_after_cover'].includes(turn.outcome)) {
            const target = session.participants[defender];
            target.hp_current = 0;
            if (!target.conditions.includes('dead'))
                target.conditions.push('dead');
            session.conclude(string(success.outcome));
            session.endedAtTurn = context.turnNumber;
            hints.push(`${string(success.rule_ref)}: the target is destroyed outright`);
        }
        if (conclusion(session, context, operation) === null)
            normalizeCursor(session);
    }
    else {
        const holder = cursorActor(session);
        if (holder !== actor)
            return turnState(`it is ${string(holder)}'s turn, not ${actor}'s (DEX order: ${session.currentInitiative.map(value => `${value.actor_id} (DEX ${value.dex})`).join(', ')})`,
                // §138.5: a person whose turn it is may spend it on something that is not a fight action; that is a lawful way on.
                `settle ${string(holder)}'s turn first: resolve with actor: ${string(holder)} for a fight action, or -- when ${string(holder)} spends the turn on something else -- apply npc with name ${string(holder)}, intends (what they try) or intent_ref, outcome and spend_turn: true (action: hold when they only hold back); or combat:end`, { turn_of: holder });
        if (kind === 'attack') {
            const target = string(args.target_npc_id || '');
            if (!Object.hasOwn(session.participants, target))
                throw new RpcError('unknown_entity', `${target || 'the target'} is not in this combat`, { details: { query: target, candidates: Object.keys(session.participants).filter(id => id !== actor) } });
            let weapon = args.weapon_id ?? null;
            if (weapon === null && session.participants[actor].weapons.length) {
                const first = session.participants[actor].weapons[0];
                weapon = isJsonObject(first) ? first.weapon_id : string(first);
            }
            const cost = operation.opponent_attack_resource_cost, costWeapon = string(operation.opponent_weapon_id || '');
            if (session.participants[actor].side !== 'investigator' && isJsonObject(cost) && (!costWeapon || costWeapon === string(weapon))) {
                const before = number(session.participants[actor].magic_points || 0);
                if (before >= number(cost.cost || 0))
                    session.participants[actor].magic_points = before - number(cost.cost || 0);
            }
            session.pendingAttack = pendingAttack(session, context, actor, target, weapon, operation, intentText(args, `${actor} attacks ${target}`), args);
            hints.push(`an attack is pending: ${target} must answer with a defense`);
        }
        else if (SELF_RESOLVING.includes(kind)) {
            const target = string(args.target_npc_id || '') || null;
            try {
                turn = session.declareAndResolveTurn(actor, intentText(args, `${actor} ${kind}`), { targetActorId: target, defenseKind: kind === 'maneuver' ? 'dodge' : null,
                    weaponId: args.weapon_id ?? null, resolutionHint: kind, goal: kind === 'maneuver' ? args.goal ?? null : null, resolutionCommandId: context.callId,
                    ...declaredDice(args, 'attacker') });
            }
            catch (error) {
                if (!(error instanceof UnknownWeaponError) && (error as Error).name !== 'ValueError')
                    throw error;
                throw new RpcError('invalid_params', `combat ${kind} refused: ${(error as Error).message}`, {
                    fix: kind === 'maneuver'
                        ? 'a maneuver is one of the rulebook\'s four: set action.goal to disarm, ongoing_disadvantage, escape or push, and put the sentence in action.method'
                        : 'correct the named field and call again; the rest of the action is unchanged',
                });
            }
            [rolls] = session.drainPending();
            session.markCurrentInitiativeActed();
            session.initiativeCursor++;
            if (conclusion(session, context, operation) === null)
                normalizeCursor(session);
            // §138.10: an NPC who got away is out of the fight but still where the fight was; where they went is a move
            // the fiction decides. §139.12 (2026-09-26): a chase now admits them as its quarry, so the hint is the mirror
            // of an investigator's flight below -- the investigators still able to run after them, and that the pursuer
            // opens the chase with actor: <investigator> and target: <them>. (§139.9 had withdrawn the call while the
            // chase binding knew only one shape, the investigator as quarry.) §139.13: the player usually answers the flight
            // on their next turn, after the Keeper has already written where the person went, so the hint says the chase
            // start still reaches them until that turn is settled.
            if (kind === 'flee' && session.participants[actor].side !== 'investigator') {
                const pursuers = values(session.participants).filter(value => value.side === 'investigator' && eligibleParticipant(value)).map(value => string(value.actor_id));
                hints.push(pursuers.length
                    ? `${actor} fled the fight: a pursuit is the investigators' choice and the pursuer opens it -- if ${pursuers.join(' or ')} gives chase, resolve chase:start (intent move) with actor: <that investigator> and target ${actor}, and ${actor} is the chase's quarry; otherwise say where ${actor} went with apply npc to: away (or the scene they reach). Writing where they went does not end the pursuit: until the player's next turn is settled, that chase:start still runs after ${actor} from here`
                    : `${actor} fled the fight and no investigator able is left to give chase; say where ${actor} went with apply npc to: away (or the scene they reach)`);
            }
            // §139.9: an investigator's flight is the mirror. Whether anyone runs after them is the pursuer's own decision,
            // so nothing starts a chase here (the pipeline used to execute chase:start as the flight's continuation); the
            // hint names who is still able to give chase and how the pursuer opens it.
            else if (kind === 'flee') {
                const pursuers = values(session.participants).filter(value => value.side !== 'investigator' && eligibleParticipant(value)).map(value => string(value.actor_id));
                hints.push(pursuers.length
                    ? `${actor} fled the fight: a pursuit is the pursuer's choice and the pursuer opens it -- if ${pursuers.join(' or ')} gives chase, resolve chase:start (intent flee) with actor: <that pursuer> and target ${actor}; otherwise say where ${actor} went with apply move to: <the scene they ran to>`
                    : `${actor} fled the fight and no one able is left to give chase; say where ${actor} went with apply move to: <the scene they ran to>`);
            }
        }
        else {
            const options = sorted(['attack', 'defend', ...SELF_RESOLVING]);
            throw new RpcError('invalid_params', `unknown combat action ${repr(kind)}`, { fix: `use one of details.options: ${options.join(', ')}`, details: { field: 'action_kind', options } });
        }
    }
    session.revision++;
    const round = turn ? Number(turn.turn_id.split('-')[0].slice(1)) : session.currentRound;
    const damageReceipts = recordCombatRolls(context, turn, rolls, session.damageChain, round);
    landThrownUsage(context, session, turn, turn?.weapon_id ?? pending?.weapon_id ?? args.weapon_id ?? null, string(turn?.actor_id ?? pending?.actor_id ?? actor));
    await session.save(context);
    await emitDeltas(context, session, before, damageReceipts);
    if (session.status !== 'active') {
        context.addSessionReceipt('combat', 'end', { outcome: session.outcome });
        hints.push('combat is mechanically concluded; narrate the aftermath (no combat:end needed)');
    }
    const view = context.sessions();
    const data: Row = { combat_id: session.combatId, revision: session.revision, round: session.currentRound, action: kind, actor_id: actor, turn: turn ? { ...turn } : null,
        pending_attack: session.pendingAttack ? { ...session.pendingAttack } : null, status: session.status, outcome: session.outcome,
        session: view.combatView(), pending_choice: view.pendingChoice(), started: started !== null };
    const used = row(session.weaponCatalog[string(turn?.weapon_id ?? pending?.weapon_id ?? args.weapon_id ?? '')]);
    if (used.usage_id) data.object_usage = {object:used.name,usage:used.usage,instance:used.object_id,usage_id:used.usage_id};
    if (started) {
        data.initiative = started.initiative;
        data.preparations = started.preparations;
    }
    if (turn && truth(turn.outcome))
        data.turn_outcome = turn.outcome;
    return { data, warnings, hints };
}
/**
 * Contract §138.5: whose turn a saved fight is on, read off the raw save -- for a writer that must refuse before anything
 * lands. `null` when no fight is running. `pending` says an attack is waiting for its defence, when no turn can pass.
 */
export function fightTurn(combat: Row | null): { combat_id: string; round: number; turn_of: string | null; pending: boolean } | null {
    if (!isJsonObject(combat) || combat.status !== 'active') return null;
    const order = array(combat.current_initiative), cursor = number(combat.initiative_cursor);
    const at = cursor >= 0 && cursor < order.length ? row(order[cursor]) : null;
    return { combat_id: string(combat.combat_id), round: number(combat.current_round), turn_of: at ? string(at.actor_id) : null, pending: truth(combat.pending_attack) };
}
/**
 * Contract §138.5: an NPC spends their own turn of a fight on something that is not a fight action -- holds back, shouts
 * for help, grabs the telephone. Before this nothing could pass an NPC's turn but an attack, a manoeuvre, aim, reload or
 * flight, so a person who did anything else left the fight stuck on them ("it is <npc>'s turn") and the Keeper's only
 * way on was another blow. The turn is marked acted and the initiative moves on exactly as a self-resolving action moves
 * it; nothing is rolled here -- a roll the action needs is its own `resolve`.
 */
export async function passNpcTurn(context: SettleContext, handle: string): Promise<Row> {
    const session = await loadCombat(context);
    if (session.status !== 'active')
        return turnState('no fight is running; the turn has nothing to pass');
    if (session.pendingAttack)
        return turnState('an attack awaits its defence; resolve it before anyone spends a turn');
    const holder = cursorActor(session);
    if (holder !== handle)
        return turnState(`it is ${string(holder)}'s turn, not ${handle}'s`, undefined, { turn_of: holder });
    const round = session.currentRound;
    session.markCurrentInitiativeActed();
    session.initiativeCursor++;
    if (conclusion(session, context, {}) === null)
        normalizeCursor(session);
    session.revision++;
    await session.save(context);
    return { combat_id: session.combatId, round, passed: handle, turn_of: cursorActor(session), revision: session.revision };
}
/**
 * Contract §138.11: a person present strikes the first blow at an investigator -- the knee to the groin, the chair
 * swung without warning. Rulebook, "Striking the First Blow (Surprise)": whoever makes a sudden attack acts first, out
 * of DEX order, so the fight opens on their blow; the target who saw it coming may dodge or fight back, and one who did
 * not neither dodges nor fights back while the attacker gains one bonus die (the Harvey example: no opposing roll).
 * Whether the target saw it coming is the Keeper's ruling (`action.surprise: true` when they did not), usually after the
 * target's Listen, Spot Hidden or Psychology. After the blow the rounds run in DEX order; the blow spends no one's turn.
 */
async function npcFirstBlow(context: SettleContext, args: Row, attacker: string): Promise<ExecutionResult> {
    const target = string(args.target_npc_id || '') || context.actorId, hints: string[] = [], warnings: string[] = [];
    // The binding falls back to the investigator when the named target is not one; a first blow names its target.
    const named = context.action.target;
    if (context.sheetById(target) === null || typeof named === 'string' && named.trim() && context.sheetById(named) === null)
        throw new RpcError('needs', 'the first blow needs an investigator as action.target', { details: { needs: { field: 'target', options: context.party().map(sheet => string(sheet.name)) } } });
    const [session, started] = await startCombat(context, { ...args, target_npc_id: attacker, weapon_id: undefined });
    const operation: Row = { ...row(started.operation) };
    await context.writeSave('combat-operation.json', { combat_id: session.combatId, affordance_id: started.affordance_id, operation });
    let weapon = args.weapon_id ?? null;
    if (weapon === null && session.participants[attacker].weapons.length) {
        const first = session.participants[attacker].weapons[0];
        weapon = isJsonObject(first) ? first.weapon_id : string(first);
    }
    const before = hpState(session), surprise = truth(args.surprise);
    let turn: Row | null = null, rolls: Row[] = [];
    const intent = intentText(args, `${attacker} strikes ${target}${surprise ? ' without warning' : ''}`);
    if (surprise) {
        try {
            turn = session.declareAndResolveTurn(attacker, intent, { targetActorId: target, resolutionHint: 'surprise_attack', weaponId: weapon, resolutionCommandId: context.callId,
                ...declaredDice({ ...args, bonus_dice: Math.max(0, Math.trunc(number(args.bonus_dice ?? 0))) + 1 }, 'attacker') });
        }
        catch (error) {
            if (!(error instanceof UnknownWeaponError)) throw error;
            throw new RpcError('needs', error.message, { details: { needs: { field: 'weapon', options: session.participants[attacker].weapons.map((value: Row | string) => isJsonObject(value) ? string(value.weapon_id) : string(value)) } } });
        }
        [rolls] = session.drainPending();
        hints.push(`${attacker} struck first and ${target} never saw it coming: no dodge, no fighting back, one bonus die; the rounds now run in DEX order`);
    }
    else {
        session.pendingAttack = { ...pendingAttack(session, context, attacker, target, weapon, operation, intent, args), first_blow: true };
        hints.push(`${attacker} strikes the first blow and ${target} sees it coming: ${target} answers with a defence; the rounds run in DEX order after it`);
    }
    session.revision++;
    const damageReceipts = recordCombatRolls(context, turn, rolls, session.damageChain, session.currentRound);
    await session.save(context);
    await emitDeltas(context, session, before, damageReceipts);
    if (session.status !== 'active') {
        context.addSessionReceipt('combat', 'end', { outcome: session.outcome });
        hints.push('combat is mechanically concluded; narrate the aftermath (no combat:end needed)');
    }
    const view = context.sessions();
    const data: Row = { combat_id: session.combatId, revision: session.revision, round: session.currentRound, action: 'first_blow', actor_id: attacker, turn: turn ? { ...turn } : null,
        pending_attack: session.pendingAttack ? { ...session.pendingAttack } : null, status: session.status, outcome: session.outcome,
        session: view.combatView(), pending_choice: view.pendingChoice(), started: true, initiative: started.initiative, preparations: started.preparations,
        first_blow: { attacker, target, surprise } };
    if (turn && truth(turn.outcome)) data.turn_outcome = turn.outcome;
    return { data, warnings, hints };
}
export async function executeCombatEnd(context: SettleContext, args: Row): Promise<ExecutionResult> {
    if (context.sessions().combat === null)
        return turnState('no combat has been started', 'there is nothing to end');
    const session = await loadCombat(context), outcome = string(args.outcome || '').trim();
    if (session.status === 'concluded') {
        if (outcome && outcome !== session.outcome)
            throw new RpcError('invalid_params', `the combat already concluded as ${repr(session.outcome)}`, { details: { outcome: session.outcome } });
        return turnState(`the combat already ended (${session.outcome})`, 'narrate the aftermath');
    }
    if (session.pendingAttack)
        return turnState('an attack awaits its defense; resolve it before ending the fight');
    if (!VALID_OUTCOMES.has(outcome)) {
        const options = sorted([...VALID_OUTCOMES].filter((value): value is string => value !== null));
        throw new RpcError('invalid_params', `combat outcome must be one of ${repr(options)}`, { fix: 'set action.outcome', details: { options } });
    }
    const before = hpState(session);
    session.conclude(outcome);
    session.endedAtTurn = context.turnNumber;
    session.revision++;
    await session.save(context);
    await emitDeltas(context, session, before, []);
    context.addSessionReceipt('combat', 'end', { outcome });
    return { data: { combat_id: session.combatId, revision: session.revision, round: session.currentRound, status: session.status, outcome, session: context.sessions().combatView(), pending_choice: null },
        warnings: [], hints: ['the fight is closed; conditions from the exchange stay on the sheet'] };
}
