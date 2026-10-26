'use strict';const u=require('../../ui');Page({
 data:{form:{nickname:'',bio:'',avatar:''},avatarUrl:'',error:'',working:false},
 async onLoad(){try{const user=await u.requireMember();if(user)this.setData({form:{nickname:user.nickname,bio:user.bio,avatar:user.avatar},avatarUrl:user.avatarUrl||''});}catch(e){u.error(this,e);}},field:u.field,
 async avatar(e){this.setData({error:'',working:true});try{const r=await u.upload('avatar',e.detail.avatarUrl);this.setData({'form.avatar':r.assetId,avatarUrl:r.url});}catch(e){u.error(this,e);}finally{this.setData({working:false});}},
 async save(){if(this.data.working)return;this.setData({working:true,error:''});try{await u.api().call('updateProfile',this.data.form);wx.showToast({title:'资料已保存'});wx.navigateBack();}catch(e){u.error(this,e);}finally{this.setData({working:false});}}
});
