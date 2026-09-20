import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import './image-viewer.css';

type Point={x:number;y:number};
type Mode='auto'|'fit'|'width'|'manual';
const bounded=(scale:number)=>Math.max(.05,Math.min(8,scale));

// Shared by the production gallery and the prototype. Image coordinates remain
// under the same cursor/finger while zooming; native scrollbars remain usable.
export function ImageViewer({src,alt='图片',width=0,height=0}:{src:string;alt?:string;width?:number;height?:number}){
 const viewport=useRef<HTMLDivElement>(null),[natural,setNatural]=useState({width,height}),[size,setSize]=useState({width:1,height:1}),[mode,setMode]=useState<Mode>('auto'),[manual,setManual]=useState(1),[failed,setFailed]=useState(false);
 const fit=Math.min(1,(size.width-24)/Math.max(1,natural.width),(size.height-24)/Math.max(1,natural.height)),fitWidth=(size.width-24)/Math.max(1,natural.width);
 const scale=bounded(mode==='manual'?manual:mode==='width'||mode==='auto'&&natural.height>natural.width*2?fitWidth:fit);
 const imageWidth=natural.width*scale,imageHeight=natural.height*scale,canvasWidth=Math.max(size.width,imageWidth),canvasHeight=Math.max(size.height,imageHeight);
 const focal=useRef<{image:Point;screen:Point}|null>(null),pointers=useRef(new Map<number,Point>()),gesture=useRef<{point:Point;distance:number}|null>(null);
 const zoom=(next:number,point?:Point):void=>{const element=viewport.current;if(!element)return;const screen=point??{x:size.width/2,y:size.height/2};focal.current={screen,image:{x:(element.scrollLeft+screen.x-(canvasWidth-imageWidth)/2)/scale,y:(element.scrollTop+screen.y-(canvasHeight-imageHeight)/2)/scale}};latest.current.scale=bounded(next);setManual(bounded(next));setMode('manual');};
 const latest=useRef({zoom,scale});latest.current={zoom,scale};
 useLayoutEffect(()=>{const element=viewport.current;if(!element)return;const measure=()=>setSize({width:element.clientWidth,height:element.clientHeight});measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();},[]);
 useLayoutEffect(()=>{const element=viewport.current,anchor=focal.current;if(!element)return;if(anchor){element.scrollLeft=anchor.image.x*scale+(canvasWidth-imageWidth)/2-anchor.screen.x;element.scrollTop=anchor.image.y*scale+(canvasHeight-imageHeight)/2-anchor.screen.y;focal.current=null;}else if(mode!=='manual'){element.scrollLeft=0;element.scrollTop=0;}},[scale,canvasWidth,canvasHeight,imageWidth,imageHeight,mode]);
 useEffect(()=>{const element=viewport.current!;const wheel=(event:WheelEvent)=>{if(!event.ctrlKey)return;event.preventDefault();const rect=element.getBoundingClientRect();latest.current.zoom(latest.current.scale*Math.exp(-event.deltaY*.01),{x:event.clientX-rect.left,y:event.clientY-rect.top});};element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);},[]);
 const choose=(next:Mode)=>{focal.current=null;setMode(next);if(next==='manual')setManual(1);viewport.current?.scrollTo?.(0,0);};
 const point=(event:React.PointerEvent)=>{const rect=event.currentTarget.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};};
 const updateGesture=()=>{const values=[...pointers.current.values()];gesture.current=values.length>1?{point:{x:(values[0].x+values[1].x)/2,y:(values[0].y+values[1].y)/2},distance:Math.hypot(values[0].x-values[1].x,values[0].y-values[1].y)}:values.length?{point:values[0],distance:0}:null;};
 const end=(event:React.PointerEvent)=>{pointers.current.delete(event.pointerId);updateGesture();};
 return <section className="image-reader">
  <div className="image-reader-tools" aria-label="图片缩放工具">
   <button className="button" type="button" aria-label="缩小图片" disabled={scale<=.05} onClick={()=>zoom(scale/1.5)}>−</button>
   <output aria-label="缩放比例">{Math.round(scale*100)}%</output>
   <button className="button" type="button" aria-label="放大图片" disabled={scale>=8} onClick={()=>zoom(scale*1.5)}>＋</button>
   <button className="button" type="button" onClick={()=>choose('fit')}>适应窗口</button>
   <button className="button" type="button" onClick={()=>choose('width')}>按宽度</button>
   <button className="button" type="button" onClick={()=>choose('manual')}>原始尺寸</button>
  </div>
  {failed&&<p role="alert">图片暂时无法加载，请关闭后重试。</p>}
  <div ref={viewport} className={'image-viewer '+(mode==='manual'?'zoomed':'')} role="region" aria-label="图片，可拖动或缩放" tabIndex={0}
   onKeyDown={event=>{if(event.key==='+'||event.key==='='){event.preventDefault();zoom(scale*1.5);}else if(event.key==='-'){event.preventDefault();zoom(scale/1.5);}else if(event.key==='0'){event.preventDefault();choose('fit');}}}
   onDoubleClick={event=>{const rect=event.currentTarget.getBoundingClientRect();zoom(scale<1?1:scale*1.5,{x:event.clientX-rect.left,y:event.clientY-rect.top});}}
   onPointerDown={event=>{if(event.button!==0)return;event.currentTarget.focus({preventScroll:true});event.currentTarget.setPointerCapture(event.pointerId);pointers.current.set(event.pointerId,point(event));updateGesture();}}
   onPointerMove={event=>{if(!pointers.current.has(event.pointerId))return;const previous=gesture.current;pointers.current.set(event.pointerId,point(event));updateGesture();const current=gesture.current;if(!previous||!current)return;if(pointers.current.size>1&&previous.distance>0){latest.current.zoom(latest.current.scale*current.distance/previous.distance,current.point);}else{event.currentTarget.scrollLeft-=current.point.x-previous.point.x;event.currentTarget.scrollTop-=current.point.y-previous.point.y;}}}
   onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
   <div className="image-reader-canvas" style={{width:canvasWidth,height:canvasHeight}}><img src={src} alt={alt} draggable={false} style={{width:imageWidth,height:imageHeight,left:(canvasWidth-imageWidth)/2,top:(canvasHeight-imageHeight)/2}} onLoad={event=>{setNatural({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight});setFailed(false);}} onError={()=>setFailed(true)}/></div>
  </div>
 </section>;
}
