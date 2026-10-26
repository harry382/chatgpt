'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createService, TABLES:T, VERSION, DEFAULT_NOTICES } = require('../cloudfunctions/readingClubV2/domain');
const { MemoryStore } = require('../cloudfunctions/readingClub/memory-store');
function fixture(options = {}) {
 let clock = Date.parse('2026-10-24T00:00:00Z'), sequence = 0;
 const users = Object.fromEntries(['owner','member','other','admin'].map(id => [id, { id, nickname:id, status:'active', role:id === 'admin' ? 'admin' : 'member', privacyVersion:VERSION }]));
 const store = new MemoryStore({ [T.users]:users });
 const service = createService(store, { now:() => clock, makeId:() => 'event_' + ++sequence, checkContent:async () => {}, ...options });
 const call = (id, action, payload = {}) => service.call({ id }, action, payload);
 const draft = { title:'直面人生的困惑', book:'直面人生的困惑', category:'文学', location:'城市书房', description:'一起读书', agenda:'交流与讨论', startAt:clock + 86400000, endAt:clock + 97200000, signupUntil:clock + 85000000, capacity:8, publish:true };
 async function image(id, kind = 'description', ownerId = 'owner', status = 'approved') { await store.put(T.assets, id, { id, kind, ownerId, status }); return id; }
 return { store, call, draft, image, setClock:value => { clock = value; } };
}
test('V3 public history moves an event at the exact end time; excludes drafts, cancelled and legacy-private records', async () => {
 const f = fixture(), e = (await f.call('owner','saveEvent',f.draft)).event;
 const privateEvent = (await f.call('owner','saveEvent',f.draft)).event;
 await f.store.put(T.events, privateEvent.id, { ...await f.store.get(T.events,privateEvent.id), visibility:'legacy_members' });
 await f.call('owner','saveEvent',{ ...f.draft, publish:false });
 const cancelled = (await f.call('owner','saveEvent',f.draft)).event;
 await f.call('owner','cancelEvent',{ id:cancelled.id, reason:'取消测试' });
 await f.call('member','join',{ id:e.id });
 f.setClock(e.endAt - 1);
 assert.equal((await f.call('guest','listHistory')).events.length,0);
 assert.equal((await f.call('guest','listEvents')).events.length,1);
 f.setClock(e.endAt);
 const history = await f.call('guest','listHistory');
 assert.deepEqual(history.events.map(x => x.id),[e.id]);
 assert.equal(history.events[0].participants[0].nickname,'member');
 assert.equal(history.events[0].ended,true);
 assert.equal((await f.call('guest','listEvents')).events.length,0);
 assert.equal((await f.call('guest','listEvents',{ date:e.dateKey })).events.length,0);
 assert.equal((await f.call('guest','getEvent',{ id:e.id })).event.ended,true);
 await assert.rejects(f.call('member','join',{ id:e.id }),{ code:'CLOSED' });
});
test('V3 history has stable newest-first pagination across years and excludes future events', async () => {
 const f = fixture(); const ids = [];
 for (let i = 0; i < 25; i++) ids.push((await f.call('owner','saveEvent',{ ...f.draft, startAt:f.draft.startAt + i * 86400000, endAt:f.draft.endAt + i * 86400000, signupUntil:f.draft.signupUntil + i * 86400000 })).event.id);
 const future = (await f.call('owner','saveEvent',{ ...f.draft, startAt:Date.parse('2028-01-01T06:00:00Z'), endAt:Date.parse('2028-01-01T09:00:00Z'), signupUntil:Date.parse('2028-01-01T05:00:00Z') })).event;
 f.setClock(Date.parse('2027-01-01T00:00:00Z'));
 const first = await f.call('guest','listHistory'), second = await f.call('guest','listHistory',{ offset:20 });
 assert.equal(first.events.length,20); assert.equal(first.hasMore,true); assert.equal(second.events.length,5); assert.equal(second.hasMore,false);
 assert.deepEqual(first.events.concat(second.events).map(e => e.id),ids.reverse());
 assert.deepEqual((await f.call('guest','listEvents')).events.map(e => e.id),[future.id]);
});
test('V3 organizers edit public content after signup without altering schedule, counts or private data', async () => {
 const f = fixture(), e = (await f.call('owner','saveEvent',f.draft)).event;
 await f.call('member','join',{ id:e.id }); await f.image('asset_description');
 const before = await f.store.get(T.events,e.id);
 await assert.rejects(f.call('member','updateEventContent',{ id:e.id, version:before.version, description:'越权修改' }),{ code:'FORBIDDEN' });
 await assert.rejects(f.call('owner','updateEventContent',{ id:e.id, version:e.version, description:'旧版本覆盖' }),{ code:'CONFLICT' });
 const updated = await f.call('owner','updateEventContent',{ id:e.id, version:before.version, description:'新介绍', descriptionImages:['asset_description'], publicationAccepted:true, notices:[{ title:'携带书籍', body:'请带上本场共读的书。' }], capacity:100, creatorId:'member', startAt:1, count:99, groupAsset:'secret' });
 assert.equal(updated.event.description,'新介绍'); assert.equal(updated.event.notices[0].title,'携带书籍');
 const saved = await f.store.get(T.events,e.id);
 for (const key of ['capacity','creatorId','startAt','endAt','count','signupUntil','visibility']) assert.equal(saved[key],before[key]);
 assert.equal(saved.groupAsset,undefined); assert.equal(saved.version,before.version + 1);
 assert.deepEqual(saved.descriptionImages,['asset_description']); assert.deepEqual(updated.event.descriptionImages,[{ assetId:'asset_description' }]);
});
test('V3 public media requires approval, ownership, the correct kind and explicit publication consent', async () => {
 const f = fixture(), e = (await f.call('owner','saveEvent',f.draft)).event;
 await f.image('asset_foreign','description','other'); await f.image('asset_pending','description','owner','pending'); await f.image('asset_group','group'); await f.image('asset_good');
 for (const id of ['asset_foreign','asset_pending','asset_group','missing_asset']) await assert.rejects(f.call('owner','updateEventContent',{ id:e.id, version:e.version, descriptionImages:[id], publicationAccepted:true }),{ code:'MEDIA_INVALID' });
 await assert.rejects(f.call('owner','updateEventContent',{ id:e.id, version:e.version, descriptionImages:['asset_good'] }),{ code:'PHOTO_CONSENT_REQUIRED' });
 for (const images of [['asset_good','asset_good'],Array.from({length:10},(_,i) => 'asset_' + i),[{assetId:'asset_good',status:'approved'}]]) await assert.rejects(f.call('owner','updateEventContent',{ id:e.id, version:e.version, descriptionImages:images, publicationAccepted:true }),{ code:'MEDIA_INVALID' });
 assert.deepEqual((await f.store.get(T.events,e.id)).descriptionImages,[]);
 assert.equal((await f.store.get(T.events,e.id)).version,e.version);
});
test('V3 recap is end-gated, first photo becomes the hero, and admins can retain owner media or remove photos', async () => {
 const f = fixture(), e = (await f.call('owner','saveEvent',f.draft)).event;
 await f.image('asset_recap1','recap'); await f.image('asset_recap2','recap');
 const payload = { id:e.id, version:e.version, recapImages:['asset_recap1','asset_recap2'], publicationAccepted:true, recapText:'大家分享了各自的收获。' };
 await assert.rejects(f.call('owner','updateEventContent',payload),{ code:'CLOSED' });
 f.setClock(e.endAt);
 const r = await f.call('owner','updateEventContent',payload);
 assert.equal(r.event.hero,'asset_recap1'); assert.equal(r.event.recapImages.length,2);
 const reordered = await f.call('admin','updateEventContent',{ id:e.id, version:r.event.version, recapImages:['asset_recap2','asset_recap1'] });
 assert.equal(reordered.event.hero,'asset_recap2');
 const cleared = await f.call('admin','updateEventContent',{ id:e.id, version:reordered.event.version, recapImages:[], recapText:'' });
 assert.equal(cleared.event.hero,''); assert.equal((await f.call('guest','listHistory')).events[0].photoCount,0);
});
test('V3 text moderation failure and concurrent content changes leave approved content intact', async () => {
 let reject = false, race = false, f;
 f = fixture({ checkContent:async () => {
  if (reject) throw Object.assign(Error('文字未通过审核'),{code:'CONTENT_REJECTED'});
  if (race) { const e = await f.store.get(T.events,'event_1'); await f.store.put(T.events,e.id,{ ...e, version:e.version + 1 }); }
 } });
 const e = (await f.call('owner','saveEvent',f.draft)).event;
 reject = true; await assert.rejects(f.call('owner','updateEventContent',{ id:e.id, version:e.version, notices:[{title:'新须知',body:'待审核内容'}] }),{code:'CONTENT_REJECTED'});
 assert.deepEqual((await f.store.get(T.events,e.id)).notices,DEFAULT_NOTICES);
 reject = false; race = true; await assert.rejects(f.call('owner','updateEventContent',{ id:e.id, version:e.version, description:'不应覆盖并发修改' }),{code:'CONFLICT'});
 assert.equal((await f.store.get(T.events,e.id)).description,f.draft.description);
});
test('V3 old events default to editable notices, and 1.1 save requests preserve new gallery data and private QR', async () => {
 const f = fixture(); await f.image('asset_description'); await f.image('asset_group','group');
 const e = (await f.call('owner','saveEvent',{ ...f.draft, groupAsset:'asset_group', descriptionImages:['asset_description'], publicationAccepted:true })).event;
 const oldRequest = await f.call('owner','saveEvent',{ ...f.draft, id:e.id, title:'来自1.1的修改' });
 assert.equal(oldRequest.event.descriptionImages[0].assetId,'asset_description');
 assert.equal((await f.call('owner','groupCode',{ id:e.id })).assetId,'asset_group');
 const stored = await f.store.get(T.events,e.id); delete stored.notices; await f.store.put(T.events,e.id,stored);
 assert.deepEqual((await f.call('guest','getEvent',{ id:e.id })).event.notices,DEFAULT_NOTICES);
 await assert.rejects(f.call('owner','updateEventContent',{id:e.id,version:stored.version,notices:[{title:'',body:'无标题'}]}),{code:'VALIDATION'});
 const r = await f.call('owner','updateEventContent',{ id:e.id, version:stored.version, notices:[] }); assert.deepEqual(r.event.notices,[]);
});
