import React from 'react';
import {TopBar} from '../../../app/ui/Workspace';
import {WhaleHome} from '../../../app/ui/WhaleHome';
export default function HomePreview(){
 return <div className="app whale-home-shell"><TopBar navigation={null} onHome={()=>location.assign('/?home')} tools={<a className="whale-home-account" href="/?page=login">登录</a>}/><WhaleHome/></div>;
}
