/** Durable, session-bound onboarding over the existing authenticated Host API. */
import type { ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

type Row = Record<string, any>;
const MAX_FILE = 128 * 1024 * 1024;
/** Two bounded model rounds plus worker startup; past this a card is a failure, not a wait. */
const PRESENTATION_DEADLINE_MS = 360_000;
/** Backoff between presentation attempts; its length is the retry budget. */
const PRESENTATION_RETRY_DELAYS_MS = [800, 2_400, 6_000] as const;
const CHUNK = 1024 * 1024;
/**
 * How long an `uploading` job may go without a chunk before it is reported as interrupted (§44).
 *
 * The pusher is a browser, not a child of this host, so there is nothing to ask whether it is
 * alive; the only evidence is the age of the last acknowledgement. Comfortably past the Host API's
 * 30 s request timeout, so a chunk still in flight is never called a stall, and past the slowest
 * chunk a real table has produced (a degraded stream managed a MiB every 6.7 s before it stopped).
 */
const UPLOAD_STALL_MS = 90_000;
/**
 * What the host says when a preparation worker stopped before it answered (§48).
 *
 * The worker says the same sentence for the same situation, because either of them may be the one
 * that has to speak; it is duplicated across a process boundary rather than shared, which is the
 * cost of the worker being a separate program. What must never appear here is the text of whatever
 * threw: a PDF vendor's, a provider SDK's, or the last 2000 bytes of the worker's stderr.
 */
const PREPARATION_STOPPED = 'The preparation stopped before it answered. Your source is saved; retry this preparation.';
/**
 * A host failure the preparation overlay can show (contract §23): the code it looks a word up by,
 * and an English message kept for the log. Prose is never the player's only explanation, because
 * the player does not necessarily read the system language.
 */
function refuse(code: string, message: string): Error {
  return Object.assign(new Error(message), {code});
}
/** What the overlay shows when a phase failed: the same pair, carried on the snapshot. */
type Refusal = {code: string; message: string};
function refusal(error: unknown, fallback: string): Refusal {
  const code = (error as {code?: unknown})?.code;
  return {code: typeof code === 'string' && code ? code : fallback,
    message: error instanceof Error ? error.message : String(error)};
}
/**
 * The caption keys the `errors` surface registers, read from the authored source (contract §46).
 *
 * A failure reaches the player as a code the renderer looks a caption up by (§23). A code nothing
 * registers has no caption, so the renderer falls back to `unknown` -- which names nothing. That is
 * what two stalled tables were shown for a kernel `needs`: a fold headed "this step did not go
 * through" over a sentence of English. The registration *is* this key set, not a second table
 * beside it: adding a caption to `content/ui/<source>/errors.json` registers its code and nothing
 * else has to change, and a code with no caption is settled to one that has.
 *
 * The authored tag comes from the data, so this reads no language and names none.
 */
const REGISTERED = new Map<string, Set<string> | null>();
function registeredCodes(contentRoot: string): Set<string> | null {
  if (!REGISTERED.has(contentRoot)) {
    let known: Set<string> | null = null;
    try {
      const source = JSON.parse(readFileSync(join(contentRoot, 'languages.json'), 'utf8')).source;
      const surface = JSON.parse(readFileSync(join(contentRoot, 'ui', String(source), 'errors.json'), 'utf8'));
      known = new Set(Object.keys(surface).filter(key => typeof surface[key] === 'string'));
    } catch { /* a build whose surface cannot be read registers nothing it can vouch for */ }
    REGISTERED.set(contentRoot, known);
  }
  return REGISTERED.get(contentRoot) ?? null;
}
/**
 * A refusal the player can be told about: a registered code, and the diagnostic behind it.
 *
 * An unregistered code is not thrown away -- it moves into the message, where the log belongs --
 * and `fallback` carries the player-facing meaning. The message stays whatever the failure
 * actually said; a host that writes its own sentence here writes it in the system language, and
 * the overlay would put that sentence in front of a player who chose another (BUG-039).
 */
function captioned(contentRoot: string, settled: Refusal, fallback: string): Refusal {
  const known = registeredCodes(contentRoot);
  if (!known || known.has(settled.code)) return settled;
  return {code: fallback, message: settled.code ? `${settled.code}: ${settled.message}` : settled.message};
}
/**
 * The product's own captions for one play language.
 *
 * `projected` says whether they are written in `tag` (contract §23, 2026-09-09): false is the
 * authored words standing in while the projection lane runs, and the overlay redraws when it lands.
 */
export type CocUiWords = {tag: string; words: Record<string, Record<string, string>>;
  projected: boolean; source: 'seed' | 'cache' | 'default'};
/**
 * The play languages and their words, from the emitted runtime entry.
 *
 * `runtime/ui-words.ts` is the one definition of both, and this file reaches it the way the rest of
 * the host reaches the repository's own modules: by importing what `build:runtime` emitted. It is
 * loaded here rather than borrowed from `coc-view.ts` because the preparation test runs this class
 * straight off its TypeScript source under bare Node, where a compiled sibling's specifier does not
 * resolve; the cache below is this module's own for the same reason.
 */
const UI_ENTRY = 'build/runtime/ui-words.mjs';
const WORDS = new Map<string, Promise<CocUiWords | undefined>>();
function uiModule(repo: string): Promise<any> {
  return import(pathToFileURL(resolve(repo, UI_ENTRY)).href);
}
/**
 * Words for `tag`, kept per content root and tag: the overlay polls its status while a source is
 * being read, and the words behind it never change while it does. A build whose words cannot be
 * read answers with no `ui` at all, so the overlay draws identifiers rather than a language.
 */
function uiWords(repo: string, contentRoot: string, home: string, tag: unknown): Promise<CocUiWords | undefined> {
  const key = JSON.stringify([repo, contentRoot, home, typeof tag === 'string' ? tag : null]);
  let pending = WORDS.get(key);
  if (!pending) {
    pending = uiModule(repo).then(module => module.resolveUiWords({contentRoot, home, tag}) as Promise<CocUiWords>)
      .catch(() => {WORDS.delete(key); return undefined;});
    WORDS.set(key, pending);
  }
  return pending;
}
/** Drop what is held for one tag, because this host's own projection lane has just cached it. */
function forgetUiWords(repo: string, contentRoot: string, home: string, tag: unknown): void {
  WORDS.delete(JSON.stringify([repo, contentRoot, home, typeof tag === 'string' ? tag : null]));
}
export type CocOnboardingOptions = {repo:string; home:string; agentDir:string; env:NodeJS.ProcessEnv;
  layout?:'source'|'compiled';
  contentRoot?:string; nodeExecutable?:string; backend?:'typescript'; kernelEntrypoint?:string;
  preparationEntrypoint?:string;
  preparationEnv?:(projectRoot:string)=>Promise<NodeJS.ProcessEnv>};
type PreparationHost = {home:string; start(action:string,input:Row,signal?:AbortSignal,env?:NodeJS.ProcessEnv):{
  child:ChildProcessByStdio<null,Readable,Readable>; closed:Promise<void>; close():Promise<void>}};
export class CocOnboardingHost {
  private presentations = new Map<string,{task:Promise<Row>;result?:Row;error?:unknown}>();
  /** One background caption projection per tag (contract §23); a failed one waits for `retryUiWords`. */
  private wordJobs = new Map<string,{task:Promise<void>;failed:boolean}>();
  private documentReadings = new Map<string,{result?:Row;error?:unknown}>();
  private root: string;
  private options: CocOnboardingOptions;
  private preparation: Promise<PreparationHost>;
  private lifetime = new AbortController();
  private closing?: Promise<void>;
  private running = new Set<Promise<unknown>>();
  private children = new Map<string, AbortController>();
  private busy = new Set<string>();
  constructor(options: CocOnboardingOptions) {
    this.options = {...options, env: {...options.env}};
    this.root = join(options.home, '.coc/imports');
    // Both source builds and packages supply the emitted host adapter, never a TS loader.
    this.preparation = import(pathToFileURL(options.preparationEntrypoint || join(options.repo, 'build/runtime/preparation.mjs')).href).then(module => {
      const host:PreparationHost = module.createPreparationHost(this.options.home, {
        layout:this.options.layout, resourceRoot:this.options.repo, contentRoot:this.options.contentRoot, agentHome:this.options.agentDir,
        nodeExecutable:this.options.nodeExecutable, backend:this.options.backend,
        kernelEntrypoint:this.options.kernelEntrypoint, env:this.options.env,
      });
      this.options.home = host.home;
      this.root = join(host.home, '.coc/imports');
      return host;
    });
    void this.preparation.catch(() => undefined);
  }
  /** The content root this host reads its data from, resolved as `runtime/host.ts` resolves it. */
  private get contentRoot(): string {
    return resolve(this.options.repo, this.options.contentRoot ?? this.options.env.PI_COC_CONTENT_ROOT ?? 'content');
  }
  /**
   * The chrome's words for one play language, so the overlay never has to name a language itself.
   *
   * A tag with no projection yet answers with the authored words and `projected: false` — the
   * overlay draws at once — and one background projection starts for it. When that lands the held
   * answer is dropped, and the overlay's next poll carries the player's own words.
   */
  private words(tag: unknown): Promise<CocUiWords | undefined> {
    const pending = uiWords(this.options.repo, this.contentRoot, this.options.home, tag);
    void pending.then(ui => {if (ui && !ui.projected) void this.projectUiWords(ui.tag).catch(() => undefined);});
    return pending;
  }
  /**
   * Project this tag's captions once, in the background.
   *
   * Idempotent per tag for the life of this host, which is one per home: the overlay polls its
   * status every second and the sheet is read on every commit, so a run started per read would run
   * the same lane a dozen times a turn. A run that failed is not retried on its own -- the words on
   * the screen are correct English, not a broken panel -- and `retryUiWords` is the player's retry.
   * The host that asked awaits the returned promise to know when its own panels should redraw.
   */
  projectUiWords(tag: string): Promise<void> {
    const running = this.wordJobs.get(tag);
    if (running) return running.task;
    const task = (async () => {
      await this.presentation({ui: true, play_language: tag, home: this.options.home});
      forgetUiWords(this.options.repo, this.contentRoot, this.options.home, tag);
    })();
    this.wordJobs.set(tag, {task, failed: false});
    void task.then(() => {this.wordJobs.delete(tag);}, () => {
      const job = this.wordJobs.get(tag);
      if (job) job.failed = true;
    });
    return task;
  }
  /** Forget the projections that failed, so the next answer starts them again. */
  retryUiWords(): void {
    for (const [tag, job] of this.wordJobs) if (job.failed) this.wordJobs.delete(tag);
  }
  private async withWords(answer: Row, tag: unknown): Promise<Row> {
    const ui = await this.words(tag);
    return ui ? {...answer, ui} : answer;
  }
  /** The tag for what the player asked for, settled by shape; the data's default when they asked for nothing. */
  private async playLanguage(tag: unknown): Promise<string> {
    const settled = await uiModule(this.options.repo)
      .then(module => module.playLanguageTag(this.contentRoot, tag) as Promise<string>).catch(() => undefined);
    if (!settled) throw refuse('runtime_unavailable', 'The play languages this build offers are unreadable');
    return settled;
  }
  private folder(id: string) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw refuse('unknown_import', 'Unknown import');
    return join(this.root, id);
  }
  private load(id: string, session: string): Row {
    const job = JSON.parse(readFileSync(join(this.folder(id), 'job.json'), 'utf8'));
    if (job.session !== session) throw refuse('import_other_session', 'This import belongs to another session');
    if(!job.preparation) {
      const prepared=['ready','conversing','created'].includes(job.state);
      job.preparation={guidance:{state:job.guidance?'ready':job.state==='choice'?'needs_choice':job.state==='failed'?'failed':'paused',candidates:job.candidates,error:job.error},
        opening:{state:prepared?'ready':'queued'}};
      job.start_scene ||= job.guidance?.scene;
    }
    return job;
  }
  private save(job: Row) {
    const path = join(this.folder(job.id), 'job.json');
    writeFileSync(path + '.tmp', JSON.stringify(job, null, 2) + '\n'); renameSync(path + '.tmp', path);
  }
  private patch(job:Row, change:Row):Row {
    const next={...this.load(job.id,job.session),...change};this.save(next);return next;
  }
  private phaseKey(job:Row, phase:string) {return job.id+':'+phase;}
  /**
   * Whether an upload has bytes outstanding, whoever stopped it and why.
   *
   * A paused upload is one of these: pausing stops the reading phases, and there is no reading yet.
   * Saying so here is what lets the next chunk land on the prefix already on disk instead of
   * starting a 44 MB book over -- `lede.job` promises the progress is kept.
   */
  private incompleteUpload(job:Row):boolean {
    return job.source==='pdf' && !job.module_id && ['uploading','paused'].includes(job.state) &&
      typeof job.size==='number' && typeof job.received==='number' && job.received<job.size;
  }
  /**
   * Whether nobody is pushing bytes into an `uploading` job any more (§44).
   *
   * Two real tables froze at 9 MiB and 8 MiB of the same book with the job still reading
   * `uploading`, and the overlay went on drawing a progress bar over a stream that had stopped --
   * for fourteen minutes on one of them. The phases have asked "is anyone still working?" since
   * they were written (`state:'running' && !alive`); the upload never asked, because its worker is
   * a browser. The last acknowledgement's age is the same question in the only form available.
   *
   * This is read on the way out and never written back: the job stays `uploading` on disk so the
   * very next chunk is still accepted. Reporting "interrupted" and then refusing the resumed bytes
   * would be the same lie in the other direction.
   */
  private stalledUpload(job:Row):boolean {
    if(job.state!=='uploading')return false;
    const window=Number(this.options.env.PI_COC_UPLOAD_STALL_MS)||UPLOAD_STALL_MS;
    return Date.now()-(typeof job.received_at==='number'?job.received_at:0)>window;
  }
  private snapshot(job: Row): Row {
    let indexed=0, pages=job.pages||0, character='not_started',waitingForOpening=false,playing=false,handoffCommitted=false;
    if(job.module_id)try {
      const meta=JSON.parse(readFileSync(join(this.options.home,'.coc/modules',job.module_id,'module.json'),'utf8'));
      indexed=meta.reading?.viewed_pages?.length||0;pages=meta.page_count||pages;
    }catch{}
    if(job.campaign)try {
      const meta=JSON.parse(readFileSync(join(this.options.home,'.coc/campaigns',job.campaign,'campaign.json'),'utf8'));
      character=meta.setup?.confirmed_revision||meta.setup?.handoff?'confirmed':meta.setup?.draft_revision?'draft':'conversing';
      waitingForOpening=meta.setup?.waiting_for_opening===true;
      handoffCommitted=!!meta.setup?.handoff;playing=!['setting_up','ready_for_table'].includes(meta.status);
    }catch{}
    const phase=(name:string)=>{
      const saved=job.preparation?.[name]||{state:'queued'};
      const alive=this.children.has(this.phaseKey(job,name));
      // The player's explanation is the code's caption; the message is the diagnostic, for the log
      // behind the fold. This used to replace the diagnostic with a sentence written here, which
      // discarded what actually failed *and* put English in front of a player who chose another
      // language (BUG-039). Codes are settled on the way out as well as on the way in, so a job
      // recorded before this rule still answers with a caption the renderer can find.
      const failure=saved.state==='failed'
        ? captioned(this.contentRoot,{code:typeof saved.code==='string'?saved.code:'',
            message:typeof saved.error==='string'?saved.error:''},'preparation_failed')
        : undefined;
      return {stage:saved.stage,progress:saved.progress,candidates:saved.candidates,error:failure,
        state:saved.state==='running'&&!alive?'paused':saved.state,stopping:saved.state==='paused'&&alive};
    };
    const guidance=phase('guidance'),opening=phase('opening');
    const current=guidance.state==='ready'?opening:guidance;
    const canConverse=guidance.state==='ready';
    const written=job.state==='conversing'?'conversing':canConverse?'ready':current.state==='needs_choice'?'choice':
      ['paused','failed'].includes(current.state)?current.state:job.state;
    // An upload nobody is pushing is reported as stopped, with the refusal the player would get
    // for resuming it, so the overlay offers continuing instead of a progress bar that never moves.
    const stalled=written==='uploading'&&this.stalledUpload(job);
    const state=stalled?'paused':written;
    const interrupted=stalled?{code:'upload_retry',
      message:'No upload bytes have arrived for some time; send the file again from where it stopped.'}:undefined;
    return {id:job.id,name:job.name,source:job.source,size:job.size,received:job.received,state,pages,indexed,
      stage:current.stage,reviewed:current.progress?.reviewed,reviewTotal:current.progress?.review_total,
      activeReaders:current.progress?.activeReaders||0,stopping:current.stopping,
      candidates:current.candidates,
      error:interrupted||current.error||(job.error?captioned(this.contentRoot,
        {code:typeof job.error_code==='string'?job.error_code:'',message:String(job.error)},'preparation_failed'):undefined),
      preparation:{guidance,opening},character:{state:character},canConverse,
      canHandoff:character==='confirmed'&&(waitingForOpening||handoffCommitted)&&opening.state==='ready'&&!playing,playing,hidden:!!job.hidden,
      model:job.model,thinking:job.thinking,campaign:job.campaign,play_language:job.play_language};
  }
  private run(action: string, data: Row, job?: Row, phase?:string, attempt?:string, external?: AbortController): Promise<any> {
    if(this.lifetime.signal.aborted)return Promise.reject(refuse('runtime_unavailable','The onboarding host is closed'));
    const key=job?this.phaseKey(job,phase||action):undefined;
    const controller=external??new AbortController();
    if(key)this.children.set(key,controller);
    const signal=AbortSignal.any([this.lifetime.signal,controller.signal]);
    const task=(async()=>{
      const host=await this.preparation;
      const env=await this.options.preparationEnv?.(this.options.repo);
      const process=host.start(action,data,signal,env);
      const child=process.child;
      const output=new Promise((resolve, reject) => {
        let pending = '', tail = '', result: any, failure: any;
        child.stderr.on('data', chunk => {tail = (tail + chunk).slice(-2000);});
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => {
          pending += chunk;
          let end: number;
          while ((end = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, end); pending = pending.slice(end + 1);
            let event: any;
            try {event = JSON.parse(line);} catch {continue;}
            if (event.type === 'result') result = event.data;
            if (event.type === 'error') failure = event.data;
            if(job && phase && event.type==='progress') {const latest=this.load(job.id,job.session);const state=latest.preparation?.[phase];if(state?.attempt===attempt && state.state==='running')this.patch(latest,{preparation:{...latest.preparation,[phase]:{...state,stage:event.data.stage,progress:event.data}}});}
            if (job) appendFileSync(join(this.folder(job.id), 'events.jsonl'), JSON.stringify({at: new Date().toISOString(), ...event}) + '\n');
          }
        });
        child.on('error', error => {failure ||= error;});
        child.on('close', code => {
          if (signal.aborted || code !== 0 || failure || result === undefined) {
            // A worker that died without an error event leaves only stderr, and stderr is a
            // diagnostic -- stack, paths, whatever a vendor printed -- never a sentence written
            // for a player (§48). It goes to this import's event log, which is where the rest of
            // the worker's account already goes; what the overlay reads is a sentence of ours.
            if (job && !failure && tail) try {
              appendFileSync(join(this.folder(job.id), 'events.jsonl'),
                JSON.stringify({at: new Date().toISOString(), type: 'diagnostic', data: {stderr: tail}}) + '\n');
            } catch { /* the refusal still stands without its log line */ }
            const refused = Object.assign(refuse('interrupted', PREPARATION_STOPPED), failure || {});
            // Assigning the worker's fields back would carry its message too, so the sentence is
            // settled last: the worker's own when it wrote one, ours otherwise.
            refused.message = typeof failure?.message === 'string' && failure.message ? failure.message : PREPARATION_STOPPED;
            reject(refused);
          }
          else resolve(result);
        });
      });
      return (await Promise.all([output,process.closed]))[0];
    })().finally(()=>{
      if(key&&this.children.get(key)===controller)this.children.delete(key);
      this.running.delete(task);
    });
    this.running.add(task);
    return task;
  }
  private prepare(job:Row,retry=false) {
    const phase=job.preparation?.guidance?.state==='ready'?'opening':'guidance';
    const key=this.phaseKey(job,phase);
    if(this.children.has(key))return;
    const attempt=randomUUID();
    job=this.patch(job,{state:job.campaign?'conversing':'preparing',error:undefined,error_code:undefined,
      preparation:{...job.preparation,[phase]:{state:'running',stage:phase,attempt}}});
    void this.run(phase,{...job,retry},job,phase,attempt).then(result=>{
      const latest=this.load(job.id,job.session);
      if(latest.preparation?.[phase]?.attempt!==attempt||latest.preparation[phase].state!=='running')return;
      const next=this.patch(latest,{module_id:result.module_id||latest.module_id,
        ...(phase==='guidance'?{guidance:result.guidance,guidance_key:result.guidance_key,start_scene:result.guidance.scene,state:latest.campaign?'conversing':'ready'}:{}),
        preparation:{...latest.preparation,[phase]:{state:'ready',stage:'ready',attempt},
          ...(result.opening_ready?{opening:{state:'ready',stage:'ready'}}:{})}});
      if(phase==='guidance'&&next.preparation.opening?.state!=='ready')this.prepare(next);
    }).catch(error=>{
      const latest=this.load(job.id,job.session);
      if(latest.preparation?.[phase]?.attempt!==attempt||latest.preparation[phase].state!=='running')return;
      const failed=captioned(this.contentRoot,refusal(error,'preparation_failed'),'preparation_failed');
      this.patch(latest,{preparation:{...latest.preparation,[phase]:{state:error.code==='needs_choice'?'needs_choice':'failed',
        attempt,error:failed.message,code:failed.code,candidates:error.candidates}}});
    });
  }
  async invoke(params: Row, session: string, model: {id: string; thinking: string; vision: boolean}): Promise<Row> {
    await this.preparation;
    if(this.lifetime.signal.aborted)throw refuse('runtime_unavailable','The onboarding host is closed');
    if(params.action==='current') {
      let latest:Row|undefined,modified=0;
      if(session&&existsSync(this.root))for(const id of readdirSync(this.root))try {
        const job=this.load(id,session),time=statSync(join(this.folder(id),'job.json')).mtimeMs;
        if(!job.dismissed&&time>=modified){latest=job;modified=time;}
      }catch{}
      return this.withWords({current_import:latest?this.snapshot(latest):null},latest?.play_language??params.play_language);
    }
    if (params.action === 'catalog') {
      const language = await this.playLanguage(params.play_language);
      const catalog = await this.run('catalog', {play_language: language});
      const imports: Array<{job: Row; modified: number}> = [];
      if (session && existsSync(this.root)) for (const id of readdirSync(this.root)) {
        try {
          const job = this.load(id, session);
          if (!job.dismissed) imports.push({job, modified: statSync(join(this.folder(id), 'job.json')).mtimeMs});
        } catch { /* another session's or incomplete imports are not candidates */ }
      }
      imports.sort((a,b) => b.modified - a.modified);
      return this.withWords({...catalog, current_import: imports[0] ? this.snapshot(imports[0].job) : null},language);
    }
    mkdirSync(this.root, {recursive: true});
    if (params.action === 'begin' || params.action === 'select') {
      if (params.action === 'begin' && (!Number.isSafeInteger(params.size) || params.size < 5 || params.size > MAX_FILE ||
        typeof params.name !== 'string' || !params.name.toLowerCase().endsWith('.pdf'))) throw refuse('upload_too_large', 'Choose a PDF of up to 128 MiB');
      if (!model.vision && params.source !== 'starter') throw refuse('model_without_images', 'Choose a model with image input');
      // An undeclared tag is refused rather than quietly replaced: the player picked a language.
      const language = await this.playLanguage(params.play_language);
      if (params.play_language && params.play_language !== language) throw refuse('invalid_params', 'Invalid play language');
      // `received_at` starts now, so an upload that never gets its first byte goes quiet on the
      // same clock as one that stops halfway (§44) -- the §43 table froze at exactly zero.
      const job: Row = {play_language: language, id: randomUUID(), session, name: params.name, size: params.size || 0, received: 0, received_at: Date.now(),
        source: params.action === 'begin' ? 'pdf' : params.source, module_id: params.module_id,
        preparation:{guidance:{state:'queued'},opening:{state:'queued'}}, model: model.id, thinking: model.thinking, state: params.action === 'begin' ? 'uploading' : 'preparing'};
      mkdirSync(this.folder(job.id)); this.save(job);
      if (params.action === 'begin') writeFileSync(join(this.folder(job.id), 'source.pdf'), '');
      else {
        if (!['starter','module'].includes(job.source) || typeof job.module_id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(job.module_id)) throw refuse('invalid_params', 'Choose a listed scenario');
        this.prepare(job);
      }
      return this.withWords(this.snapshot(job),job.play_language);
    }
    const job = this.load(params.id, session);
    if (params.action === 'status') return this.withWords(this.snapshot(job),job.play_language);
    // Hiding the status overlay is a player preference, not an operation on the import: it must
    // work while other work runs, and unlike `dismiss` (choose another scenario) it leaves the
    // job as `current`. Only a finished preparation may be hidden — the overlay is the only
    // place holding pause, resume and retry.
    if (params.action === 'hide') {
      if (job.preparation?.opening?.state !== 'ready') throw refuse('scenario_not_ready', 'Hide the status once the opening is ready');
      return this.withWords(this.snapshot(this.patch(job, {hidden: true})),job.play_language);
    }
    if (this.busy.has(job.id)) throw refuse('operation_in_progress', 'This operation is already in progress');
    this.busy.add(job.id);
    try {
      if (params.action === 'chunk') {
        // Any upload with bytes outstanding takes them, left `uploading` or paused: the offset is
        // still this host's own count, so a lost acknowledgement cannot double-write the file, and
        // a stream that stopped resumes onto the prefix rather than beginning a book again.
        if (!this.incompleteUpload(job) || params.offset !== job.received || typeof params.data !== 'string' || params.data.length > Math.ceil(CHUNK / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(params.data)) throw refuse('upload_chunk_invalid', 'Invalid upload chunk or offset');
        const bytes = Buffer.from(params.data, 'base64');
        if (!bytes.length || bytes.length > CHUNK || job.received + bytes.length > job.size) throw refuse('upload_size_mismatch', 'Upload size mismatch');
        appendFileSync(join(this.folder(job.id), 'source.pdf'), bytes); job.received += bytes.length; job.received_at = Date.now();
        // Reopening restores the phases a pause stopped; leaving them paused would report a paused
        // job over a stream that is moving, which is the same lie the stall reading exists to end.
        if (job.state !== 'uploading') {job.state = 'uploading'; job.preparation = {guidance:{state:'queued'},opening:{state:'queued'}};}
        this.save(job);
      } else if (params.action === 'finish') {
        const path = join(this.folder(job.id), 'source.pdf');
        if (job.state !== 'uploading' || job.received !== job.size || statSync(path).size !== job.size) throw refuse('upload_incomplete', 'Upload is incomplete');
        job.state = 'inspecting'; this.save(job);
        try {
          const inspected = await this.run('inspect', {pdf: path, name: job.name}, job);
          const bound=this.patch(job,{module_id:inspected.module_id,pages:inspected.page_count});this.prepare(bound);
        } catch (error) {const failed=captioned(this.contentRoot,refusal(error,'preparation_failed'),'preparation_failed');
          job.state = 'failed'; job.error = failed.message; job.error_code = failed.code; this.save(job);}
      } else if (params.action === 'pause') {
        const targets=params.target==='all'||job.preparation?.guidance?.state!=='ready'?['guidance','opening']:['opening'];
        const preparation={...job.preparation};
        for(const target of targets)if(preparation[target]?.state!=='ready')preparation[target]={...preparation[target],state:'paused'};
        this.patch(job,{state:job.campaign?'conversing':'paused',preparation});
        for(const target of targets)this.children.get(this.phaseKey(job,target))?.abort();
      } else if (params.action === 'resume' || params.action === 'opening') {
        if (!model.vision && job.source !== 'starter') throw refuse('model_without_images', 'Choose a model with image input');
        if (!job.module_id) {
          const path=join(this.folder(job.id),'source.pdf');
          if(job.received!==job.size||!existsSync(path))throw refuse('upload_retry', 'Select the PDF again to retry its upload');
          const inspected=await this.run('inspect',{pdf:path,name:job.name},job);
          Object.assign(job,this.patch(job,{module_id:inspected.module_id,pages:inspected.page_count}));
        }
        if(params.scene&&job.campaign)throw refuse('opening_bound', 'The opening is already bound to character creation');
        const updated=this.patch(job,{start_scene:params.scene||job.start_scene,model:model.id,thinking:model.thinking});
        this.prepare(updated,true);
      } else if (params.action === 'dismiss') {
        // Choosing another scenario waits for live work -- but an upload nobody is pushing is not
        // live work, and refusing there leaves the player shut inside a screen nothing is moving.
        if ([...this.children.keys()].some(key=>key.startsWith(job.id+':')) ||
          (['uploading','inspecting'].includes(job.state) && !this.stalledUpload(job))) throw refuse('preparation_pause_first', 'Pause preparation before choosing another scenario');
        job.dismissed = true; this.save(job);
      } else if (params.action === 'converse') {
        if(job.preparation?.guidance?.state!=='ready') throw refuse('guidance_not_ready', 'Wait for the scenario guidance to be ready');
        if(!job.guidance)throw refuse('guidance_unavailable', 'Accepted guidance is unavailable');
        job.campaign ||= 'game-' + randomUUID(); this.save(job);
        // The host injects the extension's difficulty setting (contract §33.1); it is not a
        // player-editable import field, so only the converse run input carries it, never the job.
        const difficulty=params.difficulty&&typeof params.difficulty==='object'&&!Array.isArray(params.difficulty)?{difficulty:params.difficulty}:{};
        await this.run('converse', {...job,title:job.name,play_language:job.play_language??await this.playLanguage(undefined),...difficulty},job);
        this.patch(job,{state:'conversing'});
      } else throw refuse('unknown_action', 'Unknown onboarding action');
      return this.withWords(this.snapshot(this.load(job.id,session)),job.play_language);
    } finally {this.busy.delete(job.id);}
  }
  presentation(data:Row):Promise<Row> {
    return this.presentationJob(data).task;
  }
  /**
   * A presentation run is bounded, because an unbounded one is a card that never appears.
   *
   * The status poll answers `{pending:true}` for as long as the job has neither result nor error,
   * and nothing else was watching the worker: a child that emitted its result but never exited,
   * or stalled before it, left the job pending for the life of the process and the card showing
   * its loading ellipsis with no retry to offer. A deadline turns that into a failure the player
   * can act on, and cancels the worker instead of leaving it behind.
   *
   * The deadline covers the retries too, and the retries live here rather than beside a caller.
   * A projection generates through a model, so a child that dies on spawn or a provider that
   * answers 500 is an ordinary event the player should never have to see — but a failed job is
   * kept on purpose, because `presentationStatus` is a one-shot mailbox and the card's poll is
   * the only thing that turns a failure into a control the player can press. A retry outside
   * this method therefore cannot retry at all: it joins the job it already failed and re-awaits
   * the same rejection. Retrying inside keeps the job unsettled while attempts remain, so the
   * poll goes on answering `{pending:true}` and the mailbox only ever holds a final failure
   * (§72).
   */
  private runPresentation(data:Row):Promise<Row> {
    const limit=Number(this.options.env.PI_COC_PRESENTATION_DEADLINE_MS)||PRESENTATION_DEADLINE_MS;
    return this.attemptPresentation(data,Date.now()+limit,0);
  }
  private async attemptPresentation(data:Row,deadline:number,attempt:number):Promise<Row> {
    try {return await this.boundedPresentation(data,deadline);}
    catch(error) {
      const delay=PRESENTATION_RETRY_DELAYS_MS[attempt];
      // One deadline for the whole job keeps the player's worst case what it always was: an
      // attempt that burned the entire deadline has already made them wait, and giving it a
      // fresh one would only make the wait longer.
      if(delay===undefined||Date.now()+delay>=deadline)throw error;
      await new Promise<void>(resolve=>{const timer=setTimeout(resolve,delay);timer?.unref?.();});
      return this.attemptPresentation(data,deadline,attempt+1);
    }
  }
  private boundedPresentation(data:Row,deadline:number):Promise<Row> {
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const bounded=new Promise<never>((_resolve,reject)=>{
      timer=setTimeout(()=>{
        controller.abort();
        reject(refuse('presentation_timeout', 'The card presentation did not finish in time; retry it'));
      },Math.max(0,deadline-Date.now()));
      timer?.unref?.();
    });
    return Promise.race([this.run('presentation',data,undefined,undefined,undefined,controller),bounded])
      .finally(()=>clearTimeout(timer));
  }
  documentPresentationStatus(data:Row):Row {
    const key=JSON.stringify([data.campaign,data.actor,data.name,data.version,data.play_language]);
    let job=this.documentReadings.get(key);
    if(!job) {
      job={};this.documentReadings.set(key,job);
      const current=job;
      void this.run('document-presentation',data).then(result=>{current.result=result;},error=>{current.error=error;});
      if(this.documentReadings.size>64)for(const [old,value] of this.documentReadings) {
        if(old!==key&&(value.result||value.error)){this.documentReadings.delete(old);break;}
      }
    }
    if(job.error){this.documentReadings.delete(key);throw job.error;}
    return job.result||{pending:true};
  }
  presentationStatus(data:Row):Row {
    const job=this.presentationJob(data);
    if(job.error){this.presentations.delete(this.presentationKey(data));throw job.error;}
    return job.result||{pending:true};
  }
  /** The growing lanes: each is its own job, and a finished one is not kept, so the next word starts a fresh run. */
  private static readonly GROWING_LANES=['standing','possessions','clues','languages'] as const;
  private presentationKey(data:Row) {
    return JSON.stringify([data.campaign,data.revision,data.play_language,...CocOnboardingHost.GROWING_LANES.map(lane=>data[lane]===true)]);
  }
  private presentationJob(data:Row) {
    const key=this.presentationKey(data);
    if(!this.presentations.has(key)) {
      const job:{task:Promise<Row>;result?:Row;error?:unknown}={task:Promise.resolve({})};
      this.presentations.set(key,job);
      job.task=this.runPresentation(data).then(result=>{job.result=result;return result;},error=>{job.error=error;throw error;})
        .finally(()=>{if(CocOnboardingHost.GROWING_LANES.some(lane=>data[lane]))this.presentations.delete(key);});
      void job.task.catch(()=>undefined);
    }
    return this.presentations.get(key)!;
  }
  dispose() {
    if(this.lifetime.signal.aborted)return;
    for (const [key] of this.children) {
      const [id,phase]=key.split(':');
      try {
        const job = JSON.parse(readFileSync(join(this.folder(id), 'job.json'), 'utf8'));
        if(job.preparation?.[phase]?.state==='running'){job.preparation[phase].state='paused';this.save(job);}
      } catch { /* retain any available evidence if the job file is unavailable */ }
    }
    this.lifetime.abort();
  }
  close():Promise<void> {
    if(this.closing)return this.closing;
    this.dispose();
    return this.closing=Promise.allSettled([...this.running]).then(results=>{
      const failed=results.find((result):result is PromiseRejectedResult=>result.status==='rejected'&&
        (result.reason?.reason==='runtime_shutdown'||result.reason?.details?.reason==='runtime_shutdown'));
      if(failed)throw failed.reason;
    });
  }
}

/** An application owns only preparation; WebSocket session backends remain separate. */
export class CocOnboardingRegistry {
  private hosts=new Map<string,CocOnboardingHost>();
  get(options:CocOnboardingOptions):CocOnboardingHost {
    const key=JSON.stringify([options.repo,options.home,options.agentDir,options.layout,options.contentRoot,options.nodeExecutable,options.backend,options.kernelEntrypoint,options.preparationEntrypoint]);
    if(!this.hosts.has(key))this.hosts.set(key,new CocOnboardingHost(options));
    return this.hosts.get(key)!;
  }
  dispose(){for(const host of this.hosts.values())host.dispose();this.hosts.clear();}
  async close(){try{await Promise.all([...this.hosts.values()].map(host=>host.close()));}finally{this.hosts.clear();}}
}
