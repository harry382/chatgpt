'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../cloudfunctions/readingClub/handler');
const { CloudStore } = require('../cloudfunctions/readingClub/cloud-store');
const { MemoryStore } = require('../cloudfunctions/readingClub/memory-store');
const { TABLES, PRIVACY_VERSION } = require('../cloudfunctions/readingClub/domain');

function fakeDatabase(store) {
  function wrap(unit) {
    return { collection(table) {
      const query = { filters: {}, offset: 0, size: 20,
        where(filters) { this.filters = filters; return this; },
        orderBy(field, direction) { if (!this.field) { this.field = field; this.direction = direction; } return this; },
        skip(value) { this.offset = value; return this; }, limit(value) { this.size = value; return this; },
        async get() { const rows = await unit.find(table, this.filters, { offset: this.offset, limit: this.size, orderBy: this.field, direction: this.direction }); return { data: rows.map(row => ({ ...row, _id: row.id })) }; },
        doc(id) { return {
          async get() { const row = await unit.get(table, id); return { data: row ? { ...row, _id: id } : null }; },
          async set({ data }) { await unit.put(table, id, data); }
        }; }
      };
      return query;
    } };
  }
  const db = wrap(store);
  db.command = { gt(value) { return { $gt: value }; } };
  db.runTransaction = (callback, retry) => { assert.equal(retry, 5); return store.transaction(unit => callback(wrap(unit))); };
  return db;
}
function environment(context = { OPENID: 'trusted-openid', APPID: 'wx-trusted' }, variables = {}, checker = async () => ({ errCode: 0, result: { suggest: 'pass' }, traceId: 'test-trace' })) {
  const store = new MemoryStore(), db = fakeDatabase(store), errors = [];
  const cloud = { database() { return db; }, getWXContext() { return context; }, openapi: { security: { msgSecCheck: checker } } };
  return { store, cloud, context, handler: createHandler(cloud, variables, { error(...args) { errors.push(args); } }), errors };
}
async function consent(env) {
  const result = await env.handler({ action: 'acceptPrivacy', payload: { accepted: true, version: PRIVACY_VERSION } });
  assert.equal(result.ok, true, JSON.stringify(result)); return result.data.user;
}
test('cloud identity uses trusted context, ignoring forged user, role and openid in request', async () => {
  const env = environment();
  const result = await env.handler({ action: 'session', actor: { id: 'u_admin', isBootstrap: true }, OPENID: 'fake', userInfo: { openId: 'fake' }, payload: { role: 'admin' } });
  assert.equal(result.ok, true); assert.equal(result.data.user.status, 'new'); assert.equal(result.data.user.role, 'member');
  assert.match(result.data.user.id, /^u_[a-f0-9]{40}$/);
  assert.equal(JSON.stringify(result).includes('trusted-openid'), false);
});
test('missing trusted identity and mismatched app are rejected', async () => {
  for (const context of [{}, { OPENID: 'somebody' }]) {
    const env = environment(context);
    assert.equal((await env.handler({ action: 'session', OPENID: 'in-body' })).error.code, 'UNAUTHENTICATED');
  }
  const env = environment(undefined, { WX_APP_ID: 'wx-different' });
  assert.equal((await env.handler({ action: 'session' })).error.code, 'UNAUTHENTICATED');
});
test('V1 cutover switch blocks cached client writes while preserving reads and existing records', async () => {
  const variables = {}, env = environment(undefined, variables);
  const user = await consent(env), before = env.store.snapshot();
  variables.V1_WRITES_DISABLED = '1';
  for (const action of ['acceptPrivacy', 'applyMembership', 'reviewMembership', 'setOrganizer', 'saveEvent', 'joinEvent', 'cancelRegistration', 'decideEvent', 'unknownFutureWrite']) {
    const result = await env.handler({ action, payload: { accepted: true, version: PRIVACY_VERSION } });
    assert.equal(result.error.code, 'UPDATE_REQUIRED');
  }
  assert.equal((await env.handler({ action: 'session' })).data.user.id, user.id);
  assert.deepEqual(env.store.snapshot(), before);
  variables.V1_WRITES_DISABLED = '0';
  assert.equal((await env.handler({ action: 'acceptPrivacy', payload: { accepted: true, version: PRIVACY_VERSION } })).ok, true);
});
test('server environment can bootstrap the first administrator without public privilege endpoints', async () => {
  const env = environment(undefined, { BOOTSTRAP_OPENID: 'trusted-openid', WX_APP_ID: 'wx-trusted' });
  const result = await env.handler({ action: 'session' });
  assert.equal(result.data.user.role, 'admin'); assert.equal(result.data.user.status, 'approved');
  assert.equal((await env.handler({ action: 'bootstrapAdmin' })).error.code, 'INVALID_ACTION');
});
test('cloud adapter normalizes document objects and arrays and preserves only record id', async () => {
  const db = { collection() { return { doc() { return { async get() { return { data: [{ _id: 'abc', id: 'abc', title: 'book' }] }; } }; } }; } };
  assert.deepEqual(await new CloudStore(db).get('table', 'abc'), { id: 'abc', title: 'book' });
  const env = environment(), response = await env.handler({ action: 'session' });
  assert.equal(await env.store.get(TABLES.users, response.data.user.id), null);
  await consent(env);
  assert.equal((await env.store.get(TABLES.users, response.data.user.id)).id, response.data.user.id);
});
test('cloud adapter does not silently turn permission or network failures into missing records', async () => {
  const broken = { collection() { return { doc() { return { get() { throw new Error('network unreachable'); } }; } }; } };
  await assert.rejects(new CloudStore(broken).get('table', 'abc'), /network unreachable/);
  const missing = { collection() { return { doc() { return { get() { throw { code: 'DATABASE_DOCUMENT_NOT_EXIST' }; } }; } }; } };
  assert.equal(await new CloudStore(missing).get('table', 'abc'), null);
});
test('unexpected database errors return a safe retry message without leaking diagnostics', async () => {
  const errors = [], cloud = { database() { return { runTransaction() { throw new Error('secret database diagnostic'); } }; }, getWXContext() { return { OPENID: 'user', APPID: 'app' }; } };
  const result = await createHandler(cloud, {}, { error(...args) { errors.push(args); } })({ action: 'session' });
  assert.equal(result.error.code, 'INTERNAL'); assert.doesNotMatch(JSON.stringify(result), /secret database/); assert.equal(errors.length, 1);
});

