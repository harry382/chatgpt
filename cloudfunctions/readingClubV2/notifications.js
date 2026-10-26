'use strict';
const {TABLES:T}=require('./domain');
function notificationConfig(env) {
  try {
    const fields=JSON.parse(env.SUBSCRIBE_FIELD_MAP||'{}'),state=env.SUBSCRIBE_STATE||'trial';
    const sources={thing:['title','message','location','result'],time:['time'],date:['time'],phrase:['result']};
    const valid=fields&&typeof fields==='object'&&!Array.isArray(fields)&&Object.keys(fields).length>0&&Object.entries(fields).every(([key,source])=>{const type=key.match(/^(thing|time|date|phrase)\d+$/)?.[1];return !!type&&sources[type].includes(source);});
    return{enabled:!!env.SUBSCRIBE_TEMPLATE_ID&&!!valid&&['developer','trial','formal'].includes(state),fields:valid?fields:{},state};
  }catch(_){return{enabled:false,fields:{}};}
}
function notificationData(fields,event,row) {
  const date=new Date(event.startAt+28800000).toISOString(),parts=date.slice(0,10).split('-').map(Number),time=parts[0]+'年'+parts[1]+'月'+parts[2]+'日 '+date.slice(11,16);
  const values={title:event.title,location:event.location,time,message:row.message,result:row.result||'状态更新'},data={};
  for(const[field,source]of Object.entries(fields)) {
    const limit=field.startsWith('phrase')?5:field.startsWith('date')||field.startsWith('time')?30:20;
    const value=Array.from(String(values[source]||'').replace(/[\r\n\t]+/g,' ')).slice(0,limit).join('');
    if(!value||field.startsWith('phrase')&&!/^[\u4e00-\u9fff]{1,5}$/.test(value))throw Error('INVALID_TEMPLATE_VALUE');
    data[field]={value};
  }
  return data;
}
async function flushNotifications(store,cloud,env,logger=console) {
  const cfg=notificationConfig(env);if(!cfg.enabled)return;
  const rows=await store.find(T.notices,{pushStatus:'queued'},{orderBy:'createdAt',limit:3});
  for(const row of rows) {
    const claimed=await store.transaction(async unit=>{const current=await unit.get(T.notices,row.id);if(current?.pushStatus!=='queued')return false;current.pushStatus='sending';current.pushAttemptAt=Date.now();await unit.put(T.notices,current.id,current);return true;});
    if(!claimed)continue;
    let status='unknown';
    try {
      const subscription=await store.get(T.subscriptions,row.eventId+'__'+row.userId),event=await store.get(T.events,row.eventId);
      if(!subscription?.openid||!event)throw Error('MISSING_SUBSCRIPTION');
      const data=notificationData(cfg.fields,event,row);
      let timer;
      try{const result=await Promise.race([cloud.openapi.subscribeMessage.send({touser:subscription.openid,templateId:env.SUBSCRIBE_TEMPLATE_ID,page:'v2/pages/detail/index?id='+event.id,data,miniprogramState:cfg.state,lang:'zh_CN'}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DELIVERY_TIMEOUT')),4500);})]);status=Number(result.errCode??result.errcode)===0?'sent':'failed';}finally{clearTimeout(timer);}
    }catch(e){logger.warn?.('v2 notification delivery unresolved',{code:e.code||e.errCode||'UNKNOWN'});}
    await store.transaction(async unit=>{const current=await unit.get(T.notices,row.id);if(current?.pushStatus==='sending'){current.pushStatus=status;await unit.put(T.notices,current.id,current);}});
    // Network ambiguity is deliberately not retried: the in-app notification persists, and automatic retry could duplicate a push.
  }
}
module.exports={flushNotifications,notificationConfig,notificationData};
