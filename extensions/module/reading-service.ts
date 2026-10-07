/** A single host service for PDF preparation and foreground/background reading. */
import { readFile, writeFile, mkdir, copyFile, appendFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { KernelError , isKernelError } from "../kernel/client.ts";
import { readerInput, readerInputInlines, readingCacheId, wakeReaderSlots, type ReaderOutcome, type ReaderRequest } from "./reader.ts";
import { providerRefusalText } from "../../runtime/jev/provider-budget.ts";
import { reviewCandidate, type CoverageCarrySource, type ReviewPlan } from "./reader-review.ts";
import { APPEND_REPAIR_ASK, appendUnitCarry, checkAppendRepair, checkTargetedRepair, repairDecision, reviewOfCandidate, TARGETED_REPAIR_ASK, type RepairDecision } from "./targeted-repair.ts";
import { salvageInterruptedRead } from "./read-salvage.ts";
import { accountingFields, readingAccounting, tallyChildJev, tallyFirstCall, tallyReadingRow } from "./reading-accounting.ts";
import { readerInstructionText } from "../../runtime/reader-instructions.ts";
import { sourceAsset, closeSourceDocuments, sourceRenderVersion, sourceTextVersion } from "./source.ts";
import { registerSourcePdf, SourceUnreadable } from "./source-registration.ts";
import {successfulImageDeliveries} from './reader-image-delivery.ts';
import {requireCheckedSourceReceipt} from './reader-source-receipt.ts';
import {PUBLIC_GUIDANCE_FIELDS,validatePublicGuidance} from '../../kernel-ts/modules/public-guidance.ts';
import {validateSourceNeeds} from '../../kernel-ts/modules/source-needs.ts';
import { publishableAssetNodes, validateMapRegions, draftHasMapRegions } from "./map-publication.ts";
import type { HostRuntime } from "../../runtime/host.ts";
import type {FreshSourceNavigator} from '../../runtime/jev/fresh-source-navigator.ts';
import type {PublicationTravel, TravelFill} from './travel-fill.ts';
import type {ClaimSupportCheck, ClaimSupportRequest} from './claim-support.ts';
import {runSourceReference} from './source-reference.ts';
import {acceptedGuidance,acceptedPublicGuidance} from './character-guidance.ts';
import {validateReferencePacket} from '../../kernel-ts/modules/reference-contract.ts';
import {readNeedReceipt,type NeedReceipt} from '../../runtime/jev/source-need-reads.ts';
import {requireVisualOverview} from '../../kernel-ts/modules/visual-discovery.ts';
import {mapReviewPreviews} from './map-review-preview.ts';
import {IdentityReviewUnavailable,reviewVisualIdentity} from './visual-identity-review.ts';

import type {TaskProviderBudget} from '../../runtime/jev/provider-budget.ts';
import {measuredPageCost, readingJobStage, readingStageBudget, type StageBudget} from '../../runtime/jev/reading-stage-budget.ts';
import {readingImageBudget, readingReviewBudget, windowPlacesBudget, type WindowPlacesBudget} from '../../runtime/jev/host-budgets.ts';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {runWindowPlaces, WINDOW_PLACES_FAMILY} from '../../runtime/jev/window-places.ts';
/**
 * `allowanceMs` (contract §22.4.3, SL-36): the foreground allowance of an in-turn source consultation. Past it `ensure`
 * resolves `{state: "pending", job_id, read, index, settled}` instead of refusing with `reading_timeout`: the waiter leaves
 * (§61 demotes the job), the reading goes on in the background, and `settled` is that same reading's outcome. The allowance's
 * named default is the lookup's (`SOURCE_ANSWER_ALLOWANCE_MS`, `extensions/kernel/source-answers.ts`).
 */
export interface ReadingOptions {providerBudget?:TaskProviderBudget; allowanceMs?: number;
	/**
	 * §22.4.7 (SL-47): the reading stays blocking after its waiter leaves (no §61 demotion): the party stands in the scene it
	 * reads, so it keeps its blocking slot (§22.4.6) until it settles, though no call waits on it.
	 */
	blocking?: boolean}
/** §22.4.7: one page of the bound document's native text, as the reading service extracts it. */
export interface SourcePageText {page: number; pdf_label?: string; text: string}
type Row = Record<string, any>;
type Call = (method: string, params: Row) => Promise<any>;
/** A complete supported review missing issued pointers needs review repair, not source re-authoring. */
export function omittedReviewOnly(required:unknown,review:Row,guidance=false):boolean{
	if(!Array.isArray(required)||!Array.isArray(review?.checked)||!Array.isArray(review?.missing)||review.missing.length||
		review.checked.some((row:Row)=>row.verdict!=='supported')||
		guidance&&(review.guidance?.approved!==true||!Array.isArray(review.guidance?.issues)||review.guidance.issues.length))return false;
	const checked=new Set(review.checked.flatMap((row:Row)=>Array.isArray(row.paths)?row.paths:[row.path]));
	return required.some(path=>typeof path==='string'&&!checked.has(path));
}
/** Reuse an accepted entrance without asking the source author to transcribe its graph again. */
export function selectedGuidanceProjection(knownNodes:unknown,focus:string,pageCount:number):{draft:Row;sourcePages:number[]}|null{
	if(!Array.isArray(knownNodes)||!focus.trim())return null;
	const nodes=knownNodes.filter((value):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value));
	const normalize=(value:unknown)=>typeof value==='string'?value.normalize('NFKC').toLowerCase().replace(/[_\s-]+/g,' ').trim():'';
	const wanted=normalize(focus),module=nodes.find(node=>node.node_kind==='module');
	const scene=nodes.find(node=>node.node_kind==='scene'&&[node.node_id,node.name,
		node.properties?.runtime_projection?.record?.scene_id].some(value=>normalize(value)===wanted));
	if(!module||!scene||scene.properties?.is_entrance!==true||
		!Array.isArray(module.properties?.entry_scene_ids)||!module.properties.entry_scene_ids.includes(scene.node_id))return null;
	const pages=(node:Row):number[]|null=>{
		if(!Array.isArray(node.source_refs)||!node.source_refs.length||
			node.source_refs.some((ref:Row)=>!Number.isSafeInteger(ref?.page)||ref.page<1||ref.page>pageCount))return null;
		return node.source_refs.map((ref:Row)=>ref.page);
	};
	const scenePages=pages(scene),modulePages=pages(module);
	if(!scenePages||!modulePages||typeof scene.node_id!=='string'||typeof scene.name!=='string'||
		!scene.name.trim()||!['player-safe','revealable','keeper-only'].includes(scene.visibility))return null;
	const sourcePages=[...new Set([...scenePages,...modulePages])].sort((a,b)=>a-b);
	if(sourcePages.length>12)return null;
	return {sourcePages,draft:{nodes:[{node_id:scene.node_id,node_kind:'scene',name:scene.name,
		properties:{},visibility:scene.visibility,source_refs:scene.source_refs.map((ref:Row)=>({...ref}))}],
		claims:[],node_refs:[],coverage:{},dependencies:[],source_needs:[],critical:['/nodes/0'],ready_nodes:[]}};
}
/** Author pages plus host-nominated alternate entrances for an independent original-page check. */
export async function guidanceReviewPages(cwd:string,task:Row,sourceSha:string,pageCount:number,authorPages:number[]):Promise<number[]>{
	const pages=new Set(authorPages.filter(page=>Number.isSafeInteger(page)&&page>=1&&page<=pageCount));
	if(task.purpose!=='guidance'&&task.opening_scope!=='first_interaction')return [...pages].sort((a,b)=>a-b);
	if(task.guidance_projection)for(const page of task.guidance_projection.source_pages??[])pages.add(page);
	let lead:Row;
	try{lead=JSON.parse(await readFile(join(cwd,'source-navigation-review.json'),'utf8'));}
	catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [...pages].sort((a,b)=>a-b);throw error;}
	if(lead.version!==1||lead.source_sha256!==sourceSha||lead.guidance_key!==task.guidance_key||
		!Array.isArray(lead.opening_probe_pages)||lead.opening_probe_pages.length>20||
		lead.opening_probe_pages.some((page:unknown)=>!Number.isSafeInteger(page)||Number(page)<1||Number(page)>pageCount))
		throw new Error('Source navigation reviewer assignment is stale or invalid; source binding changed');
	for(const page of lead.opening_probe_pages)pages.add(page);
	if(task.opening_scope==='first_interaction'){
		if(lead.purpose!==task.purpose||lead.focus!==task.focus||!Array.isArray(lead.scope_probe_pages)||lead.scope_probe_pages.length>20||
			lead.scope_probe_pages.some((page:unknown)=>!Number.isSafeInteger(page)||Number(page)<1||Number(page)>pageCount))
			throw new Error('Current-interaction reviewer assignment is stale or invalid');
		for(const page of lead.scope_probe_pages)pages.add(page);
	}
	return [...pages].sort((a,b)=>a-b);
}
export interface ReadingBridge {
	reference?(moduleId:string,params:Row,signal?:AbortSignal):Promise<Row|undefined>;
	prepare(params: Row, signal?: AbortSignal, options?: ReadingOptions): Promise<Row>;
	ensure(moduleId: string, params: Row, signal?: AbortSignal, options?:ReadingOptions): Promise<Row>;
	/**
	 * §47. Is the reading the Keeper's foreground wait gave up on *still* running? A
	 * `reading_timeout` is the host's own patience ending, never the reader's: on campaign
	 * `game-b4cebfe0` (2026-09-16) the wait ran out at 120 s and the material arrived seconds later,
	 * while the sentence the player read still said it was being prepared. The service notice asks
	 * this at the moment it is sent, so a reading that has since landed is not announced as pending.
	 */
	reading(moduleId: string, params: Row): boolean;
	/** §22.4.7 (SL-47): the native text of pages of the module's bound document (§22.1's extraction), 1-based. */
	sourcePages?(moduleId: string, pages: number[], params?: Row, signal?: AbortSignal): Promise<SourcePageText[]>;
}
interface Dependencies {
	call: Call;
	campaign?(): string | undefined;
	home: string;
	runtime?: HostRuntime;
	navigateFresh?: FreshSourceNavigator;
	/**
	 * §138.9: the build step that names the length of every road a publication adds (`createTravelFill`). Asked
	 * before `module.read.finish`, so the minutes land in the same generation; never a reason to fail the reading.
	 */
	travel?(input: PublicationTravel): Promise<TravelFill | undefined>;
	/** §151.3: the Jev claim-support check of the verify phase (`createClaimSupport`); absent, every fact unit goes to vision. */
	claimSupport?(request: ClaimSupportRequest): Promise<ClaimSupportCheck | undefined>;
	model(): { id: string; vision: boolean; thinking?: string; contextWindow?: number };
	progress(row: Row): void;
	record(row: Row): void;
	/** The operator's out-of-fiction surface for a lane that stopped working (contract §22, shaped after §32.2). */
	status?(row: Row): void;
	/** §177.2: the book's cast landed, so the lanes that name people can ask again (the module extension emits it). */
	published?(row: Row): void;
	/**
	 * SL-87: schedules the end of a foreground wait (`ensure`'s allowance, or `PI_COC_READ_WAIT_MS`) and returns its cancel.
	 * Absent: `setTimeout`, exactly as before. A test whose subject is what happens inside and past the allowance, not its
	 * length, ends the wait itself once the claim it is about has landed.
	 */
	waitTimer?(callback: () => void, ms: number): () => void;
	/** §190.1: the environment the window-places lane reads its Jev credential from. Absent: `process.env`. */
	env?: NodeJS.ProcessEnv;
	/** §190.1, tests only: the window-places budget instead of the shipped file's. */
	windowPlacesBudget?: WindowPlacesBudget;
}
const realWaitTimer = (callback: () => void, ms: number): (() => void) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer); };
interface PendingReading {
	providerBudget?:TaskProviderBudget;
	waiters: number;
	cancelled: boolean;
	jobId?: string;
	/**
	 * §61. Whether a turn is blocked on this reading *right now*, which is not the same as the
	 * `foreground` the first `ensure` asked for. Every later `ensure` that joins with `foreground`
	 * raises it again; the moment the last waiter leaves it drops, and `fulfil` stops re-asserting
	 * foreground on its next poll. Without this field the polling loop would re-promote the job in
	 * the kernel milliseconds after the demotion.
	 */
	foreground: boolean;
	/** §61. The last waiter left before this reading had a job id; demote it as soon as it has one. */
	demotePending?: boolean;
	/**
	 * §22.2.1. The kernel answered with another identity's reading of the same focus: this request waits on
	 * it and is judged afresh once it settles, and a cancelled wait never cancels that reading.
	 */
	attached?: boolean;
	/** §47. What this in-flight reading is of, so `reading()` can answer for it by name. */
	of?: { campaign?: string; mid: string; focus: string; question: string };
	/** §22.4.3. What the book's index holds on this consultation's focus, from the kernel's last reply. */
	index?: Row[];
	/** §22.4.7. Blocking with no waiter: never demoted when its waiters leave. */
	blocking?: boolean;
}
/**
 * How long a claimed reading job may report nothing at all before the host stops it. A reader child
 * that is working says so: every phase change, every reader run and every review unit writes a
 * telemetry row, and the longest legitimate gap measured on a real book was 141 s (one review unit,
 * campaign game-3dd94f0a). A job past this window is not slow, it is gone -- on 2026-09-15 two of
 * them went quiet mid-verify and left the module `blocked` for 6.5 hours with a restart as the only
 * remedy. The window is deliberately far above the observed gap: a false stop costs a real reader run.
 */
const STALL_WINDOW_MS = 600_000;
const STALL_SWEEP_MS = 30_000;
/** §177.2: native text is extracted this many pages a call (`sourceText` takes at most 32). */
const CAST_TEXT_BATCH = 32;
/** §177.2: a range's reader run, and a second when the kernel refused the first's submit. */
const CAST_ATTEMPTS = 2;
const CAST_TIMEOUT_MS = 20 * 60_000;
function stallWindow(): number {
	const configured = Number(process.env.PI_COC_READ_STALL_MS);
	return Number.isFinite(configured) && configured > 0 ? configured : STALL_WINDOW_MS;
}
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function canonical(value: any): string {
	if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
	if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
	return JSON.stringify(value);
}
const integerList = (value: unknown): number[] => Array.isArray(value)
	? value.filter((entry): entry is number => Number.isInteger(entry))
	: [];
const mapCandidateKey = (candidate: Row): string => canonical({
	name: candidate.name,
	focus: candidate.focus,
	pages: [...integerList(candidate.pages)].sort((a, b) => a - b),
});
function editedSourcePages(before: Row, after: Row): Set<number> {
	const result = new Set<number>();
	if (Array.isArray(after.source_refs) && canonical(before) !== canonical(after))
		for (const ref of after.source_refs) result.add(ref.page);
	for (const collection of ["nodes", "claims", "source_needs"]) {
		const id = (row: Row) => collection==='source_needs'?canonical([row.focus,row.question,row.kind]):row.node_id ?? row.claim_id ?? canonical([row.subject_id, row.predicate, row.object]);
		const previous = new Map((before[collection] ?? []).map((r: Row) => [id(r), canonical(r)]));
		for (const row of after[collection] ?? []) {
			if (previous.get(id(row)) === canonical(row)) continue;
			for (const ref of [...(row.source_refs ?? []), ...(row.properties?.image_sources ?? [])]) result.add(ref.page);
		}
	}
	return result;
}
function draftPages(draft: Row): number[] { return [...editedSourcePages({}, draft)]; }
function validCheckpoint(checkpoint: Row, bytes: Buffer, job: Row): boolean {
	if (checkpoint.draft_sha256 !== sha(bytes)) return false;
	const observed = checkpoint.observations;
	if (observed?.file_sha256 !== job.source.file_sha256) return false;
	if(job.visual_scan){try{requireVisualOverview(job.visual_scan,observed.overview_pages??[]);}catch{return false;}}
	return job.purpose === "index"
		? checkpoint.index_map_audited === true && observed.full_pages?.length > 0
		: draftPages(JSON.parse(bytes.toString())).every(page => observed.read_pages?.includes(page));
}
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const error = (reason: string, message: string, fix: string, extra: Row = {}) =>
	new KernelError({ code: "needs", message, fix, details: { reason, ...extra } });
