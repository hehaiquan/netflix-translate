const N = globalThis.NetflixTranslate;
let words = [];
let hasLoaded = false;
let activeCollection = 'all';
let pendingDelete = null;
let deleting = false;
let toastTimer = null;
const speech = new N.SpeechPlayer(updateSpeech);

/** 安全生成只包含文本的界面元素。 */
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 引用页面内的装饰图标，不加载外部资源。 */
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  svg.setAttribute('class', 'book-icon');
  svg.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', '#icon-' + name);
  svg.append(use);
  return svg;
}

/** 展示可重试的加载错误，保留已经读取的收藏。 */
function showMessage(text) {
  document.querySelector('#message').textContent = text;
  document.querySelector('#load-message').hidden = !text;
  if (text) {
    document.querySelector('#loading').hidden = true;
    document.querySelector('#word-list').setAttribute('aria-busy', 'false');
    if (!hasLoaded) document.querySelector('#result-count').textContent = '读取失败';
  }
}

/** 用简短的状态通知反馈已经完成的导出或删除操作。 */
function notify(text) {
  clearTimeout(toastTimer);
  document.querySelector('#toast-text').textContent = text;
  document.querySelector('#toast').hidden = false;
  toastTimer = setTimeout(() => { document.querySelector('#toast').hidden = true; }, 4000);
}

/** 返回筛选分类的中文名称。 */
function collectionName(value) {
  return value === 'all' ? '全部收藏' : value === 'today' ? '今日收藏' : (N.LANGUAGES[value] || value);
}

/** 更新侧栏与窄屏筛选的真实数量；当前语种被删空时仍保留其入口。 */
function renderNavigation() {
  const focusedCollection = document.activeElement?.dataset.collection;
  const counts = new Map();
  for (const word of words) counts.set(word.sourceLanguage, (counts.get(word.sourceLanguage) || 0) + 1);
  document.querySelector('#total').textContent = words.length;
  document.querySelector('#today').textContent = words.filter(word => N.isSavedToday(word)).length;
  document.querySelector('#languages').textContent = counts.size;
  if (!['all', 'today'].includes(activeCollection) && !counts.has(activeCollection)) counts.set(activeCollection, 0);
  const languages = [...counts.keys()].sort((left, right) => counts.get(right) - counts.get(left) || collectionName(left).localeCompare(collectionName(right), 'zh-CN'));
  const buttons = languages.map(language => {
    const button = element('button', 'filter-button');
    button.type = 'button';
    button.dataset.collection = language;
    button.setAttribute('aria-pressed', 'false');
    const glyph = element('span', 'language-glyph', language.split('-')[0].toUpperCase());
    glyph.setAttribute('aria-hidden', 'true');
    button.append(glyph, element('span', 'filter-name', collectionName(language)), element('span', 'filter-count', counts.get(language)));
    return button;
  });
  document.querySelector('#language-filters').replaceChildren(...buttons);
  const mobile = document.querySelector('#collection-filter');
  mobile.replaceChildren(...['all', 'today', ...languages].map(value => {
    const option = element('option', '', collectionName(value));
    option.value = value;
    option.dataset.count = value === 'all' ? words.length : value === 'today' ? words.filter(word => N.isSavedToday(word)).length : counts.get(value);
    return option;
  }));
  if (focusedCollection) {
    [...document.querySelectorAll('[data-collection]')].find(button => button.dataset.collection === focusedCollection)?.focus();
  }
}

