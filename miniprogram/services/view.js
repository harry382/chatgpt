'use strict';
const { isMember, isOrganizer, isAdmin } = require('../shared/domain');
const pad = number => String(number).padStart(2, '0');
function parts(timestamp) {
  const date = new Date(timestamp + 8 * 3600000);
  return { date: date.toISOString().slice(0, 10), month: date.getUTCMonth() + 1, day: date.getUTCDate(), week: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getUTCDay()], time: pad(date.getUTCHours()) + ':' + pad(date.getUTCMinutes()) };
}
function eventView(event) {
  const start = parts(event.startsAt || event.serverNow), end = parts(event.endsAt || event.serverNow), deadline = parts(event.deadlineAt || event.serverNow);
  const labels = { draft: '草稿', decision_due: '报名已截止 · 待组织者确认', confirmed: '已确认举办', cancelled: '活动已取消', ended: '活动已结束', expired: '已过期 · 未确认举办' };
  let statusLabel = labels[event.status];
  if (event.status === 'open') statusLabel = event.count >= event.maxCapacity ? '已满员 · 待组织者确认' : event.count >= event.minCapacity ? '已达最低人数 · 待确认' : '还差 ' + (event.minCapacity - event.count) + ' 人达到最低人数';
  let actionLabel = '报名参加', actionDisabled = false;
  if (event.status !== 'open') { actionLabel = event.joined ? '已报名 · ' + (labels[event.status] || '') : (labels[event.status] || '报名不可用'); actionDisabled = true; }
  else if (event.isHost) { actionLabel = '你是本场组织者'; actionDisabled = true; }
  else if (event.joined) actionLabel = '取消报名';
  else if (event.count >= event.maxCapacity) { actionLabel = '活动已满员'; actionDisabled = true; }
  return { ...event, dateLabel: start.month + '月' + start.day + '日', weekLabel: start.week, timeLabel: start.time + '—' + end.time,
    deadlineLabel: deadline.month + '月' + deadline.day + '日 ' + deadline.time, statusLabel,
    actionLabel, actionDisabled, canConfirm: event.canManage && event.status === 'decision_due' && event.serverNow < event.startsAt && event.count >= event.minCapacity,
    canCancel: event.canManage && ['open', 'decision_due', 'confirmed'].includes(event.status),
    canEdit: event.canManage && ['draft', 'open'].includes(event.status),
    personalLabel: event.registrationStatus === 'cancelled' ? '你已取消报名' : event.joined ? '你已报名' : '' };
}
function groupEvents(events) {
  const groups = [];
  events.forEach(event => {
    let group = groups[groups.length - 1];
    if (!group || group.date !== event.dateKey) { group = { date: event.dateKey, label: event.dateLabel, week: event.weekLabel, events: [] }; groups.push(group); }
    group.events.push(event);
  });
  return groups;
}
function profile(user) {
  const labels = { member: '普通会员', organizer: '组织者', admin: '管理员' };
  const statuses = { new: '尚未申请', pending: '审核中', approved: '已加入', rejected: '申请未通过' };
  return { user, member: isMember(user), organizer: isOrganizer(user), admin: isAdmin(user), roleLabel: user ? labels[user.role] : '', membershipLabel: user ? statuses[user.status] : '' };
}
function message(error) { return error && error.message ? error.message : '操作失败，请稍后重试'; }
function membershipPage() { wx.navigateTo({ url: '/pages/membership/index' }); }
module.exports = { parts, eventView, groupEvents, profile, message, membershipPage };
