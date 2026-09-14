(function initController(scope) {
  'use strict';
  const N = scope.NetflixTranslate;
  if (N.controller) return;
  class SubtitleController {
    /** 连接字幕适配、翻译、查词与设置生命周期。 */
    constructor() {
      this.settings = N.DEFAULTS; this.revision = 0; this.hiddenRoots = new Map(); this.latest = null;
      this.resolver = new N.LanguageResolver(); this.language = ''; this.lookup = null; this.selecting = false; this.pauseOwner = null;
      this.service = new N.TranslationService(state => this.modelStatus(state));
      this.adapter = new N.NetflixAdapter(snapshot => { this.handleSnapshot(snapshot).catch(error => this.fail(error)); }, error => this.fail(error));
      this.settingsListener = (changes, area) => { if (area === 'local' && changes.settings) this.applySettings(changes.settings.newValue); };
      this.pageExit = () => this.destroy();
      this.onEscape = event => { if (event.key === 'Escape' && this.lookup) { event.stopPropagation(); this.closeLookup(); } };
      this.stateListener = (message, sender, respond) => { if (message?.type === 'GET_STATE' && sender.id === chrome.runtime.id) respond({ status: this.overlay?.lastStatus || '打开 Netflix 播放页开始使用', title: this.latest?.title || '', language: this.language }); };
    }
    /** 读取设置后开始监听，仅在 Netflix 播放页显示界面。 */
    async start() {
      const { settings } = await chrome.storage.local.get('settings');
      this.settings = N.normalizeSettings(settings); this.service.configure(this.settings);
      chrome.storage.onChanged.addListener(this.settingsListener);
      chrome.runtime.onMessage.addListener(this.stateListener);
      window.addEventListener('pagehide', this.pageExit);
      document.addEventListener('keydown', this.onEscape, true);
      this.adapter.start();
      this.health = setInterval(() => { if (!chrome.runtime?.id) this.destroy(true); }, 3000);
    }
    /** 设置变化使等待结果失效，并即时更新当前播放页。 */
    applySettings(value) {
      const oldLanguage = this.settings.sourceLanguage;
      this.settings = N.normalizeSettings(value); this.service.configure(this.settings); this.resolver.reset(); this.language = '';
      this.resumeOwnedPause(true);
      this.closeLookup(false); this.revision++;
      if (oldLanguage !== this.settings.sourceLanguage) this.service.local.dispose();
      if (!this.settings.enabled) { this.removeOverlay(); this.service.dispose(); }
      else if (this.latest) this.handleSnapshot(this.latest, true).catch(error => this.fail(error));
    }
    /** 创建轻量播放器界面，所有动作回到当前控制器。 */
    ensureOverlay(player) {
      if (!this.overlay) this.overlay = new N.SubtitleOverlay({
        prepare: () => this.prepare(), book: () => N.request({ type: 'OPEN_VOCAB' }).catch(error => this.showError(error)),
        selectStart: () => this.beginSelection(), selectCancel: () => this.cancelSelection(),
        lookup: term => this.openLookup(term), close: () => this.closeLookup(), save: () => this.saveWord()
      });
      this.overlay.mount(player); this.overlay.configure(this.settings);
    }
    /** 处理字幕会话，所有异步步骤完成后都重新核对当前代次。 */
    async handleSnapshot(snapshot, force = false) {
      const previous = this.latest; this.latest = snapshot;
      const sessionChanged = previous?.session !== snapshot.session || previous?.video !== snapshot.video;
      if (sessionChanged) { this.resolver.reset(); this.closeLookup(false); this.language = ''; this.service.invalidate(); }
      if (snapshot.conflict && !previous?.conflict) { this.resumeOwnedPause(true); this.closeLookup(false); }
      if ((this.lookup || this.selecting) && !sessionChanged && !force) return;
      const revision = ++this.revision;
      this.restoreNative();
      if (!this.settings.enabled || !snapshot.player || !snapshot.video) { this.removeOverlay(); this.service.dispose(); return; }
      this.ensureOverlay(snapshot.player);
      if (snapshot.conflict) { this.overlay.original(''); this.overlay.status('检测到其他字幕扩展，请单独启用双语助手'); return; }
      this.displayed = snapshot; this.displayedLanguage = this.settings.sourceLanguage === 'auto' ? '' : this.settings.sourceLanguage; this.currentTranslation = '';
      this.overlay.original(snapshot.text, this.settings.sourceLanguage === 'auto' ? this.language || 'en' : this.settings.sourceLanguage);
      if (!snapshot.text) { this.overlay.status(snapshot.imageOnly ? '当前为图片字幕，首版仅支持文字字幕' : '等待原文字幕 · 请在 Netflix 开启原文字幕'); return; }
      this.hideNative(snapshot.roots);
      this.overlay.status('正在识别字幕语言…');
      const language = await this.resolver.resolve(snapshot.text, this.settings.sourceLanguage, snapshot.hint);
      if (!this.current(revision)) return;
      this.language = language;
      this.displayedLanguage = language;
      if (!language) { this.overlay.status('语言样本不足，请继续播放或在插件中选择源语言'); return; }
      this.overlay.original(snapshot.text, language);
      if (language === 'zh') { this.overlay.status('当前已是简体中文 · 可切换 Netflix 原文字幕'); return; }
      this.overlay.translated('翻译中…', true);
      try {
        const result = await this.service.translate(snapshot.text, language);
        if (!this.current(revision)) return;
        this.currentTranslation = result.text;
        this.overlay.translated(result.text);
        this.overlay.status(N.LANGUAGES[language] + ' → 简体中文 · ' + (result.provider === 'mymemory' ? '在线备用' : '本地翻译'), !this.service.local.instance);
      } catch (error) {
        if (!this.current(revision) || error.code === 'CANCELLED') return;
        this.overlay.translated(''); this.currentTranslation = '';
        this.showError(error);
      }
    }
    /** 判断字幕结果是否仍属于当前可见会话。 */
    current(revision) { return this.revision === revision && this.settings.enabled && !!this.overlay && !this.lookup && !this.selecting; }
    /** 成功渲染原文后只隐藏原生字幕外观，保留其 DOM 可读性。 */
    hideNative(roots) {
      if (!this.overlay?.host.isConnected || !this.overlay.elements.original.textContent) return;
      for (const root of roots) {
        this.hiddenRoots.set(root, root.getAttribute('data-netflix-translate-hidden'));
        root.setAttribute('data-netflix-translate-hidden', 'true');
      }
    }
    /** 撤销接管标记，保留 Netflix 当前的原生字幕样式。 */
    restoreNative() {
      for (const [root, original] of this.hiddenRoots) {
        if (original === null) root.removeAttribute('data-netflix-translate-hidden'); else root.setAttribute('data-netflix-translate-hidden', original);
      }
      this.hiddenRoots.clear();
    }
    /** 从页面点击回调直接初始化模型，避免经后台转发丢失用户激活。 */
    prepare() {
      if (!this.language || this.language === 'zh') return;
      const session = this.latest?.session;
      this.service.local.initialize(this.language).then(() => {
        if (this.latest?.session === session && this.settings.enabled && !this.lookup) this.handleSnapshot(this.latest, true).catch(error => this.fail(error));
      }).catch(error => { if (error.code !== 'CANCELLED' && this.latest?.session === session) this.showError(error); });
    }
    /** 把模型下载进度显示在当前影片的状态栏。 */
    modelStatus(state) {
      if (!this.overlay || state.language !== this.language) return;
      if (state.state === 'downloading') this.overlay.status('语言包下载 ' + state.progress + '%', true, true);
    }
    /** 展示已知错误，同时保留用户可读的原文。 */
    showError(error) {
      const downloadable = ['NEEDS_ACTIVATION', 'DOWNLOADING', 'LOCAL_FAILED', 'TIMEOUT'].includes(error.code);
      this.overlay?.status(error.message || '翻译暂不可用', downloadable, error.code === 'DOWNLOADING');
    }
    /** 仅暂停正在播放的视频，并记录由插件持有的恢复资格。 */
    pauseForLookup() {
      const video = this.latest?.video;
      if (!video || this.pauseOwner) return;
      const owner = { video, session: this.latest.session, position: video.currentTime, pausedByUs: !video.paused, wasResumed: false };
      owner.onPlay = () => { owner.wasResumed = true; };
      video.addEventListener('play', owner.onPlay);
      this.pauseOwner = owner;
      if (owner.pausedByUs) video.pause();
    }
    /** 从鼠标按下起冻结字幕，避免拖选短句时原文被下一句替换。 */
    beginSelection() { if (this.lookup || !this.latest?.text) return; this.selecting = true; this.revision++; this.pauseForLookup(); }
    /** 用户未选中词语时解除冻结并恢复此前播放状态。 */
    cancelSelection() { if (!this.selecting || this.lookup) return; this.selecting = false; this.resumeOwnedPause(true); if (this.latest) this.handleSnapshot(this.latest, true).catch(error => this.fail(error)); }
    /** 翻译选中的词语或短句，收藏始终绑定打开时的上下文。 */
    async openLookup(term) {
      if (!this.displayed || !this.displayedLanguage) { this.cancelSelection(); return; }
      this.pauseForLookup(); this.selecting = false; this.revision++;
      const lookup = this.lookup = { ...this.displayed, term: N.cleanText(term).slice(0, 500), language: this.displayedLanguage, contextTranslation: this.currentTranslation || '', translation: '' };
      this.overlay.showLookup(lookup.term, lookup.text);
      try {
        const result = await this.service.translate(lookup.term, lookup.language, 'lookup');
        if (this.lookup !== lookup) return;
        lookup.translation = result.text; this.overlay.lookupResult(result.text, result.provider);
      } catch (error) { if (this.lookup === lookup) this.overlay.lookupResult(error.message, '', true); }
    }
    /** 在会话及播放位置未变化时恢复插件暂停的视频。 */
    resumeOwnedPause(allowResume) {
      const owner = this.pauseOwner; this.pauseOwner = null;
      if (!owner) return;
      owner.video.removeEventListener('play', owner.onPlay);
      if (allowResume && owner.pausedByUs && !owner.wasResumed && owner.video === this.latest?.video && owner.session === this.latest?.session && owner.video.paused && !owner.video.ended && Math.abs(owner.video.currentTime - owner.position) < 1) owner.video.play().catch(() => {});
    }
    /** 关闭查询时让旧查词结果失效，随后渲染最新字幕。 */
    closeLookup(resume = true) {
      const hadLookup = this.lookup || this.selecting;
      this.lookup = null; this.selecting = false; this.overlay?.closeLookup(); this.resumeOwnedPause(resume);
      if (hadLookup) { this.revision++; if (resume && this.latest) this.handleSnapshot(this.latest, true).catch(error => this.fail(error)); }
    }
    /** 保存当前查词快照，避免异步完成后收藏了另一句话。 */
    async saveWord() {
      const lookup = this.lookup;
      if (!lookup?.translation) return;
      this.overlay.saved('保存中…');
      try {
        const result = await N.request({ type: 'VOCAB_SAVE', word: { term: lookup.term, translation: lookup.translation, sourceLanguage: lookup.language, context: lookup.text, contextTranslation: lookup.contextTranslation, title: lookup.title, videoId: lookup.videoId, position: lookup.position } });
        if (this.lookup === lookup) this.overlay.saved(result.existed ? '已在生词本 ✓' : '已收藏 ✓');
      } catch (error) { if (this.lookup === lookup) { this.overlay.saved('重试收藏', false); this.overlay.elements.meta.textContent = error.message; } }
    }
    /** 删除显示层并恢复原生字幕。 */
    removeOverlay() { this.restoreNative(); this.overlay?.destroy(); this.overlay = null; }
    /** 异常时优先恢复原字幕，不影响 Netflix 继续播放。 */
    fail(error) { this.revision++; this.resumeOwnedPause(true); this.closeLookup(false); this.restoreNative(); this.overlay?.original(''); this.overlay?.status('字幕适配暂不可用，请刷新页面'); console.warn('Netflix 双语助手：', error.code || '字幕处理失败'); }
    /** 页面关闭或扩展更新时释放观察器、翻译器与所有监听。 */
    destroy(resume = false) {
      this.revision++; clearInterval(this.health); this.resumeOwnedPause(resume); this.closeLookup(false); this.adapter.stop(); this.service.dispose(); this.removeOverlay();
      chrome.storage.onChanged.removeListener(this.settingsListener); chrome.runtime.onMessage.removeListener(this.stateListener); window.removeEventListener('pagehide', this.pageExit); document.removeEventListener('keydown', this.onEscape, true);
      N.controller = null;
    }
  }
  N.SubtitleController = SubtitleController;
  N.controller = new SubtitleController();
  N.controller.start().catch(error => N.controller?.fail(error));
})(globalThis);
