const ACTIVITY_FONT_SIZE_OPTIONS = [
  { id: 'sm', label: 'เล็ก (14px)', px: 14 },
  { id: 'md', label: 'กลาง (16px)', px: 16 },
  { id: 'lg', label: 'ใหญ่ (18px)', px: 18 },
  { id: 'xl', label: 'ใหญ่มาก (22px)', px: 22 },
];

const ACTIVITY_DEFAULT_TEXT_COLOR = '#ffffff';
const ACTIVITY_DEFAULT_BORDER_COLOR = '#ff0050';

const ACTIVITY_DEMO_ITEMS = [
  {
    type: 'like',
    nickname: 'viewer_01',
    text: 'เคาะใจ 128 ครั้ง',
    icon: '❤️',
    avatar: '',
  },
  {
    type: 'follow',
    nickname: 'fan_99',
    text: 'ติดตามแล้ว',
    icon: '➕',
    avatar: '',
  },
  {
    type: 'share',
    nickname: 'share_king',
    text: 'แชร์ไลฟ์',
    icon: '↗️',
    avatar: '',
  },
  {
    type: 'gift',
    nickname: 'gift_master',
    text: 'ส่ง Rose x99',
    icon: '🎁',
    giftPictureUrl: '/images/rose.png',
    avatar: '',
  },
  {
    type: 'subscribe',
    nickname: 'super_fan',
    text: 'Subscribe แล้ว',
    icon: '⭐',
    avatar: '',
  },
];

function sanitizeHexColor(value, fallback = ACTIVITY_DEFAULT_TEXT_COLOR) {
  const raw = String(value ?? '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const c = raw.slice(1);
    return `#${c[0]}${c[0]}${c[1]}${c[1]}${c[2]}${c[2]}`.toLowerCase();
  }
  return fallback;
}

function parseActivityFontSizeParam(value, fallback = 'md') {
  const raw = String(value ?? '').trim().toLowerCase();
  if (ACTIVITY_FONT_SIZE_OPTIONS.some((item) => item.id === raw)) return raw;
  return fallback;
}

function getActivityFontSizeOption(sizeId) {
  return ACTIVITY_FONT_SIZE_OPTIONS.find((item) => item.id === sizeId) || ACTIVITY_FONT_SIZE_OPTIONS[1];
}

function getActivityFontSizePx(sizeId) {
  return getActivityFontSizeOption(sizeId).px;
}

function parseActivityColorParam(value, fallback) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const withHash = raw.startsWith('#') ? raw : `#${raw}`;
  return sanitizeHexColor(withHash, fallback);
}

function readActivityConfigFromUrl(search = window.location.search) {
  const params = new URLSearchParams(search);
  return {
    fontSizeId: parseActivityFontSizeParam(params.get('fontsize')),
    textColor: parseActivityColorParam(params.get('textcolor'), ACTIVITY_DEFAULT_TEXT_COLOR),
    borderColor: parseActivityColorParam(params.get('bordercolor'), ACTIVITY_DEFAULT_BORDER_COLOR),
  };
}

function escapeActivityHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeActivityImageUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/')) return escapeActivityHtml(trimmed);
  if (/^https?:\/\//i.test(trimmed)) return escapeActivityHtml(trimmed);
  return '';
}

function buildActivityCardMarkup(item, config = {}) {
  const fontSizeId = config.fontSizeId || 'md';
  const textColor = config.textColor || ACTIVITY_DEFAULT_TEXT_COLOR;
  const borderColor = config.borderColor || ACTIVITY_DEFAULT_BORDER_COLOR;
  const fontPx = getActivityFontSizePx(fontSizeId);
  const nickname = escapeActivityHtml(item.nickname || 'ผู้ชม');
  const text = escapeActivityHtml(item.text || '');
  const icon = escapeActivityHtml(item.icon || '');
  const avatarUrl = sanitizeActivityImageUrl(item.avatar);
  const giftUrl = sanitizeActivityImageUrl(item.giftPictureUrl);

  const avatarHtml = avatarUrl
    ? `<img class="activity-avatar" src="${avatarUrl}" alt="" style="border-color:${borderColor}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : '';
  const placeholderStyle = avatarUrl ? 'display:none;' : '';
  const mediaHtml = giftUrl
    ? `<img class="activity-gift" src="${giftUrl}" alt="">`
    : (icon ? `<span class="activity-icon">${icon}</span>` : '');

  return `
    <div class="activity-card" style="--activity-text:${textColor};--activity-font:${fontPx}px;--activity-border:${borderColor}">
      <div class="activity-avatar-wrap">
        ${avatarHtml}
        <div class="activity-avatar activity-avatar--placeholder" style="border-color:${borderColor};${placeholderStyle}">👤</div>
      </div>
      <div class="activity-body">
        <div class="activity-name">${nickname}</div>
        <div class="activity-text">${text}</div>
      </div>
      ${mediaHtml ? `<div class="activity-media">${mediaHtml}</div>` : ''}
    </div>`;
}