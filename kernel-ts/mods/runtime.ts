/** Immutable Mod packages and save-local activation; no gameplay executor is registered here. */
import { mkdir, rename, writeFile, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import { writeJsonAtomic } from '../fileio.js';
import { isJsonObject, orderedObject, PythonFloat } from '../json.js';
import { MOD_CAPABILITIES, buildVocabulary, packageFiles, packageDigest, manifestFrom, runtimePackageFiles, readModCatalog, activeMods, modProviders, effectiveMods,
  type ModCatalog, type UnavailablePackage } from '../read/mods.js';
import { array, row, values, entries, string, truth, clone, equal, sorted, type Row } from '../read/values.js';
import { readZipPackage } from './zip.js';

export const GAME_API = 'pipicoc.game.v1';
const invalid = (message: string): never => { throw new RpcError('invalid_params', message); };
const typeOf = (value: any): string => value instanceof PythonFloat ? 'float' : typeof value === 'bigint' ? 'int' : typeof value === 'number' ? Number.isInteger(value) && !Object.is(value, -0) ? 'int' : 'float' : typeof value;
const numeric = (value: any): boolean => ['int', 'float'].includes(typeOf(value));
const present = (value: Row, key: string, fallback: any): any => Object.hasOwn(value, key) ? value[key] : fallback;
const merged = (left: Row, right: Row): Row => orderedObject([...entries(left), ...entries(right)]);
const pythonType = (value: any): string => value == null ? 'NoneType' : Array.isArray(value) ? 'list' : isJsonObject(value) ? 'dict'
  : typeOf(value) === 'string' ? 'str' : typeOf(value) === 'boolean' ? 'bool' : typeOf(value);
function typedError(name: string, message: string): never { const error = new Error(message); error.name = name; throw error; }
function schemaContains(container: any, value: any): boolean {
  if (Array.isArray(container)) return container.some(item => equal(item, value));
  if (isJsonObject(container)) return typeof value === 'string' && Object.hasOwn(container, value);
  if (typeof container === 'string') {
    if (typeof value !== 'string') return typedError('TypeError', `'in <string>' requires string as left operand, not ${pythonType(value)}`);
    const text = Array.from(container), probe = Array.from(value);
    for (let i = 0; i <= text.length - probe.length; i++) if (probe.every((character, j) => character === text[i + j])) return true;
    return false;
  }
  return typedError('TypeError', `argument of type '${pythonType(container)}' is not a container or iterable`);
}
function schemaItem(schema: any, key: string): any {
  if (isJsonObject(schema)) return schema[key];
  return typedError('TypeError', Array.isArray(schema) ? 'list indices must be integers or slices, not str' : "string indices must be integers, not 'str'");
}
function schemaGet(schema: any, key: string, fallback: any): any {
  if (isJsonObject(schema)) return present(schema, key, fallback);
  return typedError('AttributeError', `'${pythonType(schema)}' object has no attribute 'get'`);
}
function atMost(left: any, right: any): boolean {
  if ((numeric(left) || typeof left === 'boolean') && (numeric(right) || typeof right === 'boolean')) return left <= right;
  return typedError('TypeError', `'<=' not supported between instances of '${pythonType(left)}' and '${pythonType(right)}'`);
}
function versionKey(value: any): bigint[] {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value)) return invalid('Mod version must be major.minor.patch');
  return value.split('.').map(BigInt);
}
function compareVersion(left: string, right: string): number {
  const a = versionKey(left), b = versionKey(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
export function topologicalOrder(preferred: string[], active: Row[]): string[] {
  const dependencies = new Map(active.map(mod => [mod.id, Object.keys(mod.dependencies)])), done: string[] = [], todo = [...preferred];
  while (todo.length) {
    const next = todo.find(name => (dependencies.get(name) ?? []).every(dependency => done.includes(dependency)));
    if (next === undefined) return invalid('Mod dependency order is cyclic or incomplete');
    done.push(next); todo.splice(todo.indexOf(next), 1);
  }
  return done;
}
export class ModRuntime {
  readonly root: string;
  /** Contract 41.2: what the most recent catalog read had to set aside. Diagnostic only -- never a
   *  decision input -- so that the one live path that has a campaign writer (`initializeCampaign`) can
   *  record the refusal without reading every package off disk a second time. The kernel executes requests
   *  one at a time (contract §1), so the read that set this is the read the caller is acting on. */
  unavailable: UnavailablePackage[] = [];
  constructor(readonly context: KernelContext) { this.root = join(context.stateRoot, 'mods'); }
  async catalog(): Promise<ModCatalog> { const catalog = await readModCatalog(this.context); this.unavailable = catalog.unavailable; return catalog; }
  /** Reads the catalog through `catalog()` rather than letting `activeMods` read it again: one disk read,
   *  and `unavailable` stays current on the path a live table actually takes. */
  async active(world: Row): Promise<Row[]> { return activeMods(this.context, world, await this.catalog()); }
  async providers(world: Row): Promise<Row> { return modProviders(await this.active(world)); }
  async effective(world: Row): Promise<Row[]> { return effectiveMods(await this.active(world)); }
  async editor(world: Row): Promise<Row> {
    const active = await this.active(world), provider = modProviders(active).document_editor.at(-1);
    return provider === 'core' ? {provider: 'core', renderer: 'plain'} : {provider, ...active.find(mod => mod.id === provider)!.contributes.document_editor};
  }
  async decisions(world: Row): Promise<Map<string, [string, Row]>> {
    const result = new Map<string, [string, Row]>();
    for (const mod of await this.active(world)) for (const check of array(mod.contributes.checks)) result.set(check.name, [mod.id, check]);
    return result;
  }
  async validateWorld(world: Row): Promise<void> { await this.active(world); }
  private latest(catalog: Map<string, Row>): Map<string, Row> {
    const latest = new Map<string, Row>();
    for (const mod of [...catalog.values()].sort((a, b) => compareVersion(a.version, b.version))) if (mod.compatible) latest.set(mod.id, mod);
    return latest;
  }
  /** Contract 28.2: the words the installed packages add to the reader's dossier ask. The rule and
   *  its ordering live in `read/mods.ts` -- the module store calls it on every reading claim, and
   *  reaching it through this class would pull the installer's zip reader into every bundle that
   *  reads a module. */
  buildVocabulary(): Promise<Row> { return buildVocabulary(this.context); }
  private async publish(target: string, files: ReadonlyMap<string, Buffer>): Promise<void> {
    const stage = join(this.root, 'imports', randomUUID().replaceAll('-', ''));
    await mkdir(stage, {recursive: true});
    for (const [name, bytes] of files) { const path = join(stage, name); await mkdir(dirname(path), {recursive: true}); await writeFile(path, bytes); }
    await mkdir(dirname(target), {recursive: true});
    await rename(stage, target);
  }
  async freeze(mod: Row): Promise<void> {
    const target = join(this.root, 'packages', mod.id, mod.version);
    if (await this.context.snapshots.pathExists(target)) {
      if (packageDigest(await packageFiles(target)) !== mod.digest) invalid('Locked Mod package bytes have changed');
      return;
    }
    await this.publish(target, mod.files);
  }
  async install(source: string): Promise<Row> {
    const expanded = source === '~' ? homedir() : source.startsWith('~/') ? join(homedir(), source.slice(2)) : source;
    const path = await realpath(resolve(expanded)).catch(() => resolve(expanded));
    const sourceFiles = await this.context.snapshots.isDirectory(path) ? await packageFiles(path) : await readZipPackage(path);
    const manifest = manifestFrom(sourceFiles), files = runtimePackageFiles(sourceFiles, manifest), digest = packageDigest(files), previous = (await this.catalog()).get(`${manifest.id}\0${manifest.version}`);
    if (previous) {
      if (previous.digest !== digest) return invalid('An installed Mod version cannot be replaced with different bytes');
      await this.freeze(previous); return {id: manifest.id, version: manifest.version, reused: true};
    }
    await this.publish(join(this.root, 'packages', manifest.id, manifest.version), files);
    return {id: manifest.id, version: manifest.version, digest};
  }
  async defaults(id: any = null, enabled: any = null): Promise<Row> {
    const path = join(this.root, 'defaults.json');
    const defaults = await this.context.snapshots.pathExists(path) ? clone(await this.context.snapshots.readJson(path)) as Row : {};
    if (id != null) {
      if (![...(await this.catalog()).values()].some(mod => mod.id === id) || typeof enabled !== 'boolean') return invalid('Choose an installed Mod and a boolean default');
      defaults[id] = enabled; await writeJsonAtomic(path, defaults);
    }
    return defaults;
  }
  async order(world: Row | null = null, catalog: Map<string, Row> | null = null): Promise<string[]> {
    const ids = new Set<string>([...[...(catalog ?? await this.catalog()).values()].map(mod => mod.id), ...Object.keys(row(row(world).mods).active ?? {})]);
    let preferred = row(row(world).mods).order;
    if (preferred == null) {
      const path = join(this.root, 'load-order.json');
      preferred = await this.context.snapshots.pathExists(path) ? await this.context.snapshots.readJson(path) : [];
    }
    return [...array(preferred).filter(name => ids.has(name)), ...sorted([...ids].filter(name => !array(preferred).includes(name)))];
  }
  lock(mod: Row, enabled: boolean, settings: Row | null = null): Row {
    return {version: mod.version, digest: mod.digest, state_version: mod.state_version, enabled, settings: clone(merged(mod.settings, settings ?? {}))};
  }
  async initializeWorld(world: Row): Promise<boolean> {
    if (Object.hasOwn(world, 'mods')) {
      const active = await this.active(world);
      if (!Object.hasOwn(world.mods, 'order')) { world.mods.order = topologicalOrder(await this.order(world), active); return true; }
      return false;
    }
    const latest = this.latest(await this.catalog()), defaults = await this.defaults();
    world.mods = {game_api: GAME_API, active: {}, state: {}, pending: {}};
    for (const [id, mod] of latest) { await this.freeze(mod); world.mods.active[id] = this.lock(mod, present(defaults, id, mod.default_enabled)); }
    world.mods.order = topologicalOrder(await this.order(world), [...latest.values()].filter(mod => truth(world.mods.active[mod.id].enabled)));
    await this.active(world); return true;
  }
  async reorder(world: Row | null, order: any, busy = false): Promise<void> {
    const expected = await this.order(world);
    if (!Array.isArray(order) || order.some(name => typeof name !== 'string') || new Set(order).size !== order.length || order.length !== new Set(expected).size || expected.some(name => !order.includes(name)))
      return invalid('Load order must contain every installed Mod id exactly once');
    if (world === null) {
      const latest = this.latest(await this.catalog()), defaults = await this.defaults();
      const enabled = [...latest.values()].filter(mod => truth(present(defaults, mod.id, mod.default_enabled)));
      if (!equal(topologicalOrder(order, enabled), order)) return invalid('Dependencies must load before the Mods that require them');
      await writeJsonAtomic(join(this.root, 'load-order.json'), order); return;
    }
    const staged = clone(world); staged.mods.order = [...order]; await this.active(staged);
    if (busy) world.mods.pending_order = [...order];
    else { world.mods.order = [...order]; delete world.mods.pending_order; }
  }
  /** Applies one lock change. The result names the keys an inherited lock had to retire across a version change
   *  (§26, 2026-09-10): a request that carries no `settings` keeps only the keys the target version declares, so a
   *  version that dropped a setting is still reachable from the panel's version-only Update; a request that names
   *  an unknown key is refused as before. */
  async configure(world: Row, change: Row, busy: boolean): Promise<{retired: string[], from: string | null, to: string}> {
    await this.initializeWorld(world);
    const id = change.id, old = row(world.mods.active[id]), version = present(change, 'version', old.version);
    const mod = typeof id === 'string' && typeof version === 'string' ? (await this.catalog()).get(`${id}\0${version}`) : null;
    if (!mod || !mod.compatible) return invalid('Choose a compatible installed Mod version');
    await this.freeze(mod);
    const enabled = present(change, 'enabled', present(old, 'enabled', true));
    const carried = present(old, 'settings', mod.settings), inherited = !Object.hasOwn(change, 'settings') && typeof old.version === 'string' && old.version !== version && isJsonObject(carried);
    const retired = inherited ? Object.keys(carried).filter(key => !Object.hasOwn(mod.settings, key)) : [];
    const requested = Object.hasOwn(change, 'settings') ? change.settings : inherited ? orderedObject(entries(carried).filter(([key]) => Object.hasOwn(mod.settings, key))) : carried;
    if (typeof enabled !== 'boolean' || !isJsonObject(requested) || Object.keys(requested).some(key => !Object.hasOwn(mod.settings, key))) return invalid('Invalid Mod enable state or unknown setting');
    const outcome = {retired, from: typeof old.version === 'string' ? old.version : null, to: version as string};
    const settings = merged(mod.settings, requested);
    for (const [key, value] of entries(settings)) {
      const expected = mod.settings[key], schema = present(row(mod.settings_schema), key, {});
      if (!['string', 'boolean', 'int', 'float'].includes(typeOf(expected)) || typeOf(value) !== typeOf(expected)) return invalid(`Setting ${key} has an unsupported type`);
      if (schemaContains(schema, 'enum') && !schemaContains(schemaItem(schema, 'enum'), value)) return invalid(`Setting ${key} must be one of its declared options`);
      if (numeric(value)) {
        if (!(atMost(schemaGet(schema, 'minimum', -Infinity), value) && atMost(value, schemaGet(schema, 'maximum', Infinity)))) return invalid(`Setting ${key} is outside its declared range`);
      }
    }
    const staged = clone(world); staged.mods.active[id] = this.lock(mod, enabled, settings); staged.mods.order = await this.order(staged); await this.active(staged);
    if (busy) { world.mods.pending[id] = {id, version, enabled, settings}; return outcome; }
    let state = clone(present(staged.mods.state, id, {}));
    let before = BigInt(present(old, 'state_version', mod.state_version));
    const after = BigInt(mod.state_version);
    while (before !== after) {
      const migration = array(mod.migrations).find(item => equal(item.from, before) && equal(item.to, before + 1n));
      if (!migration) return invalid(`No state migration from ${before} to ${after} for ${id}`);
      for (const operation of array(migration.operations)) {
        if (operation.op === 'default' && typeof operation.key === 'string') { if (!Object.hasOwn(state, operation.key)) state = orderedObject([...entries(state), [operation.key, clone(operation.value ?? null)]]); }
        else if (operation.op === 'rename' && typeof operation.from === 'string' && typeof operation.to === 'string') {
          if (Object.hasOwn(state, operation.from)) {
            if (Object.hasOwn(state, operation.to)) return invalid('Mod migration would overwrite an existing field');
            state = orderedObject([...entries(state).filter(([key]) => key !== operation.from), [operation.to, state[operation.from]]]);
          }
        } else return invalid('Unsupported Mod migration operation');
      }
      before++;
    }
    staged.mods.state[id] = state; delete staged.mods.pending[id]; world.mods = staged.mods;
    return outcome;
  }
  async applyPending(world: Row): Promise<boolean> {
    const changes = values(row(row(world.mods).pending)), order = row(world.mods).pending_order, staged = clone(world);
    if (order != null) await this.reorder(staged, order);
    for (const change of changes) await this.configure(staged, change, false);
    if (changes.length || order != null) world.mods = staged.mods;
    return Boolean(changes.length) || order != null;
  }
  async view(world: Row | null = null): Promise<Row> {
    const locks = row(row(world).mods), defaults = await this.defaults(), mods: Row[] = [];
    const rows = [...(await this.catalog()).values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : compareVersion(a.version, b.version));
    for (const mod of rows) mods.push({
      ...Object.fromEntries(['id', 'version', 'name', 'description', 'author', 'compatible', 'requires', 'dependencies', 'conflicts'].map(key => [key, mod[key]])),
      settings: mod.compatible ? mod.settings : {}, default_enabled: present(defaults, mod.id, mod.default_enabled),
      active: row(locks.active)[mod.id] ?? null, pending: row(locks.pending)[mod.id] ?? null,
      settings_schema: mod.compatible ? mod.settings_schema ?? {} : {},
    });
    return {game_api: GAME_API, capabilities: sorted(MOD_CAPABILITIES), mods, order: await this.order(world), pending_order: locks.pending_order ?? null,
      // Contract 41.2: a package that refused its own bytes is listed here rather than dropped, so the
      // panel and the operator see the gap instead of a package that quietly stopped existing.
      unavailable: this.unavailable.map(entry => ({...entry})),
      providers: truth(world) && truth(locks) ? modProviders(await this.active(world!)) : {}};
  }
}
