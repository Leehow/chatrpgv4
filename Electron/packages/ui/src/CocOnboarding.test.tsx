// @vitest-environment jsdom
/**
 * The wizard's own words (§23). It shipped in one language with an `en` option beside it that only
 * changed what the Keeper would later write, so choosing English left the whole screen in Chinese.
 * Every caption now comes from the answer's `ui`, and the picker offers `content/languages.json`'s
 * suggestions while accepting any BCP-47-shaped tag a player types: the set is open, so a language
 * the product has never heard of has to reach the host exactly as a suggested one does.
 */
import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import playLanguages from '../../../../content/languages.json';
import {CocOnboarding} from './CocOnboarding';
import {say,ui} from './fixtures/coc-ui-words';

type Row=Record<string,any>;
const zh=(key:string)=>say('zh-Hans','onboarding',key);
const DEFAULT=playLanguages.default;

/** Every onboarding answer carries the words for the language it was asked in. */
const answer=(data:Row,tag=DEFAULT)=>({ok:true,data:{ui:ui(tag),...data}});

afterEach(()=>{cleanup();localStorage.clear()});
it('shows three scenario entries and an honest empty prepared library',async()=>{
  const invokeExtension=vi.fn(async()=>answer({presets:[],modules:[],occupations:[]}));
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="new"/>);
  await screen.findByRole('button',{name:new RegExp(zh('source.starter.title'))});
  expect(screen.getByRole('button',{name:new RegExp(zh('source.pdf.title'))})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:new RegExp(zh('source.module.title'))}));
  await waitFor(()=>expect(screen.getByText(zh('emptyLibrary'))).toBeTruthy());
  expect(invokeExtension).toHaveBeenCalledWith('coc-keeper','onboarding',{action:'catalog',play_language:DEFAULT},{sessionId:'new'});
});

/**
 * The picker suggests the tags the data names, each called what that language calls itself through
 * `Intl.DisplayNames`, and it opens at the declared default. A hardcoded pair of `<option>`s meant
 * a language could ship its whole content directory and never appear; a closed `<select>` meant a
 * language nobody had shipped could never be asked for at all.
 */
it('suggests the declared tags, named by Intl.DisplayNames, and opens at the declared default',async()=>{
  const invokeExtension=vi.fn(async()=>answer({presets:[],modules:[],occupations:[]}));
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="new"/>);
  const picker=await screen.findByLabelText(zh('playLanguage')) as HTMLInputElement;
  expect(picker.value).toBe(DEFAULT);
  const options=Array.from(document.querySelectorAll(`datalist#${picker.getAttribute('list')} option`));
  expect(options.map(option=>option.getAttribute('value'))).toEqual(playLanguages.suggested);
  // The names come from the platform's own table, in each language itself -- never from a table
  // this product keeps. Asserting against the same call is what proves no table was written.
  expect(options.map(option=>option.textContent))
    .toEqual(playLanguages.suggested.map(tag=>new Intl.DisplayNames([tag],{type:'language'}).of(tag)));
  // A name, not the tag repeated: `Intl.DisplayNames` falling through would make this pass vacuously.
  expect(options.every(option=>option.textContent && option.textContent!==option.getAttribute('value'))).toBe(true);
});

/**
 * The set is open: a tag the product ships nothing for reaches the host as the play language, and
 * the screen follows the words that come back for it.
 */
it('accepts a tag nobody shipped, and sends it as the play language',async()=>{
  const invokeExtension=vi.fn(async(_id:string,_method:string,p:any)=>answer({presets:[],modules:[],occupations:[]},p.play_language));
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="new"/>);
  const picker=await screen.findByLabelText(zh('playLanguage')) as HTMLInputElement;
  expect(playLanguages.suggested).not.toContain('pt-BR');
  // Typed, then left: a half-typed tag must not send the host a language nobody named.
  fireEvent.change(picker,{target:{value:'pt-'}});
  expect(invokeExtension).not.toHaveBeenCalledWith('coc-keeper','onboarding',
    expect.objectContaining({play_language:'pt-'}),expect.anything());
  fireEvent.change(picker,{target:{value:'pt-BR'}});
  fireEvent.blur(picker);
  await waitFor(()=>expect(invokeExtension).toHaveBeenCalledWith('coc-keeper','onboarding',
    {action:'catalog',play_language:'pt-BR'},{sessionId:'new'}));
  expect(picker.value).toBe('pt-BR');
});