/**
 * Contract §20 addendum 2: a round that failed on the provider, typed. A refusal from a lease the job shares
 * across its rounds (`shared`, a stage lease) is final: the second round would reserve from the same lease.
 * The error's details carry §22.3.1's `rule`/`reason` strings, so the kernel keeps them on the failed job.
 */
function providerFailure(run: ReaderOutcome, shared: boolean): { error: KernelError; final: boolean } {
	const refusal = run.refusal;
	const message = refusal ? providerRefusalText(refusal)
		: `reader_transport: the provider failed the round (${String(run.providerError).slice(0, 300)})`;
	return { final: !!refusal && shared, error: new KernelError({ code: "needs", message, fix: "request the same reading with retry: true",
		details: { reason: refusal ? refusal.reason : "transport", rule: refusal ? "provider_budget_refused" : "reader_transport",
			...(refusal ? { refusal } : { provider_error: run.providerError }) } }) };
}
/**
 * §22.3.1 / §48: a reading the publication gate refused is said in one sentence built from the refusal the
 * kernel kept -- the field it refused and the gate's own reason, the same record findings.json holds. It is
 * written here, so it is branded `said` here; the preparation overlay shows it instead of the generic stop.
 */
/** §22.3.3 (SL-57): what a reader re-reading a refused focus is told (system language). */
export const REVIEW_RETRY_ASK = "An earlier reading of this focus was refused at independent review: task.review_retry.refused lists each refused field "
	+ "with the reviewer's reason. Re-read the pages those fields came from and write only what the pages state; correct or drop what they do not.";
/** §151.4: what a unit reader is told about the retained source needs located inside its pages (system language). */
export const CARRIED_NEEDS_ASK = "task.carried_needs lists open source questions about known entities whose located pages fall inside your assigned pages. "
	+ "Answer each one from those pages only, as ordinary records with source_refs, when the pages state it; add nothing for a question they do not answer.";
function refusedReading(params: Row, refusal: Row, fix: string): KernelError {
	const of = String(params.focus ?? "").trim(), at = typeof refusal.path === "string" && refusal.path ? ` at ${refusal.path}` : "";
	const failure = new KernelError({ code: "needs", fix,
		message: `The reading of ${of ? `"${of}"` : "this book"} was refused${at}: ${String(refusal.message).split("\n")[0].replace(/[.\s]+$/, "")}.`,
		details: { reason: "reading_failed", refusal } });
	return Object.assign(failure, { said: true });
}
/**
 * A draft the kernel refused with a fix is a repair, whatever the reading was for. Only an opening
 * used to get the round; an index refused for rows without their contents-page reference, or a
 * detail refused on one node, ended as a failed job nobody retried, and the book stayed unread.
 */
/** §90.3's own words: the one thing a way-on repair adds, and what it must not touch. */
const WAY_ON_ASK = "This reading repairs one thing: the opening scene publishes no way on. Keep every node and claim already in the retained draft exactly as it is, including ready_nodes, and add only what the pages state: either the relation the book gives from this scene to the place it leads to (route-to, play-precedes, may-lead-to, alternative-to or hands-off-to) together with the target scene node the book names for it, or, when the book ends in this scene, is_final on this scene. Do not invent a destination the pages do not name, and do not remove anything.";
function finishSemanticRejection(failure: unknown): boolean {
	return isKernelError(failure) && failure.code === "invalid_params";
}
/** §152.4: how many times one publication asks the identity reviewer before the refusal is the reading's own. */
const IDENTITY_ASKS = 3;
/** §152.4: the pairs a publication refused as `visual_identity_pending`, or undefined for any other refusal. */
function identityPending(failure: unknown): Row[] | undefined {
	return isKernelError(failure) && failure.code === "needs" && failure.details?.reason === "visual_identity_pending" && Array.isArray(failure.details.pairs)
		? failure.details.pairs as Row[] : undefined;
}
/** Resolve a JSON pointer against a draft, or `undefined` when it does not land. */
function atPointer(draft: Row, pointer: unknown): unknown {
	if (typeof pointer !== "string" || !pointer.startsWith("/")) return undefined;
	let value: any = draft;
	for (const raw of pointer.slice(1).split("/")) {
		const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
		if (value === null || typeof value !== "object") return undefined;
		value = Array.isArray(value) ? value[Number(key)] : value[key];
	}
	return value;
}
/**
 * The one repair an unsupported number has, said in words the repair round can act on.
 *
 * Every numeric properties field is reviewed automatically, so a number the book does not
 * print cannot be cited into support — it has to go. Nothing told the reader that. The
 * reviewer reports only that it found no source; the kernel answers *correct the draft using
 * the original pages and submit again*; and the repair round, handed both, re-cited the same
 * invented value and failed identically (§74).
 *
 * Measured on `Masks of Nyarlathotep` (669 pages, 2026-09-17): one minor NPC's `age: 32`,
 * `missing: []`, every other unit supported. Two rounds failed, and the player's only offered
 * recovery -- the offer to keep preparing in the background -- inherited the same draft and
 * failed a third time. A book prepared but
 * for one fabricated number is unplayable forever.
 *
 * Only numbers get this line. A prose field the review could not support may well be
 * repairable by reading the right page, and telling the reader to delete it would trade a
 * stall for a silent omission.
 */
function unsupportedNumberRepairs(draft: Row, unsupported: Row[]): string[] {
	const repairs: string[] = [];
	for (const row of unsupported) {
		const paths = Array.isArray(row?.paths) ? row.paths : [row?.path];
		for (const path of paths) {
			if (typeof atPointer(draft, path) !== "number") continue;
			repairs.push(`${path}: the review found no page stating this number. Either view a page that prints this exact value and cite it, or delete the field. Re-citing pages that do not print it fails the same way. Deleting an unsourced number is a correct repair, not a loss: the field stops being reviewed once it is gone.`);
		}
	}
	return repairs;
}


export class ReadingService implements ReadingBridge {
	private stopped = false;
	private requests = new Map<string, PendingReading & { task: Promise<Row> }>();
	private jobBudgets=new Map<string,TaskProviderBudget>();
	private claimBindings = new Map<string, Promise<void>>();
	private pumps = new Map<string, Promise<void>>();
	private pumpWakes = new Map<string, () => void>();
	private controllers = new Map<string, AbortController>();
	private jobs = new Map<string, Row>();
	private priorityWaiting=new Map<string,number>();
	private cancelledJobs = new Set<string>();
	/** Per claimed job, the moment it last reported anything: the lane's own heartbeat, never an inference from elapsed wall clock. */
	private heartbeats = new Map<string, number>();
	/** Jobs this host stopped for going quiet, and how long they had been quiet: their finish is `failed`, not `cancelled`. */
	private stalled = new Map<string, number>();
	/** Jobs stopped at a hand-off (`dispose({handOff})`): their finish is left to the next owner's claim. */
	private handedOff = new Set<string>();
	/**
	 * §22.4.6 (SL-45). Background jobs this host stopped to give their slot to a blocking read: when, and for which job.
	 * Their attempt is returned with `module.read.yield`, never finished.
	 */
	private displaced = new Map<string, {at: number; forJob?: string}>();
	/** When this host started each claimed job, for the displacement row's `ran_ms`. */
	private startedAt = new Map<string, number>();
	private sweep: ReturnType<typeof setInterval> | undefined;
	private stallNotified = false;
	/** Per scoped module, the reason of the most recent wake no claim has answered yet: the claim row names it (contract §22, #65). */
	private wakes = new Map<string, string>();
	/** §182.4: per scoped module, the last reading window a read-ahead reported, so `read_window` is written only on a change. */
	private windows = new Map<string, string>();
	/** §190.1: per scoped module, the window-places pass in flight or last run; the next window's pass chains after it. */
	private windowPlaceRuns = new Map<string, Promise<void>>();
	/** Aborted by `dispose`: the host lanes this service starts in the background (§190.1) stop with it. */
	private readonly lanes = new AbortController();
	private readonly deps: Dependencies;
	/**
	 * The unwrapped recorder, for rows the *host* writes about a job rather than rows the job writes
	 * about itself. The wrapper below is a heartbeat, and a host decision such as §61's demotion is no
	 * evidence that the reader child is still alive: recording it through the wrapper would hand a
	 * silent reader up to ten more minutes before the stall watchdog stopped it.
	 */
	private readonly note: (row: Row) => void;
	constructor(deps: Dependencies) {
		// Every row a claimed job writes is also its heartbeat. Wrapping here rather than at each call
		// site makes the rule structural: anything that reaches the operator reaches the stall watchdog,
		// and a new telemetry row can never be added without the lane counting as alive when it lands.
		const beat = (row: Row) => { if (row && row.job_id) this.beat(JSON.stringify([row.campaign, row.module_id, row.job_id])); };
		this.note = row => deps.record(row);
		this.deps = { ...deps,
			record: row => { beat(row); deps.record(row); },
			progress: row => { beat(row); deps.progress(row); } };
	}
	private campaign(params: Row): string | undefined {
		// null explicitly selects the library, even when this service is bound to a campaign.
		return params.campaign === null ? undefined : params.campaign ?? this.deps.campaign?.();
	}
	private call(method: string, params: Row, campaign: string | undefined): Promise<any> {
		const { campaign: _scope, ...rest } = params;
		return this.deps.call(method, { ...rest, ...(campaign !== undefined ? { campaign } : {}) });
	}
	/** A queued job must receive its budget before this service can claim it, including a prefetch wake. */
	private async bindBeforeClaim<T>(mid: string, campaign: string | undefined, action: () => Promise<T>): Promise<T> {
		const scope = JSON.stringify([campaign, mid]), previous = this.claimBindings.get(scope);
		let release!: () => void;
		const binding = new Promise<void>(resolve => { release = resolve; });
		this.claimBindings.set(scope, binding);
		try { if (previous) await previous; return await action(); }
		finally { release(); if (this.claimBindings.get(scope) === binding) this.claimBindings.delete(scope); }
	}
	private runtime(): HostRuntime {
		if (!this.deps.runtime) throw new Error("Source reading requires its owner's runtime");
		return this.deps.runtime;
	}

	/**
	 * Stop every claimed reading. With `handOff` (the onboarding worker's exit, contract §20 addendum 2), a
	 * reading nobody is waiting on is handed off rather than cancelled: its reader child stops and the job is
	 * left `running` with no lock holder, which the next owner's claim re-queues with its retained attempt.
	 */
	dispose(options: {handOff?: boolean} = {}) {
		this.stopped = true;
		this.lanes.abort();
		this.stopSweep();
		for (const [key, controller] of this.controllers) {
			if (options.handOff && (this.jobs.get(key)?.foreground !== true||this.jobs.get(key)?.source_unit)) this.handedOff.add(key);
			controller.abort();
		}
	}

	async close(options: {handOff?: boolean} = {}) { this.dispose(options); try { await Promise.allSettled([...this.pumps.values(), ...this.casting.values(), ...this.windowPlaceRuns.values()]); } finally { await closeSourceDocuments(); } }

	/** The heartbeat of one claimed job. Called only where the reader reported something real. */
	private beat(key: string) { if (this.heartbeats.has(key) || this.controllers.has(key)) this.heartbeats.set(key, Date.now()); }

	private startSweep() {
		if (this.sweep || this.stopped) return;
		this.sweep = setInterval(() => this.checkStalls(), Math.min(STALL_SWEEP_MS, stallWindow()));
		this.sweep.unref?.();
	}

	private stopSweep() {
		if (!this.sweep) return;
		clearInterval(this.sweep);
		this.sweep = undefined;
	}

	/**
	 * A reading job that has reported nothing for the whole stall window is stopped and finished as
	 * `failed`, so the module stops saying "still being read" and the ordinary `retry: true` path
	 * (contract §22) can pick it up. It is not requeued here: an automatic requeue would re-spend a
	 * real reader run on a child that just proved it hangs, and the host already owns one bounded
	 * automatic repair per read identity per player turn.
	 */
	checkStalls(now = Date.now()): void {
		const window = stallWindow();
		for (const [key, at] of [...this.heartbeats]) {
			if(this.priorityWaiting.has(key))continue;
			const idle = now - at;
			if (idle < window) continue;
			const job = this.jobs.get(key);
			if (!job || this.stalled.has(key)) continue;
			this.stalled.set(key, idle);
			const [campaign, moduleId] = JSON.parse(key) as [string | undefined, string, string];
			const row = { lane: "reading", event: "stalled", module_id: moduleId, campaign, job_id: job.job_id,
				purpose: job.purpose, focus: job.focus ?? "", idle_ms: idle, window_ms: window, foreground: job.foreground === true };
			// No `-progress` frame: §22.5 fixes that channel's `stage` to source|index|read|verify, and a
			// stall is not a stage. The telemetry row above and the operator notice below carry the signal.
			this.deps.record(row);
			// The operator's surface, once per session-level outage: the reader lane is a service, and a
			// service that keeps dying is not something the player or the Keeper can fix (contract §32.2).
			if (!this.stallNotified) {
				this.stallNotified = true;
				this.deps.status?.({ ...row, status: "down",
					fix: "The source reader stopped reporting progress and was stopped, so this material stays unprepared. Check the reader model and provider, or set PI_COC_BUILD_MODEL to a healthy provider/model; the table keeps playing on everything already prepared." });
			}
			this.controllers.get(key)?.abort();
		}
		if (!this.heartbeats.size) this.stopSweep();
	}

