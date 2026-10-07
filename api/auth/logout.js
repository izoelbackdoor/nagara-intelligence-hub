const { clearSession, sendJson } = require('../_lib/session');
module.exports = async (req, res) => { clearSession(res); return sendJson(res, 200, { ok: true }); };
