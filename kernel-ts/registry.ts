import type { KernelContext } from "./context.js";
import { foundationHandlers } from "./foundation.js";
import { assembleHandlers, type HandlerGroup } from "./handlers.js";
import { readHandlers } from "./read/handlers.js";
import { createRuleQueries } from "./rules/queries.js";
import { createWriteRuntime } from "./write/index.js";
import { createModuleRuntime } from "./modules/index.js";
import { createSetupHandlers } from "./setup/index.js";
import { createLibraryHandlers, createLibraryWriteBack } from "./library/index.js";
import { createResolveRuntime } from "./resolve/index.js";
import { createMemoryHandlers } from "./memory/index.js";
/** Integration owner only: add each later slice's static handler group here. */
export function createKernelRuntime(context: KernelContext): {
    handlers: HandlerGroup;
    close(): Promise<void>;
} {
    const rules = createRuleQueries(context);
    const modules = createModuleRuntime(context);
    const writer = createWriteRuntime(context, { openingReady: modules.source.openingReady,
        sourceGraphPath: id => modules.source.store.graphPath(id),
        queueAdjacentReading: modules.source.queueAdjacentReading,
        libraryWriteBack: createLibraryWriteBack(context) });
    const resolver = createResolveRuntime(context, writer, { requireMaterial: modules.source.requireMaterial });
    const handlers = assembleHandlers(context, foundationHandlers(context), readHandlers(context, { ...writer.read, lookupRules: rules.lookup }), writer.handlers, modules.handlers, createSetupHandlers(context, writer), createLibraryHandlers(context, writer), resolver.handlers, createMemoryHandlers(context, writer));
    let closing: Promise<void> | undefined;
    return Object.freeze({ handlers, close() {
            return closing ??= (async () => { try {
                await modules.close();
            }
            finally {
                await context.git.close();
            } })();
        } });
}
/** Existing pure assembly probes use no held leases; RPC owners use the full lifetime. */
export function buildHandlers(context: KernelContext): HandlerGroup { return createKernelRuntime(context).handlers; }
