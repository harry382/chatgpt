'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),config=require('../miniprogram/config');
const issues=[];
if(config.generation!==2||config.mode!=='cloud'||!config.cloudEnv||config.functionName!=='readingClubV2')issues.push('当前配置仍为开发演示，不能上传体验版或正式版');
const releaseVersion=require('../package.json').version.split('-')[0];
const filename=path.join(root,'work/release-evidence-'+releaseVersion+'.json');
if(!fs.existsSync(filename))issues.push('缺少真实接入验收记录：微信身份注册、隐私声明、图片审核、导航、通知、数据迁移与手机验证');
else{const evidence=JSON.parse(fs.readFileSync(filename));for(const key of ['authentication','privacy','moderation','navigation','notifications','migration','device','dependencies',...(releaseVersion==='1.2.0'?['history','recap','notices','images']:[])])if(evidence[key]?.passed!==true||!evidence[key]?.evidence)issues.push('未验收：'+key);}
if(issues.length){console.error(releaseVersion+' 发布检查未通过：\n'+issues.map(x=>'• '+x).join('\n'));process.exitCode=1;}else console.log('本地发布门槛通过；仍须在微信后台审核并正式发布。');
