'use strict';
const config = require('../../config');
const { createClient } = require('../../services/client');
const { parts, message } = require('../../services/view');
Page({
  data: { available: false, personas: [], selected: '', currentTime: '', error: '' },
  onShow() {
    const demo = getApp().client.demo;
    const runtime = wx.getAccountInfoSync().miniProgram.envVersion;
    if (!getApp().globalData.isDemo || runtime !== 'develop' || !demo) { this.setData({ error: '此页面仅在本机开发演示模式开放' }); return; }
    const time = parts(demo.now());
    this.setData({ available: true, personas: demo.personas, selected: demo.currentPersona(), currentTime: time.date + ' ' + time.time + ' 北京时间', error: '' });
  },
  select(event) {
    if (!this.data.available) return;
    getApp().client.demo.setPersona(event.currentTarget.dataset.id);
    getApp().globalData.user = null; this.onShow(); wx.showToast({ title: '体验身份已切换' });
  },
  async advance() {
    if (!this.data.available) return;
    try { await getApp().client.demo.advanceToDeadline(); this.onShow(); wx.showToast({ title: '已推进到报名截止后' }); }
    catch (error) { this.setData({ error: message(error) }); }
  },
  async reset() {
    if (!this.data.available) return;
    const answer = await wx.showModal({ title: '重置本机演示数据？', content: '仅清空本机模拟活动、报名和申请，恢复初始演示。' });
    if (!answer.confirm) return;
    const app = getApp(); app.client.demo.reset(); app.client = createClient(wx, config, 'develop'); app.globalData.user = null; this.onShow();
  },
  home() { wx.switchTab({ url: '/pages/home/index' }); }
});
