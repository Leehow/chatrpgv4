import { describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_USAGE_STALE_AFTER_MS,
  AccountUsageMonitor,
  AccountUsageRegistry,
  builtinAccountUsageAdapters,
  openCodeGoWindows,
  parseClaudeWindows,
  parseCodexWindows,
  parseCursorWindows,
  parseDeepSeekBalance,
  parseKimiWindows,
  parseMoonshotBalance,
  parseOpenCodeGoUsage,
  parseOpenRouterBalance,
  parseQwenWindows,
  parseSiliconFlowBalance,
  type AccountUsageAdapter,
} from "../src/index.js";

const response = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("provider parsers", () => {
  it("normalizes Codex, Claude and Kimi subscription windows", () => {
    expect(parseCodexWindows({ rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18000 }, secondary_window: { used_percent: 20, limit_window_seconds: 604800 } } }).map(w => [w.label, w.usedPercent])).toEqual([["5h", 10], ["周", 20]]);
    expect(parseClaudeWindows({ five_hour: { utilization: 16, resets_at: "2026-08-14T00:00:00Z" }, seven_day: { utilization: "40" } }).map(w => w.usedPercent)).toEqual([16, 40]);
    expect(parseKimiWindows({ usage: { limit: "100", used: "20" }, limits: [{ detail: { limit: 50, remaining: 40 } }] }).map(w => w.usedPercent)).toEqual([20, 20]);
    expect(parseCursorWindows({ includedUsagePercent: 33, namedModelSelectedUsage: { used: 2, limit: 8 } }).map(w => [w.id, w.usedPercent])).toEqual([["plan", 33], ["cursorModels", 25]]);
    expect(parseCursorWindows(null)).toEqual([]);
  });

  it("normalizes Qwen and every prepaid balance", () => {
    expect(parseQwenWindows({ data: { DataV2: { data: { data: { per5HourPercentage: 0.25, per1WeekPercentage: 0.5 } } } } }).map(w => w.usedPercent)).toEqual([25, 50]);
    expect(parseMoonshotBalance({ code: 0, data: { available_balance: "20" } })).toEqual({ amount: 20, currency: "CNY" });
    expect(parseSiliconFlowBalance({ data: { totalBalance: 30 } })).toEqual({ amount: 30, currency: "CNY" });
    expect(parseOpenRouterBalance({ data: { total_credits: 50, total_usage: 12.5 } })).toEqual({ amount: 37.5, currency: "USD" });
  });

  it("normalizes the DeepSeek prepaid balance and rejects unavailable payloads", () => {
    expect(parseDeepSeekBalance({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "110.00" }] })).toEqual({ amount: 110, currency: "CNY" });
    expect(parseDeepSeekBalance({ is_available: true, balance_infos: [{ currency: "usd", total_balance: 5 }] })).toEqual({ amount: 5, currency: "USD" });
    expect(parseDeepSeekBalance({ is_available: false, balance_infos: [{ currency: "CNY", total_balance: "110.00" }] })).toBeUndefined();
    expect(parseDeepSeekBalance({ is_available: true, balance_infos: [] })).toBeUndefined();
    expect(parseDeepSeekBalance({ is_available: true, balance_infos: [{ currency: "CNY" }] })).toBeUndefined();
  });

  it("computes OpenCode Go local-only windows", () => {
    const now = Date.UTC(2026, 7, 13, 12);
    const windows = openCodeGoWindows([{ createdMs: now - 60_000, cost: 6 }], now);
    expect(windows.map(w => w.usedPercent)).toEqual([50, 20, 10]);
    expect(windows.map(w => w.title)).toEqual(["5小时本机用量", "周本机用量", "月本机用量"]);
  });

  it("parses OpenCode Go official usage windows", () => {
    const rollingReset = "2026-08-29T07:38:42.348Z";
    const weeklyReset = "2026-08-31T00:00:00.348Z";
    const monthlyReset = "2026-09-08T01:22:14.348Z";
    const windows = parseOpenCodeGoUsage({
      usage: {
        rolling: { status: "ok", percent: 13, resetsAt: rollingReset },
        weekly: { status: "ok", percent: 54, resetsAt: weeklyReset },
        monthly: { status: "ok", percent: 67, resetsAt: monthlyReset },
      },
    });
    expect(windows.map(w => [w.id, w.usedPercent, w.label, w.title])).toEqual([
      ["fiveHour", 13, "5h", "5小时额度"],
      ["weekly", 54, "周", "周额度"],
      ["monthly", 67, "月", "月额度"],
    ]);
    expect(windows[0].resetsAt).toBe(Date.parse(rollingReset));
    expect(windows[1].resetsAt).toBe(Date.parse(weeklyReset));
    expect(windows[2].resetsAt).toBe(Date.parse(monthlyReset));
    expect(parseOpenCodeGoUsage({ usage: { weekly: { percent: 54 } } })).toEqual([
      expect.objectContaining({ id: "weekly", usedPercent: 54, label: "周" }),
    ]);
    expect(parseOpenCodeGoUsage({})).toEqual([]);
  });

  it("returns stable empty values for malformed provider payloads", () => {
    expect(parseCodexWindows(null)).toEqual([]);
    expect(parseClaudeWindows({ five_hour: { utilization: "bad" } })).toEqual([]);
    expect(parseKimiWindows({})).toEqual([]);
    expect(parseCursorWindows({})).toEqual([]);
  });
});

