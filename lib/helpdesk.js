/**
 * Helpdesk NADI — tiket support klien.
 *
 * Alur:
 *  - WA masuk dari klien berstatus "deal" (atau nomor yang punya tiket terbuka) → otomatis jadi/masuk tiket
 *    (dipanggil dari lib/inbound.js). Tiket juga bisa dibuat manual / dari percakapan WA / dari email.
 *  - SLA = batas waktu RESPON BERIKUTNYA dari kita, diukur dari pesan klien terakhir:
 *      urgent 2 jam · tinggi 4 jam · normal 24 jam · rendah 48 jam. Dikosongkan saat kita membalas.
 *  - Balasan ke klien hanya terkirim saat pemilik klik "Kirim" di dashboard (draf AI dari agen Rawat
 *    hanya mengisi kotak balasan).
 */
const { sb } = require('./supabase');
const { normWa } = require('./leads');
const { sendWa } = require('./wa');

const SLA_HOURS = { urgent: 2, tinggi: 4, normal: 24, rendah: 48 };
const PRIORITIES = Object.keys(SLA_HOURS);
const CATEGORIES = ['teknis', 'tagihan', 'permintaan_fitur', 'pertanyaan', 'keluhan', 'lainnya'];
const STATUSES = ['baru', 'dibuka', 'menunggu_klien', 'selesai', 'ditutup'];
const OPEN = ['baru', 'dibuka', 'menunggu_klien'];
const CHANNELS = ['wa', 'email', 'manual', 'web'];
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const intId = v => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const slaFrom = (priority, from = Date.now()) => new Date(from + (SLA_HOURS[priority] || 24) * 3600e3).toISOString();

/** Tebakan awal tanpa AI (gratis) — agen Rawat bisa memperbaikinya. */
function triage(text) {
  const t = String(text || '').toLowerCase();
  let category = 'pertanyaan', priority = 'normal';
  if (/tagihan|invoice|faktur|transfer|bayar|pembayaran|perpanjang|kwitansi|refund/.test(t)) category = 'tagihan';
  if (/tambah(kan)? (fitur|menu|halaman)|fitur baru|bisa (dibuat|ditambah)|request|permintaan/.test(t)) category = 'permintaan_fitur';
  // Keluhan dicek sebelum teknis: "website mati, pelanggan komplain" adalah masalah teknis.
  if (/kecewa|komplain|keluh|parah|tidak puas|marah|lama sekali|belum juga/.test(t)) category = 'keluhan';
  if (/error|bug|tidak bisa|gak bisa|ga bisa|nggak bisa|tidak muncul|gagal|rusak|lemot|lambat|down|mati|blank|404|500|login/.test(t)) category = 'teknis';
  const outage = /(website|web|situs|toko online|aplikasi|sistem)\b[^.?!\n]{0,25}\b(mati|down|offline|blank|(tidak|gak|ga|nggak|ngga) bisa (dibuka|diakses|dibuka sama sekali))/.test(t)
    || /(tidak|gak|ga|nggak) bisa diakses|kena hack|diretas|hacked|(pembayaran|checkout|transaksi)\b[^.?!\n]{0,15}\b(gagal|error)/.test(t);
  if (outage) priority = 'urgent';
  else if (/urgent|segera|darurat|asap|hari ini juga|secepatnya|kecewa|komplain|tidak puas|marah/.test(t) || category === 'keluhan') priority = 'tinggi';
  else if (category === 'teknis') priority = 'tinggi';
  else if (category === 'permintaan_fitur') priority = 'rendah';
  return { category, priority };
}

function subjectFrom(text) {
  const first = String(text || '').replace(/\s+/g, ' ').trim();
  return first.length > 80 ? first.slice(0, 77) + '…' : (first || 'Permintaan bantuan');
}

const event = (level, message) => sb('office_events', { method: 'POST', prefer: 'return=minimal',
  body: { unit_key: 'studio', desk_key: 'rawat', level, message: clip(message, 500) } }).catch(() => {});

async function addMessage(ticketId, direction, channel, body, meta = {}) {
  await sb('hd_messages', { method: 'POST', prefer: 'return=minimal', body: { ticket_id: ticketId, direction, channel, body: clip(body, 4000), meta } });
}

