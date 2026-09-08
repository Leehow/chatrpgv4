export type UsageWindow = {
  id: string;
  usedPercent: number;
  resetsAt?: number;
  label: string;
  title: string;
};

export type AccountBalance = { amount: number; currency: string };

export type AccountUsageSnapshot = {
  provider: string;
  accountLabel: string;
  windows: UsageWindow[];
  balance?: AccountBalance;
  source: "subscription" | "prepaid" | "local";
};

export type LocalUsageRow = { createdMs: number; cost: number };

/** Host-owned I/O. The core never imports Electron, Pi, React, SwiftUI, SQLite, or filesystem APIs. */
export type AccountUsageCapabilities = {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  /** Parsed JSON or raw JSON from the host's credential stores. */
  readAuth?: (store: "pi" | "codex" | "opencode") => Promise<unknown>;
  /** Cursor desktop JWT from the host (read-only SQLite). Never refresh this token. */
  readCursorAuth?: () => Promise<string | undefined>;
  /** Optional browser-cookie capability. Values are never returned in snapshots/errors. */
  readCookie?: (provider: "kimi" | "qwen-token-plan" | "cursor") => Promise<string | undefined>;
  /** Persists a cookie that just produced a successful fetch. Browser session
   *  cookies (e.g. the aliyun login ticket) do not survive an app restart, so
   *  the host caches the last-known-good value (Swift persistCookie parity). */
  persistCookie?: (provider: "qwen-token-plan", cookie: string) => Promise<void> | void;
  /** Optional local-database capability; the host owns SQLite access. */
  readLocalUsage?: (provider: "opencode-go") => Promise<LocalUsageRow[] | undefined>;
  now?: () => number;
  timeoutMs?: number;
};

export type AccountUsageContext = Required<Pick<AccountUsageCapabilities, "fetch" | "now" | "timeoutMs">> & AccountUsageCapabilities;

export type AccountUsageAdapter = {
  id: string;
  kind: "subscription" | "prepaid";
  priority?: number;
  matches(provider: string): boolean;
  load(ctx: AccountUsageContext): Promise<AccountUsageSnapshot | undefined>;
};

export type AccountUsageResult =
  | { status: "ready"; snapshot: AccountUsageSnapshot; stale: boolean }
  | { status: "no-data"; reason: "unsupported" | "missing-capability" | "missing-credential" | "empty-response" }
  | { status: "error"; code: "timeout" | "http" | "malformed" | "network"; detail?: string; staleSnapshot?: AccountUsageSnapshot };

export const ACCOUNT_USAGE_STALE_AFTER_MS = 3 * 60 * 1000;

const clean = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  let result = value.trim();
  if ((result.startsWith("\"") && result.endsWith("\"")) || (result.startsWith("'") && result.endsWith("'"))) result = result.slice(1, -1).trim();
  return result || undefined;
};
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const number = (value: unknown): number | undefined => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const clamp = (value: number) => Math.min(100, Math.max(0, value));
const json = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return undefined; }
};
const authEntry = (root: unknown, ...ids: string[]) => {
  const r = record(json(root));
  for (const id of ids) {
    const entry = record(r?.[id]);
    if (entry) return entry;
  }
};
const token = (entry: Record<string, unknown> | undefined, ...keys: string[]) => {
  for (const key of keys) { const value = clean(entry?.[key]); if (value) return value; }
};
const resetMs = (value: unknown): number | undefined => {
  const n = number(value);
  if (n !== undefined) return n > 10_000_000_000 ? n : n * 1000;
  if (typeof value === "string") { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : undefined; }
};
const envToken = (ctx: AccountUsageContext, ...names: string[]) => {
  for (const name of names) { const value = clean(ctx.env?.[name]); if (value) return value; }
};

export class UsageError extends Error {
  constructor(readonly code: "timeout" | "http" | "malformed" | "network", message: string) { super(message); }
}
class NoDataError extends Error {
  constructor(readonly reason: "missing-capability" | "missing-credential" | "empty-response") { super(reason); }
}

