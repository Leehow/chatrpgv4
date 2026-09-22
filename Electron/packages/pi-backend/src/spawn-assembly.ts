import { accessSync, closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, readSync, statSync, unlinkSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { mainSessionExcludeToolArgs } from "./main-tool-policy.js";
import { KERNEL_MOUNTS, resolveKernelPaths, type KernelMount, type KernelPaths } from "./kernel-mounts.js";

export { KERNEL_MOUNT_IDS, KERNEL_MOUNTS, kernelMount, kernelMountOrder, resolveKernelPaths } from "./kernel-mounts.js";
export type { KernelMountId, KernelPaths } from "./kernel-mounts.js";

/**
 * Host-owned runtime layout published to the child process.
 *
 * These are facts about the *installed runtime tree* — never about a package.
 * The base ships the kernel and nothing else, so an AGENT.md catalog or a skill
 * root is a property of whichever extension package brought it and travels on
 * that package's manifest (`agent.agentsDir` / `agent.skills`), not here. What
 * is left is the managed npm root the installer itself created.
 */
export type SpawnRuntimeLayout = {
  /** Managed `pi-hermes-memory` root, resolved by the installer's pin (`PIPIUI_HERMES_*`). */
  hermesMemory?: string;
};

/** Origin of the resolved extension instance that produced a contribution snapshot. */
export type SpawnExtensionOrigin = "builtin" | "app" | "project";
/** Incremental patch metadata in the spawn snapshot. Prompt fields are canonical absolute paths, never bodies. */
export type SpawnAgentContributionPatch = {
  target: string;
  appendPrompt?: string;
  replacePrompt?: string;
  addTools?: readonly string[];
  removeTools?: readonly string[];
};
/** Bounded agent-contribution snapshot item shared by main session and workers. */
export type SpawnAgentContribution = {
  id: string;
  origin: SpawnExtensionOrigin;
  root: string;
  agents: readonly string[];
  patches: readonly SpawnAgentContributionPatch[];
};
/** Loader-side contribution validation issues. Never prompt bodies or absolute paths. Not part of the spawn snapshot JSON. */
export type SpawnContributionDiagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  extensionId?: string;
  agentName?: string;
};
/** Registry-owned agent-half mounts (spec D3). Disabled/error packages must set enabled=false. */
export type SpawnRegisteredExtension = {
  id: string;
  version?: string;
  enabled: boolean;
  extensionPath?: string;
  skillRoots?: readonly string[];
  /** Manifest `agent.layers`: one prompt-layer directory appended to `PIPI_PHILOSOPHY_LAYER_DIRS`. */
  layerDir?: string;
  /** Manifest `agent.systemPrompt`: resolved persona file replacing Pi's default frame. */
  systemPrompt?: string;
  /** Manifest `agent.agentsDir`: the bundled AGENT.md catalog this package owns (`PIPIUI_AGENTS_DIR`). */
  agentsDir?: string;
  /** Manifest `agent.tools`: the tool names this package's agent half registers. */
  tools?: readonly string[];
  settings?: unknown;
  /** Vault-backed secret values for this package's settings schema, keyed by env var
   * name (`secretEnvName(settingsKey)`). Applied to the child environment only when the
   * agent half is actually mounted, and never serialized into settings snapshots,
   * IPC payloads or transcript redaction sources. */
  secretEnv?: Record<string, string>;
  /** Validated, path-confined contribution metadata. Omitted when disabled/invalid/refused/empty. */
  agentContribution?: SpawnAgentContribution;
  /** Contribution path/size issues for an otherwise usable extension. Omitted when disabled/refused. */
  contributionDiagnostics?: readonly SpawnContributionDiagnostic[];
};

export type SpawnInput = {
  sessionPath?: string;
  /** Host session id. Scopes per-session runtime state (plan store) to one conversation. */
  sessionId?: string;
  /** Set for sessions the user manually stopped or archived: pi-goal must not auto-resume goals/continuations in that child. */
  goalAutoResume?: "blocked";
  cwd: string;
  /** Canonical project root (identity anchor). When the session is bound to a workspace/worktree,
   *  `cwd` is the workspace and this stays the project root; defaults to `cwd`. */
  projectRoot?: string;
  runtimeRoot?: string;
  agentDir?: string;
  sessionsRoot?: string;
  resourceMode?: "default" | "explicit";
  /** Resolved kernel surfaces for this runtime tree. Empty ⇒ a deliberately bare child. */
  kernel?: KernelPaths;
  /** Host-owned runtime layout facts published as environment. */
  runtime?: SpawnRuntimeLayout;
  /** Exact host-owned node_modules that satisfies pinned dependencies imported by registered extension packages. */
  managedNodeModulesRoot?: string;
  bridgePort?: number;
  bridgeRoutingKey?: string;
  /** Canonical v1 bridge credential. Its presence is what selects PIPIUI_HOST_PROTOCOL=1. */
  sessionCapability?: string;
  mainModelId?: string;
  /** Optional full provider/model reference for Hermes background review. */
  memoryReviewModelId?: string;
  subagentModelsFile?: string;
  /** Read-only available-model catalog snapshot (exact `provider/modelId` refs + display names only, hidden ids
   *  already excluded) for Boss dispatch pins and prompt injection; hot-read per dispatch. */
  subagentModelCatalogFile?: string;
  /** Compact provider/id → nativeSearch map for worker tool-list filtering. */
  subagentNativeSearchFile?: string;
  /** Selected session model; used to hide generic web_search when native web_search is effective. */
  model?: { provider?: string; id?: string; capabilities?: import("@pipi/host-api").ModelCapabilities };
  /** The user's Settings → 工具开关 denylist. Merged with the Boss read-only policy; never passed to workers. */
  disabledToolNames?: readonly string[];
  /** Unused disk path kept only so callers do not infer a project vault. */
  vaultDir?: string;
  /** Enabled PipiUI extension agent halves, assembled into `-e` from the registry. */
  registeredExtensions?: readonly SpawnRegisteredExtension[];
  /** Extra internal env merged last (never sanitized): host-owned contracts the sanitizer must not strip. */
  internalEnv?: Record<string, string>;
};
export type SpawnOutput = { args: string[]; env: Record<string,string> };
/**
 * An explicit process invocation for Pi.
 *
 * Packaged Electron uses the bundled Node executable with the real, unpacked Pi CLI as the first
 * prefix argument. Development callers can keep using a directly executable external `pi`.
 * `piPath` is the launcher-shaped path used by the auth helper to locate Pi's module root.
 */
export type PiCommand = {
  executable: string;
  prefixArgs?: readonly string[];
  env?: Readonly<Record<string, string>>;
  piPath?: string;
};
const ext=(args:string[], path?:string)=>{if(path)args.push("-e",path)};
/**
 * The single env key that carries the host→worker spawn contract.
 *
 * The document's shape, its reader, and this version number are defined once in
 * `packs/agent-orchestration/spawn-contract.ts`. That file cannot be imported
 * from here — the pi-backend build is rooted at `src` and the runtime tree ships
 * standalone — so the two constants are restated and
 * `packages/pi-backend/test/spawn-contract.test.ts` asserts them equal while
 * round-tripping this writer's output through the runtime reader.
 */
