// Tim Produksi (Studio NADI) — alur kerja, anggota tim & jobdesk, proyek berjalan, hasil kerja & laporan uji.
// Data: GET /api/office/produksi[?id=<proyek>] → RPC hub_produksi(). Hanya baca; keputusan diambil di halaman Hari Ini.
/* global escapeHtml, crmApi, officeAgo, openSharedModal, showPage */

const pr = { data: null, view: 'alur', semua: false, detail: {} };
const prEl = id => document.getElementById(id);
const prUsd = n => '$' + Number(n || 0).toFixed(2);
const prUrl = u => (/^https?:\/\//i.test(String(u || '')) ? escapeHtml(u) : '#');
const prTgl = d => d ? new Date(String(d).length === 10 ? d + 'T00:00:00+07:00' : d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
const PR_STATUS = {
  menunggu_dp: 'Menunggu DP', onboarding: 'Rencana kerja', produksi: 'Produksi', pengujian: 'Pengujian internal',
  uat: 'UAT klien', serah_terima: 'Serah terima', selesai: 'Selesai', jeda: 'Dijeda', batal: 'Batal',
};
const PR_TUGAS = { antre: 'Antre', dikerjakan: 'Dikerjakan', review: 'Ditahan (cek)', selesai: 'Selesai', batal: 'Batal' };
const PR_MEJA = { pm: 'Project Manager', desainer: 'Designer & Copywriter', uji_fungsi: 'Penguji Fungsional', uji_persona: 'Penguji Persona', uji_performa: 'Penguji Performa', dev: 'Dev Engineer' };

// Alur kerja tim — urutan, siapa, apa, dan titik keputusan Imam
const PR_ALUR = [
  { tahap: ['menunggu_dp'], judul: 'Deal & DP', siapa: 'Sistem → Imam',
    isi: 'Brief berstatus Deal otomatis menjadi proyek NADI-YYYY-xxx. Tim belum bekerja sebelum DP masuk.',
    gate: 'Imam: konfirmasi "DP sudah masuk"' },
  { tahap: ['onboarding'], judul: 'Rencana kerja', siapa: 'Project Manager',
    isi: 'Membaca brief, lalu menyusun timeline, membagi tugas (copy, aset visual, build), dan menulis 8–20 kriteria uji. Target selesai dihitung dari "target waktu" klien.',
    gate: 'Imam: setujui kirim WA timeline + daftar materi ke klien' },
  { tahap: [], meja: 'desainer', judul: 'Copy & aset', siapa: 'Designer & Copywriter',
    isi: 'Copy per halaman (headline, isi, CTA, meta SEO), arah visual (palet, font, gaya), daftar aset + prompt gambar. Tidak mengarang testimoni/angka; data yang kurang ditandai [PERLU DATA].',
    gate: 'Otomatis (urut sesuai dependensi)' },
  { tahap: ['produksi'], judul: 'Build', siapa: 'Dev Engineer (Claude Code + Imam)',
    isi: 'Saat semua copy & aset selesai, muncul "Build siap" dengan paket spesifikasi lengkap (prod_paket_build). Website dibangun dan dideploy ke preview Vercel.',
    gate: 'Imam: tempel URL preview' },
  { tahap: ['pengujian'], judul: 'Uji internal', siapa: '3 Penguji',
    isi: 'Fungsional (cek kriteria uji, link, WA, placeholder), Persona (mencoba sebagai pelanggan klien), Performa (PageSpeed mobile/desktop, tanpa AI). Bug kritis/tinggi → revisi otomatis ke Dev, maks 3 putaran, lalu eskalasi.',
    gate: 'Otomatis; eskalasi ke Imam bila 3 putaran belum lulus' },
  { tahap: ['uat'], judul: 'UAT klien', siapa: 'Klien → Imam',
    isi: 'Undangan mencoba versi uji dikirim ke klien. Jawaban klien dicatat: SETUJU, atau catatan perbaikan yang otomatis menjadi tugas revisi + uji ulang.',
    gate: 'Imam: setujui kirim undangan, lalu catat jawaban klien' },
  { tahap: ['serah_terima', 'selesai'], judul: 'Serah terima', siapa: 'Imam (sementara manual)',
    isi: 'BAST, invoice pelunasan, mulai masa garansi. Legal Drafter & Admin Keuangan belum aktif.',
    gate: 'Manual' },
];

async function prInit() {
  if (!pr.data) prSetView(pr.view);
  await prLoad();
}

async function prLoad() {
  const err = prEl('pr-error');
  try {
    pr.data = await crmApi('/api/office/produksi');
    err.style.display = 'none';
  } catch (e) {
    err.innerHTML = /hub_produksi|404/.test(e.message) ? '<b>Fungsi database belum ada.</b> Migrasi <code>hub_03_produksi</code> belum dijalankan.' : escapeHtml(e.message);
    err.style.display = 'block';
    return;
  }
  prRender();
}

function prSetView(v) {
  pr.view = v;
  document.querySelectorAll('#pr-views .crm-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  ['alur', 'tim', 'proyek', 'aktivitas'].forEach(k => { prEl('pr-view-' + k).style.display = k === v ? '' : 'none'; });
}

function prRender() {
  const d = pr.data, t = d.tahap || {};
  const aktif = (d.proyek || []).filter(p => !['selesai', 'batal'].includes(p.status));
  const tim = d.tim || [];
  const antre = tim.reduce((s, m) => s + Number(m.antre || 0) + Number(m.dikerjakan || 0), 0);
  const bug = aktif.reduce((s, p) => s + Number(p.bug_terbuka || 0), 0);
  const tunggu = aktif.reduce((s, p) => s + Number(p.menunggu_imam || 0), 0);
  const terakhir = tim.map(m => m.terakhir).filter(Boolean).sort().pop();
  prEl('pr-kpis').innerHTML = [
    [aktif.length, 'proyek aktif'],
    [tunggu, 'menunggu keputusan Anda', tunggu ? 'color:var(--brand-orange)' : ''],
    [antre, 'tugas antre / dikerjakan'],
    [bug, 'bug terbuka', bug ? 'color:#c0392b' : ''],
    [prUsd(d.biaya_7h), 'biaya token tim 7 hari'],
    [terakhir ? officeAgo(terakhir) : '—', 'aktivitas agen terakhir', 'font-size:19px'],
  ].map(([v, l, st]) => `<div class="aio-kpi"><b style="${st || ''}">${v}</b><span>${l}</span></div>`).join('');

  // Alur kerja + jumlah proyek di tiap tahap
  const desainerAntre = (tim.find(m => m.key === 'desainer') || {});
  prEl('pr-alur').innerHTML = PR_ALUR.map((a, i) => {
    const n = a.meja ? Number(desainerAntre.antre || 0) + Number(desainerAntre.dikerjakan || 0) : a.tahap.reduce((s, k) => s + Number(t[k] || 0), 0);
    const label = a.meja ? 'tugas' : 'proyek';
    return `<div class="pr-step"><div class="pr-step-no">${i + 1}</div>
      <div class="pr-step-head"><b>${escapeHtml(a.judul)}</b><span class="pr-count ${n ? 'on' : ''}">${n} ${label}</span></div>
      <div class="pr-siapa">${escapeHtml(a.siapa)}</div><div class="pr-isi">${escapeHtml(a.isi)}</div>
      <div class="pr-gate">${a.gate.startsWith('Imam') ? '🔑 ' : '⚙️ '}${escapeHtml(a.gate)}</div></div>`;
  }).join('<div class="pr-arrow">→</div>');

  // Tim & jobdesk
  prEl('pr-tim').innerHTML = tim.map(m => {
    const j = m.jobdesc || {};
    return `<div class="pr-agent">
      <div class="pr-agent-head"><b>${escapeHtml(m.nama)}</b><span class="pr-badge pr-${escapeHtml(m.status)}">${escapeHtml(m.status)}</span></div>
      <div class="hi-muted">${escapeHtml(m.model || '-')}${m.budget != null ? ' · budget ' + prUsd(m.budget) + '/hari' : ''}</div>
      <div class="pr-isi" style="margin:8px 0">${escapeHtml(m.peran || '')}</div>
      ${Object.entries(j).map(([k, v]) => `<div class="pr-kv"><span>${escapeHtml(k)}</span>${escapeHtml(v)}</div>`).join('')}
      <div class="pr-stat"><span>Antre <b>${m.antre}</b></span><span>Dikerjakan <b>${m.dikerjakan}</b></span><span>Selesai 7h <b>${m.selesai_7h}</b></span>
        <span>Hari ini <b>${prUsd(m.usd_hari_ini)}</b></span><span>7 hari <b>${prUsd(m.usd_7h)}</b></span></div>
      ${m.prompt ? `<details class="pr-prompt"><summary>Lihat instruksi kerja (system prompt)</summary><pre>${escapeHtml(m.prompt)}</pre></details>` : ''}
    </div>`;
  }).join('');

  prRenderProyek();

  prEl('pr-akt').innerHTML = (d.aktivitas || []).length ? d.aktivitas.map(e => `<tr><td style="white-space:nowrap">${escapeHtml(officeAgo(e.waktu))}</td>
    <td>${escapeHtml(PR_MEJA[e.meja] || e.meja)}</td><td>${escapeHtml(e.level)}</td><td>${escapeHtml(e.pesan)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="hi-muted">Belum ada aktivitas.</td></tr>';
  prEl('pr-updated').textContent = 'Diperbarui ' + new Date(d.generated_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function prRenderProyek() {
  const list = (pr.data.proyek || []).filter(p => pr.semua || !['selesai', 'batal'].includes(p.status));
  prEl('pr-proyek').innerHTML = list.length ? list.map(p => `<tr style="cursor:pointer" onclick="prBuka('${escapeHtml(p.id)}')">
    <td><b>${escapeHtml(p.kode)}</b>${p.kode.startsWith('UJI') ? '<div class="hi-muted">data uji coba</div>' : ''}</td>
    <td>${escapeHtml(p.usaha)}<div class="hi-muted">${escapeHtml(p.jenis || '')}</div></td>
    <td>${escapeHtml(PR_STATUS[p.status] || p.status)}${p.menunggu_imam ? ` <span class="pr-count on">${p.menunggu_imam} menunggu Anda</span>` : ''}</td>
    <td>${p.tugas_selesai}/${p.tugas_total}</td><td>${p.putaran}/${p.maks_putaran}${p.bug_terbuka ? ` · <b style="color:#c0392b">${p.bug_terbuka} bug</b>` : ''}</td>
    <td>${prTgl(p.mulai)} → ${prTgl(p.target)}</td><td style="text-align:right">${prUsd(p.biaya)}</td><td><button class="vo-btn">Detail</button></td></tr>`).join('')
    : `<tr><td colspan="8" class="hi-muted">Belum ada proyek aktif. Proyek dibuat otomatis saat brief berstatus Deal.${(pr.data.proyek || []).length ? ' Centang "tampilkan selesai/batal" untuk melihat contoh uji coba.' : ''}</td></tr>`;
}

async function prBuka(id) {
  openSharedModal('<div class="hi-muted">Memuat…</div>');
  try {
    pr.detail = await crmApi('/api/office/produksi?id=' + encodeURIComponent(id));
  } catch (e) { openSharedModal(`<div class="hi-warn">${escapeHtml(e.message)}</div>`); return; }
  const d = pr.detail, p = d.proyek, b = d.brief || {}, ren = p.rencana || {};
  const sec = (judul, isi) => `<div class="pr-sec"><div class="pr-sec-h">${judul}</div>${isi}</div>`;
  const putaran = [...new Set(d.uji.map(u => u.putaran))];
  openSharedModal(`<div class="pr-modal">
    <h3>${escapeHtml(p.kode)} · ${escapeHtml(p.nama_usaha)}</h3>
    <div class="hi-muted">${escapeHtml(p.jenis_proyek || '')} · ${escapeHtml(PR_STATUS[p.status] || p.status)} · ${prTgl(p.mulai)} → ${prTgl(p.target_selesai)} · biaya token ${prUsd(d.biaya)}
      ${p.preview_url ? ` · <a href="${prUrl(p.preview_url)}" target="_blank" rel="noopener">Preview ↗</a>` : ''}</div>
    ${p.catatan ? `<div class="hi-warn">${escapeHtml(p.catatan)}</div>` : ''}
    ${sec('Brief', `<div class="pr-isi">${escapeHtml(b.masalah || '-')}${b.harapan ? '<br><span class="hi-muted">Harapan:</span> ' + escapeHtml(b.harapan) : ''}</div>
      <div class="hi-muted">${escapeHtml((b.fitur || []).join(' · '))}${b.target_waktu ? ' · target ' + escapeHtml(b.target_waktu) : ''}</div>`)}
    ${ren.ringkasan || ren.timeline ? sec('Rencana Project Manager', `<div class="pr-isi">${escapeHtml(ren.ringkasan || '')}</div>
      ${(ren.timeline || []).length ? `<div class="pr-chips">${ren.timeline.map(x => `<span>${escapeHtml(x.tahap)} · hari ${x.hari_ke}–${Number(x.hari_ke) + Number(x.durasi_hari) - 1}</span>`).join('')}</div>` : ''}
      ${(p.kriteria_uji || []).length ? `<details><summary>${p.kriteria_uji.length} kriteria uji</summary><ol>${p.kriteria_uji.map(k => `<li><b>${escapeHtml(k.fitur || '')}</b> — ${escapeHtml(k.langkah || '')} → ${escapeHtml(k.harapan || '')}</li>`).join('')}</ol></details>` : ''}
      ${(ren.risiko || []).length ? `<div class="hi-muted">Risiko: ${escapeHtml(ren.risiko.join('; '))}</div>` : ''}`) : ''}
    ${sec('Tugas & hasil kerja', `<table class="pf-table"><thead><tr><th>Kode</th><th>Tugas</th><th>Meja</th><th>Status</th><th>Setelah</th><th></th></tr></thead><tbody>${
      d.tugas.map((t, i) => `<tr><td>${escapeHtml(t.kode || '')}</td><td>${escapeHtml(t.judul)}${t.error ? `<div class="hi-warn">${escapeHtml(t.error)}</div>` : ''}</td>
        <td>${escapeHtml(PR_MEJA[t.meja] || t.meja)}</td><td>${escapeHtml(PR_TUGAS[t.status] || t.status)}${t.percobaan > 1 ? ` (${t.percobaan}x)` : ''}</td>
        <td class="hi-muted">${escapeHtml((t.setelah || []).join(', '))}</td><td>${t.hasil ? `<button class="vo-btn" onclick="prHasil(${i})">Hasil</button>` : ''}</td></tr>`).join('')
    }</tbody></table>`)}
    ${putaran.length ? sec('Pengujian', putaran.map(n => `<div class="pr-putaran"><b>Putaran ${n}</b>${d.uji.filter(u => u.putaran === n).map(u => {
      const i = d.uji.indexOf(u);
      return `<div class="pr-uji"><span class="pr-badge pr-${u.status === 'lulus' ? 'aktif' : 'gagal'}">${escapeHtml(u.jenis)}: ${escapeHtml(u.status)}</span>
        <span class="pr-isi">${escapeHtml(u.ringkasan || '')}</span>${u.laporan_md ? `<button class="vo-btn" onclick="prLaporan(${i})">Laporan</button>` : ''}</div>`;
    }).join('')}</div>`).join('')) : ''}
    ${d.bug.length ? sec('Bug', `<table class="pf-table"><thead><tr><th>Putaran</th><th>Bug</th><th>Keparahan</th><th>Status</th></tr></thead><tbody>${
      d.bug.map(g => `<tr><td>${g.putaran}</td><td>${escapeHtml(g.judul)}${g.aktual ? `<div class="hi-muted">${escapeHtml(g.aktual)}</div>` : ''}</td>
        <td>${escapeHtml(g.keparahan)}</td><td>${escapeHtml(g.status)}</td></tr>`).join('')}</tbody></table>`) : ''}
    ${d.keputusan.length ? sec('Keputusan Imam', d.keputusan.map(k => `<div class="pr-kep"><span class="pr-badge pr-${k.status === 'menunggu' ? 'uji' : k.status === 'disetujui' ? 'aktif' : 'jeda'}">${escapeHtml(k.status)}</span>
      <span class="pr-isi">${escapeHtml(String(k.ringkasan || '').split('\n')[0])}</span><span class="hi-muted">${escapeHtml(officeAgo(k.dibuat))}</span></div>`).join('')
      + (d.keputusan.some(k => k.status === 'menunggu') ? `<button class="vo-btn hi-utama" style="margin-top:8px" onclick="showPage('hari-ini');pfCloseModal()">Putuskan di Hari Ini</button>` : '')) : ''}
    ${d.pesan.length ? sec('Pesan WA ke klien', d.pesan.map(m => `<div class="pr-kep"><span class="pr-badge pr-${m.status === 'terkirim' ? 'aktif' : 'jeda'}">${escapeHtml(m.status)}</span>
      <span class="pr-isi" style="white-space:pre-wrap">${escapeHtml(m.pesan)}</span></div>`).join('')) : ''}
  </div>`);
}

function prTampil(judul, isi) {
  openSharedModal(`<div class="pr-modal"><button class="vo-btn" onclick="prBuka('${escapeHtml(pr.detail.proyek.id)}')">← Kembali</button>
    <h3 style="margin-top:10px">${escapeHtml(judul)}</h3>${isi}</div>`);
}

function prHasil(i) {
  const t = pr.detail.tugas[i], h = t.hasil || {};
  let isi = '';
  if (t.jenis === 'rencana') isi = `<pre class="pr-pre">${escapeHtml(JSON.stringify({ ringkasan: h.ringkasan, timeline: h.timeline, tugas: h.tugas, risiko: h.risiko }, null, 2))}</pre>`;
  else if (t.jenis === 'build' || t.jenis === 'revisi') isi = h.preview_url ? `<p>Preview: <a href="${prUrl(h.preview_url)}" target="_blank" rel="noopener">${escapeHtml(h.preview_url)}</a></p>${h.catatan ? `<p>${escapeHtml(h.catatan)}</p>` : ''}` : '<p class="hi-muted">Belum ada preview.</p>';
  else {
    if (h.ringkasan) isi += `<p>${escapeHtml(h.ringkasan)}</p>`;
    if (h.arah_visual) {
      const v = h.arah_visual;
      isi += `<div class="pr-chips">${(v.palet || []).map(c => `<span><i style="display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-1px;background:${/^#[0-9a-f]{3,8}$/i.test(c) ? c : '#ccc'}"></i> ${escapeHtml(c)}</span>`).join('')}
        ${v.font ? `<span>Judul: ${escapeHtml(v.font.judul || '-')}</span><span>Isi: ${escapeHtml(v.font.isi || '-')}</span>` : ''}</div><p>${escapeHtml(v.gaya || '')}</p>`;
    }
    if ((h.daftar_aset || []).length) isi += `<table class="pf-table"><thead><tr><th>Aset</th><th>Halaman</th><th>Ukuran</th><th>Sumber</th><th>Prompt / alt</th></tr></thead><tbody>${
      h.daftar_aset.map(a => `<tr><td>${escapeHtml(a.nama)}</td><td>${escapeHtml(a.halaman || '')}</td><td>${escapeHtml(a.ukuran || '')}</td><td>${escapeHtml(a.sumber || '')}</td>
        <td class="hi-muted">${escapeHtml(a.prompt_gambar || '')}${a.alt ? '<br>alt: ' + escapeHtml(a.alt) : ''}</td></tr>`).join('')}</tbody></table>`;
    if (h.dokumen_md) isi += `<pre class="pr-pre">${escapeHtml(h.dokumen_md)}</pre>`;
    if ((h.perlu_data || []).length) isi += `<div class="hi-warn">Perlu data dari klien: ${escapeHtml(h.perlu_data.join('; '))}</div>`;
    if (!isi) isi = `<pre class="pr-pre">${escapeHtml(JSON.stringify(h, null, 2))}</pre>`;
  }
  prTampil(`${t.kode || ''} · ${t.judul}`, isi);
}

function prLaporan(i) {
  const u = pr.detail.uji[i];
  const sk = (u.skenario || []).length ? `<table class="pf-table"><thead><tr><th>Skenario</th><th>Status</th><th>Catatan</th></tr></thead><tbody>${
    u.skenario.map(s => `<tr><td>${escapeHtml(s.id || '')}</td><td>${escapeHtml(s.status || '')}</td><td>${escapeHtml(s.catatan || '')}</td></tr>`).join('')}</tbody></table>` : '';
  prTampil(`Laporan uji ${u.jenis} · putaran ${u.putaran}`, `<p>${escapeHtml(u.ringkasan || '')}</p>${sk}<pre class="pr-pre">${escapeHtml(u.laporan_md || '')}</pre>`);
}
