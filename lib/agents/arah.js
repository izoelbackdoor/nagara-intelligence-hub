/**
 * Agen ARAH — Chief of Staff (zona Inti).
 * Merangkum aktivitas semua karyawan AI menjadi brief singkat untuk Anda,
 * menyorot yang butuh perhatian & antrean persetujuan.
 *
 * Dipanggil oleh:
 *  - Vercel Cron (07:00 & 17:00 WIB) dengan header Authorization: Bearer <CRON_SECRET>
 *  - Tombol "Minta brief sekarang" di dashboard (wajib login)
 *
 * Pengaman: tidak mengambil keputusan / tidak mengirim apa pun ke luar selain email brief ke
 * pemilik (opsional, BRIEF_EMAIL_TO), batas biaya harian, semua aksi tercatat di office_events.
 * Env: CLAUDE_API_KEY, CRON_SECRET, SUPABASE_*, opsional GMAIL_USER/GMAIL_PASS/BRIEF_EMAIL_TO
 */
const { sb } = require('../supabase');
const { ensureAgent: ensure, spentToday: spent, callClaude, logCost } = require('./common');

const DESK = 'arah';
const DAILY_BUDGET_USD = 0.5;
const ensureAgent = () => ensure({ desk: DESK, name: 'Arah', tools: ['office_db:read', 'office_events:write', 'email:owner'], budget: DAILY_BUDGET_USD });
const spentToday = () => spent(DESK);

async function sendEmail(subject, text) {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_PASS, to = process.env.BRIEF_EMAIL_TO;
  if (!user || !pass || !to) return false;
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  await t.sendMail({ from: `Arah · Nagara Command Center <${user}>`, to, subject, text });
  return true;
}

module.exports = async function runArah(who, res, sendJson) {
  try {
    await ensureAgent();
    const spent = await spentToday();
    if (spent >= DAILY_BUDGET_USD) {
      await sb('office_events', { method: 'POST', prefer: 'return=minimal', body: { unit_key: 'inti', desk_key: DESK, level: 'peringatan', message: `Brief dilewati: batas biaya harian $${DAILY_BUDGET_USD} tercapai.` } });
      return sendJson(res, 200, { ok: false, skipped: 'budget' });
    }
    const since = new Date(Date.now() - 864e5).toISOString();
    const [desks, events, approvals] = await Promise.all([
      sb('office_desks?select=key,name,unit_key,status,last_seen_at&status=eq.aktif'),
      sb(`office_events?select=desk_key,level,message,created_at&created_at=gte.${since}&desk_key=neq.${DESK}&order=created_at&limit=200`),
      sb('office_approvals?select=desk_key,kind,summary,created_at&status=eq.menunggu&order=created_at'),
    ]);
    const now = Date.now();
    const roster = desks.filter(d => d.key !== DESK).map(d => {
      const m = d.last_seen_at ? Math.round((now - new Date(d.last_seen_at).getTime()) / 60000) : null;
      return `- ${d.name} (${d.unit_key}): ${m === null ? 'belum pernah lapor' : m < 15 ? 'online' : `terakhir lapor ${m} menit lalu`}`;
    }).join('\n') || '- (tidak ada)';
    const log = events.map(e => `[${e.created_at.slice(11, 16)} UTC] ${e.desk_key || 'sistem'} · ${e.level}: ${e.message}`).join('\n') || '(tidak ada laporan 24 jam terakhir)';
    const appr = approvals.map(a => `- ${a.desk_key || '?'} (${a.kind}): ${a.summary}`).join('\n') || '- (kosong)';
    const system = 'Anda adalah Arah, Chief of Staff AI untuk Nagara Group Indonesia. Tulis brief untuk pemilik (Aa Imam) dalam Bahasa Indonesia yang lugas, tanpa basa-basi. Format: 1) Ringkasan (2-3 kalimat), 2) Perlu perhatian (poin, hanya jika ada masalah/agen tidak lapor), 3) Menunggu persetujuan Anda (poin), 4) Satu saran tindakan paling penting hari ini. Maksimal 180 kata. Jangan mengarang data yang tidak ada di input; jika data kosong, katakan apa adanya.';
    const user = `Waktu sekarang: ${new Date().toISOString()}\n\nKaryawan AI aktif:\n${roster}\n\nLog 24 jam:\n${log}\n\nAntrean persetujuan:\n${appr}`;
    const { text, usage } = await callClaude(system, user);
    const usd = await logCost(DESK, usage);
    const jam = new Date(Date.now() + 7 * 3600e3).getUTCHours();
    const label = jam < 12 ? 'Brief pagi' : 'Brief sore';
    await sb('office_events', { method: 'POST', prefer: 'return=minimal', body: { unit_key: 'inti', desk_key: DESK, level: 'info', message: `${label}: ${text}`.slice(0, 500), meta: { brief: text, trigger: who } } });
    let emailed = false;
    try { emailed = await sendEmail(`${label} · Nagara Command Center`, text); }
    catch (e) { await sb('office_events', { method: 'POST', prefer: 'return=minimal', body: { unit_key: 'inti', desk_key: DESK, level: 'peringatan', message: 'Gagal mengirim email brief: ' + String(e.message).slice(0, 200) } }); }
    return sendJson(res, 200, { ok: true, brief: text, emailed, usd: Number(usd.toFixed(5)) });
  } catch (e) {
    try { await sb('office_events', { method: 'POST', prefer: 'return=minimal', body: { unit_key: 'inti', desk_key: DESK, level: 'bahaya', message: 'Arah gagal membuat brief: ' + String(e.message).slice(0, 300) } }); } catch {}
    return sendJson(res, 500, { error: e.message });
  }
};
