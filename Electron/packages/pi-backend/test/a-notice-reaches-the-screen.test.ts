import { spawn } from "node:child_process";
import { appendFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend, HOST_DELIVERED_CUSTOM_TYPES } from "../src/index.js";

/**
 * Contract §55: a notice the host places reaches the screen when it is placed.
 *
 * Every word the host puts in front of the player itself -- the eight service notices and the
 * fallback that carries the turn's own prose -- travels `pi.sendMessage`. Pi delivers such a
 * message as a `message_end` whose message carries `role: "custom"`; it never emits
 * `entry_appended`, which only `pi.appendEntry` does, and which carries a different entry shape
 * (`type: "custom"`, not `type: "custom_message"`).
 *
 * These tests are deliberately placed at the projection layer rather than at the extension seam.
 * The extension seam can only answer "was the message sent", and the message always was: the
 * acceptance for §38.5 counts `coc-delivery` custom messages in the session and has been green
 * throughout. What was never asserted anywhere is the step after it -- that the live projection
 * turns one into a `presentation` event -- and that is the step that was missing. Counting at the
 * seam is why this survived, so the assertion has to live past the seam.
 *
 * The arrival shape below is Pi's, not this suite's invention: see the last test, which pins it to
 * the installed Pi. The fixtures that fabricated an `entry_appended` carrying a `custom_message`
 * described a shape Pi has never emitted, and every test written against them was green about a
 * path that could not run.
 */

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); root = ""; });

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error("condition was not met before timeout");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "pipi-live-delivery-"));
  const agentDir = join(root, "agent");
  const sessionsRoot = join(root, "sessions");
  const cwd = join(root, "project");
  const directory = join(sessionsRoot, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(directory, { recursive: true });
  const sessionPath = join(directory, "s1.jsonl");
  await writeFile(sessionPath, [
    JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-09-16T00:00:00.000Z", cwd }),
    JSON.stringify({ type: "custom", customType: "coc-session", data: { campaign: "campaign-1", home: root, play_language: "zh-Hans", mode: "play" } }),
  ].join("\n") + "\n");
  const backend = createPiHostBackend({
    agentDir,
    sessionsRoot,
    runtimeRoot: root,
    piPath: process.execPath,
    spawn: (_bin, _args, spawnOptions) =>
      spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], spawnOptions) as any,
  });
  const presentations: any[] = [];
  const off = backend.subscribe(event => {
    if (event.channel === "stream" && event.event.type === "presentation") presentations.push(event.event.entry);
  });
  return { backend, sessionPath, presentations, off };
}

/**
 * What Pi does when an extension calls `pi.sendMessage`, in Pi's own order: the row is appended to
 * the transcript first (synchronously, `appendFileSync`), and only then are `message_start` and
 * `message_end` emitted. The emitted message carries no entry id -- Pi discards the id the session
 * manager minted -- so the id the host publishes can only come from the row.
 */
async function deliverLikePi(backend: any, sessionPath: string, row: {
  id: string; customType: string; content: string; details?: Record<string, unknown>; display?: boolean;
}): Promise<void> {
  const live = backend.live.get("s1");
  await appendFile(sessionPath, JSON.stringify({
    type: "custom_message", customType: row.customType, content: row.content,
    display: row.display ?? true, details: row.details,
    id: row.id, parentId: null, timestamp: new Date().toISOString(),
  }) + "\n");
  const message = {
    role: "custom", customType: row.customType, content: row.content,
    display: row.display ?? true, details: row.details, timestamp: Date.now(),
  };
  backend.rpcEvent(live, { type: "message_start", message });
  backend.rpcEvent(live, { type: "message_end", message });
}

/** The §38.9 turn-unfinished notice, as a real table received it (t7 turn 21, 2026-09-16). */
const NOTICE = [
  "这一回合结束时没有交付结果。",
  "已经结算的内容都还在——随便说句话就能继续。",
].join("\n\n");

