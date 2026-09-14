const test = require('node:test');
const assert = require('node:assert/strict');
require('../lib/core.js'); require('../lib/translation.js');
const N = globalThis.NetflixTranslate;
const { deferred } = require('./helpers.cjs');
test('首次下载必须由初始化入口触发，进度与语言参数完整', async () => {
  let creates = 0, options; const states = [];
  const instance = { async translate() { return '你好'; }, destroy() {} };
  const provider = new N.LocalProvider(state => states.push(state), { Translator: {
    async availability() { return 'downloadable'; }, create(input) { creates++; options = input; input.monitor({ addEventListener(type, listener) { listener({ loaded: .5 }); } }); return Promise.resolve(instance); }
  } });
  await assert.rejects(provider.translate('Hello', 'en'), error => error.code === 'NEEDS_ACTIVATION'); assert.equal(creates, 0);
  await provider.initialize('en'); assert.equal(options.sourceLanguage, 'en'); assert.equal(options.targetLanguage, 'zh');
  assert.ok(states.some(state => state.progress === 50)); assert.equal((await provider.translate('Hello', 'en')).text, '你好'); provider.dispose();
});
test('下载失败可重试，已失效下载的模型被销毁', async () => {
  const gate = deferred(); let destroyed = false;
  const provider = new N.LocalProvider(() => {}, { Translator: { create: () => gate.promise } });
  const pending = provider.initialize('ja'); provider.dispose(); gate.resolve({ destroy() { destroyed = true; } });
  await assert.rejects(pending, error => error.code === 'CANCELLED'); assert.equal(destroyed, true);
  const failed = new N.LocalProvider(() => {}, { Translator: { create: () => Promise.reject(Error('download failed')) } });
  await assert.rejects(failed.initialize('ko'), error => error.code === 'LOCAL_FAILED'); assert.equal(failed.creating, null);
  const browserFailure = new N.LocalProvider(() => {}, { Translator: { create: () => Promise.reject(new DOMException('Download failed', 'AbortError')) } });
  await assert.rejects(browserFailure.initialize('en'), error => error.code === 'LOCAL_FAILED' && error.message.includes('本地翻译失败'));
});
test('本地不可用且未允许备用时不发送字幕', async () => {
  let calls = 0; globalThis.chrome = { runtime: { async sendMessage() { calls++; } } };
  const service = new N.TranslationService(() => {}, {});
  await assert.rejects(service.translate('Hello', 'en'), error => error.code === 'UNSUPPORTED'); assert.equal(calls, 0);
});
test('换集后旧本地请求失败不会触发在线备用', async () => {
  let calls = 0; globalThis.chrome = { runtime: { async sendMessage() { calls++; } } };
  const service = new N.TranslationService(() => {}, {}); service.configure({ onlineFallback: true });
  const gate = deferred(); service.local.translate = () => gate.promise;
  const pending = service.translate('Old subtitle', 'en'); service.invalidate(); gate.reject(N.failure('LOCAL_FAILED'));
  await assert.rejects(pending, error => error.code === 'CANCELLED'); assert.equal(calls, 0);
});
test('语言识别聚合多句，手动选择优先且不猜单词', async () => {
  const inputs = []; globalThis.chrome = { i18n: { async detectLanguage(text) { inputs.push(text); return { isReliable: true, languages: [{ language: 'en', percentage: 100 }] }; } } };
  const resolver = new N.LanguageResolver(); assert.equal(await resolver.resolve('Hi', 'auto'), ''); assert.equal(inputs.length, 0);
  assert.equal(await resolver.resolve('It is a beautiful day.', 'auto'), 'en'); assert.ok(inputs[0].includes('Hi'));
  assert.equal(await resolver.resolve('hello', 'ja'), 'ja'); resolver.reset(); assert.equal(resolver.language, '');
});
test('日韩字幕切换时移除旧文字脚本样本', async () => {
  const samples = []; globalThis.chrome = { i18n: { async detectLanguage(text) { samples.push(text); return { isReliable: true, languages: [{ language: /[\u3040-\u30ff]/.test(text) ? 'ja' : 'ko', percentage: 100 }] }; } } };
  const resolver = new N.LanguageResolver();
  assert.equal(await resolver.resolve('今日は新しい物語が始まります。', 'auto'), 'ja');
  assert.equal(await resolver.resolve('오늘은 새로운 이야기가 시작됩니다.', 'auto'), 'ko');
  assert.ok(!samples.at(-1).includes('今日は'));
});
test('较早的语言检测迟到时不能污染当前识别结果', async () => {
  const old = deferred(); let calls = 0;
  globalThis.chrome = { i18n: { detectLanguage() { return ++calls === 1 ? old.promise : Promise.resolve({ isReliable: true, languages: [{ language: 'fr', percentage: 100 }] }); } } };
  const resolver = new N.LanguageResolver();
  const pending = resolver.resolve('This is a previous subtitle.', 'auto');
  assert.equal(await resolver.resolve('Nous commençons une nouvelle histoire.', 'auto'), 'fr');
  old.resolve({ isReliable: true, languages: [{ language: 'en', percentage: 100 }] });
  assert.equal(await pending, ''); assert.equal(resolver.language, 'fr');
});
