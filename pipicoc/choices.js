/**
 * Structured interaction controls. No rule question is concatenated into story prose.
 *
 * The words are the delivery's, not this file's: `details.ui = {tag, words}` carries the session's
 * play language (§23, 2026-09-09), so the six mechanics options are `choices.option.<name>` rows in
 * `content/ui/<tag>/choices.json` and a seventh option a kernel grows shows its own key until one is
 * authored. A story option is the Keeper's own text and is printed as written.
 */

/** A caption from the delivery's `ui` block, or `fallback` -- the key by default, never a word
 *  from a language the player did not choose. */
function word(ui, surface, key, fallback) {
  const words = ui && typeof ui === 'object' && ui.words && typeof ui.words === 'object' ? ui.words : {};
  const table = words[surface] && typeof words[surface] === 'object' ? words[surface] : {};
  return typeof table[key] === 'string' ? table[key] : fallback === undefined ? key : fallback;
}

export function createComponent(React) {
  const h=React.createElement;
  return function Choice({details={},onSelectOption}) {
    const [selected,setSelected]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(null);
    const t=(key,fallback)=>word(details.ui,'choices',key,fallback);
    // Retire the whole defense interaction, including old cards that also offered flee.
    const retiredDefense = (typeof details.binds === 'string' && details.binds.startsWith('defense:'))
      || (typeof details.name === 'string' && details.name.startsWith('defense:'))
      || (details.kind === 'mechanics' && (details.options || []).some(option => option === 'dodge' || option === 'fight_back'));
    async function choose(option) {
      if(!onSelectOption||retiredDefense)return;
      setBusy(true);setError(null);
      // A refusal is shown by its code; the English message it carries is for the log, so it goes
      // behind a fold rather than becoming the sentence the player reads.
      try {await onSelectOption(option);setSelected(option);}
      catch(e){setError({code:typeof e?.code==='string'?e.code:'',message:e instanceof Error?e.message:String(e)});}
      finally{setBusy(false);}
    }
    return h('section',{'aria-label':t('actions'),style:{display:'grid',gap:8,padding:'12px 0'}},
      details.kind==='story'&&details.prompt?h('p',null,details.prompt):null,
      h('div',{style:{display:'flex',gap:8,flexWrap:'wrap'}},...(details.options||[]).map(option=>h('button',{key:option,type:'button',disabled:busy||selected!==null||!onSelectOption||retiredDefense,onClick:()=>void choose(option),style:{padding:'8px 14px',borderRadius:8,border:'1px solid var(--border)',background:selected===option?'var(--accent-soft)':'var(--surface)',color:'var(--text)'}},details.kind==='mechanics'?t(`option.${option}`):option))),
      error?h('p',{role:'alert'},word(details.ui,'errors',error.code,word(details.ui,'errors','unknown')),
        error.message?h('details',null,h('summary',null,word(details.ui,'errors','details')),h('p',null,error.message)):null):null);
  };
}
