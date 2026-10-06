import assert from "node:assert/strict";
import { test } from "node:test";
import {createHash} from 'node:crypto';

import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readerContext, { boundImages, confineReaderEnvironment, createReaderToolGuard } from "../../extensions/module/reader-context.ts";
import { readingImageBudget, resetReadingImageBudgetCache } from "../../runtime/jev/host-budgets.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

test('host original images keep stable identity when Pi moves the projection within later context',()=>{
 const host={role:'custom',details:{kind:'host_source_pages',source_sha256:'a'.repeat(64)},
  content:Array.from({length:6},(_,i)=>({type:'image',data:Buffer.from('original-page-'+i).toString('base64')}))};
 const first=boundImages([host],new Set(),100000,4);
 assert.equal(first.count,6,'every first-use original must reach the reader');
 const moved=boundImages([{role:'user',content:'Earlier context'},host],new Set(first.included),100000,4);
 // §186.1: six delivered images over a budget of four are evicted in one batch, oldest first, down to half the budget.
 assert.equal(moved.count,2,'a changed message index must not replay the entire host image batch');
 assert.equal(moved.evicted.length,4);
 assert.equal(host.content.filter(block=>block.type==='image').length,6,'the retained transcript is unchanged');
 assert.equal(boundImages([{role:'user',content:'Retry'},host],new Set(),100000,4).count,6,'failed first delivery is retried intact');
});

