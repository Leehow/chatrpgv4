import {useEffect,useRef,useState} from 'react'
import './coc-character-draft-edit.css'

type Row=Record<string,any>
type Props={data:Row;t:(key:string)=>string;onOverride:(request:Row)=>Promise<Row>;onClose:()=>void}

/** The five bounds the unlock disclosure can relax, in display order. */
const LIMIT_FIELDS=['characteristic_min','characteristic_max','skill_cap','occupation_points','interest_points'] as const
type LimitField=typeof LIMIT_FIELDS[number]

type Limits={
  characteristicMin:number
  characteristicMax:number
  skillCap:number
  occupationFormula:string
  occupationTotal:number
  interestFormula:string
  interestTotal:number
  creditMin:number
  creditMax:number
  overridden:Record<string,boolean>
}

const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:undefined

/**
 * The `limits` block the kernel stores on every draft (contract §23.4, kernel-ts/setup/drafts.ts):
 * flat effective bounds, the two formulas with their evaluated totals, the occupation's credit
 * rating range, and the list of bounds an override supplied. Missing entries fall back to the
 * rulebook defaults the contract names.
 */
export function readLimits(raw:unknown):Limits|null {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null
  const row=raw as Row
  const credit=Array.isArray(row.credit_rating_range)?row.credit_rating_range:[]
  const formula=(value:unknown)=>value&&typeof value==='object'&&typeof (value as Row).formula==='string'?(value as Row).formula:''
  const formulaTotal=(value:unknown)=>value&&typeof value==='object'?finite((value as Row).total):undefined
  const overridden:Record<string,boolean>=Array.isArray(row.overridden)
    ?Object.fromEntries(row.overridden.filter((key:unknown)=>typeof key==='string').map((key:string)=>[key,true]))
    :{}
  return {
    characteristicMin:finite(row.characteristic_min)??15,
    characteristicMax:finite(row.characteristic_max)??90,
    skillCap:finite(row.skill_cap)??75,
    occupationFormula:formula(row.occupation_formula),
    occupationTotal:finite(row.occupation_points)??formulaTotal(row.occupation_formula)??0,
    interestFormula:formula(row.interest_formula),
    interestTotal:finite(row.interest_points)??formulaTotal(row.interest_formula)??0,
    creditMin:finite(credit[0])??0,
    creditMax:finite(credit[1])??0,
    overridden,
  }
}

/** An edit value is a whole number or it is not an edit. */
const parseWhole=(value:string):number|undefined=>/^\s*-?\d+\s*$/.test(value)?parseInt(value,10):undefined

/**
 * The manual numeric edit control behind the card (contract §23.4). It edits numbers only and
 * never computes one: every derived value, base, budget and limit on screen comes from the
 * current payload or the latest `dry_run` preview, and every change rides back to the kernel as
 * raw field edits.
 */
