import process from "node:process";

const modulePath = process.argv[2];
const loaded = await import(modulePath);
const tools = new Map();
const handlers = new Map();
let active = [];
await loaded.default({
  registerTool(definition) { tools.set(definition.name, definition); },
  on(name, handler) { handlers.set(name, handler); },
  setActiveTools(names) { active = [...names]; },
  getThinkingLevel() { return "high"; },
});
handlers.get("session_start")?.({}, {});
process.stdout.write(JSON.stringify({ registered: [...tools.keys()].sort(), active: active.sort() }));
