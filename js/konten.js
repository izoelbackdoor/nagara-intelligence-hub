// Konten NADI — menu tim Marketing (konten & materi pemasaran NADI) di Command Center.
// Data: GET /api/office/konten (RPC hub_konten) · detail: GET /api/office/konten?id=<uuid> (hub_konten_detail)
// Aksi: POST /api/office/konten {op: minta|setujui|revisi|tolak|setujui_semua|terbit|mulai_minggu|arahan} (hub_konten_aksi)
// Penulis (mkt-*) dijalankan workflow n8n "NADI 7 - Marketing & Sales"; visual dikerjakan Studio Desain.
/* global escapeHtml, crmApi, officeAgo */

const kt = { data: null, timer: null, busy: false, buka: null, detail: {} };
const ktEl = id => document.getElementById(id);
const ktUsd = n => '$' + Number(n || 0).toFixed(2);
const ktJam = t => t ? new Date(t).toLocaleString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
const KT_KANAL = {
  ig_fb: { label: 'IG & FB', format: { single: 'Single post', carousel: 'Carousel' } },
  tiktok: { label: 'TikTok / Reels', format: { video: 'Naskah video' } },
  linkedin: { label: 'LinkedIn', format: { teks: 'Post teks', carousel: 'Carousel dokumen' } },
  blog: { label: 'Blog nagaraku.id', format: { artikel: 'Artikel SEO' } },
};
const KT_STATUS = {
  menulis: ['Sedang ditulis', 'baru'], revisi: ['Direvisi', 'baru'], menunggu_review: ['Menunggu Anda', 'tinggi'],
  disetujui: ['Disetujui', 'selesai'], siap_terbit: ['Siap posting', 'selesai'], terbit: ['Terbit', 'selesai'],
  ditolak: ['Ditolak', 'rendah'], gagal: ['Gagal', 'urgent'],
};
const KT_BATCH = {
  menyusun: 'Kepala Marketing menyusun rencana', menulis: 'Penulis sedang menulis', menunggu_review: 'Menunggu review Anda',
  produksi_visual: 'Visual dikerjakan Studio Desain', berjalan: 'Terjadwal', selesai: 'Selesai', gagal: 'Gagal',
};
const ktTag = s => { const [l, c] = KT_STATUS[s] || [s, '']; return `<span class="hd-tag ${c}">${escapeHtml(l)}</span>`; };

function ktInit() {
  ktFormKanal();
  ktLoad();
  clearInterval(kt.timer);
  kt.timer = setInterval(() => { if (!document.hidden && ktEl('page-konten')?.classList.contains('active') && !kt.busy) ktLoad(true); }, 45000);
}
function ktStop() { clearInterval(kt.timer); kt.timer = null; }

async function ktLoad(quiet) {
  const err = ktEl('kt-error');
  try {
    kt.data = await crmApi('/api/office/konten');
    err.style.display = 'none';
  } catch (e) {
    err.innerHTML = /hub_konten|404/.test(e.message)
      ? '<b>Fungsi database belum ada.</b> Jalankan migrasi <code>supabase/migrations/20261023_hub_konten.sql</code>.'
      : escapeHtml(e.message);
    err.style.display = 'block';
    if (!quiet) return;
  }
  if (kt.data) ktRender();
}

