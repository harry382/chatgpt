'use strict';
const u=require('../../ui');
Page({
 data:{demo:false,loading:true,error:'',categories:['全部',...u.CATEGORIES],category:'全部',groups:[],date:'',hasMore:false,user:null},
 onLoad(){this.setData({demo:!!u.api().demo});},onShow(){return this.refresh();},
 async refresh(){this.offset=0;this.rows=[];await this.load();},
 async load(){const ticket=this.ticket=(this.ticket||0)+1;this.setData({loading:true,error:''});try{const [r,user]=await Promise.all([u.api().call('listEvents',{category:this.data.category,date:this.data.date,offset:this.offset||0}),u.session()]);if(ticket!==this.ticket)return;this.rows=(this.rows||[]).concat(r.events);this.setData({groups:u.groupEvents(this.rows),hasMore:r.hasMore,user});}catch(e){if(ticket===this.ticket)u.error(this,e);}finally{if(ticket===this.ticket)this.setData({loading:false});wx.stopPullDownRefresh();}},
 onPullDownRefresh(){return this.refresh();},onReachBottom(){return this.more();},
 more(){if(!this.data.hasMore||this.data.loading)return;this.offset=(this.offset||0)+20;return this.load();},
 category(e){this.setData({category:e.currentTarget.dataset.value});return this.refresh();},
 date(e){this.setData({date:e.detail.value});return this.refresh();},clearDate(){this.setData({date:''});return this.refresh();},
 membership(){u.navigate('membership');},async create(){if(await u.requireMember())u.navigate('editor');},openEvent:u.openEvent,
 onShareAppMessage(){return{title:'一起共读 · 找到下一场想参加的读书会',path:'/v2/pages/home/index'};}
});
