'use strict';
const { profile, message, membershipPage } = require('../../services/view');
const { privacyPage, authorizePrivacyPage } = require('../../services/privacy');
Page({
  data: { user: null, member: false, organizer: false, admin: false, isDemo: false, error: '' },
  onShow() { this.load(); },
  async load() {
    this.setData({ error: '', user: null, member: false, organizer: false, admin: false });
    try { const app = getApp(), user = await app.session(); this.setData({ ...profile(user), isDemo: app.globalData.isDemo }); }
    catch (error) { this.setData({ error: message(error), privacyRequired: error.code === 'PRIVACY_REQUIRED' }); }
  },
  membership: membershipPage,
  privacy: privacyPage,
  authorizePrivacy: authorizePrivacyPage,
  records(event) { wx.navigateTo({ url: '/pages/records/index?kind=' + event.currentTarget.dataset.kind }); },
  create() { wx.navigateTo({ url: '/pages/event-editor/index' }); },
  admin() { wx.navigateTo({ url: '/pages/admin/index' }); },
  demo() { if (getApp().globalData.isDemo) wx.navigateTo({ url: '/pages/demo/index' }); }
});
