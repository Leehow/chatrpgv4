import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeepwoodClient } from "../../../packs/deepwood-sync/agent/client.ts";
import { DEFAULT_BASE_URL, normalizeBaseUrl } from "../../../packs/deepwood-sync/agent/config.ts";
import { imageRefs, rewriteImages } from "../../../packs/deepwood-sync/agent/markdown.ts";
import { renderNotes } from "../../../packs/deepwood-sync/agent/notes.ts";
import { allowedWritePath, filePlan, folderPaths, slugify, writeMirrorFile } from "../../../packs/deepwood-sync/agent/paths.ts";
import { decideWrite, readManifest } from "../../../packs/deepwood-sync/agent/state.ts";
import { runSync } from "../../../packs/deepwood-sync/agent/sync.ts";
import manifest from "../../../packs/deepwood-sync/pipiui-extension.json";
import { validateExtensionManifest } from "../src/extension-manifest.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

async function project(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "deepwood-sync-"));
  return root;
}

/**
 * A stand-in for the remote account. Counting calls is how the incremental rule is
 * observed from outside: an unchanged object must not be downloaded twice.
 */
function stubClient() {
  const downloads: string[] = [];
  const file = {
    id: "file-abcdefgh",
    title: "Attention Is All You Need",
    original_filename: "attention.pdf",
    file_path: "https://oss.example.com/attention.pdf",
    file_size: 12,
    updated_at: "2026-01-01T00:00:00Z",
    folder_id: "folder-1",
  };
  const client = {
    baseUrl: "https://deepwood.cn",
    downloads,
    markdown: "# Attention\n\n![fig](images/fig-1.png)\n",
    listFolders: async () => [{ id: "folder-1", name: "文献", parent_id: null }],
    listProjectFiles: async () => [file],
    getMarkdown: async () => ({ content: client.markdown }),
    listWritingMemories: async () => [{ content: "先看第 3 节", created_at: "2026-01-02T00:00:00Z" }],
    getFile: async () => ({
      text_annotations: { a1: { original_text: "attention is all", messages: [{ role: "user", content: "为什么" }] } },
    }),
    listGallery: async (page: number) =>
      page === 1
        ? { images: [{ id: "img-1234abcd", url: "https://oss.example.com/plot.png", title: "结果图", created_at: "2026-02-03T00:00:00Z" }], total: 1 }
        : { images: [], total: 1 },
    fetchBinary: async (url: string) => {
      downloads.push(url);
      return new TextEncoder().encode(`bytes:${url}`);
    },
    imageUrl: (fileId: string, path: string) => `https://deepwood.cn/api/files/${fileId}/images/${path}`,
  };
  return client;
}

const BOUND = { id: "proj-1", name: "写作项目" };

async function sync(dir: string, client: ReturnType<typeof stubClient>) {
  return runSync({ root: dir, client: client as unknown as DeepwoodClient, project: BOUND });
}

describe("deepwood-sync manifest", () => {
  it("is a valid extension manifest declaring only capabilities it uses", () => {
    const result = validateExtensionManifest(manifest);
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(result.ok && result.manifest.capabilities).toEqual([
      "settings.read",
      "settings.write",
      "bridge.emit",
      "invoke.agent",
      "data.read",
    ]);
  });

  it("keeps the token out of the settings file by declaring it a vault secret", () => {
    const token = manifest.app.settings.schema.properties["ext.deepwood-sync.token"];
    expect(token.format).toBe("secret");
  });
});

describe("base url", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to the mount the Deepwood web app itself uses", () => {
    expect(DEFAULT_BASE_URL).toBe("https://www.deepwood.cn/chat");
    expect(normalizeBaseUrl("deepwood.cn/chat/")).toBe("https://deepwood.cn/chat");
  });

  it("follows the apex redirect to www and keeps the /chat mount", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("https://deepwood.cn/")) {
        return new Response(null, { status: 301, headers: { location: "https://www.deepwood.cn/chat/api/projects" } });
      }
      return new Response("{}", { status: 403 });
    }));
    expect(await DeepwoodClient.resolveBaseUrl("https://deepwood.cn/chat")).toBe("https://www.deepwood.cn/chat");
  });

  it("leaves an address that answers directly alone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    expect(await DeepwoodClient.resolveBaseUrl("https://www.deepwood.cn/chat")).toBe("https://www.deepwood.cn/chat");
  });
});

