// Iklan Meta — tab "Iklan Meta & 11 Page FB" (halaman marketing-content, menu Konten & Marketing).
// Data: GET /api/office/iklan → RPC hub_iklan() (tabel mkt_iklan_*, disinkron n8n "NADI 7b - Iklan Meta" tiap 6 jam).
// Aksi: POST /api/office/iklan {op: rekomendasi|peringatan|budget}; analisis sekarang: POST /api/agents/iklan.
// Hanya baca: tidak ada yang diubah di akun iklan dari sini. Eksekusi tetap oleh Imam di Ads Manager.
/* global escapeHtml, crmApi, officeAgo */

const ik = { data: null, periode: null, semua: false, busy: false };
const ikEl = id => document.getElementById(id);
const ikRp = n => (n == null || isNaN(n) ? '—' : 'Rp ' + Math.round(Number(n)).toLocaleString('id-ID'));
const ikN = n => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('id-ID'));
const ikUsd = n => '$' + Number(n || 0).toFixed(3);
const ikTgl = d => (d ? new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const IK_STATUS = {
  ACTIVE: ['Aktif', 'pr-aktif'], PAUSED: ['Dijeda', ''], CAMPAIGN_PAUSED: ['Kampanye dijeda', ''], ADSET_PAUSED: ['Ad set dijeda', ''],
  DISAPPROVED: ['Ditolak', 'pr-gagal'], WITH_ISSUES: ['Bermasalah', 'pr-gagal'], PENDING_REVIEW: ['Direview', 'pr-uji'],
  PENDING_BILLING_INFO: ['Tertahan pembayaran', 'pr-gagal'], IN_PROCESS: ['Diproses', 'pr-uji'],
};
const IK_REK = { naikkan_budget: 'Naikkan budget', turunkan_budget: 'Turunkan budget', matikan: 'Matikan', aktifkan: 'Aktifkan', audiens: 'Audiens', materi: 'Materi', lainnya: 'Lainnya' };
const IK_PER = { m7: '7 hari', m30: '30 hari', total: 'Seumur' };

function ikBadge(s) {
  const [l, c] = IK_STATUS[s] || [s || '-', ''];
  return `<span class="pr-badge ${c}">${escapeHtml(l)}</span>`;
}

async function ikInit() { await ikLoad(); }

async function ikLoad() {
  const err = ikEl('ik-error');
  if (!err) return;
  try {
    ik.data = await crmApi('/api/office/iklan');
    err.style.display = 'none';
  } catch (e) {
    err.innerHTML = /hub_iklan|404/.test(e.message) ? '<b>Fungsi database belum ada.</b> Jalankan migrasi <code>20261024_iklan_meta.sql</code>.' : escapeHtml(e.message);
    err.style.display = 'block';
    return;
  }
  if (!ik.periode) ik.periode = Number((ik.data.akun_30h || {}).impresi || 0) > 0 ? 'm7' : 'total';   // tanpa tayangan 30 hari → tampilkan seumur
  ikRender();
}

function ikMetrik(e) {
  if (ik.periode === 'total') {
    const t = e.total || {};
    const sp = Number(t.spend || 0), im = Number(t.impresi || 0), kl = Number(t.klik || 0), h = Number(t.hasil || 0);
    return { spend: sp, impresi: im, klik: kl, hasil: h, ctr_persen: im ? +(100 * kl / im).toFixed(2) : null, cpc: kl ? sp / kl : null, cpr: h ? sp / h : null };
  }
  return e[ik.periode] || {};
}

function ikRender() {
  const d = ik.data, a = d.akun || {}, s = d.sinkron || {}, m7 = d.akun_7h || {}, m30 = d.akun_30h || {};
  const ent = d.entitas || [];
  const iklan = ent.filter(e => e.level === 'ad');
  const tot = iklan.reduce((o, e) => { const t = e.total || {}; o.spend += Number(t.spend || 0); o.hasil += Number(t.hasil || 0); return o; }, { spend: 0, hasil: 0 });

  // Status sinkron
  const st = s.terakhir;
  const okAt = s.terakhir_ok;
  const basi = !okAt || Date.now() - new Date(okAt).getTime() > 13 * 3600e3;
  ikEl('ik-sinkron').innerHTML = `Akun <b>${escapeHtml(a.act_id || '-')}</b> · Page ${escapeHtml(a.page_id || '-')} ·
    ${st ? `sinkron terakhir <b>${escapeHtml(officeAgo(st.waktu))}</b> (${escapeHtml(st.sumber === 'mcp_awal' ? 'impor awal' : 'n8n')}${st.ok === false ? ', <span style="color:#c0392b">gagal</span>' : ''})` : 'belum pernah sinkron'}
    ${basi ? ' · <span style="color:var(--brand-orange)">data tidak terbarui otomatis — aktifkan workflow n8n "NADI 7b - Iklan Meta"</span>' : ''}`;

  // Peringatan
  const per = (d.peringatan || []).filter(p => p.status === 'aktif');
  ikEl('ik-peringatan').innerHTML = per.map(p => `<div class="ik-alert">
      <div><b>⚠ ${escapeHtml(p.judul)}</b><div class="hi-muted">${escapeHtml(p.detail || '')} · sejak ${escapeHtml(officeAgo(p.dibuat))}</div></div>
      <button class="crm-btn-ghost" onclick="ikAbaikanPeringatan(${Number(p.id)}, this)">Abaikan 7 hari</button></div>`).join('');

  // KPI
  ikEl('ik-kpis').innerHTML = [
    [ikRp(m7.spend), 'belanja 7 hari'],
    [ikN(m7.hasil), 'hasil 7 hari'],
    [m7.cpr != null ? ikRp(m7.cpr) : '—', 'biaya per hasil 7 hari'],
    [m7.ctr_persen != null ? m7.ctr_persen + '%' : '—', 'CTR 7 hari'],
    [ikRp(m30.spend), 'belanja 30 hari'],
    [ikN(m30.hasil), 'hasil 30 hari'],
    [ikRp(tot.spend), `belanja seumur · ${ikN(tot.hasil)} hasil`],
    [a.batas_harian ? ikRp(a.batas_harian) : 'belum diisi', 'batas belanja harian', a.batas_harian ? '' : 'font-size:17px;color:var(--brand-orange)'],
  ].map(([v, l, stl]) => `<div class="aio-kpi"><b style="${stl || ''}">${v}</b><span>${escapeHtml(l)}</span></div>`).join('');

  ikRenderGrafik();
  ikRenderTabel();
  ikRenderAnalisis();

  const ag = d.agen || {};
  ikEl('ik-agen').textContent = `Analis Meta Ads · ${ag.model || '-'} · status ${ag.status || '-'} · biaya hari ini ${ikUsd(ag.usd_hari_ini)} (batas $${Number(ag.budget || 0).toFixed(2)}/hari) · 30 hari ${ikUsd(ag.usd_30h)}`;
  const bi = ikEl('ik-budget');
  if (bi && document.activeElement !== bi) bi.value = a.budget_bulanan ? Number(a.budget_bulanan) : '';
  ikEl('ik-updated').textContent = 'Diperbarui ' + new Date(d.generated_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function ikRenderGrafik() {
  const h = ik.data.harian || [];
  const max = Math.max(1, ...h.map(x => Number(x.spend || 0)));
  const W = 600, H = 110, bw = W / Math.max(1, h.length);
  const bars = h.map((x, i) => {
    const v = Number(x.spend || 0), bh = v ? Math.max(2, (v / max) * (H - 10)) : 0;
    const tip = `${ikTgl(x.tgl)} · ${ikRp(v)} · ${ikN(x.impresi)} impresi · ${ikN(x.klik)} klik · ${ikN(x.hasil)} hasil`;
    return `<g><title>${escapeHtml(tip)}</title><rect x="${(i * bw + 1).toFixed(1)}" y="${(H - bh).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="var(--brand-orange)"/>
      ${Number(x.hasil) ? `<circle cx="${(i * bw + bw / 2).toFixed(1)}" cy="${(H - 4 - bh).toFixed(1)}" r="3" fill="#2e9e5b"/>` : ''}</g>`;
  }).join('');
  const kosong = !h.some(x => Number(x.spend) || Number(x.impresi));
  ikEl('ik-grafik').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="ik-svg" role="img" aria-label="Belanja harian 30 hari">${bars}</svg>
    ${h.length ? `<div class="ik-sumbu"><span>${escapeHtml(ikTgl(h[0].tgl))}</span><span>${escapeHtml(ikTgl(h[h.length - 1].tgl))}</span></div>` : ''}
    <div class="hi-muted">Batang = belanja harian · titik hijau = ada hasil. ${kosong ? '<b>Tidak ada tayangan dalam 30 hari terakhir.</b>' : `Puncak ${ikRp(max)}/hari.`}</div>`;
}

function ikRenderTabel() {
  const ent = ik.data.entitas || [];
  const lihat = e => ik.semua || e.status === 'ACTIVE' || Number((e.m30 || {}).impresi || 0) > 0;
  const kamp = ent.filter(e => e.level === 'campaign' && lihat(e));
  const baris = (e, lv) => {
    const m = ikMetrik(e);
    const nama = `<span style="padding-left:${lv * 16}px">${lv ? '↳ ' : ''}${escapeHtml(e.nama || e.id)}</span>`;
    const info = e.level === 'campaign'
      ? `<div class="hi-muted" style="padding-left:0">${escapeHtml((e.tujuan || '').replace('OUTCOME_', '').toLowerCase() || '-')} · hasil = ${escapeHtml(e.jenis_hasil || '-')}${e.budget_harian ? ' · budget ' + ikRp(e.budget_harian) + '/hari' : ''} · tayang terakhir ${escapeHtml(ikTgl(e.terakhir_tayang))}</div>` : '';
    return `<tr class="ik-l${lv}"><td>${nama}${info}</td><td>${ikBadge(e.status)}</td><td class="num">${ikRp(m.spend)}</td><td class="num">${ikN(m.impresi)}</td>
      <td class="num">${ikN(m.klik)}</td><td class="num">${m.ctr_persen != null ? m.ctr_persen + '%' : '—'}</td><td class="num">${m.cpc != null ? ikRp(m.cpc) : '—'}</td>
      <td class="num">${ikN(m.hasil)}</td><td class="num">${m.cpr != null ? ikRp(m.cpr) : '—'}</td></tr>`;
  };
  const rows = [];
  kamp.forEach(c => {
    rows.push(baris(c, 0));
    ent.filter(s => s.level === 'adset' && s.campaign_id === c.id && (ik.semua || lihat(s) || s.status === 'ACTIVE')).forEach(s => {
      rows.push(baris(s, 1));
      ent.filter(x => x.level === 'ad' && x.adset_id === s.id).forEach(x => rows.push(baris(x, 2)));
    });
    ent.filter(x => x.level === 'ad' && x.campaign_id === c.id && !x.adset_id).forEach(x => rows.push(baris(x, 1)));
  });
  ikEl('ik-tabel').innerHTML = rows.length ? rows.join('')
    : `<tr><td colspan="9" class="hi-muted">Tidak ada kampanye aktif / tayang 30 hari. ${ik.semua ? '' : 'Centang "tampilkan semua" untuk melihat kampanye dijeda.'}</td></tr>`;
  document.querySelectorAll('#ik-periode .crm-view-btn').forEach(b => b.classList.toggle('active', b.dataset.p === ik.periode));
}

function ikRenderAnalisis() {
  const list = ik.data.analisis || [];
  const an = list[0];
  const box = ikEl('ik-analisis');
  if (!an) {
    box.innerHTML = '<div class="hi-muted">Belum ada analisis. Analis Meta Ads berjalan otomatis tiap Senin 06.30 WIB, atau klik "Analisis sekarang".</div>';
    ikEl('ik-riwayat').innerHTML = '';
    return;
  }
  if (an.status !== 'selesai') {
    const t = an.tugas || {};
    box.innerHTML = `<div class="hi-muted">${an.status === 'gagal' ? '<b style="color:#c0392b">Analisis gagal.</b> ' + escapeHtml(t.error || '') : `Analisis ${escapeHtml(ikTgl(an.periode_mulai))}–${escapeHtml(ikTgl(an.periode_selesai))} <b>${escapeHtml(t.status || 'antre')}</b> (percobaan ${Number(t.percobaan || 0)})${t.error ? ' · error terakhir: ' + escapeHtml(t.error) : ''}.`}</div>`;
    const prev = list.find(x => x.status === 'selesai');
    if (prev) box.innerHTML += ikHtmlAnalisis(prev);
  } else box.innerHTML = ikHtmlAnalisis(an);
  ikEl('ik-riwayat').innerHTML = list.slice(1).map(x => `<span class="hi-muted">${escapeHtml(ikTgl(x.periode_mulai))}–${escapeHtml(ikTgl(x.periode_selesai))} · ${escapeHtml(x.status)} · ${escapeHtml(x.sumber || '')} · ${ikUsd(x.biaya)}</span>`).join('<br>');
}

function ikHtmlAnalisis(an) {
  const h = an.hasil || {}, kep = an.keputusan || {};
  const rek = (h.rekomendasi || []).map((r, i) => {
    const k = kep[String(i)];
    const aksi = k
      ? `<span class="pr-badge ${k.status === 'dijalankan' ? 'pr-aktif' : ''}">${k.status === 'dijalankan' ? 'Sudah dijalankan' : 'Diabaikan'}</span>
         <button class="crm-btn-ghost" onclick="ikRek('${an.id}', ${i}, 'batal', this)">Batalkan</button>`
      : `<button class="vo-btn hi-utama" onclick="ikRek('${an.id}', ${i}, 'dijalankan', this)">Sudah saya jalankan di Ads Manager</button>
         <button class="crm-btn-ghost" onclick="ikRek('${an.id}', ${i}, 'diabaikan', this)">Abaikan</button>`;
    return `<div class="ik-rek${k ? ' ik-done' : ''}">
      <div class="ik-rek-h"><span class="pr-badge pr-uji">${escapeHtml(IK_REK[r.jenis] || r.jenis || 'Saran')}</span>
        <b>${i + 1}. ${escapeHtml(r.aksi || '')}</b>${r.perlu_uang ? ' <span class="pr-badge pr-gagal">menambah belanja</span>' : ''}</div>
      <div class="hi-muted">${escapeHtml(r.entitas_nama || '')}${r.prioritas ? ' · prioritas ' + escapeHtml(r.prioritas) : ''}</div>
      <div class="pr-isi"><b>Alasan:</b> ${escapeHtml(r.alasan || '')}</div>
      ${r.dampak ? `<div class="pr-isi"><b>Dampak:</b> ${escapeHtml(r.dampak)}</div>` : ''}
      <div class="hi-aksi-row">${aksi}</div></div>`;
  }).join('');
  const varr = (h.variasi_iklan || []).map((v, i) => `<div class="ik-var"><div class="hi-muted">IKL-${i + 1} · ${escapeHtml(v.untuk || '')} · CTA ${escapeHtml(v.cta || '-')}</div>
      <div class="ik-var-h">${escapeHtml(v.headline || '')}</div><div class="pr-isi">${escapeHtml(v.primary_text || '')}</div>
      ${v.deskripsi ? `<div class="hi-muted">${escapeHtml(v.deskripsi)}</div>` : ''}
      ${v.brief_visual ? `<details class="pr-prompt"><summary>Brief visual${v.perlu_visual === false ? '' : ' (dikirim ke Studio Desain)'}</summary><div class="pr-isi">${escapeHtml(v.brief_visual)}</div></details>` : ''}
      <button class="crm-btn-ghost" onclick="ikSalin(this)" data-t="${escapeHtml([v.primary_text, v.headline, v.deskripsi].filter(Boolean).join('\n'))}">Salin teks</button></div>`).join('');
  const a7 = h.angka_7h || {};
  return `<div class="ik-an-h">Analisis ${escapeHtml(ikTgl(an.periode_mulai))}–${escapeHtml(ikTgl(an.periode_selesai))}
      <span class="hi-muted">· ${escapeHtml(an.sumber === 'jadwal' ? 'jadwal Senin' : 'manual')} · ${escapeHtml(officeAgo(an.diperbarui))} · biaya token ${ikUsd(an.biaya)}</span></div>
    <div class="pr-isi" style="font-size:13.5px">${escapeHtml(h.ringkasan || '')}</div>
    ${a7.spend != null ? `<div class="hi-muted">Angka 7 hari menurut analis: belanja ${ikRp(a7.spend)} · ${ikN(a7.impresi)} impresi · ${ikN(a7.klik)} klik · ${ikN(a7.hasil)} hasil</div>` : ''}
    ${(h.temuan || []).length ? `<ul class="ik-temuan">${h.temuan.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}
    ${(h.per_iklan || []).length ? `<details class="pr-prompt"><summary>Penilaian per iklan (${h.per_iklan.length})</summary>${h.per_iklan.map(p => `<div class="pr-isi"><b>${escapeHtml(p.nama || p.id || '')}</b> — ${escapeHtml(p.status_saran || '')}: ${escapeHtml(p.alasan || '')}</div>`).join('')}</details>` : ''}
    <div class="hi-h">Rekomendasi (${(h.rekomendasi || []).length}) — Anda yang mengeksekusi di Ads Manager</div>${rek || '<div class="hi-muted">Tidak ada rekomendasi.</div>'}
    <div class="hi-h">3 variasi teks iklan</div>
    ${(an.cek || []).length ? `<div class="aio-mock-banner" style="display:block">Cek otomatis menemukan: ${an.cek.map(escapeHtml).join(', ')} — periksa sebelum dipakai.</div>` : ''}
    <div class="ik-vars">${varr || '<div class="hi-muted">-</div>'}</div>
    ${an.desain ? `<div class="hi-muted" style="margin-top:6px">Visual: job Studio Desain <a href="#desain" onclick="showPage('desain');return false">${escapeHtml(an.desain.kode)}</a> (${escapeHtml(an.desain.status)})</div>` : ''}
    ${h.eksperimen ? `<div class="pr-isi" style="margin-top:8px"><b>Uji A/B minggu ini:</b> ${escapeHtml(h.eksperimen)}</div>` : ''}
    ${h.catatan_data ? `<div class="hi-muted" style="margin-top:6px">Catatan data: ${escapeHtml(h.catatan_data)}</div>` : ''}`;
}

function ikSetPeriode(p) { ik.periode = p; ikRenderTabel(); }

async function ikPost(body) {
  return crmApi('/api/office/iklan', { method: 'POST', body: JSON.stringify(body) });
}

async function ikRek(id, idx, status, btn) {
  if (btn) btn.disabled = true;
  try { await ikPost({ op: 'rekomendasi', id, idx, status }); await ikLoad(); } catch (e) { alert(e.message); if (btn) btn.disabled = false; }
}

async function ikAbaikanPeringatan(id, btn) {
  btn.disabled = true;
  try { await ikPost({ op: 'peringatan', id: String(id) }); await ikLoad(); } catch (e) { alert(e.message); btn.disabled = false; }
}

async function ikSimpanBudget(btn) {
  const v = ikEl('ik-budget').value.trim();
  btn.disabled = true;
  try { const r = await ikPost({ op: 'budget', budget_bulanan: v }); ikEl('ik-budget-info').textContent = r.info || 'Tersimpan.'; await ikLoad(); }
  catch (e) { ikEl('ik-budget-info').textContent = e.message; }
  btn.disabled = false;
}

async function ikAnalisis(btn) {
  if (ik.busy) return;
  ik.busy = true; btn.disabled = true;
  const info = ikEl('ik-an-info');
  info.textContent = 'Analis Meta Ads sedang membaca data 7 hari… (±30–50 detik)';
  try {
    const r = await crmApi('/api/agents/iklan', { method: 'POST', body: '{}' });
    info.textContent = r.info || 'Selesai.';
  } catch (e) { info.textContent = e.message; }
  ik.busy = false; btn.disabled = false;
  await ikLoad();
}

function ikSalin(btn) {
  const t = btn.dataset.t || '';
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { btn.textContent = 'Tersalin ✓'; }, () => { btn.textContent = 'Gagal menyalin'; });
}
