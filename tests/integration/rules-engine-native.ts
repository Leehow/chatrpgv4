/** A single bundled module preserves runtime class identities across engine ports. */
export {createKernelContext} from '../../kernel-ts/context.ts';
export {RuleTables} from '../../kernel-ts/rules/tables.ts';
export {CheckArithmetic} from '../../kernel-ts/resolve/arithmetic.ts';
export {CampaignWriter} from '../../kernel-ts/write/store.ts';
export {PythonRandom} from '../../kernel-ts/random.ts';
export {pythonJsonDumps} from '../../kernel-ts/json.ts';
export {parsePythonJson,jsonDigest} from '../../kernel-ts/json.ts';
export {Catalog,resolveFamilyParameter} from '../../kernel-ts/rules/catalog.ts';
export * as development from '../../kernel-ts/development/state.ts';
export * as developmentPlan from '../../kernel-ts/development/plan.ts';
export {skillTickEligible,recordSkillTicks} from '../../kernel-ts/resolve/context.ts';
export * as healing from '../../kernel-ts/healing/session.ts';
export * as sanity from '../../kernel-ts/sanity/session.ts';
export * as magic from '../../kernel-ts/magic/state.ts';
export * as magicEngine from '../../kernel-ts/magic/engine.ts';
export * as spells from '../../kernel-ts/magic/spells.ts';
export * as mp from '../../kernel-ts/healing/mp.ts';
export {clockEngines} from '../../kernel-ts/clock-engines.generated.ts';
export {ChaseSession} from '../../kernel-ts/chase/session.ts';
export * as chaseModel from '../../kernel-ts/chase/model.ts';
export * as chaseValidation from '../../kernel-ts/chase/validation.ts';
export * as combatEngine from '../../kernel-ts/combat/engine.ts';
export * as combatCatalog from '../../kernel-ts/combat/catalog.ts';
export {LEVELS as combatLevels} from '../../kernel-ts/combat/rolls.ts';
export {EVENT_TYPES} from '../../kernel-ts/write/store.ts';
export {conditionStatus} from '../../kernel-ts/read/module-graph.ts';

export {sheetSkillValue,investigatorCombatParticipant,resolveInvestigatorWeapon,weaponOptions} from '../../kernel-ts/combat/profiles.ts';
export {createAdvisoryLocks} from '../../kernel-ts/locks.ts';
export {assembleHandlers} from '../../kernel-ts/handlers.ts';
export {ModuleStore} from '../../kernel-ts/modules/store.ts';
export {ModuleGraph} from '../../kernel-ts/read/module-graph.ts';
export {playability,registerStarter} from '../../kernel-ts/write/source.ts';

export {PythonFloat} from '../../kernel-ts/json.ts';
