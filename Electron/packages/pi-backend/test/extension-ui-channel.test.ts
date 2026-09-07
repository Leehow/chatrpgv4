import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { PIPI_HOST_PROTOCOL_VERSION } from "@pipi/host-api";
import { createPiHostBackend } from "../src/index.js";
import {
  EXTUI_CHANNEL,
  EXTUI_DIALOG_TIMEOUT_MS,
  EXTUI_TIMEOUT_MS,
  ExtensionUiChannel,
  kindFromMethod,
  mapExtensionUiRequest,
  needsResponse,
} from "../src/extension-ui-channel.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

const fakePi = new URL("./fake-pi-extui.mjs", import.meta.url).pathname;

async function seedSession(cwd: string, sessionsRoot: string) {
  const dir = join(sessionsRoot, "project");
  await mkdir(dir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeFile(
    join(dir, "session.jsonl"),
    `${JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd })}\n`,
  );
}

function backendFor(dirs: {
  agent: string;
  sessions: string;
  runtime: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}) {
  return createPiHostBackend({
    agentDir: dirs.agent,
    sessionsRoot: dirs.sessions,
    runtimeRoot: dirs.runtime,
    piPath: "node",
    extensionUiTimeoutMs: dirs.timeoutMs,
    spawn: (_bin, _args, options) =>
      spawn(process.execPath, [fakePi], {
        ...options,
        env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin", ...dirs.env },
      }) as any,
  });
}

async function waitUntil<T>(pick: () => T | undefined | Promise<T | undefined>, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await pick();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("extension_ui mapping", () => {
  it("maps notify/widget as fire-and-forget and dialogs as pending kinds", () => {
    const notify = mapExtensionUiRequest("s1", {
      type: "extension_ui_request",
      id: "n1",
      method: "notify",
      message: "hi",
    });
    expect(notify).toMatchObject({
      protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
      channel: EXTUI_CHANNEL,
      event: { type: "request", sessionId: "s1", requestId: "n1", kind: "notify", payload: { message: "hi" } },
    });
    expect(needsResponse("notify")).toBe(false);
    expect(kindFromMethod("setWidget")).toBe("widget");
    expect(needsResponse("widget")).toBe(false);
    expect(needsResponse("confirm")).toBe(true);
  });

  it("times out dialogs, emits cancel, and rejects a late respond", async () => {
    const events: unknown[] = [];
    const writes: unknown[] = [];
    const channel = new ExtensionUiChannel({
      emit: (event) => events.push(event),
      writeResponse: (sessionId, body) => writes.push({ sessionId, body }),
      timeoutMs: 30,
    });
    expect(
      channel.handleRpc("s1", { type: "extension_ui_request", id: "r1", method: "confirm", title: "x" }),
    ).toBe(true);
    await waitUntil(
      () => events.find((e: any) => e.event?.type === "cancel" && e.event.requestId === "r1") as any,
    );
    expect(writes).toEqual([
      { sessionId: "s1", body: { type: "extension_ui_response", id: "r1", cancelled: true } },
    ]);
    expect(channel.respond("s1", "r1", { confirmed: true })).toEqual({ ok: false, error: "late" });
    channel.dispose();
  });
});

describe("extension_ui fake-pi host wiring", () => {
  it("passes notify/widget through as HostEvent and round-trips confirm/select/input", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-extui-ok-"));
    const cwd = join(root, "project");
    const sessions = join(root, "sessions");
    const extuiLog = join(root, "extui.log");
    await seedSession(cwd, sessions);
    const backend = backendFor({
      agent: join(root, "agent"),
      sessions,
      runtime: join(root, "runtime"),
      env: { FAKE_PI_EXTUI_LOG: extuiLog },
    });
    const events: any[] = [];
    backend.subscribe((event) => events.push(event));
    await backend.handle("addProject", [cwd]);

    await backend.handle("sendPrompt", ["session-1", "__extui_notify__"]);
    const notify = await waitUntil(() =>
      events.find((e) => e.channel === "extui" && e.event.kind === "notify" && e.event.type === "request"),
    );
    expect(notify).toMatchObject({
      protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
      channel: "extui",
      event: {
        type: "request",
        sessionId: "session-1",
        requestId: "ui-notify-1",
        kind: "notify",
        payload: { message: "hi", notifyType: "info" },
      },
    });

    await backend.handle("sendPrompt", ["session-1", "__extui_widget__"]);
    const widget = await waitUntil(() =>
      events.find((e) => e.channel === "extui" && e.event.kind === "widget" && e.event.requestId === "ui-widget-1"),
    );
    expect(widget.event.payload).toMatchObject({ widgetKey: "demo", widgetLines: ["line"] });

    await backend.handle("sendPrompt", ["session-1", "__extui_confirm__"]);
    await waitUntil(() =>
      events.find((e) => e.channel === "extui" && e.event.requestId === "ui-confirm-1" && e.event.type === "request"),
    );
    await backend.handle("extensionUiResponse" as never, [
      "session-1",
      "ui-confirm-1",
      { confirmed: true },
    ]);

    await backend.handle("sendPrompt", ["session-1", "__extui_select__"]);
    await waitUntil(() =>
      events.find((e) => e.channel === "extui" && e.event.requestId === "ui-select-1" && e.event.type === "request"),
    );
    await backend.handle("extensionUiResponse" as never, [
      "session-1",
      "ui-select-1",
      { value: "Allow" },
    ]);

    await backend.handle("sendPrompt", ["session-1", "__extui_input__"]);
    await waitUntil(() =>
      events.find((e) => e.channel === "extui" && e.event.requestId === "ui-input-1" && e.event.type === "request"),
    );
    await backend.handle("extensionUiResponse" as never, [
      "session-1",
      "ui-input-1",
      { value: "Ada" },
    ]);

    const log = await waitUntil(async () => {
      const text = await readFile(extuiLog, "utf8").catch(() => "");
      return text.includes("ui-input-1") ? text : undefined;
    });
    const lines = log
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toEqual(
      expect.arrayContaining([
        { type: "extension_ui_response", id: "ui-confirm-1", confirmed: true },
        { type: "extension_ui_response", id: "ui-select-1", value: "Allow" },
        { type: "extension_ui_response", id: "ui-input-1", value: "Ada" },
      ]),
    );
    await backend.close();
  });

  it("rejects a renderer response after session abort and after timeout", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-extui-late-"));
    const cwd = join(root, "project");
    const sessions = join(root, "sessions");
    const extuiLog = join(root, "extui.log");
    await seedSession(cwd, sessions);
    const backend = backendFor({
      agent: join(root, "agent"),
      sessions,
      runtime: join(root, "runtime"),
      timeoutMs: 80,
      env: { FAKE_PI_EXTUI_LOG: extuiLog },
    });
    const events: any[] = [];
    backend.subscribe((event) => events.push(event));
    await backend.handle("addProject", [cwd]);

    await backend.handle("sendPrompt", ["session-1", "__extui_confirm__"]);
    await waitUntil(() =>
      events.find((e) => e.channel === "extui" && e.event.requestId === "ui-confirm-1" && e.event.type === "request"),
    );
    await backend.handle("stop", ["session-1"]);
    const aborted = await waitUntil(() =>
      events.find(
        (e) =>
          e.channel === "extui" &&
          e.event.type === "cancel" &&
          e.event.requestId === "ui-confirm-1" &&
          e.event.reason === "aborted",
      ),
    );
    expect(aborted.event.sessionId).toBe("session-1");
    await expect(
      backend.handle("extensionUiResponse" as never, ["session-1", "ui-confirm-1", { confirmed: true }]),
    ).rejects.toThrow(/rejected: late/);

    events.length = 0;
    await backend.handle("sendPrompt", ["session-1", "__extui_select__"]);
    await waitUntil(() =>
      events.find((e) => e.channel === "extui" && e.event.requestId === "ui-select-1" && e.event.type === "request"),
    );
    const timed = await waitUntil(() =>
      events.find(
        (e) =>
          e.channel === "extui" &&
          e.event.type === "cancel" &&
          e.event.requestId === "ui-select-1" &&
          e.event.reason === "timeout",
      ),
    );
    expect(timed.event.sessionId).toBe("session-1");
    await expect(
      backend.handle("extensionUiResponse" as never, ["session-1", "ui-select-1", { value: "Allow" }]),
    ).rejects.toThrow(/rejected: late/);
    await backend.close();
  });

  it("does not cut a dialog short: reading a plan preview takes longer than a notify", async () => {
    // 原来所有请求一律 30 秒。而一个 confirm 常带着要读完才能决定的正文——Hydra 的
    // Execution Preview 就是目标、逐步的临时改动、交还状态。人还在读，计时器先到了，
    // 扩展收到的取消和"用户点了取消"长得一模一样，于是 agent 会认真分析"你是不是对
    // 计划有顾虑"，其实你只是在读。实测就这么发生过三次。
    //
    // 这里不给 timeoutMs：走真实的按类型分档，确认必须**不**在短档内被取消。
    const events: unknown[] = [];
    const channel = new ExtensionUiChannel({
      emit: (event) => events.push(event),
      writeResponse: () => undefined,
    });
    expect(
      channel.handleRpc("s1", { type: "extension_ui_request", id: "r-dialog", method: "confirm", title: "确认执行？" }),
    ).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const cancelled = events.some(
      (event) => (event as { event?: { type?: string; requestId?: string } }).event?.type === "cancel"
        && (event as { event?: { requestId?: string } }).event?.requestId === "r-dialog",
    );
    expect(cancelled).toBe(false);
    channel.dispose();
  });

  it("lets the extension declare how long its own dialog needs", async () => {
    // 知道那份正文要读多久的是扩展，不是宿主。pi 的 ui.confirm(title, message, { timeout })
    // 会把声明带过来；宿主按类型猜只是没人声明时的退路。
    const events: unknown[] = [];
    const channel = new ExtensionUiChannel({
      emit: (event) => events.push(event),
      writeResponse: () => undefined,
    });
    channel.handleRpc("s1", {
      type: "extension_ui_request", id: "r-short", method: "confirm", title: "秒答即可", timeout: 1_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const cancelled = events.some(
      (event) => (event as { event?: { type?: string; requestId?: string } }).event?.type === "cancel"
        && (event as { event?: { requestId?: string } }).event?.requestId === "r-short",
    );
    // 声明了 1 秒就该 1 秒到期，而不是被拉到对话默认的 30 分钟
    expect(cancelled).toBe(true);
    channel.dispose();
  });

  it("never lets the backend fill in a default that masquerades as explicit config", async () => {
    // 差点白改一整轮。宿主原来写：
    //     timeoutMs: options.extensionUiTimeoutMs ?? EXTUI_TIMEOUT_MS
    // 没人配置时也把 30 秒填了进来。通道于是分不清"调用方要求 30 秒"和"没人要求"，
    // 把它当显式指定、压过按类型分档和扩展自己声明的时长——改了等于没改，确认框照旧
    // 30 秒被掐（2026-09-05 实测：一次 hydra_execute_plan 共 37 秒，其中 30 秒是它）。
    //
    // 这条钉在源码上：通道测试构造通道时不经过 index.ts，行为断言看不见这行兜底。
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
    const wiring = source.match(/timeoutMs: options\.extensionUiTimeoutMs[^,\n]*/)?.[0] ?? "";
    expect(wiring).toBe("timeoutMs: options.extensionUiTimeoutMs");
  });

  it("leaves a dialog alone when nobody configured a timeout", async () => {
    // 不传 timeoutMs 时，对话必须走长档，而不是回落到通知那一档。
    const events: unknown[] = [];
    const channel = new ExtensionUiChannel({
      emit: (event) => events.push(event),
      writeResponse: () => undefined,
      timeoutMs: undefined,
    });
    channel.handleRpc("s1", { type: "extension_ui_request", id: "r-default", method: "confirm", title: "x" });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(events.some(
      (event) => (event as { event?: { type?: string; requestId?: string } }).event?.type === "cancel"
        && (event as { event?: { requestId?: string } }).event?.requestId === "r-default",
    )).toBe(false);
    channel.dispose();
  });

  it("still bounds a dialog rather than leaking it forever", () => {
    // 给足时间不等于不管：窗口关了、渲染端不答，挂起项也必须有终点。
    expect(EXTUI_DIALOG_TIMEOUT_MS).toBeGreaterThan(EXTUI_TIMEOUT_MS);
    expect(Number.isFinite(EXTUI_DIALOG_TIMEOUT_MS)).toBe(true);
  });
});
