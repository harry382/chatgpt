'use strict';
const { CONTACT_EMAIL, PRIVACY_VERSION, rememberConsent, clearConsent } = require('../../services/privacy');
Page({
  data: { email: CONTACT_EMAIL, version: PRIVACY_VERSION, authorize: false, agreed: false, ready: false, needsPlatformConsent: true, working: false, error: '' },
  onLoad(query = {}) {
    this.setData({ authorize: query.authorize === '1' });
    if (!this.data.authorize) return;
    if (typeof wx.getPrivacySetting !== 'function') { this.setData({ error: '请更新微信后再使用会员服务；你仍可阅读本页说明。' }); return; }
    wx.getPrivacySetting({
      success: result => this.setData({ ready: true, needsPlatformConsent: result.needAuthorization }),
      fail: () => this.setData({ error: '暂时无法读取微信隐私设置，请返回后重试。' })
    });
  },
  check(event) { this.setData({ agreed: event.detail.value.includes('agree') }); },
  openContract() {
    if (typeof wx.openPrivacyContract !== 'function') { this.setData({ error: '当前微信不支持打开平台隐私指引，请更新微信。' }); return; }
    wx.openPrivacyContract({ fail: () => this.setData({ error: '平台隐私指引暂时无法打开，请稍后重试。' }) });
  },
  agreeNative() { return this.accept(true); },
  agree() { return this.accept(false); },
  async accept(platformAgreed) {
    if (!this.data.authorize || !this.data.ready || !this.data.agreed || this.data.working) return;
    if (this.data.needsPlatformConsent && !platformAgreed) { this.setData({ error: '请通过微信的同意按钮完成授权。' }); return; }
    this.setData({ working: true, error: '' });
    try {
      rememberConsent(wx);
      await getApp().session();
      wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/home/index' }) });
    } catch (error) { clearConsent(wx); this.setData({ error: error.message || '同意状态未保存，请重试' }); }
    finally { this.setData({ working: false }); }
  },
  decline() { wx.switchTab({ url: '/pages/home/index' }); }
});
