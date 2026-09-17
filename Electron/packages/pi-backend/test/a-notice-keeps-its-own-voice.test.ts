import { spawn } from "node:child_process";
import { appendFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend, HOST_DELIVERED_CUSTOM_TYPES } from "../src/index.js";

/**
 * Contract §83, the writing end: the transcript carries who placed a row, not only which side.
 *
 * §53 gave a host-placed notice the Keeper's side of the table, and §55 made it arrive live. Both
 * are right, and together they left the re-read unable to tell the host's own sentence from the
 * Keeper's: `role: "assistant"` is all that reached the transcript's assembly rules, so a notice
 * landing after a Keeper turn that ran tools and delivered nothing was folded into that turn's
 * card -- the host's out-of-fiction line printed as the Keeper's words, and the Keeper's card id
 * replaced by the notice's (see the UI case, which measures what that cost on H-SIDE t4 turn 109).
 *
 * The registry is the one answer to "whose words are these", so the mark is read off it here, once,
 * for every channel in it -- a channel added to that set arrives marked on the day it is added.
 *
 * The arrival below is Pi's own: the row is appended to the transcript first, and the message is
 * then announced with `role: "custom"` carrying no entry id. `a-notice-reaches-the-screen.test.ts`
 * pins that shape to the installed Pi.
 */

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); root = ""; });

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "pipi-notice-voice-"));
  const agentDir = join(root, "agent");
  const sessionsRoot = join(root, "sessions");
  const cwd = join(root, "project");
  const directory = join(sessionsRoot, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(directory, { recursive: true });
  const sessionPath = join(directory, "s1.jsonl");
  await writeFile(sessionPath, [
    JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-09-17T00:00:00.000Z", cwd }),
    JSON.stringify({ type: "custom", customType: "coc-session", data: { campaign: "campaign-1", home: root, play_language: "en", mode: "play" } }),
  ].join("\n") + "\n");
  const backend = createPiHostBackend({
    agentDir,
    sessionsRoot,
    runtimeRoot: root,
    piPath: process.execPath,
    spawn: (_bin, _args, spawnOptions) =>
      spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], spawnOptions) as any,
  });
  return { backend: backend as any, sessionPath };
}

/**
 * A custom-message row, written the way Pi writes one, and announced the way Pi announces it.
 *
 * The rows are chained by `parentId`, as a real transcript is: history reads the leaf branch, so a
 * row hanging off nothing is not in the page at all and would make this assert about an empty set.
 */
async function place(backend: any, sessionPath: string, row: {
  id: string; customType: string; content: string; display?: boolean; parentId: string | null;
}): Promise<void> {
  await appendFile(sessionPath, JSON.stringify({
    type: "custom_message", customType: row.customType, content: row.content,
    display: row.display ?? true, details: { turn: 21 },
    id: row.id, parentId: row.parentId, timestamp: new Date().toISOString(),
  }) + "\n");
  const message = { role: "custom", customType: row.customType, content: row.content, display: row.display ?? true, timestamp: Date.now() };
  backend.rpcEvent(backend.live.get("s1"), { type: "message_start", message });
  backend.rpcEvent(backend.live.get("s1"), { type: "message_end", message });
}

/** The id of the last row on disk, so a placed row joins the branch history actually reads. */
async function tailId(sessionPath: string): Promise<string | null> {
  const rows = (await readFile(sessionPath, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  for (let index = rows.length - 1; index >= 0; index--) {
    if (typeof rows[index].id === "string") return rows[index].id;
  }
  return null;
}

describe("the transcript says who placed a row, not only which side it is on", () => {
  it("marks every channel the host is registered to deliver through", async () => {
    const { backend, sessionPath } = await fixture();
    try {
      await backend.handle("sendPrompt", ["s1", "hello"]);
      expect(HOST_DELIVERED_CUSTOM_TYPES.size).toBeGreaterThan(0);
      for (const customType of HOST_DELIVERED_CUSTOM_TYPES) {
        await place(backend, sessionPath, { id: `row-${customType}`, customType,
          content: `words carried by ${customType}`, parentId: await tailId(sessionPath) });
      }
      const entries = await backend.handle("getSessionHistory", ["s1", 0, 500]);
      for (const customType of HOST_DELIVERED_CUSTOM_TYPES) {
        const entry = entries.find((row: any) => row.id === `row-${customType}`);
        expect(entry, customType).toBeTruthy();
        // §53: the Keeper's side of the table...
        expect(entry.role, customType).toBe("assistant");
        // ...and §83: the host's own voice on it.
        expect(entry.placedByHost, customType).toBe(true);
      }
    } finally {
      await backend.close();
    }
  });

  it("does not mark a custom message the host did not place", async () => {
    // The other kind of visible custom message stands in for the player's own turn. Marking that
    // would hand the exemption to a row the merge rule is right about.
    const { backend, sessionPath } = await fixture();
    try {
      await backend.handle("sendPrompt", ["s1", "hello"]);
      await place(backend, sessionPath, {
        id: "subagent-1", customType: "pipiui-subagent-complete-v1", content: "the background task finished",
        parentId: await tailId(sessionPath),
      });
      const entries = await backend.handle("getSessionHistory", ["s1", 0, 500]);
      const entry = entries.find((row: any) => row.id === "subagent-1");
      expect(entry).toBeTruthy();
      expect(entry.role).toBe("user");
      expect(entry.placedByHost).toBeUndefined();
    } finally {
      await backend.close();
    }
  });
});
