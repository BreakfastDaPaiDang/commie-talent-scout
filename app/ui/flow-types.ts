// UI contracts shared by the prototype and a future real-data adapter.
export type FlowPage='tasks'|'external'|'members'|'org'|'messages'|'statistics'|'tags';
export type FlowActor={id:string;name:string;role:'member'|'admin'};
export type FlowPerson={id:string;name:string;kind:'person'|'org';member:boolean;relation:string;subtitle:string;tags:string[];contact:string;ambassadors?:string[]};
export type FlowEvent={id:string;at:string;actor:string;text:string;result?:string};
export type FlowNote={id:string;personId:string;body:string;authorId:string;at:string};
export type FlowTask={id:string;personId:string;type:'audit'|'onboarding'|'monthly'|'cooperation';title:string;purpose:string;delivery:string;open:boolean;ownerId:string|null;deadline:string;month?:string;result?:'completed'|'failed'|'unclaimed'|'cancelled';history:FlowEvent[];comments:{id:string;authorId:string;body:string;at:string}[];noteIds:string[]};
export type FlowMessage={id:string;ownerId:string;personId:string;taskId:string;text:string;read:boolean};
export type FlowData={people:FlowPerson[];tasks:FlowTask[];notes:FlowNote[];events:FlowEvent[];messages:FlowMessage[];now:string};
export type FlowAction={type:'refer';personId:string}|{type:'join';personId:string}|{type:'claim'|'release'|'complete'|'cancel'|'reopen'|'extend'|'comment';taskId:string;body?:string;deadline?:string}|{type:'note';personId:string;body:string}|{type:'read';messageId:string};
export const flowTaskTypes={audit:'人事审核',onboarding:'入社对接',monthly:'月度沟通',cooperation:'合作交流'};
export const flowResults={completed:'已完成',failed:'未完成',unclaimed:'过期未接取',cancelled:'已取消'};
