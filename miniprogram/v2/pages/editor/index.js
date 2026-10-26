'use strict';const u=require('../../ui');const {DEFAULT_AGENDA}=require('../../runtime');
Page({
 data:{form:{title:'',book:'',category:'文学',location:'',address:'',description:'',remarks:'',agenda:DEFAULT_AGENDA,capacity:'8',startDate:'',startTime:'14:00',endDate:'',endTime:'16:00',deadlineDate:'',deadlineTime:'13:00',latitude:null,longitude:null,cover:'',checkinCode:'654321'},groupAsset:'',coverUrl:'',groupUrl:'',categories:u.CATEGORIES,categoryIndex:3,error:'',working:false,demo:false,locked:false,saved:false},
 async onLoad(q={}){
  this.id=q.id||'';this.setData({demo:!!u.api().demo});if(!await u.requireMember())return;
  const d=u.dateParts(u.now()+7*86400000).date;this.setData({'form.startDate':d,'form.endDate':d,'form.deadlineDate':d});
  if(this.id){try{const r=await u.api().call('getEvent',{id:this.id});if(!r.canManage)throw Error('仅发起人可编辑');const e=r.event,m=await u.api().call('manageEvent',{id:this.id});this.setData({form:{...e,startDate:u.dateParts(e.startAt).date,startTime:u.dateParts(e.startAt).time,endDate:u.dateParts(e.endAt).date,endTime:u.dateParts(e.endAt).time,deadlineDate:u.dateParts(e.signupUntil).date,deadlineTime:u.dateParts(e.signupUntil).time,checkinCode:m.checkinCode||'654321'},categoryIndex:u.CATEGORIES.indexOf(e.category),coverUrl:e.coverUrl||'',groupAsset:m.groupAsset,locked:!!(e.count||e.waitCount)});}catch(e){u.error(this,e);}}
 },field:u.field,category(e){const i=Number(e.detail.value);this.setData({categoryIndex:i,'form.category':u.CATEGORIES[i]});},
 async image(e){const kind=e.currentTarget.dataset.kind;this.setData({working:true,error:''});try{const r=await u.upload(kind);if(kind==='cover')this.setData({'form.cover':r.assetId,coverUrl:r.url});else this.setData({groupAsset:r.assetId,groupUrl:r.url});}catch(e){if(!/cancel/.test(e.errMsg||''))u.error(this,e);}finally{this.setData({working:false});}},
 async location(){try{const r=await u.promiseWx('chooseLocation');this.setData({'form.location':r.name,'form.address':r.address,'form.latitude':r.latitude,'form.longitude':r.longitude});}catch(e){if(!/cancel/.test(e.errMsg||''))this.setData({error:'地图选点暂不可用，可先填写地点保存草稿。'});}},
 async save(e){
  if(this.data.working||this.data.locked)return;this.setData({working:true,error:''});try{const f=this.data.form;const p={...f,id:this.id||undefined,capacity:Number(f.capacity),startAt:u.parseDate(f.startDate,f.startTime),endAt:u.parseDate(f.endDate,f.endTime),signupUntil:u.parseDate(f.deadlineDate,f.deadlineTime),publish:e.currentTarget.dataset.publish===true||e.currentTarget.dataset.publish==='true',groupAsset:this.data.groupAsset};
   const r=await u.api().call('saveEvent',p);this.id=r.event.id;this.setData({saved:true});wx.showToast({title:p.publish?'活动已发布':'草稿已保存'});wx.redirectTo({url:'/v2/pages/detail/index?id='+this.id});
  }catch(e){u.error(this,e);}finally{this.setData({working:false});}
 }
});