	/** In-flight calls finish; source work yields before the next provider reservation. */
	private async waitForPriority(job:Row,key:string,signal:AbortSignal,campaign?:string):Promise<void>{
		const rank=(value:Row)=>value.foreground===true?0:value.purpose==='opening'?1:value.reference_fragment?2:value.reference_stream&&value.purpose==='index'?4:value.source_unit?3:2;
		const blocked=()=>{
			const priority=rank(job);if(priority===0)return false;
			// A pending request may need this reader's focus lock. Claim ordering and
			// reserved foreground capacity belong to the kernel; only runnable work
			// may suspend a reader here, or both sides can wait forever.
			return [...this.jobs].some(([otherKey,other])=>otherKey!==key&&other.module_id===job.module_id&&rank(other)<priority);
		};
		if(!blocked())return;
		const began=Date.now();this.priorityWaiting.set(key,(this.priorityWaiting.get(key)??0)+1);
		this.deps.record({lane:'reading',event:'priority_wait',module_id:job.module_id,job_id:job.job_id,purpose:job.purpose,campaign});
		try{while(blocked()){signal.throwIfAborted();await delay(25);}signal.throwIfAborted();}
		finally{const remaining=(this.priorityWaiting.get(key)??1)-1;if(remaining)this.priorityWaiting.set(key,remaining);else this.priorityWaiting.delete(key);this.beat(key);
			this.deps.record({lane:'reading',event:'priority_resumed',module_id:job.module_id,job_id:job.job_id,purpose:job.purpose,campaign,
				ms:Date.now()-began,cancelled:signal.aborted});}
	}
	private async referenceGuidance(mid:string,params:Row,signal:AbortSignal|undefined,options:ReadingOptions):Promise<Row|undefined>{
		if(!this.deps.runtime?.sourceReferences)return;
		const status=await this.call('module.reference.status',{module_id:mid,focus:params.start_scene||''},undefined);
		const source=await this.call('module.source.snapshot',{module_id:mid},undefined);
		if(source.window)return;
		if(status.source_reference&&status.character_guidance?.[params.guidance_key])return {state:'ready',setup_ready:true,reference_ready:status.ready,source_reference:true,guidance_key:params.guidance_key,
			guidance:await acceptedGuidance(this.deps.home,mid,params.guidance_key),public_fields:await acceptedPublicGuidance(this.deps.home,mid,params.guidance_key)};
		let packet;
		if(status.source_reference?.packet_file){
			const path=resolve(dirname(source.pdf),status.source_reference.packet_file),bytes=await readFile(path);
			if(createHash('sha256').update(bytes).digest('hex')!==status.source_reference.packet_sha256)throw Error('Original source context changed');
			packet=validateReferencePacket(JSON.parse(bytes.toString()),source.page_count,source.file_sha256);
		}
		const progress=(state:string,fields?:Row)=>this.deps.progress({stage:'guidance',purpose:'guidance',module_id:mid,public_preparation:{
			source_sha256:source.file_sha256,module_id:mid,guidance_key:params.guidance_key,opening:params.start_scene||'',job_id:'source-reference',attempt:params.guidance_key,
			fields:Object.fromEntries(PUBLIC_GUIDANCE_FIELDS.map(field=>[field,fields?.[field]?.status==='value'?{state:'confirmed',value:fields[field].text}:fields?{state:fields[field]?.status==='needs_choice'?'needs_choice':'unavailable'}:{state}]))}});
		progress('searching');
		const result=await runSourceReference({runtime:this.runtime(),source:{...source,cache:join(dirname(source.pdf),'cache','pages')},moduleId:mid,kind:'guidance',focus:params.start_scene||'',
			language:params.play_language,packet,providerBudget:options.providerBudget,model:this.deps.model(),signal,record:this.deps.record});
		const published=await this.call('module.reference.publish',{module_id:mid,work_dir:result.workDir,guidance_key:params.guidance_key,play_language:params.play_language,start_scene:params.start_scene||''},undefined);
		progress('confirmed',published.public_fields);
		if(!published.setup_ready)throw new KernelError({code:'needs_choice',message:'Choose an authored starting entrance',fix:'Select one of details.candidates and retry prepare-module',
			details:{...published.opening?.choice,introduction:published.introduction,source_reference:true}});
		return {...published,source_reference:true};
	}
	async reference(mid:string,params:Row,signal?:AbortSignal):Promise<Row|undefined>{
		if(!this.deps.runtime?.sourceReferences)return;
		const campaign=this.campaign(params);
		if(params.materialize_place)await this.readAhead({module_id:mid,focus:params.focus||''},campaign);
		const source=await this.call('module.source.snapshot',{module_id:mid},campaign);
		if(source.window)return;
		try{const known=await this.call('module.reference.status',{module_id:mid,focus:params.focus||''},campaign);
			const result=await runSourceReference({runtime:this.runtime(),source:{...source,cache:join(dirname(source.pdf),'cache','pages')},moduleId:mid,kind:'lookup',materializePlace:params.materialize_place===true,
			focus:params.focus||'',question:params.question||'Read the requested physical place and its necessary conditions.',knownNodes:known.known_nodes,model:this.deps.model(),signal,record:this.deps.record});
			let material:Row|undefined;if(params.materialize_place){if(!result.packet.places?.length)return;material=await this.call('module.reference.materialize',{module_id:mid,work_dir:result.workDir},campaign);this.recordLibrarySync(material,{module_id:mid,campaign});if(material.state!=='ready')return;void this.readAhead({module_id:mid,focus:material.scene},campaign).then(()=>{this.wakes.set(JSON.stringify([campaign,mid]),'reference-place');return this.pump(mid,campaign);}).catch(()=>undefined);}
			return {state:'ready',...(material?{material}:{}),source_answer:{status:'excerpts',authority:'original-source-excerpts',prepared:!!material,...(material?{scene:material.scene,scene_name:material.name,material_scope:'source-place-identity-only'}:{}),source_sha256:result.packet.source_sha256,
				answer:result.packet.excerpts.map(span=>`[Original physical page ${span.page}]\n${span.text}`).join('\n\n'),excerpts:result.packet.excerpts,
				source_refs:[...new Set(result.packet.excerpts.map(span=>span.page))].map(page=>({source_id:'pdf:'+mid,pdf_index:page-1})),
				coverage:{partial:true,visual:'unassessed',unavailable_pages:result.packet.unavailable_pages},
				note:'Exact original source excerpts, not a generated answer or completed graph. Use alongside published material and established campaign facts. Follow necessary connections; do not infer whole-book absence or overwrite table canon. Inspect original page images when a visual detail is needed.'}};
		}catch(error){if(signal?.aborted)throw error;this.deps.record({lane:'source-reference',event:'visual_fallback',module_id:mid,campaign,detail:String(error)});return;}
	}
	prefetch(moduleId: string, reason = 'requested'): Promise<void> {
		if (this.stopped) return Promise.resolve();
		const campaign = this.deps.campaign?.();
		this.deps.record({lane:'reading',event:'prefetch_wake',module_id:moduleId,campaign,reason});
		// §190.1: a table opening (or its reader arriving after it) reads the window once, so the window's places are asked
		// at the open rather than after the first background reading finishes; the read-ahead's own change check starts them.
		if ((reason === 'table-open' || reason === 'reader-ready') && campaign !== undefined && this.deps.runtime?.sourceReferences)
			void this.readAhead({module_id: moduleId}, campaign).catch(() => undefined);
		this.wakes.set(JSON.stringify([campaign, moduleId]), reason);
		return this.pump(moduleId, campaign);
	}

	/** `options.providerBudget` is the stage lease the whole preparation pays from (contract §20 addendum 2). */
	/**
	 * §177.2: a book the table is preparing gets its cast in the background, whichever road prepared it -- a PDF's ingest, or
	 * character creation choosing a book already read, which onboarding prepares directly -- so the cast can land before the
	 * opening. The kernel answers no job for an authored module or a book that has its cast.
	 */
	async prepare(params: Row, signal?: AbortSignal, options: ReadingOptions = {}): Promise<Row> {
		const result = await this.prepareBook(params, signal, options);
		const mid = typeof result?.module_id === 'string' ? result.module_id : typeof params.module_id === 'string' ? params.module_id : undefined;
		// Binding returns before any read (the guidance or opening preparation that follows asks); the cast is queued after
		// this call has returned, never inside it.
		if (mid && params.purpose !== 'bind') setImmediate(() => { if (!this.stopped) void this.cast(mid, params).catch(() => undefined); });
		return result;
	}
	private async prepareBook(params: Row, signal?: AbortSignal, options: ReadingOptions = {}): Promise<Row> {
		const campaign = this.campaign(params);
		let mid = params.module_id;
		if (params.pdf) {
			const model = this.deps.model();
			if (!model.vision) throw error("vision_required", "the configured reader cannot receive images", "select a reader model with image input");
			const path = resolve(this.deps.home, params.pdf);
			this.deps.progress({ stage: "source" });
			let bound: Row;
			try {
				const runtime = (() => { try { return this.runtime(); } catch (failure) { throw new SourceUnreadable(failure); } })();
				bound = await registerSourcePdf({ runtime, call: this.deps.call, pdf: path, cache: this.deps.home, signal,
					params: { ...(mid ? { module_id: mid } : {}), ...(campaign !== undefined ? { campaign } : {}), title: basename(path, ".pdf") } });
			} catch (failure) {
				if (!(failure instanceof SourceUnreadable)) throw failure;
				if (isKernelError(failure.failure)) throw failure.failure;
				throw error("bad_pdf", `the original PDF could not be opened: ${failure.message}`, "choose an accessible, readable original PDF");
			}
			mid = bound.module_id;
			// §14.16.3: the book is a built-in starter's source; its authored graph is already playable.
			if (Array.isArray(bound.starters)) return { ok: true, module_id: mid, opening_ready: true, starters: bound.starters };
        }
		if (!mid) throw error("needs_source", "choose a PDF or an existing module", "pass pdf or module_id");
		if (params.purpose === "bind") return {ok:true,module_id:mid,source_bound:true};
		if (params.purpose === "guidance") {
			try{const reference=await this.referenceGuidance(mid,params,signal,options);if(reference)return {...reference,module_id:mid};}
			catch(failure){if(signal?.aborted||isKernelError(failure)&&failure.code==='needs_choice')throw failure;this.deps.record({lane:'source-reference',event:'guidance_fallback',module_id:mid,detail:String(failure)});}
			const result = await this.ensure(mid, {...params,public_progress:true, campaign:null, focus: params.start_scene || "", foreground:true}, signal, options);
			return {...result, module_id:mid};
		}
		if (params.start_scene && params.targeted === true) {
			if(this.deps.runtime?.sourceReferences){const reference=await this.call('module.reference.status',{module_id:mid,focus:params.start_scene},campaign);
				if(reference.ready){void this.readAhead({module_id:mid,focus:params.start_scene},campaign).then(()=>{this.wakes.set(JSON.stringify([campaign,mid]),'reference-ready');return this.pump(mid,campaign);}).catch(()=>undefined);
					return {ok:true,module_id:mid,opening_ready:true,readiness:'source-reference',graph_complete:false};}}
			await this.ensure(mid, {purpose:"opening", campaign:campaign ?? null, focus:params.start_scene,
				opening_scope:'first_interaction',foreground:params.background!==true, retry:params.retry===true}, signal, options);
			return {ok:true, module_id:mid, opening_ready:true};
		}
		await this.ensure(mid, { purpose: "skeleton", campaign: null, foreground: true, retry: params.retry === true }, signal, options);
		const status = await this.deps.call("module.status", { module_id: mid });
		if (!params.start_scene && status.opening_candidates?.length > 1) {
			throw new KernelError({ code: "needs_choice", message: "choose the opening for this new campaign",
				fix: "match the player's intent to the candidate summaries, then pass its scene as start_scene in prepare-module",
				details: { field: "start_scene", candidates: status.opening_candidates } });
		}
		await this.ensure(mid, { purpose: "opening", opening_scope:'first_interaction',campaign: null, focus: params.start_scene ?? "", foreground: true, retry: params.retry === true }, signal, options);
		return { ok: true, module_id: mid, opening_ready: true };
	}

	/**
	 * §47. Whether a reading of this material is still in flight *right now*. The map is the whole
	 * answer: `ensure` puts a request in it and the task's `finally` takes it out, so a reading that
	 * has landed, failed or been cancelled since the Keeper's foreground wait expired is already gone
	 * from it. Matched by focus and question rather than by the full `ensure` key, because the wait
	 * the host retained keeps only what the refusal told it (§22's `details.read`), and because a
	 * second reading of the same material under another purpose is still that material being read.
	 * An empty focus matches nothing: it would make every reading answer for every wait.
	 */
	reading(mid: string, params: Row): boolean {
		const focus = String(params.focus ?? ""), question = String(params.question ?? "");
		if (!focus && !question) return false;
		for (const request of this.requests.values()) {
			const of = request.of;
			if (!of || request.cancelled || of.mid !== mid) continue;
			if (of.focus === focus && of.question === question) return true;
		}
		return false;
	}

	/**
	 * §22.4.7 (SL-47): the native text of `pages` of the module's bound document, read with the same extraction the
	 * prescreen uses (`sourceText`, pinned to the document's digest). Read-only; costs no model call.
	 */
	async sourcePages(mid: string, pages: number[], params: Row = {}, signal?: AbortSignal): Promise<SourcePageText[]> {
		const campaign = this.campaign(params);
		const snapshot = await this.call("module.source.snapshot", { module_id: mid }, campaign);
		const bundle = await this.runtime().sourceText({ pdf: snapshot.pdf, pages, expected_file_sha256: snapshot.file_sha256 }, signal);
		return (bundle.snapshots ?? []).map((row: Row) => ({ page: row.page, ...(typeof row.pdf_label === "string" && row.pdf_label ? { pdf_label: row.pdf_label } : {}),
			text: typeof row.text === "string" ? row.text : "" }));
	}

	/**
	 * Contract §177.2: the book's cast -- every person it names, with the pages that name them -- read once per bound file, in
	 * the background, by a reader child over the native text layer. Blood Road's graph at table 23's turn 9 had 54 people, the
	 * ones the reader had reached; a newcomer could take the name of anyone else, and a carried page could hand the Keeper an
	 * untold name nobody renamed. Nothing waits on this: until it lands, every check reads the graph's people as before.
	 * One descriptor-owned run per book across hosts at a time; the kernel answers `job_id: null` once the book has its cast.
	 */
	cast(mid: string, params: Row = {}): Promise<Row> {
		const campaign = this.campaign(params), key = JSON.stringify(['cast', mid]);
		const running = this.casting.get(key);
		if (running) return running;
		// A cast that failed this session is not read again until the next one: every preparation and table open asks, and a
		// reader that cannot do it would otherwise be paid again each time.
		if (this.castFailed.has(key)) return Promise.resolve({ state: 'failed', retry: 'next_session' });
		const run = this.readCast(mid, campaign, key).then(result => { if (result?.state === 'failed') this.castFailed.add(key); return result; })
			.finally(() => { this.casting.delete(key); this.controllers.delete(key); });
		this.casting.set(key, run);
		return run;
	}
	private casting = new Map<string, Promise<Row>>();
	private castFailed = new Set<string>();
	private async readCast(mid: string, bound: string | undefined, key: string): Promise<Row> {
		if (this.stopped) return { state: 'stopped' };
		const controller = new AbortController(), signal = controller.signal, started = Date.now();
		this.controllers.set(key, controller);
		let campaign: string | undefined, job: Row | undefined;
		const record = (row: Row) => this.note({ lane: 'cast', module_id: mid, ...(campaign ? { campaign } : {}), ...(job?.job_id ? { job_id: job.job_id } : {}), ...row });
		try {
			// The library owns the cast; a campaign-only book is the one scoped exception. Different host processes must
			// claim the kernel's descriptor lock before extracting text or starting a paid child (§177.2).
			let waiting = false;
			for (;;) {
				signal.throwIfAborted();
				job = await this.call('cast.job', { module_id: mid, claim: true }, campaign);
				if (job?.reason === 'no_module' && campaign === undefined && bound !== undefined) { campaign = bound; continue; }
				if (job?.state !== 'busy') break;
				if (!waiting) { record({ event: 'waiting', reason: 'reader_owned' }); waiting = true; }
				await delay(1000);
			}
			if (!job?.job_id) return job ?? {};
			if (typeof job.lease !== 'string' || !job.lease) throw new Error('cast.job returned no reader lease');
			const owned = { module_id: mid, job_id: job.job_id, lease: job.lease };
			let ranges: Row[] = Array.isArray(job.ranges) ? job.ranges : [];
			if (job.source !== 'kept') {
				const pages: SourcePageText[] = [];
				for (let first = 1; first <= job.page_count; first += CAST_TEXT_BATCH) {
					const batch = Array.from({ length: Math.min(CAST_TEXT_BATCH, job.page_count - first + 1) }, (_, index) => first + index);
					pages.push(...await this.sourcePages(mid, batch, campaign === undefined ? { campaign: null } : { campaign }, signal));
				}
				signal.throwIfAborted();
				const staged = await this.call('cast.source', { ...owned, pages: pages.map(({ page, text }) => ({ page, text })) }, campaign);
				if (staged.state !== 'ready') { record({ event: 'unavailable', reason: staged.reason, ms: Date.now() - started }); return staged; }
				ranges = Array.isArray(staged.ranges) ? staged.ranges : [];
			}
			const systemPrompt = await readFile(join(this.runtime().contentRoot, 'setup', 'module-cast.md'), 'utf8');
			const model = this.deps.model();
			let result: Row = { state: 'partial' };
			for (const range of ranges.filter(value => value?.done !== true)) {
				signal.throwIfAborted();
				const place = await this.call('cast.range', { ...owned, index: range.index }, campaign);
				let lastError: unknown, submitted: Row | undefined;
				for (let attempt = 1; attempt <= CAST_ATTEMPTS && !submitted; attempt++) {
					if (signal.aborted || this.stopped) return { state: 'stopped' };
					const run = await this.runtime().runTask({ kind: 'reader', request: { cwd: place.cwd, model: model.id, thinking: model.thinking, priority: 'background',
						systemPrompt, tools: 'read,write,edit,bash', timeoutMs: CAST_TIMEOUT_MS, eventLog: join(place.cwd, `cast-${attempt}.jsonl`),
						brief: `${readerInput({ task: { job_id: job.job_id, purpose: 'cast', play_language: job.play_language, range: { first: place.first, last: place.last }, pages_with_text: place.pages_with_text, known_cast: place.known } })} `
							+ `Read task.json, then every page file under pages/ (pages ${place.first}-${place.last}), and write draft.json as your instructions say. `
							+ (attempt > 1 && lastError ? `The previous attempt was refused: ${lastError instanceof Error ? lastError.message : String(lastError)}. ` : '')
							+ 'Run coc-read-check --kind module-cast --draft draft.json before you stop, and repair what it refuses.' } }, signal);
					signal.throwIfAborted();
					try {
						submitted = await this.call('cast.submit', { ...owned, index: range.index }, campaign);
						record({ event: submitted.state === 'complete' ? 'published' : 'range', range: range.index, people: submitted.people, accepted: submitted.accepted,
							refused: Array.isArray(submitted.refused) ? submitted.refused.length : 0, attempt, ok: run.ok, ms: Date.now() - started });
					} catch (error) {
						// Lost ownership is not a draft refusal: paying for the old child again cannot repair it.
						if (isKernelError(error) && error.details?.reason === 'cast_lease_lost') throw error;
						lastError = error;
						record({ event: 'refused', range: range.index, attempt, ok: run.ok, reason: isKernelError(error) ? error.details?.reason ?? error.code : 'error', message: error instanceof Error ? error.message : String(error) });
					}
				}
				if (!submitted) return { state: 'failed', range: range.index };
				result = submitted;
				this.deps.published?.({ ...(campaign ? { campaign } : {}), module_id: mid, people: submitted.people, state: submitted.state });
			}
			return result;
		} catch (error) {
			if (!signal.aborted) record({ event: 'failed', message: error instanceof Error ? error.message : String(error), ms: Date.now() - started });
			return { state: signal.aborted ? 'stopped' : 'failed' };
		} finally {
			if (job?.job_id && job.lease) {
				try { await this.call('cast.release', { module_id: mid, job_id: job.job_id, lease: job.lease }, campaign); }
				catch (error) { record({ event: 'failed', stage: 'release', message: error instanceof Error ? error.message : String(error) }); }
			}
		}
	}

