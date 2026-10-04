/** Scope the existing Node test runner without requiring Node 24's global-setup flag. */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { globalSetup, globalTeardown } from "../tests/extension/playtests-guard.mjs";

export async function runExtensionTests(args) {
  await globalSetup();
  let child;
  const forward = (signal) => child?.kill(signal);
  const interrupt = () => forward("SIGINT");
  const terminate = () => forward("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    const status = await new Promise((accept, reject) => {
      child = spawn(process.execPath, ["--test", ...args], { stdio: "inherit", env: { ...process.env } });
      child.once("error", reject);
      child.once("close", (code, signal) => accept(code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1)));
    });
    process.exitCode = status;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    await globalTeardown();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runExtensionTests(["tests/extension/**/*.test.mjs", ...process.argv.slice(2)]);
}
