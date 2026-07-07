require('dotenv').config();

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const {
  TikTokLiveConnection,
  WebcastEvent,
  UserOfflineError,
  SignatureMissingTokensError,
} = require('tiktok-live-connector');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const helmet = require('helmet');
const compression = require('compression');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const {
  normalizeTikTokUser,
  normalizeChatEvent,
  normalizeGiftEvent,
  normalizeLikeEvent,
} = require('./tiktok-event-normalize');

// ================== Config ==================
const isProd = process.env.NODE_ENV === 'production';
const isRailway = !!process.env.RAILWAY_ENVIRONMENT;
const PORT = parseInt(process.env.PORT || '3000', 10);

function normalizeUrl(url) {
  const cleaned = String(url || '').trim().replace(/\/$/, '');
  if (!cleaned) return '';
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  return `https://${cleaned}`;
}

function resolveAppUrl() {
  if (process.env.APP_URL) return normalizeUrl(process.env.APP_URL);
  if (process.env.RAILWAY_STATIC_URL) return normalizeUrl(process.env.RAILWAY_STATIC_URL);
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return normalizeUrl(process.env.RAILWAY_PUBLIC_DOMAIN);
  }
  return `http://localhost:${PORT}`;
}

const APP_URL = resolveAppUrl();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const SESSION_SECRET = process.env.SESSION_SECRET || (isProd ? null : 'dev-only-secret-change-me');

function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (fs.existsSync('/data')) return '/data';
  return path.join(__dirname, '.data');
}

const DATA_DIR = resolveDataDir();
const USERS_FILE = process.env.USERS_FILE || path.join(DATA_DIR, 'users.json');
const SESSION_DIR = process.env.SESSION_DIR || path.join(DATA_DIR, 'sessions');

function ensureDataDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

ensureDataDirs();

function buildAllowedOrigins() {
  const origins = (process.env.ALLOWED_ORIGINS || APP_URL)
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (!isProd) {
    origins.push(
      `http://localhost:${PORT}`,
      `http://127.0.0.1:${PORT}`,
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    );
  }

  return [...new Set(origins)];
}

const allowedOrigins = buildAllowedOrigins();

function requireEnv() {
  const missing = [];
  if (!GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!SESSION_SECRET) missing.push('SESSION_SECRET');
  if (missing.length) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('   Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
}
requireEnv();

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// ================== App Setup ==================
const app = express();
const httpServer = createServer(app);

app.set('trust proxy', isProd ? true : false);

const io = new Server(httpServer, {
  path: '/socket.io/',
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, true);
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingInterval: 25000,
  pingTimeout: 120000,
  connectTimeout: 45000,
  transports: ['polling', 'websocket'],
  allowUpgrades: true,
  perMessageDeflate: false,
});

// ================== Security Middleware ==================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com', 'https://apis.google.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      connectSrc: [
        "'self'",
        'https://accounts.google.com',
        'https://oauth2.googleapis.com',
        'https://www.googleapis.com',
        'wss:',
        'ws:',
      ],
      frameSrc: ["'self'", 'https://accounts.google.com'],
      fontSrc: ["'self'", 'https:', 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(compression());
app.disable('x-powered-by');

// ================== Rate Limiting ==================
const jsonError = (message) => ({ success: false, error: message });

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 200 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonError('คำขอมากเกินไป กรุณาลองใหม่ภายหลัง'),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 10 : 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonError('ลอง login บ่อยเกินไป กรุณารอสักครู่'),
});

const actionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 20 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonError('ดำเนินการบ่อยเกินไป กรุณารอสักครู่'),
});

function getConnectRateLimitKey(req) {
  const cleaned = String(req.session?.user?.email || '').trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return `connect:user:${cleaned}`;
  return `connect:ip:${ipKeyGenerator(req.ip || 'unknown')}`;
}

const connectLimitBase = {
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonError('เชื่อมต่อ TikTok บ่อยเกินไป กรุณารอสักครู่'),
  keyGenerator: getConnectRateLimitKey,
  validate: { trustProxy: isProd },
};

const connectBurstLimiter = rateLimit({
  ...connectLimitBase,
  windowMs: 5 * 60 * 1000,
  max: isProd ? 10 : 30,
});

const connectWindowLimiter = rateLimit({
  ...connectLimitBase,
  windowMs: 15 * 60 * 1000,
  max: isProd ? 15 : 30,
});

app.use('/api/', generalLimiter);
app.use('/google-login', authLimiter);

// ================== Session ==================
let sessionStore;
try {
  sessionStore = new FileStore({
    path: SESSION_DIR,
    ttl: 30 * 24 * 60 * 60,
    retries: 1,
    logFn: () => {},
  });
} catch (err) {
  console.error('❌ Session FileStore init failed:', err.message);
  if (isProd) process.exit(1);
}

const sessionMiddleware = session({
  store: sessionStore,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'tgj.sid',
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'lax' : 'lax',
  },
});

