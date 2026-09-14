const samples = { en: 'Every word has a story to tell.', ja: '今日は新しい物語が始まります。', ko: '오늘은 새로운 이야기가 시작됩니다.' };
const status = document.querySelector('#status');
const local = new NetflixTranslate.LocalProvider(state => { status.textContent = state.state === 'downloading' ? '语言包下载 ' + state.progress + '%' : state.state === 'ready' ? '模型就绪' : NetflixTranslate.ERRORS[state.code]; });
/** 查询浏览器实际支持状态，不主动下载。 */
async function inspect() { const language = document.querySelector('#language').value; document.querySelector('#input').textContent = samples[language]; status.textContent = 'Translator API：' + (typeof Translator !== 'undefined' ? '存在' : '不存在') + '；语言对状态：' + await local.availability(language); }
/** 在真实点击事件内初始化并执行一条本地翻译。 */
function translateSample() {
  const language = document.querySelector('#language').value; const button = document.querySelector('#prepare'); button.disabled = true;
  local.initialize(language).then(() => local.translate(samples[language], language)).then(result => { document.querySelector('#result').textContent = result.text; status.textContent = '真实本地翻译成功'; }).catch(error => { status.textContent = error.message; }).finally(() => { button.disabled = false; });
}
document.querySelector('#language').addEventListener('change', inspect);
document.querySelector('#prepare').addEventListener('click', translateSample);
inspect();
