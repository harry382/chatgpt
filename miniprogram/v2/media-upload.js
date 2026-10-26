'use strict';
function bounded(task, timeoutMs, message) {
 let timer;
 return Promise.race([Promise.resolve().then(task),new Promise((_,reject)=>{timer=setTimeout(()=>{const error=Error(message);error.code='IMAGE_UPLOAD_TIMEOUT';reject(error);},timeoutMs);})]).finally(()=>clearTimeout(timer));
}
function transportError(error) {
 const raw=String(error?.message||error?.errMsg||'');
 if(/timeout|timed out|-404012/i.test(raw)||Number(error?.errCode)===-404012){const e=Error('图片处理响应超时，请重试剩余图片');e.code='IMAGE_UPLOAD_TIMEOUT';return e;}
 if(/network|ECONNRESET|ENETUNREACH|request:fail/i.test(raw)){const e=Error('网络连接不稳定，请重试剩余图片');e.code='IMAGE_NETWORK';return e;}
 return error;
}
async function uploadImage(platform,client,kind,path,options={}) {
 const local=(name,args)=>bounded(()=>new Promise((resolve,reject)=>platform[name]({...args,success:resolve,fail:reject})),options.localTimeoutMs||10000,'图片读取或压缩超时，请重试');
 const info=await local('getImageInfo',{src:path});
 if(!(info.width>0&&info.height>0))throw Error('无法读取这张图片，请重新选择');
 let data,previewPath;
 for(const [edge,quality] of [[1600,65],[1280,50],[1024,40]]) {
  const scale=Math.min(1,edge/Math.max(info.width,info.height));
  const compressed=await local('compressImage',{src:path,quality,compressedWidth:Math.max(1,Math.round(info.width*scale)),compressedHeight:Math.max(1,Math.round(info.height*scale))});
  previewPath=compressed.tempFilePath;
  data=await bounded(()=>new Promise((resolve,reject)=>platform.getFileSystemManager().readFile({filePath:previewPath,encoding:'base64',success:r=>resolve(r.data),fail:reject})),options.localTimeoutMs||10000,'图片读取超时，请重试');
  if(typeof data!=='string')throw Error('图片读取失败，请重新选择');
  const bytes=Math.floor(data.length*3/4)-(data.endsWith('==')?2:data.endsWith('=')?1:0);
  if(bytes<=700*1024)break;
  data=null;
 }
 if(!data)throw Error('这张图片压缩后仍过大，请换用较小的图片');
 const payload={kind,type:data.startsWith('iVBOR')?'image/png':'image/jpeg',base64:data};
 const retryable=new Set(['IMAGE_CHECK_TIMEOUT','IMAGE_UPLOAD_TIMEOUT','IMAGE_UPLOAD_FAILED','IMAGE_NETWORK','CONTENT_UNAVAILABLE']);
 for(let attempt=0;attempt<2;attempt++) {
  try {
   const result=await bounded(()=>client.call('uploadImage',payload),options.requestTimeoutMs||18000,'图片处理响应超时，请重试剩余图片');
   if(typeof result?.assetId!=='string'||!result.assetId)throw Error('图片未确认保存，请重试');
   return{...result,url:previewPath};
  }catch(error){const failure=transportError(error);if(attempt||!retryable.has(failure?.code))throw failure;options.onRetry?.();}
 }
}
module.exports={uploadImage,transportError};
