/**
 * Penawaran (quotation) NADI — kalkulator, simpan, kirim lewat antrean persetujuan, halaman klien.
 *
 * Prinsip:
 *  - Angka selalu dihitung ulang di server dengan js/quote-calc.js (sumber yang sama dengan dashboard).
 *  - Tarif per jam, jam kerja, biaya dasar & margin TIDAK PERNAH masuk ke halaman klien (pakai clientView).
 *  - Mengirim penawaran ke klien = draf WA di office_approvals (desk "usul", kind "penawaran");
 *    pesan baru terkirim setelah pemilik klik "Setujui & kirim" (lihat decideApproval di api/office/state.js).
 */
const { sb } = require('./supabase');
const QC = require('../js/quote-calc.js');
const { normWa } = require('./leads');

const SETTINGS_KEY = 'kalkulator';
const STATUSES = ['draf', 'menunggu_kirim', 'terkirim', 'diterima', 'ditolak', 'kedaluwarsa'];
const EDITABLE = ['draf'];
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const intId = v => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

async function getSettings() {
  const rows = await sb(`sales_settings?select=value,updated_at&key=eq.${SETTINGS_KEY}`);
  return { settings: QC.mergeSettings(rows[0]?.value), saved: !!rows[0], updated_at: rows[0]?.updated_at || null };
}

async function saveSettings(value) {
  const settings = QC.mergeSettings(value);
  await sb('sales_settings?on_conflict=key', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { key: SETTINGS_KEY, value: settings, updated_at: new Date().toISOString() } });
  return settings;
}

/** Bersihkan input dari form — hanya id komponen/fitur yang dikenal yang dipakai. */
function cleanInputs(settings, raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = QC.defaultInputs(settings);
  const rc = r.components || {}, rf = r.features || {};
  settings.components.forEach(c => {
    const v = rc[c.id]; if (!v || typeof v !== 'object') return;
    out.components[c.id] = { on: !!v.on, hours: Number.isFinite(+v.hours) ? Math.min(Math.max(+v.hours, 0), 1000) : c.hours, fixed: Number.isFinite(+v.fixed) ? Math.min(Math.max(+v.fixed, 0), 1e10) : c.fixed };
  });
  settings.features.forEach(f => {
    const v = rf[f.key]; if (!v || !v.on) return;
    out.features[f.key] = { on: true, complexity: settings.complexity[v.complexity] ? v.complexity : 'sederhana' };
  });
  out.server = QC.SERVERS[r.server] ? r.server : 'shared';
  out.offerPrice = r.offerPrice === '' || r.offerPrice == null || !(+r.offerPrice > 0) ? null : Math.round(+r.offerPrice);
  out.revisions = Number.isFinite(+r.revisions) ? Math.min(Math.max(Math.round(+r.revisions), 0), 50) : settings.defaultRevisions;
  return out;
}

const LIST_COLS = 'id,number,share_token,lead_id,product,client_name,client_contact,client_wa,client_email,project_title,status,revisions,valid_until,price_final,tier,offer_price,yearly_recurring,sent_at,decided_at,viewed_at,created_at,updated_at';

async function listQuotes(q = {}) {
  const f = [`select=${LIST_COLS}`, 'order=updated_at.desc', 'limit=100'];
  if (STATUSES.includes(q.status)) f.push(`status=eq.${q.status}`);
  const lead = intId(q.lead_id); if (lead) f.push(`lead_id=eq.${lead}`);
  const rows = await sb('sales_quotes?' + f.join('&'));
  // Tandai kedaluwarsa saat dibaca (tanpa cron): terkirim + lewat masa berlaku.
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  rows.forEach(r => { if (r.status === 'terkirim' && r.valid_until && r.valid_until < today) r.expired = true; });
  return rows;
}

async function getQuote(id) {
  const rows = await sb(`sales_quotes?select=*&id=eq.${intId(id) || 0}`);
  return rows[0] || null;
}

