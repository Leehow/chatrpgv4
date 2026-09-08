/** Durable, session-bound onboarding over the existing authenticated Host API. */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

type Row = Record<string, any>;
const MAX_FILE = 128 * 1024 * 1024;
const CHUNK = 1024 * 1024;
export class CocOnboardingHost {
  private stopping = new Set<string>();
  private root: string;
  private children = new Map<string, ChildProcess>();
  private busy = new Set<string>();
  constructor(private options: {repo: string; home: string; agentDir: string; env: NodeJS.ProcessEnv}) {
    this.root = join(options.home, '.coc/imports');
  }
  private folder(id: string) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Unknown import');
    return join(this.root, id);
  }
  private load(id: string, session: string): Row {
    const job = JSON.parse(readFileSync(join(this.folder(id), 'job.json'), 'utf8'));
    if (job.session !== session) throw new Error('This import belongs to another session');
    return job;
  }
  private save(job: Row) {
    const path = join(this.folder(job.id), 'job.json');
    writeFileSync(path + '.tmp', JSON.stringify(job, null, 2) + '\n'); renameSync(path + '.tmp', path);
  }
  private snapshot(job: Row): Row {
    let indexed = 0, activeReaders = 0, pages = job.pages || 0;
    if (job.module_id) try {
      const meta = JSON.parse(readFileSync(join(this.options.home, '.coc/modules', job.module_id, 'module.json'), 'utf8'));
      indexed = meta.reading?.viewed_pages?.length || 0; pages = meta.page_count || pages;
      const queue = JSON.parse(readFileSync(join(this.options.home, ".coc/modules", job.module_id, "deepen-queue.json"), "utf8"));
      activeReaders = queue.filter((row: Row) => row.state === "running").length;
    } catch { /* preparation may not have bound a source yet */ }
    const state = job.state === 'preparing' && !this.children.has(job.id) ? 'paused' : job.state;
    return {id: job.id, name: job.name, source: job.source, size: job.size, received: job.received,
      state, stopping: state === "paused" && this.children.has(job.id), stage: job.stage, pages, indexed, activeReaders: job.progress?.activeReaders ?? activeReaders, reviewed: job.progress?.reviewed, reviewTotal: job.progress?.review_total, candidates: job.candidates, error: job.error,
      model: job.model, thinking: job.thinking, campaign: job.campaign, view: job.view, guidance: job.guidance, play_language: job.play_language};
  }
  private run(action: string, data: Row, job?: Row): Promise<any> {
    const child = spawn(process.execPath, ['--experimental-strip-types', join(this.options.repo, 'pipicoc/onboarding-worker.ts'), action,
      JSON.stringify({...data, home: this.options.home})], {
      cwd: this.options.repo, env: {...this.options.env, ELECTRON_RUN_AS_NODE: '1', PI_CODING_AGENT_DIR: this.options.agentDir}, stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (job) this.children.set(job.id, child);
    return new Promise((resolve, reject) => {
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
          if (job && event.type === 'progress' && !this.stopping.has(job.id)) {job.stage = event.data.stage; job.progress = event.data; this.save(job);}
          if (job) appendFileSync(join(this.folder(job.id), 'events.jsonl'), JSON.stringify({at: new Date().toISOString(), ...event}) + '\n');
        }
      });
      child.on('error', reject);
      child.on('close', code => {
        if (job) this.children.delete(job.id);
        if (code !== 0 || failure || result === undefined) reject(Object.assign(new Error(failure?.message || tail || 'Preparation interrupted'), failure || {}));
        else resolve(result);
      });
    });
  }
  private prepare(job: Row, retry = false) {
    if (this.children.has(job.id)) return;
    this.stopping.delete(job.id);
    job.play_language ||= 'zh-Hans';
    job.state = 'preparing'; job.stage = 'preparing'; job.progress = undefined; job.error = undefined; this.save(job);
    void this.run('prepare', {...job, retry}, job).then(result => {
      if (this.stopping.has(job.id)) return;
      job.guidance = result.guidance; job.state = 'ready'; job.module_id = result.module_id; job.stage = 'ready'; this.save(job);
    }).catch(error => {
      if (this.load(job.id, job.session).state === 'paused') return;
      job.state = error.code === 'needs_choice' ? 'choice' : 'failed';
      job.candidates = error.candidates; job.error = error.message; this.save(job);
    });
  }
  async invoke(params: Row, session: string, model: {id: string; thinking: string; vision: boolean}): Promise<Row> {
    if (params.action === 'catalog') {
      const catalog = await this.run('catalog', {});
      const imports: Array<{job: Row; modified: number}> = [];
      if (session && existsSync(this.root)) for (const id of readdirSync(this.root)) {
        try {
          const job = this.load(id, session);
          if (!job.dismissed) imports.push({job, modified: statSync(join(this.folder(id), 'job.json')).mtimeMs});
        } catch { /* another session's or incomplete imports are not candidates */ }
      }
      imports.sort((a,b) => b.modified - a.modified);
      return {...catalog, current_import: imports[0] ? this.snapshot(imports[0].job) : null};
    }
    mkdirSync(this.root, {recursive: true});
    if (params.action === 'begin' || params.action === 'select') {
      if (params.action === 'begin' && (!Number.isSafeInteger(params.size) || params.size < 5 || params.size > MAX_FILE ||
        typeof params.name !== 'string' || !params.name.toLowerCase().endsWith('.pdf'))) throw new Error('Choose a PDF of up to 128 MiB');
      if (!model.vision && params.source !== 'starter') throw new Error('Choose a model with image input');
      if (params.play_language && !['zh-Hans','en'].includes(params.play_language)) throw new Error('Invalid play language');
      const job: Row = {play_language: params.play_language || 'zh-Hans', id: randomUUID(), session, name: params.name, size: params.size || 0, received: 0,
        source: params.action === 'begin' ? 'pdf' : params.source, module_id: params.module_id,
        model: model.id, thinking: model.thinking, state: params.action === 'begin' ? 'uploading' : 'preparing'};
      mkdirSync(this.folder(job.id)); this.save(job);
      if (params.action === 'begin') writeFileSync(join(this.folder(job.id), 'source.pdf'), '');
      else {
        if (!['starter','module'].includes(job.source) || typeof job.module_id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(job.module_id)) throw new Error('Choose a listed scenario');
        this.prepare(job);
      }
      return this.snapshot(job);
    }
    const job = this.load(params.id, session);
    if (params.action === 'status') return this.snapshot(job);
    if (this.busy.has(job.id)) throw new Error('This operation is already in progress');
    this.busy.add(job.id);
    try {
      if (params.action === 'chunk') {
        if (job.state !== 'uploading' || params.offset !== job.received || typeof params.data !== 'string' || params.data.length > Math.ceil(CHUNK / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(params.data)) throw new Error('Invalid upload chunk or offset');
        const bytes = Buffer.from(params.data, 'base64');
        if (!bytes.length || bytes.length > CHUNK || job.received + bytes.length > job.size) throw new Error('Upload size mismatch');
        appendFileSync(join(this.folder(job.id), 'source.pdf'), bytes); job.received += bytes.length; this.save(job);
      } else if (params.action === 'finish') {
        const path = join(this.folder(job.id), 'source.pdf');
        if (job.state !== 'uploading' || job.received !== job.size || statSync(path).size !== job.size) throw new Error('Upload is incomplete');
        job.state = 'inspecting'; this.save(job);
        try {
          const inspected = await this.run('inspect', {pdf: path, name: job.name}, job);
          job.module_id = inspected.module_id; job.pages = inspected.page_count; this.prepare(job);
        } catch (error) {job.state = 'failed'; job.error = error instanceof Error ? error.message : String(error); this.save(job);}
      } else if (params.action === 'pause') {
        this.stopping.add(job.id); job.state = 'paused'; this.save(job);
        const child = this.children.get(job.id);
        if (child) {
          let timer: ReturnType<typeof setTimeout>;
          await new Promise<void>(resolve => {timer=setTimeout(resolve,3000);child.once('close',()=>{clearTimeout(timer);resolve()});child.kill('SIGTERM')});
        }
      } else if (params.action === 'resume' || params.action === 'opening') {
        if (!job.module_id) throw new Error('Select the PDF again to retry its upload');
        job.start_scene = params.scene || job.start_scene; this.prepare(job, true);
      } else if (params.action === 'dismiss') {
        if (this.children.has(job.id) || ['uploading','inspecting'].includes(job.state)) throw new Error('Pause preparation before choosing another scenario');
        job.dismissed = true; this.save(job);
      } else if (params.action === 'converse') {
        if (!['ready','conversing'].includes(job.state)) throw new Error('Wait for the scenario guidance to be ready');
        if(!job.guidance) {this.prepare(job,true);return this.snapshot(job);}
        job.campaign ||= 'game-' + randomUUID(); this.save(job);
        await this.run('converse', {...job,title:job.name,play_language:job.play_language||'zh-Hans'},job);
        job.state='conversing'; this.save(job);
      } else throw new Error('Unknown onboarding action');
      return this.snapshot(job);
    } finally {this.busy.delete(job.id);}
  }
  dispose() {
    for (const [id, child] of this.children) {
      this.stopping.add(id);
      try {
        const job = JSON.parse(readFileSync(join(this.folder(id), 'job.json'), 'utf8'));
        if (['preparing', 'inspecting'].includes(job.state)) {job.state = 'paused'; job.error = undefined; this.save(job);}
      } catch { /* retain any available evidence if the job file is unavailable */ }
      child.kill('SIGTERM');
    }
  }
}
