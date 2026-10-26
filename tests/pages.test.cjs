'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..', 'miniprogram');
const { PRIVACY_VERSION } = require('../miniprogram/shared/domain');
const privacy = require('../miniprogram/services/privacy');

function harness(options = {}) {
  const storage = new Map(), navigation = [], toasts = [];
  const wx = {
    getAccountInfoSync() { return { miniProgram: { envVersion: 'develop' } }; },
    getStorageSync(key) { return storage.get(key); }, setStorageSync(key, value) { storage.set(key, JSON.parse(JSON.stringify(value))); }, removeStorageSync(key) { storage.delete(key); },
    async showModal() { return { confirm: true, content: '请核对所在社群' }; },
    showToast(value) { toasts.push(value.title); }, navigateTo(value) { navigation.push(value.url); }, redirectTo(value) { navigation.push(value.url); }, switchTab(value) { navigation.push(value.url); }, stopPullDownRefresh() {},
    navigateBack() { navigation.push('back'); },
    getPrivacySetting({ success }) { success({ needAuthorization: options.platformConsentNeeded || false }); },
    openPrivacyContract() { navigation.push('platform-privacy-contract'); }
  };
  if (options.consented !== false) privacy.rememberConsent(wx);
  let app;
  function evaluate(filename, extra) {
    const localRequire = createRequire(filename);
    const testRequire = name => localRequire.resolve(name) === path.join(root, 'config.js') ? { mode: 'demo', cloudEnv: '', functionName: 'readingClub' } : localRequire(name);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { wx, require: testRequire, getApp: () => app, ...extra }, { filename });
  }
  evaluate(path.join(root, 'app.js'), { App(definition) { app = definition; } });
  app.onLaunch({ query: {} });
  function page(name, query = {}) {
    let definition;
    evaluate(path.join(root, 'pages', name, 'index.js'), { Page(value) { definition = value; } });
    const instance = { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
      setData(update) { Object.entries(update).forEach(([key, value]) => { const keys = key.split('.'); let target = this.data; while (keys.length > 1) { const part = keys.shift(); if (!target[part]) target[part] = {}; target = target[part]; } target[keys[0]] = value; }); }
    };
    if (instance.onLoad) instance.onLoad(query);
    return instance;
  }
  return { app, wx, page, navigation, toasts };
}
async function flush() { for (let index = 0; index < 12; index++) await new Promise(resolve => setImmediate(resolve)); }
function click(data = {}) { return { currentTarget: { dataset: data } }; }

test('missing legacy entry returns to a registered home without bypassing membership', async () => {
  const env = harness(); env.app.client.demo.setPersona('u_demo_new');
  env.app.onPageNotFound({ path: 'pages/index/index', query: { id: 'e_demo_positive' }, isEntryPage: true });
  const target = env.navigation.at(-1), config = require('../miniprogram/app.json');
  assert.equal(target, '/pages/home/index');
  assert.ok(config.pages.includes(target.slice(1)));
  // The retained 1.0.2 route remains registered; 1.1.0 owns the visible tabs.
  assert.equal(env.app.pendingEvent(), 'e_demo_positive');
  const home = env.page('home'); await home.refresh();
  assert.equal(home.data.member, false); assert.equal(home.data.events.length, 0);
  const detail = env.page('event-detail', { id: 'e_demo_positive' }); await detail.load();
  assert.equal(detail.data.member, false); assert.equal(detail.data.event, null);
});
test('missing entry ignores invalid activity identifiers and recovers without query parameters', () => {
  const env = harness(); env.app.rememberEvent('e_demo_positive');
  env.app.onPageNotFound({ path: 'old/entry', query: { id: '../admin?role=admin' }, isEntryPage: true });
  assert.equal(env.app.pendingEvent(), 'e_demo_positive');
  assert.equal(env.navigation.at(-1), '/pages/home/index');
  env.app.onPageNotFound({ path: 'old/entry', isEntryPage: true });
  assert.equal(env.navigation.at(-1), '/pages/home/index');
});

