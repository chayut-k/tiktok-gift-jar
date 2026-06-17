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
app.use(session({
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
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(express.json({ limit: '16kb' }));
app.use(express.static('public', {
  maxAge: isProd ? '1d' : 0,
  etag: true,
}));

// ================== Global State ==================
let currentConnection = null;
let currentTikTokUsername = '';
let totalDiamonds = 0;
const likers = new Map();

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

function getAvatar(user) {
  if (!user) return '';
  const pic = user.profilePicture || user.profilePictureMedium || user.profilePictureLarge;
  if (pic) {
    if (Array.isArray(pic.urlList) && pic.urlList.length > 0) return pic.urlList[0];
    if (Array.isArray(pic.url) && pic.url.length > 0) return pic.url[0];
  }
  return '';
}

function computeTopLikers(limit = 5) {
  return [...likers.entries()]
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

function resetAllState() {
  totalDiamonds = 0;
  likers.clear();
  console.log('🔄 State reset (total + likers)');
}

function emitStatus(connected, username = currentTikTokUsername) {
  io.emit('status', { connected: !!connected, username });
}

function mapTikTokError(err) {
  const msg = err?.message || '';
  if (msg.includes('user_not_found')) {
    return 'ไม่พบผู้ใช้ TikTok นี้ หรือยังไม่ได้เปิดไลฟ์';
  }
  if (msg.includes('blocked') || msg.includes('SIGI')) {
    return 'ถูกบล็อกชั่วคราวจาก TikTok ลองใช้ Session ID หรือรอสักครู่';
  }
  return 'เชื่อมต่อไม่สำเร็จ';
}

// ================== TikTok Connection Logic ==================
async function startTikTokConnection(tiktokUsername, sessionId = null) {
  if (!tiktokUsername) throw new Error('TikTok Username หายไป');

  if (currentConnection) {
    try { currentConnection.disconnect(); } catch (e) {}
    currentConnection = null;
  }

  resetAllState();
  currentTikTokUsername = tiktokUsername;

  const options = {
    enableExtendedGiftInfo: true,
    processInitialData: false,
  };
  if (sessionId) options.sessionId = sessionId;

  currentConnection = new TikTokLiveConnection(tiktokUsername, options);
  attachTikTokListeners(currentConnection);

  try {
    await currentConnection.connect();
    console.log(`✅ เชื่อมต่อ TikTok สำเร็จ: ${tiktokUsername}`);
    emitStatus(true);
  } catch (err) {
    currentConnection = null;
    currentTikTokUsername = '';
    throw err;
  }
}

function attachTikTokListeners(conn) {
  conn.on(WebcastEvent.GIFT, (data) => {
    try {
      const diamonds = data.diamondCount
        || (data.extendedGiftInfo && data.extendedGiftInfo.diamond_count)
        || (data.giftDetails && data.giftDetails.diamondCount)
        || 0;
      if (diamonds <= 0) return;

      const repeatEnd = data.repeatEnd === true || data.repeatEnd === 1;
      if (!repeatEnd) return;

      const repeatCount = data.repeatCount || 1;
      totalDiamonds += diamonds * repeatCount;

      const giftPictureUrl = data.giftPictureUrl
        || (data.extendedGiftInfo && data.extendedGiftInfo.image && data.extendedGiftInfo.image.url_list && data.extendedGiftInfo.image.url_list[0])
        || (data.giftDetails && data.giftDetails.icon && data.giftDetails.icon.urlList && data.giftDetails.icon.urlList[0])
        || null;

      io.emit('gift', {
        user: data.user?.nickname || data.user?.uniqueId || 'คนดู',
        giftName: data.giftName || (data.giftDetails && data.giftDetails.giftName) || 'Unknown',
        diamonds,
        repeatCount,
        total: totalDiamonds,
        giftPictureUrl,
      });
    } catch (err) {
      console.error('GIFT handler error:', err);
    }
  });

  conn.on(WebcastEvent.CHAT, (data) => {
    io.emit('chat', {
      nickname: data.user?.nickname || data.uniqueId || 'user',
      comment: data.comment || '',
      avatar: getAvatar(data.user),
    });
  });

  conn.on(WebcastEvent.LIKE, (data) => {
    try {
      const uid = data.user?.uniqueId || data.uniqueId;
      if (uid) {
        const existing = likers.get(uid) || {
          nickname: data.user?.nickname || uid,
          likes: 0,
          avatar: getAvatar(data.user),
        };
        existing.likes += (data.likeCount || 1);
        likers.set(uid, existing);
        io.emit('topLikers', computeTopLikers());
      }

      io.emit('like', { avatar: getAvatar(data.user) });
    } catch (err) {
      console.error('LIKE handler error:', err);
    }
  });

  conn.on('connected', (state) => {
    console.log('🔗 Connected to room:', state?.roomId);
    emitStatus(true);
  });

  conn.on('disconnected', () => {
    console.log('🔌 Disconnected from TikTok');
    emitStatus(false);
  });

  conn.on('streamEnd', () => {
    console.log('📺 Stream ended');
    emitStatus(false);
  });

  conn.on('error', (err) => {
    console.error('TikTok connection error:', err.message || err);
    io.emit('status', { connected: false, error: 'Connection error' });
  });
}

// ================== Public API ==================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    connected: !!currentConnection,
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
    const tiktokUsername = sanitizeTikTokUsername(req.body?.tiktokUsername);
    const sessionId = req.body?.sessionId ? String(req.body.sessionId).trim().slice(0, 200) : null;

    if (!tiktokUsername) {
      return res.status(400).json({ error: 'TikTok Username ไม่ถูกต้อง' });
    }

    if (req.user?.emails) {
      const email = req.user.emails[0].value;
      if (!users[email]) users[email] = {};
      users[email].tiktokUsername = tiktokUsername;
      if (sessionId) users[email].sessionId = sessionId;
      saveUsers();
    }

    await startTikTokConnection(tiktokUsername, sessionId);
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
    const email = sanitizeEmail(req.body?.email)
      || sanitizeEmail(req.session?.user?.email)
      || (req.user?.emails ? req.user.emails[0].value : null);

    if (!tiktokUsername) {
      return res.status(400).json({ error: 'TikTok Username ไม่ถูกต้อง' });
    }
    if (!email) {
      return res.status(400).json({ error: 'ต้องการ email ที่ถูกต้อง' });
    }

    if (!users[email]) users[email] = {};
    users[email].tiktokUsername = tiktokUsername;
    if (sessionId) users[email].sessionId = sessionId;
    saveUsers();

    await startTikTokConnection(tiktokUsername, sessionId);
    res.json({ success: true });
  } catch (err) {
    console.error('/save-tiktok error:', err);
    res.status(500).json({ error: mapTikTokError(err) });
  }
});

app.post('/reset-jar', actionLimiter, (req, res) => {
  resetAllState();
  io.emit('gift', { total: 0, user: '', giftName: '', giftPictureUrl: '', diamonds: 0, repeatCount: 0 });
  res.json({ success: true, total: 0 });
});

app.post('/disconnect-tiktok', actionLimiter, (req, res) => {
  if (currentConnection) {
    currentConnection.disconnect();
    currentConnection = null;
  }
  emitStatus(false);
  res.json({ success: true });
});

app.get('/api/status', (req, res) => {
  res.json({
    connected: !!currentConnection,
    username: currentTikTokUsername || null,
    totalDiamonds,
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
  console.log('🖥️ Overlay connected:', socket.id);

  if (currentTikTokUsername) {
    socket.emit('status', {
      connected: !!currentConnection,
      username: currentTikTokUsername,
    });
  }

  if (totalDiamonds > 0) {
    socket.emit('gift', {
      user: '',
      total: totalDiamonds,
      giftName: '',
      giftPictureUrl: '',
      diamonds: 0,
      repeatCount: 0,
    });
  }

  const top = computeTopLikers();
  if (top.length > 0) socket.emit('topLikers', top);
});

// ================== Start & Graceful Shutdown ==================
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running (${isProd ? 'production' : 'development'}${isRailway ? ' / Railway' : ''})`);
  console.log(`   URL: ${APP_URL}`);
  console.log(`   Health: ${APP_URL}/health`);
  console.log(`   Users file: ${USERS_FILE}`);
});

function shutdown(signal) {
  console.log(`\n${signal} received — shutting down...`);
  if (currentConnection) {
    try { currentConnection.disconnect(); } catch (e) {}
  }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));