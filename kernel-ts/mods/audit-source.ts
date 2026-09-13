/** Source evidence for the existing Mod audit; semantics remain the reviewer's responsibility. */
import {lstat, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {KernelContext} from '../context.js';
import type {CampaignWritePort} from '../transactions.js';
import {CampaignSnapshot, type LoadedModule} from '../read/campaign.js';
import {pinnedSource} from '../adaptation/source.js';
import {isJsonObject, jsonDigest, storedJson} from '../json.js';
import {RpcError} from '../errors.js';
import {array, row, string, type Row} from '../read/values.js';
import {continuityAuditContext} from './continuity-audit.js';

export const SOURCE_AUDIT = 'audit.source.v1';
export async function auditSourceEvidence(context: KernelContext, campaign: Pick<CampaignWritePort, 'id'>, module: LoadedModule, world: Row, turn: Row, party: Row[], continuity = false, preparationWait: Row | null = null, rebindingRefused: Row | null = null) {
    const original = module.adapted ? await pinnedSource(context, row(world.adaptation).source) : module;
    const source = (loaded: LoadedModule) => ({graph: loaded.graph.raw,
        material: [...loaded.graph.nodes.values()].map(node => ({name: loaded.graph.handle(node), status: loaded.material(node.node_id)}))});
    const snapshot = new CampaignSnapshot(context, campaign.id);
    const records = (await snapshot.files('turns')).filter(record => record.closed_by === 'narrate' && record.commit);
    const current = {turn: turn.turn, state: turn.state, player_text: turn.player_text ?? null,
        receipts: turn.receipts ?? [], pending_choice: turn.pending_choice ?? null};
    const files: Row = {
        'original.json': source(original), 'effective.json': source(module), 'world.json': world,
        'current.json': {party, turn: current},
        'history.json': records.map(record => ({turn: record.turn, player_text: record.player_text ?? null,
            rendered_text: record.rendered_text ?? '', receipts: record.receipts ?? [], warnings: record.warnings ?? [], world: record.world ?? null})),
        'handouts.json': Object.fromEntries(await snapshot.handoutTexts([...records.flatMap(record => array(record.receipts)), ...array(turn.receipts)])),
        'notes.json': await snapshot.log('notes.jsonl'), 'memory.json': await snapshot.log('memory/candidates.jsonl')
    };
    if (continuity) {
        files['context.json'] = continuityAuditContext(module.graph, world, turn, party, files);
        if (preparationWait && ['source', 'adaptation'].includes(string(preparationWait.kind)))
            row(files['context.json']).preparation_wait = {kind: preparationWait.kind,
                ...(typeof preparationWait.name === 'string' && preparationWait.name ? {name: preparationWait.name} : {})};
        // Contract §37.6: the independent source review refused the placement this reentry needs. That is
        // host-owned structural state, not prose, and it is what makes an authority_unavailable defer lawful.
        const refusedName = typeof rebindingRefused?.name === 'string' ? rebindingRefused.name : '';
        const refusedSummary = typeof rebindingRefused?.summary === 'string' ? rebindingRefused.summary : '';
        if (refusedName)
            row(files['context.json']).rebinding_refused = {name: refusedName, ...(refusedSummary ? {summary: refusedSummary} : {})};
    }
    return {files, binding: jsonDigest({files, current, party}), descriptor: {schema: 1, files: Object.keys(files),
        current_input: current.player_text, pending_choice: current.pending_choice,
        authority: continuity
            ? 'Preserve established campaign continuity and player choices. Compatible new fiction is allowed without a literal source quote. Recaps must faithfully report prior delivery; NPC assertions and player hypotheses retain attribution. Corrections supersede earlier claims. Kernel receipts remain authoritative for actions and resources.'
            : 'Original source is immutable. Effective source includes only accepted campaign adaptations. History records what was delivered, not proof that prior improvisation was true. Notes and memory never establish source facts. Inspect relevant complete evidence and distinguish unknown causes from invented explanations.'}};
}

export async function writeAuditSources(root: string, files: Row): Promise<void> {
    for (const [name, value] of Object.entries(files)) {
        try { await writeFile(join(root, name), storedJson(value), {flag: 'wx', mode: 0o400}); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    await verifyAuditSources(root, files);
}
export async function verifyAuditSources(root: string, files: Row): Promise<void> {
    for (const [name, value] of Object.entries(files)) {
        const path = join(root, name);
        let valid = false;
        try { valid = (await lstat(path)).isFile() && await readFile(path, 'utf8') === storedJson(value); }
        catch { /* Missing retained evidence is not approval. */ }
        if (!valid) throw new RpcError('needs', 'The retained source-audit evidence changed or is unavailable',
            {details: {reason: 'mod_audit_evidence', file: name}, fix: 'Keep this draft unpublished; inspect the retained audit evidence'});
    }
}

const VERDICTS = ['supported', 'unsupported', 'unclear'];
const words = (value: unknown, max = 2000): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
const shape = (value: unknown, keys: string[]): value is Row => isJsonObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function strings(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
    return [];
}
export function validateSourceReview(value: unknown, text: string, files: Row): void {
    const bad = (message: string): never => { throw new RpcError('invalid_params', message); };
    if (!shape(value, ['verdict', 'summary', 'claims']) || !VERDICTS.includes(value.verdict) || !words(value.summary)
        || !Array.isArray(value.claims) || value.claims.length > 24) return bad('Source audit requires verdict, summary and at most 24 checked claims');
    const evidenceStrings = new Map<string, string[]>();
    for (const claim of value.claims) {
        if (!shape(claim, ['quote', 'verdict', 'reason', 'evidence']) || !words(claim.quote) || !text.includes(claim.quote)
            || !VERDICTS.includes(claim.verdict) || !words(claim.reason) || !Array.isArray(claim.evidence) || claim.evidence.length > 3)
            return bad('Each source claim needs an exact draft quote, verdict, reason and bounded evidence');
        if (claim.verdict === 'supported' && !claim.evidence.length) return bad('A supported source claim needs a real evidence excerpt');
        for (const evidence of claim.evidence) {
            if (!shape(evidence, ['file', 'quote']) || typeof evidence.file !== 'string' || !Object.hasOwn(files, evidence.file) || !words(evidence.quote, 1000))
                return bad('Source evidence must cite a supplied file and a nonempty exact excerpt');
            if (!evidenceStrings.has(evidence.file)) evidenceStrings.set(evidence.file, strings(files[evidence.file]));
            if (!evidenceStrings.get(evidence.file)!.some(source => source.includes(evidence.quote))) return bad('A cited source excerpt is absent from its evidence file');
        }
        if (value.verdict === 'supported' && claim.verdict !== 'supported') return bad('A supported source review cannot contain unsupported or unclear claims');
    }
}
