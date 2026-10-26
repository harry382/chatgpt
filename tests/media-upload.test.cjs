'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryStore}=require('../cloudfunctions/readingClub/memory-store');
const {TABLES:T,VERSION}=require('../cloudfunctions/readingClubV2/domain');
const {createMediaProcessor}=require('../cloudfunctions/readingClubV2/media');
const {uploadImage}=require('../miniprogram/v2/media-upload');
const png=Buffer.from([137,80,78,71,13,10,26,10,1]);
function server(options={}){
 const store=new MemoryStore({[T.users]:{owner:{id:'owner',status:'active',privacyVersion:VERSION}}});
 let audits=0,uploads=0;
 const cloud={openapi:{security:{imgSecCheck:async()=>{audits++;return{errCode:0};}}},uploadFile:async p=>{uploads++;return{fileID:'cloud://'+p.cloudPath};}};
 const process=createMediaProcessor(cloud,store,{warn(){},info(){}},options);
 const payload={kind:'recap',type:'image/png',base64:png.toString('base64')};
 return{store,cloud,process,payload,actor:{id:'owner'},counts:()=>({audits,uploads})};
}
test('image audit timeout fails closed and a late pass never stores or approves the file',async()=>{
 const f=server({checkMs:5,budgetMs:30});let finish,uploads=0;
 f.cloud.openapi.security.imgSecCheck=()=>new Promise(resolve=>{finish=resolve;});f.cloud.uploadFile=async()=>{uploads++;return{fileID:'cloud://never'};};
 await assert.rejects(f.process(f.actor,f.payload),{code:'IMAGE_CHECK_TIMEOUT'});finish({errCode:0});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(uploads,0);assert.equal(Object.keys(f.store.snapshot()[T.assets]||{}).length,0);
});
test('image storage timeout returns without attaching or approving an unfinished file',async()=>{
 const f=server({budgetMs:5});f.cloud.uploadFile=()=>new Promise(()=>{});
 await assert.rejects(f.process(f.actor,f.payload),{code:'IMAGE_UPLOAD_TIMEOUT'});assert.equal(Object.keys(f.store.snapshot()[T.assets]||{}).length,0);
});
test('repeating identical owner/kind/bytes reuses one approved upload; other kinds require their own audit',async()=>{
 const f=server(),a=await f.process(f.actor,f.payload),b=await f.process(f.actor,{...f.payload});
 assert.equal(a.assetId,b.assetId);assert.deepEqual(f.counts(),{audits:1,uploads:1});
 const other=await f.process(f.actor,{...f.payload,kind:'description'});assert.notEqual(other.assetId,a.assetId);assert.deepEqual(f.counts(),{audits:2,uploads:2});
 await assert.rejects(f.process({id:'outsider'},f.payload),{code:'MEMBER_REQUIRED'});
});
test('risky, unknown and missing image audit verdicts never enter storage',async()=>{
 for(const response of [{errCode:87014},{errCode:40001},{},null]){
  const f=server();f.cloud.openapi.security.imgSecCheck=async()=>response;
  await assert.rejects(f.process(f.actor,f.payload),{code:response?.errCode===87014?'CONTENT_REJECTED':'CONTENT_UNAVAILABLE'});assert.equal(f.counts().uploads,0);
 }
});
function phone(){
 const compressions=[],reads=[];
 const platform={getImageInfo:r=>r.success({width:4000,height:3000}),compressImage:r=>{compressions.push(r);r.success({tempFilePath:'/compressed/'+compressions.length+'.jpg'});},getFileSystemManager:()=>({readFile:r=>{reads.push(r.filePath);r.success({data:Buffer.from([255,216,1]).toString('base64')});}})};
 return{platform,compressions,reads};
}
test('client prepares bytes once and retries transient upload using exactly the same payload',async()=>{
 const f=phone(),calls=[];let retries=0;
 const client={call:async(action,p)=>{calls.push(p);if(calls.length===1)throw{errCode:-404012,errMsg:'cloud.callFunction:fail polling exceed max timeout retry'};return{assetId:'asset_ready'};}};
 const r=await uploadImage(f.platform,client,'recap','/original.jpg',{onRetry:()=>retries++});
 assert.equal(r.assetId,'asset_ready');assert.equal(r.url,'/compressed/1.jpg');assert.equal(calls[0],calls[1]);assert.equal(f.compressions.length,1);assert.equal(retries,1);
 assert.equal(f.compressions[0].compressedWidth,1600);assert.equal(f.compressions[0].compressedHeight,1200);
});
test('client reduces oversized images before requesting audit and refuses files still over the limit',async()=>{
 const f=phone();let count=0,calls=0;
 f.platform.getFileSystemManager=()=>({readFile:r=>r.success({data:Buffer.alloc(++count<3?760000:500000,1).toString('base64')})});
 await uploadImage(f.platform,{call:async()=>{calls++;return{assetId:'asset_small'};}},'recap','/original.jpg');assert.equal(f.compressions.length,3);assert.equal(calls,1);
 const large=phone();large.platform.getFileSystemManager=()=>({readFile:r=>r.success({data:Buffer.alloc(760000,1).toString('base64')})});
 await assert.rejects(uploadImage(large.platform,{call:async()=>{throw Error('must not send oversized bytes');}},'recap','/huge.png'),/仍过大/);
});
test('client audit rejection is not retried; a never-ending cloud response stops after one bounded retry',async()=>{
 const f=phone();let calls=0;
 await assert.rejects(uploadImage(f.platform,{call:async()=>{calls++;throw Object.assign(Error('审核未通过'),{code:'CONTENT_REJECTED'});}},'recap','/photo.jpg'),{code:'CONTENT_REJECTED'});assert.equal(calls,1);
 calls=0;await assert.rejects(uploadImage(f.platform,{call:()=>{calls++;return new Promise(()=>{});}},'recap','/photo.jpg',{requestTimeoutMs:5}),{code:'IMAGE_UPLOAD_TIMEOUT'});assert.equal(calls,2);
});
