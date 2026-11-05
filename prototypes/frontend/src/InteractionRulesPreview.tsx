import React from 'react';
import {InteractionGraph} from '../../../app/ui/InteractionGraph';
import data from '../../../app/shared/interaction-graph.json';
import type {InteractionGraph as Graph} from '../../../app/shared/interaction-graph-types';

export default function InteractionRulesPreview(){
 return <InteractionGraph data={data as Graph} storageKey="cts-rule-graph:prototype" onNavigate={()=>{location.href='/';}}/>;
}
