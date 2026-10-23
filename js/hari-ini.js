// Hari Ini — satu halaman berisi semua yang menunggu keputusan pemilik dari semua tim,
// plus ringkasan biaya, masalah, meeting, dan proyek. Data: GET /api/office/hari-ini (RPC hub_hari_ini).
// Keputusan Produksi & follow-up Sales diambil langsung di sini (POST /api/office/putuskan);
// tim lain (desain, konten, penawaran) membuka halaman review masing-masing.
/* global escapeHtml, crmApi, officeAgo, showPage */

const hi = { data: null, timer: null, busy: false };
const hiEl = id => document.getElementById(id);
const hiUsd = n => '$' + Number(n || 0).toFixed(2);
const hiJam = t => t ? new Date(t).toLocaleString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
const HI_JENIS = {
  dp: 'DP masuk?', kirim_klien: 'Kirim pesan ke klien', build: 'Build / preview', uat: 'Jawaban UAT klien', eskalasi: 'Eskalasi uji',
  review_desain: 'Review desain', review_konten: 'Review konten', posting: 'Posting', link_zoom: 'Link Zoom', approval_wa: 'Draf WA outreach',
  brief_baru: 'Brief baru', menunggu_catatan: 'Catatan meeting', menunggu_review: 'Review penawaran', disetujui_klien: 'Klien setuju', diskusi: 'Klien ingin diskusi',
};
const hiJenis = j => HI_JENIS[j] || (String(j || '').startsWith('followup_') ? 'Follow-up ' + j.slice(9).replace(/_/g, ' ') : String(j || '').replace(/_/g, ' '));

function hiInit() {
  hiLoad();
  clearInterval(hi.timer);
  hi.timer = setInterval(() => { if (!document.hidden && hiEl('page-hari-ini')?.classList.contains('active') && !hi.busy) hiLoad(true); }, 60000);
}
function hiStop() { clearInterval(hi.timer); hi.timer = null; }

async function hiLoad(quiet) {
  const err = hiEl('hi-error');
  try {
    hi.data = await crmApi('/api/office/hari-ini');
    err.style.display = 'none';
  } catch (e) {
    err.innerHTML = /hub_hari_ini|404/.test(e.message)
      ? '<b>Fungsi database belum ada.</b> Migrasi <code>hub_02_hari_ini</code> belum dijalankan di Supabase.'
      : escapeHtml(e.message);
    err.style.display = 'block';
    if (!quiet) return;
  }
  if (hi.data) hiRender();
}