it('lists a starter by its authored blurb, not its folder slug, and re-reads the catalog in the chosen play language',async()=>{
  const cards:Record<string,Row[]>={'zh-Hans':[{id:'the-haunting',title:'鬼屋',blurb:'1920 年的波士顿，房东雇你查清一栋没人住得下去的老宅。'}],
    en:[{id:'the-haunting',title:'The Haunting',blurb:'Boston, 1920. A landlord hires you to find out what is wrong with the house nobody will keep.'}]};
  const invokeExtension=vi.fn(async(_id:string,_method:string,p:any)=>answer({presets:cards[p.play_language]||[],modules:[],occupations:[]},p.play_language));
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="new"/>);
  fireEvent.click(await screen.findByRole('button',{name:new RegExp(zh('source.starter.title'))}));
  expect(await screen.findByText('鬼屋')).toBeTruthy();
  expect(screen.getByText(/1920 年的波士顿/)).toBeTruthy();
  expect(screen.queryByText(/预设 · the-haunting/)).toBeNull();
  fireEvent.change(screen.getByLabelText(zh('playLanguage')),{target:{value:'en'}});
  expect(await screen.findByText('The Haunting')).toBeTruthy();
  expect(screen.getByText(/A landlord hires you/)).toBeTruthy();
  expect(screen.queryByText('鬼屋')).toBeNull();
});

/** The chrome follows the answer, not only the catalog rows: choosing English translates the page. */
it('switches its own captions with the language the answer carries',async()=>{
  const invokeExtension=vi.fn(async(_id:string,_method:string,p:any)=>answer({presets:[],modules:[],occupations:[]},p.play_language));
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="new"/>);
  await screen.findByText(zh('lede.start'));
  fireEvent.change(screen.getByLabelText(zh('playLanguage')),{target:{value:'en'}});
  await screen.findByText(say('en','onboarding','lede.start'));
  expect(screen.queryByText(zh('lede.start'))).toBeNull();
});

it('automatically opens the existing conversation after preparation without a character form',async()=>{
  const invokeExtension=vi.fn(async(_id,_method,p)=>answer(p.action==='catalog'?{presets:[{id:'the-haunting',title:'The Haunting'}],modules:[],occupations:[]}:p.action==='select'?{id:'import',name:'The Haunting',state:'ready'}:{id:'import',name:'The Haunting',state:'conversing'}));
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="new"/>);
  fireEvent.click(await screen.findByRole('button',{name:new RegExp(zh('source.starter.title'))}));
  fireEvent.click(await screen.findByRole('button',{name:/The Haunting/}));
  await waitFor(()=>expect(invokeExtension).toHaveBeenCalledWith('coc-keeper','onboarding',{action:'converse',id:'import'},{sessionId:'new'}));
  expect(screen.queryByLabelText('调查员姓名')).toBeNull();
  expect(screen.queryByLabelText('职业')).toBeNull();
  expect(screen.queryByRole('button',{name:'创建角色'})).toBeNull();
});

it('restores paused preparation from the server without browser storage',async()=>{
  const invokeExtension=vi.fn(async()=>answer({presets:[],modules:[],occupations:[],current_import:{id:'retained',name:'Masks.pdf',state:'paused',pages:669,indexed:12}}));
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="same-session"/>);
  expect(await screen.findByRole('heading',{name:zh('pausedTitle')})).toBeTruthy();
  expect(screen.getByText('Masks.pdf')).toBeTruthy();
  expect(screen.getByRole('button',{name:zh('resume')})).toBeTruthy();
});

