'use strict';
const crypto = require('node:crypto');
const { ClubError, TABLES: T, VERSION } = require('./domain');

function createMediaProcessor(cloud, store, logger = console, options = {}) {
  const now = options.now || Date.now;
  const budgetMs = options.budgetMs || 12000, checkMs = options.checkMs || 8500;
  return async (actor, p) => {
    const started = now(), deadline = started + budgetMs;
    async function step(stage, task, limit = budgetMs) {
      const remaining = Math.min(limit, deadline - now());
      if (remaining <= 0) throw new ClubError('IMAGE_UPLOAD_TIMEOUT', '图片处理超时，请重试这张图片');
      let timer;
      try {
        return await Promise.race([
          Promise.resolve().then(task),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new ClubError(stage === 'check' ? 'IMAGE_CHECK_TIMEOUT' : 'IMAGE_UPLOAD_TIMEOUT', stage === 'check' ? '图片审核响应较慢，请重试这张图片' : '图片上传响应较慢，请重试这张图片')), remaining); })
        ]);
      } catch (error) {
        // No image bytes, file URLs, identities or upstream messages in operational logs.
        logger.warn?.('image stage failed', { stage, elapsedMs: now() - started, code: error.code || error.errCode || 'UNAVAILABLE' });
        if (!(error instanceof ClubError) && stage !== 'check') throw new ClubError('IMAGE_UPLOAD_FAILED', '图片处理暂未完成，请重试这张图片');
        throw error;
      } finally { clearTimeout(timer); }
    }
    const user = await step('member', () => store.get(T.users, actor.id));
    if (!user || user.status !== 'active' || user.privacyVersion !== VERSION) throw new ClubError('MEMBER_REQUIRED', '请先注册并同意隐私指引');
    if (!['cover', 'avatar', 'group', 'description', 'recap'].includes(p.kind) || !['image/jpeg', 'image/png'].includes(p.type) || typeof p.base64 !== 'string' || p.base64.length > 1040000) throw new ClubError('MEDIA_INVALID', '请上传小于750KB的JPG或PNG图片');
    const buffer = Buffer.from(p.base64, 'base64'), png = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), jpeg = buffer[0] === 255 && buffer[1] === 216;
    if (buffer.length > 768000 || !(png && p.type === 'image/png' || jpeg && p.type === 'image/jpeg')) throw new ClubError('MEDIA_INVALID', '图片格式无效');
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    // Stable per owner, kind and exact bytes: a lost response can safely retry.
    const id = 'asset_' + crypto.createHash('sha256').update(actor.id + ':' + p.kind + ':' + checksum).digest('hex');
    const existing = await step('lookup', () => store.get(T.assets, id));
    if (existing?.status === 'approved' && existing.ownerId === actor.id && existing.kind === p.kind && existing.checksum === checksum && existing.fileID) return { assetId: id };
    let moderation;
    try { moderation = await step('check', () => cloud.openapi.security.imgSecCheck({ media: { contentType: p.type, value: buffer } }), checkMs); }
    catch (error) {
      if (error instanceof ClubError) throw error;
      if (Number(error.errCode ?? error.errcode) === 87014) throw new ClubError('CONTENT_REJECTED', '图片未通过内容审核，请更换');
      throw new ClubError('CONTENT_UNAVAILABLE', '图片审核暂时不可用，请稍后重试');
    }
    const verdict = Number(moderation?.errCode ?? moderation?.errcode);
    if (verdict === 87014) throw new ClubError('CONTENT_REJECTED', '图片未通过内容审核，请更换');
    if (verdict !== 0) throw new ClubError('CONTENT_UNAVAILABLE', '图片审核结果未确认，请重试');
    // The audit verdict must arrive before storage. A late verdict never publishes.
    const result = await step('storage', () => cloud.uploadFile({ cloudPath: 'v2/' + actor.id + '/' + id + (png ? '.png' : '.jpg'), fileContent: buffer }));
    if (!result.fileID) throw new ClubError('IMAGE_UPLOAD_FAILED', '图片未存储成功，请重试');
    await step('record', () => store.put(T.assets, id, { id, ownerId: actor.id, kind: p.kind, status: 'approved', fileID: result.fileID, checksum, createdAt: now() }));
    logger.info?.('image ready', { kind: p.kind, bytes: buffer.length, elapsedMs: now() - started });
    return { assetId: id };
  };
}
module.exports = { createMediaProcessor };