function ktRender() {
  const d = kt.data, konten = d.konten || [], m = d.mesin || {};
  const n = s => konten.filter(k => s.includes(k.status)).length;
  const review = n(['menunggu_review']);
  const badge = ktEl('kt-nav-badge');
  if (badge) { badge.textContent = review; badge.style.display = review ? '' : 'none'; }

  // Peringatan mesin
  const warn = [];
  if (!d.aktif) warn.push('Tim Marketing dinonaktifkan di pengaturan (<code>nadi_config.cfg.tim.marketing.aktif</code>).');
  const lamaAntre = m.antre_terlama && (Date.now() - new Date(m.antre_terlama).getTime()) > 10 * 60e3;
  if (!m.pernah_jalan) warn.push('<b>Penulis belum pernah bekerja.</b> Aktifkan workflow n8n <b>NADI 7 - Marketing &amp; Sales</b> (dan <b>NADI 6 - Produksi</b> untuk notifikasi Telegram). Permintaan tetap tersimpan dan dikerjakan begitu workflow aktif.');
  else if (lamaAntre) warn.push(`Ada ${m.tugas_antre} tugas menunggu lebih dari 10 menit — cek workflow n8n <b>NADI 7</b> masih aktif dan kredit Anthropic cukup.`);
  ktEl('kt-warn').innerHTML = warn.map(w => `<div class="aio-mock-banner">${w}</div>`).join('');

  ktEl('kt-kpis').innerHTML = [
    [review, 'menunggu review Anda', review ? 'color:var(--brand-orange)' : ''],
    [n(['menulis', 'revisi']), 'sedang ditulis / direvisi'],
    [n(['disetujui']), 'menunggu visual Studio Desain'],
    [n(['siap_terbit']), 'siap diposting'],
    [n(['terbit']), 'sudah terbit'],
    [ktUsd((d.tim || []).filter(t => t.unit === 'marketing').reduce((a, t) => a + Number(t.usd_hari_ini || 0), 0)), 'biaya token tim hari ini'],
  ].map(([v, l, st]) => `<div class="aio-kpi"><b style="${st || ''}">${v}</b><span>${l}</span></div>`).join('');

  // Rencana mingguan & arahan
  const p = d.pengaturan || {}, rb = d.rencana_berikut || {};
  const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][p.hari_rencana % 7] || 'Sabtu';
  ktEl('kt-mingguan').innerHTML = `
    <div class="hi-muted">Kepala Marketing menyusun kalender otomatis tiap <b>${hari} pagi</b> untuk minggu berikutnya, dengan kuota:
      ${Object.entries(p.kuota || {}).filter(([, v]) => v > 0).map(([k, v]) => `${escapeHtml(KT_KANAL[k]?.label || k)} ${v}`).join(' · ') || '-'}.</div>
    <div style="margin:8px 0">Minggu ${escapeHtml(new Date(rb.minggu + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long' }))}:
      ${rb.ada ? '<b>rencana sudah dibuat</b>' : `<span class="hi-muted">belum dibuat</span> <button class="vo-btn" onclick="ktAksi({op:'mulai_minggu'}, this)">Susun sekarang</button>`}</div>
    <label class="hi-muted" for="kt-arahan">Arahan Anda untuk rencana berikutnya (fokus, jenis usaha, hal yang dihindari)</label>
    <textarea id="kt-arahan" class="hi-input" rows="3" maxlength="1500" placeholder="mis. Fokus ke klinik & salon bulan ini. Tonjolkan sistem booking online.">${escapeHtml(p.catatan_imam || '')}</textarea>
    <button class="vo-btn" onclick="ktAksi({op:'arahan', catatan: ktEl('kt-arahan').value}, this)">Simpan arahan</button>
    <div class="hi-muted" style="margin-top:8px">Visual otomatis ke Studio Desain: <b>${p.visual_otomatis ? 'aktif' : 'mati'}</b> ·
      Posting FB/IG otomatis: <b>${p.auto_terbit ? 'aktif' : 'manual (paket siap tempel)'}</b></div>`;

  // Batch (permintaan & rencana mingguan) + kontennya
  const batch = d.batch || [];
  ktEl('kt-batch').innerHTML = batch.length ? batch.map(b => {
    const isi = konten.filter(k => k.rencana_id === b.id);
    const tunggu = isi.filter(k => k.status === 'menunggu_review').length;
    return `<div class="hi-card kt-batch">
      <div class="hi-card-head"><span class="hi-tim">${b.jenis === 'permintaan' ? 'Permintaan Anda' : 'Rencana mingguan'}</span>
        <span class="hi-muted">${escapeHtml(officeAgo(b.dibuat))}</span></div>
      <div class="hi-sub">${escapeHtml(b.tema || b.label)}</div>
      <div class="hi-muted">${escapeHtml(KT_BATCH[b.status] || b.status)} · ${b.jumlah} materi
        ${b.desain ? ` · Visual <a href="${escapeHtml(b.desain.link)}" target="_blank" rel="noopener">${escapeHtml(b.desain.kode)}</a> (${escapeHtml(String(b.desain.status).replace(/_/g, ' '))})` : ''}</div>
      ${b.ringkasan ? `<div class="kt-ringkas">${escapeHtml(b.ringkasan)}</div>` : ''}
      ${tunggu > 1 ? `<button class="vo-btn hi-utama" style="margin:6px 0" onclick="if(confirm('Setujui ${tunggu} konten sekaligus?')) ktAksi({op:'setujui_semua', rencana_id:'${b.id}'}, this)">Setujui semua (${tunggu})</button>` : ''}
      <div class="pf-table-wrap"><table class="pf-table kt-table"><thead><tr><th>Kode</th><th>Kanal</th><th>Materi</th><th>Jadwal</th><th>Status</th><th></th></tr></thead><tbody>
      ${isi.map(ktBaris).join('') || '<tr><td colspan="6" class="hi-muted">Kepala Marketing sedang menyusun daftar konten…</td></tr>'}
      </tbody></table></div></div>`;
  }).join('') : '<div class="hi-empty">Belum ada konten. Isi form <b>Minta materi</b> di atas, atau tunggu rencana mingguan.</div>';

  // Tim
  ktEl('kt-tim').innerHTML = (d.tim || []).map(t => `<tr><td>${t.unit === 'desain' ? 'Studio Desain' : 'Marketing'}</td>
    <td><b>${escapeHtml(t.nama)}</b><div class="hi-muted">${escapeHtml(t.peran || '')}</div></td><td>${escapeHtml(t.status || '-')}</td>
    <td style="text-align:right">${t.dikerjakan ? `<b>${t.dikerjakan} jalan</b> · ` : ''}${t.antre}</td>
    <td>${t.terakhir ? escapeHtml(officeAgo(t.terakhir)) : '<span class="hi-muted">belum pernah</span>'}</td>
    <td style="text-align:right">${ktUsd(t.usd_hari_ini)}${t.budget ? ` <span class="hi-muted">/ ${ktUsd(t.budget)}</span>` : ''}</td>
    <td style="text-align:right">${t.gagal_7h || ''}</td></tr>`).join('');

  ktEl('kt-updated').textContent = 'Diperbarui ' + new Date(d.generated_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  if (kt.buka) ktTampilDetail(kt.buka, true);
}