app.use(sessionMiddleware);
app.use(express.json({ limit: '16kb' }));
app.use(express.static('public', {
  maxAge: isProd ? '1d' : 0,
  etag: true,
  setHeaders(res, filePath) {
    if (/\.(html|js)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));

const wrapMiddleware = (middleware) => (socket, next) => {
  middleware(socket.request, {}, next);
};
io.use(wrapMiddleware(sessionMiddleware));

// ================== Per-User Stream State ==================
const userStreams = new Map();
const usernameOwners = new Map();
const DASHBOARD_GRACE_MS = 35000;
const DASHBOARD_HTTP_TTL_MS = 5 * 60 * 1000;
const CONNECT_INTENT_TTL_MS = 5 * 60 * 1000;
const TIKTOK_RECONNECT_DELAYS = [3000, 5000, 10000, 15000, 30000, 60000];
const TIKTOK_MAX_RECONNECT_ATTEMPTS = 12;
const WAIT_FOR_LIVE_POLL_MS = 35000;

function createStreamState(email) {
  return {
    email,
    connection: null,
    activeConnectionId: 0,
    connecting: null,
    tiktokUsername: '',
    totalDiamonds: 0,
    likers: new Map(),
    gifters: new Map(),
    dashboardSockets: new Set(),
    dashboardDisconnectTimer: null,
    dashboardHttpUntil: 0,
    connectIntentUntil: 0,
    reconnectTimer: null,
    reconnectAttempt: 0,
    waitingForLive: false,
    waitForLiveTimer: null,

  };
}

function getTikTokCredentials(email) {
  const saved = email ? users[email] || {} : {};
  return {
    sessionId: saved.sessionId || process.env.TIKTOK_SESSION_ID || null,
    ttTargetIdc: saved.ttTargetIdc || process.env.TIKTOK_TT_TARGET_IDC || null,
  };
}

function getTikTokConnectionOptions(email) {
  const { sessionId, ttTargetIdc } = getTikTokCredentials(email);
  const signApiKey = process.env.TIKTOK_SIGN_API_KEY || process.env.EULER_API_KEY;
  const options = {
    processInitialData: false,
    fetchRoomInfoOnConnect: false,
    enableExtendedGiftInfo: !!signApiKey,
  };

  if (sessionId) options.sessionId = sessionId;
  if (ttTargetIdc) options.ttTargetIdc = ttTargetIdc;
  if (signApiKey) options.signApiKey = signApiKey;

  return options;
}

async function probeIsLive(tiktokUsername, email = null) {
  const conn = new TikTokLiveConnection(tiktokUsername, getTikTokConnectionOptions(email));
  return conn.fetchIsLive();
}

function stopWaitForLive(stream) {
  if (!stream) return;
  if (stream.waitForLiveTimer) {
    clearTimeout(stream.waitForLiveTimer);
    stream.waitForLiveTimer = null;
  }
  stream.waitingForLive = false;
}

async function pollWaitForLive(email) {
  const stream = userStreams.get(email);
  if (!stream?.waitingForLive || !stream.tiktokUsername) return;
  if (!shouldKeepStreamAlive(stream)) {
    stopWaitForLive(stream);
    return;
  }

  try {
    const isLive = await probeIsLive(stream.tiktokUsername, email);
    if (!stream.waitingForLive) return;

    if (isLive) {
      console.log(`📡 [${email}] Live detected — connecting @${stream.tiktokUsername}`);
      stopWaitForLive(stream);
      await startTikTokConnectionForUser(email, stream.tiktokUsername);
      return;
    }
  } catch (err) {
    console.warn(`Wait-for-live poll [${email}]:`, err.message || err);
  }

  if (!stream.waitingForLive || !shouldKeepStreamAlive(stream)) return;

  stream.waitForLiveTimer = setTimeout(() => {
    stream.waitForLiveTimer = null;
    pollWaitForLive(email);
  }, WAIT_FOR_LIVE_POLL_MS);
}

function startWaitForLive(email) {
  const stream = userStreams.get(email);
  if (!stream?.tiktokUsername) return;
  if (!shouldKeepStreamAlive(stream)) return;

  stopWaitForLive(stream);
  clearReconnectTimer(stream);
  stopTikTokConnection(stream);

  stream.waitingForLive = true;
  stream.reconnectAttempt = 0;

  console.log(`⏳ [${email}] Waiting for @${stream.tiktokUsername} to go live`);
  emitStreamStatus(email, false, { reason: 'waiting_for_live' });
  pollWaitForLive(email);
}

function isErrorInstance(err, ErrorClass) {
  return typeof ErrorClass === 'function' && err instanceof ErrorClass;
}

function isUserNotLiveError(err) {
  if (!err) return false;
  if (isErrorInstance(err, UserOfflineError)) return true;
  const msg = String(err.message || err).toLowerCase();
  return /isn't online|not online|user.?offline|no live|isn't live|fetchislive/.test(msg);
}

function isTikTokSignConfigError(err) {
  if (!err) return false;
  if (isErrorInstance(err, SignatureMissingTokensError)) return true;
  const msg = String(err.message || err).toLowerCase();
  return /business plan|signaturemissing|sign a request|eulerstream/.test(msg);
}

function canReconnect(stream) {
  if (!stream?.tiktokUsername || stream.waitingForLive) return false;
  if (!shouldKeepStreamAlive(stream)) return false;
  if (stream.reconnectAttempt >= TIKTOK_MAX_RECONNECT_ATTEMPTS) return false;
  return true;
}

function stopReconnecting(email, reason, extra = {}) {
  const stream = userStreams.get(email);
  if (!stream) return;

  clearReconnectTimer(stream);
  stream.reconnectAttempt = 0;
  emitStreamStatus(email, false, { reason, ...extra });
  console.log(`⏹️ [${email}] Stop reconnect (${reason})`);

  if (reason === 'reconnect_exhausted' && stream.tiktokUsername && shouldKeepStreamAlive(stream)) {
    startWaitForLive(email);
  }
}

function endLiveSession(email, reason = 'stream_end', extra = {}) {
  const stream = userStreams.get(email);
  if (!stream) return;

  clearReconnectTimer(stream);
  stream.reconnectAttempt = 0;
  stopTikTokConnection(stream);
  emitStreamStatus(email, false, { reason, ...extra });
  console.log(`📴 [${email}] Live ended (${reason})`);

  if (stream.tiktokUsername && shouldKeepStreamAlive(stream)) {
    startWaitForLive(email);
  }
}

function touchDashboardHttpPresence(email) {
  if (!email) return;
  const stream = getOrCreateStream(email);
  clearDashboardGraceTimer(stream);
  stream.dashboardHttpUntil = Date.now() + DASHBOARD_HTTP_TTL_MS;
}

function touchConnectIntent(email) {
  if (!email) return;
  const stream = getOrCreateStream(email);
  stream.connectIntentUntil = Date.now() + CONNECT_INTENT_TTL_MS;
}

function isDashboardPresent(stream) {
  if (!stream) return false;
  if (stream.dashboardSockets.size > 0) return true;
  if (stream.dashboardDisconnectTimer) return true;
  if (stream.dashboardHttpUntil && Date.now() < stream.dashboardHttpUntil) return true;
  if (stream.connectIntentUntil && Date.now() < stream.connectIntentUntil) return true;
  return false;
}

function shouldKeepStreamAlive(stream) {
  return isDashboardPresent(stream);
}

function clearDashboardGraceTimer(stream) {
  if (!stream?.dashboardDisconnectTimer) return;
  clearTimeout(stream.dashboardDisconnectTimer);
  stream.dashboardDisconnectTimer = null;
}

function clearReconnectTimer(stream) {
  if (!stream?.reconnectTimer) return;
  clearTimeout(stream.reconnectTimer);
  stream.reconnectTimer = null;
}

function clearStreamTimers(stream) {
  clearDashboardGraceTimer(stream);
  clearReconnectTimer(stream);
  stopWaitForLive(stream);
}

function getOrCreateStream(email) {
  if (!userStreams.has(email)) {
    userStreams.set(email, createStreamState(email));
  }
  return userStreams.get(email);
}

function getStreamRoom(username) {
  return `stream:${username}`;
}

function getDashboardRoom(email) {
  return `dashboard:${email}`;
}

function findStreamByUsername(username) {
  const email = usernameOwners.get(username);
  return email ? userStreams.get(email) : null;
}

function emitToStream(username, event, data) {
  if (!username) return;
  io.to(getStreamRoom(username)).emit(event, data);
}

function emitStreamStatus(email, connected, extra = {}) {
  const stream = userStreams.get(email);
  if (!stream?.tiktokUsername) return;

  const payload = {
    connected: !!connected,
    username: stream.tiktokUsername,
    ...extra,
  };

  io.to(getDashboardRoom(email)).emit('status', payload);
  emitToStream(stream.tiktokUsername, 'status', payload);
}

function getAvatar(userOrData) {
  return normalizeTikTokUser(userOrData).avatar;
}

function computeTopLikers(stream, limit = 10) {
  return [...stream.likers.entries()]
    .sort((a, b) => b[1].likes - a[1].likes)
    .slice(0, limit)
    .map(([username, data], index) => ({
      rank: index + 1,
      username,
      nickname: data.nickname,
      likes: data.likes,
      avatar: data.avatar,
    }));
}

function computeTopGifters(stream, limit = 5) {
  return [...stream.gifters.entries()]
    .sort((a, b) => b[1].diamonds - a[1].diamonds)
    .slice(0, limit)
    .map(([username, data], index) => ({
      rank: index + 1,
      username,
      nickname: data.nickname,
      diamonds: data.diamonds,
      avatar: data.avatar,
    }));
}

function resetStreamCounters(stream) {
  stream.totalDiamonds = 0;
  stream.likers.clear();
  stream.gifters.clear();
}

function clearUsernameOwner(username, email) {
  if (username && usernameOwners.get(username) === email) {
    usernameOwners.delete(username);
  }
}

function stopTikTokConnection(stream) {
  if (!stream?.connection) return;
  stream.activeConnectionId += 1;
  const conn = stream.connection;
  stream.connection = null;
  try {
    conn.removeAllListeners();
    conn.disconnect();
  } catch (e) {}
}

function disconnectUserStream(email, reason = 'manual') {
  const stream = userStreams.get(email);
  if (!stream) return;

  clearStreamTimers(stream);
  stream.reconnectAttempt = 0;
  stopTikTokConnection(stream);

  clearUsernameOwner(stream.tiktokUsername, email);
  stream.tiktokUsername = '';

  if (reason === 'manual') {
    if (!users[email]) users[email] = {};
    users[email].connectionPaused = true;
    saveUsers();
  }

  emitStreamStatus(email, false, reason ? { reason } : {});
  console.log(`🔌 ตัดการเชื่อมต่อของ ${email} (${reason})`);
}

function scheduleDashboardGraceDisconnect(email) {
  const stream = userStreams.get(email);
  if (!stream) return;

  clearDashboardGraceTimer(stream);
  console.log(`⏳ Dashboard grace period: ${email} (${DASHBOARD_GRACE_MS / 1000}s)`);

  stream.dashboardDisconnectTimer = setTimeout(() => {
    stream.dashboardDisconnectTimer = null;
    const current = userStreams.get(email);
    if (current && current.dashboardSockets.size === 0) {
      disconnectUserStream(email, 'dashboard_closed');
    }
  }, DASHBOARD_GRACE_MS);
}

function scheduleTikTokReconnect(email) {
  const stream = userStreams.get(email);
  if (!stream) return;

  if (!canReconnect(stream)) {
    if (stream.waitingForLive) return;
    if (stream.reconnectAttempt >= TIKTOK_MAX_RECONNECT_ATTEMPTS) {
      stopReconnecting(email, 'reconnect_exhausted', { attempt: stream.reconnectAttempt });
    }
    return;
  }

  clearReconnectTimer(stream);

  const delay = TIKTOK_RECONNECT_DELAYS[
    Math.min(stream.reconnectAttempt, TIKTOK_RECONNECT_DELAYS.length - 1)
  ];
  stream.reconnectAttempt += 1;

  console.log(`🔄 [${email}] TikTok reconnect in ${delay}ms (attempt ${stream.reconnectAttempt})`);
  emitStreamStatus(email, false, {
    reason: 'reconnecting',
    attempt: stream.reconnectAttempt,
  });

  stream.reconnectTimer = setTimeout(async () => {
    stream.reconnectTimer = null;
    const current = userStreams.get(email);
    if (!canReconnect(current)) {
      if (current?.reconnectAttempt >= TIKTOK_MAX_RECONNECT_ATTEMPTS && !current.waitingForLive) {
        stopReconnecting(email, 'reconnect_exhausted', { attempt: current.reconnectAttempt });
      }
      return;
    }

    try {
      await reconnectTikTokConnectionForUser(email);
    } catch (err) {
      console.error(`Reconnect failed [${email}]:`, err.message || err);
      if (isUserNotLiveError(err)) {
        endLiveSession(email, 'stream_end', { offline: true });
        return;
      }
      const latest = userStreams.get(email);
      if (canReconnect(latest)) {
        scheduleTikTokReconnect(email);
      } else if (latest?.reconnectAttempt >= TIKTOK_MAX_RECONNECT_ATTEMPTS) {
        stopReconnecting(email, 'reconnect_exhausted', { attempt: latest.reconnectAttempt });
      }
    }
  }, delay);
}

function syncOverlaySocket(socket, username) {
  const stream = findStreamByUsername(username);
  if (!stream) {
    socket.emit('status', { connected: false, username });
    return;
  }

  const statusPayload = {
    connected: !!stream.connection,
    username: stream.tiktokUsername,
  };
  if (stream.waitingForLive) statusPayload.reason = 'waiting_for_live';
  socket.emit('status', statusPayload);

  if (stream.totalDiamonds > 0) {
    socket.emit('gift', {
      user: '',
      total: stream.totalDiamonds,
      giftName: '',
      giftPictureUrl: '',
      diamonds: 0,
      repeatCount: 0,
    });
  }

  const top = computeTopLikers(stream);
  if (top.length > 0) socket.emit('topLikers', top);

  const topGifters = computeTopGifters(stream);
  if (topGifters.length > 0) socket.emit('topGifters', topGifters);
}

function registerDashboardSocket(socket, email) {
  const stream = getOrCreateStream(email);
  clearDashboardGraceTimer(stream);
  stream.dashboardSockets.add(socket.id);
  socket.data.email = email;
  socket.data.isDashboard = true;
  socket.join(getDashboardRoom(email));

  if (stream.tiktokUsername) {
    const statusPayload = {
      connected: !!stream.connection,
      username: stream.tiktokUsername,
    };
    if (stream.waitingForLive) statusPayload.reason = 'waiting_for_live';
    else if (stream.reconnectTimer) {
      statusPayload.reason = 'reconnecting';
      statusPayload.attempt = stream.reconnectAttempt;
    }
    socket.emit('status', statusPayload);
  }

  if (stream.waitingForLive && !stream.waitForLiveTimer && !stream.connection) {
    pollWaitForLive(email);
  }

  console.log(`🖥️ Dashboard online: ${email} (${stream.dashboardSockets.size} tab)`);
}

function unregisterDashboardSocket(email, socketId) {
  const stream = userStreams.get(email);
  if (!stream) return;

  stream.dashboardSockets.delete(socketId);
  console.log(`🖥️ Dashboard offline: ${email} (${stream.dashboardSockets.size} tab left)`);

  if (stream.dashboardSockets.size === 0 && (
    stream.connection || stream.reconnectTimer || stream.waitingForLive
  )) {
    scheduleDashboardGraceDisconnect(email);
  }
}

function registerOverlaySocket(socket, username) {
  socket.data.streamUser = username;
  socket.data.isOverlay = true;
  socket.join(getStreamRoom(username));
  console.log(`📺 Overlay joined stream:${username} (${socket.id})`);
  syncOverlaySocket(socket, username);
}

function attachTikTokListeners(conn, email, connectionId) {
  const isActive = () => {
    const stream = userStreams.get(email);
    return stream?.connection === conn && stream.activeConnectionId === connectionId;
  };

  conn.on(WebcastEvent.GIFT, (data) => {
    if (!isActive()) return;
    try {
      const stream = getOrCreateStream(email);
      const gift = normalizeGiftEvent(data);
      if (gift.diamonds <= 0) return;

      const userLabel = gift.user.nickname || gift.user.uniqueId || 'คนดู';
      const {
        diamonds, giftType, repeatEnd, giftPictureUrl, giftName,
      } = gift;

      // giftType 1 = streak (Rose ฯลฯ) แสดงทีละชิ้นระหว่าง combo | จบ combo อัปเดตยอดอย่างเดียว ไม่สร้างของซ้ำ
      if (giftType === 1 && !repeatEnd) {
        emitToStream(stream.tiktokUsername, 'gift', {
          user: userLabel,
          giftName,
          diamonds,
          repeatCount: 1,
          total: stream.totalDiamonds,
          giftPictureUrl,
        });
        return;
      }

      if (giftType === 1 && repeatEnd) {
        const repeatCount = gift.repeatCount;
        const giftValue = diamonds * repeatCount;
        stream.totalDiamonds += giftValue;

        const uid = gift.user.uniqueId;
        if (uid) {
          const existing = stream.gifters.get(uid) || {
            nickname: gift.user.nickname || uid,
            diamonds: 0,
            avatar: gift.user.avatar,
          };
          existing.diamonds += giftValue;
          stream.gifters.set(uid, existing);
          emitToStream(stream.tiktokUsername, 'topGifters', computeTopGifters(stream));
        }

        emitToStream(stream.tiktokUsername, 'gift', {
          user: userLabel,
          giftName,
          diamonds,
          repeatCount: 0,
          total: stream.totalDiamonds,
          giftPictureUrl,
        });
        return;
      }

      const repeatCount = gift.repeatCount;
      const giftValue = diamonds * repeatCount;
      stream.totalDiamonds += giftValue;

      const uid = gift.user.uniqueId;
      if (uid) {
        const existing = stream.gifters.get(uid) || {
          nickname: gift.user.nickname || uid,
          diamonds: 0,
          avatar: gift.user.avatar,
        };
        existing.diamonds += giftValue;
        stream.gifters.set(uid, existing);
        emitToStream(stream.tiktokUsername, 'topGifters', computeTopGifters(stream));
      }

      emitToStream(stream.tiktokUsername, 'gift', {
        user: userLabel,
        giftName,
        diamonds,
        repeatCount,
        total: stream.totalDiamonds,
        giftPictureUrl,
      });
    } catch (err) {
      console.error('GIFT handler error:', err);
    }
  });

  conn.on(WebcastEvent.CHAT, (data) => {
    if (!isActive()) return;
    const stream = getOrCreateStream(email);
    const chat = normalizeChatEvent(data);
    if (!chat.comment) return;
    emitToStream(stream.tiktokUsername, 'chat', chat);
  });

  conn.on(WebcastEvent.EMOTE, (data) => {
    if (!isActive()) return;
    const stream = getOrCreateStream(email);
    const user = normalizeTikTokUser(data);
    emitToStream(stream.tiktokUsername, 'chat', {
      nickname: user.nickname,
      comment: '[สติกเกอร์]',
      avatar: user.avatar,
    });
  });

  conn.on(WebcastEvent.LIKE, (data) => {
    if (!isActive()) return;
    try {
      const stream = getOrCreateStream(email);
      const like = normalizeLikeEvent(data);
      const uid = like.user.uniqueId;
      if (uid) {
        const existing = stream.likers.get(uid) || {
          nickname: like.user.nickname || uid,
          likes: 0,
          avatar: like.user.avatar,
        };
        existing.likes += like.likeCount;
        stream.likers.set(uid, existing);
        emitToStream(stream.tiktokUsername, 'topLikers', computeTopLikers(stream));
      }

      emitToStream(stream.tiktokUsername, 'like', { avatar: like.user.avatar });
    } catch (err) {
      console.error('LIKE handler error:', err);
    }
  });

  conn.on('connected', (state) => {
    if (!isActive()) return;
    console.log(`🔗 [${email}] Connected to room:`, state?.roomId);
    emitStreamStatus(email, true);
  });

  conn.on('disconnected', () => {
    if (!isActive()) return;
    const stream = userStreams.get(email);
    if (!stream) return;
    console.log(`🔌 [${email}] TikTok disconnected`);
    stream.connection = null;
    if (stream.waitingForLive) return;
    emitStreamStatus(email, false, { reason: 'disconnected' });
    scheduleTikTokReconnect(email);
  });

  conn.on('streamEnd', () => {
    if (!isActive()) return;
    endLiveSession(email, 'stream_end');
  });

  conn.on('error', (err) => {
    if (!isActive()) return;
    const stream = userStreams.get(email);
    if (!stream) return;
    console.error(`TikTok error [${email}]:`, err.message || err);
    stopTikTokConnection(stream);
    if (stream.waitingForLive) return;
    if (isUserNotLiveError(err)) {
      endLiveSession(email, 'stream_end', { offline: true });
      return;
    }
    if (isTikTokSignConfigError(err)) {
      emitStreamStatus(email, false, { reason: 'error', error: mapTikTokError(err) });
      return;
    }
    emitStreamStatus(email, false, { reason: 'error', error: 'Connection error' });
    scheduleTikTokReconnect(email);
  });
}

function prepareStreamUsername(email, tiktokUsername) {
  const stream = getOrCreateStream(email);
  const previousOwner = usernameOwners.get(tiktokUsername);
  if (previousOwner && previousOwner !== email) {
    const ownerStream = userStreams.get(previousOwner);
    if (ownerStream) {
      stopTikTokConnection(ownerStream);
      stopWaitForLive(ownerStream);
      clearUsernameOwner(tiktokUsername, previousOwner);
    }
  }

  if (stream.tiktokUsername && stream.tiktokUsername !== tiktokUsername) {
    clearUsernameOwner(stream.tiktokUsername, email);
  }

  stream.tiktokUsername = tiktokUsername;
  usernameOwners.set(tiktokUsername, email);
  return stream;
}

async function connectOrWaitForLive(email, tiktokUsername) {
  if (!tiktokUsername) throw new Error('TikTok Username หายไป');

  touchDashboardHttpPresence(email);
  touchConnectIntent(email);

  if (!users[email]) users[email] = {};
  users[email].connectionPaused = false;
  saveUsers();

  const stream = prepareStreamUsername(email, tiktokUsername);
  stopWaitForLive(stream);
  clearReconnectTimer(stream);

  if (!shouldKeepStreamAlive(stream)) {
    throw new Error('กรุณาเปิด Dashboard ค้างไว้เพื่อรอไลฟ์');
  }

  let isLive = false;
  try {
    isLive = await probeIsLive(tiktokUsername, email);
  } catch (err) {
    console.warn(`Live probe failed [${email}]:`, err.message || err);
  }

  if (!isLive) {
    startWaitForLive(email);
    return { mode: 'waiting' };
  }

  await startTikTokConnectionForUser(email, tiktokUsername);
  return { mode: 'connected' };
}

async function reconnectTikTokConnectionForUser(email) {
  const stream = userStreams.get(email);
  if (!stream?.tiktokUsername) throw new Error('TikTok Username หายไป');
  if (stream.waitingForLive) return;

  if (stream.connecting) {
    await stream.connecting;
  }

  const tiktokUsername = stream.tiktokUsername;

  const connectTask = (async () => {
    stopWaitForLive(stream);
    stopTikTokConnection(stream);

    const connectionId = stream.activeConnectionId;
    const conn = new TikTokLiveConnection(tiktokUsername, getTikTokConnectionOptions(email));
    stream.connection = conn;
    attachTikTokListeners(conn, email, connectionId);

    await conn.connect();
    if (stream.connection !== conn || stream.activeConnectionId !== connectionId) return;

    stream.reconnectAttempt = 0;
    console.log(`✅ [${email}] TikTok reconnected: ${tiktokUsername}`);
    emitStreamStatus(email, true, { reason: 'reconnected' });
  })();

  stream.connecting = connectTask;
  try {
    await connectTask;
  } finally {
    if (stream.connecting === connectTask) {
      stream.connecting = null;
    }
  }
}

async function startTikTokConnectionForUser(email, tiktokUsername) {
  if (!tiktokUsername) throw new Error('TikTok Username หายไป');

  const stream = getOrCreateStream(email);

  if (stream.connecting) {
    await stream.connecting;
  }

  const connectTask = (async () => {
    prepareStreamUsername(email, tiktokUsername);
    stopWaitForLive(stream);
    stopTikTokConnection(stream);

    resetStreamCounters(stream);
    stream.reconnectAttempt = 0;

    const connectionId = stream.activeConnectionId;
    const conn = new TikTokLiveConnection(tiktokUsername, getTikTokConnectionOptions(email));
    stream.connection = conn;
    attachTikTokListeners(conn, email, connectionId);

    try {
      await conn.connect();
      if (stream.connection !== conn || stream.activeConnectionId !== connectionId) return;
      stream.reconnectAttempt = 0;
      console.log(`✅ [${email}] เชื่อมต่อ TikTok สำเร็จ: ${tiktokUsername}`);
      emitStreamStatus(email, true);
    } catch (err) {
      if (stream.connection === conn) {
        stream.connection = null;
      }
      if (isUserNotLiveError(err) && shouldKeepStreamAlive(stream)) {
        startWaitForLive(email);
        return;
      }
      clearUsernameOwner(tiktokUsername, email);
      stream.tiktokUsername = '';
      throw err;
    }
  })();

  stream.connecting = connectTask;
  try {
    await connectTask;
  } finally {
    if (stream.connecting === connectTask) {
      stream.connecting = null;
    }
  }
}

app.get('/logout', (req, res) => {
  const email = getSessionEmail(req);
  if (email) disconnectUserStream(email, 'logout');

  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send('Logout failed');
    }
    res.clearCookie('tgj.sid');
    res.redirect('/');
  });
});

