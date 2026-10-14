/**
 * Agen RAWAT — account manager & support klien (zona Studio NADI).
 * Untuk satu tiket helpdesk: merangkum masalah, menyarankan kategori & prioritas, dan menulis
 * DRAF balasan dari knowledge base (kb/faq.md, kb/product-brief.md, kb/sop-reply.md) + data
 * penawaran klien di database. Draf hanya mengisi kotak balasan — pemilik yang menekan "Kirim".
 *
 * Pengaman: dipanggil hanya dari dashboard (login), batas biaya $0.5/hari, tidak boleh menyebut
 * harga/diskon/tanggal selesai di luar data penawaran klien, gagal AI → draf template sopan.
 */
const fs = require('fs');
const path = require('path');
const { sb } = require('../supabase');
const { ensureAgent, spentToday, callClaude, logCost, event } = require('./common');
const { CATEGORIES, PRIORITIES } = require('../helpdesk');
const QC = require('../../js/quote-calc.js');

const DESK = 'rawat', UNIT = 'studio', DAILY_BUDGET_USD = 0.5;
const kb = f => { try { return fs.readFileSync(path.join(process.cwd(), 'kb', f), 'utf8').slice(0, 4000); } catch { return ''; } };

function templateReply(t) {
  const sapa = `Halo ${t.client_name}`;
  const isi = {
    teknis: 'terima kasih sudah melapor. Kami sedang mengecek kendalanya dan akan mengabari perkembangannya secepatnya. Jika ada, mohon kirimkan tangkapan layar atau langkah saat kendala muncul agar kami bisa memperbaiki lebih cepat.',
    tagihan: 'terima kasih atas pesannya. Kami cek dulu data tagihan Anda dan akan kami konfirmasi kembali secepatnya.',
    permintaan_fitur: 'terima kasih atas masukannya. Permintaan ini kami catat dan akan kami kaji kebutuhannya, lalu kami kabari estimasi waktu dan biayanya bila ada.',
    keluhan: 'mohon maaf atas ketidaknyamanannya, dan terima kasih sudah menyampaikan langsung ke kami. Kami sedang menindaklanjuti dan akan segera mengabari Anda.',
  }[t.category] || 'terima kasih atas pesannya. Kami akan bantu dan segera mengabari Anda kembali.';
  return `${sapa}, ${isi}\n\nSalam,\nImam — NADI`;
}