function ktBaris(k) {
  const kanal = KT_KANAL[k.kanal];
  const aksi = k.status === 'menunggu_review'
    ? `<button class="vo-btn hi-utama" onclick="ktAksi({op:'setujui', id:'${k.id}'}, this)">Setujui</button>
       <button class="vo-btn" onclick="ktLihat('${k.id}')">Lihat / revisi</button>`
    : `<button class="vo-btn" onclick="ktLihat('${k.id}')">Lihat</button>`;
  return `<tr id="kt-row-${k.id}">
    <td style="white-space:nowrap"><b>${escapeHtml(k.kode)}</b></td>
    <td>${escapeHtml(kanal?.label || k.label_kanal || k.kanal)}<div class="hi-muted">${escapeHtml(kanal?.format[k.format] || k.format || '')}</div></td>
    <td><b>${escapeHtml(k.judul || '-')}</b><div class="hi-muted kt-clip">${escapeHtml(k.ringkas || '')}</div>
      ${(k.cek || []).length ? `<div class="hi-warn">⚠️ ${escapeHtml(k.cek.join('; '))}</div>` : ''}
      ${k.status === 'siap_terbit' && k.perlu_visual && !k.aset ? '<div class="hi-warn">Belum punya visual</div>' : ''}</td>
    <td style="white-space:nowrap">${escapeHtml(ktJam(k.jadwal))}</td>
    <td>${ktTag(k.status)}${k.putaran ? `<div class="hi-muted">revisi ${k.putaran}x</div>` : ''}${k.url_terbit ? `<div><a href="${escapeHtml(k.url_terbit)}" target="_blank" rel="noopener">Lihat posting</a></div>` : ''}</td>
    <td class="kt-aksi">${aksi}</td></tr>
    <tr class="kt-detail-row" id="kt-det-${k.id}" style="display:none"><td colspan="6"><div id="kt-detail-${k.id}" class="kt-detail">Memuat…</div></td></tr>`;
}

