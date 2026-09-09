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
const CHUNK = 1024 * 1024;
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
/** The product's own captions for one play language: `{tag, words: {surface: {key: word}}}`. */
export type CocUiWords = {tag: string; words: Record<string, Record<string, string>>};
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
function uiWords(repo: string, contentRoot: string, tag: unknown): Promise<CocUiWords | undefined> {
  const key = JSON.stringify([repo, contentRoot, typeof tag === 'string' ? tag : null]);
  let pending = WORDS.get(key);
  if (!pending) {
    pending = uiModule(repo).then(module => module.loadUiWords(contentRoot, tag) as Promise<CocUiWords>)
      .catch(() => {WORDS.delete(key); return undefined;});
    WORDS.set(key, pending);
  }
  return pending;
}
export type CocOnboardingOptions = {repo:string; home:string; agentDir:string; env:NodeJS.ProcessEnv;
  layout?:'source'|'compiled';
  contentRoot?:string; nodeExecutable?:string; backend?:'python'|'typescript'; kernelEntrypoint?:string;
  preparationEntrypoint?:string};
type PreparationHost = {home:string; start(action:string,input:Row,signal?:AbortSignal):{
  child:ChildProcessByStdio<null,Readable,Readable>; closed:Promise<void>; close():Promise<void>}};
export class CocOnboardingHost {
  private presentations = new Map<string,{task:Promise<Row>;result?:Row;error?:unknown}>();
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
  /** The chrome's words for one play language, so the overlay never has to name a language itself. */
  private words(tag: unknown): Promise<CocUiWords | undefined> {
    return uiWords(this.options.repo, this.contentRoot, tag);
  }
  private async withWords(answer: Row, tag: unknown): Promise<Row> {
    const ui = await this.words(tag);
    return ui ? {...answer, ui} : answer;
  }
  /** The declared tag for what the player asked for; the data's default when they asked for nothing. */
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
      return {stage:saved.stage,progress:saved.progress,candidates:saved.candidates,
        error:saved.state==='failed'?{code:typeof saved.code==='string'&&saved.code?saved.code:'preparation_failed',
          message:'Source preparation could not finish. Your source and investigator are saved; retry this preparation.'}:undefined,
        state:saved.state==='running'&&!alive?'paused':saved.state,stopping:saved.state==='paused'&&alive};
    };
    const guidance=phase('guidance'),opening=phase('opening');
    const current=guidance.state==='ready'?opening:guidance;
    const canConverse=guidance.state==='ready';
    const state=job.state==='conversing'?'conversing':canConverse?'ready':current.state==='needs_choice'?'choice':
      ['paused','failed'].includes(current.state)?current.state:job.state;
    return {id:job.id,name:job.name,source:job.source,size:job.size,received:job.received,state,pages,indexed,
      stage:current.stage,reviewed:current.progress?.reviewed,reviewTotal:current.progress?.review_total,
      activeReaders:current.progress?.activeReaders||0,stopping:current.stopping,
      candidates:current.candidates,
      error:current.error||(job.error?{code:typeof job.error_code==='string'&&job.error_code?job.error_code:'preparation_failed',message:job.error}:undefined),
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
      const process=host.start(action,data,signal);
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
          if (signal.aborted || code !== 0 || failure || result === undefined) reject(Object.assign(refuse('interrupted', failure?.message || tail || 'Preparation interrupted'), failure || {}));
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
      const failed=refusal(error,'preparation_failed');
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
      const job: Row = {play_language: language, id: randomUUID(), session, name: params.name, size: params.size || 0, received: 0,
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
        if (job.state !== 'uploading' || params.offset !== job.received || typeof params.data !== 'string' || params.data.length > Math.ceil(CHUNK / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(params.data)) throw refuse('upload_chunk_invalid', 'Invalid upload chunk or offset');
        const bytes = Buffer.from(params.data, 'base64');
        if (!bytes.length || bytes.length > CHUNK || job.received + bytes.length > job.size) throw refuse('upload_size_mismatch', 'Upload size mismatch');
        appendFileSync(join(this.folder(job.id), 'source.pdf'), bytes); job.received += bytes.length; this.save(job);
      } else if (params.action === 'finish') {
        const path = join(this.folder(job.id), 'source.pdf');
        if (job.state !== 'uploading' || job.received !== job.size || statSync(path).size !== job.size) throw refuse('upload_incomplete', 'Upload is incomplete');
        job.state = 'inspecting'; this.save(job);
        try {
          const inspected = await this.run('inspect', {pdf: path, name: job.name}, job);
          const bound=this.patch(job,{module_id:inspected.module_id,pages:inspected.page_count});this.prepare(bound);
        } catch (error) {const failed=refusal(error,'preparation_failed');job.state = 'failed'; job.error = failed.message; job.error_code = failed.code; this.save(job);}
      } else if (params.action === 'pause') {
        const targets=params.target==='all'||job.preparation?.guidance?.state!=='ready'?['guidance','opening']:['opening'];
        const preparation={...job.preparation};
        for(const target of targets)if(preparation[target]?.state!=='ready')preparation[target]={...preparation[target],state:'paused'};
        this.patch(job,{state:job.campaign?'conversing':'paused',preparation});
        for(const target of targets)this.children.get(this.phaseKey(job,target))?.abort();
      } else if (params.action === 'resume' || params.action === 'opening') {
        if (!job.module_id) {
          const path=join(this.folder(job.id),'source.pdf');
          if(job.received!==job.size||!existsSync(path))throw refuse('upload_retry', 'Select the PDF again to retry its upload');
          const inspected=await this.run('inspect',{pdf:path,name:job.name},job);
          Object.assign(job,this.patch(job,{module_id:inspected.module_id,pages:inspected.page_count}));
        }
        if(params.scene&&job.campaign)throw refuse('opening_bound', 'The opening is already bound to character creation');
        const updated=this.patch(job,{start_scene:params.scene||job.start_scene});
        this.prepare(updated,true);
      } else if (params.action === 'dismiss') {
        if ([...this.children.keys()].some(key=>key.startsWith(job.id+':')) || ['uploading','inspecting'].includes(job.state)) throw refuse('preparation_pause_first', 'Pause preparation before choosing another scenario');
        job.dismissed = true; this.save(job);
      } else if (params.action === 'converse') {
        if(job.preparation?.guidance?.state!=='ready') throw refuse('guidance_not_ready', 'Wait for the scenario guidance to be ready');
        if(!job.guidance)throw refuse('guidance_unavailable', 'Accepted guidance is unavailable');
        job.campaign ||= 'game-' + randomUUID(); this.save(job);
        await this.run('converse', {...job,title:job.name,play_language:job.play_language??await this.playLanguage(undefined)},job);
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
   */
  private runPresentation(data:Row):Promise<Row> {
    const limit=Number(this.options.env.PI_COC_PRESENTATION_DEADLINE_MS)||PRESENTATION_DEADLINE_MS;
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const bounded=new Promise<never>((_resolve,reject)=>{
      timer=setTimeout(()=>{
        controller.abort();
        reject(refuse('presentation_timeout', 'The card presentation did not finish in time; retry it'));
      },limit);
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
  private static readonly GROWING_LANES=['standing','possessions','clues'] as const;
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
