/**
 * Contract §194.5 item 2 (owner ruling 2026-10-08): a cast person who is a real public figure of the world outside the story,
 * mentioned as such, is not untold.
 *
 * Real table TR-F2 (Cold Harvest, turn 2): the letter says the workers toil in Stalin's name, and the cast lists him as a person
 * of the book (§177.16 asked the reader to leave such people out, and it did not), so §177.11's gate refused the name and the
 * Keeper wrote "the Soviet leader" instead.
 *
 * Whether someone is such a figure is a semantic question: the host asks Jev one question per stored row, from the row's own
 * entry (§194.4's cut), and sends the verdicts here. `cast.public.job` lists the rows with no verdict for what they say now;
 * `cast.public.submit` keeps the verdicts beside the table that serves the checks (`cast-public.json`, `readCastPublic`), each
 * bound to its row's digest, so the cast's every reader -- the untold roster, the gate, the rename and the document tells --
 * reads the same verdict (`CastPerson.public`). No list of names: a row with no verdict, or a verdict below the host's bar,
 * stays untold.
 */
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import type { HandlerGroup } from '../handlers.js';
import { writeJsonAtomic } from '../fileio.js';
import { isJsonObject, jsonDigest, type ReadonlyJson } from '../json.js';
import { withExclusiveLock } from '../locks.js';
import { loadCampaignModule } from '../read/campaign.js';
import { CAST_PUBLIC_FILE, bookCast, castRowDigest, moduleSourceSha, printedNames, servedCast } from '../read/cast.js';
import { array, number, numeric, repr, row, string, type Row } from '../read/values.js';
import { nowIso, type CampaignWriter } from '../write/store.js';
import type { createWriteRuntime } from '../write/index.js';
import { castDirs, castEntry, castPages } from './entry.js';

/** Rows one job carries; a bigger cast is asked in further jobs. */
export const PUBLIC_FIGURES_PER_JOB = 200;
const STATUSES: readonly string[] = ['setting_up', 'ready_for_table', 'active'];
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/** The table that serves this campaign's checks, with its directory and its rows; null for a book with none. */
async function served(context: KernelContext, writer: ReturnType<typeof createWriteRuntime>, params: Row) {
    const campaign: CampaignWriter = await writer.campaign(params), meta = await campaign.readCampaign();
    if (!STATUSES.includes(string(meta.status)))
        throw new RpcError('campaign_not_ready', `campaign ${repr(campaign.id)} is ${repr(meta.status)}`, { details: { status: meta.status } });
    const world = await context.snapshots.pathExists(campaign.path('world.json')) ? await campaign.readWorld() : {};
    const moduleId = string(meta.module_id);
    let loaded;
    try { loaded = await loadCampaignModule(context, moduleId, world, campaign.id); } catch { return { campaign, table: null }; }
    const sha = moduleSourceSha(row(loaded.meta));
    const found = sha ? await servedCast(context.snapshots, await castDirs(context, campaign.id, moduleId), sha) : null;
    if (!found || !['complete', 'partial'].includes(string(found.table.state))) return { campaign, table: null };
    return { campaign, table: found.table, dir: found.dir, sha, moduleId, graph: loaded.graph, rows: array(found.table.people).filter(raw => !!text(row(raw).id)) };
}
async function verdictFile(context: KernelContext, dir: string): Promise<Row> {
    const path = join(dir, CAST_PUBLIC_FILE);
    try { return await context.snapshots.pathExists(path) ? row(await context.snapshots.readJson(path)) : {}; } catch { return {}; }
}

