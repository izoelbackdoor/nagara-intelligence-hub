/**
 * Pesan WA masuk → CRM. Dipakai oleh webhook Fonnte (api/inbox/webhook-wa.js)
 * dan oleh wacrm / WhatsApp Cloud API lewat POST /api/office/wa-inbound.
 *  - simpan ke crm_messages (riwayat percakapan per calon klien)
 *  - "STOP" → status jangan_hubungi + batalkan draf yang menunggu
 *  - balasan lain dari kontak yang sudah dihubungi → status "membalas"
 */
const { sb } = require('./supabase');
const { normWa } = require('./leads');

const STOP_RE = /^\s*(stop|berhenti|unsubscribe|jangan\s+hubungi)\b/i;

async function handleInbound({ wa, text, channel = 'fonnte', meta = {} }) {
  const num = normWa(wa);
  const body = String(text || '').trim().slice(0, 2000);
  if (!num || !body) return { ok: false, reason: 'nomor/pesan kosong' };
  const leads = await sb(`crm_leads?select=id,name,status,product&wa=eq.${num}&order=id&limit=1`);
  const lead = leads[0] || null;
  await sb('crm_messages', { method: 'POST', prefer: 'return=minimal', body: { lead_id: lead?.id || null, wa: num, direction: 'in', channel, body, meta } });
  if (!lead) return { ok: true, matched: false };
  const now = new Date().toISOString();
  let status = lead.status;
  if (STOP_RE.test(body)) {
    status = 'jangan_hubungi';
    await sb(`office_approvals?lead_id=eq.${lead.id}&status=eq.menunggu`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'ditolak', note: 'Kontak membalas STOP', decided_at: now } });
  } else if (['baru', 'draft', 'dihubungi'].includes(lead.status)) {
    status = 'membalas';
  }
  if (status !== lead.status) await sb(`crm_leads?id=eq.${lead.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status, updated_at: now } });
  const msg = status === 'jangan_hubungi' && lead.status !== 'jangan_hubungi'
    ? `${lead.name} membalas STOP — ditandai jangan dihubungi.`
    : `${lead.name} membalas WA: "${body.slice(0, 120)}"`;
  await sb('office_events', { method: 'POST', prefer: 'return=minimal', body: { unit_key: 'studio', desk_key: 'usul', level: status === 'jangan_hubungi' ? 'peringatan' : 'info', message: msg.slice(0, 500) } });
  return { ok: true, matched: true, lead_id: lead.id, status };
}

async function logOutbound({ lead_id, wa, text, channel = 'fonnte', meta = {} }) {
  await sb('crm_messages', { method: 'POST', prefer: 'return=minimal', body: { lead_id, wa, direction: 'out', channel, body: String(text).slice(0, 2000), meta } });
}

module.exports = { handleInbound, logOutbound, STOP_RE };
