'use strict';
const { createService, TABLES: T, VERSION } = require('./shared/domain');
const { MemoryStore } = require('./shared/memory-store');
const KEY = 'reading_club_v2_demo', PERSONA = KEY + '_persona', CLOCK = KEY + '_clock';
const DEFAULT_AGENDA = '1 自我介绍（15分钟）\n轮流介绍自己、最近在读的书，以及期待讨论的问题。\n\n2 主题讨论（60分钟）\nQ1 书中哪一个观点让你印象最深？\nQ2 它与你的生活有什么联系？\nQ3 你想与大家一起探讨什么？\n\n3 自由交流（30分钟）\n回应彼此的问题，分享不同视角。\n\n4 回顾与告别（15分钟）\n说说今天的收获，约定下次共读。';
function seed(now) {
  const d = new Date(now + 8 * 86400000 + 8 * 3600000), day = d.toISOString().slice(0,10), start = Date.parse(day + 'T14:00:00+08:00');
  const users = {};
  for (const [id,nickname,bio] of [['owner','林间','在阅读中认识世界，也认识彼此。'],['alice','小满','喜欢文学、散步和咖啡。'],['bob','阿树','和有趣的人一起读书。']]) users[id] = { id, nickname, bio, status:'active',role:'member',privacyVersion:VERSION,createdAt:now };
  const base = { status:'published',visibility:'public',creatorId:'owner',creatorName:'林间',dateKey:day,startAt:start,endAt:start+7200000,signupUntil:start-3600000,capacity:8,count:1,waitCount:0,nextQueue:0,version:1,createdAt:now,category:'文学',location:'城市书房 · 阅读空间',address:'演示地点，请以发起人实际发布为准',latitude:31.2304,longitude:121.4737,remarks:'请提前10分钟到达，带上书和你的问题。活动免费，场地消费按个人需要自理。',agenda:DEFAULT_AGENDA,cover:'',hostId:'' };
  const events = {
    e_v2_literature:{...base,id:'e_v2_literature',title:'在文字里，遇见另一种生活',book:'文学共读',description:'留出一个下午，一起读书、交换想法。你可以带来喜欢的段落，也可以只带着好奇心来。我们从文字出发，聊聊各自的生活经验。\n\n无需提前读完整本书。欢迎认真倾听，也欢迎不同的观点。'},
    e_v2_psychology:{...base,id:'e_v2_psychology',title:'把沟通变成彼此的理解',book:'心理共读',category:'心理',dateKey:new Date(start+86400000+28800000).toISOString().slice(0,10),startAt:start+86400000,endAt:start+93600000,signupUntil:start+82800000,capacity:2,count:2,location:'街角咖啡 · 共读长桌',description:'从关系中的小事开始，讨论怎样表达需要、理解边界，以及建立更好的沟通。',hostId:'alice'}
  };
  const regs={};
  for(const [eventId,id] of [['e_v2_literature','owner'],['e_v2_psychology','alice'],['e_v2_psychology','bob']]) { const rid=eventId+'__'+id;regs[rid]={id:rid,eventId,userId:id,status:'registered',createdAt:now,queueNo:0}; }
  return { [T.users]:users,[T.events]:events,[T.registrations]:regs,[T.private]:{e_v2_literature:{id:'e_v2_literature',groupAsset:'demo_group',checkinCode:'654321'},e_v2_psychology:{id:'e_v2_psychology',groupAsset:'demo_group',checkinCode:'654321'}},[T.assets]:{demo_group:{id:'demo_group',kind:'group',status:'approved',ownerId:'owner',url:'',demo:true}} };
}
function createV2Client(platform, config, runtime) {
  if(config.mode==='demo') {
    if(runtime!=='develop') throw Error('演示数据仅供开发预览，禁止作为体验版或正式版运行');
    const clock=()=>Date.now()+Number(platform.getStorageSync(CLOCK)||0);
    let store=new MemoryStore(platform.getStorageSync(KEY)||seed(clock()),value=>platform.setStorageSync(KEY,value)),service;
    const build=()=>{service=createService(store,{now:clock,checkContent:async()=>({demo:true})});};build();
    const actor=()=>({id:platform.getStorageSync(PERSONA)||'guest'});
    async function hydrate(value) {
      if(!value||typeof value!=='object')return;
      if(value.assetId==='demo_group') {value.demo=true;value.url='';}
      if(value.cover) value.coverUrl=(await store.get(T.assets,value.cover))?.url||'';
      if(value.avatar) value.avatarUrl=(await store.get(T.assets,value.avatar))?.url||'';
      for(const child of Object.values(value)) if(child&&typeof child==='object') {if(Array.isArray(child))await Promise.all(child.map(hydrate));else await hydrate(child);}
    }
    return {
      async call(action,payload={}) {
        if(action==='uploadImage') { const id='asset_'+Date.now().toString(36);await store.transaction(async unit=>unit.put(T.assets,id,{id,ownerId:actor().id,kind:payload.kind,status:'approved',url:payload.previewUrl||'',demo:true}));return{assetId:id}; }
        const result=await service.call(actor(),action,payload);await hydrate(result);return result;
      },
      demo:{personas:[{id:'guest',name:'新书友 · 注册体验'},{id:'owner',name:'活动发起人 · 林间'},{id:'alice',name:'已报名书友 · 小满'},{id:'bob',name:'已报名书友 · 阿树'}],current:()=>actor().id,switch(id){if(!['guest','owner','alice','bob'].includes(id))throw Error('演示身份无效');platform.setStorageSync(PERSONA,id);},reset(){platform.removeStorageSync(KEY);platform.removeStorageSync(PERSONA);platform.removeStorageSync(CLOCK);store=new MemoryStore(seed(Date.now()),v=>platform.setStorageSync(KEY,v));build();},clock,advance(time){platform.setStorageSync(CLOCK,time-Date.now());}}
    };
  }
  if(config.mode!=='cloud'||!config.cloudEnv||config.functionName!=='readingClubV2')throw Error('新版本云服务尚未配置');
  platform.cloud.init({env:config.cloudEnv,traceUser:false});
  return { async call(action,payload={}) {
    const response=await platform.cloud.callFunction({name:config.functionName,data:{action,payload}});
    const result=response.result;
    if(!result?.ok) {const e=Error(result?.error?.message||'服务暂时不可用');e.code=result?.error?.code||'INTERNAL';throw e;}
    return result.data;
  }};
}
module.exports={createV2Client,seed,DEFAULT_AGENDA};
