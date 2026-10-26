'use strict';
const { createService } = require('../shared/domain');
const { MemoryStore } = require('../shared/memory-store');
const { makeSeed, PERSONAS } = require('./demo-data');
const DATA_KEY = 'reading_club_demo_v1';
const PERSONA_KEY = 'reading_club_demo_persona';
const OFFSET_KEY = 'reading_club_demo_clock_offset';

function createClient(platform, config, runtime) {
  if (config.mode === 'demo') {
    if (runtime !== 'develop') throw new Error('演示数据仅限开发版。体验版及正式版请接入云开发环境。');
    let saved = platform.getStorageSync(DATA_KEY);
    if (!saved || saved.version !== 1) {
      saved = { version: 1, data: makeSeed(Date.now()) };
      platform.setStorageSync(DATA_KEY, saved);
    }
    const store = new MemoryStore(saved.data, data => platform.setStorageSync(DATA_KEY, { version: 1, data }));
    const now = () => Date.now() + (Number(platform.getStorageSync(OFFSET_KEY)) || 0);
    let sequence = 0;
    const service = createService(store, { now, makeId: () => 'e_demo_' + Date.now().toString(36) + '_' + (++sequence) });
    const persona = () => {
      const selected = platform.getStorageSync(PERSONA_KEY);
      return PERSONAS.some(item => item.id === selected) ? selected : 'u_demo_reader';
    };
    return {
      call(action, payload = {}) { return service.call({ id: persona() }, action, payload); },
      demo: {
        personas: PERSONAS,
        currentPersona: persona,
        setPersona(id) {
          if (!PERSONAS.some(item => item.id === id)) throw new Error('演示身份不存在');
          platform.setStorageSync(PERSONA_KEY, id);
        },
        now,
        async advanceToDeadline() {
          const event = await store.get('club_events', 'e_demo_positive');
          platform.setStorageSync(OFFSET_KEY, event.deadlineAt + 1000 - Date.now());
        },
        reset() {
          platform.removeStorageSync(DATA_KEY); platform.removeStorageSync(OFFSET_KEY); platform.removeStorageSync(PERSONA_KEY);
        }
      }
    };
  }
  if (config.mode !== 'cloud' || !config.cloudEnv || !platform.cloud) throw new Error('请配置可用的云开发环境');
  platform.cloud.init({ env: config.cloudEnv, traceUser: false });
  return {
    async call(action, payload = {}) {
      let response;
      try { response = await platform.cloud.callFunction({ name: config.functionName, data: { action, payload } }); }
      catch (_) { throw new Error('连接失败，请检查网络后重试'); }
      if (!response.result || !response.result.ok) {
        const issue = response.result && response.result.error;
        const error = new Error(issue ? issue.message : '服务暂时不可用');
        error.code = issue ? issue.code : 'INTERNAL'; throw error;
      }
      return response.result.data;
    }
  };
}
module.exports = { createClient };