export const SPAWN_CONTRACT_ENV = "PIPIUI_SPAWN_CONTRACT";
export const SPAWN_CONTRACT_VERSION = 1;
/**
 * PIPIUI_SESSION_CAPABILITY and PIPIUI_HOST_PROTOCOL are stripped for the same reason as the
 * finalizer: a bridge credential inherited from an outer shell would let another process address
 * this session's agent tree. Only the value this host mints for this spawn survives.
 */
export function sanitizeEnvironment(env: NodeJS.ProcessEnv): Record<string,string> { const exact=new Set(["EXT_JEV_APIKEY","PIPIUI_ACTIVE_PROJECT_PI_HOME","PIPIUI_AGENTS_DIR","PIPIUI_BOSS_READ_ONLY","PIPIUI_BRIDGE_PORT","PIPIUI_BUILT_IN_SKILL_ROOT","PIPIUI_CORE_PROMPT","PIPIUI_PROMPT_OBSERVER_EXT","PIPIUI_MAIN_CWD","PIPIUI_MAIN_MODEL","PIPIUI_MAIN_MODEL_FILE","PIPIUI_PROJECT_ROOT","PIPIUI_MOUNTED_EXTENSIONS","PIPIUI_NODE_PATH","PIPIUI_PI_PATH","PIPIUI_RUNTIME_SOURCE_ROOT","PIPIUI_SPAWN_CONTRACT","PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE","PIPIUI_SESSION_KEY","PIPIUI_SESSION_CAPABILITY","PIPIUI_SESSION_ID","PIPIUI_HOST_PROTOCOL",GOAL_AUTO_RESUME_ENV,"PIPIUI_SKILL_READ_BLOCK","PIPIUI_SKILL_ROOTS","PIPIUI_TOOL_SKILL_SETTINGS_FILE","PIPIUI_WORKTREE","PIPIUI_SECRET_VAULT_DIR","PIPIUI_VAULT_DEK"]); return Object.fromEntries(Object.entries(env).filter(([key,value])=>value!==undefined&&!exact.has(key)&&!["PIPIUI_AGENT_","PIPIUI_MEMORY_","PIPIUI_TERMINAL_","PIPIUI_SUBAGENT_","PIPIUI_WORKTREE_","PIPIUI_HERMES_","PIPIUI_EXT_"].some(prefix=>key.startsWith(prefix))) as [string,string][]); }
/**
 * Layered spawn environment, mirroring Swift `ChatSession.mergedSpawnEnv` + `PiProcess`
 * (T17): every configured `<agentDir>/.env` key is injected into the spawned pi process so
 * env-key providers resolve in the RPC session exactly as they do
 * for `listModels`. Precedence, highest first: internal assembly env (the host's own
 * PIPIUI_* contract) → `.env` → host process env → host defaults. Managed PIPIUI_*
 * keys are stripped from both base layers, so a stale `.env`/parent value can never resurrect
 * a disabled feature or clobber the host's bridge contract.
 */
/**
 * Packaged Pi/auth children run as Electron Helper. A reconstructed spawn env
 * that drops this flag makes Helper start as Chromium and busy-loop.
 * Harmless on a real Node binary.
 */
export function withElectronRunAsNode<T extends Record<string, string | undefined>>(
  env: T,
): T & { ELECTRON_RUN_AS_NODE: string } {
  return { ...env, ELECTRON_RUN_AS_NODE: "1" };
}

export function mergedSpawnEnvironment(
  parent: NodeJS.ProcessEnv,
  dotEnv: Record<string, string>,
  internal: Record<string, string>,
): Record<string, string> {
  return withElectronRunAsNode({
    PI_CACHE_RETENTION: "long",
    CONTEXTFOLD_BUDGET_CAP: "150000",
    CONTEXTFOLD_TAIL: "30000",
    CONTEXTFOLD_COMPACT: "native",
    CONTEXTFOLD_SPOOL_RETAIN_DAYS: "30",
    CONTEXTFOLD_TOOL_USE_TRIGGER: "40",
    CONTEXTFOLD_TOOL_USE_KEEP: "12",
    CONTEXTFOLD_TOOL_USE_MIN_SAVINGS: "10000",
    ...sanitizeEnvironment(parent),
    ...sanitizeEnvironment(dotEnv),
    ...internal,
  });
}

/**
 * Kernel `-e` mounts with `order` below this run before the registered manifest
 * packages; the rest run after them. The split is what keeps `runtime-info`'s
 * read-only request observer last — it must see the payload every other mount
 * has already rewritten — without the assembler naming any extension.
 */
const KERNEL_MOUNT_AFTER_EXTENSIONS = 50;

type KernelMountEntry = KernelMount & { contribution: { kind: "mount"; order: number; env?: string } };

function kernelMountEntries(before: boolean): KernelMountEntry[] {
  return KERNEL_MOUNTS
    .filter((entry): entry is KernelMountEntry => entry.contribution.kind === "mount")
    .filter(entry => (entry.contribution.order < KERNEL_MOUNT_AFTER_EXTENSIONS) === before)
    .sort((a, b) => a.contribution.order - b.contribution.order);
}

/**
 * The locked base system prompt (`pi-core-prompt/SYSTEM_BASE.md`), pushed before any other
 * append source so it is the first thing after Pi's own frame. Unconditional on purpose: it
 * carries the identity, the extension architecture, and the handful of invariants that must
 * still hold in a session where every extension is disabled, so no feature flag gates it.
 *
 * Passing `--append-system-prompt` explicitly switches Pi's resource loader out of discovery,
 * so the user's own append file is re-added here rather than silently dropped. Only the
 * agent-dir copy is: Pi trust-gates `{cwd}/.pi/APPEND_SYSTEM.md` and leaves
 * `{agentDir}/APPEND_SYSTEM.md` ungated, and replicating a trust decision host-side would put
 * a second, drifting copy of it in this file. In PipiUI `agentDir` is `{project}/.pi/agent`,
 * so the ungated path is already project-scoped.
 */
function appendCorePrompt(args:string[],env:Record<string,string>,input:SpawnInput):void {
  const base=input.kernel?.["core-prompt"];
  if(base){
    args.push("--append-system-prompt",base);
    // Workers assemble their own arguments in the subagent extension rather than through this
    // function, so the path travels to them in the spawn contract as well as here.
    env.PIPIUI_CORE_PROMPT=base;
  }
  // Worker-side prompt observability travels the same way. The main session gets this from
  // runtime-info, which registers a tool and therefore cannot be mounted in a worker.
  const observer=input.kernel?.["prompt-observer"];
  if(observer)env.PIPIUI_PROMPT_OBSERVER_EXT=observer;
  if(!base||!input.agentDir)return;
  const userAppend=join(input.agentDir,"APPEND_SYSTEM.md");
  if(existsSync(userAppend))args.push("--append-system-prompt",userAppend);
}

