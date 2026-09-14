/* 双语助手的纯函数与公共约定；同时供扩展页面、内容脚本和测试使用。 */
(function initCore(scope) {
  'use strict';
  const N = scope.NetflixTranslate = scope.NetflixTranslate || {};
  const LANGUAGES = {
    en: '英语', ja: '日语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语',
    it: '意大利语', pt: '葡萄牙语', ru: '俄语', th: '泰语', vi: '越南语',
    id: '印度尼西亚语', ar: '阿拉伯语', hi: '印地语', tr: '土耳其语',
    nl: '荷兰语', pl: '波兰语', uk: '乌克兰语', sv: '瑞典语', da: '丹麦语',
    fi: '芬兰语', no: '挪威语', cs: '捷克语', el: '希腊语', he: '希伯来语',
    hu: '匈牙利语', ro: '罗马尼亚语', bg: '保加利亚语', bn: '孟加拉语',
    hr: '克罗地亚语', kn: '卡纳达语', lt: '立陶宛语', mr: '马拉地语',
    sk: '斯洛伐克语', sl: '斯洛文尼亚语', ta: '泰米尔语', te: '泰卢固语',
    zh: '简体中文', 'zh-Hant': '繁体中文'
  };
  const DEFAULTS = Object.freeze({ enabled: true, sourceLanguage: 'auto', fontSize: 26, backgroundOpacity: 65, bottomOffset: 10, onlineFallback: false });
  const ERRORS = {
    CANCELLED: '本次字幕已过期', NEEDS_ACTIVATION: '请点击「准备本地翻译」下载语言包',
    DOWNLOADING: '正在准备语言包', UNSUPPORTED: '此浏览器或语言暂不支持本地翻译',
    LOCAL_FAILED: '本地翻译失败，可重新准备语言包', TIMEOUT: '翻译超时，请稍后重试',
    ONLINE_DISABLED: '在线备用尚未开启', PERMISSION_DENIED: '尚未获得 MyMemory 访问权限',
    QUOTA: 'MyMemory 今日额度不足，已停止在线请求', RATE_LIMIT: 'MyMemory 请求受限，在线翻译已暂停',
    REMOTE_ERROR: '在线翻译暂不可用，请稍后重试', INVALID_REQUEST: '请求内容无效',
    STORAGE: '本地保存失败，请检查扩展存储空间'
  };
  /** 创建带稳定错误代码的异常，界面只显示中文信息。 */
  function failure(code, detail) { const error = new Error(detail || ERRORS[code] || '操作失败'); error.code = code; return error; }
  /** 清理字幕空白，保留有意义的换行与标点。 */
  function cleanText(value) { return String(value || '').normalize('NFC').replace(/\u200b/g, '').replace(/\r/g, '').split('\n').map(line => line.replace(/[\t \u00a0]+/g, ' ').trim()).filter(Boolean).join('\n').trim(); }
  /** 把地区语言代码归一到翻译引擎使用的语言代码。 */
  function languageCode(value) {
    const code = String(value || '').replace(/_/g, '-').toLowerCase();
    if (/^zh-(hant|tw|hk|mo)(-|$)/.test(code)) return 'zh-Hant';
    const base = code.split('-')[0];
    return ({ nb: 'no', nn: 'no', iw: 'he', fil: 'tl' })[base] || base;
  }
  /** 校验设置，避免旧数据或异常输入破坏布局。 */
  function normalizeSettings(value = {}) {
    const bounded = (input, fallback, min, max) => Number.isFinite(Number(input)) ? Math.min(max, Math.max(min, Number(input))) : fallback;
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULTS.enabled,
      sourceLanguage: value.sourceLanguage === 'auto' || LANGUAGES[value.sourceLanguage] ? value.sourceLanguage : 'auto',
      fontSize: bounded(value.fontSize ?? DEFAULTS.fontSize, DEFAULTS.fontSize, 16, 44),
      backgroundOpacity: bounded(value.backgroundOpacity ?? DEFAULTS.backgroundOpacity, DEFAULTS.backgroundOpacity, 0, 100),
      bottomOffset: bounded(value.bottomOffset ?? DEFAULTS.bottomOffset, DEFAULTS.bottomOffset, 3, 35),
      onlineFallback: value.onlineFallback === true
    };
  }
  /** 按 UTF-8 字节限制拆分文本，保持所有字符和顺序。 */
  function splitUtf8(text, maxBytes = 500) {
    if (maxBytes < 4) throw failure('INVALID_REQUEST');
    const encoder = new TextEncoder();
    const chunks = [];
    let chunk = '', size = 0;
    for (const char of String(text)) {
      const bytes = encoder.encode(char).length;
      if (size + bytes > maxBytes) { chunks.push(chunk); chunk = ''; size = 0; }
      chunk += char; size += bytes;
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  }
  /** 创建按源语言和词语去重的收藏标识。 */
  function wordKey(term, language) { return languageCode(language) + ':' + cleanText(term).toLocaleLowerCase().replace(/\s+/g, ' '); }
  /** 校验并截取收藏字段，仅生成 Netflix 播放链接。 */
  function normalizeWord(input, now = Date.now()) {
    const term = cleanText(input.term).slice(0, 500);
    const translation = cleanText(input.translation).slice(0, 2000);
    const sourceLanguage = languageCode(input.sourceLanguage);
    if (!term || !translation || !LANGUAGES[sourceLanguage]) throw failure('INVALID_REQUEST');
    const videoId = /^\d+$/.test(String(input.videoId)) ? String(input.videoId) : '';
    const position = Math.max(0, Number(input.position) || 0);
    return { id: wordKey(term, sourceLanguage), term, translation, sourceLanguage, targetLanguage: 'zh',
      context: cleanText(input.context).slice(0, 3000), contextTranslation: cleanText(input.contextTranslation).slice(0, 3000),
      title: cleanText(input.title).slice(0, 300), videoId, position, createdAt: now,
      url: videoId ? 'https://www.netflix.com/watch/' + videoId + '?t=' + Math.floor(position) : '' };
  }
  /** 格式化影片播放位置。 */
  function timestamp(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    return (value >= 3600 ? Math.floor(value / 3600) + ':' : '') + String(Math.floor(value / 60) % 60).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
  }
  /** 为 CSV 转义引号、换行和电子表格公式前缀。 */
  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  /** 导出可直接用表格软件打开的 UTF-8 CSV。 */
  function exportCsv(words) {
    const rows = [['词语', '中文译文', '源语言', '字幕上下文', '上下文译文', '影片', '播放位置', '播放链接', '收藏时间']];
    words.forEach(word => rows.push([word.term, word.translation, word.sourceLanguage, word.context, word.contextTranslation, word.title, timestamp(word.position), word.url, new Date(word.createdAt).toISOString()]));
    return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  /** 按词切分字幕，保留空格、日韩文词语与标点。 */
  function segmentWords(text, language) {
    try { return Array.from(new Intl.Segmenter(language || 'en', { granularity: 'word' }).segment(text), part => ({ text: part.segment, word: part.isWordLike === true })); }
    catch (_) { return text.split(/(\s+|[.,!?;:，。！？、]+)/).filter(Boolean).map(part => ({ text: part, word: /[\p{L}\p{N}]/u.test(part) })); }
  }
  class LruCache {
    /** 建立有容量上限的内存缓存。 */
    constructor(limit = 500) { this.limit = limit; this.items = new Map(); }
    /** 读取并更新最近使用顺序。 */
    get(key) { if (!this.items.has(key)) return undefined; const value = this.items.get(key); this.items.delete(key); this.items.set(key, value); return value; }
    /** 保存结果并淘汰最久未使用的项目。 */
    set(key, value) { this.items.delete(key); this.items.set(key, value); while (this.items.size > this.limit) this.items.delete(this.items.keys().next().value); }
    /** 释放缓存。 */
    clear() { this.items.clear(); }
  }
  class LatestQueue {
    /** 每种用途仅保留最新等待任务，查词优先于字幕。 */
    constructor() { this.pending = new Map(); this.running = null; }
    /** 合并相同任务，并淘汰同一用途尚未执行的旧任务。 */
    submit(channel, key, work) {
      if (this.running?.key === key) return this.running.promise;
      for (const job of this.pending.values()) if (job.key === key) return job.promise;
      this.pending.get(channel)?.reject(failure('CANCELLED'));
      const job = { channel, key, work };
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      this.pending.set(channel, job); this.drain(); return job.promise;
    }
    /** 逐个执行任务，避免浏览器翻译器内部形成无界队列。 */
    async drain() {
      if (this.running || !this.pending.size) return;
      const job = this.pending.get('lookup') || this.pending.values().next().value;
      this.pending.delete(job.channel); this.running = job;
      try { job.resolve(await job.work()); } catch (error) { job.reject(error); }
      finally { this.running = null; this.drain(); }
    }
    /** 取消尚未开始的任务，已运行结果由调用方会话校验丢弃。 */
    clear() { for (const job of this.pending.values()) job.reject(failure('CANCELLED')); this.pending.clear(); }
  }
  /** 将无响应操作限制在指定时间内，并释放可取消资源。 */
  function withTimeout(promise, ms, onTimeout) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => { onTimeout?.(); reject(failure('TIMEOUT')); }, ms); })]).finally(() => clearTimeout(timer));
  }
  Object.assign(N, { LANGUAGES, DEFAULTS, ERRORS, failure, cleanText, languageCode, normalizeSettings, splitUtf8, wordKey, normalizeWord, timestamp, exportCsv, segmentWords, LruCache, LatestQueue, withTimeout });
})(globalThis);