describe("path planning", () => {
  it("folds filesystem-hostile characters but keeps readable unicode", () => {
    expect(slugify("Attention: All You Need?")).toBe("Attention-All You Need");
    expect(slugify("文献/2025")).toBe("文献-2025");
    expect(slugify("   ")).toBe("untitled");
  });

  it("mirrors the remote folder tree and keeps same-titled documents apart", () => {
    const paths = folderPaths([
      { id: "a", name: "文献", parent_id: null },
      { id: "b", name: "2025", parent_id: "a" },
    ]);
    expect(paths.get("b")).toBe("文献/2025");
    const one = filePlan({ id: "aaaaaaaa1", title: "同名", original_filename: "x.pdf" }, "文献");
    const two = filePlan({ id: "bbbbbbbb2", title: "同名", original_filename: "x.pdf" }, "文献");
    expect(one.dir).toBe(join("deepwood", "files", "文献"));
    expect(one.stem).not.toBe(two.stem);
    expect(one.originalExt).toBe(".pdf");
  });

  it("refuses every write outside the mirror directory", async () => {
    const dir = await project();
    expect(allowedWritePath(dir, join(dir, "deepwood", "files", "a.md"))).toBe(true);
    expect(allowedWritePath(dir, join(dir, "manuscript.md"))).toBe(false);
    await expect(writeMirrorFile(dir, join("..", "escape.md"), "x")).rejects.toThrow(/只写 deepwood/);
  });
});

describe("incremental rule", () => {
  const entry = {
    path: "deepwood/files/a.md",
    kind: "markdown" as const,
    remoteId: "f1",
    remoteFingerprint: "v1",
    localHash: "hash-we-wrote",
    bytes: 3,
    syncedAt: "2026-01-01T00:00:00Z",
  };

  it("writes what is missing, skips what is untouched, and never overwrites a local edit", () => {
    expect(decideWrite({ currentHash: undefined, entry, remoteFingerprint: "v2" })).toBe("write");
    expect(decideWrite({ currentHash: "hash-we-wrote", entry, remoteFingerprint: "v1" })).toBe("unchanged");
    expect(decideWrite({ currentHash: "hash-we-wrote", entry, remoteFingerprint: "v2" })).toBe("write");
    expect(decideWrite({ currentHash: "user-edited", entry, remoteFingerprint: "v2" })).toBe("local-modified");
    expect(decideWrite({ currentHash: "someone-elses", entry: undefined, remoteFingerprint: "v2" })).toBe("untracked");
  });
});

describe("markdown assets", () => {
  it("collects references and rewrites only the ones that were downloaded", () => {
    const source = "![a](images/a.png) ![b](https://cdn/b.png) ![c](data:image/png;base64,AA)";
    expect(imageRefs(source).map(ref => ref.url)).toEqual(["images/a.png", "https://cdn/b.png"]);
    const rewritten = rewriteImages(source, new Map([["images/a.png", "doc.assets/a.png"]]));
    expect(rewritten).toContain("![a](doc.assets/a.png)");
    expect(rewritten).toContain("![b](https://cdn/b.png)");
  });
});

describe("notes sidecar", () => {
  it("renders memories and annotations, and stays absent when there are none", () => {
    expect(renderNotes({ title: "T", remoteId: "f1", memories: [], annotations: {} })).toBeUndefined();
    const body = renderNotes({
      title: "T",
      remoteId: "f1",
      memories: [{ content: "记一笔", created_at: "2026-01-02" }],
      annotations: { a: { original_text: "原文", messages: [{ role: "user", content: "为什么" }] } },
    });
    expect(body).toContain("记一笔");
    expect(body).toContain("> 原文");
    expect(body).toContain("**user**: 为什么");
  });
});

