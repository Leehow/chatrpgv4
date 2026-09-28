import {installChildProviderBudget, outputFieldPath, withOutputRoom} from "../../runtime/jev/provider-budget.ts";
import {READING_STAGE_BUDGET} from "../../runtime/jev/reading-stage-budget.ts";
/** Keep page-image history bounded without changing the recorded reader transcript. */
import { appendFileSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import {createHash} from 'node:crypto';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

type ToolCall = { toolName: string; input?: Record<string, unknown> };
type ToolGate = { block: true; reason: string } | undefined;
type AllowedCheck = { command: string; wrapper: string; bytes: Buffer };

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const HOST_FILES = new Set(["task.json", "packet.json", "baseline.json", "findings.json", "observations.json", "read-complete.json", "review-input.json", "source-driver-complete.json", "source-driver.jsonl", "source-navigation-review.json", "pending-source-needs.json"]);
const blocked = (tool: string, reason: string): ToolGate => ({ block: true, reason: `Reader confinement blocked ${tool}: ${reason}` });
const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

/** A derived directory may not exist yet: canonicalize the deepest ancestor that does, so two
 *  spellings of the same not-yet-rendered path still compare equal. */
function canonical(path: string): string {
	let cursor = resolve(path);
	const tail: string[] = [];
	while (true) {
		try { return join(realpathSync(cursor), ...tail.slice().reverse()); }
		catch {
			const parent = dirname(cursor);
			if (parent === cursor) return resolve(path);
			tail.push(basename(cursor));
			cursor = parent;
		}
	}
}

function within(root: string, target: string): boolean {
	const suffix = relative(root, target);
	return suffix === "" || (suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix));
}

/** Match the path normalization performed by Pi's file tools before applying the stronger realpath boundary. */
function toolPath(value: unknown): string | undefined {
	if (typeof value !== "string" || !value || value.includes("\0")) return;
	let path = value.replace(UNICODE_SPACES, " ");
	if (path.startsWith("@")) path = path.slice(1);
	if (!path || path === "~" || path.startsWith("~/")) return;
	return path;
}

function canonicalExisting(cwd: string, value: unknown): string | undefined {
	const path = toolPath(value);
	if (!path) return;
	try { return realpathSync(resolve(cwd, path)); } catch { return; }
}

function writableInside(cwd: string, root: string, value: unknown): { path: string; relative: string } | undefined {
	const path = toolPath(value);
	if (!path) return;
	const absolute = resolve(cwd, path), lexicalRoot = resolve(cwd);
	if (!within(lexicalRoot, absolute)) return;
	let cursor = absolute;
	while (true) {
		try {
			const canonical = realpathSync(cursor);
			if (!within(root, canonical)) return;
			break;
		} catch {
			const parent = dirname(cursor);
			if (parent === cursor) return;
			cursor = parent;
		}
	}
	const suffix = relative(lexicalRoot, absolute);
	return { path: absolute, relative: suffix };
}

function sourceRoots(cwd: string, env: NodeJS.ProcessEnv): { task: string; pdf?: string; cache?: string; error?: string } {
	let task: string;
	try { task = realpathSync(cwd); } catch { return { task: resolve(cwd), error: "the task directory is unavailable" }; }
	const homeValue = env.PI_COC_HOME;
	if (!homeValue) return { task, error: "PI_COC_HOME is missing" };
	let home: string;
	try { home = realpathSync(homeValue); } catch { return { task, error: "PI_COC_HOME is unavailable" }; }
	if (!within(home, task)) return { task, error: "the task directory is outside PI_COC_HOME" };
	if (!env.PI_COC_READER_SOURCE) return { task };
	try {
		const source = JSON.parse(env.PI_COC_READER_SOURCE);
		if (!source || typeof source.pdf !== "string" || typeof source.cache !== "string") throw new Error();
		const pdf = realpathSync(source.pdf), module = dirname(pdf), root = dirname(module);
		// A module workspace is either the shared library `.coc/modules/<id>` or one campaign's
		// private `.coc/module-campaigns/<campaign>/modules/<id>`. Both are internal; neither is
		// reachable from the other. The page cache is a derived artifact of whichever one owns the
		// PDF, so it is compared lexically and may not exist yet on the first read of a fresh seed.
		const coc = realpathSync(join(home, ".coc")), scope = dirname(root);
		const internal = within(coc, pdf) && basename(root) === "modules"
			&& (root === canonical(join(coc, "modules"))
				|| (basename(dirname(scope)) === "module-campaigns" && dirname(dirname(scope)) === coc));
		const cache = canonical(source.cache), expectedCache = canonical(join(module, "cache", "pages"));
		if (!internal || basename(pdf) !== "source.pdf" || cache !== expectedCache || !within(realpathSync(join(module, "work")), task))
			return { task, error: "the PDF source, cache or task does not match one internal module" };
		return { task, pdf, cache };
	} catch { return { task, error: "PI_COC_READER_SOURCE is invalid" }; }
}

