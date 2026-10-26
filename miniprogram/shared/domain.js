'use strict';

const CATEGORIES = ['心理', '经济', 'AI', '历史', '文学', '社会'];
const TABLES = { users: 'club_users', events: 'club_events', registrations: 'club_registrations' };
const PRIVACY_VERSION = '2026-10-23.1';

class ClubError extends Error {
  constructor(code, message) { super(message); this.name = 'ClubError'; this.code = code; }
}
function fail(code, message) { throw new ClubError(code, message); }
function text(value, max, label, required = true) {
  if (typeof value !== 'string') {
    if (!required && (value === undefined || value === null)) return '';
    fail('INVALID_INPUT', label + '格式不正确');
  }
  const result = value.trim();
  if ((required && !result) || result.length > max) fail('INVALID_INPUT', label + '请填写 1 至 ' + max + ' 个字');
  return result;
}
function recordId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{3,80}$/.test(value)) fail('INVALID_INPUT', '记录编号不正确');
  return value;
}
function isMember(user) { return !!user && user.status === 'approved'; }
function isOrganizer(user) { return isMember(user) && ['organizer', 'admin'].includes(user.role); }
function isAdmin(user) { return isMember(user) && user.role === 'admin'; }
function canManage(user, event) { return isAdmin(user) || (isOrganizer(user) && user.id === event.createdBy); }
function requireMember(user) { if (!isMember(user)) fail('MEMBERSHIP_REQUIRED', '请先申请会员，并等待管理员审核'); }
function requireAdmin(user) { if (!isAdmin(user)) fail('FORBIDDEN', '只有管理员可以执行此操作'); }
function dateKey(timestamp) { return new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10); }
function stateOf(event, now) {
  if (event.status === 'draft' || event.status === 'cancelled') return event.status;
  if (now >= event.endsAt) return event.status === 'confirmed' ? 'ended' : 'expired';
  if (event.status === 'confirmed') return 'confirmed';
  return now >= event.deadlineAt ? 'decision_due' : 'open';
}
function userView(user) {
  if (!user) return null;
  const { id, nickname, groupName, status, role, rejectionReason, privacyVersion } = user;
  return { id, nickname, groupName, status, role, rejectionReason: rejectionReason || '', privacyVersion: privacyVersion || '' };
}
function eventView(event, user, now, registration) {
  const view = {
    id: event.id, title: event.title, book: event.book, category: event.category,
    location: event.location, description: event.description, preparation: event.preparation,
    startsAt: event.startsAt, endsAt: event.endsAt, deadlineAt: event.deadlineAt,
    dateKey: event.dateKey, minCapacity: event.minCapacity, maxCapacity: event.maxCapacity,
    count: event.count, status: stateOf(event, now), organizerName: event.organizerName,
    cancellationReason: event.cancellationReason || '',
    canManage: canManage(user, event), isHost: event.createdBy === user.id,
    joined: !!registration && registration.status === 'active',
    registrationStatus: registration ? registration.status : '',
    serverNow: now, updatedAt: event.updatedAt
  };
  return view;
}
function pagination(payload) {
  const offset = payload.offset === undefined ? 0 : payload.offset;
  const limit = payload.limit === undefined ? 20 : payload.limit;
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 30) fail('INVALID_INPUT', '分页参数不正确');
  return { offset, limit };
}
function timestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 946684800000 || value > 4102444800000) fail('INVALID_INPUT', label + '不正确');
  return value;
}
function eventInput(payload, now, publish) {
  const data = {
    title: text(payload.title, 80, '活动标题', publish),
    book: text(payload.book, 60, '共读书籍', publish),
    category: text(payload.category, 12, '书籍类别', publish),
    location: text(payload.location, 160, '活动地点', publish),
    description: text(payload.description, 3000, '内容简介', publish),
    preparation: text(payload.preparation, 1500, '参加前准备', false),
    startsAt: payload.startsAt || 0, endsAt: payload.endsAt || 0, deadlineAt: payload.deadlineAt || 0,
    minCapacity: payload.minCapacity || 0, maxCapacity: payload.maxCapacity || 0
  };
  if (data.category && !CATEGORIES.includes(data.category)) fail('INVALID_INPUT', '请选择支持的书籍类别');
  if (publish) {
    timestamp(data.startsAt, '开始时间'); timestamp(data.endsAt, '结束时间'); timestamp(data.deadlineAt, '截止时间');
    if (data.startsAt <= now || data.deadlineAt <= now) fail('INVALID_INPUT', '开始时间和报名截止时间需要晚于当前时间');
    if (data.endsAt <= data.startsAt) fail('INVALID_INPUT', '结束时间必须晚于开始时间');
    if (data.deadlineAt >= data.startsAt) fail('INVALID_INPUT', '报名截止时间必须早于开始时间');
    if (!Number.isInteger(data.minCapacity) || !Number.isInteger(data.maxCapacity) || data.minCapacity < 1 || data.maxCapacity < data.minCapacity || data.maxCapacity > 100) fail('INVALID_INPUT', '读者人数需满足：1 ≤ 最低人数 ≤ 上限 ≤ 100');
  } else {
    for (const key of ['startsAt', 'endsAt', 'deadlineAt', 'minCapacity', 'maxCapacity']) {
      if (!Number.isSafeInteger(data[key]) || data[key] < 0) fail('INVALID_INPUT', '草稿的时间和人数格式不正确');
    }
  }
  data.dateKey = data.startsAt ? dateKey(data.startsAt) : '';
  return data;
}
function registrationId(eventId, userId) { return eventId + '__' + userId; }

