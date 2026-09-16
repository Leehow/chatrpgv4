/** Share one visual reading service between setup, commands and live material requests. */
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendJsonl, cocMode } from "../lanes/host.ts";
import { isKernelError } from "../kernel/client.ts";
import { ReadingService } from "./reading-service.ts";
import type { HostRuntime } from "../../runtime/host.ts";

type Row = Record<string, any>;
type Call = (method: string, params: Row) => Promise<any>;
const record = (value: unknown): Row => value && typeof value === "object" ? value as Row : {};

export default function (pi: ExtensionAPI) {
    let ctx: ExtensionContext | undefined;
    let bridge: { call: Call; runtime: HostRuntime; campaign?: string } | undefined;
    let reading: ReadingService | undefined;
    const retiring = new Set<Promise<void>>();
    function retireReader() {
        const previous = reading; reading = undefined;
        if (!previous) return;
        const closed = previous.close().catch(()=>undefined).finally(()=>retiring.delete(closed));
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
    function shareReader() {
        if (!ctx || !bridge) return;
        retireReader();
        const home = bridge.runtime.home, current = bridge;
        reading = new ReadingService({
            call: current.call, campaign: () => campaign, runtime: current.runtime, home,
            model: () => {
                const id = current.runtime.readerModel || (ctx?.model ? `${ctx.model.provider}/${ctx.model.id}` : "");
                const slash = id.indexOf("/");
                const model = ctx?.modelRegistry.find(id.slice(0, slash), id.slice(slash + 1));
                return { id, vision: model?.input?.includes("image") === true, thinking: pi.getThinkingLevel() };
            },
            progress: row => pi.events.emit("coc:module-ingest-progress", row),
            record: row => {
                const line = { at: new Date().toISOString(), ...row };
                try { pi.appendEntry("coc-telemetry", line); } catch { /* a closed session cannot accept entries */ }
                void appendJsonl(join(home, ".coc", "reading-telemetry.jsonl"), line).catch(() => undefined);
                if (row.campaign) void appendJsonl(join(home, ".coc", "campaigns", row.campaign, "telemetry.jsonl"), line).catch(() => undefined);
            },
            // The operator's surface for a reader lane that stopped working, shaped after the admission
            // outage notice of contract §32.2: out of fiction, once per session, with the fix. Its reader
            // is the person running the table, not the run analysis -- the telemetry row already says the
            // same thing to kpi.py, and the player is never asked to resend words that were not the problem.
            status: row => {
                const line = { at: new Date().toISOString(), ...row };
                try { pi.appendEntry("coc-reading-status", line); } catch { /* a closed session cannot accept entries */ }
                pi.events.emit("coc:reading-status", line);
            },
        });
        pi.events.emit("coc:reading-bridge", reading);
        wake("reader-ready");
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
    });
    pi.events.on("coc:turn-committed", data => {if(record(data).campaign === campaign)wake("turn-committed");});
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
