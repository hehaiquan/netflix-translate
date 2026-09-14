/* 真正运行生产字幕适配和界面代码；仅替换媒体状态与翻译服务。 */
const video = document.querySelector('video');
let paused = false, position = 12, seeking = false;
Object.defineProperties(video, { paused: { get: () => paused }, currentTime: { get: () => position, set: value => { position = value; seeking = true; video.dispatchEvent(new Event('seeking')); queueMicrotask(() => { seeking = false; video.dispatchEvent(new Event('seeked')); }); } }, seeking: { get: () => seeking } });
video.play = async function playMockVideo() { paused = false; video.dispatchEvent(new Event('play')); };
video.pause = function pauseMockVideo() { paused = true; video.dispatchEvent(new Event('pause')); };
/** 等待可观察到的界面状态，失败时输出明确断言。 */
async function until(check, label, timeout = 3500) { const start = Date.now(); while (!check()) { if (Date.now() - start > timeout) throw Error(label); await new Promise(resolve => setTimeout(resolve, 20)); } }
/** 修改模拟原生字幕。 */
function cue(text) { document.querySelector('.player-timedtext-text-container').textContent = text; }
/** 读取当前 Shadow DOM。 */
function overlay() { return document.querySelector('#netflix-translate-overlay')?.shadowRoot; }
/** 从生产界面的词语元素触发完整鼠标选择流程。 */
function clickFirstWord() { const word = overlay().querySelector('.word'); word.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0 })); word.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, button: 0 })); }
/** 更新模拟设置并等待异步渲染。 */
async function settings(patch) { await chrome.storage.local.set({ settings: { ...ntFixture.data.settings, ...patch } }); }
/** 使用不同文字脚本检验自动识别和分词。 */
async function sample(language, text) { await settings({ sourceLanguage: language, enabled: true }); cue(text); }
document.querySelector('#english').addEventListener('click', () => sample('en', 'Every word has a story to tell.'));
document.querySelector('#japanese').addEventListener('click', () => sample('ja', '今日は新しい物語が始まります。'));
document.querySelector('#korean').addEventListener('click', () => sample('ko', '오늘은 새로운 이야기가 시작됩니다.'));
document.querySelector('#fullscreen').addEventListener('click', async function enterFullscreen() {
  try { await document.querySelector('[data-uia="player"]').requestFullscreen(); }
  catch (error) { document.querySelector('#results').append(document.createTextNode('\n全屏未进入：' + error.message)); }
});

