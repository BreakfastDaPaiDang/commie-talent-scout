import React from 'react';
import {MemberPicker as Picker} from '../../../app/ui/MemberPicker';
import {Avatar} from './Avatar.jsx';
export function MemberPicker(props){return <Picker {...props} renderAvatar={m=><Avatar name={m.name} src={m.avatar} qq={m.qq} size="tiny"/>}/>;}