test('cloud denies business requests before current privacy acceptance, without creating an account', async () => {
  const env = environment(), session = await env.handler({ action: 'session' });
  assert.equal(await env.store.get(TABLES.users, session.data.user.id), null);
  for (const action of ['applyMembership', 'listEvents', 'joinEvent', 'listMembers']) {
    assert.equal((await env.handler({ action, payload: { accepted: true, version: PRIVACY_VERSION } })).error.code, 'PRIVACY_REQUIRED');
  }
  assert.equal((await env.handler({ action: 'acceptPrivacy', payload: { version: 'old', accepted: true } })).error.code, 'PRIVACY_REQUIRED');
});
test('cloud content checks use trusted openid, and do not store openid or user-supplied audit receipts', async () => {
  const checks = [], env = environment(undefined, {}, async input => { checks.push(input); return { errCode: 0, result: { suggest: 'pass' }, traceId: 'verified' }; });
  const user = await consent(env);
  const result = await env.handler({ action: 'applyMembership', OPENID: 'forged', payload: { nickname: '新书友', groupName: '共读群', contentReview: { provider: 'fake' }, openid: 'forged' } });
  assert.equal(result.ok, true); assert.equal(checks.length, 1);
  assert.equal(checks[0].openid, 'trusted-openid'); assert.equal(checks[0].version, 2); assert.equal(checks[0].scene, 1);
  const record = await env.store.get(TABLES.users, user.id);
  assert.equal(record.contentReview.provider, 'wechat'); assert.equal(record.privacyVersion, PRIVACY_VERSION);
  assert.doesNotMatch(JSON.stringify(record), /trusted-openid|forged|fake/);
});
test('risky, review, absent API, network errors and missing verdict all block profile changes', async () => {
  const checkers = [async () => ({ result: { suggest: 'risky' } }), async () => ({ result: { suggest: 'review' } }), null,
    async () => { throw new Error('private upstream diagnostic'); }, async () => ({ errCode: 0 })];
  for (const checker of checkers) {
    const env = environment(undefined, {}, checker), user = await consent(env);
    const result = await env.handler({ action: 'applyMembership', payload: { nickname: '书友', groupName: '共读群' } });
    assert.equal(result.ok, false); assert.match(result.error.code, /^CONTENT_/);
    assert.equal((await env.store.get(TABLES.users, user.id)).status, 'new');
    assert.doesNotMatch(JSON.stringify(result), /private upstream/);
  }
});
test('publishing or editing an existing event is blocked when content detection fails; draft and existing data survive', async () => {
  const env = environment(), user = await consent(env);
  await env.store.put(TABLES.users, user.id, { ...(await env.store.get(TABLES.users, user.id)), role: 'admin', status: 'approved', nickname: '主持人' });
  const now = Date.now(), payload = { title: '测试活动', book: '测试书籍', category: '心理', location: '测试书房', description: '讨论', preparation: '', startsAt: now + 86400000, endsAt: now + 90000000, deadlineAt: now + 3600000, minCapacity: 1, maxCapacity: 8, publish: false };
  env.cloud.openapi.security.msgSecCheck = async () => ({ result: { suggest: 'risky' } });
  const draft = await env.handler({ action: 'saveEvent', payload }); assert.equal(draft.ok, true);
  const result = await env.handler({ action: 'saveEvent', payload: { ...payload, id: draft.data.event.id, publish: true } });
  assert.equal(result.error.code, 'CONTENT_REJECTED');
  const stored = await env.store.get(TABLES.events, draft.data.event.id);
  assert.equal(stored.published, false); assert.equal(stored.count, 0);
});
test('role checks run before submitting activity text to the detection service', async () => {
  let checks = 0; const env = environment(undefined, {}, async () => { checks++; return { result: { suggest: 'pass' } }; });
  const user = await consent(env);
  await env.store.put(TABLES.users, user.id, { ...(await env.store.get(TABLES.users, user.id)), status: 'approved' });
  assert.equal((await env.handler({ action: 'saveEvent', payload: { publish: true } })).error.code, 'FORBIDDEN');
  assert.equal(checks, 0);
});
test('existing published event and registrations remain unchanged after a failed content edit or cancellation', async () => {
  const env = environment(), user = await consent(env);
  await env.store.put(TABLES.users, user.id, { ...(await env.store.get(TABLES.users, user.id)), role: 'admin', status: 'approved', nickname: '主持人' });
  const now = Date.now(), payload = { title: '已发布活动', book: '测试书籍', category: '心理', location: '测试书房', description: '原内容', preparation: '', startsAt: now + 86400000, endsAt: now + 90000000, deadlineAt: now + 3600000, minCapacity: 1, maxCapacity: 8, publish: true };
  const saved = await env.handler({ action: 'saveEvent', payload }); assert.equal(saved.ok, true);
  const id = saved.data.event.id;
  const registration = { id: id + '__u_test_reader', eventId: id, userId: 'u_test_reader', nickname: '测试读者', status: 'active', createdAt: now, updatedAt: now };
  await env.store.put(TABLES.registrations, registration.id, registration);
  await env.store.put(TABLES.events, id, { ...(await env.store.get(TABLES.events, id)), count: 1 });
  const before = await env.store.get(TABLES.events, id);
  env.cloud.openapi.security.msgSecCheck = async () => ({ result: { suggest: 'risky' } });
  assert.equal((await env.handler({ action: 'saveEvent', payload: { ...payload, id, description: '被拦截的改动' } })).error.code, 'CONTENT_REJECTED');
  assert.equal((await env.handler({ action: 'decideEvent', payload: { id, decision: 'cancel', reason: '被拦截的原因' } })).error.code, 'CONTENT_REJECTED');
  assert.deepEqual(await env.store.get(TABLES.events, id), before);
  assert.deepEqual(await env.store.get(TABLES.registrations, registration.id), registration);
});
test('a changed application is not approved using a verdict for its previous text', async () => {
  const env = environment(), admin = await consent(env);
  await env.store.put(TABLES.users, admin.id, { ...(await env.store.get(TABLES.users, admin.id)), role: 'admin', status: 'approved', nickname: '管理员' });
  env.context.OPENID = 'second-user'; const applicant = await consent(env);
  assert.equal((await env.handler({ action: 'applyMembership', payload: { nickname: '原昵称', groupName: '共读群' } })).ok, true);
  env.context.OPENID = 'trusted-openid';
  env.cloud.openapi.security.msgSecCheck = async () => {
    const record = await env.store.get(TABLES.users, applicant.id);
    await env.store.put(TABLES.users, applicant.id, { ...record, nickname: '更新后的昵称' });
    return { result: { suggest: 'pass' } };
  };
  assert.equal((await env.handler({ action: 'reviewMembership', payload: { userId: applicant.id, decision: 'approve' } })).error.code, 'CONFLICT');
  assert.equal((await env.store.get(TABLES.users, applicant.id)).status, 'pending');
});
