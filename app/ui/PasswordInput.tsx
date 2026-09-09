import React,{useState,type InputHTMLAttributes} from 'react';
import './password-input.css';

export function PasswordInput(props:Omit<InputHTMLAttributes<HTMLInputElement>,'type'>){
 const[visible,setVisible]=useState(false);
 return <span className="password-input"><input {...props} type={visible?'text':'password'}/><button type="button" className="password-visibility" aria-label={visible?'隐藏密码':'显示密码'} aria-pressed={visible} onClick={()=>setVisible(value=>!value)}>{visible?'隐藏':'显示'}</button></span>;
}
