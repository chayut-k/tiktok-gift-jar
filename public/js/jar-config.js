const STAGE_CENTER_X = 230;

const JAR_CONFIGS = {
  jar1: {
    label: 'โถแก้ว Mason (jar1)',
    image: '/images/jar1.png',
    physics: {
      centerX: STAGE_CENTER_X,
      floorY: 528,
      innerLeft: 98,
      innerRight: 362,
      wallTopY: 218,
      mouthY: 88,
      mouthHalfWidth: 54,
      neckInset: 22,
      floorWidth: 278,
      wallHeight: 210,
      wallCenterY: 422
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
  jar4: {
    label: 'โถแก้วมังกรทอง (jar4)',
    image: '/images/jar4.png',
    physics: {
      centerX: STAGE_CENTER_X,
      floorY: 536,
      innerLeft: 86,
      innerRight: 374,
      wallTopY: 204,
      mouthY: 76,
      mouthHalfWidth: 64,
      neckInset: 10,
      floorWidth: 300,
      wallHeight: 216,
      wallCenterY: 426
    },
    classic: {
      giftsBottom: 90,
      giftsLeft: 76,
      giftsWidth: '70%',
      giftsHeight: 248,
      liquidBottom: 84,
      liquidLeft: 82,
      liquidWidth: '66%',
      coinBottom: 42
    }
  },
  jar5: {
    label: 'โถแก้วกลม (jar5)',
    image: '/images/jar5.png',
    physics: {
      centerX: STAGE_CENTER_X,
      floorY: 542,
      innerLeft: 114,
      innerRight: 346,
      wallTopY: 198,
      mouthY: 72,
      mouthHalfWidth: 66,
      neckInset: 12,
      floorWidth: 246,
      wallHeight: 188,
      wallCenterY: 432
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
      centerX: STAGE_CENTER_X,
      floorY: 526,
      innerLeft: 108,
      innerRight: 352,
      wallTopY: 214,
      mouthY: 84,
      mouthHalfWidth: 52,
      neckInset: 22,
      floorWidth: 268,
      wallHeight: 208,
      wallCenterY: 418
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

const NUMERIC_JAR_MAP = { 1: 'jar1', 4: 'jar4', 5: 'jar5', 6: 'jar6' };

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