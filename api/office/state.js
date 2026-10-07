/**
 * Virtual Office — keadaan kantor dari Supabase (project nagara-command-center).
 * Hanya bisa dibaca setelah login. Kunci Supabase hanya di server (env):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const { requireAuth, sendJson } = require('../../lib/session');

async function q(path) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, Accept: 'application/json' };
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`; // kunci JWT lama
  const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, { headers });
  if (!r.ok) throw new Error(`${path.split('?')[0]}: HTTP ${r.status}`);
  return r.json();
}

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return sendJson(res, 500, { error: 'Database kantor belum terhubung: set SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di Vercel.' });
  try {
    const units = await q('office_units?select=key,name,color,zone,description,sort&active=is.true&order=sort');
    const keys = units.map(u => u.key);
    const inList = `in.(${keys.map(k => encodeURIComponent(k)).join(',')})`;
    const [desks, agents, events, approvals] = keys.length ? await Promise.all([
      q(`office_desks?select=key,unit_key,name,role,kind,tenant,model,supervisor,jobdesc,status,agent_id,sort&unit_key=${inList}&order=sort`),
      q('office_agents?select=id,desk_key,name,model,tools,daily_budget_usd,needs_approval,status'),
      q(`office_events?select=id,unit_key,desk_key,level,message,created_at&unit_key=${inList}&order=created_at.desc&limit=40`),
      q('office_approvals?select=id,desk_key,kind,summary,status,created_at&status=eq.menunggu&order=created_at'),
    ]) : [[], [], [], []];
    const deskKeys = new Set(desks.map(d => d.key));
    return sendJson(res, 200, {
      generated_at: new Date().toISOString(),
      units, desks,
      agents: agents.filter(a => deskKeys.has(a.desk_key)),
      events, approvals: approvals.filter(a => !a.desk_key || deskKeys.has(a.desk_key)),
    });
  } catch (e) {
    return sendJson(res, 502, { error: 'Gagal membaca database kantor: ' + e.message });
  }
};
