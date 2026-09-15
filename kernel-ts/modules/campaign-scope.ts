/** A reusable library publication seeds one independently writable campaign source. */
import { constants } from 'node:fs';
import { copyFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import { withExclusiveLock } from '../locks.js';
import { writeJsonAtomic } from '../fileio.js';
import { array, clone, row } from '../read/values.js';
import { ModuleStore, validateModuleId } from './store.js';
import { childPath, inside, resolvedPath } from './paths.js';

export function moduleContext(context: KernelContext, campaign: string): KernelContext {
    if (typeof campaign !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(campaign))
        throw new RpcError('invalid_params', 'campaign must be a short slug');
    return { ...context, moduleRoot: join(context.stateRoot, 'module-campaigns', campaign, 'modules') };
}

export async function ensureCampaignModule(context: KernelContext, campaign: string, moduleId: string): Promise<KernelContext> {
    const scoped = moduleContext(context, campaign), id = validateModuleId(moduleId);
    const store = new ModuleStore(scoped), destination = store.moduleDir(id);
    const scopeRoot = join(context.stateRoot, 'module-campaigns');
    if (await resolvedPath(destination) !== join(await resolvedPath(scopeRoot), campaign, 'modules', id))
        throw new RpcError('invalid_params', 'campaign module path redirects outside its own scope');
    const campaignFile = join(context.campaignsRoot, campaign, 'campaign.json');
    if (await context.snapshots.isFile(campaignFile)) {
        const meta = row(await context.snapshots.readJson(campaignFile));
        if (meta.module_id !== id)
            throw new RpcError('invalid_params', 'the requested module does not belong to this campaign');
    }
    const existing = async () => {
        if (!await store.exists(id)) return false;
        const meta = await store.module(id);
        if (meta.id !== id || meta.campaign_scope !== campaign)
            throw new RpcError('invalid_params', 'the private module belongs to a different campaign scope');
        return true;
    };
    if (await existing()) return scoped;
    // The seed lock lives outside the atomically published directory. It also protects setup
    // scopes that precede campaign.json, so two kernel processes cannot publish different seeds.
    return withExclusiveLock(context.locks, join(scoped.moduleRoot!, `.seed-${id}.lock`), async () => {
        if (await existing()) return scoped;
        const libraryContext = { ...context, moduleRoot: join(context.stateRoot, 'modules') };
        const library = new ModuleStore(libraryContext), source = library.moduleDir(id);
        if (!await library.exists(id) && await context.snapshots.isFile(join(context.content, 'starters', id, 'module-graph.json')))
            await library.register(id);
        return withExclusiveLock(context.locks, join(source, '.metadata.lock'), async () => {
            const meta = await library.module(id), graph = await library.readGraph(id);
            const temporary = join(scoped.moduleRoot!, `.seed-${id}-${randomUUID()}`);
            await mkdir(temporary, { recursive: true });
            const copied = new Set<string>();
            const copy = async (name: unknown, required = false) => {
                if (typeof name !== 'string' || !name || copied.has(name)) return;
                const from = childPath(source, name), to = childPath(temporary, name);
                if (!inside(await resolvedPath(source), await resolvedPath(from)))
                    throw new RpcError('invalid_params', 'a source artifact escapes the module library');
                if (!await context.snapshots.isFile(from)) {
                    if (required) throw new RpcError('campaign_not_ready', 'the source artifact needed for the campaign seed is missing', { details: { artifact: name } });
                    return;
                }
                await mkdir(dirname(to), { recursive: true });
                // Reflinks where supported, independent files elsewhere. Never mutable hard links.
                await copyFile(from, to, constants.COPYFILE_FICLONE);
                copied.add(name);
            };
            // A published PDF generation promises its declared source, index and assets: a seed
            // missing one would be a silently broken private workspace. Legacy starters may
            // reference author images that never shipped, and the library already tolerates that,
            // so their seed copies what exists instead of refusing the whole book.
            const promised = Boolean(meta.reading_version);
            if (graph) {
                const graphFile = relative(source, await library.graphPath(id, meta));
                await copy(graphFile, true);
                await copy(join(dirname(graphFile), 'module-graph-manifest.json'), true);
                await copy(join(dirname(graphFile), 'assets.json'));
                for (const asset of await library.assets(id)) await copy(asset.path, promised);
                for (const node of array(graph.nodes)) await copy(row(node.properties).asset_ref, promised);
            }
            await copy(row(meta.source_document).path, promised);
            await copy(meta.index_file || 'sections.json', promised && Boolean(meta.index_file));
            await copy('assets.json');
            // Accepted guidance is keyed by source/scene/language, not by a running reader lease.
            for (const key of Object.keys(row(meta.character_guidance)))
                await copy(join('character-guidance', key, 'accepted.json'), true);
            const privateMeta = clone(meta);
            if (privateMeta.reading) privateMeta.reading.completed = {};
            privateMeta.campaign_scope = campaign;
            privateMeta.source_generation = meta.generation ?? 0;
            await writeJsonAtomic(join(temporary, 'deepen-queue.json'), []);
            await writeJsonAtomic(join(temporary, 'module.json'), privateMeta);
            // A previous interrupted seed is retained as evidence; no half-published directory
            // is ever a readable workspace. Unique staging directories are never reused.
            await mkdir(dirname(destination), { recursive: true });
            await rename(temporary, destination);
            return scoped;
        });
    });
}