async function fetchResponse(ctx: AccountUsageContext, url: string, init: RequestInit): Promise<Response> {
  try {
    return await ctx.fetch(url, { ...init, signal: AbortSignal.timeout(ctx.timeoutMs) });
  } catch (error) {
    if (error instanceof UsageError) throw error;
    if (error instanceof DOMException && error.name === "TimeoutError") throw new UsageError("timeout", "request timed out");
    throw new UsageError("network", "request failed");
  }
}

async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { throw new UsageError("malformed", "invalid JSON response"); }
}

async function fetchJson(ctx: AccountUsageContext, url: string, init: RequestInit): Promise<unknown> {
  const response = await fetchResponse(ctx, url, init);
  if (!response.ok) throw new UsageError("http", `HTTP ${response.status}`);
  return responseJson(response);
}

function bearer(value: string): Record<string, string> { return { Authorization: `Bearer ${value}`, Accept: "application/json" }; }
function window(id: string, usedPercent: number, label: string, title: string, resetsAt?: number): UsageWindow {
  return { id, usedPercent: clamp(usedPercent), resetsAt, label, title };
}

export function codexWindowLabel(seconds?: number): string {
  if (!seconds || seconds <= 0) return "额度";
  const hours = seconds / 3600;
  if (hours >= 4.5 && hours <= 5.5) return "5h";
  const days = Math.round(seconds / 86400);
  if (days >= 4 && days <= 12) return "周";
  if (days >= 20 && days <= 45) return "月";
  return "额度";
}

export function parseCodexWindows(body: unknown): UsageWindow[] {
  const rate = record(record(body)?.rate_limit);
  if (!rate) return [];
  const out: UsageWindow[] = [];
  for (const [id, raw] of [["primary_window", rate.primary_window], ["secondary_window", rate.secondary_window]] as const) {
    const value = record(raw); const used = number(value?.used_percent); if (used === undefined) continue;
    const label = codexWindowLabel(number(value?.limit_window_seconds));
    out.push(window(id, used, label, label === "额度" ? "额度" : `${label}额度`, resetMs(value?.reset_at)));
  }
  return out.map((item, index) => out.length > 1 ? { ...item, id: `window${index}` } : item);
}

export function parseDeepSeekBalance(body: unknown): AccountBalance | undefined {
  const root = record(body); if (!root || root.is_available === false || !Array.isArray(root.balance_infos)) return;
  const first = record(root.balance_infos[0]); const amount = number(first?.total_balance); if (amount === undefined) return;
  return { amount, currency: clean(first?.currency)?.toUpperCase() ?? "CNY" };
}
export function parseMoonshotBalance(body: unknown): AccountBalance | undefined {
  const root = record(body); const code = root?.code; if (code !== undefined && String(code) !== "0") return;
  const amount = number(record(root?.data)?.available_balance); return amount === undefined ? undefined : { amount, currency: "CNY" };
}
export function parseSiliconFlowBalance(body: unknown): AccountBalance | undefined {
  const amount = number(record(record(body)?.data)?.totalBalance); return amount === undefined ? undefined : { amount, currency: "CNY" };
}
export function parseOpenRouterBalance(body: unknown): AccountBalance | undefined {
  const data = record(record(body)?.data); const credits = number(data?.total_credits); const used = number(data?.total_usage);
  return credits === undefined || used === undefined ? undefined : { amount: credits - used, currency: "USD" };
}

export function parseClaudeWindows(body: unknown): UsageWindow[] {
  const root = record(body); if (!root) return [];
  const out: UsageWindow[] = [];
  for (const [key, id, label] of [["five_hour", "fiveHour", "5h"], ["seven_day", "sevenDay", "周"]] as const) {
    const value = record(root[key]); const used = number(value?.utilization); if (used === undefined) continue;
    out.push(window(id, used, label, `${label}额度`, resetMs(value?.resets_at)));
  }
  return out;
}