/** Simpan (baru atau ubah draf). Angka dihitung ulang di sini. */
async function saveQuote(b) {
  const { settings } = await getSettings();
  const inputs = cleanInputs(settings, b.inputs);
  const result = QC.compute(settings, inputs);
  const clientName = clip(b.client_name, 200);
  if (!clientName) throw Object.assign(new Error('Nama klien wajib diisi'), { status: 400 });
  let lead = null;
  const leadId = intId(b.lead_id);
  if (leadId) lead = (await sb(`crm_leads?select=id,name,wa,email,contact_person,product&id=eq.${leadId}`))[0] || null;
  const validDays = settings.validDays;
  const row = {
    lead_id: lead ? lead.id : null,
    product: lead?.product || 'nadi',
    client_name: clientName,
    client_contact: clip(b.client_contact || lead?.contact_person, 200) || null,
    client_wa: normWa(b.client_wa || lead?.wa) || null,
    client_email: clip(b.client_email || lead?.email, 200) || null,
    project_title: clip(b.project_title, 200) || 'Pembuatan Website',
    revisions: inputs.revisions,
    notes: clip(b.notes, 2000) || null,
    inputs, assumptions: settings,
    result: { ...result, client: QC.clientView(settings, inputs, result) },
    cost_base: result.costBase, price_final: result.priceFinal, tier: result.tierLabel,
    offer_price: result.offerPrice, yearly_recurring: result.recurring.totalYearly,
    updated_at: new Date().toISOString(),
  };
  const id = intId(b.id);
  if (id) {
    const cur = await getQuote(id);
    if (!cur) throw Object.assign(new Error('Penawaran tidak ditemukan'), { status: 404 });
    if (!EDITABLE.includes(cur.status)) throw Object.assign(new Error(`Penawaran ${cur.number} sudah ${cur.status.replace('_', ' ')} — duplikat untuk membuat versi baru.`), { status: 409 });
    const out = await sb(`sales_quotes?id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body: row });
    return out[0];
  }
  row.valid_until = new Date(Date.now() + 7 * 3600e3 + validDays * 864e5).toISOString().slice(0, 10);
  const out = await sb('sales_quotes', { method: 'POST', prefer: 'return=representation', body: row });
  await event('info', `Penawaran ${out[0].number} untuk ${clientName} disimpan (${result.tierLabel}, ${QC.formatRp(result.offerPrice)}).`);
  return out[0];
}

async function duplicateQuote(id) {
  const cur = await getQuote(id);
  if (!cur) throw Object.assign(new Error('Penawaran tidak ditemukan'), { status: 404 });
  return saveQuote({ ...cur, id: null, notes: cur.notes, inputs: cur.inputs });
}

async function setQuoteStatus(id, status, note) {
  if (!['draf', 'diterima', 'ditolak', 'kedaluwarsa'].includes(status)) throw Object.assign(new Error('Status tidak valid'), { status: 400 });
  const cur = await getQuote(id);
  if (!cur) throw Object.assign(new Error('Penawaran tidak ditemukan'), { status: 404 });
  if (status === 'draf' && cur.status === 'menunggu_kirim') {
    await sb(`office_approvals?kind=eq.penawaran&status=eq.menunggu&payload->>quote_id=eq.${cur.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'ditolak', note: 'Dikembalikan ke draf', decided_at: new Date().toISOString() } });
  }
  const now = new Date().toISOString();
  await sb(`sales_quotes?id=eq.${cur.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status, decided_at: ['diterima', 'ditolak'].includes(status) ? now : cur.decided_at, notes: note ? clip((cur.notes ? cur.notes + '\n' : '') + note, 2000) : cur.notes, updated_at: now } });
  if (cur.lead_id && status === 'diterima') await sb(`crm_leads?id=eq.${cur.lead_id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'deal', updated_at: now } });
  if (cur.lead_id && status === 'ditolak') await sb(`crm_leads?id=eq.${cur.lead_id}&status=in.(tertarik,membalas,dihubungi)`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'tidak_tertarik', updated_at: now } });
  if (['diterima', 'ditolak'].includes(status)) await event(status === 'diterima' ? 'info' : 'peringatan', `Penawaran ${cur.number} (${cur.client_name}) ${status}.`);
  return { ok: true, status };
}

function quoteUrl(req, quote) {
  const host = process.env.PUBLIC_BASE_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  return `${host.replace(/\/$/, '')}/penawaran/${quote.share_token}`;
}

