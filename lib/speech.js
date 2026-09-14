/** 初始化供生词本使用的本地语音选择与朗读控制器。 */
(function initSpeech(scope) {
  'use strict';
  const N = scope.NetflixTranslate;
  const preferredLocales = { en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', 'zh-Hant': 'zh-TW' };

  /** 只选择与原文语言匹配的本地语音，优先使用常用地区与系统默认音色。 */
  function selectSpeechVoice(voices, language) {
    const code = N.languageCode(language);
    const local = voices.filter(voice => voice.localService && N.languageCode(voice.lang) === code);
    const locale = (preferredLocales[code] || language).toLowerCase();
    const exact = local.filter(voice => voice.lang.replace(/_/g, '-').toLowerCase() === locale);
    return exact.find(voice => voice.default) || exact[0] || local.find(voice => voice.default) || local[0] || null;
  }

  /** 把设备语音错误转换成可操作的中文提示。 */
  function speechError(code) {
    if (code === 'not-allowed') return '浏览器未允许播放语音，请再次点击发音按钮。';
    if (code === 'audio-busy' || code === 'audio-hardware') return '暂时无法播放声音，请检查设备的音频输出后重试。';
    if (code === 'language-unavailable' || code === 'voice-unavailable') return '对应的本地语音暂不可用，请在系统设置中检查该语言的语音后重试。';
    if (code === 'text-too-long') return '这段对白过长，当前语音引擎无法完整朗读。';
    return '本地朗读失败，请稍后重试，或检查系统是否已安装对应语音。';
  }

  class SpeechPlayer {
    /** 为生词本维护一个朗读会话，预先触发浏览器加载设备语音列表。 */
    constructor(onState, host = scope) {
      this.synth = host.speechSynthesis;
      this.Utterance = host.SpeechSynthesisUtterance;
      this.onState = onState;
      this.state = { status: 'idle', key: '' };
      this.generation = 0;
      this.active = null;
      this.cancelWait = null;
      this.startTimer = null;
      try { this.synth?.getVoices(); } catch (_) { /* 点击时再展示设备语音不可用提示。 */ }
    }

    /** 检查当前页面是否提供完整的浏览器朗读接口。 */
    get supported() {
      return !!(this.synth && this.Utterance && this.synth.getVoices && this.synth.speak && this.synth.cancel);
    }

    /** 发布朗读状态，让播放按钮与错误提示保持一致。 */
    update(state) {
      this.state = state;
      this.onState(state);
    }

    /** 等待首次异步语音加载；停止或超时后及时移除事件监听。 */
    waitForVoices() {
      return new Promise(resolve => {
        let finished = false;
        /** 结束等待并释放本次监听和定时器。 */
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          this.synth.removeEventListener('voiceschanged', changed);
          this.cancelWait = null;
          resolve();
        };
        /** 只有浏览器已经返回语音列表时才提前结束等待。 */
        const changed = () => {
          try { if (this.synth.getVoices().length) finish(); } catch (_) { finish(); }
        };
        const timer = setTimeout(finish, 1500);
        this.cancelWait = finish;
        this.synth.addEventListener('voiceschanged', changed);
        changed();
      });
    }

    /** 停止声音及待加载的请求，使旧朗读回调不能覆盖新状态。 */
    stop() {
      this.generation++;
      this.cancelWait?.();
      clearTimeout(this.startTimer);
      this.startTimer = null;
      const active = this.active;
      this.active = null;
      if (active) {
        try { this.synth.cancel(); } catch (_) { /* 即使设备取消失败也清理页面状态。 */ }
      }
      if (this.state.status !== 'idle') this.update({ status: 'idle', key: '' });
    }

    /** 结束失败会话，并将错误关联到用户刚刚点击的词条。 */
    fail(key, message) {
      this.stop();
      this.update({ status: 'error', key, message });
    }

    /** 点击同一按钮时停止；切换词语或对白时只播放最新一次请求。 */
    async toggle(key, text, language) {
      if (this.state.key === key && ['loading', 'speaking'].includes(this.state.status)) {
        this.stop();
        return;
      }
      this.stop();
      const value = N.cleanText(text);
      if (!value) return;
      if (!this.supported) {
        this.fail(key, '当前浏览器不支持朗读，请使用桌面版 Chrome 打开生词本。');
        return;
      }
      const generation = this.generation;
      this.update({ status: 'loading', key });
      try {
        if (!this.synth.getVoices().length) await this.waitForVoices();
        if (generation !== this.generation) return;
        const voice = selectSpeechVoice(this.synth.getVoices(), language);
        if (!voice) {
          this.fail(key, '当前设备没有可用的' + (N.LANGUAGES[N.languageCode(language)] || '对应语言') + '本地语音，请在系统设置中添加该语言的语音后重试。');
          return;
        }
        const utterance = new this.Utterance(value);
        utterance.voice = voice;
        utterance.lang = voice.lang;
        utterance.rate = 0.9;
        this.active = utterance;
        /** 判断事件是否仍然属于当前朗读，忽略取消后迟到的事件。 */
        const current = () => generation === this.generation && this.active === utterance;
        utterance.onstart = () => {
          if (!current()) return;
          clearTimeout(this.startTimer);
          this.update({ status: 'speaking', key });
        };
        utterance.onend = () => {
          if (!current()) return;
          clearTimeout(this.startTimer);
          this.active = null;
          this.update({ status: 'idle', key: '' });
        };
        utterance.onerror = event => {
          if (!current()) return;
          if (event.error === 'canceled' || event.error === 'interrupted') this.stop();
          else this.fail(key, speechError(event.error));
        };
        this.startTimer = setTimeout(() => {
          if (current()) this.fail(key, '语音启动超时，请再次点击发音按钮，或检查系统语音设置。');
        }, 8000);
        if (this.synth.paused) this.synth.resume();
        this.synth.speak(utterance);
      } catch (error) {
        if (generation === this.generation) this.fail(key, speechError(error.name === 'NotAllowedError' ? 'not-allowed' : 'synthesis-failed'));
      }
    }
  }

  Object.assign(N, { selectSpeechVoice, SpeechPlayer });
})(globalThis);