module.exports = async function runRawat(who, body, res, sendJson) {
  if (who !== 'owner') return sendJson(res, 403, { error: 'Rawat hanya dijalankan dari dashboard' });
  const id = parseInt(body.ticket_id, 10);
  if (!Number.isInteger(id) || id <= 0) return sendJson(res, 400, { error: 'ticket_id wajib' });
  try {
    const t = (await sb(`hd_tickets?select=*&id=eq.${id}`))[0];
    if (!t) return sendJson(res, 404, { error: 'Tiket tidak ditemukan' });
    await ensureAgent({ desk: DESK, name: 'Rawat', tools: ['hd_tickets:read', 'hd_tickets:draft', 'sales_quotes:read'], budget: DAILY_BUDGET_USD });
    const [msgs, quotes] = await Promise.all([
      sb(`hd_messages?select=direction,body,created_at&ticket_id=eq.${id}&direction=neq.note&order=created_at.desc&limit=12`),
      t.lead_id ? sb(`sales_quotes?select=number,status,tier,offer_price,yearly_recurring,valid_until,project_title&lead_id=eq.${t.lead_id}&order=created_at.desc&limit=3`) : [],
    ]);
    const convo = msgs.reverse().map(m => `${m.direction === 'in' ? 'KLIEN' : 'NADI'} (${m.created_at.slice(0, 16).replace('T', ' ')} UTC): ${m.body.slice(0, 800)}`).join('\n') || '(belum ada pesan)';
    const quoteInfo = quotes.length ? quotes.map(q => `- ${q.number} · ${q.project_title || 'Website'} · paket ${q.tier} · ${QC.formatRp(q.offer_price)} sekali bayar` +
      (q.yearly_recurring ? ` + ${QC.formatRp(q.yearly_recurring)}/tahun` : '') + ` · status ${q.status}`).join('\n') : '(tidak ada)';

    let out, source = 'ai', aiError = null;
    if (await spentToday(DESK) >= DAILY_BUDGET_USD) { aiError = `batas biaya harian $${DAILY_BUDGET_USD} tercapai`; }
    else {
      const system = `Anda adalah Rawat, account manager & support klien NADI (Nagara Digital Lab Indonesia), agensi digital di Bandung. Penanda tangan: Imam — NADI.
Tugas: baca tiket helpdesk, lalu jawab HANYA dengan JSON:
{"category": salah satu ${JSON.stringify(CATEGORIES)}, "priority": salah satu ${JSON.stringify(PRIORITIES)}, "summary": "ringkasan masalah 1 kalimat untuk pemilik", "reply": "draf balasan WhatsApp ke klien", "needs": "info yang perlu dicek pemilik sebelum mengirim, atau kosong"}
Aturan prioritas: urgent = website/pembayaran klien mati atau diretas; tinggi = fitur penting rusak atau klien kecewa; normal = pertanyaan/permintaan biasa; rendah = ide/permintaan fitur tanpa tenggat.
Aturan balasan:
- Bahasa Indonesia sopan, hangat, ringkas (maks 4 paragraf pendek), tanpa emoji berlebihan. Ikuti SOP balasan di bawah.
- JANGAN mengarang fakta: jangan menjanjikan tanggal selesai, jangan menyebut harga/diskon/biaya baru. Angka hanya boleh dari "Penawaran klien" di bawah, dan hanya jika klien menanyakannya.
- Untuk permintaan fitur/biaya tambahan: sampaikan akan dibuatkan penawaran resmi.
- Untuk masalah teknis: akui, minta detail yang dibutuhkan (tangkapan layar, halaman, waktu kejadian), sampaikan sedang dicek.
- Jangan mengaku sudah memperbaiki sesuatu. Jangan menyebut bahwa Anda AI.
SOP balasan:\n${kb('sop-reply.md')}\n\nProduct brief:\n${kb('product-brief.md')}\n\nFAQ:\n${kb('faq.md')}`;
      const user = `Tiket ${t.number} · klien: ${t.client_name} · kanal: ${t.channel} · kategori saat ini: ${t.category} · prioritas saat ini: ${t.priority}\nSubjek: ${t.subject}\n\nPenawaran klien:\n${quoteInfo}\n\nPercakapan (lama → baru):\n${convo}`;
      try {
        const { text, usage } = await callClaude(system, user, 900);
        await logCost(DESK, usage);
        const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('Format jawaban AI tidak terbaca');
        out = JSON.parse(m[0]);
      } catch (e) { aiError = String(e.message || e).slice(0, 200); }
    }
    if (!out) {
      source = 'template';
      out = { category: t.category, priority: t.priority, summary: t.summary || t.subject, reply: templateReply(t), needs: '' };
      await event(UNIT, DESK, 'peringatan', `AI tidak tersedia (${aiError}) — Rawat memakai draf template untuk ${t.number}.`);
    }
    const category = CATEGORIES.includes(out.category) ? out.category : t.category;
    const priority = PRIORITIES.includes(out.priority) ? out.priority : t.priority;
    const reply = String(out.reply || '').trim().slice(0, 3000) || templateReply(t);
    const summary = String(out.summary || '').trim().slice(0, 300) || null;
    const patch = { ai_draft: reply, summary, updated_at: new Date().toISOString() };
    // Saran AI hanya diterapkan otomatis pada tiket yang belum disentuh pemilik.
    if (t.status === 'baru') { patch.category = category; patch.priority = priority; }
    await sb(`hd_tickets?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: patch });
    await event(UNIT, DESK, 'info', `Rawat menyiapkan draf balasan ${t.number} (${t.client_name})${source === 'template' ? ' — template' : ''}. Menunggu Anda kirim.`);
    return sendJson(res, 200, { ok: true, source, ai_error: aiError, draft: reply, summary, category, priority, needs: String(out.needs || '').slice(0, 300), applied: t.status === 'baru' });
  } catch (e) {
    try { await event(UNIT, DESK, 'bahaya', 'Rawat gagal: ' + String(e.message).slice(0, 300)); } catch {}
    return sendJson(res, /HTTP 404/.test(e.message) ? 503 : 500, { error: /HTTP 404/.test(e.message) ? 'Tabel helpdesk belum dibuat — jalankan migrasi supabase/migrations/20261014_penawaran_helpdesk.sql' : e.message });
  }
};
