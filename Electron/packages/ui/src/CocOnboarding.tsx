/**
 * The scenario wizard: pick a source, watch it prepare, walk into the conversation.
 *
 * Every caption comes from the snapshot's own `ui = {tag, words}` (contract §23, 2026-09-09). This
 * screen used to be written in one language outright, with an `en` option beside it that changed
 * only what the Keeper would later write -- so choosing English left the whole wizard in Chinese.
 * The picker offers `content/languages.json`'s `suggested` tags and accepts any other the player
 * types: the tag set is open (contract §23, 2026-09-09), so there is no list to be on. A language
 * is named by `Intl.DisplayNames` in that language itself, falling back to the tag, and the field
 * starts at the file's `default`. Adding a language is nothing at all.
 *
 * Before the first answer arrives there is no `ui`, and the screen draws an ellipsis rather than
 * words in a language nobody has chosen. A failure shows its code's caption from the `errors`
 * surface and keeps the host's English message behind a fold, where a log message belongs.
 */
import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react'
import {createExtensionHostAPI} from '@pipiui/extension-api'
import type {PipiHostAPI} from '@pipi/host-api'
import playLanguages from '../../../../content/languages.json'
import './coc-onboarding.css'

type Row = Record<string, any>
type Ui = {tag: string; words: Record<string, Record<string, string>>}
type Failure = {code: string; message: string}
type Props = {host: PipiHostAPI; sessionId: string}
const MB = 1024 * 1024
const MAX_UPLOAD_MB = 128

/** A caption from the answer's `ui` block, or `fallback` -- the key by default, so a gap is
 *  something a player can name rather than a word from a language they did not choose. */
function word(ui: Ui | null, surface: string, key: string, fallback?: string): string {
  const table = ui?.words?.[surface]
  const found = table?.[key]
  return typeof found === 'string' ? found : fallback === undefined ? key : fallback
}

/** The shape of a play language tag, and the only thing this screen asks about one (contract §23). */
const PLAY_LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

/**
 * What to call a language, in that language.
 *
 * `Intl.DisplayNames` is the platform's own table, so the product keeps none; a tag it does not
 * know comes back as itself, which is a name a player can still read and retype.
 */
function languageName(tag: string): string {
  try {return new Intl.DisplayNames([tag], {type: 'language'}).of(tag) || tag}
  catch {return tag}
}

/** A parameterised caption: `{name}` placeholders filled from `values`, order and all. */
function fill(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole)
}

/** A `{code, message}` pair from anything a host or this screen refused with. */
function failure(reason: unknown): Failure {
  if (reason && typeof reason === 'object')
    return {code: typeof (reason as Row).code === 'string' ? (reason as Row).code : '',
      message: typeof (reason as Row).message === 'string' ? (reason as Row).message : ''}
  return {code: '', message: reason === undefined || reason === null ? '' : String(reason)}
}

