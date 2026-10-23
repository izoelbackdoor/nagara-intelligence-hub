// Studio Desain — alur kerja, tim & jobdesk, daftar job + hasil desain, form job baru, aktivitas.
// Data: GET /api/office/desain[?id=<job>] → RPC hub_desain(). Aksi: POST /api/office/desain-aksi {op: buat|putuskan|ulang}.
// Mockup HTML dibuka lewat GET /api/office/desain-aset?id= (CSP sandbox, terisolasi dari sesi dashboard).
/* global escapeHtml, crmApi, officeAgo, openSharedModal, pfCloseModal, showPage */

const ds = { data: null, view: 'alur', semua: false, detail: null, busy: false };
const dsEl = id => document.getElementById(id);
const dsUsd = n => '$' + Number(n || 0).toFixed(2);
const dsUrl = u => (/^https:\/\//i.test(String(u || '')) ? escapeHtml(u) : '#');
const dsHex = c => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '#ccc');
const DS_STATUS = {
  rencana: 'Rencana kreatif', produksi: 'Produksi', review: 'Review internal', menunggu_imam: 'Menunggu Anda',
  disetujui: 'Disetujui', batal: 'Ditolak', gagal: 'Gagal',
};
const DS_JENIS = { uiux: 'UI/UX web & app', brand: 'Brand & logo', konten: 'Konten sosmed & iklan', motion: 'Video pendek' };
const DS_MEJA = { 'desain-ad': 'Art Director', 'desain-uiux': 'UI/UX Designer', 'desain-brand': 'Brand Designer', 'desain-konten': 'Social & Ads Designer', 'desain-motion': 'Motion Designer' };
const DS_TUGAS = { antre: 'Antre', dikerjakan: 'Dikerjakan', review: 'Menunggu media', selesai: 'Selesai', batal: 'Batal', gagal: 'Gagal' };
const DS_KELAS = { menunggu_imam: 'uji', disetujui: 'aktif', gagal: 'gagal', batal: 'gagal' };

// Alur kerja tim — siapa, apa, dan titik keputusan Imam
const DS_ALUR = [
  { tahap: [], judul: 'Job masuk', siapa: 'Imam',
    isi: 'Isi form "Job baru": jenis pekerjaan, permintaan, referensi, ukuran. Bisa ditarik dari brief klien sehingga data usaha, selera desain, dan referensi ikut terbaca tim.',
    gate: 'Imam: kirim job ke Art Director' },
  { tahap: ['rencana'], judul: 'Rencana kreatif', siapa: 'Art Director',
    isi: 'Menetapkan arah kreatif yang khas untuk bisnis itu (positioning, palet hex, font, gaya visual, tone), lalu membagi tugas hanya ke desainer yang dibutuhkan, lengkap dengan deliverable, ukuran, dan jatah gambar/video.',
    gate: 'Otomatis' },
  { tahap: ['produksi'], judul: 'Produksi', siapa: 'UI/UX · Brand · Konten · Motion',
    isi: 'Bekerja paralel. UI/UX: mockup HTML + catatan UX. Brand: 3 konsep logo, guideline, brand story. Konten: post/carousel/iklan siap posting + caption. Motion: storyboard, keyframe, klip video.',
    gate: 'Otomatis' },
  { tahap: [], media: true, judul: 'Gambar & video', siapa: 'Generator gambar & video',
    isi: 'Prompt dari desainer dikirim ke Higgsfield: gambar (Ideogram 4.0, kuat untuk teks di gambar) dan video (Kling 3.0 Turbo dari keyframe). Gagal dicoba ulang 1x; batas waktu 20 menit gambar, 45 menit video.',
    gate: 'Otomatis' },
  { tahap: ['review'], judul: 'Review kualitas', siapa: 'Art Director',
    isi: 'Melihat semua aset (termasuk gambarnya) dengan daftar periksa standar kualitas: ide khas, headline ≤2 baris, teks di gambar ≤6 kata & ejaan, kontras, tanpa pola generik, tanpa bukti karangan. Tidak lolos → revisi otomatis ke desainer terkait, maks 2 putaran.',
    gate: 'Otomatis; lolos/habis putaran → ke Anda' },
  { tahap: ['menunggu_imam'], judul: 'Keputusan Anda', siapa: 'Imam',
    isi: 'Notifikasi Telegram berisi skor & ringkasan jujur Art Director. Buka job di menu ini, lihat semua aset, lalu Setujui, Minta revisi (catatan wajib → Art Director menyusun ulang rencana), atau Tolak.',
    gate: 'Imam: Setujui / Revisi / Tolak' },
  { tahap: ['disetujui'], judul: 'Kirim ke klien', siapa: 'Sistem',
    isi: 'Setelah disetujui, link pratinjau (hanya lihat, tanpa catatan internal & prompt) dikirim ke WA klien beserta catatan Anda. Job internal tanpa nomor WA cukup disimpan.',
    gate: 'Otomatis setelah Anda setujui' },
];

