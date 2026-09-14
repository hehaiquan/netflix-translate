/* 仅由后台脚本调用的 MyMemory 适配器。 */
(function initMyMemory(scope) {
  'use strict';
  const N = scope.NetflixTranslate;
  const ORIGIN = 'https://api.mymemory.translated.net/*';
  class MyMemoryProvider {
    /** 注入权限、设置及存储访问，便于使用固定响应验证异常路径。 */
    constructor(api, fetcher = fetch, now = Date.now) {
      this.api = api; this.fetcher = fetcher; this.now = now;
      this.tail = Promise.resolve(); this.cache = new N.LruCache(500); this.active = null;
    }
    /** 获取当天额度状态；上游仍可能按共享公网 IP 提前限额。 */
    async status() {
      const data = (await this.api.storage.local.get('onlineUsage')).onlineUsage;
      const day = new Date(this.now()).toISOString().slice(0, 10);
      return data?.day === day ? data : { day, used: 0, blocked: '' };
    }
    /** 停止正在发出的在线请求，供撤销权限和关闭备用使用。 */
    cancel() { this.active?.abort(); this.cache.clear(); }
    /** 仅手动解除临时限流，日额度不足不能通过重试绕过。 */
    async retry() {
      const status = await this.status();
      if (status.blocked === 'RATE_LIMIT') { status.blocked = ''; await this.api.storage.local.set({ onlineUsage: status }); }
      return status;
    }
    /** 串行校验及扣减额度，多个标签页共享每日预算。 */
    translate(text, sourceLanguage) {
      const run = this.tail.then(() => this.run(text, sourceLanguage));
      this.tail = run.catch(() => {}); return run;
    }
    /** 每次网络请求前重新确认用户开关及实际权限。 */
    async authorize() {
      const { settings } = await this.api.storage.local.get('settings');
      if (!N.normalizeSettings(settings).onlineFallback) throw N.failure('ONLINE_DISABLED');
      if (!await this.api.permissions.contains({ origins: [ORIGIN] })) throw N.failure('PERMISSION_DENIED');
    }
    /** 调用固定只读接口，处理字节限制、错误正文与取消请求。 */
    async run(text, sourceLanguage) {
      const source = N.languageCode(sourceLanguage);
      if (!N.LANGUAGES[source] || typeof text !== 'string' || !text.trim() || text.length > 6000) throw N.failure('INVALID_REQUEST');
      await this.authorize();
      const key = source + ':' + text;
      const cached = this.cache.get(key);
      if (cached) return cached;
      const usage = await this.status();
      if (usage.blocked) throw N.failure(usage.blocked);
      const count = Array.from(text).length;
      if (usage.used + count > 5000) { usage.blocked = 'QUOTA'; await this.api.storage.local.set({ onlineUsage: usage }); throw N.failure('QUOTA'); }
      const output = [];
      for (const chunk of N.splitUtf8(text, 500)) {
        await this.authorize();
        usage.used += Array.from(chunk).length;
        await this.api.storage.local.set({ onlineUsage: usage });
        const url = new URL('https://api.mymemory.translated.net/get');
        url.search = new URLSearchParams({ q: chunk, langpair: (source === 'zh-Hant' ? 'zh-TW' : source) + '|zh-CN', mt: '1' }).toString();
        const abort = new AbortController(); this.active = abort;
        try {
          const response = await N.withTimeout(this.fetcher(url.href, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: abort.signal }), 8000, () => abort.abort());
          if (response.status === 429) throw N.failure('RATE_LIMIT');
          if (!response.ok) throw N.failure('REMOTE_ERROR');
          const body = await N.withTimeout(response.json(), 3000, () => abort.abort());
          const details = String(body.responseDetails || '');
          if (body.quotaFinished || /quota|daily limit|next available|used all available/i.test(details) || Number(body.responseStatus) === 403) throw N.failure('QUOTA');
          if (Number(body.responseStatus) === 429) throw N.failure('RATE_LIMIT');
          const translated = body.responseData?.translatedText;
          if (Number(body.responseStatus) !== 200 || typeof translated !== 'string' || !translated.trim()) throw N.failure('REMOTE_ERROR');
          await this.authorize();
          output.push(translated);
        } catch (error) {
          const code = N.ERRORS[error.code] ? error.code : (abort.signal.aborted ? 'CANCELLED' : 'REMOTE_ERROR');
          if (code === 'QUOTA' || code === 'RATE_LIMIT') { usage.blocked = code; await this.api.storage.local.set({ onlineUsage: usage }); }
          throw N.failure(code);
        } finally { this.active = null; }
      }
      const result = { text: output.join(''), provider: 'mymemory' };
      this.cache.set(key, result); return result;
    }
  }
  Object.assign(N, { MyMemoryProvider, MYMEMORY_ORIGIN: ORIGIN });
})(globalThis);
