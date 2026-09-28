import {normalizeSourceDraft} from './reader-normalize.ts';
/** Private checked source submission; never graph publication. */
import {moduleLogicReview,MODULE_REVIEW_IMPACTS} from '../../kernel-ts/modules/module-review-policy.ts';
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resourceRootFrom } from "../../runtime/deployment.mjs";
import { Type } from "typebox";
import { validateGuidance } from "./character-guidance.ts";
import { checkAnswerReviewShape, checkReviewEvidence } from "./reader-review.ts";
import {successfulImageDeliveries} from './reader-image-delivery.ts';
import {REVIEW_VERDICTS} from '../../kernel-ts/modules/review-verdicts.ts';
import {PUBLIC_GUIDANCE_FIELDS,validatePublicGuidance} from '../../kernel-ts/modules/public-guidance.ts';
import {retainSourceNeeds} from './source-needs.ts';

export default async function readerSubmit(pi: any) {
	const cwd = process.cwd();
	const checker = process.env.PI_COC_READER_CHECK ?? join(resourceRootFrom(import.meta.url), "bin/coc-read-check");
	const task = JSON.parse(await readFile(join(cwd, "task.json"), "utf8"));
	const guidanceTask = task.purpose === "guidance", answerTask = task.purpose === "answer";
	if (!guidanceTask && !answerTask && !['opening', 'detail'].includes(task.purpose)) throw new Error("Checked submission is only available for guidance, opening, detail and source answers");
	const reviewing = Array.isArray(task.required_review);
	const guidanceProjection=guidanceTask&&!reviewing&&task.guidance_projection;
	if(guidanceProjection&&(!Array.isArray(guidanceProjection.source_pages)||!guidanceProjection.source_pages.length||
		guidanceProjection.source_pages.length>12||guidanceProjection.source_pages.some((page:unknown)=>!Number.isSafeInteger(page)||Number(page)<1||Number(page)>task.source?.page_count)))
		throw new Error('Selected guidance source assignment is invalid');
	const projectionDraft=guidanceProjection?await readFile(join(cwd,'draft.json')):undefined;
	const publicBytes=guidanceTask?await readFile(join(cwd,'public-fields.json')).catch(error=>{
		if(error.code==='ENOENT')return undefined;throw error;}):undefined;
	const candidateFiles = ["draft.json", ...(guidanceTask ? ["guidance.json"] : []),...(publicBytes?['public-fields.json']:[])];
	const originals = reviewing ? await Promise.all(candidateFiles.map(name => readFile(join(cwd, name)))) : [];
	const seen = new Set<number>();
	const pageCalls=new Map<string,number[]>();
	pi.on("context", (event: any) => {
		for (const message of event.messages) {
			if (message.role !== "toolResult" || message.details?.kind !== "source_pages" ||
				!message.content?.some((block: any) => block.type === "image")) continue;
			const pages=(message.details.observations??[]).map((row:any)=>row.page).filter(Number.isSafeInteger);
			for(const page of pages)seen.add(page);
			if(typeof message.toolCallId==='string')pageCalls.set(message.toolCallId,pages);
		}
	});
	const deliveredPages=async()=>{
		const log=process.env.PI_COC_READER_IMAGES_LOG;
		if(!log)return seen;
		const source=JSON.parse(process.env.PI_COC_READER_SOURCE??'null');
		if(typeof source?.file_sha256!=='string'||typeof source?.cache!=='string')throw new Error('Bound source image delivery is unavailable');
		const delivered=await successfulImageDeliveries(log,source);
		const pages=new Set<number>(delivered.hostPages.map(row=>row.page));
		for(const [id,viewed] of pageCalls)if(delivered.toolCallIds.has(id))for(const page of viewed)pages.add(page);
		return pages;
	};
	const issuedPaths=(Array.isArray(task.required_review)?task.required_review:[]).filter((path:unknown):path is string=>typeof path==='string'&&!!path);
	const issuedPath=issuedPaths.length>1?Type.Union(issuedPaths.map((path:string)=>Type.Literal(path)))
		:issuedPaths.length===1?Type.Literal(issuedPaths[0]):Type.String();
	const guidanceReview=Type.Object({checked:Type.Array(Type.Object({paths:Type.Array(issuedPath,{minItems:1}),
		verdict:Type.Union(REVIEW_VERDICTS.map(value=>Type.Literal(value))),source_refs:Type.Array(Type.Any()),reason:Type.Optional(Type.String())},{additionalProperties:true})),
		missing:Type.Array(Type.Any()),guidance:Type.Object({approved:Type.Boolean(),issues:Type.Array(Type.Any())},{additionalProperties:true})},{additionalProperties:true});
	const logicReviewSchema=Type.Object({checked:Type.Array(Type.Object({
        paths:Type.Optional(Type.Array(Type.String())),path:Type.Optional(Type.String()),
        verdict:Type.Union((answerTask?['supported','contradicted','unclear']:REVIEW_VERDICTS).map(value=>Type.Literal(value))),
        impact:Type.Optional(Type.Union(MODULE_REVIEW_IMPACTS.map(value=>Type.Literal(value)))),
        source_refs:Type.Array(Type.Object({page:Type.Integer({minimum:1})},{additionalProperties:true})),reason:Type.String()
    },{additionalProperties:true})),missing:Type.Array(Type.Any()),
        ...(guidanceTask?{guidance:Type.Object({approved:Type.Boolean(),issues:Type.Array(Type.Any())},{additionalProperties:true})}:{})
    },{additionalProperties:true});
	const publicSchema=Type.Object(Object.fromEntries(PUBLIC_GUIDANCE_FIELDS.map(field=>[field,Type.Object({
		status:Type.Union(['value','needs_choice','unavailable'].map(value=>Type.Literal(value))),text:Type.String({maxLength:1000}),
		source_refs:Type.Array(Type.Object({page:Type.Integer({minimum:1})},{additionalProperties:false}),{maxItems:12})},{additionalProperties:false})])),{additionalProperties:false});
	pi.registerTool({
		name: "submit_reading", label: "Submit checked source artifacts",
		executionMode: "sequential",
		description: reviewing
			? "Save and check review.json, then finish without another model reply. Supply review or omit it if already written. Never modify the candidate files. Call alone after viewing the original cited pages."
			: answerTask ? "Save and check the scoped source answer in draft.json, then finish without another model reply. Supply draft or omit it if already written. Use only status, answer, source_refs and limitations; no graph fields. Call alone after viewing every cited original page."
			: guidanceProjection ? "Save and check guidance.json and public_fields for the already reviewed selected entrance. The host owns the unchanged draft.json; do not edit or submit it. Call alone after viewing assigned original pages."
			: guidanceTask ? "Save and check draft.json and guidance.json, then finish without another model reply. Supply both small objects, or omit them if already written with write/edit/bash. Failure returns findings for repair. Call alone after viewing the required original pages."
			: task.purpose === 'detail' ? "Save and check the scoped detail delta in draft.json, then finish without a closing reply. Prepare only task.focus/question and necessary dependencies; preserve accepted fields and leave unrelated material unprepared. Supply draft or omit it if already written. A failed check returns concrete findings for repair. Call alone after viewing the required original pages."
			: "Save and check the first opening batch in draft.json, then finish without a closing reply. Under opening_scope first_interaction, declare interaction_scene and prepare the selected entry plus its first substantive interaction and immediate dependencies. Defer future encounters. Supply draft or omit it if already written. Failure returns findings for repair. Call alone after viewing the required original pages.",
		parameters: reviewing ? Type.Object({review:Type.Optional(moduleLogicReview(task)?logicReviewSchema:guidanceTask?guidanceReview:Type.Any())})
			: guidanceProjection ? Type.Object({guidance:Type.Optional(Type.Object({opening:Type.String(),advice:Type.String(),scene:Type.String(),guide:Type.Literal(''),handoff:Type.String()},{additionalProperties:false})),public_fields:Type.Optional(publicSchema)},{additionalProperties:false})
			: Type.Object({draft:Type.Optional(guidanceTask?Type.Object({nodes:Type.Array(Type.Any()),claims:Type.Array(Type.Any()),
				node_refs:Type.Array(Type.Any()),coverage:Type.Object({},{additionalProperties:Type.Any()}),dependencies:Type.Array(Type.Any()),
				critical:Type.Array(Type.String()),ready_nodes:Type.Array(Type.String())},{additionalProperties:true}):Type.Any()),
				...(guidanceTask?{guidance:Type.Optional(Type.Any()),public_fields:Type.Optional(publicSchema)}:{})}),
		async execute(_id: string, params: any, signal?: AbortSignal) {
			if (signal?.aborted) throw new Error("Source submission cancelled");
			const names = reviewing ? ["review"] : guidanceProjection?["guidance"]:["draft", ...(guidanceTask?["guidance"]:[])];
			if(guidanceProjection){
				if(params.guidance&&params.guidance.guide!=='')throw new Error('Selected guidance guide must be empty; this projection does not prepare a physically present NPC');
				const liveDraft=await readFile(join(cwd,'draft.json'));
				if(!liveDraft.equals(projectionDraft!)||params.draft!==undefined)
					throw new Error('The host-owned selected entrance shard changed');
			}
			for (const name of names) if (params[name] !== undefined) {
				if (!params[name] || typeof params[name] !== "object" || Array.isArray(params[name])) throw new Error(`${name} must be an object`);
				await writeFile(join(cwd, `${name}.json`), JSON.stringify(params[name]) + "\n");
			}
			if(guidanceTask&&!reviewing&&params.public_fields!==undefined){
				validatePublicGuidance(params.public_fields,task.source?.page_count);
				await writeFile(join(cwd,'public-fields.json'),JSON.stringify(params.public_fields)+'\n');
			}
			const viewed=await deliveredPages();
			if(!reviewing){
				const retained=await readFile(join(cwd,'pending-source-needs.json')).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
				if(retained&&!answerTask&&!guidanceProjection){
					const candidate=JSON.parse(await readFile(join(cwd,'draft.json'),'utf8'));
					if(!Object.hasOwn(candidate,'source_needs'))await writeFile(join(cwd,'draft.json'),JSON.stringify({...candidate,source_needs:[]})+'\n');
				}
			}
			if (reviewing) {
				for (const [i, name] of candidateFiles.entries())
					if (!(await readFile(join(cwd, name))).equals(originals[i])) throw new Error("reviewer modified its candidate pair");
				const review = JSON.parse(await readFile(join(cwd, "review.json"), "utf8"));
				checkReviewEvidence(review, task.required_review, viewed, task.review_scope_pages ?? [], JSON.parse(originals[0].toString()));
				// §22.4.3: the answer review's protocol shape, checked where the reviewer can still repair it in place.
				if (answerTask) checkAnswerReviewShape(review, Number(task.source?.page_count) || Number.MAX_SAFE_INTEGER, viewed,
					(JSON.parse(originals[0].toString()).source_refs ?? []).map((ref: any) => ref?.page));
				if (guidanceTask && (typeof review.guidance?.approved !== "boolean" || !Array.isArray(review.guidance?.issues))) throw new Error("review needs guidance approved and issues");
			} else {
				if (guidanceTask) {
					const guidance = JSON.parse(await readFile(join(cwd, "guidance.json"), "utf8"));
					if (!(guidance.needs_choice === true && Object.keys(guidance).length === 1)) {
					validateGuidance(guidance);
					if(guidanceProjection&&guidance.guide!=='')throw new Error('Selected guidance guide must be empty; this projection does not prepare a physically present NPC');
						if (Object.keys(guidance).length !== 5) throw new Error("guidance needs exactly five bounded strings");
					}
				}
				let publicPages:number[]=[];
				if(guidanceTask){
					const bytes=await readFile(join(cwd,'public-fields.json'),'utf8').catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
					if(task.public_progress_required&&!bytes)throw new Error('Submit the four public_fields in the same call as guidance');
					if(bytes)publicPages=Object.values(validatePublicGuidance(JSON.parse(bytes),task.source?.page_count)).flatMap(field=>field.source_refs.map(ref=>ref.page));
				}
				if(!answerTask&&!guidanceProjection){
                    const file=join(cwd,'draft.json'),candidate=JSON.parse(await readFile(file,'utf8'));
                    if(normalizeSourceDraft(candidate).length)await writeFile(file,JSON.stringify(candidate)+'\n');
                }
				const result = await pi.exec(checker, ["--packet",join(cwd,"task.json"),"--draft",join(cwd,"draft.json")], {signal});
				if (result.code !== 0) {
					let failure:any;try{failure=JSON.parse(result.stdout);}catch{}
					if(failure?.error?.details?.rule==='source_needs_pending'&&Array.isArray(failure.error.details.requests)){
						const source=JSON.parse(process.env.PI_COC_READER_SOURCE??'null');
						await retainSourceNeeds(cwd,source?.file_sha256??'',failure.error.details.requests,task.source?.page_count);
						return {
						content:[{type:'text',text:'Required source gaps are retained. Retrieve original evidence and repair them before completing this candidate.'}],
						details:{kind:'source_need_batch',requests:failure.error.details.requests}};
					}
					throw new Error(result.stdout || result.stderr || "source draft check failed");
				}
				const check = JSON.parse(result.stdout);
				if (check.ok !== true || !Array.isArray(check.required_view_pages)) throw new Error("source draft check did not complete");
				const required=[...new Set<number>([...check.required_view_pages,...(guidanceProjection?.source_pages??[]),...publicPages])];
				const missing = required.filter((page: number) => !viewed.has(page));
				if (missing.length) throw new Error(`View original physical pages before submitting: ${missing.join(", ")}`);
			}
			if (signal?.aborted) throw new Error("Source submission cancelled");
			return {content:[{type:"text",text:"Artifacts checked. The host will apply the existing independent review and publication gates."}],
				details:{kind:"source_submission",phase:reviewing?"review":guidanceTask?"guidance":"read"},terminate:true};
		},
	});
}
