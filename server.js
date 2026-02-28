require('dotenv').config();
const express      = require('express');
const session      = require('express-session');
const SQLiteStore  = require('connect-sqlite3')(session);
const bcrypt       = require('bcrypt');
const Database     = require('better-sqlite3');
const multer       = require('multer');
const nodemailer   = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const path         = require('path');
const fs           = require('fs');

/* ── try to load optional modules ── */
let sharp = null;
try { sharp = require('sharp'); } catch(_) { console.warn('sharp not installed – panoramas won\'t be re-optimised'); }

let rateLimit = null;
try { rateLimit = require('express-rate-limit'); } catch(_) {}

let helmet = null;
try { helmet = require('helmet'); } catch(_) {}

/* ────────────────────────────────────────────────
   CONFIG
──────────────────────────────────────────────── */
const PORT           = process.env.PORT           || 3000;
const DB_PATH        = process.env.DB_PATH        || path.join(__dirname, 'database', 'data.sqlite');
const UPLOAD_PATH    = process.env.UPLOAD_PATH    || path.join(__dirname, 'public', 'uploads');
const BASE_URL       = process.env.BASE_URL       || `http://localhost:${PORT}`;
const SESSION_SECRET = process.env.SESSION_SECRET || 'CHANGE_THIS_IN_PROD_' + Date.now();
const BCRYPT_ROUNDS  = parseInt(process.env.BCRYPT_ROUNDS || '12');

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER || 'noreply@virtualtour.app';

/* ────────────────────────────────────────────────
   DIRECTORIES
──────────────────────────────────────────────── */
[UPLOAD_PATH, path.dirname(DB_PATH)].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