function kimiDetail(raw: unknown, id: string, label: string, title: string): UsageWindow | undefined {
  const detail = record(raw); const limit = number(detail?.limit); if (!detail || !limit || limit <= 0) return;
  const remaining = number(detail.remaining); const used = number(detail.used) ?? (remaining === undefined ? 0 : Math.max(0, limit - remaining));
  return window(id, used / limit * 100, label, title, resetMs(detail.resetTime ?? detail.resetAt ?? detail.reset_time ?? detail.reset_at));
}
export function parseKimiWindows(body: unknown): UsageWindow[] {
  const root = record(body); if (!root) return [];
  const out: UsageWindow[] = [];
  const weekly = kimiDetail(root.usage, "weekly", "周", "周额度"); if (weekly) out.push(weekly);
  const limits = root.limits; if (Array.isArray(limits)) { const five = kimiDetail(record(limits[0])?.detail, "fiveHour", "5h", "5小时额度"); if (five) out.push(five); }
  return out;
}

function usagePercent(raw: unknown): number | undefined {
  const r = record(raw); if (!r) return;
  const named = number(r.usedPercent ?? r.used_percent ?? r.percent ?? r.percentage ?? r.includedUsagePercent ?? r.planUsedPercent);
  if (named !== undefined) return named > 0 && named <= 1 ? named * 100 : named;
  const used = number(r.used ?? r.usedUsd ?? r.used_usd ?? r.requestsUsed ?? r.requestUsed);
  const limit = number(r.limit ?? r.limitUsd ?? r.limit_usd ?? r.total ?? r.requestsLimit ?? r.requestLimit);
  if (used !== undefined && limit !== undefined && limit > 0) return used / limit * 100;
}

/** Unofficial cursor.com/api/usage-summary — field names vary; keep this the only parse site. */
export function parseCursorWindows(body: unknown): UsageWindow[] {
  const root = record(body); if (!root) return [];
  const reset = resetMs(root.billingCycleEnd ?? root.billing_cycle_end ?? root.cycleEnd ?? root.resetAt ?? root.resetsAt);
  const out: UsageWindow[] = [];
  const push = (id: string, used: number | undefined, label: string, title: string) => {
    if (used === undefined || !Number.isFinite(used)) return;
    out.push(window(id, used, label, title, reset));
  };
  const plan = usagePercent({
    usedPercent: root.includedUsagePercent ?? root.planUsedPercent ?? root.usedPercent ?? root.included_usage_percent,
  }) ?? usagePercent(root.planUsage ?? root.plan_usage ?? root.individualUsage ?? root.usage ?? root.plan ?? root.included);
  push("plan", plan, "额", "订阅额度");
  push("cursorModels", usagePercent(root.namedModelSelectedUsage ?? root.cursorModels ?? root.cursor_models), "池", "Cursor 模型池");
  push("thirdParty", usagePercent(root.thirdPartyUsage ?? root.third_party ?? root.thirdParty), "三方", "第三方模型池");
  push("onDemand", usagePercent(root.onDemandUsage ?? root.extraUsage ?? root.on_demand ?? root.extra), "额外", "按需额外");
  return out;
}

export function jwtUnexpired(tokenValue: string, now: number, skewMs = 60_000): boolean {
  const parts = tokenValue.split(".");
  if (parts.length < 2) return true;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/") + "==".slice((parts[1].length % 4) || 4);
    const payload = record(JSON.parse(atob(b64)));
    const exp = number(payload?.exp);
    if (exp === undefined) return true;
    const expMs = exp > 10_000_000_000 ? exp : exp * 1000;
    return expMs > now + skewMs;
  } catch {
    return true;
  }
}

export function parseQwenWindows(body: unknown): UsageWindow[] {
  const payload = record(record(record(record(record(body)?.data)?.DataV2)?.data)?.data); if (!payload) return [];
  return [
    window("fiveHour", (number(payload.per5HourPercentage) ?? 0) * 100, "5h", "5小时额度", resetMs(payload.per5HourResetTime)),
    window("weekly", (number(payload.per1WeekPercentage) ?? 0) * 100, "周", "周额度", resetMs(payload.per1WeekResetTime)),
  ];
}

