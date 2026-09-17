import {useEffect, useRef, useState, type ReactNode} from 'react'
import {CocCharacterDraftEdit} from './CocCharacterDraftEdit'
import './coc-character-draft.css'

type Row = Record<string, any>
/**
 * The card's own actions (§97). `onOverride` still carries the numeric edit dialog; the three
 * added here are whole-card verbs the host answers without the model: confirm the draft and open
 * the table, spread the points nobody spent, reroll the dice the pins do not hold.
 */
type Props={data:Row;onRendered?:()=>Promise<void>;onPresentation?:()=>Promise<Row>;onOverride?:(request:Row)=>Promise<Row>
  onConfirm?:()=>Promise<Row>;onSpread?:()=>Promise<Row>;onReroll?:()=>Promise<Row>}

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
/**
 * A number somebody set on purpose, against a number the allocator spread (§97).
 *
 * `pins` is keyed the way the sheet is -- characteristics by abbreviation, skills by name, plus
 * the single credit rating entry -- and an older revision carries none of it. Absence is drawn as
 * "nothing is pinned here", never as an empty card.
 */
function pinnedCells(data:Row):{characteristic:(key:string)=>boolean;skill:(name:string)=>boolean} {
  const pins=data.pins&&typeof data.pins==='object'&&!Array.isArray(data.pins)?data.pins as Row:undefined
  const holds=(rows:unknown,key:string)=>!!rows&&typeof rows==='object'&&!!(rows as Row)[key]
  return {
    characteristic:(key:string)=>holds(pins?.characteristics,key),
    skill:(name:string)=>name==='Credit Rating'?!!pins?.credit_rating:holds(pins?.skills,name),
  }
}
/** One pool of the budget report, or nothing when the revision predates it. */
function pool(budget:Row|undefined,key:string):{total?:number;spent?:number;unspent:number}|undefined {
  const entry=budget?.[key]
  if(!entry||typeof entry!=='object')return undefined
  const figure=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:undefined
  return {total:figure(entry.total),spent:figure(entry.spent),unspent:figure(entry.unspent)??0}
}
export function CocCharacterDraft({data,onRendered,onPresentation,onOverride,onConfirm,onSpread,onReroll}:Props) {
  const [presentation,setPresentation]=useState<Row|null>(data.presentation||null)
  const [showDetails,setShowDetails]=useState(false)
  const [editing,setEditing]=useState(false)
  const [busy,setBusy]=useState<string|null>(null)
  const [actionError,setActionError]=useState<string|null>(null)
  const [rerollAsked,setRerollAsked]=useState(false)
  const alive=useRef(true)
  useEffect(()=>()=>{alive.current=false},[])
  useEffect(()=>{setShowDetails(false);setEditing(false);setRerollAsked(false);setActionError(null)},[data.revision])
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
  if(!sheet||!presentation)return <section className="coc-draft-pending" aria-busy={!error} role="status">{error?<><span className="coc-draft-error">{error}</span><button type="button" onClick={()=>setRetry(x=>x+1)}>↻</button></>:<span className="coc-draft-spinner" aria-hidden="true"/>}</section>
  // A word the projection does not carry comes back as itself. Returning '' instead blanked the
  // cell, which reads as "this card has nothing here" rather than "this word is not translated
  // yet" -- and a blank is the one thing a player cannot report.
  const t=(value:string)=>presentation.texts[value]||value
  const cell=(value:unknown):string=>value===null||value===undefined?'—':typeof value==='number'?String(value):typeof value==='boolean'?t(value?'Yes':'No'):Array.isArray(value)?value.map(cell).join(' / '):isDiceNotation(value)?String(value):t(String(value))
  const pinned=pinnedCells(data)
  // The pin is a mark on the number, not a number of its own: it says who set this cell, so the
  // player can tell a figure they chose from one the allocator spread and will move again.
  const pinMark=(held:boolean)=>held?<span className="coc-draft-pin" role="img" aria-label={t('Pinned')}>📌</span>:null
  const values=(rows:Row,held?:(key:string)=>boolean)=><div className="coc-draft-table-scroll"><table className="coc-draft-table"><thead><tr><th>{t('Parameter')}</th><th>{t('Value')}</th></tr></thead><tbody>{Object.entries(rows).map(([key,value])=><tr key={key} className={held?.(key)?'coc-draft-pinned':undefined}><th scope="row">{t(key)}{pinMark(!!held?.(key))}</th><td>{cell(key==='DB'&&value==='none'?0:value)}</td></tr>)}</tbody></table></div>
  /**
   * One card action in flight at a time, and its refusal drawn where the card already draws one.
   *
   * A `needs` refusal comes back as a resolved `{ok:false,error}` (the host's own shape), a
   * transport failure as a rejection; both end as the one line beside the buttons, and neither
   * leaves a button stuck disabled.
   */
  const run=(name:string,action:()=>Promise<Row>)=>{
    setBusy(name)
    setActionError(null)
    void action()
      .then(result=>{const refusal=result&&(result as Row).ok===false?(result as Row).error:undefined;if(alive.current&&refusal)setActionError(failureText(refusal.message||refusal.code||name))})
      .catch(e=>{if(alive.current)setActionError(failureText(e))})
      .finally(()=>{if(alive.current)setBusy(null)})
  }
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
  const skillTable=<div className="coc-draft-table-scroll"><table className="coc-draft-table coc-draft-skill-detail"><thead><tr>{['Skill','Base value','Occupation points','Interest points','Final value'].map(key=><th key={key}>{t(key)}</th>)}</tr></thead><tbody>{skillRows.map(row=><tr key={row.name} className={pinned.skill(row.name)?'coc-draft-pinned':undefined}><th scope="row">{t(row.name)}{pinMark(pinned.skill(row.name))}</th><td>{amount(row.base)}</td><td>{amount(row.occupational)}</td><td>{amount(row.personal)}</td><td>{cell(row.final)}</td></tr>)}</tbody></table></div>
  const budgets=[{key:'Occupation points',account:occupation,spent:typeof occupation?.spent==='number'&&typeof credit==='number'?occupation.spent+credit:undefined},{key:'Interest points',account:interest,spent:interest?.spent}]
  const statGrid=(rows:Row,derived=false)=><dl className={`coc-draft-stats${derived?' coc-draft-derived':''}`}>{Object.entries(rows).map(([key,value])=>{
    const held=!derived&&pinned.characteristic(key)
    return <div className={`coc-draft-stat${held?' coc-draft-pinned':''}`} key={key}><dt>{t(key)}{pinMark(held)}</dt><dd>{cell(key==='DB'&&value==='none'?0:value)}</dd></div>
  })}</dl>
  /**
   * The budget is a report, not a gate (§97): two bars saying what each pool holds and what it has
   * spent, the points nobody spent, and -- when a limit was relaxed -- the one badge that says so.
   * The notes are the kernel's own sentences about the spread, drawn under the bars.
   */
  const budget=data.budget&&typeof data.budget==='object'&&!Array.isArray(data.budget)?data.budget as Row:undefined
  const pools=[{key:'Occupation points',figures:pool(budget,'occupation')},{key:'Interest points',figures:pool(budget,'interest')}].filter(entry=>entry.figures)
  const unspent=pools.reduce((total,entry)=>total+(entry.figures!.unspent||0),0)
  const notes=Array.isArray(budget?.notes)?budget!.notes.filter((note:unknown)=>typeof note==='object'?!!(note as Row)?.code:typeof note==='string'&&note.trim()):[]
  /**
   * A budget note is a fact with a code, and the card says it in the player's own words.
   *
   * The kernel sends `text` beside the code for the model to read; drawing it would put the
   * system language in front of the player, so only the code is read here and the sentence is
   * built from captions. The codes are a closed contract enum -- not a guess at what a sentence
   * means -- and a code this build does not know still draws the code rather than nothing, which
   * is a gap a player can report. An older revision's plain string is drawn as it always was.
   */
  const poolWord=(name:unknown)=>name==='occupation'?t('occupation points'):name==='interest'?t('interest points'):t(String(name))
  const limitWord=(name:unknown)=>name==='skill_cap'?t('Starting skill cap')
    :name==='characteristic_max'?t('Characteristic maximum')
    :name==='characteristic_min'?t('Characteristic minimum')
    :name==='occupation_points'?t('Occupation points')
    :name==='interest_points'?t('Interest points')
    :String(name)
  const noteLine=(note:Row|string):string=>{
    if(typeof note==='string')return t(note)
    if(note.code==='points_left')return `${t('Points left')}: ${poolWord(note.pool)} ${note.amount}`
    if(note.code==='overspent')return `${t('Overspent by')} ${note.amount} ${poolWord(note.pool)}`
    if(note.code==='relaxed')return `${limitWord(note.limit)}: ${t('Relaxed to')} ${note.value}`
    if(note.code==='above_cap')return `${t('Above the starting cap')} ${note.cap}: ${(Array.isArray(note.skills)?note.skills:[]).map((name:unknown)=>t(String(name))).join(' / ')}`
    return t(String(note.code))
  }
  const budgetBars=pools.length>0&&<div className="coc-draft-budget">
    {pools.map(({key,figures})=>{
      const total=figures!.total,spent=figures!.spent
      const filled=typeof total==='number'&&total>0&&typeof spent==='number'?Math.max(0,Math.min(100,Math.round(spent/total*100))):0
      return <div className="coc-draft-budget-pool" key={key}>
        <div className="coc-draft-budget-head"><span>{t(key)}</span><span className="coc-draft-budget-count">{amount(spent)} / {amount(total)}</span></div>
        <div className="coc-draft-budget-track"><div className="coc-draft-budget-fill" style={{width:`${filled}%`}}/></div>
        {figures!.unspent>0&&<p className="coc-draft-budget-left">{t('Points left')}: {figures!.unspent}</p>}
      </div>
    })}
    {notes.length>0&&<ul className="coc-draft-budget-notes">{notes.map((note:Row|string,i:number)=><li key={i}>{noteLine(note)}</li>)}</ul>}
  </div>
  // A money cell whose amount is not there is an empty cell, and this card already knows how to draw
  // one: `cell()` prints the same mark for the weapon parameters the rules tables leave blank. It did
  // not, and the rulebook's Penniless row -- which prints no assets, and so reaches the sheet as
  // `{amount: null, formula: 'None'}` -- put the literal word `null` in front of a currency on two
  // live tables. The value the kernel records is right; printing it was not.
  const money=(entry:Row)=>entry&&entry.amount!==null&&entry.amount!==undefined?`${entry.amount} ${t(entry.currency)}`:cell(null)
  return <section aria-label={t('Character draft')} data-draft-revision={data.revision} className="coc-draft" data-view={showDetails?'details':'compact'}>
    <header className="coc-draft-header"><div className="coc-draft-identity"><h2>{sheet.name}</h2><p>{sheet.occupation_stated?<>{sheet.occupation_stated} ({t(sheet.occupation)})</>:t(sheet.occupation)} · {sheet.age}{sheet.sex?<> · {t(sheet.sex)}</>:null} · {t(sheet.era)}</p>
      {budget?.legal===false&&<p className="coc-draft-nonstandard">{t('Non-standard card')}</p>}</div>
      <div className="coc-draft-toolbar"><p className="coc-draft-guidance">{t('Click "Confirm and open the table", or say below what to change.')}</p>
        {onConfirm&&<button className="coc-draft-primary" type="button" disabled={busy!==null} onClick={()=>run('confirm',onConfirm)}>{t('Confirm and open the table')}</button>}
        {onSpread&&unspent>0&&<button className="coc-draft-toggle" type="button" disabled={busy!==null} onClick={()=>run('spread',onSpread)}>{t('Auto-spread')}</button>}
        {/* A reroll is the one action that can move a number the player never asked about, so it
            asks first and says what it will not touch. */}
        {onReroll&&(rerollAsked
          ?<span className="coc-draft-ask"><span className="coc-draft-ask-question">{t('Reroll the dice? Pinned numbers stay.')}</span><button className="coc-draft-toggle" type="button" disabled={busy!==null} onClick={()=>{setRerollAsked(false);run('reroll',onReroll)}}>{t('Yes, reroll')}</button><button className="coc-draft-toggle" type="button" onClick={()=>setRerollAsked(false)}>{t('Cancel')}</button></span>
          :<button className="coc-draft-toggle" type="button" disabled={busy!==null} onClick={()=>setRerollAsked(true)}>{t('Reroll')}</button>)}
        <button className="coc-draft-toggle" type="button" aria-expanded={showDetails} onClick={()=>setShowDetails(value=>!value)}>{t(showDetails?'Hide calculation details':'Show calculation details')}</button>{data.limits&&onOverride&&<button className="coc-draft-toggle" type="button" disabled={busy!==null} onClick={()=>setEditing(true)}>{t('Edit numbers')}</button>}</div>
      {actionError&&<p className="coc-draft-note coc-draft-error" role="alert">{actionError}</p>}</header>
    <h3>{t('Characteristics')}</h3>{showDetails?<><p className="coc-draft-method">{generated.method==='rolled'?t('Standard rolled characteristics'):generated.method==='rolled_pool_assignment'?t('Rolled characteristics assigned to the stated aptitudes'):generated.method==='quick_fire'?t('Quick-fire array'):'—'} · {age.bracket||'—'}</p>
    {calculationTable(sheet.characteristics,generation)}{calculationTable(sheet.derived,derivedCalculation)}</>:<>{statGrid(sheet.characteristics)}{statGrid(sheet.derived,true)}</>}
    {(pools.length>0||showDetails)&&<><h3>{t('Point allocation')}</h3>{budgetBars}
    {showDetails&&<table className="coc-draft-table coc-draft-budgets"><thead><tr>{['Point allocation','Total points','Spent','Remaining'].map(key=><th key={key}>{t(key)}</th>)}</tr></thead><tbody>{budgets.map(({key,account,spent})=><tr key={key}><th scope="row">{t(key)}</th><td>{amount(account?.budget?.total)}</td><td>{amount(spent)}</td><td>{amount(account?.unspent)}</td></tr>)}</tbody></table>}</>}
    <h3>{t('Skills')}</h3>{showDetails?skillTable:values(sheet.skills,pinned.skill)}
    <h3>{t('Finance')}</h3><dl className="coc-draft-finance">{[['cash',money(sheet.finance?.cash)],['assets',money(sheet.finance?.assets)],['spending',money(sheet.finance?.spending_level)],['credit_rating',sheet.credit_rating]].map(([key,value])=><div key={key}><dt>{t(key)}</dt><dd>{value}</dd></div>)}</dl>
    {/* A book set in a year the rulebook never tabulated builds these figures off the table's own
        nominated column (§23.4); the kernel records which setting that column stood in for. The
        player was told only by a sentence the setup agent was asked to say once in prose, and
        `game-b4cebfe0`'s transcript never says it. The card carries the fact beside the numbers. */}
    {sheet.finance?.substituted_for&&<p className="coc-draft-note">{t('finance_period')}: {cell(sheet.finance.period)} · {t('substituted_for')}: {cell(sheet.finance.substituted_for)}</p>}
    <h3>{t('Background')}</h3><dl className="coc-draft-background">{Object.entries(sheet.backstory||{}).map(([key,value])=><div key={key}><dt>{t(key)}</dt><dd>{cell(value)}</dd></div>)}</dl>
    <p className="coc-draft-note">{t('Language')}: {t(sheet.own_language)}</p><p className="coc-draft-note">{t('Key connection')}: {cell(sheet.key_connection?.summary)}</p>
    <h3>{t('Equipment')}</h3><ul className="coc-draft-kit">{(sheet.equipment||[]).filter((item:string)=>!presentation.finance_equipment?.includes(item)).map((item:string,i:number)=><li key={i}>{t(item)}</li>)}</ul>
    {!!sheet.weapons?.length&&<><h3>{t('Weapons')}</h3>{sheet.weapons.map((weapon:Row,i:number)=><div key={i}>{values(weapon)}</div>)}</>}
    {error&&<p role="alert">{t('Preview unavailable')}: {error} <button type="button" onClick={()=>{setError(null);if(onRendered)void onRendered().catch(e=>setError(failureText(e)))}}>{t('Retry')}</button></p>}
    {editing&&onOverride&&<CocCharacterDraftEdit data={data} t={t} onOverride={onOverride} onClose={()=>setEditing(false)}/>}
  </section>
}
