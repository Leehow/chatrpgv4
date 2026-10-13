export type Binding={home:string;campaign:string};
export type HandoutImageFile={path:string;media_type:string;bytes:Buffer;sha256:string};
export function handoutImageFile(row:any,binding?:Binding):HandoutImageFile|undefined;
export function handoutImage(row:any,binding?:Binding):string|undefined;
export function withHandoutImages(view:any,binding?:Binding):any;
export function withDocumentImage(view:any,binding:Binding):any;