describe("registry routing", () => {
  const registry = new AccountUsageRegistry();
  it("routes every built-in provider and excludes relays/near misses", () => {
    expect(registry.resolve("cursor")?.id).toBe("cursor");
    expect(registry.resolve("openai-codex")?.id).toBe("codex");
    expect(registry.resolve("anthropic")?.id).toBe("claude");
    expect(registry.resolve("kimi-coding")?.id).toBe("kimi");
    expect(registry.resolve("qwen-token-plan-cn")?.id).toBe("qwenTokenPlan");
    expect(registry.resolve("opencode-go")?.id).toBe("opencodeGo");
    expect(registry.resolve("moonshotai")?.id).toBe("moonshot");
    expect(registry.resolve("siliconflow")?.id).toBe("siliconflow");
    expect(registry.resolve("openrouter")?.id).toBe("openrouter");
    expect(registry.resolve("qwen-vl")).toBeUndefined();
    expect(registry.resolve("moonshot-relay")).toBeUndefined();
    expect(registry.resolve("deepseek")?.id).toBe("deepseek");
    expect(registry.resolve("deepseek-extended")?.id).toBe("deepseek");
    expect(registry.resolve("deepseek-relay")).toBeUndefined();
  });

  it("prioritizes subscription quota over prepaid balance", () => {
    const quota: AccountUsageAdapter = { id: "quota", kind: "subscription", matches: () => true, load: async () => undefined };
    const balance: AccountUsageAdapter = { id: "balance", kind: "prepaid", priority: 100, matches: () => true, load: async () => undefined };
    expect(new AccountUsageRegistry([balance, quota]).resolve("same")?.id).toBe("quota");
  });
});

