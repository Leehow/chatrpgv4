import type { KernelContext } from "./context.js";
import { foundationHandlers } from "./foundation.js";
import { assembleHandlers, type HandlerGroup } from "./handlers.js";
import { readHandlers } from "./read/handlers.js";
import { createRuleQueries } from "./rules/queries.js";
import { createWriteRuntime } from "./write/index.js";

/** Integration owner only: add each later slice's static handler group here. */
export function buildHandlers(context: KernelContext): HandlerGroup {
  const rules = createRuleQueries(context);
  const writer = createWriteRuntime(context);
  return assembleHandlers(context, foundationHandlers(context),
    readHandlers(context, {...writer.read, lookupRules: rules.lookup}), writer.handlers);
}
