import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { QuotaStore, quotaProviderFor } from "../src/quota.js";
import { captureFlapcodeRateLimitHeaders, resetRateLimitCaptureForTests } from "../../../../extensions/flapcode/agent/quota.js";

describe("Flapcode captured quota reaches the host", () => {
  it("reads the extension's weekly snapshot and refreshes it without a network probe", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "flapcode-quota-host-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    const fetcher = vi.fn(async () => { throw new Error("Quota must use captured headers"); });
    let now = Date.UTC(2026, 9, 1, 12);
    try {
      process.env.PI_CODING_AGENT_DIR = agentDir;
      resetRateLimitCaptureForTests();
      const headers = {
        "x-codex-primary-used-percent": "41",
        "x-codex-primary-window-minutes": "10080",
        "x-codex-primary-reset-at": "1791049084",
        "x-codex-secondary-used-percent": "0",
        "x-codex-secondary-window-minutes": "0",
      };
      captureFlapcodeRateLimitHeaders(headers, now);
      expect(JSON.parse(await readFile(join(agentDir, "flapcode-rate-limits.json"), "utf8")).primary.usedPercent).toBe(41);
      const store = new QuotaStore({}, { agentDir, fetch: fetcher, now: () => now });
      expect(quotaProviderFor("flapcode")).toBe("flapcode");
      expect(await store.snapshot("flapcode")).toMatchObject({
        provider: "flapcode",
        windows: [{ label: "周", usedPercent: 41, resetsAt: 1791049084000 }],
      });
      expect((await store.snapshot("flapcode"))?.windows).toHaveLength(1);

      now += 31_000;
      captureFlapcodeRateLimitHeaders({ ...headers,
        "x-codex-primary-used-percent": "52",
        "x-codex-secondary-used-percent": "8",
        "x-codex-secondary-window-minutes": "300",
      }, now);
      expect((await store.snapshot("flapcode", true))?.windows.map(window => [window.label, window.usedPercent])).toEqual([["周", 52], ["5h", 8]]);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
      resetRateLimitCaptureForTests();
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it("keeps missing and malformed quota snapshots unavailable", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "flapcode-quota-missing-"));
    try {
      const store = new QuotaStore({}, { agentDir });
      expect(await store.snapshot("flapcode")).toBeNull();
      for (const content of ["not json", "{}", '{"primary":{"usedPercent":"invalid"}}']) {
        await writeFile(join(agentDir, "flapcode-rate-limits.json"), content);
        expect(await store.snapshot("flapcode", true)).toBeNull();
      }
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });
});
