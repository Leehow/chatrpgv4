/** Combat, chase and sanity views read saved snapshots without loading an engine writer. */
import { ModuleGraph, recordOf } from "./module-graph.js";
import { CampaignSnapshot } from "./campaign.js";
import { entries, array, row, number, truth, string, integer, type Row } from "./values.js";
import { OUT_OF_FIGHT_CONDITIONS } from "../healing/conditions.js";
export const active = (snapshot: Row | null): boolean => snapshot?.status === "active";
export const boutActive = (snapshot: Row | null): boolean => truth(snapshot?.bout_active);
export function defenseOptions(pending: Row): string[] {
    const firearm = pending.resolution_hint === "firearm_attack",
        allowed = new Set(array(pending.allowed_defenses));
    return ["dodge", "fight_back", "none"].filter(choice => choice === "none" || choice === "dodge" && allowed.has(firearm ? "dive_for_cover" : "dodge") || !firearm && choice === "fight_back" && allowed.has(choice));
}
export class SessionView {
    readonly combat: Row | null;
    readonly chase: Row | null;
    readonly sanity: Map<string, Row | null>;
    readonly partyIds: Set<string>;
    constructor(readonly campaign: CampaignSnapshot, readonly graph: ModuleGraph, readonly party: Row[], readonly world: Row) {
        this.combat = campaign.saved("combat.json");
        this.chase = campaign.saved("chase.json");
        this.sanity = new Map(party.map(sheet => [string(sheet.id), campaign.sanity(string(sheet.id))]));
        this.partyIds = new Set(party.map(sheet => string(sheet.id)));
    }
    label(id: string): string {
        const sheet = this.party.find(s => string(s.id) === id);
        if (sheet)
            return string(sheet.name || id);
        const node = this.graph.find(id, ["npc"]);
        return node ? this.graph.displayName(node) : id;
    }
    isInvestigator(id: string): boolean {
        return this.partyIds.has(id);
    }
    combatTurnOf(snapshot: Row): string | null {
        const order = array(snapshot.current_initiative),
            cursor = number(snapshot.initiative_cursor);
        return cursor >= 0 && cursor < order.length && Object.keys(row(order[cursor])).length ? string(order[cursor].actor_id) : null;
    }
    combatActions(snapshot: Row): Row[] {
        const pending = snapshot.pending_attack;
        if (pending && typeof pending === "object" && !Array.isArray(pending)) {
            const actor = string(pending.target_actor_id);
            return [{
                    decision: "combat:defend",
                    actor,
                    options: defenseOptions(pending),
                    for: this.isInvestigator(actor) ? "player" : "npc"
                }];
        }
        const actor = this.combatTurnOf(snapshot);
        if (actor == null || !active(snapshot))
            return [];
        const participants = new Map(array(snapshot.participants).map(p => [string(p.actor_id), p])),
            me = row(participants.get(actor));
        const targets = [...participants].filter(([id, p]) => id !== actor && p.side !== me.side && number(p.hp_current) > 0 && !array(p.conditions).some(c => OUT_OF_FIGHT_CONDITIONS.has(c))).map(([id]) => id);
        const weapons = array(me.weapons).map(w => string(typeof w === "object" ? w.weapon_id : w)),
            catalog = row(snapshot.weapon_catalog);
        const actions: Row[] = [{
                decision: "combat:attack",
                actor,
                targets,
                weapons
            }];
        if (weapons.some(w => catalog[w] && catalog[w].magazine != null))
            actions.push({
                decision: "combat:aim",
                actor
            }, {
                decision: "combat:reload",
                actor
            });
        actions.push({
            decision: "combat:maneuver",
            actor,
            targets
        });
        if (this.isInvestigator(actor))
            actions.push({
                decision: "combat:flee",
                actor
            });
        actions.push({
            decision: "combat:end",
            actor
        });
        return actions;
    }
    combatView(snapshot = this.combat): Row | null {
        if (!snapshot)
            return null;
        const pending = snapshot.pending_attack,
            defender = string(row(pending).target_actor_id);
        return {
            kind: "combat",
            status: active(snapshot) ? "active" : "ended",
            round: number(snapshot.current_round),
            turn_of: active(snapshot) ? this.combatTurnOf(snapshot) : null,
            actions: active(snapshot) ? this.combatActions(snapshot) : [],
            pending_defense: pending && typeof pending === "object" ? {
                for: this.isInvestigator(defender) ? "player" : "npc",
                actor: defender,
                attacker: string(pending.actor_id),
                options: defenseOptions(pending)
            } : null,
            participants: array(snapshot.participants).map(p => ({
                name: string(p.actor_id),
                label: this.label(string(p.actor_id)),
                side: p.side ?? null,
                hp: p.hp_current ?? null,
                hp_max: p.hp_max ?? null,
                conditions: array(p.conditions),
                ...(truth(p.armor) ? { armor: p.armor } : {})
            })),
            ...(!active(snapshot) ? { outcome: snapshot.outcome ?? null } : {})
        };
    }
    chaseTurnOf(snapshot: Row): string | null {
        const order = array(array(snapshot.rounds).at(-1)?.dex_order),
            cursor = number(snapshot.initiative_cursor);
        return cursor >= 0 && cursor < order.length ? string(order[cursor]) : null;
    }
    chasePendingKind(snapshot: Row): string | null {
        if (!active(snapshot))
            return null;
        const participants = array(snapshot.participants),
            quarries = participants.filter(p => p.side === "quarry");
        if (quarries.length && quarries.every(q => truth(q.escaped) || truth(q.captured)))
            return "end";
        const actor = participants.find(p => string(p.actor_id) === this.chaseTurnOf(snapshot));
        if (!actor)
            return "move";
        const position = number(actor.position),
            next = array(snapshot.location_chain)[position + 1];
        if (actor.side === "pursuer" && quarries.some(q => !truth(q.escaped) && !truth(q.captured) && number(q.position, -2) === position))
            return "conflict";
        if (next?.barrier && number(next.barrier.hp) > 0)
            return "barrier";
        if (next?.hazard && typeof next.hazard === "object")
            return "hazard";
        return "move";
    }
    chaseOutcome(snapshot: Row): string | null {
        const quarries = array(snapshot.participants).filter(q => q.side === "quarry");
        return !quarries.length ? null : quarries.every(q => truth(q.escaped)) ? "escaped" : quarries.every(q => truth(q.captured) || truth(q.wrecked)) ? "captured" : null;
    }
    chaseActions(snapshot: Row): Row[] {
        const kind = this.chasePendingKind(snapshot),
            actor = this.chaseTurnOf(snapshot),
            participants = array(snapshot.participants),
            me = row(participants.find(p => string(p.actor_id) === actor));
        const remaining = number(me.movement_actions_remaining),
            position = number(me.position),
            next = array(snapshot.location_chain)[position + 1],
            actions: Row[] = [];
        if (kind === "end")
            return [{
                    decision: "chase:end",
                    outcome: this.chaseOutcome(snapshot)
                }];
        if (kind === "conflict") {
            const targets = participants.filter(p => string(p.actor_id) !== actor && p.side === "quarry" && number(p.position, -2) === position && !truth(p.escaped) && !truth(p.captured)).map(p => string(p.actor_id));
            actions.push({
                decision: "chase:conflict",
                actor,
                action: targets.length ? `conflict:${targets[0]}` : null,
                targets,
                cost: 1,
                resolves: "a Fighting roll: success grabs the quarry (captured)"
            });
        }
        else if (kind === "barrier" && next)
            for (const method of ["negotiate", "break"])
                actions.push({
                    decision: "chase:barrier",
                    actor,
                    method,
                    action: `barrier:${string(next.barrier.barrier_id)}:${method}`,
                    cost: 1,
                    skill: next.barrier.skill ?? null,
                    target: next.barrier.target ?? null
                });
        else if (kind === "hazard" && next)
            actions.push({
                decision: "chase:hazard",
                actor,
                action: `hazard:${string(next.hazard.hazard_id)}`,
                cost: 1,
                skill: next.hazard.skill ?? null,
                target: next.hazard.target ?? null,
                difficulty: next.hazard.difficulty ?? "regular"
            });
        else
            actions.push({
                decision: "chase:move",
                actor,
                action: "move:advance",
                cost: 1
            });
        for (const action of actions) {
            action.movement_actions_remaining = remaining;
            if (remaining <= 0 && action.decision === "chase:move")
                Object.assign(action, {
                    cost: 0,
                    note: "no movement actions this round (hazard debt): the actor passes"
                });
        }
        return actions;
    }
    chaseOutlook(snapshot: Row): string[] {
        const chain = array(snapshot.location_chain),
            quarries = array(snapshot.participants).filter(q => q.side === "quarry"),
            pursuers = array(snapshot.participants).filter(p => p.side === "pursuer"),
            result: string[] = [];
        for (const quarry of quarries) {
            const name = string(quarry.actor_id),
                ahead = Math.max(0, chain.length - 1 - number(quarry.position));
            result.push(truth(quarry.escaped) ? `${name} has escaped -- settle chase:end` : truth(quarry.captured) ? `${name} has been caught -- settle chase:end` : ahead === 0 ? `${name} is on the last location of the track; its next advance runs clear of the chase and ends it` : `${name} is ${ahead} location(s) from the end of the track, and running past it is an escape`);
        }
        for (const pursuer of pursuers) {
            const gaps = quarries.filter(q => !truth(q.escaped) && !truth(q.captured)).map(q => number(q.position) - number(pursuer.position));
            if (!gaps.length)
                continue;
            const gap = gaps.sort((a, b) => Math.abs(a) - Math.abs(b))[0],
                name = string(pursuer.actor_id);
            result.push(gap > 0 ? `${name} is ${gap} location(s) behind the quarry` : `${name} has closed to the quarry's own location; catching it is a chase conflict, which needs a combat defence receipt`);
        }
        if (!chain.some(loc => truth(loc.barrier) || truth(loc.hazard)))
            result.push("no location in this chase's track carries a barrier or a hazard, so chase:barrier and chase:hazard cannot become available on it");
        return result;
    }
    chaseView(snapshot = this.chase): Row | null {
        if (!snapshot)
            return null;
        return {
            kind: "chase",
            status: active(snapshot) ? "active" : "ended",
            round: number(snapshot.current_round),
            turn_of: active(snapshot) ? this.chaseTurnOf(snapshot) : null,
            actions: active(snapshot) ? this.chaseActions(snapshot) : [],
            pending_defense: null,
            pending_kind: this.chasePendingKind(snapshot),
            participants: array(snapshot.participants).map(p => ({
                name: string(p.actor_id),
                label: this.label(string(p.actor_id)),
                side: p.side ?? null,
                hp: p.hp ?? null,
                position: p.position ?? null,
                mov: p.mov_adjusted ?? null,
                movement_actions: p.movement_actions ?? null,
                escaped: truth(p.escaped),
                captured: truth(p.captured)
            })),
            locations: array(snapshot.location_chain).map(loc => ({
                index: loc.index ?? null,
                label: loc.label ?? null,
                ...(loc.hazard && typeof loc.hazard === "object" ? { hazard: loc.hazard.hazard_id ?? null } : {}),
                ...(loc.barrier && typeof loc.barrier === "object" ? { barrier: loc.barrier.barrier_id ?? null } : {})
            })),
            outlook: this.chaseOutlook(snapshot),
            ...(!active(snapshot) ? { outcome: snapshot.outcome ?? null } : {})
        };
    }
    boutView(id: string, snapshot = this.sanity.get(id)): Row | null {
        if (!snapshot)
            return null;
        const active = boutActive(snapshot),
            bouts = array(snapshot.bouts_of_madness),
            bout = row(bouts.find(b => b.bout_id === snapshot.active_bout_id) ?? bouts.at(-1)),
            duration = number(bout.duration_rounds),
            remaining = number(snapshot.bout_rounds_remaining);
        return {
            kind: "sanity_bout",
            status: active ? "active" : "ended",
            round: Math.max(0, duration - remaining) + (active ? 1 : 0),
            turn_of: active ? id : null,
            actions: active ? [{
                    decision: "sanity:bout-tick",
                    actor: id
                }, {
                    decision: "sanity:bout-end",
                    actor: id
                }] : [],
            pending_defense: null,
            participants: [{
                    name: id,
                    label: this.label(id),
                    side: "investigator",
                    san: snapshot.san_current ?? null
                }],
            bout: {
                id: bout.bout_id ?? null,
                mode: bout.mode ?? null,
                result: bout.bout_result ?? null,
                kind: bout.bout_kind ?? null,
                rounds_remaining: remaining,
                duration_rounds: duration,
                phobia: bout.phobia ?? null,
                mania: bout.mania ?? null
            },
            insanity: {
                temporary: truth(snapshot.temporary_insane),
                indefinite: truth(snapshot.indefinite_insane),
                permanent: truth(snapshot.permanently_insane)
            }
        };
    }
    activeSession(): Row | null {
        if (active(this.combat))
            return this.combatView();
        if (active(this.chase))
            return this.chaseView();
        for (const [id, snapshot] of this.sanity)
            if (boutActive(snapshot))
                return this.boutView(id);
        return null;
    }
    pendingChoice(): Row | null {
        const pending = this.combat?.pending_attack;
        if (active(this.combat) && pending && typeof pending === "object") {
            const attacker = string(pending.actor_id),
                defender = string(pending.target_actor_id),
                options = defenseOptions(pending),
                player = this.isInvestigator(defender);
            return {
                name: `defense:${attacker}-r${number(this.combat!.current_round)}`,
                for: player ? "player" : "keeper",
                prompt: player ? `${this.label(attacker)} attacks you. How do you respond? (${options.join(" / ")})` : `${this.label(attacker)} attacks ${this.label(defender)}: on the next resolve use actor: ${defender} and pick a defense (${options.join(" / ")})`,
                options
            };
        }
        for (const [id, snapshot] of this.sanity)
            if (boutActive(snapshot)) {
                const view = this.boutView(id)!,
                    bout = view.bout;
                return {
                    name: `bout:${id}-r${view.round}`,
                    for: "keeper",
                    prompt: `${this.label(id)} is in a bout of madness (${string(bout.result)}, ${bout.rounds_remaining} rounds left): advance one round (sanity:bout-tick) or end it now (sanity:bout-end)?`,
                    options: ["sanity:bout-tick", "sanity:bout-end"]
                };
            }
        return null;
    }
    facts(id: string, minutes: number): Row {
        const snapshot = row(this.sanity.get(id)),
            pendingKind = this.chase ? this.chasePendingKind(this.chase) : null,
            recovery = snapshot.recovery_trigger,
            treatment = snapshot.treatment_trigger;
        const ready = !active(this.chase) && this.party.length > 0 && entries(row(this.world.npc_presence)).some(([name, at]) => {
            if (at !== this.world.active_scene)
                return false;
            const node = this.graph.find(name, ["npc"]);
            if (!node)
                return false;
            // The book's numbers, or a profile the table pinned from a rulebook archetype (contract §34.10).
            const profile = row(recordOf(node).mechanics).profile ?? row(this.world.npc_profiles)[name];
            return !!profile && typeof profile === "object" && !Array.isArray(profile);
        });
        const gain = this.campaign.saved(`sanity-gain-pending/${id}.json`);
        return {
            "chase.session.active": active(this.chase),
            "chase.session.inactive": !active(this.chase),
            "chase.start.ready": ready,
            "chase.pending.kind": pendingKind,
            "chase.conflict.receipt-ready": pendingKind === "conflict",
            "sanity.bout.pending": boutActive(snapshot),
            "sanity.delusion.active": !!snapshot.active_delusion && typeof snapshot.active_delusion === "object",
            "sanity.insane": truth(snapshot.temporary_insane) || truth(snapshot.indefinite_insane),
            "sanity.recovery.due": truth(snapshot.temporary_insane) && !!recovery && minutes >= number(recovery.due_elapsed_minutes),
            "sanity.treatment.due": truth(snapshot.indefinite_insane) && !!treatment && minutes >= number(treatment.due_elapsed_minutes),
            "sanity.gain.pending": integer(gain?.san_gain) && number(gain?.san_gain) > 0,
            "subsystem.snapshot.active": active(this.combat) || active(this.chase)
        };
    }
}
