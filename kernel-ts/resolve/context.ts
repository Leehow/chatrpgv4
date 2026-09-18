/** One resolve's state and receipt authority, backed by the owner's transaction port. */
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import type { TurnTransaction } from '../transactions.js';
import { isJsonObject, jsonDigest } from '../json.js';
import { CampaignSnapshot, type LoadedModule } from '../read/campaign.js';
import { recordOf } from '../read/module-graph.js';
import { SessionView } from '../read/session-view.js';
import { dieHidden } from '../read/mechanics.js';
import { factsFromState, RuleObservations } from '../read/rule-facts.js';
import { array, clone, entries, integer, kebab, normalize, number, row, string, truth, values, type Row } from '../read/values.js';
import { RuleTables } from '../rules/tables.js';
import { CHARACTERISTICS } from '../rules/skills.js';
import { moduleSpellRecords } from '../rules/catalog.js';
import { caseFold } from '../rules/casefold.js';
import { nowIso } from '../write/store.js';
import {weaponRows} from '../mods/projection.js';
import {prepareMagicFacts,augmentMagicFacts,provisionalMagicSemantic,type PreparedMagicFacts} from '../magic/facts.js';
import { incapacitatedBy } from '../healing/conditions.js';
import { personLabel } from '../read/capsule.js';
import { CheckArithmetic, SUCCESS_OUTCOMES, valueError } from './arithmetic.js';
export interface ExecutionResult {
    data: Row;
    warnings: string[];
    hints: string[];
}
export type SettlementExecutor = (context: SettleContext, args: Row, plan: Row) => Promise<ExecutionResult>;
export interface ResolveWriter {
    transaction(params: Row, options?: {
        repairLegacyTrail?: boolean;
        preload?: boolean;
    }): Promise<TurnTransaction>;
}
/**
 * What the table knows about an NPC's numbers: the book's printed profile, else one `apply npc
 * {archetype}` pinned (contract §34.10), with whatever the campaign has since written into
 * `world.npc_resources` laid over it.
 *
 * Standalone rather than a method because two callers need it before a `SettleContext` exists --
 * `table.resolve` deciding who the patient of a First Aid check is, and `table.apply` deciding whom
 * a damage effect is about (contract §66). The method stays, so nothing else changes.
 */
