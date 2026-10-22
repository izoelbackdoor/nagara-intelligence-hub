/**
 * Progres outreach WA otomatis NADI (n8n + Fonnte + bot) dan brief/penawaran dari brief.nagaraku.id.
 * Data dari view Supabase (supabase/migrations/20261022_nadi_progres_views.sql):
 *   nadi_v_ringkasan · nadi_v_progres · nadi_v_penawaran, plus crm_messages untuk aktivitas & percakapan.
 * Hanya baca. Pengiriman tetap diatur n8n (workflow NADI 2/3/4).
 */
const { sb } = require('./supabase');

const JENIS_AKTIVITAS = ['outreach', 'outreach_gagal', 'bot', 'brief_ideal', 'brief_hemat', 'brief_zoom'];

async function readProgress() {
  const [ringkasan, progres, penawaran, aktivitas] = await Promise.all([
    sb('nadi_v_ringkasan?select=*'),
    sb('nadi_v_progres?select=*&limit=300'),
    sb('nadi_v_penawaran?select=*&limit=100'),
    sb(`crm_messages?select=id,lead_id,direction,body,meta,created_at&meta->>jenis=in.(${JENIS_AKTIVITAS.join(',')})&order=id.desc&limit=60`),
  ]);
  const ids = [...new Set((aktivitas || []).map(m => m.lead_id).filter(Number.isInteger))];
  const leads = ids.length ? await sb(`crm_leads?select=id,name,business,category&id=in.(${ids.join(',')})`) : [];
  const byId = Object.fromEntries(leads.map(l => [l.id, l]));
  return {
    generated_at: new Date().toISOString(),
    ringkasan: (ringkasan && ringkasan[0]) || {},
    progres: progres || [],
    penawaran: penawaran || [],
    aktivitas: (aktivitas || []).map(m => {
      const l = byId[m.lead_id] || {};
      return {
        id: m.id, lead_id: m.lead_id, created_at: m.created_at,
        nama: l.business || l.name || `Lead #${m.lead_id}`, kategori: l.category || '',
        jenis: m.meta?.jenis || '', alasan: m.meta?.alasan || '', status_bot: m.meta?.status_bot || '',
        cuplikan: String(m.body || '').slice(0, 160),
      };
    }),
  };
}

async function readConversation(leadId) {
  const id = Number.parseInt(leadId, 10);
  if (!Number.isInteger(id) || id <= 0) { const e = new Error('lead tidak valid'); e.status = 400; throw e; }
  const [lead, messages, briefs] = await Promise.all([
    sb(`crm_leads?select=id,name,business,category,city,status,bot_aktif,bot_summary,wa&id=eq.${id}`),
    sb(`crm_messages?select=id,direction,body,meta,created_at&lead_id=eq.${id}&order=id.asc&limit=200`),
    sb(`nadi_v_penawaran?select=*&lead_id=eq.${id}`),
  ]);
  if (!lead || !lead.length) { const e = new Error('Calon klien tidak ditemukan'); e.status = 404; throw e; }
  return { lead: lead[0], messages: messages || [], briefs: briefs || [] };
}

module.exports = { readProgress, readConversation };
