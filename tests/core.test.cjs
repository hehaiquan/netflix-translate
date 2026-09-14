const test = require('node:test');
const assert = require('node:assert/strict');
require('../lib/core.js');
const N = globalThis.NetflixTranslate;
const { deferred } = require('./helpers.cjs');
test('UTF-8 分块不破坏日韩文或 emoji，每块不超过 500 字节', () => {
  const input = ('Hello, 世界。こんにちは 안녕하세요 🎬\n').repeat(60);
  const chunks = N.splitUtf8(input);
  assert.equal(chunks.join(''), input); assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => Buffer.byteLength(chunk) <= 500));
});
test('设置限制、地区语言归一与收藏去重', () => {
  const settings = N.normalizeSettings({ fontSize: 1000, bottomOffset: -5, sourceLanguage: 'unknown', onlineFallback: 'true' });
  assert.equal(settings.fontSize, 44); assert.equal(settings.bottomOffset, 3); assert.equal(settings.sourceLanguage, 'auto'); assert.equal(settings.onlineFallback, false);
  assert.equal(N.languageCode('zh-TW'), 'zh-Hant'); assert.equal(N.languageCode('en-US'), 'en');
  assert.equal(N.wordKey('  Hello  WORLD ', 'en-US'), N.wordKey('hello world', 'en'));
  assert.notEqual(N.wordKey('gift', 'en'), N.wordKey('gift', 'de'));
});
test('收藏仅保留 Netflix 影片定位，不接受任意链接', () => {
  const word = N.normalizeWord({ term: 'hello', translation: '你好', sourceLanguage: 'en', videoId: '123', position: 12.8, url: 'javascript:alert(1)' }, 100);
  assert.equal(word.url, 'https://www.netflix.com/watch/123?t=12'); assert.equal(word.createdAt, 100);
  assert.throws(() => N.normalizeWord({ term: 'word' }), /请求内容无效/);
});
test('CSV 正确保留换行、引号与中文，并处理公式前缀', () => {
  const word = N.normalizeWord({ term: '=1+1', translation: '"一"\n二', sourceLanguage: 'en' }, 1000);
  const csv = N.exportCsv([word]);
  assert.ok(csv.startsWith('\ufeff')); assert.ok(csv.includes("\"'=1+1\"")); assert.ok(csv.includes('""一""\n二'));
});
test('英文及日韩文分词保持原文内容', () => {
  for (const [language, text] of [['en', "It's a beautiful day."], ['ja', '今日はいい天気ですね。'], ['ko', '오늘 날씨가 정말 좋아요.']]) {
    const parts = N.segmentWords(text, language); assert.equal(parts.map(part => part.text).join(''), text); assert.ok(parts.some(part => part.word));
  }
});
test('LRU 淘汰最久未使用项目', () => { const cache = new N.LruCache(2); cache.set('a', 1); cache.set('b', 2); cache.get('a'); cache.set('c', 3); assert.equal(cache.get('b'), undefined); assert.equal(cache.get('a'), 1); });
test('字幕队列淘汰旧任务、合并相同请求，查词优先执行', async () => {
  const queue = new N.LatestQueue(), gate = deferred(), order = [];
  const first = queue.submit('caption', 'a', async () => { order.push('a'); return gate.promise; });
  const same = queue.submit('lookup', 'a', () => { throw Error('不应重复执行'); }); assert.equal(first, same);
  const old = queue.submit('caption', 'b', () => order.push('b')); const rejected = assert.rejects(old, error => error.code === 'CANCELLED');
  const latest = queue.submit('caption', 'c', () => order.push('c'));
  const lookup = queue.submit('lookup', 'd', () => order.push('d'));
  gate.resolve('ok'); await Promise.all([first, latest, lookup, rejected]); assert.deepEqual(order, ['a', 'd', 'c']);
});
