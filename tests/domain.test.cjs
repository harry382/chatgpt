'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createService, TABLES, stateOf, registrationId } = require('../cloudfunctions/readingClub/domain');
const { MemoryStore } = require('../cloudfunctions/readingClub/memory-store');
const { makeSeed } = require('../miniprogram/services/demo-data');
const NOW = Date.parse('2026-10-22T12:00:00+08:00');
function setup() {
  let now = NOW, next = 0;
  const store = new MemoryStore(makeSeed(now));
  const service = createService(store, { now: () => now, makeId: () => 'e_test_' + (++next) });
  const call = (user, action, payload) => service.call({ id: 'u_demo_' + user }, action, payload);
  return { store, service, call, time(value) { now = value; } };
}
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
const eventId = 'e_demo_positive';
const original = async context => (await context.call('reader', 'getEvent', { id: eventId })).event;

test('new members apply, admins review, applicants become ordinary members', async () => {
  const context = setup();
  const fresh = await context.call('new', 'session'); assert.equal(fresh.user.status, 'new');
  await context.call('new', 'applyMembership', { nickname: '小林', groupName: '周末共读群', role: 'admin', status: 'approved' });
  await rejects(context.call('new', 'listEvents'), 'MEMBERSHIP_REQUIRED');
  await rejects(context.call('reader', 'reviewMembership', { userId: 'u_demo_new', decision: 'approve' }), 'FORBIDDEN');
  const reviewed = await context.call('admin', 'reviewMembership', { userId: 'u_demo_new', decision: 'approve' });
  assert.equal(reviewed.user.role, 'member');
  assert.equal((await context.call('new', 'listEvents')).items.length, 2);
});
test('rejected members can amend their application; rejection requires reason', async () => {
  const context = setup();
  await rejects(context.call('admin', 'reviewMembership', { userId: 'u_demo_pending', decision: 'reject' }), 'INVALID_INPUT');
  await context.call('admin', 'reviewMembership', { userId: 'u_demo_pending', decision: 'reject', reason: '请核对所在群' });
  assert.equal((await context.call('pending', 'session')).user.status, 'rejected');
  const result = await context.call('pending', 'applyMembership', { nickname: '修正昵称', groupName: '修正群名' });
  assert.equal(result.user.status, 'pending'); assert.equal(result.user.rejectionReason, '');
});
test('reviewing the same application twice cannot grant extra privileges', async () => {
  const context = setup();
  await context.call('admin', 'reviewMembership', { userId: 'u_demo_pending', decision: 'approve' });
  await rejects(context.call('admin', 'reviewMembership', { userId: 'u_demo_pending', decision: 'approve' }), 'CONFLICT');
});
test('unapproved members cannot read activities, details, personal records or attendee names', async () => {
  const context = setup();
  for (const user of ['new', 'pending']) {
    await rejects(context.call(user, 'listEvents'), 'MEMBERSHIP_REQUIRED');
    await rejects(context.call(user, 'getEvent', { id: eventId }), 'MEMBERSHIP_REQUIRED');
    await rejects(context.call(user, 'myEvents', { kind: 'joined' }), 'MEMBERSHIP_REQUIRED');
    await rejects(context.call(user, 'listRegistrations', { id: eventId }), 'MEMBERSHIP_REQUIRED');
  }
  await rejects(context.call('reader', 'listRegistrations', { id: eventId }), 'FORBIDDEN');
  assert.equal((await context.call('host', 'listRegistrations', { id: eventId })).items.length, 3);
});
test('ordinary members cannot publish, change roles, review or decide activities', async () => {
  const context = setup(), event = await original(context);
  await rejects(context.call('reader', 'saveEvent', { ...event, id: undefined, publish: true }), 'FORBIDDEN');
  await rejects(context.call('reader', 'setOrganizer', { userId: 'u_demo_reader', enabled: true }), 'FORBIDDEN');
  await rejects(context.call('reader', 'listMembers'), 'FORBIDDEN');
  await rejects(context.call('reader', 'decideEvent', { id: eventId, decision: 'cancel', reason: '测试' }), 'FORBIDDEN');
});
test('organizers can only manage their own activity; admin can manage all', async () => {
  const context = setup();
  await context.call('admin', 'setOrganizer', { userId: 'u_demo_reader', enabled: true });
  const event = await original(context);
  await rejects(context.call('reader', 'saveEvent', { ...event, publish: true }), 'FORBIDDEN');
  await rejects(context.call('reader', 'listRegistrations', { id: eventId }), 'FORBIDDEN');
  await rejects(context.call('reader', 'decideEvent', { id: eventId, decision: 'cancel', reason: '测试' }), 'FORBIDDEN');
  assert.equal((await context.call('admin', 'getEvent', { id: eventId })).event.canManage, true);
});
test('organizer role can be granted and removed without changing administrator role', async () => {
  const context = setup();
  await context.call('admin', 'setOrganizer', { userId: 'u_demo_reader', enabled: true });
  assert.equal((await context.call('reader', 'session')).user.role, 'organizer');
  await context.call('admin', 'setOrganizer', { userId: 'u_demo_reader', enabled: false });
  assert.equal((await context.call('reader', 'session')).user.role, 'member');
  await rejects(context.call('admin', 'setOrganizer', { userId: 'u_demo_admin', enabled: false }), 'FORBIDDEN');
});
test('duplicate join retries create one registration and increment once', async () => {
  const context = setup();
  const results = await Promise.all(Array.from({ length: 20 }, () => context.call('reader', 'joinEvent', { id: eventId })));
  assert.ok(results.every(result => result.event.joined));
  assert.equal((await original(context)).count, 4);
  const rows = await context.store.find(TABLES.registrations, { eventId, userId: 'u_demo_reader' });
  assert.equal(rows.length, 1);
});
test('two members competing for the last seat cannot overbook', async () => {
  const context = setup();
  const seed = await context.store.get(TABLES.events, eventId); seed.maxCapacity = 4;
  await context.store.put(TABLES.events, eventId, seed);
  const result = await Promise.allSettled([context.call('reader', 'joinEvent', { id: eventId }), context.call('admin', 'joinEvent', { id: eventId })]);
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(result.find(item => item.status === 'rejected').reason.code, 'EVENT_FULL');
  assert.equal((await original(context)).count, 4);
});
test('cancellation is idempotent, releases one seat and supports rejoining', async () => {
  const context = setup();
  await context.call('reader', 'joinEvent', { id: eventId });
  await Promise.all(Array.from({ length: 10 }, () => context.call('reader', 'cancelRegistration', { id: eventId })));
  assert.equal((await original(context)).count, 3);
  await context.call('reader', 'joinEvent', { id: eventId });
  assert.equal((await original(context)).count, 4);
});
test('cutoff uses service time and rejects new joins and cancellations exactly at deadline', async () => {
  const context = setup();
  const event = await original(context);
  await context.call('reader', 'joinEvent', { id: eventId });
  context.time(event.deadlineAt);
  await rejects(context.call('admin', 'joinEvent', { id: eventId, now: 0 }), 'REGISTRATION_CLOSED');
  await rejects(context.call('reader', 'cancelRegistration', { id: eventId }), 'REGISTRATION_CLOSED');
  assert.equal((await original(context)).status, 'decision_due');
});
test('reaching minimum or capacity never confirms automatically; host confirms after cutoff', async () => {
  const context = setup(), event = await original(context);
  await context.call('reader', 'joinEvent', { id: eventId });
  assert.equal((await original(context)).status, 'open');
  await rejects(context.call('host', 'decideEvent', { id: eventId, decision: 'confirm' }), 'BEFORE_DEADLINE');
  context.time(event.deadlineAt + 1);
  await context.call('host', 'decideEvent', { id: eventId, decision: 'confirm' });
  assert.equal((await original(context)).status, 'confirmed');
});
test('insufficient readers cannot confirm; cancelled activities retain signup and reason', async () => {
  const context = setup(), event = await original(context);
  context.time(event.deadlineAt + 1);
  await rejects(context.call('host', 'decideEvent', { id: eventId, decision: 'confirm' }), 'NOT_ENOUGH_READERS');
  await rejects(context.call('host', 'decideEvent', { id: eventId, decision: 'cancel', reason: ' ' }), 'INVALID_INPUT');
  await context.call('host', 'decideEvent', { id: eventId, decision: 'cancel', reason: '人数不足' });
  const history = await context.call('attendee1', 'myEvents', { kind: 'joined' });
  assert.equal(history.items[0].status, 'cancelled'); assert.equal(history.items[0].cancellationReason, '人数不足');
  await rejects(context.call('reader', 'joinEvent', { id: eventId }), 'REGISTRATION_CLOSED');
});
test('host is excluded from reader seats', async () => {
  const context = setup();
  await rejects(context.call('host', 'joinEvent', { id: eventId }), 'HOST_NOT_ATTENDEE');
  assert.equal((await original(context)).count, 3);
});
test('drafts are private and can be published without changing id', async () => {
  const context = setup();
  const draft = await context.call('host', 'saveEvent', { publish: false, title: '下一场共读' });
  await rejects(context.call('reader', 'getEvent', { id: draft.event.id }), 'NOT_FOUND');
  assert.equal((await context.call('reader', 'listEvents')).items.length, 2);
  const event = await original(context);
  const published = await context.call('host', 'saveEvent', { ...event, id: draft.event.id, publish: true });
  assert.equal(published.event.id, draft.event.id); assert.equal(published.event.status, 'open');
  assert.equal((await context.call('reader', 'listEvents')).items.length, 3);
});
test('publishing validates all date, category and capacity constraints', async () => {
  const context = setup(), event = await original(context);
  const valid = { ...event, id: undefined, publish: true };
  for (const override of [{ minCapacity: 0 }, { maxCapacity: 3 }, { maxCapacity: 101 }, { minCapacity: 1.5 }, { startsAt: NOW }, { endsAt: event.startsAt }, { deadlineAt: event.startsAt }, { deadlineAt: NOW }, { category: '未知' }, { title: ' ' }, { location: '' }]) {
    await rejects(context.call('host', 'saveEvent', { ...valid, ...override }), 'INVALID_INPUT');
  }
});
test('editing after signups preserves records and locks schedule, place and capacity', async () => {
  const context = setup(), event = await original(context);
  await rejects(context.call('host', 'saveEvent', { ...event, publish: true, startsAt: event.startsAt + 1000 }), 'CONFLICT');
  const result = await context.call('host', 'saveEvent', { ...event, publish: true, description: '补充介绍' });
  assert.equal(result.event.count, 3);
  assert.equal((await context.call('host', 'listRegistrations', { id: eventId })).items.length, 3);
});
test('filtering combines date and category, including empty results; invalid dates are rejected', async () => {
  const context = setup(), event = await original(context);
  assert.equal((await context.call('reader', 'listEvents', { category: '心理', date: event.dateKey })).items.length, 1);
  assert.equal((await context.call('reader', 'listEvents', { category: 'AI', date: event.dateKey })).items.length, 0);
  for (const date of ['2026-13-31', '2026-02-30', 'tomorrow', 5]) await rejects(context.call('reader', 'listEvents', { date }), 'INVALID_INPUT');
});
test('pagination signals more records and never returns member contacts in event listing', async () => {
  const context = setup();
  const first = await context.call('reader', 'listEvents', { limit: 1 });
  const second = await context.call('reader', 'listEvents', { limit: 1, offset: 1 });
  assert.equal(first.hasMore, true); assert.equal(second.hasMore, false); assert.notEqual(first.items[0].id, second.items[0].id);
  assert.equal(first.items[0].createdBy, undefined); assert.equal(first.items[0].groupName, undefined);
  await rejects(context.call('reader', 'listEvents', { offset: -1 }), 'INVALID_INPUT');
});
test('unconfirmed past activities expire without implying that they took place', async () => {
  const context = setup(), event = await original(context);
  context.time(event.endsAt + 1); assert.equal((await original(context)).status, 'expired');
  assert.equal(stateOf({ ...event, status: 'confirmed' }, event.endsAt + 1), 'ended');
  await rejects(context.call('host', 'decideEvent', { id: eventId, decision: 'confirm' }), 'CONFLICT');
});
test('failed persistence rolls back both count and registration', async () => {
  const store = new MemoryStore(makeSeed(NOW), () => { throw new Error('disk full'); });
  const service = createService(store, { now: () => NOW });
  await assert.rejects(service.call({ id: 'u_demo_reader' }, 'joinEvent', { id: eventId }), /disk full/);
  assert.equal((await store.get(TABLES.events, eventId)).count, 3);
  assert.equal(await store.get(TABLES.registrations, registrationId(eventId, 'u_demo_reader')), null);
});
test('invalid actions and missing actor are rejected; first bootstrap requires server-supplied actor', async () => {
  const context = setup();
  await rejects(context.service.call(null, 'session'), 'UNAUTHENTICATED');
  await rejects(context.call('reader', 'constructor'), 'INVALID_ACTION');
  const result = await context.service.call({ id: 'u_first_admin', isBootstrap: true }, 'session');
  assert.equal(result.user.role, 'admin'); assert.equal(result.user.status, 'approved');
});
