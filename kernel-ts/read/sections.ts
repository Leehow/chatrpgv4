/**
 * Contract §183: a package's instruction, whole while the table's instructions fit a budget and indexed beyond it.
 *
 * A package that requires `instructions.sections.v1` names a JSON file in `contributes.sections` declaring every `## `
 * section of its `agent.md`: resident (rides every turn) or situational (named topics of the product's closed list,
 * kernel and host gates, triggers). The kernel checks the shape when the manifest loads and the topic names when the
 * catalog loads; it decides each package's form while it assembles `capsule.mods`, and evaluates its gates there from
 * the turn's own state. Which topics a player's words involve is the host's question (Jev), never a reading here.
 */
import { join } from "node:path";
import type { KernelContext } from "../context.js";
import { RpcError } from "../errors.js";
import { parsePythonJson } from "../json.js";
import { APPLY_KINDS, CORE_CAPABILITY_NAMES } from "../apply/kinds.js";
import type { ModuleGraph } from "./module-graph.js";
import { array, row, string, number, integer, numeric, type Row } from "./values.js";

export const SECTIONS_CAPABILITY = "instructions.sections.v1";
export const DISCOVERY_CAPABILITY = "instructions.discovery.v1";
/** The UTF-8 bytes of package instructions a request carries whole before sectioned packages go indexed (§183.3). */
export const INSTRUCTION_BUDGET = 65536;
/** Gates the kernel evaluates on the turn's state (§183.3); `no_topic` is the host's (§183.5). */
export const KERNEL_GATES: readonly string[] = ["opening", "people_present", "present_without_history", "unregistered_equipment",
    "registered_instances", "threat_clock", "stall", "recover", "clue_here", "handed_clue_here", "reentry",
    // §180.10: a creature present, and a present being whose row carries a weakness chain.
    "creature_present", "weakness_here",
    // §203.3: the turn owes an establishing reply (`mods.establish` is on the capsule).
    "establish"];
export const HOST_GATES: readonly string[] = ["no_topic"];
/** The decision families a `resolve` settles: the ruleset's `decision:coc7:<family>:` prefixes and the kernel's own
 *  `objects:` decisions. A test holds this to the ruleset. */
export const RESOLVE_FAMILIES: readonly string[] = ["chase", "combat", "core-check", "development", "healing", "magic", "objects",
    "psychology", "push-luck", "sanity", "social"];
const ENTRY_FIELDS = new Set(["heading", "kind", "topics", "gates", "triggers", "topic_threshold"]);
const DISCOVERY_FIELDS = new Set([...ENTRY_FIELDS,"applicability","category","dependencies"]);
const TOPIC_ID = /^[a-z][a-z0-9_]{0,63}$/;
const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const plain = (value: unknown): value is Row => value != null && typeof value === "object" && !Array.isArray(value);
const label = (manifest: Row): string => `${string(manifest.id ?? "?")} ${string(manifest.version ?? "?")}`;
function refuse(manifest: Row, message: string, details: Row = {}): never {
    throw new RpcError("invalid_params", `${label(manifest)}: ${message}`, {
        details: { mod: string(manifest.id ?? "?"), version: string(manifest.version ?? "?"), field: "contributes.sections", ...details },
    });
}

export type Section = {
    readonly heading: string | null;
    readonly kind: "resident" | "situational";
    readonly topics: readonly string[];
    readonly gates: readonly string[];
    readonly triggers: readonly string[];
    readonly topic_threshold: number;
    /** The section as the Keeper reads it: its `## ` line, then its text. The preamble has no heading line. */
    readonly text: string;
    readonly index_contract_version?: 2;
    readonly applicability?: {what:string;not_for:string;examples:string[]};
    readonly category?: string;
    readonly dependencies?: readonly string[];
};

