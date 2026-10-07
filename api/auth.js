/**
 * Nagara — auth (satu function untuk login/logout/me, hemat kuota function Hobby)
 *   POST /api/auth/login   GET /api/auth/me   POST /api/auth/logout
 */
const { setSession, clearSession, getSession, checkPassword, safeEqual, sendJson } = require('../lib/session');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function login(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { user, pass } = body || {};
  try {
    const okUser = safeEqual(String(user || '').trim(), process.env.DASH_USER || '');
    const okPass = checkPassword(pass); // selalu dihitung supaya waktu respon sama
    if (okUser && okPass) { setSession(res, String(user).trim()); return sendJson(res, 200, { ok: true, user: String(user).trim() }); }
  } catch (e) {
    return sendJson(res, 500, { error: 'Login belum dikonfigurasi di server: ' + e.message });
  }
  await sleep(800); // perlambat tebak-tebakan password
  return sendJson(res, 401, { error: 'Username atau password salah' });
}

module.exports = async (req, res) => {
  const action = (req.query && req.query.action) || new URL(req.url, 'http://x').searchParams.get('action') || (req.url.match(/\/api\/auth\/(\w+)/) || [])[1];
  if (action === 'login') return login(req, res);
  if (action === 'logout') { clearSession(res); return sendJson(res, 200, { ok: true }); }
  if (action === 'me') {
    const s = getSession(req);
    if (!s) return sendJson(res, 401, { error: 'Perlu login' });
    return sendJson(res, 200, { user: s.u, exp: s.exp });
  }
  return sendJson(res, 404, { error: 'Tidak ditemukan' });
};
