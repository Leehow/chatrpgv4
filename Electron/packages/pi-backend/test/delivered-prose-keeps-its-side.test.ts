import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPiHostBackend, projectPiSessionsDir } from "../src/index.js";

/**
 * Contract §53: a text the host delivered to the player is the keeper's side of the transcript.
 *
 * The live stream and the re-read of the same file are two projections of one entry, and they used
 * to disagree about whose words a `coc-delivery` carries: the stream stamped it `assistant`, the
 * re-read stamped it `user`. Everything downstream that branches on the speaker then behaved
 * differently on the second reading -- the player-message collapse rule is the one that cost a real
 * table four paragraphs of a delivery it had already read (t9 turn 36, 2026-09-16).
 *
 * So the assertion is about the speaker, not about any word in the text: whoever wrote the entry
 * decides which side it lands on, and the channel it arrived through is what says who wrote it.
 */

/** Six paragraphs: past the five-line collapse rule a player's own message is clipped by. */
const DELIVERY = [
  "The clerk follows your finger to the stack of leases and his mouth tightens.",
  "「I am not the records office, friend.」",
  "He pulls the drawer open and drops a thin folder on the ledger.",
  "Further down there are two or three older short-term drafts, forwarding address blank.",
  "「That is all of it. They moved out alive; the head of the house went into the asylum.」",
  "The pen is left where you can reach it.",
].join("\n\n");

const OPENING = "The house on the hill has been empty for a year.";
const SUBAGENT_NOTE = "PIPIUI_SUBAGENT_COMPLETE\nreport body";

function sessionRows(id: string, cwd: string): string {
  const rows: unknown[] = [
    { type: "session", version: 3, id, timestamp: "2026-09-16T00:00:00.000Z", cwd },
    { type: "session_info", id: `${id}-name`, parentId: null, timestamp: "2026-09-16T00:00:00.001Z", name: `Session ${id}` },
    {
      type: "custom_message", customType: "coc-setup-opening", display: true,
      id: `${id}-opening`, parentId: `${id}-name`, timestamp: "2026-09-16T00:00:01.000Z",
      content: OPENING,
    },
    {
      type: "message", id: `${id}-player`, parentId: `${id}-opening`, timestamp: "2026-09-16T00:00:02.000Z",
      message: { role: "user", content: "I ask him for the leases." },
    },
    {
      type: "custom_message", customType: "coc-delivery", display: true,
      id: `${id}-delivery`, parentId: `${id}-player`, timestamp: "2026-09-16T00:00:03.000Z",
      content: DELIVERY, details: { coc_delivery: true, turn: 36 },
    },
    {
      type: "custom_message", customType: "pipiui-subagent-complete-v1", display: true,
      id: `${id}-subagent`, parentId: `${id}-delivery`, timestamp: "2026-09-16T00:00:04.000Z",
      content: SUBAGENT_NOTE,
    },
  ];
  return rows.map(row => JSON.stringify(row)).join("\n") + "\n";
}

describe("a delivery the player already read keeps the keeper's side of the transcript", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  });

  it("re-reads a host-placed delivery as the keeper's words, whole", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-delivered-prose-"));
    const project = join(root, "project");
    const sessionsDir = projectPiSessionsDir(project);
    await mkdir(sessionsDir, { recursive: true });
    const id = "1f2e3d4c-0000-4000-8000-00000000abcd";
    await writeFile(join(sessionsDir, `2026-09-16T00-00-00-000Z_${id}.jsonl`), sessionRows(id, project));

    const backend = createPiHostBackend({
      agentDir: join(root, "profile"),
      sessionsRoot: join(root, "profile", "sessions"),
      profileMode: "isolated",
    });
    try {
      await backend.handle("setProjectPaths", [[project]]);
      const [listedProject] = await backend.handle("listProjects", []) as Array<{ id: string }>;
      await backend.handle("listSessionPage" as never, [listedProject.id, undefined, 10]);

      const entries = await backend.handle("getSessionHistory" as never, [id, 0, 500]) as Array<{
        id: string; role: string; content: string;
      }>;
      const byId = new Map(entries.map(entry => [entry.id, entry]));

      const delivery = byId.get(`${id}-delivery`);
      expect(delivery, "the delivery reaches the re-read at all").toBeTruthy();
      // The failure this pins: as `user` the transcript hands it to the player-message collapse
      // rule, which keeps five lines -- three of these six paragraphs -- and cuts on a full stop,
      // so the player cannot tell anything is missing.
      expect(delivery!.role).toBe("assistant");
      expect(delivery!.content).toBe(DELIVERY);

      // The opening narration is the same kind of text through the same kind of channel.
      expect(byId.get(`${id}-opening`)?.role).toBe("assistant");

      // ...and a message the host injects on the player's behalf is still the player's turn: the
      // rule is who wrote it, so it must not sweep up every visible custom message.
      expect(byId.get(`${id}-subagent`)?.role).toBe("user");
    } finally {
      await backend.close();
    }
  }, 60_000);
});
