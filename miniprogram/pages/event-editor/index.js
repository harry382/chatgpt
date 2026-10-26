'use strict';
const { CATEGORIES } = require('../../shared/domain');
const { profile, parts, message } = require('../../services/view');
function beijingDateValue(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NaN;
  const [year, month, day] = date.split('-').map(Number), [hour, minute] = time.split(':').map(Number);
  const utc = Date.UTC(year, month - 1, day, hour, minute), value = new Date(utc);
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day || value.getUTCHours() !== hour || value.getUTCMinutes() !== minute) return NaN;
  return utc - 8 * 3600000;
}
function initialForm(now) {
  const start = parts(now + 8 * 86400000), deadline = parts(now + 7 * 86400000);
  return { title: '《正面管教》共读会', book: '正面管教', category: '心理', location: '', description: '', preparation: '',
    startDate: start.date, startTime: '14:00', endDate: start.date, endTime: '16:00', deadlineDate: deadline.date, deadlineTime: '20:00', minCapacity: '4', maxCapacity: '8' };
}
function toForm(event) {
  const start = parts(event.startsAt || event.serverNow), end = parts(event.endsAt || event.serverNow), deadline = parts(event.deadlineAt || event.serverNow);
  return { title: event.title, book: event.book, category: event.category || '心理', location: event.location, description: event.description, preparation: event.preparation,
    startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time, deadlineDate: deadline.date, deadlineTime: deadline.time,
    minCapacity: String(event.minCapacity || ''), maxCapacity: String(event.maxCapacity || '') };
}
Page({
  data: { form: {}, categories: CATEGORIES, organizer: false, loading: false, working: false, error: '', isDemo: false, locked: false, published: false, manualDates: false },
  onLoad(options) {
    this.id = options.id || '';
    const demo = getApp().client.demo;
    this.setData({ form: initialForm(demo ? demo.now() : Date.now()) });
  },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const app = getApp(), user = await app.session();
      this.setData({ ...profile(user), isDemo: app.globalData.isDemo });
      if (!profile(user).organizer) throw new Error('只有管理员和指定组织者可以发起活动');
      if (this.id) {
        const result = await app.client.call('getEvent', { id: this.id });
        if (!result.event.canManage) throw new Error('只能编辑自己发起的活动');
        if (!['open', 'draft'].includes(result.event.status)) throw new Error('该活动已停止报名或结束，暂时不能编辑');
        this.setData({ form: toForm(result.event), locked: result.event.count > 0, published: result.event.status !== 'draft' });
      }
    } catch (error) { this.setData({ error: message(error), organizer: false }); }
    finally { this.setData({ loading: false }); }
  },
  input(event) { this.setData({ ['form.' + event.currentTarget.dataset.field]: event.detail.value }); },
  toggleDateInput() { this.setData({ manualDates: !this.data.manualDates }); },
  category(event) { this.setData({ 'form.category': CATEGORIES[Number(event.detail.value)] }); },
  async save(event) {
    if (this.data.working || !this.data.organizer) return;
    const publish = event.currentTarget.dataset.publish === true || event.currentTarget.dataset.publish === 'true';
    const form = this.data.form;
    const startsAt = beijingDateValue(form.startDate, form.startTime), endsAt = beijingDateValue(form.endDate, form.endTime), deadlineAt = beijingDateValue(form.deadlineDate, form.deadlineTime);
    if (![startsAt, endsAt, deadlineAt].every(Number.isFinite)) {
      this.setData({ error: '请填写有效的日期和时间：日期如 2026-10-25，时间如 14:00，均为北京时间。' });
      return;
    }
    const payload = { id: this.id || undefined, publish, title: form.title, book: form.book, category: form.category, location: form.location, description: form.description, preparation: form.preparation,
      startsAt, endsAt, deadlineAt,
      minCapacity: Number(form.minCapacity), maxCapacity: Number(form.maxCapacity) };
    this.setData({ working: true, error: '' });
    try {
      const result = await getApp().client.call('saveEvent', payload);
      this.id = result.event.id;
      wx.showToast({ title: publish ? '活动已发布' : '草稿已保存', icon: 'success' });
      if (publish) wx.redirectTo({ url: '/pages/event-detail/index?id=' + this.id });
    } catch (error) { this.setData({ error: message(error) }); }
    finally { this.setData({ working: false }); }
  }
});