describe("built-in adapters", () => {
  const pi = {
    "openai-codex": { type: "oauth", access: "codex-token" },
    anthropic: { type: "oauth", access: "claude-token" },
    "kimi-coding": { type: "api_key", key: "kimi-token" },
    moonshot: { type: "api_key", key: "moonshot-token" },
    siliconflow: { type: "api_key", key: "sf-token" },
    openrouter: { type: "api_key", key: "or-token" },
  };
  const bodies: Array<[string, unknown]> = [
    ["cursor.com/api/usage-summary", { includedUsagePercent: 22, namedModelSelectedUsage: { used: 1, limit: 10 } }],
    ["wham/usage", { rate_limit: { primary_window: { used_percent: 11, limit_window_seconds: 18000 } } }],
    ["anthropic.com", { five_hour: { utilization: 12 } }],
    ["kimi.com/coding", { usage: { limit: 100, used: 14 } }],
    ["bailian-cs", { data: { DataV2: { data: { data: { per5HourPercentage: 0.16, per1WeekPercentage: 0.17 } } } } }],
    ["moonshot.cn", { code: 0, data: { available_balance: 19 } }],
    ["siliconflow.cn", { data: { totalBalance: 20 } }],
    ["openrouter.ai", { data: { total_credits: 30, total_usage: 9 } }],
  ];
  const fakeFetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = bodies.find(([needle]) => url.includes(needle));
    if (!match) throw new Error(`unexpected URL ${url}`);
    return response(match[1]);
  }) as unknown as typeof fetch;
  const monitor = new AccountUsageMonitor({
    fetch: fakeFetch,
    env: { OPENCODE_API_KEY: "go-key" },
    readAuth: async store => store === "pi" ? pi : store === "codex" ? { tokens: { access_token: "codex-token" } } : undefined,
    readCookie: async provider => provider === "qwen-token-plan" ? "ticket=ok" : provider === "cursor" ? "WorkosCursorSessionToken=ok" : undefined,
    readCursorAuth: async () => undefined,
    readLocalUsage: async () => [{ createdMs: Date.now() - 1000, cost: 1 }],
  });

  for (const [provider, expected] of [["cursor", 22], ["openai-codex", 11], ["anthropic", 12], ["kimi-coding", 14], ["qwen-token-plan", 16]] as const) {
    it(`loads ${provider} quota`, async () => {
      const result = await monitor.snapshot(provider, true);
      expect(result.status).toBe("ready");
      if (result.status === "ready") expect(result.snapshot.windows[0].usedPercent).toBeCloseTo(expected);
    });
  }
  for (const [provider, expected] of [["moonshot", 19], ["siliconflow", 20], ["openrouter", 21]] as const) {
    it(`loads ${provider} balance`, async () => {
      const result = await monitor.snapshot(provider, true);
      expect(result.status).toBe("ready");
      if (result.status === "ready") expect(result.snapshot.balance?.amount).toBe(expected);
    });
  }
  it("loads the DeepSeek prepaid balance with a bearer key against the official endpoint", async () => {
    let request: { url?: string; init?: RequestInit } = {};
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = { url: String(input), init };
      return response({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "110.00" }] });
    }) as unknown as typeof fetch;
    const monitor = new AccountUsageMonitor({
      fetch: fetchSpy,
      readAuth: async store => store === "pi" ? { deepseek: { type: "api_key", key: "ds-key" } } : undefined,
    });
    const result = await monitor.snapshot("deepseek", true);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.snapshot).toMatchObject({ provider: "deepseek", balance: { amount: 110, currency: "CNY" }, source: "prepaid" });
    }
    expect(request.url).toBe("https://api.deepseek.com/user/balance");
    expect((request.init?.headers as Record<string, string>).Authorization).toBe("Bearer ds-key");
  });
  it("hides Cursor when no desktop token or cookie is available", async () => {
    const fetchSpy = vi.fn(async () => response({})) as unknown as typeof fetch;
    const empty = new AccountUsageMonitor({ fetch: fetchSpy, readCursorAuth: async () => undefined, readCookie: async () => undefined });
    const result = await empty.snapshot("cursor", true);
    expect(result).toEqual({ status: "no-data", reason: "missing-credential" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("does not inspect browser cookies when Cursor has a valid desktop token", async () => {
    const token = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
    const readCookie = vi.fn(async () => "WorkosCursorSessionToken=unused");
    const fetchSpy = vi.fn(async () => response({ includedUsagePercent: 22 })) as unknown as typeof fetch;
    const monitor = new AccountUsageMonitor({ fetch: fetchSpy, readCursorAuth: async () => token, readCookie });

    expect((await monitor.snapshot("cursor", true)).status).toBe("ready");
    expect(readCookie).not.toHaveBeenCalled();
  });
  it("loads OpenCode Go only through the injected local reader", async () => {
    const result = await monitor.snapshot("opencode-go", true);
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.snapshot.source).toBe("local");
  });
  it("prefers OpenCode Go server usage over local rows", async () => {
    const readLocalUsage = vi.fn(async () => [{ createdMs: Date.now() - 1000, cost: 6 }]);
    const fetchSpy = vi.fn(async () => response({
      usage: {
        rolling: { status: "ok", percent: 13, resetsAt: "2026-08-29T07:38:42.348Z" },
        weekly: { status: "ok", percent: 54, resetsAt: "2026-08-31T00:00:00.348Z" },
        monthly: { status: "ok", percent: 67, resetsAt: "2026-09-08T01:22:14.348Z" },
      },
    })) as unknown as typeof fetch;
    const serverFirst = new AccountUsageMonitor({
      fetch: fetchSpy,
      env: { OPENCODE_API_KEY: "go-key" },
      readAuth: async () => ({}),
      readLocalUsage,
    });
    const result = await serverFirst.snapshot("opencode-go", true);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.snapshot.source).toBe("subscription");
      expect(result.snapshot.windows.map(w => w.usedPercent)).toEqual([13, 54, 67]);
    }
    expect(readLocalUsage).not.toHaveBeenCalled();
  });
  it("falls back to OpenCode Go local rows when the server request fails", async () => {
    const now = Date.now();
    const fetchSpy = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const ready = new AccountUsageMonitor({
      fetch: fetchSpy,
      env: { OPENCODE_API_KEY: "go-key" },
      readAuth: async () => ({}),
      readLocalUsage: async () => [{ createdMs: now - 1000, cost: 6 }],
      now: () => now,
    });
    const readyResult = await ready.snapshot("opencode-go", true);
    expect(readyResult.status).toBe("ready");
    if (readyResult.status === "ready") {
      expect(readyResult.snapshot.source).toBe("local");
      expect(readyResult.snapshot.windows[0].usedPercent).toBeCloseTo(50);
    }
    const empty = new AccountUsageMonitor({
      fetch: fetchSpy,
      env: { OPENCODE_API_KEY: "go-key" },
      readAuth: async () => ({}),
      readLocalUsage: async () => [],
    });
    await expect(empty.snapshot("opencode-go", true)).resolves.toMatchObject({ status: "no-data" });
  });
  it("gates OpenCode Go on env OPENCODE_API_KEY when the auth entry is missing", async () => {
    const byEnv = new AccountUsageMonitor({ fetch: fakeFetch, env: { OPENCODE_API_KEY: "go-key" }, readAuth: async () => ({}), readLocalUsage: async () => [{ createdMs: Date.now() - 1000, cost: 1 }] });
    expect((await byEnv.snapshot("opencode-go", true)).status).toBe("ready");
    const unconfigured = new AccountUsageMonitor({ fetch: fakeFetch, readAuth: async () => ({}), readLocalUsage: async () => [{ createdMs: Date.now() - 1000, cost: 1 }] });
    await expect(unconfigured.snapshot("opencode-go", true)).resolves.toEqual({ status: "no-data", reason: "missing-credential" });
  });
  it("persists the qwen cookie after a successful fetch so the session survives restarts", async () => {
    const persistCookie = vi.fn();
    const monitor = new AccountUsageMonitor({ fetch: fakeFetch, readCookie: async () => "ticket=ok", persistCookie });
    const result = await monitor.snapshot("qwen-token-plan", true);
    expect(result.status).toBe("ready");
    expect(persistCookie).toHaveBeenCalledWith("qwen-token-plan", "ticket=ok");
  });
  it("never persists the qwen cookie when the gateway reports NotLogined", async () => {
    const notLoginedFetch = vi.fn(async () => response({ errorCode: "BailianGateway.Login.NotLogined" })) as unknown as typeof fetch;
    const persistCookie = vi.fn();
    const monitor = new AccountUsageMonitor({ fetch: notLoginedFetch, readCookie: async () => "ticket=stale", persistCookie });
    await monitor.snapshot("qwen-token-plan", true);
    expect(persistCookie).not.toHaveBeenCalled();
  });
  it("returns no-data when credentials or optional capabilities are absent", async () => {
    const empty = new AccountUsageMonitor({ fetch: fakeFetch, readAuth: async () => ({}) });
    await expect(empty.snapshot("anthropic")).resolves.toEqual({ status: "no-data", reason: "missing-credential" });
    await expect(empty.snapshot("qwen-token-plan")).resolves.toEqual({ status: "no-data", reason: "missing-capability" });
    await expect(empty.snapshot("opencode-go")).resolves.toEqual({ status: "no-data", reason: "missing-capability" });
  });
});

