/** 创建可控的异步承诺。 */
function deferred() { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
/** 创建可监听与触发的 Chrome 事件。 */
function event() { const listeners = new Set(); return { addListener(fn) { listeners.add(fn); }, removeListener(fn) { listeners.delete(fn); }, emit(...args) { for (const fn of listeners) fn(...args); } }; }
/** 提供内存版 Chrome 权限及存储接口，不连接用户浏览器。 */
function mockChrome(initial = {}) {
  const data = { settings: { onlineFallback: true }, words: [], ...initial };
  const api = { granted: true, data, storage: { onChanged: event(), local: {
    async get(keys) { if (typeof keys === 'string') return { [keys]: structuredClone(data[keys]) }; return Object.fromEntries(keys.map(key => [key, structuredClone(data[key])])); },
    async set(patch) { const changes = {}; for (const [key, value] of Object.entries(patch)) { changes[key] = { oldValue: data[key], newValue: structuredClone(value) }; data[key] = structuredClone(value); } api.storage.onChanged.emit(changes, 'local'); }
  } }, permissions: { async contains() { return api.granted; }, onRemoved: event() },
    runtime: { id: 'test-extension', getURL(file) { return 'chrome-extension://test-extension/' + file; }, onMessage: event(), onInstalled: event() },
    tabs: { async create(options) { return options; } }
  };
  return api;
}
/** 构造符合 MyMemory 协议的响应。 */
function response(text = '你好', extra = {}, status = 200) { return { ok: status >= 200 && status < 300, status, async json() { return { responseStatus: 200, responseData: { translatedText: text }, ...extra }; } }; }
module.exports = { deferred, event, mockChrome, response };
