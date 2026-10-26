'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const mini = path.join(root, 'miniprogram');
const assert = require('node:assert/strict');
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).filter(entry => !['.git', 'node_modules', 'backups', 'data-exports', 'work', 'dist', '.cloudbase', '.cli'].includes(entry.name)).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
const all = files(root);
for (const filename of all) {
  if (filename.endsWith('.json')) JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (/\.(js|cjs)$/.test(filename)) new vm.Script(fs.readFileSync(filename, 'utf8'), { filename });
}
const project = require('../project.config.json'), app = require('../miniprogram/app.json');
assert.equal(project.miniprogramRoot, 'miniprogram/'); assert.equal(project.cloudfunctionRoot, 'cloudfunctions/');
for (const file of ['domain.js', 'memory-store.js']) assert.equal(fs.readFileSync(path.join(mini, 'shared', file), 'utf8'), fs.readFileSync(path.join(root, 'cloudfunctions/readingClub', file), 'utf8'), 'Run npm run sync after business rule changes');
for (const file of ['domain.js', 'memory-store.js']) assert.equal(fs.readFileSync(path.join(mini, 'v2/shared', file), 'utf8'), fs.readFileSync(path.join(root, file === 'domain.js' ? 'cloudfunctions/readingClubV2' : 'cloudfunctions/readingClub', file), 'utf8'), 'V2 shared rules require npm run sync');
for (const route of app.pages.concat('components/event-card/index')) {
  const entry = path.join(mini, route);
  for (const extension of ['.js', '.json', '.wxml', '.wxss']) assert.ok(fs.existsSync(entry + extension), 'Missing ' + route + extension);
  let definition;
  vm.runInNewContext(fs.readFileSync(entry + '.js', 'utf8'), { require: createRequire(entry + '.js'), Page(value) { definition = value; }, Component(value) { definition = value; } }, { filename: entry + '.js' });
  const methods = route.startsWith('components/') ? definition.methods : definition;
  const template = fs.readFileSync(entry + '.wxml', 'utf8');
  const stack = [];
  for (const match of template.matchAll(/<(\/?)([\w:-]+)([^>]*)>/g)) {
    const [, closing, tag, attributes] = match;
    if (closing) assert.equal(stack.pop(), tag, 'Unbalanced WXML tags in ' + route);
    else if (!attributes.endsWith('/')) stack.push(tag);
    if (!closing) for (const binding of attributes.matchAll(/(?:bind(?::)?[\w-]*|catch(?::)?[\w-]*)="([A-Za-z_]\w*)"/g)) assert.equal(typeof methods[binding[1]], 'function', 'Missing handler ' + binding[1] + ' in ' + route);
  }
  assert.equal(stack.length, 0, 'Unclosed WXML tags in ' + route);
  for (const expression of template.matchAll(/{{([\s\S]*?)}}/g)) {
    const code = expression[1].replaceAll('&amp;', '&').replaceAll('&gt;', '>').replaceAll('&lt;', '<');
    new vm.Script('(' + code + ')', { filename: entry + '.wxml' });
  }
  const components = require(entry + '.json').usingComponents || {};
  for (const component of Object.values(components)) assert.ok(fs.existsSync(path.join(mini, component) + '.json'));
}
for (const tab of app.tabBar.list) assert.ok(app.pages.includes(tab.pagePath));
console.log('Project checks passed: ' + app.pages.length + ' pages, shared-rule sync, JavaScript, JSON, template structure and handlers.');
console.log('Native WeChat compilation and device verification remain required.');
