const GOAL_STYLE_OPTIONS = [
  { id: 'classic', label: 'คลาสสิก — TikTok Pink' },
  { id: 'neon', label: 'นีออน — เรืองแสง' },
  { id: 'minimal', label: 'มินิมอล — เรียบง่าย' },
];

const GOAL_TARGET_PRESETS = [100, 300, 500, 1000, 3000, 5000];

function parseGoalTarget(value, fallback = 500) {
  const num = parseInt(String(value ?? '').replace(/,/g, ''), 10);
  if (!Number.isFinite(num) || num < 1) return fallback;
  return Math.min(9999999, num);
}

function parseGoalStyleParam(value, fallback = 'classic') {
  const raw = String(value ?? '').trim().toLowerCase();
  if (GOAL_STYLE_OPTIONS.some((item) => item.id === raw)) return raw;
  return fallback;
}

function getGoalStyleOption(styleId) {
  return GOAL_STYLE_OPTIONS.find((item) => item.id === styleId) || GOAL_STYLE_OPTIONS[0];
}

function formatGoalNumber(value) {
  const num = Math.max(0, Math.floor(Number(value) || 0));
  return num.toLocaleString('en-US');
}

function computeGoalPercent(current, target) {
  const tgt = parseGoalTarget(target, 1);
  const cur = Math.max(0, Number(current) || 0);
  return Math.min(100, (cur / tgt) * 100);
}

function readLiveGoalConfigFromUrl(search = window.location.search) {
  const params = new URLSearchParams(search);
  return {
    target: parseGoalTarget(params.get('goal')),
    styleId: parseGoalStyleParam(params.get('style')),
  };
}

function buildGoalWidgetMarkup(current, target, styleId) {
  const pct = computeGoalPercent(current, target);
  const cur = formatGoalNumber(current);
  const tgt = formatGoalNumber(target);
  const pctLabel = `${Math.round(pct)}%`;

  return `
    <div class="live-goal live-goal--${styleId}" data-style="${styleId}">
      <div class="live-goal-head">
        <span class="live-goal-title">🎯 เป้าหมายไลฟ์</span>
        <span class="live-goal-pct">${pctLabel}</span>
      </div>
      <div class="live-goal-amount">
        <img class="live-goal-coin" src="/images/coin.png" alt="">
        <span class="live-goal-count"><strong>${cur}</strong> / ${tgt}</span>
      </div>
      <div class="live-goal-track" aria-hidden="true">
        <div class="live-goal-fill" style="width:${pct}%"></div>
      </div>
    </div>`;
}