function fileChunk(file: Blob): Promise<string> {
  return new Promise((resolve,reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject({code:'upload_chunk_invalid', message:'the file could not be read'})
    reader.readAsDataURL(file)
  })
}
export function CocOnboarding({host, sessionId}: Props) {
  const [language,setLanguage] = useState<string>(playLanguages.default)
  const api=useMemo(()=>createExtensionHostAPI({host,sessionId,extensionId:'coc-keeper',capabilities:['invoke.agent']}),[host,sessionId])
  const query=useMemo(()=>api.observe!('onboarding',{action:'current',play_language:language}),[api,language])
  const current=useSyncExternalStore(query.subscribe,query.snapshot,query.snapshot)
  const [section,setSection] = useState<'home'|'starter'|'module'|'pdf'>('home')
  const [catalog,setCatalog] = useState<Row | null>(null)
  const [job,setJob] = useState<Row | null>(null)
  const [busy,setBusy] = useState(false), [error,setError] = useState<Failure | null>(null)
  // What is in the field, which is not yet what the screen is in: a half-typed tag would ask the
  // host for a catalog in a language nobody named. The tag is committed when it is a whole one.
  const [typedLanguage,setTypedLanguage] = useState<string>(playLanguages.default)
  const [ui,setUi] = useState<Ui | null>(null)
  const starting=useRef(false), restored=useRef(false)
  const chooser = useRef<HTMLInputElement>(null), cancelled = useRef(false), uploadRunning = useRef(false)
  const storageKey = 'pipicoc-import:' + sessionId
  const t=(key:string)=>word(ui,'onboarding',key)
  const tf=(key:string,values:Record<string,unknown>)=>fill(t(key),values)
  const said=(reason:Failure)=>word(ui,'errors',reason.code,word(ui,'errors','unknown'))
  /** A whole tag becomes the screen's language; anything half-typed stays in the field alone. */
  function commitLanguage(value: string): void {
    const tag = value.trim()
    if (PLAY_LANGUAGE_TAG.test(tag)) setLanguage(tag)
  }
  async function call(params: Row): Promise<Row> {
    if (!host.invokeExtension) throw {code:'runtime_unavailable', message:'this host cannot prepare a scenario'}
    const reply = await host.invokeExtension('coc-keeper','onboarding',params,{sessionId})
    if (!reply.ok) throw {code:(reply.error as Row)?.code ?? '', message:reply.error.message}
    const data = reply.data as Row
    // Every answer carries the words for the language it was asked in, so the screen follows the
    // picker without a second round trip and without a table of its own.
    if (data?.ui) setUi(data.ui as Ui)
    return data
  }
  function remember(next: Row) {
    // A restored import brings its own language back; the field follows it, or it would go on
    // showing whatever the player had typed before the page was reloaded.
    if(next.play_language){setLanguage(next.play_language);setTypedLanguage(next.play_language)}
    setJob(next)
    void query.refresh()
    try {localStorage.setItem(storageKey,next.id)} catch { /* storage may be disabled */ }
  }
  // Scenario titles and blurbs are authored per play language, so the catalog is re-read
  // when the picker's language changes. `remember` adopts a restored import's language,
  // which would re-enter this effect: the restore itself happens once.
  useEffect(() => {
    let active = true
    void call({action:'catalog',play_language:language}).then(data => {if(active){setCatalog(data)
      if(data.current_import&&!restored.current){restored.current=true;remember(data.current_import)}}}).catch(e => {if(active)setError(failure(e))})
    return () => {active=false}
  },[host,sessionId,language])
  useEffect(() => {
    let active = true
    try {
      const id = localStorage.getItem(storageKey)
      if(id)void call({action:'status',id}).then(data => {if(active){restored.current=true;remember(data)}}).catch(() => {})
    } catch { /* no browser storage */ }
    return () => {active=false}
  },[host,sessionId])
  useEffect(()=>{if(current?.ok){const data=current.data as Row;const next=data.current_import;if(next)setJob(next);if(data.ui?.tag===language)setUi(data.ui)}},[current,language])
  async function act(params:Row) {
    setError(null);setBusy(true)
    try {remember(await call({...params,id:job?.id,...(params.action==='select'?{play_language:language}:{})}))} catch(e){setError(failure(e))} finally {setBusy(false)}
  }
  async function upload(file?:File) {
    if(!file)return
    setSection('pdf');setError(null);cancelled.current=false
    if(!file.name.toLowerCase().endsWith('.pdf') || file.size>MAX_UPLOAD_MB*MB || file.size<5){
      setError({code:'upload_too_large', message:`select a PDF of at most ${MAX_UPLOAD_MB} MB`});return}
    uploadRunning.current=true
    setBusy(true)
    try {
      let current=await call({action:'begin',name:file.name,size:file.size,play_language:language})
      remember(current)
      for(let offset=0;offset<file.size;offset+=MB){
        if(cancelled.current)break
        current=await call({action:'chunk',id:current.id,offset,data:await fileChunk(file.slice(offset,offset+MB))})
        remember(current)
      }
      if(cancelled.current){remember(await call({action:'pause',id:current.id}));return}
      remember(await call({action:'finish',id:current.id}))
    } catch(e){setError(failure(e))} finally {uploadRunning.current=false;setBusy(false)}
  }
  async function back(){setBusy(true);try{if(job)await call({action:'dismiss',id:job.id});setJob(null);setSection('home');setError(null);try{localStorage.removeItem(storageKey)}catch{}}catch(e){setError(failure(e))}finally{setBusy(false)}}
  const preparing=job && ['preparing','inspecting','uploading'].includes(job.state)
  useEffect(()=>{
    if(!job || !['ready','conversing'].includes(job.state) || starting.current)return
    starting.current=true
    void act({action:'converse'}).finally(()=>{starting.current=false})
  },[job?.id,job?.state])
  const stageTitle=job?.state==='uploading'?t('state.uploading'):job?.state==='inspecting'?t('state.inspecting')
    :word(ui,'onboarding',`stage.${job?.stage}`,t('stage.default'))
  return <div className="coc-onboarding"><div className="coc-onboarding-inner">
    <input ref={chooser} type="file" accept=".pdf,application/pdf" aria-label={t('choosePdf')} className="coc-file-input" onChange={event=>{void upload(event.target.files?.[0]);event.target.value=''}}/>
    <header className="coc-welcome"><span className="coc-eyebrow">{t('eyebrow')}</span><h1>{job?.state==='created'?t('title.created'):job?.state==='ready'?t('title.ready'):t('title.start')}</h1><p>{job?t('lede.job'):t('lede.start')}</p></header>
    {!job && <>
        {/* The suggestions sit outside the label: a datalist inside one joins its accessible name,
            and the field would answer to the caption plus every language listed under it. */}
        <label>{t('playLanguage')}<input list="coc-play-languages" value={typedLanguage} spellCheck={false}
          onChange={e=>{const value=e.target.value;setTypedLanguage(value);if(playLanguages.suggested.includes(value.trim()))commitLanguage(value)}}
          onBlur={e=>commitLanguage(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter')commitLanguage((e.target as HTMLInputElement).value)}}/></label>
        <datalist id="coc-play-languages">{playLanguages.suggested.map(tag=><option key={tag} value={tag}>{languageName(tag)}</option>)}</datalist>
      <div className="coc-source-cards">
        <button className={section==='starter'?'selected':''} onClick={()=>setSection('starter')}><span className="coc-source-symbol">⌘</span><strong>{t('source.starter.title')}</strong><span>{t('source.starter.hint')}</span><b>{t('source.starter.action')}</b></button>
        <button className={section==='pdf'?'selected':''} onClick={()=>{setSection('pdf');chooser.current?.click()}}><span className="coc-source-symbol">↑</span><strong>{t('source.pdf.title')}</strong><span>{t('source.pdf.hint')}</span><b>{t('source.pdf.action')}</b></button>
        <button className={section==='module'?'selected':''} onClick={()=>setSection('module')}><span className="coc-source-symbol">▤</span><strong>{t('source.module.title')}</strong><span>{t('source.module.hint')}</span><b>{t('source.module.action')}</b></button>
      </div>
      {section==='pdf' && <button className="coc-drop-zone" onClick={()=>chooser.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void upload(e.dataTransfer.files?.[0])}}>{t('drop')}<span>{t('dropHint')}</span></button>}
      {(section==='starter'||section==='module') && <section className="coc-source-list" aria-label={section==='starter'?t('list.starter'):t('list.module')}>
        {!catalog?<p role="status">{t('catalogLoading')}</p>:(section==='starter'?catalog.presets:catalog.modules).length===0?<div className="coc-empty-library"><p>{t('emptyLibrary')}</p><button onClick={()=>chooser.current?.click()}>{t('uploadFirst')}</button></div>:
          (section==='starter'?catalog.presets:catalog.modules).map((item:Row)=><button disabled={busy} key={item.id||item.module_id} onClick={()=>void act({action:'select',source:section,module_id:item.id||item.module_id,name:item.title})}><strong>{item.title}</strong><span>{section==='starter'?item.blurb:t('moduleBlurb')}</span><b>{t('select')}</b></button>)}
      </section>}
    </>}
    {job && <section className="coc-preparation" aria-label={t('label')}>
      <div className="coc-file-heading"><span className="coc-source-symbol">▤</span><div><strong>{job.name}</strong><small>{job.size?`${tf('size',{mb:(job.size/MB).toFixed(1)})} · `:''}{job.pages?tf('pages',{n:job.pages}):job.source==='starter'?t('source.starterKind'):t('source.pdfKind')}</small></div></div>
      {preparing && <div role="status" aria-live="polite">
        <h2>{stageTitle}</h2>
        {job.stage==='guidance'?<p role="status">{t('guidanceBody')}</p>:job.state==='uploading'?<><progress aria-label={t('uploadProgress')} max={job.size} value={job.received}/><p>{tf('uploaded',{done:(job.received/MB).toFixed(1),total:(job.size/MB).toFixed(1)})}</p></>:
          <><progress aria-label={t('readProgress')} {...(job.stage==='verify'&&job.reviewTotal?{max:job.reviewTotal,value:job.reviewed||0}:{})}/><p>{job.stage==='verify'&&job.reviewTotal?tf('reviewed',{done:job.reviewed||0,total:job.reviewTotal,active:job.activeReaders||0}):t('reading')}</p><p className="coc-muted">{t('backgroundNote')}</p></>}
        <button className="coc-secondary" onClick={()=>{if(job.state==='uploading'&&uploadRunning.current)cancelled.current=true;else void act({action:'pause'})}}>{job.state==='uploading'?t('cancelUpload'):t('pause')}</button>
      </div>}
      {job.state==='choice' && <div><h2>{t('openingTitle')}</h2><p>{t('openingBody')}</p><div className="coc-source-list">{job.candidates?.map((item:Row)=><button key={item.scene} disabled={busy} onClick={()=>void act({action:'opening',scene:item.scene})}><strong>{item.name}</strong>{item.summary&&<span>{item.summary}</span>}<b>{t('select')}</b></button>)}</div></div>}
      {['failed','paused'].includes(job.state)&&<div><h2>{job.state==='paused'?t('pausedTitle'):t('failedTitle')}</h2><p>{t('keptNote')}</p>{/* The caption leads and the host's message follows it, never replaces it: a message is written
            in the system language, and a player who chose another reads only the caption (BUG-039). */}
        {job.error&&<details><summary>{t('showReason')}</summary><p>{said(failure(job.error))}</p>{failure(job.error).message&&<p className="coc-muted">{failure(job.error).message}</p>}</details>}<div className="coc-actions"><button disabled={busy||job.stopping} onClick={()=>void act({action:'resume'})}>{job.stopping?t('pausing'):t('resume')}</button><button className="coc-secondary" onClick={()=>chooser.current?.click()}>{t('choosePdfAgain')}</button></div></div>}
      {['ready','conversing'].includes(job.state)&&<p role="status">{t('entering')}</p>}
      {!preparing&&!busy&&job.state!=='created'&&<button className="coc-back" onClick={back}>{t('back')}</button>}
    </section>}
    {error&&<div className="coc-error" role="alert"><strong>{t('errorTitle')}</strong><p>{said(error)}</p>{error.message&&<details><summary>{word(ui,'errors','details')}</summary><p>{error.message}</p></details>}<button onClick={()=>{setError(null);void call({action:'catalog',play_language:language}).then(setCatalog).catch(e=>setError(failure(e)))}}>{t('retryConnection')}</button></div>}
  </div></div>
}
