/** 提供生词本的组合筛选、排序和原句标记，不修改收藏原始数据。 */
(function initVocabulary(scope) {
  'use strict';
  const N = scope.NetflixTranslate;
  const collator = new Intl.Collator('zh-CN', { sensitivity: 'base', numeric: true });

  /** 判断收藏是否来自用户所在时区的今天。 */
  function isSavedToday(word, now = new Date()) {
    return new Date(word.createdAt).toDateString() === now.toDateString();
  }

  /** 组合收藏分类与全文搜索，再对结果副本排序，保持导出的原始集合完整。 */
  function filterVocabulary(words, { query = '', collection = 'all', sort = 'newest', now = new Date() } = {}) {
    const normalized = query.trim().toLocaleLowerCase();
    const result = words.filter(word => {
      if (collection === 'today' && !isSavedToday(word, now)) return false;
      if (collection !== 'all' && collection !== 'today' && word.sourceLanguage !== collection) return false;
      return [word.term, word.translation, word.context, word.contextTranslation, word.title, N.LANGUAGES[word.sourceLanguage]].join(' ').toLocaleLowerCase().includes(normalized);
    });
    result.sort((left, right) => {
      if (sort === 'term') return collator.compare(left.term, right.term);
      const difference = (Number(new Date(left.createdAt)) || 0) - (Number(new Date(right.createdAt)) || 0);
      return sort === 'oldest' ? difference : -difference;
    });
    return result;
  }

  /** 返回保留原文的标记片段；拉丁词避免误标单词内部，日韩词允许连续文本匹配。 */
  function vocabularyContextParts(text, term) {
    const value = String(text || '');
    const needle = String(term || '').trim();
    if (!needle) return [{ text: value, highlighted: false }];
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const latin = /^[\p{Script=Latin}\d]/u.test(needle) && /[\p{Script=Latin}\d]$/u.test(needle);
    const pattern = new RegExp(latin ? '(?<![\\p{L}\\p{N}_])' + escaped + '(?![\\p{L}\\p{N}_])' : escaped, 'giu');
    const parts = [];
    let position = 0;
    for (const match of value.matchAll(pattern)) {
      if (match.index > position) parts.push({ text: value.slice(position, match.index), highlighted: false });
      parts.push({ text: match[0], highlighted: true });
      position = match.index + match[0].length;
    }
    if (position < value.length || !parts.length) parts.push({ text: value.slice(position), highlighted: false });
    return parts;
  }

  Object.assign(N, { isSavedToday, filterVocabulary, vocabularyContextParts });
})(globalThis);
