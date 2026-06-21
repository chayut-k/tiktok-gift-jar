const GIFT_DIAMOND_CAP = 500;

function normalizeGiftDiamonds(diamonds) {
  const value = Number(diamonds);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(value, GIFT_DIAMOND_CAP);
}

function giftScaleFactor(diamonds) {
  const capped = normalizeGiftDiamonds(diamonds);
  const minScale = 0.85;
  const maxScale = 2.35;
  const t = Math.sqrt((capped - 1) / (GIFT_DIAMOND_CAP - 1));
  return minScale + t * (maxScale - minScale);
}

function giftPixelSize(diamonds, baseSize = 39) {
  return Math.round(baseSize * giftScaleFactor(diamonds));
}

function getGiftSizeMultiplier(sizeId) {
  if (sizeId === 'small' || sizeId === 'sm') return 0.8;
  return 1;
}

function giftPhysicsRadius(diamonds, sizeMultiplier = 1) {
  const capped = normalizeGiftDiamonds(diamonds);
  const minR = 10;
  const maxR = 50;
  const t = Math.sqrt((capped - 1) / (GIFT_DIAMOND_CAP - 1));
  const base = minR + t * (maxR - minR);
  const scale = Number(sizeMultiplier);
  if (!Number.isFinite(scale) || scale <= 0) return base;
  return base * scale;
}