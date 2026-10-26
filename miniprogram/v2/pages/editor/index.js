'use strict';
const u = require('../../ui');
const { DEFAULT_AGENDA } = require('../../runtime');
const { DEFAULT_NOTICES } = require('../../shared/domain');
Page({
 data: {
  form: { title:'', book:'', category:'文学', location:'', address:'', description:'', remarks:'', agenda:DEFAULT_AGENDA, capacity:'8', startDate:'', startTime:'14:00', endDate:'', endTime:'16:00', deadlineDate:'', deadlineTime:'13:00', latitude:null, longitude:null, cover:'', checkinCode:'654321', recapText:'' },
  coverUrl:'', descriptionImages:[], recapImages:[], notices:DEFAULT_NOTICES.map((n,i)=>({...n,key:"notice_"+i})),
  categories:u.CATEGORIES, categoryIndex:3, error:'', working:false, ready:false, demo:false, locked:false, ended:false, contentOnly:false, cancelled:false, saved:false, uploadStatus:'', pendingUploadCount:0
 },
 async onLoad(q = {}) {
  this.id = q.id || ''; this.setData({ demo:!!u.api().demo, contentOnly:q.content === '1' });
  if (!await u.requireMember()) return;
  try {
   const d = u.dateParts(u.now() + 7 * 86400000).date;
   this.setData({ 'form.startDate':d, 'form.endDate':d, 'form.deadlineDate':d });
   if (this.id) {
    const r = await u.api().call('getEvent', { id:this.id });
    if (!r.canManage) throw Error('仅发起人或管理员可编辑');
    const e = u.eventView(r.event), m = await u.api().call('manageEvent', { id:this.id });
    const locked = !!(e.count || e.waitCount || e.startAt <= u.now() || e.status === 'cancelled');
    this.setData({ form:{ ...e, startDate:u.dateParts(e.startAt).date, startTime:u.dateParts(e.startAt).time, endDate:u.dateParts(e.endAt).date, endTime:u.dateParts(e.endAt).time, deadlineDate:u.dateParts(e.signupUntil).date, deadlineTime:u.dateParts(e.signupUntil).time, checkinCode:m.checkinCode || '654321', recapText:e.recapText || '' }, categoryIndex:u.CATEGORIES.indexOf(e.category), coverUrl:e.coverUrl || '', descriptionImages:e.descriptionImages || [], recapImages:e.recapImages || [], notices:(e.notices || DEFAULT_NOTICES).map((n,i)=>({...n,key:"notice_"+i})), locked, ended:e.ended, cancelled:e.status === 'cancelled', contentOnly:this.data.contentOnly || locked });
   }
   this.setData({ ready:true });
  } catch (e) { u.error(this, e); }
 },
 field:u.field,
 category(e) { const i = Number(e.detail.value); this.setData({ categoryIndex:i, 'form.category':u.CATEGORIES[i] }); },
 async image() {
  if (this.data.working) return;
  this.setData({ working:true, error:'' });
  try { const r = await u.upload('cover'); this.setData({ 'form.cover':r.assetId, coverUrl:r.url }); }
  catch (e) { if (!/cancel/.test(e.errMsg || '')) u.error(this, e); }
  finally { this.setData({ working:false }); }
 },
 async gallery(e) {
  if (this.data.working || !this.data.ready || this.data.cancelled) return;
  if (this.pendingGallery) { this.setData({error:'请先重试剩余图片，或选择暂不上传剩余图片'}); return; }
  const kind = e.currentTarget.dataset.kind;
  if (!['description', 'recap'].includes(kind) || kind === 'recap' && !this.data.ended) return;
  const key = kind + 'Images', max = kind === 'description' ? 9 : 12, room = max - this.data[key].length;
  if (room <= 0) return;
  this.setData({ working:true, error:'' });
  try {
   if (!this.publicationAccepted) {
    const choice = await u.promiseWx('showModal', { title:'图片会在活动页面公开展示', content:'请仅上传有权使用的图片。现场照片中如有人物可被识别，请先取得本人同意；不要上传群码、证件或私人聊天截图。', confirmText:'确认选择' });
    if (!choice.confirm) return;
    this.publicationAccepted = true;
   }
   const selected = await u.promiseWx('chooseMedia', { count:Math.min(room, 9), mediaType:['image'], sourceType:['album'] });
   if (!selected.tempFiles.length) return;
   this.pendingGallery = {kind,key,files:selected.tempFiles,index:0};
   this.setData({pendingUploadCount:selected.tempFiles.length});
   await this.processGallery();
  } catch (error) { if (!/cancel/.test(error.errMsg || '')) { u.error(this, error); wx.showToast({ title:'图片未添加，请查看页面提示', icon:'none' }); } }
  finally { this.setData({ working:false, uploadStatus:'' }); }
 },
 async processGallery() {
  const batch = this.pendingGallery;
  if (!batch) return;
  try {
   while (batch.index < batch.files.length) {
    const number=batch.index+1,total=batch.files.length;
    this.setData({uploadStatus:'正在处理图片 '+number+' / '+total+'（已完成'+batch.index+'张）'});
    const image=await u.upload(batch.kind,batch.files[batch.index].tempFilePath,{onRetry:()=>this.setData({uploadStatus:'第'+number+'张响应较慢，正在自动重试；已完成图片会保留'})});
    if(this.pendingGallery!==batch)return;
    if(!this.data[batch.key].some(x=>x.assetId===image.assetId))this.setData({[batch.key]:this.data[batch.key].concat(image)});
    batch.index++;
    this.setData({pendingUploadCount:total-batch.index});
   }
   this.pendingGallery=null;
   wx.showToast({title:'图片已添加，请保存活动',icon:'none'});
  } catch (error) {
   if(this.pendingGallery!==batch)return;
   this.setData({error:'第'+(batch.index+1)+'张未完成：'+(error.message||'图片处理失败')+'。已完成'+batch.index+'张已保留，剩余'+(batch.files.length-batch.index)+'张可重试。'});
   wx.showToast({title:'部分图片未完成，可重试剩余图片',icon:'none'});
  }
 },
 async retryGallery() {
  if(this.data.working||!this.pendingGallery)return;
  this.setData({working:true,error:''});
  try{await this.processGallery();}finally{this.setData({working:false,uploadStatus:''});}
 },
 discardPending() {
  if(this.data.working)return;
  this.pendingGallery=null;this.setData({pendingUploadCount:0,error:'',uploadStatus:''});
 },
 onUnload(){this.pendingGallery=null;},
 removeImage(e) { if (this.data.working) return; const { kind, index } = e.currentTarget.dataset, key = kind + 'Images'; this.setData({ [key]:this.data[key].filter((_, i) => i !== Number(index)) }); },
 moveImage(e) { if (this.data.working) return; const { kind, index, delta } = e.currentTarget.dataset, key = kind + 'Images', list = this.data[key].slice(), from = Number(index), to = from + Number(delta); if (to < 0 || to >= list.length) return; [list[from], list[to]] = [list[to], list[from]]; this.setData({ [key]:list }); },
 previewImage(e) { const { kind, index } = e.currentTarget.dataset, images = this.data[kind + 'Images'].map(x => x.url).filter(Boolean); if (images.length) wx.previewImage({ urls:images, current:this.data[kind + 'Images'][Number(index)].url }); },
 noticeField(e) { const { index, key } = e.currentTarget.dataset, notices = this.data.notices.map((n, i) => i === Number(index) ? { ...n, [key]:e.detail.value } : n); this.setData({ notices }); },
 addNotice() { if (this.data.notices.length < 12) this.setData({ notices:this.data.notices.concat({ key:'notice_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8), title:'', body:'' }) }); },
 removeNotice(e) { this.setData({ notices:this.data.notices.filter((_, i) => i !== Number(e.currentTarget.dataset.index)) }); },
 async location() { try { const r = await u.promiseWx('chooseLocation'); this.setData({ 'form.location':r.name, 'form.address':r.address, 'form.latitude':r.latitude, 'form.longitude':r.longitude }); } catch (e) { if (!/cancel/.test(e.errMsg || '')) this.setData({ error:'地图选点暂不可用，可先填写地点保存草稿。' }); } },
 async save(e) {
  if (this.data.working || !this.data.ready || this.data.cancelled) return;
  if (this.pendingGallery) { this.setData({error:'还有'+this.data.pendingUploadCount+'张图片未完成，请重试或选择暂不上传剩余图片，再保存活动'}); return; }
  this.setData({ working:true, error:'' });
  try {
   const f = this.data.form, media = { descriptionImages:this.data.descriptionImages.map(x => x.assetId), notices:this.data.notices, publicationAccepted:this.publicationAccepted === true };
   let r, title;
   if (this.id && (this.data.contentOnly || this.data.locked)) {
    const payload = { id:this.id, version:f.version, description:f.description, remarks:f.remarks, agenda:f.agenda, ...media };
    if (this.data.ended) Object.assign(payload, { recapImages:this.data.recapImages.map(x => x.assetId), recapText:f.recapText });
    r = await u.api().call('updateEventContent', payload); title = this.data.ended ? '活动回顾已保存' : '活动内容已更新';
   } else {
    const publish = e.currentTarget.dataset.publish === true || e.currentTarget.dataset.publish === 'true';
    const payload = { ...f, ...media, id:this.id || undefined, capacity:Number(f.capacity), startAt:u.parseDate(f.startDate, f.startTime), endAt:u.parseDate(f.endDate, f.endTime), signupUntil:u.parseDate(f.deadlineDate, f.deadlineTime), publish };
    r = await u.api().call('saveEvent', payload); title = publish ? '活动已发布' : '草稿已保存';
   }
   this.id = r.event.id; this.setData({ saved:true }); wx.showToast({ title }); wx.redirectTo({ url:'/v2/pages/detail/index?id=' + this.id });
  } catch (error) { u.error(this, error); }
  finally { this.setData({ working:false }); }
 }
});
