/** Structured interaction controls. No rule question is concatenated into story prose. */
export function createComponent(React) {
  const h=React.createElement;
  return function Choice({details={},onSelectOption}) {
    const [selected,setSelected]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
    const zh=details.play_language==='zh-Hans';
    const labels=zh?{push:'孤注一掷',spend_luck:'使用幸运',accept:'接受结果',dodge:'闪避',fight_back:'反击',flee:'逃离'}:{push:'Push',spend_luck:'Spend Luck',accept:'Accept',dodge:'Dodge',fight_back:'Fight back',flee:'Flee'};
    async function choose(option) {
      if(!onSelectOption)return;
      setBusy(true);setError('');
      try {await onSelectOption(option);setSelected(option);}catch(e){setError(e.message||String(e));}finally{setBusy(false);}
    }
    return h('section',{'aria-label':zh?'行动选择':'Actions',style:{display:'grid',gap:8,padding:'12px 0'}},
      details.kind==='story'&&details.prompt?h('p',null,details.prompt):null,
      h('div',{style:{display:'flex',gap:8,flexWrap:'wrap'}},...(details.options||[]).map(option=>h('button',{key:option,type:'button',disabled:busy||selected!==null||!onSelectOption,onClick:()=>void choose(option),style:{padding:'8px 14px',borderRadius:8,border:'1px solid var(--border)',background:selected===option?'var(--accent-soft)':'var(--surface)',color:'var(--text)'}},details.kind==='mechanics'?(labels[option]||option):option))),
      error?h('p',{role:'alert'},error):null);
  };
}
