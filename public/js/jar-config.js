const JAR_CONFIGS = {
  jar1: {
    label: 'โถแก้ว Mason (jar1)',
    image: '/images/jar1.png',
    physics: {
      centerX: 230,
      floorY: 528,
      innerLeft: 94,
      innerRight: 366,
      wallTopY: 210,
      mouthY: 88,
      mouthHalfWidth: 58,
      neckInset: 28,
      floorWidth: 286,
      wallHeight: 228,
      wallCenterY: 418
    },
    classic: {
      giftsBottom: 95,
      giftsLeft: 80,
      giftsWidth: '68%',
      giftsHeight: 255,
      liquidBottom: 88,
      liquidLeft: 85,
      liquidWidth: '65%',
      coinBottom: 45
    }
  },
  jar5: {
    label: 'โถแก้วกลม (jar5)',
    image: '/images/jar5.png',
    physics: {
      centerX: 230,
      floorY: 542,
      innerLeft: 112,
      innerRight: 348,
      wallTopY: 188,
      mouthY: 72,
      mouthHalfWidth: 70,
      neckInset: 14,
      floorWidth: 248,
      wallHeight: 200,
      wallCenterY: 430
    },
    classic: {
      giftsBottom: 82,
      giftsLeft: 98,
      giftsWidth: '58%',
      giftsHeight: 230,
      liquidBottom: 76,
      liquidLeft: 102,
      liquidWidth: '52%',
      coinBottom: 38
    }
  },
  jar6: {
    label: 'โถแก้วแมว (jar6)',
    image: '/images/jar6.png',
    physics: {
      centerX: 215,
      floorY: 526,
      innerLeft: 100,
      innerRight: 342,
      wallTopY: 206,
      mouthY: 84,
      mouthHalfWidth: 50,
      neckInset: 26,
      floorWidth: 256,
      wallHeight: 224,
      wallCenterY: 416
    },
    classic: {
      giftsBottom: 92,
      giftsLeft: 88,
      giftsWidth: '60%',
      giftsHeight: 250,
      liquidBottom: 86,
      liquidLeft: 92,
      liquidWidth: '56%',
      coinBottom: 44
    }
  }
};

const DEFAULT_JAR = 'jar1';

const NUMERIC_JAR_MAP = { 1: 'jar1', 5: 'jar5', 6: 'jar6' };

function getJarFromQuery() {
  const jar = new URLSearchParams(window.location.search).get('jar');
  if (jar && JAR_CONFIGS[jar]) return jar;
  const num = parseInt(jar, 10);
  if (Number.isFinite(num) && NUMERIC_JAR_MAP[num]) return NUMERIC_JAR_MAP[num];
  return DEFAULT_JAR;
}

function getJarConfig(jarId) {
  return JAR_CONFIGS[jarId] || JAR_CONFIGS[DEFAULT_JAR];
}

function applyJarImage(elementId) {
  const jarId = getJarFromQuery();
  const jarConfig = getJarConfig(jarId);
  const el = document.getElementById(elementId);
  if (el) {
    el.src = jarConfig.image;
  }
  return { jarId, jarConfig };
}