// ================== User Data ==================
let users = {};
if (fs.existsSync(USERS_FILE)) {
  try {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (err) {
    console.error('Failed to read users file:', err.message);
    users = {};
  }
}

function saveUsers() {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${USERS_FILE}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2));
  fs.renameSync(tmp, USERS_FILE);
}

// ================== Helpers ==================
function sanitizeTikTokUsername(username) {
  const cleaned = String(username || '').trim().replace(/^@/, '');
  if (!/^[a-zA-Z0-9._]{1,50}$/.test(cleaned)) return null;
  return cleaned;
}

function sanitizeEmail(email) {
  const cleaned = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return null;
  return cleaned;
}

function getSessionEmail(req) {
  return sanitizeEmail(req.session?.user?.email);
}

function mapTikTokError(err) {
  const msg = err?.message || '';
  if (msg.includes('Dashboard') || msg.includes('dashboard')) {
    return msg;
  }
  if (isTikTokSignConfigError(err)) {
    return 'TikTok sign server ต้องการ API key — ใส่ TIKTOK_SIGN_API_KEY ใน Railway หรือ sessionid + tt-target-idc ใน Dashboard';
  }
  if (msg.includes('user_not_found')) {
    return 'ไม่พบผู้ใช้ TikTok นี้ หรือยังไม่ได้เปิดไลฟ์';
  }
  if (msg.includes('blocked') || msg.includes('SIGI') || msg.includes('Room ID')) {
    return 'TikTok บล็อกการเชื่อมต่อชั่วคราว — ลองใส่ sessionid + tt-target-idc ใน Dashboard หรือทดสอบ physics ด้วย ?preview=1';
  }
  return 'เชื่อมต่อไม่สำเร็จ';
}

