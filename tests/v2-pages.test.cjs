'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {createV2Client}=require('../miniprogram/v2/runtime');
const {VERSION,TABLES:T}=require('../miniprogram/v2/shared/domain');
const root=path.resolve(__dirname,'../miniprogram');
function harness() {
 const storage=new Map(),navigation=[],messages=[];let app;
 const wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,JSON.parse(JSON.stringify(v))),removeStorageSync:k=>storage.delete(k),getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}}),stopPullDownRefresh(){},showShareMenu(){},navigateTo:r=>navigation.push(r.url),switchTab:r=>navigation.push(r.url),redirectTo:r=>navigation.push(r.url),reLaunch:r=>navigation.push(r.url),navigateBack:()=>navigation.push('back'),showToast:r=>messages.push(r.title),getPrivacySetting:r=>r.success({needAuthorization:false}),showModal:r=>r.success({confirm:true,content:'654321'}),openLocation:r=>r.success({})};
 const client=createV2Client(wx,{mode:'demo'},'develop');app={client,globalData:{},rememberEvent:id=>storage.set('pending',id),pendingEvent:()=>storage.get('pending'),clearPendingEvent:()=>storage.delete('pending')};
 // Helpers access the real injected app and platform in a dedicated VM require graph.
 const cache=new Map();
 function load(filename){if(cache.has(filename))return cache.get(filename).exports;const module={exports:{}};cache.set(filename,module);const local=createRequire(filename);const requireModule=name=>name.startsWith('.')?load(local.resolve(name)):local(name);const fn=vm.runInNewContext('(function(require,module,exports,wx,getApp,Page){'+fs.readFileSync(filename,'utf8')+'\n})',{setInterval,clearInterval,console},{filename});fn(requireModule,module,module.exports,wx,()=>app,()=>{});return module.exports;}
 function page(name,q={}){let definition;const filename=path.join(root,'v2/pages',name,'index.js'),local=createRequire(filename);vm.runInNewContext(fs.readFileSync(filename,'utf8'),{wx,getApp:()=>app,require:n=>n.startsWith('.')?load(local.resolve(n)):local(n),setInterval,clearInterval,Page:d=>definition=d},{filename});const p={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(update){for(const [key,value]of Object.entries(update)){const parts=key.split('.');let at=this.data;while(parts.length>1)at=at[parts.shift()];at[parts[0]]=value;}}};p.ready=p.onLoad?.(q);return p;}
 return{wx,app,client,page,navigation,storage,messages,ui:load(path.join(root,'v2/ui.js'))};
}
const click=dataset=>({currentTarget:{dataset}});
test('V2 page flow: public browse → register → resume event → join → group → cancel',async()=>{
 const h=harness(),home=h.page('home');await home.refresh();assert.equal(home.data.groups.length,2);assert.equal(home.data.user,null);
 const detail=h.page('detail',{id:'e_v2_literature'});await detail.load();await detail.join();assert.match(h.navigation.at(-1),/membership/);
 const register=h.page('register');await register.ready;await register.register();assert.match(register.data.error,/同意/);register.setData({agreed:true});await register.register();assert.match(register.data.error,/昵称/);register.setData({nickname:'共读新朋友'});await register.register();
 assert.match(h.navigation.at(-1),/detail\/index\?id=e_v2_literature/);
 await detail.load();await detail.join();assert.equal(detail.data.event.count,2);assert.equal(detail.data.groupOpen,true);assert.match(detail.data.groupMessage,/未关联真实微信群/);
 await detail.join();assert.equal(detail.data.event.count,1);
});
test('V2 preview queue: cancellation promotes current member and persists on restart',async()=>{
 const h=harness();await h.client.call('register',{accepted:true,version:VERSION,nickname:'候补书友'});
 const detail=h.page('detail',{id:'e_v2_psychology'});await detail.load();await detail.wait();assert.equal(detail.data.registration.status,'waitlist');
 h.client.demo.switch('alice');await h.client.call('cancelRegistration',{id:'e_v2_psychology'});h.client.demo.switch('guest');
 const mine=h.page('mine');await mine.load(true);assert.equal(mine.data.events[0].myStatus,'registered');assert.equal(mine.data.notices.length,1);
 const again=createV2Client(h.wx,{mode:'demo'},'develop');assert.equal((await again.call('getEvent',{id:'e_v2_psychology'})).registration.status,'registered');
});
test('V2 event editor validates dates, publishes a member-created event, exposes it in My',async()=>{
 const h=harness();h.client.demo.switch('owner');const editor=h.page('editor');await editor.ready;
 editor.setData({'form.title':'我们的第一次共读','form.book':'一本新书','form.location':'共读空间','form.description':'交换各自的阅读收获'});
 await editor.save(click({publish:true}));assert.equal(editor.data.error,'');assert.ok(editor.id);
 const mine=h.page('mine');mine.setData({tab:'created'});await mine.load(true);assert.ok(mine.data.events.some(e=>e.id===editor.id));
 const bad=h.page('editor');await bad.ready;bad.setData({'form.startDate':'2026-02-30'});await bad.save(click({publish:true}));assert.match(bad.data.error,/无效/);
});
test('V2 demo rejected outside develop; cloud errors never fall back to local accounts',async()=>{
 const h=harness();for(const runtime of ['trial','release',undefined])assert.throws(()=>createV2Client(h.wx,{mode:'demo'},runtime),/禁止/);
 const c=createV2Client({cloud:{init(){},callFunction:async()=>({result:{ok:false,error:{code:'UNAUTHENTICATED',message:'身份验证失败'}}})}},{mode:'cloud',cloudEnv:'isolated-env',functionName:'readingClubV2'},'trial');
 await assert.rejects(c.call('register'),{code:'UNAUTHENTICATED'});
});
test('V2 legacy members accept new privacy without losing account or requiring fake SMS',async()=>{
 const h=harness();h.client.demo.switch('owner');
 const data=h.storage.get('reading_club_v2_demo')||require('../miniprogram/v2/runtime').seed(Date.now());data[T.users].owner.privacyVersion='old';h.storage.set('reading_club_v2_demo',data);h.app.client=createV2Client(h.wx,{mode:'demo'},'develop');
 const p=h.page('register');await p.ready;assert.equal(p.data.existing,true);p.setData({agreed:true});await p.register();assert.equal(p.data.error,'');assert.equal((await h.app.client.call('session')).user.id,'owner');
});
test('V2 WeChat registration requires both explicit agreement and the platform privacy callback',async()=>{
 const h=harness();h.wx.getPrivacySetting=r=>r.success({needAuthorization:true});
 const p=h.page('register');await p.ready;p.setData({agreed:true,nickname:'新书友昵称'});await p.register();
 assert.equal((await h.client.call('session')).user,null);assert.match(p.data.error,/隐私授权/);
 await p.agreeNative();assert.equal((await h.client.call('session')).user.member,true);
 assert.equal(p.data.phone,undefined);assert.equal(p.data.code,undefined);
});
test('V2 unavailable privacy APIs keep WeChat registration disabled',async()=>{
 const h=harness();delete h.wx.getPrivacySetting;const p=h.page('register');await p.ready;p.setData({agreed:true});await p.register();
 assert.equal((await h.client.call('session')).user,null);assert.equal(p.data.platformReady,false);
});
test('V2 logout clears visible membership across restart and WeChat login restores the same records',async()=>{
 const h=harness(),p=h.page('register');await p.ready;p.setData({nickname:'小林',agreed:true});await p.register();
 await h.client.call('join',{id:'e_v2_literature'});
 const mine=h.page('mine');await mine.load(true);const id=mine.data.user.id;assert.equal(mine.data.events.length,1);
 mine.register();assert.match(h.navigation.at(-1),/profile/);
 h.wx.showModal=r=>r.success({confirm:false});await mine.logout();assert.equal(await h.ui.session()!==null,true);
 h.wx.showModal=r=>r.success({confirm:true});await mine.logout();assert.equal(h.app.globalData.user,null);assert.equal(h.storage.get(h.ui.SIGNED_OUT),true);
 h.app.client=createV2Client(h.wx,{mode:'demo'},'develop');await mine.load(true);assert.equal(mine.data.user,null);assert.equal(mine.data.events.length,0);assert.equal(mine.data.notices.length,0);
 const detail=h.page('detail',{id:'e_v2_literature'});await detail.load();assert.equal(detail.data.registration,null);assert.equal(detail.data.canManage,false);
 await detail.join();assert.match(h.navigation.at(-1),/membership/);assert.equal((await h.app.client.call('getEvent',{id:'e_v2_literature'})).event.count,2);
 const login=h.page('register');await login.ready;assert.equal(login.data.existing,true);assert.equal(login.data.returning,true);await login.register();
 assert.equal(h.storage.has(h.ui.SIGNED_OUT),false);await mine.load(true);assert.equal(mine.data.user.id,id);assert.equal(mine.data.user.nickname,'小林');assert.equal(mine.data.events.length,1);
});
test('V2 an in-flight session response cannot undo an explicit logout',async()=>{
 const h=harness();h.client.demo.switch('owner');let finish;h.app.client={call:()=>new Promise(resolve=>{finish=resolve;})};
 const pending=h.ui.session();h.ui.signOut();finish({user:{id:'owner',member:true}});
 assert.equal(await pending,null);assert.equal(h.app.globalData.user,null);
});
