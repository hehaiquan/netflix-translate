(function initAdapter(scope) {
  'use strict';
  const N = scope.NetflixTranslate;
  const TEXT_SELECTOR = '.player-timedtext-text-container, [data-uia="subtitle-text"], [data-uia="player-timedtext-text-container"]';
  class NetflixAdapter {
    /** 仅适配原生字幕 DOM，不访问 Netflix 私有接口或其他扩展内容。 */
    constructor(onSnapshot, onError) {
      this.onSnapshot = onSnapshot; this.onError = onError; this.video = null; this.player = null;
      this.session = 0; this.sequence = 0; this.path = ''; this.last = null; this.scheduled = 0;
      this.onSeek = () => this.invalidate();
      this.onTrackClick = event => { if (event.target instanceof Element && event.target.closest('[data-uia*="subtitle"], [data-uia*="track-subtitle"]')) this.invalidate(); };
    }
    /** 监听字幕变化及单页导航，低频巡检补充播放器整体替换。 */
    start() {
      this.observer = new MutationObserver(() => this.schedule());
      this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      this.interval = setInterval(() => this.scan(), 700);
      document.addEventListener('click', this.onTrackClick, true);
      this.scan();
    }
    /** 合并一帧内的多次 DOM 变化，避免对整个页面高频遍历。 */
    schedule() { if (!this.scheduled) this.scheduled = requestAnimationFrame(() => { this.scheduled = 0; this.scan(); }); }
    /** 跳转进度或切换轨道时立即清除旧句的有效性。 */
    invalidate() { this.session++; this.last = null; this.scan(); }
    /** 重绑视频元素，并解绑上一集的事件。 */
    bindVideo(video) {
      if (this.video === video) return;
      if (this.video) { this.video.removeEventListener('seeking', this.onSeek); this.video.removeEventListener('emptied', this.onSeek); }
      this.video = video; this.session++; this.last = null;
      if (video) { video.addEventListener('seeking', this.onSeek); video.addEventListener('emptied', this.onSeek); }
    }
    /** 读取文字字幕快照，明确区分无字幕、图片字幕及扩展冲突。 */
    scan() {
      try {
        const match = location.pathname.match(/^\/watch\/(\d+)/);
        const path = match?.[1] || '';
        if (path !== this.path) { this.path = path; this.session++; this.last = null; }
        const video = path ? document.querySelector('video') : null;
        this.bindVideo(video);
        const player = video?.closest('[data-uia="player"]') || video?.closest('.watch-video') || video?.parentElement || null;
        if (player !== this.player) { this.player = player; this.session++; this.last = null; }
        const nodes = player ? Array.from(document.querySelectorAll(TEXT_SELECTOR)).filter(node => !node.closest('#lln-main-subs, .lln-main-subs, #lln-vertical-view-subs')) : [];
        const text = video?.seeking ? '' : N.cleanText(nodes.map(node => node.innerText || node.textContent).join('\n'));
        const roots = [...new Set(nodes.map(node => node.closest('.player-timedtext') || node))];
        const conflict = !!document.querySelector('body.lln-active, #lln-main-subs, .lln-main-subs, #nflxmultisubs, .nflxmultisubs');
        const imageOnly = !text && !!document.querySelector('.player-timedtext img, .player-timedtext-image-container, .image-based-timed-text');
        // 只信任字幕自身的语言标记，播放器外层的 lang 代表 Netflix 界面语言。
        const hint = nodes[0]?.getAttribute('lang') || nodes[0]?.closest('.player-timedtext')?.getAttribute('lang') || '';
        const fingerprint = [this.session, text, conflict, imageOnly, hint].join('|');
        if (this.last?.fingerprint === fingerprint && this.last.roots.length === roots.length && roots.every((root, index) => root === this.last.roots[index])) return;
        this.sequence++;
        const title = document.querySelector('[data-uia="video-title"], .video-title h4, .ellipsize-text h4')?.textContent?.trim() || document.title.replace(/\s*[-|–]?\s*Netflix\s*$/i, '').trim() || (path ? '影片 ' + path : '');
        const snapshot = { fingerprint, session: this.session, sequence: this.sequence, text, hint, roots, conflict, imageOnly,
          video, player, videoId: path, title, position: video?.currentTime || 0 };
        this.last = snapshot; this.onSnapshot(snapshot);
      } catch (error) { this.onError(error); }
    }
    /** 停止所有观察器和视频监听。 */
    stop() {
      this.observer?.disconnect(); clearInterval(this.interval); cancelAnimationFrame(this.scheduled);
      document.removeEventListener('click', this.onTrackClick, true); this.bindVideo(null);
    }
  }
  Object.assign(N, { NetflixAdapter, TEXT_SELECTOR });
})(globalThis);
