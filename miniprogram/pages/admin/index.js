'use strict';
const { message } = require('../../services/view');
const ROLE_LABELS = { member: '普通会员', organizer: '组织者', admin: '管理员' };
Page({
  data: { status: 'pending', members: [], hasMore: false, loading: false, working: false, error: '' },
  onShow() { this.load(false); },
  async load(append = false) {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      await getApp().session();
      const result = await getApp().client.call('listMembers', { status: this.data.status, offset: append ? this.data.members.length : 0 });
      const members = result.items.map(user => ({ ...user, roleLabel: ROLE_LABELS[user.role] }));
      this.setData({ members: (append ? this.data.members : []).concat(members), hasMore: result.hasMore });
    } catch (error) { this.setData({ error: message(error), members: [], hasMore: false }); }
    finally { this.setData({ loading: false }); }
  },
  tab(event) { if (this.data.loading || this.data.working) return; this.setData({ status: event.currentTarget.dataset.status, members: [] }); this.load(false); },
  retry() { this.load(false); },
  more() { this.load(true); },
  async review(event) {
    if (this.data.working) return;
    const userId = event.currentTarget.dataset.id, decision = event.currentTarget.dataset.decision;
    let reason = '';
    if (decision === 'reject') {
      const response = await wx.showModal({ title: '未通过原因', editable: true, placeholderText: '说明如何核对或补充社群信息' });
      if (!response.confirm) return;
      reason = (response.content || '').trim();
      if (!reason) { this.setData({ error: '请填写未通过原因' }); return; }
    }
    this.setData({ working: true, error: '' });
    try { await getApp().client.call('reviewMembership', { userId, decision, reason }); await this.load(false); wx.showToast({ title: decision === 'approve' ? '审核已通过' : '已记录审核结果' }); }
    catch (error) { this.setData({ error: message(error) }); }
    finally { this.setData({ working: false }); }
  },
  async organizer(event) {
    if (this.data.working) return;
    const userId = event.currentTarget.dataset.id, enabled = event.currentTarget.dataset.enabled;
    this.setData({ working: true, error: '' });
    try { await getApp().client.call('setOrganizer', { userId, enabled }); await this.load(false); }
    catch (error) { this.setData({ error: message(error) }); }
    finally { this.setData({ working: false }); }
  }
});