/** `agent.md` cut at its `## ` lines. The preamble is the text before the first, less a leading `# ` title line. */
export function cutInstruction(markdown: string): { preamble: string; parts: Array<{ heading: string; body: string }> } {
    const lines = markdown.split("\n"), parts: Array<{ heading: string; body: string[] }> = [], before: string[] = [];
    for (const line of lines) {
        const match = /^## (.+?)\s*$/.exec(line);
        if (match)
            parts.push({ heading: match[1], body: [] });
        else
            (parts.at(-1)?.body ?? before).push(line);
    }
    const head = before.join("\n").trim().replace(/^# [^\n]*\n?/, "").trim();
    return { preamble: head, parts: parts.map(part => ({ heading: part.heading, body: part.body.join("\n").trim() })) };
}

function trigger(manifest: Row, value: unknown, at: number): string {
    const text = string(value), [kind, name, ...rest] = text.split(":");
    const known = rest.length === 0 && (kind === "state" ? KERNEL_GATES.includes(name)
        : kind === "before_apply" ? APPLY_KINDS.includes(name)
            : kind === "before_resolve" ? RESOLVE_FAMILIES.includes(name) : false);
    if (typeof value !== "string" || !known)
        refuse(manifest, `section ${at}: unknown trigger ${JSON.stringify(value)}`, { entry: at, trigger: value ?? null,
            kinds: ["state:<kernel gate>", "before_apply:<effect kind>", "before_resolve:<decision family>"] });
    return text;
}

/** The declaration's shape against the package's own `agent.md`. Topic ids are checked against the product's list
 *  where the catalog loads (`validateSectionsContribution`); everything else is decided here. */
export function parseSections(manifest: Row, raw: unknown, markdown: string): Section[] {
    if (!plain(raw) || ![1,2].includes(raw.schema_version) || !Array.isArray(raw.sections) || !raw.sections.length
        || Object.keys(raw).some(key => key !== "schema_version" && key !== "sections"))
        refuse(manifest, "sections.json must declare a supported schema_version and a nonempty sections list");
    const discovery=raw.schema_version===2;
    if(discovery&&!array(manifest.requires).includes(DISCOVERY_CAPABILITY))
        refuse(manifest,'a version-2 section index must require '+DISCOVERY_CAPABILITY);
    const { preamble, parts } = cutInstruction(markdown);
    const headings = parts.map(part => part.heading);
    const twice = headings.find((heading, i) => headings.indexOf(heading) !== i);
    if (twice !== undefined)
        refuse(manifest, `agent.md has the heading "## ${twice}" twice`, { heading: twice });
    const seen = new Set<string | null>(), result: Section[] = [];
    (raw.sections as unknown[]).forEach((entry, at) => {
        if (!plain(entry) || Object.keys(entry).some(key => !(discovery?DISCOVERY_FIELDS:ENTRY_FIELDS).has(key)))
            refuse(manifest, `section ${at} must be an object of ${[...ENTRY_FIELDS].join(", ")}`, { entry: at });
        const heading = entry.heading === null ? null : typeof entry.heading === "string" && entry.heading.trim() ? entry.heading : undefined;
        if (heading === undefined)
            return refuse(manifest, `section ${at}: heading must be the text of a ## line of agent.md, or null for the text before the first`, { entry: at });
        if (heading !== null && !headings.includes(heading))
            refuse(manifest, `section ${at}: agent.md has no heading "## ${heading}"`, { entry: at, heading, headings });
        if (heading === null && !preamble)
            refuse(manifest, `section ${at}: agent.md has no text before its first ## heading`, { entry: at });
        if (seen.has(heading))
            refuse(manifest, `two entries name ${heading === null ? "the preamble" : `"## ${heading}"`}`, { entry: at, heading });
        seen.add(heading);
        const kind = entry.kind;
        if (kind !== "resident" && kind !== "situational")
            refuse(manifest, `section ${at}: kind is resident or situational`, { entry: at, kind: kind ?? null });
        const has = (key: string) => Object.hasOwn(entry, key);
        if (kind === "resident" && ["topics", "gates", "triggers", "topic_threshold","applicability","category","dependencies"].some(has))
            refuse(manifest, `section ${at}: a resident section rides every turn and names no topics, gates or triggers`, { entry: at });
        const list = (key: string): unknown[] => {
            if (!has(key)) return [];
            const value = entry[key];
            if (!Array.isArray(value) || !value.length || new Set(value).size !== value.length)
                refuse(manifest, `section ${at}: ${key} must be a non-empty list without repeats`, { entry: at, [key]: value ?? null });
            return value;
        };
        const topics = list("topics").map(topic => {
            if (typeof topic !== "string" || (topic !== "*" && !TOPIC_ID.test(topic)))
                refuse(manifest, `section ${at}: unknown topic ${JSON.stringify(topic)}`, { entry: at, topic: topic ?? null });
            return topic as string;
        });
        if (topics.includes("*") && topics.length > 1)
            refuse(manifest, `section ${at}: "*" stands alone in topics`, { entry: at });
        const gates = list("gates").map(gate => {
            if (typeof gate !== "string" || (!KERNEL_GATES.includes(gate) && !HOST_GATES.includes(gate)))
                refuse(manifest, `section ${at}: unknown gate ${JSON.stringify(gate)}`, { entry: at, gate: gate ?? null, gates: [...KERNEL_GATES, ...HOST_GATES] });
            return gate as string;
        });
        const triggers = list("triggers").map(value => trigger(manifest, value, at));
        if (kind === "situational" && !discovery && !topics.length && !triggers.length)
            refuse(manifest, `section ${at}: a situational section names topics, triggers or both`, { entry: at });
        if ((gates.length || has("topic_threshold")) && !topics.length && !discovery)
            refuse(manifest, `section ${at}: gates and topic_threshold qualify topics and need them`, { entry: at });
        const raw = has("topic_threshold") ? entry.topic_threshold : 0.5, threshold = typeof raw === "number" ? raw : numeric(raw) ? number(raw) : NaN;
        if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1)
            refuse(manifest, `section ${at}: topic_threshold is a number between 0 and 1`, { entry: at, topic_threshold: raw ?? null });
        let detail:Pick<Section,'applicability'|'category'|'dependencies'>={};
        if(discovery&&kind==='situational'){
            const applies=entry.applicability;
            if(!plain(applies)||Object.keys(applies).some(key=>!['what','not_for','examples'].includes(key))
                ||typeof applies.what!=='string'||!applies.what.trim()||applies.what.length>400
                ||typeof applies.not_for!=='string'||applies.not_for.length>300
                ||!Array.isArray(applies.examples)||applies.examples.length>3
                ||applies.examples.some(value=>typeof value!=='string'||!value.trim()||value.length>200))
                refuse(manifest,'section '+at+': invalid bounded applicability');
            if(typeof entry.category!=='string'||!entry.category.trim()||entry.category.length>100)
                refuse(manifest,'section '+at+': a discovery category must be authored nonempty text');
            const rawDependencies=has('dependencies')?entry.dependencies:[];
            if(!Array.isArray(rawDependencies)||new Set(rawDependencies).size!==rawDependencies.length)
                refuse(manifest,'section '+at+': dependencies must be a list without repeats');
            const dependencies=rawDependencies.map(value=>{
                if(typeof value!=='string'||!CORE_CAPABILITY_NAMES.includes(value))
                    refuse(manifest,'section '+at+': unknown capability dependency',{dependency:value});
                return value as string;
            });
            detail={applicability:{what:applies.what,not_for:applies.not_for,examples:[...applies.examples]},
                category:entry.category,dependencies};
        }
        const body = heading === null ? preamble : parts.find(part => part.heading === heading)!.body;
        result.push({ heading, kind, topics, gates, triggers, topic_threshold: threshold, ...(discovery?{index_contract_version:2 as const}:{}),...detail, text: heading === null ? body : `## ${heading}\n\n${body}`.trim() });
    });
    const missing = headings.filter(heading => !seen.has(heading));
    if (missing.length)
        refuse(manifest, `every ## heading of agent.md needs one entry; none for ${missing.map(h => `"## ${h}"`).join(", ")}`, { missing });
    if (preamble && !seen.has(null))
        refuse(manifest, "agent.md has text before its first ## heading and no entry with heading null", { missing: [null] });
    return result;
}