// ================== Public API ==================
app.get('/health', (req, res) => {
  let activeConnections = 0;
  userStreams.forEach((stream) => {
    if (stream.connection) activeConnections += 1;
  });

  res.json({
    status: 'ok',
    uptime: process.uptime(),
    activeUsers: userStreams.size,
    activeConnections,
    sessionStore: sessionStore ? 'file' : 'memory',
    nodeEnv: process.env.NODE_ENV || 'development',
    version: require('./package.json').version,
  });
});

app.get('/api/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

async function buildGoogleUserResponse(payload) {
  const email = payload.email;
  const userData = {
    success: true,
    loggedIn: true,
    name: payload.name || payload.email,
    email,
    picture: payload.picture || null,
  };

  if (users[email]) {
    if (users[email].tiktokUsername) userData.tiktokUsername = users[email].tiktokUsername;
    if (users[email].sessionId) userData.sessionId = users[email].sessionId;
    if (users[email].ttTargetIdc) userData.ttTargetIdc = users[email].ttTargetIdc;
    if (users[email].selectedJar) userData.selectedJar = users[email].selectedJar;
  }

  const stream = userStreams.get(email);
  if (stream?.tiktokUsername) {
    userData.connected = !!stream.connection;
    userData.tiktokUsername = stream.tiktokUsername;
  }

  return userData;
}

function saveSessionUser(req, userData) {
  req.session.user = {
    email: userData.email,
    name: userData.name,
    picture: userData.picture,
  };
}

app.get('/api/me', async (req, res) => {
  if (!req.session?.user?.email) {
    return res.json({ success: false, loggedIn: false });
  }

  try {
    const userData = await buildGoogleUserResponse({
      email: req.session.user.email,
      name: req.session.user.name,
      picture: req.session.user.picture,
    });
    res.json(userData);
  } catch (err) {
    console.error('/api/me error:', err.message);
    res.status(500).json({ success: false, loggedIn: false });
  }
});

app.post('/api/logout', (req, res) => {
  const email = getSessionEmail(req);
  if (email) disconnectUserStream(email, 'logout');

  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Logout failed' });
    }
    res.clearCookie('tgj.sid');
    res.json({ success: true });
  });
});

