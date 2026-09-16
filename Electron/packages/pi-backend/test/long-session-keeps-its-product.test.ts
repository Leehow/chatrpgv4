import { afterEach, describe, expect, it, vi } from "vitest";
import { appendFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPiHostBackend } from "../src/index.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";

/**
 * §65. A table that is played long enough writes a session JSONL past the
 * host's 4 MB `SESSION_MANAGER_MAX_BYTES`. The real 68-turn table that
 * prompted this was 8.1 MB; a healthy table alongside it was 4.9 MB and over
 * the same bound. Neither size may cost the table its product: the session
 * must still report which pack it belongs to, its history must still page,
 * and nothing may report it as skipped — that warning described a decision
 * `readHistory` never made and sent two investigations after a phantom.
 *
 * The oversized file here is grown through the product's own writes (a real
 * `newSession`, then real message rows appended to it), not hand-forged small
 * and declared large.
 */

const PACK_ID = "coc-keeper";
let root = "";

afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function installPack(agentDir: string): Promise<void> {
  const directory = join(agentDir, "extensions", PACK_ID);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "pipiui-extension.json"), JSON.stringify({
    id: PACK_ID,
    name: "COC Keeper",
    version: "0.1.0",
    defaultEnabled: false,
    capabilities: [],
    app: {
      ui: {
        layout: { primarySidebar: "pipi.sessions", center: "pipi.conversation", auxiliarySidebar: "coc.mods" },
        panels: [{ slot: "toolPanel", id: "coc.mods", title: "Mods", entry: "mods-panel.js" }],
      },
    },
  }));
  await writeFile(join(directory, "mods-panel.js"), "export default function mount() {}\n");
}

/**
 * `where: "project"` installs the pack under the project's own `.pi`, which is
 * how a table's product actually reaches it and the only case the shared
 * scanner can lose: a scan pointed anywhere else no longer has the pack in its
 * registry, and the enablement resolver then answers `base`.
 */
async function fixture(where: "app" | "project" = "app") {
  root = await mkdtemp(join(tmpdir(), "pipi-long-session-"));
  const project = join(root, "project");
  await mkdir(project, { recursive: true });
  if (where === "app") await installPack(join(root, "agent"));
  else {
    await installPack(projectPiAgentDir(project));
    await writeFile(join(projectPiAgentDir(project), "ext-enabled.json"), JSON.stringify({
      schemaVersion: 3,
      overrides: { [PACK_ID]: "enabled" },
    }));
  }
  const backend = createPiHostBackend({
    agentDir: join(root, "agent"),
    sessionsRoot: join(root, "sessions"),
    runtimeRoot: join(root, "runtime"),
    profileMode: "default",
    defaultPack: PACK_ID,
    piPath: "node",
    spawn: () => {
      throw new Error("no Pi process is needed for product identity");
    },
  } as never);
  await backend.handle("addProject", [project]);
  const projects = await backend.handle("listProjects", []) as { id: string }[];
  return { backend, project, projectId: projects[0]!.id };
}

/**
 * Grow a live session file the way play grows it: ordinary user/assistant rows
 * appended to the JSONL the product just created, until it is past the bound.
 * The real table wrote ~123 KB per turn; these rows are the same shape.
 */
async function playUntilOverTheBound(path: string, targetBytes: number): Promise<number> {
  let parentId: string | null = null;
  let turn = 0;
  while ((await stat(path)).size < targetBytes) {
    turn += 1;
    const rows: string[] = [];
    for (const [role, text] of [
      ["user", `第 ${turn} 回合：我打开档案柜，翻一八六六年的遗嘱检验记录。`],
      ["assistant", `${"档房的空气发霉。你翻过一叠又一叠泛黄的卷宗，指尖沾上灰。".repeat(400)}`],
    ] as const) {
      const id = `${turn}-${role}`;
      rows.push(JSON.stringify({
        type: "message",
        id,
        parentId,
        timestamp: new Date(Date.UTC(2026, 8, 16, 11, 44, 23) + turn * 1000).toISOString(),
        message: { role, content: [{ type: "text", text }] },
      }));
      parentId = id;
    }
    await appendFile(path, rows.join("\n") + "\n", "utf8");
  }
  return turn;
}

describe("a long session keeps its product", () => {
  it("still reports its pack and pages its history past the bounded-history size, and never reports itself skipped", async () => {
    const { backend, projectId } = await fixture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const created = await backend.handle("newSession", [projectId, "鬼屋"]) as { id: string };
      const listedBefore = await backend.handle("listSessions", [projectId]) as Array<{ id: string; productProfile?: { id: string } }>;
      const path = (backend as never as { sessionById: Map<string, { path: string }> }).sessionById.get(created.id)!.path;
      expect(listedBefore.find(item => item.id === created.id)?.productProfile?.id).toBe(PACK_ID);

      // Past 4 MB (the host's bound) and past the 8.1 MB the stranded table reached.
      const turns = await playUntilOverTheBound(path, 8.4 * 1024 * 1024);
      expect((await stat(path)).size).toBeGreaterThan(8 * 1024 * 1024);
      expect(turns).toBeGreaterThan(1);

      // The identity row sits at the head, where the session was created, and
      // has never been rewritten — exactly the real table's shape.
      const head = (await readFile(path, "utf8")).split("\n").slice(0, 12);
      expect(head.some(line => line.includes("pipiui_product_profile"))).toBe(true);

      warn.mockClear();
      const listed = await backend.handle("listSessions", [projectId]) as Array<{ id: string; productProfile?: { id: string } }>;
      expect(listed.find(item => item.id === created.id)?.productProfile?.id).toBe(PACK_ID);

      const history = await backend.handle("getSessionHistory", [created.id, 0, 500]) as unknown[];
      expect(history.length).toBeGreaterThan(0);

      const reported = warn.mock.calls.map(call => String(call[0]));
      expect(reported.filter(line => line.includes("bounded history limit"))).toEqual([]);
      await backend.close();
    } finally {
      warn.mockRestore();
    }
  }, 120_000);

  it("does not stamp `base` over a recorded pack when the registry was pointed elsewhere mid-read", async () => {
    const { backend, projectId } = await fixture("project");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const created = await backend.handle("newSession", [projectId, "鬼屋"]) as { id: string; productProfile?: { id: string } };
      expect(created.productProfile?.id).toBe(PACK_ID);
      const internals = backend as never as {
        sessionById: Map<string, { path: string }>;
        extensionLoader: { scan(root?: string): void };
        readSettings(): Promise<unknown>;
        ensure(id: string): Promise<unknown>;
      };
      const path = internals.sessionById.get(created.id)!.path;

      // Another project-bound read repoints the shared scanner while this
      // spawn is resolving its identity. `activePackId` then answers `base` —
      // not because the project has no pack, but because nobody asked about
      // this project. That value used to be appended to the JSONL, and from
      // then on every load read the table as belonging to another product.
      const settings = internals.readSettings.bind(internals);
      internals.readSettings = async () => {
        const value = await settings();
        internals.extensionLoader.scan(undefined);
        return value;
      };

      await internals.ensure(created.id).catch(() => undefined);

      const rows = (await readFile(path, "utf8"))
        .split("\n")
        .filter(line => line.includes("pipiui_product_profile"))
        .map(line => JSON.parse(line) as { profileId: string });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.map(row => row.profileId)).not.toContain("base");
      expect(rows.at(-1)!.profileId).toBe(PACK_ID);
      await backend.close();
    } finally {
      warn.mockRestore();
    }
  }, 60_000);
});