/** 切换收藏分类后展示结果起点，保留现有搜索条件。 */
function selectCollection(value) {
  activeCollection = value;
  render();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

/** 同步词条按钮、当前朗读浮条及原位错误提示。 */
function updateSpeech(state) {
  let activeButton = null;
  const playing = ['loading', 'speaking'].includes(state.status);
  for (const button of document.querySelectorAll('button[data-speech-key]')) {
    const active = button.dataset.speechKey === state.key && playing;
    if (active) activeButton = button;
    button.classList.toggle('is-speaking', active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-busy', String(active && state.status === 'loading'));
    button.setAttribute('aria-label', (active ? '停止' : '') + button.dataset.speechDescription);
    button.title = active ? '停止朗读（Esc）' : button.dataset.speechDescription;
    button.querySelector('use').setAttribute('href', active ? '#icon-stop' : '#icon-volume');
    button.querySelector('.speech-label').textContent = active ? (state.status === 'loading' ? '准备中' : '停止朗读') : button.dataset.speechLabel;
  }
  for (const card of document.querySelectorAll('.word-card')) {
    const belongs = ['term', 'context'].some(kind => state.key === card.dataset.wordId + ':' + kind);
    card.classList.toggle('is-reading', belongs && playing);
    const feedback = card.querySelector('.speech-feedback');
    feedback.textContent = belongs && state.status === 'error' ? state.message : '';
    feedback.hidden = !feedback.textContent;
  }
  const player = document.querySelector('#speech-player');
  const previousKey = player.dataset.speechKey;
  const restoreFocus = !playing && player.contains(document.activeElement);
  player.hidden = !playing;
  player.dataset.state = state.status;
  player.dataset.speechKey = state.key;
  if (activeButton) {
    document.querySelector('#speech-player-title').textContent = activeButton.dataset.speechTerm;
    document.querySelector('#speech-player-status').textContent = state.status === 'loading' ? '正在准备本地语音' : (state.key.endsWith(':term') ? '正在朗读单词' : '正在朗读对白');
  }
  if (restoreFocus) {
    const previousButton = [...document.querySelectorAll('button[data-speech-key]')].find(button => button.dataset.speechKey === previousKey);
    (previousButton || document.querySelector('#search')).focus();
  }
}

/** 为单词或原文对白创建可重复点击以停止的发音按钮。 */
function speechButton(word, kind) {
  const isTerm = kind === 'term';
  const button = element('button', 'speech-button ' + (isTerm ? 'word-speech' : 'context-speech'));
  button.type = 'button';
  button.dataset.speechKey = word.id + ':' + kind;
  button.dataset.speechLabel = isTerm ? '发音' : '朗读对白';
  button.dataset.speechDescription = (isTerm ? '朗读单词：' : '朗读对白：') + word.term;
  button.dataset.speechTerm = word.term;
  button.setAttribute('aria-label', button.dataset.speechDescription);
  button.setAttribute('aria-pressed', 'false');
  button.title = button.dataset.speechDescription;
  button.append(icon('volume'), element('span', 'speech-label', button.dataset.speechLabel));
  /** 将当前词条的原文与语言交给本地朗读控制器。 */
  button.addEventListener('click', function toggleSpeech() {
    speech.toggle(button.dataset.speechKey, isTerm ? word.term : word.context, word.sourceLanguage);
  });
  return button;
}

/** 渲染词条卡片，突出原句中的收藏表达并保留受限的影片定位链接。 */
function wordCard(word, index) {
  const card = element('article', 'word-card');
  card.dataset.wordId = word.id;
  const meta = element('div', 'card-meta');
  const createdAt = new Date(word.createdAt);
  const validDate = !Number.isNaN(createdAt.getTime());
  const dateText = N.isSavedToday(word) ? '今天' : validDate ? createdAt.toLocaleDateString('zh-CN', { ...(createdAt.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}), month: 'short', day: 'numeric' }) : '日期未知';
  const date = element('time', 'date', dateText);
  if (validDate) {
    date.dateTime = createdAt.toISOString();
    date.title = '收藏于 ' + createdAt.toLocaleString('zh-CN');
  }
  meta.append(element('span', 'language-tag', N.LANGUAGES[word.sourceLanguage] || word.sourceLanguage), date);
  const head = element('div', 'card-head');
  const title = element('h2', '', word.term);
  title.id = 'word-title-' + index;
  title.dir = 'auto';
  title.lang = word.sourceLanguage;
  card.setAttribute('aria-labelledby', title.id);
  head.append(title, speechButton(word, 'term'));
  const meaning = element('p', 'word-translation', word.translation);
  meaning.dir = 'auto';
  meaning.lang = 'zh-CN';
  card.append(meta, head, meaning);

  if (word.context || word.contextTranslation) {
    const context = element('blockquote', 'word-context');
    const heading = element('div', 'context-heading');
    heading.append(element('span', 'context-label', '对白'));
    if (word.context?.trim()) heading.append(speechButton(word, 'context'));
    context.append(heading);
    if (word.context) {
      const original = element('p', 'context-original');
      original.dir = 'auto';
      original.lang = word.sourceLanguage;
      for (const part of N.vocabularyContextParts(word.context, word.term)) {
        original.append(part.highlighted ? element('mark', '', part.text) : document.createTextNode(part.text));
      }
      context.append(original);
    }
    if (word.contextTranslation) {
      const translated = element('p', 'context-translation', word.contextTranslation);
      translated.dir = 'auto';
      translated.lang = 'zh-CN';
      context.append(translated);
    }
    card.append(context);
  }

  const feedback = element('p', 'speech-feedback');
  feedback.setAttribute('role', 'status');
  feedback.hidden = true;
  const footer = element('div', 'card-footer');
  const hasVideo = /^\d+$/.test(word.videoId);
  const link = element(hasVideo ? 'a' : 'span', 'source-link');
  const sourceIcon = element('span', 'source-icon');
  sourceIcon.append(icon('play'));
  const details = element('span', 'source-details');
  const sourceTitle = element('span', 'source-title', word.title || 'Netflix');
  sourceTitle.title = word.title || 'Netflix';
  const position = element('span', 'source-position', N.timestamp(word.position) + (hasVideo ? ' · 回看影片' : ' · 影片位置'));
  if (hasVideo) position.append(icon('arrow'));
  details.append(sourceTitle, position);
  link.append(sourceIcon, details);
  if (hasVideo) {
    link.href = 'https://www.netflix.com/watch/' + word.videoId + '?t=' + Math.floor(word.position);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  const remove = element('button', 'delete icon-button');
  remove.type = 'button';
  remove.title = '删除收藏';
  remove.setAttribute('aria-label', '删除收藏 ' + word.term);
  remove.append(icon('trash'));
  /** 先展示待删除词条，让用户明确本次删除的对象。 */
  remove.addEventListener('click', function requestDelete() { openDelete(word, index); });
  footer.append(link, remove);
  card.append(feedback, footer);
  return card;
}

/** 组合分类、搜索和排序，更新收藏内容与空状态。 */
function render() {
  if (!hasLoaded) return;
  speech.stop();
  const search = document.querySelector('#search');
  const query = search.value.trim();
  const visible = N.filterVocabulary(words, { query, collection: activeCollection, sort: document.querySelector('#sort').value });
  for (const button of document.querySelectorAll('[data-collection]')) {
    const selected = button.dataset.collection === activeCollection;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  const mobileFilter = document.querySelector('#collection-filter');
  mobileFilter.value = activeCollection;
  for (const option of mobileFilter.options) {
    option.textContent = collectionName(option.value) + ' · ' + (option.value === activeCollection ? visible.length : option.dataset.count);
  }
  document.querySelector('#collection-title').textContent = collectionName(activeCollection);
  document.querySelector('#result-count').textContent = query ? visible.length + ' 条匹配' : visible.length + ' 个词条';
  const list = document.querySelector('#word-list');
  list.replaceChildren(...visible.map(wordCard));
  list.setAttribute('aria-busy', 'false');
  document.querySelector('#loading').hidden = true;
  document.querySelector('#clear-search').hidden = !search.value;
  document.querySelector('#search-shortcut').hidden = !!search.value;
  const filtered = !!query || activeCollection !== 'all';
  document.querySelector('#empty').hidden = visible.length > 0;
  document.querySelector('#empty-icon').setAttribute('href', query ? '#icon-search' : '#icon-book');
  document.querySelector('#empty-title').textContent = query ? '没有找到这个表达' : activeCollection === 'today' ? '今天的好表达，等你发现' : filtered ? '这里还没有收藏' : '好表达，值得留下来';
  document.querySelector('#empty-hint').textContent = query ? '换个词语、中文译文或影片名称试试，也可以回到全部收藏。' : filtered ? '去喜欢的故事里发现新词，或先重温已有的收藏。' : '在 Netflix 点击字幕里的词语并收藏。下一次见面，就在这里。';
  document.querySelector('#discover-words').hidden = !!query;
  document.querySelector('#reset-search').hidden = !filtered;
  for (const id of ['export-toggle', 'export-csv', 'export-json']) document.querySelector('#' + id).disabled = !words.length;
  if (!words.length) setExportMenu(false);
}

/** 清空搜索文字，保留当前分类并把焦点交还搜索框。 */
function clearSearch() {
  const search = document.querySelector('#search');
  search.value = '';
  render();
  search.focus();
}

/** 从空结果恢复到全部收藏，同时清除所有筛选条件。 */
function resetFilters() {
  activeCollection = 'all';
  clearSearch();
}

/** 读取收藏后刷新筛选入口，保留页面正在使用的搜索和排序。 */
async function loadWords() {
  document.querySelector('#retry-load').disabled = true;
  try {
    words = await N.request({ type: 'VOCAB_LIST' });
    hasLoaded = true;
    renderNavigation();
    render();
    showMessage('');
  } finally { document.querySelector('#retry-load').disabled = false; }
}

/** 控制导出选项的展开状态，键盘关闭时恢复触发按钮焦点。 */
function setExportMenu(open, restoreFocus = false) {
  document.querySelector('#export-menu').hidden = !open;
  document.querySelector('#export-toggle').setAttribute('aria-expanded', String(open));
  if (restoreFocus) document.querySelector('#export-toggle').focus();
}

/** 导出完整收藏集合；当前搜索、分类和排序不会删减导出内容。 */
function download(format) {
  try {
    const content = format === 'csv' ? N.exportCsv(words) : JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), words }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Netflix生词本-' + new Date().toISOString().slice(0, 10) + '.' + format;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportMenu(false, true);
    notify(format.toUpperCase() + ' 已生成，包含 ' + words.length + ' 个词条');
  } catch (error) { showMessage(error.message); }
}

/** 展示删除确认，将原文作为纯文本呈现并默认聚焦保留操作。 */
function openDelete(word, index) {
  speech.stop();
  setExportMenu(false);
  pendingDelete = { word, index };
  document.querySelector('#delete-term').textContent = word.term;
  document.querySelector('#delete-error').hidden = true;
  document.querySelector('#delete-dialog').showModal();
}

/** 删除成功后恢复到相邻词条；失败时保留弹窗并允许重试。 */
async function confirmDelete(event) {
  event.preventDefault();
  if (!pendingDelete || deleting) return;
  const { word, index } = pendingDelete;
  deleting = true;
  const confirm = document.querySelector('#confirm-delete');
  const cancel = document.querySelector('#cancel-delete');
  confirm.disabled = true;
  cancel.disabled = true;
  confirm.textContent = '正在删除…';
  try {
    await N.request({ type: 'VOCAB_DELETE', id: word.id });
    await loadWords();
    document.querySelector('#delete-dialog').close();
    const cards = [...document.querySelectorAll('.word-card')];
    const next = cards[Math.min(index, cards.length - 1)];
    (next?.querySelector('.word-speech') || document.querySelector('#search')).focus();
    notify('已删除「' + word.term + '」');
  } catch (error) {
    const feedback = document.querySelector('#delete-error');
    feedback.textContent = error.message;
    feedback.hidden = false;
  } finally {
    deleting = false;
    confirm.disabled = false;
    cancel.disabled = false;
    confirm.textContent = '删除';
  }
}

/** 在分类导航中响应静态收藏项与动态语种项。 */
document.querySelector('.library-sidebar').addEventListener('click', function filterCollection(event) {
  const button = event.target.closest('[data-collection]');
  if (button) selectCollection(button.dataset.collection);
});
/** 让窄屏原生下拉框与桌面侧栏使用同一个筛选状态。 */
document.querySelector('#collection-filter').addEventListener('change', function filterMobile(event) { selectCollection(event.target.value); });
document.querySelector('#search').addEventListener('input', render);
document.querySelector('#sort').addEventListener('change', render);
document.querySelector('#clear-search').addEventListener('click', clearSearch);
document.querySelector('#reset-search').addEventListener('click', resetFilters);
/** 展开或收起导出格式选择。 */
document.querySelector('#export-toggle').addEventListener('click', function toggleExport() { setExportMenu(document.querySelector('#export-menu').hidden); });
/** 导出可用表格软件阅读的收藏文件。 */
document.querySelector('#export-csv').addEventListener('click', function exportCsv() { download('csv'); });
/** 导出包含完整词条信息的 JSON 文件。 */
document.querySelector('#export-json').addEventListener('click', function exportJson() { download('json'); });
/** 点击菜单外部时收起导出选项，不抢走用户当前焦点。 */
document.addEventListener('click', function dismissExport(event) { if (!event.target.closest('.export-control')) setExportMenu(false); });
/** 键盘焦点移到其他控件时收起选项，忽略隐藏菜单过程中没有目标的焦点事件。 */
document.querySelector('.export-control').addEventListener('focusout', function blurExport(event) { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setExportMenu(false); });
/** 在读写错误后重新读取收藏。 */
document.querySelector('#retry-load').addEventListener('click', function retryLoad() { loadWords().catch(error => showMessage(error.message)); });
document.querySelector('#delete-form').addEventListener('submit', confirmDelete);
/** 取消删除，交由原生对话框恢复触发位置的焦点。 */
document.querySelector('#cancel-delete').addEventListener('click', function cancelDelete() { document.querySelector('#delete-dialog').close(); });
/** 提交中的删除等待结果，避免重复触发或关闭后失去错误提示。 */
document.querySelector('#delete-dialog').addEventListener('cancel', function guardDelete(event) { if (deleting) event.preventDefault(); });
/** 对话框关闭后释放临时删除目标。 */
document.querySelector('#delete-dialog').addEventListener('close', function clearDelete() { pendingDelete = null; });
/** 从浮动播放器停止当前朗读，焦点由状态更新返回词条。 */
document.querySelector('#stop-speech').addEventListener('click', function stopPlayer() { speech.stop(); });
/** 响应其他扩展页面写入的收藏变化。 */
chrome.storage.onChanged.addListener(function storageChanged(changes, area) { if (area === 'local' && changes.words) loadWords().catch(error => showMessage(error.message)); });
/** 离开生词本时停止声音，避免遗留后台朗读。 */
window.addEventListener('pagehide', function stopPageSpeech() { speech.stop(); });
/** 提供搜索快捷键，并让 Esc 关闭临时控件或停止朗读。 */
document.addEventListener('keydown', function handleKeyboard(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !document.querySelector('#delete-dialog').open) {
    event.preventDefault();
    setExportMenu(false);
    document.querySelector('#search').focus();
  }
  if (event.key === 'Escape') {
    if (!document.querySelector('#export-menu').hidden) { event.preventDefault(); setExportMenu(false, true); }
    speech.stop();
  }
});
if (!/Mac|iPhone|iPad/.test(navigator.platform)) document.querySelector('#search-shortcut').textContent = 'Ctrl K';
loadWords().catch(error => showMessage(error.message));