async function dsInit() {
  if (!ds.data) dsSetView(ds.view);
  await dsLoad();
}

async function dsLoad() {
  const err = dsEl('ds-error');
  try {
    ds.data = await crmApi('/api/office/desain');
    err.style.display = 'none';
  } catch (e) {
    err.innerHTML = /hub_desain|404/.test(e.message) ? '<b>Fungsi database belum ada.</b> Migrasi <code>hub_04_desain</code> belum dijalankan.' : escapeHtml(e.message);
    err.style.display = 'block';
    return;
  }
  dsRender();
}

function dsSetView(v) {
  ds.view = v;
  document.querySelectorAll('#ds-views .crm-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  ['alur', 'tim', 'job', 'baru', 'aktivitas'].forEach(k => { dsEl('ds-view-' + k).style.display = k === v ? '' : 'none'; });
}

function dsRender() {
  const d = ds.data, t = d.tahap || {}, tim = d.tim || [];
  const jobs = d.job || [];
  const aktif = jobs.filter(j => !['disetujui', 'batal'].includes(j.status));
  const tunggu = Number(t.menunggu_imam || 0);
  const antre = tim.reduce((s, m) => s + Number(m.antre || 0) + Number(m.dikerjakan || 0), 0);
  const gagal = Number(t.gagal || 0);
  const terakhir = tim.map(m => m.terakhir).filter(Boolean).sort().pop();
  dsEl('ds-kpis').innerHTML = [
    [aktif.length, 'job berjalan'],
    [tunggu, 'menunggu keputusan Anda', tunggu ? 'color:var(--brand-orange)' : ''],
    [antre, 'tugas antre / dikerjakan'],
    [d.media_proses || 0, 'gambar & video diproses'],
    [gagal, 'job gagal', gagal ? 'color:#c0392b' : ''],
    [dsUsd(d.biaya_7h), 'biaya token tim 7 hari'],
    [terakhir ? officeAgo(terakhir) : '—', 'aktivitas agen terakhir', 'font-size:19px'],
  ].map(([v, l, st]) => `<div class="aio-kpi"><b style="${st || ''}">${v}</b><span>${l}</span></div>`).join('');
  const navBadge = dsEl('ds-nav-badge');
  if (navBadge) { navBadge.textContent = tunggu; navBadge.style.display = tunggu ? '' : 'none'; }

  // Peringatan: tugas antre lama tanpa diambil = workflow n8n belum jalan
  const macet = antre > 0 && (!terakhir || Date.now() - new Date(terakhir).getTime() > 15 * 60000);
  dsEl('ds-warn').innerHTML = macet ? `<div class="aio-mock-banner" style="display:block"><b>Tugas mengantre tapi belum diambil agen.</b>
    Pastikan workflow n8n <b>NADI 6 - Studio Desain</b> sudah di-import dan aktif, dengan credential Anthropic & Higgsfield terisi.</div>` : '';

  dsEl('ds-alur').innerHTML = DS_ALUR.map((a, i) => {
    const n = a.media ? Number(d.media_proses || 0) : a.tahap.reduce((s, k) => s + Number(t[k] || 0), 0);
    const label = a.media ? 'aset' : 'job';
    const count = a.tahap.length || a.media ? `<span class="pr-count ${n ? 'on' : ''}">${n} ${label}</span>` : '';
    return `<div class="pr-step"><div class="pr-step-no">${i + 1}</div>
      <div class="pr-step-head"><b>${escapeHtml(a.judul)}</b>${count}</div>
      <div class="pr-siapa">${escapeHtml(a.siapa)}</div><div class="pr-isi">${escapeHtml(a.isi)}</div>
      <div class="pr-gate">${a.gate.startsWith('Imam') ? '🔑 ' : '⚙️ '}${escapeHtml(a.gate)}</div></div>`;
  }).join('<div class="pr-arrow">→</div>');

  const p = d.pengaturan || {};
  dsEl('ds-atur').textContent = `Batas per job: ${p.maks_gambar ?? '-'} gambar, ${p.maks_video ?? '-'} video, revisi otomatis maks ${p.maks_revisi_ai ?? '-'} putaran. Kirim WA ke klien setelah disetujui: ${p.kirim_wa_klien ? 'aktif' : 'mati'}.`;

  dsEl('ds-tim').innerHTML = tim.map(m => {
    const j = m.jobdesc || {};
    return `<div class="pr-agent">
      <div class="pr-agent-head"><b>${escapeHtml(m.nama)}</b><span class="pr-badge pr-${escapeHtml(m.status)}">${escapeHtml(m.status)}</span></div>
      <div class="hi-muted">${escapeHtml(m.model || '-')}${m.budget != null ? ' · budget ' + dsUsd(m.budget) + '/hari' : ''}${j.max_tokens ? ' · maks ' + Number(j.max_tokens).toLocaleString('id-ID') + ' token/jawaban' : ''}</div>
      <div class="pr-isi" style="margin:8px 0">${escapeHtml(m.peran || '')}</div>
      ${(j.tugas || []).length ? `<div class="pr-chips">${j.tugas.map(x => `<span>${escapeHtml(x)}</span>`).join('')}</div>` : ''}
      <div class="pr-stat"><span>Antre <b>${m.antre}</b></span><span>Dikerjakan <b>${m.dikerjakan}</b></span><span>Selesai 7h <b>${m.selesai_7h}</b></span>
        ${m.gagal_7h ? `<span>Gagal 7h <b style="color:#c0392b">${m.gagal_7h}</b></span>` : ''}
        <span>Hari ini <b>${dsUsd(m.usd_hari_ini)}</b></span><span>7 hari <b>${dsUsd(m.usd_7h)}</b></span>
        <span>Terakhir <b>${escapeHtml(m.terakhir ? officeAgo(m.terakhir) : 'belum pernah')}</b></span></div>
      ${m.prompt ? `<details class="pr-prompt"><summary>Lihat instruksi kerja (system prompt)</summary><pre>${escapeHtml(m.prompt)}</pre></details>` : ''}
    </div>`;
  }).join('');

  dsRenderJob();
  dsRenderForm();

  dsEl('ds-akt').innerHTML = (d.aktivitas || []).length ? d.aktivitas.map(e => `<tr><td style="white-space:nowrap">${escapeHtml(officeAgo(e.waktu))}</td>
    <td>${escapeHtml(DS_MEJA[e.meja] || e.meja || '-')}</td><td>${escapeHtml(e.level)}</td><td>${escapeHtml(e.pesan)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="hi-muted">Belum ada aktivitas.</td></tr>';
  dsEl('ds-updated').textContent = 'Diperbarui ' + new Date(d.generated_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function dsRenderJob() {
  const list = (ds.data.job || []).filter(j => ds.semua || !['disetujui', 'batal'].includes(j.status));
  dsEl('ds-job').innerHTML = list.length ? list.map(j => `<div class="ds-job" onclick="dsBuka('${escapeHtml(j.id)}')" role="button" tabindex="0" onkeydown="if(event.key==='Enter')dsBuka('${escapeHtml(j.id)}')">
      <div class="ds-thumb">${j.thumb ? `<img src="${dsUrl(j.thumb)}" alt="" loading="lazy">` : `<span>${escapeHtml(j.kode)}</span>`}</div>
      <div class="ds-job-body">
        <div class="pr-agent-head"><b>${escapeHtml(j.kode)}</b><span class="pr-badge pr-${DS_KELAS[j.status] || ''}">${escapeHtml(DS_STATUS[j.status] || j.status)}</span></div>
        <div class="ds-job-judul">${escapeHtml(j.judul)}</div>
        <div class="hi-muted">${escapeHtml(j.usaha || 'Internal NADI')} · ${escapeHtml((j.jenis || []).map(x => DS_JENIS[x] || x).join(', '))}</div>
        <div class="pr-stat"><span>Halaman <b>${j.halaman}</b></span><span>Gambar <b>${j.gambar}</b></span><span>Video <b>${j.video}</b></span>
          ${j.media_proses ? `<span>Diproses <b>${j.media_proses}</b></span>` : ''}${j.skor != null ? `<span>Skor AD <b>${escapeHtml(j.skor)}/10</b></span>` : ''}
          <span>Revisi <b>${j.revisi}</b></span><span>Biaya <b>${dsUsd(j.biaya)}</b></span><span>${escapeHtml(officeAgo(j.diperbarui))}</span></div>
      </div></div>`).join('')
    : `<div class="hi-empty">Belum ada job berjalan. Buat dari tab "Job baru".${(ds.data.job || []).length ? ' Centang "tampilkan selesai/ditolak" untuk melihat job lama.' : ''}</div>`;
}

function dsRenderForm() {
  const sel = dsEl('ds-f-brief');
  if (sel && sel.options.length <= 1) {
    sel.innerHTML = '<option value="">— tanpa brief / job internal NADI —</option>'
      + (ds.data.brief || []).map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.label)}</option>`).join('');
  }
}