function defaultMessage(q, url) {
  const c = q.result?.client || {};
  const cp = q.client_contact ? q.client_contact.split(/[\/,;(]/)[0].trim() : '';
  const sapa = !cp ? `Tim ${q.client_name}` : /^(bapak|ibu|pak|bu|dr\.?|drg\.?|prof\.?|kak|mas|mbak|ustadz|ustadzah|h\.|hj\.)\s/i.test(cp) ? cp : `Bapak/Ibu ${cp}`;
  return `Halo ${sapa}, terima kasih atas waktunya. Berikut penawaran ${q.project_title || 'website'} dari NADI (${q.number}):\n\n` +
    `• ${c.packageName || 'Paket'}: ${QC.formatRp(q.offer_price)} (sekali bayar)\n` +
    (q.yearly_recurring ? `• Hosting, maintenance & domain: ${QC.formatRp(q.yearly_recurring)}/tahun\n` : '') +
    `• Berlaku sampai ${fmtDate(q.valid_until)}\n\nDetail lengkap & persetujuan online:\n${url}\n\n` +
    `Kalau ada yang ingin disesuaikan, balas pesan ini saja. Terima kasih!`;
}

/** Siapkan draf WA penawaran → antrean persetujuan (desk Usul). Tidak mengirim apa pun. */
async function requestSend(req, id, message) {
  const q = await getQuote(id);
  if (!q) throw Object.assign(new Error('Penawaran tidak ditemukan'), { status: 404 });
  if (!['draf', 'terkirim'].includes(q.status)) throw Object.assign(new Error(`Penawaran sedang berstatus ${q.status.replace('_', ' ')}`), { status: 409 });
  if (!q.client_wa) throw Object.assign(new Error('Nomor WA klien belum ada — isi dulu di penawaran'), { status: 400 });
  if (q.lead_id) {
    const l = (await sb(`crm_leads?select=status&id=eq.${q.lead_id}`))[0];
    if (l?.status === 'jangan_hubungi') throw Object.assign(new Error('Kontak ini ditandai jangan dihubungi'), { status: 400 });
  }
  const url = quoteUrl(req, q);
  const msg = clip(message || defaultMessage(q, url), 1500);
  await sb('office_approvals', { method: 'POST', prefer: 'return=minimal', body: {
    desk_key: 'usul', kind: 'penawaran', lead_id: q.lead_id,
    summary: clip(`Kirim penawaran ${q.number} (${q.result?.client?.packageName || q.tier}, ${QC.formatRp(q.offer_price)}) ke ${q.client_name}`, 300),
    payload: { message: msg, quote_id: q.id, wa: q.client_wa, url } } });
  await sb(`sales_quotes?id=eq.${q.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'menunggu_kirim', updated_at: new Date().toISOString() } });
  await event('info', `Draf WA penawaran ${q.number} untuk ${q.client_name} menunggu persetujuan Anda.`);
  return { ok: true, url, message: msg };
}

/** Dipanggil dari decideApproval setelah WA penawaran berhasil terkirim / ditolak. */
async function markSent(quoteId, sentAt) {
  await sb(`sales_quotes?id=eq.${intId(quoteId) || 0}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'terkirim', sent_at: sentAt, updated_at: sentAt } });
}
async function markBackToDraft(quoteId) {
  await sb(`sales_quotes?id=eq.${intId(quoteId) || 0}&status=eq.menunggu_kirim`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'draf', updated_at: new Date().toISOString() } });
}

const event = (level, message) => sb('office_events', { method: 'POST', prefer: 'return=minimal', body: { unit_key: 'studio', desk_key: 'usul', level, message: clip(message, 500) } }).catch(() => {});

// ── Halaman penawaran untuk klien (publik, akses dengan token acak 64 karakter) ──
const TOKEN_RE = /^[a-f0-9]{64}$/;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmtDate(d) {
  if (!d) return '-';
  const dt = new Date(String(d).length === 10 ? d + 'T00:00:00+07:00' : d);
  return dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
}

async function findByToken(token) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const rows = await sb(`sales_quotes?select=id,number,share_token,client_name,client_contact,project_title,status,valid_until,offer_price,result,created_at,sent_at,decided_at,viewed_at,lead_id&share_token=eq.${token}`);
  return rows[0] || null;
}

function isExpired(q) {
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  return q.status === 'kedaluwarsa' || (q.status === 'terkirim' && q.valid_until && q.valid_until < today);
}

