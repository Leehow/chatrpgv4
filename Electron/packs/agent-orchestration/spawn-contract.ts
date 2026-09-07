/**
 * The one typed contract between the Electron host's spawn assembler and the
 * worker-side assembler in `pi-ext/subagent`.
 *
 * Before this module the two halves agreed through ~15 untyped `PIPIUI_*_EXT`
 * environment variables — one per extension the host happened to know about —
 * and nothing type-checked across the gap: adding a mount meant editing a host
 * table, a worker `if`, and a sanitizer allowlist, and forgetting any of the
 * three failed silently at runtime. Here the host publishes one versioned JSON
 * document describing everything a child process needs in order to rebuild the
 * same `-e` argument list, and the worker reads it back.
 *
 * The document is *transport*, not policy. It says what is mounted and whether
 * a mount is safe to remount in a worker; it never says which tools a role may
 * use — that stays with the worker's own tool policy.
 *
 * Deliberately dependency-free and side-effect-free: the host build
 * (`packages/pi-backend`, `rootDir: src`) cannot import this file, so
 * `spawn-assembly.ts` writes the same shape from its own writer and
 * `packages/pi-backend/test/spawn-contract.test.ts` round-trips host output
 * through the reader below. `SPAWN_CONTRACT_VERSION` is asserted equal on both
 * sides by that test, so a shape change that only lands on one side fails
 * before it can ship.
 */

/** Inline JSON. Sanitized like every other `PIPIUI_*` key, so a stale inherited value cannot survive. */
export const SPAWN_CONTRACT_ENV = "PIPIUI_SPAWN_CONTRACT";
/** Bump only together with the reader below and the host writer. */
export const SPAWN_CONTRACT_VERSION = 1;

/**
 * Where a mount came from. `kernel` is host machinery that is still mounted in
 * a session with every extension disabled; `extension` is a manifest package
 * from the registry; `project` is a plain pi extension the user dropped in
 * their own project home.
 */
export type SpawnMountKind = "kernel" | "extension" | "project";

export type SpawnContractMount = {
	/** Extension id, `kernel:<name>`, or `project:<basename>`. Unique within one contract. */
	id: string;
	kind: SpawnMountKind;
	/** Absolute path passed to pi as `-e`. */
	path: string;
	/**
	 * Whether a worker may remount this by default. False marks mounts a worker
	 * reaches through some other gate (role-gated skills, the memory broker's
	 * issued identity) or must never load at all (host-only kernel surfaces).
	 */
	worker: boolean;
	/** Tool names the manifest declares this mount registers. Empty for kernel/project mounts. */
	tools?: string[];
};

export type SpawnContract = {
	version: typeof SPAWN_CONTRACT_VERSION;
	/** Absolute path to the locked base system prompt, if the runtime ships one. */
	corePrompt?: string;
	/** Absolute path to the tool-free prompt observer. Workers mount it last, when prompt debugging is on. */
	promptObserver?: string;
	/** Prompt-layer directories contributed by enabled extensions, in mount order. */
	layerDirs: string[];
	mounts: SpawnContractMount[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function parseMount(value: unknown): SpawnContractMount | undefined {
	if (!isRecord(value)) return undefined;
	const id = nonEmptyString(value.id);
	const path = nonEmptyString(value.path);
	const kind = value.kind;
	if (!id || !path) return undefined;
	if (kind !== "kernel" && kind !== "extension" && kind !== "project") return undefined;
	const mount: SpawnContractMount = { id, kind, path, worker: value.worker === true };
	if (Array.isArray(value.tools)) {
		const tools = value.tools.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
		if (tools.length) mount.tools = tools;
	}
	return mount;
}

/**
 * Strict parse of one contract document. Anything unrecognizable yields
 * `undefined` rather than a partially-populated contract: a worker that cannot
 * read the contract falls back to "mount nothing extra", which is recoverable,
 * while a half-parsed one would silently drop mounts.
 */
export function parseSpawnContract(text: string | undefined): SpawnContract | undefined {
	if (!text) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed) || parsed.version !== SPAWN_CONTRACT_VERSION) return undefined;
	if (!Array.isArray(parsed.mounts)) return undefined;
	const mounts: SpawnContractMount[] = [];
	const seen = new Set<string>();
	for (const item of parsed.mounts) {
		const mount = parseMount(item);
		if (!mount || seen.has(mount.id)) continue;
		seen.add(mount.id);
		mounts.push(mount);
	}
	const layerDirs = Array.isArray(parsed.layerDirs)
		? parsed.layerDirs.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
		: [];
	const contract: SpawnContract = { version: SPAWN_CONTRACT_VERSION, layerDirs, mounts };
	const corePrompt = nonEmptyString(parsed.corePrompt);
	if (corePrompt) contract.corePrompt = corePrompt;
	const promptObserver = nonEmptyString(parsed.promptObserver);
	if (promptObserver) contract.promptObserver = promptObserver;
	return contract;
}

export function serializeSpawnContract(contract: SpawnContract): string {
	return JSON.stringify(contract);
}

/**
 * Read the contract this process was spawned with.
 *
 * It travels inline rather than as a sidecar file because it is bounded by
 * construction — one absolute path per mounted extension plus the tool names a
 * manifest declares, tens of entries at most, single-digit kilobytes — so
 * unlike the agent-contribution snapshot it has no growth path that could
 * approach ARG_MAX.
 */
export function readSpawnContract(env: Record<string, string | undefined>): SpawnContract | undefined {
	return parseSpawnContract(env[SPAWN_CONTRACT_ENV]);
}

export function findSpawnMount(contract: SpawnContract | undefined, id: string): SpawnContractMount | undefined {
	return contract?.mounts.find((mount) => mount.id === id);
}

/**
 * `-e` arguments for a child of this process: every mount the host marked
 * remountable, with `first` ids hoisted so load-order-sensitive extensions
 * (the orchestration half) still initialize before the rest.
 */
export function workerSpawnMountArgs(
	contract: SpawnContract | undefined,
	options: { first?: readonly string[]; skip?: readonly string[] } = {},
): string[] {
	if (!contract) return [];
	const first = options.first ?? [];
	const skip = new Set(options.skip ?? []);
	const eligible = contract.mounts.filter((mount) => mount.worker && !skip.has(mount.id));
	const rank = (mount: SpawnContractMount) => {
		const index = first.indexOf(mount.id);
		return index < 0 ? first.length : index;
	};
	const ordered = eligible
		.map((mount, index) => ({ mount, index }))
		.sort((a, b) => rank(a.mount) - rank(b.mount) || a.index - b.index)
		.map((item) => item.mount);
	const args: string[] = [];
	for (const mount of ordered) args.push("-e", mount.path);
	return args;
}

/** Comma-joined ids of the manifest packages mounted in this spawn (tool-ownership policy input). */
export function mountedExtensionIds(contract: SpawnContract | undefined): string[] {
	return (contract?.mounts ?? []).filter((mount) => mount.kind === "extension").map((mount) => mount.id);
}
