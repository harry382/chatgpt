'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createContentChecker } = require('../cloudfunctions/readingClub/content-safety');

test('long Unicode text is fully checked, including phrases crossing request boundaries', async () => {
  const calls = [], content = '前'.repeat(2395) + '边界风险词' + '📖'.repeat(2700) + '末尾';
  const check = createContentChecker({ openapi: { security: { async msgSecCheck(input) { calls.push(input); return { result: { suggest: input.content.includes('边界风险词') ? 'risky' : 'pass' } }; } } } });
  await assert.rejects(check({ openid: 'trusted' }, [content], 3), error => error.code === 'CONTENT_REJECTED');
  assert.ok(calls.length >= 3); assert.ok(calls.every(call => Array.from(call.content).length <= 2500));
  assert.ok(calls[0].content.startsWith('前')); assert.ok(calls.at(-1).content.endsWith('末尾'));
  assert.ok(calls.some(call => call.content.includes('边界风险词')));
});
test('a timed-out detector fails closed without publishing or leaking diagnostics', async () => {
  const check = createContentChecker({ openapi: { security: { msgSecCheck: () => new Promise(() => {}) } } }, { timeoutMs: 5 });
  await assert.rejects(check({ openid: 'trusted' }, ['活动内容'], 3), error => error.code === 'CONTENT_CHECK_UNAVAILABLE' && !/timeout/.test(error.message));
});
