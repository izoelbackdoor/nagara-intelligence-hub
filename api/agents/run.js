/**
 * Router karyawan AI (satu serverless function supaya tetap di bawah batas 12 fungsi Vercel Hobby).
 *   /api/agents/arah  → brief Chief of Staff (cron CRON_SECRET atau login)
 *   /api/agents/usul  → draf WA perkenalan ke antrean persetujuan (login saja), body { product, n }
 *   /api/agents/rawat → triase tiket helpdesk + draf balasan (login saja), body { ticket_id }
 *   /api/agents/iklan → Analis Meta Ads: analisis 7 hari sekarang (login saja, POST). Cron arah juga
 *                       mengerjakan analisis jadwal Senin yang masih antre (bila n8n NADI 7 belum aktif).
 */
const { sendJson } = require('../../lib/session');
const { whoCalls } = require('../../lib/agents/common');
const runArah = require('../../lib/agents/arah');
const runUsul = require('../../lib/agents/usul');
const runRawat = require('../../lib/agents/rawat');
const runIklan = require('../../lib/agents/iklan');

module.exports = async (req, res) => {
  const who = whoCalls(req);
  if (!who) return sendJson(res, 401, { error: 'Tidak diizinkan' });
  if (!process.env.CLAUDE_API_KEY) return sendJson(res, 500, { error: 'CLAUDE_API_KEY belum di-set' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return sendJson(res, 500, { error: 'Database kantor belum terhubung' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const agent = (req.query && req.query.agent) || '';
  if (agent === 'arah') {
    if (who === 'cron') {
      try {
        const r = await runIklan.jalankanTertunda(35000);
        if (r) console.log('[iklan] analisis tertunda:', r.info);
      } catch (e) { console.error('[iklan] analisis tertunda gagal:', e.message); }
    }
    return runArah(who, res, sendJson);
  }
  if (agent === 'iklan') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Gunakan POST' });
    return runIklan(who, body || {}, res, sendJson);
  }
  if (agent === 'usul') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Gunakan POST' });
    return runUsul(who, body || {}, res, sendJson);
  }
  if (agent === 'rawat') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Gunakan POST' });
    return runRawat(who, body || {}, res, sendJson);
  }
  return sendJson(res, 404, { error: 'Agen tidak dikenal' });
};
