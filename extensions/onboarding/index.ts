import {selectSetupSource} from './source-intake.ts';
import {browseInvestigators} from './pregens.ts';
import { computeMove, renderBrief, type SetupSlot, type SetupNotes } from './brief.ts';
import { playerReason } from './reasons.ts';
/** Setup ordering comes from setup.steps; source preparation uses the shared visual reader. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from 'node:crypto';
import {buildSetupInputCatalog,setupUserTextFields,materializeSetupInputs,copySetupInputSelection,type SetupInputCatalog,type SetupInputField,type NameBoundaryCheckInput,type NameBoundaryDecision} from '../../runtime/jev/setup-input-references.ts';
import {nameBoundaryBindings,checkNameBoundary,NAME_BOUNDARY_FAMILY} from '../../runtime/jev/setup-name-boundary-domain.ts';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {preparationBudget} from '../../runtime/jev/preparation-budget.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {readJevApiKey} from '../jev/agent/config.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { prepareCharacterGuidance, acceptedGuidance, guidanceReviewRefused, type Guidance } from '../module/character-guidance.ts';
import {preparePdfCreationGuidance} from './pdf-guidance.ts';
import { registerInvokeHandlers } from '../../pipicoc/host-bridge.ts';
import { Type } from "typebox";
import { cocHome, cocMode } from "../lanes/host.ts";
import { agentHomeOf, openingHelp } from "../ui/hints.ts";
import { playLanguageTag } from "../../runtime/ui-words.ts";
import type { HostRuntime } from "../../runtime/host.ts";
import { type ExtensionWords, extensionContentRoot, extensionSurface } from "../ui/words.ts";
import {
	allowedSteps,
	applies,
	gate,
	type GateState,
	instructionFor,
	nextStep,
	axisProducts,
	declaredSources,
	normalizeSteps,
	type OpSpec,
	progressCounts,
	progressLine,
	sourceKinds,
	type Step,
} from "./steps.ts";

type KernelCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/**
 * How many times one guidance preparation may run when its reviewer refuses the draft: the first, and
 * one retry before the step answers (SL-103, §98 addendum 10). Bounded, because each run is an author
 * and a reviewer child, and the player's next line retries again anyway.
 */
const GUIDANCE_ATTEMPTS = 2;

/** The code of a kernel error envelope is read structurally: instanceof is unreliable across extensions (two module instances). */
function errorCode(error: unknown): string | undefined {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : undefined;
}

function errorText(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).slice(0, 400);
}

/**
 * Why setup is blocked for the rest of this turn. Three failures block, and they are not one
 * condition: a guidance preparation that failed inside `create-campaign`, one that failed at the
 * start of a later turn, and a `mods.context` read that failed at the start of a turn. Contract
 * §23.4 has a failed guidance review "block setup and suppress invented fallback prose", so the
 * two guidance causes drop the assistant's text; §26 has a failed `mods.context` "block the turn
 * with a notice rather than silently running the core policy", and the Keeper's own explanation
 * of that notice stays on screen. The flag carries the cause so the refusal, the notice and the
 * text rule each read it, never a string.
 */
type SetupBlockKind = 'guidance_at_create_campaign' | 'guidance_at_turn_start' | 'package_context';
interface SetupBlock {
	kind: SetupBlockKind;
	/** The kernel's or the preparer's error code, when it had one. */
	code?: string;
	detail: string;
	/** The actionable half of the cause (contract §14.15): it must survive into every refusal the block answers with. */
	fix?: string;
	details?: Record<string, unknown>;
	/** The player has already been told this turn (turn-start causes notify as they block). */
	noticed: boolean;
}

/** The two guidance kinds: the only blocks whose remedy is a setup step (§98 addendum 9). */
function guidanceBlock(block: SetupBlock | undefined): boolean {
	return block !== undefined && block.kind !== 'package_context';
}

/**
 * A failed guidance review keeps the Keeper's prose off the screen (§23.4); a failed package read does
 * not (§26), and neither does a missing opening choice: that one is a question the guide must ask
 * (§14.19), and hiding its text was half of the Masks deadlock.
 */
function setupBlockHidesText(block: SetupBlock): boolean {
	return guidanceBlock(block) && block.code !== 'needs_choice';
}

/** The actionable half of a thrown error, read structurally (contract §14.15). */
function actionable(error: unknown): {fix?: string; details?: Record<string, unknown>} {
	const fix = (error as {fix?: unknown} | null)?.fix, details = (error as {details?: unknown} | null)?.details;
	return {...(typeof fix === 'string' && fix ? {fix} : {}), ...(details && typeof details === 'object' && !Array.isArray(details) ? {details: details as Record<string, unknown>} : {})};
}

/** The candidates of an opening question (`details.candidates`), or undefined when it carries none. */
function openingCandidates(details: unknown): unknown[] | undefined {
	const rows = (details as {candidates?: unknown} | null | undefined)?.candidates;
	return Array.isArray(rows) && rows.length > 1 ? rows : undefined;
}

/**
 * The refusal every `setup` call gets while the turn is blocked: the actual cause and the fix that
 * matches it. `remedy` is the preparation step when this source has one (§98 addendum 9).
 */
function setupBlockRefusal(block: SetupBlock, remedy?: string): Record<string, unknown> {
	const why = block.code ? `${block.code}: ${block.detail}` : block.detail;
	let error: string;
	if (block.kind === 'package_context') {
		error = `The setup package context could not be read (mods.context: ${why}). Setup is blocked until it is restored: fix or disable the package the error names in the Mods panel, then wait for a new player input, which reads the context again; do not draft or continue setup on the core policy alone.`;
	} else if (block.code === 'needs_choice') {
		error = `Setup waits for the opening (${why}). Ask the player which opening to start from (details.candidates), then call ${remedy ?? 'the preparation step'} with the exact chosen candidate.scene handle as start_scene: it records the choice and prepares the guidance again. Do not translate that handle, invent a setup scene or create a card.`;
	} else {
		const when = block.kind === 'guidance_at_create_campaign' ? 'when create-campaign ran' : 'at the start of this turn';
		const fix = block.code === 'guidance_not_ready'
			? 'A new player input will not repair it: the starter\'s bundled guidance is missing or stale and only the offline bundle builder replaces it. Tell the player setup cannot continue on this starter.'
			: `Wait for a new player input, which retries the preparation${remedy ? `, or retry it now with ${remedy} (retry: true)` : ''}.`;
		error = `Module guidance could not be prepared ${when} (${why}). ${fix} Do not invent a setup scene or create a card.`;
	}
	const reason = playerReason({code: 'setup_blocked', blockedBy: block.kind, cause: block.code});
	return { ok: false, code: 'setup_blocked', blocked_by: block.kind, ...(block.code ? { cause: block.code } : {}), error,
		...(block.fix ? {fix: block.fix} : {}), ...(block.details ? {details: block.details} : {}), ...(reason ? {player_reason: reason} : {}) };
}

/**
 * What the guide is told when the last step hands the player to the table (§14.4 step seven, §98
 * addendum 10, SL-103): that the host has done it, as §14.18's `opening_shown` says of the opening,
 * and never the command. The host shows that itself -- `ctx.ui.notify` in a terminal, the play-mode
 * `coc-session` entry the App switches on -- and a command the guide repeats is noise in the App and a
 * second copy of the host's line in the terminal (the Masks re-run, 2026-09-27).
 */
