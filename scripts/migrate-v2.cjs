'use strict';
const fs=require('node:fs'),path=require('node:path');
const {TABLES:T,CATEGORIES}=require('../cloudfunctions/readingClubV2/domain');
const {DEFAULT_AGENDA}=require('../miniprogram/v2/runtime');
function migrateV1(snapshot) {
  const data=Object.fromEntries(Object.values(T).map(table=>[table,{}])),warnings=[];
  const rows=table=>Array.isArray(snapshot[table])?snapshot[table]:Object.values(snapshot[table]||{});
  for(const old of rows('club_users')) {
    const id=old.id||old._id;if(!id)throw Error('会员缺少ID');
    if(old.status!=='approved'){warnings.push('未迁移待审批/未加入账号：'+id);continue;}
    data[T.users][id]={id,nickname:old.nickname||'书友',avatar:'',bio:'',status:'active',role:old.role==='admin'?'admin':'member',privacyVersion:old.privacyVersion||'',createdAt:old.createdAt,updatedAt:old.updatedAt,migrated:true};
  }
  for(const old of rows('club_events')) {
    const id=old.id||old._id;
    if(!id||!data[T.users][old.createdBy]){warnings.push('活动缺少已迁移发起人，需人工核对：'+id);continue;}
    if(!Number.isFinite(old.startsAt)||!Number.isFinite(old.endsAt)){warnings.push('活动日期不完整，暂不迁移：'+id);continue;}
    const category=old.category==='经济'?'商业':old.category;
    if(!CATEGORIES.includes(category))throw Error('未知活动分类：'+id);
    data[T.events][id]={id,visibility:'legacy_members',title:old.title,book:old.book,category,location:old.location,address:'',description:old.description,remarks:old.preparation||'',agenda:DEFAULT_AGENDA,startAt:old.startsAt,endAt:old.endsAt,signupUntil:old.deadlineAt,dateKey:new Date(old.startsAt+28800000).toISOString().slice(0,10),capacity:old.maxCapacity,count:0,waitCount:0,nextQueue:0,version:1,creatorId:old.createdBy,creatorName:old.organizerName,cover:'',hostId:'',status:old.status==='cancelled'?'cancelled':old.published?'published':'draft',cancellationReason:old.cancellationReason||'',createdAt:old.createdAt,updatedAt:old.updatedAt,migrated:true};
    data[T.private][id]={id,groupAsset:'',checkinCode:''};
    warnings.push('需由发起人补充地图位置、群码及签到口令：'+id);
  }
  for(const old of rows('club_registrations')) {
    if(!data[T.events][old.eventId]||!data[T.users][old.userId]){warnings.push('报名关联需核对：'+(old.id||old._id));continue;}
    const id=old.eventId+'__'+old.userId,status=old.status==='active'?'registered':'cancelled';
    if(data[T.registrations][id])throw Error('重复的会员活动报名：'+id);
    data[T.registrations][id]={id,eventId:old.eventId,userId:old.userId,status,queueNo:0,createdAt:old.createdAt,updatedAt:old.updatedAt,migrated:true};
    if(status==='registered')data[T.events][old.eventId].count+=1;
  }
  for(const e of Object.values(data[T.events]))if(e.count>e.capacity)throw Error('报名人数超过容量，迁移已停止：'+e.id);
  return{data,warnings,counts:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,Object.keys(v).length]))};
}
if(require.main===module) {
  const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('用法：node scripts/migrate-v2.cjs 已核验旧数据.json 私有输出目录；只生成新集合导入文件，不连接云端');
  const result=migrateV1(JSON.parse(fs.readFileSync(input,'utf8')));
  if(fs.existsSync(output))throw Error('输出目录已存在，拒绝覆盖');
  fs.mkdirSync(output,{recursive:true,mode:0o700});
  for(const [table,rows]of Object.entries(result.data))fs.writeFileSync(path.join(output,table+'.ndjson'),Object.values(rows).map(row=>JSON.stringify({...row,_id:row.id})).join('\n')+'\n',{mode:0o600});
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({counts:result.counts,warnings:result.warnings},null,2),{mode:0o600});
  console.log('仅生成迁移预演文件；未连接或修改云端。请私下查看报告并核对关联和人数。');
}
module.exports={migrateV1};
