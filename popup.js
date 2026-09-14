const N = globalThis.NetflixTranslate;
let settings = { ...N.DEFAULTS };
let saveTail = Promise.resolve();

/** 在弹窗内显示保存或权限错误。 */
function showMessage(text) { document.querySelector('#message').textContent = text; document.querySelector('#message').hidden = !text; }
/** 串行保存当前控件值，避免快速拖动滑块时发生倒序覆盖。 */
function saveSettings(patch) {
  settings = N.normalizeSettings({ ...settings, ...patch });
  const snapshot = { ...settings };
  const saving = saveTail.then(() => chrome.storage.local.set({ settings: snapshot }));
  saveTail = saving.catch(error => showMessage('设置保存失败，请重试'));
  return saving;
}
/** 更新滑块旁的实际数值。 */
function updateOutput(key) { document.querySelector('#' + key + '-value').textContent = settings[key] + (key === 'fontSize' ? ' px' : '%'); }
/** 展示匿名额度的本地估计与服务端限流状态。 */
async function updateQuota() {
  const usage = await N.request({ type: 'ONLINE_STATUS' });
  document.querySelector('#quota').textContent = usage.blocked ? N.ERRORS[usage.blocked] : '今日已请求约 ' + usage.used.toLocaleString() + ' / 5,000 字符';
  document.querySelector('#retry').hidden = usage.blocked !== 'RATE_LIMIT';
}
/** 初始化弹窗及语言列表，探测当前标签页是否已有字幕助手。 */
async function initializePopup() {
  const source = document.querySelector('#sourceLanguage');
  for (const [code, label] of Object.entries(N.LANGUAGES)) { const option = document.createElement('option'); option.value = code; option.textContent = label; source.append(option); }
  settings = N.normalizeSettings((await chrome.storage.local.get('settings')).settings);
  for (const key of ['enabled', 'onlineFallback']) document.querySelector('#' + key).checked = settings[key];
  source.value = settings.sourceLanguage;
  for (const key of ['fontSize', 'backgroundOpacity', 'bottomOffset']) { document.querySelector('#' + key).value = settings[key]; updateOutput(key); }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const state = await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATE' });
    document.querySelector('#page-status').textContent = !settings.enabled ? '双语字幕已关闭' : state.status;
    document.querySelector('#page-hint').textContent = state.title || '在 Netflix 中开启需要翻译的原文字幕。';
  } catch (_) { document.querySelector('#page-status').textContent = '打开 Netflix 播放页开始使用'; document.querySelector('#page-hint').textContent = '首次安装后，请刷新已打开的 Netflix 页面。'; }
  await updateQuota();
}
document.querySelector('#enabled').addEventListener('change', function toggleEnabled(event) { saveSettings({ enabled: event.target.checked }).catch(() => {}); document.querySelector('#page-status').textContent = event.target.checked ? '双语字幕已开启' : '双语字幕已关闭'; });
document.querySelector('#sourceLanguage').addEventListener('change', function chooseLanguage(event) { saveSettings({ sourceLanguage: event.target.value }).catch(() => {}); });
for (const key of ['fontSize', 'backgroundOpacity', 'bottomOffset']) {
  document.querySelector('#' + key).addEventListener('input', function changeAppearance(event) { saveSettings({ [key]: Number(event.target.value) }).catch(() => {}); updateOutput(key); });
}
document.querySelector('#onlineFallback').addEventListener('change', async function toggleOnline(event) {
  const control = event.target; control.disabled = true;
  try {
    if (control.checked) {
      // 直接在用户点击处理器中申请可选域名权限。
      const granted = await chrome.permissions.request({ origins: ['https://api.mymemory.translated.net/*'] });
      if (!granted) { control.checked = false; showMessage('未授予访问权限，继续使用本地翻译。'); return; }
      await saveSettings({ onlineFallback: true }); showMessage('已开启在线备用；本地翻译可用时仍优先使用本地。');
    } else {
      await saveSettings({ onlineFallback: false });
      await chrome.permissions.remove({ origins: ['https://api.mymemory.translated.net/*'] }); showMessage('已关闭在线备用。');
    }
  } catch (_) { control.checked = settings.onlineFallback; showMessage('无法更新在线备用，请重试。'); }
  finally { control.disabled = false; }
});
document.querySelector('#retry').addEventListener('click', async function retryOnline() { try { await N.request({ type: 'ONLINE_RETRY' }); await updateQuota(); showMessage('已解除临时限流暂停，下一句将重新尝试。'); } catch (error) { showMessage(error.message); } });
document.querySelector('#open-book').addEventListener('click', function openBook() { N.request({ type: 'OPEN_VOCAB' }).catch(error => showMessage(error.message)); });
initializePopup().catch(error => showMessage(error.message));
