import {useEffect, useState, type ReactNode} from 'react'

type Row = Record<string, any>
type Props={data:Row;onRendered?:()=>Promise<void>;onPresentation?:()=>Promise<Row>}
export function CocCharacterDraft({data,onRendered,onPresentation}:Props) {
  const [presentation,setPresentation]=useState<Row|null>(data.presentation||null)
  const [error,setError]=useState(false),[retry,setRetry]=useState(0)
  useEffect(()=>{
    let active=true
    setError(false)
    if(data.presentation){setPresentation(data.presentation);return()=>{active=false}}
    setPresentation(null)
    if(onPresentation)void onPresentation().then(value=>{if(active)setPresentation(value)}).catch(()=>{if(active)setError(true)})
    return()=>{active=false}
  },[data.revision,data.play_language,retry])
  useEffect(()=>{if(presentation&&onRendered)void onRendered().catch(()=>setError(true))},[presentation,data.revision])
  const sheet=data.sheet
  if(!sheet||!presentation)return <section aria-busy={!error} role="status">{error?<button onClick={()=>setRetry(x=>x+1)}>↻</button>:'…'}</section>
  const t=(value:string)=>presentation.texts[value]||''
  const cell=(value:unknown):string=>value===null||value===undefined?'—':typeof value==='number'?String(value):typeof value==='boolean'?t(value?'Yes':'No'):Array.isArray(value)?value.map(cell).join(' / '):/^(?=.*\d)[\d\s()+\-*/Dd×.,]+$/.test(String(value))?String(value):t(String(value))
  const tableStyle={width:'100%',textAlign:'left' as const}
  const values=(rows:Row)=><div style={{maxHeight:360,overflow:'auto'}}><table style={tableStyle}><thead><tr><th>{t('Parameter')}</th><th>{t('Value')}</th></tr></thead><tbody>{Object.entries(rows).map(([key,value])=><tr key={key}><th scope="row">{t(key)}</th><td>{cell(key==='DB'&&value==='none'?0:value)}</td></tr>)}</tbody></table></div>
  const creation=sheet.creation||{},generated=creation.characteristics||{},age=creation.age||{}
  const generation=(key:string)=>{
    if(key==='LUCK') {
      const luck=creation.luck
      if(!luck?.attempts)return '—'
      return <>{luck.dice} × {luck.multiplier}{luck.attempts.map((roll:Row,i:number)=><div key={i}>{t('Dice results')}: [{roll.faces?.join(', ')}] → {roll.total} × {luck.multiplier}</div>)}<div>{t('Keep highest')}: 1 / {luck.attempts.length}</div></>
    }
    const roll=generated.rolls?.[key],initial=generated.values?.[key]
    if(typeof initial!=='number')return '—'
    const checks=key==='EDU'&&Array.isArray(age.edu_improvement_checks)?age.edu_improvement_checks:[]
    const adjustment=sheet.characteristics[key]-initial
    return <>{roll?<><div>({roll.dice}) × {generated.multiplier}</div><div>{t('Dice results')}: [{roll.faces?.join(', ')}] → {roll.total} × {generated.multiplier} = {initial}</div></>:<div>{t('Rolled value')}: {initial}</div>}
      <div>{t('Age adjustment')}: {adjustment>=0?'+':''}{adjustment}</div>
      {checks.length>0&&<div>{t('EDU improvement checks')}: {checks.map((check:Row,i:number)=><div key={i}>D100: {check.roll} {check.roll>check.edu?'>':'≤'} {t('EDU')} {check.edu} → +{(checks[i+1]?.edu??sheet.characteristics.EDU)-check.edu}{check.improvement!==undefined?` (D10: ${check.improvement})`:''}</div>)}</div>}</>
  }
  const derivedCalculation=(key:string)=>{
    const trace=creation.derived?.[key]
    if(typeof trace!=='string')return '—'
    if(['HP','MP','SAN'].includes(key)) {
      const match=trace.match(/\(([A-Z]+(?:\+[A-Z]+)*)\)(?:\/(\d+))?$/)
      if(!match)return '—'
      const operands=match[1].split('+').map((name:string)=>`${t(name)} ${sheet.characteristics[name]}`).join(' + ')
      return match[2]?`(${operands}) ÷ ${match[2]} · ${t('Round down')}`:operands
    }
    if(key==='MOV'&&presentation.calculations?.movement) {
      const rule=presentation.calculations.movement
      return <>{t(rule.condition)}<div>{t('Base movement')} {rule.base} − {t('Age movement penalty')} {rule.penalty}</div></>
    }
    if(['DB','BUILD'].includes(key)&&presentation.calculations?.damage_bonus) {
      const rule=presentation.calculations.damage_bonus
      return <>{t('STR')} {sheet.characteristics.STR} + {t('SIZ')} {sheet.characteristics.SIZ} = {rule.total}<div>{rule.min}–{rule.max} → {cell(sheet.derived[key]==='none'?0:sheet.derived[key])}</div></>
    }
    return '—'
  }
  const calculationTable=(rows:Row,calculate:(key:string)=>ReactNode)=><table style={tableStyle}><thead><tr><th>{t('Parameter')}</th><th>{t('Calculation')}</th><th>{t('Final value')}</th></tr></thead><tbody>{Object.entries(rows).map(([key,value])=><tr key={key}><th scope="row">{t(key)}</th><td>{calculate(key)}</td><td>{cell(key==='DB'&&value==='none'?0:value)}</td></tr>)}</tbody></table>
  const occupation=sheet.creation?.skills?.occupation,interest=sheet.creation?.skills?.interest
  const allocationsAvailable=!!occupation?.allocations&&!!interest?.allocations&&typeof occupation.credit_rating?.value==='number'
  const credit=occupation?.credit_rating?.value
  const amount=(value:unknown)=>typeof value==='number'?value:'—'
  const skillRows=Object.entries(sheet.skills||{}).map(([name,final])=>{
    const occupational=allocationsAvailable?(name==='Credit Rating'?credit:occupation.allocations[name]||0):undefined
    const personal=allocationsAvailable?(interest.allocations[name]||0):undefined
    return {name,base:allocationsAvailable?Number(final)-occupational-personal:undefined,occupational,personal,final}
  })
  const skillTable=<div style={{maxHeight:480,overflow:'auto'}}><table style={tableStyle}><thead><tr>{['Skill','Base value','Occupation points','Interest points','Final value'].map(key=><th key={key}>{t(key)}</th>)}</tr></thead><tbody>{skillRows.map(row=><tr key={row.name}><th scope="row">{t(row.name)}</th><td>{amount(row.base)}</td><td>{amount(row.occupational)}</td><td>{amount(row.personal)}</td><td>{cell(row.final)}</td></tr>)}</tbody></table></div>
  const budgets=[{key:'Occupation points',account:occupation,spent:typeof occupation?.spent==='number'&&typeof credit==='number'?occupation.spent+credit:undefined},{key:'Interest points',account:interest,spent:interest?.spent}]
  const money=(entry:Row)=>entry?`${entry.amount} ${t(entry.currency)}`:'—'
  return <section aria-label={t('Character draft')} data-draft-revision={data.revision} style={{padding:16,border:'1px solid var(--border)',borderRadius:12,background:'var(--surface)',display:'grid',gap:16}}>
    <header><h2>{sheet.name}</h2><p>{t(sheet.occupation)} · {sheet.age} · {t(sheet.era)}</p><p>{t('Character draft — reply to confirm or describe changes.')}</p></header>
    <h3>{t('Characteristics')}</h3><p>{generated.method==='rolled'?t('Standard rolled characteristics'):generated.method==='quick_fire'?t('Quick-fire array'):'—'} · {age.bracket||'—'}</p>
    {calculationTable(sheet.characteristics,generation)}{calculationTable(sheet.derived,derivedCalculation)}
    <h3>{t('Point allocation')}</h3>
    <table style={tableStyle}><thead><tr>{['Point allocation','Total points','Spent','Remaining'].map(key=><th key={key}>{t(key)}</th>)}</tr></thead><tbody>{budgets.map(({key,account,spent})=><tr key={key}><th scope="row">{t(key)}</th><td>{amount(account?.budget?.total)}</td><td>{amount(spent)}</td><td>{amount(account?.unspent)}</td></tr>)}</tbody></table>
    <h3>{t('Skills')}</h3>{skillTable}
    <h3>{t('Finance')}</h3><dl>{[['cash',money(sheet.finance?.cash)],['assets',money(sheet.finance?.assets)],['spending',money(sheet.finance?.spending_level)],['credit_rating',sheet.credit_rating]].map(([key,value])=><div key={key}><dt>{t(key)}</dt><dd>{value}</dd></div>)}</dl>
    <h3>{t('Background')}</h3><dl>{Object.entries(sheet.backstory||{}).map(([key,value])=><div key={key}><dt>{t(key)}</dt><dd>{cell(value)}</dd></div>)}</dl>
    <p>{t('Language')}: {t(sheet.own_language)}</p><p>{t('Key connection')}: {cell(sheet.key_connection?.summary)}</p>
    <h3>{t('Equipment')}</h3><ul>{(sheet.equipment||[]).map((item:string,i:number)=><li key={i}>{t(item)}</li>)}</ul>
    {!!sheet.weapons?.length&&<><h3>{t('Weapons')}</h3>{sheet.weapons.map((weapon:Row,i:number)=><div key={i}>{values(weapon)}</div>)}</>}
    {error&&<p role="alert">{t('Preview unavailable')} <button onClick={()=>{setError(false);if(onRendered)void onRendered().catch(()=>setError(true))}}>{t('Retry')}</button></p>}
  </section>
}