function handoffShown(shown: boolean): string {
	return (shown
		? 'Setup is complete, and the host has already shown the player how the table opens.'
		: 'Setup is complete, and the host opens the table for the player itself.')
		+ " The handoff is the host's: write no command, path or launch line and do not repeat the host's line. Close the setup prologue in a sentence or two in play_language and continue nothing.";
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** A lookup path such as `source.module_id`. */
function lookupPath(context: Record<string, unknown>, path: string): unknown {
	let cursor: unknown = context;
	for (const segment of path.split(".")) {
		if (!cursor || typeof cursor !== "object") return undefined;
		cursor = (cursor as Record<string, unknown>)[segment];
	}
	return cursor;
}

/**
 * Contract §5: `campaign` is required in the parameters of every `table.*` and `setup.*` call;
 * source operations use the campaign workspace (§22.6), even before campaign creation.
 * Binding, registration and listing remain library operations; module.prepare keeps its initial work unscoped.
 */
function wantsCampaign(method: string): boolean {
	return method.startsWith("setup.") || method.startsWith("table.") ||
		(method.startsWith("module.") && !["module.source.bind", "module.register", "module.list"].includes(method));
}

export default function (pi: ExtensionAPI) {
	// In the play process this extension registers nothing (contract §14.4).
	if (cocMode() !== "setup") return;

	let ctx: ExtensionContext | undefined;
	let reading: { prepare(params: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
		pregens?(moduleId: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> } | undefined;
	pi.events.on("coc:reading-bridge", value => { reading = value && typeof (value as any).prepare === "function" ? value as any : undefined; });
	let bridge: { call: KernelCall; hello?: Record<string, unknown>; runtime?: HostRuntime } | undefined;
	let steps: Step[] | undefined;
	/** The `sources` the table declares; the source vocabulary comes from here, not from the steps (#32). */
	let tableSources: string[] = [];
	let stepsError: string | undefined;
	let loading: Promise<void> | undefined;
	const completed = new Set<string>();
	/** What completed steps left behind: campaign id, module id, source, investigator id, and so on; parameters are filled from here. */
	const context: Record<string, unknown> = {};
	/** The ops already run within one step (a list lookup like `setup.occupations` is not run twice). */
	const opCache = new Map<string, unknown>();
	let sourceKind: string | undefined;
	/** §21.5's second axis: which investigator lane this run took, set by the first step of one. */
	let investigatorSource: string | undefined;
	/** The last step is done: wait for this run to finish speaking, then exit the process. */
	let handoff: string | undefined;
  let characterGuidance: Guidance | undefined;
  let draftRevision: number | undefined;
  let prologueRecorded = false;
  let lastPlayerInput = "";
  let inputKey = "";
  let inputOrdinal=0;
  let inputCatalog:SetupInputCatalog|undefined;
  /** The player's earlier setup messages, before this input (§151.6: a first card is read from all of them). */
  let earlierInputs:string[]=[];
  let setupBlock: SetupBlock | undefined;
  /** §14.19: the openings the host last answered `needs_choice` with; the preparation step stays open until one is recorded. */
  let openingQuestion: unknown[] | undefined;
  /** §14.19: the opening the campaign itself pins -- campaign.create's, the resumed record's, or the one the remedy pinned. */
  let campaignOpening: string | undefined;
  /** §14.19.4: when this setup first waited on each reading, so the player hears roughly how long it has been. */
  const readingSince = new Map<string, number>();
  let guidancePending: Promise<Guidance | undefined> | undefined;
  const openingPrefetches=new Set<string>();
  // Contract §26 Guided Creation: the package's slots, the kernel's notes and the cap; the move is computed, never remembered.
  let setupSlots: SetupSlot[] = [];
  let setupNotes: SetupNotes | undefined;
  let guidedCap = 3;
  /** The rulebook catalog the setup prompt is given once per session (§98). */
  let catalogText = '';
  /** The same catalog as rows, for the driven setup run's read (§151.6); read with the text, never separately. */
  let catalogRows: Record<string, unknown> | undefined;
  const guidanceAbort = new AbortController();
  let invokeDisposers:Array<()=>void>=[];
  let completing=false;
	/** The captions this setup speaks with (contract §23), for whatever play language the table has named so far. */
	const surface = extensionSurface();
	// A background projection has written this tag's captions (contract §23): drop the authored
	// stand-in so the setup's next line is in the language the player named.
	pi.events.on("coc:ui-words", (data) => { surface.refresh((data as { tag?: unknown } | undefined)?.tag); });
	/** The campaign's play language as the kernel reported it; undefined until then, which reads as the data default. */
	function playLanguage(): string | undefined {
		return asString(context.play_language);
	}
	/**
	 * The one sentence §16.1 relies on, with its value (§14.17). The setup process has no capsule, so
	 * this is the only way the campaign's language reaches the guide; before a campaign names one
	 * there is nothing to say, and nothing is guessed.
	 */
	function tableLanguage(): string {
		const tag = playLanguage();
		return tag
			? `\n\nThis table's language: play_language=${tag}. Every word the player reads from you is written in it: each acknowledgement, question, example and reminder, the language notice, the card account and the close. ` +
				"Everything else given to you here is English for you, not for the player: these instructions, the module advice, the setup packages' instructions and the tool results. Carry their sense into play_language, never their English words."
			: "";
	}
	/** The captions for the language this setup is in right now; the tag is re-read every time, because it arrives mid-run. */
	function speaking(): Promise<ExtensionWords> {
		surface.speak(playLanguage());
		return surface.words();
	}
	/**
	 * The play language to record and to prepare guidance in: the campaign's when it names one of
	 * the right shape, and otherwise the tag the data calls the default. The set is open (contract
	 * §23, 2026-09-09), so nothing here asks whether the tag is one this build knows; no tag is
	 * written here either way.
	 */
	function boundLanguage(): Promise<string> {
		return playLanguageTag(extensionContentRoot(), playLanguage());
	}
  /**
   * The module guidance, prepared once and kept. One preparation runs at a time: a caller that arrives
   * while one is running joins it (and its signal), never starts a second.
   *
   * A draft the reviewer refused is prepared once more right away, inside this same preparation
   * (SL-103, §98 addendum 10): the step that asked -- create-campaign, the preparation step's remedy --
   * answers only after it, and the player is asked to wait only when that retry is refused too. Only a
   * refusal is retried (`guidanceReviewRefused`); a reader that failed, a missing opening or a stale
   * bundle is answered at once. Never after a stop: `signal` is the step's own (the player stopped the
   * run) and the session's end is always part of it, so a stop before the retry skips it and a stop
   * during it ends it.
   */
  async function ensureGuidance(signal?: AbortSignal): Promise<Guidance | undefined> {
    if(characterGuidance)return characterGuidance;
    if(guidancePending)return guidancePending;
    const moduleId=asString(context.module_id);
    if(!ctx || !bridge || !moduleId || !/^[a-z0-9-]{1,64}$/.test(moduleId) || !context.campaign)return;
    const home=cocHome(ctx.cwd);
    if(!existsSync(join(home,'.coc/modules',moduleId,'module.json')))return;
    const owner=bridge;
    const stop=signal ? AbortSignal.any([guidanceAbort.signal,signal]) : guidanceAbort.signal;
    guidancePending=(async()=>{
      if(typeof context.guidance_key==='string') {
        characterGuidance=await acceptedGuidance(home,moduleId,context.guidance_key);
        return characterGuidance;
      }
      const occupations=asRecord(await owner.call('setup.occupations',{})).occupations as any[];
      const runtime=owner.runtime;
      const options:Parameters<typeof prepareCharacterGuidance>[0]={home,module_id:moduleId,
        contentRoot:runtime?.contentRoot,
        opening:asString(context.start_scene),
        play_language:await boundLanguage(),occupations,
        model:ctx?.model ? ctx.model.provider+'/'+ctx.model.id : undefined,
        thinking:pi.getThinkingLevel(),signal:stop,
        runner:runtime ? request=>runtime.runTask({kind:'reader',request},request.signal) : undefined};
      for(let attempt=1;;attempt++) {
        try {
          characterGuidance=await prepareCharacterGuidance(options);
          return characterGuidance;
        } catch(error) {
          if(attempt>=GUIDANCE_ATTEMPTS || !guidanceReviewRefused(error) || stop.aborted)throw error;
        }
      }
    })().finally(()=>{guidancePending=undefined;});
    return guidancePending;
  }

  /**
   * The accepted opening is delivered once, directly, and booked as delivered (§23.4, §14.18). Every
   * path that shows it comes through here -- the App's session start, a terminal or driver setup's
   * first turn, and the turn a campaign is created in -- so the words the kernel records are the
   * words the player was shown, never a reply that retold them.
   */
  async function shownPrologue(guidance: Guidance): Promise<{customType:string;content:string;display:true;details:Record<string,unknown>}> {
    await bridge!.call('setup.prologue',{campaign:context.campaign,scene:guidance.scene,guide:guidance.guide,handoff:guidance.handoff,text:guidance.opening});
    prologueRecorded=true;
    // The prologue is the story and nothing else. What is happening here -- that this is the player's
    // investigator being made, that a name and a trade is enough -- rides beside it as a help fold
    // the host draws behind a "?" after the guide's question (user ruling 2026-09-16: immersion and
    // guidance both; the pinned intro card that used to say this hid the transcript). Captions of the
    // extension surface, so they arrive in the play language.
    const words=await speaking();
    // Open by itself the first time this home meets the moment, then only on the "?" (§4 of the spec).
    const help=await openingHelp('setup-opening',words.line('setup_help_title'),[words.line('setup_help_1'),words.line('setup_help_2'),words.line('setup_help_3'),words.line('setup_help_4'),words.line('setup_help_skip')],{home:cocHome(ctx!.cwd),agentHome:agentHomeOf(ctx!.cwd)});
    return {customType:'coc-setup-opening',content:guidance.opening,display:true,details:{kind:'setup-opening',help}};
  }

	function state(): GateState {
		return {
			completed,
			...(sourceKind ? { sourceKind } : {}),
			...(investigatorSource ? { investigatorSource } : {}),
		};
	}

	/**
	 * The progress line the player watches (contract §23): the same counts the tool's own `progress`
	 * reports, drawn with the campaign's captions instead of the English the model reads.
	 */
	function paint(): void {
		const table = steps;
		if (!table) return;
		const counts = progressCounts(table, state());
		void speaking()
			.then((words) => {
				try {
					if (!ctx?.hasUI) return;
					ctx.ui.setStatus(
						"coc-setup",
						counts
							? counts.next
								? words.line("setup_progress", { done: counts.done, total: counts.total, step: counts.next.id })
								: words.line("setup_progress_ready", { done: counts.done, total: counts.total })
							: undefined,
					);
				} catch {
					/* the status line must not break a step */
				}
			})
			.catch(() => {
				/* an unreadable content root leaves the line as it was */
			});
	}

	// ---- The table --------------------------------------------------------

	/**
	 * The table comes from the kernel. When `setup.steps` carries `completed` or `state`, this is a setup
	 * being picked up where the last one left off (`bin/pi-coc setup --campaign <id>`).
	 */
	async function loadSteps(): Promise<void> {
		const current = bridge;
		if (!current) {
			stepsError = "The kernel bridge is not up yet, so the setup table cannot be fetched.";
			return;
		}
		try {
			const campaign = asString(context.campaign);
			const result = asRecord(await current.call("setup.steps", campaign ? { campaign } : {}));
			const rows = normalizeSteps(result);
			if (rows.length === 0) {
				stepsError = "The kernel answered with an empty setup table: there are no steps to walk.";
				return;
			}
			steps = rows;
			tableSources = declaredSources(result);
			stepsError = undefined;
			absorbCompleted(rows, result.completed);
			const carried = asRecord(result.state);
			for (const [key, value] of Object.entries(carried)) {
				if (context[key] === undefined) context[key] = value;
			}
			const restoredDraft=asRecord(carried.draft);
      if(typeof restoredDraft.revision==='number')draftRevision=restoredDraft.revision;
      if(carried.notes && typeof carried.notes==='object')setupNotes=carried.notes as SetupNotes;
      prologueRecorded=!!carried.prologue;
      // A resumed campaign's own opening (§14.19): null for a book created before its opening was chosen.
      campaignOpening = asString(carried.start_scene) ?? campaignOpening;
      const carriedSource = asRecord(carried.source);
			sourceKind = asString(carried.source_kind) ?? asString(carriedSource.kind) ?? sourceKind;
		} catch (error) {
			stepsError = `setup.steps did not come back: ${errorCode(error) ?? "internal"}: ${errorText(error)}`;
		}
	}

	/** Book the steps the kernel reports done. The kernel's list only ever adds: a booked step is never un-booked here. */
	function absorbCompleted(rows: Step[], done: unknown): void {
		for (const entry of Array.isArray(done) ? done : []) {
			const id = asString(entry);
			if (!id) continue;
			completed.add(id);
			// A resumed setup that already took one investigator lane keeps that axis settled.
			const row = rows.find((step) => step.id === id);
			if (row?.investigatorSource && row.receipt && axisProducts(rows).has(row.receipt)) {
				investigatorSource ??= row.investigatorSource;
			}
		}
	}

	/**
	 * The card's button confirms and completes on a cold kernel (§98) while this process may still be
	 * running, so once a card exists the steps booked at session start are no longer the kernel's
	 * truth. Read them again before a turn decides what setup still owes.
	 */
	async function refreshCompleted(): Promise<void> {
		if (!steps || !bridge || !context.campaign || draftRevision === undefined || completed.has("complete")) return;
		try {
			absorbCompleted(steps, asRecord(await bridge.call("setup.steps", { campaign: context.campaign })).completed);
		} catch {
			/* an unreadable snapshot leaves the booked steps as they were; the turn goes on as before */
		}
	}

	async function ensureSteps(): Promise<void> {
		if (steps) return;
		loading ??= loadSteps().finally(() => {
			loading = undefined;
		});
		await loading;
	}

	/**
	 * The rulebook catalog (§98), read once a campaign exists: the prompt's text and, for the driven setup run's
	 * read (§151.6), the same answer as rows. A catalog that cannot be read is not a reason to stop setup; the
	 * kernel still resolves names, and the next turn asks again.
	 */
	async function loadCatalog(): Promise<void> {
		if (catalogText || !bridge || !context.campaign || !completed.has('create-campaign')) return;
		try {
			const catalog=asRecord(await bridge.call('setup.catalog',{campaign:context.campaign}));
			const occupations=(Array.isArray(catalog.occupations)?catalog.occupations:[]) as Array<Record<string,unknown>>;
			const skills=(Array.isArray(catalog.skills)?catalog.skills:[]) as Array<Record<string,unknown>>;
			const weapons=(Array.isArray(catalog.weapons)?catalog.weapons:[]) as string[];
			catalogText='\n\nThe rulebook catalog. Write these names (or the label after the slash) in occupation, occupation_skills, interest_skills, numbers.skills and weapons; the kernel resolves either. A trade with no entry here is drafted under the closest entry with the player\'s own words in occupation_stated.'+
				'\nOccupations (credit rating range; skill points; printed skill list):\n'+occupations.map(o=>`- ${String(o.id)}${o.label&&o.label!==o.id?' / '+String(o.label):''} (${(o.credit_rating_range as number[]).join('-')}; ${String(o.formula)}): ${(o.skills as string[]).join('; ')}`).join('\n')+
				'\nSkills: '+skills.map(s=>s.label&&s.label!==s.name?`${String(s.name)} / ${String(s.label)}`:String(s.name)).join(', ')+'; a language is written '+String(catalog.language_specialty??'Language (Other: English)')+'.'+
				'\nWeapons the tables print (anything else is equipment): '+weapons.join(', ');
			catalogRows=catalog;
		} catch { /* a catalog that cannot be read is not a reason to stop setup; the kernel still resolves names */ }
	}

	// ---- Parameters -------------------------------------------------------

	/** The model may spread parameters at the top level or pack them into `params`; both are accepted. */
	function mergeArgs(raw: Record<string, unknown>): Record<string, unknown> {
		const { step: _step, params, ...rest } = raw;
		return { ...rest, ...asRecord(params) };
	}

	interface Filled {
		params: Record<string, unknown>;
		missing: string[];
	}

	/** A value comes, in order, from this call's parameters, the `from` path the table names, and the same-named value left by a completed step. */
	function fillParams(op: OpSpec, args: Record<string, unknown>, isFirst: boolean): Filled {
		const params: Record<string, unknown> = {};
		const missing: string[] = [];
		for (const spec of op.params) {
			const value =
				args[spec.name] ?? (spec.from ? lookupPath(context, spec.from) : undefined) ?? context[spec.name];
			if (value === undefined || value === null || value === "") {
				if (spec.required) missing.push(spec.name);
				continue;
			}
			params[spec.name] = value;
		}
		// When the table gives only one step-level parameter set, the later ops must at least get the identity key, or the kernel does not know which book is meant.
		if (!isFirst && op.params.length === 0) {
			const moduleId = asString(context.module_id);
			if (moduleId) params.module_id = moduleId;
		}
		if(op.method==='campaign.create' && context.campaign)params.id=context.campaign;
		// §14.19: the opening prepare-module recorded is the campaign's; the kernel pins it (§22.9) and
		// checks it names an authored opening. Carried by the host, never re-typed by the guide.
		if (op.method === 'campaign.create') {
			const chosen = asString(context.start_scene);
			if (chosen) params.start_scene = chosen;
		}
    const campaign = asString(context.campaign);
		if (campaign && wantsCampaign(op.method) && params.campaign === undefined) params.campaign = campaign;
		return { params, missing };
	}

	/** Scalars from a result go into the context; from objects only the identity keys the contract names are taken, so a whole graph never lands in a parameter slot. */
	let recordedBinding = "";
	function noteResult(result: Record<string, unknown>): void {
		for (const [key, value] of Object.entries(result)) {
			if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
				context[key] = value;
			}
		}
		const campaign = asRecord(result.campaign);
		const campaignId = asString(result.campaign_id) ?? asString(campaign.id) ?? asString(result.campaign);
		if (campaignId) context.campaign = campaignId;
    // `campaign.create` answers with the campaign record, the tag nested in it (§14.17). Left out of
    // the context, a campaign made in this process prepared its guidance and spoke its captions in
    // the data default, and its guide was never told the table's language.
    if (asString(campaign.play_language)) context.play_language = asString(campaign.play_language);
    // The opening the kernel pinned on the record it just created (§14.19), when it pinned one.
    if (asString(campaign.opening_scene)) campaignOpening = asString(campaign.opening_scene);
    const language = asString(context.play_language);
    if (ctx && context.campaign && language) {
      const data = {campaign: context.campaign, home: cocHome(ctx.cwd), play_language: language, mode: "setup"};
      const identity = JSON.stringify(data);
      if (identity !== recordedBinding) {
        recordedBinding = identity;
        pi.appendEntry("coc-session", data);
        pi.events.emit("coc:session-bound", data);
      }
    }
		const moduleId = asString(result.module_id) ?? asString(asRecord(result.module).id);
		if (moduleId) context.module_id = moduleId;
	}

	// ---- The three steps that are not one kernel call ---------------------

	/**
	 * What the player may choose from: the starters in `kernel.hello`'s content, the books already
	 * installed in the module store (§20.7's third source — parsed once, played any number of times),
	 * and the campaigns `campaign.list` already has.
	 */
	async function sourceCatalogue(): Promise<Record<string, unknown>> {
		const modules = asRecord(asRecord(bridge?.hello).content).modules;
		const starters = Array.isArray(modules) ? modules.filter((row) => typeof row === "string") : [];
		let campaigns: unknown[] = [];
		try {
			const listed = asRecord(await bridge?.call("campaign.list", {}));
			campaigns = Array.isArray(listed.campaigns) ? listed.campaigns : [];
		} catch {
			/* failing to list them must not block choosing a book */
		}
		let installed: string[] = [];
		let installedModules: Record<string, unknown>[] = [];
		try {
			const listed = asRecord(await bridge?.call("module.list", {}));
			const rows = Array.isArray(listed.modules) ? listed.modules : [];
			installedModules = rows.map(asRecord).filter(row => row.status === "installed");
			installed = rows
				.map((row) => {
					const record = asRecord(row);
					return record.status === "installed" ? asString(record.module_id) ?? asString(record.id) : undefined;
				})
				.filter((row): row is string => row !== undefined && !starters.includes(row));
		} catch {
			/* a store that cannot be listed still leaves the starters choosable */
		}
		return { starters, installed, installed_modules: installedModules, campaigns, kinds: sourceKinds(steps ?? [], tableSources) };
	}

	/**
	 * Choosing the source (the table's `ask` step): the player either names a starter or gives an original PDF path.
	 * The vocabulary of source kinds comes from the table (`applies_to`); no second one is kept here.
	 */
	async function runAsk(step: Step, args: Record<string, unknown>): Promise<Record<string, unknown>> {
		const catalogue = await sourceCatalogue();
		const kinds = catalogue.kinds as string[];
		const module = asString(args.module) ?? asString(args.module_id) ?? asString(args.starter);
		const pdf = asString(args.pdf);
		const starterNames = catalogue.starters as string[];
		const installedNames = catalogue.installed as string[];
		let kind = asString(args.kind) ?? asString(args.source_kind);
		if (!kind) {
			// Source kind follows what was selected, not the shape of the step table.
			if (pdf) kind = "pdf";
			else if (module && starterNames.includes(module)) kind = kinds.includes("starter") ? "starter" : kinds[0];
			else if (module && installedNames.includes(module)) kind = kinds.includes("module") ? "module" : kinds[0];
		}
		if (!kind) {
			return {
				ok: false,
				step: step.id,
				needs: ["kind"],
				hint: `Settle the source with the player first: a starter, an installed module, or an original PDF. The table's source kinds are ${kinds.join(", ") || "starter, pdf"}.`,
				...catalogue,
			};
		}
		if (kinds.length > 0 && !kinds.includes(kind)) {
			return {
				ok: false,
				step: step.id,
				rejected: `The setup table's only source kinds are ${kinds.join(", ")}; there is no "${kind}".`,
				...catalogue,
			};
		}
		if (module) {
			const known = [...starterNames, ...installedNames];
			if (known.length > 0 && !known.includes(module)) {
				return {
					ok: false,
					step: step.id,
					rejected: `Neither the content catalogue nor the module store has a book called "${module}".`,
					candidates: known,
					...catalogue,
				};
			}
			return { ok: true, source: { kind, module_id: module }, ...catalogue };
		}
		if (pdf) return { ok: true, source: { kind, pdf }, ...catalogue };
		return {
			ok: false,
			step: step.id,
			needs: ["module or pdf"],
			hint: "Choose a named starter or installed module, or provide the original PDF path in pdf.",
			...catalogue,
		};
	}

  function freezeInputSources(prompt:string):void {
    let branch:any[]=[],all:any[]=[],unavailable=false;
    try {const value=ctx?.sessionManager.getBranch();if(!Array.isArray(value)) unavailable=true;else branch=value;
      const entries=(ctx?.sessionManager as any)?.getEntries?.();all=Array.isArray(entries)?entries:branch;
    } catch {unavailable=true;}
    inputOrdinal=Math.max(inputOrdinal,...all.filter(entry=>entry.type==='custom'&&entry.customType==='coc-setup-input-epoch')
      .map(entry=>Number(entry.data?.ordinal)).filter(value=>Number.isSafeInteger(value)&&value>=0))+1;
    pi.appendEntry('coc-setup-input-epoch',{ordinal:inputOrdinal});
    const fields=setupUserTextFields(branch,{occurrence:`current:${inputKey}`,text:prompt});
    earlierInputs=fields.slice(0,-1).map(field=>field.text).filter(text=>text.trim());
    inputCatalog=buildSetupInputCatalog({epoch:inputKey,generation:inputOrdinal,branch:`${branch.at(-1)?.id??'root'}:${branch.length}`,fields,
      unavailable:unavailable||(draftRevision!==undefined&&!branch.some(entry=>entry.type==='message'&&entry.message?.role==='user'))});
  }
  /** §98 addendum 7 continuation (SL-68): a per-row Jev question, timed and budgeted like the table's other
   * optional preparation lanes, asked only for a `profile.name` range selection and only when a boundary token
   * survives SL-66's punctuation/space trim. Unconfigured Jev, no time left, or any failure keeps the token
   * (the fail-safe `materializeSetupInputs` already applies when this returns nothing extra) -- this never blocks
   * setup on the check. */
  const DEFAULT_NAME_BOUNDARY_TIMEOUT_MS=2_500;
  function nameBoundaryTimeoutMs(env:NodeJS.ProcessEnv):number {
    const value=Number(env.PI_COC_NAME_BOUNDARY_TIMEOUT_MS?.trim()||NaN);
    return Number.isFinite(value)&&value>0?value:DEFAULT_NAME_BOUNDARY_TIMEOUT_MS;
  }
  async function checkNameBoundaryFor(campaign:string,epoch:string,input:NameBoundaryCheckInput):Promise<NameBoundaryDecision> {
    const env=process.env;
    if(!readJevApiKey(env)) return {leading:true,trailing:true};
    let lease:TaskLease|undefined,accounting:ReturnType<typeof preparationBudget>|undefined;
    try {
      const deadlineAt=Date.now()+nameBoundaryTimeoutMs(env),bindings=nameBoundaryBindings(campaign,epoch,input);
      accounting=preparationBudget({decision:createDecisionAdapter({env,maxConcurrency:4,retryPolicies:{
        [NAME_BOUNDARY_FAMILY]:{maxRetries:0,backoffInitialMs:100,backoffMaxMs:1_000}}}),
        campaign,deadlineAt,signal:new AbortController().signal,owner:NAME_BOUNDARY_FAMILY,
        goal:'Check whether a selected name range\'s boundary token belongs to the name'});
      lease=new TaskLease({owner:NAME_BOUNDARY_FAMILY,goal:'Check whether a selected name range\'s boundary token belongs to the name',
        scope:bindings.scope,capabilities:['decision'],readSet:bindings.readSet,
        budget:{deadlineAt,remainingInputTokens:100_000,remainingOutputTokens:10_000,remainingCostUsd:0.01,remainingActions:1}});
      return await checkNameBoundary(campaign,epoch,input,accounting.decision,lease);
    } catch { return {leading:true,trailing:true}; }
    finally { lease?.close(); accounting?.close(); }
  }
  async function bindInputParams(params:Record<string,unknown>):Promise<Record<string,unknown>> {
    if(!inputCatalog) throw new Error('Current setup input sources are unavailable; omit unchanged names and wait for the current player input');
    const profile=asRecord(params.profile),values:Partial<Record<SetupInputField,unknown>>={};
    if(Object.hasOwn(profile,'name')) values['profile.name']=profile.name;
    if(Object.hasOwn(params,'pending_action')) values.pending_action=params.pending_action;
    const campaign=String(params.campaign??context.campaign??'');
    const bound=await materializeSetupInputs(inputCatalog,{campaign,inputKey,values},
      (input)=>checkNameBoundaryFor(campaign,inputKey,input));
    return {...params,input_key:inputKey,setup_input:bound.envelope,
      ...(Object.hasOwn(profile,'name')?{profile:{...profile,name:bound.values['profile.name']}}:{}),
      ...(Object.hasOwn(params,'pending_action')?{pending_action:bound.values.pending_action}:{})};
  }

	// ---- One step ---------------------------------------------------------

	/** Put a new card revision on the table: remember it and append the card (contract §98). Every
	 *  writer of a revision comes through here — the first draft, a revision, a reroll — and the
	 *  card entry is the host's guarantee that the revision was shown; the kernel no longer asks. */
	async function presentDraft(_current: NonNullable<typeof bridge>, result: Record<string, unknown>): Promise<void> {
		draftRevision = result.revision as number;
		context.draft = result;
		pi.appendEntry('coc-character-draft', {...result, play_language: await boundLanguage()});
		if (process.env.PI_COC_SETUP_AUTOSTART !== '1') {
			pi.sendMessage({customType: 'coc-character-preview', content: JSON.stringify(result.sheet), display: true});
		}
	}
	/** What the model is told about a card (§98): the numbers and the words it needs to describe it,
	 *  never the creation trace, the finance table or the backstory it wrote itself. */
	function summarize(result: Record<string, unknown>): Record<string, unknown> {
		const sheet = asRecord(result.sheet);
		const out: Record<string, unknown> = {revision: result.revision,
			card: {name: sheet.name, occupation: sheet.occupation, occupation_stated: sheet.occupation_stated ?? null, age: sheet.age, sex: sheet.sex,
				characteristics: sheet.characteristics, derived: sheet.derived, skills: sheet.skills, credit_rating: sheet.credit_rating, cash: sheet.cash ?? null,
				weapons: Array.isArray(sheet.weapons) ? (sheet.weapons as Array<Record<string, unknown>>).map(weapon => weapon.name) : [], equipment: sheet.equipment ?? []},
			pins: result.pins, budget: result.budget, completeness: result.completeness};
		for (const key of ['applied', 'unresolved', 'filled_in', 'moved_to_equipment', 'kept_player_pins', 'notes']) if (result[key] !== undefined) out[key] = result[key];
		return out;
	}
	/**
	 * What the guide reads of one op's answer in a step result: the card as its summary (§98), the
	 * confirmation as its revision, and the completion without its `launch` line -- the kernel's record
	 * keeps it, but the command that opens the table is the host's to show (§98 addendum 10).
	 */
	function guideView(method: string, value: unknown): unknown {
		if (method === 'setup.draft') return summarize(asRecord(value));
		if (method === 'setup.confirm') return {committed: asRecord(value).committed, revision: asRecord(value).revision};
		if (method === 'setup.complete') {
			const {launch: _launch, ...rest} = asRecord(value);
			return rest;
		}
		return value;
	}

	/** Run this step's ops in table order; a missing parameter stops it there and hands the results so far to the model to fill in. */
	async function runOps(step: Step, args: Record<string, unknown>, signal?:AbortSignal): Promise<Record<string, unknown>> {
		const current = bridge;
		if (!current) return { ok: false, step: step.id, rejected: "The kernel bridge is gone, so this step cannot run." };
		const results: Record<string, unknown> = {};
		for (const [index, op] of step.ops.entries()) {
			const cacheKey = `${step.id}\u0000${op.method}`;
			if (op.method !== 'investigator.list' && opCache.has(cacheKey)) {
				results[op.method] = opCache.get(cacheKey);
				continue;
			}
			const filled = fillParams(op, args, index === 0);
      if(op.method==='setup.draft'||op.method==='setup.confirm')filled.params.input_key=inputKey;
      // setup.confirm's revision stays omitted: the kernel defaults it to the campaign's current
      // draft (contract §23.4), which keeps a UI-driven override confirmable without a re-draft.
      if(op.method==='setup.confirm') filled.params.last_exchange=lastPlayerInput;
			if (filled.missing.length > 0) {
				return {
					ok: false,
					step: step.id,
					blocked_on: op.method,
					needs: filled.missing,
					results,
					hint:
						`${op.method} is still missing ${filled.missing.join(", ")}. ` +
						`The results above hold what this step already looked up (the occupation list, for instance): pick from them, or ask the player.`,
				};
			}
			try {
                if(op.method==='setup.draft'||op.method==='setup.confirm')filled.params=await bindInputParams(filled.params);
				if(op.method==='setup.complete'&&sourceKind!=='starter'&&reading){
					const moduleId=asString(context.module_id),scene=campaignOpening??asString(context.start_scene)??characterGuidance?.scene;
					if(moduleId&&scene)await reading.prepare({module_id:moduleId,start_scene:scene,targeted:true,campaign:context.campaign},signal);
				}
				const result =
					op.method === "module.prepare"
						? await (reading && ctx ? preparePdfCreationGuidance({home:cocHome(ctx.cwd),contentRoot:current.runtime?.contentRoot,
							params:filled.params,reading,playLanguage:boundLanguage,
							occupations:async()=>asRecord(await current.call('setup.occupations',{})).occupations as Record<string,unknown>[],signal})
							: Promise.reject(new Error("the reading service is unavailable")))
						: op.method === 'investigator.list'
							? await browseInvestigators(current.call, filled.params, asString(context.module_id), reading, signal)
							: asRecord(await current.call(op.method, filled.params));
				if (result.ok === false) return { ...result, step: step.id, results };
				if(op.method==='setup.draft') await presentDraft(current,result);
        results[op.method] = result;
        if(op.method!=='investigator.list') opCache.set(cacheKey, result);
				noteResult(result);
			} catch (error) {
				// The kernel's `fix` and `details` are the only actionable part of a refusal
				// (contract §1) and they must survive this projection: dropping them is what made
				// the setup model guess one near-miss play_language after another and then give up on
				// the parameter altogether, while the refusal had been naming the accepted tags all
				// along (#33).
				const fix = (error as { fix?: unknown }).fix;
				const details = (error as { details?: unknown }).details;
				return {
					ok: false,
					step: step.id,
					failed_on: op.method,
					code: errorCode(error) ?? "internal",
					message: errorText(error),
					...(typeof fix === "string" && fix ? { fix } : {}),
					...(details && typeof details === "object" ? { details } : {}),
					results,
				};
			}
		}
		return { ok: true, ...results };
	}

	// ---- The opening choice and the block's remedy (contract §14.19, §98 addendum 9) ----

	/** The step whose op is `method`: the table owns the step ids, the host knows the ops it runs. */
	function stepWithOp(method: string): Step | undefined {
		return steps?.find((row) => row.ops.some((op) => op.method === method));
	}

	/**
	 * A block never blocks its own remedy. While setup is blocked on guidance, or (unblocked) the host has
	 * asked for the opening, the preparation step stays open whether or not it is done: it is the step
	 * that records the opening choice and retries the preparation. Card and campaign steps still wait.
	 */
	function remedyOpen(id: string | undefined): boolean {
		const preparation = stepWithOp('module.prepare');
		if (!preparation || id !== preparation.id) return false;
		return setupBlock ? guidanceBlock(setupBlock) : openingQuestion !== undefined;
	}

	/** The preparation step's id when it is this source's remedy, for the refusal's fix. */
	function remedyStep(): string | undefined {
		const preparation = stepWithOp('module.prepare');
		return preparation && applies(preparation, state()) ? preparation.id : undefined;
	}

	/**
	 * The player's reason beside a result that did not go through (§14.19.4, SL-100), chosen from the
	 * result's closed codes only. A reading wait also says how long this setup has waited on that same
	 * reading, measured from the call that first waited on it.
	 */
	function withReason(outcome: Record<string, unknown>, startedAt: number): Record<string, unknown> {
		const details = asRecord(outcome.details), read = asRecord(details.read), reason = asString(details.reason);
		let minutes: number | undefined;
		if (reason === 'reading_timeout') {
			const key = JSON.stringify([asString(read.purpose) ?? '', asString(read.focus) ?? '']);
			const since = readingSince.get(key) ?? startedAt;
			readingSince.set(key, since);
			minutes = Math.round((Date.now() - since) / 60_000);
		}
		const text = playerReason({code: asString(outcome.code), cause: asString(outcome.cause), reason, purpose: asString(read.purpose), minutes});
		return text ? {...outcome, player_reason: text} : outcome;
	}

	/**
	 * A guidance preparation that produced no guidance blocks setup with its cause (§98 addendum 4) and
	 * answers actionably (§14.15): a missing opening is `needs_choice` with the candidates (§14.19),
	 * anything else `guidance_failed` with the preparer's code as `cause`.
	 */
	function guidanceFailure(error: unknown, kind: SetupBlockKind, noticed: boolean, startedAt: number): Record<string, unknown> {
		const code = errorCode(error), detail = errorText(error), {fix, details} = actionable(error);
		setupBlock = {kind, ...(code ? {code} : {}), detail, ...(fix ? {fix} : {}), ...(details ? {details} : {}), noticed};
		const question = code === 'needs_choice' ? openingCandidates(details) : undefined;
		if (question) openingQuestion = question;
		return withReason({ok: false, code: question ? 'needs_choice' : 'guidance_failed', ...(code ? {cause: code} : {}), message: detail,
			...(fix ? {fix} : {}), ...(details ? {details} : {})}, startedAt);
	}

	/**
	 * create-campaign never runs guidance without a recorded opening on a book with several (§14.19
	 * ruling 4). Only a book that came through the preparation step is asked; its openings are the
	 * kernel's `module.status` `opening_candidates`. A status that cannot be read leaves the step to
	 * the kernel and the guidance preparer, which answer the same question themselves.
	 */
	async function unchosenOpenings(): Promise<unknown[] | undefined> {
		const preparation = stepWithOp('module.prepare'), moduleId = asString(context.module_id);
		if (!bridge || !preparation || !completed.has(preparation.id) || !moduleId || asString(context.start_scene)) return undefined;
		try { return openingCandidates({candidates: asRecord(await bridge.call('module.status', {module_id: moduleId})).opening_candidates}); }
		catch { return undefined; }
	}

	/** Begin the already chosen scene while the player is still building a card. */
	function prepareOpeningInBackground(campaign:string,scene:string):void {
		const moduleId=asString(context.module_id),owner=reading;
		if(!owner||!moduleId||sourceKind==='starter'||!campaign||!scene)return;
		const key=campaign+'\u0000'+moduleId+'\u0000'+scene;
		if(openingPrefetches.has(key))return;
		openingPrefetches.add(key);
		try{pi.appendEntry('coc-telemetry',{lane:'reading',event:'opening_overlap_start',campaign,module_id:moduleId,scene,at:new Date().toISOString()});}catch{}
		void owner.prepare({module_id:moduleId,start_scene:scene,targeted:true,background:true,campaign})
			.catch(error=>{
				openingPrefetches.delete(key);
				try{pi.appendEntry('coc-telemetry',{lane:'reading',event:'opening_overlap_wait_ended',campaign,module_id:moduleId,scene,
					code:errorCode(error)??'reading_failed',at:new Date().toISOString()});}catch{}
			});
	}

	/**
	 * After the preparation step succeeds on a campaign that already exists: the campaign's own opening
	 * is pinned when it has none (a campaign created before its opening was chosen), with
	 * `module.opening.choose` scoped to that campaign -- never the library, which other tables read --
	 * and a guidance block is retried now instead of on the player's next line. Returns the refusal to
	 * answer with, or undefined when the step's own success stands.
	 */
	async function afterPreparation(id: string, outcome: Record<string, unknown>, startedAt: number, signal?: AbortSignal): Promise<Record<string, unknown> | undefined> {
		const creation = stepWithOp('campaign.create'), campaign = asString(context.campaign);
		if (!bridge || !creation || !completed.has(creation.id) || !campaign) return undefined;
		const chosen = asString(context.start_scene), moduleId = asString(context.module_id);
		if (chosen && moduleId && !campaignOpening) {
			try {
				campaignOpening = asString(asRecord(await bridge.call('module.opening.choose', {module_id: moduleId, scene: chosen, campaign})).start_scene) ?? chosen;
				prepareOpeningInBackground(campaign,campaignOpening);
			} catch (error) {
				const code = errorCode(error) ?? 'internal', {fix, details} = actionable(error);
				const question = code === 'needs_choice' ? openingCandidates(details) : undefined;
				if (question) { openingQuestion = question; delete context.start_scene; }
				return withReason({ok: false, step: id, failed_on: 'module.opening.choose', code, message: errorText(error),
					...(fix ? {fix} : {}), ...(details ? {details} : {}), progress: progressLine(steps ?? [], state())}, startedAt);
			}
		}
		const blocked = setupBlock;
		if (!blocked || !guidanceBlock(blocked)) return undefined;
		try {
			const guidance = await ensureGuidance(signal);
			if (!guidance) return undefined;
			setupBlock = undefined;
			outcome.character_guidance = guidance;
			if (!prologueRecorded) {
				pi.sendMessage(await shownPrologue(guidance),{triggerTurn:false});
				outcome.opening_shown = 'The host has shown character_guidance.opening to the player word for word, right after this result. Do not repeat, retell or translate it; continue after it as the host.';
			}
			return undefined;
		} catch (error) {
			return {...guidanceFailure(error, blocked.kind, blocked.noticed, startedAt), step: id};
		}
	}

	/** A step is done: book it, update the source, and see whether it was the last one. */
	function settle(step: Step, outcome: Record<string, unknown>): void {
		completed.add(step.id);
		opCache.clear();
		// Producing the investigator settles that axis: the other lane's steps leave the table and
		// `complete`'s prerequisite on them counts as satisfied (§21.5). Only production counts —
		// browsing an empty library must leave the door to building a card open (#32).
		if (step.investigatorSource && step.receipt && axisProducts(steps ?? []).has(step.receipt)) {
			investigatorSource ??= step.investigatorSource;
		}
		const source = asRecord(outcome.source);
		if (Object.keys(source).length > 0) {
			context.source = source;
			sourceKind = asString(source.kind) ?? sourceKind;
			if (asString(source.module_id)) context.module = asString(source.module_id);
			if (asString(source.module_id)) context.module_id = asString(source.module_id);
			if (asString(source.pdf)) context.pdf = asString(source.pdf);
		}
		for (const [key, value] of Object.entries(outcome)) {
			if (key === "ok" || key === "step") continue;
			if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
				context[key] = value;
			} else {
				noteResult(asRecord(value));
			}
		}
		paint();
	}

	async function execute(raw: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
		const startedAt = Date.now();
		if (setupBlock && !remedyOpen(asString(raw.step))) return setupBlockRefusal(setupBlock, remedyStep());
		await ensureSteps();
		if (!steps) {
			return { ok: false, error: stepsError ?? "The setup table is not in hand yet." };
		}
		const id = asString(raw.step);
		// A note carries no order and is not a table step (contract §26): it fills a slot of the creation brief.
		if (id === 'note') {
			if (!bridge || !context.campaign || !completed.has('create-campaign')) return { ok: false, step: id, rejected: 'A note needs the campaign: run create-campaign first.' };
			if (!setupSlots.length) return { ok: false, step: id, rejected: 'No active setup package declares slots; there is nothing to note. Draft with create-investigator.' };
			const args = mergeArgs(raw);
			try {
				setupNotes = asRecord(await bridge.call('setup.note', { campaign: context.campaign, slot: args.slot, value: args.value, ...(args.origin !== undefined ? { origin: args.origin } : {}) })).notes as SetupNotes;
			} catch (error) {
				// The refusal names what was sent, so a slot the model misspelt is visible to it and in the record.
				const details = (error as { details?: unknown }).details;
				return { ok: false, step: id, code: errorCode(error), message: errorText(error), details: details && typeof details === 'object' ? {...(details as Record<string, unknown>), given: {slot: args.slot, origin: args.origin}} : details };
			}
			return { ok: true, step: id, notes: setupNotes, brief: renderBrief(setupSlots, setupNotes, guidedCap) };
		}
		// §98: the card is revised in place. `revise` merges words (`profile`), pins numbers
		// (`numbers`) and relaxes bounds (`limits`); `reroll` is the one call that rolls again;
		// `adjust` stays as the §92 spelling of a numbers-only revision. None is a table step: they
		// neither advance the order nor are done once, because the player may change the card as
		// often as they like before confirmation, and nothing here ever redraws it.
		if (id === 'revise' || id === 'adjust' || id === 'reroll') {
			if (!bridge || !context.campaign || draftRevision === undefined) return { ok: false, step: id, rejected: 'There is no card yet: draft one with create-investigator first.' };
			if (completed.has('confirm-investigator')) return { ok: false, step: id, rejected: 'The card is confirmed; it is no longer a draft.' };
			const args = mergeArgs(raw);
			try {
				const result = id === 'reroll'
					? asRecord(await bridge.call('setup.reroll', await bindInputParams({campaign: context.campaign, revision: draftRevision, keep_pins: args.keep_pins !== false, input_key: inputKey})))
					: asRecord(await bridge.call('setup.revise', await bindInputParams({campaign: context.campaign, revision: draftRevision, input_key: inputKey, by: 'model',
						...(args.profile !== undefined ? {profile: args.profile} : {}),
						...(id === 'adjust' ? (args.edits !== undefined ? {numbers: args.edits} : {}) : (args.numbers !== undefined ? {numbers: args.numbers} : {})),
						...(args.limits !== undefined ? {limits: args.limits} : args.limits_override !== undefined ? {limits: args.limits_override} : {}),
						...(args.auto_spread === true ? {auto_spread: true} : {})})));
				if (result.revision !== draftRevision) await presentDraft(bridge, result);
				return { ok: true, step: id, ...summarize(result) };
			} catch (error) {
				// A bound refusal is the answer, not a failure: its details name the field, the range and
				// the unlock that would admit the number, and that is what the player is told.
				const fix = (error as { fix?: unknown }).fix;
				return { ok: false, step: id, code: errorCode(error), message: errorText(error), ...(typeof fix === 'string' && fix ? {fix} : {}), details: (error as { details?: unknown }).details };
			}
		}
		// A second `create-investigator` with a card on the table is a revision of that card (§98):
		// the model's next sentence about the person, never a redraw of the numbers.
		if (id === 'create-investigator' && draftRevision !== undefined && !completed.has('confirm-investigator')) {
			const args = mergeArgs(raw);
			return execute({step: 'revise', ...(args.profile !== undefined ? {profile: args.profile} : {}), ...(args.numbers !== undefined ? {numbers: args.numbers} : args.edits !== undefined ? {numbers: args.edits} : {}), ...(args.limits !== undefined ? {limits: args.limits} : args.limits_override !== undefined ? {limits: args.limits_override} : {}), ...(args.auto_spread === true ? {auto_spread: true} : {})});
		}
		if (!id) {
			const next = nextStep(steps, state());
			return {
				ok: false,
				error: "step is required: which step to do this time.",
				next: instructionFor(next),
				allowed: allowedSteps(steps, state()).map((row) => row.id),
			};
		}
		// The remedy step is reopened for the gate (§98 addendum 9): its prerequisites and its source
		// still apply, and only "already done" is waived.
		const gated = remedyOpen(id) ? {...state(), completed: new Set([...completed].filter((done) => done !== id))} : state();
    const verdict = gate(steps, gated, id);
		if (!verdict.ok) {
			return { ok: false, step: id, rejected: verdict.reason, allowed: allowedSteps(steps, state()).map((row) => row.id) };
		}
		const step = verdict.step;
		const args = mergeArgs(raw);
		// The first draft waits for the brief (contract §26): while the move is a question, the card is refused the way the kernel refuses an incomplete profile.
		if (id === 'create-investigator' && setupSlots.length && draftRevision === undefined) {
			const move = computeMove(setupSlots, setupNotes, guidedCap);
			if (move.move === 'ask') return { ok: false, step: id, code: 'brief_incomplete', missing: move.missing, brief: renderBrief(setupSlots, setupNotes, guidedCap) };
		}
		if (step.ops.some((op) => op.method === 'campaign.create')) {
			const candidates = await unchosenOpenings();
			if (candidates) {
				openingQuestion = candidates;
				return withReason({ok: false, step: id, code: 'needs_choice', message: 'this book has more than one opening and none is recorded for this campaign yet',
					fix: `ask the player which opening to start from (details.candidates: name and summary), then call ${stepWithOp('module.prepare')?.id ?? 'the preparation step'} with that candidate's scene as start_scene; ${id} comes after it`,
					details: {field: 'start_scene', candidates}, progress: progressLine(steps, state())}, startedAt);
			}
		}
		// §14.19: the player's choice is recorded the moment the preparation step receives it, before any
		// reading runs, so a reading that outlasts this call keeps it and a later call may leave it out.
		const preparing = step.ops.some((op) => op.method === 'module.prepare');
		const chosen = preparing ? asString(args.start_scene) : undefined, previousChoice = context.start_scene;
		if (chosen) {
			context.start_scene = chosen;
			openingQuestion = undefined;
		}
		const outcome =
			step.kind === "ask"
				? await runAsk(step, args)
				: await runOps(step, args,signal);

		if (outcome.ok !== true) {
			const question = outcome.code === 'needs_choice' ? openingCandidates(outcome.details) : undefined;
			if (question) {
				const introduction=asString(asRecord(outcome.details).introduction);
				if(introduction&&asRecord(outcome.details).source_reference===true){
					pi.sendMessage({customType:'coc-setup-opening',content:introduction,display:true,details:{kind:'setup-opening'}},{triggerTurn:false});
					outcome.opening_shown='The host has shown details.introduction verbatim. Do not repeat or translate it; wait for the player to choose an opening.';
				}
				openingQuestion = question;
				// A scene the book does not offer is no choice: the one this call brought is not kept.
				if (chosen && context.start_scene === chosen) context.start_scene = previousChoice;
			}
			// A step that did not succeed is not booked: the same step can be tried again with the parameters the hint names.
			return withReason({ ...outcome, step: id, progress: progressLine(steps, state()) }, startedAt);
		}
		settle(step, outcome);
		if (preparing) {
			readingSince.clear();
			const refused = await afterPreparation(id, outcome, startedAt, signal);
			if (refused) return refused;
		}
    if(id==='create-campaign') {
      try {
        const guidance=await ensureGuidance(signal);
        if(guidance)outcome.character_guidance=guidance;
        // Sent while the turn runs, the opening lands right after this result and before the guide's
        // next step (§14.18); the guide only has to know it was shown.
        if(guidance && !prologueRecorded) {
          pi.sendMessage(await shownPrologue(guidance),{triggerTurn:false});
          outcome.opening_shown='The host has shown character_guidance.opening to the player word for word, right after this result. Do not repeat, retell or translate it; continue after it as the host.';
        }
        const created=asRecord(asRecord(outcome['campaign.create']).campaign);
        const boundCampaign=asString(created.id)??asString(context.campaign);
        const boundScene=asString(created.opening_scene)??campaignOpening??asString(context.start_scene)??guidance?.scene;
        if(boundCampaign&&boundScene)prepareOpeningInBackground(boundCampaign,boundScene);
      } catch(error) {return guidanceFailure(error,'guidance_at_create_campaign',false,startedAt);}
    }
		const next = nextStep(steps, state());
		const handedOff = next ? undefined : await finish();
		return {
			...Object.fromEntries(Object.entries(outcome).map(([key, value]) => [key, guideView(key, value)])),
			step: id,
			completed: [...completed],
			progress: progressLine(steps, state()),
			next: instructionFor(next),
			// The guide is told the host has handed off, never handed the command (§98 addendum 10).
			...(handedOff !== undefined ? { handoff_shown: handoffShown(handedOff) } : {}),
		};
	}

	/**
	 * No next step in the table: hand over the command that opens the table, and exit the process once
	 * this run has spoken (contract §14.4, step seven). The command is the host's to show, never the
	 * guide's to say (§98 addendum 10): true when this call showed the player the line itself.
	 */
	async function finish(): Promise<boolean> {
		const campaign = asString(context.campaign);
		handoff = campaign ? `bin/pi-coc --campaign ${campaign}` : "bin/pi-coc";
		const command = handoff;
		// The command itself is a command, so it is the same in every language; the sentence around
		// it is the campaign's (contract §23). A content root that cannot be read still owes the
		// person the command: the handoff is the way out of setup and must never be swallowed.
		let language = playLanguage();
		let line = command;
		try {
			language = await boundLanguage();
			line = (await speaking()).line("setup_complete", { command });
		} catch {
			/* the command alone, rather than nothing at all */
		}
		let shown = false;
		try {
			if(campaign && ctx)pi.appendEntry('coc-session',{campaign,home:cocHome(ctx.cwd),play_language:language,mode:'play'});
      pi.appendEntry("coc-setup-handoff", { campaign: campaign ?? null, command });
			if (ctx?.hasUI && process.env.PI_COC_SETUP_AUTOSTART!=='1') { ctx.ui.notify(line, "info"); shown = true; }
		} catch {
			/* failing to print the handoff must not block the exit */
		}
		return shown;
	}

	// ---- The driven setup run's port (contract §151.6) ----------------------

	/**
	 * The setup state the driven setup run reads (§151.6 Read): where the table stands, the kernel's catalog, the card
	 * on the table and the latest input. Read-only; the lists it issues are the only candidates the run's decisions
	 * choose from. The legacy engine never asks for it.
	 */
	async function setupRead(): Promise<Record<string, unknown>> {
		await ensureSteps();
		const table = steps ?? [];
		const id = (method: string) => stepWithOp(method)?.id;
		const ids = {choose: 'choose-source', prepare: id('module.prepare'), create: id('campaign.create'), draft: id('setup.draft'), confirm: id('setup.confirm'),
			browse: id('investigator.list'), load: id('investigator.load')};
		const done = (step: string | undefined) => !!step && completed.has(step);
		const created = done(ids.create);
		if (created) await loadCatalog();
		const draft = asRecord(context.draft);
		const era = asString(asRecord(draft.sheet).era);
		const card = draftRevision !== undefined && Object.keys(draft).length ? {revision: draftRevision, summary: summarize(draft), profile: asRecord(draft.profile), ...(era ? {era} : {})} : null;
		const confirmed = done(ids.confirm), loaded = done(ids.load);
		let sources: Array<Record<string, unknown>> = [];
		if (!done(ids.choose) && bridge) {
			const catalogue = await sourceCatalogue(), kinds = catalogue.kinds as string[];
			sources = [
				...(kinds.includes('starter') ? (catalogue.starters as string[]).map(module => ({kind: 'starter', module})) : []),
				...(kinds.includes('module') ? (catalogue.installed_modules as Array<Record<string, unknown>>).map(row => ({kind: 'module', module: asString(row.module_id) ?? asString(row.id), ...(asString(row.title) ? {title: asString(row.title)} : {})}))
					.filter(row => row.module && !(catalogue.starters as string[]).includes(String(row.module))) : []),
			];
		}
		let library: Array<Record<string, unknown>> = [];
		if (created && !card && !loaded && ids.load && investigatorSource !== 'new' && bridge) {
			try {
				const listed = asRecord(await bridge.call('investigator.list', {}));
				library = (Array.isArray(listed.investigators) ? listed.investigators : []).map(asRecord).filter(row => asString(row.library_id))
					.map(row => ({library_id: asString(row.library_id), ...(asString(row.name) ? {name: asString(row.name)} : {}), ...(asString(row.occupation) ? {occupation: asString(row.occupation)} : {})}));
			} catch { /* an unreadable library offers nothing to load */ }
		}
		const catalog = catalogRows ? {
			occupations: (Array.isArray(catalogRows.occupations) ? catalogRows.occupations : []).map(asRecord).filter(row => asString(row.id)).map(row => ({id: asString(row.id), ...(asString(row.label) ? {label: asString(row.label)} : {}),
				...(Array.isArray(row.skills) ? {skills: (row.skills as unknown[]).filter((name): name is string => typeof name === 'string')} : {})})),
			skills: (Array.isArray(catalogRows.skills) ? catalogRows.skills : []).map(asRecord).filter(row => asString(row.name)).map(row => ({name: asString(row.name), ...(asString(row.label) ? {label: asString(row.label)} : {}), ...(row.listed === false ? {listed: false} : {})})),
			characteristics: (Array.isArray(catalogRows.characteristics) ? catalogRows.characteristics : []).map(asRecord).filter(row => asString(row.abbr)).map(row => ({abbr: asString(row.abbr), ...(asString(row.name) ? {name: asString(row.name)} : {})})),
		} : null;
		return {
			ready: !!steps && !!bridge,
			blocked: setupBlock ? {kind: setupBlock.kind, ...(setupBlock.code ? {code: setupBlock.code} : {})} : null,
			complete: completed.has('complete'),
			campaign: asString(context.campaign) ?? null,
			created,
			next: steps ? nextStep(steps, state())?.id ?? null : null,
			allowed: steps ? allowedSteps(steps, state()).map(row => row.id) : [],
			completed: [...completed],
			source_kind: sourceKind ?? null,
			investigator_source: investigatorSource ?? null,
			steps: Object.fromEntries(Object.entries(ids).filter(([, value]) => value && table.some(row => row.id === value))),
			card, confirmed, loaded,
			brief_holds: setupSlots.length > 0 && draftRevision === undefined && computeMove(setupSlots, setupNotes, guidedCap).move === 'ask',
			sources,
			openings: openingQuestion ? openingQuestion.map(asRecord).filter(row => asString(row.scene)).map(row => ({scene: asString(row.scene),
				...(asString(row.name) ? {name: asString(row.name)} : {}), ...(asString(row.summary) ? {summary: asString(row.summary)} : {})})) : null,
			library,
			catalog,
			eras: Array.isArray(context.rulebook_eras) ? (context.rulebook_eras as unknown[]).filter((era): era is string => typeof era === 'string') : [],
			// Before the first card a field the player stated in an earlier message still counts: on Dust to Dust (2026-10-02)
			// the name came in one message and the trade in the next, and the guide asked for each again in turn.
			input: inputCatalog && inputKey ? {key: inputKey, text: lastPlayerInput, ...(!card && earlierInputs.length ? {earlier: earlierInputs.slice(-6)} : {})} : null,
			play_language: playLanguage() ?? null,
		};
	}

	/**
	 * The preparation and campaign steps the host runs itself once a source or an opening is chosen (§149's
	 * continuation, §151.6 decision 4): the preparation step when this source has one and it is still owed (or reopened
	 * as a remedy), then create-campaign with the bound language when the campaign id is known. Stops at the first
	 * result that did not go through and returns it.
	 */
	async function continueSource(args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
		let outcome: Record<string, unknown> = {ok: true};
		const preparation = stepWithOp('module.prepare');
		if (preparation && applies(preparation, state()) && (!completed.has(preparation.id) || remedyOpen(preparation.id))) {
			signal.throwIfAborted();
			outcome = await execute({step: preparation.id, ...args}, signal);
			if (outcome.ok !== true) return outcome;
		}
		const creation = stepWithOp('campaign.create');
		if (creation && context.campaign && !completed.has(creation.id)) {
			signal.throwIfAborted();
			outcome = await execute({step: creation.id, id: context.campaign, play_language: await boundLanguage()}, signal);
		}
		return outcome;
	}

	/** A cleared route move the host executes itself (§151.6 decision 4); each step goes through `execute`, never around it. */
	async function setupMove(move: string, target: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
		if (move === 'choose_source') {
			const chosen = await execute({step: 'choose-source', kind: target.kind, module: target.module}, signal);
			return chosen.ok === true ? continueSource({}, signal) : chosen;
		}
		if (move === 'pick_opening') {
			const preparation = stepWithOp('module.prepare');
			if (!preparation) return {ok: false, rejected: 'This setup table has no preparation step to record an opening on.'};
			return continueSource({start_scene: target.scene}, signal);
		}
		if (move === 'draft_now') {
			// §151.6 decision 10: the player ended the brief's questions. The brief's own record of that is its `stop`
			// note (§26), with the player's words as they wrote them; after it the brief allows the draft.
			return execute({step: 'note', slot: 'stop', value: lastPlayerInput.trim(), origin: 'player'}, signal);
		}
		if (move === 'load_library') {
			const browse = stepWithOp('investigator.list'), load = stepWithOp('investigator.load');
			if (!load) return {ok: false, rejected: 'This setup table has no library step.'};
			if (browse && !completed.has(browse.id)) {
				const browsed = await execute({step: browse.id}, signal);
				if (browsed.ok !== true) return browsed;
			}
			return execute({step: load.id, library_id: target.library_id}, signal);
		}
		return {ok: false, rejected: `The host executes no setup move named ${move}.`};
	}

	/** The player's own words for a field, copied from an issued input selection (§151.6 decision 2). */
	async function copyInput(selection: unknown): Promise<string> {
		if (!inputCatalog) throw new Error('Current setup input sources are unavailable');
		return copySetupInputSelection(inputCatalog, {campaign: String(context.campaign ?? ''), inputKey, selection});
	}

	// ---- The tool ---------------------------------------------------------

  const inputSelection=Type.Object({source:Type.String({description:'Choose a current issued input alias; never copy source text or offsets'}),
    range:Type.Optional(Type.Object({first:Type.String({description:'First issued grapheme unit alias, inclusive'}),last:Type.String({description:'Last issued grapheme unit alias, inclusive'})},{additionalProperties:false}))},{additionalProperties:false});
  const profileSchema=Type.Object({name:Type.Optional(Type.Union([inputSelection,Type.Object({generated:Type.String({minLength:1,description:'A newly proposed name, never claimed as the player wording'})},{additionalProperties:false})],
    {description:'Select the player-supplied name, or explicitly propose generated. Omit unchanged name on revisions.'}))},{additionalProperties:true,description:'The semantic profile, or only changed fields. Name uses the current setup input source catalog.'});
	pi.registerTool({
		name: "setup",
		label: "Setup",
		description:
			"The one action from nothing to an open table. `step` is which step to do this time, and the other parameters are what the previous result's next asked for " +
			"(they may also be packed into `params`). The step table, its order, its prerequisites and the parameters of each step are the kernel's call: " +
			"if you do not know what to write on the first call, give any step (start, say) and the result will tell you the table's first step. " +
			"Every return carries next (the next step and its parameters) and progress; a call that did not succeed carries rejected or needs, " +
			"so change what it says to change and do not resend unchanged. " +
			"While an active setup package declares slots, `step: note` with `slot`, `value` (the player's words) and optional `origin` (player|concept) records one answer of the creation brief; the result carries the brief and the one move it allows. " +
			"`step: revise` changes the card on the table in place, as often as the player asks: `profile` with only the changed fields (words: equipment, backstory, weapons, skill lists, age, name) moves no number; `numbers` {characteristics?, skills?, credit_rating?} pins the numbers the player wants (each value is the final value; a pinned number stays until the player changes it); `limits` {characteristic_min?, characteristic_max?, skill_cap?, occupation_points?, interest_points?} relaxes exactly those bounds when the player asks to play outside them; `auto_spread: true` spends whatever points are left. A refusal names the field and, for a number past a bound, the `unlock` that would admit it. " +
			"`step: reroll` is the only call that rolls the dice again (pins stay). Nothing here redraws the card: create-investigator is called once, and with a card on the table it is the same as revise.",
		promptSnippet: "The one setup tool: walk the kernel's seven-step table, one step at a time.",
		// Every parameter a step can take is declared here by name (§98): a live table on grok-4.6
		// sent `slot: true, value: null` three to five times per turn while only `step` and `params`
		// were declared -- the provider filled undeclared keys with booleans and nulls -- and each
		// of those was a refused call before the one that nested the same fields under `params`.
		parameters: Type.Object(
			{
				step: Type.String({ description: "which step to do this time; step names come from the kernel's setup table, and the previous result's next holds it" }),
				params: Type.Optional(
					Type.Object({profile:Type.Optional(profileSchema),pending_action:Type.Optional(inputSelection)}, { additionalProperties: true, description: "the parameters this step wants; they may also be spread at the top level" }),
				),
				slot: Type.Optional(Type.String({ description: "note: the creation-brief slot this answer fills, or stop" })),
				value: Type.Optional(Type.String({ description: "note: the player's words for that slot" })),
				origin: Type.Optional(Type.String({ description: "note: player or concept" })),
				profile: Type.Optional(profileSchema),
				numbers: Type.Optional(Type.Object({}, { additionalProperties: true, description: "revise: {characteristics?, skills?, credit_rating?} pinned as final values" })),
				limits: Type.Optional(Type.Object({}, { additionalProperties: true, description: "revise: relaxed bounds {characteristic_min?, characteristic_max?, skill_cap?, occupation_points?, interest_points?}" })),
				edits: Type.Optional(Type.Object({}, { additionalProperties: true, description: "adjust (older spelling of revise numbers)" })),
				auto_spread: Type.Optional(Type.Boolean({ description: "revise: spend whatever points are left" })),
				keep_pins: Type.Optional(Type.Boolean({ description: "reroll: keep the pinned numbers (default true)" })),
				consent: Type.Optional(Type.String({ description: "confirm-investigator: approved or delegated" })),
				pending_action: Type.Optional(inputSelection),
				kind: Type.Optional(Type.String({ description: "choose-source: starter, module or pdf" })),
				module: Type.Optional(Type.String({ description: "choose-source: the starter or module id" })),
				pdf: Type.Optional(Type.String({ description: "choose-source: the original PDF path" })),
				id: Type.Optional(Type.String({ description: "create-campaign: the campaign id" })),
				title: Type.Optional(Type.String({ description: "create-campaign: the campaign title" })),
				play_language: Type.Optional(Type.String({ description: "create-campaign: the play language tag" })),
			},
			{ additionalProperties: true },
		),
		executionMode: "sequential",
		execute: async (_toolCallId, params, signal) => {
			const result = await execute(asRecord(params), signal);
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	});

  pi.on('message_end', event=>{
    // Only a guidance failure suppresses the Keeper's text (§23.4's "invented fallback prose"); a
    // failed package read blocks with a notice (§26) and the Keeper may explain it to the player.
    if(setupBlock && setupBlockHidesText(setupBlock) && event.message.role==='assistant')return {message:{...event.message,content:event.message.content.filter((part:any)=>part.type!=='text')}};
  });
	// ---- Lifecycle --------------------------------------------------------
  pi.on('before_agent_start',async(event)=>{
    lastPlayerInput=event.prompt;inputKey=randomUUID();setupBlock=undefined;
    await ensureSteps();freezeInputSources(event.prompt);
    const inputPrompt='\n\nSetup input source selection (setup-input-reference-v1): profile.name selects {source,range?:{first,last}} or proposes {generated:newName}. Omit unchanged names when revising. pending_action selects only an actual player request; no generated form or copied string is permitted. This catalog covers user text fields only, not image or attached-file content. Unit aliases are inclusive grapheme endpoints, never character offsets. Coverage omissions mean missing input is unavailable, not absent; preserve an existing draft name and ask for a repeated request when its source is needed. Never copy epochs, digests or message IDs.\n'+JSON.stringify(inputCatalog!.public);
    // The frontend's confirm button commits the draft and completes setup on a cold kernel before
    // it sends its ordinary closing sentence (§98). A fresh setup process resumes with `complete`
    // already booked; a live one learns it here from the kernel. Either way there is no world yet:
    // asking `mods.context` at that point takes the play-only branch and fails because `table.open`
    // has not created the world, and that failure used to block the turn as a guidance failure and
    // strand the table (installed build e1b4176d3, 2026-09-23). Finish the existing handoff first;
    // the agent only owes the short prologue close, and agent_end will let the wrapper replace this
    // setup child with the play child.
    await refreshCompleted();
    // Every reply below is read by the player, the blocked and closing ones included (§14.17).
    let base=event.systemPrompt+tableLanguage();
    if(completed.has('complete')) {
      await finish();
      return {systemPrompt:base+'\nSetup is already complete. Do not call setup or continue character creation. Close the prologue briefly; the host will open the table.'};
    }
    if(!completed.has('choose-source')&&ctx&&bridge&&reading&&context.campaign){
      const preparationSignal=ctx.signal?AbortSignal.any([ctx.signal,guidanceAbort.signal]):guidanceAbort.signal;
      let outcome:Record<string,unknown>|undefined;
      const pdf=await selectSetupSource({text:event.prompt,language:await boundLanguage(),signal:preparationSignal});
      if(pdf){
        preparationSignal.throwIfAborted();
        const chosen=outcome=await execute({step:'choose-source',kind:'pdf',pdf},preparationSignal);
        if(chosen.ok===true){
          preparationSignal.throwIfAborted();
          const preparation=stepWithOp('module.prepare');
          const prepared=outcome=preparation?await execute({step:preparation.id,pdf},preparationSignal):undefined;
          if(prepared?.ok===true){preparationSignal.throwIfAborted();const creation=stepWithOp('campaign.create');if(creation)outcome=await execute({step:creation.id,id:context.campaign,play_language:await boundLanguage()},preparationSignal);}
        }
      }
      if(outcome){const progress={completed:[...completed],next:steps?nextStep(steps,state())?.id:undefined,...(typeof outcome.opening_shown==='string'?{opening_shown:outcome.opening_shown}:{}),...(outcome.ok!==true?{code:outcome.code,details:outcome.details,message:outcome.message}: {})};
        pi.appendEntry('coc-setup-preflight',progress);base+='\nHost source preparation already performed these setup steps; continue from next without repeating them. '+JSON.stringify(progress);}
    }
    let guidance: Guidance | undefined;
    // The campaign id may be known before the campaign exists (PI_COC_CAMPAIGN); preparing guidance for a campaign that a
    // rejected create-campaign never made throws, and that used to poison every later turn with a guidance refusal.
    // Guidance is prepared by the create-campaign step itself and, on later turns, only once that step has run.
    const guidanceFailed=async(error:unknown)=>{
      // What the player is told is the campaign's sentence; the English message the preparation
      // threw stays in it as the detail, which is what a log and a bug report need (contract §23).
      const detail=errorText(error),code=errorCode(error),{fix,details}=actionable(error);
      setupBlock={kind:'guidance_at_turn_start',...(code?{code}:{}),detail,...(fix?{fix}:{}),...(details?{details}:{}),noticed:true};
      const question=code==='needs_choice'?openingCandidates(details):undefined;
      if(question) {
        // §14.19: a missing opening is the guide's question, not a failure: no error notice, the guide's
        // text stays on screen, and the step that records the answer stays open (§98 addendum 9).
        openingQuestion=question;
		return {systemPrompt:base+'\nThis book has more than one opening and this campaign has none recorded yet. Ask the player which one to start from, naming each by its name and what it is about (the list below). When they answer, call setup '+(remedyStep()??'prepare-module')+' with the exact chosen candidate.scene handle as start_scene: it records the choice and prepares the module guidance. Do not translate that handle. Until then do not invent a prologue or create an investigator.\nOpenings: '+JSON.stringify(question)};
      }
      try {ctx?.ui.notify((await speaking()).line('setup_guidance_failed',{detail}),'error');}
      catch {ctx?.ui.notify(detail,'error');}
      return {systemPrompt:base+'\nModule guidance is unavailable. Do not invent a prologue, create an investigator or continue setup.'};
    };
    try {guidance=completed.has('create-campaign')||characterGuidance?await ensureGuidance():undefined;}
    catch(error) {return await guidanceFailed(error);}
    // Setup packages (contract §26): what the campaign's enabled Mods have to say about creation, refreshed every turn so a panel toggle lands on the next reply.
    // Consulted whether or not module guidance exists: a package speaks to setup, not to the prologue.
    let setupPackages='';
    // The id may be known before the campaign exists (PI_COC_CAMPAIGN); ask only once create-campaign has actually run, here or in an earlier session.
    if(bridge && context.campaign && completed.has('create-campaign')) {
      try {
        const mods=asRecord(await bridge.call('mods.context',{campaign:context.campaign}));
        const setup=Array.isArray(mods.setup)?mods.setup as Array<Record<string,unknown>>:[];
        if(setup.length)setupPackages='\n\nActive setup packages ('+setup.map(entry=>String(entry.mod)).join(', ')+'). Their instructions below extend the core setup policy for this campaign:'+
          setup.map(entry=>'\n\n['+String(entry.mod)+' '+String(entry.version)+'] settings: '+JSON.stringify(entry.settings??{})+'\n'+String(entry.instruction)).join('');
        setupSlots=Array.isArray(mods.slots)?mods.slots as SetupSlot[]:[];
        const caps=setup.map(entry=>Number(asRecord(entry.settings).max_guided_turns)).filter(n=>Number.isInteger(n)&&n>0);
        guidedCap=caps.length?Math.max(...caps):3;
        // The brief: the exchange is open once a note exists and no draft does; each player turn then counts one guiding turn.
        if(setupSlots.length && draftRevision===undefined) {
          if(setupNotes && Object.keys(setupNotes.slots).length) setupNotes=asRecord(await bridge.call('setup.note',{campaign:context.campaign,advance:true})).notes as SetupNotes;
          setupPackages+='\n\n'+renderBrief(setupSlots,setupNotes,guidedCap);
        }
      } catch(error) {
        const detail=errorText(error);
        setupBlock={kind:'package_context',code:errorCode(error),detail,noticed:true};
        try {ctx?.ui.notify((await speaking()).line('setup_packages_failed',{detail}),'error');}
        catch {ctx?.ui.notify(detail,'error');}
        return {systemPrompt:base+'\nThe setup package context is unavailable. Do not draft or continue setup until it is restored.'};
      }
    }
    // The catalog (§98): every trade, skill and printed weapon with the play language's label, once,
    // so the model writes names the kernel accepts instead of guessing at them refusal by refusal.
    await loadCatalog();
    if(!guidance)return {systemPrompt:base+setupPackages+catalogText+inputPrompt};
    if(context.campaign&&!completed.has('complete'))prepareOpeningInBackground(String(context.campaign),campaignOpening??asString(context.start_scene)??guidance.scene);
    // A terminal or driver setup shows the opening on its first turn, right after the player's first
    // line (§14.18): the App showed it at session start, and a campaign created in this process right
    // after create-campaign. Shown last, once nothing else can still block this turn; a draft on the
    // table means the meeting is long past.
    let shown: Awaited<ReturnType<typeof shownPrologue>> | undefined;
    if(!prologueRecorded && draftRevision===undefined) {
      try {shown=await shownPrologue(guidance);}
      catch(error) {return await guidanceFailed(error);}
    }
    return {...(shown?{message:shown}:{}),systemPrompt:base+'\n\nPrepared module prologue ('+(prologueRecorded?'the host has shown it to the player word for word; never repeat, retell or translate it, and continue after it as the host':'context for the meeting already under way; do not narrate it')+'):\n'+guidance.opening+
      '\n\nModule-specific setup advice:\n'+guidance.advice+
      '\nBefore inviting card confirmation, compare the draft with this source-backed setup advice. If the draft differs on a consequential point, tell the player one concise advice or warning in the play language, then allow their chosen card to be confirmed. Do not silently edit, reroll or refuse a card to enforce module advice.\n'+
      '\nThe player\'s stated strengths and weaknesses outrank module suggestions in card allocation. Do not put a skill the player explicitly called ordinary, weak or not a strength into occupation_skills or interest_skills merely to satisfy scenario advice. After setup.draft, compare the computed card with those player statements; if it silently raised a rejected skill, use revise before inviting confirmation. If the desired numeric level remains unclear, tell the player what the card actually shows and let them choose.\n'+
      '\nBefore create-investigator, briefly explain useful or explicitly required languages from this advice or the public opening, and how lacking them can hinder conversation or reading. Distinguish authored requirements from contextual recommendations; do not invent a requirement or expose a secret. The display language is not a character skill. After drafting or a relevant revision, compare the actual own_language and Language skills and mention any material difficulty before inviting confirmation. This is a notice, not an extra question or confirmation gate: preserve chosen limitations and never change language skills merely to remove a warning. Only a player request, accepted suggestion or explicit delegation authorizes changing those choices.'+
      '\nThe rulebook tabulates these finance periods: '+JSON.stringify(context.rulebook_eras||[])+'. The authored setting can be descriptive prose or a year the rulebook never tabulated; never copy it as a table key. Pass profile.era only to name the listed period that reads closest to that setting. Omit it and the table\'s own period stands in. Either way the draft comes back with the period used and the setting it stood in for on sheet.finance, and setup is never blocked on this: say it once to the player in their own words (which setting, which period stood in for it) and carry on.'+
      '\nAs soon as a name and an occupation concept are known, use setup create-investigator once with a complete structured profile in that reply, unless an active setup package below asks for an exchange first. Propose rather than ask whatever you can: the way into the opening, personal ties and the key connection, age, ordinary gear. Do not merely describe a character: the computed card must appear before approval. After that every change the player asks for is one `revise` call with only what changed: words in profile, numbers in numbers. Never call create-investigator again to change something. Use confirm-investigator only after approval or explicit write-now delegation.'+
      '\nBoth skill lists are priority ordered: the points walk each list from the front, so put the abilities the player called defining first. Read the returned card and describe what it holds, never what you hoped it would hold; a number the player wants different is one `revise` with numbers.'+
      setupPackages+catalogText+inputPrompt+
      (process.env.PI_COC_SETUP_AUTOSTART==='1'?'\nThis is the frontend. The card on screen shows the final values, a calculation-details toggle, the point budgets, and a "Confirm and open the table" button the player can press instead of answering; they may also confirm in words. Keep the accompanying prose brief: identity, edition/method, any material language difficulty, and one invitation to confirm or change. Do not automatically repeat calculations or budgets. After complete, close the prologue without a launch command; the host hands off to play.':'')};
  });

	// The kernel extension emits the bridge in session_start; this subscribes at load time, so both load orders are caught.
	pi.events.on("coc:kernel-bridge", (data) => {
		const payload = asRecord(data) as { call?: KernelCall; hello?: Record<string, unknown>; campaign?: string; runtime?: HostRuntime };
		bridge = typeof payload.call === "function" ? { call: payload.call, runtime:payload.runtime, ...(payload.hello ? { hello: asRecord(payload.hello) } : {}) } : undefined;
		if (payload.campaign && context.campaign === undefined) context.campaign = payload.campaign;
	});

	pi.on("session_start", async (_event, sessionCtx) => {
		ctx = sessionCtx;
        inputCatalog=undefined;inputKey="";lastPlayerInput="";inputOrdinal=0;earlierInputs=[];
		steps = undefined;
		completed.clear();
		opCache.clear();
		sourceKind = undefined;
		investigatorSource = undefined;
		handoff = undefined;
		const campaign = process.env.PI_COC_CAMPAIGN?.trim();
		if (campaign) context.campaign = campaign;
		// The setup process's tool surface is only this one (contract §14.4).
		pi.setActiveTools(["setup"]);
		// §151.6: the same step executor, for the driven setup run. Only that engine listens; legacy never does.
		pi.events.emit("coc:setup-executor", {tool: "setup", execute: (raw: Record<string, unknown>, signal?: AbortSignal) => execute(raw, signal),
			read: () => setupRead(), move: (move: string, target: Record<string, unknown>, signal: AbortSignal) => setupMove(move, target, signal),
			copy: (selection: unknown) => copyInput(selection)});
		// When the kernel extension loaded first the bridge is already here and the table is fetched now; when it comes later, the first tool call fetches it.
		if (bridge) await ensureSteps();
		paint();
    invokeDisposers=registerInvokeHandlers('coc-keeper',{'setup-handoff':async()=>{
      if(completing||!ctx?.isIdle()||!bridge)return {waiting:true};
      completing=true;
      try {
        const snapshot=asRecord(await bridge.call('setup.steps',{campaign:context.campaign}));
        // Two ways here: an opening the card waited for is now ready, or the card's button already completed setup
        // on the cold kernel. The second used to need a guide turn to notice it; that turn spoke to nobody.
        const done=Array.isArray(snapshot.completed)&&snapshot.completed.includes('complete');
        if(!asRecord(snapshot.state).waiting_for_opening&&!done)return {waiting:false};
        await bridge.call('setup.complete',{campaign:context.campaign});
        completed.add('complete');await finish();
        pi.appendEntry('coc-setup-exit',{command:handoff});
        ctx.shutdown();
        return {completed:true};
      }catch(error){return {waiting:true,code:errorCode(error)};}
      finally{completing=false;}
    }});
    const hasDialogue=ctx.sessionManager.getBranch().some((entry:any)=>(entry.type==='message' && ['user','assistant'].includes(entry.message?.role)) || (entry.type==='custom_message'&&entry.customType==='coc-setup-opening'));
    if(process.env.PI_COC_SETUP_AUTOSTART==='1' && campaign && !hasDialogue && !completed.has('complete')) {
      const guidance=await ensureGuidance();
      if(!guidance)throw new Error('The prepared module guidance is unavailable');
      pi.sendMessage(await shownPrologue(guidance),{triggerTurn:false});
    }
    if (ctx.hasUI && steps && process.env.PI_COC_SETUP_AUTOSTART!=='1') {
			// The player is told how long the table is and which step is next. The step's own
			// instruction sentence is not repeated here: that one is written for the model and stays
			// English (contract §16.1), while this line is the player's and comes from the surface.
			// With no next step the table is already done and `finish` says so; this line would only
			// name a step that is not there.
			const next = nextStep(steps, state());
			try {
				if (next) ctx.ui.notify((await speaking()).line("setup_opened", { total: steps.length, step: next.id }), "info");
			} catch {
				/* one opening line must not stop the session from starting */
			}
		}
	});

	// After the last step, wait for this run to say the handoff out loud before exiting (contract §14.4: the process exits and prints the command that opens the table).
	pi.on("agent_end", async () => {
    if(setupBlock){
      // A turn-start cause was announced as it blocked; the create-campaign cause is announced
      // here, once, in the words of its own failure: a review that needs another preparation
      // (`preparation_failed`) or anything else with its detail. The package cause is never
      // named as a guidance review, because it is not one.
      // A missing opening is a question the guide asked in its own reply (§14.19), not a failure to announce.
      if(!setupBlock.noticed && setupBlock.code!=='needs_choice'){
        const block=setupBlock;
        block.noticed=true;
        try {
          const words=await speaking();
          ctx?.ui.notify(block.kind==='package_context' ? words.line('setup_packages_failed',{detail:block.detail})
            : block.code==='preparation_failed' ? words.word('setup_guidance_review_failed')
            : words.line('setup_guidance_failed',{detail:block.detail}),'error');
        }
        catch {/* an unreadable content root must not swallow the agent_end handler */}
      }
      return;
    }
		if (!handoff) return;
		const command = handoff;
		handoff = undefined;
		try {
			ctx?.shutdown();
			pi.appendEntry("coc-setup-exit", { command });
		} catch {
			/* failing to exit must not throw either: the command has already been printed */
		}
	});

	pi.on("session_shutdown", async () => {
		for(const dispose of invokeDisposers)dispose();invokeDisposers=[];
		guidanceAbort.abort();
    ctx = undefined;
		bridge = undefined;
	});
}
