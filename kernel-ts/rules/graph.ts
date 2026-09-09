/** Compiled RuleGraph queries, card grants and immutable slot plans. No executor is invoked. */
import { isJsonObject, compareUnicode, jsonDigest, freezeJson, orderedObject, pythonJsonDumps } from "../json.js";
import { RuleObservations, children, evaluateCondition, requirementPhrase, classifyExceptionCondition, semanticName } from "../read/rule-facts.js";
import { array, row, entries, values, string, truth, clone, sorted, equal, repr, type Row } from "../read/values.js";
const SEMANTIC_OWNERS = new Set(["keeper-semantic", "optional-semantic", "player-source"]);
const REQUIRED_OWNERS = new Set(["keeper-semantic", "player-source"]);
const LOCKED_OWNERS = new Set(["host-locked", "resolver-owned"]);
const GRANT_KEYS = ["role", "phase", "stage", "player_turn_epoch", "progress_revision"];
const scalarType = (name: string): string => ["pushed", "complete_rest", "poor_environment", "include_selection_policy"].includes(name) ? "bool"
    : ["skill_value", "medicine_skill_value", "credit_rating", "limit", "build", "actor_build", "target_build", "current_hp", "max_hp", "current_san"].includes(name) ? "int" : "scalar";
export function canonicalSlotName(id: any): string {
    const parts = string(id).split(":");
    return parts.length >= 3 && parts[0] === "input-slot" ? parts.at(-1)!.replaceAll("-", "_") : string(id);
}
export interface RuleGraphOptions {
    rulesetId?: string;
    rulesetVersion?: string;
    campaignId?: string | null;
    graphManifest?: Row | null;
    facts?: () => Row;
    grantContext?: () => Row;
    hostLocked?: (decision: string) => Row;
    resolverIndex?: Row | null;
    projectionAudience?: "keeper" | "host-internal" | "audit";
    augmentFacts?: (selected: Row | null, facts: Row) => Row;
    optionalRules?: () => Row;
}
export class RuleGraph {
    readonly nodes: Map<string, Row>;
    readonly graph: Row;
    readonly manifest: Row | null;
    readonly rulesetId: string;
    readonly rulesetVersion: string;
    readonly graphGeneration: string;
    readonly audience: string;
    private readonly grants = new Map<string, Row>();
    private grantSequence = 0;
    constructor(readonly observations: RuleObservations, readonly options: RuleGraphOptions = {}) {
        this.nodes = observations.nodes;
        this.graph = observations.graph;
        this.manifest = options.graphManifest === undefined ? observations.manifest : options.graphManifest;
        this.rulesetId = options.rulesetId || string(this.graph.ruleset_id || "");
        this.rulesetVersion = options.rulesetVersion || row(this.manifest).ruleset_version || "unversioned";
        this.graphGeneration = truth(row(this.manifest).graph_content_digest) ? string(row(this.manifest).graph_content_digest) : `sha256:${jsonDigest(this.graph)}`;
        this.audience = options.projectionAudience ?? "keeper";
        if (!["keeper", "host-internal", "audit"].includes(this.audience)) {
            const error = new Error("RulesRuntime projection_audience must be keeper, host-internal, or audit");
            error.name = "ValueError";
            throw error;
        }
    }
    families(): string[] {
        return sorted(Object.keys(row(this.graph.coverage)));
    }
    nodeIdsByKind(kind: string): string[] {
        return sorted([...this.nodes].filter(([, node]) => node.node_kind === kind).map(([id]) => id));
    }
    decisionNodes(family?: string | null): Row[] {
        return this.nodeIdsByKind("decision").map(id => this.nodes.get(id)!).filter(node => family == null || row(node.properties).family_id === family);
    }
    familyOf(id: string): string {
        return string(row(this.nodes.get(id)?.properties).family_id || "");
    }
    outgoing(id: string, kind?: string): Row[] {
        return (this.observations.outgoing.get(id) ?? []).filter(rel => kind === undefined || rel.relation_kind === kind).sort((a, b) => compareUnicode(string(a.relation_id), string(b.relation_id)));
    }
    invokes(id: string): Row | null {
        return this.outgoing(id, "invokes").map(rel => this.nodes.get(string(rel.to_node_id))).find(Boolean) ?? null;
    }
    capabilityOf(id: string): string | null {
        const value = row(this.invokes(id)?.properties).resolver_capability;
        return typeof value === "string" ? value : null;
    }
    conditionsFor(id: string): Row[] {
        return this.observations.conditionsFor(id);
    }
    applicability(id: string, facts: Row): [
        boolean,
        boolean
    ] {
        return this.observations.applicability(id, facts);
    }
    rulesFor(id: string): string[] {
        const capability = this.invokes(id);
        if (!capability)
            return [];
        return sorted([...this.nodes.values()].filter(node => node.node_kind === "rule" && this.outgoing(node.node_id).some(rel => rel.relation_kind === "invokes" && string(rel.to_node_id) === string(capability.node_id))).map(node => string(node.node_id)));
    }
    sourceRefsFor(refs: string[]): string[] {
        return sorted(new Set(refs.flatMap(id => array(this.nodes.get(id)?.evidence_span_ids).filter(value => typeof value === "string"))));
    }
    effectsFor(id: string): string[] {
        return sorted(new Set(this.outgoing(id, "emits").map(rel => this.nodes.get(string(rel.to_node_id))).filter(node => node?.node_kind === "effect").map(node => string(node!.node_id))));
    }
    effectKindsFor(id: string): string[] {
        return sorted(new Set(this.effectsFor(id).map(ref => row(this.nodes.get(ref)?.properties).effect_kind).filter(value => typeof value === "string")));
    }
    pendingChoicesFor(id: string): string[] {
        return sorted(new Set(this.outgoing(id, "offers-choice").map(rel => this.nodes.get(string(rel.to_node_id))).filter(node => node?.node_kind === "pending-choice").map(node => string(node!.node_id))));
    }
    continuationsFor(id: string): string[] {
        const result = new Set<string>();
        for (const rel of this.outgoing(id, "continues-as")) {
            const target = this.nodes.get(string(rel.to_node_id));
            if (!target)
                continue;
            if (target.node_kind === "continuation") {
                for (const hop of this.outgoing(string(target.node_id), "continues-as"))
                    if (this.nodes.has(string(hop.to_node_id)))
                        result.add(string(hop.to_node_id));
            }
            else
                result.add(string(target.node_id));
        }
        return sorted(result);
    }
    slotsFor(id: string): Row[] {
        const slots = new Map<string, Row>(),
            implementation = row(row(this.nodes.get(id)?.properties).implementation);
        for (const slot of array(implementation.payload_slots))
            if (isJsonObject(slot) && typeof slot.name === "string")
                slots.set(slot.name, {
                    name: slot.name,
                    ownership: slot.ownership || "host-locked",
                    type: scalarType(slot.name)
                });
        for (const rel of [...this.outgoing(id, "requires-input"), ...this.outgoing(id, "locks-input")]) {
            const target = this.nodes.get(string(rel.to_node_id));
            if (target?.node_kind !== "input-slot")
                continue;
            const props = row(target.properties),
                canonical = canonicalSlotName(target.node_id),
                type = props.value_type || "scalar",
                description = typeof target.name === "string" && target.name.trim() ? target.name : null,
                existing = slots.get(canonical);
            if (existing) {
                if ((existing.type == null || existing.type === "scalar") && type !== "scalar")
                    existing.type = type;
                if (!Object.hasOwn(existing, "path"))
                    existing.path = props.path ?? null;
                if (description && !truth(existing.description))
                    existing.description = description;
            }
            else
                slots.set(canonical, {
                    name: canonical,
                    ownership: props.ownership || "keeper-semantic",
                    type,
                    path: props.path ?? null,
                    ...(description ? { description } : {})
                });
        }
        return [...slots.values()].sort((a, b) => compareUnicode(a.name, b.name));
    }
    declaredPayloadSlots(id: string): Set<string> {
        return new Set(array(row(row(this.nodes.get(id)?.properties).implementation).payload_slots).filter(slot => isJsonObject(slot) && truth(slot.name)).map(slot => string(slot.name)));
    }
    requiredSemanticSlots(id: string): string[] {
        return sorted(this.slotsFor(id).filter(slot => REQUIRED_OWNERS.has(slot.ownership)).map(slot => slot.name));
    }
    optionalRuleGate(id: string): Row | null {
        const value = this.options.optionalRules?.()[id];
        return isJsonObject(value) ? clone(value) : null;
    }
    answersDeclaredIntent(id: string, facts: Row): boolean | null {
        const conditions = this.conditionsFor(id).filter(condition => condition.hard_gate !== true && pythonJsonDumps(row(condition.properties).expression ?? null, { sortKeys: true }).includes("intent.action_kind"));
        return !conditions.length || !truth(facts["intent.action_kind"]) ? null : conditions.some(condition => evaluateCondition(row(condition.properties).expression, facts) === true);
    }
    unmetAvailability(id: string, facts: Row = this.options.facts?.() ?? {}): Row[] {
        const result: Row[] = [],
            seen = new Set<string>();
        const walk = (expression: any, negated = false) => {
            if (!isJsonObject(expression))
                return;
            const nested = children(expression);
            if (nested != null) {
                for (const child of nested)
                    walk(child, negated !== (expression.op === "not"));
                return;
            }
            const path = expression.path;
            if (typeof path !== "string" || seen.has(path))
                return;
            if (evaluateCondition(expression, facts) === (negated ? false : true))
                return;
            seen.add(path);
            result.push({
                path,
                op: expression.op ?? null,
                negated,
                actual: facts[path] ?? null,
                expected: expression.value ?? null,
                requirement: requirementPhrase(expression, negated)
            });
        };
        for (const condition of this.conditionsFor(id))
            if (condition.hard_gate === true)
                walk(row(condition.properties).expression);
        return result;
    }
    private exclusions(): Row[] {
        return values(row(this.manifest).family_promotion_eligibility).flatMap(value => isJsonObject(value) ? array(value.shadow_exclusions).filter(isJsonObject) : []);
    }
    private exceptionExpression(exclusion: Row, node: Row | undefined): any {
        if (node) {
            const expressions = this.conditionsFor(string(node.node_id || "")).map(condition => row(condition.properties).expression).filter(isJsonObject);
            if (expressions.length === 1)
                return expressions[0];
            if (expressions.length > 1)
                return {
                    op: "all",
                    of: expressions
                };
            if (isJsonObject(row(node.properties).expression))
                return node.properties.expression;
        }
        return isJsonObject(exclusion.when) ? exclusion.when : null;
    }
    surfaceExceptions(id: string, facts: Row): [
        string[],
        Row[]
    ] {
        const active: string[] = [],
            unevaluated: Row[] = [];
        for (const exclusion of this.exclusions()) {
            if (exclusion.decision_ref !== id)
                continue;
            const ref = exclusion.exception_ref;
            if (typeof ref !== "string" || !ref) {
                unevaluated.push({
                    exception_ref: "",
                    reason: "malformed_expression",
                    evaluation: "unevaluated"
                });
                continue;
            }
            const [status, reason] = classifyExceptionCondition(this.exceptionExpression(exclusion, this.nodes.get(ref)), facts);
            if (status === "matched")
                active.push(ref);
            else if (status === "unevaluated") {
                active.push(ref);
                unevaluated.push({
                    exception_ref: ref,
                    reason: reason || "malformed_expression",
                    evaluation: "unevaluated"
                });
            }
        }
        return [sorted(new Set(active)), unevaluated];
    }
    factsForDecision(selected: Row | null = null): Row {
        const facts = clone(this.options.facts?.() ?? {});
        return this.options.augmentFacts ? clone(this.options.augmentFacts(selected, facts)) : facts;
    }
    card(id: string, facts: Row): Row {
        const node = this.nodes.get(id)!;
        const props = row(node.properties),
            slots = this.slotsFor(id),
            [applicable, hard] = this.applicability(id, facts),
            capability = this.invokes(id),
            ruleRefs = this.rulesFor(id),
            [active, unevaluated] = this.surfaceExceptions(id, facts);
        const card: Row = {
            schema_version: 1,
            decision_ref: id,
            name: semanticName(id),
            family: props.family_id || "",
            label: node.name || id,
            applicability: applicable ? "applicable" : "not_applicable",
            required_inputs: slots.filter(slot => SEMANTIC_OWNERS.has(slot.ownership)).map(slot => ({
                name: slot.name,
                owner: slot.ownership,
                type: slot.type,
                ...(truth(slot.description) ? { description: slot.description } : {})
            })),
            locked_inputs: slots.filter(slot => LOCKED_OWNERS.has(slot.ownership)).map(slot => slot.name),
            rule_refs: ruleRefs,
            source_refs: this.sourceRefsFor(ruleRefs),
            capability_ref: capability ? string(capability.node_id) : null,
            effect_refs: this.effectsFor(id),
            possible_continuations: this.continuationsFor(id),
            authority: {
                selection: "keeper-semantic",
                execution: "current-ruleset-adapter",
                hard_gate: hard
            }
        };
        const answers = this.answersDeclaredIntent(id, facts);
        if (answers != null)
            card.answers_declared_intent = answers;
        const gate = this.optionalRuleGate(id);
        if (gate) {
            card.applicability = "not_applicable";
            card.disabled_by_optional_rule = gate;
        }
        if (active.length)
            card.active_exceptions = active;
        if (unevaluated.length)
            card.unevaluated_exceptions = unevaluated;
        return card;
    }
    gatingFactPaths(refs: string[]): string[] {
        const paths = new Set<string>();
        const walk = (expression: any) => {
            if (!isJsonObject(expression))
                return;
            const nested = children(expression);
            if (nested != null) {
                nested.forEach(walk);
                return;
            }
            if (typeof expression.path === "string" && expression.path)
                paths.add(expression.path);
        };
        for (const ref of refs)
            for (const condition of this.conditionsFor(ref))
                if (condition.hard_gate === true)
                    walk(row(condition.properties).expression);
        paths.delete("intent.action_kind");
        return sorted(paths);
    }
    grantBinding(scope?: string[]): Row {
        const facts = this.options.facts?.() ?? {};
        const state = orderedObject(scope === undefined ? entries(facts).filter(([key]) => key !== "intent.action_kind") : sorted(scope).map(key => [key, facts[key] ?? null]));
        const binding: Row = {
            campaign_id: this.options.campaignId ?? null,
            ruleset_id: this.rulesetId,
            ruleset_version: this.rulesetVersion,
            graph_generation: this.graphGeneration,
            state_revision: `sha256:${jsonDigest(state)}`
        };
        const provided = this.options.grantContext?.();
        if (isJsonObject(provided))
            for (const key of sorted(GRANT_KEYS))
                if (Object.hasOwn(provided, key))
                    binding[key] = clone(provided[key]);
        return binding;
    }
    issueCardGrant(cards: Row[], sourceDecisionId?: string | null): Row {
        this.grantSequence++;
        const family = cards.length ? string(cards[0].family || "") : "",
            refs = sorted(new Set(cards.map(card => string(card.decision_ref)))),
            scope = this.gatingFactPaths(refs);
        const grant: Row = {
            contract_id: "coc.rule-graph-card-grant.v1",
            schema_version: 1,
            grant_id: `card-grant:${this.rulesetId}:${family || "unscoped"}:${this.grantSequence}`,
            binding: this.grantBinding(scope),
            decision_refs: refs,
            state_scope: scope
        };
        if (typeof sourceDecisionId === "string" && sourceDecisionId)
            grant.source_decision_id = sourceDecisionId;
        this.grants.set(grant.grant_id, clone(grant));
        return clone(grant);
    }
    private stale(id: string, reason: string, message: string, extra: Row = {}): Row {
        return {
            schema_version: 1,
            decision_ref: id,
            family: this.familyOf(id),
            status: "rule_decision_stale",
            failure: {
                code: "rule_decision_stale",
                reason,
                message,
                ...extra
            }
        };
    }
    checkCardGrant(grant: Row | null, id: string): Row | null {
        if (!isJsonObject(grant) || typeof grant.grant_id !== "string" || !grant.grant_id)
            return this.stale(id, "missing_card_grant", "a machine-issued card grant is required (context() -> settle())");
        const stored = this.grants.get(grant.grant_id);
        if (!stored)
            return this.stale(id, "unrecognized_card_grant", "the grant was not issued by this runtime instance");
        const current = this.grantBinding(stored.state_scope),
            drifted = sorted(Object.keys(stored.binding)).filter(key => !equal(stored.binding[key], current[key]));
        if (drifted.length)
            return this.stale(id, "grant_binding_mismatch", `card grant binding no longer matches current state: ${drifted.join(", ")}`, { drifted });
        if (!array(stored.decision_refs).includes(id))
            return this.stale(id, "decision_not_in_grant", `decision ${repr(id)} was not covered by the live card grant`);
        return null;
    }
    latestGrantCovering(id: string): Row | null {
        for (const grant of [...this.grants.values()].reverse())
            if (array(grant.decision_refs).includes(id) && equal(grant.binding, this.grantBinding(grant.state_scope)))
                return clone(grant);
        return null;
    }
    context(question: Row | null = null): Row {
        question = row(question);
        const facts = this.factsForDecision(question),
            family = question.family;
        if (typeof family !== "string" || !family)
            return {
                schema_version: 1,
                status: "no_candidate_in_compiled_scope",
                family: null,
                cards: [],
                reason: "question must name a compiled rule family",
                facts
            };
        const requested = Array.isArray(question.selected_affordance_ids) ? question.selected_affordance_ids.filter((value: any) => typeof value === "string") : null;
        const cards: Row[] = [],
            gates: Row[] = [],
            withheld: Row[] = [];
        for (const node of this.decisionNodes(family)) {
            if (node.audience !== this.audience || requested != null && !requested.includes(node.node_id))
                continue;
            const card = this.card(node.node_id, facts);
            if (card.applicability !== "applicable") {
                if (truth(card.disabled_by_optional_rule))
                    gates.push({
                        decision_ref: node.node_id,
                        ...card.disabled_by_optional_rule
                    });
                else
                    withheld.push({
                        decision_ref: node.node_id,
                        label: card.label,
                        unmet: this.unmetAvailability(node.node_id, facts)
                    });
            }
            else
                cards.push(card);
        }
        const result: Row = {
            schema_version: 1,
            status: cards.length ? "ok" : "no_candidate_in_compiled_scope",
            family,
            cards,
            facts
        };
        if (gates.length)
            result.disabled_by_optional_rules = gates;
        if (withheld.length) {
            let spent = 0;
            result.withheld = withheld.map(value => {
                const unmet = array(value.unmet),
                    kept = unmet.slice(0, Math.max(24 - spent, 0));
                spent += kept.length;
                return {
                    decision_ref: value.decision_ref,
                    ...(truth(value.label) ? { label: value.label } : {}),
                    unmet: kept,
                    ...(kept.length < unmet.length ? { unmet_omitted: unmet.length - kept.length } : {})
                };
            });
        }
        if (cards.length)
            result.card_grant = this.issueCardGrant(cards, string(question._host_source_decision_id || "") || null);
        return result;
    }
    continuationCards(plan: Row, decisionId: string): Row[] {
        const facts = this.factsForDecision(null),
            continued: Row[] = [];
        for (const ref of array(plan.next_decisions).slice(0, 8)) {
            if (this.nodes.get(string(ref))?.node_kind === "decision" && this.applicability(string(ref), facts)[0])
                continued.push(this.card(string(ref), facts));
        }
        continued.sort((a, b) => compareUnicode(a.decision_ref, b.decision_ref));
        if (continued.length)
            this.issueCardGrant(continued, decisionId);
        return continued;
    }
    private undeclaredSlots(id: string, family: string, slots: Row[], offending: string[], origin: "model" | "host"): Row {
        const required = sorted(slots.filter(slot => REQUIRED_OWNERS.has(slot.ownership)).map(slot => slot.name)),
            optional = sorted(slots.filter(slot => SEMANTIC_OWNERS.has(slot.ownership) && !REQUIRED_OWNERS.has(slot.ownership)).map(slot => slot.name));
        const takes = required.length && optional.length ? `${required.join(", ")} (optional: ${optional.join(", ")})` : required.length ? required.join(", ") : optional.length ? `only optional input: ${optional.join(", ")}` : "no semantic input at all (every slot is filled by the host)";
        const keys = offending.map(repr).join(", "),
            message = (origin === "host" ? `host-owned inputs are not declared slots of this decision: ${keys}; the host fills these, not the Keeper` : `not declared slots of this decision: ${keys}`) + `; this decision takes ${takes}`;
        return { failure: {
                code: "unknown_semantic_input",
                message,
                declared_slots: sorted(slots.map(slot => slot.name)),
                model_owned_slots: sorted(slots.filter(slot => SEMANTIC_OWNERS.has(slot.ownership)).map(slot => slot.name)),
                required_semantic_slots: required,
                optional_semantic_slots: optional,
                host_owned_slots: sorted(slots.filter(slot => LOCKED_OWNERS.has(slot.ownership)).map(slot => slot.name)),
                unknown: [...offending],
                input_origin: origin,
                decision_ref: id,
                family
            } };
    }
    compilePlan(id: string, semanticInputs: Row, facts: Row = this.options.facts?.() ?? {}, hostLocked?: Row | null): Row {
        const node = this.nodes.get(id);
        if (node?.node_kind !== "decision")
            return { failure: {
                    code: "no_candidate_in_compiled_scope",
                    message: `decision ${repr(id)} is not in the compiled graph`
                } };
        const family = row(node.properties).family_id || "";
        if (!this.applicability(id, facts)[0])
            return { failure: {
                    code: "rule_decision_not_applicable",
                    message: "the decision's hard-gate conditions do not hold for current state",
                    decision_ref: id,
                    family,
                    unmet: this.unmetAvailability(id, facts)
                } };
        const capability = this.invokes(id);
        if (!capability)
            return { failure: {
                    code: "unsupported_ruleset_operation",
                    message: "the decision does not invoke a compiled capability",
                    decision_ref: id,
                    family
                } };
        const capabilityProps = row(capability.properties),
            resolver = capabilityProps.resolver_capability;
        if (this.options.resolverIndex != null && (typeof resolver !== "string" || !Object.hasOwn(this.options.resolverIndex, resolver)))
            return { failure: {
                    code: "unsupported_ruleset_operation",
                    message: `capability ${repr(resolver)} is not in the active resolver index`,
                    decision_ref: id,
                    family
                } };
        const implementation = row(row(node.properties).implementation),
            slots = this.slotsFor(id),
            names = new Set(slots.map(slot => slot.name));
        if (id.endsWith(":combined-check"))
            semanticInputs = orderedObject(entries(semanticInputs).filter(([key]) => !["difficulty_basis", "skill", "characteristic"].includes(key)));
        const unknown = sorted(Object.keys(semanticInputs).filter(key => !names.has(key)));
        if (unknown.length)
            return this.undeclaredSlots(id, family, slots, unknown, "model");
        const missing = sorted(slots.filter(slot => REQUIRED_OWNERS.has(slot.ownership) && !Object.hasOwn(semanticInputs, slot.name)).map(slot => slot.name));
        if (missing.length)
            return { failure: {
                    code: "missing_semantic_input",
                    message: "required semantic inputs are missing",
                    missing,
                    decision_ref: id,
                    family
                } };
        const host = new Map(entries(hostLocked).map(([key, value]) => [key, clone(value)]));
        for (const [key, value] of entries(this.options.hostLocked?.(id)))
            if (!host.has(key))
                host.set(key, clone(value));
        const hostUnknown = sorted([...host.keys()].filter(key => !names.has(key)));
        if (hostUnknown.length)
            return this.undeclaredSlots(id, family, slots, hostUnknown, "host");
        const payload = new Map(entries(implementation.payload_constants).map(([key, value]) => [key, clone(value)]));
        for (const slot of slots) {
            if (SEMANTIC_OWNERS.has(slot.ownership) && Object.hasOwn(semanticInputs, slot.name))
                payload.set(slot.name, clone(semanticInputs[slot.name]));
            else if (LOCKED_OWNERS.has(slot.ownership) && host.has(slot.name))
                payload.set(slot.name, clone(host.get(slot.name)));
        }
        const command = {
            kind: string(implementation.kind || "resolver-invocation"),
            phase: string(implementation.phase || "resolve"),
            payload: orderedObject(payload)
        },
            ruleRefs = this.rulesFor(id),
            effects = this.effectsFor(id);
        let visibility = "public";
        for (const effect of effects) {
            const value = row(this.nodes.get(effect)?.properties).visibility || this.nodes.get(effect)?.visibility;
            if (["keeper-only", "concealed-result"].includes(value)) {
                visibility = value;
                break;
            }
        }
        const plan = {
            schema_version: 1,
            decision_ref: id,
            family,
            capability: {
                ref: string(capability.node_id),
                adapter: capabilityProps.adapter || "resolver",
                resolver_capability: resolver ?? null
            },
            command,
            rule_refs: ruleRefs,
            source_refs: this.sourceRefsFor(ruleRefs),
            resource_effects: effects,
            visibility,
            pending_choices: this.pendingChoicesFor(id),
            next_decisions: this.continuationsFor(id)
        };
        return {
            plan: freezeJson(plan),
            failure: null
        };
    }
}
