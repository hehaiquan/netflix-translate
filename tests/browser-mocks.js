/* 仅用于本机模拟页面，不在 manifest 中引用。 */
(function setupBrowserMocks() {
  const handlers = new Set(), messages = new Set();
  const initial = { settings: { enabled: true, sourceLanguage: 'en', fontSize: 26, backgroundOpacity: 65, bottomOffset: 10, onlineFallback: false }, words: [] };
  let data;
  try { data = JSON.parse(localStorage.getItem('nt-fixture-data')) || initial; } catch (_) { data = initial; }
  const state = window.ntFixture = { calls: [], remoteCalls: 0, localAvailability: 'available', granted: false, data };
  const api = window.chrome || (window.chrome = {});
  /** 在测试页面内发送消息，不调用扩展或外部服务。 */
  async function sendMessage(message) {
    const N = window.NetflixTranslate;
    switch (message.type) {
      case 'VOCAB_LIST': return { ok: true, value: data.words };
      case 'VOCAB_SAVE': {
        const word = N.normalizeWord(message.word); const existing = data.words.find(item => item.id === word.id);
        if (!existing) { const words = [word, ...data.words]; await api.storage.local.set({ words }); }
        return { ok: true, value: { word: existing || word, existed: !!existing } };
      }
      case 'VOCAB_DELETE': await api.storage.local.set({ words: data.words.filter(word => word.id !== message.id) }); return { ok: true, value: true };
      case 'ONLINE_STATUS': return { ok: true, value: { used: 0, blocked: '' } };
      case 'ONLINE_RETRY': return { ok: true, value: true };
      case 'OPEN_VOCAB': window.open('/vocabulary.html?fixture=1', '_blank'); return { ok: true, value: true };
      case 'TRANSLATE_ONLINE': state.remoteCalls++; return { ok: true, value: { text: '在线译文：' + message.text, provider: 'mymemory' } };
      default: return { ok: false, code: 'INVALID_REQUEST' };
    }
  }
  Object.assign(api, {
    storage: { local: {
      async get(keys) { if (typeof keys === 'string') return { [keys]: data[keys] }; return Object.fromEntries(keys.map(key => [key, data[key]])); },
      async set(patch) { const changes = {}; for (const [key, value] of Object.entries(patch)) { changes[key] = { oldValue: data[key], newValue: value }; data[key] = value; } localStorage.setItem('nt-fixture-data', JSON.stringify(data)); for (const handler of handlers) handler(changes, 'local'); }
    }, onChanged: { addListener(fn) { handlers.add(fn); }, removeListener(fn) { handlers.delete(fn); } } },
    runtime: { id: 'fixture', sendMessage, getURL(file) { return '/' + file + '?fixture=1'; }, onMessage: { addListener(fn) { messages.add(fn); }, removeListener(fn) { messages.delete(fn); } } },
    i18n: { async detectLanguage(text) { return { isReliable: true, languages: [{ language: /[\u3040-\u30ff]/.test(text) ? 'ja' : /[\uac00-\ud7af]/.test(text) ? 'ko' : 'en', percentage: 100 }] }; } },
    permissions: { async request() { state.granted = true; return true; }, async contains() { return state.granted; }, async remove() { state.granted = false; return true; } },
    tabs: { async query() { return [{ id: 1 }]; }, async sendMessage() { return { status: '本机模拟播放页', title: '字幕层与交互测试' }; } }
  });
  window.Translator = {
    async availability() { return state.localAvailability; },
    async create(options) {
      let destroyed = false;
      if (state.localAvailability === 'downloadable') {
        options.monitor?.({ addEventListener(type, callback) { callback({ loaded: .5 }); } });
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return {
        async translate(text) { state.calls.push(text); await new Promise(resolve => setTimeout(resolve, text.startsWith('SLOW') ? 450 : 25)); if (destroyed) throw Error('destroyed'); return '译：' + text; },
        destroy() { destroyed = true; }
      };
    }
  };
})();