function hiRender() {
  const d = hi.data, r = d.ringkas || {};
  const keputusan = d.keputusan || [];
  // Produksi sudah tampil di "keputusan" (bisa diputuskan di sini) — jangan dobel
  const lain = (d.tindakan || []).filter(t => t.tim !== 'Produksi');
  const total = keputusan.length + lain.length;
  const badge = hiEl('hi-nav-badge');
  if (badge) { badge.textContent = total; badge.style.display = total ? '' : 'none'; }

  hiEl('hi-kpis').innerHTML = [
    [total, 'menunggu keputusan Anda', total ? 'color:var(--brand-orange)' : ''],
    [r.masalah ?? 0, 'masalah 7 hari (tugas gagal/ditahan)', r.masalah ? 'color:#c0392b' : ''],
    [hiUsd(r.usd_hari_ini), `biaya token hari ini · 7 hari ${hiUsd(r.usd_7h)}`],
    [r.meeting_7h ?? 0, 'meeting 7 hari ke depan'],
    [r.proyek_aktif ?? 0, 'proyek produksi aktif'],
    [r.tugas_jalan ?? 0, 'tugas agen berjalan'],
    [(r.outbox_tertahan ?? 0) + ' / ' + (r.outbox_gagal_24j ?? 0), 'pesan tertahan / gagal 24 jam', (r.outbox_tertahan || r.outbox_gagal_24j) ? 'color:#c0392b' : ''],
  ].map(([v, l, st]) => `<div class="aio-kpi"><b style="${st || ''}">${v}</b><span>${l}</span></div>`).join('');

  hiEl('hi-keputusan').innerHTML = keputusan.length ? keputusan.map(hiCard).join('')
    : '<div class="hi-empty">Tidak ada keputusan Produksi atau follow-up Sales yang menunggu.</div>';

  hiEl('hi-lain').innerHTML = lain.length ? `<div class="pf-table-wrap"><table class="pf-table"><thead><tr><th>Tim</th><th>Perlu</th><th>Keterangan</th><th>Sejak</th><th></th></tr></thead><tbody>${
    lain.map(t => `<tr><td>${escapeHtml(t.tim)}</td><td><b>${escapeHtml(t.judul)}</b><div class="hi-muted">${escapeHtml(hiJenis(t.jenis))}</div></td>
      <td>${escapeHtml(t.sub || '')}</td><td style="white-space:nowrap">${escapeHtml(officeAgo(t.sejak))}</td><td>${hiLink(t.link)}</td></tr>`).join('')
  }</tbody></table></div>` : '<div class="hi-empty">Tidak ada.</div>';

  const masalah = d.masalah || [];
  hiEl('hi-masalah-wrap').style.display = masalah.length ? '' : 'none';
  hiEl('hi-masalah').innerHTML = masalah.map(m => `<tr><td style="white-space:nowrap">${escapeHtml(officeAgo(m.waktu))}</td><td>${escapeHtml(m.unit)} · ${escapeHtml(m.meja)}</td>
    <td><b>${escapeHtml(m.judul)}</b><div class="hi-muted">${escapeHtml(m.error || '')}</div></td><td>${escapeHtml(m.status)} (${m.percobaan || 0}x)</td></tr>`).join('');

  const meeting = d.meeting || [];
  hiEl('hi-meeting').innerHTML = meeting.length ? meeting.map(m => `<tr><td style="white-space:nowrap">${escapeHtml(hiJam(m.mulai))}</td>
    <td><b>${escapeHtml(m.usaha || m.nama || '-')}</b><div class="hi-muted">${escapeHtml(m.nama || '')}</div></td><td>${escapeHtml(m.platform)}</td>
    <td>${m.url ? `<a href="${escapeHtml(m.url)}" target="_blank" rel="noopener">Buka link</a>` : '<span class="hi-muted">belum ada link</span>'}</td>
    <td>${m.riset && String(m.riset).startsWith('http') ? `<a href="${escapeHtml(m.riset)}" target="_blank" rel="noopener">Riset</a>` : escapeHtml(m.riset || '')}</td></tr>`).join('')
    : '<tr><td colspan="5" class="hi-muted">Tidak ada meeting terjadwal.</td></tr>';

  const proyek = d.proyek || [];
  hiEl('hi-proyek').innerHTML = proyek.length ? proyek.map(p => `<tr><td><b>${escapeHtml(p.kode)}</b></td><td>${escapeHtml(p.usaha)}<div class="hi-muted">${escapeHtml(p.jenis || '')}</div></td>
    <td>${escapeHtml(String(p.status).replace(/_/g, ' '))}</td><td>${p.tugas_selesai}/${p.tugas_total}</td><td>${p.putaran}/${p.maks_putaran}${p.bug_terbuka ? ` · <b style="color:#c0392b">${p.bug_terbuka} bug</b>` : ''}</td>
    <td>${escapeHtml(p.target || '-')}</td><td>${p.preview ? `<a href="${escapeHtml(p.preview)}" target="_blank" rel="noopener">Preview</a>` : ''}</td></tr>`).join('')
    : '<tr><td colspan="7" class="hi-muted">Belum ada proyek produksi aktif.</td></tr>';

  const meja = (d.unit || []).flatMap(u => (u.meja || []).map(m => ({ ...m, unit: u.nama })))
    .filter(m => Number(m.usd_7h) > 0 || m.antre > 0 || m.gagal_7h > 0)
    .sort((a, b) => Number(b.usd_hari_ini) - Number(a.usd_hari_ini) || Number(b.usd_7h) - Number(a.usd_7h));
  hiEl('hi-biaya').innerHTML = meja.length ? meja.map(m => `<tr><td>${escapeHtml(m.unit)}</td><td><b>${escapeHtml(m.nama)}</b><div class="hi-muted">${escapeHtml(m.model || '')}</div></td>
    <td>${escapeHtml(m.status_agen || m.status)}</td><td style="text-align:right">${hiUsd(m.usd_hari_ini)}${m.budget ? ` <span class="hi-muted">/ ${hiUsd(m.budget)}</span>` : ''}</td>
    <td style="text-align:right">${hiUsd(m.usd_7h)}</td><td style="text-align:right">${m.antre}</td><td style="text-align:right">${m.gagal_7h || ''}</td></tr>`).join('')
    : '<tr><td colspan="7" class="hi-muted">Belum ada pemakaian token 7 hari terakhir.</td></tr>';

  hiEl('hi-updated').textContent = 'Diperbarui ' + new Date(d.generated_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function hiLink(link) {
  if (!link) return '';
  if (link.startsWith('#')) return `<button class="vo-btn" onclick="showPage('${escapeHtml(link.slice(1))}')">Buka</button>`;
  return `<a class="vo-btn" style="text-decoration:none;display:inline-block" href="${escapeHtml(link)}" target="_blank" rel="noopener">Buka ↗</a>`;
}

function hiCard(k) {
  const key = k.sumber + '-' + k.id;
  const tombol = (k.pilihan || []).map((p, i) => {
    const field = p.isian === 'url' ? `<input class="hi-input" id="hi-v-${key}-${i}" type="url" placeholder="https://….vercel.app">`
      : p.isian === 'catatan' ? `<textarea class="hi-input" id="hi-v-${key}-${i}" rows="3" placeholder="Catatan perbaikan dari klien"></textarea>` : '';
    return `<div class="hi-aksi">${field}<button class="vo-btn ${i === 0 ? 'hi-utama' : ''}" onclick="hiPutuskan('${k.sumber}','${escapeHtml(String(k.id))}','${escapeHtml(p.a)}','${p.isian || ''}','hi-v-${key}-${i}')">${escapeHtml(p.label)}</button></div>`;
  }).join('');
  const pesan = k.pesan == null ? '' : k.sumber === 'followup'
    ? `<textarea class="hi-input hi-pesan" id="hi-p-${key}" rows="6">${escapeHtml(k.pesan)}</textarea><div class="hi-muted">Boleh diubah sebelum dikirim.</div>`
    : `<div class="hi-pesan-box">${escapeHtml(k.pesan)}</div>`;
  return `<div class="hi-card">
    <div class="hi-card-head"><span class="hi-tim">${escapeHtml(k.tim)}</span><span class="hi-muted">${escapeHtml(hiJenis(k.jenis))} · ${escapeHtml(officeAgo(k.sejak))}</span></div>
    <div class="hi-sub">${escapeHtml(k.sub || '')}</div>
    <div class="hi-judul">${escapeHtml(k.judul)}</div>
    ${k.info ? `<div class="hi-muted">${escapeHtml(k.info)}</div>` : ''}${k.catatan ? `<div class="hi-warn">⚠️ ${escapeHtml(k.catatan)}</div>` : ''}
    ${pesan}<div class="hi-aksi-row">${tombol}</div><div class="hi-hasil" id="hi-r-${key}"></div></div>`;
}

async function hiPutuskan(sumber, id, aksi, isian, inputId) {
  if (hi.busy) return;
  const key = sumber + '-' + id, out = hiEl('hi-r-' + key);
  const body = { sumber, id, aksi };
  if (isian) {
    const v = (hiEl(inputId)?.value || '').trim();
    if (isian === 'url' && !/^https:\/\/\S+$/.test(v)) { out.textContent = 'Tempel URL preview yang diawali https://'; return; }
    if (isian === 'catatan' && v.length < 5) { out.textContent = 'Tulis catatan perbaikan dari klien.'; return; }
    if (isian !== 'pesan') body.nilai = v;
  }
  if (sumber === 'followup' && aksi === 'kirim') {
    body.pesan = hiEl('hi-p-' + key)?.value || '';
    if (!body.pesan.trim()) { out.textContent = 'Pesan kosong.'; return; }
    if (!confirm('Kirim follow-up ini ke klien via WhatsApp sekarang?')) return;
  }
  hi.busy = true; out.textContent = 'Memproses…';
  try {
    const j = await crmApi('/api/office/putuskan', { method: 'POST', body: JSON.stringify(body) });
    out.textContent = '✓ ' + (j.info || 'Beres');
    setTimeout(() => hiLoad(true), 1200);
  } catch (e) {
    out.textContent = '✗ ' + e.message;
  } finally { hi.busy = false; }
}