function readDeclaration(manifest: Row, files: ReadonlyMap<string, Uint8Array>): Section[] {
    const contributes = row(manifest.contributes);
    let raw: unknown;
    try { raw = parsePythonJson(decode(files.get(string(contributes.sections))!)); }
    catch { return refuse(manifest, "contributes.sections must be valid UTF-8 JSON"); }
    return parseSections(manifest, raw, decode(files.get(string(contributes.instructions))!));
}

/** With the rest of the manifest (`manifestFrom`): the pairing, the path, the shape against `agent.md`. */
export function validateSectionsDeclaration(manifest: Row, files: ReadonlyMap<string, Uint8Array>): void {
    // Requiring the capability without contributing is allowed: such a package simply goes whole. The other way round is
    // refused, so a kernel without the capability marks the package incompatible instead of meeting an unknown field.
    const contributes = row(manifest.contributes), path = contributes.sections, required = array(manifest.requires).includes(SECTIONS_CAPABILITY);
    if (path == null)
        return;
    if (!required)
        refuse(manifest, `a package contributing sections must require ${SECTIONS_CAPABILITY}`);
    if (contributes.instructions == null)
        refuse(manifest, "contributes.sections cuts contributes.instructions and needs it");
    if (typeof path !== "string" || !path.endsWith(".json") || !files.has(path))
        refuse(manifest, "contributes.sections must name a package JSON file");
    if (Array.isArray(manifest.package_files) && !manifest.package_files.includes(path))
        refuse(manifest, "package_files must include contributes.sections");
    readDeclaration(manifest, files);
}

