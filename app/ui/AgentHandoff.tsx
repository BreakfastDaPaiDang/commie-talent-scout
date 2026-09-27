import React from 'react';
import './agent-onboarding.css';

function AgentOnboarding(){
 return <details className="agent-onboarding"><summary>还没有 Agent？</summary><h2>试试 DSH 桌面版</h2><p>DeepSeek Harness（DSH）可以帮你整理材料、查档案、写观察。新手推荐下载桌面版，安装后用聊天的方式交代工作。</p><ol>
  <li><strong>下载安装。</strong> <a href="https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.1.7-rc.1.20260924.1-win-x64.exe">下载 Windows x64 桌面版</a>，安装后打开 DeepSeek Harness。</li>
  <li><strong>开通 API 余额。</strong> 前往 <a href="https://platform.deepseek.com/" target="_blank" rel="noopener noreferrer">DeepSeek 官方开放平台</a>注册或登录，在充值页面先充 5 元试用，API 按实际用量扣费。</li>
  <li><strong>配置模型。</strong> 在开放平台的 API keys 页面创建并复制密钥，回到 DSH 的 API Key 配置入口填写并保存。密钥填写在 DSH 的配置界面，不用发到聊天里。</li>
  <li><strong>接入康米巨星。</strong> 点击上方“复制提示词给 Agent”，粘贴到 DSH 对话中发送。等它确认连接成功，再交给它需要整理的材料。</li>
 </ol></details>;
}

export function AgentHandoff({onCopy,busy=false,copied=false,fallback='',error='',onNew}:{onCopy:()=>void;busy?:boolean;copied?:boolean;fallback?:string;error?:string;onNew?:()=>void}){
 return <section className="agent-simple"><div className="agent-copy"><span className="eyebrow">让 Agent 帮你干活</span><h1>整理资料，交给 Agent。</h1><p>让它帮你查档案、整理材料、写观察，<br/>把值得留下的信息记到这里。</p><p>复制时自动创建专用连接。<br/>仅发给你要授权的 Agent，无需它操作浏览器。</p><button className="button primary" disabled={busy} onClick={onCopy}>{busy?'正在准备接入…':'复制提示词给 Agent'}</button>{error&&<p className="form-error" role="alert">{error}</p>}{copied&&<p role="status">接入信息已复制，粘贴给 Agent 即可。</p>}{fallback&&<div className="copy-fallback"><label>请选择下方接入信息复制<textarea readOnly value={fallback} onFocus={e=>e.currentTarget.select()} rows={12}/></label></div>}{onNew&&<div className="inline-actions"><button className="button quiet" disabled={busy} onClick={onNew}>为另一个 Agent 复制</button><a className="text-button" href="/account/connections">管理连接</a></div>}<AgentOnboarding/></div><div className="agent-art" aria-hidden="true"><img src="/art/agent-handoff-v3.png" alt=""/></div></section>;
}