	async ensure(mid: string, params: Row, signal?: AbortSignal, options:ReadingOptions={}): Promise<Row> {
		if (signal?.aborted || this.stopped) throw error("reading_failed", "reading was cancelled", "retry the reading when ready");
		const campaign = this.campaign(params);
		if (params._task_prepare && !options.providerBudget) throw error('source_preparation_budget_missing', 'Owned source preparation requires its original provider budget', 'Retry through the pending operation owner');
		const key = JSON.stringify([campaign, mid, params.purpose, params.opening_scope??'', params.material ?? "", params.focus ?? "", params.question ?? "", params.guidance_key ?? "", canonical(params._task_prepare ?? null)]);
		let request = this.requests.get(key);
		if(request&&request.providerBudget!==options.providerBudget&&(request.providerBudget||options.providerBudget))throw error('reading_failed','This reading already has a different provider budget owner','Wait for its source owner to finish');
		if (!request) {
			const pending: PendingReading = { providerBudget:options.providerBudget,waiters: 0, cancelled: false, foreground: params.foreground === true,
				of: { campaign, mid, focus: String(params.focus ?? ""), question: String(params.question ?? "") } };
			const task = this.fulfil(mid, params, pending, campaign).finally(() => this.requests.delete(key));
			task.catch(() => undefined);
			request = Object.assign(pending, { task });
			this.requests.set(key, request);
		}
		// A later turn that joins this same reading in the foreground puts the wait back (§61); `fulfil`
		// re-asserts it with the kernel on its next poll, the same way a fresh foreground request would.
		if (params.foreground === true) request.foreground = true;
		if (options.blocking === true) request.blocking = true;
		request.waiters++;
		let waiting = true, aborting = false;
		const releaseWaiter = () => {
			if (!waiting) return;
			waiting = false;
			request.waiters--;
			// An abort cancels the reading outright, so it must not also demote it on the way out.
			if (aborting) return;
			// §61. The last waiter is gone and nobody cancelled: the reading goes on, the wait does not.
			// Releasing the foreground lease here rather than on a clock is the whole point -- this fires
			// on the real event (the turn stopped waiting), never on elapsed time.
			if (request.waiters === 0 && !request.cancelled && request.foreground && !request.blocking) {
				request.foreground = false;
				if (request.jobId) this.unwait(mid, request.jobId, campaign);
				else request.demotePending = true;
			}
		};
		let cancelTimer: (() => void) | undefined;
		let onAbort: (() => void) | undefined;
		try {
			const configured = Number(process.env.PI_COC_READ_WAIT_MS);
			// §22.4.3: a consultation's allowance, when the caller gives one, replaces the foreground wait.
			const allowance = options.allowanceMs;
			const wait = allowance !== undefined ? allowance : Number.isFinite(configured) && configured > 0 ? configured : 120_000;
			const interrupted = new Promise<Row>((resolvePending, reject) => {
				cancelTimer = (this.deps.waitTimer ?? realWaitTimer)(() => allowance !== undefined ? resolvePending({ state: "pending", ...(request.jobId ? { job_id: request.jobId } : {}),
					...(request.attached ? { attached: true } : {}), read: { purpose: params.purpose, focus: params.focus ?? "", question: params.question ?? "" },
					index: request.index ?? [], settled: request.task }) : reject(error("reading_timeout", "the source is still being read",
					params.purpose === "opening" ? "return control, then call prepare-module again to rejoin the retained preparation"
						: `use ask to return control; on a later player turn, ${params.purpose === 'answer' ? 'repeat lookup kind=source source_mode=answer' : 'retry the original action or lookup kind=source'} with the exact focus and question in details.read; do not invent another question`,
					// The job handle travels beside `read` for telemetry (#65); the fix names only `read`, so the model does not see it.
					{ read: { purpose: params.purpose, ...(params.material ? { material: params.material } : {}), focus: params.focus ?? "", question: params.question ?? "" },
						...(request.jobId ? { job_id: request.jobId } : {}) })), wait);
				onAbort = () => {
					aborting = true;
					releaseWaiter();
					if (request.waiters === 0) {
						request.cancelled = true;
						if (request.jobId && !request.attached) this.cancelJob(mid, request.jobId, campaign);
					}
					reject(error("reading_failed", "reading was cancelled", "retry explicitly when ready"));
				};
				signal?.addEventListener("abort", onAbort, { once: true });
			});
			return await Promise.race([request.task, interrupted]);
		} finally {
			cancelTimer?.();
			if (onAbort) signal?.removeEventListener("abort", onAbort);
			releaseWaiter();
		}
	}

	/**
	 * §152.4: ask the independent visual reviewer whether each colliding pair is one print. Its Pi child runs through the
	 * job's reviewer owner (`run`); the verdict file lands in `dir`, inside the job's attempt, and its path is what the
	 * kernel takes as `identity_review_path`. Throws `IdentityReviewUnavailable` when the reviewer cannot answer.
	 */
	private async reviewIdentity(job: Row, pairs: Row[], dir: string, context: {campaign?: string; cache: string; signal: AbortSignal; round?: number;
		run(request: ReaderRequest): Promise<ReaderOutcome>}): Promise<string> {
		await mkdir(dir, { recursive: true });
		const instructions = join(dir, "instructions-identity.md");
		await writeFile(instructions, await readFile(join(this.runtime().contentRoot, "setup", "visual-identity.md")));
		return reviewVisualIdentity({ cwd: dir, pairs, instructions, model: this.deps.model(), signal: context.signal,
			source: { pdf: job.source.path, cache: context.cache, file_sha256: job.source.file_sha256 }, run: context.run,
			record: row => this.deps.record({ module_id: job.module_id, job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "", campaign: context.campaign,
				...(context.round !== undefined ? { round: context.round } : {}), ...row }) });
	}

	/**
	 * The read-ahead (§22.4, §182), as every caller in this service asks it. A `window` that differs from the last one this
	 * host saw for the campaign and module is one `read_window` row; a short book's completion in a fork carries the library's
	 * answer, which is its `library_sync` row (§184.1).
	 */
	private async readAhead(params: Row, campaign: string | undefined): Promise<Row | undefined> {
		const result = await this.call("module.read.ahead", params, campaign);
		const window = result?.window;
		if (window && typeof window === "object" && !Array.isArray(window)) {
			const scope = JSON.stringify([campaign, params.module_id]), seen = JSON.stringify(window);
			if (this.windows.get(scope) !== seen) {
				this.windows.set(scope, seen);
				this.note({ lane: "reading", event: "read_window", module_id: params.module_id, campaign, ...window });
				if (campaign !== undefined && typeof params.module_id === "string") this.placeWindow(params.module_id, campaign, window);
			}
		}
		this.recordLibrarySync(result, { module_id: params.module_id, campaign });
		return result;
	}

	/**
	 * §190.1: the window's places, in the background, on each window change of a campaign (its table's open included, through
	 * `prefetch`). Only where source references run (a configured Jev); one pass at a time per campaign and module, the next
	 * window's chained after the last; a failure is one row and nothing else. The table never waits on it.
	 */
	private placeWindow(mid: string, campaign: string, window: Row): void {
		if (this.stopped || !this.deps.runtime?.sourceReferences) return;
		const scope = JSON.stringify([campaign, mid]), signal = this.lanes.signal;
		const run = (this.windowPlaceRuns.get(scope) ?? Promise.resolve()).then(async () => {
			if (signal.aborted) return;
			const runtime = this.runtime();
			await runWindowPlaces({campaign, moduleId: mid, window: {mode: window.mode, first: Number(window.first), last: Number(window.last)},
				budget: this.deps.windowPlacesBudget ?? await windowPlacesBudget(),
				call: (method, params) => this.call(method, params, campaign),
				bookmarks: async pdf => { const info = await runtime.sourceInfo({ pdf, cache: this.deps.home }, signal) as Row;
					return { file_sha256: info.file_sha256, bookmarks: info.bookmarks }; },
				pages: async (pdf, sha, pages) => ((await runtime.sourceText({ pdf, pages, expected_file_sha256: sha }, signal)).snapshots ?? [])
					.map((row: Row) => ({ page: row.page, text: typeof row.text === "string" ? row.text : "" })),
				decision: createDecisionAdapter({ env: this.deps.env ?? process.env, maxConcurrency: 2,
					retryPolicies: { [WINDOW_PLACES_FAMILY]: { maxRetries: 1, backoffInitialMs: 500, backoffMaxMs: 2_000 } } }),
				record: row => { this.note(row); this.recordLibrarySync(row, { module_id: mid, campaign }); },
				extractionVersion: sourceTextVersion, signal });
		}).catch(failure => {
			this.note({ lane: WINDOW_PLACES_FAMILY, event: "failed", module_id: mid, campaign, window: { mode: window.mode ?? null, first: window.first, last: window.last },
				detail: (failure instanceof Error ? failure.message : String(failure)).slice(0, 500) });
		});
		this.windowPlaceRuns.set(scope, run);
	}

	/**
	 * §182.1: a book bound before binding kept its bookmarks gets them when a table opens on it. `module.status` says whether
	 * an outline was ever recorded; the host reads the bound PDF's bookmarks (the kernel never parses it) and hands them to
	 * `module.source.outline`, which writes the library and the campaign's fork. A failure is one row and nothing else.
	 */
	async backfillOutline(mid: string, signal?: AbortSignal): Promise<void> {
		const campaign = this.deps.campaign?.();
		try {
			const status = await this.call("module.status", { module_id: mid }, campaign);
			if (!status || status.outline !== null) return;
			const snapshot = await this.call("module.source.snapshot", { module_id: mid }, campaign);
			const info = await this.runtime().sourceInfo({ pdf: snapshot.pdf, cache: this.deps.home }, signal) as Row;
			if (info.file_sha256 !== snapshot.file_sha256) throw new Error("the bound PDF is not the bytes its module was bound to");
			const written = await this.call("module.source.outline", { module_id: mid, file_sha256: snapshot.file_sha256,
				outline: Array.isArray(info.bookmarks) ? info.bookmarks : [] }, campaign);
			this.note({ lane: "reading", event: "outline_backfill", module_id: mid, campaign, state: "written", entries: written?.entries ?? null,
				library: written?.library ?? null, ...(written?.campaign ? { fork: written.campaign } : {}) });
		} catch (failure) {
			this.note({ lane: "reading", event: "outline_backfill", module_id: mid, campaign, state: "failed",
				detail: (failure instanceof Error ? failure.message : String(failure)).slice(0, 500) });
		}
	}

	/**
	 * Contract §184.1: one `library_sync` row per campaign publication, with the library's answer to it as the kernel gave
	 * it (`state`, and `reason`, `library_generation` or `detail`). A library-scoped publication carries none and writes none.
	 */
	private recordLibrarySync(published: Row | undefined, fields: Row): void {
		const sync = published?.library_sync;
		if (!sync || typeof sync !== "object" || Array.isArray(sync)) return;
		this.deps.record({ lane: "reading", event: "library_sync", ...fields, ...sync });
	}

	/**
	 * How a stopped attempt is published. A job this host aborted because it went quiet is `failed`
	 * with the silence named, not `cancelled`: `cancelled` reads as "somebody asked for this to stop"
	 * and leaves no reason on disk, and only `failed` offers the retry the Keeper and the operator need.
	 */
	private jobOutcome(key: string, aborted: boolean, detail: string): Row {
		const idle = this.stalled.get(key);
		if (idle === undefined) return { outcome: aborted ? "cancelled" : "failed", detail };
		return { outcome: "failed", detail: `the reader reported nothing for ${Math.round(idle / 1000)}s and was stopped` };
	}

	private cancelJob(mid: string, jobId: string, campaign: string | undefined) {
		const key = JSON.stringify([campaign, mid, jobId]);
		this.cancelledJobs.add(key);
		this.controllers.get(key)?.abort();
		void this.pump(mid, campaign);
	}

	/**
	 * §61. The last turn waiting on this reading has stopped waiting. The reading is *not* cancelled --
	 * its material still lands and §47's notice still answers for it -- but it gives up the single
	 * foreground lease, so the next read the table is actually blocked on can claim at once. The pump
	 * is woken in the same breath: a freed lease nobody claims is the defect this repairs.
	 */
	private unwait(mid: string, jobId: string, campaign: string | undefined) {
		const key = JSON.stringify([campaign, mid, jobId]);
		const running = this.jobs.get(key);
		if (running) running.foreground = false;
		void this.call("module.read.unwait", { module_id: mid, job_id: jobId }, campaign)
			.then(() => {
				// Written by the host about the job, so it is not the job's heartbeat (see `note`).
				this.note({ lane: "reading", event: "unwaited", module_id: mid, campaign, job_id: jobId });
				wakeReaderSlots();
				return this.pump(mid, campaign);
			})
			// A lease the kernel would not give back is exactly the state this section exists to make
			// visible, so the failure is recorded rather than swallowed. It fails no turn: nobody is
			// waiting on this reading any more, which is why it was being released.
			.catch(failure => this.note({ lane: "reading", event: "unwait_failed", module_id: mid, campaign, job_id: jobId,
				detail: failure instanceof Error ? failure.message : String(failure) }));
	}