/** The product's topic list (§183.2), read once per content tree. */
const topicLists = new Map<string, Promise<Map<string, Row>>>();
export function topicList(context: KernelContext): Promise<Map<string, Row>> {
    const path = join(context.content, "mods", "topics.json");
    let list = topicLists.get(path);
    if (!list) {
        list = (async () => {
            const raw = row(await context.snapshots.readJson(path));
            if (raw.schema_version !== 1 || !Array.isArray(raw.topics))
                throw new RpcError("internal", `${path} is not a topic list`);
            return new Map(array(raw.topics).map(topic => [string(row(topic).id), { id: string(row(topic).id), what: string(row(topic).what),
                not_for: string(row(topic).not_for), examples: array(row(topic).examples).map(string) }]));
        })();
        list.catch(() => topicLists.delete(path));
        topicLists.set(path, list);
    }
    return list;
}

/** Where the catalog loads: every topic a section names is on the product's list. */
export async function validateSectionsContribution(context: KernelContext, manifest: Row, files: ReadonlyMap<string, Uint8Array>): Promise<void> {
    if (row(manifest.contributes).sections == null)
        return;
    const topics = await topicList(context);
    readDeclaration(manifest, files).forEach((section, at) => {
        const unknown = section.topics.find(topic => topic !== "*" && !topics.has(topic));
        if (unknown !== undefined)
            refuse(manifest, `section ${at}: "${unknown}" is not on the product's topic list`, { entry: at, topic: unknown, topics: [...topics.keys()] });
    });
}

/** A loaded package's sections, by digest (its bytes are frozen per version). */
const cuts = new Map<string, Section[]>();
export function packageSections(mod: Row): Section[] {
    const digest = string(mod.digest);
    let sections = cuts.get(digest);
    if (!sections) {
        sections = readDeclaration(mod, mod.files as ReadonlyMap<string, Uint8Array>);
        cuts.set(digest, sections);
    }
    return sections;
}
export const sectioned = (mod: Row): boolean => row(mod.contributes).sections != null;
export const sectionKey = (mod: Row, ordinal: number): string => `${string(mod.id)}@${string(mod.version)}#${ordinal}`;

/** `COC_INSTRUCTION_BUDGET` in the kernel's environment, when it is a positive integer; else the contract's budget. */
export function instructionBudget(): number {
    const value = Number(process.env.COC_INSTRUCTION_BUDGET ?? "");
    return Number.isSafeInteger(value) && value > 0 ? value : INSTRUCTION_BUDGET;
}

