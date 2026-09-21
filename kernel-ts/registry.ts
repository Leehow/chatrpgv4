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
import { createJournalHandlers } from "./journal/index.js";
import { createVoiceHandlers } from "./voice/index.js";
import { createDevelopmentFamily, stageEnding } from "./development/index.js";
import { createApplyHandlers } from "./apply/index.js";
import { applyResources } from "./apply/resources.js";
import { createHealingResolveContribution } from "./healing/index.js";
import { createModRuntime } from "./mods/index.js";
import {moduleWeaponCatalog} from './combat/profiles.js';
import {createSanityFamily} from './sanity/index.js';
import {createMagicFamily} from './magic/index.js';
import {createCombatResolveContribution} from './combat/index.js';
import {createChaseResolveContribution} from './chase/index.js';
import {createWorldlineRuntime} from './worldline/index.js';
import { graphHandlers } from "./read/graph.js";
import {createBranchHandlers} from './worldline/branch.js';
import {clockEngines} from './clock-engines.generated.js';
import {ordinaryResolveHandlers} from './runtime/resolve-operation.js';
import {ordinaryApplyHandlers} from './runtime/apply-operation.js';
import { AdaptationJobs } from './adaptation/jobs.js';
/** Integration owner only: add each later slice's static handler group here. */
export function createKernelRuntime(context: KernelContext): {
    handlers: HandlerGroup;
    close(): Promise<void>;
} {
    const rules = createRuleQueries(context);
    const modules = createModuleRuntime(context);
    const mods = createModRuntime(context,{asset:(id,name)=>modules.source.store.asset(id,name)});
    const adaptations = new AdaptationJobs(context, (id, name) => modules.source.store.asset(id, name));
    const worldlines = createWorldlineRuntime(context,clockEngines);
    const writer = createWriteRuntime(context, { openingReady: modules.source.openingReady,
        requestReading: modules.source.requestFollowing,
        queueAheadReading: modules.source.ahead,
        mods,
        worldlines,
        sourceGraphPath: modules.source.graphPath,
        queueAdjacentReading: modules.source.queueAdjacentReading,
        libraryWriteBack: createLibraryWriteBack(context) });
    const resolver = createResolveRuntime(context, writer, { beforeMain:mods.resolveBeforeMain,requireMaterial: modules.source.requireMaterial, development: createDevelopmentFamily(), healing:createHealingResolveContribution(), sanity:createSanityFamily(),magic:createMagicFamily({effects:mods.magicEffects}),combat:createCombatResolveContribution(),chase:createChaseResolveContribution() });
    const asset=(id:string,name:string)=>modules.source.store.asset(id,name);
    const handlers = assembleHandlers(context, foundationHandlers(context), ordinaryResolveHandlers(context), ordinaryApplyHandlers(context), readHandlers(context, { ...writer.read, lookupRules: rules.lookup, asset, requireMapMaterial: modules.source.requireMapMaterial }), writer.handlers, modules.handlers, createSetupHandlers(context, writer), createLibraryHandlers(context, writer), resolver.handlers, createMemoryHandlers(context, writer), createJournalHandlers(context, writer), createVoiceHandlers(context, writer), mods.handlers(writer), adaptations.handlers(), graphHandlers(context), createBranchHandlers(context, writer), createApplyHandlers(context, writer, {adaptation:(c,e)=>adaptations.stage(c,e),mods:mods.apply(writer),worldlines,resources:applyResources,ending:stageEnding,requireMaterial:modules.source.requireMaterial,requireArrivalMapMaterial:modules.source.requireArrivalMapMaterial,materialReady:modules.source.materialReady,queueAdjacentReading:modules.source.queueAdjacentReading,asset,weaponCatalog:graph=>moduleWeaponCatalog(context,graph)}));
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
