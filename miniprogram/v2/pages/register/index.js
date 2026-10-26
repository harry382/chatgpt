'use strict';const u=require('../../ui');
Page({
 data:{nickname:'',agreed:false,working:false,error:'',demo:false,existing:false,returning:false,platformReady:false,needsPlatformConsent:true,platformAccepted:false},
 async onLoad(){try{const user=await u.session({forLogin:true});this.setData({demo:!!u.api().demo,existing:!!user?.member,nickname:user?.nickname||'',returning:!!user?.member&&user.privacyVersion===u.VERSION&&wx.getStorageSync(u.CONSENT)===u.VERSION});if(typeof wx.getPrivacySetting==='function')wx.getPrivacySetting({success:r=>this.setData({platformReady:true,needsPlatformConsent:!!r.needAuthorization}),fail:()=>this.setData({error:'无法读取微信隐私设置，请稍后重试'})});else this.setData({error:'请更新微信后再注册'});}catch(e){u.error(this,e);}},
 field:u.field,
 check(e){this.setData({agreed:e.detail.value.includes('agree')});},privacy(){u.navigate('privacy');},
 agreeNative(){this.setData({platformAccepted:true});return this.register();},
 async register(){
  if(this.data.working)return;if(!this.data.returning&&!this.data.agreed||!this.data.platformReady||this.data.needsPlatformConsent&&!this.data.platformAccepted){this.setData({error:'请先阅读、同意并完成隐私授权'});return;}
  const nickname=this.data.nickname.trim();if(!this.data.existing&&(!nickname||nickname.length>24)){this.setData({error:'请填写1至24字的昵称'});return;}
  this.setData({working:true,error:''});try{
   const r=await u.api().call(this.data.returning?'session':this.data.existing?'acceptPrivacy':'register',{accepted:true,version:u.VERSION,nickname});if(!r.user?.member)throw Error('登录未完成，请稍后重试');if(r.user.privacyVersion!==u.VERSION)throw Error('隐私说明已更新，请重新打开本页确认');u.signIn(r.user);
   wx.showToast({title:this.data.returning?'登录成功':this.data.existing?'已更新隐私同意':'免费注册成功',icon:'success'});const id=getApp().pendingEvent();getApp().clearPendingEvent();
   if(id)wx.redirectTo({url:'/v2/pages/detail/index?id='+encodeURIComponent(id)});else wx.switchTab({url:'/v2/pages/mine/index'});
  }catch(e){u.error(this,e);}finally{this.setData({working:false});}
 }
});
