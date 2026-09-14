(function initOverlay(scope) {
  'use strict';
  const N = scope.NetflixTranslate;
  const STYLES = `
    :host { all: initial; position: absolute; inset: 0; z-index: 2147483000; pointer-events: none; color: #fff; font: 14px/1.5 system-ui, -apple-system, "PingFang SC", sans-serif; --size: 26px; --bg: .65; --bottom: 10%; }
    * { box-sizing: border-box; } [hidden] { display: none !important; }
    button, select { font: inherit; } button { cursor: pointer; color: inherit; }
    button:focus-visible, .word:focus-visible { outline: 2px solid #ffb0b5; outline-offset: 3px; }
    .tools { position: absolute; right: 20px; top: 22px; display: flex; gap: 9px; align-items: center; padding: 8px 12px; max-width: min(90%, 610px); border: 1px solid #ffffff26; border-radius: 12px; background: #141418e8; pointer-events: auto; box-shadow: 0 8px 24px #0004; transition: opacity .2s; opacity: .55; }
    .tools:hover, .tools:focus-within, .tools.attention { opacity: 1; } .brand { color: #ff707b; font-weight: 800; white-space: nowrap; }
    .status { font-size: 12px; color: #dedee3; } .tools button { border: 0; padding: 5px 8px; background: #ffffff12; border-radius: 6px; font-size: 12px; white-space: nowrap; }
    .captions { position: absolute; bottom: var(--bottom); width: 90%; left: 5%; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .line { max-width: 100%; border-radius: 7px; background: rgb(0 0 0 / var(--bg)); padding: 4px 12px; text-shadow: 0 2px 4px #000; font-size: var(--size); line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
    .original { pointer-events: auto; user-select: text; cursor: text; } .word { border-radius: 3px; cursor: pointer; } .word:hover { color: #ffbbc0; background: #ffffff21; }
    .translated { color: #fff0bc; font-size: calc(var(--size) * .92); } .translated.pending { color: #ddd; font-size: 14px; }
    .lookup { pointer-events: auto; position: absolute; bottom: calc(var(--bottom) + 128px); left: 50%; transform: translateX(-50%); width: min(440px, 88%); max-height: 50%; overflow: auto; padding: 20px; border: 1px solid #ffffff2b; border-radius: 16px; color: #f7f7fb; background: #18181ef7; box-shadow: 0 16px 60px #0009; }
    .lookup-head { display: flex; align-items: flex-start; gap: 14px; } .term { font-size: 22px; font-weight: 650; overflow-wrap: anywhere; flex: 1; margin: 0; } .close { border: 0; border-radius: 8px; background: #ffffff13; font-size: 20px; width: 30px; height: 30px; }
    .meaning { font-size: 18px; color: #fff0bc; margin: 16px 0; white-space: pre-wrap; overflow-wrap: anywhere; } .context { font-size: 12px; color: #aaaab6; border-left: 2px solid #b34552; padding-left: 10px; margin: 12px 0 18px; overflow-wrap: anywhere; }
    .footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; } .meta { color: #9696a3; font-size: 11px; } .save { background: #e94758; border: none; padding: 9px 16px; border-radius: 8px; font-weight: 600; } button:disabled { opacity: .5; cursor: default; }
    @media(max-width: 640px) { .tools { top: 8px; right: 8px; padding: 6px 8px; } .brand { display: none; } .captions { width: 96%; left: 2%; } .line { font-size: min(var(--size), 22px); } .lookup { bottom: calc(var(--bottom) + 95px); } }
  `;
  class SubtitleOverlay {
    /** 使用 Shadow DOM 隔离样式与字幕交互。 */
    constructor(callbacks) {
      this.callbacks = callbacks; this.host = document.createElement('div'); this.host.id = 'netflix-translate-overlay';
      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.shadow.innerHTML = `<style>${STYLES}</style>
        <div class="tools"><span class="brand">译</span><span class="status" role="status" aria-live="polite">等待原文字幕</span><button class="prepare" hidden>准备本地翻译</button><button class="book" title="打开生词本">生词本 ↗</button></div>
        <div class="captions" hidden><div class="line original" dir="auto" aria-label="原字幕，点击词语或选中短句查词"></div><div class="line translated" dir="auto" hidden></div></div>
        <section class="lookup" role="dialog" aria-label="字幕查词" hidden><div class="lookup-head"><p class="term" dir="auto"></p><button class="close" aria-label="关闭查词">×</button></div><p class="meaning" dir="auto"></p><p class="context" dir="auto"></p><div class="footer"><span class="meta"></span><button class="save" disabled>＋ 收藏</button></div></section>`;
      this.elements = {};
      ['tools', 'status', 'prepare', 'book', 'captions', 'original', 'translated', 'lookup', 'term', 'close', 'meaning', 'context', 'meta', 'save'].forEach(name => { this.elements[name] = this.shadow.querySelector('.' + name); });
      this.elements.prepare.addEventListener('click', () => callbacks.prepare());
      this.elements.book.addEventListener('click', () => callbacks.book());
      this.elements.close.addEventListener('click', () => callbacks.close());
      this.elements.save.addEventListener('click', () => callbacks.save());
      this.elements.original.addEventListener('pointerdown', event => { if (event.button === 0) callbacks.selectStart(); });
      this.elements.original.addEventListener('pointerup', event => this.selectEnd(event));
      this.elements.original.addEventListener('click', event => { if (this.elements.lookup.hidden && event.target.closest('.word')) callbacks.lookup(event.target.closest('.word').textContent); });
      this.onPointerUp = event => { if (!event.composedPath().includes(this.elements.original)) callbacks.selectCancel(); };
      this.onPointerCancel = () => callbacks.selectCancel();
      document.addEventListener('pointerup', this.onPointerUp, true);
      document.addEventListener('pointercancel', this.onPointerCancel, true);
      this.shadow.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !this.elements.lookup.hidden) { event.preventDefault(); callbacks.close(); }
        if ((event.key === 'Enter' || event.key === ' ') && event.target.classList?.contains('word')) { event.preventDefault(); callbacks.lookup(event.target.textContent); }
        event.stopPropagation();
      });
      ['click', 'dblclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup'].forEach(type => this.shadow.addEventListener(type, event => event.stopPropagation()));
      this.onFullscreen = () => this.mount(this.player);
      document.addEventListener('fullscreenchange', this.onFullscreen);
    }
    /** 将字幕层放入播放器或全屏容器，使全屏时仍然可见。 */
    mount(player) {
      this.player = player;
      if (!player?.isConnected) return;
      const fullscreen = document.fullscreenElement;
      const target = fullscreen && fullscreen.tagName !== 'VIDEO' && (fullscreen.contains(player) || player.contains(fullscreen)) ? fullscreen : player;
      if (this.host.parentElement !== target) target.append(this.host);
    }
    /** 应用字号、背景及底部位置设置。 */
    configure(settings) {
      this.host.style.setProperty('--size', settings.fontSize + 'px');
      this.host.style.setProperty('--bg', String(settings.backgroundOpacity / 100));
      this.host.style.setProperty('--bottom', settings.bottomOffset + '%');
    }
    /** 渲染可查词原文，保留空格、换行和文本方向。 */
    original(text, language) {
      const fragment = document.createDocumentFragment();
      for (const part of N.segmentWords(text, language)) {
        if (!part.word) fragment.append(document.createTextNode(part.text));
        else { const span = document.createElement('span'); span.className = 'word'; span.textContent = part.text; span.tabIndex = 0; span.setAttribute('role', 'button'); fragment.append(span); }
      }
      this.elements.original.replaceChildren(fragment); this.elements.captions.hidden = !text;
      this.elements.translated.textContent = ''; this.elements.translated.hidden = true;
    }
    /** 只显示当前句的译文或加载状态。 */
    translated(text, pending = false) {
      this.elements.translated.textContent = text; this.elements.translated.hidden = !text;
      this.elements.translated.classList.toggle('pending', pending);
    }
    /** 更新紧凑状态栏及模型准备按钮。 */
    status(text, prepare = false, downloading = false) {
      this.lastStatus = text;
      this.elements.status.textContent = text; this.elements.prepare.hidden = !prepare;
      this.elements.prepare.disabled = downloading;
      this.elements.prepare.textContent = downloading ? '下载中…' : '准备本地翻译';
      this.elements.tools.classList.toggle('attention', prepare);
    }
    /** 获取原字幕范围内的选中文本，否则使用被点击的词。 */
    selectEnd(event) {
      if (event.button !== 0) return;
      const selection = this.shadow.getSelection?.() || window.getSelection();
      const selected = selection?.toString().trim();
      const inOriginal = selection && this.elements.original.contains(selection.anchorNode) && this.elements.original.contains(selection.focusNode);
      const term = inOriginal && selected ? selected : event.target.closest('.word')?.textContent;
      if (term) this.callbacks.lookup(term); else this.callbacks.selectCancel();
    }
    /** 打开查词浮窗并记录焦点，便于关闭后继续键盘操作。 */
    showLookup(term, context) {
      this.previousFocus = this.shadow.activeElement;
      this.elements.lookup.hidden = false; this.elements.term.textContent = term;
      this.elements.context.textContent = context; this.elements.meaning.textContent = '正在翻译…';
      this.elements.meta.textContent = '关闭后恢复之前的播放状态'; this.elements.save.disabled = true;
      this.elements.save.textContent = '＋ 收藏'; this.elements.close.focus({ preventScroll: true });
    }
    /** 展示查词结果，不把远程响应作为 HTML 执行。 */
    lookupResult(text, provider, failed = false) {
      this.elements.meaning.textContent = text;
      this.elements.meta.textContent = failed ? '可关闭后重试' : provider === 'mymemory' ? 'MyMemory 在线译文' : '本地译文';
      this.elements.save.disabled = failed;
    }
    /** 显示收藏操作的结果。 */
    saved(text = '已收藏 ✓', success = true) { this.elements.save.textContent = text; this.elements.save.disabled = success; }
    /** 关闭浮窗并归还焦点。 */
    closeLookup() { this.elements.lookup.hidden = true; this.previousFocus?.isConnected && this.previousFocus.focus({ preventScroll: true }); }
    /** 删除字幕层及全局监听器。 */
    destroy() { this.host.remove(); document.removeEventListener('fullscreenchange', this.onFullscreen); document.removeEventListener('pointerup', this.onPointerUp, true); document.removeEventListener('pointercancel', this.onPointerCancel, true); }
  }
  N.SubtitleOverlay = SubtitleOverlay;
})(globalThis);