async function confinementFixture(t, options = {}) {
	const home = await mkdtemp(join(tmpdir(), "reader-confinement-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	// A campaign-scoped read owns a private module workspace; a library read uses the shared one.
	const module = options.campaign
		? join(home, ".coc", "module-campaigns", options.campaign, "modules", "book")
		: join(home, ".coc", "modules", "book");
	const cwd = join(module, "work", "read-1", "attempt-1");
	const cache = join(module, "cache", "pages");
	const source = join(module, "source.pdf");
	const outside = await mkdtemp(join(tmpdir(), "reader-outside-"));
	t.after(() => rm(outside, { recursive: true, force: true }));
	await mkdir(join(cwd, "host-bin"), { recursive: true });
	await mkdir(join(home, ".coc", "modules"), { recursive: true });
	if (!options.withoutCache) await mkdir(cache, { recursive: true });
	await writeFile(source, "%PDF-1.7\n");
	for (const name of ["draft.json", "baseline.json", "findings.json", "review.json"])
		await writeFile(join(cwd, name), "{}\n");
	await writeFile(join(outside, "secret.txt"), "outside\n");
	await symlink(join(outside, "secret.txt"), join(cwd, "escape.txt"));
	await symlink(outside, join(cwd, "escape-dir"));
	const checker = `coc-read-check --packet ${quote(join(cwd, "task.json"))} --draft ${quote(join(cwd, "draft.json"))}`;
	await writeFile(join(cwd, "task.json"), JSON.stringify({ commands: { check: checker } }) + "\n");
	await writeFile(join(cwd, "packet.json"), "{}\n");
	const wrapper = join(cwd, "host-bin", "coc-read-check");
	await writeFile(wrapper, "#!/bin/sh\nexit 0\n");
	const env = { PI_COC_HOME: home, PI_COC_READER_SOURCE: JSON.stringify({ pdf: source, cache }),
		PI_COC_READER_CHECK: wrapper, PATH: `${join(cwd, "host-bin")}:/usr/bin:/bin`, HOME: "/Users/example" };
	return { home, module, cwd, cache, source, outside, checker, wrapper, env };
}

test("the reader blocks read-6 shell traversal before execution and permits only the captured checker", async t => {
	const fixture = await confinementFixture(t), guard = createReaderToolGuard(fixture.cwd, fixture.env);
	let executed = 0;
	const run = event => { const result = guard(event); if (!result?.block) executed++; return result; };
	for (const command of [
		"find / -maxdepth 8 -type f",
		"cd /Applications/PipiCOC.app/Contents/Resources/pi-coc && find .",
		"python3 -c 'print(1)'",
		"cat ~/Documents/secret.txt",
		`${fixture.checker}; find / -maxdepth 8`,
	]) assert.match(run({ toolName: "bash", input: { command } }).reason, /Reader confinement blocked bash/);
	assert.equal(executed, 0);
	assert.equal(run({ toolName: "bash", input: { command: fixture.checker } }), undefined);
	assert.equal(executed, 1);
	await writeFile(fixture.wrapper, "#!/bin/sh\nfind /\n");
	assert.match(run({ toolName: "bash", input: { command: fixture.checker } }).reason, /unchanged host-generated/);
	assert.equal(executed, 1);
});

test("read/write/edit stay in the task and bound source cache across traversal and symlink attempts", async t => {
	const fixture = await confinementFixture(t), guard = createReaderToolGuard(fixture.cwd, fixture.env);
	for (const path of ["/Applications/PipiCOC.app/Contents/Resources/pi-coc/content", "../../../../../../../../etc/passwd",
		join(fixture.outside, "secret.txt"), "escape.txt", "@/etc/passwd", "~/Documents/secret.txt"])
		assert.match(guard({ toolName: "read", input: { path } }).reason, /blocked read/);
	for (const path of ["../outside.json", join(fixture.outside, "new.json"), "escape.txt", "escape-dir/new.json"])
		for (const toolName of ["write", "edit"])
			assert.match(guard({ toolName, input: { path } }).reason, new RegExp(`blocked ${toolName}`));
	for (const path of ["task.json", "packet.json", "baseline.json", "findings.json", "observations.json", "read-complete.json", "review-input.json", "source-driver-complete.json", "source-driver.jsonl", "source-navigation-review.json", "read-1.jsonl.images.jsonl", "review-plan.json", "host-bin/coc-read-check"])
		assert.match(guard({ toolName: "write", input: { path } }).reason, /host-owned/);
	for (const path of ["task.json", "draft.json", "baseline.json", "findings.json", "review.json", fixture.source])
		assert.equal(guard({ toolName: "read", input: { path } }), undefined);
	const page = join(fixture.cache, "page-4.jpg");
	await writeFile(page, "image");
	assert.equal(guard({ toolName: "read", input: { path: page } }), undefined);
	for (const [toolName, path] of [["write", "draft.json"], ["write", "notes/source.json"], ["edit", "review.json"]])
		assert.equal(guard({ toolName, input: { path } }), undefined);
	assert.equal(guard({ toolName: "pdf", input: { pages: [4] } }), undefined);
});

test("an externally rebound PDF or cache fails closed before the private pdf tool runs", async t => {
	const fixture = await confinementFixture(t);
	const guard = createReaderToolGuard(fixture.cwd, {...fixture.env,
		PI_COC_READER_SOURCE: JSON.stringify({pdf:join(fixture.outside,"secret.txt"),cache:fixture.cache})});
	assert.match(guard({toolName:"pdf",input:{pages:[1]}}).reason, /blocked pdf/);
	assert.match(guard({toolName:"read",input:{path:"task.json"}}).reason, /does not match one internal module/);
	const guardUnparseable = createReaderToolGuard(fixture.cwd, {...fixture.env, PI_COC_READER_SOURCE: "{"});
	assert.match(guardUnparseable({toolName:"read",input:{path:"task.json"}}).reason, /PI_COC_READER_SOURCE is invalid/);
});

test("a campaign's private module workspace is an internal source, not an escape", async t => {
	const fixture = await confinementFixture(t, { campaign: "game-3dd94f0a" });
	const guard = createReaderToolGuard(fixture.cwd, fixture.env);
	// The PDF lives under .coc/module-campaigns/<campaign>/modules/book, never under .coc/modules.
	assert.equal(guard({ toolName: "pdf", input: { pages: [4] } }), undefined);
	assert.equal(guard({ toolName: "read", input: { path: fixture.source } }), undefined);
	const page = join(fixture.cache, "page-4.jpg");
	await writeFile(page, "image");
	assert.equal(guard({ toolName: "read", input: { path: page } }), undefined);
	assert.equal(guard({ toolName: "read", input: { path: "task.json" } }), undefined);
});

test("a private module PDF paired with another workspace's page cache fails closed", async t => {
	const fixture = await confinementFixture(t, { campaign: "game-3dd94f0a" });
	const library = join(fixture.home, ".coc", "modules", "book", "cache", "pages");
	await mkdir(library, { recursive: true });
	const guard = createReaderToolGuard(fixture.cwd, { ...fixture.env,
		PI_COC_READER_SOURCE: JSON.stringify({ pdf: fixture.source, cache: library }) });
	assert.match(guard({ toolName: "pdf", input: { pages: [1] } }).reason, /blocked pdf/);
	assert.match(guard({ toolName: "read", input: { path: "task.json" } }).reason,
		/does not match one internal module/);
});

test("a freshly seeded workspace whose page cache is not rendered yet still binds its source", async t => {
	const fixture = await confinementFixture(t, { campaign: "game-3dd94f0a", withoutCache: true });
	const guard = createReaderToolGuard(fixture.cwd, fixture.env);
	// The cache is a derived directory the first page render creates; its absence is not a
	// broken binding, and must not be reported as an invalid PI_COC_READER_SOURCE.
	assert.equal(guard({ toolName: "pdf", input: { pages: [1] } }), undefined);
	assert.equal(guard({ toolName: "read", input: { path: "task.json" } }), undefined);
});

test("a source outside every module workspace is still refused", async t => {
	const fixture = await confinementFixture(t, { campaign: "game-3dd94f0a" });
	const stray = join(fixture.home, ".coc", "module-campaigns", "game-3dd94f0a", "source.pdf");
	await writeFile(stray, "%PDF-1.7\n");
	const guard = createReaderToolGuard(fixture.cwd, { ...fixture.env,
		PI_COC_READER_SOURCE: JSON.stringify({ pdf: stray, cache: fixture.cache }) });
	assert.match(guard({ toolName: "pdf", input: { pages: [1] } }).reason, /blocked pdf/);
});

test("the extension installs the guard and confines shell startup environment without breaking the agent home", async t => {
	const fixture = await confinementFixture(t);
	const handlers = new Map();
	const env = {...fixture.env, BASH_ENV: "/Users/example/.bashrc", ENV: "/Users/example/.profile", CDPATH: "/Users/example",
		PI_CODING_AGENT_DIR: join(fixture.home, "agent") };
	readerContext({ on(name, handler) { handlers.set(name, handler); } }, {cwd:fixture.cwd,env});
	assert.equal(env.HOME, fixture.cwd);
	assert.equal(env.BASH_ENV, undefined);
	assert.equal(env.ENV, undefined);
	assert.equal(env.CDPATH, undefined);
	assert.equal(env.PI_CODING_AGENT_DIR, join(fixture.home, "agent"));
	assert.match(handlers.get("tool_call")({ toolName: "bash", input: { command: "find /" } }).reason, /blocked bash/);
	assert.equal(handlers.get("tool_call")({ toolName: "bash", input: { command: fixture.checker } }), undefined);
});

test("non-PDF tool-enabled lanes keep their existing tools and environment", () => {
	const handlers = new Map(), env = { HOME: "/Users/example", BASH_ENV: "/Users/example/.bashrc" };
	readerContext({ on(name, handler) { handlers.set(name, handler); } }, {cwd:"/unused",env});
	assert.equal(handlers.has("tool_call"), false);
	assert.equal(env.HOME, "/Users/example");
	assert.equal(env.BASH_ENV, "/Users/example/.bashrc");
});

test("all new images reach the model before historical eviction", () => {
	const image = { type: "image", mimeType: "image/png", data: Buffer.alloc(100).toString("base64") };
	const original = Array.from({ length: 6 }, (_, i) => ({ role: "toolResult", toolCallId: `read-${i}`, content: [{ type: "text", text: `page ${i}` }, image] }));
	const result = boundImages(original, new Set(["read-0"]), 250, 4);
	assert.deepEqual(result.included, ["read-5", "read-4", "read-3", "read-2", "read-1"]);
	assert.equal(result.bytes, 500);
	assert.match(result.messages[0].content[1].text, /Earlier page/);
	assert.equal(result.messages[1].content[1].type, "image");
	const later = boundImages(original, new Set(original.map(m => m.toolCallId)), 250, 4);
	// §186.1: an overflow evicts down to half of each budget; half of 250 bytes holds one 100-byte image.
	assert.deepEqual(later.included, ["read-5"]);
	assert.deepEqual(later.evicted, ["read-0", "read-1", "read-2", "read-3", "read-4"]);
	assert.ok(original.every(m => m.content[1].type === "image"));
	assert.deepEqual(result.messages.map(m => m.toolCallId), original.map(m => m.toolCallId));
});

test("the newest image remains available even if it alone exceeds the soft budget", () => {
	const result = boundImages([{ role: "toolResult", toolCallId: "new", content: [{ type: "image", data: Buffer.alloc(300).toString("base64") }] }], new Set(), 100);
	assert.deepEqual(result.included, ["new"]);
});

test('§186.1: only a successful reply makes an image evictable, a submission keeps it, and an overflow evicts once in one batch',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'reader-image-delivery-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const log=join(dir,'images.jsonl'),hooks={};
 readerContext({on(name,fn){hooks[name]=fn;}},{cwd:dir,env:{PI_COC_READER_IMAGE_HISTORY:'2',PI_COC_READER_IMAGES_LOG:log}});
 const image={type:'image',mimeType:'image/jpeg',data:Buffer.alloc(100).toString('base64')};
 const page=n=>({role:'toolResult',toolCallId:`page-${n}`,content:[image]});
 const kinds=result=>result.messages.map(message=>message.content[0].type);
 const reply=stopReason=>{hooks.before_provider_request({payload:{}},{abort(){}});hooks.message_end({message:{role:'assistant',stopReason}});};
 assert.deepEqual(kinds(hooks.context({messages:[page(1)]})),['image']);
 reply('error');
 assert.deepEqual(kinds(hooks.context({messages:[page(1),page(2),page(3)]})),['image','image','image'],'a failed send cannot evict the first image');
 reply('toolUse');
 // Three delivered images over a budget of two: the oldest are evicted in one batch until one (half the budget) is left.
 assert.deepEqual(kinds(hooks.context({messages:[page(1),page(2),page(3)]})),['text','text','image']);
 reply('toolUse');
 await writeFile(join(dir,'draft.json'),JSON.stringify({nodes:[],claims:[]}));
 hooks.tool_execution_end?.({toolName:'submit_reading',isError:true});
 // The window refills: no earlier message changes until the budget overflows again, submission or not.
 assert.deepEqual(kinds(hooks.context({messages:[page(1),page(2),page(3),page(4)]})),['text','text','image','image'],'a submission keeps delivered images');
 reply('toolUse');
 assert.deepEqual(kinds(hooks.context({messages:[page(1),page(2),page(3),page(4),{...page(5),toolCallId:'explicit-reopen'}]})),['text','text','text','text','image'],
  'the next overflow evicts once more; an explicit reopen is a new first delivery');
 const rows=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
 assert.deepEqual(rows.filter(row=>row.event==='image_eviction'),[
  {event:'image_eviction',evicted:['page-1','page-2'],kept:1,bytes_before:300,bytes_after:100},
  {event:'image_eviction',evicted:['page-3','page-4'],kept:1,bytes_before:300,bytes_after:100}]);
 assert.deepEqual(rows.filter(row=>row.delivery==='succeeded').flatMap(row=>row.included),['page-3','page-2','page-1','page-3','page-4','page-3']);
});

test('§186.1: the reading image budget is data; an unreadable or invalid entry leaves the hook its own budget',async t=>{
 resetReadingImageBudgetCache();
 const shipped=JSON.parse(await readFile(join(ROOT,'content','rulesets','coc7','host-budgets.json'),'utf8'));
 assert.deepEqual(await readingImageBudget(join(ROOT,'content')),{count:shipped.reading_images.count});
 const root=await mkdtemp(join(tmpdir(),'reading-images-budget-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const [index,entry] of [undefined,{},{count:0},{count:1},{count:3.5},{count:'twelve'}].entries()){
  const dir=join(root,String(index));await mkdir(join(dir,'rulesets','coc7'),{recursive:true});
  await writeFile(join(dir,'rulesets','coc7','host-budgets.json'),JSON.stringify({schema_version:1,...(entry?{reading_images:entry}:{})}));
  assert.deepEqual(await readingImageBudget(dir),{count:undefined},JSON.stringify(entry));
 }
 const custom=join(root,'custom');await mkdir(join(custom,'rulesets','coc7'),{recursive:true});
 await writeFile(join(custom,'rulesets','coc7','host-budgets.json'),JSON.stringify({schema_version:1,reading_images:{count:7}}));
 assert.deepEqual(await readingImageBudget(custom),{count:7});
});

test('§186.1: an author viewing pages one at a time rewrites no earlier message until the shipped budget overflows, then once',async t=>{
 const {count:budget}=await readingImageBudget(join(ROOT,'content'));
 assert.ok(Number.isInteger(budget)&&budget>=2);
 const dir=await mkdtemp(join(tmpdir(),'reader-image-window-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const log=join(dir,'images.jsonl'),hooks={};
 readerContext({on(name,fn){hooks[name]=fn;}},{cwd:dir,env:{PI_COC_READER_IMAGE_HISTORY:String(budget),PI_COC_READER_IMAGES_LOG:log}});
 const messages=[{role:'user',content:[{type:'text',text:'Read the assigned pages.'}]}];
 let previous,rewrites=0;
 for(let n=1;n<=budget+2;n++){
  messages.push({role:'assistant',content:[{type:'toolCall',id:`page-${n}`,name:'pdf',arguments:{pages:[n]}}]},
   {role:'toolResult',toolCallId:`page-${n}`,content:[{type:'text',text:`Original physical page ${n}`},{type:'image',mimeType:'image/jpeg',data:Buffer.from(`page image ${n}`).toString('base64')}]});
  if(n===3){
   // A rejected submission and its fix loop: today it retired every delivered page and rewrote the whole prefix.
   messages.push({role:'assistant',content:[{type:'toolCall',id:'submit-1',name:'submit_reading',arguments:{}}]},{role:'toolResult',toolCallId:'submit-1',content:[{type:'text',text:'Rejected: fix the coverage object.'}],isError:true});
   hooks.tool_execution_end?.({toolName:'submit_reading',isError:true});
  }
  const projected=hooks.context({messages}).messages.map(message=>JSON.stringify(message));
  if(previous&&previous.some((message,index)=>projected[index]!==message))rewrites++;
  previous=projected;
  hooks.before_provider_request({payload:{}},{abort(){}});
  hooks.message_end({message:{role:'assistant',stopReason:'toolUse'}});
 }
 assert.equal(rewrites,1,'one rewrite: the batch at the first overflow');
 const evictions=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse).filter(row=>row.event==='image_eviction');
 assert.equal(evictions.length,1);
 assert.deepEqual(evictions[0].evicted,Array.from({length:budget+1-Math.floor(budget/2)},(_,i)=>`page-${i+1}`));
 assert.equal(evictions[0].kept,Math.floor(budget/2));
});

test('a host-projected original page receives an identity-bound receipt only after successful inference',async t=>{
 const fixture=await confinementFixture(t),bytes=Buffer.from('original page image');
 const imagePath=join(fixture.cache,'page-1.jpg');await writeFile(imagePath,bytes);
 const digest=value=>createHash('sha256').update(value).digest('hex');
 const sourceSha=digest(await readFile(fixture.source)),log=join(fixture.cwd,'host-images.jsonl');
 const env={...fixture.env,PI_COC_READER_SOURCE:JSON.stringify({pdf:fixture.source,cache:fixture.cache,file_sha256:sourceSha}),PI_COC_READER_IMAGES_LOG:log};
 const hooks={};readerContext({on(name,fn){hooks[name]=fn;}},{cwd:fixture.cwd,env});
 const message={role:'custom',customType:'coc-source-navigation',display:false,details:{kind:'host_source_pages',source_sha256:sourceSha,
  pages:[{page:1,path:imagePath,image_sha256:digest(bytes),box:[0,0,1,1]}]},content:[{type:'text',text:'Original page 1'},
  {type:'image',mimeType:'image/jpeg',data:bytes.toString('base64')}]};
 hooks.context({messages:[message]});hooks.before_provider_request({payload:{}},{abort(){}});
 hooks.message_end({message:{role:'assistant',stopReason:'error'}});
 assert.equal((await readFile(log,'utf8')).includes('host_pages'),false);
 hooks.context({messages:[message]});hooks.before_provider_request({payload:{}},{abort(){}});
 hooks.message_end({message:{role:'assistant',stopReason:'toolUse'}});
 const rows=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
 assert.deepEqual(rows.filter(row=>row.delivery==='succeeded').flatMap(row=>row.host_pages??[]).map(row=>row.page),[1]);
 hooks.tool_execution_end?.({toolName:'submit_reading',isError:true});
 assert.equal(hooks.context({messages:[message]}).messages[0].content[1].type,'image','§186.1: a submission no longer retires a delivered host page');
});

test("a host-owned provider request ceiling aborts before an extra model call", () => {
	const previous = process.env.PI_COC_READER_MAX_REQUESTS;
	process.env.PI_COC_READER_MAX_REQUESTS = "1";
	try {
		const hooks = {};
		readerContext({on(name, fn) { hooks[name] = fn; }});
		let aborted = 0;
		hooks.before_provider_request({}, {abort() { aborted++; }});
		assert.throws(() => hooks.before_provider_request({}, {abort() { aborted++; }}), /1-request limit/);
		assert.equal(aborted, 1);
	} finally {
		if (previous == null) delete process.env.PI_COC_READER_MAX_REQUESTS;
		else process.env.PI_COC_READER_MAX_REQUESTS = previous;
	}
});

test("§140: an unleased child sends its own output bound, so the provider's default never decides it", async t => {
	const dir = await mkdtemp(join(tmpdir(), "reader-output-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const log = join(dir, "requests.jsonl");
	const hooks = {};
	readerContext({ on(name, fn) { hooks[name] = fn; } }, { env: { PI_COC_READER_REQUESTS_LOG: log } });
	// The occ-check reviewer's model: opencode-go serves it over chat completions and declares 384,000 output tokens.
	const deepseek = { provider: "opencode-go", id: "deepseek-v4.1-flash", api: "openai-completions", maxTokens: 384000 };
	const payload = { model: "deepseek-v4.1-flash", reasoning_effort: "low", messages: [] };
	const sent = hooks.before_provider_request({ payload }, { model: deepseek, abort() {} });
	assert.equal(sent.max_tokens, 32768, "the reading's per-call bound, not the provider's unstated 8,192");
	assert.equal("max_tokens" in payload, false, "the original payload is not mutated");
	// A smaller bound already in the payload stands; a model whose ceiling is lower caps it; an unknown API is left alone.
	assert.equal(hooks.before_provider_request({ payload: { ...payload, max_tokens: 4000 } }, { model: deepseek, abort() {} }), undefined);
	assert.equal(hooks.before_provider_request({ payload }, { model: { ...deepseek, maxTokens: 16384 }, abort() {} }).max_tokens, 16384);
	assert.equal(hooks.before_provider_request({ payload }, { model: { ...deepseek, api: "some-new-api" }, abort() {} }), undefined);
	// Anthropic and Google shapes use their own fields.
	assert.equal(hooks.before_provider_request({ payload: { messages: [] } }, { model: { api: "anthropic-messages", maxTokens: 64000 }, abort() {} }).max_tokens, 32768);
	assert.deepEqual(hooks.before_provider_request({ payload: { contents: [] } }, { model: { api: "google-generative-ai", maxTokens: 65536 }, abort() {} }).config, { maxOutputTokens: 32768 });
	// The request log carries the bound each request actually went out with.
	const rows = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
	assert.deepEqual(rows.map((row) => row.output_bound), [32768, 4000, 16384, null, 32768, 32768]);

	// A Google adapter carries its own abort signal inside the payload; the clone keeps it by identity, as
	// boundProviderRequest does (b8307b19e), or every Gemini child call dies in 1 ms on `{}.addEventListener`.
	const controller = new AbortController();
	const google = hooks.before_provider_request({ payload: { contents: [], config: { abortSignal: controller.signal } } },
		{ model: { api: "google-generative-ai", maxTokens: 65536 }, abort() {} });
	assert.equal(google.config.abortSignal, controller.signal, "the same signal object, not a clone");
	assert.equal(google.config.maxOutputTokens, 32768);

	// A lease's per-call bound, when the host passes one, is the room instead.
	const leaseHooks = {};
	readerContext({ on(name, fn) { leaseHooks[name] = fn; } }, { env: { PI_COC_PROVIDER_OUTPUT_LIMIT: "20000" } });
	assert.equal(leaseHooks.before_provider_request({ payload }, { model: deepseek, abort() {} }).max_tokens, 20000);
});
