/**
 * Nagara — sesi login server-side
 * Cookie HttpOnly bertanda tangan HMAC. Kredensial & secret hanya di env Vercel:
 *   DASH_USER, DASH_PASS_HASH (scrypt, buat dengan scripts/hash-password.js), SESSION_SECRET (>= 32 karakter)
 */
const crypto = require('crypto');

const COOKIE = 'ngi_session';
const MAX_AGE = 60 * 60 * 12; // 12 jam

function secret() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 32) throw new Error('SESSION_SECRET belum di-set (min. 32 karakter)');
  return s;
}
const mac = b => crypto.createHmac('sha256', secret()).update(b).digest('base64url');

function sign(payload) {
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${b}.${mac(b)}`;
}
function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const [b, sig] = token.split('.');
  if (!b || !sig) return null;
  const exp = mac(b);
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  let p; try { p = JSON.parse(Buffer.from(b, 'base64url').toString()); } catch { return null; }
  if (!p || !p.exp || p.exp < Math.floor(Date.now() / 1000)) return null;
  return p;
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function getSession(req) {
  try { return verify(parseCookies(req)[COOKIE]); } catch { return null; }
}
function setSession(res, user) {
  const now = Math.floor(Date.now() / 1000);
  res.setHeader('Set-Cookie', `${COOKIE}=${sign({ u: user, iat: now, exp: now + MAX_AGE })}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`);
}
function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}
function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
function requireAuth(req, res) {
  const s = getSession(req);
  if (!s) { sendJson(res, 401, { error: 'Perlu login' }); return null; }
  return s;
}
/** Bungkus handler lama: OPTIONS tetap lolos, selain itu wajib sesi login. */
function withAuth(handler) {
  return async (req, res) => {
    if (req.method === 'OPTIONS') return handler(req, res);
    if (!requireAuth(req, res)) return;
    return handler(req, res);
  };
}
/** Cek password terhadap DASH_PASS_HASH format "scrypt$<saltHex>$<hashHex>". */
function checkPassword(pass) {
  const stored = process.env.DASH_PASS_HASH || '';
  const [algo, saltHex, hashHex] = stored.split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) throw new Error('DASH_PASS_HASH belum di-set');
  const want = Buffer.from(hashHex, 'hex');
  const got = crypto.scryptSync(String(pass || ''), Buffer.from(saltHex, 'hex'), want.length);
  return crypto.timingSafeEqual(got, want);
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { getSession, setSession, clearSession, requireAuth, withAuth, checkPassword, safeEqual, sendJson };