it.each(['restored','failed-chunk'])('can cancel a %s upload and return to scenario selection',async(origin)=>{
  const job={id:'interrupted',name:'Masks.pdf',source:'pdf',state:'uploading',size:8,received:0};
  const catalog={presets:[],modules:[],occupations:[],...(origin==='restored'?{current_import:job}:{})};
  const invokeExtension=vi.fn(async(_id,_method,p)=>{
    if(p.action==='catalog')return answer(catalog);
    if(p.action==='begin')return answer(job);
    // A resume asks the host for its own count before sending anything (§44).
    if(p.action==='status')return answer(job);
    if(p.action==='chunk')return {ok:false,error:{code:'upload_retry',message:'Upload connection interrupted'}};
    if(p.action==='pause')return answer({...job,state:'paused'});
    if(p.action==='dismiss')return answer({...job,state:'paused',dismissed:true});
    throw new Error('Unexpected onboarding operation');
  });
  render(<CocOnboarding host={{invokeExtension} as any} sessionId="interrupted-session"/>);
  await screen.findByLabelText(zh('choosePdf'));
  if(origin==='failed-chunk'){
    fireEvent.change(screen.getByLabelText(zh('choosePdf')),{target:{files:[new File(['%PDF-1.7'],'Masks.pdf',{type:'application/pdf'})]}});
    // The code is the caption; the host's English sentence is folded away, not printed at the player.
    const alert=await screen.findByRole('alert',undefined,{timeout:10000});
    await waitFor(()=>expect(alert.textContent).toContain(say('zh-Hans','errors','upload_retry')));
    expect(alert.querySelector('details')?.textContent).toContain('Upload connection interrupted');
    // An upload nothing can move any further stops calling itself one: the card left behind is the
    // paused one, which offers continuing and choosing another scenario. It used to go on drawing
    // a progress bar with a cancel button, which is what this test used to click.
  } else {
    fireEvent.click(await screen.findByRole('button',{name:zh('cancelUpload')}));
  }
  await screen.findByRole('heading',{name:zh('pausedTitle')},{timeout:10000});
  expect(invokeExtension).toHaveBeenCalledWith('coc-keeper','onboarding',{action:'pause',id:'interrupted'},{sessionId:'interrupted-session'});
  fireEvent.click(screen.getByRole('button',{name:new RegExp(zh('back').replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}));
  await screen.findByRole('button',{name:new RegExp(zh('source.starter.title'))});
  expect(screen.getByRole('button',{name:new RegExp(zh('source.pdf.title'))})).toBeTruthy();
  expect(screen.getByRole('button',{name:new RegExp(zh('source.module.title'))})).toBeTruthy();
},20000);

/**
 * The byte stream restarts, and the screen never claims it is moving when it is not (§44).
 *
 * Two real tables froze at 9 MiB and 8 MiB of the same 44 MB book. The push loop lived inside one
 * call, holding the only reference to the chosen `File`; a chunk that never answered ended the
 * loop, and with it the only thing in the product that could send a byte. Nothing else took over:
 * `retryConnection` re-read the catalog, so the label went back to "uploading" over a stream that
 * had stopped, and a reload restored the same frozen card. The host had the resume point all
 * along -- `received` is the length of the file on its disk.
 */
const CHUNK_SIZE=1024*1024

/** A host that answers as `CocOnboardingHost` does: chunks land at the count it keeps, an offset
 *  that is not that count is refused, and `drop` lists the chunk attempts that never answer. */
function uploadHost(size:number,drop:number[]=[],restored=false){
  const job:Row={id:'masks',name:'Masks.pdf',source:'pdf',size,received:0,state:'uploading'}
  const seen:Row[]=[]
  let attempts=0
  const invokeExtension=vi.fn(async(_id:string,_method:string,p:Row)=>{
    seen.push(p)
    // A session with nothing in flight has no current import; a reloaded one restores its job.
    if(p.action==='catalog')return answer({presets:[],modules:[],occupations:[],current_import:restored?{...job}:null})
    if(p.action==='current')return answer({current_import:restored?{...job}:null})
    if(p.action==='begin'){Object.assign(job,{received:0,state:'uploading'});return answer({...job})}
    if(p.action==='status')return answer({...job})
    if(p.action==='chunk'){
      // The transport's own failure: a frame that never receives a matching response. It carries no
      // caption of its own, and the player must never be shown it.
      if(drop.includes(attempts++))throw {code:'transport_timeout',message:'transport request timed out'}
      if(p.offset!==job.received)throw {code:'upload_chunk_invalid',message:'Invalid upload chunk or offset'}
      job.received=Math.min(size,job.received+CHUNK_SIZE)
      return answer({...job})
    }
    if(p.action==='finish'){job.state='inspecting';return answer({...job})}
    if(p.action==='pause'){job.state='paused';return answer({...job})}
    throw new Error('Unexpected onboarding operation '+p.action)
  })
  return {invokeExtension,job,seen,chunks:()=>seen.filter(p=>p.action==='chunk')}
}
const book=(bytes:number)=>new File([new Uint8Array(bytes)],'Masks.pdf',{type:'application/pdf'})

it('resumes the byte stream from the host\'s own count when a chunk never answers',async()=>{
  // The second chunk attempt is dropped. Before this, that was the end of the upload for good.
  const host=uploadHost(3*CHUNK_SIZE,[1])
  render(<CocOnboarding host={host as any} sessionId="resume"/>)
  fireEvent.change(await screen.findByLabelText(zh('choosePdf')),{target:{files:[book(3*CHUNK_SIZE)]}})
  await waitFor(()=>expect(host.seen.some(p=>p.action==='finish')).toBe(true),{timeout:15000})
  expect(host.job.received).toBe(3*CHUNK_SIZE)
  // Exactly one `begin`: the stream continued, it did not start the book again.
  expect(host.seen.filter(p=>p.action==='begin')).toHaveLength(1)
  // The resume asked the host where it had got to rather than resending blind; a dropped frame may
  // have delivered its bytes, and a blind resend would be refused as the wrong offset.
  expect(host.seen.filter(p=>p.action==='status').length).toBeGreaterThan(0)
  expect(host.chunks().map(p=>p.offset)).toEqual([0,CHUNK_SIZE,CHUNK_SIZE,2*CHUNK_SIZE])
  // A transport hiccup the product recovered from is not something to tell the player about.
  expect(screen.queryByRole('alert')).toBeNull()
},20000)

// Both buttons the stopped card offers must move bytes: `retryConnection` on the failure, and
// `resume` on the paused card behind it. Either one only changing a label is the defect itself.
it.each(['retryConnection','resume'])('names a stopped upload in its own words, stops claiming it is moving, and really pushes again via %s',async(button)=>{
  const host=uploadHost(2*CHUNK_SIZE,[1,2,3,4,5])
  render(<CocOnboarding host={host as any} sessionId="stopped"/>)
  fireEvent.change(await screen.findByLabelText(zh('choosePdf')),{target:{files:[book(2*CHUNK_SIZE)]}})
  const alert=await screen.findByRole('alert',undefined,{timeout:15000})
  // The transport's code has no caption to project (§23), so showing it would put `errors.unknown`
  // over the host's English sentence -- which is exactly what a real table read. The upload names
  // what happened in a word this product has, and the English stays the log line it is.
  await waitFor(()=>expect(alert.textContent).toContain(say('zh-Hans','errors','upload_retry')))
  expect(alert.textContent).not.toContain(say('zh-Hans','errors','unknown'))
  expect(alert.querySelector('details')?.textContent).toContain('transport request timed out')
  // And the card stops saying the upload is running: the job is paused, which is both true and
  // something the player can act on.
  expect(host.job.state).toBe('paused')
  await screen.findByRole('heading',{name:zh('pausedTitle')})

  // The buttons that only ever changed a label now move bytes.
  const before=host.chunks().length
  fireEvent.click(screen.getByRole('button',{name:zh(button)}))
  await waitFor(()=>expect(host.seen.some(p=>p.action==='finish')).toBe(true),{timeout:15000})
  expect(host.chunks().length).toBeGreaterThan(before)
  expect(host.job.received).toBe(2*CHUNK_SIZE)
  expect(host.seen.filter(p=>p.action==='begin')).toHaveLength(1)
},30000)

/**
 * A reload leaves the host holding the bytes and the browser holding nothing: a `File` is not
 * storable, so continuing genuinely needs the player to point at the file again. `lede.job`
 * promises the progress is kept, and choosing it again must continue rather than resend 44 MB.
 */
it('continues a restored upload from the acknowledged prefix when the file is chosen again',async()=>{
  const host=uploadHost(3*CHUNK_SIZE,[],true)
  host.job.received=2*CHUNK_SIZE
  host.job.state='paused'
  render(<CocOnboarding host={host as any} sessionId="reloaded"/>)
  await screen.findByRole('heading',{name:zh('pausedTitle')})
  fireEvent.change(await screen.findByLabelText(zh('choosePdf')),{target:{files:[book(3*CHUNK_SIZE)]}})
  await waitFor(()=>expect(host.seen.some(p=>p.action==='finish')).toBe(true),{timeout:15000})
  expect(host.seen.filter(p=>p.action==='begin')).toHaveLength(0)
  expect(host.chunks().map(p=>p.offset)).toEqual([2*CHUNK_SIZE])
},20000)
