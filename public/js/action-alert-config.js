const ACTION_ALERT_TYPE_DEFS = [
  {
    id: 'gift',
    label: 'ของขวัญ',
    icon: '🎁',
    defaultTemplate: 'ขอบคุณ {username} ที่ส่ง {giftname}',
    hasMinCoin: true,
  },
  {
    id: 'like',
    label: 'ไลค์',
    icon: '❤️',
    defaultTemplate: 'ขอบคุณ {username} ที่เคาะใจ {coin} ครั้ง',
    hasMinLikes: true,
  },
  {
    id: 'follow',
    label: 'ติดตาม',
    icon: '➕',
    defaultTemplate: 'ขอบคุณ {username} ที่ติดตาม',
  },
  {
    id: 'share',
    label: 'แชร์',
    icon: '↗️',
    defaultTemplate: 'ขอบคุณ {username} ที่แชร์',
  },
  {
    id: 'join',
    label: 'เข้าห้อง',
    icon: '👋',
    defaultTemplate: 'ยินดีต้อนรับ {username} เข้าห้องไลฟ์',
  },
];

const ACTION_ALERT_TEMPLATE_PARAM_KEYS = {
  gift: 'tg',
  like: 'tl',
  follow: 'tf',
  share: 'ts',
  join: 'tj',
};

const ACTION_ALERT_ENABLE_PARAM_KEYS = {
  gift: 'eg',
  like: 'el',
  follow: 'ef',
  share: 'es',
  join: 'ej',
};

const ACTION_ALERT_DEMO_EVENTS = {
  gift: {
    type: 'gift',
    nickname: 'เราเองสุดหล่อ',
    avatar: '',
    giftName: 'โดนัท',
    giftPictureUrl: '/images/rose.png',
    coin: 99,
    likeCount: 0,
  },
  like: {
    type: 'like',
    nickname: 'viewer_01',
    avatar: '',
    giftName: '',
    giftPictureUrl: '',
    coin: 128,
    likeCount: 128,
  },
  follow: {
    type: 'follow',
    nickname: 'fan_99',
    avatar: '',
    giftName: '',
    giftPictureUrl: '',
    coin: 0,
    likeCount: 0,
  },
  share: {
    type: 'share',
    nickname: 'พี่สุดเท่',
    avatar: '',
    giftName: '',
    giftPictureUrl: '',
    coin: 0,
    likeCount: 0,
  },
  join: {
    type: 'join',
    nickname: 'new_viewer',
    avatar: '',
    giftName: '',
    giftPictureUrl: '',
    coin: 0,
    likeCount: 0,
  },
};

function createDefaultActionAlertConfig() {
  const enabled = {};
  const templates = {};
  ACTION_ALERT_TYPE_DEFS.forEach((def) => {
    enabled[def.id] = true;
    templates[def.id] = def.defaultTemplate;
  });

  return {
    bgId: 'dim',
    fontSizeId: 'md',
    textColor: '#ffffff',
    borderColor: '#ff0050',
    displaySec: 4,
    voice: 'female1',
    volume: 100,
    speed: 100,
    giftMinCoin: 1,
    likeMinCount: 1,
    enabled,
    templates,
  };
}

function mergeActionAlertConfig(partial = {}) {
  const base = createDefaultActionAlertConfig();
  const merged = {
    ...base,
    ...partial,
    enabled: { ...base.enabled, ...(partial.enabled || {}) },
    templates: { ...base.templates, ...(partial.templates || {}) },
  };

  merged.bgId = parseActivityBgParam(merged.bgId, base.bgId);
  merged.fontSizeId = parseActivityFontSizeParam(merged.fontSizeId, base.fontSizeId);
  merged.textColor = parseActivityColorParam(merged.textColor, base.textColor);
  merged.borderColor = parseActivityColorParam(merged.borderColor, base.borderColor);
  merged.displaySec = parseActionAlertDurationSec(merged.displaySec, base.displaySec);
  merged.voice = TTS_VOICE_PRESETS.some((item) => item.id === merged.voice) ? merged.voice : base.voice;
  merged.volume = parseTtsVolume(merged.volume, base.volume);
  merged.speed = parseTtsSpeed(merged.speed, base.speed);
  merged.giftMinCoin = parseActionAlertMinValue(merged.giftMinCoin, base.giftMinCoin);
  merged.likeMinCount = parseActionAlertMinValue(merged.likeMinCount, base.likeMinCount);

  ACTION_ALERT_TYPE_DEFS.forEach((def) => {
    if (typeof merged.enabled[def.id] !== 'boolean') {
      merged.enabled[def.id] = base.enabled[def.id];
    }
    const tpl = String(merged.templates[def.id] ?? '').trim();
    merged.templates[def.id] = tpl || def.defaultTemplate;
  });

  return merged;
}

function parseActionAlertDurationSec(value, fallback = 4) {
  const num = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(15, Math.max(2, num));
}

function parseActionAlertMinValue(value, fallback = 1) {
  const num = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.min(9999999, num);
}