/**
 * Assemble the Electron host's Pi process contract.
 *
 * Exactly three things get mounted, in this order:
 *
 * 1. the **kernel** — the declarative table in `kernel-mounts.ts`, the runtime
 *    machinery that is still there when every extension is disabled;
 * 2. the **registered manifest packages** the extension registry resolved for
 *    this project and profile (spec D3);
 * 3. the **project's own plain pi extensions** (spec D13), which are the user's
 *    files and therefore load last, after everything the host shipped.
 *
 * There is no fourth channel and no per-extension branch: this function does
 * not know that a browser, a plan store or a memory broker exist. What a
 * package contributes — its mount, its skills, its prompt layers, its settings
 * snapshot, its declared tools — comes from its manifest.
 */
export function assemblePiSpawn(input:SpawnInput):SpawnOutput {
  const args:string[]=[];
  const env:Record<string,string>={};
  const kernel=input.kernel??{};
  const layout=input.runtime??{};

  appendCorePrompt(args,env,input);
  if(input.managedNodeModulesRoot)env.NODE_PATH=input.managedNodeModulesRoot;
  if(input.resourceMode==="explicit")args.push("--no-extensions","--no-skills","--no-prompt-templates","--no-themes");
  if(input.agentDir){
    env.PI_CODING_AGENT_DIR=input.agentDir;
    env.PIPIUI_ACTIVE_PROJECT_PI_HOME=input.agentDir;
  }
  if(input.sessionsRoot)env.PI_CODING_AGENT_SESSION_DIR=input.sessionsRoot;
  if(input.sessionPath)args.push("--session",input.sessionPath);

  const mounts:MountRecord[]=[];
  for(const entry of kernelMountEntries(true))appendKernelMount(args,env,mounts,entry,kernel);

  // Registry-owned agent halves. Everything package-specific — layers, skills,
  // settings, secrets, declared tools — is read off the snapshot the loader built.
  const registered=appendRegisteredExtensions(args,env,mounts,input);

  // The user's own project extensions load after everything the host shipped, so a
  // project file can wrap or shadow a bundled tool rather than race it.
  appendProjectExtensions(args,mounts,input);

  for(const entry of kernelMountEntries(false))appendKernelMount(args,env,mounts,entry,kernel);

  args.push(...mainSessionExcludeToolArgs({disabledToolNames:input.disabledToolNames,model:input.model}));

  // ---- runtime-semantic environment (never mount plumbing) ----------------
  // This host does not directly finalize Git worktrees. Electron hands
  // merge/cleanup/disposition to the audited service in pi so exactly one
  // finalizer ever runs against a repository.
  env.PIPIUI_WORKTREE_FINALIZER="pi";
  env.PIPIUI_MAIN_CWD=input.cwd;
  // The canonical project root travels separately from `cwd`: identity-level state (memory, plan
  // files, worker session dirs, session-worktree merge target) anchors there even when `cwd` is
  // a session-bound workspace/worktree.
  env.PIPIUI_PROJECT_ROOT=input.projectRoot??input.cwd;
  env.PIPIUI_MEMORY_PROJECT_ROOT=input.projectRoot??input.cwd;
  env.PIPIUI_MEMORY_BROKER_MODE="main";
  // The plan store is per conversation, not per project: without this id every session in
  // one work tree would read and overwrite the same `.pi/plans` file.
  if(input.sessionId)env.PIPIUI_SESSION_ID=input.sessionId;
  if(input.goalAutoResume==="blocked")env[GOAL_AUTO_RESUME_ENV]="blocked";
  if(layout.hermesMemory){
    env.PIPIUI_HERMES_PACKAGE_ROOT=layout.hermesMemory;
    env.PIPIUI_HERMES_NODE_MODULES_ROOT=dirname(layout.hermesMemory);
  }
  if(input.memoryReviewModelId)env.PIPIUI_MEMORY_REVIEW_MODEL=input.memoryReviewModelId;
  if(input.mainModelId)env.PIPIUI_MAIN_MODEL=input.mainModelId;
  if(input.subagentModelsFile)env.PIPIUI_SUBAGENT_MODELS_FILE=input.subagentModelsFile;
  if(input.subagentModelCatalogFile)env.PIPIUI_SUBAGENT_MODEL_CATALOG_FILE=input.subagentModelCatalogFile;
  if(input.subagentNativeSearchFile)env.PIPIUI_SUBAGENT_NATIVE_SEARCH_FILE=input.subagentNativeSearchFile;
  if(input.bridgePort!==undefined){
    env.PIPIUI_BRIDGE_PORT=String(input.bridgePort);
    env.PIPIUI_SESSION_KEY=input.bridgeRoutingKey??"";
  }
  // Canonical v1: extensions encode `sessionCapability` envelopes and fail closed when the
  // capability is missing, so the protocol marker is only ever set together with a real credential.
  if(input.sessionCapability){env.PIPIUI_HOST_PROTOCOL="1";env.PIPIUI_SESSION_CAPABILITY=input.sessionCapability}

  // Prompt layers are additive: every enabled extension that declares one contributes,
  // in mount order. A single-assignment producer silently clobbered the second one.
  const layerDirs=registered.layerDirs;
  if(layerDirs.length)env.PIPI_PHILOSOPHY_LAYER_DIRS=layerDirs.join(delimiter);
  // A product pack owns its persona: its `agent.systemPrompt` file replaces Pi's
  // default coding-assistant frame; SYSTEM_BASE and layers still append after it.
  if(registered.systemPrompt&&existsSync(registered.systemPrompt)){
    const body=readFileSync(registered.systemPrompt,"utf8").trim();
    if(body)args.push("--system-prompt",body);
  }

  writeSpawnContract(env,{
    corePrompt:kernel["core-prompt"],
    promptObserver:kernel["prompt-observer"],
    layerDirs,
    mounts,
  });

  if(input.internalEnv)for(const[key,value]of Object.entries(input.internalEnv))env[key]=value;
  return {args,env};
}

function appendKernelMount(
  args:string[],
  env:Record<string,string>,
  mounts:MountRecord[],
  entry:KernelMountEntry,
  kernel:KernelPaths,
):void {
  const path=kernel[entry.id];
  if(!path)return;
  ext(args,path);
  if(entry.contribution.env)env[entry.contribution.env]=path;
  mounts.push({id:`kernel:${entry.id}`,kind:"kernel",path,worker:entry.worker});
}

export const USER_EXTENSIONS_DIR="user-extensions";
/** Project-local pi extension roots, in load order. Both are the user's own files (spec D13). */
export const PROJECT_EXTENSION_ROOTS: readonly { from: "agentDir" | "projectRoot"; segments: readonly string[] }[] =
  Object.freeze([
    // Historical PipiUI location: `{project}/.pi/agent/user-extensions`.
    { from: "agentDir", segments: [USER_EXTENSIONS_DIR] },
    // Pi's own convention: `{project}/.pi/extensions`. Electron starts Pi with
    // `--no-extensions`, so nothing else would ever mount these.
    { from: "projectRoot", segments: [".pi", "extensions"] },
  ]);
