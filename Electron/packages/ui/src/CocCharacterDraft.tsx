import {useEffect, useState} from 'react'

type Row = Record<string, any>
type Props={data:Row;onRendered?:()=>Promise<void>;onPresentation?:()=>Promise<Row>}
export function CocCharacterDraft({data,onRendered,onPresentation}:Props) {
  const [presentation,setPresentation]=useState<Row|null>(data.presentation||null)
  const [error,setError]=useState(false),[retry,setRetry]=useState(0)
  useEffect(()=>{
    let active=true
    let timer:ReturnType<typeof setTimeout>|undefined
    setError(false)
    if(data.presentation){setPresentation(data.presentation);return()=>{active=false}}
    setPresentation(null)
    const load=async()=>{
      try {const value=await onPresentation!();if(!active)return;if(value.pending){timer=setTimeout(load,1500);return;}setPresentation(value)}
      catch{if(active)setError(true)}
    }
    if(onPresentation)void load()
    return()=>{active=false;if(timer)clearTimeout(timer)}
  },[data.revision,data.play_language,retry])
  useEffect(()=>{if(presentation&&onRendered)void onRendered().catch(()=>setError(true))},[presentation,data.revision])
  const sheet=data.sheet
  if(!sheet||!presentation)return <section aria-busy={!error} role="status">{error?<button onClick={()=>setRetry(x=>x+1)}>↻</button>:'…'}</section>
  const t=(value:string)=>presentation.texts[value]||''
  const cell=(value:unknown):string=>value===null||value===undefined?'—':typeof value==='number'?String(value):typeof value==='boolean'?t(value?'Yes':'No'):Array.isArray(value)?value.map(cell).join(' / '):/^(?=.*\d)[\d\s()+\-*/Dd×.,]+$/.test(String(value))?String(value):t(String(value))
  const values=(rows:Row,thresholds=false)=><div style={{maxHeight:360,overflow:'auto'}}><table style={{width:'100%',textAlign:'left'}}><thead><tr><th>{t('Parameter')}</th><th>{t('Value')}</th>{thresholds&&<><th>{t('Half')}</th><th>{t('Fifth')}</th></>}</tr></thead><tbody>{Object.entries(rows).map(([key,value])=><tr key={key}><th>{t(key)}</th><td>{cell(key==='DB'&&value==='none'?0:value)}</td>{thresholds&&<><td>{Math.floor(Number(value)/2)}</td><td>{Math.floor(Number(value)/5)}</td></>}</tr>)}</tbody></table></div>
  const money=(entry:Row)=>entry?`${entry.amount} ${t(entry.currency)}`:'—'
  return <section aria-label={t('Character draft')} data-draft-revision={data.revision} style={{padding:16,border:'1px solid var(--border)',borderRadius:12,background:'var(--surface)',display:'grid',gap:16}}>
    <header><h2>{sheet.name}</h2><p>{t(sheet.occupation)} · {sheet.age} · {t(sheet.era)}</p><p>{t('Character draft — reply to confirm or describe changes.')}</p></header>
    {values(sheet.characteristics,true)}{values(sheet.derived)}
    <h3>{t('Skills')}</h3>{values(sheet.skills,true)}
    <h3>{t('Finance')}</h3><dl>{[['cash',money(sheet.finance?.cash)],['assets',money(sheet.finance?.assets)],['spending',money(sheet.finance?.spending_level)],['credit_rating',sheet.credit_rating]].map(([key,value])=><div key={key}><dt>{t(key)}</dt><dd>{value}</dd></div>)}</dl>
    <h3>{t('Background')}</h3><dl>{Object.entries(sheet.backstory||{}).map(([key,value])=><div key={key}><dt>{t(key)}</dt><dd>{cell(value)}</dd></div>)}</dl>
    <p>{t('Language')}: {t(sheet.own_language)}</p><p>{t('Key connection')}: {cell(sheet.key_connection?.summary)}</p>
    <h3>{t('Equipment')}</h3><ul>{(sheet.equipment||[]).map((item:string,i:number)=><li key={i}>{t(item)}</li>)}</ul>
    {!!sheet.weapons?.length&&<><h3>{t('Weapons')}</h3>{sheet.weapons.map((weapon:Row,i:number)=><div key={i}>{values(weapon)}</div>)}</>}
    <p>{t('Occupation unspent')}: {sheet.creation?.skills?.occupation?.unspent} · {t('Interest unspent')}: {sheet.creation?.skills?.interest?.unspent}</p>
    {error&&<p role="alert">{t('Preview unavailable')} <button onClick={()=>{setError(false);if(onRendered)void onRendered().catch(()=>setError(true))}}>{t('Retry')}</button></p>}
  </section>
}
