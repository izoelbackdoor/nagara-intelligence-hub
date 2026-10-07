/** Skor prospek calon klien NADI (0–100) — aturan sederhana, tanpa biaya AI. */
const CAT_FIT = {
  'Klinik & Kesehatan': 15, 'Klinik': 15, 'Travel Umroh & Haji': 12, 'Umroh': 12, 'Kost & Apartemen': 12,
  'Spa & Massage': 12, 'Hotel & Penginapan': 10, 'Salon & Barber': 10, 'Olahraga & Fitness': 10,
  'Pendidikan': 10, 'Coffee Shop': 8, 'Restoran': 8, 'Kuliner': 8, 'UMKM': 8,
  'Bank & Keuangan': 2, 'BPR': 2, 'Perkantoran': 4, 'Lainnya': 5,
};

function normWa(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  if (d.startsWith('8')) d = '62' + d;
  return /^62\d{8,13}$/.test(d) ? d : null;
}

function scoreLead({ notes = '', category = '', wa, city = '' }) {
  const n = String(notes || '');
  const reasons = [];
  let s = 0;
  const noWeb = /Website:\s*(Tidak|-|Tidak ada)/i.test(n) || /noweb/i.test(city || '');
  const hasWebField = /Website:\s*\S/i.test(n);
  const has_website = noWeb ? false : hasWebField ? true : null;
  if (has_website === false) { s += 40; reasons.push('belum punya website (+40)'); }
  else if (has_website === true) { s += 5; reasons.push('sudah punya website (+5)'); }
  const pm = n.match(/Prospek:\s*(High|Medium|Low)/i);
  const prospect_level = pm ? pm[1][0].toUpperCase() + pm[1].slice(1).toLowerCase() : null;
  if (prospect_level === 'High') { s += 25; reasons.push('prospek High (+25)'); }
  else if (prospect_level === 'Medium') { s += 12; reasons.push('prospek Medium (+12)'); }
  const rm = n.match(/Rating:\s*([\d.]+)/i);
  if (rm) { const r = parseFloat(rm[1]); if (r >= 4.5) { s += 10; reasons.push(`rating ${r} (+10)`); } else if (r >= 4) { s += 5; reasons.push(`rating ${r} (+5)`); } }
  const fit = CAT_FIT[category] ?? 5;
  s += fit; reasons.push(`kategori ${category || '-'} (+${fit})`);
  if (normWa(wa)) { s += 10; reasons.push('WA valid (+10)'); } else reasons.push('WA tidak valid');
  if (/minat|proposal|tertarik/i.test(n)) { s += 20; reasons.push('pernah menunjukkan minat (+20)'); }
  return { score: Math.min(100, s), score_reason: reasons.join(' · '), has_website, prospect_level };
}

/** Ambil nomor WA (ponsel) pertama dari teks berisi beberapa nomor. Telepon kantor diabaikan. */
function pickWa(raw) {
  for (const part of String(raw || '').split(/[;,/]|\s{2,}/)) {
    const d = part.replace(/\(.*?\)\s*$/, '').replace(/\D/g, '');
    if (/^(08|628|8)\d{7,12}$/.test(d)) return normWa(d);
  }
  return null;
}

/** Skor prospek Nagara EduKit (lembaga training/diklat), 0–100. */
const SEG_FIT = {
  'Bimtek ASN/Pemda': 15, 'Korporat/Manajemen': 12, 'K3/PJK3': 12, 'Soft Skill/Public Speaking': 12,
  'LPK Jepang': 10, 'Pajak/Brevet': 10, 'ISO/Sertifikasi': 10, 'Kesehatan': 8, 'Migas/Teknik': 8,
  'Keuangan/Perbankan': 8, 'PBJ (LKPP)': 8, 'Guru/Pendidikan': 8, 'Hospitality': 6, 'Instansi Pemerintah': 3,
};
function scoreEdukit({ priority, quality, segment, wa, email, contact, notes = '', phoneRaw = '' }) {
  const r = []; let s = 0;
  const P = { Tinggi: 35, Sedang: 20, Rendah: 5 }[priority] || 0;
  if (P) { s += P; r.push(`prioritas ${priority} (+${P})`); }
  const Q = { 'Lengkap': 15, 'Sebagian': 8 }[quality] || 0;
  if (Q) { s += Q; r.push(`data ${quality} (+${Q})`); } else if (quality) r.push(`data ${quality}`);
  const fit = SEG_FIT[segment] ?? 6; s += fit; r.push(`segmen ${segment || '-'} (+${fit})`);
  if (wa) { s += 15; r.push('WA ponsel ada (+15)'); } else r.push('belum ada nomor WA ponsel');
  if (/cek ulang/i.test(phoneRaw)) { s -= 5; r.push('nomor perlu cek ulang (−5)'); }
  if (email) { s += 5; r.push('email ada (+5)'); }
  if (contact) { s += 5; r.push('ada contact person (+5)'); }
  if (/minat|proposal|tertarik/i.test(notes)) { s += 20; r.push('pernah menunjukkan minat (+20)'); }
  return { score: Math.max(0, Math.min(100, s)), score_reason: r.join(' · '), prospect_level: priority || null };
}

module.exports = { scoreLead, scoreEdukit, normWa, pickWa };
