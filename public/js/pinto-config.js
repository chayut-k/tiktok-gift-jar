const PINTO_STAGE_W = 460;
const PINTO_STAGE_H = 620;

const PINTO_VARIANTS = {
  pinto1: {
    id: 'pinto1',
    label: 'ปิ่นโต (ดั้งเดิม)',
    image: '/images/ปิ่นโต.png',
    w: 960,
    h: 1072
  },
  pinto2: {
    id: 'pinto2',
    label: 'ปิ่นโต 2 (ไก่)',
    image: '/images/ปิ่นโต2.png',
    w: 960,
    h: 1072
  }
};

const PINTO_DEFAULT_ID = 'pinto2';

// พิกัดจาก pinto-marking.png (ภาพ 960×1072, Y=0 ด้านบน) — ใช้ร่วมทั้ง 2 รูป
// กรอบเขียว = ชั้น 1–4 | กรอบแดง = ฝาปิ่นโต
const PINTO_BAND_N = {
  lidTop: 70 / 1072,
  lidBottom: 295 / 1072,
  tier4Top: 302 / 1072,
  tier4Floor: 472 / 1072,
  tier3Top: 472 / 1072,
  tier3Floor: 646 / 1072,
  tier2Top: 646 / 1072,
  tier2Floor: 817 / 1072,
  tier1Top: 817 / 1072,
  tier1Floor: 980 / 1072,
  handleTop: 0
};

const PINTO_TIER_DEFS = [
  {
    id: 1,
    label: 'ชั้นล่าง',
    topN: PINTO_BAND_N.tier1Top,
    floorN: PINTO_BAND_N.tier1Floor,
    revealTopN: PINTO_BAND_N.tier1Top - 0.009,
    innerLeftN: 0.276,
    innerRightN: 0.7198,
    mouthN: (PINTO_BAND_N.tier1Top + PINTO_BAND_N.tier1Floor) / 2,
    mouthHalfN: 0.056
  },
  {
    id: 2,
    label: 'ชั้น 2',
    topN: PINTO_BAND_N.tier2Top,
    floorN: PINTO_BAND_N.tier2Floor,
    revealTopN: PINTO_BAND_N.tier2Top - 0.009,
    innerLeftN: 0.276,
    innerRightN: 0.7208,
    mouthN: (PINTO_BAND_N.tier2Top + PINTO_BAND_N.tier2Floor) / 2,
    mouthHalfN: 0.054
  },
  {
    id: 3,
    label: 'ชั้น 3',
    topN: PINTO_BAND_N.tier3Top,
    floorN: PINTO_BAND_N.tier3Floor,
    revealTopN: PINTO_BAND_N.tier3Top - 0.009,
    innerLeftN: 0.276,
    innerRightN: 0.7198,
    mouthN: (PINTO_BAND_N.tier3Top + PINTO_BAND_N.tier3Floor) / 2,
    mouthHalfN: 0.052
  },
  {
    id: 4,
    label: 'ชั้นบน',
    topN: PINTO_BAND_N.tier4Top,
    floorN: PINTO_BAND_N.tier4Floor,
    revealTopN: PINTO_BAND_N.lidBottom,
    innerLeftN: 0.2729,
    innerRightN: 0.7208,
    mouthN: (PINTO_BAND_N.tier4Top + PINTO_BAND_N.tier4Floor) / 2,
    mouthHalfN: 0.05,
    fillRatio: 0.88
  }
];

function buildPintoLayout(stageW, stageH, imageW, imageH) {
  const scale = Math.min(stageW / imageW, stageH / imageH);
  const displayW = imageW * scale;
  const displayH = imageH * scale;
  return {
    stageW,
    stageH,
    imageW,
    imageH,
    scale,
    displayW,
    displayH,
    offsetX: (stageW - displayW) / 2
  };
}

function mapPintoX(layout, normalizedX) {
  return layout.offsetX + normalizedX * layout.displayW;
}

function mapPintoY(layout, normalizedY) {
  return layout.stageH - (1 - normalizedY) * layout.displayH;
}

function resolvePintoTiers(layout, tierDefs) {
  return tierDefs.map((tier) => {
    const floorY = mapPintoY(layout, tier.floorN);
    const topY = mapPintoY(layout, tier.topN);
    const interior = Math.max(32, floorY - topY);
    const wallHeight = interior - 4;
    const innerLeft = mapPintoX(layout, tier.innerLeftN);
    const innerRight = mapPintoX(layout, tier.innerRightN);
    const innerWidth = innerRight - innerLeft;

    return {
      id: tier.id,
      label: tier.label,
      floorY,
      topY,
      revealTopY: mapPintoY(layout, tier.revealTopN),
      innerLeft,
      innerRight,
      floorWidth: innerWidth - 6,
      wallHeight,
      wallCenterY: floorY - wallHeight / 2,
      mouthY: mapPintoY(layout, tier.mouthN),
      mouthHalfWidth: tier.mouthHalfN * layout.displayW,
      fillRatio: tier.fillRatio || 0.9
    };
  });
}

function resolvePintoVariantId(pintoId) {
  if (pintoId && PINTO_VARIANTS[pintoId]) return pintoId;
  return PINTO_DEFAULT_ID;
}

function buildPintoConfig(pintoId = PINTO_DEFAULT_ID) {
  const variant = PINTO_VARIANTS[resolvePintoVariantId(pintoId)];
  const layout = buildPintoLayout(
    PINTO_STAGE_W,
    PINTO_STAGE_H,
    variant.w,
    variant.h
  );

  return {
    id: variant.id,
    label: variant.label,
    image: variant.image,
    centerX: layout.offsetX + layout.displayW / 2,
    layout,
    tierCount: 4,
    lidTopY: mapPintoY(layout, PINTO_BAND_N.lidTop),
    lidBottomY: mapPintoY(layout, PINTO_BAND_N.lidBottom),
    lidLeftX: mapPintoX(layout, 0.236),
    lidRightX: mapPintoX(layout, 0.764),
    fullRevealTopY: mapPintoY(layout, PINTO_BAND_N.lidTop),
    spillFloorY: mapPintoY(layout, 0.968),
    tiers: resolvePintoTiers(layout, PINTO_TIER_DEFS)
  };
}

const PINTO_CONFIG_CACHE = {};

function getPintoConfig(pintoId) {
  const id = resolvePintoVariantId(pintoId);
  if (!PINTO_CONFIG_CACHE[id]) {
    PINTO_CONFIG_CACHE[id] = buildPintoConfig(id);
  }
  return PINTO_CONFIG_CACHE[id];
}

function getPintoVariantFromUrl(search = window.location.search) {
  const pinto = new URLSearchParams(search).get('pinto');
  return resolvePintoVariantId(pinto);
}

function applyPintoImage(elementId, pintoId) {
  const resolvedId = resolvePintoVariantId(pintoId);
  const pintoConfig = getPintoConfig(resolvedId);
  const el = document.getElementById(elementId);
  if (el) {
    el.src = pintoConfig.image;
  }
  return { pintoConfig, pintoId: resolvedId };
}