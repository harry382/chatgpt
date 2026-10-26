'use strict';
const { profile, eventView, message, membershipPage } = require('../../services/view');
const config = require('../../config');
Page({
  data: { event: null, member: false, loading: false, working: false, error: '', isDemo: false },
  onLoad(options) { this.id = options.id || ''; getApp().rememberEvent(this.id); if (config.generation === 2) { this.redirected = true; wx.redirectTo({ url: '/v2/pages/detail/index?id=' + encodeURIComponent(this.id) }); } },
  onShow() { if (!this.redirected) this.load(); },
  async load() {
    this.setData({ loading: true, error: '', event: null });
    try {
      const app = getApp(), user = await app.session();
      this.setData({ ...profile(user), isDemo: app.globalData.isDemo });
      if (!profile(user).member) return;
      const result = await app.client.call('getEvent', { id: this.id });
      this.setData({ event: eventView(result.event) });
      app.clearPendingEvent();
    } catch (error) { this.setData({ error: message(error) }); }
    finally { this.setData({ loading: false }); }
  },
  async register() {
    if (this.data.working || !this.data.event || this.data.event.actionDisabled) return;
    const action = this.data.event.joined ? 'cancelRegistration' : 'joinEvent';
    if (action === 'cancelRegistration') {
      const result = await wx.showModal({ title: '取消这场报名？', content: '取消后将释放你的读者名额。', confirmText: '取消报名', cancelText: '保留报名' });
      if (!result.confirm) return;
    }
    this.setData({ working: true, error: '' });
    try {
      const result = await getApp().client.call(action, { id: this.id });
      this.setData({ event: eventView(result.event) });
      wx.showToast({ title: action === 'joinEvent' ? '报名成功' : '已取消报名', icon: 'success' });
    } catch (error) { this.setData({ error: message(error) }); await this.refreshAfterError(); }
    finally { this.setData({ working: false }); }
  },
  async refreshAfterError() {
    try { const result = await getApp().client.call('getEvent', { id: this.id }); this.setData({ event: eventView(result.event) }); }
    catch (error) { if (error.code === 'MEMBERSHIP_REQUIRED') this.setData({ event: null, member: false }); }
  },
  membership: membershipPage,
  manage() { wx.navigateTo({ url: '/pages/event-manage/index?id=' + this.id }); },
  edit() { wx.navigateTo({ url: '/pages/event-editor/index?id=' + this.id }); },
  home() { wx.switchTab({ url: '/pages/home/index' }); },
  onShareAppMessage() { return { title: '邀请你查看社群读书活动', path: '/pages/event-detail/index?id=' + this.id }; }
});
