import React from 'react';
import {qceTool,singleFileTool,sixinTool} from '../shared/auxiliary-tools';
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
    <article className="auxiliary-card" aria-labelledby="singlefile-title">
      <div className="auxiliary-intro">
        <span className="auxiliary-icon" aria-hidden="true"><Icon name="file" size={28}/></span>
        <p className="auxiliary-platform">浏览器扩展 · 网页留存</p>
        <h2 id="singlefile-title">{singleFileTool.name}</h2>
        <p>把当前网页保存成一个 HTML 文件，留住正文、图片与排版。帖子日后删除或链接失效，仍可打开本地副本查看。</p>
        <a className="button primary" href={singleFileTool.edgeUrl} target="_blank" rel="noopener noreferrer">安装 Edge 扩展<Icon name="arrow"/></a>
        <div className="auxiliary-browser-links"><a href={singleFileTool.chromeUrl} target="_blank" rel="noopener noreferrer">Chrome 版</a><a href={singleFileTool.firefoxUrl} target="_blank" rel="noopener noreferrer">Firefox 版</a></div>
        <a className="auxiliary-docs" href={singleFileTool.docsUrl} target="_blank" rel="noopener noreferrer">GitHub 与其他浏览器安装说明</a>
      </div>
      <section className="auxiliary-tutorial" aria-labelledby="singlefile-steps">
        <h3 id="singlefile-steps">保存一份网页</h3>
        <ol>
          <li><strong>安装对应浏览器扩展</strong><p>选择你正在使用的浏览器，安装 SingleFile，并将它固定到扩展工具栏。</p></li>
          <li><strong>打开帖子，展开要保留的内容</strong><p>展开全文和需要的评论，滚动页面，等图片加载完成。</p></li>
          <li><strong>点击 SingleFile 保存</strong><p>点击工具栏里的扩展按钮，等待保存完成。文件通常会出现在浏览器的下载文件夹。</p></li>
          <li><strong>打开副本，检查并留存</strong><p>用浏览器打开保存的 HTML，确认正文和图片齐全。需要归入档案时，可上传到“绑定材料”，并在说明中写下原链接与保存日期。</p></li>
        </ol>
        <p className="auxiliary-tip">保存后检查一次副本；未加载的评论、视频等动态内容未必完整保留。</p>
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