app.post('/google-login', async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) {
    return res.status(400).json({ success: false, error: 'ไม่มีข้อมูล login' });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) {
      return res.status(401).json({ success: false, error: 'Google login ไม่ถูกต้อง' });
    }

    const userData = await buildGoogleUserResponse(payload);
    saveSessionUser(req, userData);
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('Session save failed:', saveErr.message);
        return res.status(500).json({ success: false, error: 'บันทึก session ไม่สำเร็จ' });
      }
      res.json(userData);
    });
  } catch (err) {
    console.error('Google token verify failed:', err.message);
    res.status(401).json({ success: false, error: 'Google login ไม่ถูกต้อง' });
  }
});

function saveTikTokUserCredentials(email, body) {
  if (!users[email]) users[email] = {};
  if (body?.sessionId) {
    users[email].sessionId = String(body.sessionId).trim().slice(0, 200);
  }
  if (body?.ttTargetIdc) {
    users[email].ttTargetIdc = String(body.ttTargetIdc).trim().slice(0, 64);
  }
  saveUsers();
}

// ================== Protected Actions ==================
app.post('/connect-tiktok', connectBurstLimiter, connectWindowLimiter, async (req, res) => {
  try {
    const email = getSessionEmail(req);
    const tiktokUsername = sanitizeTikTokUsername(req.body?.tiktokUsername);

    if (!email) return res.status(401).json({ error: 'กรุณา Login ก่อน' });
    if (!tiktokUsername) return res.status(400).json({ error: 'TikTok Username ไม่ถูกต้อง' });

    touchDashboardHttpPresence(email);

    if (!users[email]) users[email] = {};
    users[email].tiktokUsername = tiktokUsername;
    saveTikTokUserCredentials(email, req.body);

    const result = await connectOrWaitForLive(email, tiktokUsername);
    res.json({
      success: true,
      username: tiktokUsername,
      waiting: result.mode === 'waiting',
      connected: result.mode === 'connected',
    });
  } catch (err) {
    console.error('Connect error:', err);
    res.status(500).json({ error: mapTikTokError(err) });
  }
});

