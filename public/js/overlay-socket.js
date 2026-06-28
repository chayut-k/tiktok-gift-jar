function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeImageUrl(url) {
  const trimmed = String(url || '').trim();
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return escapeHtml(trimmed);
}

function createOverlaySocket() {
  const user = new URLSearchParams(window.location.search).get('user') || '';
  return io({
    path: '/socket.io/',
    query: { user },
    transports: ['polling', 'websocket'],
    upgrade: true,
    rememberUpgrade: false,
    withCredentials: false,
    timeout: 20000,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
  });
}

function getOverlayBgId() {
  const bg = new URLSearchParams(window.location.search).get('bg');
  return bg === 'transparent' ? 'transparent' : 'dim';
}

function getOverlayNameColorId() {
  const color = new URLSearchParams(window.location.search).get('nameColor');
  if (color === 'black' || color === 'rainbow') return color;
  return 'white';
}

function getOverlayLikesColorId() {
  const color = new URLSearchParams(window.location.search).get('likesColor');
  if (color === 'black' || color === 'red') return color;
  return 'white';
}

function getOverlayFontSizeId(param, fallback = 'md') {
  const size = new URLSearchParams(window.location.search).get(param);
  if (size === 'sm' || size === 'lg') return size;
  return fallback;
}

function getOverlayNameSizeId() {
  return getOverlayFontSizeId('nameSize');
}

function getOverlayLikesSizeId() {
  return getOverlayFontSizeId('likesSize');
}

function getOverlayCoinsDisplay() {
  const coins = new URLSearchParams(window.location.search).get('coins');
  return coins === 'hide' ? 'hide' : 'show';
}

function getOverlayGiftSize() {
  const size = new URLSearchParams(window.location.search).get('giftsize');
  if (size === 'small' || size === 'sm') return 'small';
  return 'normal';
}

function getOverlayGiftSizeMultiplier() {
  return getGiftSizeMultiplier(getOverlayGiftSize());
}