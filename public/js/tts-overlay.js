async function fetchTtsAudio({ text, voice, speed }) {
  const res = await fetch('/api/tts/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, speed }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 404) {
      throw new Error('tts_api_missing');
    }
    throw new Error(err.error || `tts_http_${res.status}`);
  }

  const voiceName = decodeURIComponent(res.headers.get('X-TTS-Voice') || '');
  const blob = await res.blob();
  return { blob, voiceName };
}

function previewTtsVoice(voiceId, volumePercent, speedPercent, format = 'full', text) {
  const mode = normalizeTtsFormat(format, 'full');
  const line = text || buildTtsPreviewText(mode);
  return playTtsLine({
    text: line,
    voice: voiceId,
    volume: parseTtsVolume(volumePercent),
    speed: parseTtsSpeed(speedPercent),
  });
}

let activePreviewAudio = null;

async function playTtsLine({ text, voice, volume, speed }) {
  const { blob, voiceName } = await fetchTtsAudio({ text, voice, speed });
  if (activePreviewAudio) {
    activePreviewAudio.pause();
    activePreviewAudio = null;
  }

  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.volume = parseTtsVolume(volume) / 100;
  activePreviewAudio = audio;

  return new Promise((resolve, reject) => {
    const cleanup = () => URL.revokeObjectURL(url);
    audio.onended = () => {
      cleanup();
      if (activePreviewAudio === audio) activePreviewAudio = null;
      resolve({ voiceName });
    };
    audio.onerror = () => {
      cleanup();
      if (activePreviewAudio === audio) activePreviewAudio = null;
      reject(new Error('audio_play_failed'));
    };
    audio.play().catch(reject);
  });
}

class TtsSpeaker {
  constructor(config, hooks = {}) {
    this.config = config;
    this.hooks = hooks;
    this.queue = [];
    this.running = false;
    this.currentAudio = null;
    this.unlocked = false;
  }

  getVoiceLabel() {
    const preset = TTS_VOICE_PRESETS.find((item) => item.id === this.config.voice);
    return preset ? preset.label : this.config.voice;
  }

  unlock() {
    this.unlocked = true;
    return true;
  }

  isSupported() {
    return typeof Audio !== 'undefined' && typeof fetch !== 'undefined';
  }

  enqueue(text) {
    const line = String(text || '').trim();
    if (!line || !this.isSupported()) return false;

    if (this.queue.length >= this.config.maxQueue) {
      this.queue.shift();
    }
    this.queue.push(line);
    this.hooks.onQueued?.(line, this.queue.length);
    this.pump();
    return true;
  }

  clear() {
    this.queue = [];
    this.running = false;
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this.hooks.onCleared?.();
  }

  async pump() {
    if (this.running || !this.queue.length || !this.isSupported()) return;
    this.running = true;

    while (this.queue.length) {
      const text = this.queue.shift();
      this.hooks.onSpeakStart?.(text, this.queue.length);
      try {
        const { blob, voiceName } = await fetchTtsAudio({
          text,
          voice: this.config.voice,
          speed: this.config.speed,
        });
        await this.playBlob(blob);
        this.hooks.onSpeakEnd?.(text, voiceName);
      } catch (err) {
        this.hooks.onSpeakError?.(text, err);
        break;
      }
    }

    this.running = false;
  }

  playBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = parseTtsVolume(this.config.volume) / 100;
      this.currentAudio = audio;

      const cleanup = () => {
        URL.revokeObjectURL(url);
        if (this.currentAudio === audio) this.currentAudio = null;
      };

      audio.onended = () => {
        cleanup();
        resolve();
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error('audio_play_failed'));
      };
      audio.play().catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }

  getActiveFormat() {
    if (typeof window !== 'undefined' && window.location) {
      return getTtsFormatFromUrl(window.location.search);
    }
    return normalizeTtsFormat(this.config.format, 'full');
  }

  handleChat(data) {
    const line = formatChatSpeech(data, this.getActiveFormat());
    if (line) this.enqueue(line);
  }
}