export function npcProfileOf(graph: LoadedModule['graph'], world: Row, handle: string): Row | null {
    const node = graph.find(handle, ['npc']);
    if (!node)
        return null;
    // The book's numbers first; then a profile the table pinned from a rulebook archetype (contract §34.10).
    const authored = row(recordOf(node).mechanics).profile, pinnedProfile = row(world.npc_profiles)[handle];
    const profile = isJsonObject(authored) ? authored : isJsonObject(pinnedProfile) ? pinnedProfile : null;
    if (!isJsonObject(profile))
        return null;
    const resources = row(row(world.npc_resources)[handle]);
    const result = clone(profile);
    result.spells = [...new Set([...array(result.spells), ...Object.keys(row(row(row(world.objects).abilities)[handle]))])];
    result.weapons = [...array(result.weapons), ...weaponRows(world, handle)];
    if (Object.hasOwn(resources, 'current_hp'))
        result.hp_current = resources.current_hp;
    for (const key of ['current_mp', 'conditions', 'characteristics'])
        if (Object.hasOwn(resources, key))
            result[key] = clone(resources[key]);
    return result;
}
export class SettleContext {
    readonly receipts: Row[] = [];
    readonly effects: Row[] = [];
    private readonly minted = new Set<string>();
    actorId: string;
    readonly subjectId: string;
    readonly turnNumber: number;
    readonly moduleSpells: Row[];
    /**
     * The keeper's declared `action.modifiers`, validated once at the entry (§95): `[bonus, penalty,
     * difficulty]`. It lives here so every family reads the same checked triple instead of re-parsing
     * the raw action, and so a family that cannot carry it can be told apart from one that forgot to.
     */
    declaredModifiers: [
        number,
        number,
        string,
        string | null
    ] = [0, 0, 'regular', null];
    private knownSpells: string[] = [];
    private learningSources: Row = {};
    private settlementPending = false;
    private preparedMagic?: PreparedMagicFacts;
    constructor(readonly kernel: KernelContext, readonly transaction: TurnTransaction, readonly snapshot: CampaignSnapshot, readonly module: LoadedModule, readonly tables: RuleTables, readonly arithmetic: CheckArithmetic, readonly observations: RuleObservations, readonly callId: string, readonly ordinal: number, public actor: Row, public subject: Row, readonly action: Row, readonly actingId = string(actor.id)) {
        this.actorId = string(actor.id);
        this.subjectId = string(subject.id);
        this.turnNumber = number(transaction.turn.turn);
        this.moduleSpells = moduleSpellRecords(module.graph, transaction.world);
    }
    get campaignId(): string { return this.transaction.campaign.id; }
    get graph() { return this.module.graph; }
    get world(): Row { return this.transaction.world; }
    get turn(): Row { return this.transaction.turn; }
    get rng() { return this.kernel.rng; }
    get clockMinutes(): number { return number(row(this.world.clock).minutes); }
    get activeScene(): string { return string(this.world.active_scene); }
    party(): Row[] { return this.snapshot.party; }
    partyNames(): string[] { return this.party().map(sheet => string(sheet.name || sheet.id)); }
    sheetById(id: any): Row | null {
        if (!truth(id))
            return null;
        const key = normalize(string(id));
        return this.party().find(sheet => [normalize(string(sheet.id)), normalize(string(sheet.name))].includes(key)) ?? null;
    }
    async writeSheet(sheet: Row): Promise<void> {
        await this.transaction.campaign.writeSheet(sheet);
        const id = string(sheet.id);
        const index = this.snapshot.party.findIndex(existing => string(existing.id) === id);
        if (index >= 0)
            this.snapshot.party[index] = sheet;
        if (id === this.actorId)
            this.actor = sheet;
        if (id === this.subjectId)
            this.subject = sheet;
    }
    async skillValue(sheet: Row | null, skill: string): Promise<number | null> {
        if (!sheet || !isJsonObject(sheet.skills))
            return null;
        if (Object.hasOwn(sheet.skills, skill)) {
            let raw = sheet.skills[skill];
            if (isJsonObject(raw))
                raw = raw.value;
            if (typeof raw === 'boolean' || raw == null)
                return null;
            const value = typeof raw === 'string' && !/^[+-]?\d+$/.test(raw.trim()) ? NaN : Math.trunc(number(raw));
            return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
        }
        let spec: Row;
        try {
            spec = await this.tables.skillByName(skill);
        }
        catch (error) {
            if (['KeyError', 'ValueError'].includes((error as Error).name) || (error as NodeJS.ErrnoException).code)
                return null;
            throw error;
        }
        if (spec.modern_only === true && caseFold(string(sheet.era || '').trim()) !== 'modern')
            return null;
        return integer(spec.base_chance) && number(spec.base_chance) >= 0 && number(spec.base_chance) <= 100 ? number(spec.base_chance) : null;
    }
    npcNode(handle: string): Row | null { return this.graph.find(handle, ['npc']); }
    npcProfile(handle: string): Row | null { return npcProfileOf(this.graph, this.world, handle); }
    npcSkillLabels(ref: string): string[] {
        const parts = ref.split(':');
        const profile = parts.length >= 2 ? this.npcProfile(parts[1]) : null;
        if (!profile)
            return [];
        return ['skills', 'characteristics'].flatMap(kind => entries(profile[kind]).filter(([, value]) => integer(value) || typeof value === 'boolean').map(([name]) => name)).sort();
    }
    async actorSkillValue(id: string, skill: string): Promise<number | null> {
        const sheet = this.sheetById(id);
        if (sheet)
            return this.skillValue(sheet, skill);
        const node = this.npcNode(id);
        if (!node)
            return null;
        const wanted = normalize(skill);
        for (const receipt of [...this.allReceipts()].reverse()) {
            const pinned = row(receipt.skill);
            if (receipt.kind === 'npc' && receipt.npc === node.node_id && normalize(string(pinned.name || '')) === wanted && (integer(pinned.value) || typeof pinned.value === 'boolean'))
                return number(pinned.value);
        }
        const ledger = row(await this.snapshot.optional('npc-ledger.json'));
        for (const [name, pinned] of entries(row(ledger[node.node_id]).skills)) {
            if (normalize(name) === wanted && (integer(pinned.value) || typeof pinned.value === 'boolean'))
                return number(pinned.value);
        }
        return this.graph.actorSkillValue(node, skill);
    }
    presentNpcNames(): string[] {
        return entries(this.world.npc_presence).filter(([, at]) => at === this.activeScene).map(([handle]) => handle).sort();
    }
    sessions(): SessionView { return new SessionView(this.snapshot, this.graph, this.party(), this.world); }
    async readSave(name: string): Promise<any> {
        return clone(await this.transaction.campaign.readSave(name));
    }
    async writeSave(name: string, value: Row): Promise<void> {
        await this.transaction.campaign.writeSave(name, value);
        this.snapshot.jsonFiles.set(join('save', name), value);
    }
    async removeSave(name: string): Promise<void> {
        await this.transaction.campaign.removeSave(name);
        this.snapshot.jsonFiles.set(join('save',name),null);
    }
    allReceipts(): Row[] {
        return [...this.snapshot.records.flatMap(record => array(record.receipts).filter(isJsonObject)), ...array(this.turn.receipts).filter(isJsonObject), ...this.receipts];
    }
    receiptContinued(id: string): boolean { return this.allReceipts().some(receipt => receipt.source_receipt === id); }
    markReceiptContinued(id: string, kind: string): void {
        for (const receipt of [...array(this.turn.receipts), ...this.receipts])
            if (receipt.id === id)
                receipt.continued_by = kind;
    }
    mint(base: string): string {
        let candidate = base;
        let counter = 2;
        while (this.minted.has(candidate) || array(this.turn.receipts).some(receipt => receipt.id === candidate))
            candidate = `${base}-${counter++}`;
        this.minted.add(candidate);
        return candidate;
    }
    /**
     * What to call the subject of a receipt on a card (§79). Every roll, delta and cash receipt
     * draws its `actor_label` / `subject_label` here, so this is the person-side junction §76.2
     * named as missing: `world.person_labels` decides, and the sheet's or the book's name stands
     * only until this table has given one. The identity -- `actor`, `subject` -- is untouched.
     */
    subjectLabel(id: string): string {
        const sheet = this.sheetById(id);
        if (sheet)
            return personLabel(this.world, string(sheet.id), string(sheet.name || id));
        const node = this.npcNode(id);
        return node ? personLabel(this.world, this.graph.handle(node), this.graph.displayName(node)) : id;
    }
    addSessionReceipt(family: string, transition: string, options: Row = {}): string {
        const id=this.mint(`session:${family}-${transition}-t${this.turnNumber}-c${this.ordinal}`);
        const {outcome=null,summary=null,...extra}=options;
        this.receipts.push({id,kind:'session',call_id:this.callId,family,transition,outcome,summary,
            ...Object.fromEntries(entries(extra).filter(([,value])=>value!=null)),at:nowIso()});
        return id;
    }
    addRoll(input: Row): string {
        const { actor, skill, target, difficulty, threshold, roll, level, passed, bonus = 0, penalty = 0, visibility = 'public', kind = 'skill_check', pushed = false, source_receipt, check, skill_label, ...extra } = input;
        const investigator = this.sheetById(actor) !== null;
        const id = this.mint(`roll:${kebab(skill)}${investigator ? '' : `-${kebab(actor)}`}-t${this.turnNumber}-c${this.ordinal}`);
        const receipt: Row = {
            id,
            kind: 'roll',
            call_id: this.callId,
            actor,
            skill,
            skill_label: skill_label || skill,
            target: number(target),
            difficulty,
            threshold: number(threshold),
            roll: number(roll),
            level,
            passed: truth(passed),
            bonus: number(bonus),
            penalty: number(penalty),
            visibility,
            roll_kind: kind,
            pushed: truth(pushed),
            rule_refs: [...array(row(check).rule_refs)],
            at: nowIso(),
            ...extra
        };
        receipt.actor_label = this.subjectLabel(actor);
        receipt.actor_is_investigator = investigator;
        if (truth(source_receipt))
            receipt.source_receipt = source_receipt;
        if (check != null) {
            receipt.check = clone(check);
            delete receipt.check.rule_refs;
            receipt.check.roll_id = id;
        }
        this.receipts.push(receipt);
        return id;
    }
    addDiceRoll(input: Row): string {
        const { actor, label, expression, faces, total, skill_label, ...extra } = input;
        const id = this.mint(`roll:${kebab(label) || 'dice'}-t${this.turnNumber}-c${this.ordinal}`);
        const receipt = {
            id,
            kind: 'roll',
            form: 'dice',
            call_id: this.callId,
            actor,
            skill: label,
            skill_label: skill_label || label,
            expression,
            faces: [...faces],
            total,
            visibility: 'public',
            at: nowIso(),
            ...extra,
            actor_label: this.subjectLabel(actor),
            actor_is_investigator: this.sheetById(actor) !== null
        };
        this.receipts.push(receipt);
        return id;
    }
    addDelta(resource: string, subject: string, before: any, after: any, options: Row = {}): string {
        const { source_receipt, ...extra } = options;
        const id = this.mint(`delta:${resource}-t${this.turnNumber}-c${this.ordinal}`);
        const receipt: Row = {
            id,
            kind: 'delta',
            call_id: this.callId,
            resource,
            subject,
            subject_label: this.subjectLabel(subject),
            before,
            after,
            ...extra,
            at: nowIso(),
            subject_is_investigator: this.sheetById(subject) !== null
        };
        if (truth(source_receipt))
            receipt.source_receipt = source_receipt;
        this.receipts.push(receipt);
        this.effects.push({
            kind: resource,
            subject,
            before,
            after,
            ...extra
        });
        return id;
    }
    addEffect(kind: string, subject: string, before: any, after: any, extra: Row = {}): void {
        this.effects.push({
            kind,
            subject,
            before,
            after,
            ...extra
        });
        if (kind !== 'condition')
            return;
        // A condition is the one thing that changes what is true of a person without a number moving,
        // so `addDelta`'s receipt never covered it: `dying`, `unconscious` and `dead` had a writer and
        // a world state and no receipt at all. The investigator who died at `admission-e2e-4` turn 38
        // therefore died only in the prose -- no mechanics card, no committed fact, and the verifier
        // filed the death as `uncommitted_state`, correctly (contract §32.9).
        const had = array(before).map(string), has = array(after).map(string);
        const gained = has.filter(value => !had.includes(value)), lost = had.filter(value => !has.includes(value));
        if (!gained.length && !lost.length)
            return;
        // Which of the conditions now standing take the action away (CoC 7e: `dead`, `dying`,
        // `unconscious`). The rules engine draws that line in one place -- `INCAPACITATING_CONDITIONS`
        // -- and the receipt carries the answer rather than the card working it out, because a
        // reading surface that decided which states forbid acting would be a second rules table in a
        // consumer. Empty when the subject can still act, so a reader tests the list, not a name.
        this.receipts.push({
            id: this.mint(`condition:${subject}-t${this.turnNumber}-c${this.ordinal}`),
            kind: 'condition',
            call_id: this.callId,
            subject,
            subject_label: this.subjectLabel(subject),
            before: had,
            after: has,
            gained,
            lost,
            incapacitated: incapacitatedBy(has),
            ...extra,
            at: nowIso(),
            subject_is_investigator: this.sheetById(subject) !== null
        });
    }
    async prepareFacts(): Promise<void> {
        this.settlementPending = false;
        // The patient's own wound ledger, when the patient is not at the table (contract §66).
        // `CampaignSnapshot.preload` fetches one healing save per party sheet and no others, so an
        // NPC's read as an empty ledger -- and an empty ledger makes `time.minutes_since_injury`
        // unknown, which is exactly the fact the First Aid hour gate is written against. The
        // treatment was refused for want of the wound it was treating.
        if (!this.sheetById(this.subjectId))
            await this.snapshot.optional(join('save', 'healing-state', `${this.subjectId}.json`));
        this.preparedMagic = await prepareMagicFacts(this);
        this.knownSpells = [...this.preparedMagic.knownSpells];
        this.learningSources = this.preparedMagic.learningSources;
        const endings = join(this.transaction.campaign.directory, 'save', 'development-settlements', 'endings');
        for (const id of await this.kernel.snapshots.sortedChildNames(endings, path => this.kernel.snapshots.isDirectory(path))) {
            const capsule = row(await this.readSave(`development-settlements/endings/${id}/capsule.json`));
            if (array(capsule.investigator_ids).includes(this.subjectId) && !await this.kernel.snapshots.pathExists(join(endings, string(capsule.ending_id || ''), `${this.subjectId}.json`)))
                this.settlementPending = true;
        }
    }
    facts(intent?: string): Row {
        const sheet = this.sheetById(this.subjectId) || this.subject;
        const healing = this.snapshot.healing(this.subjectId);
        const state = {
            investigator_id: this.subjectId,
            current_hp: sheet.current_hp ?? null,
            current_san: sheet.current_san ?? null,
            current_mp: sheet.current_mp ?? null,
            current_luck: sheet.current_luck ?? null,
            conditions: Array.isArray(healing.conditions) ? healing.conditions : array(sheet.conditions),
            wound_ledger: array(healing.wound_ledger),
            major_wound_recovery_ledger: array(healing.major_wound_recovery_ledger)
        };
        return factsFromState(state, sheet, this.clockMinutes, {
            'campaign.ruleset_version': string(this.observations.manifest.ruleset_version || '1.0.0'),
            'scene.id': this.activeScene,
            'time.day': Math.floor(this.clockMinutes / 1440),
            ...(intent ? {
                'intent.action_kind': intent
            } : {}),
            ...this.sessions().facts(this.subjectId, this.clockMinutes),
            'magic.known_spells': this.knownSpells,
            'magic.learn.sources': this.learningSources,
            'magic.spell.module_namespace': this.moduleSpells,
            'development.settlement.pending': this.settlementPending,
        });
    }
    provisionalSemantic(target?:string|null):Row {
        return this.preparedMagic?provisionalMagicSemantic(this,this.preparedMagic,target):{};
    }
    augmentFacts(selected: Row | null, facts: Row): Row {
        const output = clone(facts);
        const semantic = row(selected?.semantic_inputs);
        const source = row(selected?._host_source_receipt);
        if (!Object.hasOwn(output, 'intent.rescuer_count'))
            output['intent.rescuer_count'] = 1;
        if (typeof semantic.assistant_rescuer_ref === 'string' && semantic.assistant_rescuer_ref.trim())
            output['intent.rescuer_count'] = 2;
        if (truth(source)) {
            if (typeof source.outcome === 'string' && source.outcome)
                output['receipt.last_outcome'] = source.outcome;
            output['intent.pushed'] = truth(source.pushed);
            output['receipt.push_eligible'] = source.push_eligible !== false;
        }
        if(this.preparedMagic)return augmentMagicFacts(this.preparedMagic,selected,output);
        output['magic.spell.known'] = false;
        output['magic.learn.source-available'] = values(this.learningSources).some(value => Array.isArray(value) && value.length > 0);
        return output;
    }
}
/** Scene-bound NPCs shared by combat and chase; engine-specific eligibility stays with each caller. */
export function presentOpponents(context: SettleContext): Array<[string, Row, Row | null]> {
    return entries(context.world.npc_presence).filter(([, at]) => at === context.activeScene).flatMap(([handle]) => {
        const node = context.graph.find(handle, ['npc']);
        return node ? [[handle, node, context.npcProfile(handle)] as [string, Row, Row | null]] : [];
    });
}
export function continuableCheck(receipt: Row, actor: any): boolean {
    return receipt.kind === 'roll' && receipt.form !== 'dice' && receipt.actor === actor && !dieHidden(receipt.visibility)
        && ['skill_check', 'characteristic_check'].includes(receipt.roll_kind) && isJsonObject(receipt.check);
}
export function latestCheckReceipt(context: SettleContext): [
    string,
    Row
] | null {
    const receipt = [...context.allReceipts()].reverse().find(value => continuableCheck(value, context.actorId));
    return receipt ? [string(receipt.id), {
            ...clone(receipt.check),
            roll_id: receipt.id,
            pushed: truth(receipt.pushed),
            continued_by: receipt.continued_by ?? null
        }] : null;
}
export function skillTickEligible(arithmetic: CheckArithmetic, skill: string, check: Row): boolean {
    if (!skill.trim() || array(row(arithmetic.data.development.tick).never_tick_skills).map(string).includes(skill))
        return false;
    // Improvement checks are for skills. A characteristic rolled through a skill-shaped receipt (the
    // dying CON roll and major-wound recovery are `healing_check` rolls on CON) never earns a tick; a
    // tick on CON later refuses `development:end-session` for the whole table, because CON is on no
    // skill list (`admission-e2e-4`, turn 40).
    if (Object.hasOwn(CHARACTERISTICS, skill.trim().toUpperCase()) || skill.trim().toUpperCase() === 'SAN')
        return false;
    if (check.success !== true && !SUCCESS_OUTCOMES.has(string(check.outcome || '').trim().toLowerCase()))
        return false;
    if (check.improvement_tick_eligible === false || truth(check.luck_spent) || check.excluded_outcome === 'bonus_die_only_success' || check.bonus_die_only_success === true)
        return false;
    if (number(check.bonus) > 0 && number(check.penalty) <= 0 && array(check.tens_values).length >= 2 && check.units != null) {
        const threshold = number(check.effective_target ?? check.target);
        const units = number(check.units);
        const without = number(check.unmodified_roll ?? (number(check.tens_values[0]) * 10 + units)) || 100;
        const withBonus = Math.min(...check.tens_values.map((value: any) => number(value) * 10 + units || 100));
        if (withBonus <= threshold && threshold < without)
            return false;
    }
    if (check.excluded_outcome === 'opposed_roll_loser' || check.opposed_won === false || ['defender_higher', 'tie_defender_wins'].includes(check.opposed_outcome))
        return false;
    if (['sanity_check', 'sanity', 'luck', 'damage', 'characteristic_check', 'characteristic', 'idea_roll', 'idea', 'combined_skill_check'].includes(string(check.kind || check.roll_kind || '')))
        return false;
    if (['device', 'remote_device', 'environment', 'trap', 'apparatus', 'poltergeist'].includes(caseFold(string(check.executor_kind || check.attack_executor_kind || 'living'))))
        return false;
    return check.device_attack !== true && check.remote_attack !== true;
}
export async function recordSkillTicks(context: SettleContext): Promise<void> {
    for (const receipt of context.receipts) {
        if (receipt.kind !== 'roll' || !isJsonObject(receipt.check) || dieHidden(receipt.visibility))
            continue;
        const actor = string(receipt.actor || '');
        const skill = string(receipt.skill).trim();
        if (!context.sheetById(actor) || !['skill_check', 'healing_check', 'opposed_check'].includes(receipt.roll_kind))
            continue;
        const check: Row = {
            ...receipt.check,
            kind: receipt.roll_kind
        };
        if (!skillTickEligible(context.arithmetic, skill, check))
            continue;
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(actor))
            valueError('investigator_id must be a stable safe id');
        const token = `development-check-${jsonDigest({
            campaign_id: context.campaignId,
            investigator_id: actor,
            source_kind: receipt.roll_kind,
            source_event_id: receipt.id
        })}`;
        const path = `development-state/${actor}.json`;
        const state = row(await context.readSave(path));
        state.investigator_id ??= actor;
        if (!isJsonObject(state.ticks))
            state.ticks = {};
        if (!isJsonObject(state.claimed))
            state.claimed = {};
        if (state.ticks[token] != null) {
            if (state.ticks[token].skill !== skill)
                valueError('development event token has conflicting skill');
            continue;
        }
        state.ticks[token] = {
            schema_version: 2,
            event_type: 'development_check_earned',
            event_token: token,
            investigator_id: actor,
            campaign_id: context.campaignId,
            session_id: `${context.campaignId}:session:1`,
            source_kind: receipt.roll_kind,
            source_event_id: receipt.id,
            skill,
            ts: nowIso(),
            roll: check.roll ?? null
        };
        await context.writeSave(path, state);
    }
}
