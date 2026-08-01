(function () {
  const STORAGE_KEY = "road-to-crown-audio-enabled-v1";
  const FADE_MS = 420;

  const bgmConfig = {
    main: { src: "assets/audio/bgm-main.wav", fallback: "assets/audio/bgm-main.mp3", volume: 0.25 },
    game: { src: "assets/audio/bgm-game.wav", fallback: "assets/audio/bgm-game.mp3", volume: 0.35 },
  };

  const sfxConfig = {
    hit: { src: "assets/audio/sfx-hit.wav", fallback: "assets/audio/sfx-hit.mp3", volume: 0.45 },
    bonus: { src: "assets/audio/sfx-bonus.wav", fallback: "assets/audio/sfx-bonus.mp3", volume: 0.55 },
    miss: { src: "assets/audio/sfx-miss.wav", fallback: "assets/audio/sfx-miss.mp3", volume: 0.4 },
    combo: { src: "assets/audio/sfx-combo.wav", fallback: "assets/audio/sfx-combo.mp3", volume: 0.5 },
    success: { src: "assets/audio/sfx-success.wav", fallback: "assets/audio/sfx-success.mp3", volume: 0.55 },
    leaderChange: { src: "assets/audio/sfx-leader-change.wav", fallback: "assets/audio/sfx-leader-change.mp3", volume: 0.65 },
  };

  const state = {
    enabled: false,
    unlocked: false,
    currentBgm: null,
    currentKey: "",
    fadeTimer: null,
    warned: new Set(),
    button: null,
    audioContext: null,
    busy: false,
  };

  const bgm = {};
  const sfx = {};

  function createAudio(src, { fallback = "", loop = false, volume = 1 } = {}) {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.loop = loop;
    audio.volume = volume;
    audio.__primarySrc = src;
    audio.__fallbackSrc = fallback;
    audio.__fallbackTried = false;
    audio.addEventListener("error", () => switchToFallback(audio));
    return audio;
  }

  function warnMissing(src) {
    if (state.warned.has(src)) return;
    state.warned.add(src);
    console.warn(`[AudioManager] 音频文件暂不可用，已静默跳过：${src}`);
  }

  function switchToFallback(audio) {
    const primary = audio.__primarySrc || audio.src;
    const fallback = audio.__fallbackSrc;
    if (fallback && !audio.__fallbackTried) {
      audio.__fallbackTried = true;
      warnMissing(primary);
      audio.src = fallback;
      audio.load();
      return true;
    }
    warnMissing(audio.currentSrc || audio.src || primary);
    return false;
  }

  function init() {
    bgm.main = createAudio(bgmConfig.main.src, { fallback: bgmConfig.main.fallback, loop: true, volume: 0 });
    bgm.game = createAudio(bgmConfig.game.src, { fallback: bgmConfig.game.fallback, loop: true, volume: 0 });
    Object.keys(sfxConfig).forEach((key) => {
      sfx[key] = createAudio(sfxConfig[key].src, { fallback: sfxConfig[key].fallback, volume: sfxConfig[key].volume });
    });

    state.enabled = localStorage.getItem(STORAGE_KEY) === "on";
    state.button = document.getElementById("soundToggle");
    if (state.button) {
      state.button.addEventListener("click", toggleMute);
    }
    updateButton();
  }

  async function unlockAudio() {
    if (state.unlocked) return true;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        state.audioContext = state.audioContext || new AudioContextClass();
        if (state.audioContext.state === "suspended") {
          await state.audioContext.resume();
        }
      }
      state.unlocked = true;
      return true;
    } catch {
      state.unlocked = false;
      return false;
    }
  }

  function updateButton() {
    if (!state.button) return;
    if (state.busy) {
      state.button.textContent = "🔊 开启中";
      state.button.setAttribute("aria-pressed", "false");
      return;
    }
    const active = state.enabled && state.unlocked;
    state.button.textContent = active ? "🔊 声音已开" : "🔇 开启声音";
    state.button.setAttribute("aria-pressed", active ? "true" : "false");
  }

  function playMainBgm() {
    return fadeToMainBgm();
  }

  function playGameBgm() {
    return fadeToGameBgm();
  }

  function fadeToMainBgm() {
    return fadeToBgm("main", bgmConfig.main.volume);
  }

  function fadeToGameBgm() {
    return fadeToBgm("game", bgmConfig.game.volume);
  }

  function currentBgmKey() {
    return document.querySelector(".screen.active")?.id === "gameScreen" ? "game" : "main";
  }

  function resumeAudioContext() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return Promise.resolve();
      state.audioContext = state.audioContext || new AudioContextClass();
      if (state.audioContext.state === "suspended") return state.audioContext.resume();
    } catch {
      return Promise.resolve();
    }
    return Promise.resolve();
  }

  async function fadeToBgm(key, targetVolume) {
    if (!state.enabled) return;
    if (state.currentKey === key && state.currentBgm && !state.currentBgm.paused) {
      fadeVolume(state.currentBgm, targetVolume, FADE_MS);
      return;
    }

    const next = bgm[key];
    if (!next) return;
    await unlockAudio();
    if (!state.unlocked) {
      updateButton();
      return;
    }

    const previous = state.currentBgm;
    state.currentBgm = next;
    state.currentKey = key;

    next.loop = true;
    next.volume = 0;
    try {
      await next.play();
      fadeVolume(next, targetVolume, FADE_MS);
    } catch {
      if (switchToFallback(next)) {
        try {
          await next.play();
          fadeVolume(next, targetVolume, FADE_MS);
        } catch {
          warnMissing(next.currentSrc || next.src);
          state.unlocked = false;
          updateButton();
          return;
        }
      } else {
        state.unlocked = false;
        updateButton();
        return;
      }
    }

    state.unlocked = true;
    updateButton();

    if (previous && previous !== next) {
      fadeVolume(previous, 0, FADE_MS, () => {
        previous.pause();
        previous.currentTime = 0;
      });
    }
  }

  function fadeVolume(audio, target, duration, done) {
    const start = audio.volume;
    const delta = target - start;
    const started = Date.now();
    clearInterval(audio.__fadeTimer);
    audio.__fadeTimer = setInterval(() => {
      const progress = Math.min((Date.now() - started) / duration, 1);
      audio.volume = Math.max(0, Math.min(1, start + delta * progress));
      if (progress >= 1) {
        clearInterval(audio.__fadeTimer);
        if (done) done();
      }
    }, 30);
  }

  function stopBgm() {
    Object.values(bgm).forEach((audio) => {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 0;
    });
    state.currentBgm = null;
    state.currentKey = "";
  }

  function playSfx(name) {
    if (!state.enabled || !state.unlocked) return;
    const config = sfxConfig[name];
    if (!config) return;
    const audio = createAudio(config.src, { fallback: config.fallback, volume: config.volume });
    audio.volume = config.volume;
    audio.play().catch(() => {
      if (!switchToFallback(audio)) return;
      audio.play().catch(() => warnMissing(config.fallback || config.src));
    });
  }

  function setGameRush(active) {
    if (!state.enabled || !bgm.game) return;
    fadeVolume(bgm.game, active ? 0.42 : bgmConfig.game.volume, 300);
  }

  function mute() {
    state.enabled = false;
    state.unlocked = false;
    state.busy = false;
    localStorage.setItem(STORAGE_KEY, "off");
    stopBgm();
    updateButton();
  }

  async function unmute(key = currentBgmKey()) {
    if (state.busy) return;
    state.busy = true;
    state.enabled = true;
    localStorage.setItem(STORAGE_KEY, "on");
    updateButton();

    const config = bgmConfig[key] || bgmConfig.main;
    const next = bgm[key] || bgm.main;
    if (!next) {
      state.busy = false;
      state.unlocked = false;
      updateButton();
      return;
    }

    const previous = state.currentBgm;
    state.currentBgm = next;
    state.currentKey = key;
    next.loop = true;
    next.volume = config.volume;

    const resumePromise = resumeAudioContext();
    let played = false;
    try {
      await next.play();
      played = true;
    } catch {
      if (switchToFallback(next)) {
        try {
          await next.play();
          played = true;
        } catch {
          played = false;
        }
      }
    }

    await resumePromise.catch(() => {});
    state.busy = false;
    state.unlocked = played;
    if (!played) {
      state.enabled = false;
      localStorage.setItem(STORAGE_KEY, "off");
      warnMissing(next.currentSrc || next.src || config.src);
    } else if (previous && previous !== next) {
      previous.pause();
      previous.currentTime = 0;
      previous.volume = 0;
    }
    updateButton();
  }

  function toggleMute(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (state.enabled && state.unlocked) {
      mute();
    } else {
      unmute();
    }
  }

  function isMuted() {
    return !state.enabled;
  }

  function setVolume(type, volume) {
    if (type === "main") bgmConfig.main.volume = volume;
    if (type === "game") bgmConfig.game.volume = volume;
    if (sfxConfig[type]) sfxConfig[type].volume = volume;
  }

  window.AudioManager = {
    init,
    unlockAudio,
    playMainBgm,
    playGameBgm,
    stopBgm,
    fadeToMainBgm,
    fadeToGameBgm,
    playSfx,
    mute,
    unmute,
    toggleMute,
    isMuted,
    setVolume,
    setGameRush,
  };
})();