export const INDEXED_LEAD = "Further sections of this package arrive in coc-mod-sections when a turn needs them.";
/** The text an indexed row carries every turn: one line on where the rest arrives, then the resident sections. */
export function residentText(sections: readonly Section[]): string {
    return [INDEXED_LEAD, ...sections.filter(section => section.kind === "resident").map(section => section.text)].join("\n\n");
}

/** The turn's state the kernel gates read, gathered while the capsule assembles and before any budget cuts it. */
export type TurnFacts = {
    readonly opening: boolean;
    /** `present[]` rows as assembled (with `history`); a creature's row carries `kind: "creature"`, a person's no `kind`. */
    readonly present: readonly Row[];
    /** Undiscovered clues of this scene a present person or the scene itself hands over (delivery obvious, or
     *  npc_dialogue with a speaker present). */
    readonly handed: number;
    readonly undiscovered: number;
    readonly stalled_turns: number;
    /** The Director's own stall threshold; a package's integer `stall_turns` setting overrides it for that package. */
    readonly stall_threshold: number;
    readonly beat: string;
    readonly repeat_input: boolean;
    readonly threat_clocks: number;
};

/** The scene's clue facts: undiscovered clues here, and those the scene hands over (delivery obvious) or a present
 *  person does (npc_dialogue, with someone present who is the clue's source or knows it) -- the thread's own rule. */
export function sceneFacts(graph: ModuleGraph, world: Row, scene: Row, present: readonly Row[]): { undiscovered: number; handed: number } {
    const here = new Set(present.map(node => string(node.node_id))), found = new Set(array(world.discovered_clues).map(string));
    let undiscovered = 0, handed = 0;
    for (const id of graph.sceneClueIds(scene)) {
        const node = graph.nodes.get(id);
        if (!node || found.has(graph.handle(node)))
            continue;
        undiscovered++;
        const profile = graph.clueProfile(node), kind = string(profile.delivery_kind || "");
        if (kind === "obvious" || kind === "npc_dialogue" && [...array(profile.source_npc_ids).map(string), ...graph.npcsKnowing(node)].some(npc => here.has(npc)))
            handed++;
    }
    return { undiscovered, handed };
}

/** A present row is a person's when it carries no `kind` (§180.4: a creature's says `creature`). */
const isPersonRow = (entry: Row): boolean => !Object.hasOwn(row(entry), "kind");
/** Every kernel gate for one package (`settings` carries its own stall threshold, if it has one). */
export function kernelGates(facts: TurnFacts, mods: Row, settings: Row): Record<string, boolean> {
    const own = row(settings).stall_turns, threshold = integer(own) && number(own) > 0 ? number(own) : facts.stall_threshold;
    return {
        opening: facts.opening,
        // §180.10: the people gates count person rows only, which carry no `kind`; a creature has no history to lack.
        people_present: facts.present.some(isPersonRow),
        present_without_history: facts.present.filter(isPersonRow).some(person => row(row(person).history).last_spoke_turn == null),
        creature_present: facts.present.some(entry => row(entry).kind === "creature"),
        weakness_here: facts.present.some(entry => row(entry).weaknesses != null || row(entry).false_leads != null),
        unregistered_equipment: array(mods.unregistered_equipment).length > 0,
        registered_instances: array(row(mods.objects).instances).length > 0,
        threat_clock: facts.threat_clocks > 0,
        stall: facts.stalled_turns >= threshold,
        recover: facts.beat === "RECOVER" || facts.repeat_input,
        clue_here: facts.undiscovered > 0,
        handed_clue_here: facts.handed > 0,
        reentry: row(mods.thread).reentry != null,
        establish: mods.establish != null,
    };
}

/** §183.3: `gates_open` and `due` on every indexed row's sections. */
export function annotateGates(mods: Row, facts: TurnFacts): void {
    for (const instruction of array(mods.instructions)) {
        if (instruction.form !== "indexed")
            continue;
        const gates = kernelGates(facts, mods, row(instruction.settings));
        for (const section of array(instruction.sections)) {
            section.gates_open = array(section.gates).every((gate: string) => !KERNEL_GATES.includes(gate) || gates[gate]);
            section.due = array(section.triggers).some((value: string) => value.startsWith("state:") && gates[value.slice(6)]);
        }
    }
}
