/** Canonical settlement results, receipt markers, ruling matches and telemetry. */
import type { DomainEvent } from '../transactions.js';
import { RuleGraph } from '../rules/graph.js';
import { SLOT_TO_ACTION } from '../rules/planning.js';
import { latestNamed } from '../read/memory.js';
import { semanticName } from '../read/rule-facts.js';
import { markersFor } from '../write/text.js';
import { orderedObject } from '../json.js';
import { array, entries, normalize, number, row, string, truth, type Row } from '../read/values.js';
import { SettleContext, continuableCheck } from './context.js';
import { APPROACH_BY_SKILL } from './arithmetic.js';
import { COMBINED, LUCK, LUCK_ROLL, OBSERVE, OPPOSED, ORDINARY, PUSH, REALIZE, SOCIAL } from './bindings.js';
export function continuationEntry(runtime: RuleGraph, ref: string): Row {
    const fields = ref === PUSH ? ['push', 'stakes', 'method'] : ref === LUCK ? ['luck'] : ['decision'];
    if (![PUSH, LUCK].includes(ref))
        for (const slot of runtime.requiredSemanticSlots(ref)) {
            const field = SLOT_TO_ACTION[slot];
            if (field && !fields.includes(field))
                fields.push(field);
        }
    return {
        decision: semanticName(ref),
        action: fields,
        when: runtime.nodes.get(ref)?.name ?? null
    };
}
export function checkView(check: Row): Row {
    return {
        skill: check.skill ?? null,
        target: check.target ?? null,
        difficulty: check.difficulty ?? null,
        threshold: check.threshold ?? null,
        roll: check.roll ?? null,
        level: check.level ?? null,
        passed: check.passed ?? null,
        bonus: check.bonus ?? 0,
        penalty: check.penalty ?? 0
    };
}
export function outcomeOf(ref: string, result: Row): Row {
    const bound = row(result.bound_check);
    if ([ORDINARY, COMBINED, LUCK_ROLL].includes(ref)) {
        if (ref === COMBINED || truth(bound.combined_roll)) {
            const combined = row(bound.combined_roll);
            return {
                kind: 'combined',
                ...checkView(bound),
                mode: combined.comparison_mode ?? null,
                targets: array(combined.targets),
                passed: combined.overall_success ?? null,
                pushed: false
            };
        }
        return {
            kind: 'check',
            ...checkView(bound),
            pushed: false
        };
    }
    if (ref === OPPOSED)
        return {
            kind: 'opposed',
            skill: result.skill ?? null,
            investigator: checkView({
                ...result.investigator_roll,
                skill: result.skill ?? null
            }),
            opponent: checkView({
                ...result.opponent_roll,
                skill: result.opponent_skill ?? null
            }),
            opponent_id: result.opponent_id ?? null,
            winner: result.winner ?? null
        };
    if (ref === PUSH)
        return {
            kind: 'push',
            ...checkView(bound),
            pushed: true,
            source_receipt: result.original_check_decision_id ?? null,
            failure_consequence: result.failure_consequence ?? null
        };
    if (ref === LUCK) {
        const spend = row(result.luck_spend);
        return {
            kind: 'luck',
            points: result.points ?? null,
            luck_before: spend.luck_before ?? null,
            luck_after: spend.luck_after ?? null,
            source_receipt: spend.original_check_decision_id ?? null,
            ...Object.fromEntries(['skill', 'target', 'difficulty', 'threshold', 'roll', 'level', 'passed'].map(key => [key, spend[key] ?? null]))
        };
    }
    if (ref === SOCIAL) {
        const adjudication = row(result.adjudication);
        const outcome: Row = {
            kind: 'social',
            npc: adjudication.npc_id ?? null,
            approach: adjudication.approach ?? null,
            approach_skill: adjudication.approach_skill ?? null,
            feasibility: adjudication.feasibility ?? null,
            base_difficulty: adjudication.base_difficulty ?? null,
            final_difficulty: adjudication.final_difficulty ?? null,
            motive: adjudication.motive ?? null,
            leverage_delta: adjudication.leverage_delta ?? null
        };
        if (truth(bound))
            Object.assign(outcome, checkView(bound));
        else
            Object.assign(outcome, {
                level: adjudication.feasibility ?? null,
                passed: adjudication.feasibility === 'automatic'
            });
        return outcome;
    }
    if (ref === OBSERVE)
        return {
            kind: 'psychology',
            status: 'observed',
            npc: result.npc_id ?? null,
            insight_id: result.insight_id ?? null,
            inference_depth: result.inference_depth ?? null,
            misread_policy: result.misread_policy ?? null,
            concealed: true,
            level: result.outcome ?? null,
            roll_visibility: 'concealed'
        };
    if (ref === REALIZE)
        return {
            kind: 'psychology',
            status: 'realized',
            npc: result.npc_id ?? null,
            insight_id: result.insight_id ?? null,
            external_behavior: row(result.player_projection).external_behavior ?? null
        };
    throw new Error(`No result projection for ${ref}`);
}
export function shapeSettlement(context: SettleContext, runtime: RuleGraph, chosen: Row, envelope: Row, familyOutcome?: Row): Row {
    const result = row(row(envelope.settlement).result);
    const ref = string(chosen.decision_ref);
    const outcome = familyOutcome ?? outcomeOf(ref, result);
    let continuations = array(result.next_continuations).map(value => continuationEntry(runtime, string(value)));
    for (const card of array(envelope.next_decisions)) {
        const entry = continuationEntry(runtime, string(card.decision_ref));
        if (!continuations.some(value => value.decision === entry.decision))
            continuations.push(entry);
    }
    if (!context.receipts.some(receipt => continuableCheck(receipt, context.actorId)))
        continuations = continuations.filter(value => !string(value.decision || '').startsWith('push-luck:'));
    if (ref === OBSERVE)
        continuations.push({
            decision: 'psychology:realize-player-safe',
            action: ['decision', 'target', 'method'],
            when: 'the player is told what they can see; the die stays concealed'
        });
    const ruleRefs: string[] = [];
    for (const receipt of context.receipts)
        for (const id of array(receipt.rule_refs))
            if (!ruleRefs.includes(id))
                ruleRefs.push(id);
    for (const id of array(envelope.rule_refs))
        if (!ruleRefs.includes(id))
            ruleRefs.push(string(id));
    for (const block of [result.luck_spend, result.event, row(result.result).roll_result]) {
        const id = row(block).rule_ref;
        if (typeof id === 'string' && !ruleRefs.includes(id))
            ruleRefs.push(id);
    }
    return {
        kind: 'settled',
        decision: chosen.name,
        family: chosen.family,
        outcome,
        effects: [...context.effects],
        continuations,
        rule_refs: ruleRefs,
        receipts: context.receipts,
        hints: [...array(envelope.hints)],
        warnings: [...array(envelope.warnings)],
        effect_kinds: runtime.effectKindsFor(ref),
        settlement: result,
        session: ['combat', 'chase', 'sanity'].includes(chosen.family) ? result.session ?? null : null,
        pending_choice: ['combat', 'chase', 'sanity'].includes(chosen.family) ? result.pending_choice ?? null : null
    };
}
export function tagNpcReceipts(context: SettleContext, family: string, npc: Row | null, outcome: Row): void {
    let against = npc ? context.graph.handle(npc) : null;
    if (!against && typeof outcome.npc === 'string') {
        const node = context.graph.find(outcome.npc, ['npc']);
        if (node)
            against = context.graph.handle(node);
    }
    const approach = typeof outcome.approach === 'string' ? outcome.approach : null;
    for (const receipt of context.receipts) {
        if (receipt.kind !== 'roll')
            continue;
        if (!Object.hasOwn(receipt, 'family'))
            receipt.family = family;
        if (against && receipt.actor !== against && !Object.hasOwn(receipt, 'npc'))
            receipt.npc = against;
        const named = approach || APPROACH_BY_SKILL[string(receipt.skill || '')];
        if (named && !Object.hasOwn(receipt, 'approach'))
            receipt.approach = named;
    }
}
export function markersOf(turn: Row, minted: Row[]): string[] {
    const known = array(turn.receipts);
    const ids = new Set(known.map(receipt => receipt.id));
    const markers = markersFor([...known, ...minted.filter(receipt => !ids.has(receipt.id))]);
    return minted.flatMap(receipt => markers.has(receipt.id) ? [markers.get(receipt.id)!] : []);
}
export function modResolveEvents(action:Row,result:Row,receipts:Row[]):DomainEvent[]{
    const events:DomainEvent[]=[];
    for(const receipt of receipts){
        receipt.family??=result.family;
        if(receipt.kind==='roll')events.push({type:'roll-resolved',data:{...orderedObject(entries(receipt).filter(([key])=>!['check','id','kind','call_id','at'].includes(key))),goal:Object.hasOwn(action,'goal')?action.goal:'',method:Object.hasOwn(action,'method')?action.method:''},receipt:receipt.id});
        else if(receipt.kind==='delta')events.push({type:'resource-changed',data:{resource:receipt.resource,subject:receipt.subject,before:receipt.before,after:receipt.after},receipt:receipt.id});
        else if(receipt.kind==='item')events.push({type:'item-transferred',data:{name:receipt.name,to:receipt.subject_label??receipt.subject,from:receipt.from??null},receipt:receipt.id});
    }
    if(!result.reused)events.push({type:'decision-settled',data:{decision:result.decision,family:result.family,outcome_kind:row(result.outcome).kind??null}});
    return events;
}
export function rulingsForResolve(context: SettleContext, settled: Row): Row[] {
    const skills = context.receipts.filter(receipt => receipt.kind === 'roll' && receipt.form !== 'dice' && truth(receipt.skill)).map(receipt => string(receipt.skill));
    if (typeof settled.outcome.skill === 'string')
        skills.push(settled.outcome.skill);
    const entities: string[] = [];
    for (const name of [context.action.target, context.action.actor, settled.outcome.target]) {
        const node = typeof name === 'string' && name.trim() ? context.graph.find(name) : null;
        if (node && !entities.includes(context.graph.handle(node)))
            entities.push(context.graph.handle(node));
    }
    return latestNamed(context.snapshot.logs.get('rulings.jsonl') || [], 'active').filter(value => {
        if (value.scope === 'scene' && value.scene !== context.activeScene || value.scope === 'module' && value.module != null && value.module !== context.graph.moduleId)
            return false;
        const anchor = row(value.anchor);
        if (anchor.family != null && anchor.family !== settled.family || anchor.decision != null && anchor.decision !== settled.decision)
            return false;
        if (anchor.skill != null && !skills.map(normalize).includes(normalize(string(anchor.skill))))
            return false;
        return !truth(anchor.entities) || array(anchor.entities).some(entity => entities.includes(entity));
    }).sort((a, b) => number(b.turn) - number(a.turn) || number(b.seq) - number(a.seq)).slice(0, 3).map(value => ({
        name: string(value.name),
        statement: string(value.statement)
    }));
}
export function resolveResult(context: SettleContext, settled: Row): {
    result: Row;
    events: DomainEvent[];
} {
    const receipts = context.receipts;
    for (const receipt of receipts)
        if (!Object.hasOwn(receipt, 'family'))
            receipt.family = settled.family;
    const rolls = receipts.filter(receipt => receipt.kind === 'roll').map(receipt => receipt.id);
    const view = context.sessions();
    const session = settled.session || view.activeSession();
    const pending = settled.pending_choice || view.pendingChoice() || context.turn.pending_choice || null;
    const result: Row = {
        receipt: rolls[0] ?? receipts[0]?.id ?? null,
        receipts: receipts.map(receipt => receipt.id),
        markers: markersOf(context.turn, receipts),
        decision: settled.decision,
        family: settled.family,
        outcome: settled.outcome,
        effects: settled.effects,
        session,
        pending_choice: pending,
        continuations: settled.continuations,
        rule_refs: settled.rule_refs,
        rulings: rulingsForResolve(context, settled)
    };
    for (const key of ['decision_source', 'hints', 'warnings'])
        if (truth(settled[key]))
            result[key] = settled[key];
    const goal = typeof context.action.goal === 'string' ? context.action.goal : '';
    const method = typeof context.action.method === 'string' ? context.action.method : '';
    const events: DomainEvent[] = [];
    for (const receipt of receipts) {
        if (receipt.kind === 'roll') {
            const data = orderedObject(entries(receipt).filter(([key]) => !['check', 'id', 'kind', 'call_id', 'at'].includes(key)));
            events.push({
                type: 'roll-resolved',
                data: {
                    ...data,
                    goal,
                    method
                },
                receipt: receipt.id
            });
        }
        else if (receipt.kind === 'delta')
            events.push({
                type: 'resource-changed',
                data: {
                    resource: receipt.resource,
                    subject: receipt.subject,
                    before: receipt.before,
                    after: receipt.after
                },
                receipt: receipt.id
            });
        else if (receipt.kind === 'item')
            events.push({
                type: 'item-transferred',
                data: {name: receipt.name, to: receipt.subject_label ?? receipt.subject, from: receipt.from ?? null},
                receipt: receipt.id
            });
        else if (receipt.kind === 'session') {
            const data: Row = {family: receipt.family ?? null, transition: receipt.transition ?? null};
            for (const key of ['outcome', 'summary']) if (receipt[key] != null) data[key] = receipt[key];
            events.push({type: 'session-changed', data, receipt: receipt.id});
        }
    }
    events.push({
        type: 'decision-settled',
        data: {
            decision: settled.decision,
            family: settled.family,
            outcome_kind: settled.outcome.kind ?? null,
            effect_kinds: settled.effect_kinds,
            effects: settled.effects.map((effect: Row) => effect.kind),
            continuations: settled.continuations.map((value: Row) => value.decision),
            session_kind: session?.kind ?? null,
            session_status: session?.status ?? null,
            pending_choice: pending?.name ?? null
        }
    });
    return {
        result,
        events
    };
}