async function ktLihat(id) {
  const row = ktEl('kt-det-' + id);
  if (!row) return;
  if (row.style.display !== 'none' && kt.buka === id) { row.style.display = 'none'; kt.buka = null; return; }
  if (kt.buka && kt.buka !== id) { const lama = ktEl('kt-det-' + kt.buka); if (lama) lama.style.display = 'none'; }
  kt.buka = id; row.style.display = '';
  await ktTampilDetail(id);
}

async function ktTampilDetail(id, dariRender) {
  const row = ktEl('kt-det-' + id), box = ktEl('kt-detail-' + id);
  if (!row || !box) { kt.buka = null; return; }
  row.style.display = '';
  try {
    if (!dariRender || !kt.detail[id]) kt.detail[id] = await crmApi('/api/office/konten?id=' + encodeURIComponent(id));
    box.innerHTML = ktDetailHtml(kt.detail[id]);
  } catch (e) { box.textContent = 'Gagal memuat: ' + e.message; }
}

function ktSalinBtn(teks) {
  return teks ? `<button class="vo-btn kt-salin" data-teks="${escapeHtml(teks)}" onclick="ktSalin(this)">Salin</button>` : '';
}
function ktSalin(btn) {
  navigator.clipboard?.writeText(btn.dataset.teks).then(() => { btn.textContent = '✓ Tersalin'; setTimeout(() => { btn.textContent = 'Salin'; }, 1500); });
}

