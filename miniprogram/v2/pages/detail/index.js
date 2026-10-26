'use strict';const u=require('../../ui');
Page({
 data:{event:null,user:null,members:[],creator:null,registration:null,hostRequest:null,tab:'members',error:'',loading:true,working:false,demo:false,canManage:false,management:null,shareOpen:false,groupOpen:false,groupUrl:'',groupMessage:''},
 onLoad(q){this.id=q.id||(q.scene?decodeURIComponent(q.scene):'');this.setData({demo:!!u.api().demo});if(wx.showShareMenu)wx.showShareMenu({menus:['shareAppMessage','shareTimeline']});},
 onShow(){return this.load();},
 async load(){this.setData({loading:true,error:''});try{const r=await u.api().call('getEvent',{id:this.id}),user=await u.session();if(!user?.member)Object.assign(r,{registration:null,hostRequest:null,canManage:false});this.setData({...r,event:u.eventView(r.event),user,management:null,templateId:(await u.api().call('capabilities')).subscriptionTemplateId});if(r.canManage)this.setData({management:await u.api().call('manageEvent',{id:this.id})});}catch(e){u.error(this,e);}finally{this.setData({loading:false});}},
 tab(e){this.setData({tab:e.currentTarget.dataset.value});},
 join(){return this.signup(false);},wait(){return this.signup(true);},
 async signup(waitlist){
  if(this.data.working||!await u.requireMember(this.id))return;
  const r=this.data.registration;
  if(r&&['registered','waitlist'].includes(r.status)){const choice=await u.promiseWx('showModal',{title:r.status==='waitlist'?'退出候补？':'取消报名？',content:'空出的名额会按候补顺序自动递补。',confirmText:'确认退出'});if(choice.confirm)await this.perform('cancelRegistration',{id:this.id});return;}
  await this.perform('join',{id:this.id,waitlist},async result=>{if(result.registration.status==='registered')await this.group();else wx.showToast({title:'已加入候补，请留意“我的”中的通知',icon:'none'});});
 },
 async perform(action,payload,after){this.setData({working:true,error:''});try{const r=await u.api().call(action,payload);await this.load();if(after)await after(r);}catch(e){u.error(this,e);}finally{this.setData({working:false});}},
 async group(){
  if(!await u.requireMember(this.id))return;this.setData({groupOpen:true,groupMessage:'',groupUrl:''});
  try{const r=await u.api().call('groupCode',{id:this.id});this.setData({groupUrl:r.url||'',groupMessage:r.demo?'这是演示活动，未关联真实微信群。正式活动报名后，会显示发起人上传的群码。':r.url?'':'群码暂时无法读取，请稍后重试。'});}catch(e){this.setData({groupMessage:e.message});}
 },
 closeGroup(){this.setData({groupOpen:false});},previewGroup(){if(this.data.groupUrl)wx.previewImage({urls:[this.data.groupUrl],current:this.data.groupUrl,showmenu:true});},
 async saveGroup(){try{if(!this.data.groupUrl)return;const r=await u.promiseWx('downloadFile',{url:this.data.groupUrl});await u.promiseWx('saveImageToPhotosAlbum',{filePath:r.tempFilePath});wx.showToast({title:'已保存到相册'});}catch(e){this.setData({groupMessage:'未保存。可放大群码后长按操作，或检查相册权限。'});}},
 async location(){const e=this.data.event;if(e.latitude==null||e.longitude==null){this.setData({error:'发起人尚未设置地图位置，请按地址联系确认'});return;}try{await u.promiseWx('openLocation',{latitude:e.latitude,longitude:e.longitude,name:e.location,address:e.address,scale:16});}catch(e){this.setData({error:'地图未打开，请检查微信权限后重试'});}},
 async host(){if(!await u.requireMember(this.id))return;const r=await u.promiseWx('showModal',{title:'申请成为主持人',content:'请先报名。主持人负责引导讨论和控制节奏，由活动发起人确认。',confirmText:'提交申请'});if(r.confirm)await this.perform('requestHost',{id:this.id},()=>wx.showToast({title:'申请已提交'}));},
 async checkIn(){if(!await u.requireMember(this.id))return;const r=await u.promiseWx('showModal',{title:'现场签到',editable:true,placeholderText:'向现场主持人获取六位签到口令',confirmText:'签到'});if(r.confirm)await this.perform('checkIn',{id:this.id,code:(r.content||'').trim()},()=>wx.showToast({title:'签到成功'}));},
 review(e){return this.perform('reviewHost',{id:this.id,userId:e.currentTarget.dataset.id,approved:e.currentTarget.dataset.approved===true||e.currentTarget.dataset.approved==='true'});},
 edit(){u.navigate('editor','?id='+this.id);},
 async updateGroup(){this.setData({working:true,error:''});try{const image=await u.upload('group');await u.api().call('updatePrivate',{id:this.id,groupAsset:image.assetId});wx.showToast({title:'群码已更新'});await this.load();}catch(e){u.error(this,e);}finally{this.setData({working:false});}},
 async subscribe(){try{const id=this.data.templateId;if(!id)throw Error('订阅消息尚未配置');const r=await u.promiseWx('requestSubscribeMessage',{tmplIds:[id]});if(r[id]!=='accept'){this.setData({error:'未授权微信提醒。站内消息仍会正常显示。'});return;}await u.api().call('authorizeNotification',{id:this.id,accepted:true});wx.showToast({title:'已开启一次提醒'});}catch(e){u.error(this,e);}},
 async cancelEvent(){const r=await u.promiseWx('showModal',{title:'取消这场活动',editable:true,placeholderText:'取消原因会通过站内消息告知书友',confirmText:'取消活动'});if(r.confirm)await this.perform('cancelEvent',{id:this.id,reason:(r.content||'').trim()});},
 share(){this.setData({shareOpen:true});},closeShare(){this.setData({shareOpen:false});},noop(){},
 copy(){const e=this.data.event;wx.setClipboardData({data:'【一起共读】'+e.title+'\n时间：'+e.fullLabel+'—'+e.endLabel+'\n地点：'+e.location+'\n地址：'+e.address+'\n人数：'+e.count+'/'+e.capacity+'\n'+e.description+'\n请在微信打开“一起共读”小程序查找本活动报名。'});},
 timeline(){this.closeShare();wx.showModal({title:'分享到朋友圈',content:'点击右上角“…”后选择“分享到朋友圈”。若当前微信不支持，可生成活动海报并保存后分享。',showCancel:false});},
 async poster(){
  if(!this.data.event||this.data.working)return;this.setData({working:true,error:''});try{let qr='';if(!u.api().demo){const r=await u.api().call('shareCode',{id:this.id});if(!r.url)throw Error('小程序码尚未配置，海报未生成');qr=(await u.promiseWx('downloadFile',{url:r.url})).tempFilePath;}const path=await require('../../poster').renderPoster(wx,this,this.data.event,qr,!!u.api().demo);this.setData({posterPath:path,posterOpen:true,shareOpen:false});}catch(e){u.error(this,e);}finally{this.setData({working:false});}
 },
 closePoster(){this.setData({posterOpen:false});},
 async sharePoster(){try{await u.promiseWx('showShareImageMenu',{path:this.data.posterPath});}catch(e){if(!/cancel/.test(e.errMsg||''))this.setData({error:'当前环境暂不能打开图片分享，可先保存海报再分享。'});}},
 async savePoster(){try{await u.promiseWx('saveImageToPhotosAlbum',{filePath:this.data.posterPath});wx.showToast({title:'海报已保存'});}catch(e){this.setData({error:'未保存，请检查微信相册权限后重试。'});}},
 onShareAppMessage(){return{title:this.data.event?this.data.event.title+' · 一起共读':'一起共读',path:'/v2/pages/detail/index?id='+this.id,imageUrl:this.data.event?.coverUrl||undefined};},
 onShareTimeline(){return{title:this.data.event?.title||'一起共读',query:'id='+this.id,imageUrl:this.data.event?.coverUrl||undefined};}
});
