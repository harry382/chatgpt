'use strict';
// Create a standalone public snapshot. Never push the operational repository's history.
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), revision = process.argv[2];
if (!revision || !/^[\w./-]+$/.test(revision)) throw Error('Supply a Git revision to archive');
const git = process.env.PUBLIC_ARCHIVE_GIT || 'git';
const run = args => execFileSync(git, args, { cwd:root, encoding:'utf8' });
const version = JSON.parse(run(['show', revision + ':package.json'])).version.split('-')[0];
const target = path.join(root, 'work', 'public-' + version);
if (fs.existsSync(target)) throw Error('Public export directory already exists; inspect it before re-exporting');
const elements = [];
function sanitize(content) {
 return content.replace(/\bwx[0-9a-f]{16}\b/gi, 'wx0000000000000000')
  .replace(/yiqi-gongdu-dev-[\w-]+/g, 'YOUR_CLOUD_ENV_ID')
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'privacy@example.com');
}
function add(filename, content, mode = '100644') {
 const clean = sanitize(content);
 if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/.test(clean)) throw Error('Possible credential in ' + filename);
 const destination = path.join(target, filename); fs.mkdirSync(path.dirname(destination), { recursive:true }); fs.writeFileSync(destination, clean);
 elements.push({ path:filename, mode, type:'blob', content:clean });
}
for (const record of run(['ls-tree', '-rz', revision]).split('\0').filter(Boolean)) {
 const [meta, filename] = record.split('\t'), [mode, type] = meta.split(' ');
 if (type !== 'blob') throw Error('Unexpected tree entry');
 if (!/^(miniprogram\/|cloudfunctions\/|scripts\/|tests\/|\.github\/)/.test(filename) && !['.gitignore', 'package.json', 'project.config.json'].includes(filename)) continue;
 if (/(^|\/)(work|backups|data-exports|node_modules)\/|(^|\/)\.env|config\.local|private\.config|\.(pem|key)$/.test(filename)) throw Error('Private artifact selected');
 add(filename, run(['show', revision + ':' + filename]), mode);
}
add('README.md', '# 一起共读 · 微信读书会小程序\n\n当前快照：' + version + '。1.1.0为第二版本；1.2.0为第三版本迭代。\n\n这是脱敏的公开代码归档，不包含真实用户、活动照片、运营文档、备份、密钥和原始运行配置。公开历史与本机运营仓库分离；请勿向此仓库直接推送运营仓库的完整历史。\n\n## 本地运行\n\n1. 使用Node.js 20或以上版本运行 `npm run verify`。\n2. 在微信开发者工具导入本目录。将project.config.json中的占位AppID换成自己的AppID。\n3. 仅本机演示时，将miniprogram/config.js配置为generation: 2、mode: demo；演示数据仅能在develop环境运行。\n4. 真实云模式需配置自己的云环境和readingClubV2云函数，创建club_v2_*集合并关闭客户端直接读写。安装云函数依赖，配置服务端身份、审核与可选订阅模板。\n5. 发布前补全真实隐私联系邮箱和微信平台隐私声明，验证图片审核、地图和订阅提醒，完成真实手机验收和微信审核。\n\n## 版本\n\n- release/1.1.0：第二版本源码归档（配置与联系方式已脱敏）。\n- feature/reading-club-1.2.0：第三版本，增加历史活动、活动回顾照片、简介配图、可编辑须知。\n\n真实生产版本及运行数据以运营方记录为准；本仓库不保存生产凭据。\n');
fs.mkdirSync(path.join(root, 'work'), { recursive:true });
const output = path.join(root, 'work', 'public-tree-' + version + '.json'); fs.writeFileSync(output, JSON.stringify(elements));
console.log(JSON.stringify({ version, files:elements.length, target, output, characters:JSON.stringify(elements).length }));
