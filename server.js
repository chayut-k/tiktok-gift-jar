require('dotenv').config();

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { TikTokLiveConnection, WebcastEvent } = require('tiktok-live-connector');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

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
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || (isProd ? null : 'dev-only-secret-change-me');

const defaultUsersFile = fs.existsSync('/data')
  ? '/data/users.json'
  : path.join(__dirname, 'users.json');
const USERS_FILE = process.env.USERS_FILE || defaultUsersFile;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || APP_URL)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function requireEnv() {
  const missing = [];
  if (!GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  if (!SESSION_SECRET) missing.push('SESSION_SECRET');
  if (missing.length) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('   Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
}
requireEnv();

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);

// ================== App Setup ==================
const app = express();
const httpServer = createServer(app);

app.set('trust proxy', isProd ? 1 : false);

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingInterval: 15000,
  pingTimeout: 10000,
});

// ================== Security Middleware ==================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com', 'https://apis.google.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      connectSrc: ["'self'", 'https://accounts.google.com', 'https://oauth2.googleapis.com', 'https://www.googleapis.com', 'wss:', 'ws:'],
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

const connectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 5 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonError('เชื่อมต่อ TikTok บ่อยเกินไป กรุณารอสักครู่'),
});

app.use('/api/', generalLimiter);
app.use('/google-login', authLimiter);
app.use('/auth/', authLimiter);

// ================== Session ==================
const sessionMiddleware = session({
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
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json({ limit: '16kb' }));
app.use(express.static('public', {
  maxAge: isProd ? '1d' : 0,
  etag: true,
}));

const wrapMiddleware = (middleware) => (socket, next) => {
  middleware(socket.request, {}, next);
};
io.use(wrapMiddleware(sessionMiddleware));

// ================== Per-User Stream State ==================
const userStreams = new Map();
const usernameOwners = new Map();
const DASHBOARD_GRACE_MS = 45000;
const TIKTOK_RECONNECT_DELAYS = [3000, 5000, 10000, 15000, 30000, 60000];

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
    reconnectTimer: null,
    reconnectAttempt: 0,
  };
}