describe("monitor caching and failures", () => {
  const auth = async () => ({ tokens: { access_token: "secret" } });
  it("throttles for three minutes, force refreshes, and dedupes concurrent force calls", async () => {
    let now = 1_000, calls = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetcher = vi.fn(async () => { calls++; if (calls === 2) await gate; return response({ rate_limit: { primary_window: { used_percent: calls, limit_window_seconds: 18000 } } }); }) as unknown as typeof fetch;
    const monitor = new AccountUsageMonitor({ fetch: fetcher, readAuth: async store => store === "codex" ? auth() : undefined, now: () => now });
    const first = await monitor.snapshot("openai-codex");
    now += ACCOUNT_USAGE_STALE_AFTER_MS - 1;
    expect(await monitor.snapshot("openai-codex")).toEqual(first);
    const a = monitor.snapshot("openai-codex", true), b = monitor.snapshot("openai-codex", true);
    release();
    expect(await a).toEqual(await b);
    expect(calls).toBe(2);
  });

  it("returns explicit HTTP/malformed/timeout errors without leaking credentials and carries last-good", async () => {
    let mode: "ok" | "http" | "malformed" | "timeout" = "ok";
    const fetcher = vi.fn(async () => {
      if (mode === "http") return response("denied", 401);
      if (mode === "malformed") return response("not-json");
      if (mode === "timeout") throw new DOMException("secret-token", "TimeoutError");
      return response({ rate_limit: { primary_window: { used_percent: 44, limit_window_seconds: 18000 } } });
    }) as unknown as typeof fetch;
    const monitor = new AccountUsageMonitor({ fetch: fetcher, readAuth: async store => store === "codex" ? auth() : undefined });
    const good = await monitor.snapshot("openai-codex");
    for (const [next, code] of [["http", "http"], ["malformed", "malformed"], ["timeout", "timeout"]] as const) {
      mode = next;
      const failed = await monitor.snapshot("openai-codex", true);
      expect(failed).toMatchObject({ status: "error", code });
      if (failed.status === "error") expect(failed.staleSnapshot).toEqual(good.status === "ready" ? good.snapshot : undefined);
      expect(JSON.stringify(failed)).not.toContain("secret");
    }
  });
});

it("exports an explicit, unique provider registry", () => {
  expect(new Set(builtinAccountUsageAdapters.map(adapter => adapter.id)).size).toBe(builtinAccountUsageAdapters.length);
});
