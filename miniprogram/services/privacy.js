'use strict';
const { PRIVACY_VERSION } = require('../shared/domain');
const KEY = 'reading_club_privacy_consent';
const CONTACT_EMAIL = 'privacy@example.com';
function hasConsent(platform) { return platform.getStorageSync(KEY) === PRIVACY_VERSION; }
function rememberConsent(platform) { platform.setStorageSync(KEY, PRIVACY_VERSION); }
function clearConsent(platform) { platform.removeStorageSync(KEY); }
function privacyPage() { wx.navigateTo({ url: '/pages/privacy/index' }); }
function authorizePrivacyPage() { wx.navigateTo({ url: '/pages/privacy/index?authorize=1' }); }
module.exports = { PRIVACY_VERSION, CONTACT_EMAIL, hasConsent, rememberConsent, clearConsent, privacyPage, authorizePrivacyPage };
