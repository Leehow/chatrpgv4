/** Closed frontend control syntax; document contents never become control inputs. */
export function documentEditInput(text:unknown):{actor:string;document:string}|null {
    if(typeof text!=='string')return null;
    try{const value=JSON.parse(text);return value?.kind==='document_edit_request'&&typeof value.actor==='string'
        &&typeof value.document==='string'?{actor:value.actor,document:value.document}:null;}catch{return null;}
}
