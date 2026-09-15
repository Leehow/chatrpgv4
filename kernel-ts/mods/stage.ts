/** Stage existing Mod object effects in the shared apply batch. */
import { RpcError } from '../errors.js';
import { canonicalJson, isJsonObject, orderedObject } from '../json.js';
import { actor as selectActor } from '../read/handlers.js';
import { findNamedObject } from '../read/mods.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { array, clone, entries, equal, integer, normalize, repr, row, string, truth, type Row } from '../read/values.js';
import type { CampaignWritePort, DomainEvent } from '../transactions.js';
import type { ApplyContext } from '../apply/index.js';
import { stagedSheet } from '../apply/inventory.js';
import { required } from '../write/store.js';
import { validateDefinition } from './definition.js';
import { initializeDocument, ownershipChanged, writeDocument } from './documents.js';
import { defineObject, moveObject, objectInstance, objectRegistry } from './objects.js';
import { objectTransferReceipt } from './object-transfer.js';
import { clearRegistration, queueAdoption, queueRegistration, queuedDefinition } from './queue.js';
import type { ModJobs } from './jobs.js';
import {registerUsage, validateUsage, validateUsageRequest} from './usages.js';

const field = (value: Row, key: string, fallback: any): any => Object.hasOwn(value, key) ? value[key] : fallback;
export async function objectOwner(campaign: CampaignWritePort, graph: ModuleGraph, world: Row, name: any): Promise<Row> {
    if (typeof name !== 'string' || !name.trim()) throw new RpcError('invalid_params', 'Object owner must be an investigator, NPC or scene name');
    if (name === 'here') { const scene = graph.scene(world.active_scene); return {kind: 'scene', id: graph.handle(scene), name: graph.displayName(scene)}; }
    for (const sheet of await campaign.party()) if ([normalize(sheet.id), normalize(sheet.name)].includes(normalize(name))) return {kind: 'investigator', id: sheet.id, name: sheet.name};
    const node = graph.find(name);
    if (node?.node_kind === 'npc') return {kind: 'npc', id: graph.handle(node), name: graph.displayName(node)};
    const container = objectInstance(world, name);
    if (container) return {kind: 'object', id: container.id, name: container.name};
    try { const scene = graph.scene(name); return {kind: 'scene', id: graph.handle(scene), name: graph.displayName(scene)}; }
    catch (error) { if (!(error instanceof RpcError)) throw error; throw new RpcError('unknown_entity', `No object owner named ${repr(name)}`); }
}
export async function stageModEffect(context: ApplyContext, original: Row, sheets: Map<string, Row>, jobs: ModJobs): Promise<{receipt: Row; event: DomainEvent}> {
    const {campaign, graph, world, callId} = context, turn = context.turn.turn;
    let effect = original;
    const kind = effect.kind, mint = (id: string) => context.mint(id);
    if (kind === 'usage') {
        const input = validateUsageRequest(effect), prepared = row(effect._usage), provenance = row(prepared.provenance);
        if (!truth(provenance.job)) throw new RpcError('needs',"Usage needs the host's tool-enabled Mod creator",{details:{reason:'mod_generation_required'}});
        const accepted = await jobs.accept({campaign:campaign.id,job:provenance.job});
        if (canonicalJson(accepted) !== canonicalJson(prepared)) throw new RpcError('invalid_params','Usage differs from the accepted Mod job');
        validateUsage(accepted.usage,{name:input.name});
        const usage = registerUsage(world,input.object,accepted.usage,accepted.physical_basis,provenance);
        return {receipt:{id:mint(`definition:usage-${callId}`),kind:'definition',name:usage.name,object:input.object,usage:usage.name,
            usage_id:usage.id,instance:usage.object_id,visibility:'keeper',call_id:callId},
            event:{type:'definition-created',data:{name:usage.name,object:input.object,capability:'objects.usages.v1'}}};
    }
    if (kind === 'define') {
        if (effect.category == null) effect = {...effect,category:'item'};
        // Registration the delivery does not wait on. Nothing about the object is invented here: the marker
        // records only what the Keeper already named plus the job that will produce its parameters, and the
        // receipt says so, so the audit that reads this turn's receipts is told the truth about what landed.
        if (typeof effect._queued === 'string') {
            const category = string(effect.category), name = string(effect.name);
            if (!['weapon', 'spell', 'item'].includes(category) || !name.trim()) throw new RpcError('invalid_params', 'A queued definition needs its name and category');
            if (!/^[0-9a-f]{64}$/.test(effect._queued)) throw new RpcError('invalid_params', 'A queued definition needs its Mod job');
            const provenance = truth(effect._provenance) ? row(effect._provenance) : {}, active = await jobs.runtime.active(world);
            const packageRow = active.find(mod => mod.id === provenance.mod);
            if (!packageRow || packageRow.digest !== provenance.digest || !truth(packageRow.contributes.materializer))
                throw new RpcError('invalid_params', 'Definition provenance is not an active materializer');
            queueRegistration(world, packageRow.id, {name, category, job: effect._queued, turn,
                define: {kind: 'define', name, category, ...(truth(effect.description) ? {description: effect.description} : {}), ...(truth(effect.template) ? {template: effect.template} : {})},
                adopt: null, owner: null, object: null});
            return {receipt: {id: mint(`definition:queued-${callId}`), kind: 'definition', name, category, queued: true, visibility: 'keeper', call_id: callId},
                event: {type: 'definition-queued', data: {name, category}}};
        }
        const draft = effect._definition;
        if (!isJsonObject(draft)) throw new RpcError('needs', "Definition needs the host's tool-enabled Mod creator", {details: {reason: 'mod_generation_required'}});
        validateDefinition(draft, {name: effect.name ?? null, category: effect.category ?? null});
        const provenance = truth(effect._provenance) ? effect._provenance : {}, active = await jobs.runtime.active(world), packageRow = active.find(mod => mod.id === provenance.mod);
        if (!packageRow || packageRow.digest !== provenance.digest || !truth(packageRow.contributes.materializer)) throw new RpcError('invalid_params', 'Definition provenance is not an active materializer');
        const accepted = await jobs.accept({campaign: campaign.id, job: provenance.job});
        if (canonicalJson(accepted.definition ?? null) !== canonicalJson(draft)) throw new RpcError('invalid_params', 'Definition differs from the accepted Mod job');
        const value = defineObject(world, draft, provenance);
        // The registration this definition was queued for is now real, so its marker stops standing in
        // for it -- otherwise the row would stay hidden from the audit that is supposed to notice gaps.
        clearRegistration(world, packageRow.id, string(value.name), string(value.category));
        return {receipt: {id: mint(`definition:${callId}`), kind: 'definition', name: value.name, category: value.category, definition: value.id, visibility: 'keeper', call_id: callId},
            event: {type: 'definition-created', data: {name: value.name, category: value.category}}};
    }
    if (kind === 'dossier') {
        // Contract 28.7. A word a book never gave has nowhere to live: the graph is the book's and no
        // package may write it, and the ledger is the kernel's and would outlive the package that filled
        // it. This writes into the package's own namespace instead, so turning the package off takes the
        // word with it and the book is left exactly as it was found.
        const node = graph.npc(required(effect, 'name')!), handle = graph.handle(node);
        const values = effect.values;
        if (!isJsonObject(values) || !entries(values).length)
            throw new RpcError('invalid_params', 'a dossier effect needs `values`, one or more contributed keys',
                {fix: 'name the keys this package contributes and what the table established for each', details: {field: 'dossier.values'}});
        const active = await jobs.runtime.active(world);
        const owners = new Map<string, Row>();
        for (const mod of active) {
            if (!array(mod.requires).includes('graph.vocabulary.table.v1'))
                continue;
            for (const entry of array(row(row(mod.contributes).vocabulary).actor_profile_keys))
                if (!owners.has(string(entry.key)))
                    owners.set(string(entry.key), mod);
        }
        const written: string[] = [];
        for (const [key, value] of entries(values)) {
            const mod = owners.get(key);
            if (!mod)
                throw new RpcError('invalid_params', `no active package establishes ${repr(key)} at the table`,
                    {fix: `use a key contributed by a package requiring graph.vocabulary.table.v1${owners.size ? `: ${[...owners.keys()].join(', ')}` : ''}`,
                     details: {field: 'dossier.values', key, available: [...owners.keys()]}});
            // The book outranks the table on its own material: a word the source gave is not the
            // Keeper's to overwrite, and silently keeping the losing value would leave two answers on record.
            const authored = graph.npcProfile(node)[key];
            if (truth(authored))
                throw new RpcError('invalid_params', `the source already gives ${graph.displayName(node)} ${key} ${repr(authored)}`,
                    {fix: 'the book\'s own word stands; establish this only for someone the source leaves silent',
                     details: {field: 'dossier.values', actor: handle, key, authored_value: authored}});
            const shape = array(row(row(mod.contributes).vocabulary).actor_profile_keys).find(entry => string(entry.key) === key);
            if (row(shape).shape === 'lines')
                throw new RpcError('invalid_params', `${key} is written by the package's own lane, not at the table`,
                    {fix: 'leave this word to the npc-voice lane; it fills it for anyone the source leaves silent', details: {field: 'dossier.values', key}});
            if (typeof value !== 'string' || !value.trim() || value.length > 200)
                throw new RpcError('invalid_params', `dossier.values.${key} must be one bounded line`,
                    {fix: 'say what the table established, in a phrase', details: {field: `dossier.values.${key}`}});
            const namespaces = world.mods.state;
            const id = string(mod.id);
            if (!Object.hasOwn(namespaces, id)) namespaces[id] = {};
            if (!Object.hasOwn(namespaces[id], 'dossier')) namespaces[id].dossier = {};
            const recorded = namespaces[id].dossier;
            if (!Object.hasOwn(recorded, node.node_id)) recorded[node.node_id] = {};
            // The record carries the word's Keeper-facing name with it. The label a module recorded at
            // build is exactly what a table this feature exists for does not have, so reading one back
            // through the build-time spine would leave the value written and unreadable.
            const label = array(row(row(mod.contributes).vocabulary).actor_profile_keys)
                .find(entry => string(entry.key) === key);
            recorded[node.node_id][key] = {value: value.trim(), label: string(row(label).label) || key, turn, mod: id};
            written.push(key);
        }
        return {receipt: {id: mint(`dossier:${handle}-t${turn}`), kind: 'dossier', call_id: callId, npc: node.node_id, handle,
                          name: graph.displayName(node), keys: written, values: Object.fromEntries(written.map(key => [key, string(values[key]).trim()])),
                          ...(truth(effect.why) ? {why: effect.why} : {}), visibility: 'keeper'},
                event: {type: 'dossier-established', data: {npc: handle, keys: written}}};
    }
    if (kind === 'object') {
        const name = effect.name;
        if (typeof name !== 'string' || !name.trim()) throw new RpcError('invalid_params', 'Object needs a name');
        const owner = await objectOwner(campaign, graph, world, effect.to), source = truth(effect.from) ? await objectOwner(campaign, graph, world, effect.from) : null;
        const prior = objectInstance(world, name); let adopted: any = null;
        // Its definition is still queued, so the adoption is queued with it and the two are replayed
        // together. The sheet row stays exactly where it is, which is the shape the world already had.
        if (Object.hasOwn(effect, 'adopt') && !prior) {
            const waiting = queuedDefinition(world, truth(effect.definition) ? effect.definition : name);
            if (waiting) {
                if (typeof effect.adopt !== 'string' || !effect.adopt.trim() || source || owner.kind !== 'investigator')
                    throw new RpcError('invalid_params', 'Adopt needs an existing investigator equipment name, without from or an existing instance');
                if (!queueAdoption(world, string(waiting.name), string(waiting.category), {...effect}))
                    throw new RpcError('invalid_params', 'The queued definition for this adoption is no longer registered');
                return {receipt: {id: mint(`definition:queued-adopt-${callId}`), kind: 'definition', name, category: waiting.category,
                    queued: true, adopted: effect.adopt, subject: owner.id, visibility: 'keeper', call_id: callId},
                    event: {type: 'definition-queued', data: {name: string(waiting.name), category: string(waiting.category)}}};
            }
        }
        if (!prior && !Object.hasOwn(effect, 'adopt') && owner.kind === 'investigator') {
            const sheet = sheets ? await stagedSheet(context, sheets, owner.name) : selectActor(await campaign.party() as Row[], owner.name);
            if (array(sheet.equipment).some(item => typeof item === 'string' ? item === name : isJsonObject(item) && item.name === name))
                throw new RpcError('invalid_params', 'This equipment is already owned; use object.adopt to enrich it instead of awarding another copy');
        }
        if (Object.hasOwn(effect, 'adopt')) {
            if (typeof effect.adopt !== 'string' || !effect.adopt.trim() || prior || source || owner.kind !== 'investigator' || !sheets)
                throw new RpcError('invalid_params', 'Adopt needs an existing investigator equipment name, without from or an existing instance');
            const sheet = await stagedSheet(context, sheets, owner.name), matches = array(sheet.equipment).flatMap((item, index) =>
                typeof item === 'string' && item === effect.adopt || isJsonObject(item) && !truth(item.object_id) && item.name === effect.adopt ? [[index, item] as const] : []);
            if (matches.length !== 1) throw new RpcError('invalid_params', 'Adoption must identify exactly one existing unmanaged equipment row');
            const [index, value] = matches[0]; adopted = value;
            if (array(sheet.weapons).some(weapon => isJsonObject(weapon) && normalize(string(weapon.name || weapon.display_name || '')) === normalize(effect.adopt)
                && truth(weapon.weapon_id || weapon.damage || weapon.damage_die))) throw new RpcError('invalid_params', 'This equipment already has executable weapon parameters');
            const recorded = row(adopted), count = field(recorded, 'quantity', 1), condition = field(recorded, 'condition', 'intact');
            if (!equal(field(effect, 'quantity', count), count) || !equal(field(effect, 'condition', condition), condition)) throw new RpcError('invalid_params', 'Adoption preserves recorded quantity and condition');
            effect = {...effect, quantity: count, condition}; sheet.equipment.splice(index, 1);
        }
        const beforeCondition = prior?.state.condition ?? null;
        if (prior && effect.condition != null && effect.condition !== beforeCondition && !string(effect.why || '').trim()) throw new RpcError('invalid_params', 'A physical state change needs its causal reason in why');
        const quantity = field(effect, 'quantity', prior ? prior.quantity : 1);
        let seed: Row | null = null, writing = false;
        if (Object.hasOwn(effect, 'document')) {
            if (prior && !equal(source, owner)) throw new RpcError('invalid_params', 'Document initialization or writing uses the same current from/to owner');
            const value = effect.document; writing = isJsonObject(value) && value.action === 'write';
            if (writing) {
                if (Object.keys(value).length !== 2 || !Object.hasOwn(value, 'text') || !prior || !string(effect.why || '').trim()) throw new RpcError('invalid_params', 'Writing an existing document needs text and a causal why');
            } else seed = await jobs.documentSeed(graph, world, value);
        }
        const item = moveObject(world, name, effect.definition ?? null, owner, {source, turn, quantity, condition: effect.condition ?? null, documentSeed: prior ? null : seed});
        const definition = objectRegistry(world).definitions[item.definition];
        if (prior && Object.hasOwn(effect, 'document')) {
            if (writing) writeDocument(item, effect.document.text);
            else { initializeDocument(item, seed); ownershipChanged(world); }
        }
        if (adopted !== null) {
            const recorded = row(adopted);
            for (const key of ['ammo', 'charges']) if (Object.hasOwn(recorded, key)) {
                const value = recorded[key];
                if (value !== null && (!integer(value) || value < 0)) throw new RpcError('invalid_params', 'Recorded ammunition and charges must be nonnegative integers or null');
                item.state[key] = value;
            }
            return {receipt: {id: mint(`definition:adopt-${callId}`), kind: 'definition', name, category: definition.category, definition: definition.id,
                instance: item.id, adopted: effect.adopt, subject: owner.id, visibility: 'keeper', call_id: callId},
                event: {type: 'resource-changed', data: {resource: 'equipment_representation', subject: owner.id, item: name}}};
        }
        if (prior && Object.hasOwn(effect, 'document')) return {receipt: {id: mint(`definition:document-${callId}`), kind: 'definition', name, document_changed: true, visibility: 'keeper', call_id: callId},
            event: {type: 'resource-changed', data: {resource: 'document', subject: owner.id, item: name}}};
        if (prior && equal(source, owner) && effect.condition != null) {
            const receipt = {id: mint(`delta:item-condition-${callId}`), kind: 'delta', resource: 'condition', subject: owner.id, subject_label: owner.name,
                subject_is_investigator: owner.kind === 'investigator', item: item.name, instance: item.id, before: beforeCondition, after: item.state.condition,
                why: effect.why ?? null, call_id: callId};
            return {receipt, event: {type: 'resource-changed', data: {resource: receipt.resource, subject: receipt.subject, item: receipt.item, before: receipt.before, after: receipt.after}}};
        }
        return objectTransferReceipt({id: mint(`item:${callId}`), callId, name, owner, source, quantity, item, definition, why: effect.why ?? null});
    }
    if (kind === 'ability') {
        const owner = await objectOwner(campaign, graph, world, effect.to);
        if (!['npc', 'investigator'].includes(owner.kind) || typeof effect.source !== 'string' || !effect.source.trim()) throw new RpcError('invalid_params', 'Ability acquisition needs a person and an explicit source');
        const definition = findNamedObject(objectRegistry(world).definitions, string(effect.name));
        if (!definition || definition.category !== 'spell') throw new RpcError('invalid_params', 'Ability must name an accepted spell definition');
        if (owner.kind === 'investigator') throw new RpcError('needs', 'Owning a source does not teach its spell; use resolve magic:learn-spell', {details: {reason: 'spell_learning_required'}});
        const abilities = objectRegistry(world).abilities;
        if (!Object.hasOwn(abilities, owner.id)) abilities[owner.id] = {};
        abilities[owner.id] = orderedObject([...entries(abilities[owner.id]), [definition.name, {source: effect.source, turn}]]);
        return {receipt: {id: mint(`ability:${callId}`), kind: 'ability', name: definition.name, subject: owner.id, source: effect.source, visibility: 'keeper', call_id: callId},
            event: {type: 'ability-acquired', data: {name: definition.name, subject: owner.id}}};
    }
    throw new RpcError('invalid_params', 'Unsupported Mod world effect');
}
