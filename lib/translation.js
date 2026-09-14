(function initTranslation(scope) {
  'use strict';
  const N = scope.NetflixTranslate;
  /** 调用后台并恢复结构化错误。 */
  async function request(message) {
    let response;
    try { response = await chrome.runtime.sendMessage(message); }
    catch (_) { throw N.failure('CANCELLED', '扩展已更新，请刷新 Netflix 页面'); }
    if (!response?.ok) throw N.failure(response?.code || 'REMOTE_ERROR', response?.message);
    return response.value;
  }
  class LocalProvider {
    /** 维护当前语言的本地模型，下载状态只归属于当前代次。 */
    constructor(onStatus, host = scope) { this.host = host; this.onStatus = onStatus; this.instance = null; this.language = ''; this.generation = 0; this.creating = null; this.abort = null; }
    /** 查询本机对某个语言对的支持情况，不自动下载模型。 */
    async availability(language) {
      if (language === 'zh') return 'available';
      if (!this.host.Translator) return 'unavailable';
      try { return await this.host.Translator.availability({ sourceLanguage: language, targetLanguage: 'zh' }); }
      catch (_) { return 'unavailable'; }
    }
    /** 在真实页面点击事件中直接创建模型，保留下载所需的用户激活。 */
    initialize(language) {
      if (!this.host.Translator) return Promise.reject(N.failure('UNSUPPORTED'));
      if (this.instance && this.language === language) return Promise.resolve(this.instance);
      if (this.creating && this.language === language) return this.creating;
      this.dispose(); this.language = language;
      const generation = this.generation;
      const abort = this.abort = new AbortController();
      this.onStatus({ state: 'downloading', language, progress: 0 });
      let creating;
      try {
        creating = this.host.Translator.create({ sourceLanguage: language, targetLanguage: 'zh', signal: abort.signal,
          monitor: monitor => monitor.addEventListener('downloadprogress', event => {
            if (generation === this.generation) this.onStatus({ state: 'downloading', language, progress: Math.round(event.loaded * 100) });
          }) });
      } catch (error) { creating = Promise.reject(error); }
      this.creating = N.withTimeout(Promise.resolve(creating), 180000, () => abort.abort()).then(instance => {
        if (generation !== this.generation) { instance.destroy(); throw N.failure('CANCELLED'); }
        this.instance = instance; this.onStatus({ state: 'ready', language }); return instance;
      }).catch(error => {
        if (generation !== this.generation) throw N.failure('CANCELLED');
        const code = error.name === 'NotAllowedError' ? 'NEEDS_ACTIVATION' : N.ERRORS[error.code] ? error.code : 'LOCAL_FAILED';
        this.onStatus({ state: 'error', language, code }); throw N.failure(code);
      }).finally(() => { if (generation === this.generation) this.creating = null; });
      return this.creating;
    }
    /** 翻译一个文本；首次下载交由界面按钮触发，已就绪模型可以自动恢复。 */
    async translate(text, language) {
      if (language === 'zh') return { text, provider: 'identity' };
      if (!this.instance || this.language !== language) {
        if (this.creating && this.language === language) throw N.failure('DOWNLOADING');
        const availability = await this.availability(language);
        if (availability === 'unavailable') throw N.failure('UNSUPPORTED');
        if (availability !== 'available') throw N.failure('NEEDS_ACTIVATION');
        await this.initialize(language);
      }
      const instance = this.instance;
      try {
        const result = await N.withTimeout(instance.translate(text), 8000, () => this.dispose());
        if (!result?.trim()) throw N.failure('LOCAL_FAILED');
        return { text: N.cleanText(result), provider: 'local' };
      } catch (error) { throw N.failure(N.ERRORS[error.code] ? error.code : 'LOCAL_FAILED'); }
    }
    /** 释放旧模型并使未完成的下载结果失效。 */
    dispose() {
      this.generation++; this.abort?.abort();
      try { this.instance?.destroy(); } catch (_) { /* 模型可能已由浏览器释放。 */ }
      this.instance = null; this.creating = null; this.abort = null; this.language = '';
    }
  }
  class TranslationService {
    /** 为字幕与查词共享缓存、去重及最新任务队列。 */
    constructor(onStatus, host = scope) { this.local = new LocalProvider(onStatus, host); this.cache = new N.LruCache(500); this.queue = new N.LatestQueue(); this.onlineFallback = false; this.epoch = 0; }
    /** 更新在线备用开关，避免继续使用被用户关闭的在线译文。 */
    configure(settings) { this.onlineFallback = settings.onlineFallback; this.invalidate(); if (!settings.onlineFallback) this.cache.clear(); }
    /** 会话变化后不再为旧字幕启动在线备用请求。 */
    invalidate() { this.epoch++; this.queue.clear(); }
    /** 优先本地翻译，仅在用户开启备用后向后台请求网络翻译。 */
    translate(text, language, channel = 'caption') {
      const normalized = N.cleanText(text);
      const onlineAllowed = this.onlineFallback;
      const epoch = this.epoch;
      const suffix = language + ':zh:' + normalized;
      return this.queue.submit(channel, suffix + ':' + onlineAllowed + ':' + epoch, async () => {
        if (epoch !== this.epoch) throw N.failure('CANCELLED');
        const cached = this.cache.get('local:' + suffix);
        if (cached) return cached;
        try {
          const result = await this.local.translate(normalized, language);
          this.cache.set('local:' + suffix, result); return result;
        } catch (error) {
          if (epoch !== this.epoch) throw N.failure('CANCELLED');
          if (error.code === 'CANCELLED' || !onlineAllowed || !this.onlineFallback) throw error;
          const cachedOnline = this.cache.get('mymemory:' + suffix);
          if (cachedOnline) return cachedOnline;
          const result = await request({ type: 'TRANSLATE_ONLINE', text: normalized, sourceLanguage: language });
          if (!this.onlineFallback || epoch !== this.epoch) throw N.failure('CANCELLED');
          result.text = decodeEntities(result.text);
          this.cache.set('mymemory:' + suffix, result); return result;
        }
      });
    }
    /** 会话结束时取消等待任务并释放本地模型。 */
    dispose() { this.invalidate(); this.local.dispose(); }
  }
  /** 解码服务端返回的字符实体，文本随后仍使用 textContent 渲染。 */
  function decodeEntities(value) {
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return N.cleanText(String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()] || match;
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }));
  }
  class LanguageResolver {
    /** 聚合字幕样本，避免将短词误识别为另一种语言。 */
    constructor() { this.reset(); }
    /** 在影片或字幕轨道变化时清空语言样本。 */
    reset() { this.samples = []; this.language = ''; this.script = ''; this.generation = (this.generation || 0) + 1; this.requestSequence = (this.requestSequence || 0) + 1; }
    /** 手动语言优先，其次使用轨道提示，最后进行本地连续文本识别。 */
    async resolve(text, setting, hint = '') {
      const requestSequence = ++this.requestSequence;
      if (setting !== 'auto') return setting;
      const languageHint = N.languageCode(hint);
      if (N.LANGUAGES[languageHint]) return languageHint;
      // 文字脚本明显变化时清除旧轨道样本，仍由语言识别器确认结果。
      const script = (text.match(/[\uac00-\ud7af]/g) || []).length >= 3 ? 'ko' : (text.match(/[\u3040-\u30ff]/g) || []).length >= 3 ? 'ja' : (text.match(/[a-z]/gi) || []).length >= 12 ? 'latin' : '';
      if (script && this.script && script !== this.script) { this.samples = []; this.language = ''; this.generation++; }
      if (script) this.script = script;
      if (this.samples.at(-1) !== text) this.samples.push(text);
      this.samples = this.samples.slice(-5);
      const sample = this.samples.join(' ').slice(-1200);
      if (sample.replace(/[^\p{L}]/gu, '').length < 12) return this.language;
      const generation = this.generation;
      try {
        const result = await chrome.i18n.detectLanguage(sample);
        if (generation !== this.generation || requestSequence !== this.requestSequence) return '';
        const top = result.languages?.[0];
        const code = N.languageCode(top?.language);
        if (result.isReliable && top?.percentage >= 70 && N.LANGUAGES[code]) this.language = code;
      } catch (_) { /* 识别不可用时保留手动选择入口。 */ }
      return this.language;
    }
  }
  Object.assign(N, { request, LocalProvider, TranslationService, LanguageResolver });
})(globalThis);
