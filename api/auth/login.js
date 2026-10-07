const { setSession, checkPassword, safeEqual, sendJson } = require('../_lib/session');

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = async (req, res) => {
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
};
