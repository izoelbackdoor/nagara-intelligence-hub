const { getSession, sendJson } = require('../_lib/session');
module.exports = async (req, res) => {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'Perlu login' });
  return sendJson(res, 200, { user: s.u, exp: s.exp });
};
