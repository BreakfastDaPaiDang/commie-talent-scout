import React from 'react';
import {qceTool,waybackTool,sixinTool} from '../shared/auxiliary-tools';
import {Icon} from './icons';
import './auxiliary-tools.css';

export function AuxiliaryTools(){
  return <main className="auxiliary-tools">
    <header className="auxiliary-heading"><p className="eyebrow">整理材料，从这里开始</p><h1>辅助工具</h1><p>导出聊天、留存网页，也方便临时分享信息。</p></header>
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
    <article className="auxiliary-card" aria-labelledby="wayback-title">
      <div className="auxiliary-intro">
        <span className="auxiliary-icon" aria-hidden="true"><Icon name="file" size={28}/></span>
        <p className="auxiliary-platform">Wayback Machine · 在线网页存档</p>
        <h2 id="wayback-title">{waybackTool.name}</h2>
        <p>输入原网址，查找网页过去的样子。帖子删除或网站打不开时，尝试查看已有的历史副本；也可以提前保存仍能访问的公开网页。</p>
        <a className="button primary" href={waybackTool.url} target="_blank" rel="noopener noreferrer">查找网页历史<Icon name="arrow"/></a>
        <a className="auxiliary-docs" href={waybackTool.saveUrl} target="_blank" rel="noopener noreferrer">保存当前网页 · Save Page Now</a>
        <a className="auxiliary-docs" href={waybackTool.docsUrl} target="_blank" rel="noopener noreferrer">查看官方使用说明</a>
      </div>
      <section className="auxiliary-tutorial" aria-labelledby="wayback-steps">
        <h3 id="wayback-steps">查历史，也提前留底</h3>
        <ol>
          <li><strong>找旧页面：粘贴原网址</strong><p>打开“查找网页历史”，输入帖子的完整原链接，查询是否已有存档。</p></li>
          <li><strong>选择日期，查看历史副本</strong><p>选择有存档的年份、日期和时间。检查正文与图片，再复制这份历史副本的链接，记录它对应的存档日期。</p></li>
          <li><strong>防删帖：趁页面可访问时保存</strong><p>打开 Save Page Now，填入要保留的公开网页链接并提交；按网站提示完成所需操作，等待保存结果。</p></li>
          <li><strong>打开存档，确认内容保存成功</strong><p>检查返回的副本，保留原网址、存档链接和日期。未成功保存的页面可稍后重试；动态内容和登录后内容可能无法完整保存。</p></li>
        </ol>
        <p className="auxiliary-tip">已删除的页面必须此前有存档才可能找回，无法恢复从未保存的内容。这里是公开存档服务，私人材料请留在档案的“绑定材料”。</p>
      </section>
    </article>
    <article className="auxiliary-card" aria-labelledby="sixin-title">
      <div className="auxiliary-intro">
        <span className="auxiliary-icon" aria-hidden="true"><Icon name="file" size={28}/></span>
        <p className="auxiliary-platform">在线工具 · 阅后即焚</p>
        <h2 id="sixin-title">{sixinTool.name}</h2>
        <p>将临时分享的文字生成一个私信链接，交给指定的人阅读。按网站所选的销毁方式，阅读后或到时删除私信。</p>
        <a className="button primary" href={sixinTool.url} target="_blank" rel="noopener noreferrer">打开阅后即焚<Icon name="arrow"/></a>
        <a className="auxiliary-docs" href={sixinTool.faqUrl} target="_blank" rel="noopener noreferrer">查看使用与销毁说明</a>
      </div>
      <section className="auxiliary-tutorial" aria-labelledby="sixin-steps">
        <h3 id="sixin-steps">分享一条临时私信</h3>
        <ol>
          <li><strong>写下要分享的文字</strong><p>打开网站，将这次需要对方查看的内容填入私信框。</p></li>
          <li><strong>确认销毁方式</strong><p>在选项中确认是阅读后销毁，还是按时间销毁；两种方式不同。也可按需设置自定义密码。</p></li>
          <li><strong>创建私信，复制链接</strong><p>点击“创建私信”，把生成的链接发给收件人。使用阅读后销毁时，不要自己先打开链接，以免提前销毁。</p></li>
        </ol>
        <p className="auxiliary-tip">阅后即焚不能阻止收件人截图或复制；需要长期留存的材料，请使用档案的“绑定材料”。</p>
      </section>
    </article>
  </main>;
}