function ktDetailHtml(j) {
  if (!j.ok) return escapeHtml(j.info || 'Tidak ditemukan');
  const k = j.konten, i = k.isi || {}, a = k.arahan || {};
  const blok = (judul, isi, salin) => isi ? `<div class="kt-blok"><div class="kt-blok-h">${judul}${salin ? ktSalinBtn(salin) : ''}</div>${isi}</div>` : '';
  const pre = t => t ? `<div class="kt-pre">${escapeHtml(t)}</div>` : '';
  const tags = (i.hashtag || []).join(' ');
  let utama = '';
  if (!k.isi) {
    const t = j.tugas || {};
    utama = `<div class="hi-muted">Belum ada draf. Tugas penulis: <b>${escapeHtml(t.status || '-')}</b>${t.percobaan ? ` (percobaan ${t.percobaan})` : ''}.
      ${t.error ? `<div class="hi-warn">${escapeHtml(t.error)}</div>` : ''}</div>`;
  } else if (k.kanal === 'tiktok') {
    utama = blok('Hook', pre(i.hook))
      + blok(`Naskah · ±${escapeHtml(String(i.durasi_detik || '-'))} detik`, `<div class="pf-table-wrap"><table class="pf-table"><thead><tr><th>Detik</th><th>Visual</th><th>Voiceover</th><th>Teks layar</th></tr></thead><tbody>${
        (i.naskah || []).map(s => `<tr><td>${escapeHtml(s.detik || '')}</td><td>${escapeHtml(s.visual || '')}</td><td>${escapeHtml(s.voiceover || '')}</td><td>${escapeHtml(s.teks_layar || '')}</td></tr>`).join('')}</tbody></table></div>`)
      + blok('Caption', pre(i.caption + (tags ? '\n\n' + tags : '')), i.caption + (tags ? '\n\n' + tags : ''))
      + blok('Audio', pre(i.audio));
  } else if (k.kanal === 'blog') {
    utama = blok('SEO', pre(`Meta title: ${i.meta_title || '-'}\nMeta description: ${i.meta_description || '-'}\nSlug: ${i.slug || '-'}\nKeyword: ${i.keyword || '-'}`))
      + blok('Artikel (markdown)', pre(i.artikel_md), i.artikel_md)
      + blok('FAQ', pre((i.faq || []).map(f => `T: ${f.q}\nJ: ${f.a}`).join('\n\n')))
      + blok('Internal link', pre((i.internal_link || []).map(l => `${l.anchor} → ${l.ke}`).join('\n')));
  } else if (k.kanal === 'linkedin') {
    utama = blok('Post', pre(i.post + (tags ? '\n\n' + tags : '')), i.post + (tags ? '\n\n' + tags : ''))
      + ((i.slides || []).length ? blok('Slide', pre(i.slides.map((s, n) => `${n + 1}. ${s.judul || ''}\n${s.teks || ''}`).join('\n\n'))) : '');
  } else if (k.kanal === 'ads') {
    utama = blok('Ringkasan', pre(i.ringkasan)) + blok('Isi analisis', pre(JSON.stringify(i, null, 2)));
  } else {
    utama = blok('Hook', pre(i.hook))
      + blok(k.format === 'carousel' ? 'Slide' : 'Visual', pre((i.slides || []).map((s, n) => `${n + 1}. ${s.judul || ''}\n${s.teks || ''}`).join('\n\n')))
      + blok('Caption', pre(i.caption + (tags ? '\n\n' + tags : '')), i.caption + (tags ? '\n\n' + tags : ''));
  }
  const aset = (k.aset || []).filter(x => x.url);
  const keputusan = k.status === 'menunggu_review' ? `<div class="kt-keputusan">
      <textarea id="kt-cat-${k.id}" class="hi-input" rows="2" placeholder="Catatan revisi / alasan menolak"></textarea>
      <div class="hi-aksi-row">
        <button class="vo-btn hi-utama" onclick="ktAksi({op:'setujui', id:'${k.id}'}, this)">Setujui</button>
        <button class="vo-btn" onclick="ktAksi({op:'revisi', id:'${k.id}', catatan: ktEl('kt-cat-${k.id}').value}, this)">Minta revisi</button>
        <button class="vo-btn" onclick="ktAksi({op:'tolak', id:'${k.id}', catatan: ktEl('kt-cat-${k.id}').value}, this)">Tolak</button>
      </div></div>`
    : k.status === 'siap_terbit' ? `<div class="kt-keputusan">
      <input id="kt-url-${k.id}" class="hi-input" type="url" placeholder="Link posting (opsional), https://…">
      <button class="vo-btn hi-utama" onclick="ktAksi({op:'terbit', id:'${k.id}', url: ktEl('kt-url-${k.id}').value.trim()}, this)">Sudah saya posting</button></div>` : '';
  return `<div class="kt-detail-grid"><div>
      <div class="hi-muted">${escapeHtml(j.label_kanal)} · ${escapeHtml(k.format || '')} · ${escapeHtml(j.rencana?.label || '')} · jadwal ${escapeHtml(ktJam(k.jadwal))}</div>
      ${(k.cek || []).length ? `<div class="hi-warn">⚠️ Pemeriksa teks: ${escapeHtml(k.cek.join('; '))}</div>` : ''}
      ${k.catatan_imam ? `<div class="hi-muted">Catatan Anda: ${escapeHtml(k.catatan_imam)}</div>` : ''}
      ${utama}
      ${i.catatan_untuk_imam ? blok('Catatan penulis', pre(i.catatan_untuk_imam)) : ''}
    </div><div>
      ${blok('Arahan', pre([a.angle && 'Arahan: ' + a.angle, a.target && 'Sasaran: ' + a.target, a.cta && 'Ajakan: ' + a.cta, a.keyword && 'Keyword: ' + a.keyword].filter(Boolean).join('\n')))}
      ${blok('Brief visual (untuk Studio Desain)', pre(i.brief_visual))}
      ${aset.length ? blok('Visual', aset.map(x => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(x.url)
        ? `<a href="${escapeHtml(x.url)}" target="_blank" rel="noopener"><img class="kt-img" src="${escapeHtml(x.url)}" alt="${escapeHtml(x.judul || '')}"></a>`
        : `<div><a href="${escapeHtml(x.url)}" target="_blank" rel="noopener">${escapeHtml(x.judul || x.url)}</a></div>`).join('')) : ''}
      ${keputusan}<div class="hi-hasil" id="kt-r-${k.id}"></div>
    </div></div>`;
}

