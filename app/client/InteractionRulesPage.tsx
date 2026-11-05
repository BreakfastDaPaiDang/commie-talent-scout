import React from 'react';
import {InteractionGraph} from '../ui/InteractionGraph';
import data from '../shared/interaction-graph.json';
import type {InteractionGraph as Graph} from '../shared/interaction-graph-types';

export function InteractionRulesPage({memberId,onNavigate}:{memberId:string;onNavigate:(path:string)=>void}){
 return <InteractionGraph data={data as Graph} storageKey={'cts-rule-graph:'+memberId} onNavigate={onNavigate}/>;
}