const USER_EXTENSION_FILE=/\.(?:[cm]?js|ts)$/;
const DIRECTORY_ENTRYPOINTS=["index.ts","index.js","index.mjs","index.cjs"];

function scanProjectExtensionRoot(root:string,boundary:string):string[] {
  let entries:import("node:fs").Dirent[];
  try{entries=readdirSync(root,{withFileTypes:true,encoding:"utf8"})}catch{return[]}
  const mounts:string[]=[];
  for(const entry of entries){
    if(entry.name.startsWith(".")||entry.name==="node_modules")continue;
    const full=resolve(root,entry.name);
    const rel=relative(root,full);
    if(!rel||rel.startsWith("..")||isAbsolute(rel))continue;
    if(entry.isFile()&&USER_EXTENSION_FILE.test(entry.name)){mounts.push(full);continue}
    if(entry.isDirectory()){
      const declared=declaredEntrypoints(full,boundary);
      if(declared.length){mounts.push(...declared);continue}
      const entrypoint=directoryEntrypoint(full);
      if(entrypoint)mounts.push(entrypoint);
    }
  }
  return mounts.sort();
}

function directoryEntrypoint(root:string):string|undefined {
  for(const name of DIRECTORY_ENTRYPOINTS){
    const candidate=join(root,name);
    if(existsSync(candidate))return candidate;
  }
  return undefined;
}

/**
 * Extra `-e` mounts owned by the project itself.
 *
 * Electron starts Pi with `--no-extensions`, so pi's own discovery of
 * `{project}/.pi/extensions` never runs and a plain pi extension a user drops
 * into their repository would silently do nothing. This is the one resolver for
 * both locations: a `.ts`/`.js` file, a directory with a `pi.extensions` entry
 * in its `package.json`, or a directory with a bare `index.ts`. Deduped by
 * realpath so the same file reached through two roots mounts once.
 *
 * Trust is unchanged and is not this function's business: pi still gates these
 * against the project's own `trust.json`, and nothing here auto-trusts.
 */
export function projectExtensionMounts(input:{agentDir?:string;projectRoot?:string}):string[] {
  const mounts:string[]=[];
  const seen=new Set<string>();
  for(const spec of PROJECT_EXTENSION_ROOTS){
    const base=spec.from==="agentDir"?input.agentDir:input.projectRoot;
    if(!base)continue;
    // A declared entry may point anywhere inside the project the roots belong to.
    // Without a known project root the scanned root is the only tree we can vouch for.
    const boundary=input.projectRoot??base;
    for(const mount of scanProjectExtensionRoot(resolve(base,...spec.segments),boundary)){
      let identity:string;
      try{identity=realpathSync(mount)}catch{identity=mount}
      if(seen.has(identity))continue;
      seen.add(identity);
      mounts.push(mount);
    }
  }
  return mounts;
}

/** Back-compat name for the historical `{agentDir}/user-extensions` scan. */
export function userExtensionMounts(agentDir?:string):string[] {
  return agentDir?scanProjectExtensionRoot(resolve(agentDir,USER_EXTENSIONS_DIR),agentDir):[];
}

/**
 * Project-local mounts run last, so anything a manifest package already mounted
 * is skipped here. A project may point a plain-pi `package.json` at a file that
 * is also the agent half of an installed manifest extension — the same
 * extension reached by two routes — and mounting it twice registers its tools
 * twice, which pi rejects at load.
 */
function appendProjectExtensions(args:string[],mounts:MountRecord[],input:SpawnInput):void {
  const identity=(path:string):string=>{try{return realpathSync(path)}catch{return resolve(path)}};
  const mounted=new Set(mounts.map(record=>identity(record.path)));
  for(const path of projectExtensionMounts({agentDir:input.agentDir,projectRoot:input.projectRoot??input.cwd})){
    if(mounted.has(identity(path)))continue;
    mounted.add(identity(path));
    ext(args,path);
    mounts.push({id:`project:${basename(dirname(path))}/${basename(path)}`,kind:"project",path,worker:true});
  }
}
export const GOAL_AUTO_RESUME_ENV = "PIPIUI_GOAL_AUTO_RESUME";
/** Spec §5.5: `PIPIUI_EXT_SETTINGS_<ID>` with the extension id uppercased. */
export function extensionSettingsEnvName(id: string): string {
  const token = id.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  return `PIPIUI_EXT_SETTINGS_${token || "EXT"}`;
}
/**
 * Comma-joined ids of the registered extensions actually mounted (`-e`) in this spawn.
 * Bare runtime extensions read it to yield tool ownership to a mounted manifest package
 * instead of registering duplicate tools.
 */
export const MOUNTED_EXTENSIONS_ENV = "PIPIUI_MOUNTED_EXTENSIONS";
/**
 * Bounded JSON snapshot of enabled extension agent contributions.
 * Value is metadata only (ids, origins, canonical roots, absolute AGENT.md / prompt-file paths, tool names).
 * Never contains prompt bodies. Name uses `PIPIUI_EXT_` so sanitizeEnvironment strips inherited/stale values.
 * Main session and workers share this exact string; omit it when there are no active contributions.
 */
export const AGENT_CONTRIBUTIONS_ENV = "PIPIUI_EXT_AGENT_CONTRIBUTIONS";
export const AGENT_CONTRIBUTIONS_FILE_ENV = "PIPIUI_EXT_AGENT_CONTRIBUTIONS_FILE";
/**
 * Canonical session-owned jail directory for the sidecar named by
 * AGENT_CONTRIBUTIONS_FILE_ENV. Set by the host beside the file env so the
 * runtime can verify the sidecar never left the session directory (realpath
 * confinement, not a lexical prefix). `PIPIUI_EXT_` prefix so stale inherited
 * values are stripped like the file env.
 */
