import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KERNEL_MOUNTS, kernelMount } from "../src/kernel-mounts.js";
import {
  installRegistry,
  parseRequests,
  pollLoop,
  runRequest,
  EXT_INVOKE_REGISTRY_KEY,
  type ExtInvokeRegistry,
} from "../../../resources/runtime/kernel/pipiui-ext-invoke.ts";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("the ext-invoke kernel mount", () => {
  it("is mounted before every extension package so a handler is registered by the time a panel asks", () => {
    const entry = kernelMount("ext-invoke");
    expect(entry.file).toEqual(["kernel", "pipiui-ext-invoke.ts"]);
    expect(entry.contribution).toMatchObject({ kind: "mount", env: "PIPIUI_EXT_INVOKE_EXT" });
    // Kernel mounts below the registered-extension threshold load first (spawn-assembly).
    expect((entry.contribution as { order: number }).order).toBeLessThan(50);
    const order = KERNEL_MOUNTS.filter((m) => m.contribution.kind === "mount").map((m) => m.id);
    expect(order.indexOf("ext-invoke")).toBeGreaterThan(-1);
  });

  it("publishes one registry per process under the well-known symbol", () => {
    const host: Record<symbol, unknown> = {};
    const first = installRegistry(host);
    const second = installRegistry(host);
    expect(second).toBe(first);
    expect(host[EXT_INVOKE_REGISTRY_KEY]).toBe(first);
    expect(first.version).toBe(1);
    const dispose = first.register("pack", "ping", () => "pong");
    expect(first.resolve("pack", "ping")).toBeTypeOf("function");
    expect(first.resolve("other", "ping")).toBeUndefined();
    dispose();
    expect(first.resolve("pack", "ping")).toBeUndefined();
  });
});

describe("running one invoke request", () => {
  const registryWith = (handlers: Record<string, (params: unknown) => unknown>): ExtInvokeRegistry => {
    const registry = installRegistry({});
    for (const [method, handler] of Object.entries(handlers)) registry.register("pack", method, handler);
    return registry;
  };

  it("accepts both a bare value and the panel envelope, and reports a throw as agent_error", async () => {
    const registry = registryWith({
      bare: () => ({ manuscripts: [1] }),
      envelope: () => ({ ok: true, data: { listed: true } }),
      refused: () => ({ ok: false, error: { code: "not_found", message: "no such manuscript" } }),
      broken: () => { throw new Error("tectonic missing"); },
    });
    expect(await runRequest({ requestId: "r1", extensionId: "pack", method: "bare" }, registry)).toEqual({ requestId: "r1", ok: true, data: { manuscripts: [1] } });
    expect(await runRequest({ requestId: "r2", extensionId: "pack", method: "envelope" }, registry)).toEqual({ requestId: "r2", ok: true, data: { listed: true } });
    expect(await runRequest({ requestId: "r3", extensionId: "pack", method: "refused" }, registry)).toEqual({ requestId: "r3", ok: false, code: "not_found", error: "no such manuscript" });
    expect(await runRequest({ requestId: "r4", extensionId: "pack", method: "broken" }, registry)).toMatchObject({ ok: false, code: "agent_error", error: "tectonic missing" });
  });

  it("answers not_found for a method (or package) that registered nothing", async () => {
    const registry = registryWith({});
    expect(await runRequest({ requestId: "r5", extensionId: "pack", method: "nope" }, registry)).toMatchObject({ ok: false, code: "not_found" });
  });

  it("ignores malformed poll payloads instead of dispatching them", () => {
    expect(parseRequests(undefined)).toEqual([]);
    expect(parseRequests({ requests: [{ requestId: 1 }, { extensionId: "p", method: "m" }, null] })).toEqual([]);
    expect(parseRequests({ requests: [{ requestId: "r", extensionId: "p", method: "m", params: { a: 1 } }] })).toHaveLength(1);
  });
});

describe("the poll loop", () => {
  it("posts each handler result back with its request id", async () => {
    const registry = installRegistry({});
    registry.register("pack", "ping", (params) => ({ echoed: params }));
    const posted: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body)) as { action: string; event: Record<string, unknown> };
      if (body.action === "ext_invoke_poll") {
        return { ok: true, json: async () => ({ ok: true, result: { requests: [{ requestId: "r1", extensionId: "pack", method: "ping", params: { x: 1 } }] } }) } as unknown as Response;
      }
      posted.push(body.event);
      return { ok: true, json: async () => ({ ok: true, result: {} }) } as unknown as Response;
    }) as unknown as typeof fetch;
    await pollLoop({ config: { port: "1", capability: "cap" }, lookup: registry, fetchImpl, signal: new AbortController().signal, maxPolls: 1 });
    expect(posted).toEqual([{ requestId: "r1", ok: true, data: { echoed: { x: 1 } } }]);
  });

  it("backs off instead of spinning when the bridge is unreachable, and stops when aborted", async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetchImpl = vi.fn(async () => { calls += 1; controller.abort(); throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    await pollLoop({ config: { port: "1", capability: "cap" }, fetchImpl, signal: controller.signal, retryDelayMs: 5 });
    expect(calls).toBe(1);
  });
});

describe("host side of the channel", () => {
  async function backend() {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-invoke-"));
    await mkdir(join(root, "agent"), { recursive: true });
    const { createPiHostBackend } = await import("../src/index.js");
    return createPiHostBackend({ agentDir: join(root, "agent") });
  }

  it("refuses an invoke with no live session rather than queueing it forever", async () => {
    const host = await backend();
    const result = await host.handle("invokeExtension" as never, ["latex-workbench", "manuscripts", {}]);
    expect(result).toMatchObject({ ok: false, error: { code: expect.stringMatching(/not_found|no_session/) } });
    await host.close();
  });
});
