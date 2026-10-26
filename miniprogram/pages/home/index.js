'use strict';
const { CATEGORIES } = require('../../shared/domain');
const { profile, eventView, groupEvents, message, membershipPage } = require('../../services/view');
const { privacyPage, authorizePrivacyPage } = require('../../services/privacy');
const config = require('../../config');
Page({
  data: { categories: ['全部'].concat(CATEGORIES), category: '全部', date: '', groups: [], events: [], loading: false, error: '', member: false, organizer: false, hasMore: false, isDemo: false },
  onShow() { if (config.generation === 2) wx.switchTab({ url: '/v2/pages/home/index' }); else this.refresh(); },
  async refresh() {
    const ticket = this.request = (this.request || 0) + 1;
    this.setData({ loading: true, error: '', events: [], groups: [], hasMore: false, member: false, organizer: false, privacyRequired: false });
    try {
      const app = getApp(), user = await app.session();
      if (ticket !== this.request) return;
      this.setData({ ...profile(user), isDemo: app.globalData.isDemo });
      if (!profile(user).member) return;
      const result = await app.client.call('listEvents', { category: this.data.category, date: this.data.date, offset: 0 });
      if (ticket !== this.request) return;
      const events = result.items.map(eventView);
      this.setData({ events, groups: groupEvents(events), hasMore: result.hasMore });
    } catch (error) { if (ticket === this.request) this.setData({ error: message(error), privacyRequired: error.code === 'PRIVACY_REQUIRED' }); }
    finally { if (ticket === this.request) this.setData({ loading: false }); }
  },
  async loadMore() {
    if (this.data.loading || !this.data.hasMore) return;
    const ticket = this.request;
    this.setData({ loading: true, error: '' });
    try {
      const result = await getApp().client.call('listEvents', { category: this.data.category, date: this.data.date, offset: this.data.events.length });
      if (ticket !== this.request) return;
      const events = this.data.events.concat(result.items.map(eventView));
      this.setData({ events, groups: groupEvents(events), hasMore: result.hasMore });
    } catch (error) { if (ticket === this.request) this.setData({ error: message(error) }); }
    finally { if (ticket === this.request) this.setData({ loading: false }); }
  },
  setCategory(event) { this.setData({ category: event.currentTarget.dataset.category }); this.refresh(); },
  setDate(event) { this.setData({ date: event.detail.value }); this.refresh(); },
  clearDate() { this.setData({ date: '' }); this.refresh(); },
  openEvent(event) { wx.navigateTo({ url: '/pages/event-detail/index?id=' + event.detail.id }); },
  membership: membershipPage,
  privacy: privacyPage,
  authorizePrivacy: authorizePrivacyPage,
  createEvent() { wx.navigateTo({ url: '/pages/event-editor/index' }); },
  onPullDownRefresh() { this.refresh().finally(() => wx.stopPullDownRefresh()); },
  onReachBottom() { this.loadMore(); }
});