/** 顺序验证真实 DOM 适配、异步失效、查词与本地保存。 */
async function runTests() {
  const button = document.querySelector('#run-tests'); button.disabled = true;
  const results = document.querySelector('#results'); results.textContent = '';
  document.body.classList.remove('lln-active'); history.replaceState({}, '', '/watch/999');
  const checks = [];
  /** 记录一项行为测试结果并继续后续独立场景。 */
  async function check(label, work) { try { await work(); checks.push({ label, passed: true }); results.append(document.createTextNode('✓ ' + label + '\n')); } catch (error) { checks.push({ label, passed: false }); results.append(document.createTextNode('✗ ' + label + '：' + error.message + '\n')); } }
  await settings({ enabled: true, sourceLanguage: 'en', onlineFallback: false }); await chrome.storage.local.set({ words: [] });
  await check('原生文字字幕接管与双语显示', async () => { cue('Every word has a story to tell.'); await until(() => overlay()?.querySelector('.translated').textContent === '译：Every word has a story to tell.', '未显示译文'); if (getComputedStyle(document.querySelector('.player-timedtext')).opacity !== '0') throw Error('原字幕未接管'); });
  await check('Netflix 重写行内样式后仍隐藏原生字幕', async () => {
    const native = document.querySelector('.player-timedtext'); native.setAttribute('style', 'display: block; opacity: .7;');
    if (getComputedStyle(native).opacity !== '0') throw Error('行内样式重写导致字幕重叠');
  });
  await check('空字幕立即清除译文并保留 Netflix 当前样式', async () => { cue(''); await until(() => overlay().querySelector('.captions').hidden, '字幕未清空'); const native = document.querySelector('.player-timedtext'); if (native.hasAttribute('data-netflix-translate-hidden') || getComputedStyle(native).opacity !== '0.7') throw Error('Netflix 当前样式未恢复'); native.removeAttribute('style'); });
  await check('Netflix 界面语言不会覆盖实际字幕语言', async () => {
    document.querySelector('[data-uia="player"]').setAttribute('lang', 'zh-CN'); await settings({ sourceLanguage: 'auto' });
    cue('A subtitle in English should remain English.');
    await until(() => NetflixTranslate.controller.language === 'en' && overlay().querySelector('.translated').textContent === '译：A subtitle in English should remain English.', '错误使用了界面语言');
    document.querySelector('[data-uia="player"]').removeAttribute('lang'); await settings({ sourceLanguage: 'en' });
  });
  await check('慢响应与连续换句不串句，等待任务有上限', async () => {
    const before = ntFixture.calls.length; cue('SLOW previous subtitle sentence.'); await until(() => ntFixture.calls.length > before, '旧请求未开始');
    for (let i = 0; i < 6; i++) { cue('Discarded subtitle number ' + i); await new Promise(resolve => setTimeout(resolve, 25)); }
    cue('Only the newest subtitle is visible.'); await until(() => overlay().querySelector('.translated').textContent === '译：Only the newest subtitle is visible.', '未显示最新译文');
    if (ntFixture.calls.length - before > 3) throw Error('请求出现积压');
  });
  await check('跳转进度丢弃旧字幕结果', async () => { cue('SLOW seeking test sentence.'); await new Promise(resolve => setTimeout(resolve, 60)); video.currentTime = 90; cue('The scene after seeking is ready.'); await until(() => overlay().querySelector('.translated').textContent === '译：The scene after seeking is ready.', '跳转后字幕错误'); });
  await check('查词暂停，关闭后恢复原先播放', async () => { await video.play(); clickFirstWord(); await until(() => !overlay().querySelector('.save').disabled, '查词失败'); if (!video.paused) throw Error('未暂停'); overlay().querySelector('.close').click(); await until(() => !video.paused, '没有恢复播放'); });
  await check('原本暂停的视频不会被查词自动播放', async () => { video.pause(); clickFirstWord(); await until(() => !overlay().querySelector('.save').disabled, '查词未完成'); overlay().querySelector('.close').click(); if (!video.paused) throw Error('错误恢复播放'); });
  await check('拖选在字幕外结束或被取消时恢复播放', async () => {
    for (const type of ['pointerup', 'pointercancel']) {
      await video.play(); const source = overlay().querySelector('.original');
      source.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0 }));
      if (!video.paused) throw Error('拖选时未暂停');
      overlay().querySelector('.tools').dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, button: 0 }));
      await until(() => !video.paused && !NetflixTranslate.controller.selecting, '取消拖选后没有恢复播放');
    }
  });
  await check('短句拖选使用选中范围，收藏绑定原句上下文', async () => {
    const source = overlay().querySelector('.original'); const selectedWords = source.querySelectorAll('.word');
    const range = document.createRange(); range.setStartBefore(selectedWords[0]); range.setEndAfter(selectedWords[2]); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    source.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0 })); selectedWords[2].dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, button: 0 }));
    await until(() => !overlay().querySelector('.save').disabled, '短句翻译失败');
    if (overlay().querySelector('.term').textContent !== 'The scene after') throw Error('短句范围错误');
    overlay().querySelector('.save').click(); await until(() => ntFixture.data.words.length === 1, '未保存');
    if (ntFixture.data.words[0].context !== 'The scene after seeking is ready.') throw Error('收藏上下文不一致');
    overlay().querySelector('.close').click(); selection.removeAllRanges();
  });
  await check('重复收藏去重', async () => { const word = ntFixture.data.words[0]; await chrome.runtime.sendMessage({ type: 'VOCAB_SAVE', word }); if (ntFixture.data.words.length !== 1) throw Error('收藏重复'); });
  await check('自动识别日文与韩文，分词不丢失文本', async () => {
    for (const [language, text] of [['ja', '今日は新しい物語が始まります。'], ['ko', '오늘은 새로운 이야기가 시작됩니다.']]) {
      await settings({ sourceLanguage: 'auto' }); cue(text);
      await until(() => NetflixTranslate.controller.language === language && overlay().querySelector('.translated').textContent === '译：' + text, '语言识别错误：' + language);
      if (overlay().querySelector('.original').textContent !== text) throw Error('分词丢字');
    }
  });
  await check('换集使查词浮窗及旧上下文失效', async () => {
    clickFirstWord(); await until(() => !overlay().querySelector('.lookup').hidden, '查词未打开');
    history.pushState({}, '', '/watch/1000'); cue('새로운 에피소드가 지금 시작됩니다.');
    await until(() => overlay().querySelector('.lookup').hidden && NetflixTranslate.controller.latest.videoId === '1000', '换集未清理');
  });
  await check('冲突提示不依赖其他扩展的字幕', async () => { document.body.classList.add('lln-active'); await until(() => overlay().querySelector('.status').textContent.includes('其他字幕扩展'), '未提示冲突'); if (document.querySelector('.player-timedtext').style.opacity) throw Error('冲突时仍隐藏原字幕'); document.body.classList.remove('lln-active'); await until(() => !overlay().querySelector('.captions').hidden, '未恢复字幕'); });
  await check('关闭功能移除显示层并恢复原字幕', async () => { await settings({ enabled: false }); await until(() => !overlay(), '显示层仍然存在'); if (document.querySelector('.player-timedtext').style.opacity) throw Error('原字幕未恢复'); });
  await check('重新开启后恢复工作', async () => { await sample('en', 'Every word has a story to tell.'); await until(() => overlay()?.querySelector('.translated').textContent === '译：Every word has a story to tell.', '无法重新开启'); });
  await check('扩展失效清理时恢复插件暂停的视频和原生字幕', async () => {
    await video.play(); clickFirstWord(); await until(() => !overlay().querySelector('.lookup').hidden, '查词未打开');
    NetflixTranslate.controller.destroy(true);
    if (overlay() || video.paused || document.querySelector('.player-timedtext').style.opacity) throw Error('清理后遗留显示层或暂停状态');
    NetflixTranslate.controller = new NetflixTranslate.SubtitleController(); await NetflixTranslate.controller.start();
    await until(() => overlay()?.querySelector('.translated').textContent === '译：Every word has a story to tell.', '重新初始化失败');
  });
  results.dataset.failed = checks.filter(item => !item.passed).length; results.dataset.passed = checks.filter(item => item.passed).length;
  results.append(document.createTextNode('\n通过 ' + results.dataset.passed + ' / ' + checks.length + ' 项。'));
  results.className = Number(results.dataset.failed) ? 'failed' : 'passed'; button.disabled = false;
}
document.querySelector('#run-tests').addEventListener('click', runTests);
