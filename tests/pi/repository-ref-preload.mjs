import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [root, taskPath] = process.argv.slice(2);
const runtime = await import(pathToFileURL(resolve(root, "plugins/coc-keeper/pi/lib/runtime.ts")).href);
const task = JSON.parse(await readFile(taskPath, "utf8"));
const evidence = await runtime.buildLeafEvidenceContext(task);
const ref = task.packet.requests[0].cached_page_refs[0];

process.stdout.write(JSON.stringify({
  contract_id: evidence.contract_id,
  page_count: evidence.pages.length,
  path: ref.path,
  text_sha256: ref.text_sha256,
  content_sha256: ref.content_sha256,
  ocr_revision: ref.ocr_revision,
}));