function captureCheck(cwd: string, taskRoot: string, env: NodeJS.ProcessEnv): { allowed?: AllowedCheck; error?: string } {
	let task: any;
	try { task = JSON.parse(readFileSync(join(cwd, "task.json"), "utf8")); }
	catch { return { error: "the host task could not be captured" }; }
	const command = task?.commands?.check;
	if (command === undefined) return {};
	const expected = `coc-read-check --packet ${shellQuote(join(cwd, "task.json"))} --draft ${shellQuote(join(cwd, "draft.json"))}`;
	if (command !== expected) return { error: "the host checker command is not canonical" };
	const wrapper = join(cwd, "host-bin", "coc-read-check");
	if (resolve(env.PI_COC_READER_CHECK ?? "") !== wrapper) return { error: "the host checker wrapper is not bound to this task" };
	try {
		const info = lstatSync(wrapper);
		if (!info.isFile() || info.isSymbolicLink() || !within(taskRoot, realpathSync(wrapper))) throw new Error();
		const pathHead = (env.PATH ?? "").split(delimiter)[0];
		if (!pathHead || realpathSync(pathHead) !== realpathSync(join(cwd, "host-bin"))) throw new Error();
		return { allowed: { command, wrapper: realpathSync(wrapper), bytes: readFileSync(wrapper) } };
	} catch { return { error: "the host checker wrapper is unavailable or mutable through another path" }; }
}

function unchanged(check: AllowedCheck): boolean {
	try {
		const info = lstatSync(check.wrapper);
		return info.isFile() && !info.isSymbolicLink() && readFileSync(check.wrapper).equals(check.bytes);
	} catch { return false; }
}

/** A fail-closed, host-owned boundary around Pi's otherwise general local coding tools. */
export function createReaderToolGuard(cwd: string, env: NodeJS.ProcessEnv = process.env): (event: ToolCall) => ToolGate {
	const roots = sourceRoots(cwd, env);
	const check = roots.error ? {} : captureCheck(cwd, roots.task, env);
	return (event: ToolCall): ToolGate => {
		if (event.toolName === "pdf") return roots.error ? blocked("pdf", roots.error) : undefined;
		if (!["bash", "read", "write", "edit"].includes(event.toolName)) return;
		if (roots.error) return blocked(event.toolName, roots.error);
		if (event.toolName === "bash") {
			if (!check.allowed || check.error || event.input?.command !== check.allowed.command || !unchanged(check.allowed))
				return blocked("bash", check.error ?? "only the unchanged host-generated source checker command is allowed");
			return;
		}
		if (event.toolName === "read") {
			const target = canonicalExisting(cwd, event.input?.path);
			if (!target || !(within(roots.task, target) || target === roots.pdf || !!roots.cache && within(roots.cache, target)))
				return blocked("read", "the path is outside the task directory and its bound PDF cache");
			return;
		}
		const target = writableInside(cwd, roots.task, event.input?.path);
		if (!target) return blocked(event.toolName, "the path escapes the task directory or crosses a symlink boundary");
		const first = target.relative.split(sep)[0];
		if (first === "host-bin" || HOST_FILES.has(target.relative) || target.relative.endsWith('.jsonl'))
			return blocked(event.toolName, "host-owned task inputs and executable wrappers are immutable");
	};
}

/** Shell startup files and home expansion must not create a path around the tool-call guard. */
export function confineReaderEnvironment(cwd: string, env: NodeJS.ProcessEnv = process.env): void {
	for (const key of ["BASH_ENV", "ENV", "CDPATH"]) delete env[key];
	env.HOME = cwd;
}

