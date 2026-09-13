/** Tool-enabled host job packets and acceptance; this module never invokes a model. */
import { mkdir, lstat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import { writeJsonAtomic } from '../fileio.js';
import { isJsonObject, jsonDigest } from '../json.js';
import { loadCampaignModule } from '../read/campaign.js';
import { playLanguageOf } from '../read/languages.js';
import { recordOf, type ModuleGraph } from '../read/module-graph.js';
import { whereSection } from '../read/capsule.js';
import { MOD_CAPABILITIES, objectContext, unregisteredEquipment, findNamedObject } from '../read/mods.js';
import { array, chars, clone, entries, equal, normalize, row, sorted, string, truth, values, type Row } from '../read/values.js';
import { RuleTables } from '../rules/tables.js';
import type { createWriteRuntime } from '../write/index.js';
import { validateDefinition, validateDocumentSeed } from './definition.js';
import { claimedEquipment, queuedRegistrations } from './queue.js';
import type { ModRuntime } from './runtime.js';
import {SOURCE_AUDIT, auditSourceEvidence, writeAuditSources, verifyAuditSources, validateSourceReview} from './audit-source.js';
import {CONTINUITY_AUDIT, AUDIT_LIMITS, continuityArtifactErrors} from './audit-result.js';

export interface ModSources { asset?: (moduleId: string, name: string) => Promise<Row | null>; }
const field = (value: Row, key: string, fallback: any): any => Object.hasOwn(value, key) ? value[key] : fallback;
export class ModJobs {
    readonly tables: RuleTables;
    constructor(readonly context: KernelContext, readonly runtime: ModRuntime, readonly writer: ReturnType<typeof createWriteRuntime>, readonly sources: ModSources = {}) {
        this.tables = new RuleTables(context);
    }
    private async load(params: Row) {
        const transaction = await this.writer.transaction(params, {preload: false});
        const meta = await transaction.campaign.readCampaign(), module = await loadCampaignModule(this.context, string(meta.module_id), transaction.world);
        return {...transaction, meta, module, graph: module.graph};
    }
    private reviewScope(campaign: string, meta: Row, turn: Row): string {
        return join(this.runtime.root, 'jobs', jsonDigest(['continuity-chain', campaign, meta.active_worldline ?? null, turn.turn, turn.opened_at ?? null]));
    }
    async reviewStatus(params: Row): Promise<Row> {
        const {campaign, world, turn, meta} = await this.load(params);
        const enabled = (await this.contributors(world, turn, 'audit')).some(mod => array(mod.requires).includes(CONTINUITY_AUDIT));
        if (!enabled) return {enabled: false, paused: false};
        const path = join(this.reviewScope(campaign.id, meta, turn), 'review-budget.json');
        if (!await this.context.snapshots.pathExists(path)) return {enabled: true, paused: false, turn: turn.turn};
        try {
            const budget = row(await this.context.snapshots.readJson(path));
            const invalid = budget.version !== 1 || !['requests', 'ms', 'rewrites', 'artifact_repairs'].every(k => typeof budget[k] === 'number' && budget[k] >= 0);
            const reason = invalid ? 'Retained review accounting is invalid' : budget.blocked || (budget.active ? 'An interrupted review retains its allowance' : null);
            return {enabled: true, paused: !!reason, reason, turn: turn.turn};
        } catch { return {enabled: true, paused: true, reason: 'Retained review accounting is unreadable', turn: turn.turn}; }
    }
    async knownHandouts(graph: ModuleGraph, world: Row): Promise<Row[]> {
        const result: Row[] = [];
        for (const handle of array(world.handouts_shown)) {
            const node = graph.find(handle);
            if (!node) continue;
            if (!this.sources.asset) throw new RpcError('not_implemented', 'The module asset contribution is not implemented');
            const record = recordOf(node), registered = (graph.assetOverride ? await graph.assetOverride(node.node_id) : await this.sources.asset(graph.moduleId, node.node_id)) || {};
            const value = typeof record.authored_text === 'string' ? record.authored_text : registered.authored_text;
            if (typeof value === 'string') result.push({name: graph.displayName(node), text: value});
        }
        return result;
    }
    async documentSeed(graph: ModuleGraph, world: Row, value: any): Promise<Row> {
        let seed = validateDocumentSeed(value);
        if (Object.hasOwn(seed, 'handout')) {
            const matches = (await this.knownHandouts(graph, world)).filter(item => normalize(item.name) === normalize(seed.handout));
            if (matches.length !== 1) throw new RpcError('invalid_params', 'Document source must name one already revealed textual handout');
            seed = validateDocumentSeed({text: matches[0].text, presentation: seed.presentation});
        }
        return seed;
    }
    async contributors(world: Row, turn: Row, role: string): Promise<Row[]> {
        if (role === 'create') return (await this.runtime.active(world)).filter(mod => truth(mod.contributes.materializer)).slice(-1);
        const decisions = new Set(array(turn.receipts).map(receipt => receipt.decision ?? null)), owners = await this.runtime.decisions(world), providers = await this.runtime.providers(world);
        const result: Row[] = [];
        for (const mod of await this.runtime.effective(world)) {
            const contributes = mod.contributes;
            if (!truth(contributes.auditor) || providers[`audit:${field(contributes, 'audit_slot', mod.id)}`].at(-1) !== mod.id) continue;
            const triggers = contributes.audit_on_decisions;
            if (truth(triggers) && !array(triggers).some(name => decisions.has(name) && (!owners.has(name) || owners.get(name)![0] === mod.id))) continue;
            result.push(mod);
        }
        return result;
    }
    /**
     * Only the table that can answer this job travels with it. A definition is pinned to its category
     * before the child starts -- `job` validates it and `accept` re-pins name and category -- so an
     * item can never reach a weapon or spell preset. It carried them anyway: 24 of the 25 definitions
     * on record were items, and every one shipped all 88 KB of both tables.
     *
     * An oversized packet does not merely cost tokens, because the child cannot query a file. The
     * children answered it by building their own extraction instead: a quarter of their shell calls
     * are ad-hoc `python3 -c "import json ..."` against request.json.
     */
    private async presets(category: string): Promise<Row> {
        if (category === 'weapon') return {weapons: await this.tables.weaponsTable()};
        if (category === 'spell') return {spells: await this.tables.spellsTable()};
        return {};
    }
    async job(params: Row): Promise<Row> {
        const {campaign, graph, module, world, turn, meta} = await this.load(params), role = params.role;
        if (!['create', 'audit'].includes(role)) throw new RpcError('invalid_params', 'Mod job role must be create or audit');
        if (role === 'create') {
            const input = params.input;
            if (!isJsonObject(input) || !['weapon', 'spell', 'item'].includes(input.category as string)) throw new RpcError('invalid_params', 'Definition request needs a category and a name');
            if (input.category === 'spell' && array((await this.tables.spellsTable()).spells).some(spell => normalize(string(spell.name)) === normalize(string(input.name))))
                throw new RpcError('needs', 'This name already belongs to a rulebook spell', {fix: 'use the existing spell, or give a distinct derivative its own name'});
        }
        const promptField = role === 'create' ? 'materializer' : 'auditor', candidates = await this.contributors(world, turn, role);
        if (!candidates.length) return {enabled: false};
        const packageRow = candidates[0], party = await campaign.party() as Row[];
        const continuity = role === 'audit' && candidates.some(mod => array(mod.requires).includes(CONTINUITY_AUDIT));
        const sourceAudit = !continuity && role === 'audit' && candidates.some(mod => array(mod.requires).includes(SOURCE_AUDIT));
        const wait = row(row(params.input).preparation_wait), refused = row(row(params.input).rebinding_refused);
        const evidence = sourceAudit || continuity ? await auditSourceEvidence(this.context, campaign, module, world, turn, party, continuity, wait, refused) : null;
        const request: Row = {role, input: params.input ?? null, capabilities: sorted(MOD_CAPABILITIES), play_language: await playLanguageOf(this.context, meta),
            mod_settings: Object.fromEntries(candidates.map(mod => [mod.id, (world as Row).mods.active[mod.id].settings])),
            scene: whereSection(graph, world, graph.scene(world.active_scene as string)), party, objects: objectContext(world), receipts: field(turn, 'receipts', []),
            known_handouts: (await this.knownHandouts(graph, world)).map(item => ({name: item.name, preview: chars(item.text, 240)})),
            unregistered_equipment: unregisteredEquipment(party, claimedEquipment(world))};
        if (evidence) request[continuity ? 'continuity_review' : 'source_review'] = evidence.descriptor;
        if (role === 'create') request.catalogs = await this.presets(string(row(params.input).category));
        const identity: Row = {campaign: campaign.id, turn: turn.turn, worldline: meta.active_worldline ?? null, mod: packageRow.id, digest: packageRow.digest,
            packages: candidates.map(mod => ({id: mod.id, digest: mod.digest})), request: role === 'audit' ? request : {input: params.input ?? null, role},
            ...(evidence ? {source_binding: evidence.binding} : {})};
        const key = jsonDigest(identity), root = join(this.runtime.root, 'jobs', key);
        if (!await this.context.snapshots.pathExists(join(root, 'request.json'))) {
            await mkdir(root, {recursive: true});
            if (evidence) await writeAuditSources(root, evidence.files);
            await writeJsonAtomic(join(root, 'request.json'), request);
            await writeJsonAtomic(join(root, 'identity.json'), Object.fromEntries(entries(identity).filter(([name]) => name !== 'request')));
            const prompts: Buffer[] = [];
            for (const [index, mod] of candidates.entries()) { if (index) prompts.push(Buffer.from('\n\n')); prompts.push(mod.files.get(mod.contributes[promptField])); }
            await writeFile(join(root, 'prompt.md'), Buffer.concat(prompts));
            if (role === 'create') {
                const prior = findNamedObject(row(row(world.objects).definitions), string(params.input.name));
                if (prior && prior.category === params.input.category) {
                    const definition = Object.fromEntries(['name', 'category', 'description', 'basis', 'parameters', 'player_view', 'traits', 'document'].filter(name => Object.hasOwn(prior, name)).map(name => [name, clone(prior[name])]));
                    await writeJsonAtomic(join(root, 'accepted.json'), {definition, provenance: {mod: packageRow.id, digest: packageRow.digest, job: key, reused_definition: prior.id}});
                }
            }
        }
        return {enabled: true, job: key, cwd: root, system_prompt: join(root, 'prompt.md'), mod: packageRow.id, digest: packageRow.digest,
            accepted: await this.context.snapshots.pathExists(join(root, 'accepted.json')), role, ...(sourceAudit ? {source_review: true} : {}),
            ...(continuity ? {continuity_review: true, focus: evidence!.files['context.json'], limits: AUDIT_LIMITS,
                review_scope: this.reviewScope(campaign.id, meta, turn)} : {})};
    }
    /**
     * The registrations whose parameters have arrived, shaped as ordinary effects. The host applies them
     * through the same staging every other definition travels, so nothing here is a second implementation
     * of define or adopt; an entry whose job has not finished yet is simply left for the next turn.
     */
    async queued(params: Row): Promise<Row> {
        const {campaign, world, turn} = await this.load(params), effects: Row[] = [], unfinished: Row[] = [];
        // A registration the host could not complete falls back to the ordinary blocking path rather than
        // leaving a marker that hides its row from the audit: dropped here, the gear reads as unregistered
        // again on the next turn and the Keeper registers it the way it did before any of this existed.
        if (truth(params.discard)) {
            const dropped = queuedRegistrations(world).length;
            for (const state of values(row(row(world.mods).state))) if (isJsonObject(state)) state.queued = {};
            await campaign.writeWorld(world);
            return {effects, unfinished, discarded: dropped};
        }
        for (const entry of queuedRegistrations(world)) {
            // Deferral means not this turn. Completing inside the turn that queued it would put the wait
            // back where it was, one tool call later, which is exactly what the marker exists to avoid.
            if (equal(entry.turn, turn.turn)) continue;
            const define = clone(row(entry.define));
            const accepted = join(this.runtime.root, 'jobs', string(entry.job), 'accepted.json');
            // A session that died between the marker and its parameters must not leave the row hidden from
            // the audit for good, so an unfinished entry is reported as work rather than silently skipped.
            if (!await this.context.snapshots.pathExists(accepted)) {
                unfinished.push({name: define.name, category: define.category, ...(Object.hasOwn(define, 'description') ? {description: define.description} : {}),
                    ...(Object.hasOwn(define, 'template') ? {template: define.template} : {})});
                continue;
            }
            const value = row(await this.context.snapshots.readJson(accepted));
            effects.push({...define, _definition: value.definition, _provenance: value.provenance});
            if (truth(entry.object)) effects.push(clone(row(entry.object)));
        }
        return {effects, unfinished};
    }
    async accept(params: Row): Promise<Row> {
        const key = params.job;
        if (typeof key !== 'string' || key.length !== 64 || !/^[0-9a-f]{64}$/.test(key)) throw new RpcError('invalid_params', 'Unknown Mod job');
        const root = join(this.runtime.root, 'jobs', key), identity = row(await this.context.snapshots.readJson(join(root, 'identity.json')));
        const {campaign, graph, module, world, turn, meta} = await this.load(params);
        // A deferred registration is accepted after delivery, and narrate has already moved the turn on, so
        // the turn is not what pins this job -- the marker the kernel itself wrote is. Campaign, worldline
        // and the package digests below still have to match.
        const deferred = queuedRegistrations(world).some(entry => entry.job === key);
        if (identity.campaign !== campaign.id || (!deferred && !equal(identity.turn, turn.turn)) || !equal(identity.worldline, meta.active_worldline ?? null))
            throw new RpcError('invalid_params', 'Mod job belongs to another turn or worldline');
        const active = new Map((await this.runtime.active(world)).map(mod => [mod.id, mod]));
        if (!active.has(identity.mod) || active.get(identity.mod)!.digest !== identity.digest) throw new RpcError('invalid_params', 'Mod changed while the job was running');
        if (array(identity.packages).some(mod => active.get(mod.id)?.digest !== mod.digest)) throw new RpcError('invalid_params', 'An audit contributor changed while the job was running');
        const request = row(await this.context.snapshots.readJson(join(root, 'request.json'))), providers = (await this.contributors(world, turn, request.role)).map(mod => ({id: mod.id, digest: mod.digest}));
        if (!equal(providers, identity.packages ?? null)) throw new RpcError('invalid_params', 'The effective Mod provider changed while the job was running');
        const continuity = request.role === 'audit' && (await this.contributors(world, turn, 'audit')).some(mod => array(mod.requires).includes(CONTINUITY_AUDIT));
        const sourceAudit = !continuity && request.role === 'audit' && (await this.contributors(world, turn, 'audit')).some(mod => array(mod.requires).includes(SOURCE_AUDIT));
        if ((sourceAudit || continuity) && jsonDigest({...identity, request}) !== key) throw new RpcError('needs', 'The retained source-audit request changed',
            {details: {reason: 'mod_audit_evidence', file: 'request.json'}, fix: 'Keep this draft unpublished; inspect the retained audit request'});
        const wait = row(row(request.input).preparation_wait), refused = row(row(request.input).rebinding_refused);
        const evidence = sourceAudit || continuity ? await auditSourceEvidence(this.context, campaign, module, world, turn, await campaign.party() as Row[], continuity, wait, refused) : null;
        if (evidence) {
            if (evidence.binding !== identity.source_binding) throw new RpcError('needs', 'Source audit no longer matches the current campaign evidence',
                {details: {reason: 'mod_audit_stale'}, fix: 'Retry the same narration to prepare a current source audit; do not reroll settled actions'});
            await verifyAuditSources(root, evidence.files);
        }
        const acceptedPath = join(root, 'accepted.json');
        if (await this.context.snapshots.pathExists(acceptedPath)) {
            const accepted = row(await this.context.snapshots.readJson(acceptedPath));
            if (continuity) this.validateContinuity(accepted, request, evidence!.files);
            else if (evidence) validateSourceReview(accepted.source_review, string(row(request.input).text), evidence.files);
            return accepted;
        }
        const resultPath = join(root, 'result.json');
        if (!await this.context.snapshots.pathExists(resultPath)) throw new RpcError('invalid_params', 'Mod agent did not write a bounded result.json');
        const stat = await lstat(resultPath);
        if (stat.isSymbolicLink() || stat.size > 512000) throw new RpcError('invalid_params', 'Mod agent did not write a bounded result.json');
        const raw = clone(await this.context.snapshots.readJson(resultPath));
        let result: Row;
        if (request.role === 'create') {
            if (isJsonObject(raw) && Object.hasOwn(raw, 'document')) raw.document = await this.documentSeed(graph, world, raw.document);
            const value = validateDefinition(raw, {name: request.input.name ?? null, category: request.input.category ?? null});
            if (value.category === 'weapon' && array(active.get(identity.mod)!.requires).includes('weapons.profile.v2') && !Object.hasOwn(value.parameters, 'adds_damage_bonus'))
                throw new RpcError('invalid_params', 'Weapon profile v2 must explicitly declare adds_damage_bonus from its preset rule');
            result = {definition: value, provenance: {mod: identity.mod, digest: identity.digest, job: key}};
        } else if (continuity) {
            this.validateContinuity(raw, request, evidence!.files);
            result = row(raw);
        } else {
            if (!isJsonObject(raw) || Object.keys(raw).some(name => !['missing', 'findings', ...(sourceAudit ? ['source_review'] : [])].includes(name)) || !Array.isArray(raw.missing) || raw.missing.length > 16)
                throw new RpcError('invalid_params', 'Audit must return a bounded missing list');
            for (const finding of raw.missing) {
                if (!isJsonObject(finding) || Object.keys(finding).length !== 3 || !['name', 'category', 'reason'].every(name => Object.hasOwn(finding, name))
                    || !['weapon', 'spell', 'item'].includes(finding.category as string) || entries(finding).some(([, value]) => typeof value !== 'string' || !value.trim()))
                    throw new RpcError('invalid_params', 'Audit finding needs name, category and reason');
            }
            const findings = field(raw, 'findings', []);
            if (!Array.isArray(findings) || findings.length > 10 || findings.some(finding => !isJsonObject(finding) || Object.keys(finding).length !== 2
                || !Object.hasOwn(finding, 'reason') || !Object.hasOwn(finding, 'fix') || entries(finding).some(([, value]) => typeof value !== 'string' || !value.trim())))
                throw new RpcError('invalid_params', 'Narrative audit findings need reason and fix');
            if (evidence) validateSourceReview(raw.source_review, string(row(request.input).text), evidence.files);
            result = raw;
        }
        await writeJsonAtomic(acceptedPath, result); return result;
    }
    private validateContinuity(raw: unknown, request: Row, files: Row): void {
        const errors = continuityArtifactErrors(raw, string(row(request.input).text), files);
        if (errors.length) throw new RpcError('invalid_params', 'The audit artifact needs a targeted format repair',
            {details: {reason: 'audit_artifact_invalid', errors}});
    }
}