describe("runSync", () => {
  it("mirrors originals, parsed markdown with local images, notes and the gallery", async () => {
    const dir = await project();
    const client = stubClient();
    const report = await sync(dir, client);

    const stem = "Attention Is All You Need-file-abc";
    const docDir = join(dir, "deepwood", "files", "文献");
    expect(await readFile(join(docDir, `${stem}.pdf`), "utf8")).toBe("bytes:https://oss.example.com/attention.pdf");
    const markdown = await readFile(join(docDir, `${stem}.md`), "utf8");
    expect(markdown).toContain(`![fig](${stem}.assets/fig-1.png)`);
    expect(await readFile(join(docDir, `${stem}.assets`, "fig-1.png"), "utf8"))
      .toBe("bytes:https://deepwood.cn/api/files/file-abcdefgh/images/images/fig-1.png");
    expect(await readFile(join(docDir, `${stem}.notes.md`), "utf8")).toContain("先看第 3 节");
    expect(await readFile(join(dir, "deepwood", "gallery", "2026-02", "结果图-img-1234.png"), "utf8"))
      .toBe("bytes:https://oss.example.com/plot.png");
    expect(report.summary.written).toBeGreaterThanOrEqual(5);
    expect(report.summary.failed).toBe(0);
    expect(await readFile(join(dir, "deepwood", "README.md"), "utf8")).toContain("写作项目");
  });

  it("downloads nothing on a second run when the remote has not moved", async () => {
    const dir = await project();
    const client = stubClient();
    await sync(dir, client);
    const first = client.downloads.length;
    const second = await sync(dir, client);
    expect(client.downloads.length).toBe(first);
    expect(second.summary.written).toBe(0);
    expect(second.summary.unchanged).toBeGreaterThan(0);
  });

  it("re-downloads only what the remote changed", async () => {
    const dir = await project();
    const client = stubClient();
    await sync(dir, client);
    client.markdown = "# Attention\n\n修订过的正文\n";
    const report = await sync(dir, client);
    const stem = "Attention Is All You Need-file-abc";
    expect(await readFile(join(dir, "deepwood", "files", "文献", `${stem}.md`), "utf8")).toContain("修订过的正文");
    expect(report.items.filter(item => item.decision === "write").map(item => item.kind)).toEqual(["markdown"]);
  });

  it("keeps a locally edited mirror file and reports it instead of overwriting", async () => {
    const dir = await project();
    const client = stubClient();
    await sync(dir, client);
    const stem = "Attention Is All You Need-file-abc";
    const edited = join(dir, "deepwood", "files", "文献", `${stem}.md`);
    await writeFile(edited, "我自己改的正文\n");
    client.markdown = "# Attention\n\n远端也改了\n";

    const report = await sync(dir, client);
    expect(await readFile(edited, "utf8")).toBe("我自己改的正文\n");
    expect(report.summary.skippedLocalEdits).toBe(1);
    expect(await readFile(join(dir, "deepwood", "README.md"), "utf8")).toContain("本地已改动");
  });

  it("does not adopt a file it never wrote", async () => {
    const dir = await project();
    const client = stubClient();
    const stem = "Attention Is All You Need-file-abc";
    await mkdir(join(dir, "deepwood", "files", "文献"), { recursive: true });
    await writeFile(join(dir, "deepwood", "files", "文献", `${stem}.md`), "用户先放在这里的\n");

    const report = await sync(dir, client);
    expect(await readFile(join(dir, "deepwood", "files", "文献", `${stem}.md`), "utf8")).toBe("用户先放在这里的\n");
    expect(report.summary.skippedUntracked).toBe(1);
  });

  it("records what it wrote so a later run can tell remote change from local change", async () => {
    const dir = await project();
    await sync(dir, stubClient());
    const stored = await readManifest(dir);
    const kinds = Object.values(stored.entries).map(entry => entry.kind).sort();
    expect(kinds).toContain("original");
    expect(kinds).toContain("markdown");
    expect(kinds).toContain("asset");
    expect(kinds).toContain("notes");
    expect(kinds).toContain("gallery");
  });

  it("mirrors only what the caller asked for", async () => {
    const dir = await project();
    const client = stubClient();
    const report = await runSync({
      root: dir,
      client: client as unknown as DeepwoodClient,
      project: BOUND,
      options: { originals: false, notes: false, gallery: false },
    });
    expect(report.items.every(item => item.kind === "markdown" || item.kind === "asset")).toBe(true);
  });

  it("says so when the remote kept no original at all", async () => {
    const dir = await project();
    const client = stubClient();
    const local = { ...(await client.listProjectFiles())[0], file_path: "/var/data/uploads/attention.pdf" };
    client.listProjectFiles = async () => [local];
    const report = await sync(dir, client);
    expect(report.summary.notes.join("\n")).toContain("没有原件");
    expect(report.items.some(item => item.kind === "original")).toBe(false);
  });
});
