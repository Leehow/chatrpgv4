/** Setup ordering comes from setup.steps; source preparation uses the shared visual reader. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { prepareCharacterGuidance, acceptedGuidance, type Guidance } from '../module/character-guidance.ts';
import { registerInvokeHandlers } from '../../pipicoc/host-bridge.ts';
import { Type } from "typebox";
import { cocHome, cocMode } from "../lanes/host.ts";
import {
	allowedSteps,
	gate,
	type GateState,
	instructionFor,
	nextStep,
	axisProducts,
	declaredSources,
	normalizeSteps,
	type OpSpec,
	progressLine,
	sourceKinds,
	type Step,
} from "./steps.ts";

type KernelCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** The code of a kernel error envelope is read structurally: instanceof is unreliable across extensions (two module instances). */
function errorCode(error: unknown): string | undefined {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : undefined;
}

function errorText(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).slice(0, 400);
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
 * the `module.*` calls of §14.3 are addressed by module id (several campaigns share one module) and carry no campaign.
 * When the table does not name `campaign`, fill it in by this rule rather than guessing from the method name.
 */
function wantsCampaign(method: string): boolean {
	return method.startsWith("setup.") || method.startsWith("table.");
}

export default function (pi: ExtensionAPI) {
	// In the play process this extension registers nothing (contract §14.4).
	if (cocMode() !== "setup") return;

	let ctx: ExtensionContext | undefined;
	let reading: { prepare(params: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> } | undefined;
	pi.events.on("coc:reading-bridge", value => { reading = value && typeof (value as any).prepare === "function" ? value as any : undefined; });
	let bridge: { call: KernelCall; hello?: Record<string, unknown> } | undefined;
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
  let guidanceBlocked = false;
  let guidancePending: Promise<Guidance | undefined> | undefined;
  const guidanceAbort = new AbortController();
  let invokeDisposers:Array<()=>void>=[];
  let completing=false;
  async function ensureGuidance(): Promise<Guidance | undefined> {
    if(characterGuidance)return characterGuidance;
    if(guidancePending)return guidancePending;
    const moduleId=asString(context.module_id);
    if(!ctx || !bridge || !moduleId || !/^[a-z0-9-]{1,64}$/.test(moduleId) || !context.campaign)return;
    const home=cocHome(ctx.cwd);
    if(!existsSync(join(home,'.coc/modules',moduleId,'module.json')))return;
    guidancePending=(async()=>{
      if(typeof context.guidance_key==='string') {
        characterGuidance=await acceptedGuidance(home,moduleId,context.guidance_key);
        return characterGuidance;
      }
      const occupations=asRecord(await bridge!.call('setup.occupations',{})).occupations as any[];
      characterGuidance=await prepareCharacterGuidance({home,module_id:moduleId,
        opening:asString(context.start_scene),
        play_language:asString(context.play_language)||'zh-Hans',occupations,
        model:ctx?.model ? ctx.model.provider+'/'+ctx.model.id : undefined,
        thinking:pi.getThinkingLevel(),signal:guidanceAbort.signal});
      return characterGuidance;
    })().finally(()=>{guidancePending=undefined;});
    return guidancePending;
  }

	function state(): GateState {
		return {
			completed,
			...(sourceKind ? { sourceKind } : {}),
			...(investigatorSource ? { investigatorSource } : {}),
		};
	}

	function paint(): void {
		try {
			if (!ctx?.hasUI || !steps) return;
			ctx.ui.setStatus("coc-setup", progressLine(steps, state()));
		} catch {
			/* the status line must not break a step */
		}
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
			for (const done of Array.isArray(result.completed) ? result.completed : []) {
				const id = asString(done);
				if (!id) continue;
				completed.add(id);
				// A resumed setup that already took one investigator lane keeps that axis settled.
				const row = rows.find((step) => step.id === id);
				if (row?.investigatorSource && row.receipt && axisProducts(rows).has(row.receipt)) {
					investigatorSource ??= row.investigatorSource;
				}
			}
			const carried = asRecord(result.state);
			for (const [key, value] of Object.entries(carried)) {
				if (context[key] === undefined) context[key] = value;
			}
			const restoredDraft=asRecord(carried.draft);
      if(typeof restoredDraft.revision==='number')draftRevision=restoredDraft.revision;
      prologueRecorded=!!carried.prologue;
      const carriedSource = asRecord(carried.source);
			sourceKind = asString(carried.source_kind) ?? asString(carriedSource.kind) ?? sourceKind;
		} catch (error) {
			stepsError = `setup.steps did not come back: ${errorCode(error) ?? "internal"}: ${errorText(error)}`;
		}
	}

	async function ensureSteps(): Promise<void> {
		if (steps) return;
		loading ??= loadSteps().finally(() => {
			loading = undefined;
		});
		await loading;
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
    const language = asString(asRecord(result.campaign).play_language) ?? asString(context.play_language);
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

	// ---- One step ---------------------------------------------------------

	/** Run this step's ops in table order; a missing parameter stops it there and hands the results so far to the model to fill in. */
	async function runOps(step: Step, args: Record<string, unknown>): Promise<Record<string, unknown>> {
		const current = bridge;
		if (!current) return { ok: false, step: step.id, rejected: "The kernel bridge is gone, so this step cannot run." };
		const results: Record<string, unknown> = {};
		for (const [index, op] of step.ops.entries()) {
			const cacheKey = `${step.id}\u0000${op.method}`;
			if (opCache.has(cacheKey)) {
				results[op.method] = opCache.get(cacheKey);
				continue;
			}
			const filled = fillParams(op, args, index === 0);
      if(op.method==='setup.draft'||op.method==='setup.confirm')filled.params.input_key=inputKey;
      if(op.method==='setup.confirm') {filled.params.revision=draftRevision;filled.params.last_exchange=lastPlayerInput;filled.params.player_requests=ctx?.sessionManager.getBranch().filter((e:any)=>e.type==='message'&&e.message?.role==='user').map((e:any)=>Array.isArray(e.message.content)?e.message.content.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('\n'):typeof e.message.content==='string'?e.message.content:'')||[];}
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
				const result =
					op.method === "module.prepare"
						? await (reading ? reading.prepare(filled.params) : Promise.reject(new Error("the reading service is unavailable")))
						: asRecord(await current.call(op.method, filled.params));
				if (result.ok === false) return { ...result, step: step.id, results };
				if(op.method==='setup.draft') {
          draftRevision=result.revision as number;
          context.draft=result;
          const payload={...result,play_language:context.play_language||'zh-Hans'};
          pi.appendEntry('coc-character-draft',payload);
          if(process.env.PI_COC_SETUP_AUTOSTART!=='1') {
            pi.sendMessage({customType:'coc-character-preview',content:JSON.stringify(result.sheet),display:true});
            await current.call('setup.previewed',{campaign:context.campaign,revision:draftRevision});
          }
        }
        results[op.method] = result;
        opCache.set(cacheKey, result);
				noteResult(result);
			} catch (error) {
				// The kernel's `fix` and `details` are the only actionable part of a refusal
				// (contract §1) and they must survive this projection: dropping them is what made
				// the setup model try play_language "zh", then "zh-CN", then give up on the
				// parameter altogether while the kernel had been naming zh-Hans and en all along (#33).
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

	async function execute(raw: Record<string, unknown>): Promise<Record<string, unknown>> {
    if(guidanceBlocked)return {ok:false,error:"Guidance review did not pass. Wait for a new player input to retry; do not invent a setup scene or create a card."};
		await ensureSteps();
		if (!steps) {
			return { ok: false, error: stepsError ?? "The setup table is not in hand yet." };
		}
		const id = asString(raw.step);
		if (!id) {
			const next = nextStep(steps, state());
			return {
				ok: false,
				error: "step is required: which step to do this time.",
				next: instructionFor(next),
				allowed: allowedSteps(steps, state()).map((row) => row.id),
			};
		}
		if(id==='create-investigator' && !completed.has('confirm-investigator')) {completed.delete('create-investigator');opCache.clear();}
    const verdict = gate(steps, state(), id);
		if (!verdict.ok) {
			return { ok: false, step: id, rejected: verdict.reason, allowed: allowedSteps(steps, state()).map((row) => row.id) };
		}
		const step = verdict.step;
		const args = mergeArgs(raw);
		const outcome =
			step.kind === "ask"
				? await runAsk(step, args)
				: await runOps(step, args);

		if (outcome.ok !== true) {
			// A step that did not succeed is not booked: the same step can be tried again with the parameters the hint names.
			return { ...outcome, step: id, progress: progressLine(steps, state()) };
		}
		settle(step, outcome);
    if(id==='create-campaign') {
      try {
        const guidance=await ensureGuidance();
        if(guidance)outcome.character_guidance=guidance;
      } catch(error) {guidanceBlocked=true;return {ok:false,code:'guidance_failed',message:errorText(error)};}
    }
		const next = nextStep(steps, state());
		if (!next) finish();
		return {
			...Object.fromEntries(Object.entries(outcome).map(([key,value])=>[key,key==='setup.draft'||key==='setup.confirm'?{...asRecord(value),revision:undefined,labels:undefined,sheet:{...asRecord(asRecord(value).sheet),id:undefined,creation:{...asRecord(asRecord(asRecord(value).sheet).creation),seed:undefined,equipment:undefined}}}:value])),
			step: id,
			completed: [...completed],
			progress: progressLine(steps, state()),
			next: instructionFor(next),
			...(handoff ? { handoff_command: handoff } : {}),
		};
	}

	/** No next step in the table: hand over the command that opens the table, and exit the process once this run has spoken (contract §14.4, step seven). */
	function finish(): void {
		const campaign = asString(context.campaign);
		handoff = campaign ? `bin/pi-coc --campaign ${campaign}` : "bin/pi-coc";
		const line = `Setup complete. Open the table with: ${handoff}`;
		try {
			if(campaign && ctx)pi.appendEntry('coc-session',{campaign,home:cocHome(ctx.cwd),play_language:context.play_language||'zh-Hans',mode:'play'});
      pi.appendEntry("coc-setup-handoff", { campaign: campaign ?? null, command: handoff });
			if (ctx?.hasUI && process.env.PI_COC_SETUP_AUTOSTART!=='1') ctx.ui.notify(line, "info");
		} catch {
			/* failing to print the handoff must not block the exit */
		}
	}

	// ---- The tool ---------------------------------------------------------

	pi.registerTool({
		name: "setup",
		label: "Setup",
		description:
			"The one action from nothing to an open table. `step` is which step to do this time, and the other parameters are what the previous result's next asked for " +
			"(they may also be packed into `params`). The step table, its order, its prerequisites and the parameters of each step are the kernel's call: " +
			"if you do not know what to write on the first call, give any step (start, say) and the result will tell you the table's first step. " +
			"Every return carries next (the next step and its parameters) and progress; a call that did not succeed carries rejected or needs, " +
			"so change what it says to change and do not resend unchanged.",
		promptSnippet: "The one setup tool: walk the kernel's seven-step table, one step at a time.",
		parameters: Type.Object(
			{
				step: Type.String({ description: "which step to do this time; step names come from the kernel's setup table, and the previous result's next holds it" }),
				params: Type.Optional(
					Type.Object({}, { additionalProperties: true, description: "the parameters this step wants; they may also be spread at the top level" }),
				),
			},
			{ additionalProperties: true },
		),
		executionMode: "sequential",
		execute: async (_toolCallId, params) => {
			const result = await execute(asRecord(params));
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	});

  pi.on('message_end', event=>{
    if(guidanceBlocked && event.message.role==='assistant')return {message:{...event.message,content:event.message.content.filter((part:any)=>part.type!=='text')}};
  });
	// ---- Lifecycle --------------------------------------------------------
  pi.on('before_agent_start',async(event)=>{
    lastPlayerInput=event.prompt;inputKey=randomUUID();guidanceBlocked=false;
    await ensureSteps();
    let guidance: Guidance | undefined;
    try {guidance=await ensureGuidance();}
    catch(error) {guidanceBlocked=true;ctx?.ui.notify(errorText(error),'error');return {systemPrompt:event.systemPrompt+'\nModule guidance is unavailable. Do not invent a prologue, create an investigator or continue setup.'};}
    if(!guidance)return;
    return {systemPrompt:event.systemPrompt+'\n\nPrepared module prologue ('+(prologueRecorded?'already delivered; continue from the player answer without repeating it':'use on the first setup reply only')+'):\n'+guidance.opening+
      '\n\nModule-specific setup advice:\n'+guidance.advice+
      '\nChoose profile.era from these rulebook periods only when it matches the authored setting: '+JSON.stringify(context.rulebook_eras||[])+'. The source era can be descriptive prose; do not copy it as a table key. If no period applies, retain the finance blocker rather than choosing a nearby era.'+
      '\nWhen the player supplies only a name and an occupation concept without delegating the rest, ask one or two in-character follow-up questions (one at a time, waiting for each answer) and do not draft in that reply. After the answers, or at once on explicit delegation, use setup create-investigator with a complete structured profile. Do not merely describe a character: the computed draft must appear before approval. Use confirm-investigator only after approval or explicit write-now delegation.'+
      '\nThe occupational skill list is priority ordered for the existing tier allocation. Put scenario prerequisites and the player\'s essential abilities first. Inspect the computed draft against those requirements before asking for confirmation. If an essential ability remains at its base value, revise the same profile order or legal interest choices; preserve the existing seed and required occupation skills. Do not claim an ability the actual card lacks.'+
      (process.env.PI_COC_SETUP_AUTOSTART==='1'?'\nThis is the frontend. The card defaults to final values and has a calculation-details toggle for all dice, adjustments and allocation evidence. Keep the accompanying prose brief: identity, edition/method and one confirmation invitation. Do not automatically repeat calculations or budgets; point to the details control or explain them if the player explicitly asks. After complete, close the prologue without a launch command; the host hands off to play.':'')};
  });

	// The kernel extension emits the bridge in session_start; this subscribes at load time, so both load orders are caught.
	pi.events.on("coc:kernel-bridge", (data) => {
		const payload = asRecord(data) as { call?: KernelCall; hello?: Record<string, unknown>; campaign?: string };
		bridge = typeof payload.call === "function" ? { call: payload.call, ...(payload.hello ? { hello: asRecord(payload.hello) } : {}) } : undefined;
		if (payload.campaign && context.campaign === undefined) context.campaign = payload.campaign;
	});

	pi.on("session_start", async (_event, sessionCtx) => {
		ctx = sessionCtx;
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
		// When the kernel extension loaded first the bridge is already here and the table is fetched now; when it comes later, the first tool call fetches it.
		if (bridge) await ensureSteps();
		paint();
    invokeDisposers=registerInvokeHandlers('coc-keeper',{'setup-handoff':async()=>{
      if(completing||!ctx?.isIdle()||!bridge)return {waiting:true};
      completing=true;
      try {
        const snapshot=asRecord(await bridge.call('setup.steps',{campaign:context.campaign}));
        if(!asRecord(snapshot.state).waiting_for_opening)return {waiting:false};
        await bridge.call('setup.complete',{campaign:context.campaign});
        completed.add('complete');finish();
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
      await bridge!.call('setup.prologue',{campaign,scene:guidance.scene,guide:guidance.guide,handoff:guidance.handoff,text:guidance.opening});
      prologueRecorded=true;
      pi.sendMessage({customType:'coc-setup-opening',content:guidance.opening,display:true,details:{kind:'setup-opening'}});
    }
    if (ctx.hasUI && steps && process.env.PI_COC_SETUP_AUTOSTART!=='1') {
			ctx.ui.notify(`Setup: ${steps.length} steps in all. ${instructionFor(nextStep(steps, state()))}`, "info");
		}
	});

	// After the last step, wait for this run to say the handoff out loud before exiting (contract §14.4: the process exits and prints the command that opens the table).
	pi.on("agent_end", async () => {
    if(guidanceBlocked){ctx?.ui.notify("Character guidance review failed; retry preparation before continuing.","error");return;}
    if(characterGuidance && bridge && context.campaign && !prologueRecorded && !handoff) {
      const messages=ctx?.sessionManager.getBranch().filter((e:any)=>e.type==='message'&&e.message?.role==='assistant') as any[] || [];
      const last=messages.at(-1)?.message?.content?.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('\n');
      if(last) {await bridge.call('setup.prologue',{campaign:context.campaign,scene:characterGuidance.scene,guide:characterGuidance.guide,handoff:characterGuidance.handoff,text:last});prologueRecorded=true;}
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