test('page controllers: member browses, joins, cancels, sees records and shares correct activity', async () => {
  const env = harness(), home = env.page('home');
  await home.refresh(); assert.equal(home.data.events.length, 2); assert.equal(home.data.organizer, false);
  home.setCategory(click({ category: 'AI' })); await flush(); assert.equal(home.data.events.length, 0);
  home.setCategory(click({ category: '全部' })); await flush();
  const detail = env.page('event-detail', { id: 'e_demo_positive' }); await detail.load();
  await detail.register(); assert.equal(detail.data.event.count, 4); assert.equal(detail.data.event.joined, true);
  const records = env.page('records', { kind: 'joined' }); await records.load(); assert.equal(records.data.events.length, 1);
  assert.match(detail.onShareAppMessage().path, /e_demo_positive$/);
  await detail.register(); assert.equal(detail.data.event.count, 3); assert.equal(detail.data.event.joined, false);
});
test('page controllers: unknown member enters shared event, applies, admin approves, resumes event', async () => {
  const env = harness(); env.app.client.demo.setPersona('u_demo_new');
  const detail = env.page('event-detail', { id: 'e_demo_positive' }); await detail.load();
  assert.equal(detail.data.member, false); assert.equal(detail.data.event, null);
  const membership = env.page('membership'); await membership.load(); membership.setData({ nickname: '书友阿青', groupName: '周末共读群' }); await membership.apply();
  assert.equal(membership.data.user.status, 'pending');
  env.app.client.demo.setPersona('u_demo_admin');
  const admin = env.page('admin'); await admin.load();
  await admin.review(click({ id: 'u_demo_new', decision: 'approve' })); assert.equal(admin.data.error, '');
  env.app.client.demo.setPersona('u_demo_new'); await membership.load(); assert.equal(membership.data.member, true);
  membership.continue(); assert.match(env.navigation.at(-1), /e_demo_positive$/);
});
test('page controllers: organizer saves draft, publishes, and finds it in own records', async () => {
  const env = harness(); env.app.client.demo.setPersona('u_demo_host');
  const editor = env.page('event-editor'); await editor.load();
  editor.setData({ 'form.location': '演示书房', 'form.description': '一起讨论家庭会议' });
  await editor.save(click({ publish: false })); assert.equal(editor.data.error, ''); assert.ok(editor.id);
  await editor.save(click({ publish: true })); assert.equal(editor.data.error, ''); assert.match(env.navigation.at(-1), /event-detail/);
  const records = env.page('records', { kind: 'created' }); await records.load();
  assert.ok(records.data.events.some(event => event.id === editor.id));
});
test('manual dates reject impossible dates and invalid time before saving', async () => {
  const env = harness(); env.app.client.demo.setPersona('u_demo_host');
  const editor = env.page('event-editor'); await editor.load(); editor.toggleDateInput();
  assert.equal(editor.data.manualDates, true);
  let calls = 0; env.app.client.call = async () => { calls++; };
  for (const [date, time] of [['2026-02-30', '14:00'], ['2026-10-25', '25:00'], ['2026-10-25', '14:60'], ['2026-1-25', '14:00']]) {
    editor.setData({ 'form.startDate': date, 'form.startTime': time });
    await editor.save(click({ publish: false }));
    assert.match(editor.data.error, /有效的日期和时间/); assert.equal(calls, 0);
  }
});
test('manual dates save a leap day using Beijing time', async () => {
  const env = harness(); env.app.client.demo.setPersona('u_demo_host');
  const editor = env.page('event-editor'); await editor.load(); editor.toggleDateInput();
  editor.setData({ 'form.startDate': '2028-02-29', 'form.startTime': '14:00', 'form.endDate': '2028-02-29', 'form.endTime': '16:00', 'form.deadlineDate': '2028-02-28', 'form.deadlineTime': '14:00' });
  await editor.save(click({ publish: false })); assert.equal(editor.data.error, '');
  const result = await env.app.client.call('getEvent', { id: editor.id });
  assert.equal(result.event.startsAt, Date.UTC(2028, 1, 29, 6));
  assert.equal(result.event.endsAt, Date.UTC(2028, 1, 29, 8));
  assert.equal(result.event.deadlineAt, Date.UTC(2028, 1, 28, 6));
});
test('page controllers: admin assigns organizer and host confirms only after deadline', async () => {
  const env = harness(); await env.app.client.call('joinEvent', { id: 'e_demo_positive' });
  env.app.client.demo.setPersona('u_demo_admin');
  const admin = env.page('admin'); await admin.load();
  await admin.organizer(click({ id: 'u_demo_reader', enabled: true })); assert.equal(admin.data.error, '');
  env.app.client.demo.setPersona('u_demo_host');
  const manage = env.page('event-manage', { id: 'e_demo_positive' }); await manage.load();
  assert.equal(manage.data.event.canConfirm, false); assert.equal(manage.data.readers.length, 4);
  await env.app.client.demo.advanceToDeadline(); await manage.load(); assert.equal(manage.data.event.canConfirm, true);
  await manage.decide(click({ decision: 'confirm' })); assert.equal(manage.data.event.status, 'confirmed');
});
test('page controllers: development demo switches identity and resets only demo data', async () => {
  const env = harness(), demo = env.page('demo'); demo.onShow(); assert.equal(demo.data.available, true);
  demo.select(click({ id: 'u_demo_host' })); assert.equal(env.app.client.demo.currentPersona(), 'u_demo_host');
  await demo.reset(); assert.equal(env.app.client.demo.currentPersona(), 'u_demo_reader');
  assert.equal((await env.app.client.call('getEvent', { id: 'e_demo_positive' })).event.count, 3);
});

