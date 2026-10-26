'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createService, TABLES: T, VERSION } = require('../cloudfunctions/readingClubV2/domain');
const { MemoryStore } = require('../cloudfunctions/readingClub/memory-store');
function fixture(options = {}) {
  let clock = Date.parse('2026-10-25T00:00:00Z'), seq = 0;
  const users = Object.fromEntries(['owner','amy','bob','cat','dan'].map(id => [id, { id, nickname: id, status: 'active', role: 'member', privacyVersion: VERSION }]));
  const store = new MemoryStore({ [T.users]: users });
  const service = createService(store, { now: () => clock, makeId: () => 'event_' + ++seq, checkContent: async () => {}, consumeOtp: async (unit, actor, phone, code) => code === '246810' ? { phoneKey: phone } : { error: { code: 'OTP_INVALID', message: '验证码不正确' } }, ...options });
  const call = (id, action, payload) => service.call({ id, openid: 'test_' + id }, action, payload);
  const draft = { title: '一起读一本书', category: '文学', location: '书店', description: '认真讨论', remarks: '带上书', agenda: '自我介绍\n问题讨论\n自由交流', startAt: clock + 86400000, endAt: clock + 93600000, signupUntil: clock + 85000000, capacity: 2, publish: true, checkinCode: '654321' };
  return { store, call, draft, setClock: value => { clock = value; } };
}
test('V2 public browsing exposes no phone or private QR; membership required for signup', async () => {
  const f = fixture(), e = (await f.call('owner','saveEvent',f.draft)).event;
  assert.equal((await f.call('guest','listEvents')).events.length,1);
  const detail = await f.call('guest','getEvent',{id:e.id});
  assert.equal(detail.event.checkinCode,undefined); assert.equal(detail.event.groupAsset,undefined);
  await assert.rejects(f.call('guest','join',{id:e.id}),{code:'MEMBER_REQUIRED'});
  await assert.rejects(f.call('guest','groupCode',{id:e.id}),{code:'MEMBER_REQUIRED'});
});
test('V2 capacity, FIFO promotion, duplicate requests and notification commit together', async () => {
  const f = fixture(), e = (await f.call('owner','saveEvent',f.draft)).event;
  const results = await Promise.allSettled(['amy','bob','cat','dan'].map(id=>f.call(id,'join',{id:e.id})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
  await f.call('cat','join',{id:e.id,waitlist:true}); await f.call('dan','join',{id:e.id,waitlist:true});
  await Promise.all([f.call('amy','cancelRegistration',{id:e.id}),f.call('amy','cancelRegistration',{id:e.id})]);
  const detail = await f.call('cat','getEvent',{id:e.id});
  assert.equal(detail.registration.status,'registered'); assert.equal(detail.event.count,2); assert.equal(detail.event.waitCount,1);
  assert.equal((await f.call('dan','getEvent',{id:e.id})).registration.status,'waitlist');
  assert.equal((await f.call('cat','notices')).notices.length,1);
  assert.equal((await f.call('cat','join',{id:e.id})).event.count,2);
});
test('V2 waitlist consent reserves its single push for promotion or cancellation, including old consent rows', async () => {
  for (const legacy of [false, true]) {
    const f = fixture({ notificationsEnabled: true }), e = (await f.call('owner','saveEvent',f.draft)).event;
    await f.call('amy','join',{id:e.id}); await f.call('bob','join',{id:e.id});
    await f.call('owner','join',{id:e.id,waitlist:true});
    await f.call('owner','authorizeNotification',{id:e.id,accepted:true});
    const id=e.id+'__owner', sub=await f.store.get(T.subscriptions,id);
    assert.equal(sub.purpose,'waitlist');
    if (legacy) { delete sub.purpose; await f.store.put(T.subscriptions,id,sub); }
    await f.call('amy','requestHost',{id:e.id});
    assert.equal((await f.store.get(T.subscriptions,id)).remaining,1);
    assert.equal((await f.call('owner','notices')).notices.find(n=>n.result==='收到申请').pushStatus,'not_requested');
    await f.call('owner','reviewHost',{id:e.id,userId:'amy',approved:true});
    await f.call('amy','cancelRegistration',{id:e.id});
    const notices=(await f.call('owner','notices')).notices;
    assert.equal(notices.find(n=>n.result==='候补成功').pushStatus,'queued');
    assert.equal((await f.store.get(T.subscriptions,id)).remaining,0);
    await f.call('owner','cancelEvent',{id:e.id,reason:'测试结束'});
    assert.equal((await f.call('owner','notices')).notices.find(n=>n.result==='活动取消').pushStatus,'not_subscribed');
  }
});
test('V2 free WeChat registration requires consent, is idempotent, and preserves trusted roles',async()=>{
  const f=fixture();
  await assert.rejects(f.call('guest','requestOtp',{}),{code:'AUTH_METHOD_CHANGED'});
  await assert.rejects(f.call('guest','register',{}),{code:'PRIVACY_REQUIRED'});
  const payload={version:VERSION,accepted:true,nickname:'新来的书友',role:'admin',id:'owner'};
  assert.equal((await f.call('guest','register',payload)).user.member,true);
  assert.equal((await f.call('guest','register',payload)).user.role,'member');
  assert.equal((await f.store.get(T.users,'guest')).authMethod,'wechat');
  assert.equal((await f.call('other','register',payload)).user.id,'other');
  assert.ok(!JSON.stringify(await f.store.get(T.users,'guest')).includes('phone'));
  const row=await f.store.get(T.users,'owner'); row.role='admin';await f.store.put(T.users,'owner',row);
  assert.equal((await f.call('owner','register',payload)).user.role,'admin');
  await f.store.put(T.users,'restricted',{id:'restricted',status:'blocked',role:'member'});
  await assert.rejects(f.call('restricted','register',payload),{code:'MEMBER_RESTRICTED'});
});
test('V2 first registration requires a moderated nickname and failed validation creates no account',async()=>{
 const seen=[],f=fixture({checkContent:async(actor,content,scene)=>{seen.push({content,scene});if(content==='受限昵称')throw Object.assign(Error('未通过审核'),{code:'CONTENT_REJECTED'});}});
 for(const nickname of ['', '   ', '长'.repeat(25)])await assert.rejects(f.call('guest','register',{accepted:true,version:VERSION,nickname}),{code:'VALIDATION'});
 assert.equal(await f.store.get(T.users,'guest'),null);
 await assert.rejects(f.call('guest','register',{accepted:true,version:VERSION,nickname:'受限昵称'}),{code:'CONTENT_REJECTED'});
 assert.equal(await f.store.get(T.users,'guest'),null);
 const r=await f.call('guest','register',{accepted:true,version:VERSION,nickname:'  林间书友  '});
 assert.equal(r.user.nickname,'林间书友');assert.equal(seen.at(-1).scene,'profile');
 assert.equal((await f.call('guest','register',{accepted:true,version:VERSION,nickname:'不应覆盖原昵称'})).user.nickname,'林间书友');
});
test('V2 host role is event scoped, creator approval only, checkin bounded and idempotent',async()=>{
  const f=fixture(),e=(await f.call('owner','saveEvent',f.draft)).event;
  await f.call('amy','join',{id:e.id});await f.call('amy','requestHost',{id:e.id});
  await assert.rejects(f.call('bob','reviewHost',{id:e.id,userId:'amy',approved:true}),{code:'FORBIDDEN'});
  await f.call('owner','reviewHost',{id:e.id,userId:'amy',approved:true});
  assert.equal((await f.call('amy','session')).user.role,'member');
  await assert.rejects(f.call('amy','checkIn',{id:e.id,code:'654321'}),{code:'CHECKIN_CLOSED'});
  f.setClock(e.startAt);
  await assert.rejects(f.call('amy','checkIn',{id:e.id,code:'000000'}),{code:'CODE_INVALID'});
  const first=await f.call('amy','checkIn',{id:e.id,code:'654321'});
  assert.equal((await f.call('amy','checkIn',{id:e.id,code:'654321'})).registration.checkedAt,first.registration.checkedAt);
});
test('V2 fails closed on moderation and prevents modifying events with members',async()=>{
  const f=fixture(),e=(await f.call('owner','saveEvent',f.draft)).event;
  await f.call('amy','join',{id:e.id});
  await assert.rejects(f.call('owner','saveEvent',{...f.draft,id:e.id}),{code:'HAS_REGISTRATIONS'});
  const service=createService(f.store);
  await assert.rejects(service.call({id:'owner'},'updateProfile',{nickname:'测试',bio:''}),{code:'CONTENT_UNAVAILABLE'});
});
test('V2 date filter queries beyond the first page and rejects impossible dates',async()=>{
  const f=fixture();let last;
  for(let i=0;i<25;i++)last=(await f.call('owner','saveEvent',{...f.draft,startAt:f.draft.startAt+i*86400000,endAt:f.draft.endAt+i*86400000,signupUntil:f.draft.signupUntil+i*86400000})).event;
  assert.equal((await f.call('guest','listEvents')).events.length,20);
  const r=await f.call('guest','listEvents',{date:last.dateKey});assert.equal(r.events.length,1);assert.equal(r.events[0].id,last.id);
  await assert.rejects(f.call('guest','listEvents',{date:'2026-02-30'}),{code:'VALIDATION'});
});
test('V2 group QR can be replaced after signup, remains private and owner-scoped',async()=>{
  const f=fixture(),e=(await f.call('owner','saveEvent',f.draft)).event;await f.call('amy','join',{id:e.id});
  await f.store.put(T.assets,'asset_group',{id:'asset_group',ownerId:'owner',kind:'group',status:'approved'});
  await f.call('owner','updatePrivate',{id:e.id,groupAsset:'asset_group'});
  assert.equal((await f.call('amy','groupCode',{id:e.id})).assetId,'asset_group');
  await assert.rejects(f.call('bob','groupCode',{id:e.id}),{code:'FORBIDDEN'});
  await assert.rejects(f.call('bob','updatePrivate',{id:e.id,groupAsset:'asset_group'}),{code:'FORBIDDEN'});
  assert.ok(!JSON.stringify(await f.call('guest','getEvent',{id:e.id})).includes('asset_group'));
});
test('V2 cancellation at cutoff does not silently promote someone after the deadline',async()=>{
  const f=fixture(),e=(await f.call('owner','saveEvent',f.draft)).event;
  await f.call('amy','join',{id:e.id});await f.call('bob','join',{id:e.id});await f.call('cat','join',{id:e.id,waitlist:true});f.setClock(e.signupUntil);
  await f.call('amy','cancelRegistration',{id:e.id});assert.equal((await f.call('cat','getEvent',{id:e.id})).registration.status,'waitlist');
  await assert.rejects(f.call('dan','join',{id:e.id}),{code:'CLOSED'});
});
test('V2 a storage failure rolls back both the event count and registration',async()=>{
  const f=fixture(),e=(await f.call('owner','saveEvent',f.draft)).event;f.store.onSave=()=>{throw Error('simulated persistence failure');};
  await assert.rejects(f.call('amy','join',{id:e.id}),/persistence failure/);assert.equal((await f.call('amy','getEvent',{id:e.id})).event.count,0);assert.equal((await f.call('amy','getEvent',{id:e.id})).registration,null);
});
