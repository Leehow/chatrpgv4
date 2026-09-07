import { createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { ZipFile } from "yazl";
import { afterEach, describe, expect, it } from "vitest";

import {
  installFromProductPackArchive,
  writeProductPackArchive,
} from "../src/product-pack-archive.js";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

async function smallZip(path: string, entries: Array<{ name: string; body: string; mode?: number }>): Promise<void> {
  const zip = new ZipFile();
  for (const entry of entries) zip.addBuffer(Buffer.from(entry.body), entry.name, entry.mode ? { mode: entry.mode } : undefined);
  const writing = pipeline(zip.outputStream as Readable, createWriteStream(path));
  zip.end();
  await writing;
}

describe("Product Pack ZIP archive", () => {
  it("streams a complete pack and extracts files with executable modes intact", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-archive-"));
    const extension = join(root, "source", "lab-tools");
    await mkdir(join(extension, "bin"), { recursive: true });
    await writeFile(join(extension, "pipiui-extension.json"), JSON.stringify({
      id: "lab-tools",
      name: "Lab Tools",
      version: "1.0.0",
      capabilities: [],
    }));
    await writeFile(join(extension, "bin", "run"), "#!/bin/sh\necho ok\n");
    await chmod(join(extension, "bin", "run"), 0o755);
    // The pack extension is what carries the form: dependencies + layout.
    const pack = join(root, "source", "lab");
    await mkdir(pack, { recursive: true });
    await writeFile(join(pack, "pipiui-extension.json"), JSON.stringify({
      id: "lab",
      name: "Lab",
      version: "1.0.0",
      capabilities: [],
      defaultEnabled: false,
      dependencies: { required: [{ id: "lab-tools", version: "^1.0.0" }] },
      app: { ui: { layout: { primarySidebar: "pipi.sessions", center: "pipi.conversation" } } },
    }));
    const archive = join(root, "lab.pipiui-pack.zip");

    const result = await writeProductPackArchive({
      destination: archive,
      packId: "lab",
      packName: "Lab",
      extensions: [{ id: "lab-tools", directory: extension }, { id: "lab", directory: pack }],
    });

    expect(result).toMatchObject({ archivePath: archive, extensionCount: 2 });
    expect(result.bytes).toBeGreaterThan(0);
    await installFromProductPackArchive(archive, async directory => {
      expect(JSON.parse(await readFile(join(directory, "pipiui-product-pack.json"), "utf8"))).toMatchObject({
        schemaVersion: 2,
        id: "lab",
        extensions: [{ id: "lab", path: "extensions/lab" }, { id: "lab-tools", path: "extensions/lab-tools" }],
      });
      expect(JSON.parse(await readFile(join(directory, "extensions", "lab", "pipiui-extension.json"), "utf8")))
        .toMatchObject({ app: { ui: { layout: { primarySidebar: "pipi.sessions" } } } });
      expect(JSON.parse(await readFile(join(directory, "extensions", "lab-tools", "pipiui-extension.json"), "utf8"))).toMatchObject({ hostApi: "^1.0.0" });
      expect(await readFile(join(directory, "extensions", "lab-tools", "bin", "run"), "utf8")).toContain("echo ok");
      expect((await stat(join(directory, "extensions", "lab-tools", "bin", "run"))).mode & 0o777).toBe(0o755);
    });
  });

  it("refuses to write an archive that omits its own pack extension", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-missing-"));
    const extension = join(root, "source", "lab-tools");
    await mkdir(extension, { recursive: true });
    await writeFile(join(extension, "pipiui-extension.json"), JSON.stringify({
      id: "lab-tools",
      name: "Lab Tools",
      version: "1.0.0",
      capabilities: [],
    }));

    await expect(writeProductPackArchive({
      destination: join(root, "lab.pipiui-pack.zip"),
      packId: "lab",
      packName: "Lab",
      extensions: [{ id: "lab-tools", directory: extension }],
    })).rejects.toThrow(/must include its own pack extension 'lab'/);
  });

  it("rejects path traversal before extraction", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-traversal-"));
    const archive = join(root, "unsafe.zip");
    await smallZip(archive, [{ name: "aa/x", body: "escape" }]);
    const bytes = await readFile(archive);
    const safe = Buffer.from("aa/x");
    const unsafe = Buffer.from("../x");
    let replacements = 0;
    for (let index = 0; index <= bytes.length - safe.length; index += 1) {
      if (!bytes.subarray(index, index + safe.length).equals(safe)) continue;
      unsafe.copy(bytes, index);
      replacements += 1;
    }
    expect(replacements).toBeGreaterThanOrEqual(2);
    await writeFile(archive, bytes);

    await expect(installFromProductPackArchive(archive, async () => undefined))
      .rejects.toThrow(/invalid|unsafe|relative|parent/i);
    await expect(stat(join(root, "x"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects symbolic links from imported archives", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-symlink-"));
    const archive = join(root, "symlink.zip");
    await smallZip(archive, [
      { name: "pipiui-product-pack.json", body: "{}" },
      { name: "link", body: "outside", mode: 0o120777 },
    ]);

    await expect(installFromProductPackArchive(archive, async () => undefined))
      .rejects.toThrow(/symbolic link/i);
  });
});
