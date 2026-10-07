import {memberStatuses} from './archive-states.ts';

export type ContactLike={type:string;value:string};
export type ContactReminder={needed:boolean;count:number;minimum:number;eligible:boolean;message:string|null};

// The reminder is deliberately a derived hint. It never blocks a profile write
// and it does not try to verify whether an address or account is reachable.
export function contactReminder(type:'person'|'org',status:string,contacts:ContactLike[]):ContactReminder{
  const eligible=type==='person'
    ? [...memberStatuses,'\u5916\u90e8\u793e\u53cb'].includes(status as typeof memberStatuses[number])
    : ['\u4e2a\u4eba\u63a5\u89e6','\u7ec4\u7ec7\u4ea4\u6d41'].includes(status);
  const keys=new Set(contacts.map(contact=>`${contact.type.trim().toLocaleLowerCase()}\u0000${contact.value.trim().toLocaleLowerCase()}`).filter(Boolean));
  const count=keys.size;
  return {eligible,count,minimum:2,needed:eligible&&count<2,message:eligible&&count<2?`\u5efa\u8bae\u8865\u5145\u81f3\u5c11\u4e24\u79cd\u4e0d\u540c\u7684\u8054\u7cfb\u65b9\u5f0f\uff08\u5f53\u524d ${count} \u79cd\uff09\u3002`:null};
}