	/**
	 * §22.4.6. The job a request of this host is blocked on (a turn waits on it now) when that job is not running here yet:
	 * the pump may then claim past its own capacity, to place it or to learn which background read yields.
	 */
	private blockingWaiting(mid: string, campaign: string | undefined): string | undefined {
		for (const request of this.requests.values()) {
			const of = request.of;
			if (!of || of.mid !== mid || of.campaign !== campaign || request.cancelled || !request.foreground || !request.jobId) continue;
			if (!this.jobs.has(JSON.stringify([campaign, mid, request.jobId]))) return request.jobId;
		}
		return undefined;
	}

	/**
	 * §22.4.6. Stop a background reading this pump runs so a blocking read takes its slot, and wait until the slot is
	 * back (its attempt returned with `module.read.yield`). Never a blocking reading, never one this pump does not run.
	 */
	private async displace(mid: string, campaign: string | undefined, jobId: string, running: Map<string, Promise<void>>): Promise<boolean> {
		const key = JSON.stringify([campaign, mid, jobId]), job = this.jobs.get(key), tracked = running.get(key);
		if (!job || !tracked || job.foreground === true || this.displaced.has(key)) return false;
		this.displaced.set(key, { at: Date.now(), forJob: this.blockingWaiting(mid, campaign) });
		this.controllers.get(key)?.abort();
		await tracked;
		return true;
	}

	/**
	 * §22.4.6. Return a displaced reading's attempt to the queue. A yield the kernel refuses would leave the slot held for
	 * the life of the kernel, so the attempt is then finished `cancelled` (its evidence kept, `retry: true` re-reads it).
	 */
	private async yieldSlot(job: Row, campaign: string | undefined, key: string): Promise<void> {
		const displaced = this.displaced.get(key), started = this.startedAt.get(key);
		const row = { lane: "reading", module_id: job.module_id, campaign, job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "",
			...(displaced?.forJob ? { for_job: displaced.forJob } : {}), ...(started !== undefined ? { ran_ms: Date.now() - started } : {}) };
		try {
			const result = await this.call("module.read.yield", { module_id: job.module_id, job_id: job.job_id, lease: job.lease }, campaign);
			this.note({ ...row, event: "displaced", displaced: result?.displaced });
		} catch (failure) {
			this.note({ ...row, event: "yield_failed", detail: failure instanceof Error ? failure.message : String(failure) });
			await this.call("module.read.finish", { module_id: job.module_id, job_id: job.job_id, lease: job.lease, outcome: "cancelled",
				detail: "displaced by a blocking reading; the slot could not be returned" }, campaign).catch(() => undefined);
		}
	}

	private async fulfil(mid: string, params: Row, request: PendingReading, campaign: string | undefined): Promise<Row> {
		let retry = params.retry === true;
		let answerGeneration: number | undefined;
		while (!this.stopped && !request.cancelled) {
			// `request.foreground`, never `params.foreground`: this loop polls every 300 ms, and the
			// original params would re-promote a job the last waiter has already let go (§61).
			const response = await this.bindBeforeClaim(mid, campaign, async () => {
				const response = await this.call("module.read.request", { ...params, foreground: request.foreground, module_id: mid, retry,
					...(params.purpose === 'answer' && answerGeneration !== undefined ? {context_generation: answerGeneration} : {}) }, campaign);
				if(request.providerBudget&&response.job_id&&['queued','reading'].includes(response.state)) {
					const jobKey=JSON.stringify([campaign,mid,response.job_id]),previous=this.jobBudgets.get(jobKey);
					if((previous||this.jobs.has(jobKey)||response.state==='reading')&&previous!==request.providerBudget)
						throw error('source_preparation_foreign_job','The claimed source job has another provider budget owner','Wait for the existing source owner');
					this.jobBudgets.set(jobKey,request.providerBudget);
				}
				return response;
			});
			if (params.purpose === 'answer' && answerGeneration === undefined) {
				if (!Number.isSafeInteger(response.generation) || response.generation < 0) throw error('reading_failed', 'the source consultation returned no context generation', 'retry the same source consultation explicitly');
				answerGeneration = response.generation;
			}
			if (request.foreground && response.job_id) {
				const running = this.jobs.get(JSON.stringify([campaign, mid,response.job_id]));
				if (running) { running.foreground = true; wakeReaderSlots(); }
			}
			request.jobId = response.job_id;
			request.attached = response.attached === true;
			if (Array.isArray(response.index)) request.index = response.index;
			if (request.demotePending && response.job_id) {
				request.demotePending = false;
				this.unwait(mid, response.job_id, campaign);
			}
			if (request.cancelled) {
				if (request.jobId && !request.attached) this.cancelJob(mid, request.jobId, campaign);
				break;
			}
			retry = false;
			if (response.state === "ready") return response;
			// §22.3.3 (SL-57): a focus settled unusable is answered, not read again; the waiter takes the settlement.
			if (response.state === "unusable") return response;
			if (response.state === "blocked") {
				const choice = response.opening?.choice;
				if (choice) throw new KernelError({ code: "needs_choice", message: "the book offers more than one opening",
					fix: "choose one candidate using start_scene in prepare-module", details: choice });
				if (response.refusal?.message) throw refusedReading(params, response.refusal, response.fix ?? "retry explicitly");
				throw error("reading_failed", (response.missing ?? []).join("; ") || "the reading could not prepare this material", response.fix ?? "retry explicitly");
			}
			await Promise.race([this.pump(mid, campaign), delay(150)]);
			await delay(150);
		}
		throw error("reading_failed", request.cancelled ? "reading was cancelled" : "the reader host shut down",
			request.cancelled ? "retry explicitly when ready" : "resume in a new session");
	}

	private pump(mid: string, campaign: string | undefined): Promise<void> {
		const scope = JSON.stringify([campaign, mid]);
		const running = this.pumps.get(scope);
		if (running) { this.pumpWakes.get(scope)?.(); return running; }
		const active = new Set<Promise<void>>();
		// §22.4.6: this pump's running jobs by key, so a displaced one can be awaited until its slot is back.
		const runningJobs = new Map<string, Promise<void>>();
		let wakeRequested = false;
		const task = (async () => {
			let capacity = 1;
			try {
				while (!this.stopped) {
					wakeRequested = false;
					const wake = new Promise<void>(resolve => this.pumpWakes.set(scope, () => {wakeRequested = true; resolve();}));
					// §22.4.6: past its own capacity the pump claims only to place a blocking read one of its requests waits on.
					while ((active.size < capacity || this.blockingWaiting(mid, campaign) !== undefined) && !this.stopped) {
						const job = await this.bindBeforeClaim(mid, campaign, () => this.call("module.read.claim", { module_id: mid, owner: `host-${process.pid}` }, campaign));
						// A wake does not choose a job; the claim does. The row that names the job names the wake it answered,
						// and a wake that found nothing queued says so instead of leaving no trace (#65).
						const wake = this.wakes.get(scope);
						this.wakes.delete(scope);
						if (!job.job_id) {
							if (wake !== undefined) this.deps.record({ lane: "reading", event: "claim_empty", module_id: mid, campaign, wake });
							// §22.4.6: every slot is held and a blocking read waits; the claim names the background read that yields.
							if (typeof job.displace === "string" && await this.displace(mid, campaign, job.displace, runningJobs)) continue;
							break;
						}
						capacity = Math.max(1, Number(job.concurrency) || 1);
						const key = JSON.stringify([campaign, mid, job.job_id]);
						const controller = new AbortController();
						this.controllers.set(key, controller);
						this.jobs.set(key,job);
						this.startedAt.set(key, Date.now());
						this.heartbeats.set(key, Date.now());
						this.startSweep();
						if (this.stopped || this.cancelledJobs.has(key)) controller.abort();
						const work = (async () => {
							try {
								if (controller.signal.aborted) throw new Error("reading was cancelled");
								await this.runJob(job, controller.signal, campaign,this.jobBudgets.get(key));
							}
							catch (failure) {
								if (this.displaced.has(key)) await this.yieldSlot(job, campaign, key);
								else if (!this.handedOff.has(key)) try {
									await this.call("module.read.finish", { module_id: mid, job_id: job.job_id, lease: job.lease,
										...this.jobOutcome(key, controller.signal.aborted, String(failure)) }, campaign);
								} catch { /* a closed kernel releases its leases; retained attempts remain reclaimable */ }
							}
							finally { this.controllers.delete(key); this.jobs.delete(key); this.jobBudgets.delete(key); this.cancelledJobs.delete(key); this.heartbeats.delete(key); this.stalled.delete(key); this.handedOff.delete(key); this.displaced.delete(key); this.startedAt.delete(key); }
						})();
						const tracked = work.finally(() => { active.delete(tracked); runningJobs.delete(key); });
						active.add(tracked);
						runningJobs.set(key, tracked);
						// §22.4.6: the row names the job's class and how long it waited as that class (`class_at`, kept by the kernel).
						const since = (value: unknown) => Number.isFinite(Date.parse(String(value))) ? Math.max(0, Date.now() - Date.parse(String(value))) : undefined;
						this.deps.record({lane: "reading", event: "concurrency", module_id: mid, campaign, job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "", ...(wake !== undefined ? { wake } : {}),
							active: active.size, capacity, foreground:job.foreground === true, class: job.foreground === true ? "blocking" : "background",
							slot_wait_ms: since(job.class_at ?? job.at), queue_wait_ms: since(job.at),
							// §22.4.6.1 (SL-54): a job claimed under a generation other than its last attempt's says so.
							...(job.resumed ? { resumed: job.resumed } : {})});
						// §22.4.6.1 addendum (SL-60): the `concurrency` row above buries `resumed` in a field a triage has to know to
						// look for -- on the b8 table the state-level resume (queued, then completed) left no telemetry naming it, and
						// the triage had to infer it from the queue file. A dedicated row, one per resuming claim, is the one the
						// `requeued` row already gets on the finish side (§22.4.6.1 addendum, SL-55).
						if (job.resumed) this.note({lane: "reading", event: "resumed", module_id: mid, campaign, job_id: job.job_id,
							purpose: job.purpose, focus: job.focus ?? "", ...job.resumed});
					}
					if (!active.size) { if (wakeRequested) continue; return; }
					await Promise.race([...active, wake]);
				}
			} finally { await Promise.allSettled([...active]); }
		})().finally(() => { this.pumps.delete(scope); this.pumpWakes.delete(scope); if(wakeRequested&&!this.stopped)void this.pump(mid, campaign).catch(()=>undefined); });
		task.catch(() => undefined);
		this.pumps.set(scope, task);
		return task;
	}

