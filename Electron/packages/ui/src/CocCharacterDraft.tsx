import {useEffect, useState} from 'react'

type Row = Record<string, any>
export function CocCharacterDraft({data,onRendered}:{data:Row;onRendered?:()=>Promise<void>}) {
  const [error,setError]=useState('')
  const acknowledge=()=>{if(onRendered)void onRendered().catch(e=>setError(e.message||String(e)))}
  useEffect(()=>{acknowledge()},[data.revision])
  const sheet=data.sheet, labels=data.labels||{}
  if(!sheet)return <p role="alert">Character preview unavailable</p>
  const values=(rows:Row,thresholds=false)=><div style={{maxHeight:360,overflow:'auto'}}><table style={{width:'100%',textAlign:'left'}}><thead><tr><th>Parameter</th><th>Value</th>{thresholds&&<><th>Half</th><th>Fifth</th></>}</tr></thead><tbody>{Object.entries(rows).map(([key,value])=><tr key={key}><th>{labels[key]||key}</th><td>{String(value)}</td>{thresholds&&<><td>{Math.floor(Number(value)/2)}</td><td>{Math.floor(Number(value)/5)}</td></>}</tr>)}</tbody></table></div>
  return <section aria-label="Character draft" data-draft-revision={data.revision} style={{padding:16,border:'1px solid var(--border)',borderRadius:12,background:'var(--surface)',display:'grid',gap:16}}>
    <header><h2>{sheet.name}</h2><p>{sheet.occupation} · {sheet.age} · {sheet.era}</p><p>Character draft — reply to confirm or describe changes.</p></header>
    {values(sheet.characteristics,true)}
    {values(sheet.derived)}
    <h3>Skills</h3>{values(sheet.skills,true)}
    <h3>Finance</h3>{values({cash:sheet.cash,assets:sheet.finance?.assets?.amount,spending:sheet.finance?.spending_level?.amount,credit_rating:sheet.credit_rating})}
    <h3>Background</h3><dl>{Object.entries(sheet.backstory||{}).map(([key,value])=><div key={key}><dt>{key.replaceAll('_',' ')}</dt><dd>{String(value)}</dd></div>)}</dl>
    <p>Language: {sheet.own_language}</p><p>Key connection: {sheet.key_connection?.summary}</p>
    <h3>Equipment</h3><ul>{(sheet.equipment||[]).map((item:string,i:number)=><li key={i}>{item}</li>)}</ul>
    {!!sheet.weapons?.length&&<><h3>Weapons</h3>{sheet.weapons.map((weapon:Row,i:number)=><div key={i}>{values(weapon)}</div>)}</>}
    <p>Occupation unspent: {sheet.creation?.skills?.occupation?.unspent} · Interest unspent: {sheet.creation?.skills?.interest?.unspent}</p>
    {error&&<p role="alert">{error} <button onClick={acknowledge}>Retry preview acknowledgment</button></p>}
  </section>
}
