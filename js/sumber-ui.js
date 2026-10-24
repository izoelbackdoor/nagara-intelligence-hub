// Sumber klien — tab di menu Konten & Marketing (halaman `sumber-klien`).
// Funnel klik → chat WA / brief → meeting → penawaran → deal per kanal & per link (konten/iklan), plus per bulan.
// Data: GET /api/office/sumber?dari=&sampai= → RPC hub_sumber(). Aksi: POST /api/office/sumber {op: buat|nonaktif|aktif}.
// Link pendek nagaraku.id/l/<kode> dicatat oleh middleware situs nagaraku.id (repo nadi-international).
/* global escapeHtml, crmApi, officeAgo */

const sk = { data: null, periode: 'bulan_ini', semua_link: false, busy: false };
const skEl = id => document.getElementById(id);
const skRp = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const skN = n => Number(n || 0).toLocaleString('id-ID');
const skPersen = (a, b) => (Number(b) ? Math.round((100 * Number(a)) / Number(b)) + '%' : '—');
const SK_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const SK_KANAL = [['ig_fb', 'Instagram & Facebook'], ['tiktok', 'TikTok'], ['linkedin', 'LinkedIn'], ['meta_ads', 'Iklan Meta'],
  ['blog', 'Blog / SEO'], ['wa_outreach', 'Outreach WA'], ['email', 'Email'], ['lainnya', 'Lainnya']];
const SK_TUJUAN = { brief: 'Form brief', wa: 'Chat WhatsApp', web: 'Halaman nagaraku.id' };

function skTanggal(d) { return d.toISOString().slice(0, 10); }
function skRentang() {
  const now = new Date(Date.now() + 7 * 3600e3); // WIB
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const awal = (yy, mm) => skTanggal(new Date(Date.UTC(yy, mm, 1)));
  const akhir = (yy, mm) => skTanggal(new Date(Date.UTC(yy, mm + 1, 0)));
  switch (sk.periode) {
    case 'bulan_lalu': return [awal(y, m - 1), akhir(y, m - 1)];
    case '30h': return [skTanggal(new Date(now.getTime() - 29 * 864e5)), skTanggal(now)];
    case '90h': return [skTanggal(new Date(now.getTime() - 89 * 864e5)), skTanggal(now)];
    default: return [awal(y, m), skTanggal(now)];
  }
}

async function skInit() {
  if (!skEl('sk-kanal-opsi').children.length) {
    skEl('sk-kanal-opsi').innerHTML = SK_KANAL.map(([k, l]) => `<option value="${k}">${escapeHtml(l)}</option>`).join('');
  }
  await skLoad();
}

async function skLoad() {
  const err = skEl('sk-error');
  const [dari, sampai] = skRentang();
  try {
    sk.data = await crmApi(`/api/office/sumber?dari=${dari}&sampai=${sampai}`);
    err.style.display = 'none';
  } catch (e) {
    err.innerHTML = /hub_sumber|404/.test(e.message) ? '<b>Fungsi database belum ada.</b> Jalankan migrasi <code>20261024_link_pelacak.sql</code>.' : escapeHtml(e.message);
    err.style.display = 'block';
    return;
  }
  skRender();
}

function skSetPeriode(p) {
  sk.periode = p;
  document.querySelectorAll('#sk-periode .crm-view-btn').forEach(b => b.classList.toggle('active', b.dataset.p === p));
  skLoad();
}

function skBaris(r, judul, sub) {
  return `<tr><td>${judul}${sub ? `<div class="hi-muted">${sub}</div>` : ''}</td>
    <td class="num">${skN(r.klik)}<div class="hi-muted">${skN(r.pengunjung)} orang</div></td>
    <td class="num">${skN(r.chat_wa)}</td>
    <td class="num">${skN(r.brief)}</td>
    <td class="num">${skN(r.meeting)}<div class="hi-muted">${skPersen(r.meeting, r.brief)}</div></td>
    <td class="num">${skN(r.penawaran)}<div class="hi-muted">${skPersen(r.penawaran, r.brief)}</div></td>
    <td class="num"><b>${skN(r.deal)}</b><div class="hi-muted">${skPersen(r.deal, r.brief)}</div></td>
    <td class="num">${Number(r.nilai) ? skRp(r.nilai) : '—'}</td></tr>`;
}