async function createTicket(b) {
  const wa = normWa(b.wa);
  const email = clip(b.email, 200) || null;
  const body = clip(b.body || b.message, 4000);
  let lead = null;
  const leadId = intId(b.lead_id);
  if (leadId) lead = (await sb(`crm_leads?select=id,name,wa,email&id=eq.${leadId}`))[0] || null;
  else if (wa) lead = (await sb(`crm_leads?select=id,name,wa,email&wa=eq.${wa}&order=id&limit=1`))[0] || null;
  const name = clip(b.client_name || lead?.name, 200);
  if (!name) throw err('Nama klien wajib diisi');
  if (!body && !clip(b.subject, 200)) throw err('Isi keluhan/pertanyaan wajib diisi');
  const guess = triage(`${b.subject || ''} ${body}`);
  const priority = PRIORITIES.includes(b.priority) ? b.priority : guess.priority;
  const category = CATEGORIES.includes(b.category) ? b.category : guess.category;
  const now = new Date().toISOString();
  const row = {
    lead_id: lead?.id || null, quote_id: intId(b.quote_id), client_name: name,
    wa: wa || (lead?.wa ?? null), email: email || lead?.email || null,
    channel: CHANNELS.includes(b.channel) ? b.channel : 'manual',
    subject: clip(b.subject, 200) || subjectFrom(body), category, priority, status: 'baru',
    sla_due_at: slaFrom(priority), last_message_at: now,
  };
  const out = await sb('hd_tickets', { method: 'POST', prefer: 'return=representation', body: row });
  const t = out[0];
  if (body) await addMessage(t.id, 'in', row.channel === 'manual' ? 'manual' : row.channel, body, b.meta || {});
  await event(priority === 'urgent' ? 'bahaya' : priority === 'tinggi' ? 'peringatan' : 'info',
    `Tiket ${t.number} (${priority}) dari ${name}: ${row.subject}`);
  return t;
}

/** WA masuk → tiket. Dipanggil dari lib/inbound.js; tidak pernah melempar error ke webhook. */
async function routeInbound({ wa, text, lead, channel }) {
  const num = normWa(wa); if (!num || !text) return null;
  const open = await sb(`hd_tickets?select=id,number,status,priority,first_response_at&wa=eq.${num}&status=in.(${OPEN.join(',')})&order=last_message_at.desc&limit=1`);
  const now = new Date().toISOString();
  if (open[0]) {
    const t = open[0];
    await addMessage(t.id, 'in', 'wa', text, { via: channel });
    // Klien membalas → giliran kita lagi; SLA dihitung ulang dari sekarang.
    await sb(`hd_tickets?id=eq.${t.id}`, { method: 'PATCH', prefer: 'return=minimal', body: {
      status: t.status === 'baru' ? 'baru' : 'dibuka', sla_due_at: slaFrom(t.priority), last_message_at: now, updated_at: now } });
    await event('info', `Pesan baru di tiket ${t.number}${lead ? ' dari ' + lead.name : ''}: "${clip(text, 120)}"`);
    return { ticket_id: t.id, number: t.number, created: false };
  }
  if (!lead || lead.status !== 'deal') return null; // calon klien biasa tetap di alur CRM/sales
  const t = await createTicket({ lead_id: lead.id, client_name: lead.name, wa: num, channel: 'wa', body: text, meta: { via: channel } });
  return { ticket_id: t.id, number: t.number, created: true };
}

