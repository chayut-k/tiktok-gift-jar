const TTS_EMOJI_PATTERN = /\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*/gu;
const TTS_FLAG_PATTERN = /\p{Regional_Indicator}{2}/gu;
const TTS_KEYCAP_PATTERN = /[#*0-9]\uFE0F?\u20E3/gu;
const TTS_SPEAKABLE_PATTERN = /[\p{L}\p{N}]/u;
const TTS_STICKER_ONLY_PATTERN = /^\[(?:สติกเกอร์|sticker|emote|emoji)\]$/i;

function stripEmojisForTts(text) {
  return String(text ?? '')
    .replace(TTS_EMOJI_PATTERN, ' ')
    .replace(TTS_FLAG_PATTERN, ' ')
    .replace(TTS_KEYCAP_PATTERN, ' ')
    .replace(/\u200D|\uFE0F|\uFE0E/g, ' ');
}

function hasSpeakableText(text) {
  return TTS_SPEAKABLE_PATTERN.test(String(text ?? ''));
}

function extractSpeakableText(raw, maxLen = 160) {
  const cleaned = String(raw ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || TTS_STICKER_ONLY_PATTERN.test(cleaned)) return '';

  const spoken = stripEmojisForTts(cleaned)
    .replace(/[^\p{L}\p{N}\s.,!?…'"()\-\u0E00-\u0E7F]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!hasSpeakableText(spoken)) return '';
  return spoken.slice(0, maxLen);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    stripEmojisForTts,
    hasSpeakableText,
    extractSpeakableText,
  };
}