/* ────────────────────────────────────────────────
   DATABASE
──────────────────────────────────────────────── */
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    UNIQUE NOT NULL,
    username    TEXT    NOT NULL,
    password    TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin','editor','viewer')),
    active      INTEGER NOT NULL DEFAULT 1,
    createdAt   DATETIME DEFAULT CURRENT_TIMESTAMP,
    lastLoginAt DATETIME
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    token     TEXT    PRIMARY KEY,
    userId    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires   INTEGER NOT NULL,
    used      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS scenes (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    panorama    TEXT NOT NULL DEFAULT '',
    "order"     INTEGER NOT NULL DEFAULT 0,
    published   INTEGER NOT NULL DEFAULT 1,
    createdAt   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS hotspots (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    sceneId   TEXT    NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    pitch     REAL    NOT NULL DEFAULT 0,
    yaw       REAL    NOT NULL DEFAULT 0,
    rotation  REAL    NOT NULL DEFAULT 0,
    type      TEXT    NOT NULL DEFAULT 'scene' CHECK(type IN ('scene','info')),
    target    TEXT,
    label     TEXT    NOT NULL DEFAULT 'Go',
    infoText  TEXT    NOT NULL DEFAULT '',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS visits (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    userId    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sceneId   TEXT,
    ip        TEXT,
    visitedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_hotspots_scene ON hotspots(sceneId);
  CREATE INDEX IF NOT EXISTS idx_visits_scene   ON visits(sceneId);
`);

/* ── Migrate existing DBs: add new columns if missing ── */
try {
  db.exec(`ALTER TABLE hotspots ADD COLUMN type     TEXT NOT NULL DEFAULT 'scene'`);
} catch(_) {}
try {
  db.exec(`ALTER TABLE hotspots ADD COLUMN infoText TEXT NOT NULL DEFAULT ''`);
} catch(_) {}

// Seed default admin
if (!db.prepare("SELECT id FROM users WHERE email=?").get('admin@vt.com')) {
  const hash = bcrypt.hashSync('Admin@1234', BCRYPT_ROUNDS);
  db.prepare("INSERT INTO users(email,username,password,role) VALUES(?,?,?,?)")
    .run('admin@vt.com', 'Admin', hash, 'admin');
  console.log('✅ Default admin → admin@vt.com / Admin@1234  (change immediately!)');
}

/* ────────────────────────────────────────────────
   EMAIL
──────────────────────────────────────────────── */
let mailer = null;
if (SMTP_HOST && SMTP_USER) {
  mailer = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  mailer.verify().then(() => console.log('✅ SMTP ready')).catch(e => console.warn('⚠ SMTP:', e.message));
}

async function sendMail(to, subject, html) {
  if (mailer) {
    await mailer.sendMail({ from: MAIL_FROM, to, subject, html });
  } else {
    console.log(`\n📧 [DEV – no SMTP] To: ${to} | Subject: ${subject}\nLink in HTML above ↑\n${html}\n`);
  }
}

/* ────────────────────────────────────────────────
   MULTER
──────────────────────────────────────────────── */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_PATH),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase().replace(/\s/g,'') || '.jpg';
    cb(null, Date.now() + '_' + uuidv4().slice(0,8) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 80 * 1024 * 1024 }, // 80 MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|webp|tiff?)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG / PNG / WebP / TIFF allowed'));
  }
});

async function optimisePanorama(filePath) {
  if (!sharp) return;
  try {
    const tmp = filePath + '.opt.jpg';
    await sharp(filePath)
      .rotate()  // fix EXIF orientation
      .jpeg({ quality: 95, chromaSubsampling: '4:4:4', progressive: true })
      .toFile(tmp);
    fs.renameSync(tmp, filePath);
  } catch (e) {
    console.warn('panorama optimise skipped:', e.message);
  }
}

/* ────────────────────────────────────────────────
   APP
──────────────────────────────────────────────── */
const app = express();
app.set('trust proxy', 1);
if (helmet) {
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
}

if (rateLimit) {
  const authLim = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
  app.post('/api/login',    authLim);
  app.post('/api/register', authLim);
  app.post('/api/forgot',   authLim);
  app.post('/api/reset',    authLim);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.dirname(DB_PATH) }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true }
}));

// Serve static files
app.use(express.static('public'));

// Auth middleware
const requireAuth = (role) => (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'unauthorized' });
  if (role && req.session.user.role !== role && req.session.user.role !== 'admin')
    return res.status(403).json({ error: 'forbidden' });
  next();
};

/* ────────────────────────────────────────────────
   AUTH ROUTES
──────────────────────────────────────────────── */
app.get('/api/me', (req, res) => {
  res.json(req.session.user || null);
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json({ success: false, error: 'missing' });
  const user = db.prepare("SELECT * FROM users WHERE LOWER(email)=? AND active=1").get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.json({ success: false, error: 'invalid' });
  db.prepare("UPDATE users SET lastLoginAt=CURRENT_TIMESTAMP WHERE id=?").run(user.id);
  req.session.user = { id: user.id, email: user.email, username: user.username, role: user.role };
  res.json({ success: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.post('/api/register', (req, res) => {
  const { email, username, password } = req.body;
  if (!email || !password || password.length < 8)
    return res.json({ success: false, error: 'invalid_input' });
  try {
    const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    db.prepare("INSERT INTO users(email,username,password,role) VALUES(?,?,?,?)").run(email.toLowerCase(), username||'User', hash, 'viewer');
    res.json({ success: true });
  } catch(e) {
    res.json({ success: false, error: e.message.includes('UNIQUE') ? 'email_exists' : e.message });
  }
});

app.post('/api/forgot', (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ success: false });
  const user = db.prepare("SELECT id FROM users WHERE LOWER(email)=?").get(email.toLowerCase());
  if (!user) return res.json({ success: true }); // don't reveal if email exists
  const token = uuidv4();
  const expires = Date.now() + 3600 * 1000; // 1 hour
  db.prepare("INSERT INTO password_resets(token,userId,expires) VALUES(?,?,?)").run(token, user.id, expires);
  const resetLink = `${BASE_URL}/reset?token=${token}`;
  sendMail(email, 'Password Reset', `<p><a href="${resetLink}">Click here to reset your password</a></p>`);
  res.json({ success: true });
});

app.get('/api/reset/verify', (req, res) => {
  const row = db.prepare("SELECT * FROM password_resets WHERE token=? AND used=0").get(req.query.token);
  res.json({ valid: !!(row && row.expires > Date.now()) });
});

app.post('/api/reset', (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || password.length < 8)
    return res.json({ success: false, error: 'invalid_input' });
  const row = db.prepare("SELECT * FROM password_resets WHERE token=? AND used=0").get(token);
  if (!row || row.expires < Date.now())
    return res.json({ success: false, error: 'token_expired' });
  db.prepare("UPDATE users SET password=? WHERE id=?").run(bcrypt.hashSync(password, BCRYPT_ROUNDS), row.userId);
  db.prepare("UPDATE password_resets SET used=1 WHERE token=?").run(token);
  res.json({ success: true });
});

/* ────────────────────────────────────────────────
   UPLOAD
──────────────────────────────────────────────── */
app.post('/api/upload', requireAuth('editor'), upload.array('images', 50), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ success: false, error: 'no_files' });
  // Optimise asynchronously
  files.forEach(f => optimisePanorama(f.path));
  const paths = files.map(f => '/uploads/' + f.filename);
  res.json({ success: true, path: paths[0], files: paths });
});

/* ────────────────────────────────────────────────
   SCENES
──────────────────────────────────────────────── */
app.get('/api/scenes', (req, res) => {
  const rows = db.prepare(`SELECT * FROM scenes WHERE published=1 ORDER BY "order", createdAt`).all();
  const out  = {};
  rows.forEach(r => {
    const hs = db.prepare("SELECT * FROM hotspots WHERE sceneId=? ORDER BY id").all(r.id);
    out[r.id] = {
      title: r.title, panorama: r.panorama,
      hotSpots: hs.map(h => ({ pitch: h.pitch, yaw: h.yaw, rotation: h.rotation, type: 'scene', sceneId: h.target, text: h.label }))
    };
  });
  res.json(out);
});

app.get('/api/admin/scenes', requireAuth('editor'), (req, res) => {
  const rows = db.prepare(`SELECT * FROM scenes ORDER BY "order", createdAt`).all();
  const out  = {};
  rows.forEach(r => {
    const hs = db.prepare("SELECT * FROM hotspots WHERE sceneId=? ORDER BY id").all(r.id);
    out[r.id] = {
      title: r.title, panorama: r.panorama, published: !!r.published, order: r.order,
      hotSpots: hs.map(h => ({ pitch: h.pitch, yaw: h.yaw, rotation: h.rotation, type: 'scene', sceneId: h.target, text: h.label }))
    };
  });
  res.json(out);
});

app.post('/api/scenes', requireAuth('editor'), (req, res) => {
  const { id, title, panorama, hotSpots, order, published } = req.body;
  const sid = (id && id !== '(auto)') ? id : 'scene' + Date.now();
  db.prepare(`INSERT OR REPLACE INTO scenes(id,title,panorama,"order",published,updatedAt) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)`)
    .run(sid, title || '', panorama || '', order ?? 0, published !== false ? 1 : 0);
  db.prepare("DELETE FROM hotspots WHERE sceneId=?").run(sid);
  if (Array.isArray(hotSpots) && hotSpots.length) {
    const ins = db.prepare("INSERT INTO hotspots(sceneId,pitch,yaw,rotation,type,target,label,infoText) VALUES(?,?,?,?,?,?,?,?)");
    db.transaction(arr => arr.forEach(h => ins.run(
      sid, h.pitch??0, h.yaw??0, h.rotation??0,
      h.type==='info' ? 'info' : 'scene',
      h.sceneId||h.target||null,
      h.text||h.label||'Go',
      h.infoText||''
    )))(hotSpots);
  }
  res.json({ success: true, id: sid });
});

app.delete('/api/scenes/:id', requireAuth('editor'), (req, res) => {
  db.prepare("DELETE FROM hotspots WHERE sceneId=?").run(req.params.id);
  db.prepare("DELETE FROM scenes WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

/* ────────────────────────────────────────────────
   VISITS
──────────────────────────────────────────────── */
app.post('/api/visit', (req, res) => {
  if (!req.body.sceneId) return res.json({ success: false });
  db.prepare("INSERT INTO visits(userId,sceneId,ip) VALUES(?,?,?)").run(req.session.user?.id ?? null, req.body.sceneId, req.ip);
  res.json({ success: true });
});

/* ────────────────────────────────────────────────
   STATS
──────────────────────────────────────────────── */
app.get('/api/stats', requireAuth('editor'), (req, res) => {
  const visits    = db.prepare("SELECT sceneId, COUNT(*) AS count FROM visits GROUP BY sceneId ORDER BY count DESC").all();
  const uploads   = fs.readdirSync(UPLOAD_PATH).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f)).length;
  const users     = db.prepare("SELECT COUNT(*) AS c FROM users WHERE active=1").get().c;
  const scenes    = db.prepare("SELECT COUNT(*) AS c FROM scenes").get().c;
  const today     = db.prepare("SELECT COUNT(*) AS c FROM visits WHERE DATE(visitedAt)=DATE('now')").get().c;
  res.json({ visits, uploads, users, scenes, todayVisits: today });
});

/* ────────────────────────────────────────────────
   USERS
──────────────────────────────────────────────── */
app.get('/api/users', requireAuth('admin'), (req, res) => {
  res.json(db.prepare("SELECT id,email,username,role,active,createdAt,lastLoginAt FROM users ORDER BY createdAt DESC").all());
});

app.post('/api/users', requireAuth('admin'), (req, res) => {
  const { email, username, password, role } = req.body;
  if (!email || !password) return res.json({ success: false, error: 'missing' });
  try {
    db.prepare("INSERT INTO users(email,username,password,role) VALUES(?,?,?,?)").run(email.toLowerCase(), username||email.split('@')[0], bcrypt.hashSync(password, BCRYPT_ROUNDS), role||'viewer');
    res.json({ success: true });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

app.patch('/api/users/:id', requireAuth('admin'), (req, res) => {
  const { role, active } = req.body;
  if (role)            db.prepare("UPDATE users SET role=?   WHERE id=?").run(role,  req.params.id);
  if (active != null)  db.prepare("UPDATE users SET active=? WHERE id=?").run(active?1:0, req.params.id);
  res.json({ success: true });
});

app.delete('/api/users/:id', requireAuth('admin'), (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id)
    return res.json({ success: false, error: 'cannot_delete_self' });
  db.prepare("DELETE FROM users WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

/* ────────────────────────────────────────────────
   PANNELLUM EXPORT
──────────────────────────────────────────────── */
app.get('/api/export', (req, res) => {
  const rows = db.prepare(`SELECT * FROM scenes WHERE published=1 ORDER BY "order", createdAt`).all();
  const out  = {};
  // Build scene map first so hotspot text can reference titles
  rows.forEach(s => { out[s.id] = { title: s.title, type: 'equirectangular', panorama: s.panorama, hotSpots: [] }; });
  db.prepare("SELECT * FROM hotspots").all().forEach(h => {
    if (out[h.sceneId]) {
      out[h.sceneId].hotSpots.push({
        pitch:    h.pitch,
        yaw:      h.yaw,
        rotation: h.rotation || 0,
        type:     h.type || 'scene',
        sceneId:  h.target,
        text:     h.label || (out[h.target] ? '→ ' + out[h.target].title : '→'),
        infoText: h.infoText || ''
      });
    }
  });
  res.json(out);
});

/* Reorder scenes */
app.post('/api/scenes/reorder', requireAuth('editor'), (req, res) => {
  const { order } = req.body;  // array of scene ids in new order
  if (!Array.isArray(order)) return res.json({ success: false });
  const upd = db.prepare(`UPDATE scenes SET "order"=? WHERE id=?`);
  db.transaction(arr => arr.forEach((id, i) => upd.run(i, id)))(order);
  res.json({ success: true });
});

/* ────────────────────────────────────────────────
   HEALTH
──────────────────────────────────────────────── */
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Global error handler
app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 80 MB)' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

/* ────────────────────────────────────────────────
   START SERVER
──────────────────────────────────────────────── */
// Single listen call - supports both Railway and local development
// Railway uses process.env.PORT and requires 0.0.0.0 binding
const PORT_TO_USE = process.env.PORT || 3000;
const BIND_ADDRESS = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';

app.listen(PORT_TO_USE, BIND_ADDRESS, () => {
  console.log(`\n✅ Server is running!`);
  console.log(`🚀 Port: ${PORT_TO_USE}`);
  console.log(`📍 Binding: ${BIND_ADDRESS}`);
  console.log(`🔗 URL: ${process.env.BASE_URL || 'http://localhost:' + PORT_TO_USE}\n`);
});