async function ktAksi(body, btn) {
  if (kt.busy) return;
  if (body.op === 'revisi' && (body.catatan || '').trim().length < 5) { alert('Tulis catatan revisi minimal 5 karakter.'); return; }
  if (body.op === 'tolak' && !confirm('Tolak konten ini?')) return;
  kt.busy = true;
  const asli = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = 'Memproses…'; }
  try {
    const j = await crmApi('/api/office/konten', { method: 'POST', body: JSON.stringify(body) });
    if (body.id) delete kt.detail[body.id];
    ktToast((j.ok ? '✓ ' : '✗ ') + (j.info || 'Beres'), !j.ok);
    if (j.ok) await ktLoad(true);
  } catch (e) {
    ktToast('✗ ' + e.message, true);
  } finally {
    kt.busy = false; if (btn) { btn.disabled = false; btn.textContent = asli; }
  }
}

function ktToast(teks, gagal) {
  const t = ktEl('kt-toast');
  t.textContent = teks; t.className = 'kt-toast' + (gagal ? ' gagal' : ''); t.style.display = 'block';
  clearTimeout(kt.toastT); kt.toastT = setTimeout(() => { t.style.display = 'none'; }, 5000);
}

// ── Form "Minta materi" ──
function ktFormKanal() {
  const wrap = ktEl('kt-f-kanal');
  if (!wrap || wrap.dataset.siap) return;
  wrap.dataset.siap = '1';
  wrap.innerHTML = Object.entries(KT_KANAL).map(([k, v]) => `<div class="kt-kanal">
      <label><input type="checkbox" id="kt-k-${k}" onchange="ktHitung()"> ${escapeHtml(v.label)}</label>
      <select id="kt-f-${k}" class="hi-input">${Object.entries(v.format).map(([f, l]) => `<option value="${f}">${escapeHtml(l)}</option>`).join('')}</select>
      <input id="kt-j-${k}" class="hi-input" type="number" min="1" max="5" value="1" onchange="ktHitung()" title="Jumlah">
    </div>`).join('');
  const besok = new Date(Date.now() + 864e5 + 7 * 3600e3).toISOString().slice(0, 10);
  ktEl('kt-f-mulai').value = besok; ktEl('kt-f-mulai').min = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  ktHitung();
}
function ktItem() {
  return Object.keys(KT_KANAL).filter(k => ktEl('kt-k-' + k)?.checked)
    .map(k => ({ kanal: k, format: ktEl('kt-f-' + k).value, jumlah: Math.max(1, Math.min(5, parseInt(ktEl('kt-j-' + k).value) || 1)) }));
}
function ktHitung() {
  const total = ktItem().reduce((a, x) => a + x.jumlah, 0);
  ktEl('kt-f-total').textContent = total ? `${total} materi${total > 8 ? ' — maksimal 8' : ''}` : 'Pilih minimal satu kanal';
  ktEl('kt-f-total').style.color = total > 8 ? '#c0392b' : '';
  ktEl('kt-f-kw').style.display = ktEl('kt-k-blog')?.checked ? '' : 'none';
}
async function ktKirimPermintaan(btn) {
  const body = {
    op: 'minta', judul: ktEl('kt-f-judul').value.trim(), brief: ktEl('kt-f-brief').value.trim(),
    target: ktEl('kt-f-target').value.trim(), cta: ktEl('kt-f-cta').value.trim(),
    keyword: ktEl('kt-f-keyword').value.trim(), mulai: ktEl('kt-f-mulai').value, item: ktItem(),
  };
  if (body.judul.length < 3) return ktToast('✗ Isi judul permintaan.', true);
  if (body.brief.length < 15) return ktToast('✗ Tulis arahan materi minimal 15 karakter.', true);
  if (!body.item.length) return ktToast('✗ Pilih minimal satu kanal.', true);
  if (body.item.reduce((a, x) => a + x.jumlah, 0) > 8) return ktToast('✗ Maksimal 8 materi per permintaan.', true);
  await ktAksi(body, btn);
  if (!ktEl('kt-toast').classList.contains('gagal')) { ktEl('kt-f-judul').value = ''; ktEl('kt-f-brief').value = ''; }
}
