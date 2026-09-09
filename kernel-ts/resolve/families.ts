/** Named static bindings for the existing settlement pipeline. */
import type { Row } from '../read/values.js';
import type { RuleGraph } from '../rules/graph.js';
import type { SettleContext, SettlementExecutor } from './context.js';
export interface FixedFamilyBinding {
    matches(decisionRef: string, capability: string | null): boolean;
    slots(decisionRef: string, context: SettleContext, targets: {
        npc: Row | null;
        investigator: Row | null;
    }): Promise<{
        semantic: Row;
        extras: Row;
    }>;
    locked(context: SettleContext, runtime: RuleGraph, selected: Row, grant: Row | null): Promise<Row>;
    args(context: SettleContext, plan: Row, selected: Row): Row;
    execute: SettlementExecutor;
    outcome(context: SettleContext, decisionRef: string, result: Row): Row;
}
export interface FixedFamilies {
    readonly healing?: FixedFamilyBinding;
    readonly development?: FixedFamilyBinding;
    readonly combat?: FixedFamilyBinding;
    readonly chase?: FixedFamilyBinding;
    readonly sanity?: FixedFamilyBinding;
    readonly magic?: FixedFamilyBinding;
}
export function familyBinding(families: FixedFamilies, ref: string, capability: string | null): FixedFamilyBinding | undefined {
    const matching = [families.healing, families.development, families.combat, families.chase, families.sanity, families.magic].filter((binding): binding is FixedFamilyBinding => !!binding && binding.matches(ref, capability));
    if (matching.length > 1)
        throw new Error(`Multiple fixed families own ${ref}`);
    return matching[0];
}
