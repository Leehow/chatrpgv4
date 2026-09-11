import {useEffect, useState, type ReactNode} from 'react'
import {CocCharacterDraftEdit} from './CocCharacterDraftEdit'
import './coc-character-draft.css'

type Row = Record<string, any>
type Props={data:Row;onRendered?:()=>Promise<void>;onPresentation?:()=>Promise<Row>;onOverride?:(request:Row)=>Promise<Row>}

/**
 * Dice notation, the one kind of value that is read rather than translated.
 *
 * `1D6`, `2D6+6`, `3D6 × 5`, `+1D4`, `15`: a die count, the letter D, faces, and arithmetic. The
 * test is deliberately narrow -- a whole-string match on that grammar -- because the rule it
 * replaces asked only whether a string held a digit and no letters but D, and so sent every
 * language whose script it did not recognise straight past the glossary untranslated. Prose is
 * never classified here by which characters it is made of; anything that is not this shape is a
 * word, and a word goes to the glossary.
 */
export function isDiceNotation(value:unknown):boolean {
  const written=String(value).trim()
  if(!written)return false
  return /^[+-]?(\d+(\.\d+)?|\d*[Dd]\d+)(\s*[+\-*/×]\s*(\d+(\.\d+)?|\d*[Dd]\d+))*$/.test(written)
}
/**
 * The reason a projection failed, trimmed to the one line a card can carry next to its retry.
 * The lane's own message is the useful part ("Model grok-build/grok-4.6 not found"); a stderr
 * tail can run to thousands of characters, so the first non-empty line is kept and capped.
 */
