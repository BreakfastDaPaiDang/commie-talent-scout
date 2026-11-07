import React from 'react';
import {api} from './api';
import {mutate} from './mutations';
import {ResourceTool} from '../ui/ResourceTool';
import type {Resource,ResourceSave} from '../shared/resources';
const load=(search:string)=>api<{resources:Resource[]}>('/resources?'+new URLSearchParams({search}));
const save=(input:ResourceSave)=>mutate('/resources/save',input);
export function ResourcePage(){return <ResourceTool load={load} save={save}/>;}
