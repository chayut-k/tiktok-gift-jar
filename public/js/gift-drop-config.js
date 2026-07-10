const HELI_SPEED_OPTIONS = [
  { id: 'slow', label: 'ช้า (65%)', mult: 0.65 },
  { id: 'md', label: 'ปกติ (100%)', mult: 1 },
  { id: 'fast', label: 'เร็ว (140%)', mult: 1.4 },
  { id: 'turbo', label: 'เร็วมาก (200%)', mult: 2 },
];

function parseHeliSpeedParam(value, fallback = 'md') {
  const raw = String(value ?? '').trim().toLowerCase();
  if (HELI_SPEED_OPTIONS.some((item) => item.id === raw)) return raw;
  return fallback;
}

function getHeliSpeedOption(speedId) {
  return HELI_SPEED_OPTIONS.find((item) => item.id === speedId) || HELI_SPEED_OPTIONS[1];
}

function getHeliSpeedMultiplier(speedId = 'md') {
  return getHeliSpeedOption(speedId).mult;
}

function readGiftDropConfigFromUrl(search = window.location.search) {
  const params = new URLSearchParams(search);
  const speedId = parseHeliSpeedParam(params.get('hspeed'));
  return {
    speedId,
    speedMult: getHeliSpeedMultiplier(speedId),
  };
}