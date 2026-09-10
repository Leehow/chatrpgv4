/** Verify a published graph binding before any read or merge consumes its bytes. */
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import { freezeJson, jsonDigest, parsePythonJson, type JsonValue } from '../json.js';
import { integer, number, row, type Row } from './values.js';

export async function readPublishedGraph(context: KernelContext, path: string, metadata: Row, moduleId: string): Promise<{raw: Row; digest: string}> {
    const published = Object.keys(metadata).length > 0;
    const invalid = (component: string, expected?: JsonValue, actual?: JsonValue): never => {
        throw new RpcError('campaign_not_ready', `module ${moduleId} has inconsistent published graph data`, {
            fix: 'Preserve this generation and repair it through a reviewed source publication; do not edit stored hashes to accept changed bytes.',
            details: {reason: 'module_graph_integrity', module: moduleId, generation: metadata.generation ?? null,
                component, ...(expected === undefined ? {} : {expected}), ...(actual === undefined ? {} : {actual})},
        });
    };
    const contained = async (candidate: string, component: string): Promise<string> => {
        const base = await realpath(join(context.stateRoot, 'modules', moduleId));
        const actual = await realpath(candidate).catch(() => resolve(candidate)), part = relative(base, actual);
        if (part === '..' || part.startsWith('..' + sep) || resolve(base, part) !== actual) invalid(component);
        return actual;
    };
    if (published) path = await contained(path, 'graph_path');
    let bytes: Buffer;
    try { bytes = await readFile(path); }
    catch (error) {
        if (published) invalid('graph_unreadable');
        throw error;
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (published) {
        if (typeof metadata.graph_digest !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.graph_digest))
            invalid('metadata_digest');
        if (digest !== metadata.graph_digest) invalid('graph_digest', metadata.graph_digest, digest);
    }
    let raw: Row;
    try {
        const value = parsePythonJson(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('graph is not an object');
        raw = row(freezeJson(value));
    } catch (error) {
        if (published) invalid('graph_json');
        throw error;
    }
    if (published) {
        let manifest: Row = {};
        const manifestPath = await contained(join(dirname(path), 'module-graph-manifest.json'), 'manifest_path');
        try { manifest = row(await context.snapshots.readJson(manifestPath)); }
        catch { invalid('manifest_unreadable'); }
        if (manifest.contract_id !== 'coc.module-graph-manifest.v1' || manifest.schema_version !== 1)
            invalid('manifest_contract');
        // Bundled legacy graphs use the node-prefixed spelling for their root module id.
        if (metadata.id !== moduleId || manifest.module_id !== moduleId || ![moduleId, `module-${moduleId}`].includes(raw.module_id))
            invalid('module_identity', moduleId, {metadata: metadata.id ?? null, manifest: manifest.module_id ?? null, graph: raw.module_id ?? null});
        if (!integer(metadata.generation) || !integer(manifest.generation) || number(metadata.generation) < 1 || number(manifest.generation) !== number(metadata.generation))
            invalid('generation', metadata.generation, manifest.generation);
        if (manifest.graph_contract_id !== raw.contract_id) invalid('graph_contract', manifest.graph_contract_id, raw.contract_id);
        const canonical = jsonDigest(raw);
        if (canonical !== manifest.graph_content_digest) invalid('manifest_digest', manifest.graph_content_digest, canonical);
    }
    return {raw, digest};
}
