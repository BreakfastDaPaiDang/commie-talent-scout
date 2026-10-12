/** Planning only: no database, credentials, commit callback or background work. */
export type Rule<C, S> = {
 id:string;
 when:(context:C)=>boolean;
 apply:(context:C)=>readonly S[];
};

export type RuleModule<C, S> = {
 id:string;
 source:string;
 triggers:readonly {file:string;entry:string}[];
 rules:readonly Rule<C,S>[];
 verification:{
  transaction:{file:string;entry:string};
  guard:{file:string;entry:string};
  tests:readonly string[];
  idempotency:string;
  failure:string;
 };
};

export type RulePlan<S> = {
 moduleId:string;
 steps:{ruleId:string;statements:readonly S[]}[];
 statements:S[];
};

/** Preserve definition order, including SQL guards and effects within each rule. */
export function planRules<C,S>(module:RuleModule<C,S>,context:C):RulePlan<S>{
 const steps:RulePlan<S>['steps']=[];
 for(const rule of module.rules){
  if(rule.when(context))steps.push({ruleId:rule.id,statements:rule.apply(context)});
 }
 return {moduleId:module.id,steps,statements:steps.flatMap(step=>step.statements)};
}