export function CocCharacterDraftEdit({data,t,onOverride,onClose}:Props) {
  const sheet=data.sheet||{}
  const characteristicKeys=Object.keys(sheet.characteristics||{})
  const skillNames=Object.keys(sheet.skills||{}).filter(name=>name!=='Credit Rating')
  const [characteristics,setCharacteristics]=useState<Record<string,string>>(()=>Object.fromEntries(characteristicKeys.map(key=>[key,String(sheet.characteristics[key])])))
  const [skills,setSkills]=useState<Record<string,string>>(()=>Object.fromEntries(skillNames.map(name=>[name,String(sheet.skills[name])])))
  const [creditRating,setCreditRating]=useState<string>(sheet.credit_rating===undefined?'':String(sheet.credit_rating))
  const [unlocked,setUnlocked]=useState(false)
  const [limitsDraft,setLimitsDraft]=useState<Record<string,string>>(()=>{
    const limits=readLimits(data.limits)
    const flags=limits?.overridden||{}
    const effective:Record<LimitField,number|undefined>=limits?{
      characteristic_min:limits.characteristicMin,
      characteristic_max:limits.characteristicMax,
      skill_cap:limits.skillCap,
      occupation_points:limits.occupationTotal,
      interest_points:limits.interestTotal,
    }:{characteristic_min:undefined,characteristic_max:undefined,skill_cap:undefined,occupation_points:undefined,interest_points:undefined}
    const draft:Record<string,string>={}
    for(const field of LIMIT_FIELDS)if(flags[field]&&effective[field]!==undefined)draft[field]=String(effective[field])
    return draft
  })
  const [preview,setPreview]=useState<Row|null>(null)
  const [previewFailed,setPreviewFailed]=useState(false)
  const [fieldErrors,setFieldErrors]=useState<Record<string,string>>({})
  const [superseded,setSuperseded]=useState(false)
  const [saving,setSaving]=useState(false)
  const [saveFailed,setSaveFailed]=useState(false)
  const sequence=useRef(0)
  const alive=useRef(true)
  useEffect(()=>()=>{alive.current=false},[])

  const collectEdits=():Row=>{
    const edits:Row={}
    const changedCharacteristics:Row={}
    for(const key of characteristicKeys){const value=parseWhole(characteristics[key]||'');if(value!==undefined&&value!==sheet.characteristics[key])changedCharacteristics[key]=value}
    if(Object.keys(changedCharacteristics).length)edits.characteristics=changedCharacteristics
    const changedSkills:Row={}
    for(const name of skillNames){const value=parseWhole(skills[name]||'');if(value!==undefined&&value!==sheet.skills[name])changedSkills[name]=value}
    if(Object.keys(changedSkills).length)edits.skills=changedSkills
    const credit=parseWhole(creditRating)
    if(credit!==undefined&&credit!==sheet.credit_rating)edits.credit_rating=credit
    return edits
  }
  const collectLimitsOverride=():Row|undefined=>{
    const override:Row={}
    for(const field of LIMIT_FIELDS){const value=parseWhole(limitsDraft[field]||'');if(value!==undefined)override[field]=value}
    return Object.keys(override).length?override:undefined
  }

  /**
   * A `needs` refusal names the pool, the spend and the offending field; mark exactly that input.
   *
   * A pool refusal and a bound refusal are two different sentences and only one of them is about a
   * range. Both used to end in the offending field's own legal range, which on a pool refusal is
   * the range the entered value is already inside: raising Spot Hidden to 60 came back as "Not
   * enough occupation points. (Allowed range: 25 – 75)" — a number refused for being out of a
   * range that contains it, with no hint of the actual blocker. Both budgets start fully spent, so
   * this is the first thing a player meets on the first edit they try. A pool refusal now reports
   * the arithmetic that refused it and the two ways out.
   */
  const applyNeeds=(error:Row|undefined)=>{
    const details=error?.details&&typeof error.details==='object'?error.details as Row:error||{}
    const pool=typeof details.pool==='string'?details.pool:''
    let message=pool==='occupation'?t('Not enough occupation points.'):pool==='interest'?t('Not enough interest points.'):t('Value outside the allowed range.')
    const range=Array.isArray(details.range)?details.range:[]
    const spend=finite(details.spend),total=finite(details.total)
    if(pool&&spend!==undefined&&total!==undefined)message+=` (${t('Spent')}: ${spend} / ${total}) ${t('Take the points from another skill in the same pool, or raise the budget under Unlock limits.')}`
    else if(finite(range[0])!==undefined&&finite(range[1])!==undefined)message+=` (${t('Allowed range')}: ${range[0]} – ${range[1]})`
    const field=typeof details.field==='string'?details.field:''
    const target=characteristicKeys.includes(field)?`characteristic:${field}`:skillNames.includes(field)?`skill:${field}`:field==='credit_rating'?'credit_rating':'form'
    setFieldErrors({[target]:message})
  }

  // Debounced live preview: every edit (and every unlocked bound) is rebuilt and revalidated by
  // the kernel, so the derived values and budget meters below are always its arithmetic.
  useEffect(()=>{
    const edits=collectEdits()
    const limitsOverride=collectLimitsOverride()
    if(!Object.keys(edits).length&&!limitsOverride){sequence.current+=1;setPreview(null);setFieldErrors({});setPreviewFailed(false);return}
    const id=++sequence.current
    const timer=setTimeout(()=>{
      void onOverride({revision:data.revision,edits,...(limitsOverride?{limits_override:limitsOverride}:{}),dry_run:true})
        .then(result=>{
          if(!alive.current||sequence.current!==id)return
          if(result?.superseded){setSuperseded(true);return}
          if(result?.ok===false){applyNeeds(result.error);return}
          setPreview(result)
          setFieldErrors({})
          setPreviewFailed(false)
        })
        .catch(()=>{if(alive.current&&sequence.current===id)setPreviewFailed(true)})
    },400)
    return()=>clearTimeout(timer)
  },[characteristics,skills,creditRating,limitsDraft])

  const save=async()=>{
    const invalid:Record<string,string>={}
    for(const key of characteristicKeys)if(parseWhole(characteristics[key]||'')===undefined)invalid[`characteristic:${key}`]=t('Enter a whole number.')
    for(const name of skillNames)if(parseWhole(skills[name]||'')===undefined)invalid[`skill:${name}`]=t('Enter a whole number.')
    if(parseWhole(creditRating)===undefined)invalid.credit_rating=t('Enter a whole number.')
    if(Object.keys(invalid).length){setFieldErrors(invalid);return}
    sequence.current+=1
    setSaving(true)
    setSaveFailed(false)
    try {
      const limitsOverride=collectLimitsOverride()
      const result=await onOverride({revision:data.revision,edits:collectEdits(),...(limitsOverride?{limits_override:limitsOverride}:{})})
      if(!alive.current)return
      if(result?.superseded){setSuperseded(true);return}
      if(result?.ok===false){applyNeeds(result.error);return}
      onClose()
    } catch {
      if(alive.current)setSaveFailed(true)
    } finally {
      if(alive.current)setSaving(false)
    }
  }

  const view=preview||data
  const viewSheet=view.sheet||sheet
  const limits=readLimits(view.limits)||readLimits(data.limits)
  // A cleared unlock input keeps the persisted relaxation (the kernel's `carried` rule), so it is
  // not a change either; Save stays disabled until an edit or a bound actually moves, because a
  // no-op save would still write a revision and pay a full re-projection.
  const persistedLimits=readLimits(data.limits)
  const persistedValue=(field:LimitField):number|undefined=>{
    if(!persistedLimits||!persistedLimits.overridden[field])return undefined
    return {characteristic_min:persistedLimits.characteristicMin,characteristic_max:persistedLimits.characteristicMax,
      skill_cap:persistedLimits.skillCap,occupation_points:persistedLimits.occupationTotal,
      interest_points:persistedLimits.interestTotal}[field]
  }
  const limitsChanged=LIMIT_FIELDS.some(field=>(parseWhole(limitsDraft[field]||'')??persistedValue(field))!==persistedValue(field))
  const saveDisabled=saving||(!Object.keys(collectEdits()).length&&!limitsChanged)
  const ledger=viewSheet.creation?.skills||{}
  const occupation=ledger.occupation,interest=ledger.interest
  const ledgerCredit=finite(occupation?.credit_rating?.value)
  const budgets=[
    {key:'Occupation points',total:finite(occupation?.budget?.total)??limits?.occupationTotal,spent:finite(occupation?.spent)!==undefined&&ledgerCredit!==undefined?finite(occupation?.spent)!+ledgerCredit:finite(occupation?.spent),remaining:finite(occupation?.unspent)},
    {key:'Interest points',total:finite(interest?.budget?.total)??limits?.interestTotal,spent:finite(interest?.spent),remaining:finite(interest?.unspent)},
  ]
  /** A skill's base on the preview's characteristics: its final minus both recorded pools. */
  const skillBase=(name:string):number|undefined=>{
    const final=finite(viewSheet.skills?.[name])
    if(final===undefined||!occupation?.allocations||!interest?.allocations)return undefined
    return final-(occupation.allocations[name]||0)-(interest.allocations[name]||0)
  }
  const amount=(value:unknown)=>typeof value==='number'?String(value):'—'
  const rangeCaption=(min:number|undefined,max:number|undefined)=>`${t('Allowed range')}: ${amount(min)} – ${amount(max)}`
  const field=(id:string,label:string,value:string,onChange:(next:string)=>void,caption:string)=>(
    <div className="coc-draft-edit-field" key={id}>
      <label><span>{label}</span><input inputMode="numeric" value={value} aria-invalid={!!fieldErrors[id]} onChange={event=>onChange(event.target.value)}/></label>
      <p className="coc-draft-edit-caption">{caption}</p>
      {fieldErrors[id]&&<p className="coc-draft-edit-error" role="alert">{fieldErrors[id]}</p>}
    </div>
  )
  const limitLabels:Record<LimitField,string>={characteristic_min:t('Characteristic minimum'),characteristic_max:t('Characteristic maximum'),skill_cap:t('Skill cap'),occupation_points:t('Occupation points'),interest_points:t('Interest points')}
  return <div className="coc-draft-edit-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <section className="coc-draft-edit" role="dialog" aria-modal="true" aria-label={t('Edit draft numbers')}>
      <header className="coc-draft-edit-header"><h2>{t('Edit draft numbers')}</h2><button type="button" className="coc-draft-edit-close" aria-label={t('Close')} onClick={onClose}>×</button></header>
      {superseded?<div className="coc-draft-edit-body">
        <p role="alert">{t('The draft changed while you were editing. The latest version is shown instead.')}</p>
        <footer className="coc-draft-edit-actions"><button type="button" className="coc-draft-edit-primary" onClick={onClose}>{t('Close')}</button></footer>
      </div>:<div className="coc-draft-edit-body">
        {fieldErrors.form&&<p className="coc-draft-edit-error" role="alert">{fieldErrors.form}</p>}
        {previewFailed&&<p className="coc-draft-edit-error" role="alert">{t('Preview unavailable')}</p>}
        <h3>{t('Characteristics')}</h3>
        <div className="coc-draft-edit-grid">{characteristicKeys.map(key=>field(`characteristic:${key}`,t(key),characteristics[key]||'',next=>setCharacteristics(current=>({...current,[key]:next})),limits?rangeCaption(limits.characteristicMin,limits.characteristicMax):''))}</div>
        <h3>{t('Derived values')}</h3>
        <dl className="coc-draft-edit-derived">{Object.entries(viewSheet.derived||{}).map(([key,value])=><div key={key}><dt>{t(key)}</dt><dd>{key==='DB'&&value==='none'?0:String(value)}</dd><p className="coc-draft-edit-caption">{t('Calculated automatically')}</p></div>)}</dl>
        <h3>{t('Skills')}</h3>
        <table className="coc-draft-edit-budgets"><thead><tr><th>{t('Point allocation')}</th><th>{t('Total points')}</th><th>{t('Spent')}</th><th>{t('Remaining')}</th></tr></thead><tbody>{budgets.map(budget=><tr key={budget.key}><th scope="row">{t(budget.key)}</th><td>{amount(budget.total)}</td><td>{amount(budget.spent)}</td><td>{amount(budget.remaining)}</td></tr>)}</tbody></table>
        <div className="coc-draft-edit-grid">{skillNames.map(name=>{
          const base=skillBase(name)
          const caption=base!==undefined&&limits?rangeCaption(base,limits.skillCap):limits?`${t('Starting skill cap')}: ${limits.skillCap}`:''
          return field(`skill:${name}`,t(name),skills[name]||'',next=>setSkills(current=>({...current,[name]:next})),caption)
        })}</div>
        {field('credit_rating',t('Credit Rating'),creditRating,setCreditRating,limits?rangeCaption(limits.creditMin,limits.creditMax):'')}
        <h3>{t('Rules in force')}</h3>
        {limits&&<dl className="coc-draft-edit-limits">
          <div><dt>{t('Characteristic range')}</dt><dd>{limits.characteristicMin} – {limits.characteristicMax}{limits.overridden.characteristic_min||limits.overridden.characteristic_max?` · ${t('Overridden')}`:''}</dd></div>
          <div><dt>{t('Starting skill cap')}</dt><dd>{limits.skillCap}{limits.overridden.skill_cap?` · ${t('Overridden')}`:''}</dd></div>
          <div><dt>{t('Occupation points')}</dt><dd>{limits.occupationFormula?`${limits.occupationFormula} = `:''}{limits.occupationTotal}{limits.overridden.occupation_points?` · ${t('Overridden')}`:''}</dd></div>
          <div><dt>{t('Interest points')}</dt><dd>{limits.interestFormula?`${limits.interestFormula} = `:''}{limits.interestTotal}{limits.overridden.interest_points?` · ${t('Overridden')}`:''}</dd></div>
          <div><dt>{t('Credit Rating range')}</dt><dd>{limits.creditMin} – {limits.creditMax}</dd></div>
        </dl>}
        <button type="button" className="coc-draft-edit-unlock" aria-expanded={unlocked} onClick={()=>setUnlocked(value=>!value)}>{t(unlocked?'Hide limit overrides':'Unlock limits')}</button>
        {unlocked&&<div className="coc-draft-edit-grid">{LIMIT_FIELDS.map(name=>field(`limit:${name}`,limitLabels[name],limitsDraft[name]||'',next=>setLimitsDraft(current=>({...current,[name]:next})),''))}</div>}
        <footer className="coc-draft-edit-actions">
          {saveFailed&&<p className="coc-draft-edit-error" role="alert">{t('The save failed — try again.')}</p>}
          <button type="button" onClick={onClose}>{t('Cancel')}</button>
          <button type="button" className="coc-draft-edit-primary" disabled={saveDisabled} onClick={()=>void save()}>{t('Save changes')}</button>
        </footer>
      </div>}
    </section>
  </div>
}
