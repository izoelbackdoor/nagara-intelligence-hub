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
const { sb } = require('../../lib/supabase');
const { scoreLead, scoreEdukit, normWa, pickWa } = require('../../lib/leads');
const { sendWa } = require('../../lib/wa');

const LEVELS = ['info', 'teknis', 'peringatan', 'bahaya'];
const clip = (s, n) => String(s ?? '').slice(0, n);

async function readState(res) {
  const units = await sb('office_units?select=key,name,color,zone,description,sort&active=is.true&order=sort');
  const keys = units.map(u => u.key);
  const inList = `in.(${keys.map(k => encodeURIComponent(k)).join(',')})`;
  const [desks, agents, events, approvals] = keys.length ? await Promise.all([
    sb(`office_desks?select=key,unit_key,name,role,kind,tenant,model,supervisor,jobdesc,status,agent_id,last_seen_at,sort&unit_key=${inList}&order=sort`),
    sb('office_agents?select=id,desk_key,name,model,tools,daily_budget_usd,needs_approval,status'),
    sb(`office_events?select=id,unit_key,desk_key,level,message,created_at&unit_key=${inList}&order=created_at.desc&limit=40`),
    sb('office_approvals?select=id,desk_key,kind,summary,status,payload,lead_id,created_at&status=eq.menunggu&order=created_at'),
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

// ── CRM: calon klien ─────────────────────────────────────────────
const LEAD_STATUS = ['baru', 'draft', 'dihubungi', 'membalas', 'tertarik', 'deal', 'tidak_tertarik', 'jangan_hubungi'];
const DAILY_SEND_CAP = 20;

const PRODUCTS = ['nadi', 'edukit'];
async function readLeads(req, res) {
  const q = req.query || {};
  const product = PRODUCTS.includes(q.product) ? q.product : 'nadi';
  const limit = Math.min(Math.max(parseInt(q.limit) || 50, 1), 200);
  const offset = Math.max(parseInt(q.offset) || 0, 0);
  const f = ['select=id,product,name,wa,email,city,category,segment,priority,data_quality,website,contact_person,score,score_reason,has_website,prospect_level,status,last_contacted_at',
    `product=eq.${product}`, 'order=score.desc,id.asc', `limit=${limit}`, `offset=${offset}`];
  if (q.status && LEAD_STATUS.includes(q.status)) f.push(`status=eq.${q.status}`);
  if (q.category) f.push(`or=(category.eq.${encodeURIComponent(q.category)},segment.eq.${encodeURIComponent(q.category)})`);
  if (q.q) { const t = encodeURIComponent(`*${String(q.q).replace(/[*,()]/g, ' ').slice(0, 60)}*`); f.push(`and=(or(name.ilike.${t},city.ilike.${t}))`); }
  const [rows, stats] = await Promise.all([sb('crm_leads?' + f.join('&')), sb(`crm_product_stats?select=category,status,n,avg_score&product=eq.${product}`)]);
  return sendJson(res, 200, { product, rows, stats, limit, offset });
}

async function airtableAll(token, base, table, onRecord) {
  let offset;
  do {
    const u = new URL(`https://api.airtable.com/v0/${base}/${table}`);
    u.searchParams.set('pageSize', '100'); if (offset) u.searchParams.set('offset', offset);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (!r.ok) throw new Error(`Airtable ${base} ${r.status}: ${j.error?.message || j.error?.type || j.error || 'gagal'}`);
    for (const rec of j.records || []) await onRecord(rec);
    offset = j.offset;
  } while (offset);
}

// Sumber data calon klien. NADI = UMKM (Nagara CRM); EduKit = lembaga training (Nagara EduKit — Pipeline Prospek).
const SOURCES = {
  nadi: () => ({ base: process.env.CRM_AIRTABLE_BASE || 'apprX0HpneI5lcqOP', table: process.env.CRM_AIRTABLE_TABLE || 'tbl7HTgx2LtFt6j9V',
    map: (rec) => {
      const f = rec.fields || {};
      const name = String(f['Nama'] || f['Perusahaan / Bisnis'] || '').trim();
      if (!name) return null;
      return { name, wa: normWa(f['No WA']), phone_raw: f['No WA'] ? String(f['No WA']).slice(0, 120) : null, email: f['Email Kontak'] || null,
        business: f['Perusahaan / Bisnis'] || null, city: f['Kota'] || null, category: f['Kategori Blast'] || null,
        notes: String(f['Catatan'] || '').slice(0, 1000),
        ...scoreLead({ notes: f['Catatan'] || '', category: f['Kategori Blast'] || '', wa: f['No WA'], city: f['Kota'] || '' }) };
    } }),
  edukit: () => ({ base: process.env.EDUKIT_AIRTABLE_BASE || 'appo57WuaPrR0zICH', table: process.env.EDUKIT_AIRTABLE_TABLE || 'tblYDHGjCyk9tNrmH',
    map: (rec) => {
      const f = rec.fields || {};
      const name = String(f['Nama Lembaga'] || '').trim();
      if (!name) return null;
      const phoneRaw = String(f['Telepon/WA'] || '');
      const wa = pickWa(phoneRaw);
      const notes = String(f['Catatan'] || '');
      return { name, wa, phone_raw: phoneRaw.slice(0, 120) || null, email: f['Email'] || null, business: name,
        city: f['Kota'] || null, category: f['Segmen'] || null, segment: f['Segmen'] || null, priority: f['Prioritas'] || null,
        data_quality: f['Kualitas Data'] || null, website: f['Website'] || null, contact_person: f['Contact Person'] || null,
        has_website: f['Website'] ? true : null, notes: notes.slice(0, 1000),
        ...scoreEdukit({ priority: f['Prioritas'], quality: f['Kualitas Data'], segment: f['Segmen'], wa, email: f['Email'], contact: f['Contact Person'], notes, phoneRaw }) };
    } }),
};

async function syncLeads(b, res) {
  const token = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_TOKEN;
  if (!token) return sendJson(res, 500, { error: 'Token Airtable belum di-set' });
  const which = PRODUCTS.includes(b.product) ? [b.product] : PRODUCTS;
  const result = {}, errors = {};
  for (const product of which) {
    const src = SOURCES[product]();
    let total = 0, batch = [];
    const flush = async () => {
      if (!batch.length) return;
      await sb('crm_leads?on_conflict=airtable_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: batch });
      total += batch.length; batch = [];
    };
    try {
      await airtableAll(token, src.base, src.table, async (rec) => {
        const row = src.map(rec); if (!row) return;
        row.name = row.name.slice(0, 200);
        batch.push({ airtable_id: rec.id, product, source_base: src.base, ...row, updated_at: new Date().toISOString() });
        if (batch.length >= 500) await flush();
      });
      await flush();
      result[product] = total;
    } catch (e) { errors[product] = e.message; }
  }
  const label = { nadi: 'NADI', edukit: 'EduKit' };
  const msg = Object.entries(result).map(([k, n]) => `${label[k]} ${n}`).join(', ');
  await sb('office_events', { method: 'POST', prefer: 'return=minimal', body: { unit_key: 'inti', level: Object.keys(errors).length ? 'peringatan' : 'info',
    message: `Sinkron calon klien dari Airtable: ${msg || '0'} kontak diperbarui & diberi skor.${Object.keys(errors).length ? ' Gagal: ' + Object.keys(errors).map(k => label[k]).join(', ') : ''}`.slice(0, 500) } });
  return sendJson(res, Object.keys(result).length ? 200 : 502, { ok: !Object.keys(errors).length, result, errors });
}

async function updateLead(b, res) {
  const id = parseInt(b.id); if (!id || !LEAD_STATUS.includes(b.status)) return sendJson(res, 400, { error: 'id/status tidak valid' });
  await sb(`crm_leads?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: b.status, updated_at: new Date().toISOString() } });
  return sendJson(res, 200, { ok: true });
}

async function decideApproval(b, res) {
  const rows = await sb(`office_approvals?select=id,desk_key,kind,summary,status,payload,lead_id&id=eq.${encodeURIComponent(b.id)}`);
  const a = rows[0];
  if (!a) return sendJson(res, 404, { error: 'Persetujuan tidak ditemukan' });
  if (a.status !== 'menunggu') return sendJson(res, 409, { error: 'Sudah diputuskan sebelumnya' });
  const now = new Date().toISOString();
  const unit = a.kind === 'outreach' ? 'studio' : null;
  if (b.decision === 'tolak') {
    await sb(`office_approvals?id=eq.${a.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'ditolak', note: String(b.note || '').slice(0, 300), decided_at: now } });
    if (a.lead_id) await sb(`crm_leads?id=eq.${a.lead_id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: b.block ? 'jangan_hubungi' : 'baru', updated_at: now } });
    await sb('office_events', { method: 'POST', prefer: 'return=minimal', body: { unit_key: unit, desk_key: a.desk_key, level: 'info', message: `Ditolak Anda: ${a.summary}`.slice(0, 500) } });
    return sendJson(res, 200, { ok: true, status: 'ditolak' });
  }
  if (b.decision !== 'setuju') return sendJson(res, 400, { error: 'decision harus setuju/tolak' });
  if (a.kind === 'outreach') {
    const since = new Date(Date.now() - 864e5).toISOString();
    const sent = await sb(`office_approvals?select=id&kind=eq.outreach&status=eq.disetujui&decided_at=gte.${since}`);
    if (sent.length >= DAILY_SEND_CAP) return sendJson(res, 429, { error: `Batas kirim harian ${DAILY_SEND_CAP} pesan tercapai — lanjut besok supaya nomor WA aman.` });
    const lead = a.lead_id ? (await sb(`crm_leads?select=id,wa,status&id=eq.${a.lead_id}`))[0] : null;
    if (!lead || !lead.wa) return sendJson(res, 400, { error: 'Nomor WA calon klien tidak valid' });
    if (lead.status === 'jangan_hubungi') return sendJson(res, 400, { error: 'Kontak ini ditandai jangan dihubungi' });
    const message = String(b.message || a.payload?.message || '').trim().slice(0, 1000);
    if (!message) return sendJson(res, 400, { error: 'Pesan kosong' });
    try { await sendWa(lead.wa, message); }
    catch (e) {
      await sb('office_events', { method: 'POST', prefer: 'return=minimal', body: { unit_key: unit, desk_key: a.desk_key, level: 'peringatan', message: `Gagal kirim WA: ${e.message}`.slice(0, 500) } });
      return sendJson(res, 502, { error: 'Gagal kirim WA: ' + e.message });
    }
    await sb(`office_approvals?id=eq.${a.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'disetujui', decided_at: now, payload: { ...(a.payload || {}), message, sent_at: now } } });
    await sb(`crm_leads?id=eq.${lead.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'dihubungi', last_contacted_at: now, updated_at: now } });
    await sb('office_events', { method: 'POST', prefer: 'return=minimal', body: { unit_key: unit, desk_key: a.desk_key, level: 'info', message: `Disetujui & terkirim via WA: ${a.summary}`.slice(0, 500) } });
    return sendJson(res, 200, { ok: true, status: 'terkirim' });
  }
  await sb(`office_approvals?id=eq.${a.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'disetujui', decided_at: now, note: String(b.note || '').slice(0, 300) } });
  await sb('office_events', { method: 'POST', prefer: 'return=minimal', body: { unit_key: unit, desk_key: a.desk_key, level: 'info', message: `Disetujui Anda: ${a.summary}`.slice(0, 500) } });
  return sendJson(res, 200, { ok: true, status: 'disetujui' });
}

module.exports = async (req, res) => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return sendJson(res, 500, { error: 'Database kantor belum terhubung: set SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di Vercel.' });
  const action = (req.query && req.query.action) || 'state';
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  try {
    if (action === 'state' && req.method === 'POST') return await ingest(req, res); // laporan agen (token)
    if (!requireAuth(req, res)) return;                                         // selebihnya wajib login
    if (action === 'state' && req.method === 'GET') return await readState(res);
    if (action === 'leads' && req.method === 'GET') return await readLeads(req, res);
    if (action === 'leads-sync' && req.method === 'POST') return await syncLeads(body || {}, res);
    if (action === 'lead' && req.method === 'POST') return await updateLead(body || {}, res);
    if (action === 'approval' && req.method === 'POST') return await decideApproval(body || {}, res);
    return sendJson(res, 405, { error: 'Aksi tidak dikenal' });
  } catch (e) {
    return sendJson(res, 502, { error: 'Gagal mengakses database kantor: ' + e.message });
  }
};