function renderQuotePage(q, flash) {
  const c = q.result?.client || {};
  const co = c.company || QC.DEFAULTS.company;
  const waDigits = String(co.wa || '').replace(/\D/g, '').replace(/^0/, '62');
  const expired = isExpired(q);
  const accepted = q.status === 'diterima';
  const canAccept = q.status === 'terkirim' && !expired;
  const scope = (c.scope || []).map(g => `<div class="grp"><h4>${esc(g.group)}</h4><ul>${g.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('');
  const rec = c.recurring;
  const waText = encodeURIComponent(`Halo NADI, saya ingin bertanya tentang penawaran ${q.number} untuk ${q.client_name}.`);
  const banner = accepted ? `<div class="note ok">Penawaran ini sudah disetujui pada ${esc(fmtDate(q.decided_at))}. Terima kasih — tim kami akan menghubungi Anda untuk langkah berikutnya.</div>`
    : expired ? `<div class="note warn">Masa berlaku penawaran ini sudah lewat. Hubungi kami untuk penawaran terbaru.</div>`
    : q.status === 'ditolak' ? `<div class="note warn">Penawaran ini sudah ditutup.</div>` : '';
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Penawaran ${esc(q.number)} · NADI</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
<style>
:root{--red:#E11D2C;--orange:#FF7A2E;--ink:#241E1A;--sand:#F0E7DA;--muted:#6b6058;--line:#e4d9ca}
*{box-sizing:border-box}body{margin:0;background:var(--sand);color:var(--ink);font:15px/1.6 Manrope,system-ui,sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:24px 16px 48px}.doc{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(36,30,26,.08)}
.hero{background:linear-gradient(120deg,var(--red),var(--orange));color:#fff;padding:28px 32px}.hero .brand{font:700 14px 'Space Grotesk',system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;opacity:.9}
.hero h1{font:700 28px/1.2 'Space Grotesk',system-ui,sans-serif;margin:10px 0 6px}.hero .meta{opacity:.92;font-size:14px}
.body{padding:28px 32px}.row{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:22px}.row>div{flex:1;min-width:200px}
.lbl{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.val{font-weight:600}
h3{font:700 18px 'Space Grotesk',system-ui,sans-serif;margin:26px 0 10px}.grp h4{margin:14px 0 4px;font-size:14px;color:var(--red)}ul{margin:0;padding-left:20px}
.price{display:flex;justify-content:space-between;align-items:center;border:2px solid var(--ink);border-radius:12px;padding:16px 20px;margin-top:8px}
.price b{font:700 26px 'Space Grotesk',system-ui,sans-serif}table{width:100%;border-collapse:collapse;font-size:14px}td{padding:8px 0;border-bottom:1px solid var(--line)}td:last-child{text-align:right;font-weight:600;white-space:nowrap;padding-left:12px}
.terms li{margin-bottom:4px}.note{padding:12px 16px;border-radius:10px;margin-bottom:18px;font-weight:600}.ok{background:#e7f6ec;color:#17643a}.warn{background:#fff1e6;color:#9a3d06}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:26px}.btn{border:0;border-radius:10px;padding:12px 18px;font:600 15px Manrope,system-ui,sans-serif;cursor:pointer;text-decoration:none;display:inline-block}
.btn-p{background:linear-gradient(120deg,var(--red),var(--orange));color:#fff}.btn-s{background:var(--sand);color:var(--ink)}
form.accept{margin-top:26px;border-top:1px dashed var(--line);padding-top:20px}form.accept input{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;font:15px Manrope,system-ui,sans-serif;margin:6px 0 12px}
.foot{padding:18px 32px;background:#faf6f0;font-size:13px;color:var(--muted)}
@media print{body{background:#fff}.wrap{padding:0}.doc{box-shadow:none;border-radius:0}.actions,form.accept,.noprint{display:none!important}.hero{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
@media (max-width:560px){.hero,.body,.foot{padding-left:18px;padding-right:18px}.hero h1{font-size:22px}.price b{font-size:21px}}
</style></head><body><div class="wrap"><div class="doc">
<div class="hero"><div class="brand">NADI · Nagara Digital Lab Indonesia</div><h1>Penawaran ${esc(q.project_title || 'Website')}</h1>
<div class="meta">No. ${esc(q.number)} · ${esc(fmtDate(q.sent_at || q.created_at))} · Berlaku sampai ${esc(fmtDate(q.valid_until))}</div></div>
<div class="body">${flash ? `<div class="note ok">${esc(flash)}</div>` : ''}${banner}
<div class="row"><div><div class="lbl">Untuk</div><div class="val">${esc(q.client_name)}</div>${q.client_contact ? `<div>${esc(q.client_contact)}</div>` : ''}</div>
<div><div class="lbl">Dari</div><div class="val">${esc(co.name)}</div><div>${esc([co.city, co.web].filter(Boolean).join(' · '))}</div></div></div>
<h3>Ruang lingkup pekerjaan</h3>${scope || '<p>-</p>'}
<h3>Investasi</h3><div class="price"><div><div class="lbl">${esc(c.packageName || 'Paket')}</div><div>Sekali bayar</div></div><b>${esc(QC.formatRp(c.price ?? q.offer_price))}</b></div>
${rec ? `<h3>Biaya berulang (per tahun)</h3><table>${rec.serverLabel ? `<tr><td>Hosting ${esc(rec.serverLabel)} & maintenance (${esc(QC.formatRp(rec.monthly))}/bulan)</td><td>${esc(QC.formatRp(rec.yearlyHosting))}</td></tr>` : ''}${rec.annual ? `<tr><td>Domain, SSL & email</td><td>${esc(QC.formatRp(rec.annual))}</td></tr>` : ''}<tr><td><b>Total per tahun</b></td><td>${esc(QC.formatRp(rec.totalYearly))}</td></tr></table><p style="font-size:13px;color:var(--muted)">Mulai ditagih saat website live, diperpanjang tiap tahun.</p>` : ''}
<h3>Ketentuan</h3><ul class="terms"><li>Termasuk ${esc(c.revisions ?? 2)}× putaran revisi. Revisi tambahan ditagih terpisah.</li><li>Pembayaran: ${esc(c.paymentTerms || '')}</li><li>Pengerjaan dimulai setelah pembayaran pertama dan materi (logo, teks, foto) diterima.</li><li>Harga belum termasuk PPN bila dikenakan.</li></ul>
<div class="actions noprint"><button class="btn btn-s" onclick="window.print()">Cetak / simpan PDF</button>${waDigits ? `<a class="btn btn-s" href="https://wa.me/${esc(waDigits)}?text=${waText}" target="_blank" rel="noopener">Tanya via WhatsApp</a>` : ''}</div>
${canAccept ? `<form class="accept" method="post" action="/penawaran/${esc(q.share_token)}"><h3 style="margin-top:0">Setujui penawaran</h3><p>Dengan menyetujui, Anda menyetujui ruang lingkup, harga, dan ketentuan di atas. Tim kami akan menghubungi Anda untuk invoice pembayaran pertama.</p>
<label class="lbl" for="nm">Nama Anda</label><input id="nm" name="name" required maxlength="120" autocomplete="name"><input type="hidden" name="decision" value="terima">
<button class="btn btn-p" type="submit">Saya setuju dengan penawaran ini</button></form>` : ''}
</div><div class="foot">${esc(co.name)} · WA ${esc(co.wa)} · ${esc(co.email)} · ${esc(co.web)}</div></div></div></body></html>`;
}

/** GET/POST /penawaran/<token> — tanpa login. POST hanya bisa mengubah terkirim → diterima, sekali. */
async function publicQuote(req, res, token, body) {
  const send = (status, html) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.end(html);
  };
  const notFound = () => send(404, '<!doctype html><meta charset="utf-8"><title>Tidak ditemukan</title><p style="font-family:sans-serif;padding:2rem">Penawaran tidak ditemukan atau tautan tidak valid.</p>');
  const q = await findByToken(token);
  if (!q || q.status === 'draf' || q.status === 'menunggu_kirim') return notFound();
  if (req.method === 'POST') {
    const name = clip(body?.name, 120);
    if (body?.decision !== 'terima' || !name) return send(400, renderQuotePage(q, null));
    if (q.status !== 'terkirim' || isExpired(q)) return send(409, renderQuotePage(q, null));
    const now = new Date().toISOString();
    const upd = await sb(`sales_quotes?id=eq.${q.id}&status=eq.terkirim`, { method: 'PATCH', prefer: 'return=representation',
      body: { status: 'diterima', decided_at: now, updated_at: now, notes: clip(`Disetujui online oleh "${name}" pada ${now}`, 500) } });
    if (!upd.length) return send(409, renderQuotePage(q, null));
    if (q.lead_id) await sb(`crm_leads?id=eq.${q.lead_id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'deal', updated_at: now } });
    await event('info', `🎉 ${q.client_name} menyetujui penawaran ${q.number} secara online (oleh ${name}). Siapkan invoice DP.`);
    return send(200, renderQuotePage({ ...q, status: 'diterima', decided_at: now }, 'Terima kasih! Persetujuan Anda sudah kami terima.'));
  }
  if (!q.viewed_at) {
    await sb(`sales_quotes?id=eq.${q.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { viewed_at: new Date().toISOString() } });
    await event('info', `${q.client_name} membuka penawaran ${q.number}.`);
  }
  return send(200, renderQuotePage(q, null));
}

module.exports = { getSettings, saveSettings, listQuotes, getQuote, saveQuote, duplicateQuote, setQuoteStatus, requestSend, markSent, markBackToDraft, publicQuote, renderQuotePage, cleanInputs, STATUSES };
