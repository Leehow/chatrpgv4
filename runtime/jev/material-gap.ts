/**
 * Contract §205: what a turn's request needs from the book and the record, and whether the material supplied for it holds
 * that. The needs are the player's line cut at sentence boundaries (a cut, never a judgement); whether each need is held,
 * missing or not a material need at all is Jev's, one closed choice per need, and which located book entry a need is about
 * is a second closed choice over the entries the locate found. Nothing here reads meaning from text.
 */
import type {DecisionAnswer,DecisionQuestion,Json} from './contracts.ts';

type Row=Record<string,any>;
/** At most this many needs; the rest of a longer line joins the last one. */
export const MATERIAL_NEEDS=6;
/** At most this many located book entries are offered as what a need is about. */
export const MATERIAL_ENTRIES=8;
/** A need is unmet when Jev chose `missing` with at least this probability (a read-only consequence: a lookup, a note). */
export const GAP_MISSING=0.5;
/** The host supplies at most this many found passages for one unmet need (§205.3). */
export const GAP_HOST_PASSAGES=2;
/** The focus a source answer is asked under when the need is about no located entry (the consultation path's own default). */
export const GAP_QUERY='Authored source consultation';

/**
 * The parts of a player's line, in order: its sentences (`Intl.Segmenter`, sentence granularity, no locale: Unicode's
 * sentence boundaries, the same in every script), trimmed. A line longer than `MATERIAL_NEEDS` sentences keeps the first
 * five and its whole remainder as the sixth, so nothing the player said is dropped.
 */
export function requestNeeds(text:string):string[] {
    const segments=[...new Intl.Segmenter(undefined,{granularity:'sentence'}).segment(text)]
        .filter(segment=>segment.segment.trim());
    if(!segments.length)return [];
    const kept=segments.slice(0,MATERIAL_NEEDS-1).map(segment=>segment.segment.trim());
    if(segments.length>=MATERIAL_NEEDS)kept.push(text.slice(segments[MATERIAL_NEEDS-1].index).trim());
    return kept;
}

export interface GapView {needs:Array<{alias:string;text:string}>;book_entries?:Array<{alias:string;label:string}>}
/** What Jev is shown beside the materials: the needs by alias and the located book entries by alias (labels only). */
export function gapView(needs:readonly string[],entries:readonly string[]):GapView {
    const offered=entries.slice(0,MATERIAL_ENTRIES);
    return {needs:needs.map((text,index)=>({alias:`need_${index+1}`,text})),
        ...(offered.length?{book_entries:offered.map((label,index)=>({alias:`entry_${index+1}`,label}))}:{})};
}

/**
 * One closed choice per need (`need_<n>`: held, missing, none), and, when there are entries, which entry it is about
 * (`about_need_<n>`). `held` is listed first: an answer that defaults to the first candidate names no gap.
 */
export function gapQuestions(view:GapView):DecisionQuestion[] {
    const entries=view.book_entries??[];
    return view.needs.flatMap(({alias}):DecisionQuestion[]=>[
        {key:alias,target:alias,type:'choice' as const,
            instructions:`Judge only ${alias}, one part of the request (its text is in needs), against the materials and the retained context `
                +'in this state as they are now, before any listed operation runs. Does what this part asks about or depends on stand in them?',
            criteria:{held:'The supplied materials or the retained context state what this part asks about or depends on.',
                missing:'This part asks about or depends on a person, place, thing, event, or what someone knows or says, and nothing supplied states it.',
                none:'This part needs nothing a book or a record holds: it is only the investigator\'s own action, movement, words, plan or feeling.'}},
        ...(entries.length?[{key:`about_${alias}`,target:alias,type:'choice' as const,
            instructions:`Which listed book entry (book_entries) is ${alias} about? Choose none when it is about none of them.`,
            criteria:{...Object.fromEntries(entries.map(entry=>[entry.alias,entry.label])),none:'About none of the listed entries.'}}]:[]),
    ]);
}

export type NeedChoice='held'|'missing'|'none'|'unknown';
export interface NeedVerdict {need:number;text:string;choice:NeedChoice;p_missing?:number;about?:string}

/** The verdict per need from a decision's answers; an unanswered need is `unknown`, never held or missing. */
export function readNeeds(answers:Readonly<Record<string,DecisionAnswer>>|undefined,view:GapView):NeedVerdict[] {
    const entries=new Map((view.book_entries??[]).map(entry=>[entry.alias,entry.label]));
    return view.needs.map(({alias,text},index)=>{
        const answer=answers?.[alias],about=answers?.[`about_${alias}`];
        if(answer?.status!=='answered'||answer.type!=='choice'||!['held','missing','none'].includes(answer.choice))
            return {need:index+1,text,choice:'unknown' as const};
        const probability=answer.probabilities?.missing,label=about?.status==='answered'&&about.type==='choice'?entries.get(about.choice):undefined;
        return {need:index+1,text,choice:answer.choice as NeedChoice,...(typeof probability==='number'?{p_missing:probability}:{}),
            ...(label?{about:label}:{})};
    });
}
/** A need is unmet when Jev chose `missing` (with at least `GAP_MISSING` where it reported a distribution). */
export const unmet=(verdict:NeedVerdict):boolean=>verdict.choice==='missing'&&(verdict.p_missing??1)>=GAP_MISSING;

/**
 * The Keeper-facing row for an unmet need the host could not supply: the player's own words for it, the book entry it is
 * about, and the lookup to make before narrating (a source answer when the table has a module source, else Jev support).
 */
export function missingRow(verdict:NeedVerdict,ordinal:number,source:boolean):Row {
    return {alias:`missing_${ordinal}`,need:verdict.text,...(verdict.about?{about:verdict.about}:{}),
        read:source?{tool:'lookup',kind:'source',source_mode:'answer',query:verdict.about??GAP_QUERY,question:verdict.text}
            :{tool:'lookup',kind:'support',query:verdict.text}};
}

/** Telemetry for one verdict: never the player's words, only what was judged. */
export const verdictSummary=(verdict:NeedVerdict):Json=>({need:verdict.need,choice:verdict.choice,
    ...(verdict.p_missing!==undefined?{p_missing:verdict.p_missing}:{}),about:Boolean(verdict.about)});