test('first launch does not send account requests until privacy choice is explicit', async () => {
  const env = harness({ consented: false });
  let calls = 0; env.app.client.call = async () => { calls++; throw new Error('must not call'); };
  const home = env.page('home'); await home.refresh();
  assert.equal(calls, 0); assert.equal(home.data.privacyRequired, true); assert.equal(home.data.member, false);
  const policy = env.page('privacy'); policy.decline();
  assert.equal(calls, 0); assert.equal(privacy.hasConsent(env.wx), false);
  policy.openContract(); assert.equal(env.navigation.at(-1), 'platform-privacy-contract');
});
test('privacy consent requires a checkbox and retains existing member identity and signups', async () => {
  const env = harness({ consented: false });
  await env.app.client.call('joinEvent', { id: 'e_demo_positive' });
  const policy = env.page('privacy', { authorize: '1' });
  await policy.agree(); assert.equal(privacy.hasConsent(env.wx), false);
  policy.check({ detail: { value: ['agree'] } }); await policy.agree();
  assert.equal(privacy.hasConsent(env.wx), true); assert.equal(env.navigation.at(-1), 'back');
  assert.equal(env.app.globalData.user.privacyVersion, PRIVACY_VERSION);
  assert.equal(env.app.globalData.user.role, 'member');
  const home = env.page('home'); await home.refresh(); assert.equal(home.data.events.length, 2);
  const event = (await env.app.client.call('getEvent', { id: 'e_demo_positive' })).event;
  assert.equal(event.count, 4); assert.equal(event.joined, true);
});
test('platform privacy authorization cannot be replaced by the ordinary agree handler', async () => {
  const env = harness({ consented: false, platformConsentNeeded: true }), policy = env.page('privacy', { authorize: '1' });
  policy.check({ detail: { value: ['agree'] } }); await policy.agree();
  assert.equal(privacy.hasConsent(env.wx), false); assert.match(policy.data.error, /微信的同意按钮/);
  await policy.agreeNative(); assert.equal(privacy.hasConsent(env.wx), true);
});
test('failed server consent does not leave the local app authorized', async () => {
  const env = harness({ consented: false }), policy = env.page('privacy', { authorize: '1' });
  env.app.client.call = async () => { throw new Error('offline'); };
  policy.check({ detail: { value: ['agree'] } }); await policy.agree();
  assert.equal(privacy.hasConsent(env.wx), false); assert.equal(policy.data.working, false); assert.equal(policy.data.error, 'offline');
});
test('unsupported platform privacy APIs keep membership disabled and allow reading the explanation', async () => {
  const env = harness({ consented: false }); delete env.wx.getPrivacySetting;
  const policy = env.page('privacy', { authorize: '1' });
  policy.check({ detail: { value: ['agree'] } }); await policy.agree();
  assert.equal(policy.data.ready, false); assert.equal(privacy.hasConsent(env.wx), false);
  assert.equal(policy.data.email, 'privacy@example.com'); assert.match(policy.data.error, /更新微信/);
});
