export type InteractionKind='action'|'scheduled'|'query';
export type InteractionNode={id:string;title:string;subtitle:string;icon:string;x:number;y:number;tone:'red'|'yellow'|'white'};
export type InteractionRule={id:string;from:string;to:string;title:string;kind:InteractionKind;trigger:string;conditions:string[];effects:string[];boundaries:string[];destination:string;source:string};
export type InteractionGraph={nodes:InteractionNode[];rules:InteractionRule[]};