export function boundImages(messages: any[], previouslyIncluded = new Set<string>(), byteBudget = 32 * 1024 * 1024, countBudget = 24) {
	const copy = messages.map(message => ({ ...message, ...(Array.isArray(message.content) ? { content: [...message.content] } : {}) }));
	let bytes = 0, count = 0;
	const included: string[] = [];
	for (let i = copy.length - 1; i >= 0; i--) {
		const message = copy[i];
		if (!Array.isArray(message.content)) continue;
		for (let j = message.content.length - 1; j >= 0; j--) {
			const block = message.content[j];
			if (block.type !== "image") continue;
			const size = typeof block.data === "string" ? Buffer.byteLength(block.data, "base64") : 0;
			const key = message.toolCallId ?? (message.details?.kind==='host_source_pages'&&typeof block.data==='string'
				?`host:${message.details.source_sha256??''}:${createHash('sha256').update(Buffer.from(block.data,'base64')).digest('hex')}`
				:`message-${i}`);
			if (!previouslyIncluded.has(key) || count === 0 || (count < countBudget && bytes + size <= byteBudget)) {
				bytes += size; count++;
				included.push(key);
				continue;
			}
			message.content[j] = { type: "text", text: previouslyIncluded.has(key)
				? "[Earlier page image omitted from this request to bound its size. Reopen the cached image with read if you need its details again.]"
				: "[This image has not been included in the model context. Read fewer images at once and reopen this cached image before using its contents.]" };
		}
	}
	return { messages: copy, included, bytes, count };
}

