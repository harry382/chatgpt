'use strict';
const { eventView, message, parts } = require('../../services/view');
Page({
  data: { event: null, readers: [], hasMore: false, reason: '', error: '', loading: false, working: false },
  onLoad(options) { this.id = options.id || ''; },
  onShow() { this.load(false); },
  async load(append = false) {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      await getApp().session();
      const result = await getApp().client.call('listRegistrations', { id: this.id, offset: append ? this.data.readers.length : 0 });
      const readers = result.items.map(item => ({ ...item, time: parts(item.joinedAt).date + ' ' + parts(item.joinedAt).time }));
      this.setData({ event: eventView(result.event), readers: (append ? this.data.readers : []).concat(readers), hasMore: result.hasMore });
    } catch (error) { this.setData({ error: message(error), event: null, readers: [], hasMore: false }); }
    finally { this.setData({ loading: false }); }
  },
  more() { this.load(true); },
  retry() { this.load(false); },
  reason(event) { this.setData({ reason: event.detail.value }); },
  async decide(event) {
    if (this.data.working || !this.data.event) return;
    const decision = event.currentTarget.dataset.decision;
    if (decision === 'cancel' && !this.data.reason.trim()) { this.setData({ error: '请先填写取消原因' }); return; }
    const answer = await wx.showModal({ title: decision === 'confirm' ? '确认举办这场活动？' : '取消这场活动？', content: decision === 'confirm' ? '成员将看到“已确认举办”，请同步在社群中告知。' : '活动将停止报名，取消原因会保留在成员的报名记录中。' });
    if (!answer.confirm) return;
    this.setData({ working: true, error: '' });
    try {
      const result = await getApp().client.call('decideEvent', { id: this.id, decision, reason: this.data.reason });
      this.setData({ event: eventView(result.event) }); wx.showToast({ title: decision === 'confirm' ? '已确认举办' : '活动已取消' });
    } catch (error) { this.setData({ error: message(error) }); }
    finally { this.setData({ working: false }); }
  }
});
