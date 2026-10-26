'use strict';
const config = require('./config');
const { createClient } = require('./services/client');
const { createV2Client } = require('./v2/runtime');
const { hasConsent, PRIVACY_VERSION } = require('./services/privacy');

App({
  globalData: { user: null, isDemo: false, startupError: '' },
  onLaunch(options) {
    try {
      const runtime = wx.getAccountInfoSync().miniProgram.envVersion;
      this.client = config.generation === 2 ? createV2Client(wx, config, runtime) : createClient(wx, config, runtime);
      this.globalData.isDemo = config.mode === 'demo';
    } catch (error) {
      this.globalData.startupError = error.message;
      this.client = { call: async () => { throw error; } };
    }
    if (options.query && options.query.id) this.rememberEvent(options.query.id);
  },
  onPageNotFound(options = {}) {
    if (options.query && options.query.id) this.rememberEvent(options.query.id);
    wx.switchTab({ url: config.generation === 2 ? '/v2/pages/home/index' : '/pages/home/index' });
  },
  async session() {
    if (!hasConsent(wx)) {
      this.globalData.user = null;
      const error = new Error('请先阅读并同意隐私保护指引，再使用会员和报名服务');
      error.code = 'PRIVACY_REQUIRED'; throw error;
    }
    let result = await this.client.call('session');
    if (result.user.privacyVersion !== PRIVACY_VERSION) result = await this.client.call('acceptPrivacy', { version: PRIVACY_VERSION, accepted: true });
    this.globalData.user = result.user;
    return result.user;
  },
  rememberEvent(id) {
    if (typeof id === 'string' && /^[A-Za-z0-9_-]{3,80}$/.test(id)) wx.setStorageSync('club_pending_event', id);
  },
  pendingEvent() { return wx.getStorageSync('club_pending_event') || ''; },
  clearPendingEvent() { wx.removeStorageSync('club_pending_event'); }
});
