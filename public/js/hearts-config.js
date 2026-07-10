const HEART_IMAGE_OPTIONS = [
  { id: 'red', label: 'หัวใจแดง', image: '/images/red heart.png' },
  { id: 'purple', label: 'หัวใจม่วง', image: '/images/purple heart.png' },
  { id: 'pink', label: 'หัวใจชมพู', image: '/images/pink heart.png' },
  { id: 'blue', label: 'หัวใจฟ้า', image: '/images/blue heart.png' },
  { id: 'green', label: 'หัวใจเขียว', image: '/images/green heart.png' },
  { id: 'yellow', label: 'หัวใจเหลือง', image: '/images/yellow heart.png' },
];

const HEART_SIZE_OPTIONS = [
  { id: 'sm', label: 'เล็ก (18px)', px: 18 },
  { id: 'md', label: 'กลาง (24px)', px: 24 },
  { id: 'lg', label: 'ใหญ่ (30px)', px: 30 },
];

const HEART_SPREAD_OPTIONS = [
  { id: 'tight', label: 'แคบ — กระจุกใกล้กัน', leftMin: 10, leftRange: 10, bottomMin: 20, bottomRange: 4 },
  { id: 'normal', label: 'ปานกลาง', leftMin: 5, leftRange: 27, bottomMin: 18, bottomRange: 8 },
  { id: 'wide', label: 'กว้าง — กระจายเต็มพื้นที่', leftMin: 3, leftRange: 42, bottomMin: 12, bottomRange: 16 },
];

function getHeartImageOption(heartId) {
  return HEART_IMAGE_OPTIONS.find((item) => item.id === heartId) || HEART_IMAGE_OPTIONS[0];
}

function getHeartSizeOption(sizeId) {
  return HEART_SIZE_OPTIONS.find((item) => item.id === sizeId) || HEART_SIZE_OPTIONS[1];
}

function getHeartSizePx(sizeId) {
  return getHeartSizeOption(sizeId).px;
}

function parseHeartImageParam(value, fallback = 'red') {
  const raw = String(value ?? '').trim().toLowerCase();
  if (HEART_IMAGE_OPTIONS.some((item) => item.id === raw)) return raw;
  return fallback;
}

function parseHeartSizeParam(value, fallback = 'md') {
  const raw = String(value ?? '').trim().toLowerCase();
  if (HEART_SIZE_OPTIONS.some((item) => item.id === raw)) return raw;
  return fallback;
}

function getHeartSpreadOption(spreadId) {
  return HEART_SPREAD_OPTIONS.find((item) => item.id === spreadId) || HEART_SPREAD_OPTIONS[1];
}

function parseHeartSpreadParam(value, fallback = 'normal') {
  const raw = String(value ?? '').trim().toLowerCase();
  if (HEART_SPREAD_OPTIONS.some((item) => item.id === raw)) return raw;
  return fallback;
}

function randomHeartPosition(spreadId = 'normal') {
  const spread = getHeartSpreadOption(spreadId);
  return {
    left: spread.leftMin + Math.random() * spread.leftRange,
    bottom: spread.bottomMin + Math.random() * spread.bottomRange,
  };
}

function readLikeHeartsConfigFromUrl(search = window.location.search) {
  const params = new URLSearchParams(search);
  return {
    heartId: parseHeartImageParam(params.get('heart')),
    sizeId: parseHeartSizeParam(params.get('heartsize')),
    spreadId: parseHeartSpreadParam(params.get('spread')),
  };
}