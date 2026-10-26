'use strict';
const { eventView, message } = require('../../services/view');
Page({
  data: { kind: 'joined', events: [], loading: false, hasMore: false, error: '' },
  onLoad(options) { this.setData({ kind: options.kind === 'created' ? 'created' : 'joined' }); },
  onShow() { this.load(false); },
  async load(append = false) {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      await getApp().session();
      const result = await getApp().client.call('myEvents', { kind: this.data.kind, offset: append ? this.offset : 0 });
      this.offset = (append ? this.offset : 0) + result.items.length;
      this.setData({ events: (append ? this.data.events : []).concat(result.items.map(eventView)), hasMore: result.hasMore });
    } catch (error) { this.setData({ error: message(error), events: [], hasMore: false }); }
    finally { this.setData({ loading: false }); }
  },
  retry() { this.load(false); },
  more() { this.load(true); },
  open(event) { wx.navigateTo({ url: (event.detail.status === 'draft' ? '/pages/event-editor/index?id=' : '/pages/event-detail/index?id=') + event.detail.id }); }
});
