const test = require('node:test');
const assert = require('node:assert/strict');
require('../lib/core.js');
require('../lib/vocabulary.js');
const N = globalThis.NetflixTranslate;
const now = new Date(2026, 8, 14, 12);
const words = [
  { term: 'Serendipity', translation: '不期而遇的美好', context: 'Call it serendipity.', contextTranslation: '就当是命运的安排。', title: 'A quiet story', sourceLanguage: 'en', createdAt: new Date(2026, 8, 14, 0, 1).getTime() },
  { term: 'chance', translation: '机会', context: 'Take a chance.', title: 'Another story', sourceLanguage: 'en', createdAt: new Date(2026, 8, 13, 23, 59).getTime() },
  { term: '木漏れ日', translation: '树叶间洒下的阳光', context: '木漏れ日がきれいだ。', title: 'A quiet story', sourceLanguage: 'ja', createdAt: new Date(2026, 8, 14, 10).getTime() }
];

test('语种筛选可组合大小写无关的全文搜索，且包含对白译文和影片', () => {
  assert.deepEqual(N.filterVocabulary(words, { collection: 'en', query: '  STORY  ' }), [words[0], words[1]]);
  assert.deepEqual(N.filterVocabulary(words, { query: '命运的安排' }), [words[0]]);
  assert.deepEqual(N.filterVocabulary(words, { collection: 'ja', query: '机会' }), []);
  assert.deepEqual(N.filterVocabulary(words, { query: '日语' }), [words[2]]);
});

test('今日筛选使用本地日界，且支持组合搜索与空结果', () => {
  assert.equal(N.isSavedToday(words[0], now), true);
  assert.equal(N.isSavedToday(words[1], now), false);
  assert.deepEqual(N.filterVocabulary(words, { collection: 'today', now }), [words[2], words[0]]);
  assert.deepEqual(N.filterVocabulary(words, { collection: 'today', query: 'chance', now }), []);
});

test('三种排序不改变收藏原始集合和导出内容', () => {
  const original = JSON.stringify(words);
  const csv = N.exportCsv(words);
  assert.deepEqual(N.filterVocabulary(words), [words[2], words[0], words[1]]);
  assert.deepEqual(N.filterVocabulary(words, { sort: 'oldest' }), [words[1], words[0], words[2]]);
  assert.deepEqual(N.filterVocabulary(words, { sort: 'term', collection: 'en' }), [words[1], words[0]]);
  assert.equal(JSON.stringify(words), original);
  assert.equal(N.exportCsv(words), csv);
});

test('原句标记匹配独立词语和短语，不误标其他单词内部', () => {
  const parts = N.vocabularyContextParts('A brisk walk is a risk. RISK matters.', 'risk');
  assert.deepEqual(parts.filter(part => part.highlighted).map(part => part.text), ['risk', 'RISK']);
  assert.deepEqual(N.vocabularyContextParts('Take a chance; take a chance.', 'take a chance').filter(part => part.highlighted).map(part => part.text), ['Take a chance', 'take a chance']);
  assert.equal(N.vocabularyContextParts('chance', 'a').some(part => part.highlighted), false);
});

test('原句标记把正则特殊符号和 HTML 当作普通文本，并完整保留原文', () => {
  for (const term of ['C++', 'a.b', '[word]', '(test)', '$5', 'a\\b', '<img src=x>']) {
    const original = 'Before ' + term + '\n' + term + ' after.';
    const parts = N.vocabularyContextParts(original, term);
    assert.equal(parts.map(part => part.text).join(''), original);
    assert.deepEqual(parts.filter(part => part.highlighted).map(part => part.text), [term, term]);
  }
  assert.equal(N.vocabularyContextParts('axb a.b', 'a.b').filter(part => part.highlighted).length, 1);
});

test('日韩连续对白可标记收藏表达，未匹配和空内容保持原样', () => {
  for (const [text, term] of [['木漏れ日がきれいだ。', '木漏れ日'], ['아직괜찮아요.', '괜찮아']]) {
    const parts = N.vocabularyContextParts(text, term);
    assert.equal(parts.map(part => part.text).join(''), text);
    assert.deepEqual(parts.filter(part => part.highlighted).map(part => part.text), [term]);
  }
  assert.deepEqual(N.vocabularyContextParts('hello', 'missing'), [{ text: 'hello', highlighted: false }]);
  assert.deepEqual(N.vocabularyContextParts('hello', ''), [{ text: 'hello', highlighted: false }]);
  assert.deepEqual(N.vocabularyContextParts('', 'hello'), [{ text: '', highlighted: false }]);
});
