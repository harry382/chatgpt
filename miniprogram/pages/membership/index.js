'use strict';
const { profile, message } = require('../../services/view');
const { privacyPage, authorizePrivacyPage } = require('../../services/privacy');
Page({
  data: { user: null, member: false, nickname: '', groupName: '', working: false, loading: false, error: '', pendingEvent: '', isDemo: false },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true, error: '', privacyRequired: false, user: null, member: false });
    try {
      const app = getApp(), user = await app.session();
      this.setData({ ...profile(user), nickname: user.nickname, groupName: user.groupName, pendingEvent: app.pendingEvent(), isDemo: app.globalData.isDemo });
    } catch (error) { this.setData({ error: message(error), privacyRequired: error.code === 'PRIVACY_REQUIRED' }); }
    finally { this.setData({ loading: false }); }
  },
  input(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  privacy: privacyPage,
  authorizePrivacy: authorizePrivacyPage,
  async apply() {
    if (this.data.working) return;
    this.setData({ working: true, error: '' });
    try {
      await getApp().client.call('applyMembership', { nickname: this.data.nickname, groupName: this.data.groupName });
      await this.load(); wx.showToast({ title: '申请已提交', icon: 'success' });
    } catch (error) { this.setData({ error: message(error) }); }
    finally { this.setData({ working: false }); }
  },
  continue() {
    if (this.data.pendingEvent) wx.redirectTo({ url: '/pages/event-detail/index?id=' + this.data.pendingEvent });
    else wx.switchTab({ url: '/pages/home/index' });
  }
});