function parseActionAlertEnableParam(value, fallback = true) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  if (raw === '1' || raw === 'true' || raw === 'on') return true;
  return fallback;
}

function decodeTemplateParam(value, fallback) {
  if (!value) return fallback;
  try {
    const decoded = decodeURIComponent(String(value));
    return decoded.trim() || fallback;
  } catch (_) {
    return String(value).trim() || fallback;
  }
}

function readActionAlertConfigFromUrl(search = window.location.search) {
  const params = new URLSearchParams(search);
  const partial = {
    bgId: params.get('bg'),
    fontSizeId: params.get('fontsize'),
    textColor: params.get('textcolor'),
    borderColor: params.get('bordercolor'),
    displaySec: params.get('dur'),
    voice: params.get('voice'),
    volume: params.get('vol') ?? params.get('volume'),
    speed: params.get('speed'),
    giftMinCoin: params.get('gmin'),
    likeMinCount: params.get('lmin'),
    enabled: {},
    templates: {},
  };

  ACTION_ALERT_TYPE_DEFS.forEach((def) => {
    const enableKey = ACTION_ALERT_ENABLE_PARAM_KEYS[def.id];
    const templateKey = ACTION_ALERT_TEMPLATE_PARAM_KEYS[def.id];
    if (params.has(enableKey)) {
      partial.enabled[def.id] = parseActionAlertEnableParam(params.get(enableKey), true);
    }
    if (params.has(templateKey)) {
      partial.templates[def.id] = decodeTemplateParam(params.get(templateKey), def.defaultTemplate);
    }
  });

  return mergeActionAlertConfig(partial);
}

function stripActionAlertColorForUrl(color) {
  return String(color || '').replace(/^#/, '');
}

function buildActionAlertUrlParams(config) {
  const merged = mergeActionAlertConfig(config);
  const params = {
    bg: merged.bgId,
    fontsize: merged.fontSizeId,
    textcolor: stripActionAlertColorForUrl(merged.textColor),
    bordercolor: stripActionAlertColorForUrl(merged.borderColor),
    dur: merged.displaySec,
    voice: merged.voice,
    vol: merged.volume,
    speed: merged.speed,
    gmin: merged.giftMinCoin,
    lmin: merged.likeMinCount,
  };

  ACTION_ALERT_TYPE_DEFS.forEach((def) => {
    const enableKey = ACTION_ALERT_ENABLE_PARAM_KEYS[def.id];
    const templateKey = ACTION_ALERT_TEMPLATE_PARAM_KEYS[def.id];
    params[enableKey] = merged.enabled[def.id] ? 1 : 0;
    if (merged.templates[def.id] !== def.defaultTemplate) {
      params[templateKey] = encodeURIComponent(merged.templates[def.id]);
    }
  });

  return params;
}

function formatActionTemplate(template, data = {}) {
  const username = String(data.nickname || data.username || 'ผู้ชม').trim();
  const giftname = String(data.giftName || data.giftname || '').trim();
  const coinNum = Number(data.coin ?? data.likeCount ?? 0) || 0;
  const coinLabel = coinNum.toLocaleString('en-US');

  return String(template || '')
    .replace(/\{username\}/gi, username)
    .replace(/\{giftname\}/gi, giftname)
    .replace(/\{coin\}/gi, coinLabel);
}

function shouldProcessActionAlert(config, event) {
  const merged = mergeActionAlertConfig(config);
  const type = event?.type;
  if (!type || !merged.enabled[type]) return false;

  if (type === 'gift') {
    const coin = Number(event.coin) || 0;
    if (coin < merged.giftMinCoin) return false;
  }

  if (type === 'like') {
    const likes = Number(event.likeCount ?? event.coin) || 0;
    if (likes < merged.likeMinCount) return false;
  }

  return true;
}

function resolveActionAlertMessage(config, event) {
  const merged = mergeActionAlertConfig(config);
  const template = merged.templates[event.type] || '';
  return formatActionTemplate(template, event);
}

function getActionAlertDisplayMs(config) {
  return parseActionAlertDurationSec(mergeActionAlertConfig(config).displaySec) * 1000;
}

function buildActionAlertCardMarkup(event, displayText, config = {}) {
  const merged = mergeActionAlertConfig(config);
  const cardConfig = {
    fontSizeId: merged.fontSizeId,
    textColor: merged.textColor,
    borderColor: merged.borderColor,
    bgId: merged.bgId,
    showName: false,
  };

  const icon = ACTION_ALERT_TYPE_DEFS.find((item) => item.id === event.type)?.icon || '';
  return buildActivityCardMarkup({
    nickname: event.nickname || 'ผู้ชม',
    text: displayText,
    icon,
    avatar: event.avatar || '',
    giftPictureUrl: event.type === 'gift' ? (event.giftPictureUrl || '') : '',
  }, cardConfig);
}

function getEnabledActionAlertDemoTypes(config) {
  const merged = mergeActionAlertConfig(config);
  return ACTION_ALERT_TYPE_DEFS
    .filter((def) => merged.enabled[def.id])
    .map((def) => def.id);
}