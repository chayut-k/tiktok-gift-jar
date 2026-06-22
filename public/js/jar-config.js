const STAGE_CENTER_X = 230;

// จูนจาก *-marking.png (960×1072) → stage 460×620, object-fit:contain
// jar1/jar6 = jar1and6-marking | jar4 = jar4-marking | jar5 = jar5-marking
const JAR_CONFIGS = {
  jar1: {
    label: 'โถแก้ว Mason (jar1)',
    image: '/images/jar1.png',
    physics: {
      centerX: STAGE_CENTER_X,
      floorY: 541,
      innerLeft: 113,
      innerRight: 358,
      wallTopY: 220,
      mouthY: 88,
      mouthHalfWidth: 53,
      neckInset: 19,
      floorWidth: 198,
      wallHeight: 242,
      wallCenterY: 421
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
      wallStyle: 'bulbous',
      centerX: STAGE_CENTER_X,
      floorY: 535,
      innerLeft: 100,
      innerRight: 371,
      upperInnerLeft: 62,
      upperInnerRight: 406,
      bulgeSplitY: 392,
      floorWidth: 199,
      wallTopY: 151,
      mouthY: 62,
      mouthHalfWidth: 78,
      lowerWallCenterY: 463,
      lowerWallHeight: 147,
      upperWallCenterY: 272,
      upperWallHeight: 241,
      neckInset: 0,
      wallHeight: 147,
      wallCenterY: 463,
      spill: {
        overflowDetectY: 115,
        topSpillY: 72,
        mouthSpillMargin: 4
      }
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
      floorY: 544,
      innerLeft: 86,
      innerRight: 382,
      wallTopY: 205,
      mouthY: 72,
      mouthHalfWidth: 52,
      neckInset: 46,
      floorWidth: 178,
      wallHeight: 272,
      wallCenterY: 409
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
      floorY: 541,
      innerLeft: 113,
      innerRight: 358,
      wallTopY: 220,
      mouthY: 84,
      mouthHalfWidth: 53,
      neckInset: 19,
      floorWidth: 198,
      wallHeight: 242,
      wallCenterY: 421
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