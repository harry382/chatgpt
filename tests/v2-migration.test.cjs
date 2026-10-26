'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {migrateV1}=require('../scripts/migrate-v2.cjs'),{makeSeed}=require('../miniprogram/services/demo-data'),{TABLES:T,VERSION}=require('../cloudfunctions/readingClubV2/domain');
test('V2 migration preserves approved identities, admin, event IDs, counts; never manufactures privacy consent',()=>{
 const old=makeSeed(Date.now()),before=JSON.stringify(old),r=migrateV1(old);
 assert.equal(JSON.stringify(old),before);
 assert.equal(r.data[T.users].u_demo_admin.role,'admin');
 assert.notEqual(r.data[T.users].u_demo_admin.privacyVersion,VERSION);
 assert.equal(r.data[T.users].u_demo_new,undefined);
 assert.equal(r.data[T.events].e_demo_positive.count,3);
 assert.equal(Object.keys(r.data[T.registrations]).length,3);
 assert.equal(r.data[T.events].e_demo_positive.creatorId,'u_demo_host');
 assert.ok(r.warnings.some(w=>w.includes('地图')));
});
test('V2 migrated private events are not made public or open to newly registered members',async()=>{
 const r=migrateV1(makeSeed(Date.now())),{createService}=require('../cloudfunctions/readingClubV2/domain'),{MemoryStore}=require('../cloudfunctions/readingClub/memory-store');
 r.data[T.users].new_user={id:'new_user',nickname:'新会员',status:'active',role:'member',privacyVersion:VERSION};
 const service=createService(new MemoryStore(r.data));
 assert.equal((await service.call({id:'guest'},'listEvents')).events.length,0);
 await assert.rejects(service.call({id:'new_user'},'getEvent',{id:'e_demo_positive'}),{code:'NOT_FOUND'});
 await assert.rejects(service.call({id:'new_user'},'join',{id:'e_demo_positive'}),{code:'FORBIDDEN'});
});