async function listTickets(q = {}) {
  const f = ['select=id,number,lead_id,quote_id,client_name,wa,email,channel,subject,category,priority,status,summary,sla_due_at,first_response_at,resolved_at,last_message_at,created_at,updated_at', 'limit=200'];
  if (q.status === 'terbuka' || !q.status) f.push(`status=in.(${OPEN.join(',')})`);
  else if (STATUSES.includes(q.status)) f.push(`status=eq.${q.status}`);
  else if (q.status !== 'semua') f.push(`status=in.(${OPEN.join(',')})`);
  if (PRIORITIES.includes(q.priority)) f.push(`priority=eq.${q.priority}`);
  if (CATEGORIES.includes(q.category)) f.push(`category=eq.${q.category}`);
  if (q.q) { const t = encodeURIComponent(`*${String(q.q).replace(/[*,()]/g, ' ').slice(0, 60)}*`); f.push(`or=(client_name.ilike.${t},subject.ilike.${t},number.ilike.${t})`); }
  f.push('order=last_message_at.desc');
  const [rows, open] = await Promise.all([
    sb('hd_tickets?' + f.join('&')),
    sb(`hd_tickets?select=status,priority,sla_due_at&status=in.(${OPEN.join(',')})`),
  ]);
  const now = Date.now();
  const since = new Date(now - 7 * 864e5).toISOString();
  const solved = await sb(`hd_tickets?select=created_at,first_response_at,resolved_at&resolved_at=gte.${since}`);
  const frt = solved.filter(r => r.first_response_at).map(r => (new Date(r.first_response_at) - new Date(r.created_at)) / 3600e3);
  const stats = {
    open: open.length,
    waiting_us: open.filter(r => r.status !== 'menunggu_klien').length,
    overdue: open.filter(r => r.status !== 'menunggu_klien' && r.sla_due_at && new Date(r.sla_due_at).getTime() < now).length,
    urgent: open.filter(r => r.priority === 'urgent' || r.priority === 'tinggi').length,
    solved_7d: solved.length,
    avg_first_response_h: frt.length ? Math.round(frt.reduce((a, b) => a + b, 0) / frt.length * 10) / 10 : null,
  };
  rows.forEach(r => { r.overdue = OPEN.includes(r.status) && r.status !== 'menunggu_klien' && r.sla_due_at && new Date(r.sla_due_at).getTime() < now; });
  return { rows, stats };
}

async function getTicket(id) {
  const t = (await sb(`hd_tickets?select=*&id=eq.${intId(id) || 0}`))[0];
  if (!t) throw err('Tiket tidak ditemukan', 404);
  const [messages, quotes, lead] = await Promise.all([
    sb(`hd_messages?select=id,direction,channel,body,meta,created_at&ticket_id=eq.${t.id}&order=created_at&limit=300`),
    t.lead_id ? sb(`sales_quotes?select=id,number,status,tier,offer_price,valid_until,project_title&lead_id=eq.${t.lead_id}&order=created_at.desc&limit=5`) : [],
    t.lead_id ? sb(`crm_leads?select=id,name,status,city,category,segment,contact_person,product&id=eq.${t.lead_id}`).then(r => r[0] || null) : null,
  ]);
  const history = t.wa ? await sb(`hd_tickets?select=id,number,subject,status,created_at&wa=eq.${t.wa}&id=neq.${t.id}&order=created_at.desc&limit=5`) : [];
  return { ticket: t, messages, quotes, lead, history };
}

async function updateTicket(b) {
  const t = (await sb(`hd_tickets?select=*&id=eq.${intId(b.id) || 0}`))[0];
  if (!t) throw err('Tiket tidak ditemukan', 404);
  const now = new Date().toISOString();
  const patch = { updated_at: now };
  if (PRIORITIES.includes(b.priority) && b.priority !== t.priority) {
    patch.priority = b.priority;
    if (t.sla_due_at) patch.sla_due_at = slaFrom(b.priority, new Date(t.last_message_at).getTime());
  }
  if (CATEGORIES.includes(b.category)) patch.category = b.category;
  if (b.subject != null && clip(b.subject, 200)) patch.subject = clip(b.subject, 200);
  if (STATUSES.includes(b.status) && b.status !== t.status) {
    patch.status = b.status;
    if (b.status === 'selesai' || b.status === 'ditutup') { patch.resolved_at = now; patch.sla_due_at = null; }
    if (OPEN.includes(b.status) && !OPEN.includes(t.status)) { patch.resolved_at = null; patch.sla_due_at = slaFrom(patch.priority || t.priority); }
    if (b.status === 'menunggu_klien') patch.sla_due_at = null;
    await addMessage(t.id, 'note', 'sistem', `Status: ${t.status} → ${b.status}`);
  }
  await sb(`hd_tickets?id=eq.${t.id}`, { method: 'PATCH', prefer: 'return=minimal', body: patch });
  return { ok: true };
}