export const AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV = "PIPIUI_EXT_AGENT_CONTRIBUTIONS_SESSION_ROOT";
/** Runtime parser rejects snapshots above this. Host stays strictly below. */
export const AGENT_CONTRIBUTIONS_RUNTIME_MAX_BYTES = 256 * 1024;
/** Host refuses to emit at or above this, leaving margin under the runtime cap. */
export const AGENT_CONTRIBUTIONS_HOST_MAX_BYTES = 192 * 1024;
/** Inline env budget so a legal snapshot cannot blow ARG_MAX. Larger snapshots use a session-owned file. */
export const AGENT_CONTRIBUTIONS_ENV_MAX_BYTES = 32 * 1024;
export const AGENT_CONTRIBUTIONS_SNAPSHOT_VERSION = 1;
export type ContributionSnapshotDiagnostic = {
  severity: "error";
  code: "contribution-snapshot-oversize" | "contribution-snapshot-file";
  message: string;
};
export type VersionedAgentContributionSnapshot = {
  version: typeof AGENT_CONTRIBUTIONS_SNAPSHOT_VERSION;
  extensions: Record<string, unknown>[];
  json?: string;
  byteLength: number;
  diagnostics: ContributionSnapshotDiagnostic[];
};
const CONTRIBUTION_ORIGIN_RANK: Record<SpawnExtensionOrigin, number> = { builtin: 0, app: 1, project: 2 };
function isSpawnExtensionOrigin(value: unknown): value is SpawnExtensionOrigin {
  return value === "builtin" || value === "app" || value === "project";
}
function snapshotAgentContributionPatch(patch: SpawnAgentContributionPatch): Record<string, unknown> {
  const item: Record<string, unknown> = { target: patch.target };
  if (patch.appendPrompt) item.appendPrompt = patch.appendPrompt;
  if (patch.replacePrompt) item.replacePrompt = patch.replacePrompt;
  if (patch.addTools?.length) item.addTools = [...patch.addTools];
  if (patch.removeTools?.length) item.removeTools = [...patch.removeTools];
  return item;
}
function snapshotAgentContribution(pkgId: string, contribution: SpawnAgentContribution): Record<string, unknown> | undefined {
  if (!isSpawnExtensionOrigin(contribution.origin) || typeof contribution.root !== "string" || !contribution.root) return undefined;
  return {
    id: contribution.id || pkgId,
    origin: contribution.origin,
    root: contribution.root,
    agents: [...(contribution.agents ?? [])],
    patches: (contribution.patches ?? []).map(snapshotAgentContributionPatch),
  };
}
function compareAgentContributions(a: { origin: string; id: string }, b: { origin: string; id: string }): number {
  const origin = (CONTRIBUTION_ORIGIN_RANK[a.origin as SpawnExtensionOrigin] ?? 99) - (CONTRIBUTION_ORIGIN_RANK[b.origin as SpawnExtensionOrigin] ?? 99);
  if (origin !== 0) return origin;
  return a.id.localeCompare(b.id);
}
/** Build the versioned `{version:1, extensions}` snapshot shared with the runtime parser. */
export function buildVersionedAgentContributionSnapshot(
  packages?: readonly SpawnRegisteredExtension[],
): VersionedAgentContributionSnapshot {
  const items: Record<string, unknown>[] = [];
  for (const pkg of packages ?? []) {
    if (!pkg.enabled || !pkg.agentContribution) continue;
    const item = snapshotAgentContribution(pkg.id, pkg.agentContribution);
    if (item) items.push(item);
  }
  items.sort((a, b) => compareAgentContributions(
    { origin: String(a.origin), id: String(a.id) },
    { origin: String(b.origin), id: String(b.id) },
  ));
  if (!items.length) {
    return { version: AGENT_CONTRIBUTIONS_SNAPSHOT_VERSION, extensions: [], byteLength: 0, diagnostics: [] };
  }
  const json = JSON.stringify({ version: AGENT_CONTRIBUTIONS_SNAPSHOT_VERSION, extensions: items });
  const byteLength = Buffer.byteLength(json, "utf8");
  if (byteLength > AGENT_CONTRIBUTIONS_HOST_MAX_BYTES) {
    return {
      version: AGENT_CONTRIBUTIONS_SNAPSHOT_VERSION,
      extensions: [],
      byteLength,
      diagnostics: [{
        severity: "error",
        code: "contribution-snapshot-oversize",
        message: `Extension agent contributions snapshot is ${byteLength} bytes; host limit is ${AGENT_CONTRIBUTIONS_HOST_MAX_BYTES} (runtime accepts ${AGENT_CONTRIBUTIONS_RUNTIME_MAX_BYTES}). Contributions were disabled; extension/skills mounts are unchanged.`,
      }],
    };
  }
  return { version: AGENT_CONTRIBUTIONS_SNAPSHOT_VERSION, extensions: items, json, byteLength, diagnostics: [] };
}
/** Serialize enabled contributions as versioned JSON. Undefined when empty or over the host byte cap. */
export function serializeAgentContributions(packages?: readonly SpawnRegisteredExtension[]): string | undefined {
  return buildVersionedAgentContributionSnapshot(packages).json;
}
/** Canonical sidecar suffix shared with the runtime parser's basename check. */
export const CONTRIBUTION_SIDECAR_SUFFIX = ".ext-agent-contributions.json";
const CONTRIBUTION_SIDECAR_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Sidecar name for one session file: `chat.jsonl` → `chat.ext-agent-contributions.json`. */
export function contributionSidecarName(sessionFile: string): string {
  return basename(sessionFile).replace(/(\.jsonl|\.json)?$/i, "") + CONTRIBUTION_SIDECAR_SUFFIX;
}
/** Temp-file pattern for one sidecar name; crash leftovers are matched for session cleanup. */
export function contributionSidecarTempPattern(sidecarName: string): RegExp {
  return new RegExp(`^\\.${sidecarName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.\\d+\\.[0-9A-Fa-f-]+\\.tmp$`);
}
/**
 * Session-owned sidecar path, verified with realpath — never a lexical prefix guess.
 *
 * The jail is the session file's own (realpath-resolved) directory; the sidecar name is
 * the canonical derivation of the session file name. A directory that does not exist, a
 * jail outside every realpath-resolved agentDir/sessionsRoot root, or a session id that
 * is not a flat slug all refuse (undefined), so a prepositioned symlink on any path
 * component can only make the resolution fail, never relocate the sidecar.
 */