app.post('/save-tiktok', connectBurstLimiter, connectWindowLimiter, async (req, res) => {
  try {
    const email = getSessionEmail(req);
    const tiktokUsername = sanitizeTikTokUsername(req.body?.tiktokUsername);

    if (!email) return res.status(401).json({ error: 'กรุณา Login ก่อน' });
    if (!tiktokUsername) return res.status(400).json({ error: 'TikTok Username ไม่ถูกต้อง' });

    touchDashboardHttpPresence(email);

    if (!users[email]) users[email] = {};
    users[email].tiktokUsername = tiktokUsername;
    saveTikTokUserCredentials(email, req.body);

    const result = await connectOrWaitForLive(email, tiktokUsername);
    res.json({
      success: true,
      username: tiktokUsername,
      waiting: result.mode === 'waiting',
      connected: result.mode === 'connected',
    });
  } catch (err) {
    console.error('/save-tiktok error:', err);
    res.status(500).json({ error: mapTikTokError(err) });
  }
});

app.post('/reset-jar', actionLimiter, (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ success: false, error: 'กรุณา Login ก่อน' });

  const stream = userStreams.get(email);
  if (!stream) return res.json({ success: true, total: 0 });

  resetStreamCounters(stream);
  emitToStream(stream.tiktokUsername, 'gift', {
    total: 0, user: '', giftName: '', giftPictureUrl: '', diamonds: 0, repeatCount: 0,
  });
  emitToStream(stream.tiktokUsername, 'topGifters', []);
  emitToStream(stream.tiktokUsername, 'topLikers', []);
  res.json({ success: true, total: 0 });
});

