const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { mockChrome, response } = require('./helpers.cjs');
/** 使用真实后台脚本和内存 Chrome 接口构建独立测试上下文。 */
function worker() {
  const chrome = mockChrome();
  const context = vm.createContext({ chrome, console, URL, URLSearchParams, TextEncoder, AbortController, setTimeout, clearTimeout, fetch: async () => response() });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), context);
  return { chrome, async send(message, sender = { id: chrome.runtime.id, url: 'chrome-extension://test-extension/vocabulary.html', tab: { id: 7 } }) { return new Promise(resolve => chrome.runtime.onMessage.emit(message, sender, resolve)); } };
}
test('完整扩展标签页可读写收藏，并发收藏按语言和词语去重', async () => {
  const app = worker(); const word = { term: 'Hello', translation: '你好', sourceLanguage: 'en', videoId: '123', position: 8 };
  const results = await Promise.all([app.send({ type: 'VOCAB_SAVE', word }), app.send({ type: 'VOCAB_SAVE', word: { ...word, term: 'hello' } })]);
  assert.ok(results.every(result => result.ok)); assert.equal(app.chrome.data.words.length, 1);
  const list = await app.send({ type: 'VOCAB_LIST' }); assert.equal(list.value.length, 1);
  const deleted = await app.send({ type: 'VOCAB_DELETE', id: list.value[0].id }); assert.equal(deleted.ok, true); assert.equal(app.chrome.data.words.length, 0);
});
test('拒绝外部来源和任意请求命令，Netflix 内容脚本不能删除收藏', async () => {
  const app = worker();
  assert.equal((await app.send({ type: 'VOCAB_LIST' }, { id: 'other' })).ok, false);
  assert.equal((await app.send({ type: 'FETCH_URL', url: 'https://example.com' })).ok, false);
  assert.equal((await app.send({ type: 'VOCAB_DELETE', id: 'en:test' }, { id: app.chrome.runtime.id, url: 'https://www.netflix.com/watch/123', tab: { id: 1 } })).ok, false);
});
