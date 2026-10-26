'use strict';
const crypto = require('node:crypto');
const { createService, ClubError } = require('./domain');
const { CloudStore } = require('./cloud-store');
const { createContentChecker } = require('./content-safety');

function createHandler(cloud, environment = process.env, logger = console) {
  const service = createService(new CloudStore(cloud.database()), {
    now: Date.now, makeId: () => 'e_' + crypto.randomBytes(12).toString('hex'),
    requirePrivacy: true, checkContent: createContentChecker(cloud)
  });
  return async (request = {}) => {
    try {
      const context = cloud.getWXContext();
      if (!context.OPENID || !context.APPID) throw new ClubError('UNAUTHENTICATED', '请从微信小程序进入');
      if (environment.WX_APP_ID && context.APPID !== environment.WX_APP_ID) throw new ClubError('UNAUTHENTICATED', '小程序身份不匹配');
      // Enable only during the final migration, after a fresh backup. Cached V1 clients must not keep writing to the old collections after cutover.
      if (environment.V1_WRITES_DISABLED === '1' && !['session', 'listEvents', 'getEvent', 'listMembers', 'listRegistrations', 'myEvents'].includes(request.action)) {
        throw new ClubError('UPDATE_REQUIRED', '新版已上线，请完全退出小程序后重新打开，再进行报名或其他操作');
      }
      const actor = {
        id: 'u_' + crypto.createHash('sha256').update(context.APPID + ':' + context.OPENID).digest('hex').slice(0, 40),
        openid: context.OPENID,
        isBootstrap: !!environment.BOOTSTRAP_OPENID && environment.BOOTSTRAP_OPENID === context.OPENID
      };
      const data = await service.call(actor, request.action, request.payload);
      return { ok: true, data };
    } catch (error) {
      if (error instanceof ClubError) {
        if (error.code.startsWith('CONTENT_')) logger.warn?.('readingClub content check', { code: error.code });
        return { ok: false, error: { code: error.code, message: error.message } };
      }
      logger.error('readingClub request failed', { code: error.code || error.errCode || 'INTERNAL' });
      return { ok: false, error: { code: 'INTERNAL', message: '服务暂时不可用，请稍后重试' } };
    }
  };
}
module.exports = { createHandler };
