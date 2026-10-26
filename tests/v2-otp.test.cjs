'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createOtp}=require('../cloudfunctions/readingClubV2/otp');
const {TABLES:T}=require('../cloudfunctions/readingClubV2/domain');
const {MemoryStore}=require('../cloudfunctions/readingClub/memory-store');
test('SMS OTP: hashed storage, failed attempts persist, one-time consume and rate limits',async()=>{
  let code='', clock=1000000;const store=new MemoryStore(), actor={id:'reader'};
  const otp=createOtp(store,{OTP_HMAC_SECRET:'a'.repeat(40)},async(phone,value)=>{code=value;},()=>clock);
  const consume=async value=>{const result=await store.transaction(unit=>otp.consume(unit,actor,'13800138000',value));if(result.error)throw Object.assign(Error(result.error.message),{code:result.error.code});return result;};
  const p={phone:'13800138000'};
  await otp.request(actor,p.phone);
  assert.ok(!JSON.stringify(store.snapshot()).includes(code)); assert.ok(!JSON.stringify(store.snapshot()).includes(p.phone));
  await assert.rejects(otp.request(actor,p.phone),{code:'OTP_COOLDOWN'});
  for(let i=0;i<5;i++) await assert.rejects(consume(code==='000000'?'111111':'000000'),{code:'OTP_INVALID'});
  assert.equal((await store.get(T.otp,'actor_reader')).attempts,5);
  await assert.rejects(consume(code),{code:'OTP_INVALID'});
  clock+=61000; await otp.request(actor,p.phone);
  assert.ok((await consume(code)).phoneKey);
  await assert.rejects(consume(code),{code:'OTP_INVALID'});
});
test('SMS provider failures and missing config never report delivery',async()=>{
  const store=new MemoryStore();
  const otp=createOtp(store,{OTP_HMAC_SECRET:'x'.repeat(40)},async()=>{throw Error('provider failed');});
  await assert.rejects(otp.request({id:'reader'},'13800138000'),{code:'SMS_FAILED'});
  assert.equal((await store.get(T.otp,'actor_reader')).status,'failed');
  await assert.rejects(createOtp(store).request({id:'other'},'13800138001'),{code:'SMS_NOT_CONFIGURED'});
});
