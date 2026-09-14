importScripts('lib/core.js', 'lib/mymemory.js');
const N = globalThis.NetflixTranslate;
const online = new N.MyMemoryProvider(chrome);
let writeTail = Promise.resolve();

/** 串行修改本地生词，防止多标签页同时收藏造成覆盖。 */
function mutateWords(change) {
  const next = writeTail.then(async () => {
    const { words = [] } = await chrome.storage.local.get('words');
    const result = change(words);
    await chrome.storage.local.set({ words });
    return result;
  });
  writeTail = next.catch(() => {}); return next;
}

/** 仅接受本扩展页面及 Netflix 内容脚本发送的已知命令。 */
async function handleMessage(message, sender) {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') throw N.failure('INVALID_REQUEST');
  const extensionPage = sender.url?.startsWith(chrome.runtime.getURL(''));
  const netflixPage = /^https:\/\/www\.netflix\.com\//.test(sender.url || sender.tab?.url || '');
  if (!extensionPage && !netflixPage) throw N.failure('INVALID_REQUEST');
  switch (message.type) {
    case 'TRANSLATE_ONLINE': return online.translate(message.text, message.sourceLanguage);
    case 'ONLINE_STATUS': return online.status();
    case 'ONLINE_RETRY': if (!extensionPage) throw N.failure('INVALID_REQUEST'); return online.retry();
    case 'VOCAB_LIST': return (await chrome.storage.local.get('words')).words || [];
    case 'VOCAB_SAVE': {
      const word = N.normalizeWord(message.word || {});
      return mutateWords(words => { const existing = words.find(item => item.id === word.id); if (existing) return { word: existing, existed: true }; words.unshift(word); return { word, existed: false }; });
    }
    case 'VOCAB_DELETE':
      if (!extensionPage) throw N.failure('INVALID_REQUEST');
      return mutateWords(words => { const index = words.findIndex(item => item.id === message.id); if (index >= 0) words.splice(index, 1); return true; });
    case 'OPEN_VOCAB': return chrome.tabs.create({ url: chrome.runtime.getURL('vocabulary.html') }).then(() => true);
    default: throw N.failure('INVALID_REQUEST');
  }
}

/** 将异步处理结果转换为可跨扩展上下文传递的响应。 */
function receiveMessage(message, sender, respond) {
  handleMessage(message, sender).then(value => respond({ ok: true, value })).catch(error => respond({ ok: false, code: error.code || 'STORAGE', message: N.ERRORS[error.code] || N.ERRORS.STORAGE }));
  return true;
}
chrome.runtime.onMessage.addListener(receiveMessage);

/** 初次安装时设置默认值，升级时保留已有收藏与设置。 */
async function initializeStorage() {
  const existing = await chrome.storage.local.get(['settings', 'words']);
  await chrome.storage.local.set({ settings: N.normalizeSettings(existing.settings), words: Array.isArray(existing.words) ? existing.words : [] });
}
chrome.runtime.onInstalled.addListener(initializeStorage);

/** 撤回在线域名权限后立即停止请求并关闭在线备用开关。 */
async function permissionsRemoved(permissions) {
  if (!permissions.origins?.some(origin => origin.includes('mymemory.translated.net'))) return;
  online.cancel();
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...N.normalizeSettings(settings), onlineFallback: false } });
}
chrome.permissions.onRemoved.addListener(permissionsRemoved);
chrome.storage.onChanged.addListener(function settingsChanged(changes, area) {
  if (area === 'local' && changes.settings && !changes.settings.newValue?.onlineFallback) online.cancel();
});
