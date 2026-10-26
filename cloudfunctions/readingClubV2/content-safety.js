'use strict';
const { ClubError } = require('./domain');

// Keep a small overlap so a phrase crossing a request boundary is checked together.
function chunks(text) {
  const characters = Array.from(text), result = [];
  for (let start = 0; start < characters.length; start += 2320) {
    result.push(characters.slice(start, start + 2400).join(''));
    if (start + 2400 >= characters.length) break;
  }
  return result;
}

function createContentChecker(cloud, options = {}) {
  const now = options.now || Date.now, timeoutMs = options.timeoutMs || 7000;
  return async (actor, fields, scene) => {
    const content = fields.filter(value => typeof value === 'string' && value.trim()).join('\n');
    if (!content) return null;
    if (!actor.openid || typeof cloud.openapi?.security?.msgSecCheck !== 'function') {
      throw new ClubError('CONTENT_CHECK_UNAVAILABLE', '内容审核暂时不可用，请稍后重试；本次内容尚未发布');
    }
    let responses;
    try {
      responses = await Promise.all(chunks(content).map(async part => {
        let timer;
        try {
          return await Promise.race([
            cloud.openapi.security.msgSecCheck({ content: part, version: 2, scene, openid: actor.openid }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('content check timeout')), timeoutMs); })
          ]);
        } finally { clearTimeout(timer); }
      }));
    } catch (error) {
      if (Number(error.errCode || error.errcode) === 87014) throw new ClubError('CONTENT_REJECTED', '内容未通过审核，请修改后再提交');
      throw new ClubError('CONTENT_CHECK_UNAVAILABLE', '内容审核暂时不可用，请稍后重试；本次内容尚未发布');
    }
    for (const response of responses) {
      const code = Number(response && (response.errCode ?? response.errcode ?? 0));
      if (code === 87014 || ['risky', 'review'].includes(response?.result?.suggest)) throw new ClubError('CONTENT_REJECTED', '内容未通过审核，请修改后再提交');
      if (code !== 0 || response?.result?.suggest !== 'pass' ||
          (response.detail !== undefined && !Array.isArray(response.detail)) ||
          (response.detail || []).some(item => item.suggest && item.suggest !== 'pass')) {
        throw new ClubError('CONTENT_CHECK_UNAVAILABLE', '内容审核结果未确认，请稍后重试；本次内容尚未发布');
      }
    }
    return { provider: 'wechat', version: 2, checkedAt: now(), traceIds: responses.map(item => item.traceId || item.trace_id || '').filter(Boolean) };
  };
}
module.exports = { createContentChecker, chunks };