export default function readerContext(pi: any, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
	const cwd = options.cwd ?? process.cwd(), env = options.env ?? process.env;
	const configuredRequests = Number(env.PI_COC_READER_MAX_REQUESTS);
	const maxRequests = Number.isInteger(configuredRequests) && configuredRequests > 0 ? configuredRequests : null;
	let providerRequests = 0;
	const sent = new Set<string>();
	let candidateIncluded:string[]=[];
	let inFlightIncluded:string[]=[];
	let candidateImageBytes=0,inFlightImageBytes=0;
	let candidateHostPages:Record<string,unknown>[]=[];
	let inFlightHostPages:Record<string,unknown>[]=[];
	const deliveredHostImages=new Set<string>(),retiredHostImages=new Set<string>();
	const retiredImageCalls=new Set<string>();
	// Contract §140: with no lease (no budget channel) the child still sends its own output bound -- the lease's
	// per-call one, else a reading's -- so the provider's unstated default never decides how much a reasoning
	// model may think before it answers. A leased child is bounded by `installChildProviderBudget` below instead.
	const leased = env.PI_COC_PROVIDER_BUDGET === "ipc-v1";
	const configuredOutput = Number(env.PI_COC_PROVIDER_OUTPUT_LIMIT);
	const outputRoom = Number.isSafeInteger(configuredOutput) && configuredOutput > 0 ? configuredOutput : READING_STAGE_BUDGET.callOutputTokens;
	if (env.PI_COC_READER_SOURCE) {
		confineReaderEnvironment(cwd, env);
		const guard = createReaderToolGuard(cwd, env);
		pi.on("tool_call", (event: ToolCall) => guard(event));
	}
	pi.on("before_provider_request", (event: any, ctx: any) => {
		if (maxRequests !== null && providerRequests >= maxRequests) {
			ctx?.abort();
			throw new Error(`The bounded reader reached its ${maxRequests}-request limit`);
		}
		providerRequests++;
		inFlightIncluded=[...candidateIncluded];
		inFlightImageBytes=candidateImageBytes;
		inFlightHostPages=[...candidateHostPages];
		const bounded = leased ? event.payload : withOutputRoom(ctx?.model, event.payload, outputRoom);
		const log = env.PI_COC_READER_REQUESTS_LOG;
		if (log) {
			const path = bounded && typeof ctx?.model?.api === "string" ? outputFieldPath(ctx.model.api, bounded) : null;
			const output = path ? path.reduce((value: any, key) => value?.[key], bounded) : undefined;
			appendFileSync(log, JSON.stringify({at: new Date().toISOString(), provider: ctx.model?.provider,
				model: event.payload?.model, reasoning_effort: event.payload?.reasoning?.effort ?? event.payload?.reasoning_effort ?? null,
				...(leased ? {} : {output_bound: typeof output === "number" ? output : null})}) + "\n");
		}
		return bounded === event.payload ? undefined : bounded;
	});
	pi.on("message_end",(event:any)=>{
		if(event.message?.role!=="assistant")return;
		const successful=!['error','aborted'].includes(event.message.stopReason);
		if(successful){
			for(const id of inFlightIncluded)sent.add(id);
			for(const row of inFlightHostPages)if(typeof row.image_sha256==='string')deliveredHostImages.add(row.image_sha256);
			const log=env.PI_COC_READER_IMAGES_LOG;
			if(log&&(inFlightIncluded.length||inFlightHostPages.length))appendFileSync(log,JSON.stringify({delivery:'succeeded',included:inFlightIncluded,host_pages:inFlightHostPages,bytes:inFlightImageBytes})+"\n");
		}
		inFlightIncluded=[];
		inFlightHostPages=[];
		inFlightImageBytes=0;
	});
	pi.on('tool_execution_end',(event:any)=>{
		if(event.toolName==='submit_reading'){
			try{
				let task:any={};try{task=JSON.parse(readFileSync(join(cwd,'task.json'),'utf8'));}catch{}
				const names=Array.isArray(task.required_review)?['review.json']:['draft.json',...(task.purpose==='guidance'?['guidance.json']:[])];
				for(const name of names){const value=JSON.parse(readFileSync(join(cwd,name),'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))return;}
			}catch{return;}
			for(const digest of deliveredHostImages)retiredHostImages.add(digest);
			for(const id of sent)retiredImageCalls.add(id);
		}
	});
	// The owning lease's per-call output bound (contract §20 addendum 2); absent keeps the default.
	installChildProviderBudget(pi, leased, Number(env.PI_COC_PROVIDER_OUTPUT_LIMIT) || undefined);
	pi.on("context", (event: any) => {
		const configured=Number(env.PI_COC_READER_IMAGE_HISTORY);
		const material=event.messages.map((message:any)=>message.toolCallId&&retiredImageCalls.has(message.toolCallId)?{...message,
			content:(message.content??[]).map((block:any)=>block.type==='image'
				?{type:'text',text:'Earlier original-page image retired after candidate submission. Reopen the source page with pdf if its details are needed again.'}:block)
		}:message.details?.kind==='host_source_pages'?{...message,
			content:(message.content??[]).map((block:any)=>{
				if(block.type!=='image'||typeof block.data!=='string')return block;
				const digest=createHash('sha256').update(Buffer.from(block.data,'base64')).digest('hex');
				return retiredHostImages.has(digest)?{type:'text',text:'Earlier host original-page image retired after source submission. Reopen this physical page with pdf if its details are needed again.'}:block;
			})}:message);
		const result = boundImages(material, sent, undefined, configured>0?configured:undefined);
		candidateIncluded=[...result.included];
		candidateImageBytes=result.bytes;
		candidateHostPages=[];
		let binding:any;
		try{binding=JSON.parse(env.PI_COC_READER_SOURCE??'null');}catch{}
		if(binding?.file_sha256&&binding?.cache){
			for(const message of result.messages){
				if(message.customType!=='coc-source-navigation'||message.details?.kind!=='host_source_pages'||message.details.source_sha256!==binding.file_sha256)continue;
				const images=(message.content??[]).filter((block:any)=>block.type==='image'&&typeof block.data==='string');
				const available=images.map((block:any)=>({digest:createHash('sha256').update(Buffer.from(block.data,'base64')).digest('hex'),used:false}));
				for(const row of message.details.pages??[]){
					if(!Number.isSafeInteger(row.page)||row.page<1||typeof row.path!=='string'||typeof row.image_sha256!=='string')continue;
					const matching=available.find((image:any)=>!image.used&&image.digest===row.image_sha256);
					if(!matching)continue;
					try{
						if(!within(canonical(binding.cache),realpathSync(row.path)))continue;
						if(createHash('sha256').update(readFileSync(row.path)).digest('hex')!==row.image_sha256)continue;
						matching.used=true;
						candidateHostPages.push({page:row.page,path:row.path,image_sha256:row.image_sha256,box:row.box,
							source_sha256:binding.file_sha256});
					}catch{}
				}
			}
		}
		const log = env.PI_COC_READER_IMAGES_LOG;
		if (log) appendFileSync(log, JSON.stringify({ delivery:'attempted', candidates:result.included, bytes: result.bytes, count: result.count }) + "\n");
		return { messages: result.messages };
	});
}
