/**
 * Agen USUL — penyusun pesan perkenalan (zona Studio/Media).
 * Mengambil calon klien skor tertinggi yang belum dihubungi, menulis draf WA personal,
 * lalu MENARUHNYA DI ANTREAN PERSETUJUAN. Tidak ada pesan yang terkirim tanpa klik "Setujui & kirim".
 *
 * Pengaman: maks 10 draf per panggilan, maks 20 draf / 24 jam, maks 20 draf menunggu,
 * batas biaya $0.5/hari, setiap pesan wajib memuat opsi berhenti ("Balas STOP").
 */
const { sb } = require('../supabase');
const { ensureAgent, spentToday, callClaude, logCost, event } = require('./common');

const DESK = 'usul', UNIT = 'studio';
const DAILY_BUDGET_USD = 0.5, DAILY_DRAFT_CAP = 20, QUEUE_CAP = 20, MAX_PER_RUN = 10;
const STOP = 'Balas STOP jika tidak ingin dihubungi lagi.';

// Ringkasan penawaran per produk. Ubah teks ini bila penawaran berubah — agen tidak boleh menambah klaim di luar ini.
const OFFERS = {
  nadi: {
    label: 'NADI',
    pitch: 'Nagara Digital Indonesia (NADI) membantu UMKM tampil profesional di internet: pembuatan website bisnis yang rapi & mudah ditemukan di Google, terhubung ke WhatsApp untuk menerima pesanan/booking.',
    cta: 'menawarkan kirim contoh tampilan website untuk usaha sejenis, gratis tanpa komitmen',
  },
  edukit: {
    label: 'Nagara EduKit',
    pitch: 'Nagara EduKit adalah website siap pakai (SaaS) khusus lembaga training/diklat: profil lembaga, katalog & jadwal pelatihan, pendaftaran peserta online, dan pengelolaan peserta — tanpa perlu tim IT sendiri.',
    cta: 'menawarkan demo singkat 15 menit atau kirim contoh tampilan untuk lembaga sejenis',
  },
};

function parseJsonArray(text) {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('Format jawaban AI tidak terbaca');
  return JSON.parse(m[0]);
}