function failureText(value:unknown):string {
  const text=value instanceof Error?value.message:String(value)
  const line=(text.split('\n').find(part=>part.trim())??text).trim()
  return line.length>240?line.slice(0,237)+'…':line
}
export function CocCharacterDraft({data,onRendered,onPresentation,onOverride}:Props) {
  const [presentation,setPresentation]=useState<Row|null>(data.presentation||null)
  const [showDetails,setShowDetails]=useState(false)
  const [editing,setEditing]=useState(false)
  useEffect(()=>{setShowDetails(false);setEditing(false)},[data.revision])
  const [error,setError]=useState<string|null>(null),[retry,setRetry]=useState(0)
  useEffect(()=>{
    let active=true
    let timer:ReturnType<typeof setTimeout>|undefined
    setError(null)
    if(data.presentation){setPresentation(data.presentation);return()=>{active=false}}
    setPresentation(null)
    const load=async()=>{
      try {const value=await onPresentation!();if(!active)return;if(value.pending){timer=setTimeout(load,1500);return;}setPresentation(value)}
      catch(e){if(active)setError(failureText(e))}
    }
    if(onPresentation)void load()
    return()=>{active=false;if(timer)clearTimeout(timer)}
  },[data.revision,data.play_language,retry])
  useEffect(()=>{if(presentation&&onRendered)void onRendered().catch(e=>setError(failureText(e)))},[presentation,data.revision])
  const sheet=data.sheet
  if(!sheet||!presentation)return <section aria-busy={!error} role="status">{error?<><span className="coc-draft-error">{error}</span><button type="button" onClick={()=>setRetry(x=>x+1)}>↻</button></>:'…'}</section>
  // A word the projection does not carry comes back as itself. Returning '' instead blanked the
  // cell, which reads as "this card has nothing here" rather than "this word is not translated
  // yet" -- and a blank is the one thing a player cannot report.
  const t=(value:string)=>presentation.texts[value]||value
  const cell=(value:unknown):string=>value===null||value===undefined?'—':typeof value==='number'?String(value):typeof value==='boolean'?t(value?'Yes':'No'):Array.isArray(value)?value.map(cell).join(' / '):isDiceNotation(value)?String(value):t(String(value))
  const values=(rows:Row)=><div className="coc-draft-table-scroll"><table className="coc-draft-table"><thead><tr><th>{t('Parameter')}</th><th>{t('Value')}</th></tr></thead><tbody>{Object.entries(rows).map(([key,value])=><tr key={key}><th scope="row">{t(key)}</th><td>{cell(key==='DB'&&value==='none'?0:value)}</td></tr>)}</tbody></table></div>
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
  const calculationTable=(rows:Row,calculate:(key:string)=>ReactNode)=><table className="coc-draft-table coc-draft-calculations"><thead><tr><th>{t('Parameter')}</th><th>{t('Calculation')}</th><th>{t('Final value')}</th></tr></thead><tbody>{Object.entries(rows).map(([key,value])=><tr key={key}><th scope="row">{t(key)}</th><td>{calculate(key)}</td><td>{cell(key==='DB'&&value==='none'?0:value)}</td></tr>)}</tbody></table>
  const occupation=sheet.creation?.skills?.occupation,interest=sheet.creation?.skills?.interest
  const allocationsAvailable=!!occupation?.allocations&&!!interest?.allocations&&typeof occupation.credit_rating?.value==='number'
  const credit=occupation?.credit_rating?.value
  const amount=(value:unknown)=>typeof value==='number'?value:'—'
  const skillRows=Object.entries(sheet.skills||{}).map(([name,final])=>{
    const occupational=allocationsAvailable?(name==='Credit Rating'?credit:occupation.allocations[name]||0):undefined
    const personal=allocationsAvailable?(interest.allocations[name]||0):undefined
    return {name,base:allocationsAvailable?Number(final)-occupational-personal:undefined,occupational,personal,final}
  })
  const skillTable=<div className="coc-draft-table-scroll"><table className="coc-draft-table coc-draft-skill-detail"><thead><tr>{['Skill','Base value','Occupation points','Interest points','Final value'].map(key=><th key={key}>{t(key)}</th>)}</tr></thead><tbody>{skillRows.map(row=><tr key={row.name}><th scope="row">{t(row.name)}</th><td>{amount(row.base)}</td><td>{amount(row.occupational)}</td><td>{amount(row.personal)}</td><td>{cell(row.final)}</td></tr>)}</tbody></table></div>
  const budgets=[{key:'Occupation points',account:occupation,spent:typeof occupation?.spent==='number'&&typeof credit==='number'?occupation.spent+credit:undefined},{key:'Interest points',account:interest,spent:interest?.spent}]
  const statGrid=(rows:Row,derived=false)=><dl className={`coc-draft-stats${derived?' coc-draft-derived':''}`}>{Object.entries(rows).map(([key,value])=><div className="coc-draft-stat" key={key}><dt>{t(key)}</dt><dd>{cell(key==='DB'&&value==='none'?0:value)}</dd></div>)}</dl>
  const money=(entry:Row)=>entry?`${entry.amount} ${t(entry.currency)}`:'—'
  return <section aria-label={t('Character draft')} data-draft-revision={data.revision} className="coc-draft" data-view={showDetails?'details':'compact'}>
    <header className="coc-draft-header"><div className="coc-draft-identity"><h2>{sheet.name}</h2><p>{sheet.occupation_stated?<>{sheet.occupation_stated} ({t(sheet.occupation)})</>:t(sheet.occupation)} · {sheet.age} · {t(sheet.era)}</p></div><div className="coc-draft-toolbar"><p className="coc-draft-guidance">{t('Character draft — reply to confirm or describe changes.')}</p><button className="coc-draft-toggle" type="button" aria-expanded={showDetails} onClick={()=>setShowDetails(value=>!value)}>{t(showDetails?'Hide calculation details':'Show calculation details')}</button>{data.limits&&onOverride&&<button className="coc-draft-toggle" type="button" onClick={()=>setEditing(true)}>{t('Edit numbers')}</button>}</div></header>
    <h3>{t('Characteristics')}</h3>{showDetails?<><p className="coc-draft-method">{generated.method==='rolled'?t('Standard rolled characteristics'):generated.method==='rolled_pool_assignment'?t('Rolled characteristics assigned to the stated aptitudes'):generated.method==='quick_fire'?t('Quick-fire array'):'—'} · {age.bracket||'—'}</p>
    {calculationTable(sheet.characteristics,generation)}{calculationTable(sheet.derived,derivedCalculation)}</>:<>{statGrid(sheet.characteristics)}{statGrid(sheet.derived,true)}</>}
    {showDetails&&<><h3>{t('Point allocation')}</h3>
    <table className="coc-draft-table coc-draft-budgets"><thead><tr>{['Point allocation','Total points','Spent','Remaining'].map(key=><th key={key}>{t(key)}</th>)}</tr></thead><tbody>{budgets.map(({key,account,spent})=><tr key={key}><th scope="row">{t(key)}</th><td>{amount(account?.budget?.total)}</td><td>{amount(spent)}</td><td>{amount(account?.unspent)}</td></tr>)}</tbody></table></>}
    <h3>{t('Skills')}</h3>{showDetails?skillTable:values(sheet.skills)}
    <h3>{t('Finance')}</h3><dl className="coc-draft-finance">{[['cash',money(sheet.finance?.cash)],['assets',money(sheet.finance?.assets)],['spending',money(sheet.finance?.spending_level)],['credit_rating',sheet.credit_rating]].map(([key,value])=><div key={key}><dt>{t(key)}</dt><dd>{value}</dd></div>)}</dl>
    <h3>{t('Background')}</h3><dl className="coc-draft-background">{Object.entries(sheet.backstory||{}).map(([key,value])=><div key={key}><dt>{t(key)}</dt><dd>{cell(value)}</dd></div>)}</dl>
    <p className="coc-draft-note">{t('Language')}: {t(sheet.own_language)}</p><p className="coc-draft-note">{t('Key connection')}: {cell(sheet.key_connection?.summary)}</p>
    <h3>{t('Equipment')}</h3><ul className="coc-draft-kit">{(sheet.equipment||[]).filter((item:string)=>!presentation.finance_equipment?.includes(item)).map((item:string,i:number)=><li key={i}>{t(item)}</li>)}</ul>
    {!!sheet.weapons?.length&&<><h3>{t('Weapons')}</h3>{sheet.weapons.map((weapon:Row,i:number)=><div key={i}>{values(weapon)}</div>)}</>}
    {error&&<p role="alert">{t('Preview unavailable')}: {error} <button type="button" onClick={()=>{setError(null);if(onRendered)void onRendered().catch(e=>setError(failureText(e)))}}>{t('Retry')}</button></p>}
    {editing&&onOverride&&<CocCharacterDraftEdit data={data} t={t} onOverride={onOverride} onClose={()=>setEditing(false)}/>}
  </section>
}