export function createPublicFigureHandlers(context: KernelContext, writer: ReturnType<typeof createWriteRuntime>): HandlerGroup {
    return Object.freeze({
        /**
         * The rows with no verdict for what they say now (or one the host's question `version` did not give), each with its names
         * and its entry: the book's own words where it first names them, cut as §194.4 cuts an unread person's.
         */
        'cast.public.job': async (params): Promise<Row> => {
            const found = await served(context, writer, params);
            if (!found.table) return { job_id: null };
            const version = text(params.version), verdicts = row((await verdictFile(context, found.dir!)).rows);
            const wanted = found.rows!.filter(raw => {
                const verdict = row(verdicts[text(row(raw).id)]);
                return verdict.row_sha256 !== castRowDigest(raw) || typeof verdict.public !== 'boolean' || (!!version && verdict.question !== version);
            }).slice(0, PUBLIC_FIGURES_PER_JOB);
            if (!wanted.length) return { job_id: null };
            const graph = found.graph!, cast = bookCast(graph), pages = await castPages(context, found.campaign.id, found.moduleId!, found.sha!);
            const people: Row[] = [];
            for (const raw of wanted) {
                const stored = row(raw), id = text(stored.id), owner = cast.find(person => person.castIds.includes(id));
                const shown = [...array(stored.book), ...array(stored.play)].map(text).filter(Boolean);
                const own = [...new Set([...shown, ...(owner ? printedNames(graph, owner) : [])])];
                const others = cast.filter(person => person !== owner).map(person => printedNames(graph, person));
                const first = row(stored.first), page = Number.isSafeInteger(first.page) ? Number(first.page) : 0, sentence = text(first.sentence);
                let entry: string | null = null;
                for (const source of [...(page ? await pages(page) : []), sentence]) if (!entry && source) entry = castEntry(source, own, others);
                entry ??= sentence || null;
                people.push({ id, row_sha256: castRowDigest(raw), names: [...new Set([...shown, ...array(stored.notes).map(text).filter(Boolean)])], ...(entry ? { entry } : {}) });
            }
            const digest = createHash('sha256').update(people.map(person => `${string(person.id)}:${string(person.row_sha256)}`).join('\n')).digest('hex').slice(0, 12);
            return { job_id: `cast-public:${found.sha!.slice(0, 12)}:${digest}`, cast_sha256: jsonDigest(found.rows as ReadonlyJson), people };
        },
        /**
         * The host's verdicts, `{id, row_sha256, noul, public}` each: kept for a row that still says what it said when it was
         * asked about (its digest), skipped otherwise (the next job asks again).
         */
        'cast.public.submit': async (params): Promise<Row> => {
            const verdicts = params.verdicts;
            // A Noul crosses the transport as a Python float (`PythonFloat`), or an int at 0 and 1; in process it is a number.
            if (!Array.isArray(verdicts) || verdicts.some(raw => !isJsonObject(raw) || !text(raw.id) || !text(raw.row_sha256) || typeof raw.public !== 'boolean'
                || !(typeof raw.noul === 'number' || numeric(raw.noul)) || !(number(raw.noul) >= 0 && number(raw.noul) <= 1)))
                throw new RpcError('invalid_params', 'params.verdicts must be a list of {id, row_sha256, noul (0..1), public (boolean)}', { details: { field: 'verdicts' } });
            const found = await served(context, writer, params);
            if (!found.table) throw new RpcError('invalid_params', 'this campaign\'s book has no cast to judge', { fix: 'ask cast.public.job first' });
            const current = new Map(found.rows!.map(raw => [text(row(raw).id), castRowDigest(raw)]));
            const version = text(params.version);
            const counts = await withExclusiveLock(context.locks, join(found.dir!, '.cast-public.lock'), async () => {
                const file = await verdictFile(context, found.dir!), rows: Row = { ...row(file.rows) };
                let written = 0, judged = 0, skipped = 0;
                for (const raw of verdicts as Row[]) {
                    const id = text(raw.id);
                    if (current.get(id) !== text(raw.row_sha256)) { skipped += 1; continue; }
                    rows[id] = { row_sha256: text(raw.row_sha256), public: raw.public, noul: Math.round(number(raw.noul) * 1000) / 1000, ...(version ? { question: version } : {}), at: nowIso() };
                    written += 1;
                    if (raw.public) judged += 1;
                }
                if (written) await writeJsonAtomic(join(found.dir!, CAST_PUBLIC_FILE), { version: 1, source_sha256: found.sha, cast_sha256: jsonDigest(found.rows as ReadonlyJson), rows });
                return { written, public: judged, skipped };
            }, { timeoutMs: 5000 });
            await found.campaign.telemetry({ lane: 'cast-public', event: 'submitted', ...counts }).catch(() => undefined);
            return counts;
        },
    });
}
