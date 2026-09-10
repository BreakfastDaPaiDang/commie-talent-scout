export const qceTool = {
  name: 'QQ Chat Exporter',
  releaseUrl: 'https://github.com/shuakami/qq-chat-exporter/releases/latest',
  docsUrl: 'https://shuakami.github.io/qq-chat-exporter/docs/index.html',
  packagePattern: 'NapCat-Framework-QCE-v版本号.zip',
  launcher: 'napiLoader.bat',
  localUrl: 'http://localhost:40653/qce',
} as const;

export const waybackTool = {
  name: '互联网档案馆',
  url: 'https://web.archive.org/',
  saveUrl: 'https://web.archive.org/save',
  docsUrl: 'https://archivesupport.zendesk.com/hc/en-us/articles/360004651732-Using-The-Wayback-Machine',
} as const;

export const sixinTool = {
  name: 'Sixin.cc',
  url: 'https://www.sixin.cc/',
  faqUrl: 'https://www.sixin.cc/faq',
} as const;
