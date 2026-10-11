/** Active package selection and canonical settlement adapter for §228. No package imports runtime objects. */
import type {KernelContext} from '../context.js';
import {activeMods, readModCatalog} from '../read/mods.js';
import {parsePythonJson} from '../json.js';
import {row, type Row} from '../read/values.js';
import type {SettleContext} from '../resolve/context.js';
import {latestPushSource, pushRefusal, refusePush, validatePushRules, type PushProvider} from './pushed-roll-policy.js';

export async function pushedRollProvider(kernel: KernelContext, world: Row): Promise<PushProvider | null> {
    const mod = (await activeMods(kernel, world)).filter(mod => typeof mod.contributes.pushed_roll === 'string').at(-1);
    return mod ? {id: mod.id, version: mod.version, digest: mod.digest,
        rules: validatePushRules(parsePythonJson(mod.files.get(mod.contributes.pushed_roll).toString('utf8')))} : null;
}

/** Installed wording may recognize a disabled feature solely to deliver its refusal. */
export async function pushedRollDefinition(kernel: KernelContext, provider: PushProvider | null): Promise<Row | null> {
    if (provider) return provider.rules;
    const mod = [...(await readModCatalog(kernel)).values()].find(mod => mod.id === 'pushed-roll' && mod.compatible);
    return mod ? validatePushRules(parsePythonJson(mod.files.get(mod.contributes.pushed_roll).toString('utf8'))) : null;
}

export async function preparePush(context: SettleContext): Promise<{provider: PushProvider; source: Row}> {
    const provider = await pushedRollProvider(context.kernel, context.world);
    if (context.actingId && context.actingId !== context.actorId) refusePush('wrong_actor', provider);
    const receipts = context.allReceipts(), source = latestPushSource(receipts, context.actorId);
    const reason = await pushRefusal(provider, source, {actor: context.actorId, receipts,
        session: context.sessions().activeSession(), luck: context.action.luck, continuation: context.action.push_context}, context.tables);
    if (reason) refusePush(reason, provider);
    return {provider: provider!, source: source!};
}

export function drawPushRisk(context: Pick<SettleContext, 'rng'>, provider: PushProvider): Row {
    const roll = context.rng.randint(1, 100);
    const selected = provider.rules.rows.find((entry: Row) => roll >= entry.min && roll <= entry.max);
    return {mod: provider.id, version: provider.version, digest: provider.digest, table_version: provider.rules.version,
        roll, key: selected.key, instruction: selected.instruction, fallback: provider.rules.fallback.map((key: string) => {
            const entry = provider.rules.rows.find((entry: Row) => entry.key === key);
            return {key, instruction: entry.instruction};
        })};
}

export function pushSourceCheck(source: Row): Row {
    return {...row(source.check), roll_id: source.id, pushed: source.pushed === true, investigator_id: source.actor,
        skill: source.skill, kind: source.roll_kind};
}
