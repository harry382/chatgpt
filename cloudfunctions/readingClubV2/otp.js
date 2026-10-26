'use strict';
const crypto = require('node:crypto');
const { TABLES: T, ClubError } = require('./domain');
function createOtp(store, env = {}, send, now = Date.now) {
  const secret = env.OTP_HMAC_SECRET || '';
  const key = value => crypto.createHmac('sha256', secret).update(value).digest('hex');
  const recordId = actor => 'actor_' + actor.id;
  const error = (code, message) => ({ error: { code, message } });
  function configured() { if (secret.length < 32 || typeof send !== 'function') throw new ClubError('SMS_NOT_CONFIGURED', '短信服务尚未接通，未发送验证码'); }
  async function request(actor, phone) {
    configured();
    const phoneKey = key(phone), timestamp = now(), day = Math.floor(timestamp / 86400000);
    const nonce = crypto.randomBytes(16).toString('hex'), code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const reserved = await store.transaction(async unit => {
      const actorLimitId = 'limit_' + actor.id, phoneLimitId = 'limit_phone_' + phoneKey;
      const a = await unit.get(T.otp, actorLimitId), b = await unit.get(T.otp, phoneLimitId);
      for (const row of [a, b]) {
        if (row && timestamp - row.lastAt < 60000) return error('OTP_COOLDOWN', '请等待60秒后再获取验证码');
        if (row && row.day === day && row.count >= 10) return error('OTP_LIMIT', '今日验证码次数已达上限，请明天再试');
      }
      for (const [id, previous] of [[actorLimitId, a], [phoneLimitId, b]]) await unit.put(T.otp, id, { id, day, count: previous?.day === day ? previous.count + 1 : 1, lastAt: timestamp });
      await unit.put(T.otp, recordId(actor), { id: recordId(actor), nonce, phoneKey, hash: key(actor.id + ':' + phoneKey + ':' + nonce + ':' + code), expiresAt: timestamp + 300000, attempts: 0, status: 'sending' });
      return { ok: true };
    });
    if (reserved.error) throw new ClubError(reserved.error.code, reserved.error.message);
    try {
      await send(phone, code);
      await store.transaction(async unit => {
        const row = await unit.get(T.otp, recordId(actor));
        if (row?.nonce === nonce && row.status === 'sending') { row.status = 'ready'; await unit.put(T.otp, row.id, row); }
      });
      return { sent: true, cooldown: 60, expiresIn: 300 };
    } catch (_) {
      await store.transaction(async unit => { const row = await unit.get(T.otp, recordId(actor)); if (row?.nonce === nonce) { row.status = 'failed'; await unit.put(T.otp, row.id, row); } });
      throw new ClubError('SMS_FAILED', '验证码未发送成功，请稍后重试');
    }
  }
  async function consume(unit, actor, phone, code) {
    configured();
    const row = await unit.get(T.otp, recordId(actor));
    if (!row || row.status !== 'ready' || row.expiresAt <= now() || row.attempts >= 5) return error('OTP_INVALID', '验证码无效或已过期，请重新获取');
    row.attempts += 1;
    const phoneKey = key(phone), actual = key(actor.id + ':' + phoneKey + ':' + row.nonce + ':' + code);
    const pass = phoneKey === row.phoneKey && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(row.hash));
    if (pass) { row.status = 'used'; row.usedAt = now(); }
    await unit.put(T.otp, row.id, row);
    return pass ? { phoneKey } : error('OTP_INVALID', '验证码不正确');
  }
  return { request, consume };
}
function tencentSender(env) {
  if (!env.SMS_SECRET_ID || !env.SMS_SECRET_KEY || !env.SMS_APP_ID || !env.SMS_SIGN_NAME || !env.SMS_TEMPLATE_ID) return undefined;
  return async (phone, code) => {
    const Tencent = require('tencentcloud-sdk-nodejs-sms');
    const client = new Tencent.sms.v20210111.Client({ credential: { secretId: env.SMS_SECRET_ID, secretKey: env.SMS_SECRET_KEY }, region: env.SMS_REGION || 'ap-guangzhou' });
    const result = await client.SendSms({ PhoneNumberSet: ['+86' + phone], SmsSdkAppId: env.SMS_APP_ID, SignName: env.SMS_SIGN_NAME, TemplateId: env.SMS_TEMPLATE_ID, TemplateParamSet: [code, '5'] });
    if (result.SendStatusSet?.[0]?.Code !== 'Ok') throw new Error('SMS_PROVIDER_REJECTED');
  };
}
module.exports = { createOtp, tencentSender };
