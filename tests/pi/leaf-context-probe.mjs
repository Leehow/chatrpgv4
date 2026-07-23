import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "../../runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "../../runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/faux.js";

const root = path.resolve(process.argv[2]);
const mode = process.argv[3] || "happy";
const sentinel = process.argv[4] || "PI_LEAF_PROVIDER_ONLY_SENTINEL";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-leaf-context-"));
const loader = new DefaultResourceLoader({
  cwd: root,
  agentDir: temp,
  additionalExtensionPaths: [path.join(root, "plugins/coc-keeper/pi/extensions/leaf.ts")],
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
});
const faux = fauxProvider({ provider: "pi-leaf-faux", models: [{ id: "leaf" }] });
const modelRuntime = await ModelRuntime.create({ modelsPath: null });
modelRuntime.registerNativeProvider(faux.provider);
let providerContext = "";
faux.setResponses([(context) => {
  providerContext = JSON.stringify(context);
  return fauxAssistantMessage(JSON.stringify({
    schema_version: 1,
    contract_id: "coc.source-pack-worker.v1",
    packet_id: "packet-context",
    work_group_id: "group-context",
    status: "usable",
    results: [{ job_id: "job-context", pack: {}, related_packs: [] }],
  }));
}]);

try {
  await loader.reload();
  const extensions = loader.getExtensions();
  if (mode !== "happy") {
    process.stdout.write(JSON.stringify({
      failedClosed: extensions.errors.length > 0,
      providerCalls: faux.state.callCount,
      errorContainsSentinel: JSON.stringify(extensions.errors).includes(sentinel),
    }));
    process.exit(0);
  }
  if (extensions.errors.length) throw new Error(JSON.stringify(extensions.errors));
  const sessionManager = SessionManager.inMemory(root);
  const { session } = await createAgentSession({
    cwd: root,
    agentDir: temp,
    model: faux.getModel("leaf"),
    modelRuntime,
    resourceLoader: loader,
    sessionManager,
    settingsManager: SettingsManager.inMemory(),
    noTools: "all",
    tools: [],
  });
  const events = [];
  session.subscribe((event) => events.push(event));
  await session.prompt("Compile the exact injected evidence and return strict JSON only.");
  const extensionsAfter = loader.getExtensions();
  const registered = extensionsAfter.extensions.flatMap((extension) => [...extension.tools.keys()]);
  const active = session.getActiveToolNames();
  const sessionText = JSON.stringify(session.messages);
  const eventText = JSON.stringify(events);
  session.dispose();
  process.stdout.write(JSON.stringify({
    providerHasSentinel: providerContext.includes(sentinel),
    sessionHasSentinel: sessionText.includes(sentinel),
    eventsHaveSentinel: eventText.includes(sentinel),
    providerCalls: faux.state.callCount,
    registered,
    active,
  }));
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
