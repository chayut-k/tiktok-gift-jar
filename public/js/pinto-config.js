const PINTO_STAGE_W = 460;
const PINTO_STAGE_H = 620;
const PINTO_IMAGE = {
  path: '/images/ปิ่นโต2.png',
  w: 960,
  h: 1072
};

// วัดจากแถบเขียวในรูป (mid y): 307.5, 480.5, 653.5, 823.5 บนภาพ 1072px
// floor ชั้นล่าง = ขอบบนชั้นบน (ใช้ค่าเดียวกัน ไม่เว้นช่องว่าง)
const PINTO_BAND_N = {
  band43: 307.5 / 1072,
  band32: 480.5 / 1072,
  band21: 653.5 / 1072,
  band10: 823.5 / 1072,
  tier4Top: 140 / 1072,
  tier1Base: 968 / 1072,
  handleTop: 0
};

const PINTO_TIER_DEFS = [
  {
    id: 1,
    label: 'ชั้นล่าง',
    topN: PINTO_BAND_N.band21,
    floorN: PINTO_BAND_N.tier1Base,
    revealTopN: PINTO_BAND_N.band21 - 0.009,
    innerLeftN: 0.262,
    innerRightN: 0.748,
    mouthN: (PINTO_BAND_N.band21 + PINTO_BAND_N.tier1Base) / 2,
    mouthHalfN: 0.056
  },
  {
    id: 2,
    label: 'ชั้น 2',
    topN: PINTO_BAND_N.band32,
    floorN: PINTO_BAND_N.band21,
    revealTopN: PINTO_BAND_N.band32 - 0.009,
    innerLeftN: 0.262,
    innerRightN: 0.748,
    mouthN: (PINTO_BAND_N.band32 + PINTO_BAND_N.band21) / 2,
    mouthHalfN: 0.054
  },
  {
    id: 3,
    label: 'ชั้น 3',
    topN: PINTO_BAND_N.band43,
    floorN: PINTO_BAND_N.band32,
    revealTopN: PINTO_BAND_N.band43 - 0.009,
    innerLeftN: 0.262,
    innerRightN: 0.748,
    mouthN: (PINTO_BAND_N.band43 + PINTO_BAND_N.band32) / 2,
    mouthHalfN: 0.052
  },
  {
    id: 4,
    label: 'ชั้นบน',
    topN: PINTO_BAND_N.tier4Top,
    floorN: PINTO_BAND_N.band43,
    revealTopN: PINTO_BAND_N.handleTop,
    innerLeftN: 0.262,
    innerRightN: 0.748,
    mouthN: (PINTO_BAND_N.tier4Top + PINTO_BAND_N.band43) / 2,
    mouthHalfN: 0.05,
    overflowRatio: 0.9
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
      overflowRatio: tier.overflowRatio || 0.9
    };
  });
}

const PINTO_LAYOUT = buildPintoLayout(
  PINTO_STAGE_W,
  PINTO_STAGE_H,
  PINTO_IMAGE.w,
  PINTO_IMAGE.h
);

const PINTO_CONFIG = {
  id: 'pinto2',
  label: 'ปิ่นโต แก้ว (ไก่)',
  image: PINTO_IMAGE.path,
  centerX: PINTO_LAYOUT.offsetX + PINTO_LAYOUT.displayW / 2,
  layout: PINTO_LAYOUT,
  tierCount: 4,
  fullRevealTopY: mapPintoY(PINTO_LAYOUT, PINTO_BAND_N.handleTop),
  spillFloorY: mapPintoY(PINTO_LAYOUT, 0.935),
  tiers: resolvePintoTiers(PINTO_LAYOUT, PINTO_TIER_DEFS)
};

function getPintoConfig() {
  return PINTO_CONFIG;
}

function applyPintoImage(elementId) {
  const pintoConfig = getPintoConfig();
  const el = document.getElementById(elementId);
  if (el) {
    el.src = pintoConfig.image;
  }
  return { pintoConfig };
}