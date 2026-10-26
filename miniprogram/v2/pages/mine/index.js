'use strict';const u=require('../../ui');
Page({
 data:{user:null,events:[],tab:'upcoming',loading:false,error:'',demo:false,personas:[],personaIndex:0,notices:[],hasMore:false},
 onShow(){return this.load(true);},
 async load(reset){if(reset){this.offset=0;this.rows=[];}this.setData({loading:true,error:''});try{
  const client=u.api(),user=await u.session();this.setData({user,demo:!!client.demo,personas:client.demo?.personas||[],personaIndex:client.demo?Math.max(0,client.demo.personas.findIndex(x=>x.id===client.demo.current())):0});
  if(user?.member&&user.privacyVersion===u.VERSION){const r=await client.call('myActivities',{tab:this.data.tab,offset:this.offset||0});this.rows=(this.rows||[]).concat(r.events);this.setData({events:this.rows.map(u.eventView),hasMore:r.hasMore,notices:(await client.call('notices')).notices});}else this.setData({events:[],notices:[],hasMore:false});
 }catch(e){u.error(this,e);}finally{this.setData({loading:false});}},
 tab(e){this.setData({tab:e.currentTarget.dataset.value});return this.load(true);},
 more(){this.offset=(this.offset||0)+20;return this.load(false);},
 register(){u.navigate(this.data.user?.member?'profile':'register');},intro(){u.navigate('membership');},edit(){u.navigate('profile');},privacy(){u.navigate('privacy');},openEvent:u.openEvent,
 async logout(){const r=await u.promiseWx('showModal',{title:'退出登录？',content:'退出后仍可浏览公开活动。会员资料和报名记录会保留，下次使用当前微信登录即可找回。',confirmText:'退出登录'});if(r.confirm)u.signOut();},
 switchDemo(e){u.api().demo.switch(this.data.personas[Number(e.detail.value)].id);return this.load(true);},
 demoRole(e){u.api().demo.switch(e.currentTarget.dataset.id);return this.load(true);},
 async resetDemo(){const r=await u.promiseWx('showModal',{title:'重置演示',content:'仅清除本地演示账号、活动和报名记录。'});if(r.confirm){u.api().demo.reset();return this.load(true);}},
 notice(e){u.navigate('detail','?id='+e.currentTarget.dataset.id);},home:u.home
});
