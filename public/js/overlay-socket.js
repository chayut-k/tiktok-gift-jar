function createOverlaySocket() {
  const user = new URLSearchParams(window.location.search).get('user') || '';
  return io({ query: { user } });
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