async function sendEmail(to, subject, text) {
  const host = process.env.EMAIL_SMTP_HOST, user = process.env.EMAIL_SMTP_USER || process.env.GMAIL_USER, pass = process.env.EMAIL_SMTP_PASS || process.env.GMAIL_PASS;
  if (!user || !pass) throw new Error('SMTP email belum di-set (EMAIL_SMTP_* atau GMAIL_USER/GMAIL_PASS)');
  const nodemailer = require('nodemailer');
  const t = host ? nodemailer.createTransport({ host, port: parseInt(process.env.EMAIL_SMTP_PORT || '587', 10), secure: process.env.EMAIL_SMTP_PORT === '465', auth: { user, pass } })
    : nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  await t.sendMail({ from: `NADI Support <${process.env.EMAIL_FROM || user}>`, to, subject, text });
}

/** Balasan pemilik ke klien (WA/email) atau catatan internal. Klik "Kirim" = persetujuan pemilik. */
async function replyTicket(b) {
  const t = (await sb(`hd_tickets?select=*&id=eq.${intId(b.id) || 0}`))[0];
  if (!t) throw err('Tiket tidak ditemukan', 404);
  const text = clip(b.body, 3000);
  if (!text) throw err('Pesan kosong');
  const now = new Date().toISOString();
  if (b.kind === 'note') {
    await addMessage(t.id, 'note', 'manual', text);
    await sb(`hd_tickets?id=eq.${t.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { updated_at: now } });
    return { ok: true, sent: false };
  }
  const via = b.via === 'email' ? 'email' : 'wa';
  if (via === 'wa') {
    if (!t.wa) throw err('Tiket ini tidak punya nomor WA — balas lewat email atau isi nomor dulu');
    if (t.lead_id) {
      const l = (await sb(`crm_leads?select=status&id=eq.${t.lead_id}`))[0];
      if (l?.status === 'jangan_hubungi') throw err('Kontak ini ditandai jangan dihubungi');
    }
    await sendWa(t.wa, text);
    if (t.lead_id) await sb('crm_messages', { method: 'POST', prefer: 'return=minimal', body: { lead_id: t.lead_id, wa: t.wa, direction: 'out', channel: 'fonnte', body: text, meta: { ticket: t.number } } }).catch(() => {});
  } else {
    if (!t.email) throw err('Tiket ini tidak punya alamat email');
    await sendEmail(t.email, `[${t.number}] ${t.subject}`, text);
  }
  await addMessage(t.id, 'out', via, text, { ai_draft_used: !!b.from_draft });
  const close = !!b.close;
  await sb(`hd_tickets?id=eq.${t.id}`, { method: 'PATCH', prefer: 'return=minimal', body: {
    status: close ? 'selesai' : 'menunggu_klien', sla_due_at: null, first_response_at: t.first_response_at || now,
    resolved_at: close ? now : null, ai_draft: null, updated_at: now } });
  return { ok: true, sent: true, via };
}

/** Jadikan tiket dari percakapan WA calon klien/klien (pakai pesan masuk terakhir). */
async function ticketFromLead(leadId) {
  const lead = (await sb(`crm_leads?select=id,name,wa,email&id=eq.${intId(leadId) || 0}`))[0];
  if (!lead) throw err('Kontak tidak ditemukan', 404);
  if (lead.wa) {
    const open = await sb(`hd_tickets?select=id,number&wa=eq.${lead.wa}&status=in.(${OPEN.join(',')})&limit=1`);
    if (open[0]) return { ...open[0], existing: true };
  }
  const last = (await sb(`crm_messages?select=body&lead_id=eq.${lead.id}&direction=eq.in&order=created_at.desc&limit=1`))[0];
  const t = await createTicket({ lead_id: lead.id, client_name: lead.name, wa: lead.wa, email: lead.email, channel: 'wa', body: last?.body || '(dibuat dari percakapan WA)' });
  return { id: t.id, number: t.number, existing: false };
}

module.exports = { triage, createTicket, routeInbound, listTickets, getTicket, updateTicket, replyTicket, ticketFromLead, SLA_HOURS, PRIORITIES, CATEGORIES, STATUSES, OPEN };
