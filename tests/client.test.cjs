'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('../miniprogram/services/client');
function platform() {
  const values = new Map();
  return { getStorageSync(key) { return values.get(key); }, setStorageSync(key, value) { values.set(key, JSON.parse(JSON.stringify(value))); }, removeStorageSync(key) { values.delete(key); } };
}
test('demo is refused in trial, release and unknown runtimes', () => {
  for (const runtime of ['trial', 'release', undefined, '']) assert.throws(() => createClient(platform(), { mode: 'demo' }, runtime), /仅限开发版/);
});
test('invalid cloud configuration fails explicitly without falling back to fake data', () => {
  assert.throws(() => createClient(platform(), { mode: 'cloud', cloudEnv: '' }, 'develop'), /配置/);
  assert.throws(() => createClient(platform(), { mode: 'invalid' }, 'develop'), /配置/);
});
test('demo application and registrations persist between client instances', async () => {
  const wx = platform();
  const first = createClient(wx, { mode: 'demo' }, 'develop');
  await first.call('joinEvent', { id: 'e_demo_positive' });
  const second = createClient(wx, { mode: 'demo' }, 'develop');
  const detail = await second.call('getEvent', { id: 'e_demo_positive' });
  assert.equal(detail.event.count, 4); assert.equal(detail.event.joined, true);
});
test('demo personas use shared stored applications and exercise real role rules', async () => {
  const wx = platform(), client = createClient(wx, { mode: 'demo' }, 'develop');
  client.demo.setPersona('u_demo_new');
  await client.call('applyMembership', { nickname: '测试书友', groupName: '测试群' });
  client.demo.setPersona('u_demo_admin');
  await client.call('reviewMembership', { userId: 'u_demo_new', decision: 'approve' });
  client.demo.setPersona('u_demo_new');
  assert.equal((await client.call('session')).user.status, 'approved');
  assert.equal((await client.call('listEvents')).items.length, 2);
});
test('advancing demo time enforces cutoff without changing production APIs', async () => {
  const wx = platform(), client = createClient(wx, { mode: 'demo' }, 'develop');
  await client.call('joinEvent', { id: 'e_demo_positive' });
  await client.demo.advanceToDeadline();
  await assert.rejects(client.call('cancelRegistration', { id: 'e_demo_positive' }), error => error.code === 'REGISTRATION_CLOSED');
  client.demo.setPersona('u_demo_host');
  assert.equal((await client.call('decideEvent', { id: 'e_demo_positive', decision: 'confirm' })).event.status, 'confirmed');
});
test('cloud failures surface to user and never trigger demo fallback', async () => {
  const wx = platform(); wx.cloud = { init() {}, async callFunction() { throw new Error('offline'); } };
  const client = createClient(wx, { mode: 'cloud', cloudEnv: 'real-env', functionName: 'readingClub' }, 'release');
  assert.equal(client.demo, undefined);
  await assert.rejects(client.call('session'), /连接失败/);
});
