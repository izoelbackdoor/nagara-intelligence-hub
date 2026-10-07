/**
 * Virtual Office — database kantor (Supabase project nagara-command-center).
 *
 * GET  /api/office/state   → keadaan kantor (wajib login dashboard)
 * POST /api/office/state   → laporan dari agen AI (n8n/Hermes), wajib header
 *                            Authorization: Bearer <OFFICE_INGEST_TOKEN>
 *   body: { desk:"hermes", type:"event"|"approval"|"heartbeat",
 *           level?:"info"|"teknis"|"peringatan"|"bahaya", message?:string,
 *           kind?:string, summary?:string, meta?:object }
 *
 * Env (server saja): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OFFICE_INGEST_TOKEN
 */
const { requireAuth, safeEqual, sendJson } = require('../../lib/session');

const LEVELS = ['info', 'teknis', 'peringatan', 'bahaya'];
const clip = (s, n) => String(s ?? '').slice(0, n);

async function sb(path, { method = 'GET', body, prefer } = {}) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, Accept: 'application/json' };
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`; // kunci JWT lama
  if (body) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${path.split('?')[0]}: HTTP ${r.status}`);
  return r.status === 204 ? null : r.json();
}

async function readState(res) {
  const units = await sb('office_units?select=key,name,color,zone,description,sort&active=is.true&order=sort');
  const keys = units.map(u => u.key);
  const inList = `in.(${keys.map(k => encodeURIComponent(k)).join(',')})`;
  const [desks, agents, events, approvals] = keys.length ? await Promise.all([
    sb(`office_desks?select=key,unit_key,name,role,kind,tenant,model,supervisor,jobdesc,status,agent_id,last_seen_at,sort&unit_key=${inList}&order=sort`),
    sb('office_agents?select=id,desk_key,name,model,tools,daily_budget_usd,needs_approval,status'),
    sb(`office_events?select=id,unit_key,desk_key,level,message,created_at&unit_key=${inList}&order=created_at.desc&limit=40`),
    sb('office_approvals?select=id,desk_key,kind,summary,status,created_at&status=eq.menunggu&order=created_at'),
  ]) : [[], [], [], []];
  const deskKeys = new Set(desks.map(d => d.key));
  return sendJson(res, 200, {
    generated_at: new Date().toISOString(),
    units, desks,
    agents: agents.filter(a => deskKeys.has(a.desk_key)),
    events, approvals: approvals.filter(a => !a.desk_key || deskKeys.has(a.desk_key)),
  });
}

async function ingest(req, res) {
  const token = process.env.OFFICE_INGEST_TOKEN || '';
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (token.length < 32 || !safeEqual(got, token)) return sendJson(res, 401, { error: 'Token agen tidak valid' });
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  const desk = clip(b.desk, 40);
  const rows = await sb(`office_desks?select=key,unit_key,status&key=eq.${encodeURIComponent(desk)}`);
  if (!rows.length) return sendJson(res, 404, { error: `Meja "${desk}" tidak ada` });
  const d = rows[0];
  const now = new Date().toISOString();
  await sb(`office_desks?key=eq.${encodeURIComponent(desk)}`, { method: 'PATCH', body: { last_seen_at: now }, prefer: 'return=minimal' });
  const type = b.type || 'event';
  if (type === 'heartbeat') return sendJson(res, 200, { ok: true });
  if (type === 'approval') {
    if (!b.summary) return sendJson(res, 400, { error: 'summary wajib untuk approval' });
    await sb('office_approvals', { method: 'POST', prefer: 'return=minimal', body: { desk_key: desk, kind: clip(b.kind || 'lainnya', 40), summary: clip(b.summary, 500) } });
    await sb('office_events', { method: 'POST', prefer: 'return=minimal', body: { unit_key: d.unit_key, desk_key: desk, level: 'info', message: clip(`Minta persetujuan (${b.kind || 'lainnya'}): ${b.summary}`, 500) } });
    return sendJson(res, 200, { ok: true });
  }
  if (!b.message) return sendJson(res, 400, { error: 'message wajib' });
  const meta = b.meta && typeof b.meta === 'object' && JSON.stringify(b.meta).length < 4000 ? b.meta : {};
  await sb('office_events', { method: 'POST', prefer: 'return=minimal', body: { unit_key: d.unit_key, desk_key: desk, level: LEVELS.includes(b.level) ? b.level : 'info', message: clip(b.message, 500), meta } });
  return sendJson(res, 200, { ok: true });
}

module.exports = async (req, res) => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return sendJson(res, 500, { error: 'Database kantor belum terhubung: set SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di Vercel.' });
  try {
    if (req.method === 'POST') return await ingest(req, res);
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    if (!requireAuth(req, res)) return;
    return await readState(res);
  } catch (e) {
    return sendJson(res, 502, { error: 'Gagal mengakses database kantor: ' + e.message });
  }
};
