import {isFlowLink} from './personnel-ranks.ts';
import type {MapCell,MapLayer,MapLink} from './personnel-map.ts';

export type FlowNode={cell:MapCell;x:number;y:number;height:number;column:number};
export type FlowRibbon={edge:MapLink;path:string;center:string;width:number;label:{x:number;y:number};returning:boolean};
// The rank diagram only expresses actual changes between ranks. Keep local
// transfers and shared affiliations in the source data for detail/history views.
export function personnelDiagramLinks(layers:MapLayer[],links:MapLink[]){
 const ranks=new Map(layers.flatMap(l=>l.cells.map(c=>[c.id,l.id] as const)));
 return links.filter(e=>isFlowLink(e)&&ranks.has(e.from)&&ranks.has(e.to)&&ranks.get(e.from)!==ranks.get(e.to));
}
export function layoutPersonnelFlow(layers:MapLayer[],links:MapLink[]){
 const stride=248,left=32,top=124,gap=54,rail=10;
 const nodes=new Map<string,FlowNode>(),columns=layers.map((layer,column)=>({layer,x:left+column*stride,column}));
 const edges=personnelDiagramLinks(layers,links);
 const directional=edges.filter(isFlowLink),maximum=Math.max(1,...directional.map(e=>e.people.length)),unit=Math.min(32,76/maximum);
 const size=(e:MapLink)=>!isFlowLink(e)?2:e.people.length*unit;
 const incoming=new Map<string,number>(),outgoing=new Map<string,number>();
 for(const e of directional){incoming.set(e.to,(incoming.get(e.to)??0)+size(e));outgoing.set(e.from,(outgoing.get(e.from)??0)+size(e));}
 let bottom=top;
 for(const {layer,column,x} of columns){let y=top;for(const cell of layer.cells){const height=Math.max(76,(incoming.get(cell.id)??0)+20,(outgoing.get(cell.id)??0)+20);nodes.set(cell.id,{cell,x,y,height,column});y+=height+gap;}bottom=Math.max(bottom,y-gap);}
 const usedIn=new Map<string,number>(),usedOut=new Map<string,number>();let detourSpace=44;
 const ribbons:FlowRibbon[]=edges.map(edge=>{
  const a=nodes.get(edge.from)!,b=nodes.get(edge.to)!,width=size(edge),shared=!isFlowLink(edge),returning=b.column<=a.column;
  const source=shared?a.y+a.height/2:a.y+10+(usedOut.get(edge.from)??0)+width/2,target=shared?b.y+b.height/2:b.y+10+(usedIn.get(edge.to)??0)+width/2;
  if(!shared){usedOut.set(edge.from,(usedOut.get(edge.from)??0)+width);usedIn.set(edge.to,(usedIn.get(edge.to)??0)+width);}
  if(returning){
   // Recorded returns to an earlier rank route below the columns.
   const lane=bottom+detourSpace+width/2;detourSpace+=width+24;const startX=a.x+rail,endX=b.x+(a.column===b.column?rail:0),bendX=Math.max(startX,endX)+190;
   const turn=Math.max(12,endX-40);
   const center=`M ${startX} ${source} C ${bendX} ${source},${bendX} ${lane},${startX+70} ${lane} L ${turn+20} ${lane} C ${turn} ${lane},${turn} ${target},${endX} ${target}`;
   return {edge,path:center,center,width,label:{x:(startX+endX)/2+30,y:lane-8},returning:true};
  }
  const start=a.x+rail,end=b.x,mid=(start+end)/2,half=width/2;
  const center=`M ${start} ${source} C ${mid} ${source},${mid} ${target},${end} ${target}`;
  const path=`M ${start} ${source-half} C ${mid} ${source-half},${mid} ${target-half},${end} ${target-half} L ${end} ${target+half} C ${mid} ${target+half},${mid} ${source+half},${start} ${source+half} Z`;
  return {edge,path:shared?center:path,center,width,label:{x:mid,y:(source+target)/2},returning:false};
 });
 return {nodes,columns,ribbons,width:Math.max(560,left+layers.length*stride),height:Math.max(410,bottom+detourSpace+28)};
}
