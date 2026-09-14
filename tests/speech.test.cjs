const test = require('node:test');
const assert = require('node:assert/strict');
const { getEventListeners } = require('node:events');
require('../lib/core.js');
require('../lib/speech.js');
const N = globalThis.NetflixTranslate;

/** 构造本地或远程语音，用于验证语言与音色选择。 */
function voice(lang, options = {}) {
  return { lang, name: lang, localService: true, default: false, ...options };
}

/** 模拟设备语音事件，不发出声音或连接在线服务。 */
function mockSpeech(voices = [voice('en-US')]) {
  const synth = new EventTarget();
  Object.assign(synth, {
    voices, spoken: [], cancellations: 0, paused: false, calls: [], autoStart: true,
    /** 返回当前可用音色，允许测试模拟延迟加载。 */
    getVoices() { return this.voices; },
    /** 保存实际提交的文本及语音参数，并触发开始事件。 */
    speak(utterance) {
      this.calls.push('speak');
      if (this.throwNext) { this.throwNext = false; throw Error('engine failed'); }
      this.spoken.push(utterance);
      if (this.autoStart) utterance.onstart();
    },
    /** 记录取消请求，旧事件由各测试独立触发。 */
    cancel() { this.cancellations++; this.calls.push('cancel'); },
    /** 模拟恢复被暂停的设备语音队列。 */
    resume() { this.paused = false; this.calls.push('resume'); }
  });
  class Utterance {
    /** 保留生产控制器提交的朗读原文。 */
    constructor(text) { this.text = text; }
  }
  return { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance };
}

test('仅使用本地同语种语音，地区音色优先且支持下划线语言标签', () => {
  const remote = voice('en-US', { localService: false, default: true });
  const english = voice('en_US');
  const japanese = voice('ja-JP');
  const voices = [remote, voice('en-GB'), japanese, english];
  assert.equal(N.selectSpeechVoice(voices, 'en'), english);
  assert.equal(N.selectSpeechVoice(voices, 'ja'), japanese);
  assert.equal(N.selectSpeechVoice(voices, 'ko'), null);
  assert.equal(N.selectSpeechVoice([remote], 'en'), null);
});

test('繁简中文分开选音，其他语种优先选择系统默认音色', () => {
  const traditional = voice('zh-TW');
  const simplified = voice('zh-CN');
  const french = voice('fr-CA', { default: true });
  const voices = [voice('zh-HK'), simplified, traditional, voice('fr-FR'), french];
  assert.equal(N.selectSpeechVoice(voices, 'zh-Hant'), traditional);
  assert.equal(N.selectSpeechVoice(voices, 'zh'), simplified);
  assert.equal(N.selectSpeechVoice([simplified], 'zh-Hant'), null);
  assert.equal(N.selectSpeechVoice(voices, 'fr'), french);
});

test('单词与对白使用指定原文，播放完成恢复状态，再次点击可停止', async () => {
  const host = mockSpeech([voice('ja-JP')]);
  const states = [];
  const player = new N.SpeechPlayer(state => states.push(state), host);
  await player.toggle('word:term', '木漏れ日', 'ja');
  const term = host.speechSynthesis.spoken[0];
  assert.equal(term.text, '木漏れ日');
  assert.equal(term.lang, 'ja-JP');
  assert.equal(player.state.status, 'speaking');
  term.onend();
  assert.equal(player.state.status, 'idle');
  await player.toggle('word:context', '木漏れ日の中を歩こう。', 'ja');
  assert.equal(host.speechSynthesis.spoken[1].text, '木漏れ日の中を歩こう。');
  await player.toggle('word:context', '木漏れ日の中を歩こう。', 'ja');
  assert.equal(host.speechSynthesis.spoken.length, 2);
  assert.equal(host.speechSynthesis.cancellations, 1);
  assert.equal(player.state.status, 'idle');
  assert.deepEqual(states.slice(0, 3).map(state => state.status), ['loading', 'speaking', 'idle']);
});

