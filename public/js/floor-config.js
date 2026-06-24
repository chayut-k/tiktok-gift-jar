const FLOOR_STAGE_W = 460;
const FLOOR_STAGE_H = 620;

const FLOOR_CONFIGS = {
  floor1: {
    label: 'พื้นหญ้า (floor1)',
    image: '/images/floor1.png',
    imageWidth: 2172,
    imageHeight: 724,
    physics: {
      centerX: 230,
      innerLeft: 8,
      innerRight: 452,
      // ผิวหญ้าด้านบนของรูป (≈12% จากขอบบน sprite)
      surfaceOffsetRatio: 0.12,
      floorY: 514,
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
    label: 'พื้นเค้ก (floor2)',
    image: '/images/floor2.jpg',
    imageWidth: 2816,
    imageHeight: 368,
    physics: {
      centerX: 230,
      innerLeft: 8,
      innerRight: 452,
      surfaceOffsetRatio: 0.08,
      floorY: 568,
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

const NUMERIC_FLOOR_MAP = { 1: 'floor1', 2: 'floor2' };

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