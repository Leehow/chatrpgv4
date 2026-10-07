/** Share one visual reading service between setup, commands and live material requests. */
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendJsonl, cocMode } from "../lanes/host.ts";
import { isKernelError } from "../kernel/client.ts";
import { ReadingService } from "./reading-service.ts";
import { TranscriptService } from "./transcript-service.ts";
import type { HostRuntime } from "../../runtime/host.ts";
import {createFreshSourceNavigator} from '../../runtime/jev/fresh-source-navigator.ts';
import {createTravelFill} from './travel-fill.ts';
import {createClaimSupport} from './claim-support.ts';

type Row = Record<string, any>;
type Call = (method: string, params: Row) => Promise<any>;
const record = (value: unknown): Row => value && typeof value === "object" ? value as Row : {};

export default function (pi: ExtensionAPI) {
    let ctx: ExtensionContext | undefined;
    let bridge: { call: Call; runtime: HostRuntime; campaign?: string } | undefined;
    let reading: ReadingService | undefined;
    /** §191.6: the page-transcript producer, made beside the reading service with its model and telemetry. */
    let transcripts: TranscriptService | undefined;
    const retiring = new Set<Promise<void>>();
    function retireReader() {
        const previousTranscripts = transcripts; transcripts = undefined;
        if (previousTranscripts) {
            const stopped = previousTranscripts.close().catch(()=>undefined).finally(()=>retiring.delete(stopped));
            retiring.add(stopped);
        }
        const previous = reading; reading = undefined;
        if (!previous) return;
        const closed = previous.close({handOff:true}).catch(()=>undefined).finally(()=>retiring.delete(closed));
        retiring.add(closed);
    }
    let moduleId: string | undefined;
    let campaign: string | undefined;
    let visualModule = false, stopped = false;
    const setupMode = cocMode() === "setup";

    function wake(reason:string) {
        if (setupMode || stopped || !visualModule || !moduleId || !reading) return;
        void reading.prefetch(moduleId,reason).catch(()=>undefined);
    }
    /**
     * §177.2: the book's cast, in the background, at every table open of a reading module (a campaign made before the cast
     * existed, or one that forked before it landed). `ReadingService.prepare` asks too, so a book being prepared gets it
     * before the opening. The kernel answers no job for an authored module or a book that has its cast.
     */
    function readCast(id: string | undefined) {
        if (stopped || !reading || !id) return;
        void reading.cast(id).catch(() => undefined);
    }
    /** §182.1: once per table and module, a bound book with no recorded outline is given its bookmarks. */
    const outlined = new Set<string>();
    function backfillOutline() {
        if (setupMode || stopped || !visualModule || !moduleId || !reading) return;
        const key = JSON.stringify([campaign, moduleId]);
        if (outlined.has(key)) return;
        outlined.add(key);
        void reading.backfillOutline(moduleId).catch(() => undefined);
    }
    function shareReader() {
        if (!ctx || !bridge) return;
        retireReader();
        const home = bridge.runtime.home, current = bridge;
        const model = () => {
            const id = current.runtime.readerModel || (ctx?.model ? `${ctx.model.provider}/${ctx.model.id}` : "");
            const slash = id.indexOf("/");
            const entry = ctx?.modelRegistry.find(id.slice(0, slash), id.slice(slash + 1));
            // §20 addendum 6 (SL-65): the reader's own context window, so a background/play reading's stage
            // lease can be sized to survive its actual whole-context reservations, not a fixed assumption.
            return { id, vision: entry?.input?.includes("image") === true, thinking: pi.getThinkingLevel(), contextWindow: entry?.contextWindow };
        };
        const record = (row: Row) => {
            const line = { at: new Date().toISOString(), ...row };
            try { pi.appendEntry("coc-telemetry", line); } catch { /* a closed session cannot accept entries */ }
            void appendJsonl(join(home, ".coc", "reading-telemetry.jsonl"), line).catch(() => undefined);
            if (row.campaign) void appendJsonl(join(home, ".coc", "campaigns", row.campaign, "telemetry.jsonl"), line).catch(() => undefined);
        };
        transcripts = new TranscriptService({ runtime: current.runtime, model, record });
        reading = new ReadingService({
            transcripts,
            navigateFresh: createFreshSourceNavigator({runtime: current.runtime, call: (method, params) => current.call(method, params), env: {...process.env}}),
            travel: createTravelFill({env: {...process.env}, contentRoot: current.runtime.contentRoot}),
            claimSupport: createClaimSupport({env: {...process.env}, contentRoot: current.runtime.contentRoot}),
            call: async (method, params) => {
                const result = await current.call(method, params);
                if (method === 'module.read.finish' && params.outcome === 'completed')
                    pi.events.emit('coc:source-published', {campaign: params.campaign, module_id: params.module_id,...(result?._task_source_advance?{advance:result._task_source_advance}:{})});
                return result;
            }, campaign: () => campaign, runtime: current.runtime, home,
            model,
            progress: row => pi.events.emit("coc:module-ingest-progress", row),
            record,
            // The operator's surface for a reader lane that stopped working, shaped after the admission
            // outage notice of contract §32.2: out of fiction, once per session, with the fix. Its reader
            // is the person running the table, not the run analysis -- the telemetry row already says the
            // same thing to kpi.py, and the player is never asked to resend words that were not the problem.
            // §177.2: the book's cast landed; the epithet lane gives its unread people a word (extensions/npc-epithets).
            published: row => pi.events.emit("coc:cast-published", row),
            status: row => {
                const line = { at: new Date().toISOString(), ...row };
                try { pi.appendEntry("coc-reading-status", line); } catch { /* a closed session cannot accept entries */ }
                pi.events.emit("coc:reading-status", line);
            },
        });
        pi.events.emit("coc:reading-bridge", reading);
        wake("reader-ready");
        // §177.2: the table may have opened before this session started (the kernel extension opens it in its own
        // session_start), when there was no reader to ask; the new reader asks, as the prefetch above does.
        if (!setupMode && visualModule) readCast(moduleId);
        backfillOutline();
    }

    pi.events.on("coc:kernel-bridge", data => {
        const row = record(data);
        if (row.campaign && campaign && row.campaign !== campaign) {moduleId = undefined; visualModule = false;}
        bridge = typeof row.call === "function" && row.runtime ? { call: row.call, runtime: row.runtime, campaign: row.campaign } : undefined;
        campaign = bridge?.campaign ?? campaign;
        if (bridge) shareReader();
        else { retireReader(); moduleId = undefined; visualModule = false; pi.events.emit("coc:reading-bridge", null); }
    });
    pi.events.on("coc:table-open", data => {
        const row = record(data), open = record(row.open);
        if (bridge?.campaign && row.campaign !== bridge.campaign) return;
        campaign = row.campaign ?? campaign;
        moduleId = typeof open.campaign?.module_id === "string" ? open.campaign.module_id : undefined;
        visualModule = open.module_reading === true;
        wake("table-open");
        if (visualModule) readCast(moduleId);
        backfillOutline();
    });
    pi.events.on("coc:turn-committed", data => {if(record(data).campaign === campaign)wake("turn-committed");});
    // §191.6: a reader outside this extension (the Keeper prescreen's consultation) read pages natively that it wanted now.
    pi.events.on("coc:transcript-wanted", data => {
        const row = record(data), pages = Array.isArray(row.pages) ? row.pages.filter((page: unknown) => Number.isSafeInteger(page) && (page as number) >= 1) : [];
        if (stopped || typeof row.pdf !== "string" || typeof row.file_sha256 !== "string" || !pages.length) return;
        reading?.wantTranscripts({ pdf: row.pdf, file_sha256: row.file_sha256, pages });
    });
    pi.events.on("coc:source-work-queued", data => {
        if(record(data).campaign === campaign && record(data).module_id === moduleId)wake("scene-queued");
    });
    pi.events.on("coc:module-ingest", data => {
        const row = record(data);
        if ((!row.pdf && !row.module_id) || stopped) return;
        if (!reading) {
            pi.events.emit("coc:module-ingest-failed", { pdf: row.pdf, reason: "reading_failed", detail: "the reading service is unavailable" });
            return;
        }
        void reading.prepare({ pdf: row.pdf, module_id: row.module_id, start_scene: row.start_scene, retry: row.retry })
            .then(result => pi.events.emit("coc:module-ingest-done", { pdf: row.pdf, ...result }))
            .catch(error => pi.events.emit("coc:module-ingest-failed", { pdf: row.pdf,
                reason: isKernelError(error) ? error.details?.reason ?? error.code : "reading_failed",
                detail: error instanceof Error ? error.message : String(error),
                ...(isKernelError(error) ? { fix: error.fix, details: error.details } : {}) }));
    });
    pi.on("before_agent_start", async (_event, current) => { ctx = current; });
    pi.on("session_start", async (_event, current) => {
        ctx = current; stopped = false;
        shareReader();
    });
    pi.on("session_shutdown", async () => {
        stopped = true;
        retireReader();
        pi.events.emit("coc:reading-bridge", null);
        await Promise.all([...retiring]);
    });
}
