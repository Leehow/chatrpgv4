/** Durable reference packets, isolated from both live context and the expendable query cache. */
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readdir, readFile, writeFile, link, rm, stat} from 'node:fs/promises';
import {join} from 'node:path';
import type {ScopeBinding, Json} from './jev/contracts.ts';
import type {HistoryMaterial} from './historical-reference.ts';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const namespace = (scope: ScopeBinding) => [scope.campaign ?? scope.owner, scope.worldline ?? 'main', scope.loop ?? 0];
export const materialIdentity = (row: HistoryMaterial) => digest([row.url, row.title, row.excerpts, row.published_at]);
export interface SavedReference extends HistoryMaterial {
  name: string; queries: string[]; saved_at: string; prior_applicability: string | null;
  price_anchor: boolean;
}
export interface ReferenceInventory {entries: SavedReference[]; unreadable: number}
interface ReferencePacket {
  version: 1; scope: ReturnType<typeof namespace>; query: string; objective: string | null; context: Json;
  saved_at: string; materials: HistoryMaterial[]; selection: Record<string, string>;
  origin: 'library' | 'query_cache' | 'web';
  price_anchors?: string[];
}
function validMaterial(row: any): row is HistoryMaterial {
  if (!row || typeof row.title !== 'string' || typeof row.url !== 'string' || typeof row.retrieved_at !== 'string'
    || row.title.length > 512 || row.url.length > 2048 || row.retrieved_at.length > 64
    || !(row.published_at === null || typeof row.published_at === 'string') || !Array.isArray(row.excerpts)
    || row.excerpts.length < 1 || row.excerpts.length > 3
    || !row.excerpts.every((part: unknown) => typeof part === 'string' && part.trim() && Buffer.byteLength(part) <= 6000)) return false;
  try {const url = new URL(row.url); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;} catch {return false;}
}
export class HistoricalReferenceLibrary {
  readonly home: string;
  constructor(home: string) {this.home = home;}
  directory(scope: ScopeBinding): string {return join(this.home, '.coc', 'reference-library', digest(namespace(scope)));}
  async save(input: {scope: ScopeBinding; query: string; objective?: string; context: Json}, materials: HistoryMaterial[],
    selected: Array<HistoryMaterial & {applicability: string; price_anchor?: boolean}> = [], options?: {origin?: ReferencePacket['origin']; decisions?: Record<string, string>}): Promise<void> {
    if (!materials.length) return;
    const packet: ReferencePacket = {version: 1, scope: namespace(input.scope), query: input.query, objective: input.objective ?? null,
      context: input.context, saved_at: new Date().toISOString(), materials,
      origin: options?.origin ?? 'web',
      selection: options?.decisions ?? Object.fromEntries(selected.map(row => [materialIdentity(row), row.applicability])),
      price_anchors: selected.filter(row => row.price_anchor === true).map(materialIdentity)};
    const directory = this.directory(input.scope);
    const key = digest([packet.scope, packet.query, packet.objective, packet.context, packet.origin, materials.map(materialIdentity), packet.selection, packet.price_anchors]);
    const path = join(directory, `${key}.json`), temporary = `${path}.${randomUUID()}.tmp`;
    await mkdir(directory, {recursive: true});
    try {
      await writeFile(temporary, JSON.stringify(packet), {mode: 0o600});
      try {await link(temporary, path);} catch (error) {if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;}
    } finally {await rm(temporary, {force: true}).catch(() => {});}
  }
  async inventory(scope: ScopeBinding): Promise<ReferenceInventory> {
    const directory = this.directory(scope); let files: string[];
    try {files = (await readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));}
    catch (error) {return {entries: [], unreadable: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 0 : 1};}
    const packets: ReferencePacket[] = []; let unreadable = 0;
    for (const file of files) {
      try {
        const path = join(directory, file);
        if ((await stat(path)).size > 262144) {unreadable++; continue;}
        const packet = JSON.parse(await readFile(path, 'utf8'));
        if (packet?.version !== 1 || digest(packet.scope) !== digest(namespace(scope)) || typeof packet.query !== 'string'
          || typeof packet.saved_at !== 'string' || !Array.isArray(packet.materials) || packet.materials.length > 10
          || !packet.materials.every(validMaterial)
          || (packet.price_anchors !== undefined && (!Array.isArray(packet.price_anchors)
            || !packet.price_anchors.every((id: unknown) => typeof id === 'string' && packet.materials.some((row: HistoryMaterial) => materialIdentity(row) === id))))) {unreadable++; continue;}
        packets.push(packet);
      } catch {unreadable++;}
    }
    packets.sort((a, b) => a.saved_at.localeCompare(b.saved_at) || a.query.localeCompare(b.query));
    const entries = new Map<string, SavedReference>();
    for (const packet of packets) for (const row of packet.materials) {
      const id = materialIdentity(row), prior = entries.get(id);
      if (prior) {
        if (!prior.queries.includes(packet.query)) prior.queries.push(packet.query);
        if (packet.selection?.[id]) prior.prior_applicability = packet.selection[id];
        if (packet.price_anchors?.includes(id)) prior.price_anchor = true;
      } else entries.set(id, {...row, name: `${row.title || 'Saved historical reference'} (${row.url}; ${row.retrieved_at})`,
        queries: [packet.query], saved_at: packet.saved_at, prior_applicability: packet.selection?.[id] ?? null,
        price_anchor: packet.price_anchors?.includes(id) ?? false});
    }
    return {entries: [...entries.values()], unreadable};
  }
}
