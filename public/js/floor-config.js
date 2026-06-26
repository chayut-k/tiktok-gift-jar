const FLOOR_STAGE_W = 460;
const FLOOR_STAGE_H = 620;

const FLOOR_CONFIGS = {
  floor1: {
    label: 'พื้นหญ้า (floor1)',
    image: '/images/floor1.png',
    imageWidth: 3172,
    imageHeight: 724,
    physics: {
      centerX: 230,
      innerLeft: 8,
      innerRight: 452,
      surfaceOffsetRatio: 0.27,
      floorY: 544,
      spawn: {
        centerX: 230,
        y: 64,
        halfWidth: 145,
        spread: 0.85,
        lift: 8,
        jitter: 10,
      },
    },
  },
  floor2: {
    label: 'พื้นม่วง (floor2)',
    image: '/images/floor2.png',
    imageWidth: 2144,
    imageHeight: 480,
    physics: {
      centerX: 230,
      innerLeft: 8,
      innerRight: 452,
      surfaceOffsetRatio: 0.27,
      floorY: 545,
      spawn: {
        centerX: 230,
        y: 64,
        halfWidth: 145,
        spread: 0.85,
        lift: 8,
        jitter: 10,
      },
    },
  },
  floor3: {
    label: 'พื้นเค้ก (floor3)',
    image: '/images/floor3.png',
    imageWidth: 2128,
    imageHeight: 480,
    physics: {
      centerX: 230,
      innerLeft: 8,
      innerRight: 452,
      surfaceOffsetRatio: 0.21,
      floorY: 538,
      spawn: {
        centerX: 230,
        y: 64,
        halfWidth: 145,
        spread: 0.85,
        lift: 8,
        jitter: 10,
      },
    },
  },
};

const DEFAULT_FLOOR = 'floor1';

const NUMERIC_FLOOR_MAP = { 1: 'floor1', 2: 'floor2', 3: 'floor3' };

function getFloorDisplayHeight(config) {
  const imgW = config.imageWidth || FLOOR_STAGE_W;
  const imgH = config.imageHeight || 120;
  return Math.round(FLOOR_STAGE_W * (imgH / imgW));
}

function getFloorFromQuery() {
  const floor = new URLSearchParams(window.location.search).get('floor');
  if (floor && FLOOR_CONFIGS[floor]) return floor;
  const num = parseInt(floor, 10);
  if (Number.isFinite(num) && NUMERIC_FLOOR_MAP[num]) return NUMERIC_FLOOR_MAP[num];
  return DEFAULT_FLOOR;
}

function getFloorConfig(floorId) {
  return FLOOR_CONFIGS[floorId] || FLOOR_CONFIGS[DEFAULT_FLOOR];
}

function applyFloorImage(elementId) {
  const floorId = getFloorFromQuery();
  const floorConfig = getFloorConfig(floorId);
  const el = document.getElementById(elementId);
  if (el) {
    el.src = floorConfig.image;
    const displayH = getFloorDisplayHeight(floorConfig);
    el.style.height = `${displayH}px`;
  }
  return { floorId, floorConfig };
}