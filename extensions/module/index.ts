/** Share one visual reading service between setup, commands and live material requests. */
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendJsonl, cocHome, cocMode } from "../lanes/host.ts";
import { isKernelError } from "../kernel/client.ts";
import { ReadingService } from "./reading-service.ts";

type Row = Record<string, any>;
type Call = (method: string, params: Row) => Promise<any>;
const record = (value: unknown): Row => value && typeof value === "object" ? value as Row : {};

export default function (pi: ExtensionAPI) {
    let ctx: ExtensionContext | undefined;
    let bridge: { call: Call; campaign?: string } | undefined;
    let reading: ReadingService | undefined;
    let moduleId: string | undefined;
    let campaign: string | undefined;
    let visualModule = false, stopped = false, pending = false;
    const setupMode = cocMode() === "setup";

    function shareReader() {
        if (!ctx || !bridge) return;
        reading?.dispose();
        const home = cocHome(ctx.cwd), current = bridge;
        reading = new ReadingService({
            call: current.call, home,
            model: () => {
                const id = process.env.PI_COC_BUILD_MODEL?.trim() || (ctx?.model ? `${ctx.model.provider}/${ctx.model.id}` : "");
                const slash = id.indexOf("/");
                const model = ctx?.modelRegistry.find(id.slice(0, slash), id.slice(slash + 1));
                return { id, vision: model?.input?.includes("image") === true };
            },
            progress: row => pi.events.emit("coc:module-ingest-progress", row),
            record: row => {
                const line = { at: new Date().toISOString(), ...row };
                try { pi.appendEntry("coc-telemetry", line); } catch { /* a closed session cannot accept entries */ }
                void appendJsonl(join(home, ".coc", "reading-telemetry.jsonl"), line).catch(() => undefined);
                if (campaign) void appendJsonl(join(home, ".coc", "campaigns", campaign, "telemetry.jsonl"), line).catch(() => undefined);
            },
        });
        pi.events.emit("coc:reading-bridge", reading);
    }

    pi.events.on("coc:kernel-bridge", data => {
        const row = record(data);
        bridge = typeof row.call === "function" ? { call: row.call, campaign: row.campaign } : undefined;
        campaign = bridge?.campaign ?? campaign;
        if (bridge) shareReader();
        else { reading?.dispose(); reading = undefined; pi.events.emit("coc:reading-bridge", null); }
    });
    pi.events.on("coc:table-open", data => {
        const row = record(data), open = record(row.open);
        campaign = row.campaign ?? campaign;
        moduleId = open.campaign?.module_id ?? moduleId;
        visualModule = open.module_reading === true;
    });
    pi.events.on("coc:turn-committed", () => { pending = true; });
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
    pi.on("agent_end", async () => {
        if (setupMode || stopped || !pending || !visualModule || !moduleId || !reading) return;
        pending = false;
        void reading.prefetch(moduleId).catch(() => undefined);
    });
    pi.on("session_start", async (_event, current) => {
        ctx = current; stopped = false; pending = false;
        shareReader();
    });
    pi.on("session_shutdown", async () => {
        stopped = true;
        reading?.dispose(); reading = undefined;
        pi.events.emit("coc:reading-bridge", null);
    });
}
