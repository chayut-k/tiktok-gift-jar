const TTS_VOICE_PRESETS = [
  { id: 'female1', label: 'ผู้หญิง — นุ่มนวล', hint: 'Premwadee (ไทย)' },
  { id: 'female2', label: 'ผู้หญิง — สดใส', hint: 'Ava Multilingual' },
  { id: 'male1', label: 'ผู้ชาย — ทางการ', hint: 'Niwat (ไทย)' },
];

const TTS_FORMAT_OPTIONS = [
  { id: 'full', label: 'ชื่อผู้ใช้ + ข้อความ' },
  { id: 'text', label: 'เฉพาะข้อความ' },
];

const TTS_PREVIEW_SAMPLE = 'สวัสดีค่ะ ยินดีต้อนรับเข้าสู่ไลฟ์';

function normalizeTtsFormat(value, fallback = 'full') {
  const raw = String(value ?? '').trim().toLowerCase();
  if (['text', 'msg', 'message', 'comment', 'only'].includes(raw)) return 'text';
  if (['full', 'name', 'both', 'all'].includes(raw)) return 'full';
  return fallback === 'text' ? 'text' : 'full';
}

function sanitizeTtsLine(value, maxLen = 180) {
  return extractSpeakableText(value, maxLen);
}

function resolveChatNickname(data) {
  let nickname = '';
  if (data?.nickname) nickname = extractSpeakableText(data.nickname, 60);
  else if (typeof data?.user === 'string') nickname = extractSpeakableText(data.user, 60);
  else if (data?.user && typeof data.user === 'object') {
    nickname = extractSpeakableText(data.user.nickname || data.user.uniqueId || '', 60);
  }
  return nickname || 'คนดู';
}

function extractChatComment(data) {
  return extractSpeakableText(
    data?.comment ?? data?.message ?? data?.content ?? data?.text,
    160
  );
}

function buildTtsPreviewText(format = 'full') {
  return formatChatSpeech(
    { nickname: 'ผู้ชมทดสอบ', comment: TTS_PREVIEW_SAMPLE },
    format
  );
}

function getTtsFormatFromUrl(search = window.location.search) {
  return normalizeTtsFormat(new URLSearchParams(search).get('format'), 'full');
}

function parseTtsVolume(value, fallback = 100) {
  const num = parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(100, Math.max(0, num));
}

function parseTtsSpeed(value, fallback = 100) {
  const num = parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(150, Math.max(50, num));
}

function getTtsOverlayConfig() {
  const params = new URLSearchParams(window.location.search);
  const voice = params.get('voice');
  const format = params.get('format');
  const validVoice = TTS_VOICE_PRESETS.some((preset) => preset.id === voice);

  return {
    voice: validVoice ? voice : 'female1',
    volume: parseTtsVolume(params.get('vol') ?? params.get('volume'), 100),
    speed: parseTtsSpeed(params.get('speed'), 100),
    format: normalizeTtsFormat(format, 'full'),
    maxQueue: 8,
  };
}

function formatChatSpeech(data, format = 'full') {
  const comment = extractChatComment(data);
  if (!comment) return '';

  if (normalizeTtsFormat(format) === 'text') {
    return comment;
  }

  const nickname = resolveChatNickname(data);
  return `${nickname} พูดว่า ${comment}`;
}

function paintRangeInput(rangeEl) {
  if (!rangeEl) return;
  const min = Number(rangeEl.min || 0);
  const max = Number(rangeEl.max || 100);
  const value = Number(rangeEl.value || 0);
  const ratio = max > min ? (value - min) / (max - min) : 0;
  const thumb = 18;
  const width = rangeEl.getBoundingClientRect().width || 260;
  const usable = Math.max(width - thumb, 1);
  const fillPx = ratio * usable + thumb / 2;
  const pct = Math.min(100, Math.max(0, (fillPx / width) * 100));
  rangeEl.style.setProperty('--range-pct', `${pct}%`);
}

function bindRangeInput(rangeEl, onChange) {
  if (!rangeEl) return;
  const update = () => {
    paintRangeInput(rangeEl);
    if (onChange) onChange(rangeEl);
  };
  rangeEl.addEventListener('input', update);
  rangeEl.addEventListener('change', update);
  if (!window.__tgjTtsRangeResizeBound) {
    window.__tgjTtsRangeResizeBound = true;
    window.addEventListener('resize', () => {
      document.querySelectorAll('input[type="range"].tts-range').forEach(paintRangeInput);
    });
  }
  requestAnimationFrame(update);
}