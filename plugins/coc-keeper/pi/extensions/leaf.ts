import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildLeafEvidenceContext, leafEvidenceMessage, readPrivateHandshake, validateLeafTask } from "../lib/runtime.ts";

const handshake = readPrivateHandshake();
const leafTask = validateLeafTask(handshake.task);

export default async function leafExtension(pi: ExtensionAPI) {
  const evidence = await buildLeafEvidenceContext(leafTask);
  pi.on("context", (event) => {
    return { messages: [...event.messages, leafEvidenceMessage(evidence)] };
  });
  pi.on("session_start", () => pi.setActiveTools([]));
}
