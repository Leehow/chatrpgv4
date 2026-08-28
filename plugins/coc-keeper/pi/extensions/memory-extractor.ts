import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readPrivateHandshake } from "../lib/runtime.ts";
import {
  validateMemoryExtractionTask,
} from "../lib/memory-extraction-dispatch.ts";

// Private finalize-after memory extractor. Like the source leaf, this role
// runs with zero tools: it cannot call state/rules operations or write
// files. Its only authority is to read the closed semantic task packet plus
// the bounded read payload and answer one bare strict JSON result; every
// validation, provenance reattachment, and persistence happens host-side in
// deterministic code.
const handshake = readPrivateHandshake();
const task = validateMemoryExtractionTask(handshake.task);

export default async function memoryExtractorExtension(pi: ExtensionAPI) {
  const brief = [
    "你是候选记忆断言提取器。只依据下方封闭任务包与已定稿的桌面文本，",
    "输出一个严格的裸 JSON 对象（不含 markdown、不解释、不加任何其他文字）。",
    "你不能调用任何工具，也不能写任何文件。",
    "任务包与文本如下：",
    JSON.stringify(task, null, 2),
  ].join("\n");
  pi.on("context", (event) => {
    return {
      messages: [
        ...event.messages,
        { role: "user", content: [{ type: "text", text: brief }], timestamp: 0 },
      ],
    };
  });
  pi.on("session_start", () => pi.setActiveTools([]));
}