export function resolveContributionSnapshotFile(input: {
  sessionPath?: string;
  sessionId?: string;
  agentDir?: string;
  sessionsRoot?: string;
}): string | undefined {
  let jail: string | undefined;
  let name: string;
  if (input.sessionPath) {
    jail = dirname(input.sessionPath);
    name = contributionSidecarName(input.sessionPath);
  } else if (input.agentDir && input.sessionId) {
    if (!CONTRIBUTION_SIDECAR_SESSION_ID.test(input.sessionId)) return undefined;
    jail = join(resolve(input.agentDir), "sessions", input.sessionId);
    name = "ext-agent-contributions" + CONTRIBUTION_SIDECAR_SUFFIX;
  } else {
    return undefined;
  }
  if (name === CONTRIBUTION_SIDECAR_SUFFIX) return undefined; // empty session stem
  let realJail: string;
  try {
    realJail = realpathSync(jail);
    if (!lstatSync(realJail).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  const roots = [input.agentDir, input.sessionsRoot]
    .filter((root): root is string => Boolean(root))
    .map((root) => {
      try {
        return realpathSync(resolve(root));
      } catch {
        return undefined;
      }
    })
    .filter((root): root is string => Boolean(root));
  if (!roots.length) return undefined;
  const confined = roots.some((root) => {
    const rel = relative(root, realJail);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
  if (!confined) return undefined;
  return join(realJail, name);
}
/**
 * Atomic, no-follow sidecar replacement. The temp file is created with O_EXCL
 * (0600), written+fsynced, then renamed over the target; a pre-existing symlink,
 * non-regular file, or multi-link inode at the canonical path is refused instead
 * of replaced. Any failure returns false — the caller drops contributions only.
 */
function isPublishedSidecarStat(stat: { isFile(): boolean; mode: number; nlink: number }): boolean {
  return stat.isFile() && (stat.mode & 0o777) === 0o600 && stat.nlink === 1;
}
function writeContributionSnapshotFile(file: string, json: string): boolean {
  const dir = dirname(file);
  try {
    if (!lstatSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  try {
    const existing = lstatSync(file);
    if (!existing.isFile() || existing.nlink !== 1) return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
  }
  const tmp = join(dir, `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  let published = false;
  try {
    fd = openSync(tmp, "wx", 0o600);
    const buffer = Buffer.from(json, "utf8");
    let offset = 0;
    while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, file);
    published = true;
    const noFollow = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW;
    const verifyFd = openSync(file, constants.O_RDONLY | (noFollow ?? 0));
    try {
      if (!isPublishedSidecarStat(fstatSync(verifyFd))) throw new Error("sidecar verify");
    } finally {
      closeSync(verifyFd);
    }
    return true;
  } catch {
    if (published) {
      try { unlinkSync(file); } catch { /* best-effort rollback of a failed publish */ }
    }
    return false;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* already closed */ }
    }
    try { unlinkSync(tmp); } catch { /* renamed away or never created */ }
  }
}
/**
 * Delete the session's sidecar plus this system's orphaned temp files.
 * Only files at the exact canonical path (realpath-resolved, plus the pre-realpath
 * lexical location older versions wrote) are considered, and only when they look
 * like ours: regular file, within the byte cap, and parsing as a versioned
 * snapshot. Anything else is left untouched — never delete a file this system
 * does not own.
 */
export function removeContributionSnapshotSidecar(input: {
  sessionPath: string;
  agentDir?: string;
  sessionsRoot?: string;
}): void {
  const candidates = new Set<string>();
  const resolved = resolveContributionSnapshotFile(input);
  if (resolved) candidates.add(resolved);
  if (input.sessionPath) {
    candidates.add(resolve(input.sessionPath.replace(/(\.jsonl|\.json)?$/i, "") + CONTRIBUTION_SIDECAR_SUFFIX));
  }
  if (!candidates.size) return;
  const names = new Set([...candidates].map((candidate) => basename(candidate)));
  const noFollow = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW;
  for (const candidate of candidates) {
    let fd: number | undefined;
    try {
      const pre = lstatSync(candidate);
      if (!pre.isFile() || pre.size > AGENT_CONTRIBUTIONS_RUNTIME_MAX_BYTES) continue;
      fd = openSync(candidate, constants.O_RDONLY | (noFollow ?? 0));
      const opened = fstatSync(fd);
      if (
        !opened.isFile()
        || opened.size > AGENT_CONTRIBUTIONS_RUNTIME_MAX_BYTES
        || opened.dev !== pre.dev
        || opened.ino !== pre.ino
      ) continue;
      const buffer = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < buffer.length) {
        const read = readSync(fd, buffer, offset, buffer.length - offset, offset);
        if (read <= 0) break;
        offset += read;
      }
      closeSync(fd);
      fd = undefined;
      const parsed: unknown = JSON.parse(buffer.toString("utf8", 0, offset));
      if (
        !parsed || typeof parsed !== "object"
        || (parsed as { version?: unknown }).version !== AGENT_CONTRIBUTIONS_SNAPSHOT_VERSION
        || !Array.isArray((parsed as { extensions?: unknown }).extensions)
      ) continue;
      unlinkSync(candidate);
    } catch {
      /* not ours, unreadable, or already gone — leave it alone */
    } finally {
      if (fd !== undefined) {
        try { closeSync(fd); } catch { /* already closed */ }
      }
    }
  }
  try {
    const dir = dirname([...candidates][0]!);
    const patterns = [...names].map(contributionSidecarTempPattern);
    for (const entry of readdirSync(dir, { withFileTypes: true, encoding: "utf8" })) {
      if (!entry.isFile() || !patterns.some((pattern) => pattern.test(entry.name))) continue;
      try { unlinkSync(join(dir, entry.name)); } catch { /* raced away */ }
    }
  } catch {
    /* directory already gone */
  }
}
/** Worker remount: exact inline JSON, or the same session-owned file contents. Never a rescan. */
export function workerAgentContributionsSnapshot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[AGENT_CONTRIBUTIONS_ENV];
  if (typeof value === "string" && value) return value;
  const file = env[AGENT_CONTRIBUTIONS_FILE_ENV];
  if (typeof file !== "string" || !file) return undefined;
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}
function applyAgentContributionEnv(
  env: Record<string, string>,
  packages: readonly SpawnRegisteredExtension[] | undefined,
  input?: SpawnInput,
): void {
  const built = buildVersionedAgentContributionSnapshot(packages);
  if (!built.json) return;
  if (built.byteLength <= AGENT_CONTRIBUTIONS_ENV_MAX_BYTES) {
    env[AGENT_CONTRIBUTIONS_ENV] = built.json;
    return;
  }
  const file = input ? resolveContributionSnapshotFile(input) : undefined;
  if (!file || !writeContributionSnapshotFile(file, built.json)) return;
  env[AGENT_CONTRIBUTIONS_FILE_ENV] = file;
  env[AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV] = dirname(file);
}
function isHostBundledSubagentPath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const marker = "/pi-ext/subagent/";
  const index = normalized.indexOf(marker);
  if (index < 0) return normalized.endsWith("/pi-ext/subagent");
  const rest = normalized.slice(index + marker.length);
  if (!rest) return true;
  const top = rest.split("/")[0] ?? "";
  return top !== "test" && top !== "tests";
}

/** Refuse symlink/host/aliased mounts. Missing test fixtures stay keyed by resolved path. */
function classifyExtensionMount(filePath: string): { key: string } | undefined {
  if (isHostBundledSubagentPath(filePath)) return undefined;
  try {
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) return undefined;
    try {
      if (isHostBundledSubagentPath(realpathSync(filePath))) return undefined;
    } catch {
      /* inode identity is enough */
    }
    return { key: `${stat.dev}:${stat.ino}` };
  } catch {
    return { key: `path:${resolve(filePath)}` };
  }
}
/**
 * One mounted `-e` entry, recorded as the assembler builds argv so the spawn
 * contract published to the child is derived from what actually mounted rather
 * than re-derived from a second pass over the inputs.
 */
type MountRecord = { id: string; kind: "kernel" | "extension" | "project"; path: string; worker: boolean; tools?: readonly string[] };

/**
 * Ids a worker must not remount from the contract by default.
 *
 * This is the host stating a transport fact, not policy: these packages reach a
 * worker through a narrower gate than "the main session had it" — the memory
 * half only through the broker's issued, role-scoped identity, the skill loader
 * only when the worker's tool selection actually includes skills, and web
 * access only through the worker's own retrieval routing. Marking them here
 * keeps that decision in the worker where it belongs, instead of letting a
 * blanket remount hand every role a tool its policy withheld.
 */
const WORKER_GATED_EXTENSION_IDS: ReadonlySet<string> = new Set([
  "memory-extension",
  "skill-loader-extension",
  "web-access-extension",
]);

type RegisteredMountResult = { layerDirs: string[]; systemPrompt?: string };

function appendRegisteredExtensions(
  args:string[],
  env:Record<string,string>,
  mounts:MountRecord[],
  input:SpawnInput,
):RegisteredMountResult {
  const packages=input.registeredExtensions;
  const skillRoots:string[]=[];
  const layerDirs:string[]=[];
  let systemPrompt:string|undefined;
  const mountedIds:string[]=[];
  const classified:{ pkg:SpawnRegisteredExtension; key:string }[]=[];
  const keyCount=new Map<string, number>();
  for (const pkg of packages ?? []) {
    if (!pkg.enabled) continue;
    if (pkg.skillRoots) for (const root of pkg.skillRoots) if (root) skillRoots.push(root);
    // `agent.agentsDir`: the AGENT.md catalog a package owns. First declaration
    // wins — the child reads one root, and two catalogs would be a name race.
    if (pkg.agentsDir && !env.PIPIUI_AGENTS_DIR) env.PIPIUI_AGENTS_DIR = pkg.agentsDir;
    if (pkg.settings !== undefined) env[extensionSettingsEnvName(pkg.id)] = JSON.stringify(pkg.settings);
    // Declarative contributions apply even without a code entry: a pure form
    // pack (no `agent.extension`) can still own the session persona.
    if (pkg.systemPrompt && !systemPrompt) systemPrompt = pkg.systemPrompt;
    if (!pkg.extensionPath) continue;
    const mount = classifyExtensionMount(pkg.extensionPath);
    if (!mount) continue;
    classified.push({ pkg, key: mount.key });
    keyCount.set(mount.key, (keyCount.get(mount.key) ?? 0) + 1);
  }
  for (const { pkg, key } of classified) {
    if ((keyCount.get(key) ?? 0) > 1 || !pkg.extensionPath) continue;
    ext(args, pkg.extensionPath);
    if (pkg.secretEnv) Object.assign(env, pkg.secretEnv);
    mountedIds.push(pkg.id);
    // Prompt layers are declared by the manifest and appended in mount order, so a
    // second layer-owning package adds to the list instead of replacing the first.
    if (pkg.layerDir) layerDirs.push(pkg.layerDir);
    mounts.push({
      id: pkg.id,
      kind: "extension",
      path: pkg.extensionPath,
      worker: !WORKER_GATED_EXTENSION_IDS.has(pkg.id),
      ...(pkg.tools?.length ? { tools: pkg.tools } : {}),
    });
  }
  if (mountedIds.length) env[MOUNTED_EXTENSIONS_ENV] = mountedIds.join(",");
  if (skillRoots.length) env.PIPIUI_SKILL_ROOTS = skillRoots.join(delimiter);
  applyAgentContributionEnv(env, packages, input);
  return { layerDirs, systemPrompt };
}

/**
 * Publish the versioned spawn contract (`packs/agent-orchestration/spawn-contract.ts`).
 *
 * One env key replaces the family of `PIPIUI_*_EXT` paths the worker assembler
 * used to reconstruct argv from. It carries only transport — what mounted,
 * where, and whether a worker may remount it — so a new extension needs no new
 * env key and no edit here.
 */
function writeSpawnContract(
  env:Record<string,string>,
  contract:{corePrompt?:string;promptObserver?:string;layerDirs:readonly string[];mounts:readonly MountRecord[]},
):void {
  const document:Record<string,unknown>={
    version: SPAWN_CONTRACT_VERSION,
    layerDirs: [...contract.layerDirs],
    mounts: contract.mounts.map(mount=>({
      id: mount.id,
      kind: mount.kind,
      path: mount.path,
      worker: mount.worker,
      ...(mount.tools?.length ? { tools: [...mount.tools] } : {}),
    })),
  };
  if(contract.corePrompt)document.corePrompt=contract.corePrompt;
  if(contract.promptObserver)document.promptObserver=contract.promptObserver;
  env[SPAWN_CONTRACT_ENV]=JSON.stringify(document);
}
/**
 * Every entry a plain-pi package declares in `package.json` `pi.extensions`.
 *
 * Pi's own loader (`resolveExtensionEntries`) resolves each declared path
 * against the package directory and keeps the ones that exist, so a package
 * that declares four entries mounts four extensions. Reading only the first
 * silently dropped the rest, which is indistinguishable to the author from the
 * package not loading at all.
 *
 * `boundary` is the project's own tree, not the package directory: pi imposes
 * no containment at all, and a package that points at a sibling path inside the
 * same project is doing something the author can see and reason about. What the
 * boundary still refuses is an entry that climbs out of the project — into a
 * global pi home, a neighbouring repository, or an absolute path elsewhere on
 * the host — which the author of a checked-in `package.json` cannot vouch for.
 */
function declaredEntrypoints(root:string,boundary:string):string[] {
  try {
    const manifest=JSON.parse(readFileSync(join(root,"package.json"),"utf8"));
    const declared=manifest?.pi?.extensions;
    if(!Array.isArray(declared))return[];
    const entries:string[]=[];
    for(const entry of declared){
      if(typeof entry!=="string")continue;
      const candidate=resolve(root,entry);
      if(!withinBoundary(candidate,boundary))continue;
      if(!existsSync(candidate))continue;
      if(!entries.includes(candidate))entries.push(candidate);
    }
    return entries;
  } catch{return[]}
}

/** True when `candidate` is `boundary` itself or lives under it, symlinks resolved. */
function withinBoundary(candidate:string,boundary:string):boolean {
  const real=(path:string):string=>{try{return realpathSync(path)}catch{return resolve(path)}};
  const rel=relative(real(boundary),real(candidate));
  return rel===""||(!rel.startsWith("..")&&!isAbsolute(rel));
}
/**
 * A `pi` that a transitive dependency dragged in is never the one this host wants.
 *
 * `pi-mcp-extension` depends on the pre-rename `@mariozechner/pi-coding-agent` at `*`, which
 * installs an old Pi into this repo's node_modules and claims the `pi` name in
 * `node_modules/.bin`. npm puts that directory first on PATH for every `npm run` script, so
 * the external-Pi fallback used in development would resolve a build several minor versions
 * behind the one this host is written against — and that build rejects flags the host now
 * passes, turning a stale-but-working session into one that will not start at all.
 */
const isPackageLocalBin=(dir:string):boolean=>dir.split(/[\\/]/).includes("node_modules");
/**
 * Resolve the `pi` executable without a shell.
 *
 * An Electron app launched from Finder inherits a minimal PATH (`/usr/bin:/bin:…`), so a bare
 * "pi" spawns ENOENT even though the user's terminal finds it. Search PATH first, then the usual
 * install prefixes; the bare name is the
 * last resort so an unusual install still gets a real ENOENT instead of a silent wrong binary.
 */
export function resolvePiExecutable(env:NodeJS.ProcessEnv=process.env):string{
  const executable=process.platform==="win32"?"pi.cmd":"pi";
  const fromPath=(env.PATH??"").split(delimiter).filter(Boolean).filter(dir=>!isPackageLocalBin(dir)).map(dir=>join(dir,executable));
  const candidates=[...fromPath,join(homedir(),".npm-global","bin","pi"),"/opt/homebrew/bin/pi","/usr/local/bin/pi",join(homedir(),".bun","bin","pi"),join(homedir(),".local","bin","pi")];
  return candidates.find(candidate=>{try{accessSync(candidate,constants.X_OK);return true}catch{return false}})??"pi";
}
const NODE_BIN = process.platform === "win32" ? "node.exe" : "node";

/**
 * Process-wide memoization for the shim scan. A real Node binary is 100+ MB, and reading
 * even a slice of it on every spawn blocks the host event loop long enough to stall the pi
 * child's streaming stdout. Entries are validated against the file's size+mtime, so a
 * replaced executable is re-inspected instead of reused. `withToolPath` itself stays
 * uncached: its remaining cost is a handful of statSync calls, and caching the first PATH
 * decision would freeze it for the App's lifetime even after the toolchain changes.
 */
type ShimCacheEntry={size:number;mtimeMs:number;isShim:boolean};
const shimCache=new Map<string,ShimCacheEntry>();

/**
 * Packaged Electron ships `node` as a shim that execs Helper under
 * ELECTRON_RUN_AS_NODE. Detect that script so user commands can prefer a real
 * Node binary instead of turning every `npm test` into a Helper swarm.
 *
 * Only the first 400 bytes are read: the marker lives in the shebang header, and a full
 * `readFileSync` of a real binary blocked the host event loop for several seconds per call
 * on 100-200MB binaries, batching the pi child's streamed stdout into one burst.
 */
export function isElectronNodeShim(executable: string): boolean {
  try {
    const stat = statSync(executable);
    const cached = shimCache.get(executable);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.isShim;
    let isShim: boolean;
    try {
      const fd = openSync(executable, "r");
      try {
        const buffer = Buffer.alloc(400);
        const bytesRead = readSync(fd, buffer, 0, 400, 0);
        const head = buffer.toString("utf8", 0, bytesRead);
        isShim = head.startsWith("#!") && head.includes("ELECTRON_RUN_AS_NODE");
      } finally {
        closeSync(fd);
      }
    } catch {
      // A transient read failure (EMFILE, …) must not be frozen into a permanent verdict:
      // answer "not a shim" for this call only and leave the cache untouched.
      return false;
    }
    shimCache.set(executable, { size: stat.size, mtimeMs: stat.mtimeMs, isShim });
    return isShim;
  } catch {
    return false;
  }
}

function nodeBinaryIn(dir: string): string {
  return join(dir, NODE_BIN);
}

function isRealNodeDir(dir: string): boolean {
  const binary = nodeBinaryIn(dir);
  try {
    accessSync(binary, constants.X_OK);
    return !isElectronNodeShim(binary);
  } catch {
    return false;
  }
}

/**
 * Finder/Dock-launched apps inherit a minimal PATH, so pi's `#!/usr/bin/env node` shebang and any
 * `node`/`npm` child exit 127 unless the
 * well-known tool dirs (pi's own bin, Homebrew, /usr/local) are prepended.
 *
 * When the packaged Electron node shim is on PATH and a real Node exists, drop
 * the shim directory: Pi itself is launched by absolute path / PIPIUI_NODE_PATH,
 * but bash/`npx`/`#!/usr/bin/env node` must not inherit Helper as `node`.
 */
export function withToolPath(env:Record<string,string>, piExecutable:string):Record<string,string>{
  const fallbackDirs=["/opt/homebrew/bin","/usr/local/bin",join(homedir(),".local","bin"),join(homedir(),".npm-global","bin"),"/usr/bin","/bin"];
  const existing=(env.PATH??"").split(delimiter).filter(Boolean);
  const candidates=[...new Set([dirname(piExecutable),...existing,...fallbackDirs].filter(Boolean))];
  const hasShim=candidates.some(dir=>isElectronNodeShim(nodeBinaryIn(dir)));
  if(!hasShim)return {...env,PATH:candidates.join(delimiter)};
  const realNodeDirs=candidates.filter(isRealNodeDir);
  if(realNodeDirs.length===0)return {...env,PATH:candidates.join(delimiter)};
  const withoutShim=candidates.filter(dir=>!isElectronNodeShim(nodeBinaryIn(dir)));
  return {...env,PATH:[...new Set([...realNodeDirs,...withoutShim])].join(delimiter)};
}
/** Host-independent fallback for tests/embedders. The Electron app injects app.getPath('userData'). */
export function defaultRuntimeRoot():string { return join(homedir(),".pipiui-electron","runtime") }
export type ManagedPackage={name:string;version:string};
/**
 * The two extensions pi does not ship in this repository. Pinned exactly — a range or tag would
 * let the mounted extension change between launches — and declared once so the installer and the
 * mount lookup can never drift onto different versions.
 */
export const MANAGED_PACKAGES:readonly ManagedPackage[]=[{name:"pi-web-access",version:"0.23.0"},{name:"pi-mcp-extension",version:"1.5.0"}];
export const HERMES_MEMORY_PACKAGE:ManagedPackage={name:"pi-hermes-memory",version:"0.9.6"};
/**
 * The memory system ships as the standalone `memory-extension` manifest package
 * (frozen tools: memory_query / memory_status). Its agent half wraps the
 * loopback memory broker package in place, so the broker stays the worker
 * identity root and the Hermes adapter (pi-hermes-memory 0.9.6) remains an
 * internal compatibility layer. The id is still named here only because the
 * App-profile seed store resolves that one package's content-addressed slot;
 * the spawn assembler itself no longer knows it exists.
 */
export const MEMORY_EXTENSION_ID="memory-extension";
export type SpawnRuntimeLayoutOptions={managedNodeModulesRoot?:string};

/**
 * Host-owned facts about one installed runtime tree.
 *
 * Not a mount table: every entry here is a directory the child is told about,
 * and none of them is gated on an extension being enabled. An absent path is
 * always `undefined`, never a guess.
 */
export function resolveRuntimeLayout(
  runtimeRoot:string=defaultRuntimeRoot(),
  options:SpawnRuntimeLayoutOptions={},
):SpawnRuntimeLayout {
  const layout:SpawnRuntimeLayout={};
  const hermes=managedPackageRoot(runtimeRoot,HERMES_MEMORY_PACKAGE,options.managedNodeModulesRoot);
  if(hermes)layout.hermesMemory=hermes;
  return layout;
}

/** Installed root of one version-pinned managed npm package, or undefined when the pin does not match. */
export function managedPackageRoot(
  runtimeRoot:string,
  pkg:ManagedPackage,
  managedNodeModulesRoot?:string,
):string|undefined {
  const root=managedNodeModulesRoot
    ? join(managedNodeModulesRoot,pkg.name)
    : join(runtimeRoot,"managed-npm",`${pkg.name}-${pkg.version}`,"node_modules",pkg.name);
  try{
    return JSON.parse(readFileSync(join(root,"package.json"),"utf8"))?.version===pkg.version?root:undefined;
  }catch{return undefined}
}
