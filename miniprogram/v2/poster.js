'use strict';
function call(platform,name,args){return new Promise((resolve,reject)=>platform[name]({...args,success:resolve,fail:reject}));}
function lines(value,max){const chars=Array.from(value),rows=[];for(let i=0;i<chars.length;i+=max)rows.push(chars.slice(i,i+max).join(''));return rows;}
async function renderPoster(platform,page,event,qrPath,demo){
 const canvas=await new Promise((resolve,reject)=>platform.createSelectorQuery().in(page).select('#activityPoster').fields({node:true,size:true}).exec(rows=>rows?.[0]?.node?resolve(rows[0].node):reject(Error('海报画布暂未准备好，请重试'))));
 canvas.width=720;canvas.height=1120;const c=canvas.getContext('2d');c.scale(2,2);
 c.fillStyle='#f7f8ef';c.fillRect(0,0,360,560);c.fillStyle='#4c9e89';c.fillRect(0,0,360,245);
 c.fillStyle='#fff';c.font='600 24px sans-serif';c.fillText('一起共读',26,48);c.font='11px sans-serif';c.fillText('READ TOGETHER',26,70);
 c.fillStyle='#d9ead7';c.beginPath();c.arc(55,180,85,0,Math.PI*2);c.fill();
 c.fillStyle='#fff6dd';c.fillRect(208,78,124,172);c.fillStyle='#2b7463';c.font='18px sans-serif';lines(event.book,6).slice(0,3).forEach((line,i)=>c.fillText(line,220,120+i*27));
 async function image(src,x,y,w,h){const img=canvas.createImage();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('海报图片未能加载，请重试'));img.src=src;});c.drawImage(img,x,y,w,h);}
 if(event.coverUrl){const r=await call(platform,'downloadFile',{url:event.coverUrl});await image(r.tempFilePath,208,78,124,172);}
 c.fillStyle='#1f5247';c.font='600 24px sans-serif';const title=lines(event.title,12);title.slice(0,3).forEach((line,i)=>c.fillText(i===2&&title.length>3?line.slice(0,10)+'…':line,26,300+i*34));
 c.font='13px sans-serif';c.fillText(event.fullLabel,26,425);c.fillText(event.location.slice(0,17),26,453);c.fillText('免费会员 · 预约报名',26,487);
 if(demo){c.font='11px sans-serif';c.fillText('开发预览海报 · 无真实扫码入口',26,535);}else await image(qrPath,262,447,74,74);
 const result=await call(platform,'canvasToTempFilePath',{canvas,width:360,height:560,destWidth:720,destHeight:1120,fileType:'png'});
 return result.tempFilePath;
}
module.exports={renderPoster};
