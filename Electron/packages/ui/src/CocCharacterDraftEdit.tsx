import {useEffect,useRef,useState,type ReactNode} from 'react'
import {groupSkills,OCCUPATION_SKILL_LIMIT,type SkillGroupKey} from './coc-skill-groups'
import './coc-character-draft-edit.css'

type Row=Record<string,any>
type Props={data:Row;t:(key:string)=>string;onOverride:(request:Row)=>Promise<Row>;onClose:()=>void;onCatalog?:()=>Promise<Row>}

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
export function CocCharacterDraftEdit({data,t,onOverride,onClose,onCatalog}:Props) {
  const sheet=data.sheet||{}
  const ledgerOf=(source:Row)=>source?.creation?.skills||{}
  const allocation=(source:Row,pool:string,name:string):number=>finite(ledgerOf(source)?.[pool]?.allocations?.[name])??0
  const characteristicKeys=Object.keys(sheet.characteristics||{})
  const skillNames=Object.keys(sheet.skills||{}).filter(name=>name!=='Credit Rating')
  const [characteristics,setCharacteristics]=useState<Record<string,string>>(()=>Object.fromEntries(characteristicKeys.map(key=>[key,String(sheet.characteristics[key])])))
  /**
   * The worksheet's two boxes per skill, not one final number (§98).
   *
   * A final value is the base plus what each pool bought, and the player was being asked to type
   * the sum and let the kernel work backwards -- which is why raising one skill read as "not
   * enough occupation points" for a pool they never meant to spend from. The boxes are the
   * rulebook's own columns, and they start where the ledger recorded them.
   */
  const [occupationPoints,setOccupationPoints]=useState<Record<string,string>>(()=>Object.fromEntries(skillNames.map(name=>[name,String(allocation(sheet,'occupation',name))])))
  const [interestPoints,setInterestPoints]=useState<Record<string,string>>(()=>Object.fromEntries(skillNames.map(name=>[name,String(allocation(sheet,'interest',name))])))
  const [creditRating,setCreditRating]=useState<string>(sheet.credit_rating===undefined?'':String(sheet.credit_rating))
  // Age is a characteristic edit in everything but name: the kernel reruns the age table on the
  // same dice, so EDU, APP, movement and Luck all move with it, and the pins stay as typed.
  const [age,setAge]=useState<string>(sheet.age===undefined?'':String(sheet.age))
  const [occupationId,setOccupationId]=useState<string>(String(data.profile?.occupation??sheet.occupation??''))
  const [catalog,setCatalog]=useState<Row|null>(null)
  /**
   * A skill the book does not print, written by the player (§98). The ones already saved are on
   * the sheet like any other and are drawn in their own group with a tag; the ones added here have
   * no sheet entry yet, so they live in the Custom skills section until a save gives them one --
   * which is also why only those can be taken back off the list.
   */
  const savedCustom:{name:string;base:number}[]=Array.isArray(data.profile?.custom_skills)
    ?data.profile.custom_skills.filter((entry:unknown)=>!!entry&&typeof (entry as Row).name==='string').map((entry:Row)=>({name:entry.name,base:finite(entry.base)??0}))
    :[]
  const customNames=new Set([...savedCustom.map(entry=>entry.name),...(Array.isArray(ledgerOf(sheet).custom)?ledgerOf(sheet).custom.filter((name:unknown)=>typeof name==='string'):[])])
  const [added,setAdded]=useState<{name:string;base:number}[]>([])
  const [draftSkill,setDraftSkill]=useState<{name:string;base:string;interest:string}>({name:'',base:'',interest:''})
  /**
   * Which pool each skill is taken from, as the player may now decide it (§98).
   *
   * The seed is the ledger's own two lists, so a dialog that is only opened and closed changes
   * nothing. A skill's group is the player's answer to "did my occupation pay for this", and the
   * kernel re-flows both pools around the pins when the lists move -- which is why the order rows
   * sit in is sent as well: it is the order the points are spent in.
   */
  const seededGroups=():Record<string,SkillGroupKey>=>{
    const seeded:Record<string,SkillGroupKey>={}
    for(const group of groupSkills(skillNames,sheet)??[])for(const name of group.names)seeded[name]=group.key
    // A revision whose ledger names no lists still recorded what each pool bought, and every row
    // needs a group to draw its boxes from. Reading the allocations back is the nearest true
    // answer -- and it means opening the dialog on such a card changes nothing, where seeding
    // everything to "other" would have zeroed eight occupation boxes on sight.
    for(const name of skillNames)if(!seeded[name])
      seeded[name]=allocation(sheet,'occupation',name)>0?'occupation':allocation(sheet,'interest',name)>0?'interest':'other'
    return seeded
  }
  const [groups,setGroups]=useState<Record<string,SkillGroupKey>>(seededGroups)
  const [groupError,setGroupError]=useState<string|null>(null)
  const inGroup=(key:SkillGroupKey)=>skillNames.filter(name=>groups[name]===key)
  const chooseGroup=(name:string,key:SkillGroupKey)=>{
    // Eight is the rulebook's occupation list, and the kernel refuses a ninth; refusing it here
    // keeps the player from typing a whole card into a shape that cannot be saved.
    if(key==='occupation'&&groups[name]!=='occupation'&&inGroup('occupation').length>=OCCUPATION_SKILL_LIMIT){setGroupError(name);return}
    setGroupError(null)
    setGroups(current=>({...current,[name]:key}))
  }
  /** Every skill with a row: the sheet's, plus the ones added in this dialog and not yet saved. */
  const addedNames=added.map(entry=>entry.name)
  const editedNames=[...skillNames,...addedNames]
  const points=(value:string|undefined):number|undefined=>(value??'').trim()===''?0:parseWhole(value??'')
  const occupationOf=(name:string):number=>groups[name]==='occupation'?(points(occupationPoints[name])??0):0
  const interestOf=(name:string):number=>points(interestPoints[name])??0
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
  // Whether the preview on screen is an answer to what is on screen. While the player is typing
  // the row computes its own final; the moment the kernel answers, its arithmetic -- which knows
  // the cap -- replaces it.
  const [previewFresh,setPreviewFresh]=useState(false)
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
    /**
     * A skill edit is what each pool bought, not the sum. The kernel still accepts a bare number
     * as a final value; the card no longer sends one, because the sum cannot say which pool the
     * player meant. A skill that left the occupation group reports its occupation box as zero, so
     * the points it was holding are visibly given back rather than silently re-flowed.
     */
    const changedSkills:Row={}
    for(const name of editedNames) {
      const wasOccupation=allocation(sheet,'occupation',name),wasInterest=allocation(sheet,'interest',name)
      const now=occupationOf(name),interest=interestOf(name)
      if(now===wasOccupation&&interest===wasInterest)continue
      const entry:Row={interest}
      if(groups[name]==='occupation'||wasOccupation!==0)entry.occupation=now
      changedSkills[name]=entry
    }
    if(Object.keys(changedSkills).length)edits.skills=changedSkills
    const credit=parseWhole(creditRating)
    if(credit!==undefined&&credit!==sheet.credit_rating)edits.credit_rating=credit
    return edits
  }
  /**
   * The two lists, sent only when one of them moved. An unchanged pair is not a patch: it would
   * make every save a re-flow of points the player never asked to move.
   */
  const collectProfile=():Row|undefined=>{
    const patch:Row={}
    const seeded=seededGroups()
    if(!skillNames.every(name=>seeded[name]===groups[name])) {
      patch.occupation_skills=inGroup('occupation')
      patch.interest_skills=inGroup('interest')
    }
    const years=parseWhole(age)
    if(years!==undefined&&years!==sheet.age)patch.age=years
    if(occupationId&&occupationId!==String(data.profile?.occupation??sheet.occupation??''))patch.occupation=occupationId
    if(added.length)patch.custom_skills=[...savedCustom,...added]
    return Object.keys(patch).length?patch:undefined
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
    const target=characteristicKeys.includes(field)?`characteristic:${field}`:editedNames.includes(field)?`skill:${field}`:field==='credit_rating'?'credit_rating':'form'
    setFieldErrors({[target]:message})
  }

  /**
   * The rulebook's own list of trades, asked for once when the dialog opens.
   *
   * A trade the player picks here is a profile fact: the kernel refills the eight occupation
   * skills from the new trade around the picks they have already made. A build whose host cannot
   * answer draws no picker rather than an empty one -- a dropdown with nothing in it reads as "the
   * book has no occupations".
   */
  useEffect(()=>{
    if(!onCatalog)return
    let active=true
    void onCatalog().then(answer=>{if(active&&answer&&typeof answer==='object')setCatalog(answer)}).catch(()=>undefined)
    return()=>{active=false}
  },[])

  // Debounced live preview: every edit (and every unlocked bound) is rebuilt and revalidated by
  // the kernel, so the derived values and budget meters below are always its arithmetic.
  useEffect(()=>{
    const edits=collectEdits()
    const limitsOverride=collectLimitsOverride()
    const profile=collectProfile()
    if(!Object.keys(edits).length&&!limitsOverride&&!profile){sequence.current+=1;setPreview(null);setPreviewFresh(false);setFieldErrors({});setPreviewFailed(false);return}
    const id=++sequence.current
    setPreviewFresh(false)
    const timer=setTimeout(()=>{
      void onOverride({revision:data.revision,edits,...(limitsOverride?{limits_override:limitsOverride}:{}),...(profile?{profile}:{}),dry_run:true})
        .then(result=>{
          if(!alive.current||sequence.current!==id)return
          if(result?.superseded){setSuperseded(true);return}
          if(result?.ok===false){applyNeeds(result.error);return}
          setPreview(result)
          setPreviewFresh(true)
          setFieldErrors({})
          setPreviewFailed(false)
        })
        .catch(()=>{if(alive.current&&sequence.current===id)setPreviewFailed(true)})
    },400)
    return()=>clearTimeout(timer)
  },[characteristics,occupationPoints,interestPoints,creditRating,limitsDraft,groups,age,occupationId,added])

  const save=async()=>{
    const invalid:Record<string,string>={}
    for(const key of characteristicKeys)if(parseWhole(characteristics[key]||'')===undefined)invalid[`characteristic:${key}`]=t('Enter a whole number.')
    // A blank box is no points, not a mistake; anything else in one is.
    for(const name of editedNames)if(points(occupationPoints[name])===undefined||points(interestPoints[name])===undefined)invalid[`skill:${name}`]=t('Enter a whole number.')
    if(parseWhole(creditRating)===undefined)invalid.credit_rating=t('Enter a whole number.')
    if(parseWhole(age)===undefined)invalid.age=t('Enter a whole number.')
    if(Object.keys(invalid).length){setFieldErrors(invalid);return}
    sequence.current+=1
    setSaving(true)
    setSaveFailed(false)
    try {
      const limitsOverride=collectLimitsOverride(),profile=collectProfile()
      const result=await onOverride({revision:data.revision,edits:collectEdits(),...(limitsOverride?{limits_override:limitsOverride}:{}),...(profile?{profile}:{})})
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
  const saveDisabled=saving||(!Object.keys(collectEdits()).length&&!limitsChanged&&!collectProfile())
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
  const field=(id:string,label:string,value:string,onChange:(next:string)=>void,caption:string,extra?:ReactNode)=>(
    <div className="coc-draft-edit-field" key={id}>
      <label><span>{label}</span><input inputMode="numeric" value={value} aria-invalid={!!fieldErrors[id]} onChange={event=>onChange(event.target.value)}/></label>
      <p className="coc-draft-edit-caption">{caption}</p>
      {extra}
      {fieldErrors[id]&&<p className="coc-draft-edit-error" role="alert">{fieldErrors[id]}</p>}
    </div>
  )
  /**
   * The point-buy allowance for characteristics, recomputed from what the player is typing.
   *
   * The dialog computes no number it then saves -- this one is a reading of the eight fields on
   * screen against the total the kernel put on the card, so the allowance moves under the cursor
   * instead of a round trip later. Luck is rolled, never bought, so it is not in the sum. The
   * dry-run answer carries the same figures, and they replace these the moment it lands.
   */
  const characteristicTotal=finite((view.budget as Row|undefined)?.characteristics?.total)??finite((data.budget as Row|undefined)?.characteristics?.total)
  const characteristicSpend=characteristicKeys.filter(key=>key!=='LUCK')
    .reduce((sum,key)=>sum+(parseWhole(characteristics[key]||'')??finite(sheet.characteristics?.[key])??0),0)
  const characteristicLeft=characteristicTotal===undefined?undefined:characteristicTotal-characteristicSpend
  const groupOrder:SkillGroupKey[]=['occupation','interest','other']
  const groupHeading=(key:SkillGroupKey)=>t(key==='occupation'?'Occupation skills':key==='interest'?'Interest skills':'Other skills')
  /**
   * The base chance the rulebook prints for a skill, off the ledger the kernel writes. Dodge's is
   * half DEX, so a changed characteristic moves it -- which is why this reads the preview's sheet
   * when one is in rather than the sheet the dialog opened on.
   */
  const baseOf=(name:string):number=>finite(ledgerOf(viewSheet).bases?.[name])
    ??finite(added.find(entry=>entry.name===name)?.base)
    ??finite(skillBase(name))??0
  /** What the row adds up to: the kernel's answer when it is current, the row's own until then. */
  const finalOf=(name:string):number=>{
    const answered=previewFresh?finite(preview?.sheet?.skills?.[name]):undefined
    return answered??baseOf(name)+occupationOf(name)+interestOf(name)
  }
  const pointsBox=(name:string,pool:'occupation'|'interest',value:string,onChange:(next:string)=>void)=>{
    const caption=pool==='occupation'?t('Occupation points'):t('Interest points')
    return <label className="coc-draft-edit-box"><span>{caption}</span>
      <input inputMode="numeric" aria-label={`${t(name)} ${caption}`} aria-invalid={!!fieldErrors[`skill:${name}`]} value={value} onChange={event=>onChange(event.target.value)}/></label>
  }
  const skillField=(name:string)=>{
    const occupational=groups[name]==='occupation'
    return <div className="coc-draft-edit-skill" data-skill={name} key={`skill:${name}`}>
      <div className="coc-draft-edit-skill-head">
        <span className="coc-draft-edit-skill-name">{t(name)}{customNames.has(name)&&<span className="coc-draft-edit-tag">{t('Custom')}</span>}</span>
        {/* The select carries the skill's own name, so it is the same row the numbers belong to;
            role tells it apart from the boxes beside it. */}
        <select className="coc-draft-edit-group" aria-label={t(name)} value={groups[name]||'other'}
          onChange={event=>chooseGroup(name,event.target.value as SkillGroupKey)}>
          <option value="occupation">{t('Occupation')}</option>
          <option value="interest">{t('Interest')}</option>
          <option value="other">{t('Other')}</option>
        </select>
      </div>
      <p className="coc-draft-edit-caption">{t('Base')} {baseOf(name)}</p>
      <div className="coc-draft-edit-boxes">
        {occupational&&pointsBox(name,'occupation',occupationPoints[name]||'',next=>setOccupationPoints(current=>({...current,[name]:next})))}
        {pointsBox(name,'interest',interestPoints[name]||'',next=>setInterestPoints(current=>({...current,[name]:next})))}
      </div>
      <p className="coc-draft-edit-final">{t('Final')} {finalOf(name)}</p>
      {groupError===name&&<p className="coc-draft-edit-error" role="alert">{t('Eight occupation skills at most.')}</p>}
      {fieldErrors[`skill:${name}`]&&<p className="coc-draft-edit-error" role="alert">{fieldErrors[`skill:${name}`]}</p>}
    </div>
  }
  const occupations:Row[]=Array.isArray(catalog?.occupations)?catalog!.occupations.filter((entry:unknown)=>!!entry&&typeof (entry as Row).id==='string'):[]
  const addSkill=()=>{
    const name=draftSkill.name.trim()
    const base=points(draftSkill.base)
    if(!name||base===undefined||editedNames.includes(name))return
    setAdded(current=>[...current,{name,base}])
    setInterestPoints(current=>({...current,[name]:draftSkill.interest.trim()||'0'}))
    setDraftSkill({name:'',base:'',interest:''})
  }
  const removeSkill=(name:string)=>{
    setAdded(current=>current.filter(entry=>entry.name!==name))
    setInterestPoints(current=>{const next={...current};delete next[name];return next})
  }
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
        <div className="coc-draft-edit-identity">
          {field('age',t('Age'),age,setAge,t('Age changes EDU, APP, movement and Luck.'))}
          {occupations.length>0&&<div className="coc-draft-edit-field">
            <label><span>{t('Occupation')}</span>
              <select aria-label={t('Occupation')} value={occupationId} onChange={event=>setOccupationId(event.target.value)}>
                {!occupations.some(entry=>entry.id===occupationId)&&<option value={occupationId}>{t(occupationId)}</option>}
                {occupations.map(entry=><option key={entry.id} value={entry.id}>{typeof entry.label==='string'&&entry.label?entry.label:entry.id}</option>)}
              </select>
            </label>
          </div>}
        </div>
        <div className="coc-draft-edit-grid">{characteristicKeys.map(key=>field(`characteristic:${key}`,t(key),characteristics[key]||'',next=>setCharacteristics(current=>({...current,[key]:next})),limits?rangeCaption(limits.characteristicMin,limits.characteristicMax):''))}</div>
        {characteristicTotal!==undefined&&<p className="coc-draft-edit-characteristic-budget">
          <span>{t('Characteristic points')}</span> <span>{characteristicSpend} / {characteristicTotal}</span>
          {characteristicLeft!==undefined&&characteristicLeft>0?<> · {t('Points left')} {characteristicLeft}</>:characteristicLeft!==undefined&&characteristicLeft<0?<> · {t('Overspent by')} {-characteristicLeft}</>:null}
        </p>}
        <h3>{t('Derived values')}</h3>
        <dl className="coc-draft-edit-derived">{Object.entries(viewSheet.derived||{}).map(([key,value])=><div key={key}><dt>{t(key)}</dt><dd>{key==='DB'&&value==='none'?0:String(value)}</dd><p className="coc-draft-edit-caption">{t('Calculated automatically')}</p></div>)}</dl>
        <h3>{t('Skills')}</h3>
        <table className="coc-draft-edit-budgets"><thead><tr><th>{t('Point allocation')}</th><th>{t('Total points')}</th><th>{t('Spent')}</th><th>{t('Remaining')}</th></tr></thead><tbody>{budgets.map(budget=><tr key={budget.key}><th scope="row">{t(budget.key)}</th><td>{amount(budget.total)}</td><td>{amount(budget.spent)}</td><td>{amount(budget.remaining)}</td></tr>)}</tbody></table>
        {groupOrder.map(key=><div className="coc-draft-edit-skill-group" key={key} data-skill-group={key}>
          <h4>{groupHeading(key)}</h4>
          <div className="coc-draft-edit-grid">{inGroup(key).map(name=>skillField(name))}</div>
        </div>)}
        {/* A skill the book does not print. A language is one of these -- the rulebook writes it
            as a specialisation of Language, and a player who does not know that writes "Latin"
            and wonders why the sheet has no Latin on it. */}
        <div className="coc-draft-edit-skill-group" data-skill-group="custom">
          <h4>{t('Custom skills')}</h4>
          <p className="coc-draft-edit-caption">{t('A language you speak is written as Language (Other: name).')}</p>
          <div className="coc-draft-edit-grid">{added.map(entry=><div className="coc-draft-edit-skill" data-skill={entry.name} key={`added:${entry.name}`}>
            <div className="coc-draft-edit-skill-head"><span className="coc-draft-edit-skill-name">{entry.name}<span className="coc-draft-edit-tag">{t('Custom')}</span></span>
              <button type="button" onClick={()=>removeSkill(entry.name)}>{t('Remove')}</button></div>
            <p className="coc-draft-edit-caption">{t('Base')} {entry.base}</p>
            <div className="coc-draft-edit-boxes">{pointsBox(entry.name,'interest',interestPoints[entry.name]||'',next=>setInterestPoints(current=>({...current,[entry.name]:next})))}</div>
            <p className="coc-draft-edit-final">{t('Final')} {finalOf(entry.name)}</p>
          </div>)}</div>
          <div className="coc-draft-edit-skill coc-draft-edit-add">
            <label className="coc-draft-edit-box"><span>{t('Skill name')}</span>
              <input aria-label={t('Skill name')} value={draftSkill.name} onChange={event=>setDraftSkill(current=>({...current,name:event.target.value}))}/></label>
            <label className="coc-draft-edit-box"><span>{t('Base')}</span>
              <input inputMode="numeric" aria-label={t('Base')} value={draftSkill.base} onChange={event=>setDraftSkill(current=>({...current,base:event.target.value}))}/></label>
            <label className="coc-draft-edit-box"><span>{t('Interest points')}</span>
              <input inputMode="numeric" aria-label={`${t('Skill name')} ${t('Interest points')}`} value={draftSkill.interest} onChange={event=>setDraftSkill(current=>({...current,interest:event.target.value}))}/></label>
            <button type="button" onClick={addSkill}>{t('Add')}</button>
          </div>
        </div>
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
