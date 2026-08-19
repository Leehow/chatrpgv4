import process from "node:process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[3] || process.cwd());
const modulePath = path.resolve(root, process.argv[2]);
const loaded = await import(pathToFileURL(modulePath).href);
const domain = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/domain-tools.ts")).href
);
const typed = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/typed-tools.ts")).href
);
const tools = new Map();
const handlers = new Map();
let active = [];
await loaded.default({
  registerTool(definition) { tools.set(definition.name, definition); },
  registerCommand() {},
  registerShortcut() {},
  on(name, handler) { handlers.set(name, handler); },
  setActiveTools(names) { active = [...names]; },
  getThinkingLevel() { return "high"; },
  appendEntry() {},
  sendMessage() {},
  sessionManager: { getEntries: () => [] },
});
const start = handlers.get("session_start");
const sessionCtx = { sessionManager: { getEntries: () => [] } };
if (typeof start === "function") await start({}, sessionCtx);
else if (Array.isArray(start)) {
  for (const handler of start) await handler({}, sessionCtx);
}
const registered = [...tools.keys()].sort();
const activeNames = [...active].sort();
const classify = (names) => ({
  generic: names.filter((name) => domain.isDomainToolName(name)),
  typed: names.filter((name) => typed.isTypedOperationTool(name)),
});
const registeredKinds = classify(registered);
const activeKinds = classify(activeNames);
process.stdout.write(JSON.stringify({
  registered,
  active: activeNames,
  genericRegistered: registeredKinds.generic,
  typedRegistered: registeredKinds.typed,
  genericActive: activeKinds.generic,
  typedActive: activeKinds.typed,
  sessionRole: domain.sessionRoleFromEnv(),
}));
