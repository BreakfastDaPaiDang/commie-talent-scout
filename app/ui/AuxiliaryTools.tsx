import React from 'react';
import {qceTool} from '../shared/auxiliary-tools';
import {Icon} from './icons';
import './auxiliary-tools.css';

export function AuxiliaryTools(){
  return <main className="auxiliary-tools">
    <header className="auxiliary-heading"><p className="eyebrow">整理材料，从这里开始</p><h1>辅助工具</h1><p>把聊天里的信息带出来，交给 AI 整理。</p></header>
    <article className="auxiliary-card" aria-labelledby="qce-title">
      <div className="auxiliary-intro">
        <span className="auxiliary-icon" aria-hidden="true"><Icon name="file" size={28}/></span>
        <p className="auxiliary-platform">Windows · Framework 版</p>
        <h2 id="qce-title">{qceTool.name}</h2>
        <p>导出 QQ 私聊与群聊记录，保留发言人和时间。选好需要的片段，复制给 AI，继续整理人物观察和标签。</p>
        <a className="button primary" href={qceTool.releaseUrl} target="_blank" rel="noopener noreferrer">前往 GitHub 下载<Icon name="arrow"/></a>
        <a className="auxiliary-docs" href={qceTool.docsUrl} target="_blank" rel="noopener noreferrer">查看工具文档</a>
      </div>
      <section className="auxiliary-tutorial" aria-labelledby="qce-steps">
        <h3 id="qce-steps">开始使用</h3>
        <ol>
          <li><strong>下载最新 Framework 包</strong><p>在 Releases 页的 Assets 中，选择 <code>{qceTool.packagePattern}</code>。</p></li>
          <li><strong>创建文件夹，完整解压</strong><p>例如新建 <code>D:\QQ导出工具</code>，把压缩包内的所有文件解压进去。</p></li>
          <li><strong>退出 QQ，运行启动脚本</strong><p>先退出桌面 QQ 和正在运行的旧导出后台，再双击文件夹中的 <code>{qceTool.launcher}</code>，同时启动 QQ 和工具后台。</p></li>
          <li><strong>登录 QQ，打开导出页面</strong><p>正常登录 QQ。若浏览器没有自动打开，访问 <a href={qceTool.localUrl} target="_blank" rel="noopener noreferrer">本机导出页面</a>；提示需要令牌时，使用启动窗口提供的访问令牌。</p></li>
          <li><strong>选好聊天，交给 AI</strong><p>选择好友或群聊、时间范围，导出为 TXT。打开文件，将需要的聊天内容复制给 AI 整理。</p></li>
        </ol>
        <p className="auxiliary-tip">以后需要边聊天边导出时，通过 <code>{qceTool.launcher}</code> 启动 QQ 即可。</p>
      </section>
    </article>
  </main>;
}
