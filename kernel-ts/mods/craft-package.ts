/** Declarative craft assets; no provider, prose judgement or world-writing authority. */
import {RpcError} from '../errors.js';
import {row, array, string, type Row} from '../read/values.js';
import {CraftCatalog} from '../../runtime/craft/catalog.js';

export const CRAFT_REFERENCE_CAPABILITY = 'context.craft-reference.v1';
export const CRAFT_REFERENCE_V2_CAPABILITY = 'context.craft-reference.v2';
const invalid = (message: string): never => {throw new RpcError('invalid_params', message);};
const jsonFile = (files: ReadonlyMap<string, Uint8Array>, path: string): unknown => {
    const bytes = files.get(path);
    if (!bytes) return invalid('Craft reference file is missing');
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
};
const referencePath = (manifest: Row, files: ReadonlyMap<string, Uint8Array>, value: unknown): string => {
    if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\')
        || value.split('/').some(part => !part || part === '.' || part === '..') || !value.endsWith('.json')
        || !array(manifest.package_files).includes(value) || !files.has(value))
        return invalid('Craft reference paths must name declared package JSON files');
    return value;
};
export function craftDescriptor(manifest: Row, files: ReadonlyMap<string, Uint8Array>): {catalog: string; candidates: string} {
    const path = referencePath(manifest, files, row(manifest.contributes).craft_reference);
    let value: unknown;
    try {value = jsonFile(files, path);} catch {return invalid('Craft reference descriptor must be valid JSON');}
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Invalid craft reference descriptor');
    const descriptor = value as Row;
    if (Object.keys(descriptor).sort().join(',') !== 'candidates,catalog,schema_version' || descriptor.schema_version !== 1)
        return invalid('Invalid craft reference descriptor schema');
    return {catalog: referencePath(manifest, files, descriptor.catalog), candidates: referencePath(manifest, files, descriptor.candidates)};
}
export function validateCraftContribution(manifest: Row, files: ReadonlyMap<string, Uint8Array>): void {
    const present = Object.hasOwn(row(manifest.contributes), 'craft_reference');
    if (!present) return;
    const v2 = array(manifest.requires).includes(CRAFT_REFERENCE_V2_CAPABILITY);
    if (!v2 && !array(manifest.requires).includes(CRAFT_REFERENCE_CAPABILITY)) invalid('Craft references require context.craft-reference.v1 or v2');
    const mode = row(manifest.settings).reference_mode;
    if (!['off', 'jev'].includes(mode) || JSON.stringify(row(row(manifest.settings_schema).reference_mode).enum) !== '["off","jev"]')
        invalid('Craft reference mode must declare off/jev and use one of those defaults');
    if (mode === 'jev' && !v2) invalid('Default-on craft references require context.craft-reference.v2');
    craftDescriptor(manifest, files);
}
export function craftReferenceProvider(active: Row[]): Row | undefined {
    return active.filter(mod => row(mod.contributes).craft_reference).at(-1);
}
export function craftProviderIdentity(mod: Row): Row {
    return {mod: string(mod.id), version: string(mod.version), digest: string(mod.digest)};
}
export function craftReferenceMetadata(active: Row[], world: Row): Row | undefined {
    const mod = craftReferenceProvider(active);
    if (!mod) return undefined;
    return {provider: {mod: string(mod.id), version: string(mod.version)},
        mode: row(row(row(row(world.mods).active)[mod.id]).settings).reference_mode ?? 'off'};
}
const catalogs = new Map<string, CraftCatalog>();
export function readCraftCatalog(mod: Row): CraftCatalog {
    const key = `${mod.id}:${mod.version}:${mod.digest}`;
    const held = catalogs.get(key);
    if (held) return held;
    const files = mod.files as ReadonlyMap<string, Uint8Array>, descriptor = craftDescriptor(mod, files);
    const catalog = new CraftCatalog(jsonFile(files, descriptor.catalog), jsonFile(files, descriptor.candidates));
    if (catalogs.size >= 8) catalogs.delete(catalogs.keys().next().value!);
    catalogs.set(key, catalog);
    return catalog;
}
