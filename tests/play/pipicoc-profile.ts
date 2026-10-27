/**
 * The owner's PipiCOC plugin configuration, for live tables (owner, 2026-10-27: "测试必须带上所有插件").
 *
 * The source launcher mounts every plugin the product ships (runtime/deployment.mjs sessionExtensionGroups), but the App also
 * hands each enabled plugin its settings (PIPIUI_EXT_SETTINGS_<ID>) and its vault secrets (spawn-assembly.ts
 * appendRegisteredExtensions). Without them a mounted plugin is inert: Jev without its key made 0 calls in every live table
 * before 1026m. This reads the same profile the App reads and returns that environment, or throws naming what is missing.
 * Secret values only ever go into the returned env; nothing here prints them.
 */
import {createDecipheriv} from 'node:crypto';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

type Row = Record<string, any>;
export const DEFAULT_PROFILE = join(homedir(), 'Library/Application Support/Pipi/pipicoc/pi-coc/agent');
/** Plugins the App owns itself rather than mounting into the Keeper session. */
const NOT_SESSION_PLUGINS = new Set(['coc-keeper', 'remote-control']);
/** A plugin the owner turned on must reach the table with what it needs; these it cannot run without. */
const REQUIRED_SECRETS: Readonly<Record<string, readonly string[]>> = {jev: ['ext.jev.apiKey']};

export interface ProfilePlugin {id: string; enabled: boolean; settings: string[]; secrets: string[]; mount: 'build' | 'profile'}
export interface ProfileEnv {env: Record<string, string>; plugins: ProfilePlugin[]; profile: string; extraMounts: string[]; thinking: string | null; model: string | null}

const readJson = (path: string): Row => JSON.parse(readFileSync(path, 'utf8'));
const settingsEnvName = (id: string) => `PIPIUI_EXT_SETTINGS_${id.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || 'EXT'}`;
/** Electron/packages/pi-backend/src/extension-settings.ts secretEnvName. */
export function secretEnvName(key: string): string {
    const raw = key.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
    const name = raw.length === 0 ? 'EXT_SECRET' : raw.slice(0, 64);
    return /^[A-Z]/.test(name) ? name : `E${name.slice(0, 63)}`;
}
/** Electron/packages/pi-backend/src/secret-vault.ts readPersistedVault: aes-256-gcm under the 32-byte key file. */
function vaultSecrets(profile: string): Map<string, string> {
    const file = join(profile, 'secret-vault.json'), keyFile = join(profile, 'secret-vault.key');
    if (!existsSync(file) || !existsSync(keyFile)) return new Map();
    const envelope = readJson(file), key = readFileSync(keyFile);
    if (envelope.version !== 2 || envelope.algorithm !== 'aes-256-gcm' || key.length !== 32) throw new Error('PipiCOC secret vault has an unknown shape');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const doc = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
    return new Map((doc.secrets ?? []).filter((s: Row) => typeof s?.name === 'string' && typeof s?.value === 'string').map((s: Row) => [s.name, s.value]));
}

/** `mounted`: the plugin ids the launcher mounts from this repo's build (build/extensions/<id>). */
export function pipicocProfileEnv(mounted: ReadonlySet<string>, profile = process.env.PI_COC_PROFILE_DIR || DEFAULT_PROFILE): ProfileEnv {
    if (!existsSync(join(profile, 'pipiui-settings.json'))) throw new Error(`PipiCOC profile not found at ${profile}; live tables load the owner's plugins from it (set PI_COC_PROFILE_DIR)`);
    const all = readJson(join(profile, 'pipiui-settings.json')), stored = all.extensions ?? {}, vault = vaultSecrets(profile);
    // The session's own model and thinking level, and the product pack's lane and author settings, as the App spawns them.
    const selection = all.manualModelSelection, model = selection?.provider && selection?.modelId ? `${selection.provider}/${selection.modelId}` : null;
    const thinking = typeof all.manualThinkingLevel === 'string' ? all.manualThinkingLevel : null;
    const env: Record<string, string> = {}, plugins: ProfilePlugin[] = [], problems: string[] = [], extraMounts: string[] = [];
    const dirs = existsSync(join(profile, 'extensions')) ? readdirSync(join(profile, 'extensions')) : [];
    for (const id of dirs.sort()) {
        const manifestPath = join(profile, 'extensions', id, 'pipiui-extension.json');
        if (NOT_SESSION_PLUGINS.has(id) || !existsSync(manifestPath)) continue;
        const manifest = readJson(manifestPath), slot = stored[id];
        const enabled = typeof slot === 'boolean' ? slot : typeof slot?.enabled === 'boolean' ? slot.enabled : manifest.defaultEnabled === true;
        if (!enabled || !manifest.agent?.extension) continue;
        const schema: Row = manifest.app?.settings?.schema?.properties ?? {};
        const settings: Row = {...(slot?.settings ?? {})};
        const secretKeys = Object.entries(schema).filter(([, spec]) => (spec as Row)?.format === 'secret').map(([key]) => key);
        const secrets: string[] = [];
        for (const key of secretKeys) {
            delete settings[key];
            const value = vault.get(key);
            if (value) { env[secretEnvName(key)] = value; secrets.push(key); }
        }
        for (const key of REQUIRED_SECRETS[id] ?? []) if (!secrets.includes(key)) problems.push(`${id} is enabled in PipiCOC but its ${key} is not in the vault`);
        env[settingsEnvName(id)] = JSON.stringify(settings);
        // A plugin the App mounts from the profile that this build's launcher does not (openai-fast) is mounted from there too.
        const fromBuild = mounted.has(id), entry = join(profile, 'extensions', id, String(manifest.agent.extension));
        if (!fromBuild) { if (existsSync(entry)) extraMounts.push(entry); else problems.push(`${id} is enabled in PipiCOC but neither this build nor the profile has its agent entry`); }
        plugins.push({id, enabled, settings: Object.keys(settings), secrets, mount: fromBuild ? 'build' : 'profile'});
    }
    if (!plugins.some(plugin => plugin.id === 'jev')) problems.push('jev is not enabled in PipiCOC; live tables run with Jev');
    if (problems.length) throw new Error(`PipiCOC plugins are not all loaded: ${problems.join('; ')}`);
    if (plugins.length) env.PIPIUI_MOUNTED_EXTENSIONS = plugins.map(plugin => plugin.id).join(',');
    if (stored['coc-keeper']?.settings) env[settingsEnvName('coc-keeper')] = JSON.stringify(stored['coc-keeper'].settings);
    return {env, plugins, profile, extraMounts, thinking, model};
}
