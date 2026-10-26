'use strict';
const { TABLES, dateKey, registrationId } = require('../shared/domain');
const PERSONAS = [
  { id: 'u_demo_reader', name: '普通会员 · 体验报名' },
  { id: 'u_demo_host', name: '组织者 · 发布及确认活动' },
  { id: 'u_demo_admin', name: '管理员 · 审核及设置组织者' },
  { id: 'u_demo_new', name: '未加入书友 · 申请会员' },
  { id: 'u_demo_pending', name: '待审核书友 · 查看申请状态' }
];
function makeSeed(now) {
  const users = {};
  function user(id, nickname, role = 'member', status = 'approved') {
    users[id] = { id, nickname, groupName: '周末共读群', role, status, createdAt: now, updatedAt: now };
  }
  user('u_demo_admin', '读书会管理员', 'admin'); user('u_demo_host', '小熊', 'organizer');
  user('u_demo_reader', '书友小林'); user('u_demo_new', '', 'member', 'new'); user('u_demo_pending', '书友小周', 'member', 'pending');
  for (let index = 1; index <= 3; index++) user('u_demo_attendee' + index, '书友 ' + index);
  const targetDate = dateKey(now + 8 * 86400000);
  const startsAt = Date.parse(targetDate + 'T14:00:00+08:00');
  const first = {
    id: 'e_demo_positive', title: '《正面管教》共读会', book: '正面管教', category: '心理',
    location: '社群书房 · 演示地点', description: '围绕家庭会议，交流亲子相处的真实问题。带着自己的观察来，让阅读与生活发生联系。',
    preparation: '提前阅读相关内容，带来一个希望讨论的生活问题。具体章节由组织者确认。',
    startsAt, endsAt: startsAt + 7200000, deadlineAt: startsAt - 18 * 3600000,
    minCapacity: 4, maxCapacity: 8, count: 3, dateKey: targetDate, status: 'open', published: true,
    createdBy: 'u_demo_host', organizerName: '小熊', cancellationReason: '', createdAt: now, updatedAt: now
  };
  const second = { ...first, id: 'e_demo_nextday', title: '《正面管教》第二场共读', startsAt: startsAt + 86400000, endsAt: startsAt + 93600000, deadlineAt: first.deadlineAt + 86400000, dateKey: dateKey(startsAt + 86400000), count: 0 };
  const registrations = {};
  for (let index = 1; index <= 3; index++) {
    const userId = 'u_demo_attendee' + index, id = registrationId(first.id, userId);
    registrations[id] = { id, eventId: first.id, userId, nickname: '书友 ' + index, status: 'active', createdAt: now, updatedAt: now };
  }
  return { [TABLES.users]: users, [TABLES.events]: { [first.id]: first, [second.id]: second }, [TABLES.registrations]: registrations };
}
module.exports = { PERSONAS, makeSeed };
