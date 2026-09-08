import {Icon} from '../ui/icons';
import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {api} from './api';
import {Modal} from './Modal';
import type {AttachmentInfo} from '../server/images';
import './images.css';
export type {AttachmentInfo};
type Target={purpose:'observation'|'archive_avatar'|'member_avatar';archive_id?:string;member_id?:string};
type Ticket={upload_id:string;url:string;headers:Record<string,string>;expires_at:string};
type Item={id:string;file:File;preview:string;phase:'queued'|'uploading'|'failed'|'ready';progress:number;error:string;ticket?:Ticket;attachment?:AttachmentInfo};
class Queue{
 items:Item[]=[];listeners=new Set<()=>void>();
 constructor(readonly target:Target){}
 snapshot=()=>this.items;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>this.listeners.delete(fn);};
 update(id:string,patch:Partial<Item>){this.items=this.items.map(i=>i.id===id?{...i,...patch}:i);this.listeners.forEach(fn=>fn());}
 remove(id:string){const item=this.items.find(i=>i.id===id);if(item)URL.revokeObjectURL(item.preview);this.items=this.items.filter(i=>i.id!==id);this.listeners.forEach(fn=>fn());}
 add(file:File){this.items=[...this.items,{id:crypto.randomUUID(),file,preview:URL.createObjectURL(file),phase:'queued',progress:0,error:''}];this.listeners.forEach(fn=>fn());void drain();}
}
const queues=new Map<string,Queue>();let running=false;let activeXHR:XMLHttpRequest|undefined;
export function clearUploadMemory(){activeXHR?.abort();for(const queue of queues.values())for(const item of [...queue.items])queue.remove(item.id);queues.clear();}
export function pasteImages(event:React.ClipboardEvent,queueKey:string,target:Target,count:number,max=10){
 const files=[...event.clipboardData.files];if(!files.length)return '';event.preventDefault();let queue=queues.get(queueKey);if(!queue){queue=new Queue(target);queues.set(queueKey,queue);}
 if(files.length+count+queue.items.length>max)return `最多 ${max} 张图片`;
 if(files.some(f=>!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size<1||f.size>10485760))return '请选择不超过 10 MiB 的 PNG、JPEG 或 WebP 静态图片';
 files.forEach(f=>queue!.add(f));return '';
}
async function drain(){if(running)return;running=true;try{while(true){const queue=[...queues.values()].find(q=>q.items.some(i=>i.phase==='queued'));const item=queue?.items.find(i=>i.phase==='queued');if(!queue||!item)break;queue.update(item.id,{phase:'uploading',error:''});try{
 let ticket=item.ticket;
 if(ticket){const status=await api<{state:string;attachment:AttachmentInfo|null}>('/images/uploads/'+ticket.upload_id);if(status.state==='ready'&&status.attachment){queue.update(item.id,{phase:'ready',attachment:status.attachment,progress:100});continue;}if(status.state==='uploading')throw new Error('服务仍在处理上传，请稍后重试查询');if(status.state==='expired')ticket=undefined;}
 if(!ticket){const bytes=await item.file.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');ticket=await api<Ticket>('/images/prepare',{...queue.target,mime_type:item.file.type,byte_size:item.file.size,sha256:hash});queue.update(item.id,{ticket});}
 if(!queue.items.some(i=>i.id===item.id))continue;
 await new Promise<void>((resolve,reject)=>{const xhr=new XMLHttpRequest();activeXHR=xhr;xhr.open('PUT','/uploads/'+ticket!.upload_id);xhr.timeout=65000;Object.entries(ticket!.headers).forEach(([k,v])=>xhr.setRequestHeader(k,v));xhr.upload.onprogress=e=>{if(e.lengthComputable)queue.update(item.id,{progress:Math.round(e.loaded/e.total*100)});};xhr.onerror=xhr.ontimeout=xhr.onabort=()=>reject(new Error('上传结果尚未确认，重试会先查询状态'));xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300)resolve();else{let message='上传未完成，请重试';try{message=JSON.parse(xhr.responseText).error.message;}catch{}reject(new Error(message));}};xhr.send(item.file);}).finally(()=>{activeXHR=undefined;});
 const status=await api<{state:string;attachment:AttachmentInfo|null}>('/images/uploads/'+ticket.upload_id);if(status.state!=='ready'||!status.attachment)throw new Error('图片尚未就绪，请重试查询');queue.update(item.id,{phase:'ready',attachment:status.attachment,progress:100});
 }catch(e){queue.update(item.id,{phase:'failed',error:(e as Error).message});}}}finally{running=false;}}
