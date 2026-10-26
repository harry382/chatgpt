'use strict';
const { VERSION,CATEGORIES }=require('./shared/domain');
const CONSENT='club_v2_privacy';
const SIGNED_OUT='club_v2_signed_out';
const api=()=>getApp().client;
function navigate(page,query=''){wx.navigateTo({url:'/v2/pages/'+page+'/index'+query});}
function home(){wx.switchTab({url:'/v2/pages/home/index'});}
function field(e){this.setData({[e.currentTarget.dataset.field]:e.detail.value});}
function error(page,e){page.setData({error:e.message||'操作未完成，请重试'});}
function dateParts(timestamp) {
  const s=new Date(timestamp+8*3600000).toISOString();
  const date=s.slice(0,10),time=s.slice(11,16),week='日一二三四五六'[new Date(timestamp+8*3600000).getUTCDay()];
  return{date,time,week,dateLabel:Number(date.slice(5,7))+'月'+Number(date.slice(8,10))+'日',full:date.replace(/-/g,'/')+' '+time+' 周'+week};
}
function eventView(e){const d=dateParts(e.startAt),end=dateParts(e.endAt),ended=e.ended===undefined?e.status==='published'&&e.endAt<=now():e.ended;return{...e,...d,notices:(e.notices||[]).map((n,i)=>({...n,key:"notice_"+i})),participants:(e.participants||[]).map(p=>({...p,initial:p.nickname.slice(0,1)})),ended,year:d.date.slice(0,4),monthDay:d.date.slice(5).replace('-','.'),started:e.startAt<=now(),fullLabel:d.full,endLabel:end.date===d.date?end.time:end.full,full:e.count>=e.capacity,statusLabel:e.status==='draft'?'草稿':e.status==='cancelled'?'已取消':ended?'已结束':e.startAt<=now()?'进行中':e.count>=e.capacity?'名额已满':'报名中',closed:e.status!=='published'||e.signupUntil<=now()||e.startAt<=now()};}
function now(){return api().demo?api().demo.clock():Date.now();}
function groupEvents(rows){const groups=[];for(const row of rows){const e=eventView(row);let g=groups[groups.length-1];if(!g||g.date!==e.date){g={date:e.date,label:e.dateLabel,week:e.week,events:[]};groups.push(g);}g.events.push(e);}return groups;}
async function session({forLogin=false}={}){
  if(wx.getStorageSync(SIGNED_OUT)&&!forLogin){getApp().globalData.user=null;return null;}
  const r=await api().call('session');
  if(forLogin)return r.user;
  if(wx.getStorageSync(SIGNED_OUT)){getApp().globalData.user=null;return null;}
  getApp().globalData.user=r.user;return r.user;
}
function signIn(user){wx.removeStorageSync(SIGNED_OUT);wx.setStorageSync(CONSENT,VERSION);getApp().globalData.user=user;}
function signOut(){wx.setStorageSync(SIGNED_OUT,true);getApp().globalData.user=null;getApp().clearPendingEvent();wx.reLaunch({url:'/v2/pages/mine/index'});}
async function requireMember(eventId){const u=await session();if(u?.member&&u.privacyVersion===VERSION)return u;if(eventId)getApp().rememberEvent(eventId);navigate(u?.member?'register':'membership');return null;}
function promiseWx(name,args={}){return new Promise((resolve,reject)=>{if(typeof wx[name]!=='function'){reject(Error('当前微信版本暂不支持此功能'));return;}wx[name]({...args,success:resolve,fail:reject});});}
async function upload(kind, file) {
  let path=file;
  if(!path) {const selected=await promiseWx('chooseMedia',{count:1,mediaType:['image'],sourceType:['album']});path=selected.tempFiles[0].tempFilePath;}
  if(api().demo)return{...(await api().call('uploadImage',{kind,previewUrl:path})),url:path};
  const compressed=await promiseWx('compressImage',{src:path,quality:65,compressedWidth:1000});
  const data=await new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:compressed.tempFilePath,encoding:'base64',success:r=>resolve(r.data),fail:reject}));
  const png=data.startsWith('iVBOR');return{...(await api().call('uploadImage',{kind,type:png?'image/png':'image/jpeg',base64:data})),url:compressed.tempFilePath};
}
function parseDate(date,time){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))throw Error('请填写正确的日期和时间');const n=Date.parse(date+'T'+time+':00+08:00');if(!Number.isFinite(n)||dateParts(n).date!==date||dateParts(n).time!==time)throw Error('日期或时间无效');return n;}
function openEvent(e){navigate('detail','?id='+encodeURIComponent(e.currentTarget.dataset.id));}
module.exports={api,navigate,home,field,error,dateParts,eventView,groupEvents,session,signIn,signOut,requireMember,promiseWx,upload,parseDate,openEvent,now,VERSION,CATEGORIES,CONSENT,SIGNED_OUT};
