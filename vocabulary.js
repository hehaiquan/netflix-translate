const N = globalThis.NetflixTranslate;
let words = [];

/** 安全生成只包含文本的界面元素。 */
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
/** 展示操作错误，不清空已经加载的收藏。 */
function showMessage(text) { const node = document.querySelector('#message'); node.textContent = text; node.hidden = !text; }
/** 渲染单条收藏及受限的 Netflix 原影片链接。 */
function wordCard(word) {
  const card = element('article', 'word-card'); const head = element('div', 'card-head');
  const title = element('h2', '', word.term); title.dir = 'auto'; head.append(title, element('span', 'language-tag', N.LANGUAGES[word.sourceLanguage] || word.sourceLanguage));
  const meaning = element('p', 'word-translation', word.translation);
  const context = element('div', 'word-context'); const original = element('p', '', word.context); original.dir = 'auto'; context.append(original);
  if (word.contextTranslation) context.append(element('p', '', word.contextTranslation));
  const footer = element('div', 'card-footer'); const source = element('div');
  const link = element(/^\d+$/.test(word.videoId) ? 'a' : 'span', 'source-link', (word.title || 'Netflix') + ' · ' + N.timestamp(word.position));
  if (link.tagName === 'A') { link.href = 'https://www.netflix.com/watch/' + word.videoId + '?t=' + Math.floor(word.position); link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  source.append(link, element('p', 'date', new Date(word.createdAt).toLocaleString('zh-CN')));
  const remove = element('button', 'delete', '删除'); remove.setAttribute('aria-label', '删除收藏 ' + word.term);
  remove.addEventListener('click', async function deleteWord() { remove.disabled = true; try { await N.request({ type: 'VOCAB_DELETE', id: word.id }); await loadWords(); } catch (error) { remove.disabled = false; showMessage(error.message); } });
  footer.append(source, remove); card.append(head, meaning, context, footer); return card;
}
/** 按搜索条件刷新收藏卡片和统计数字。 */
function render() {
  const query = document.querySelector('#search').value.trim().toLocaleLowerCase();
  const visible = words.filter(word => [word.term, word.translation, word.context, word.title, N.LANGUAGES[word.sourceLanguage]].join(' ').toLocaleLowerCase().includes(query));
  document.querySelector('#total').textContent = words.length;
  document.querySelector('#languages').textContent = new Set(words.map(word => word.sourceLanguage)).size;
  document.querySelector('#today').textContent = words.filter(word => new Date(word.createdAt).toDateString() === new Date().toDateString()).length;
  document.querySelector('#result-count').textContent = query ? '找到 ' + visible.length + ' 条匹配的收藏' : '全部收藏 · ' + words.length + ' 条';
  document.querySelector('#word-list').replaceChildren(...visible.map(wordCard));
  document.querySelector('#empty').hidden = visible.length > 0;
  document.querySelector('#empty-title').textContent = query ? '暂时没有匹配的词语' : '从喜欢的一句对白开始';
  document.querySelector('#empty-hint').textContent = query ? '试试其他词语、中文译文，或影片名称。' : '打开 Netflix，点击原字幕里的词语，再点「收藏」。词语、译文和影片位置都会保存在这里。';
  for (const id of ['export-csv', 'export-json']) document.querySelector('#' + id).disabled = !words.length;
}
/** 读取最新收藏，支持多个页面同时保存或删除。 */
async function loadWords() { words = await N.request({ type: 'VOCAB_LIST' }); render(); }
/** 通过本地 Blob 导出全部收藏，并在下载后释放临时 URL。 */
function download(format) {
  const content = format === 'csv' ? N.exportCsv(words) : JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), words }, null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'Netflix生词本-' + new Date().toISOString().slice(0, 10) + '.' + format;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.querySelector('#search').addEventListener('input', render);
document.querySelector('#export-csv').addEventListener('click', function exportCsv() { download('csv'); });
document.querySelector('#export-json').addEventListener('click', function exportJson() { download('json'); });
chrome.storage.onChanged.addListener(function storageChanged(changes, area) { if (area === 'local' && changes.words) loadWords().catch(error => showMessage(error.message)); });
loadWords().catch(error => showMessage(error.message));
