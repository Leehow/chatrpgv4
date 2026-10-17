import {describe, expect, it, vi} from "vitest";
import {AccountUsageMonitor} from "../src/index.js";

const response = (row: Record<string, unknown>) => ({base_resp: {status_code: 0}, model_remains: [row]});
const quota = response({model_name: "general", current_interval_total_count: 0, current_interval_usage_count: 0,
  current_interval_remaining_percent: 94, current_weekly_remaining_percent: 99,
  end_time: 1792209616577, weekly_end_time: 1792796416577});

describe("MiniMax quota", () => {
  it("uses official remaining percentages even when the legacy counts are zero", async () => {
    const fetcher = vi.fn(async () => Response.json(quota));
    const monitor = new AccountUsageMonitor({fetch: fetcher as typeof fetch, readAuth: async () => ({"minimax-cn": {key: "cn-key"}})});
    const result = await monitor.snapshot("minimax-cn");
    expect(result).toMatchObject({status: "ready", snapshot: {provider: "minimax-cn", source: "subscription", windows: [
      {id: "fiveHour", usedPercent: 6, remainingPercent: 94, resetsAt: 1792209616577},
      {id: "weekly", usedPercent: 1, remainingPercent: 99, resetsAt: 1792796416577},
    ]}});
    expect(fetcher).toHaveBeenCalledWith("https://www.minimax.cn/v1/token_plan/remains", expect.objectContaining({headers: expect.objectContaining({Authorization: "Bearer cn-key"})}));
    expect(JSON.stringify(result)).not.toContain("cn-key");
  });

  it("keeps regional credentials, endpoints and caches independent", async () => {
    const fetcher = vi.fn(async () => Response.json(quota));
    const monitor = new AccountUsageMonitor({fetch: fetcher as typeof fetch, readAuth: async () => ({"minimax-cn": {key: "cn-key"}, minimax: {key: "global-key"}})});
    await monitor.snapshot("minimax-cn");
    await monitor.snapshot("minimax");
    expect(fetcher).toHaveBeenNthCalledWith(2, "https://www.minimax.io/v1/token_plan/remains", expect.objectContaining({headers: expect.objectContaining({Authorization: "Bearer global-key"})}));
    expect(await monitor.snapshot("minimax-relay")).toEqual({status: "no-data", reason: "unsupported"});
    expect(await monitor.snapshot("MiniMax-M3.1-Flash-Preview")).toEqual({status: "no-data", reason: "unsupported"});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retains actual zero remaining and rejects malformed, missing and service-error data", async () => {
    for (const body of [response({}), response({current_interval_remaining_percent: "invalid"}), {base_resp: {status_code: 2062}, model_remains: quota.model_remains}]) {
      const monitor = new AccountUsageMonitor({env: {MINIMAX_API_KEY: "key"}, fetch: vi.fn(async () => Response.json(body)) as typeof fetch});
      expect((await monitor.snapshot("minimax")).status).not.toBe("ready");
    }
    const monitor = new AccountUsageMonitor({env: {MINIMAX_API_KEY: "key"}, fetch: vi.fn(async () => Response.json(response({current_interval_remaining_percent: 0}))) as typeof fetch});
    expect(await monitor.snapshot("minimax")).toMatchObject({status: "ready", snapshot: {windows: [{usedPercent: 100, remainingPercent: 0}]}});
  });

  it("retains last valid quota after a transient failure and never fetches without credentials", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(quota)).mockResolvedValueOnce(new Response("rate limited", {status: 429}));
    const monitor = new AccountUsageMonitor({env: {MINIMAX_API_KEY: "key"}, fetch: fetcher as typeof fetch});
    const first = await monitor.snapshot("minimax");
    expect(first.status).toBe("ready");
    expect(await monitor.snapshot("minimax", true)).toMatchObject({status: "error", code: "http", staleSnapshot: first.status === "ready" ? first.snapshot : {}});
    const empty = new AccountUsageMonitor({fetch: fetcher as typeof fetch});
    expect((await empty.snapshot("minimax-cn")).status).toBe("no-data");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
