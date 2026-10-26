'use strict';
const VERSION = '2026-10-24.2';
const CATEGORIES = ['社会', '历史', '心理', '文学', 'AI', '商业', '哲学'];
const TABLES = { users: 'club_v2_users', events: 'club_v2_events', registrations: 'club_v2_registrations', private: 'club_v2_event_private', notices: 'club_v2_notices', hosts: 'club_v2_hosts', assets: 'club_v2_assets', otp: 'club_v2_otp', subscriptions: 'club_v2_subscriptions' };
class ClubError extends Error { constructor(code, message) { super(message); this.code = code; } }
function fail(code, message) { throw new ClubError(code, message); }
function text(value, label, max, required = true) {
  const s = typeof value === 'string' ? value.trim() : '';
  if ((required && !s) || s.length > max) fail('VALIDATION', label + '请填写完整，且不超过' + max + '字');
  return s;
}
const validId = id => typeof id === 'string' && /^[\w-]{2,100}$/.test(id);
const regId = (event, user) => event + '__' + user;
const publicUser = (u, self = false) => u ? { id: u.id, nickname: self || u.privacyVersion === VERSION ? u.nickname || '书友' : '书友', avatar: self || u.privacyVersion === VERSION ? u.avatar || '' : '', bio: self || u.privacyVersion === VERSION ? u.bio || '' : '' } : null;
const selfUser = u => u ? { ...publicUser(u, true), member: u.status === 'active', role: u.role || 'member', privacyVersion: u.privacyVersion, migrated: !!u.migrated } : null;
function createService(store, options = {}) {
  const now = options.now || Date.now, makeId = options.makeId || (() => 'e_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const checkContent = options.checkContent || (async () => fail('CONTENT_UNAVAILABLE', '内容审核尚未接通，暂不能发布'));
  async function member(unit, actor) {
    const user = await unit.get(TABLES.users, actor.id);
    if (!user || user.status !== 'active') fail('MEMBER_REQUIRED', '请先免费注册会员');
    if (user.privacyVersion !== VERSION) fail('PRIVACY_REQUIRED', '请阅读并同意新版隐私指引');
    return user;
  }
  async function event(unit, id) {
    if (!validId(id)) fail('NOT_FOUND', '活动不存在');
    const row = await unit.get(TABLES.events, id);
    if (!row) fail('NOT_FOUND', '活动不存在');
    return row;
  }
  function editable(e, u) { if (e.creatorId !== u.id && u.role !== 'admin') fail('FORBIDDEN', '仅发起人可管理此活动'); }
  function open(e, u) { if (e.visibility === 'legacy_members' && !u?.migrated && u?.role !== 'admin') fail('FORBIDDEN', '此活动仅向原有会员开放'); if (e.status !== 'published' || now() >= e.signupUntil || now() >= e.startAt) fail('CLOSED', '活动已截止报名'); }
  function publicEvent(e) { const { internal, ...result } = e; return result; }
  async function asset(unit, id, user, kind) {
    if (!id) return '';
    const a = await unit.get(TABLES.assets, id);
    if (!a || a.ownerId !== user.id || a.kind !== kind || a.status !== 'approved') fail('MEDIA_INVALID', '请重新上传已审核的图片');
    return id;
  }
  async function notice(unit, userId, key, message, eventId, result='状态更新') {
    if (await unit.get(TABLES.notices, key)) return;
    const sub = await unit.get(TABLES.subscriptions, regId(eventId, userId));
    // The button grants a waitlist-result reminder, never an unrelated host notification.
    // Existing consent rows also came from this button and retain the same narrow scope.
    const requested = ['候补成功', '活动取消'].includes(result) && (!sub?.purpose || sub.purpose === 'waitlist');
    const queued = !!options.notificationsEnabled && requested && sub?.remaining > 0;
    if (queued) { sub.remaining -= 1; await unit.put(TABLES.subscriptions, sub.id, sub); }
    await unit.put(TABLES.notices, key, { id: key, userId, eventId, message, result, createdAt: now(), read: false, delivery: 'in_app', pushStatus: queued ? 'queued' : !options.notificationsEnabled ? 'not_configured' : !requested ? 'not_requested' : 'not_subscribed' });
  }
  async function promote(unit, e) {
    if (e.status !== 'published' || now() >= e.signupUntil || now() >= e.startAt) return;
    while (e.count < e.capacity) {
      const rows = await unit.find(TABLES.registrations, { eventId: e.id, status: 'waitlist' }, { orderBy: 'queueNo', limit: 1 });
      if (!rows.length) break;
      const r = rows[0]; r.status = 'registered'; r.promotedAt = now(); r.updatedAt = now(); e.count += 1; e.waitCount = Math.max(0, e.waitCount - 1);
      await unit.put(TABLES.registrations, r.id, r);
      await notice(unit, r.userId, r.id + '_promoted_' + r.queueNo, '候补成功：你已获得《' + e.title + '》的活动名额。', e.id, '候补成功');
    }
  }
  const actions = {
    async capabilities() { return options.capabilities || { authentication: 'wechat', sms: false, subscriptionTemplateId: '' }; },
    async authorizeNotification(actor, p) {
      if (!options.notificationsEnabled || !actor.openid) fail('NOT_CONFIGURED', '微信订阅提醒尚未配置，站内通知可正常使用');
      return store.transaction(async unit => {
        await member(unit, actor); const e = await event(unit, p.id), r = await unit.get(TABLES.registrations, regId(e.id, actor.id));
        if (!r || !['registered', 'waitlist'].includes(r.status) || p.accepted !== true) fail('FORBIDDEN', '仅已报名或候补成员可授权提醒');
        const id = regId(e.id, actor.id); await unit.put(TABLES.subscriptions, id, { id, openid: actor.openid, userId: actor.id, eventId: e.id, purpose: 'waitlist', remaining: 1, updatedAt: now() });
        return { saved: true };
      });
    },
    async listEvents(actor, p) {
      const criteria = { status: 'published', visibility: 'public' };
      if (p.category && p.category !== '全部') { if (!CATEGORIES.includes(p.category)) fail('VALIDATION', '分类无效'); criteria.category = p.category; }
      if (p.date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !Number.isFinite(Date.parse(p.date + 'T00:00:00+08:00')) || new Date(Date.parse(p.date + 'T00:00:00+08:00') + 28800000).toISOString().slice(0, 10) !== p.date) fail('VALIDATION', '日期无效');
        criteria.dateKey = p.date;
      } else criteria.startAt = { $gt: now() - 86400000 };
      const offset = Math.max(0, Math.min(10000, Number(p.offset) || 0));
      const rows = await store.find(TABLES.events, criteria, { orderBy: 'startAt', offset, limit: 21 });
      return { events: rows.slice(0, 20).map(publicEvent), hasMore: rows.length > 20 };
    },
    async session(actor) { return { user: selfUser(await store.get(TABLES.users, actor.id)) }; },
    async requestOtp() {
      fail('AUTH_METHOD_CHANGED', '本版使用微信身份免费注册，无需手机号或短信验证码');
    },
    async register(actor, p) {
      if (p.accepted !== true || p.version !== VERSION) fail('PRIVACY_REQUIRED', '请先阅读并同意用户协议和隐私指引');
      const before = await store.get(TABLES.users, actor.id);
      if (before && before.status !== 'active') fail('MEMBER_RESTRICTED', '账号暂不可用，请联系管理员');
      const nickname = before?.nickname || text(p.nickname, '昵称', 24);
      if (!before) await checkContent(actor, nickname, 'profile');
      return store.transaction(async unit => {
        const old = await unit.get(TABLES.users, actor.id);
        if (old && old.status !== 'active') fail('MEMBER_RESTRICTED', '账号暂不可用，请联系管理员');
        // The identity comes from the trusted cloud context, never the request body.
        const u = { ...(old || {}), id: actor.id, nickname: old?.nickname || nickname, bio: old?.bio || '', avatar: old?.avatar || '', role: old?.role || 'member', status: 'active', authMethod: 'wechat', privacyVersion: VERSION, privacyAcceptedAt: now(), createdAt: old?.createdAt || now(), updatedAt: now() };
        await unit.put(TABLES.users, u.id, u);
        return { user: selfUser(u) };
      });
    },
    async acceptPrivacy(actor, p) {
      if (p.accepted !== true || p.version !== VERSION) fail('PRIVACY_REQUIRED', '需要明确同意当前隐私指引');
      return store.transaction(async unit => {
        const u = await unit.get(TABLES.users, actor.id);
        if (!u) return { user: null };
        u.privacyVersion = VERSION; u.privacyAcceptedAt = now(); u.updatedAt = now(); await unit.put(TABLES.users, u.id, u); return { user: selfUser(u) };
      });
    },
    async updateProfile(actor, p) {
      const u = await member(store, actor);
      const nickname = text(p.nickname, '昵称', 24), bio = text(p.bio, '自我介绍', 200, false);
      await checkContent(actor, nickname + '\n' + bio, 'profile');
      return store.transaction(async unit => {
        const current = await member(unit, actor); current.nickname = nickname; current.bio = bio;
        current.avatar = await asset(unit, p.avatar || u.avatar, current, 'avatar');
        current.updatedAt = now(); await unit.put(TABLES.users, current.id, current); return { user: selfUser(current) };
      });
    },
    async getEvent(actor, p) {
      const e = await event(store, p.id), u = await store.get(TABLES.users, actor.id);
      if (e.visibility === 'legacy_members' && (!u || !u.migrated && u.role !== 'admin')) fail('NOT_FOUND', '此活动仅向原有会员开放');
      if (e.status === 'draft' && (!u || (e.creatorId !== u.id && u.role !== 'admin'))) fail('NOT_FOUND', '活动不存在');
      const registration = await store.get(TABLES.registrations, regId(e.id, actor.id));
      const creator = publicUser(await store.get(TABLES.users, e.creatorId));
      const rows = await store.find(TABLES.registrations, { eventId: e.id, status: 'registered' }, { orderBy: 'createdAt', limit: 100 });
      const members = await Promise.all(rows.map(async r => ({ ...publicUser(await store.get(TABLES.users, r.userId)), checkedIn: !!r.checkedAt, host: e.hostId === r.userId })));
      const hostRequest = await store.get(TABLES.hosts, regId(e.id, actor.id));
      return { event: publicEvent(e), creator, members, registration, hostRequest, canManage: !!u && (e.creatorId === u.id || u.role === 'admin') };
    },
    async join(actor, p) {
      return store.transaction(async unit => {
        const u = await member(unit, actor), e = await event(unit, p.id); open(e, u);
        const id = regId(e.id, u.id), old = await unit.get(TABLES.registrations, id);
        if (old && ['registered', 'waitlist'].includes(old.status)) return { registration: old, event: publicEvent(e) };
        await promote(unit, e);
        const queue = p.waitlist === true;
        if (queue && e.waitCount >= 100) fail('QUEUE_FULL', '候补队列已满，请选择其他场次');
        if (!queue && e.count >= e.capacity) fail('FULL', '名额已满，可点击候补按顺序排队');
        if (queue && e.count < e.capacity) fail('HAS_SPACE', '当前还有名额，请直接报名');
        const r = { id, eventId: e.id, userId: u.id, status: queue ? 'waitlist' : 'registered', createdAt: now(), updatedAt: now(), queueNo: queue ? ++e.nextQueue : 0 };
        if (queue) e.waitCount += 1; else e.count += 1;
        e.version += 1; await unit.put(TABLES.events, e.id, e); await unit.put(TABLES.registrations, id, r);
        return { registration: r, event: publicEvent(e) };
      });
    },
    async cancelRegistration(actor, p) {
      return store.transaction(async unit => {
        await member(unit, actor); const e = await event(unit, p.id), id = regId(e.id, actor.id), r = await unit.get(TABLES.registrations, id);
        if (!r || r.status === 'cancelled') return { event: publicEvent(e) };
        if (now() >= e.startAt) fail('CLOSED', '活动已开始，请联系发起人处理');
        if (r.status === 'registered') e.count = Math.max(0, e.count - 1); else if (r.status === 'waitlist') e.waitCount = Math.max(0, e.waitCount - 1);
        r.status = 'cancelled'; r.updatedAt = now(); await unit.put(TABLES.registrations, id, r);
        if (e.hostId === actor.id) e.hostId = '';
        await promote(unit, e); e.version += 1; await unit.put(TABLES.events, e.id, e);
        return { event: publicEvent(e) };
      });
    },
    async groupCode(actor, p) {
      await member(store, actor); const e = await event(store, p.id), r = await store.get(TABLES.registrations, regId(e.id, actor.id));
      if (e.status === 'cancelled' || (!r || r.status !== 'registered') && e.creatorId !== actor.id) fail('FORBIDDEN', '报名成功后可查看活动群码');
      const secret = await store.get(TABLES.private, e.id);
      if (!secret?.groupAsset) fail('NO_GROUP_CODE', '发起人尚未上传群码，请稍后查看');
      return { assetId: secret.groupAsset };
    },
    async saveEvent(actor, p) {
      const before = p.id ? await event(store, p.id) : null, user = await member(store, actor);
      if (before) editable(before, user);
      const fields = { title: text(p.title, '活动主题', 60), book: text(p.book || p.title, '书名', 60), category: p.category, location: text(p.location, '活动地点', 120), address: text(p.address, '详细地址', 180, false), description: text(p.description, '内容简介', 4000), remarks: text(p.remarks, '推荐语与备注', 2000, false), agenda: text(p.agenda, '活动流程', 4000), startAt: Number(p.startAt), endAt: Number(p.endAt), signupUntil: Number(p.signupUntil), capacity: Number(p.capacity), latitude: p.latitude === null || p.latitude === undefined || p.latitude === '' ? null : Number(p.latitude), longitude: p.longitude === null || p.longitude === undefined || p.longitude === '' ? null : Number(p.longitude) };
      if (!CATEGORIES.includes(fields.category)) fail('VALIDATION', '请选择活动分类');
      if (!Number.isInteger(fields.capacity) || fields.capacity < 2 || fields.capacity > 100) fail('VALIDATION', '人数限制为2至100人');
      if (![fields.startAt, fields.endAt, fields.signupUntil].every(n => Number.isSafeInteger(n) && n < 4102444800000) || fields.startAt <= now() || fields.endAt <= fields.startAt || fields.signupUntil > fields.startAt || fields.signupUntil <= now()) fail('VALIDATION', '请设置有效的未来活动时间及报名截止时间');
      if ((fields.latitude !== null || fields.longitude !== null) && !(Math.abs(fields.latitude) <= 90 && Math.abs(fields.longitude) <= 180 && fields.latitude !== null && fields.longitude !== null)) fail('VALIDATION', '地图坐标不正确，请重新选点');
      const status = p.publish === true ? 'published' : 'draft';
      await checkContent(actor, [fields.title, fields.book, fields.location, fields.address, fields.description, fields.remarks, fields.agenda].join('\n'), 'event');
      return store.transaction(async unit => {
        const u = await member(unit, actor), existing = before ? await event(unit, before.id) : null;
        if (existing) { editable(existing, u); if (existing.version !== before.version) fail('CONFLICT', '活动已更新，请刷新后重试'); if (existing.count || existing.waitCount) fail('HAS_REGISTRATIONS', '已有报名，请先联系成员；本版不支持修改有报名的活动'); if (existing.status === 'cancelled' || now() >= existing.startAt) fail('CLOSED', '已取消或已开始的活动不能编辑'); }
        const cover = await asset(unit, p.cover || existing?.cover, u, 'cover'), groupAsset = await asset(unit, p.groupAsset, u, 'group');
        const e = { ...(existing || {}), ...fields, visibility: 'public', dateKey: new Date(fields.startAt + 28800000).toISOString().slice(0, 10), id: existing?.id || makeId(), creatorId: existing?.creatorId || u.id, creatorName: u.nickname, cover, status, count: existing?.count || 0, waitCount: 0, nextQueue: 0, hostId: existing?.hostId || '', version: (existing?.version || 0) + 1, createdAt: existing?.createdAt || now(), updatedAt: now() };
        await unit.put(TABLES.events, e.id, e);
        const secret = await unit.get(TABLES.private, e.id) || { id: e.id };
        if (p.groupAsset !== undefined) secret.groupAsset = groupAsset;
        if (p.checkinCode !== undefined) { if (!/^\d{6}$/.test(p.checkinCode)) fail('VALIDATION', '签到口令需要六位数字'); secret.checkinCode = p.checkinCode; }
        await unit.put(TABLES.private, e.id, secret); return { event: publicEvent(e) };
      });
    },
    async cancelEvent(actor, p) {
      const reason = text(p.reason, '取消原因', 200);
      const before = await event(store, p.id), manager = await member(store, actor); editable(before, manager);
      await checkContent(actor, reason, 'event');
      return store.transaction(async unit => {
        const u = await member(unit, actor), e = await event(unit, p.id); editable(e, u);
        if (e.version !== before.version) fail('CONFLICT', '活动状态已更新，请刷新后再取消');
        if (e.status === 'cancelled') return { event: publicEvent(e) };
        e.status = 'cancelled'; e.cancellationReason = reason; e.version += 1; await unit.put(TABLES.events, e.id, e);
        for (let offset = 0; ; offset += 100) {
          const regs = await unit.find(TABLES.registrations, { eventId: e.id }, { offset, limit: 100 });
          for (const r of regs) if (r.status !== 'cancelled') await notice(unit, r.userId, r.id + '_event_cancelled', '活动已取消：' + e.title + '。原因：' + reason, e.id, '活动取消');
          if (regs.length < 100) break;
        }
        return { event: publicEvent(e) };
      });
    },
    async requestHost(actor, p) {
      return store.transaction(async unit => {
        const u = await member(unit, actor); const e = await event(unit, p.id); open(e, u);
        const id = regId(e.id, actor.id), r = await unit.get(TABLES.registrations, id);
        if (!r || r.status !== 'registered') fail('SIGNUP_REQUIRED', '请先报名，再申请主持');
        if (e.hostId) fail('HOST_ASSIGNED', '本次活动已有主持人');
        const previous = await unit.get(TABLES.hosts, id);
        if (previous?.status === 'pending') return { request: previous };
        const row = { id, eventId: e.id, userId: actor.id, status: 'pending', createdAt: now() };
        e.version += 1; await unit.put(TABLES.events, e.id, e); await unit.put(TABLES.hosts, id, row);
        await notice(unit, e.creatorId, id + '_host_' + e.version, '有书友申请主持《' + e.title + '》，请在活动管理中处理。', e.id, '收到申请');
        return { request: row };
      });
    },
    async reviewHost(actor, p) {
      return store.transaction(async unit => {
        const u = await member(unit, actor), e = await event(unit, p.id); editable(e, u); open(e, u);
        const id = regId(e.id, p.userId), request = await unit.get(TABLES.hosts, id), r = await unit.get(TABLES.registrations, id);
        if (!request || request.status !== 'pending') fail('NOT_FOUND', '申请已处理或不存在');
        if (p.approved && (!r || r.status !== 'registered')) fail('SIGNUP_REQUIRED', '该书友已退出报名');
        if (p.approved && e.hostId) fail('HOST_ASSIGNED', '本次活动已有主持人');
        request.status = p.approved ? 'approved' : 'declined'; if (p.approved) e.hostId = p.userId;
        e.version += 1; await unit.put(TABLES.events, e.id, e); await unit.put(TABLES.hosts, id, request);
        await notice(unit, p.userId, id + '_review_' + e.version, '主持人申请' + (p.approved ? '已通过' : '未通过') + '：《' + e.title + '》。', e.id, p.approved?'申请通过':'申请未通过');
        return { event: publicEvent(e) };
      });
    },
    async manageEvent(actor, p) {
      const u = await member(store, actor), e = await event(store, p.id); editable(e, u);
      const requests = await store.find(TABLES.hosts, { eventId: e.id, status: 'pending' }, { limit: 100 });
      const hosts = await Promise.all(requests.map(async r => ({ ...r, profile: publicUser(await store.get(TABLES.users, r.userId)) })));
      const secret = await store.get(TABLES.private, e.id);
      return { hosts, checkinCode: secret?.checkinCode || '', groupAsset: secret?.groupAsset || '' };
    },
    async updatePrivate(actor, p) {
      return store.transaction(async unit => {
        const u = await member(unit, actor), e = await event(unit, p.id); editable(e, u);
        if (e.status === 'cancelled') fail('CLOSED', '活动已取消');
        const secret = await unit.get(TABLES.private, e.id) || { id: e.id };
        if (p.groupAsset) secret.groupAsset = await asset(unit, p.groupAsset, u, 'group');
        if (p.checkinCode !== undefined) { if (!/^\d{6}$/.test(p.checkinCode)) fail('VALIDATION', '口令需要六位数字'); secret.checkinCode = p.checkinCode; }
        e.version += 1; await unit.put(TABLES.events, e.id, e); await unit.put(TABLES.private, e.id, secret);
        return { saved: true };
      });
    },
    async checkIn(actor, p) {
      const result = await store.transaction(async unit => {
        await member(unit, actor); const e = await event(unit, p.id), id = regId(e.id, actor.id), r = await unit.get(TABLES.registrations, id);
        if (!r || r.status !== 'registered' || e.status !== 'published') fail('SIGNUP_REQUIRED', '仅已报名成员可以签到');
        if (r.checkedAt) return { registration: r };
        if (now() < e.startAt - 1800000 || now() > e.endAt) fail('CHECKIN_CLOSED', '签到在活动开始前30分钟至结束期间开放');
        const secret = await unit.get(TABLES.private, e.id);
        const limitId = id + '_checkin', limit = await unit.get(TABLES.hosts, limitId), window = Math.floor(now() / 600000);
        if (limit?.window === window && limit.count >= 6) return { error: { code: 'CHECKIN_LIMIT', message: '尝试次数过多，请10分钟后再试或联系主持人' } };
        if (!secret?.checkinCode || p.code !== secret.checkinCode) {
          await unit.put(TABLES.hosts, limitId, { id: limitId, window, count: limit?.window === window ? limit.count + 1 : 1 });
          return { error: { code: 'CODE_INVALID', message: '签到口令不正确，请向现场主持人确认' } };
        }
        r.checkedAt = now(); await unit.put(TABLES.registrations, id, r); return { registration: r };
      });
      if (result.error) fail(result.error.code, result.error.message);
      return result;
    },
    async myActivities(actor, p) {
      await member(store, actor);
      if (p.tab === 'created') { const events = await store.find(TABLES.events, { creatorId: actor.id }, { orderBy: 'createdAt', direction: 'desc', offset: p.offset || 0, limit: 21 }); return { events: events.slice(0, 20).map(publicEvent), hasMore: events.length > 20 }; }
      const offset = Math.max(0, Number(p.offset) || 0), rows = await store.find(TABLES.registrations, { userId: actor.id }, { orderBy: 'createdAt', direction: 'desc', offset, limit: 21 });
      const events = [];
      for (const r of rows.slice(0, 20)) if (r.status !== 'cancelled') {
        const e = await event(store, r.eventId), past = e.endAt < now();
        if ((p.tab === 'attended' && (r.checkedAt || past && e.status !== 'cancelled')) || (p.tab !== 'attended' && !r.checkedAt && (!past || e.status === 'cancelled'))) events.push({ ...publicEvent(e), myStatus: r.checkedAt ? 'checked_in' : past ? 'ended' : r.status });
      }
      return { events, hasMore: rows.length > 20, nextOffset: offset + 20 };
    },
    async notices(actor, p) {
      await member(store, actor);
      return { notices: await store.find(TABLES.notices, { userId: actor.id }, { orderBy: 'createdAt', direction: 'desc', offset: p.offset || 0, limit: 20 }) };
    }
  };
  return { call(actor, action, payload = {}) {
    if (!actor || !validId(actor.id)) return Promise.reject(new ClubError('UNAUTHENTICATED', '请从微信进入'));
    if (!Object.prototype.hasOwnProperty.call(actions, action)) return Promise.reject(new ClubError('UNKNOWN_ACTION', '暂不支持此操作'));
    return Promise.resolve(actions[action](actor, payload));
  } };
}
module.exports = { createService, ClubError, TABLES, CATEGORIES, VERSION };
