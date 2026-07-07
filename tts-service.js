const { EdgeTTS } = require('edge-tts-universal');
const { extractSpeakableText } = require('./public/js/tts-text-utils');

const TTS_VOICE_PRESETS = [
  {
    id: 'female1',
    label: 'ผู้หญิง — นุ่มนวล',
    hint: 'Premwadee (ไทย)',
    edgeVoice: 'th-TH-PremwadeeNeural',
    rate: '-4%',
    pitch: '-1Hz',
  },
  {
    id: 'female2',
    label: 'ผู้หญิง — สดใส',
    hint: 'Ava Multilingual',
    edgeVoice: 'en-US-AvaMultilingualNeural',
    rate: '+4%',
    pitch: '+0Hz',
  },
  {
    id: 'male1',
    label: 'ผู้ชาย — ทางการ',
    hint: 'Niwat (ไทย)',
    edgeVoice: 'th-TH-NiwatNeural',
    rate: '+0%',
    pitch: '+0Hz',
  },
];

const TTS_PREVIEW_SAMPLE = 'สวัสดีค่ะ ยินดีต้อนรับเข้าสู่ไลฟ์';

function getVoicePreset(voiceId) {
  return TTS_VOICE_PRESETS.find((item) => item.id === voiceId) || TTS_VOICE_PRESETS[0];
}

function sanitizeTtsText(text, maxLen = 200) {
  return extractSpeakableText(text, maxLen);
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

function speedPercentToRateString(speedPercent) {
  const pct = Math.round(speedPercent - 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

function combineRateStrings(baseRate, userRate) {
  const parse = (rate) => parseInt(String(rate).replace('%', ''), 10) || 0;
  const total = parse(baseRate) + parse(userRate);
  return `${total >= 0 ? '+' : ''}${total}%`;
}

function normalizeTtsFormat(value, fallback = 'full') {
  const raw = String(value ?? '').trim().toLowerCase();
  if (['text', 'msg', 'message', 'comment', 'only'].includes(raw)) return 'text';
  if (['full', 'name', 'both', 'all'].includes(raw)) return 'full';
  return fallback === 'text' ? 'text' : 'full';
}

function resolveChatNickname(data) {
  if (data?.nickname) return sanitizeTtsText(data.nickname, 60);
  if (typeof data?.user === 'string') return sanitizeTtsText(data.user, 60);
  if (data?.user && typeof data.user === 'object') {
    return sanitizeTtsText(data.user.nickname || data.user.uniqueId || '', 60) || 'คนดู';
  }
  return 'คนดู';
}

function extractChatComment(data) {
  return sanitizeTtsText(data?.comment ?? data?.message ?? data?.content ?? data?.text, 160);
}

function formatChatSpeech(data, format = 'full') {
  const comment = extractChatComment(data);
  if (!comment) return '';
  if (normalizeTtsFormat(format) === 'text') return comment;
  return `${resolveChatNickname(data)} พูดว่า ${comment}`;
}

async function synthesizeSpeech({ text, voiceId, speedPercent = 100 }) {
  const line = sanitizeTtsText(text);
  if (!line) throw new Error('empty_text');

  const preset = getVoicePreset(voiceId);
  const rate = combineRateStrings(preset.rate, speedPercentToRateString(speedPercent));

  const tts = new EdgeTTS(line, preset.edgeVoice, {
    rate,
    volume: '+0%',
    pitch: preset.pitch,
  });

  const result = await tts.synthesize();
  const arrayBuffer = await result.audio.arrayBuffer();
  return {
    audio: Buffer.from(arrayBuffer),
    voiceName: preset.label,
    edgeVoice: preset.edgeVoice,
  };
}

module.exports = {
  TTS_VOICE_PRESETS,
  TTS_PREVIEW_SAMPLE,
  getVoicePreset,
  sanitizeTtsText,
  parseTtsVolume,
  parseTtsSpeed,
  formatChatSpeech,
  synthesizeSpeech,
};