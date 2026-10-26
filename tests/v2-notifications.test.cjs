'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {flushNotifications,notificationConfig,notificationData}=require('../cloudfunctions/readingClubV2/notifications'),{TABLES:T}=require('../cloudfunctions/readingClubV2/domain'),{MemoryStore}=require('../cloudfunctions/readingClub/memory-store');
function fixture(){return new MemoryStore({[T.notices]:{notice_1:{id:'notice_1',userId:'reader',eventId:'event',message:'你的候补已成功',createdAt:1,pushStatus:'queued'}},[T.events]:{event:{id:'event',title:'一起读书',startAt:Date.now()}},[T.subscriptions]:{event__reader:{id:'event__reader',openid:'private'}}});}
const env={SUBSCRIBE_TEMPLATE_ID:'approved-template',SUBSCRIBE_FIELD_MAP:'{"thing1":"title","thing2":"message"}'};
test('V2 outbox claims once under concurrent dispatch, and records explicit success only',async()=>{
 const store=fixture(),sends=[];const cloud={openapi:{subscribeMessage:{send:async body=>{sends.push(body);return{errCode:0};}}}};
 await Promise.all([flushNotifications(store,cloud,env),flushNotifications(store,cloud,env)]);
 assert.equal(sends.length,1);assert.equal((await store.get(T.notices,'notice_1')).pushStatus,'sent');
 assert.equal(sends[0].touser,'private');
});
test('V2 push errors retain station notice and do not retry uncertain delivery',async()=>{
 const store=fixture();let sends=0;const cloud={openapi:{subscribeMessage:{send:async()=>{sends++;throw Error('ambiguous upstream timeout');}}}};
 await flushNotifications(store,cloud,env,{warn(){}});await flushNotifications(store,cloud,env,{warn(){}});
 assert.equal(sends,1);assert.equal((await store.get(T.notices,'notice_1')).pushStatus,'unknown');assert.match((await store.get(T.notices,'notice_1')).message,/候补/);
});
test('V2 selected appointment template receives a date, venue and concise result',async()=>{
 const config={SUBSCRIBE_TEMPLATE_ID:'selected-template',SUBSCRIBE_FIELD_MAP:JSON.stringify({thing5:'title',date3:'time',thing2:'location',phrase9:'result'}),SUBSCRIBE_STATE:'developer'};
 assert.equal(notificationConfig(config).enabled,true);
 const store=fixture();await store.put(T.events,'event',{id:'event',title:'一起读书',startAt:Date.parse('2026-11-01T14:00:00+08:00'),location:'城市书房'});
 const notice=await store.get(T.notices,'notice_1');notice.result='候补成功';await store.put(T.notices,notice.id,notice);
 const sent=[];await flushNotifications(store,{openapi:{subscribeMessage:{send:async body=>{sent.push(body);return{errCode:0};}}}},config);
 assert.deepEqual(sent[0].data,{thing5:{value:'一起读书'},date3:{value:'2026年11月1日 14:00'},thing2:{value:'城市书房'},phrase9:{value:'候补成功'}});
 assert.equal(sent[0].miniprogramState,'developer');assert.equal((await store.get(T.notices,notice.id)).pushStatus,'sent');
});
test('V2 template config refuses mismatched field types and invalid target environments',()=>{
 for(const map of [{date3:'title'},{phrase9:'message'},{unknown1:'title'},['title']])assert.equal(notificationConfig({...env,SUBSCRIBE_FIELD_MAP:JSON.stringify(map)}).enabled,false);
 assert.equal(notificationConfig({...env,SUBSCRIBE_STATE:'release'}).enabled,false);
 assert.throws(()=>notificationData({phrase9:'result'},{startAt:Date.now()},{result:'成功:'}),/INVALID_TEMPLATE_VALUE/);
});

test('V3 queued trial reminders stay on trial even when global settings and later subscriptions use formal',async()=>{
 const store=fixture(),row=await store.get(T.notices,'notice_1');row.pushState='trial';await store.put(T.notices,row.id,row);
 const sent=[];const cloud={openapi:{subscribeMessage:{send:async r=>{sent.push(r);return{errCode:0};}}}};
 await flushNotifications(store,cloud,{...env,SUBSCRIBE_STATE:'formal'});assert.equal(sent[0].miniprogramState,'trial');
 const old=fixture();await flushNotifications(old,cloud,{...env,SUBSCRIBE_STATE:'formal'});assert.equal(sent[1].miniprogramState,'formal');
});
