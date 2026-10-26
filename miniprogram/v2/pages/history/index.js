'use strict';
const u = require('../../ui');
Page({
 data: { demo: false, loading: true, error: '', events: [], slides: [], hasMore: false },
 onLoad() { this.setData({ demo: !!u.api().demo }); },
 onShow() { return this.refresh(); },
 async refresh() { this.offset = 0; this.rows = []; return this.load(); },
 async load() {
  const ticket = this.ticket = (this.ticket || 0) + 1, offset = this.offset || 0;
  this.setData({ loading: true, error: '' });
  try {
   const r = await u.api().call('listHistory', { offset });
   if (ticket !== this.ticket) return;
   const seen = new Set((this.rows || []).map(e => e.id));
   this.rows = (this.rows || []).concat(r.events.filter(e => !seen.has(e.id)));
   this.offset = offset + r.events.length;
   const events = this.rows.map(u.eventView);
   this.setData({ events, hasMore: r.hasMore, slides: events.slice(0, 5) });
  } catch (e) { if (ticket === this.ticket) u.error(this, e); }
  finally { if (ticket === this.ticket) this.setData({ loading: false }); wx.stopPullDownRefresh(); }
 },
 more() { if (!this.data.loading && this.data.hasMore) return this.load(); },
 onReachBottom() { return this.more(); },
 onPullDownRefresh() { return this.refresh(); },
 openEvent: u.openEvent,
 home: u.home,
 onShareAppMessage() { return { title: '一起共读 · 回看我们一起读过的时光', path: '/v2/pages/history/index' }; }
});