async function dsKirimJob(btn) {
  if (ds.busy) return;
  const out = dsEl('ds-f-hasil');
  const jenis = [...document.querySelectorAll('#ds-f-jenis input:checked')].map(i => i.value);
  const v = id => (dsEl(id)?.value || '').trim();
  const job = { jenis, brief_id: v('ds-f-brief') || null, judul: v('ds-f-judul'), nama_usaha: v('ds-f-usaha'), nama_klien: v('ds-f-pic'),
    no_wa: v('ds-f-wa'), deskripsi: v('ds-f-desk'), referensi: v('ds-f-ref'), platform: v('ds-f-uk'), jumlah: v('ds-f-jml'), tenggat: v('ds-f-dl') };
  if (!jenis.length) { out.textContent = 'Pilih minimal satu jenis pekerjaan.'; return; }
  if (job.deskripsi.length < 10) { out.textContent = 'Tulis permintaan detail (minimal 10 karakter).'; return; }
  ds.busy = true; btn.disabled = true; out.textContent = 'Mengirim…';
  try {
    const r = await crmApi('/api/office/desain-aksi', { method: 'POST', body: JSON.stringify({ op: 'buat', job }) });
    out.textContent = '✓ ' + r.info;
    ['ds-f-judul', 'ds-f-usaha', 'ds-f-pic', 'ds-f-wa', 'ds-f-desk', 'ds-f-ref', 'ds-f-uk', 'ds-f-jml', 'ds-f-dl'].forEach(id => { if (dsEl(id)) dsEl(id).value = ''; });
    document.querySelectorAll('#ds-f-jenis input').forEach(i => { i.checked = false; });
    await dsLoad();
    dsSetView('job');
  } catch (e) { out.textContent = '✗ ' + e.message; }
  finally { ds.busy = false; btn.disabled = false; }
}