function qwenRequestBody(): string {
  const params = {
    Api: "zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage",
    V: "1.0",
    Data: { cornerstoneParam: { feTraceId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`, feURL: "https://bailian.console.aliyun.com/cn-beijing?tab=plan#/efm/subscription/token-plan/personal", protocol: "V2", console: "ONE_CONSOLE", productCode: "p_efm", switchUserType: 3, domain: "bailian.console.aliyun.com", consoleSite: "BAILIAN_ALIYUN", userNickName: "", userPrincipalName: "", xsp_lang: "en-US" } },
  };
  return new URLSearchParams({ product: "sfm_bailian", action: "BroadScopeAspnGateway", region: "cn-beijing", language: "en-US", params: JSON.stringify(params) }).toString();
}

export function openCodeGoWindows(rows: LocalUsageRow[], now: number): UsageWindow[] {
  const fiveStart = now - 5 * 3600_000;
  const date = new Date(now); const day = (date.getUTCDay() + 6) % 7;
  const weekStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day);
  const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1), monthEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  const fiveRows = rows.filter(row => row.createdMs >= fiveStart && row.createdMs < now);
  const sum = (selected: LocalUsageRow[]) => selected.reduce((total, row) => total + (Number.isFinite(row.cost) && row.cost >= 0 ? row.cost : 0), 0);
  const oldest = Math.min(now, ...fiveRows.map(row => row.createdMs));
  return [
    window("fiveHour", sum(fiveRows) / 12 * 100, "5h", "5小时本机用量", oldest + 5 * 3600_000),
    window("weekly", sum(rows.filter(row => row.createdMs >= weekStart && row.createdMs < weekStart + 7 * 86400_000)) / 30 * 100, "周", "周本机用量", weekStart + 7 * 86400_000),
    window("monthly", sum(rows.filter(row => row.createdMs >= monthStart && row.createdMs < monthEnd)) / 60 * 100, "月", "月本机用量", monthEnd),
  ];
}

const OPEN_CODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

export function parseOpenCodeGoUsage(body: unknown): UsageWindow[] {
  const usage = record(record(body)?.usage); if (!usage) return [];
  const out: UsageWindow[] = [];
  for (const [key, id, label, title] of [["rolling", "fiveHour", "5h", "5小时额度"], ["weekly", "weekly", "周", "周额度"], ["monthly", "monthly", "月", "月额度"]] as const) {
    const entry = record(usage[key]); const percent = number(entry?.percent);
    if (!entry || percent === undefined) continue;
    out.push(window(id, percent, label, title, resetMs(entry.resetsAt)));
  }
  return out;
}

const isRelay = (provider: string) => provider.toLowerCase().includes("relay");
const includes = (...values: string[]) => (provider: string) => !isRelay(provider) && values.some(value => provider.toLowerCase().includes(value));

async function piAuth(ctx: AccountUsageContext) { return ctx.readAuth?.("pi"); }
async function apiKey(ctx: AccountUsageContext, providerIds: string[], envNames: string[]) {
  const fromEnv = envToken(ctx, ...envNames); if (fromEnv) return fromEnv;
  const entry = authEntry(await piAuth(ctx), ...providerIds); return token(entry, "key", "access", "access_token");
}
async function prepaid(ctx: AccountUsageContext, id: string, label: string, url: string, providerIds: string[], envNames: string[], parse: (body: unknown) => AccountBalance | undefined): Promise<AccountUsageSnapshot | undefined> {
  const key = await apiKey(ctx, providerIds, envNames); if (!key) return;
  const balance = parse(await fetchJson(ctx, url, { method: "GET", headers: bearer(key) }));
  return balance ? { provider: id, accountLabel: label, windows: [], balance, source: "prepaid" } : undefined;
}

export const builtinAccountUsageAdapters: AccountUsageAdapter[] = [
  {
    id: "cursor", kind: "subscription", matches: includes("cursor"), async load(ctx) {
      const rawToken = clean(await ctx.readCursorAuth?.());
      const access = rawToken && jwtUnexpired(rawToken, ctx.now()) ? rawToken : undefined;
      // A valid desktop JWT is sufficient and avoids materializing every
      // historical Electron browser partition merely to build an unused
      // Cookie header. Browser cookies remain the fallback when no JWT exists.
      const cookie = access ? undefined : await ctx.readCookie?.("cursor");
      if (!access && !cookie) return;
      const headers: Record<string, string> = { Accept: "application/json" };
      if (access) headers.Authorization = `Bearer ${access}`;
      if (cookie) {
        headers.Cookie = cookie;
        headers.Origin = "https://cursor.com";
        headers.Referer = "https://cursor.com";
      }
      try {
        const windows = parseCursorWindows(await fetchJson(ctx, "https://cursor.com/api/usage-summary", { method: "GET", headers }));
        return windows.length ? { provider: "cursor", accountLabel: "Cursor 账号额度", windows, source: "subscription" } : undefined;
      } catch (error) {
        if (error instanceof UsageError && error.code === "http") return;
        throw error;
      }
    },
  },
  {
    id: "codex", kind: "subscription", matches: includes("openai", "codex"), async load(ctx) {
      const raw = await ctx.readAuth?.("codex"); const root = record(json(raw)); const tokens = record(root?.tokens);
      const access = token(tokens, "access_token", "accessToken") ?? token(root, "OPENAI_API_KEY") ?? token(authEntry(await piAuth(ctx), "openai-codex"), "access", "access_token");
      if (!access) return; const accountId = token(tokens, "account_id", "accountId");
      const headers = bearer(access); if (accountId) headers["ChatGPT-Account-Id"] = accountId;
      const windows = parseCodexWindows(await fetchJson(ctx, "https://chatgpt.com/backend-api/wham/usage", { method: "GET", headers }));
      return windows.length ? { provider: "codex", accountLabel: "Codex 账号额度", windows, source: "subscription" } : undefined;
    },
  },
  {
    id: "claude", kind: "subscription", matches: includes("anthropic", "claude"), async load(ctx) {
      const entry = authEntry(await piAuth(ctx), "anthropic"); const access = token(entry, "access", "access_token"); if (!access) return;
      const windows = parseClaudeWindows(await fetchJson(ctx, "https://api.anthropic.com/api/oauth/usage", { method: "GET", headers: { ...bearer(access), "anthropic-beta": "oauth-2025-04-20", "User-Agent": "claude-code/2.1.0" } }));
      return windows.length ? { provider: "claude", accountLabel: "Claude 账号额度", windows, source: "subscription" } : undefined;
    },
  },
  {
    id: "kimi", kind: "subscription", matches: includes("kimi-coding", "kimi"), async load(ctx) {
      const key = await apiKey(ctx, ["kimi-coding"], ["KIMI_CODE_API_KEY", "KIMI_API_KEY"]); if (!key) return;
      const windows = parseKimiWindows(await fetchJson(ctx, "https://api.kimi.com/coding/v1/usages", { method: "GET", headers: bearer(key) }));
      return windows.length ? { provider: "kimi", accountLabel: "Kimi 账号额度", windows, source: "subscription" } : undefined;
    },
  },
  {
    id: "qwenTokenPlan", kind: "subscription", matches: includes("qwen-token-plan"), async load(ctx) {
      if (!ctx.readCookie) throw new NoDataError("missing-capability");
      const cookie = await ctx.readCookie("qwen-token-plan"); if (!cookie) return;
      const windows = parseQwenWindows(await fetchJson(ctx, "https://bailian-cs.console.aliyun.com/data/api.json?action=BroadScopeAspnGateway&product=sfm_bailian&api=zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage&_v=undefined", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded", Origin: "https://bailian.console.aliyun.com", Referer: "https://bailian.console.aliyun.com" }, body: qwenRequestBody() }));
      if (!windows.length) return;
      // Only a genuinely successful fetch updates the host's cookie cache; a
      // NotLogined/failed response keeps the last-known-good session intact.
      await ctx.persistCookie?.("qwen-token-plan", cookie);
      return { provider: "qwenTokenPlan", accountLabel: "Qwen Token Plan 额度", windows, source: "subscription" };
    },
  },
  {
    id: "opencodeGo", kind: "subscription", matches: includes("opencode-go"), async load(ctx) {
      if (!ctx.readLocalUsage) throw new NoDataError("missing-capability");
      const key = envToken(ctx, "OPENCODE_API_KEY") ?? token(authEntry(await ctx.readAuth?.("opencode"), "opencode-go"), "key");
      if (!key) return;
      try {
        const windows = parseOpenCodeGoUsage(await fetchJson(ctx, OPEN_CODE_GO_USAGE_URL, { method: "GET", headers: bearer(key) }));
        if (windows.length) return { provider: "opencodeGo", accountLabel: "OpenCode Go 额度", windows, source: "subscription" };
      } catch { /* server usage is best-effort; fall through to local rows */ }
      const rows = await ctx.readLocalUsage("opencode-go"); if (!rows || rows.length === 0) return;
      return { provider: "opencodeGo", accountLabel: "OpenCode Go 本机用量", windows: openCodeGoWindows(rows, ctx.now()), source: "local" };
    },
  },
  { id: "deepseek", kind: "prepaid", matches: includes("deepseek"), load: ctx => prepaid(ctx, "deepseek", "账户余额", "https://api.deepseek.com/user/balance", ["deepseek", "deepseek-extended"], ["DEEPSEEK_API_KEY"], parseDeepSeekBalance) },
  { id: "moonshot", kind: "prepaid", matches: includes("moonshot", "moonshotai"), load: ctx => prepaid(ctx, "moonshot", "账户余额", "https://api.moonshot.cn/v1/users/me/balance", ["moonshot", "moonshotai"], ["MOONSHOT_API_KEY", "KIMI_API_KEY"], parseMoonshotBalance) },
  { id: "siliconflow", kind: "prepaid", matches: includes("siliconflow"), load: ctx => prepaid(ctx, "siliconflow", "账户余额", "https://api.siliconflow.cn/v1/user/info", ["siliconflow"], ["SILICONFLOW_API_KEY"], parseSiliconFlowBalance) },
  { id: "openrouter", kind: "prepaid", matches: includes("openrouter"), load: ctx => prepaid(ctx, "openrouter", "账户余额", "https://openrouter.ai/api/v1/credits", ["openrouter"], ["OPENROUTER_API_KEY"], parseOpenRouterBalance) },
];

export class AccountUsageRegistry {
  constructor(readonly adapters: readonly AccountUsageAdapter[] = builtinAccountUsageAdapters) {}
  resolve(provider: string): AccountUsageAdapter | undefined {
    if (isRelay(provider)) return;
    return this.adapters
      .filter(adapter => adapter.matches(provider))
      .sort((a, b) => (a.kind === b.kind ? (b.priority ?? 0) - (a.priority ?? 0) : a.kind === "subscription" ? -1 : 1))[0];
  }
}

export class AccountUsageMonitor {
  private cache = new Map<string, { snapshot: AccountUsageSnapshot; fetchedAt: number }>();
  private inFlight = new Map<string, Promise<AccountUsageResult>>();
  readonly registry: AccountUsageRegistry;
  readonly ctx: AccountUsageContext;
  constructor(capabilities: AccountUsageCapabilities = {}, registry = new AccountUsageRegistry()) {
    this.registry = registry;
    this.ctx = { ...capabilities, fetch: capabilities.fetch ?? fetch, now: capabilities.now ?? Date.now, timeoutMs: capabilities.timeoutMs ?? 15_000 };
  }
  async snapshot(provider: string, force = false): Promise<AccountUsageResult> {
    const adapter = this.registry.resolve(provider); if (!adapter) return { status: "no-data", reason: "unsupported" };
    const cached = this.cache.get(adapter.id), now = this.ctx.now();
    if (cached && !force && now - cached.fetchedAt < ACCOUNT_USAGE_STALE_AFTER_MS) return { status: "ready", snapshot: cached.snapshot, stale: false };
    const pending = this.inFlight.get(adapter.id); if (pending) return pending;
    const task = (async (): Promise<AccountUsageResult> => {
      try {
        const snapshot = await adapter.load(this.ctx);
        if (!snapshot) return cached ? { status: "ready", snapshot: cached.snapshot, stale: true } : { status: "no-data", reason: "missing-credential" };
        this.cache.set(adapter.id, { snapshot, fetchedAt: this.ctx.now() });
        return { status: "ready", snapshot, stale: false };
      } catch (error) {
        if (error instanceof NoDataError) return { status: "no-data", reason: error.reason };
        const code = error instanceof UsageError ? error.code : "network";
        return { status: "error", code, ...(error instanceof UsageError ? { detail: error.message } : {}), ...(cached ? { staleSnapshot: cached.snapshot } : {}) };
      } finally { this.inFlight.delete(adapter.id); }
    })();
    this.inFlight.set(adapter.id, task);
    return task;
  }
}
