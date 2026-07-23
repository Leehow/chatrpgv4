import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "../../runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/faux.js";

export default function cliFauxProvider(pi: ExtensionAPI) {
  const faux = fauxProvider({ provider: "pi-leaf-cli-faux", models: [{ id: "leaf" }] });
  faux.setResponses([fauxAssistantMessage("{}")]);
  const original = faux.provider.streamSimple!;
  faux.provider.streamSimple = (...args) => {
    const counter = process.env.COC_PI_TEST_PROVIDER_COUNTER;
    if (counter) appendFileSync(counter, "1\n", "utf8");
    return original(...args);
  };
  pi.registerProvider(faux.provider);
}