window.addEventListener('beforeunload',e=>{if([...queues.values()].some(q=>q.items.length)){e.preventDefault();e.returnValue='';}});
export function ImagePicker({queueKey,target,value,onChange,onPending,disabled=false,max=10}:{queueKey:string;target:Target;value:AttachmentInfo[];onChange:(images:AttachmentInfo[])=>void;onPending?:(pending:boolean)=>void;disabled?:boolean;max?:number}){
 let queue=queues.get(queueKey);if(!queue){queue=new Queue(target);queues.set(queueKey,queue);}const q=queue,items=useSyncExternalStore(q.subscribe,q.snapshot),[error,setError]=useState(''),current=useRef({value,onChange});current.current={value,onChange};
 useEffect(()=>{const ready=items.filter(i=>i.phase==='ready'&&i.attachment);if(ready.length){const ids=new Set(current.current.value.map(i=>i.id));current.current.onChange([...current.current.value,...ready.map(i=>i.attachment!).filter(i=>!ids.has(i.id))]);ready.forEach(i=>q.remove(i.id));}onPending?.(items.some(i=>i.phase!=='ready'));},[items,q,onPending]);
 return <div className="image-picker"><ImageGallery images={value} onRemove={disabled?undefined:id=>onChange(value.filter(i=>i.id!==id))}/>{items.length>0&&<ul className="upload-list">{items.map(i=><li key={i.id}><img src={i.preview} alt="待上传图片预览"/><div><strong>{i.file.name}</strong><p role="status">{i.phase==='failed'?i.error:i.phase==='queued'?'等待上传':i.phase==='ready'?'已上传':`正在上传 ${i.progress}%`}</p>{i.phase==='uploading'&&<progress value={i.progress} max={100}/>}</div>{i.phase==='failed'&&<button type="button" className="button" disabled={disabled} onClick={()=>{q.update(i.id,{phase:'queued'});void drain();}}>重试</button>}{i.phase!=='uploading'&&<button type="button" className="button quiet" disabled={disabled} onClick={()=>q.remove(i.id)}>移除</button>}</li>)}</ul>}{value.length+items.length<max&&<label className="image-select"><Icon name="image" size={18}/><span>添加图片</span><input aria-label="添加图片" type="file" accept="image/png,image/jpeg,image/webp" multiple={max>1} disabled={disabled} onChange={e=>{setError('');const files=[...(e.target.files??[])];if(files.length+value.length+items.length>max)setError(`最多 ${max} 张图片`);else if(files.some(f=>!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size<1||f.size>10485760))setError('请选择不超过 10 MiB 的 PNG、JPEG 或 WebP 静态图片');else files.forEach(f=>q.add(f));e.target.value='';}}/></label>}{error&&<p className="form-error" role="alert">{error}</p>}</div>;
}
export function ImageGallery({images,onRemove}:{images:AttachmentInfo[];onRemove?:(id:string)=>void}){
 const[selected,setSelected]=useState<AttachmentInfo|null>(null),[zoom,setZoom]=useState(false);
 return <>{images.length>0&&<div className="image-gallery">{images.map((i,n)=><div key={i.id}><button type="button" aria-label={`放大图片 ${n+1}`} onClick={()=>{setSelected(i);setZoom(false);}}><img src={'/images/'+i.id} alt={`观察图片 ${n+1}`} loading="lazy" width={i.width} height={i.height}/></button>{onRemove&&<button className="image-remove" type="button" aria-label={`移除图片 ${n+1}`} onClick={()=>onRemove(i.id)}>×</button>}</div>)}</div>}{selected&&<Modal title="查看原图" onClose={()=>setSelected(null)}><div className="image-viewer-actions"><button className="button" type="button" onClick={()=>setZoom(v=>!v)}>{zoom?'适应窗口':'原始尺寸'}</button><span>{selected.width} × {selected.height}</span></div><div className={'image-viewer '+(zoom?'zoomed':'')}><img src={'/images/'+selected.id} alt="观察原图"/></div></Modal>}</>;
}