function skRender() {
  const d = sk.data, kanal = d.kanal || [], link = d.link || [];
  const tot = kanal.reduce((o, k) => { for (const f of ['klik', 'chat_wa', 'brief', 'meeting', 'penawaran', 'deal', 'nilai']) o[f] += Number(k[f] || 0); return o; },
    { klik: 0, chat_wa: 0, brief: 0, meeting: 0, penawaran: 0, deal: 0, nilai: 0 });
  const terlacak = kanal.filter(k => k.kanal !== 'tanpa_link').reduce((s, k) => s + Number(k.brief || 0), 0);
  skEl('sk-kpis').innerHTML = [
    [skN(tot.klik), 'klik link pelacak'],
    [skN(tot.chat_wa), 'chat WA berkode'],
    [skN(tot.brief), `brief masuk · ${skPersen(terlacak, tot.brief)} terlacak`],
    [skN(tot.meeting), 'meeting'],
    [skN(tot.penawaran), 'penawaran terkirim'],
    [skN(tot.deal), 'deal', tot.deal ? 'color:#2e9e5b' : ''],
    [tot.nilai ? skRp(tot.nilai) : 'Rp 0', 'nilai deal'],
    [tot.brief ? skPersen(tot.deal, tot.brief) : '—', 'brief → deal'],
  ].map(([v, l, st]) => `<div class="aio-kpi"><b style="${st || ''}">${v}</b><span>${escapeHtml(l)}</span></div>`).join('');
  skEl('sk-rentang').textContent = `${d.dari} s/d ${d.sampai} · brief, meeting, penawaran & deal dihitung dari brief yang masuk di rentang ini`;

  skEl('sk-kanal').innerHTML = kanal.length ? kanal.map(k => skBaris(k, `<b>${escapeHtml(k.label)}</b>`,
      k.kanal === 'tanpa_link' ? 'brief tanpa kode link (langsung, outreach lama, atau link polos)' : '')).join('')
    : '<tr><td colspan="8" class="hi-muted">Belum ada data di rentang ini.</td></tr>';

  const tampil = link.filter(l => sk.semua_link || Number(l.klik) || Number(l.brief) || Number(l.chat_wa) || l.dibuat_oleh === 'imam');
  skEl('sk-link').innerHTML = tampil.length ? tampil.map(l => skBaris(l,
      `<b>${escapeHtml(l.label)}</b>${l.aktif ? '' : ' <span class="pr-badge pr-gagal">nonaktif</span>'}`,
      `${escapeHtml(l.kanal_label)} · ${escapeHtml(SK_TUJUAN[l.tujuan] || l.tujuan)}${l.utm_content ? ' · ' + escapeHtml(l.utm_content) : ''}
       · <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.url.replace(/^https:\/\//, ''))}</a>
       <button class="sk-mini" onclick="skSalin('${escapeHtml(l.url)}', this)">salin</button>
       <button class="sk-mini" onclick="skAktif(${Number(l.id)}, ${l.aktif ? 'false' : 'true'}, this)">${l.aktif ? 'nonaktifkan' : 'aktifkan'}</button>
       · total ${skN(l.klik_total)} klik`)).join('')
    : `<tr><td colspan="8" class="hi-muted">Belum ada link dengan aktivitas di rentang ini. ${link.length ? `Ada ${link.length} link (centang "tampilkan semua link").` : 'Buat link pertama di bawah, atau tunggu penulis konten membuatnya otomatis.'}</td></tr>`;

  const bl = d.bulanan || [];
  const maxB = Math.max(1, ...bl.map(b => Number(b.brief)));
  skEl('sk-bulanan').innerHTML = bl.map(b => {
    const t = new Date(b.bulan + 'T00:00:00');
    const pk = Object.entries(b.per_kanal || {}).sort((x, y) => y[1].brief - x[1].brief)
      .map(([k, v]) => `${escapeHtml((SK_KANAL.find(z => z[0] === k) || [k, k === 'tanpa_link' ? 'Tak terlacak' : k])[1])} ${v.brief}${v.deal ? ` (${v.deal} deal)` : ''}`).join(' · ');
    return `<tr><td><b>${SK_BULAN[t.getMonth()]} ${t.getFullYear()}</b><div class="sk-bar"><i style="width:${(100 * Number(b.brief)) / maxB}%"></i></div></td>
      <td class="num">${skN(b.klik)}</td><td class="num">${skN(b.brief)}<div class="hi-muted">${skN(b.brief_terlacak)} terlacak</div></td>
      <td class="num">${skN(b.meeting)}</td><td class="num">${skN(b.penawaran)}</td><td class="num"><b>${skN(b.deal)}</b></td>
      <td class="num">${Number(b.nilai) ? skRp(b.nilai) : '—'}</td><td class="hi-muted" style="font-size:12px">${pk || '—'}</td></tr>`;
  }).join('');

  skEl('sk-brief').innerHTML = (d.brief_terbaru || []).map(b => `<tr><td style="white-space:nowrap">${escapeHtml(officeAgo(b.waktu))}</td>
      <td>${escapeHtml(b.usaha || '-')}</td><td>${escapeHtml(b.status || '-')}</td><td>${escapeHtml(b.kanal)}</td>
      <td class="hi-muted">${escapeHtml([b.link, b.utm_source, b.utm_campaign, b.utm_content].filter(Boolean).join(' · ') || '—')}</td></tr>`).join('')
    || '<tr><td colspan="5" class="hi-muted">Belum ada brief.</td></tr>';
  skEl('sk-updated').textContent = 'Diperbarui ' + new Date(d.generated_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

async function skBuat(btn) {
  const info = skEl('sk-buat-info');
  const body = { op: 'buat', label: skEl('sk-label').value.trim(), kanal: skEl('sk-kanal-opsi').value, tujuan: skEl('sk-tujuan').value,
    campaign: skEl('sk-campaign').value.trim(), content: skEl('sk-content').value.trim(), path: skEl('sk-path').value.trim() };
  btn.disabled = true;
  try {
    const r = await crmApi('/api/office/sumber', { method: 'POST', body: JSON.stringify(body) });
    info.innerHTML = `Link siap: <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.url)}</a> <button class="sk-mini" onclick="skSalin('${escapeHtml(r.url)}', this)">salin</button>`;
    skEl('sk-label').value = '';
    await skLoad();
  } catch (e) { info.textContent = e.message; }
  btn.disabled = false;
}

async function skAktif(id, aktif, btn) {
  btn.disabled = true;
  try { await crmApi('/api/office/sumber', { method: 'POST', body: JSON.stringify({ op: aktif ? 'aktif' : 'nonaktif', id: String(id) }) }); await skLoad(); }
  catch (e) { alert(e.message); btn.disabled = false; }
}

function skSalin(url, btn) {
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => { btn.textContent = 'tersalin ✓'; }, () => { btn.textContent = 'gagal'; });
}

function skTujuanBerubah() { skEl('sk-path-wrap').style.display = skEl('sk-tujuan').value === 'web' ? '' : 'none'; }