describe("a notice the host places reaches the screen when it is placed", () => {
  it("projects a host-placed delivery that arrives the way Pi delivers it", async () => {
    const { backend, sessionPath, presentations, off } = await fixture();
    await backend.handle("sendPrompt", ["s1", "hello"]);

    await deliverLikePi(backend, sessionPath, {
      id: "turn-21-unfinished", customType: "coc-delivery", content: NOTICE,
      details: { coc_delivery: true, turn: 21, turn_unfinished: true },
    });

    // The failure this pins: no `presentation` at all, because the host's `message_end` branch
    // answered only `assistant`, `user`, a subagent completion and a stopReason error, and the
    // only projection of a delivery hung off `entry_appended`, which this path never emits.
    await eventually(() => presentations.some(entry => entry.id === "turn-21-unfinished"));
    const projected = presentations.filter(entry => entry.id === "turn-21-unfinished");
    expect(projected).toHaveLength(1);
    // §53: the host wrote it, so it keeps the keeper's side, whole.
    expect(projected[0].role).toBe("assistant");
    expect(projected[0].content).toBe(NOTICE);

    off();
    await backend.close();
  });

  it("covers every channel the host is registered to deliver through, not just the one that broke", async () => {
    // The registry is the whole answer to "whose words are these" (§53). Reading it here is what
    // makes the next host-delivered channel arrive covered instead of arriving broken: a type added
    // to that set without a live projection fails this test on the day it is added.
    expect(HOST_DELIVERED_CUSTOM_TYPES.size).toBeGreaterThan(0);
    for (const customType of HOST_DELIVERED_CUSTOM_TYPES) {
      const { backend, sessionPath, presentations, off } = await fixture();
      try {
        await backend.handle("sendPrompt", ["s1", "hello"]);
        const id = `row-${customType}`;
        await deliverLikePi(backend, sessionPath, { id, customType, content: `words carried by ${customType}` });
        await eventually(() => presentations.some(entry => entry.id === id));
        expect(presentations.filter(entry => entry.id === id), customType).toHaveLength(1);
        expect(presentations.find(entry => entry.id === id).role, customType).toBe("assistant");
      } finally {
        off();
        await backend.close();
      }
    }
  });

  it("publishes the transcript's own id, so the catch-up and a later re-read do not double it", async () => {
    const { backend, sessionPath, presentations, off } = await fixture();
    await backend.handle("sendPrompt", ["s1", "hello"]);
    const before = (await stat(sessionPath)).size;

    await deliverLikePi(backend, sessionPath, {
      id: "turn-22-outage", customType: "coc-delivery", content: "The keeper's service is unreachable.",
      details: { coc_delivery: true, turn: 22, provider_outage: true },
    });
    await eventually(() => presentations.some(entry => entry.id === "turn-22-outage"));

    // A watchdog replacement starts by replaying the same bytes. Both readings are of one row, so
    // the player must see it once -- which only holds because the live projection published the
    // row's own id rather than minting one.
    await (backend as any).projectHostDeliveries((backend as any).live.get("s1"), before);
    expect(presentations.filter(entry => entry.id === "turn-22-outage")).toHaveLength(1);

    const written = (await readFile(sessionPath, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    const row = written.find((entry: any) => entry.id === "turn-22-outage");
    expect(row.type).toBe("custom_message");

    off();
    await backend.close();
  });

  it("pins the arrival shape to the installed Pi, so this fixture cannot drift back into fiction", async () => {
    // The previous fixture for this path fabricated `entry_appended` carrying a `custom_message`
    // entry. Pi emits no such event: `entry_appended` is emitted from one place, the `appendEntry`
    // runtime member, and the entry it carries is the `type: "custom"` kind. Read the dependency
    // rather than trusting a hand-written fixture; an upgrade that changes this must fail here and
    // be re-checked, not be discovered on a table.
    // Two copies of Pi are installed: the one `bin/pi-coc` runs, at the repository root, and the
    // one this package resolves. They are different versions, so both are checked -- whichever the
    // product ends up loading, the claim has to hold.
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))),
      join(here, "..", "..", "..", "..", "node_modules", "@earendil-works", "pi-coding-agent", "dist"),
    ];
    let checked = 0;
    for (const dist of candidates) {
      const source = await readFile(join(dist, "core", "agent-session.js"), "utf8").catch(() => undefined);
      if (source === undefined) continue;
      checked += 1;
      // A host-sent custom message is written as a `custom_message` entry and announced as a
      // message, with the role the host's projection branches on.
      expect(source, dist).toContain("appendCustomMessageEntry");
      expect(source, dist).toContain('role: "custom"');
      // ...and `entry_appended` is emitted from exactly one place, the `appendEntry` runtime
      // member, which writes the other kind of entry. Nothing a host delivers travels it.
      expect(source.match(/entry_appended/g) ?? [], dist).toHaveLength(1);
      expect(source.slice(Math.max(0, source.indexOf("entry_appended") - 400), source.indexOf("entry_appended")), dist)
        .toContain("appendEntry:");
    }
    expect(checked, "at least one installed Pi was read").toBeGreaterThan(0);
  });
});