module.exports = async function runUsul(who, body, res, sendJson) {
  if (who !== 'owner') return sendJson(res, 403, { error: 'Usul hanya dijalankan dari dashboard' });
  const product = OFFERS[body.product] ? body.product : 'nadi';
  const offer = OFFERS[product];
  const want = Math.min(Math.max(parseInt(body.n) || 5, 1), MAX_PER_RUN);
  try {
    await ensureAgent({ desk: DESK, name: 'Usul', tools: ['crm_leads:read', 'office_approvals:write'], budget: DAILY_BUDGET_USD });
    if (await spentToday(DESK) >= DAILY_BUDGET_USD) return sendJson(res, 429, { error: `Batas biaya harian Usul ($${DAILY_BUDGET_USD}) tercapai.` });
    const since = new Date(Date.now() - 864e5).toISOString();
    const [made, queued] = await Promise.all([
      sb(`office_approvals?select=id&kind=eq.outreach&created_at=gte.${since}`),
      sb('office_approvals?select=id&kind=eq.outreach&status=eq.menunggu'),
    ]);
    const room = Math.min(want, DAILY_DRAFT_CAP - made.length, QUEUE_CAP - queued.length);
    if (room <= 0) return sendJson(res, 429, { error: queued.length >= QUEUE_CAP
      ? `Masih ada ${queued.length} draf menunggu persetujuan — putuskan dulu sebelum membuat draf baru.`
      : `Batas ${DAILY_DRAFT_CAP} draf per hari tercapai.` });

    // Mode pilih manual: body.lead_ids = [id, ...] (dipilih pemilik dari tabel). Tanpa itu: skor tertinggi.
    const picked = Array.isArray(body.lead_ids) ? [...new Set(body.lead_ids.map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, MAX_PER_RUN) : [];
    if (picked.length > room) return sendJson(res, 429, { error: `Hanya bisa ${room} draf lagi saat ini (batas harian/antrean). Kurangi pilihan Anda.` });
    const sel = 'select=id,name,city,category,segment,contact_person,website,has_website,score_reason,notes,status,wa';
    const leads = picked.length
      ? await sb(`crm_leads?${sel}&id=in.(${picked.join(',')})&product=eq.${product}&status=eq.baru&wa=not.is.null`)
      : await sb(`crm_leads?${sel}&product=eq.${product}&status=eq.baru&wa=not.is.null&order=score.desc,id.asc&limit=${room}`);
    const skipped = picked.length - (picked.length ? leads.length : 0);
    if (!leads.length) return sendJson(res, 200, { ok: true, drafted: 0, skipped, note: picked.length
      ? 'Kontak yang dipilih tidak bisa dibuatkan draf (bukan status Baru atau tidak punya nomor WA).'
      : 'Tidak ada calon klien baru dengan nomor WA valid. Coba sinkron dari Airtable.' });

    const system = `Anda adalah Usul, penulis pesan perkenalan WhatsApp untuk ${offer.label} (Nagara Digital Indonesia). Penulis/pengirim: Imam dari Nagara Digital Indonesia.
Penawaran (JANGAN menambah klaim, harga, diskon, testimoni, atau angka apa pun di luar ini): ${offer.pitch}
Ajakan: ${offer.cta}.
Aturan setiap pesan:
- Bahasa Indonesia sopan, hangat, natural seperti ditulis manusia; sapa nama usaha/lembaga (dan nama kontak jika ada).
- Personal: kaitkan dengan bidang/segmen dan kota mereka. Jangan berpura-pura pernah bertemu atau sudah kenal.
- Maksimal 420 karakter sebelum kalimat penutup. Tanpa emoji berlebihan (maks 1), tanpa huruf kapital semua, tanpa tautan.
- Akhiri persis dengan kalimat: "${STOP}"
Jawab HANYA dengan JSON array: [{"id": <id>, "message": "<pesan>"}] untuk setiap calon klien.`;
    const user = leads.map(l => JSON.stringify({ id: l.id, nama: l.name, kontak: l.contact_person || undefined, kota: l.city || undefined,
      bidang: l.segment || l.category || undefined, punya_website: l.has_website, catatan: String(l.notes || '').slice(0, 200) || undefined })).join('\n');
    const { text, usage } = await callClaude(system, `Calon klien:\n${user}`, 400 * leads.length + 200);
    await logCost(DESK, usage);

    const byId = new Map(leads.map(l => [l.id, l]));
    let drafted = 0;
    for (const d of parseJsonArray(text)) {
      const lead = byId.get(Number(d.id)); if (!lead) continue;
      let msg = String(d.message || '').trim(); if (!msg) continue;
      if (!msg.includes('STOP')) msg += '\n\n' + STOP;
      msg = msg.slice(0, 700);
      await sb('office_approvals', { method: 'POST', prefer: 'return=minimal', body: {
        desk_key: DESK, kind: 'outreach', lead_id: lead.id,
        summary: `WA perkenalan ${offer.label} ke ${lead.name}${lead.city ? ' (' + lead.city + ')' : ''}`.slice(0, 300),
        payload: { message: msg, product } } });
      await sb(`crm_leads?id=eq.${lead.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'draft', updated_at: new Date().toISOString() } });
      byId.delete(lead.id); drafted++;
    }
    await event(UNIT, DESK, 'info', `Usul menyiapkan ${drafted} draf WA ${offer.label} — menunggu persetujuan Anda.`);
    return sendJson(res, 200, { ok: true, drafted, skipped, product });
  } catch (e) {
    try { await event(UNIT, DESK, 'bahaya', 'Usul gagal membuat draf: ' + String(e.message).slice(0, 300)); } catch {}
    return sendJson(res, 500, { error: e.message });
  }
};
