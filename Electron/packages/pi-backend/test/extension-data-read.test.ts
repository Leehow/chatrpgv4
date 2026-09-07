import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExtensionLoader } from "../src/extension-loader.js";
import { createExtensionRegistry } from "../src/extension-registry.js";
import { validateExtensionManifest } from "../src/extension-manifest.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

function manifest(extra: Record<string, unknown> = {}) {
  return { id: "probe", name: "Probe", version: "1.0.0", capabilities: ["data.read"], ...extra };
}

const withData = (read: unknown) => validateExtensionManifest(manifest({ app: { data: { read } } }));

describe("app.data.read manifest", () => {
  it("carries declared project-relative paths", () => {
    const result = withData(["telemetry/data", "notes.jsonl"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.data?.read).toEqual(["telemetry/data", "notes.jsonl"]);
  });

  it("is optional", () => {
    const result = validateExtensionManifest(manifest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.data).toBeUndefined();
  });

  it("refuses a path that escapes the project", () => {
    const result = withData(["../../etc"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("; ")).toMatch(/app\.data\.read\[0\]/);
  });

  it("refuses a non-array and unknown keys", () => {
    expect(withData("telemetry").ok).toBe(false);
    const unknown = validateExtensionManifest(manifest({ app: { data: { execute: ["x"] } } }));
    expect(unknown.ok).toBe(false);
  });

  it("accepts app.data.write as its own list", () => {
    // 读一份日志和改一个项目的文件不是同一种权限，所以是两份声明而不是一个开关：
    // 用户看到的授权里得点出是哪个目录。
    const result = validateExtensionManifest(
      manifest({ app: { data: { read: ["telemetry/data"], write: ["telemetry/data"] } } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.data).toEqual({ read: ["telemetry/data"], write: ["telemetry/data"] });
  });

  it("accepts a package that only writes", () => {
    const result = validateExtensionManifest(manifest({ app: { data: { write: ["telemetry/data"] } } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.data).toEqual({ read: [], write: ["telemetry/data"] });
  });

  it("refuses a write path that escapes the project", () => {
    const result = validateExtensionManifest(manifest({ app: { data: { write: ["../../etc"] } } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("; ")).toMatch(/app\.data\.write\[0\]/);
  });

  it("recognises data.write as a capability", () => {
    const result = validateExtensionManifest(manifest({ capabilities: ["data.write"] }));
    expect(result.ok).toBe(true);
  });

  it("recognises data.read as a capability", () => {
    const result = validateExtensionManifest(manifest({ capabilities: ["data.read"] }));
    expect(result.ok).toBe(true);
  });
});

describe("confined data reads", () => {
  async function loaderWithProject(declared: string[], writable?: string[]) {
    root = await mkdtemp(join(tmpdir(), "pipiui-data-"));
    const project = join(root, "project");
    const extDir = join(project, ".pi", "agent", "extensions", "probe");
    await mkdir(extDir, { recursive: true });
    await writeFile(
      join(extDir, "pipiui-extension.json"),
      JSON.stringify(
        {
          ...manifest({
            capabilities: writable ? ["data.read", "data.write"] : ["data.read"],
            app: { data: writable ? { read: declared, write: writable } : { read: declared } },
          }),
        },
        null,
        2,
      ),
    );
    await mkdir(join(project, "telemetry", "data"), { recursive: true });
    await writeFile(join(project, "telemetry", "data", "params-20260904.jsonl"), "a\nb\nc\n");
    await writeFile(join(project, "secret.txt"), "not yours");
    const registry = createExtensionRegistry();
    const loader = createExtensionLoader({ registry, appRoot: join(root, "app-extensions") });
    loader.scan(project);
    return { loader, project };
  }

  it("serves a declared file as bytes with a type from its suffix", async () => {
    const { loader, project } = await loaderWithProject(["telemetry/data"]);
    // 1x1 PNG：真二进制，utf8 通道会把它读坏
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await writeFile(join(project, "telemetry", "data", "frame.png"), png);
    const asset = loader.readDataAsset("probe", project, "telemetry/data/frame.png");
    expect(asset.mime).toBe("image/png");
    expect(asset.size).toBe(png.byteLength);
    expect(Buffer.compare(asset.bytes, png)).toBe(0);
  });

  it("gives an unknown suffix octet-stream, never text/html", async () => {
    const { loader, project } = await loaderWithProject(["telemetry/data"]);
    await writeFile(join(project, "telemetry", "data", "blob.weird"), "x");
    expect(loader.readDataAsset("probe", project, "telemetry/data/blob.weird").mime).toBe("application/octet-stream");
    await writeFile(join(project, "telemetry", "data", "page.html"), "<h1>x</h1>");
    // .html 不在表里，所以也拿不到 text/html——扩展数据目录不能往应用里塞同源文档
    expect(loader.readDataAsset("probe", project, "telemetry/data/page.html").mime).toBe("application/octet-stream");
  });

  it("refuses an undeclared path for assets exactly as for text", async () => {
    const { loader, project } = await loaderWithProject(["telemetry/data"]);
    expect(() => loader.readDataAsset("probe", project, "secret.txt")).toThrow(/no declared data path/);
    expect(() => loader.readDataAsset("probe", project, "../outside.png")).toThrow(/no declared data path/);
    // 缺文件也报"no declared data path"：confinedDataPath 走 realpath，不存在就解析不出来。
    // 与文本通道同一行为，且对外统一——协议层三种拒绝都收敛成同一个 404。
    expect(() => loader.readDataAsset("probe", project, "telemetry/data/missing.png")).toThrow();
  });

  it("refuses a directory as an asset", async () => {
    const { loader, project } = await loaderWithProject(["telemetry/data"]);
    expect(() => loader.readDataAsset("probe", project, "telemetry/data")).toThrow(/unavailable/);
  });

  it("lists and tails a declared file", async () => {
    const { loader, project } = await loaderWithProject(["telemetry/data"]);
    const listed = loader.listDataFiles("probe", project, "telemetry/data");
    expect(listed.map(item => item.name)).toEqual(["params-20260904.jsonl"]);
    const read = loader.readDataFile("probe", project, "telemetry/data/params-20260904.jsonl");
    expect(read.content).toBe("a\nb\nc\n");
    expect(read.truncated).toBe(false);
  });

  it("returns whole lines when it has to truncate", async () => {
    const { loader, project } = await loaderWithProject(["telemetry/data"]);
    const read = loader.readDataFile("probe", project, "telemetry/data/params-20260904.jsonl", 1024);
    expect(read.content.startsWith("a")).toBe(true);
  });

  it("refuses a path outside the declared roots", async () => {
    const { loader, project } = await loaderWithProject(["telemetry/data"]);
    expect(() => loader.readDataFile("probe", project, "secret.txt")).toThrow(/no declared data path/);
  });

  it("refuses traversal even when it starts inside a declared root", async () => {
    const { loader, project } = await loaderWithProject(["telemetry/data"]);
    expect(() => loader.readDataFile("probe", project, "telemetry/data/../../secret.txt")).toThrow(
      /no declared data path/,
    );
  });

  it("refuses a symlink that points out of the project", async () => {
    const { loader, project } = await loaderWithProject(["telemetry/data"]);
    const outside = join(root, "outside.txt");
    await writeFile(outside, "elsewhere");
    await symlink(outside, join(project, "telemetry", "data", "link.jsonl"));
    // 真实路径跳出项目 → 解析失败，与"路径未声明"走同一条拒绝分支（不泄漏它指向哪里）。
    expect(() => loader.readDataFile("probe", project, "telemetry/data/link.jsonl")).toThrow(
      /no declared data path/,
    );
  });

  it("refuses everything for a package that declared no data paths", async () => {
    const { loader, project } = await loaderWithProject([]);
    expect(() => loader.readDataFile("probe", project, "telemetry/data/params-20260904.jsonl")).toThrow(
      /no declared data path/,
    );
  });
});

describe("host.worker manifest", () => {
  const withHost = (host: unknown) =>
    validateExtensionManifest({ id: "probe", name: "P", version: "1.0.0", capabilities: ["host.worker"], host });

  it("carries a package-relative worker entry", () => {
    const result = withHost({ worker: "host/index.js" });
    expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.host?.worker).toBe("host/index.js");
  });

  it("refuses an entry that escapes the package and any unknown key", () => {
    expect(withHost({ worker: "../../evil.js" }).ok).toBe(false);
    expect(withHost({ worker: "host/index.js", command: "rm" }).ok).toBe(false);
  });

  it("recognises host.worker as a capability that must be declared", () => {
    const undeclared = validateExtensionManifest({
      id: "probe",
      name: "P",
      version: "1.0.0",
      capabilities: [],
      host: { worker: "host/index.js" },
    });
    // 清单本身合法；能不能真的跑由 capability 决定，宿主在 reconcile 时才判。
    expect(undeclared.ok).toBe(true);
  });
});

describe("confined data writes", () => {
  /**
   * 面板只能留一张纸条，不能自己动手。这一组守的是那张纸条落在哪、有多大、以及
   * 它落不下去的时候必须报错而不是落到别处。
   */
  async function writable() {
    root = await mkdtemp(join(tmpdir(), "pipiui-write-"));
    const project = join(root, "project");
    const extDir = join(project, ".pi", "agent", "extensions", "probe");
    await mkdir(extDir, { recursive: true });
    await writeFile(
      join(extDir, "pipiui-extension.json"),
      JSON.stringify(
        manifest({
          capabilities: ["data.read", "data.write"],
          app: { data: { read: ["telemetry/data"], write: ["telemetry/data"] } },
        }),
        null,
        2,
      ),
    );
    await mkdir(join(project, "telemetry", "data"), { recursive: true });
    await writeFile(join(project, "secret.txt"), "not yours");
    const registry = createExtensionRegistry();
    const loader = createExtensionLoader({ registry, appRoot: join(root, "app-extensions") });
    loader.scan(project);
    return { loader, project };
  }

  it("creates a file under a declared writable root and replaces it", async () => {
    const { loader, project } = await writable();
    loader.writeDataFile("probe", project, "telemetry/data/request.json", '{"a":1}');
    expect(loader.readDataFile("probe", project, "telemetry/data/request.json").content).toBe('{"a":1}');
    loader.writeDataFile("probe", project, "telemetry/data/request.json", '{"a":2}');
    expect(loader.readDataFile("probe", project, "telemetry/data/request.json").content).toBe('{"a":2}');
  });

  it("refuses a path outside the declared writable roots", async () => {
    const { loader, project } = await writable();
    expect(() => loader.writeDataFile("probe", project, "secret.txt", "x")).toThrow(/no declared writable/);
    expect(() => loader.writeDataFile("probe", project, "telemetry/data/../../secret.txt", "x")).toThrow(
      /no declared writable/,
    );
    expect(await readFile(join(project, "secret.txt"), "utf8")).toBe("not yours");
  });

  it("refuses the declared root itself", async () => {
    // root 是目录，不是目标。允许它意味着一次写就能把声明的目录换成一个文件。
    const { loader, project } = await writable();
    expect(() => loader.writeDataFile("probe", project, "telemetry/data", "x")).toThrow(/no declared writable/);
  });

  it("refuses a dotfile", async () => {
    // 列目录会跳过点开头的文件：能写却看不见的东西，面板不该写得出来。
    const { loader, project } = await writable();
    expect(() => loader.writeDataFile("probe", project, "telemetry/data/.hidden", "x")).toThrow(
      /no declared writable/,
    );
  });

  it("refuses to follow a symlink out of the project", async () => {
    const { loader, project } = await writable();
    await symlink(join(root, "elsewhere"), join(project, "telemetry", "data", "away"));
    await mkdir(join(root, "elsewhere"), { recursive: true });
    expect(() => loader.writeDataFile("probe", project, "telemetry/data/away/escape.json", "x")).toThrow(
      /no declared writable/,
    );
  });

  it("refuses to overwrite something that is not a regular file", async () => {
    const { loader, project } = await writable();
    await mkdir(join(project, "telemetry", "data", "adir"));
    expect(() => loader.writeDataFile("probe", project, "telemetry/data/adir", "x")).toThrow(/not writable/);
  });

  it("caps how much a request may be", async () => {
    const { loader, project } = await writable();
    expect(() => loader.writeDataFile("probe", project, "telemetry/data/big.json", "x".repeat(64 * 1024 + 1))).toThrow(
      /over the/,
    );
  });

  it("leaves no temp file behind", async () => {
    const { loader, project } = await writable();
    loader.writeDataFile("probe", project, "telemetry/data/request.json", "{}");
    expect(loader.listDataFiles("probe", project, "telemetry/data").map(item => item.name)).toEqual([
      "request.json",
    ]);
  });

  it("gives no write path to a package that declared only reads", async () => {
    // 声明了读不等于能写。这是这两条权限分开的全部意义。
    root = await mkdtemp(join(tmpdir(), "pipiui-readonly-"));
    const project = join(root, "project");
    const extDir = join(project, ".pi", "agent", "extensions", "probe");
    await mkdir(extDir, { recursive: true });
    await writeFile(
      join(extDir, "pipiui-extension.json"),
      JSON.stringify(manifest({ app: { data: { read: ["telemetry/data"] } } }), null, 2),
    );
    await mkdir(join(project, "telemetry", "data"), { recursive: true });
    const registry = createExtensionRegistry();
    const loader = createExtensionLoader({ registry, appRoot: join(root, "app-extensions") });
    loader.scan(project);
    expect(loader.writeDataRoots("probe")).toEqual([]);
    expect(() => loader.writeDataFile("probe", project, "telemetry/data/request.json", "{}")).toThrow(
      /no declared writable/,
    );
  });
});
