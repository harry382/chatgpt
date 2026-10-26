'use strict';
const crypto = require('node:crypto');
const { createService, ClubError, TABLES: T, VERSION } = require('./domain');
const { CloudStore } = require('./cloud-store');
const { createContentChecker } = require('./content-safety');
const { flushNotifications, notificationConfig } = require('./notifications');
function createHandler(cloud, env = process.env, logger = console) {
  const store = new CloudStore(cloud.database());
  const notify = notificationConfig(env);
  const service = createService(store, { notificationsEnabled: notify.enabled, notificationState: notify.state, capabilities: { authentication: 'wechat', sms: false, subscriptionTemplateId: notify.enabled ? env.SUBSCRIBE_TEMPLATE_ID : '' }, makeId: () => 'e_' + crypto.randomBytes(12).toString('hex'), checkContent: (actor, content, scene) => createContentChecker(cloud)(actor, [content], scene === "profile" ? 1 : 3) });
  async function media(actor, p) {
    const user = await store.get(T.users, actor.id);
    if (!user || user.status !== 'active' || user.privacyVersion !== VERSION) throw new ClubError('MEMBER_REQUIRED', '请先注册并同意隐私指引');
    if (!['cover', 'avatar', 'group', 'description', 'recap'].includes(p.kind) || !['image/jpeg', 'image/png'].includes(p.type) || typeof p.base64 !== 'string' || p.base64.length > 1040000) throw new ClubError('MEDIA_INVALID', '请上传小于750KB的JPG或PNG图片');
    const buffer = Buffer.from(p.base64, 'base64'), png = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), jpeg = buffer[0] === 255 && buffer[1] === 216;
    if (buffer.length > 768000 || !(png && p.type === 'image/png' || jpeg && p.type === 'image/jpeg')) throw new ClubError('MEDIA_INVALID', '图片格式无效');
    // No client upload permission is needed; only this trusted function writes private storage.
    let moderation;
    try { moderation = await cloud.openapi.security.imgSecCheck({ media: { contentType: p.type, value: buffer } }); }
    catch (_) { throw new ClubError('CONTENT_UNAVAILABLE', '图片审核暂时不可用，请稍后重试'); }
    if (Number(moderation.errCode ?? moderation.errcode) !== 0) throw new ClubError('CONTENT_REJECTED', '图片未通过内容审核，请更换');
    const id = 'asset_' + crypto.randomBytes(16).toString('hex');
    const result = await cloud.uploadFile({ cloudPath: 'v2/' + actor.id + '/' + id + (png ? '.png' : '.jpg'), fileContent: buffer });
    await store.put(T.assets, id, { id, ownerId: actor.id, kind: p.kind, status: 'approved', fileID: result.fileID, createdAt: Date.now() });
    return { assetId: id };
  }
  async function url(assetId) {
    if (!assetId) return '';
    const a = await store.get(T.assets, assetId); if (!a || a.status !== 'approved') return '';
    const response = await cloud.getTempFileURL({ fileList: [{ fileID: a.fileID, maxAge: 600 }] });
    const file = response.fileList?.[0];
    return file?.status === 0 ? file.tempFileURL : '';
  }
  async function hydrate(value, cache = new Map()) {
    if (!value || typeof value !== 'object') return;
    const signed = id => { if (!cache.has(id)) cache.set(id, url(id)); return cache.get(id); };
    if (value.cover) value.coverUrl = await signed(value.cover);
    if (value.hero) value.heroUrl = await signed(value.hero);
    if (value.avatar) value.avatarUrl = await signed(value.avatar);
    if (value.assetId) value.url = await signed(value.assetId);
    for (const [k, child] of Object.entries(value)) if (child && typeof child === 'object') {
      if (Array.isArray(child)) await Promise.all(child.map(item => hydrate(item, cache))); else await hydrate(child, cache);
    }
  }
  return async request => {
    try {
      const context = cloud.getWXContext();
      if (!context.OPENID || !context.APPID || !env.WX_APP_ID || context.APPID !== env.WX_APP_ID) throw new ClubError('UNAUTHENTICATED', '请从已配置的小程序进入');
      const actor = { id: 'u_' + crypto.createHash('sha256').update(context.APPID + ':' + context.OPENID).digest('hex').slice(0, 40), openid: context.OPENID };
      let data;
      if (request.action === 'uploadImage') data = await media(actor, request.payload || {});
      else if (request.action === 'shareCode') {
        const detail = await service.call(actor, 'getEvent', { id: request.payload?.id });
        if (detail.event.status !== 'published' || !['trial', 'release'].includes(env.SHARE_CODE_ENV || '')) throw new ClubError('NOT_CONFIGURED', '活动海报小程序码尚未配置');
        const requested = request.payload?.targetVersion;
        if (requested !== undefined && !['trial', 'release'].includes(requested)) throw new ClubError('VALIDATION', '活动码目标版本无效');
        // Older clients omit the target and keep the configured production behavior.
        const targetVersion = requested || env.SHARE_CODE_ENV;
        let code;
        // Trial-only pages are not yet present in the published package checked by WeChat.
        // The route is fixed here; clients cannot supply an arbitrary page.
        try { code = await cloud.openapi.wxacode.getUnlimited({ scene: detail.event.id, page: 'v2/pages/detail/index', checkPath: targetVersion === 'release', envVersion: targetVersion, width: 280 }); }
        catch (error) {
          const numeric = String(error.errCode ?? error.errcode ?? error.code ?? '');
          const suffix = /^-?\d{1,9}$/.test(numeric) ? '（微信错误码' + numeric + '）' : '';
          throw new ClubError('CODE_UNAVAILABLE', '活动码暂时无法生成' + suffix + '，请稍后重试');
        }
        if (!code.buffer || !Buffer.isBuffer(code.buffer)) throw new ClubError('CODE_UNAVAILABLE', '小程序码生成失败，请稍后重试');
        const uploaded = await cloud.uploadFile({ cloudPath: 'v2/share/' + targetVersion + '/' + detail.event.id + '.png', fileContent: code.buffer });
        const response = await cloud.getTempFileURL({ fileList: [{ fileID: uploaded.fileID, maxAge: 600 }] });
        data = { url: response.fileList?.[0]?.tempFileURL || '' };
      } else data = await service.call(actor, request.action, request.payload || {});
      if (['cancelRegistration', 'cancelEvent', 'reviewHost', 'requestHost'].includes(request.action)) {
        // Application state has already committed. A push failure must never undo a seat promotion.
        try { await flushNotifications(store, cloud, env, logger); } catch (_) { logger.warn?.('v2 outbox retained'); }
      }
      await hydrate(data); return { ok: true, data };
    } catch (error) {
      if (error instanceof ClubError || error.code?.startsWith('CONTENT_')) return { ok: false, error: { code: error.code, message: error.message } };
      logger.error('readingClubV2 failed', { code: error.code || error.errCode || 'INTERNAL' });
      return { ok: false, error: { code: 'INTERNAL', message: '服务暂时不可用，请稍后重试' } };
    }
  };
}
module.exports = { createHandler };
