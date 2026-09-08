import {useEffect, useRef, useState} from 'react'
import type {PipiHostAPI} from '@pipi/host-api'
import './coc-onboarding.css'

type Row = Record<string, any>
type Props = {host: PipiHostAPI; sessionId: string}
const MB = 1024 * 1024
const stageNames: Record<string, string> = {source:'检查文件', skeleton:'识别剧本结构', index:'定位剧本结构', read:'准备开场', verify:'核对关键资料', ready:'开场已准备好'}
function fileChunk(file: Blob): Promise<string> {
  return new Promise((resolve,reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(new Error('无法读取文件，请重新选择。'))
    reader.readAsDataURL(file)
  })
}
export function CocOnboarding({host, sessionId}: Props) {
  const [section,setSection] = useState<'home'|'starter'|'module'|'pdf'>('home')
  const [catalog,setCatalog] = useState<Row | null>(null)
  const [job,setJob] = useState<Row | null>(null)
  const [busy,setBusy] = useState(false), [error,setError] = useState('')
  const [language,setLanguage] = useState('zh-Hans')
  const starting=useRef(false)
  const chooser = useRef<HTMLInputElement>(null), cancelled = useRef(false), uploadRunning = useRef(false)
  const storageKey = 'pipicoc-import:' + sessionId
  async function call(params: Row): Promise<Row> {
    if (!host.invokeExtension) throw new Error('当前宿主还不支持剧本准备。')
    const reply = await host.invokeExtension('coc-keeper','onboarding',params,{sessionId})
    if (!reply.ok) throw new Error(reply.error.message)
    return reply.data as Row
  }
  function remember(next: Row) {
    if(next.play_language)setLanguage(next.play_language)
    setJob(next)
    try {localStorage.setItem(storageKey,next.id)} catch { /* storage may be disabled */ }
  }
  useEffect(() => {
    let active = true
    void call({action:'catalog'}).then(data => {if(active){setCatalog(data);if(data.current_import)remember(data.current_import)}}).catch(e => {if(active)setError(e.message)})
    try {
      const id = localStorage.getItem(storageKey)
      if(id)void call({action:'status',id}).then(data => {if(active)remember(data)}).catch(() => {})
    } catch { /* no browser storage */ }
    return () => {active=false}
  },[host,sessionId])
  useEffect(() => {
    if(!job || !(['preparing','inspecting'].includes(job.state)||(job.state==='paused'&&job.stopping)))return
    let active=true, timer:ReturnType<typeof setTimeout>
    const poll=async()=>{
      try {const next=await call({action:'status',id:job.id});if(active)remember(next)}
      catch(e){if(active)setError(e instanceof Error?e.message:String(e))}
      if(active)timer=setTimeout(poll,2000)
    }
    timer=setTimeout(poll,1000)
    return()=>{active=false;clearTimeout(timer)}
  },[job?.id,job?.state,job?.stopping])
  async function act(params:Row) {
    setError('');setBusy(true)
    try {remember(await call({...params,id:job?.id,...(params.action==='select'?{play_language:language}:{})}))} catch(e){setError(e instanceof Error?e.message:String(e))} finally {setBusy(false)}
  }
  async function upload(file?:File) {
    if(!file)return
    setSection('pdf');setError('');cancelled.current=false
    if(!file.name.toLowerCase().endsWith('.pdf') || file.size>128*MB || file.size<5){setError('请选择不超过 128 MB 的 PDF 文件。');return}
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
    } catch(e){setError(e instanceof Error?e.message:String(e))} finally {uploadRunning.current=false;setBusy(false)}
  }
  async function back(){setBusy(true);try{if(job)await call({action:'dismiss',id:job.id});setJob(null);setSection('home');setError('');try{localStorage.removeItem(storageKey)}catch{}}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  const preparing=job && ['preparing','inspecting','uploading'].includes(job.state)
  useEffect(()=>{
    if(!job || !['ready','conversing'].includes(job.state) || starting.current)return
    starting.current=true
    void act({action:'converse'}).finally(()=>{starting.current=false})
  },[job?.id,job?.state])
  return <div className="coc-onboarding"><div className="coc-onboarding-inner">
    <input ref={chooser} type="file" accept=".pdf,application/pdf" aria-label="选择 PDF 剧本" className="coc-file-input" onChange={event=>{void upload(event.target.files?.[0]);event.target.value=''}}/>
    <header className="coc-welcome"><span className="coc-eyebrow">CALL OF CTHULHU</span><h1>{job?.state==='created'?'调查员已就绪':job?.state==='ready'?'创建你的调查员':'从一份剧本开始'}</h1><p>{job?'准备进度会保留，离开这个页面后也可以回来继续。':'选择剧本，创建调查员，让守秘人带你进入故事。'}</p></header>
    {!job && <>
        <label>游玩语言<select value={language} onChange={e=>setLanguage(e.target.value)}><option value="zh-Hans">简体中文</option><option value="en">English</option></select></label>
      <div className="coc-source-cards">
        <button className={section==='starter'?'selected':''} onClick={()=>setSection('starter')}><span className="coc-source-symbol">⌘</span><strong>选择预设剧本</strong><span>内置故事，直接开始准备</span><b>浏览预设 →</b></button>
        <button className={section==='pdf'?'selected':''} onClick={()=>{setSection('pdf');chooser.current?.click()}}><span className="coc-source-symbol">↑</span><strong>上传 PDF</strong><span>带上自己的模组，按需阅读</span><b>选择文件 →</b></button>
        <button className={section==='module'?'selected':''} onClick={()=>setSection('module')}><span className="coc-source-symbol">▤</span><strong>选择已解析剧本</strong><span>复用准备成果，开启新的调查</span><b>打开剧本库 →</b></button>
      </div>
      {section==='pdf' && <button className="coc-drop-zone" onClick={()=>chooser.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void upload(e.dataTransfer.files?.[0])}}>将 PDF 拖到这里，或点击选择文件<span>最大 128 MB · 原文件会保留 · 长篇模组分阶段准备</span></button>}
      {(section==='starter'||section==='module') && <section className="coc-source-list" aria-label={section==='starter'?'预设剧本':'已解析剧本'}>
        {!catalog?<p role="status">正在读取剧本列表…</p>:(section==='starter'?catalog.presets:catalog.modules).length===0?<div className="coc-empty-library"><p>还没有已解析的剧本</p><button onClick={()=>chooser.current?.click()}>上传第一份 PDF</button></div>:
          (section==='starter'?catalog.presets:catalog.modules).map((item:Row)=><button disabled={busy} key={item.id||item.module_id} onClick={()=>void act({action:'select',source:section,module_id:item.id||item.module_id,name:item.title})}><strong>{item.title}</strong><span>{section==='starter'?`预设 · ${item.id}`:'已保存的准备成果'}</span><b>选择 →</b></button>)}
      </section>}
    </>}
    {job && <section className="coc-preparation" aria-label="剧本准备">
      <div className="coc-file-heading"><span className="coc-source-symbol">▤</span><div><strong>{job.name}</strong><small>{job.size?`${(job.size/MB).toFixed(1)} MB · `:''}{job.pages?`${job.pages} 页`:job.source==='starter'?'预设剧本':'PDF 剧本'}</small></div></div>
      {preparing && <div role="status" aria-live="polite">
        <h2>{job.state==='uploading'?'正在上传':job.state==='inspecting'?'正在检查 PDF':(job.stage==='guidance'?'Preparing character guidance':stageNames[job.stage])||'正在准备剧本'}</h2>
        {job.stage==='guidance'?<p role="status">Preparing and reviewing your scenario background and character suggestions.</p>:job.state==='uploading'?<><progress aria-label="上传进度" max={job.size} value={job.received}/><p>已上传 {(job.received/MB).toFixed(1)} / {(job.size/MB).toFixed(1)} MB</p></>:
          <><progress aria-label="阅读进度" {...(job.stage==='verify'&&job.reviewTotal?{max:job.reviewTotal,value:job.reviewed||0}:{})}/><p>{job.stage==='verify'&&job.reviewTotal?`已核对 ${job.reviewed||0} / ${job.reviewTotal} 组资料 · ${job.activeReaders||0} 组正在复核`:'正在定位并阅读开场需要的原页。'}</p><p className="coc-muted">Character guidance follows opening preparation.</p></>}
        <button className="coc-secondary" onClick={()=>{if(job.state==='uploading'&&uploadRunning.current)cancelled.current=true;else void act({action:'pause'})}}>{job.state==='uploading'?'取消上传':'暂停准备'}</button>
      </div>}
      {job.state==='choice' && <div><h2>选择开场</h2><p>这份剧本提供了不同的开始方式。</p><div className="coc-source-list">{job.candidates?.map((item:Row)=><button key={item.scene} disabled={busy} onClick={()=>void act({action:'opening',scene:item.scene})}>{item.name}<b>选择 →</b></button>)}</div></div>}
      {['failed','paused'].includes(job.state)&&<div><h2>{job.state==='paused'?'准备已暂停':'暂时无法完成准备'}</h2><p>已经保存的文件和阅读进度都还在。</p>{job.error&&<details><summary>查看原因</summary><p>{job.error}</p></details>}<div className="coc-actions"><button disabled={busy||job.stopping} onClick={()=>void act({action:'resume'})}>{job.stopping?'正在暂停…':'继续准备'}</button><button className="coc-secondary" onClick={()=>chooser.current?.click()}>重新选择 PDF</button></div></div>}
      {['ready','conversing'].includes(job.state)&&<p role="status">The guide is opening your character-creation conversation.</p>}
      {!preparing&&!busy&&job.state!=='created'&&<button className="coc-back" onClick={back}>← 返回选择剧本</button>}
    </section>}
    {error&&<div className="coc-error" role="alert"><strong>这一步没有完成</strong><p>{error}</p><button onClick={()=>{setError('');void call({action:'catalog'}).then(setCatalog).catch(e=>setError(e.message))}}>重试连接</button></div>}
  </div></div>
}