function createService(store, options = {}) {
  const clock = options.now || Date.now;
  const makeId = options.makeId || (() => fail('CONFIGURATION', '未配置编号生成器'));
  const checkContent = options.checkContent || (async () => null);
  const readUser = (unit, actor) => unit.get(TABLES.users, actor.id);
  async function readEvent(unit, id) {
    const event = await unit.get(TABLES.events, recordId(id));
    if (!event) fail('NOT_FOUND', '活动不存在或已移除');
    return event;
  }
  const actions = {
    async session(actor) {
      return store.transaction(async unit => {
        let user = await readUser(unit, actor);
        if (!user) {
          const now = clock();
          user = { id: actor.id, nickname: actor.isBootstrap ? '读书会管理员' : '', groupName: '', role: actor.isBootstrap ? 'admin' : 'member', status: actor.isBootstrap ? 'approved' : 'new', createdAt: now, updatedAt: now };
        }
        return { user: userView(user), serverNow: clock() };
      });
    },
    async acceptPrivacy(actor, payload) {
      if (payload.version !== PRIVACY_VERSION || payload.accepted !== true) fail('PRIVACY_REQUIRED', '请阅读并同意当前隐私保护指引');
      const before = await readUser(store, actor);
      const review = before && before.nickname ? await checkContent(actor, [before.nickname, before.groupName], 1) : null;
      return store.transaction(async unit => {
        const current = await readUser(unit, actor);
        if (current && before && (current.nickname !== before.nickname || current.groupName !== before.groupName)) fail('CONFLICT', '会员资料已更新，请重试');
        const now = clock();
        const user = current || { id: actor.id, nickname: actor.isBootstrap ? '读书会管理员' : '', groupName: '', role: actor.isBootstrap ? 'admin' : 'member', status: actor.isBootstrap ? 'approved' : 'new', createdAt: now };
        const next = { ...user, privacyVersion: PRIVACY_VERSION, privacyAcceptedAt: now, updatedAt: now };
        if (review) next.contentReview = review;
        await unit.put(TABLES.users, actor.id, next);
        return { user: userView(next), serverNow: now };
      });
    },
    async applyMembership(actor, payload) {
      const nickname = text(payload.nickname, 24, '社群内昵称');
      const groupName = text(payload.groupName, 60, '所在社群');
      if (isMember(await readUser(store, actor))) fail('ALREADY_MEMBER', '你已经是会员');
      const review = await checkContent(actor, [nickname, groupName], 1);
      return store.transaction(async unit => {
        const user = await readUser(unit, actor);
        if (isMember(user)) fail('ALREADY_MEMBER', '你已经是会员');
        const now = clock();
        const next = { id: actor.id, nickname, groupName, role: 'member', status: 'pending', rejectionReason: '', createdAt: user ? user.createdAt : now, updatedAt: now,
          privacyVersion: user && user.privacyVersion || '', privacyAcceptedAt: user && user.privacyAcceptedAt || 0 };
        if (review) next.contentReview = review;
        await unit.put(TABLES.users, actor.id, next);
        return { user: userView(next), serverNow: now };
      });
    },
    async listMembers(actor, payload) {
      requireAdmin(await readUser(store, actor));
      const page = pagination(payload);
      const status = payload.status || 'pending';
      if (!['pending', 'approved'].includes(status)) fail('INVALID_INPUT', '会员筛选条件不正确');
      const rows = await store.find(TABLES.users, { status }, { ...page, limit: page.limit + 1, orderBy: 'createdAt', direction: 'asc' });
      return { items: rows.slice(0, page.limit).map(userView), hasMore: rows.length > page.limit };
    },
    async reviewMembership(actor, payload) {
      const id = recordId(payload.userId);
      if (!['approve', 'reject'].includes(payload.decision)) fail('INVALID_INPUT', '审核操作不正确');
      const reason = payload.decision === 'reject' ? text(payload.reason, 120, '未通过原因') : '';
      requireAdmin(await readUser(store, actor));
      const before = await store.get(TABLES.users, id);
      if (!before || before.status !== 'pending') fail('CONFLICT', '该申请已处理，请刷新');
      const review = await checkContent(actor, payload.decision === 'approve' ? [before.nickname, before.groupName] : [reason], 1);
      return store.transaction(async unit => {
        requireAdmin(await readUser(unit, actor));
        const target = await unit.get(TABLES.users, id);
        if (!target || target.status !== 'pending') fail('CONFLICT', '该申请已处理，请刷新');
        if (target.nickname !== before.nickname || target.groupName !== before.groupName || target.updatedAt !== before.updatedAt) fail('CONFLICT', '申请资料已更新，请刷新后重新审核');
        const next = { ...target, status: payload.decision === 'approve' ? 'approved' : 'rejected', role: 'member', rejectionReason: reason, updatedAt: clock() };
        if (review) next[payload.decision === 'approve' ? 'contentReview' : 'rejectionReview'] = review;
        await unit.put(TABLES.users, id, next);
        return { user: userView(next) };
      });
    },
    async setOrganizer(actor, payload) {
      const id = recordId(payload.userId);
      if (typeof payload.enabled !== 'boolean') fail('INVALID_INPUT', '组织者设置不正确');
      return store.transaction(async unit => {
        requireAdmin(await readUser(unit, actor));
        const user = await unit.get(TABLES.users, id);
        if (!isMember(user) || user.role === 'admin') fail('FORBIDDEN', '仅可调整普通会员或组织者');
        const next = { ...user, role: payload.enabled ? 'organizer' : 'member', updatedAt: clock() };
        await unit.put(TABLES.users, id, next);
        return { user: userView(next) };
      });
    },
    async listEvents(actor, payload) {
      const user = await readUser(store, actor); requireMember(user);
      const page = pagination(payload);
      const criteria = { published: true, endsAt: { $gt: clock() } };
      if (payload.category && payload.category !== '全部') {
        if (!CATEGORIES.includes(payload.category)) fail('INVALID_INPUT', '书籍类别不正确');
        criteria.category = payload.category;
      }
      if (payload.date) {
        const parsed = Date.parse(payload.date + 'T00:00:00Z');
        if (typeof payload.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== payload.date) fail('INVALID_INPUT', '日期不正确');
        criteria.dateKey = payload.date;
      }
      const now = clock();
      const events = await store.find(TABLES.events, criteria, { ...page, limit: page.limit + 1, orderBy: 'startsAt', direction: 'asc' });
      return { items: events.slice(0, page.limit).map(event => eventView(event, user, now)), hasMore: events.length > page.limit, serverNow: now };
    },
    async getEvent(actor, payload) {
      const user = await readUser(store, actor); requireMember(user);
      const event = await readEvent(store, payload.id);
      if (!event.published && !canManage(user, event)) fail('NOT_FOUND', '活动不存在或尚未发布');
      const registration = await store.get(TABLES.registrations, registrationId(event.id, user.id));
      return { event: eventView(event, user, clock(), registration) };
    },
    async saveEvent(actor, payload) {
      if (typeof payload.publish !== 'boolean') fail('INVALID_INPUT', '请明确保存草稿或发布活动');
      const id = payload.id ? recordId(payload.id) : recordId(makeId());
      const author = await readUser(store, actor);
      if (!isOrganizer(author)) fail('FORBIDDEN', '只有管理员和指定组织者可以发起活动');
      const before = payload.id ? await readEvent(store, id) : null;
      if (before && !canManage(author, before)) fail('FORBIDDEN', '只能管理自己发起的活动');
      const checkedFields = eventInput(payload, clock(), payload.publish);
      const review = payload.publish ? await checkContent(actor,
        [checkedFields.title, checkedFields.book, checkedFields.location, checkedFields.description, checkedFields.preparation, before ? before.organizerName : author.nickname], 3) : null;
      return store.transaction(async unit => {
        const user = await readUser(unit, actor);
        if (!isOrganizer(user)) fail('FORBIDDEN', '只有管理员和指定组织者可以发起活动');
        const existing = payload.id ? await readEvent(unit, id) : null;
        if (existing && !canManage(user, existing)) fail('FORBIDDEN', '只能管理自己发起的活动');
        if (existing && !['draft', 'open'].includes(existing.status)) fail('CONFLICT', '该活动已确认或取消，无法编辑');
        if (existing && existing.published && !payload.publish) fail('CONFLICT', '已发布活动不能转回草稿');
        const now = clock();
        const fields = eventInput(payload, now, payload.publish);
        if (existing && existing.count > 0) {
          const fixed = ['startsAt', 'endsAt', 'deadlineAt', 'location', 'minCapacity', 'maxCapacity'];
          if (fixed.some(key => fields[key] !== existing[key])) fail('CONFLICT', '已有成员报名，时间、地点和人数设置不能直接修改');
        }
        const next = { ...fields, id, status: payload.publish ? 'open' : 'draft', published: payload.publish,
          createdBy: existing ? existing.createdBy : user.id, organizerName: existing ? existing.organizerName : user.nickname,
          count: existing ? existing.count : 0, createdAt: existing ? existing.createdAt : now, updatedAt: now,
          cancellationReason: '' };
        if (review) next.contentReview = review;
        await unit.put(TABLES.events, id, next);
        return { event: eventView(next, user, now) };
      });
    },
    async joinEvent(actor, payload) {
      return store.transaction(async unit => {
        const user = await readUser(unit, actor); requireMember(user);
        const event = await readEvent(unit, payload.id);
        const now = clock();
        if (!event.published || stateOf(event, now) !== 'open') fail('REGISTRATION_CLOSED', '该活动已停止报名');
        if (event.createdBy === user.id) fail('HOST_NOT_ATTENDEE', '组织者无需占用读者名额');
        const id = registrationId(event.id, user.id);
        const previous = await unit.get(TABLES.registrations, id);
        if (previous && previous.status === 'active') return { event: eventView(event, user, now, previous) };
        if (event.count >= event.maxCapacity) fail('EVENT_FULL', '活动已满员');
        const registration = { id, eventId: event.id, userId: user.id, nickname: user.nickname, status: 'active', createdAt: previous ? previous.createdAt : now, updatedAt: now };
        const next = { ...event, count: event.count + 1, updatedAt: now };
        await unit.put(TABLES.registrations, id, registration);
        await unit.put(TABLES.events, event.id, next);
        return { event: eventView(next, user, now, registration) };
      });
    },
    async cancelRegistration(actor, payload) {
      return store.transaction(async unit => {
        const user = await readUser(unit, actor); requireMember(user);
        const event = await readEvent(unit, payload.id);
        const now = clock();
        if (!event.published || stateOf(event, now) !== 'open') fail('REGISTRATION_CLOSED', '报名已截止，请联系组织者处理');
        const id = registrationId(event.id, user.id);
        const previous = await unit.get(TABLES.registrations, id);
        if (!previous || previous.status !== 'active') return { event: eventView(event, user, now, previous) };
        if (event.count <= 0) fail('CONFLICT', '报名人数异常，请联系组织者');
        const registration = { ...previous, status: 'cancelled', updatedAt: now };
        const next = { ...event, count: event.count - 1, updatedAt: now };
        await unit.put(TABLES.registrations, id, registration);
        await unit.put(TABLES.events, event.id, next);
        return { event: eventView(next, user, now, registration) };
      });
    },
    async decideEvent(actor, payload) {
      if (!['confirm', 'cancel'].includes(payload.decision)) fail('INVALID_INPUT', '举办决定不正确');
      const reason = payload.decision === 'cancel' ? text(payload.reason, 160, '取消原因') : '';
      const manager = await readUser(store, actor), before = await readEvent(store, payload.id);
      if (!canManage(manager, before)) fail('FORBIDDEN', '只有活动组织者和管理员可以决定举办结果');
      const review = reason ? await checkContent(actor, [reason], 3) : null;
      return store.transaction(async unit => {
        const user = await readUser(unit, actor);
        const event = await readEvent(unit, payload.id);
        if (!canManage(user, event)) fail('FORBIDDEN', '只有活动组织者和管理员可以决定举办结果');
        const now = clock();
        if (!event.published || ['cancelled', 'draft'].includes(event.status) || now >= event.endsAt) fail('CONFLICT', '该活动已结束或无法操作');
        if (payload.decision === 'confirm') {
          if (now < event.deadlineAt) fail('BEFORE_DEADLINE', '请在报名截止后确认举办');
          if (now >= event.startsAt) fail('CONFLICT', '活动已到开始时间，不能补确认');
          if (event.count < event.minCapacity) fail('NOT_ENOUGH_READERS', '报名人数尚未达到最低要求');
        }
        const next = { ...event, status: payload.decision === 'confirm' ? 'confirmed' : 'cancelled', cancellationReason: reason, updatedAt: now };
        if (review) next.cancellationReview = review;
        await unit.put(TABLES.events, event.id, next);
        return { event: eventView(next, user, now) };
      });
    },
    async listRegistrations(actor, payload) {
      const user = await readUser(store, actor);
      requireMember(user);
      const event = await readEvent(store, payload.id);
      if (!canManage(user, event)) fail('FORBIDDEN', '只有活动组织者和管理员可以查看名单');
      const page = pagination(payload);
      const rows = await store.find(TABLES.registrations, { eventId: event.id, status: 'active' }, { ...page, limit: page.limit + 1, orderBy: 'createdAt', direction: 'asc' });
      return { items: rows.slice(0, page.limit).map(row => ({ id: row.id, nickname: row.nickname, joinedAt: row.updatedAt })), hasMore: rows.length > page.limit, event: eventView(event, user, clock()) };
    },
    async myEvents(actor, payload) {
      const user = await readUser(store, actor); requireMember(user);
      const page = pagination(payload); const now = clock();
      if (payload.kind === 'created') {
        if (!isOrganizer(user)) fail('FORBIDDEN', '仅组织者可查看发起记录');
        const rows = await store.find(TABLES.events, { createdBy: user.id }, { ...page, limit: page.limit + 1, orderBy: 'createdAt', direction: 'desc' });
        return { items: rows.slice(0, page.limit).map(event => eventView(event, user, now)), hasMore: rows.length > page.limit };
      }
      if (payload.kind !== 'joined') fail('INVALID_INPUT', '活动记录类型不正确');
      const rows = await store.find(TABLES.registrations, { userId: user.id }, { ...page, limit: page.limit + 1, orderBy: 'updatedAt', direction: 'desc' });
      const events = await Promise.all(rows.slice(0, page.limit).map(async registration => {
        const event = await store.get(TABLES.events, registration.eventId);
        return event ? eventView(event, user, now, registration) : null;
      }));
      return { items: events.filter(Boolean), hasMore: rows.length > page.limit };
    }
  };
  return {
    async call(actor, action, payload = {}) {
      if (!actor || typeof actor.id !== 'string' || !actor.id) fail('UNAUTHENTICATED', '请从微信小程序进入');
      if (!Object.prototype.hasOwnProperty.call(actions, action)) fail('INVALID_ACTION', '暂不支持此操作');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('INVALID_INPUT', '请求格式不正确');
      if (options.requirePrivacy && !['session', 'acceptPrivacy'].includes(action)) {
        const user = await readUser(store, actor);
        if (!user || user.privacyVersion !== PRIVACY_VERSION) fail('PRIVACY_REQUIRED', '请使用最新版小程序，阅读并同意隐私保护指引');
      }
      return actions[action](actor, payload);
    }
  };
}
module.exports = { CATEGORIES, TABLES, PRIVACY_VERSION, ClubError, createService, isMember, isOrganizer, isAdmin, canManage, stateOf, dateKey, registrationId };
