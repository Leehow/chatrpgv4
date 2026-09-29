/**
 * The host's side of `handout.reading` (contract §155): from a handle the player pressed a control on
 * to the job that reads it.
 *
 * Nothing the renderer says is trusted past the handle. The row is looked up in the campaign's own
 * player-safe `table.view`, whose `handouts` are exactly the delivered ones (§152.3), and its image
 * goes through the same gate as the display pixels (`handoutImageFile`). What reaches the job is the
 * checked path and the digest of the bytes that were checked; the job reads them again and refuses a
 * file that changed in between.
 */
import {handoutImageFile} from './coc-handout-images.js';

type Row=Record<string,any>;
/** The most a handle the panel sends may be; a longer one is a malformed request, not a lookup. */
const MAX_HANDLE=200;
const refuse=(code:string,message:string):Error=>Object.assign(new Error(message),{code});

export type HandoutReadingDeps={
  params:unknown;
  binding:{home:string;campaign:string;play_language:string}|undefined;
  /** The campaign's player-safe `table.view` (§23). */
  view:()=>Promise<any>;
  /** The table's own model: it reads the picture, so it needs image input. */
  table:()=>Promise<{model:string;thinking?:string;vision:boolean}>;
  /** The presentation lane's choice, the fallback the worker resolves the lane from (§37.10.1). */
  lane:()=>Promise<{model:string;thinking:string}>;
  host:{handoutReadingStatus(data:Row):Row;handoutReadingRunning(query:{campaign:string;handout:string}):Row|undefined};
};

/** `{status:"pending", partial?}` while the job runs, `{status:"ready", ...}` when it has a reading; a refusal is thrown with its code. */
export async function handoutReadingAnswer(deps:HandoutReadingDeps):Promise<Row> {
  const handle=(deps.params as Row|null)?.handout;
  if(!deps.binding)throw refuse('campaign_unbound','No campaign is bound');
  if(typeof handle!=='string'||!handle.trim()||handle.length>MAX_HANDLE)throw refuse('invalid_params','A handout handle is needed');
  // A reading that is being written is polled from the job itself: the handout passed the gates below
  // when the job started, and the poll does not read the table again.
  const running=deps.host.handoutReadingRunning({campaign:deps.binding.campaign,handout:handle});
  if(running)return {status:'pending',handout:handle,...(running.partial?{partial:running.partial}:{})};
  const view=await deps.view();
  const row=(Array.isArray(view?.handouts)?view.handouts:[]).find((item:Row)=>item&&typeof item==='object'&&item.handout===handle);
  if(!row)throw refuse('invalid_params','This table holds no handout with that handle');
  const image=handoutImageFile(row,deps.binding);
  if(!image)throw refuse('handout_not_available','This handout has no image the player can read');
  const table=await deps.table(),lane=await deps.lane();
  const answer=deps.host.handoutReadingStatus({campaign:deps.binding.campaign,handout:handle,play_language:deps.binding.play_language,
    image:{path:image.path,media_type:image.media_type,sha256:image.sha256},
    model:table.model,...(table.thinking?{thinking:table.thinking}:{}),vision:table.vision,lane});
  if(answer.pending)return {status:'pending',handout:handle,...(answer.partial?{partial:answer.partial}:{})};
  return {status:'ready',handout:handle,keep:answer.keep===true,title:answer.title,text:answer.text,digest:image.sha256};
}