test('切换朗读取消上一段，迟到的开始、结束和错误事件不覆盖新会话', async () => {
  const host = mockSpeech();
  const player = new N.SpeechPlayer(() => {}, host);
  await player.toggle('first:term', 'hello', 'en');
  const old = host.speechSynthesis.spoken[0];
  await player.toggle('second:context', 'Every word has a story.', 'en');
  old.onstart();
  old.onend();
  old.onerror({ error: 'synthesis-failed' });
  assert.equal(host.speechSynthesis.cancellations, 1);
  assert.equal(player.state.key, 'second:context');
  assert.equal(player.state.status, 'speaking');
  player.stop();
});

test('语音列表异步加载时只播放最后一次点击，并释放等待监听', async () => {
  const host = mockSpeech([]);
  const player = new N.SpeechPlayer(() => {}, host);
  const first = player.toggle('first:term', 'hello', 'en');
  const latest = player.toggle('second:term', '괜찮아', 'ko');
  assert.equal(player.state.status, 'loading');
  host.speechSynthesis.voices = [voice('en-US'), voice('ko-KR')];
  host.speechSynthesis.dispatchEvent(new Event('voiceschanged'));
  await Promise.all([first, latest]);
  assert.equal(host.speechSynthesis.spoken.length, 1);
  assert.equal(host.speechSynthesis.spoken[0].text, '괜찮아');
  assert.equal(getEventListeners(host.speechSynthesis, 'voiceschanged').length, 0);
  player.stop();
});

test('在语音加载完成前停止，迟到的语音列表不会自动发音', async () => {
  const host = mockSpeech([]);
  const player = new N.SpeechPlayer(() => {}, host);
  const pending = player.toggle('word:term', 'hello', 'en');
  await player.toggle('word:term', 'hello', 'en');
  host.speechSynthesis.voices = [voice('en-US')];
  host.speechSynthesis.dispatchEvent(new Event('voiceschanged'));
  await pending;
  assert.equal(player.state.status, 'idle');
  assert.equal(host.speechSynthesis.spoken.length, 0);
  assert.equal(getEventListeners(host.speechSynthesis, 'voiceschanged').length, 0);
});

test('浏览器不支持或缺少对应本地语音时给出提示，不选远程或其他语言', async () => {
  const unsupported = new N.SpeechPlayer(() => {}, {});
  await unsupported.toggle('word:term', 'hello', 'en');
  assert.match(unsupported.state.message, /当前浏览器不支持/);
  const host = mockSpeech([voice('en-US'), voice('ko-KR', { localService: false })]);
  const player = new N.SpeechPlayer(() => {}, host);
  await player.toggle('word:term', '괜찮아', 'ko');
  assert.equal(player.state.key, 'word:term');
  assert.match(player.state.message, /韩语本地语音/);
  assert.equal(host.speechSynthesis.spoken.length, 0);
  player.stop();
});

test('设备出错与同步异常恢复按钮，允许重试，主动中断不报错误', async () => {
  const host = mockSpeech();
  const player = new N.SpeechPlayer(() => {}, host);
  await player.toggle('word:term', 'hello', 'en');
  host.speechSynthesis.spoken[0].onerror({ error: 'audio-hardware' });
  assert.equal(player.state.status, 'error');
  assert.match(player.state.message, /音频输出/);
  host.speechSynthesis.throwNext = true;
  await player.toggle('word:term', 'hello', 'en');
  assert.equal(player.state.status, 'error');
  await player.toggle('word:term', 'hello', 'en');
  assert.equal(player.state.status, 'speaking');
  host.speechSynthesis.spoken.at(-1).onerror({ error: 'interrupted' });
  assert.equal(player.state.status, 'idle');
});

test('新朗读恢复设备残留的暂停状态', async () => {
  const host = mockSpeech();
  host.speechSynthesis.paused = true;
  const player = new N.SpeechPlayer(() => {}, host);
  await player.toggle('word:term', 'hello', 'en');
  assert.deepEqual(host.speechSynthesis.calls, ['resume', 'speak']);
  player.stop();
});

test('语音列表始终为空时结束等待并提示，不遗留监听或声音', async () => {
  const host = mockSpeech([]);
  const player = new N.SpeechPlayer(() => {}, host);
  await player.toggle('word:term', 'hello', 'en');
  assert.equal(player.state.status, 'error');
  assert.match(player.state.message, /英语本地语音/);
  assert.equal(getEventListeners(host.speechSynthesis, 'voiceschanged').length, 0);
  assert.equal(host.speechSynthesis.spoken.length, 0);
});