app.post('/disconnect-tiktok', actionLimiter, (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ success: false, error: 'กรุณา Login ก่อน' });

  disconnectUserStream(email, 'manual');
  res.json({ success: true });
});

app.get('/api/status', (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'กรุณา Login ก่อน' });

  touchDashboardHttpPresence(email);

  const stream = userStreams.get(email);
  const savedUsername = users[email]?.tiktokUsername || null;
  const connectionPaused = !!users[email]?.connectionPaused;

  if (!stream) {
    return res.json({
      connected: false,
      username: savedUsername,
      totalDiamonds: 0,
      dashboardRequired: true,
      connectionPaused,
      reconnecting: false,
    });
  }

  res.json({
    connected: !!stream.connection,
    waitingForLive: !!stream.waitingForLive,
    username: stream.tiktokUsername || savedUsername,
    totalDiamonds: stream.totalDiamonds,
    dashboardActive: isDashboardPresent(stream),
    dashboardRequired: true,
    connectionPaused,
    reconnecting: !!(
      stream.reconnectTimer
      || stream.connecting
    ),
  });
});

// ================== Error Handler ==================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: isProd ? 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' : err.message,
  });
});

// ================== Socket.IO ==================
io.on('connection', (socket) => {
  const sessionEmail = sanitizeEmail(socket.request.session?.user?.email);
  const overlayUser = sanitizeTikTokUsername(socket.handshake.query?.user);

  if (overlayUser) {
    registerOverlaySocket(socket, overlayUser);
  } else if (sessionEmail) {
    registerDashboardSocket(socket, sessionEmail);
  } else {
    console.log(`⚠️ Socket ${socket.id} rejected (no session / no user param)`);
    socket.disconnect(false);
    return;
  }

  socket.on('disconnect', () => {
    if (socket.data.isDashboard && socket.data.email) {
      unregisterDashboardSocket(socket.data.email, socket.id);
    }
  });
});

// ================== Start & Graceful Shutdown ==================
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running (${isProd ? 'production' : 'development'}${isRailway ? ' / Railway' : ''})`);
  console.log(`   URL: ${APP_URL}`);
  console.log(`   Health: ${APP_URL}/health`);
  console.log(`   Data dir: ${DATA_DIR}`);
  console.log(`   Users file: ${USERS_FILE}`);
  console.log(`   Sessions: ${SESSION_DIR} (${sessionStore ? 'FileStore' : 'MemoryStore'})`);
  console.log('   Mode: multi-user (per-stream rooms)');
});

function shutdown(signal) {
  console.log(`\n${signal} received — shutting down...`);
  userStreams.forEach((stream) => {
    stopTikTokConnection(stream);
  });
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));