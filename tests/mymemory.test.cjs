const test = require('node:test');
const assert = require('node:assert/strict');
require('../lib/core.js'); require('../lib/mymemory.js');
const N = globalThis.NetflixTranslate;
const { mockChrome, response, deferred } = require('./helpers.cjs');
test('未开启或撤回权限时不发出任何请求', async () => {
  const api = mockChrome({ settings: { onlineFallback: false } }); let calls = 0;
  const provider = new N.MyMemoryProvider(api, async () => { calls++; return response(); });
  await assert.rejects(provider.translate('Hello', 'en'), error => error.code === 'ONLINE_DISABLED');
  api.data.settings.onlineFallback = true; api.granted = false;
  await assert.rejects(provider.translate('Hello', 'en'), error => error.code === 'PERMISSION_DENIED'); assert.equal(calls, 0);
});
test('固定接口、UTF-8 分块、去除凭据及额度记账', async () => {
  const api = mockChrome(), calls = [];
  const provider = new N.MyMemoryProvider(api, async (url, options) => { calls.push({ url: new URL(url), options }); return response('译'); });
  const input = 'こんにちは世界。'.repeat(30);
  await provider.translate(input, 'ja');
  assert.ok(calls.length > 1); assert.ok(calls.every(call => call.url.origin === 'https://api.mymemory.translated.net' && call.url.pathname === '/get'));
  assert.ok(calls.every(call => Buffer.byteLength(call.url.searchParams.get('q')) <= 500 && call.options.credentials === 'omit'));
  assert.equal((await provider.status()).used, Array.from(input).length);
  await provider.translate(input, 'ja'); assert.equal(calls.length, N.splitUtf8(input).length);
});
test('共享额度并发时不会超支，次日可以重新请求', async () => {
  let time = Date.UTC(2026, 8, 14, 12), calls = 0;
  const api = mockChrome({ onlineUsage: { day: '2026-09-14', used: 4996, blocked: '' } });
  const provider = new N.MyMemoryProvider(api, async () => { calls++; return response(); }, () => time);
  const results = await Promise.allSettled([provider.translate('one', 'en'), provider.translate('two', 'en')]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].reason.code, 'QUOTA'); assert.equal(calls, 1);
  time += 86400000; await provider.translate('two', 'en'); assert.equal(calls, 2);
});
test('上游限额正文不能作为字幕，后续请求暂停', async () => {
  const api = mockChrome(); let calls = 0;
  const provider = new N.MyMemoryProvider(api, async () => { calls++; return response('YOU USED ALL AVAILABLE FREE TRANSLATIONS', { quotaFinished: true, responseStatus: 403 }); });
  await assert.rejects(provider.translate('hello', 'en'), error => error.code === 'QUOTA');
  await assert.rejects(provider.translate('another', 'en'), error => error.code === 'QUOTA'); assert.equal(calls, 1);
});
test('429 暂停可手动重试，权限撤回后不返回迟到的结果', async () => {
  const api = mockChrome(); let calls = 0;
  const provider = new N.MyMemoryProvider(api, async () => ++calls === 1 ? response('', {}, 429) : response());
  await assert.rejects(provider.translate('hello', 'en'), error => error.code === 'RATE_LIMIT');
  await assert.rejects(provider.translate('again', 'en'), error => error.code === 'RATE_LIMIT');
  await provider.retry(); await provider.translate('again', 'en'); assert.equal(calls, 2);
  const gate = deferred(); const slow = new N.MyMemoryProvider(api, () => gate.promise);
  const request = slow.translate('slow', 'en'); await new Promise(resolve => setImmediate(resolve)); api.granted = false; gate.resolve(response());
  await assert.rejects(request, error => error.code === 'PERMISSION_DENIED');
});
test('网络超时被取消，非成功业务响应不显示为译文', async () => {
  const original = N.withTimeout; N.withTimeout = (promise, ms, cancel) => original(promise, 15, cancel);
  try {
    let signal; const api = mockChrome();
    const slow = new N.MyMemoryProvider(api, (url, options) => { signal = options.signal; return new Promise(() => {}); });
    await assert.rejects(slow.translate('hello', 'en'), error => error.code === 'TIMEOUT'); assert.ok(signal.aborted);
    const failed = new N.MyMemoryProvider(api, async () => response('Invalid language pair', { responseStatus: 400 }));
    await assert.rejects(failed.translate('hello', 'en'), error => error.code === 'REMOTE_ERROR');
    const cancelled = new N.MyMemoryProvider(api, (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))));
    const pending = cancelled.translate('cancel me', 'en'); await new Promise(resolve => setImmediate(resolve)); cancelled.cancel();
    await assert.rejects(pending, error => error.code === 'CANCELLED');
  } finally { N.withTimeout = original; }
});