	private async runJob(job: Row, signal: AbortSignal, campaign?: string, providerBudget?: import("../../runtime/jev/provider-budget.ts").TaskProviderBudget) {
		const model = this.deps.model();
		const cwd = job.work_dir;
		const key = JSON.stringify([campaign, job.module_id, job.job_id]);
		// This job's one owner of independent reviewer children (inventory SL-00, `ReadingService.runJob.run`): the source
		// review's units and the §152.4 identity reviewer both run through it, on the job's provider owner and priority.
		let reviewLease: StageBudget | undefined;
		const reviewers = { run: (request: ReaderRequest, prompt?: ReaderRequest["prompt"]) => this.runtime().runTask({ kind: "reader", request: { ...request, providerBudget,
			beforeProviderRequest: (signal: AbortSignal) => this.waitForPriority(job, key, signal, campaign),
			...(reviewLease ? { readingLease: reviewLease } : {}),
			priority: () => job.foreground === false ? "background" : "foreground",
			...(prompt ? { prompt } : {}) } }, request.signal) };
		const publicProgress=(state:'searching'|'found'|'checking'|'confirmed',fields?:Row)=>{
			if(job.purpose!=='guidance'||typeof job.guidance_key!=='string')return;
			this.deps.progress({stage:'guidance',purpose:job.purpose,module_id:job.module_id,public_preparation:{source_sha256:job.source.file_sha256,
				module_id:job.module_id,job_id:job.job_id,attempt:basename(cwd),guidance_key:job.guidance_key,opening:job.focus??'',
				fields:Object.fromEntries(PUBLIC_GUIDANCE_FIELDS.map(field=>[field,state==='confirmed'&&fields
					?{state:fields[field].status==='value'?'confirmed':fields[field].status,...(fields[field].status==='value'?{value:fields[field].text}:{})}
					:{state}]))}});
		};
		// The page cache belongs to the workspace that owns this PDF, which is the shared library
		// for a library read and the campaign's private module for a campaign-scoped one. Deriving
		// it from the bound source keeps host and reader confinement in agreement by construction.
		const cache = join(dirname(job.source.path), "cache", "pages");
		await mkdir(cache, { recursive: true });
		// §152.4: an identity job over published pairs has no author. Its reviewer answers each pair of its page and the
		// kernel keeps the verdicts; a reviewer that cannot answer fails the job, and a later read-ahead asks again.
		if (job.visual_identity) {
			await writeFile(join(cwd, "observations.json"), JSON.stringify({ file_sha256: job.source.file_sha256, read_pages: [], full_pages: [], review_pages: [] }) + "\n");
			const pairs: Row[] = Array.isArray(job.visual_identity.pairs) ? job.visual_identity.pairs : [];
			const path = pairs.length ? await this.reviewIdentity(job, pairs, join(cwd, "identity"), { campaign, cache, signal, run: reviewers.run }) : undefined;
			const published = await this.call("module.read.finish", { module_id: job.module_id, job_id: job.job_id, lease: job.lease, outcome: "completed",
				...(path ? { identity_review_path: path } : {}) }, campaign);
			this.deps.record({ lane: "reading", event: "visual_identity_published", module_id: job.module_id, job_id: job.job_id, campaign, ...(published?.visual_identity ?? {}) });
			this.recordLibrarySync(published, { module_id: job.module_id, campaign, job_id: job.job_id });
			// The next page's pairs are queued by the read-ahead, one identity job at a time.
			await this.readAhead({ module_id: job.module_id }, campaign).catch(() => undefined);
			return;
		}
		const commands = { page: `coc-source --pdf ${quote(job.source.path)} --cache ${quote(cache)} page`,
			check: `coc-read-check --packet ${quote(join(cwd, "task.json"))} --draft ${quote(join(cwd, "draft.json"))}` };
		const task: Row = { purpose: job.purpose,
            ...Object.fromEntries(['review_policy','source_unit','visual_scan','visual_asset','map_scope','visual_hints','review_scope_pages','source_need','carried_needs','cast_names'].filter(field=>job[field]!==undefined).map(field=>[field,job[field]])), ...(job.material ? { material: job.material } : {}), ...(job.purpose === "opening" ? {opening_batch:true,...(job.opening_scope?{opening_scope:job.opening_scope}:{})} : {}), module_id: job.module_id, focus: job.focus, question: job.question, pages: job.pages,
			...(job.purpose === "guidance" ? {guidance_key:job.guidance_key,public_progress_required:job.public_progress===true,
				play_language:job.play_language, occupations:job.occupations.map((row:Row)=>({name:row.name}))} : {}),
			source: { page_count: job.source.page_count }, index: job.index, known_nodes: job.known_nodes,
			known_claims: (job.known_claims ?? []).map((claim: Row) => Object.fromEntries(
				["subject_id", "predicate", "object", "truth_status", "visibility", "reason", "known_by_ids", "asserted_by_ids", "validity"]
					.filter(key => key in claim).map(key => [key, claim[key]]))),
			vocabulary: job.vocabulary, coverage_domains: job.coverage_domains, commands,
			// §22.3.3 (SL-57): an earlier reading of this focus was refused at review; these are the refused fields and the reasons.
			...(job.review_retry ? { review_retry: { refused: job.review_retry.refused ?? [], message: job.review_retry.message ?? "" } } : {}) };
		if (job.purpose === "index") { delete task.index; delete task.known_nodes; delete task.known_claims; delete task.vocabulary; delete task.coverage_domains; delete task.commands.check; }
		const freshSkeleton = !campaign && job.purpose === 'skeleton' && Array.isArray(job.known_nodes)
			&& job.known_nodes.length === 1 && job.known_nodes[0].node_kind === 'module' && job.known_nodes[0].ready === false;
		if (freshSkeleton && this.deps.navigateFresh) {
			try {
				const navigation = await this.deps.navigateFresh({moduleId: job.module_id, jobId: job.job_id,
					source: job.source}, signal, row => this.deps.record(row));
				if (navigation) task.navigation_hints = {version: navigation.version, navigation_only: true,
					hints: navigation.hints, coverage: navigation.coverage};
			} catch {
				this.deps.record({lane: 'reading', event: 'typed_navigation', module_id: job.module_id, job_id: job.job_id, status: 'unavailable'});
			}
		}
		const guidanceProjection=job.purpose==='guidance'
			?selectedGuidanceProjection(job.known_nodes,job.focus??'',job.source.page_count):null;
		if(guidanceProjection)task.guidance_projection={scene:guidanceProjection.draft.nodes[0].name,
			source_pages:guidanceProjection.sourcePages};
		if (job.purpose === "guidance" && !guidanceProjection) {
			const { labels, bookmarks } = await this.runtime().sourceInfo({ pdf: job.source.path, cache }, signal);
			task.source = { ...task.source, labels, bookmarks };
		}
		await writeFile(join(cwd, "task.json"), JSON.stringify(task, null, 2) + "\n");
		const observations: Row = { file_sha256: job.source.file_sha256, read_pages: [], full_pages: [], review_pages: [] };
		// §151.2.4: what this run spends, written once as the job's `job_accounting` row.
		const accounting = readingAccounting();
		// §187.5.3: what the author is handed -- the task's bytes, whether it is inlined, and its instructions' bytes.
		accounting.packet_bytes = Buffer.byteLength(JSON.stringify(task));
		accounting.inlined = readerInputInlines({ task });
		accounting.known_nodes = Array.isArray(task.known_nodes) ? task.known_nodes.length : 0;
		accounting.known_claims = Array.isArray(task.known_claims) ? task.known_claims.length : 0;
		try {
			accounting.instruction_bytes = Buffer.byteLength(await readerInstructionText(this.runtime().contentRoot, { phase: job.purpose === "index" ? "index" : "read",
				purpose: job.purpose, visual: job.visual_scan ? 'scan' : job.visual_asset ? 'asset' : job.map_scope ? 'scope' : undefined,
				guidance: job.purpose === "guidance", answer: job.purpose === "answer" }));
		} catch { /* accounting never fails a reading; the child's own launch reports a missing instruction file */ }
		// §186.1: the image budget of this reading's authors and reviewers is data, chosen by RC-01's replay.
		const readingImages = ["guidance", "opening", "detail", "answer"].includes(job.purpose)
			? (await readingImageBudget(this.runtime().contentRoot)).count : undefined;
		let readComplete = false;
		if (job.resume_from) {
			try {
				const previous = JSON.parse(await readFile(join(job.resume_from, "packet.json"), "utf8"));
				if (previous.key === job.key && previous.source.file_sha256 === job.source.file_sha256) {
					await copyFile(join(job.resume_from, "draft.json"), join(cwd, "draft.json"));
					await copyFile(join(job.resume_from,'pending-source-needs.json'),join(cwd,'pending-source-needs.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});
					if (job.purpose === "guidance") await copyFile(join(job.resume_from, "guidance.json"), join(cwd, "guidance.json"));
					if (job.purpose === 'guidance') await copyFile(join(job.resume_from,'public-fields.json'),join(cwd,'public-fields.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});
					await copyFile(join(job.resume_from, "findings.json"), join(cwd, "findings.json")).catch(() => undefined);
					let checkpoint: Row | undefined;
					try { checkpoint = JSON.parse(await readFile(join(job.resume_from, "read-complete.json"), "utf8")); }
					catch (failure) { if ((failure as NodeJS.ErrnoException).code !== "ENOENT") throw failure; }
					// §151.2.3: an interrupted author left a draft but no checkpoint; salvage it before paying for the author again.
					if (!checkpoint && !job.visual_scan) {
						const bytes = await readFile(join(cwd, "draft.json"));
						let draft: unknown;
						try { draft = JSON.parse(bytes.toString()); } catch { draft = undefined; }
						const salvage = await salvageInterruptedRead({ attempt: job.resume_from, packet: previous, job, draft,
							source: { file_sha256: job.source.file_sha256, cache },
							check: () => this.runtime().check({ kind: "source-draft", packet: join(cwd, "task.json"), draft: join(cwd, "draft.json") }, signal) });
						if (salvage.eligible) {
							const { eligible: _eligible, ...evidence } = salvage;
							this.deps.record({ lane: "reading", event: salvage.salvaged ? "salvaged" : "salvage_refused", module_id: job.module_id, campaign, job_id: job.job_id,
								purpose: job.purpose, focus: job.focus ?? "", source_attempt: job.resume_from, ...evidence });
						}
						if (salvage.eligible && salvage.salvaged) {
							observations.read_pages = salvage.pages;
							await writeFile(join(cwd, "read-complete.json"), JSON.stringify({ job_id: job.job_id, draft_sha256: sha(bytes), observations,
								salvaged: true, salvage: { source_attempt: job.resume_from, required_view_pages: salvage.required } }) + "\n");
							readComplete = true;
							accounting.salvaged = true;
						}
					}
					else if (checkpoint && validCheckpoint(checkpoint, await readFile(join(cwd, "draft.json")), job)) {
						if (job.purpose === "guidance" && checkpoint.guidance_sha256 !== sha(await readFile(join(cwd,"guidance.json")))) throw new Error("guidance checkpoint mismatch");
						if (job.public_progress===true&&checkpoint.public_fields_sha256!==sha(await readFile(join(cwd,'public-fields.json'))))throw new Error('public setup checkpoint mismatch');
						Object.assign(observations, checkpoint.observations, { review_pages: [] });
						await writeFile(join(cwd, "read-complete.json"), JSON.stringify(checkpoint) + "\n");
						// Only this job's own interrupted attempt may skip reading. A retry that inherits a
						// failed job's draft owes the source-based repair round (§22): re-verifying identical
						// bytes under identical instructions cannot re-scope them, so it can only fail again.
						// §22.4.6.1 (SL-54): nor may a job resumed after its focus's material was published meanwhile;
						// it reads again from the retained draft.
						readComplete = !checkpoint.requires_repair && checkpoint.job_id === job.job_id && job.resumed?.reread !== true;
						if(!readComplete&&checkpoint.requires_repair&&job.resumed?.reread!==true&&job.purpose!=='index'){
							const checked=await this.runtime().check({kind:'source-draft',packet:join(cwd,'task.json'),draft:join(cwd,'draft.json')},signal);
							const review=JSON.parse(await readFile(join(job.resume_from,'review.json'),'utf8'));
							if(checked.ok&&omittedReviewOnly(checked.required_review,review,job.purpose==='guidance')){
								readComplete=true;
								this.deps.record({lane:'reading',event:'review_only_resume',module_id:job.module_id,job_id:job.job_id,campaign,
									source_job:checkpoint.job_id,draft_sha256:checkpoint.draft_sha256});
							}
						}
					}
				}
				else if (job.repair && previous.purpose === job.purpose && previous.source.file_sha256 === job.source.file_sha256) {
					// A repair extends the completed reading it repairs (§90.5): that draft is the starting point,
					// and the whole read runs again on top of it, so nothing here marks the read complete.
					await copyFile(join(job.resume_from, "draft.json"), join(cwd, "draft.json"));
				}
			} catch { /* a partial draft remains useful input, but only a host checkpoint skips reading */ }
		}
		if(guidanceProjection&&!readComplete)await writeFile(join(cwd,'draft.json'),JSON.stringify(guidanceProjection.draft)+'\n');
		let requiredMapCandidates: Row[] = [];
		if (job.purpose === "index") {
			try {
				const retained = JSON.parse(await readFile(join(cwd, "draft.json"), "utf8"));
				requiredMapCandidates = Array.isArray(retained.map_candidates) ? retained.map_candidates : [];
			} catch { /* a fresh index has no retained candidates */ }
		}
		await writeFile(join(cwd, "observations.json"), JSON.stringify(observations) + "\n");
		// §20 addendum 3 (SL-41) and 5 (SL-53): a read raised during play, the background index and a skeleton outside a stage
		// have no stage lease; each is sized from the book like the import's stages, once per job, and every reader child of
		// the job opens a lease of that size (runtime/tasks.ts). §20 addendum 6 (SL-65): the size also carries this reader's
		// own context window, so the floor holds its "eight whole-context reservations" against the reader actually reading
		// this book, not a fixed assumption -- a campaign's private fork reads under the exact same rule as the library.
		// §140.2 (SL-99b): an opening or guidance read outside a stage (the table's setup, `/coc ingest`) is sized too.
		const stage = providerBudget ? undefined : readingJobStage(job);
		const readingLease: StageBudget | undefined = reviewLease = stage ? readingStageBudget(stage, { pageCount: Number(job.source?.page_count) || 0,
			perPage: await measuredPageCost(resolve(cwd, "..", "..", "..")), contextWindow: model.contextWindow }) ?? undefined : undefined;
		if (readingLease) this.deps.record({ lane: "reading", event: "stage_budget", module_id: job.module_id, campaign, job_id: job.job_id, purpose: job.purpose, ...readingLease });
		// §20 addendum 3: a call a stage lease refused on an overrun it could pay; the round went on.
		const overrunRows = (run: ReaderOutcome, phase: string, round: number, extra: Row = {}) => {
			for (const overrun of run.overruns ?? []) this.deps.record({ lane: "reading", event: "provider_overrun", module_id: job.module_id, campaign,
				job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "", phase, round, ...extra, ...overrun });
			return run;
		};
		let detail = "the reader did not produce a valid draft";
		// §22.3.1: the refused field and the gate's reason, as findings.json records them, travel with the failure.
		let refusal: Row | undefined;
		// §152.4: the identity reviewer could not answer for this attempt's draft; the job is held, not failed or published.
		let identityHeld: string | undefined;
		try {
			if (!model.vision) throw error("vision_required", "the reader has no image input", "select a model that supports images");
			// Reader/check/review failures keep the existing two rounds. One opening semantic rejection
			// from publication can add only its own source-grounded repair round.
			let lastRound = 2, finishRepairUsed = false;
			for (let round = 1; round <= lastRound && !signal.aborted; round++) {
				let phaseCompleted = false;
				let publishing = false;
				// §151.2.1: the plan of the review this round's read repairs, so the re-review keeps its surviving units.
				let previousPlan: ReviewPlan | undefined;
				// §151.2.2: a targeted repair the host refused this round; the round's read runs again as today's full repair.
				let targetedRefused = false;
				// §186.4: the repaired review, offered to this round's verify only once `checkTargetedRepair` accepted the repair.
				let coverageCarry: CoverageCarrySource | undefined;
				// §187.6.1: an append repair the host refused this round (the round's read runs again in full), and the bound
				// review of the candidate an accepted append extended, whose fact units carry to this round's verify.
				let appendRefused = false;
				let appendSource: { plan: ReviewPlan; plan_sha256: string; review: Row } | undefined;
				try {
					const phases: Array<"index" | "index-audit" | "read" | "verify"> = job.purpose === "index" ? (readComplete ? [] : ["index", "index-audit"]) : (readComplete ? ["verify"] : ["read", "verify"]);
					// An index loop: a refused targeted repair inserts the round's full read right after itself.
					for (let at = 0; at < phases.length; at++) {
						const phase = phases[at];
						phaseCompleted = false;
						let previousDraft: Row | undefined, previousPages: number[] = [], candidateBytes: Buffer | undefined;
						let targeted: Extract<RepairDecision, {kind: "targeted"}> | undefined, pendingNeeds: Buffer | null = null;
						let appended: Extract<RepairDecision, {kind: "append"}> | undefined;
						let repairedReview: CoverageCarrySource | undefined;
						if (phase === "read") {
							try {
								const bytes = await readFile(join(cwd, "draft.json"));
								const checkpoint = JSON.parse(await readFile(join(cwd, "read-complete.json"), "utf8"));
								if (validCheckpoint(checkpoint, bytes, job)) { previousDraft = JSON.parse(bytes.toString()); previousPages = checkpoint.observations.read_pages; candidateBytes = bytes; }
							} catch { /* no completed source reading to carry */ }
							await writeFile(join(cwd, "baseline.json"), JSON.stringify(previousDraft ?? {}) + "\n");
							if(job.visual_asset&&previousDraft){
								task.visual_previews=await mapReviewPreviews({draft:previousDraft,paths:['/coverage'],cwd,source:{pdf:job.source.path,cache}});
								await writeFile(join(cwd,'task.json'),JSON.stringify(task)+'\n');
							}
							try {
								const retained = JSON.parse(await readFile(join(cwd, "draft.json"), "utf8"));
								task.must_view_pages = previousDraft ? [] : draftPages(retained);
								if(!guidanceProjection)task.repair = { draft: "draft.json", baseline: "baseline.json", findings: JSON.parse(await readFile(join(cwd, "findings.json"), "utf8").catch(() => "{}")) };
								await writeFile(join(cwd, "task.json"), JSON.stringify(task, null, 2) + "\n");
							} catch { /* the first draft has not been written */ }
							// §151.2.2: this read repairs a reviewed candidate. A review of exactly this candidate that refused specific
							// records and missed nothing makes it a targeted repair of those records; anything else is today's full round.
							if (previousDraft && !guidanceProjection && ["opening", "detail"].includes(job.purpose)) {
								const reviewed = await reviewOfCandidate([cwd, ...(job.resume_from ? [job.resume_from] : [])], previousDraft);
								previousPlan = reviewed?.plan;
								const decision: RepairDecision = targetedRefused ? { kind: "full", reason: "targeted_refused" }
									: appendRefused ? { kind: "full", reason: "append_refused" }
									: job.resumed?.reread === true || !reviewed ? { kind: "full", reason: "no_review" } : repairDecision(previousDraft, reviewed.review, task);
								if (decision.kind === "targeted") {
									targeted = decision;
									repairedReview = { plan: reviewed!.plan, plan_sha256: reviewed!.plan_sha256, review: reviewed!.review, draft: previousDraft };
									task.repair = { ...task.repair, kind: "targeted", refused: decision.refused, pages: decision.pages };
									await writeFile(join(cwd, "task.json"), JSON.stringify(task, null, 2) + "\n");
									pendingNeeds = await readFile(join(cwd, "pending-source-needs.json")).catch(failure => { if (failure.code === "ENOENT") return null; throw failure; });
								}
								if (decision.kind === "append") {
									appended = decision;
									appendSource = { plan: reviewed!.plan, plan_sha256: reviewed!.plan_sha256, review: reviewed!.review };
									task.repair = { ...task.repair, kind: "append", missing: decision.missing, pages: decision.pages };
									await writeFile(join(cwd, "task.json"), JSON.stringify(task, null, 2) + "\n");
									pendingNeeds = await readFile(join(cwd, "pending-source-needs.json")).catch(failure => { if (failure.code === "ENOENT") return null; throw failure; });
								}
								accounting.repair = decision.kind;
								this.deps.record({ lane: "reading", event: "repair", module_id: job.module_id, campaign, job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "",
									round, repair: decision.kind, ...(decision.kind === "targeted" ? { refused: decision.roots, pages: decision.pages }
										: decision.kind === "append" ? { missing: decision.missing.length, pages: decision.pages } : { reason: decision.reason }) });
							}
						}
						if (phase === "index-audit") {
							const draft = JSON.parse(await readFile(join(cwd, "draft.json"), "utf8"));
							const currentCandidates = Array.isArray(draft.map_candidates) ? draft.map_candidates : [];
							const currentRefs = (Array.isArray(draft.sections) ? draft.sections : []).flatMap((section: Row) =>
								(Array.isArray(section.source_refs) ? section.source_refs : []).map((ref: Row) => ref.page));
							task.required_map_candidates = requiredMapCandidates;
							task.index_audit_pages = [...new Set([
								...integerList(observations.index_candidate_pages),
								...requiredMapCandidates.flatMap(candidate => integerList(candidate.pages)),
								...currentCandidates.flatMap((candidate: Row) => integerList(candidate.pages)),
								...integerList(currentRefs),
							].filter(page => page > 0))].sort((a, b) => a - b);
							await writeFile(join(cwd, "task.json"), JSON.stringify(task, null, 2) + "\n");
						}
						const promptPhase = phase === "index-audit" ? "index" : phase;
						const instructions = join(cwd, `instructions-${promptPhase}.md`);
						this.deps.progress({ module_id: job.module_id, campaign, job_id: job.job_id,purpose:job.purpose, stage: phase === "read" && job.purpose === "skeleton" ? "skeleton" : phase, focus: job.focus, of: job.source.page_count });
						if (phase === "verify") {
							publicProgress('checking');
							try{
								const pending=JSON.parse(await readFile(join(cwd,'pending-source-needs.json'),'utf8'));
								if(pending.version!==1||pending.source_sha256!==job.source.file_sha256)throw new Error('Retained source needs changed source');
								validateSourceNeeds(pending.needs.map(({alias:_alias,...need}:Row)=>need),job.source.page_count);
								task.retained_source_needs=pending.needs;
							}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
							let requiredReview:string[]|undefined;
							if (["guidance", "opening", "detail", "answer"].includes(job.purpose)) {
								try {
									const checked = await this.runtime().check({kind:'source-draft',packet:join(cwd,'task.json'),draft:join(cwd,'draft.json')},signal);
									if (!checked.ok) throw new Error(JSON.stringify(checked.error));
									if(Array.isArray(checked.required_review))requiredReview=checked.required_review;
									if (job.purpose === 'answer' && (!Array.isArray(checked.required_view_pages) || checked.required_view_pages.some((page: number) => !observations.read_pages.includes(page))))
										throw new Error('Source answer requires original-page observations before independent review');
								}
								catch (error) { phaseCompleted = true; throw error; }
							}
							const candidate=JSON.parse(await readFile(join(cwd,"draft.json"),"utf8"));
							const reviewScope=await guidanceReviewPages(cwd,task,job.source.file_sha256,job.source.page_count,
								job.purpose==='guidance'||job.opening_scope==='first_interaction'?draftPages(candidate):observations.read_pages);
                            if(job.source_unit)for(const page of job.pages??[])if(!reviewScope.includes(page))reviewScope.push(page);
							// §151.3: the Jev claim check asks before the vision units run and merges its rows after they finish.
							let claimCheck = undefined as ClaimSupportCheck | undefined;
							const claimSupport = !job.visual_scan && !job.visual_asset && !job.map_scope && this.deps.claimSupport && (async (units: string[][]) => (claimCheck = await this.deps.claimSupport!({ cwd, round,
								module: job.module_id, job: job.job_id, ...(campaign !== undefined ? { campaign } : {}), source: { file_sha256: job.source.file_sha256 },
								task, draft: candidate, units, signal,
								sourceText: pages => this.runtime().sourceText({ pdf: job.source.path, pages, expected_file_sha256: job.source.file_sha256 }, signal),
								record: row => { tallyReadingRow(accounting, row); this.deps.record({ module_id: job.module_id, job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "", ...row, campaign }); } }))?.skip);
							const reviewBegan = Date.now();
							try {
								observations.review_pages = await reviewCandidate({ cwd, ...(claimSupport ? { claimSupport } : {}), task: {...task, review_scope_pages: reviewScope,
									...(requiredReview?{required_review:requiredReview}:{})},
									draft:candidate, instructions, round, previousPlan, coverageCarry, extractionVersion: sourceTextVersion,
									...(appendSource ? { appendCarry: (paths: string[]) => appendUnitCarry(appendSource!, { draft: candidate, task, paths }) } : {}),
									cacheId: readingCacheId(job.module_id, job.job_id, round), ...(readingImages ? { imageHistory: readingImages } : {}),
									reviewBudget: await readingReviewBudget(this.runtime().contentRoot),
									model, source: { pdf: job.source.path, cache, file_sha256:job.source.file_sha256 }, signal,
									cacheRoot:join(cache,'..','reviews'),
									reviewVersion:sha(Buffer.concat([Buffer.from(sourceRenderVersion+(draftHasMapRegions(candidate)?':map-region-review-v2':'')),Buffer.from(await readerInstructionText(this.runtime().contentRoot, { phase: "verify", guidance: job.purpose === "guidance", answer: job.purpose === "answer" }))])),
									run: ({systemPrompt: _instructions, ...request}) => reviewers.run(request,
										{ phase: "verify", guidance: job.purpose === "guidance", answer: job.purpose === "answer" })
										.then(run => { tallyFirstCall(accounting, "verify", run.firstCallUncached); return overrunRows(run, "verify", round); }),
									// Every verify row names the job and round it belongs to (#65); the reviewer adds unit and attempt.
									record: row => { tallyReadingRow(accounting, row); this.deps.record({ module_id: job.module_id, job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "", round, ...row, campaign }); },
									progress: row => this.deps.progress({ module_id: job.module_id, job_id: job.job_id,purpose:job.purpose, ...row, campaign }) });
							} finally { accounting.review_wall_ms += Date.now() - reviewBegan; }
							await claimCheck?.settle(join(cwd, "review.json"));
							await writeFile(join(cwd, "observations.json"), JSON.stringify(observations) + "\n");
							phaseCompleted = true;
							continue;
						}
						const imagePaths = new Set<string>();
						const imageCalls = new Map<string, string[]>();
						const pageCalls = new Map<string, Row[]>();
						const overviewCalls = new Map<string, number[]>(), overviewPages = new Set<number>();
						const sourcePages = new Set<number>();

						const reads = new Map<string, string>();
						// §151.2.2: a targeted pass keeps its own logs, so a full read that follows it in the round counts only its own pages.
						const eventLog = join(cwd, `${phase}-${round}${targeted ? "-targeted" : appended ? "-append" : ""}.jsonl`);
						const sourceRunStartedAt=Date.now();
						publicProgress('searching');
						const run = await this.runtime().runTask({ kind: "reader", request: { providerBudget, ...(readingLease ? { readingLease } : {}), cwd, model: model.id, thinking: model.thinking,
							...(job.visual_scan?{maxRequests:3}:{}),
							beforeProviderRequest:signal=>this.waitForPriority(job,key,signal,campaign),
							...(readingImages ? {imageHistory:readingImages} : {}),
							// §186.2: every child of this round, author and review units alike, shares one cache identity.
							cacheId: readingCacheId(job.module_id, job.job_id, round),
							submission:["guidance","opening","detail","answer"].includes(job.purpose),
							priority: () => job.foreground === false ? "background" : "foreground",
							prompt: { phase: promptPhase, purpose: job.purpose, visual:job.visual_scan?'scan':job.visual_asset?'asset':job.map_scope?'scope':undefined, guidance: job.purpose === "guidance", answer: job.purpose === "answer" }, source: { pdf: job.source.path, cache, file_sha256:job.source.file_sha256 },
							eventLog,
							brief: phase === "index-audit"
								? `${readerInput({task})} This is the independent map-page completeness audit of the retained PDF index. Read draft.json${round > 1 || job.resume_from ? " and findings.json" : ""}. View every physical page in task.index_audit_pages with pdf, compare each page to draft.map_candidates, and immediately add every authored map whose depicted place can be identified. Every task.required_map_candidates row must remain. Preserve existing sections and candidates; repair missing section source_refs but do not cite any page unless you viewed that full page in this audit or it is in task.index_audit_pages. If another page is needed as a reference, view it first. Do not rewrite for style. Finish only after every assigned page has been checked, then stop.`
								: targeted ? `${readerInput({task})} Your phase is ${phase}. ${TARGETED_REPAIR_ASK} Use submit_reading as your sole final tool call to save/check this batch and finish without a closing reply.`
								: appended ? `${readerInput({task})} Your phase is ${phase}. ${APPEND_REPAIR_ASK} Use submit_reading as your sole final tool call to save/check this batch and finish without a closing reply.`
								: guidanceProjection ? `${readerInput({task})} The selected entrance and public module facts are already source-reviewed. The host wrote an unchanged scene shard to draft.json; do not rewrite it. Use the original page images supplied in context, and pdf only for a missing or newly needed original page. Write the five guidance fields for task.focus in the player's language where requested. If a necessary public fact is absent, request its source instead of inventing it. Submit guidance and the required public_fields with submit_reading as your sole final tool call. ${round > 1 || job.resume_from ? "Read findings.json if present and address its concrete findings." : ""}`
								: `${readerInput({task})} Your phase is ${phase}. ${job.repair === "way_on" ? WAY_ON_ASK + " " : ""}Use page images to produce draft.json. If a draft was retained from this same interrupted request, inspect its sources and repair it instead of rewriting merely for style. ${["guidance","opening","detail","answer"].includes(job.purpose) ? "Use submit_reading as your sole final tool call to save/check this batch and finish without a closing reply." : ""} ${round > 1 || job.resume_from ? "Read findings.json if present and address its concrete findings." : ""}${job.resumed?.reread === true ? " The published material on this focus changed since the retained draft was written: check it against the current task and the pages, and repair what no longer holds." : ""}${job.review_retry ? ` ${REVIEW_RETRY_ASK}` : ""}${Array.isArray(job.carried_needs) && job.carried_needs.length ? ` ${CARRIED_NEEDS_ASK}` : ""}`,
							onEvent(event) {
								if (event.type === "tool_execution_start" && event.toolName === "read" && event.args?.path) reads.set(event.toolCallId, resolve(cwd, event.args.path));
								if (event.type === "tool_execution_end" && !event.isError && event.result?.content?.some((c: Row) => c.type === "image")) {
									if(event.result?.details?.kind==='source_overview')overviewCalls.set(event.toolCallId,
										(event.result.details.manifest?.tiles??[]).map((tile:Row)=>tile.page).filter(Number.isSafeInteger));
									const path = reads.get(event.toolCallId); if (path) imageCalls.set(event.toolCallId, [path]);
									if (event.result?.details?.kind === "source_pages") {
										const viewed = event.result.details.observations;
										imageCalls.set(event.toolCallId, viewed.map((row: Row) => row.path));
										pageCalls.set(event.toolCallId,viewed);
									}
								}
							},
						} }, signal);
						try{
							const delivered=await successfulImageDeliveries(eventLog+'.images.jsonl',{file_sha256:job.source.file_sha256,cache});
							for(const id of delivered.toolCallIds){
								for(const page of overviewCalls.get(id)??[])overviewPages.add(page);
								for(const path of imageCalls.get(id)??[])imagePaths.add(path);
								for(const row of pageCalls.get(id)??[])if(Number.isInteger(row.page)&&(!row.box||JSON.stringify(row.box)==='[0,0,1,1]'))sourcePages.add(row.page);
							}
							for(const row of delivered.hostPages){imagePaths.add(row.path);sourcePages.add(row.page);}
						}catch(error){if((imageCalls.size||overviewCalls.size)&&run.ok)throw error;}
						if(job.visual_scan&&phase==='read'&&run.ok){
							requireVisualOverview(job.visual_scan,overviewPages);
							observations.overview_pages=[...overviewPages].sort((a,b)=>a-b);
							this.deps.record({lane:'reading',event:'visual_overview',module_id:job.module_id,campaign,job_id:job.job_id,
								range:job.visual_scan,pages:observations.overview_pages,original_pages:[...sourcePages]});
						}
						// The pages this run consumed are read before the row is written, so the row can carry them (#65):
						// the physical page numbers (1-based) behind the images the reader kept, the same set `read_pages` is built from.
						// A page log that cannot be read still fails the job as before, after the row has landed.
						let rows: Row[] = [], pageLogFailure: unknown;
						if (run.ok && !job.visual_scan) {
							try {
								const lines = (await readFile(join(cache, "requests.jsonl"), "utf8")).trim().split("\n");
								rows = lines.map(line => JSON.parse(line)).filter(row => row.file_sha256 === job.source.file_sha256 && imagePaths.has(row.path));
							} catch (failure) { pageLogFailure = failure; }
						}
						const pagesRead = [...new Set(rows.map(row => row.page))];
						// §151.4: a background need read's decision, read before the row is written so the row can name it.
						let need: NeedReceipt | undefined, needFailure: unknown;
						if (run.ok && phase === "read" && task.source_need)
							try { need = await readNeedReceipt({cwd, command: run.command, startedAt: sourceRunStartedAt, key: task.source_need.key}); }
							catch (failure) { needFailure = failure; }
						this.deps.record({ lane: "reading", module_id: job.module_id, campaign, job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "",
							model: model.id, thinking: model.thinking, phase, round, cache_id: readingCacheId(job.module_id, job.job_id, round),
							...(run.firstCallUncached !== undefined ? { first_call_uncached: run.firstCallUncached } : {}), ms: run.ms, ok: run.ok, image_reads: imagePaths.size,
							...(run.ok && !pageLogFailure ? { pages: pagesRead } : {}), ...(run.usage ? { usage: run.usage } : {}), ...(run.overruns?.length ? { overruns: run.overruns.length } : {}),
							...(run.refusal ? { refusal: run.refusal.reason } : run.providerError ? { refusal: "transport" } : {}),
							...(need ? { need_disposition: need.disposition } : {}) });
						overrunRows(run, phase, round);
						tallyFirstCall(accounting, phase, run.firstCallUncached);
						accounting.author_ms += Number.isFinite(run.ms) ? run.ms : 0;
						// §151.2.4 + §151.4: the job row names the need read's disposition (a marked job with no receipt read).
						if (task.source_need && phase === "read" && run.ok) accounting.need = need?.disposition ?? "read";
						// §20 addendum 2: the reader's cost per page of this book, measured, for the next stage's lease.
						if (run.usage) await appendFile(join(cwd, "usage.jsonl"), JSON.stringify({ job_id: job.job_id, phase, round, cache_id: readingCacheId(job.module_id, job.job_id, round), ok: run.ok && !pageLogFailure,
							pages: run.ok && !pageLogFailure ? pagesRead.length : 0, usage: run.usage }) + "\n").catch(() => undefined);
						if (!run.ok && (run.refusal || run.providerError)) {
							const failure = providerFailure(run, !!providerBudget);
							this.deps.record({ lane: "reading", event: "provider_refused", module_id: job.module_id, campaign, job_id: job.job_id, purpose: job.purpose,
								focus: job.focus ?? "", phase, round, ...(run.refusal ?? { reason: "transport", provider_error: run.providerError }) });
							// A refusal from a lease this job shares across its rounds refuses the next round too: fail now.
							if (failure.final) lastRound = round;
							throw failure.error;
						}
						if (!run.ok) throw new Error(run.error || (run.timedOut ? "reader timed out" : run.stderr || "reader failed"));
						if (needFailure) throw needFailure;
						// §151.4: answered, unlocated or carried settles the attempt without an author; `read` goes on as today.
						if (need) {
							const decided = { disposition: need.disposition, ...(need.distribution ? { distribution: need.distribution, gate: need.gate } : {}),
								...(need.units ? { units: need.units } : {}), ...(need.evidence ? { evidence: need.evidence } : {}) };
							this.note({ lane: "reading", event: "source_need", module_id: job.module_id, campaign, job_id: job.job_id, focus: job.focus ?? "", ...decided });
							if (need.disposition !== "read") {
								await this.call("module.read.finish", { module_id: job.module_id, job_id: job.job_id, lease: job.lease, outcome: "settled",
									need: { ...decided, material_digest: need.material_digest } }, campaign);
								await this.readAhead({ module_id: job.module_id }, campaign).catch(() => undefined);
								return;
							}
						}
						await requireCheckedSourceReceipt({cwd,run,sourceSha:job.source.file_sha256,
							purpose:job.purpose,startedAt:sourceRunStartedAt});
						if(job.public_progress===true){
							validatePublicGuidance(JSON.parse(await readFile(join(cwd,'public-fields.json'),'utf8')),job.source.page_count);
							publicProgress('found');
						}
						if (pageLogFailure) throw pageLogFailure;
						// §151.2.2: the host's check of a targeted repair. Any record the review did not refuse that changed refuses the
						// repair: the reviewed candidate is put back and this round's read runs again as today's full repair.
						if (targeted) {
							const verdict = checkTargetedRepair(previousDraft!, JSON.parse(await readFile(join(cwd, "draft.json"), "utf8")), targeted.roots);
							if (!verdict.ok) {
								this.deps.record({ lane: "reading", event: "targeted_repair_refused", module_id: job.module_id, campaign, job_id: job.job_id,
									purpose: job.purpose, focus: job.focus ?? "", round, changed: verdict.paths.slice(0, 50) });
								await writeFile(join(cwd, "draft.json"), candidateBytes!);
								if (pendingNeeds) await writeFile(join(cwd, "pending-source-needs.json"), pendingNeeds);
								else await rm(join(cwd, "pending-source-needs.json"), { force: true });
								targetedRefused = true;
								phases.splice(at + 1, 0, "read");
								continue;
							}
							coverageCarry = repairedReview;
						}
						// §187.6.1: the host's check of an append repair. An existing record changed or removed refuses it: the reviewed
						// candidate is put back and this round's read runs again as today's full repair.
						if (appended) {
							const verdict = checkAppendRepair(previousDraft!, JSON.parse(await readFile(join(cwd, "draft.json"), "utf8")));
							if (!verdict.ok) {
								this.deps.record({ lane: "reading", event: "append_repair_refused", module_id: job.module_id, campaign, job_id: job.job_id,
									purpose: job.purpose, focus: job.focus ?? "", round, reason: verdict.reason, changed: verdict.paths.slice(0, 50) });
								await writeFile(join(cwd, "draft.json"), candidateBytes!);
								if (pendingNeeds) await writeFile(join(cwd, "pending-source-needs.json"), pendingNeeds);
								else await rm(join(cwd, "pending-source-needs.json"), { force: true });
								appendRefused = true;
								appendSource = undefined;
								phases.splice(at + 1, 0, "read");
								continue;
							}
						}
						if (phase === "index-audit") {
							const missing = integerList(task.index_audit_pages).filter(page => !sourcePages.has(page));
							if (missing.length) throw new Error(`index map audit did not inspect physical pages ${missing.join(", ")}`);
							const draft = JSON.parse(await readFile(join(cwd, "draft.json"), "utf8"));
							const finalCandidates: Row[] = Array.isArray(draft.map_candidates) ? draft.map_candidates : [];
							const finalKeys = new Set(finalCandidates.map(mapCandidateKey));
							const removed = requiredMapCandidates.filter(candidate => !finalKeys.has(mapCandidateKey(candidate)));
							if (removed.length) throw new Error(`index map audit removed retained candidates: ${removed.map(candidate => candidate.name ?? candidate.focus ?? "unnamed").join(", ")}`);
							const observed = new Set([...integerList(observations.full_pages), ...sourcePages]);
							const cited = [...(Array.isArray(draft.sections) ? draft.sections : []).flatMap((section: Row) =>
								(Array.isArray(section.source_refs) ? section.source_refs : []).map((ref: Row) => ref.page)),
								...finalCandidates.flatMap(candidate => integerList(candidate.pages))]
								.filter((page): page is number => Number.isInteger(page));
							const unviewed = [...new Set(cited.filter(page => !observed.has(page)))].sort((a, b) => a - b);
							if (unviewed.length) throw new Error(`index navigation references require viewing physical pages ${unviewed.join(", ")}`);
						}
						observations.read_pages = phase === "index-audit" ? [...new Set([...integerList(observations.read_pages), ...pagesRead])].sort((a, b) => a - b) : pagesRead;
						if (previousDraft) {
							const changed = editedSourcePages(previousDraft, JSON.parse(await readFile(join(cwd, "draft.json"), "utf8")));
							const absent = [...changed].filter(page => !observations.read_pages.includes(page));
							if (absent.length) throw new Error(`changed source records require viewing physical pages ${absent.join(", ")}`);
							observations.read_pages = [...new Set([...previousPages, ...observations.read_pages])];
						}
						if (phase === "index") {
							observations.index_candidate_pages = [...new Set([...integerList(observations.index_candidate_pages), ...sourcePages])].sort((a, b) => a - b);
							observations.full_pages = [...new Set(rows.filter(row => JSON.stringify(row.box) === "[0,0,1,1]").map(row => row.page))];
						}
						if (phase === "index-audit") observations.full_pages = [...new Set([...integerList(observations.full_pages), ...sourcePages])].sort((a, b) => a - b);
						await writeFile(join(cwd, "observations.json"), JSON.stringify(observations) + "\n");
						if (phase === "read" || phase === "index-audit") {
							readComplete = true;
							await writeFile(join(cwd, "read-complete.json"), JSON.stringify({ job_id: job.job_id, draft_sha256: sha(await readFile(join(cwd, "draft.json"))),
								...(phase === "index-audit" ? { index_map_audited: true } : {}),
								...(job.purpose === "guidance" ? {guidance_sha256:sha(await readFile(join(cwd,"guidance.json")))} : {}), observations }) + "\n");
							if(job.public_progress===true){
								const checkpoint=JSON.parse(await readFile(join(cwd,'read-complete.json'),'utf8'));
								await writeFile(join(cwd,'read-complete.json'),JSON.stringify({...checkpoint,public_fields_sha256:sha(await readFile(join(cwd,'public-fields.json')))})+'\n');
							}
						}
						phaseCompleted = true;
					}
					const assets = [];
					if (job.purpose !== "index" && job.purpose !== "answer") {
						const draft = JSON.parse(await readFile(join(cwd, "draft.json"), "utf8"));
						validateMapRegions(draft);
						for (const node of publishableAssetNodes(draft, job.purpose)) {
							if (typeof node.node_id !== "string" || !/^[a-z][a-z0-9-]{0,159}$/.test(node.node_id)) throw new Error("asset identifiers must be semantic kebab names");
							const mapRedactions = (draft.nodes ?? []).flatMap((map: Row) => (map.properties?.map_regions ?? [])
								.filter((region: Row) => typeof region.source_asset === "string" && [node.node_id, node.node_id.replace(/^asset-/, "")].includes(region.source_asset))
								.flatMap((region: Row) => Array.isArray(region.redactions) ? region.redactions : []));
							const imageSources = (node.properties.image_sources ?? []).map((region: Row) => ({ ...region,
								...(mapRedactions.length ? { redactions: mapRedactions } : {}) }));
							const asset = await sourceAsset(job.source.path, cache, imageSources, join(cwd, "assets", `${node.node_id}.png`));
							assets.push({ node_id: node.node_id, ...asset });
						}
					}
					let travel: TravelFill | undefined;
					if (this.deps.travel && job.purpose !== "index" && job.purpose !== "answer") {
						try {
							travel = await this.deps.travel({ moduleId: job.module_id, ...(campaign !== undefined ? { campaign } : {}), job,
								draft: JSON.parse(await readFile(join(cwd, "draft.json"), "utf8")), signal });
						} catch { travel = undefined; /* a road without minutes is the old behaviour, never a failed reading */ }
						if (travel) this.deps.record({ ...travel.row, module_id: job.module_id, job_id: job.job_id, campaign });
					}
					publishing = true;
					const finishing: Row = { module_id: job.module_id, job_id: job.job_id, lease: job.lease,
						outcome: "completed", draft_path: join(cwd, "draft.json"), review_path: join(cwd, "review.json"), assets,
						...(travel?.entries.length ? { travel: travel.entries } : {}) };
					let published: Row | undefined;
					// §152.4: a drafted visual overlapping a published one on its page waits for the reviewer's verdict on each
					// pair, then publishes again; a concurrent publication may raise new pairs, so it asks at most IDENTITY_ASKS times.
					for (let asked = 0; ; asked++) {
						try { published = await this.call("module.read.finish", finishing, campaign); break; }
						catch (failure) {
							const pairs = identityPending(failure);
							if (!pairs || asked >= IDENTITY_ASKS) throw failure;
							try {
								finishing.identity_review_path = await this.reviewIdentity(job, pairs, join(cwd, "identity", `round-${round}-${asked + 1}`),
									{ campaign, cache, signal, round, run: request => reviewers.run(request).then(run => overrunRows(run, "identity", round)) });
							} catch (unanswered) {
								if (!(unanswered instanceof IdentityReviewUnavailable) || signal.aborted) throw unanswered;
								identityHeld = unanswered.message;
								return;
							}
						}
					}
					publishing = false;
					this.recordLibrarySync(published, { module_id: job.module_id, campaign, job_id: job.job_id });
					if(published?.public_fields)publicProgress('confirmed',validatePublicGuidance(published.public_fields,job.source.page_count));
					if (travel?.entries.length) this.deps.record({ lane: "travel-fill", event: "published", module_id: job.module_id, job_id: job.job_id, campaign,
						filled: published?.travel?.filled ?? 0, skipped: published?.travel?.skipped ?? [] });
					// §22.4.6.1 addendum (SL-55): the answer's focus was published while it read; the kernel put it back in the queue
					// to be read again from this draft. The attempt is over; its slot is free and the next claim resumes it.
					if (published?.requeued) this.note({ lane: "reading", event: "requeued", module_id: job.module_id, campaign, job_id: job.job_id,
						purpose: job.purpose, focus: job.focus ?? "", reason: published.requeued, from_generation: published.from_generation, generation: published.generation });
					// The book turns its own pages next (spec thin-book-play B); never on the critical path, never a failure.
					if (["index","opening","detail"].includes(job.purpose)) await this.readAhead({ module_id: job.module_id, ...(["opening","detail"].includes(job.purpose) && job.focus ? { focus: job.focus } : {}) }, campaign).catch(() => undefined);
					return;
				} catch (failure) {
					if (isKernelError(failure) && failure.details?.reason === 'source_context_changed') throw failure;
					// Provider/transport failure during verification preserves the completed read.
					// A completed but rejected semantic review requires a source-grounded repair.
					// §22.4.3: a review the gate found malformed is the reviewer's slip; the read stands, the next round only re-reviews.
					const reviewSlip = isKernelError(failure) && (failure.details?.reason === "answer_review_malformed" || failure.details?.rule === 'review_incomplete');
					if (phaseCompleted && !reviewSlip) {
						readComplete = false;
						try {
							const checkpointPath = join(cwd, "read-complete.json");
							const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
							await writeFile(checkpointPath, JSON.stringify({ ...checkpoint, requires_repair: true }) + "\n");
						} catch { /* no completed read to invalidate */ }
					}
					detail = isKernelError(failure) ? failure.toToolText() : String(failure);
					refusal = isKernelError(failure) ? { message: failure.message,
						...Object.fromEntries(["path", "rule", "reason"].filter(key => typeof failure.details?.[key] === "string").map(key => [key, failure.details![key]])) } : undefined;
					if (publishing && finishSemanticRejection(failure) && !finishRepairUsed) {
						finishRepairUsed = true;
						lastRound = Math.max(lastRound, round + 1);
					}
					let review: Row | undefined;
					try { review = JSON.parse(await readFile(join(cwd, "review.json"), "utf8")); } catch { /* no review yet */ }
					const unsupported: Row[] = review ? (review.checked ?? []).filter((row: Row) => row.verdict !== "supported") : [];
					// §22.3.3 (SL-57): the refused fields and the reviewer's reasons travel with the refusal, for the one retry that reads with them.
					if (refusal && unsupported.length) refusal.refused = unsupported.flatMap((row: Row) => (Array.isArray(row.paths) ? row.paths : [row.path])
						.filter((path: unknown) => typeof path === "string" && path).map((path: string) => ({ path, verdict: String(row.verdict ?? ""), reason: String(row.reason ?? "") })));
					let repairs: string[] = [];
					if (unsupported.length) {
						try { repairs = unsupportedNumberRepairs(JSON.parse(await readFile(join(cwd, "draft.json"), "utf8")), unsupported); }
						catch { /* an unreadable draft still leaves the reviewer's own rows */ }
					}
					await writeFile(join(cwd, "findings.json"), JSON.stringify({ error: detail,
						...(isKernelError(failure) ? { details: failure.details } : {}),
						...(review ? { missing: review.missing, unsupported } : {}),
						...(repairs.length ? { repairs } : {}) }) + "\n");
				}
			}
		} finally {
			// §151.2.4: one row per job run with what it spent, whatever ended it.
			try {
				await tallyChildJev(accounting, cwd);
				this.deps.record({ lane: "reading", event: "job_accounting", module_id: job.module_id, campaign, job_id: job.job_id, purpose: job.purpose,
					focus: job.focus ?? "", ...accountingFields(accounting) });
			} catch { /* accounting never fails a reading */ }
			// Contract §20 addendum 2: a reading handed off at the owner's exit is not finished here. It stays
			// `running` with no lock holder, and the next owner's claim re-queues it with this attempt retained.
			if (this.handedOff.has(key)) {
				this.note({ lane: "reading", event: "handed_off", module_id: job.module_id, campaign, job_id: job.job_id, purpose: job.purpose, focus: job.focus ?? "" });
				return;
			}
			// §22.4.6: a displaced reading gives its slot back and keeps its attempt; it is not finished.
			if (this.displaced.has(key)) { await this.yieldSlot(job, campaign, key); return; }
			// §152.4: an unanswered identity question holds the job with its attempt; the next claim resumes and asks again.
			if (identityHeld !== undefined && !signal.aborted) {
				const held = await this.call("module.read.finish", { module_id: job.module_id, job_id: job.job_id, lease: job.lease,
					outcome: "held", reason: "visual_identity_unavailable", detail: identityHeld }, campaign).catch(() => undefined);
				this.note({ lane: "reading", event: "identity_held", module_id: job.module_id, campaign, job_id: job.job_id, purpose: job.purpose,
					focus: job.focus ?? "", state: held?.state ?? null, held: held?.held ?? null });
				return;
			}
			// Completed jobs replay here; failed attempts release their claim and preserve all artifacts.
			const outcome = this.jobOutcome(key, signal.aborted, detail);
			const finished = await this.call("module.read.finish", { module_id: job.module_id, job_id: job.job_id, lease: job.lease,
				...outcome, ...(outcome.outcome === "failed" && refusal ? { refusal } : {}) }, campaign).catch(() => undefined);
			// The stream goes on past a failed ask of the read-ahead's own; on a short book the last one may be what completes it (§182.2).
			if((job.source_unit||job.visual_scan||job.visual_asset||job.visual_identity||job.map_scope||job.source_need)&&finished&&!this.stopped&&!signal.aborted&&outcome.outcome==='failed')
				await this.readAhead({module_id:job.module_id},campaign).catch(()=>undefined);
			// §22.3.3 (SL-57): the refused read is queued once more, in the background, with the reviewer's reasons.
			if (finished?.requeued) this.note({ lane: "reading", event: "requeued", module_id: job.module_id, campaign, job_id: finished.requeued.job_id,
				of: job.job_id, purpose: job.purpose, focus: job.focus ?? "", reason: finished.requeued.reason });
		}
	}
}
