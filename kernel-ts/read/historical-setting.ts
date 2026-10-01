/** Authored setting evidence persists after the one-time module briefing. No inference or networking. */
import {join} from 'node:path';
import type {CampaignSnapshot, LoadedModule} from './campaign.js';
import {moduleDeclaration, recordOf, type ModuleGraph} from './module-graph.js';
import {row, type Row} from './values.js';
import {scopedModuleRoot} from '../modules/campaign-scope.js';

function sourceText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
}
function bounded(value: string | null, bytes: number): string | null {
    if (value === null || Buffer.byteLength(JSON.stringify(value)) - 2 <= bytes) return value;
    let output = '', size = 0;
    for (const char of value) {
        const width = Buffer.byteLength(JSON.stringify(char)) - 2;
        if (size + width > bytes - 3) break;
        output += char; size += width;
    }
    return output + '...';
}
export function projectHistoricalSetting(graph: ModuleGraph, meta: Row, publicFields: Row | null): Row {
    const declaration = moduleDeclaration(graph.moduleNode);
    const openings = graph.scenes().filter(scene => recordOf(scene).is_start === true);
    const entrance = meta.opening_scene ? graph.scene(meta.opening_scene) : openings.length === 1 ? openings[0] : null;
    const field = (key: string) => row(publicFields?.[key]).status === 'value' ? sourceText(row(publicFields?.[key]).text) : null;
    const authored = {
        era: field('era') ?? sourceText(row(row(entrance?.properties).investigator_setup).era) ?? sourceText(declaration.era),
        starting_place: field('starting_place') ?? sourceText(declaration.starting_place) ?? sourceText(entrance?.name),
        background: field('public_premise') ?? sourceText(graph.moduleNode?.summary),
    };
    const clipped = {era: bounded(authored.era, 256), starting_place: bounded(authored.starting_place, 384), background: bounded(authored.background, 1152)};
    return {...clipped, source: publicFields ? 'public_guidance' : 'authored_module',
        truncated: Object.keys(authored).some(key => authored[key as keyof typeof authored] !== clipped[key as keyof typeof clipped])};
}
export async function historicalSetting(campaign: CampaignSnapshot, module: LoadedModule): Promise<Row> {
    const {context, meta} = campaign, accepted = row(module.meta.character_guidance);
    let key = meta.guidance_key;
    // Older/setup-adjudicated campaigns omit the key but retain a closed entrance/language binding.
    if (!key && meta.opening_scene) {
        const entrance = module.graph.scene(meta.opening_scene).node_id;
        const matching = Object.entries(accepted).filter(([, value]) => {
            const binding = row(value);
            if (binding.play_language !== meta.play_language) return false;
            try { return module.graph.scene(binding.scene).node_id === entrance; } catch { return false; }
        });
        if (matching.length === 1) key = matching[0][0];
    }
    let fields: Row | null = null;
    if (typeof key === 'string' && /^[a-f0-9]{64}$/.test(key) && accepted[key]) {
        const root = await scopedModuleRoot(context, campaign.id, module.graph.moduleId)
            ?? context.moduleRoot ?? join(context.stateRoot, 'modules');
        const path = join(root, module.graph.moduleId, 'character-guidance', key, 'public.json');
        if (await context.snapshots.pathExists(path)) {
            const guide = row(await context.snapshots.readJson(path));
            if (guide.approved === true && guide.fingerprint === key && guide.source_sha256 === module.meta.file_sha256)
                fields = row(guide.fields);
        }
    }
    return projectHistoricalSetting(module.graph, meta, fields);
}