function shouldKeepStreamAlive(stream) {
  return stream.dashboardSockets.size > 0 || !!stream.dashboardDisconnectTimer;
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

function getAvatar(user) {
  if (!user) return '';
  const pic = user.profilePicture || user.profilePictureMedium || user.profilePictureLarge;
  if (pic) {
    if (Array.isArray(pic.urlList) && pic.urlList.length > 0) return pic.urlList[0];
    if (Array.isArray(pic.url) && pic.url.length > 0) return pic.url[0];
  }
  return '';
}

function computeTopLikers(stream, limit = 5) {
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
  if (!stream?.tiktokUsername || !shouldKeepStreamAlive(stream)) return;

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
    if (!current?.tiktokUsername || !shouldKeepStreamAlive(current)) return;

    try {
      await reconnectTikTokConnectionForUser(email);
    } catch (err) {
      console.error(`Reconnect failed [${email}]:`, err.message || err);
      if (shouldKeepStreamAlive(current)) {
        scheduleTikTokReconnect(email);
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

  socket.emit('status', {
    connected: !!stream.connection,
    username: stream.tiktokUsername,
  });

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
    socket.emit('status', {
      connected: !!stream.connection,
      username: stream.tiktokUsername,
    });
  }

  console.log(`🖥️ Dashboard online: ${email} (${stream.dashboardSockets.size} tab)`);
}

function unregisterDashboardSocket(email, socketId) {
  const stream = userStreams.get(email);
  if (!stream) return;

  stream.dashboardSockets.delete(socketId);
  console.log(`🖥️ Dashboard offline: ${email} (${stream.dashboardSockets.size} tab left)`);

  if (stream.dashboardSockets.size === 0 && (stream.connection || stream.reconnectTimer)) {
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
      const diamonds = data.diamondCount
        || (data.extendedGiftInfo && data.extendedGiftInfo.diamond_count)
        || (data.giftDetails && data.giftDetails.diamondCount)
        || 0;
      if (diamonds <= 0) return;

      const repeatEnd = data.repeatEnd === true || data.repeatEnd === 1;
      if (!repeatEnd) return;

      const repeatCount = data.repeatCount || 1;
      const giftValue = diamonds * repeatCount;
      stream.totalDiamonds += giftValue;

      const uid = data.user?.uniqueId || data.uniqueId;
      if (uid) {
        const existing = stream.gifters.get(uid) || {
          nickname: data.user?.nickname || uid,
          diamonds: 0,
          avatar: getAvatar(data.user),
        };
        existing.diamonds += giftValue;
        stream.gifters.set(uid, existing);
        emitToStream(stream.tiktokUsername, 'topGifters', computeTopGifters(stream));
      }

      const giftPictureUrl = data.giftPictureUrl
        || (data.extendedGiftInfo && data.extendedGiftInfo.image && data.extendedGiftInfo.image.url_list && data.extendedGiftInfo.image.url_list[0])
        || (data.giftDetails && data.giftDetails.icon && data.giftDetails.icon.urlList && data.giftDetails.icon.urlList[0])
        || null;

      emitToStream(stream.tiktokUsername, 'gift', {
        user: data.user?.nickname || data.user?.uniqueId || 'คนดู',
        giftName: data.giftName || (data.giftDetails && data.giftDetails.giftName) || 'Unknown',
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
    emitToStream(stream.tiktokUsername, 'chat', {
      nickname: data.user?.nickname || data.uniqueId || 'user',
      comment: data.comment || '',
      avatar: getAvatar(data.user),
    });
  });

  conn.on(WebcastEvent.LIKE, (data) => {
    if (!isActive()) return;
    try {
      const stream = getOrCreateStream(email);
      const uid = data.user?.uniqueId || data.uniqueId;
      if (uid) {
        const existing = stream.likers.get(uid) || {
          nickname: data.user?.nickname || uid,
          likes: 0,
          avatar: getAvatar(data.user),
        };
        existing.likes += (data.likeCount || 1);
        stream.likers.set(uid, existing);
        emitToStream(stream.tiktokUsername, 'topLikers', computeTopLikers(stream));
      }

      emitToStream(stream.tiktokUsername, 'like', { avatar: getAvatar(data.user) });
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
    emitStreamStatus(email, false, { reason: 'disconnected' });
    scheduleTikTokReconnect(email);
  });

  conn.on('streamEnd', () => {
    if (!isActive()) return;
    clearReconnectTimer(userStreams.get(email));
    console.log(`📺 [${email}] Stream ended`);
    emitStreamStatus(email, false, { reason: 'stream_end' });
  });

  conn.on('error', (err) => {
    if (!isActive()) return;
    const stream = userStreams.get(email);
    if (!stream) return;
    console.error(`TikTok error [${email}]:`, err.message || err);
    stopTikTokConnection(stream);
    emitStreamStatus(email, false, { reason: 'error', error: 'Connection error' });
    scheduleTikTokReconnect(email);
  });
}

async function reconnectTikTokConnectionForUser(email) {
  const stream = userStreams.get(email);
  if (!stream?.tiktokUsername) throw new Error('TikTok Username หายไป');

  if (stream.connecting) {
    await stream.connecting;
  }

  const tiktokUsername = stream.tiktokUsername;
  const sessionId = users[email]?.sessionId || null;

  const connectTask = (async () => {
    stopTikTokConnection(stream);

    const connectionId = stream.activeConnectionId;
    const options = {
      enableExtendedGiftInfo: true,
      processInitialData: false,
    };
    if (sessionId) options.sessionId = sessionId;

    const conn = new TikTokLiveConnection(tiktokUsername, options);
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

async function startTikTokConnectionForUser(email, tiktokUsername, sessionId = null) {
  if (!tiktokUsername) throw new Error('TikTok Username หายไป');

  const stream = getOrCreateStream(email);

  if (stream.connecting) {
    await stream.connecting;
  }

  const connectTask = (async () => {
    const previousOwner = usernameOwners.get(tiktokUsername);
    if (previousOwner && previousOwner !== email) {
      const ownerStream = userStreams.get(previousOwner);
      if (ownerStream) {
        stopTikTokConnection(ownerStream);
        clearUsernameOwner(tiktokUsername, previousOwner);
      }
    }

    stopTikTokConnection(stream);

    if (stream.tiktokUsername && stream.tiktokUsername !== tiktokUsername) {
      clearUsernameOwner(stream.tiktokUsername, email);
    }

    resetStreamCounters(stream);
    stream.tiktokUsername = tiktokUsername;
    usernameOwners.set(tiktokUsername, email);

    const connectionId = stream.activeConnectionId;
    const options = {
      enableExtendedGiftInfo: true,
      processInitialData: false,
    };
    if (sessionId) options.sessionId = sessionId;

    const conn = new TikTokLiveConnection(tiktokUsername, options);
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

// ================== Google OAuth ==================
passport.use(new GoogleStrategy({
  clientID: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  callbackURL: `${APP_URL}/auth/google/callback`,
},
(accessToken, refreshToken, profile, cb) => cb(null, profile)));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

app.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email'],
}));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => res.redirect('/'));

app.get('/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
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
  if (msg.includes('user_not_found')) {
    return 'ไม่พบผู้ใช้ TikTok นี้ หรือยังไม่ได้เปิดไลฟ์';
  }
  if (msg.includes('blocked') || msg.includes('SIGI')) {
    return 'ถูกบล็อกชั่วคราวจาก TikTok ลองรอสักครู่';
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
    return res.status(401).json({ success: false, loggedIn: false });
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
  const { credential, code } = req.body || {};
  if (!credential && !code) {
    return res.status(400).json({ success: false, error: 'ไม่มีข้อมูล login' });
  }

  try {
    let payload;

    if (code) {
      const { tokens } = await googleClient.getToken({
        code,
        redirect_uri: 'postmessage',
      });
      if (!tokens.id_token) {
        return res.status(401).json({ success: false, error: 'Google login ไม่ถูกต้อง' });
      }
      const ticket = await googleClient.verifyIdToken({
        idToken: tokens.id_token,
        audience: GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } else {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
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

// ================== Protected Actions ==================
app.post('/connect-tiktok', connectLimiter, async (req, res) => {
  try {
    const email = getSessionEmail(req);
    const tiktokUsername = sanitizeTikTokUsername(req.body?.tiktokUsername);
    const sessionId = req.body?.sessionId ? String(req.body.sessionId).trim().slice(0, 200) : null;

    if (!email) return res.status(401).json({ error: 'กรุณา Login ก่อน' });
    if (!tiktokUsername) return res.status(400).json({ error: 'TikTok Username ไม่ถูกต้อง' });

    if (!users[email]) users[email] = {};
    users[email].tiktokUsername = tiktokUsername;
    if (sessionId) users[email].sessionId = sessionId;
    saveUsers();

    await startTikTokConnectionForUser(email, tiktokUsername, sessionId);
    res.json({ success: true, username: tiktokUsername });
  } catch (err) {
    console.error('Connect error:', err);
    res.status(500).json({ error: mapTikTokError(err) });
  }
});

app.post('/save-tiktok', connectLimiter, async (req, res) => {
  try {
    const tiktokUsername = sanitizeTikTokUsername(req.body?.tiktokUsername);
    const sessionId = req.body?.sessionId ? String(req.body.sessionId).trim().slice(0, 200) : null;
    const email = sanitizeEmail(req.body?.email) || getSessionEmail(req);

    if (!tiktokUsername) return res.status(400).json({ error: 'TikTok Username ไม่ถูกต้อง' });
    if (!email) return res.status(401).json({ error: 'กรุณา Login ก่อน' });

    if (!users[email]) users[email] = {};
    users[email].tiktokUsername = tiktokUsername;
    if (sessionId) users[email].sessionId = sessionId;
    saveUsers();

    await startTikTokConnectionForUser(email, tiktokUsername, sessionId);
    res.json({ success: true, username: tiktokUsername });
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

  const stream = userStreams.get(email);
  if (!stream) {
    return res.json({
      connected: false,
      username: users[email]?.tiktokUsername || null,
      totalDiamonds: 0,
      dashboardRequired: true,
    });
  }

  res.json({
    connected: !!stream.connection,
    username: stream.tiktokUsername || null,
    totalDiamonds: stream.totalDiamonds,
    dashboardActive: stream.dashboardSockets.size > 0,
    dashboardRequired: true,
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
    socket.disconnect(true);
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
  console.log(`   Users file: ${USERS_FILE}`);
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