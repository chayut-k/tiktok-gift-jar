/**
 * สร้างรูป debug ขอบชน ultra jar (stage 460×620)
 * รัน: node scripts/ultra-debug-overlay.js
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const STAGE_W = 460;
const STAGE_H = 620;
const IMG_W = 976;
const IMG_H = 1056;
const scale = Math.min(STAGE_W / IMG_W, STAGE_H / IMG_H);
const offsetX = (STAGE_W - IMG_W * scale) / 2;
const offsetY = (STAGE_H - IMG_H * scale) / 2;

const JAR = {
  floorY: 510,
  floorWidth: 121,
  centerX: 230,
  segments: {
    rimTopY: 350, rimLeft: 153, rimRight: 304,
    bodyTopY: 362, bodyLeft: 159, bodyRight: 298,
    taperBottomY: 492, taperLeft: 163, taperRight: 294,
    floorLeft: 168, floorRight: 289,
  },
  feedZone: { minX: 276, maxX: 462, minY: 125, maxY: 368 },
  spoon: {
    rampCenterX: 370, rampCenterY: 273, rampLength: 218, rampWidth: 12, rampAngle: 2.36,
    guardCenterX: 450, guardCenterY: 203, guardLength: 92, guardWidth: 8, guardAngle: -1.15,
    tipX: 291, tipY: 360,
  },
  spawn: { centerX: 328, y: 158, halfWidth: 16, spread: 0.45 },
};

// ค่าจาก ultra-marking.png เดิม (อ้างอิง)
const OLD_MARKING = {
  rimTopY: 350, rimLeft: 153, rimRight: 304,
  floorY: 512,
  spoon: { rampCenterX: 370, rampCenterY: 270, tipX: 291, tipY: 347 },
};

function rgba(r, g, b, a = 255) {
  return { r, g, b, a };
}

const COLORS = {
  oldJar: rgba(80, 160, 255, 180),
  newJar: rgba(255, 48, 48, 255),
  wall: rgba(255, 140, 0, 255),
  spoon: rgba(48, 220, 80, 255),
  feed: rgba(0, 220, 255, 200),
  spawn: rgba(255, 230, 48, 255),
  tip: rgba(255, 0, 255, 255),
};

function blend(px, i, c) {
  const a = c.a / 255;
  px[i] = Math.round(px[i] * (1 - a) + c.r * a);
  px[i + 1] = Math.round(px[i + 1] * (1 - a) + c.g * a);
  px[i + 2] = Math.round(px[i + 2] * (1 - a) + c.b * a);
  px[i + 3] = 255;
}

function setPx(px, w, x, y, c, t = 2) {
  for (let dy = -t; dy <= t; dy++) {
    for (let dx = -t; dx <= t; dx++) {
      const xx = Math.round(x + dx);
      const yy = Math.round(y + dy);
      if (xx < 0 || yy < 0 || xx >= w || yy >= STAGE_H) continue;
      const i = (STAGE_W * yy + xx) * 4;
      blend(px, i, c);
    }
  }
}

function line(px, w, x0, y0, x1, y1, c, t = 1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const t0 = i / steps;
    setPx(px, w, x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0, c, t);
  }
}

function rect(px, w, left, top, right, bottom, c, t = 1) {
  line(px, w, left, top, right, top, c, t);
  line(px, w, right, top, right, bottom, c, t);
  line(px, w, right, bottom, left, bottom, c, t);
  line(px, w, left, bottom, left, top, c, t);
}

function rotRectCorners(cx, cy, len, thick, angle) {
  const hw = len / 2;
  const hh = thick / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const pts = [
    [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh],
  ];
  return pts.map(([lx, ly]) => ({
    x: cx + lx * cos - ly * sin,
    y: cy + lx * sin + ly * cos,
  }));
}

function rotRect(px, w, cx, cy, len, thick, angle, c, t = 1) {
  const corners = rotRectCorners(cx, cy, len, thick, angle);
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    line(px, w, a.x, a.y, b.x, b.y, c, t);
  }
}

function sampleUltraToStage(ultraPx, ultraW, ultraH) {
  const out = Buffer.alloc(STAGE_W * STAGE_H * 4, 0);
  for (let sy = 0; sy < STAGE_H; sy++) {
    for (let sx = 0; sx < STAGE_W; sx++) {
      const ix = (sx - offsetX) / scale;
      const iy = (sy - offsetY) / scale;
      if (ix < 0 || iy < 0 || ix >= ultraW - 1 || iy >= ultraH - 1) continue;
      const x0 = Math.floor(ix);
      const y0 = Math.floor(iy);
      const fx = ix - x0;
      const fy = iy - y0;
      const i = (STAGE_W * sy + sx) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = ultraPx[((ultraW * y0 + x0) * 4) + c];
        const p10 = ultraPx[((ultraW * y0 + x0 + 1) * 4) + c];
        const p01 = ultraPx[((ultraW * (y0 + 1) + x0) * 4) + c];
        const p11 = ultraPx[((ultraW * (y0 + 1) + x0 + 1) * 4) + c];
        out[i + c] = Math.round(
          p00 * (1 - fx) * (1 - fy)
          + p10 * fx * (1 - fy)
          + p01 * (1 - fx) * fy
          + p11 * fx * fy
        );
      }
      out[i + 3] = 255;
    }
  }
  return out;
}

function drawLegend(px, w) {
  const items = [
    [COLORS.oldJar, 'น้ำเงิน = marking เดิม (อ้างอิง)'],
    [COLORS.newJar, 'แดง = ขอบแก้ว config ปัจจุบัน'],
    [COLORS.wall, 'ส้ม = กำแพงชนจริง (+4px inset)'],
    [COLORS.spoon, 'เขียว = ช้อน (ramp+guard)'],
    [COLORS.feed, 'ฟ้า = feedZone (ไม่นับล้น)'],
    [COLORS.spawn, 'เหลือง = จุดเกิด spawn'],
    [COLORS.tip, 'ม่วง = ปลายช้อน tip'],
  ];
  items.forEach(([c, label], idx) => {
    const y = 10 + idx * 14;
    for (let x = 8; x < 20; x++) setPx(px, w, x, y, c, 3);
    // simple text via blocks skipped - legend in filename/readme
  });
}

function main() {
  const ultraPath = path.join(__dirname, '../public/images/ultra.png');
  const ultra = PNG.sync.read(fs.readFileSync(ultraPath));
  const px = sampleUltraToStage(ultra.data, ultra.width, ultra.height);
  const s = JAR.segments;
  const sp = JAR.spoon;
  const fz = JAR.feedZone;

  // marking เดิม (อ้างอิง)
  rect(px, STAGE_W, OLD_MARKING.rimLeft, OLD_MARKING.rimTopY, OLD_MARKING.rimRight, OLD_MARKING.floorY, COLORS.oldJar, 1);
  const oldRampEnd = { x: OLD_MARKING.spoon.tipX, y: OLD_MARKING.spoon.tipY };
  const oldRampStart = { x: 448, y: 191 };
  line(px, STAGE_W, oldRampStart.x, oldRampStart.y, oldRampEnd.x, oldRampEnd.y, COLORS.oldJar, 1);

  // config ปัจจุบัน — ขอบแก้ว
  rect(px, STAGE_W, s.rimLeft, s.rimTopY, s.rimRight, JAR.floorY, COLORS.newJar, 2);
  line(px, STAGE_W, s.bodyLeft, s.bodyTopY, s.bodyLeft, JAR.floorY, COLORS.newJar, 1);
  line(px, STAGE_W, s.bodyRight, s.bodyTopY, s.bodyRight, s.taperBottomY, COLORS.newJar, 1);
  line(px, STAGE_W, s.taperLeft, s.taperBottomY, s.floorLeft, JAR.floorY, COLORS.newJar, 1);
  line(px, STAGE_W, s.taperRight, s.taperBottomY, s.floorRight, JAR.floorY, COLORS.newJar, 1);
  line(px, STAGE_W, s.floorLeft, JAR.floorY, s.floorRight, JAR.floorY, COLORS.newJar, 2);

  // กำแพงชนจริง (buildUltraWalls)
  const bodyH = JAR.floorY - s.bodyTopY;
  const bodyCY = (s.bodyTopY + JAR.floorY) / 2;
  rect(px, STAGE_W, s.bodyLeft + 4 - 5, bodyCY - bodyH / 2, s.bodyLeft + 4 + 5, bodyCY + bodyH / 2, COLORS.wall, 1);
  rect(px, STAGE_W, s.bodyRight - 4 - 5, bodyCY - bodyH / 2, s.bodyRight - 4 + 5, bodyCY + bodyH / 2, COLORS.wall, 1);
  const taperH = JAR.floorY - s.taperBottomY + 10;
  const taperCY = (s.taperBottomY + JAR.floorY) / 2;
  rect(px, STAGE_W, s.taperLeft + 4 - 5, taperCY - taperH / 2, s.taperLeft + 4 + 5, taperCY + taperH / 2, COLORS.wall, 1);
  rect(px, STAGE_W, s.taperRight - 4 - 5, taperCY - taperH / 2, s.taperRight - 4 + 5, taperCY + taperH / 2, COLORS.wall, 1);
  rect(px, STAGE_W, JAR.centerX - JAR.floorWidth / 2, JAR.floorY - 7, JAR.centerX + JAR.floorWidth / 2, JAR.floorY + 7, COLORS.wall, 2);

  // ช้อน
  rotRect(px, STAGE_W, sp.rampCenterX, sp.rampCenterY, sp.rampLength, sp.rampWidth, sp.rampAngle, COLORS.spoon, 2);
  rotRect(px, STAGE_W, sp.guardCenterX, sp.guardCenterY, sp.guardLength, sp.guardWidth, sp.guardAngle, COLORS.spoon, 2);
  setPx(px, STAGE_W, sp.tipX, sp.tipY, COLORS.tip, 4);
  line(px, STAGE_W, sp.tipX, sp.tipY, s.rimRight - 10, s.rimTopY + 6, COLORS.spoon, 1);

  // feedZone + spawn
  rect(px, STAGE_W, fz.minX, fz.minY, Math.min(fz.maxX, STAGE_W - 1), fz.maxY, COLORS.feed, 1);
  const spawnHalf = JAR.spawn.halfWidth * JAR.spawn.spread;
  rect(px, STAGE_W, JAR.spawn.centerX - spawnHalf, JAR.spawn.y - 20, JAR.spawn.centerX + spawnHalf, JAR.spawn.y + 4, COLORS.spawn, 2);
  setPx(px, STAGE_W, JAR.spawn.centerX, JAR.spawn.y, COLORS.spawn, 4);

  const out = new PNG({ width: STAGE_W, height: STAGE_H });
  out.data = px;
  const outDir = path.join(__dirname, '../public/images');
  fs.writeFileSync(path.join(outDir, 'ultra-debug-current.png'), PNG.sync.write(out));

  // เวอร์ชันเทียบบน live2 (scale ขึ้นให้ดูง่าย)
  const live2Path = path.join(outDir, 'live2.png');
  if (fs.existsSync(live2Path)) {
    const live2 = PNG.sync.read(fs.readFileSync(live2Path));
    const scaleUp = 2;
    const comp = new PNG({ width: STAGE_W * scaleUp, height: STAGE_H * scaleUp });
    for (let y = 0; y < comp.height; y++) {
      for (let x = 0; x < comp.width; x++) {
        const sx = Math.min(STAGE_W - 1, Math.floor(x / scaleUp));
        const sy = Math.min(STAGE_H - 1, Math.floor(y / scaleUp));
        const si = (STAGE_W * sy + sx) * 4;
        const di = (comp.width * y + x) * 4;
        for (let c = 0; c < 4; c++) comp.data[di + c] = px[si + c];
      }
    }
    // inset live2 top-right corner for context
    const lw = live2.width;
    const lh = live2.height;
    const ox = comp.width - lw - 8;
    const oy = 8;
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        const si = (lw * y + x) * 4;
        const di = (comp.width * (oy + y) + (ox + x)) * 4;
        if (di < 0 || oy + y >= comp.height) continue;
        for (let c = 0; c < 3; c++) comp.data[di + c] = live2.data[si + c];
        comp.data[di + 3] = 255;
      }
    }
    fs.writeFileSync(path.join(outDir, 'ultra-debug-current-2x.png'), PNG.sync.write(comp));
  }

  console.log('Wrote public/images/ultra-debug-current.png (460x620)');
  if (fs.existsSync(live2Path)) console.log('Wrote public/images/ultra-debug-current-2x.png (920x1240)');
}

main();