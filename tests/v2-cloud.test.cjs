'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createHandler}=require('../cloudfunctions/readingClubV2/handler'),{TABLES:T,VERSION}=require('../cloudfunctions/readingClubV2/domain'),{MemoryStore}=require('../cloudfunctions/readingClub/memory-store');
function fakeDatabase(store) {
 function wrap(unit){return{collection(table){return{filters:{},where(c){this.filters=c;return this;},orderBy(k,d){if(!this.field){this.field=k;this.direction=d;}return this;},skip(n){this.offset=n;return this;},limit(n){this.size=n;return this;},async get(){return{data:(await unit.find(table,this.filters,{orderBy:this.field,direction:this.direction,offset:this.offset,limit:this.size})).map(r=>({...r,_id:r.id}))};},doc(id){return{async get(){return{data:await unit.get(table,id)};},async set({data}){await unit.put(table,id,data);}};}};}};}
 const db=wrap(store);db.command={gt:value=>({$gt:value})};db.runTransaction=fn=>store.transaction(u=>fn(wrap(u)));return db;
}
function setup(checker=async()=>({errCode:0,result:{suggest:'pass'}})){
 const ctx={OPENID:'private-trusted-id',APPID:'wx-test'},id='u_'+crypto.createHash('sha256').update(ctx.APPID+':'+ctx.OPENID).digest('hex').slice(0,40);
 const store=new MemoryStore({[T.users]:{[id]:{id,nickname:'书友',status:'active',role:'member',privacyVersion:VERSION}}}),checks=[];
 const cloud={database:()=>fakeDatabase(store),getWXContext:()=>ctx,openapi:{security:{msgSecCheck:async p=>{checks.push(p);return checker(p);},imgSecCheck:async()=>({errCode:0})}},getTempFileURL:async()=>({fileList:[{status:0,tempFileURL:'https://example.invalid/temporary'}]}),uploadFile:async()=>({fileID:'cloud://private/file'})};
 return{store,cloud,ctx,id,checks,handler:createHandler(cloud,{WX_APP_ID:'wx-test'},{error(){},warn(){}})};
}
test('V2 cloud wrapper registers only the trusted WeChat identity and never accepts a client role',async()=>{
 const f=setup(),r=await f.handler({action:'session',actor:{id:'forged',role:'admin'}});
 assert.equal(r.data.user.id,f.id);assert.equal(r.data.user.role,'member');assert.ok(!JSON.stringify(r).includes(f.ctx.OPENID));
 const response=await f.handler({action:'register',payload:{id:'forged',role:'admin',accepted:true,version:VERSION}});
 assert.equal(response.ok,true);assert.equal(response.data.user.id,f.id);assert.equal(response.data.user.role,'member');
 assert.equal((await f.handler({action:'requestOtp',payload:{}})).error.code,'AUTH_METHOD_CHANGED');
 assert.ok(!JSON.stringify(await f.store.get(T.users,f.id)).includes('phone'));
 assert.equal((await createHandler(f.cloud,{},console)({action:'session'})).error.code,'UNAUTHENTICATED');
 f.ctx.APPID='wrong-app';assert.equal((await f.handler({action:'register',payload:{accepted:true,version:VERSION}})).error.code,'UNAUTHENTICATED');
});
test('V2 cloud text moderation receives an array-normalized body and numeric scene; failures do not publish',async()=>{
 const f=setup();const r=await f.handler({action:'updateProfile',payload:{nickname:'新书友',bio:'喜欢读书',contentReview:{provider:'fake'}}});
 assert.equal(r.ok,true);assert.equal(f.checks[0].scene,1);assert.equal(f.checks[0].version,2);assert.equal(f.checks[0].openid,f.ctx.OPENID);assert.match(f.checks[0].content,/新书友/);
 const fail=setup(async()=>({errCode:0,result:{suggest:'risky'}}));
 assert.equal((await fail.handler({action:'updateProfile',payload:{nickname:'风险内容',bio:''}})).error.code,'CONTENT_REJECTED');
 assert.equal((await fail.store.get(T.users,fail.id)).nickname,'书友');
});
test('V2 uploads verify bytes and moderation; forged asset metadata is insufficient',async()=>{
 const f=setup();
 assert.equal((await f.handler({action:'uploadImage',payload:{kind:'cover',type:'image/png',base64:Buffer.from('not an image').toString('base64'),status:'approved'}})).error.code,'MEDIA_INVALID');
 f.cloud.openapi.security.imgSecCheck=async()=>{throw Error('upstream unavailable');};
 const png=Buffer.from([137,80,78,71,13,10,26,10,1]);
 assert.equal((await f.handler({action:'uploadImage',payload:{kind:'group',type:'image/png',base64:png.toString('base64')}})).error.code,'CONTENT_UNAVAILABLE');
 assert.equal(Object.keys(f.store.snapshot()[T.assets]||{}).length,0);
});
test('V2 share-code errors expose only a numeric vendor code and never upload an invalid code',async()=>{
 const f=setup(); await f.store.put(T.events,'event_share',{id:'event_share',status:'published',visibility:'public',creatorId:f.id});
 let uploads=0; f.cloud.uploadFile=async()=>{uploads++;};
 f.cloud.openapi.wxacode={getUnlimited:async()=>{throw{errCode:41030,errMsg:'private upstream diagnostics'};}};
 const handler=createHandler(f.cloud,{WX_APP_ID:'wx-test',SHARE_CODE_ENV:'trial'},{error(){}});
 const response=await handler({action:'shareCode',payload:{id:'event_share'}});
 assert.equal(response.error.code,'CODE_UNAVAILABLE');assert.match(response.error.message,/41030/);
 assert.ok(!JSON.stringify(response).includes('private upstream'));assert.equal(uploads,0);
});
test('V2 trial posters support a not-yet-published fixed route; release keeps the page check',async()=>{
 for(const state of ['trial','release']) {
  const f=setup(); await f.store.put(T.events,'event_share',{id:'event_share',status:'published',visibility:'public',creatorId:f.id});
  let request; f.cloud.openapi.wxacode={getUnlimited:async p=>{request=p;return{buffer:Buffer.from('test image')};}};
  const handler=createHandler(f.cloud,{WX_APP_ID:'wx-test',SHARE_CODE_ENV:state},{error(){}});
  const r=await handler({action:'shareCode',payload:{id:'event_share',page:'untrusted/page'}});
  assert.equal(r.ok,true);assert.ok(r.data.url);assert.equal(request.page,'v2/pages/detail/index');
  assert.equal(request.scene,'event_share');assert.equal(request.envVersion,state);assert.equal(request.checkPath,state==='release');
 }
});
