import type { KernelContext } from "./context.js";
import { foundationHandlers } from "./foundation.js";
import { assembleHandlers, type HandlerGroup } from "./handlers.js";

/** Integration owner only: add each later slice's static handler group here. */
export function buildHandlers(context: KernelContext): HandlerGroup {
  return assembleHandlers(context, foundationHandlers(context));
}