async function dsBuka(id) {
  openSharedModal('<div class="hi-muted">Memuat…</div>');
  try {
    ds.detail = await crmApi('/api/office/desain?id=' + encodeURIComponent(id));
  } catch (e) { openSharedModal(`<div class="hi-warn">${escapeHtml(e.message)}</div>`); return; }
  dsRenderDetail();
}

function dsRenderDetail() {
  const d = ds.detail, j = d.job, ak = (d.rencana || {}).arah_kreatif, rv = d.review || {}, mi = j.permintaan || {};
  const sec = (judul, isi) => `<div class="pr-sec"><div class="pr-sec-h">${judul}</div>${isi}</div>`;
  const uji = /^UJI\b/i.test(j.judul);

  const keputusan = j.status === 'menunggu_imam' ? `<div class="ds-putus">
      <div class="pr-sec-h" style="margin:0 0 6px">Keputusan Anda</div>
      <textarea class="hi-input" id="ds-catatan" rows="3" placeholder="Wajib untuk revisi (mis. warna terlalu gelap, headline post 2 diganti). Jika disetujui, catatan ikut terkirim ke klien."></textarea>
      <div class="hi-aksi-row">
        <button class="vo-btn hi-utama" onclick="dsPutuskan('setujui')">Setujui${j.wa ? ' & kirim ke klien' : ''}</button>
        <button class="vo-btn" onclick="dsPutuskan('revisi')">Minta revisi</button>
        <button class="vo-btn" style="color:#c0392b" onclick="dsPutuskan('tolak')">Tolak</button>
      </div><div class="hi-hasil" id="ds-putus-hasil"></div></div>`
    : j.status === 'gagal' ? `<div class="ds-putus"><div class="hi-warn">Job berhenti karena ada tugas gagal 3 kali. Cek error di "Jejak kerja" lalu coba lagi.</div>
      <button class="vo-btn hi-utama" onclick="dsUlang()">Coba lagi</button><div class="hi-hasil" id="ds-putus-hasil"></div></div>` : '';

  // Kelompokkan aset per desainer
  const grup = {};
  for (const a of d.aset) (grup[a.meja] = grup[a.meja] || { nama: a.meja_nama, list: [] }).list.push(a);
  const asetHtml = Object.values(grup).map(g => {
    const visual = g.list.filter(a => a.jenis === 'image' || a.jenis === 'video');
    const halaman = g.list.filter(a => a.jenis === 'html');
    const teks = g.list.filter(a => a.jenis === 'teks');
    return `<div class="ds-grup"><div class="ds-grup-h">${escapeHtml(g.nama)}</div>
      ${halaman.map(a => `<div class="ds-frame-wrap"><div class="ds-frame-bar"><b>${escapeHtml(a.judul)}</b><span class="hi-muted">v${a.versi}</span><span style="flex:1"></span>
          <a href="/api/office/desain-aset?id=${encodeURIComponent(a.id)}" target="_blank" rel="noopener">Buka layar penuh ↗</a></div>
        <iframe class="ds-frame" loading="lazy" sandbox="allow-scripts allow-popups" src="/api/office/desain-aset?id=${encodeURIComponent(a.id)}" title="${escapeHtml(a.judul)}"></iframe></div>`).join('')}
      ${visual.length ? `<div class="ds-galeri">${visual.map(a => `<figure class="ds-media">
          ${a.status === 'siap' && a.url ? (a.jenis === 'image'
            ? `<a href="${dsUrl(a.url)}" target="_blank" rel="noopener"><img src="${dsUrl(a.url)}" alt="${escapeHtml(a.judul)}" loading="lazy"></a>`
            : `<video src="${dsUrl(a.url)}" controls playsinline preload="metadata"></video>`)
            : `<div class="ds-media-kosong">${a.status === 'gagal' ? 'Gagal dibuat' : 'Sedang dibuat…'}</div>`}
          <figcaption><b>${escapeHtml(a.judul)}</b>${a.rasio ? ` <span class="hi-muted">${escapeHtml(a.rasio)}</span>` : ''}
            ${a.error ? `<div class="hi-warn">${escapeHtml(a.error)}</div>` : ''}
            ${a.prompt ? `<details><summary>Prompt</summary><div class="hi-muted">${escapeHtml(a.prompt)}</div></details>` : ''}</figcaption></figure>`).join('')}</div>` : ''}
      ${teks.map(a => `<details class="ds-teks" ${/^Catatan /.test(a.judul) ? '' : 'open'}><summary><b>${escapeHtml(a.judul)}</b></summary><pre class="pr-pre">${escapeHtml(a.konten || '')}</pre></details>`).join('')}
    </div>`;
  }).join('');

  openSharedModal(`<div class="pr-modal ds-modal">
    <h3>${escapeHtml(j.kode)} · ${escapeHtml(j.judul)}</h3>
    <div class="hi-muted">${escapeHtml(j.usaha || 'Internal NADI')}${j.klien ? ' · ' + escapeHtml(j.klien) : ''} · ${escapeHtml((j.jenis || []).map(x => DS_JENIS[x] || x).join(', '))}
      · <b>${escapeHtml(DS_STATUS[j.status] || j.status)}</b> · revisi otomatis ${j.revisi_ai}, revisi Anda ${j.revisi_imam} · biaya token ${dsUsd(d.biaya)}</div>
    ${uji ? '<div class="hi-warn">Data uji coba: gambar memakai URL contoh sehingga tidak tampil.</div>' : ''}
    ${keputusan}
    ${rv.ringkasan_untuk_imam ? sec(`Review Art Director · skor ${escapeHtml(rv.skor ?? '-')}/10 ${rv.lolos ? '<span class="pr-badge pr-aktif">lolos</span>' : '<span class="pr-badge pr-uji">belum lolos</span>'}`,
      `<div class="pr-isi" style="white-space:pre-wrap">${escapeHtml(rv.ringkasan_untuk_imam)}</div>
       ${(rv.per_aset || []).length ? `<table class="pf-table" style="margin-top:6px"><tbody>${rv.per_aset.map(x => `<tr><td><b>${escapeHtml(x.judul)}</b></td><td>${escapeHtml(x.catatan)}</td></tr>`).join('')}</tbody></table>` : ''}`) : ''}
    ${(d.rencana?.pertanyaan_untuk_imam || []).length ? sec('Pertanyaan Art Director', `<ul>${d.rencana.pertanyaan_untuk_imam.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`) : ''}
    ${sec('Permintaan', `<div class="pr-isi" style="white-space:pre-wrap">${escapeHtml(mi.deskripsi || '-')}</div>
      <div class="hi-muted">${[mi.platform_ukuran && 'Ukuran: ' + mi.platform_ukuran, mi.jumlah && 'Jumlah: ' + mi.jumlah, mi.referensi && 'Referensi: ' + mi.referensi, mi.tenggat && 'Tenggat: ' + mi.tenggat].filter(Boolean).map(escapeHtml).join(' · ')}</div>
      ${d.brief ? `<div class="hi-muted" style="margin-top:4px">Brief: ${escapeHtml([d.brief.kategori, d.brief.kota, d.brief.masalah, d.brief.selera_desain && 'selera: ' + d.brief.selera_desain].filter(Boolean).join(' · '))}</div>` : ''}
      ${j.catatan_imam ? `<div class="hi-warn">Catatan revisi Anda terakhir: ${escapeHtml(j.catatan_imam)}</div>` : ''}`)}
    ${ak ? sec('Arah kreatif', `<div class="pr-isi">${escapeHtml(d.rencana.ringkasan || '')}</div>
      ${ak.positioning ? `<div class="pr-isi"><b>Positioning:</b> ${escapeHtml(ak.positioning)}</div>` : ''}
      <div class="ds-palet">${(ak.palet || []).map(c => `<div><i style="background:${dsHex(c.hex)}"></i><b>${escapeHtml(c.nama || '')}</b><span>${escapeHtml(c.hex || '')}</span>${c.pakai_untuk ? `<span class="hi-muted">${escapeHtml(c.pakai_untuk)}</span>` : ''}</div>`).join('')}</div>
      <div class="pr-chips">${ak.font_judul ? `<span>Judul: ${escapeHtml(ak.font_judul)}</span>` : ''}${ak.font_isi ? `<span>Isi: ${escapeHtml(ak.font_isi)}</span>` : ''}
        ${(ak.mood || []).map(m => `<span>${escapeHtml(m)}</span>`).join('')}</div>
      ${ak.gaya_visual ? `<div class="pr-isi"><b>Gaya visual:</b> ${escapeHtml(ak.gaya_visual)}</div>` : ''}${ak.tone_bahasa ? `<div class="pr-isi"><b>Tone:</b> ${escapeHtml(ak.tone_bahasa)}</div>` : ''}`) : ''}
    ${sec(`Hasil desain${d.versi_lama ? ` <span class="hi-muted">(${d.versi_lama} aset versi lama diarsipkan)</span>` : ''}`, asetHtml || '<div class="hi-muted">Belum ada aset.</div>')}
    ${sec('Jejak kerja tim', `<table class="pf-table"><thead><tr><th>Tugas</th><th>Agen</th><th>Tahap</th><th>Status</th><th style="text-align:right">Biaya</th></tr></thead><tbody>${
      d.tugas.map(t => `<tr><td>${escapeHtml(t.judul)}${t.catatan_revisi ? `<div class="hi-muted">Revisi: ${escapeHtml(typeof t.catatan_revisi === 'string' ? t.catatan_revisi : JSON.stringify(t.catatan_revisi))}</div>` : ''}${t.error ? `<div class="hi-warn">${escapeHtml(t.error)}</div>` : ''}</td>
        <td>${escapeHtml(DS_MEJA[t.meja] || t.meja)}</td><td>${escapeHtml(t.tahap || '')}</td>
        <td>${escapeHtml(DS_TUGAS[t.status] || t.status)}${t.percobaan > 1 ? ` (${t.percobaan}x)` : ''}</td><td style="text-align:right">${dsUsd(t.usd)}</td></tr>`).join('')
    }</tbody></table>`)}
    ${d.keputusan.length ? sec('Riwayat keputusan', d.keputusan.map(k => `<div class="pr-kep"><span class="pr-badge pr-${k.status === 'menunggu' ? 'uji' : k.status === 'disetujui' ? 'aktif' : 'jeda'}">${escapeHtml(k.status)}</span>
      <span class="pr-isi">${escapeHtml(k.catatan || '')}</span><span class="hi-muted">${escapeHtml(officeAgo(k.diputuskan || k.dibuat))}</span></div>`).join('')) : ''}
    ${j.status === 'disetujui' && j.link_klien ? sec('Link untuk klien (hanya lihat)', `<a href="${dsUrl(j.link_klien)}" target="_blank" rel="noopener">${escapeHtml(j.link_klien)}</a>`) : ''}
  </div>`);
}

async function dsPutuskan(aksi) {
  if (ds.busy) return;
  const j = ds.detail.job, out = dsEl('ds-putus-hasil'), catatan = (dsEl('ds-catatan')?.value || '').trim();
  if (aksi === 'revisi' && catatan.length < 5) { out.textContent = 'Tulis catatan revisi (minimal 5 karakter).'; return; }
  if (aksi === 'setujui' && j.wa && !confirm(`Setujui ${j.kode} dan kirim link pratinjau ke WA klien sekarang?`)) return;
  if (aksi === 'tolak' && !confirm(`Tolak dan hentikan ${j.kode}?`)) return;
  ds.busy = true; out.textContent = 'Memproses…';
  try {
    const r = await crmApi('/api/office/desain-aksi', { method: 'POST', body: JSON.stringify({ op: 'putuskan', id: j.id, aksi, catatan }) });
    out.textContent = '✓ ' + (r.info || 'Beres');
    await dsLoad();
    setTimeout(() => dsBuka(j.id), 900);
  } catch (e) { out.textContent = '✗ ' + e.message; }
  finally { ds.busy = false; }
}

async function dsUlang() {
  if (ds.busy) return;
  const j = ds.detail.job, out = dsEl('ds-putus-hasil');
  ds.busy = true; out.textContent = 'Memproses…';
  try {
    const r = await crmApi('/api/office/desain-aksi', { method: 'POST', body: JSON.stringify({ op: 'ulang', id: j.id }) });
    out.textContent = '✓ ' + (r.info || 'Beres');
    await dsLoad();
  } catch (e) { out.textContent = '✗ ' + e.message; }
  finally { ds.busy = false; }
}
