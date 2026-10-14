// Penawaran & Kalkulator + Helpdesk — UI dashboard Nagara Command Center.
// Dimuat oleh index.html sebelum script utama; fungsi di sini baru dipanggil saat halaman dibuka,
// jadi boleh memakai helper global dari script utama: escapeHtml, crmApi, officeFetch, officeAgo,
// openSharedModal, showPage. Angka dihitung dengan window.QuoteCalc (js/quote-calc.js) — server
// menghitung ulang dengan modul yang sama saat menyimpan.
/* global QuoteCalc, escapeHtml, crmApi, officeFetch, officeAgo, openSharedModal, showPage */

// ════════════════════ PENAWARAN & KALKULATOR ════════════════════
const QT_STATUS = { draf: 'Draf', menunggu_kirim: 'Menunggu persetujuan kirim', terkirim: 'Terkirim', diterima: 'Diterima', ditolak: 'Ditolak', kedaluwarsa: 'Kedaluwarsa' };
const qt = { settings: null, settingsSaved: false, inputs: null, editingId: null, editingNumber: null, leadId: null, list: [], leadTimer: null, prefill: null, ready: false };
const qtRp = n => QuoteCalc.formatRp(n);
const qtEl = id => document.getElementById(id);
const qtDate = d => d ? new Date(String(d).length === 10 ? d + 'T00:00:00+07:00' : d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

function qtShowError(msg) {
  const e = qtEl('qt-error');
  if (!msg) { e.style.display = 'none'; return; }
  e.innerHTML = msg; e.style.display = 'block';
}
function qtMigrationMsg(err) {
  return /migrasi|belum dibuat/i.test(err.message)
    ? `<b>Database belum siap.</b> Jalankan sekali file <code>supabase/migrations/20261014_penawaran_helpdesk.sql</code> di Supabase → project <b>nagara-command-center</b> → SQL Editor → Run. Kalkulator tetap bisa dipakai dengan angka bawaan, tapi penawaran belum bisa disimpan.`
    : escapeHtml(err.message);
}

async function qtInit() {
  if (!qt.ready) {
    try {
      const j = await crmApi('/api/office/quote-settings');
      qt.settings = QuoteCalc.mergeSettings(j.settings); qt.settingsSaved = j.saved; qtShowError(null);
    } catch (e) {
      qt.settings = QuoteCalc.mergeSettings(null); qtShowError(qtMigrationMsg(e));
    }
    qtEl('qt-server').innerHTML = Object.entries(QuoteCalc.SERVERS).map(([k, v]) => `<option value="${k}">${v}${k !== 'none' ? ' — modal ' + qtRp(qt.settings.hosting[k]) + '/bln' : ''}</option>`).join('');
    qtEl('qt-f-status').innerHTML = '<option value="">Semua status</option>' + Object.entries(QT_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    qt.ready = true;
    qtNew(true);
  }
  if (qt.prefill) { const l = qt.prefill; qt.prefill = null; qtNew(true); qtPickLead(l); qtSetView('calc'); }
  qtRefreshBadge();
}

function qtSetView(v) {
  document.querySelectorAll('#qt-views .crm-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  ['calc', 'list', 'settings'].forEach(k => { qtEl('qt-view-' + k).style.display = k === v ? '' : 'none'; });
  if (v === 'list') qtLoadList();
  if (v === 'settings') qtRenderSettings();
}

// ── Form kalkulator ──
function qtRenderCalcForm() {
  const s = qt.settings, inp = qt.inputs;
  let html = '', lastGroup = null;
  s.components.forEach(c => {
    if (c.group !== lastGroup) { html += `<tr class="qt-group"><td colspan="5">${escapeHtml(c.group)}</td></tr>`; lastGroup = c.group; }
    const v = inp.components[c.id] || { on: c.on, hours: c.hours, fixed: c.fixed };
    html += `<tr id="qt-cr-${c.id}"><td><input type="checkbox" data-c="${c.id}" data-k="on" ${v.on ? 'checked' : ''} onchange="qtRecalc()"></td>
      <td>${escapeHtml(c.name)}${c.client ? `<span class="qt-sub">Di dokumen klien: ${escapeHtml(c.client)}</span>` : '<span class="qt-sub">Internal — tidak ditulis di dokumen klien</span>'}</td>
      <td class="num"><input type="number" min="0" step="0.5" data-c="${c.id}" data-k="hours" value="${v.hours}" oninput="qtRecalc()"></td>
      <td class="num"><input type="number" min="0" step="50000" class="qt-fixed" data-c="${c.id}" data-k="fixed" value="${v.fixed}" oninput="qtRecalc()"></td>
      <td class="num" id="qt-sub-${c.id}">—</td></tr>`;
  });
  html += `<tr id="qt-cr-fitur"><td></td><td><b>Fitur khusus</b><span class="qt-sub">Otomatis dari tabel Fitur khusus di bawah</span></td><td class="num" id="qt-fitur-h">0</td><td class="num">—</td><td class="num" id="qt-sub-fitur">—</td></tr>`;
  qtEl('qt-comp-body').innerHTML = html;
  const cx = Object.keys(s.complexity);
  qtEl('qt-feat-body').innerHTML = s.features.map(f => {
    const v = inp.features[f.key] || {};
    return `<tr id="qt-fr-${f.key}" class="${v.on ? '' : 'off'}"><td><input type="checkbox" data-f="${f.key}" data-k="on" ${v.on ? 'checked' : ''} onchange="qtRecalc()"></td>
      <td>${escapeHtml(f.name)}<span class="qt-sub">${escapeHtml(f.sub)}</span></td><td class="num">${f.hours}</td>
      <td><select data-f="${f.key}" data-k="complexity" onchange="qtRecalc()">${cx.map(k => `<option value="${k}" ${(v.complexity || 'sederhana') === k ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)} ${String(s.complexity[k]).replace('.', ',')}×</option>`).join('')}</select></td>
      <td class="num" id="qt-fh-${f.key}">—</td></tr>`;
  }).join('') || '<tr><td colspan="5">Belum ada fitur di katalog. Tambahkan di Pengaturan harga.</td></tr>';
  qtEl('qt-server').value = inp.server;
  qtEl('qt-rev').value = inp.revisions;
  qtEl('qt-offer').value = inp.offerPrice || '';
}

function qtReadInputs() {
  const s = qt.settings, inp = { components: {}, features: {}, server: qtEl('qt-server').value, revisions: +qtEl('qt-rev').value || 0, offerPrice: qtEl('qt-offer').value ? +qtEl('qt-offer').value : null };
  s.components.forEach(c => {
    const g = k => document.querySelector(`#qt-comp-body [data-c="${c.id}"][data-k="${k}"]`);
    inp.components[c.id] = { on: g('on').checked, hours: Math.max(0, +g('hours').value || 0), fixed: Math.max(0, +g('fixed').value || 0) };
  });
  s.features.forEach(f => {
    const on = document.querySelector(`#qt-feat-body [data-f="${f.key}"][data-k="on"]`);
    const cx = document.querySelector(`#qt-feat-body [data-f="${f.key}"][data-k="complexity"]`);
    if (on && on.checked) inp.features[f.key] = { on: true, complexity: cx.value };
  });
  return inp;
}

function qtRecalc() {
  if (!qt.settings) return;
  const s = qt.settings, inp = qtReadInputs(); qt.inputs = inp;
  const r = QuoteCalc.compute(s, inp);
  s.components.forEach(c => {
    const v = inp.components[c.id], line = r.lines.find(l => l.id === c.id);
    qtEl('qt-cr-' + c.id).classList.toggle('off', !v.on);
    qtEl('qt-sub-' + c.id).textContent = line ? qtRp(line.subtotal) : '—';
  });
  s.features.forEach(f => {
    const fl = r.featureLines.find(x => x.key === f.key);
    const row = qtEl('qt-fr-' + f.key); if (row) row.classList.toggle('off', !fl);
    const cell = qtEl('qt-fh-' + f.key); if (cell) cell.textContent = fl ? String(fl.hours).replace('.', ',') : '—';
  });
  const fh = r.featureLines.reduce((a, f) => a + f.hours, 0);
  qtEl('qt-fitur-h').textContent = String(Math.round(fh * 100) / 100).replace('.', ',');
  qtEl('qt-sub-fitur').textContent = fh ? qtRp(fh * s.rate) : '—';
  qtEl('qt-cr-fitur').classList.toggle('off', !fh);

  qtEl('qt-offer-show').textContent = qtRp(r.offerPrice);
  qtEl('qt-tier-show').innerHTML = r.tier
    ? `Cocok: <b>Paket ${escapeHtml(r.tier.name)}</b> (${qtRp(r.tier.price)}) · ruang sisa ${qtRp(r.tierRoom)}`
    : `<b>Custom</b> — di atas paket tertinggi, ditawarkan di harga final`;
  const w = qtEl('qt-warn');
  if (r.belowMinimum) { w.textContent = `Harga tawar di bawah harga minimum aman (${qtRp(r.priceFinal)}). Proyek berisiko rugi bila revisi/buffer terpakai.`; w.style.display = ''; }
  else w.style.display = 'none';
  const pct = v => Math.round(v * 100) + '%';
  qtEl('qt-sum-table').innerHTML = `
    <tr><td class="muted">Total jam kerja</td><td>${String(r.hours).replace('.', ',')} jam</td></tr>
    <tr><td class="muted">Biaya dasar (jam × ${qtRp(s.rate)} + biaya tetap)</td><td>${qtRp(r.costBase)}</td></tr>
    <tr><td class="muted">+ buffer ${pct(s.buffer)}</td><td>${qtRp(r.withBuffer)}</td></tr>
    <tr><td class="muted">+ margin ${pct(s.margin)}</td><td>${qtRp(r.priceCalc)}</td></tr>
    <tr class="strong"><td>Harga final (minimum aman)</td><td>${qtRp(r.priceFinal)}</td></tr>
    <tr><td class="muted">Profit kotor di harga tawar</td><td>${qtRp(r.offerProfit)}</td></tr>`;
  const rc = r.recurring;
  qtEl('qt-rec-table').innerHTML = (rc.server === 'none' ? '<tr><td class="muted">Tanpa hosting dari NADI</td><td>—</td></tr>'
    : `<tr><td class="muted">Hosting ${escapeHtml(rc.serverLabel)} + maintenance</td><td>${qtRp(rc.monthly)}/bln</td></tr>
       <tr><td class="muted">× 12 bulan</td><td>${qtRp(rc.yearlyHosting)}</td></tr>`) +
    `<tr><td class="muted">Domain + SSL + email</td><td>${qtRp(rc.annual)}</td></tr>
     <tr class="strong"><td>Total tagihan tahunan</td><td>${qtRp(rc.totalYearly)}</td></tr>`;
  return r;
}

function qtNew(silent) {
  qt.editingId = null; qt.editingNumber = null; qt.leadId = null;
  qt.inputs = QuoteCalc.defaultInputs(qt.settings);
  ['qt-client', 'qt-contact', 'qt-wa', 'qt-email', 'qt-notes', 'qt-lead-q'].forEach(id => { qtEl(id).value = ''; });
  qtEl('qt-title').value = 'Pembuatan Website';
  qtEl('qt-lead-note').textContent = '';
  qtEl('qt-editing').textContent = 'Penawaran baru';
  if (!silent) qtEl('qt-save-note').textContent = '';
  qtRenderCalcForm(); qtRecalc();
}

// ── Pilih klien dari CRM ──
function qtLeadSearch() {
  clearTimeout(qt.leadTimer);
  const q = qtEl('qt-lead-q').value.trim(), box = qtEl('qt-lead-results');
  if (q.length < 2) { box.classList.remove('show'); return; }
  qt.leadTimer = setTimeout(async () => {
    try {
      const [a, b] = await Promise.all(['nadi', 'edukit'].map(p => crmApi('/api/office/leads?' + new URLSearchParams({ product: p, q, limit: 6 }))));
      const rows = [...a.rows, ...b.rows];
      qt.leadResults = rows;
      box.innerHTML = rows.length ? rows.map((r, i) => `<button type="button" onclick="qtPickLead(qt.leadResults[${i}])"><b>${escapeHtml(r.name)}</b> <small>· ${escapeHtml([r.product === 'edukit' ? 'EduKit' : 'NADI', r.segment || r.category, r.city].filter(Boolean).join(' · '))} · ${escapeHtml(CRM_STATUS[r.status] || r.status)}</small></button>`).join('')
        : '<button type="button" disabled>Tidak ditemukan — isi manual di bawah.</button>';
      box.classList.add('show');
    } catch (e) { box.innerHTML = `<button type="button" disabled>${escapeHtml(e.message)}</button>`; box.classList.add('show'); }
  }, 300);
}
function qtPickLead(l) {
  if (!l) return;
  qt.leadId = l.id;
  qtEl('qt-client').value = l.name || '';
  qtEl('qt-contact').value = (l.contact_person || '').split(/[\/,;(]/)[0].trim();
  qtEl('qt-wa').value = l.wa ? '0' + String(l.wa).replace(/^62/, '') : '';
  qtEl('qt-email').value = l.email || '';
  qtEl('qt-lead-q').value = '';
  qtEl('qt-lead-results').classList.remove('show');
  qtEl('qt-lead-note').innerHTML = `Terhubung ke CRM: <b>${escapeHtml(l.name)}</b> (${escapeHtml(CRM_STATUS[l.status] || l.status || '-')}). Status calon klien otomatis naik saat penawaran terkirim/diterima. <a class="hd-link" onclick="qt.leadId=null;this.parentNode.textContent='Tidak terhubung ke CRM.'">lepas</a>`;
}
/** Dipanggil dari CRM (modal calon klien / percakapan WA). */
function qtFromLead(l) { qt.prefill = l; const o = document.getElementById('pf-modal-overlay'); if (o) o.style.display = 'none'; showPage('penawaran'); }

// ── Simpan / kirim / pratinjau ──
async function qtSave(mode) {
  const note = qtEl('qt-save-note');
  const client = qtEl('qt-client').value.trim();
  if (!client) { note.textContent = 'Isi nama klien dulu.'; qtEl('qt-client').focus(); return; }
  if (mode === 'send' && !qtEl('qt-wa').value.trim()) { note.textContent = 'Isi nomor WhatsApp klien untuk mengirim.'; qtEl('qt-wa').focus(); return; }
  const win = mode === 'preview' ? window.open('about:blank', '_blank') : null; // buka sinkron supaya tidak diblok popup blocker
  qtRecalc();
  const body = { id: qt.editingId, lead_id: qt.leadId, client_name: client, client_contact: qtEl('qt-contact').value, client_wa: qtEl('qt-wa').value,
    client_email: qtEl('qt-email').value, project_title: qtEl('qt-title').value, notes: qtEl('qt-notes').value, inputs: qt.inputs };
  document.querySelectorAll('#qt-view-calc .qt-actions button').forEach(b => { b.disabled = true; });
  note.textContent = 'Menyimpan…';
  try {
    const j = await crmApi('/api/office/quote', { method: 'POST', body: JSON.stringify(body) });
    qt.editingId = j.quote.id; qt.editingNumber = j.quote.number;
    qtEl('qt-editing').textContent = `Mengedit ${j.quote.number} (draf)`;
    note.textContent = `✓ Tersimpan sebagai ${j.quote.number}.`;
    if (mode === 'preview' && win) win.location = `/api/office/quotes?id=${j.quote.id}&preview=1`;
    if (mode === 'send') {
      await crmApi('/api/office/quote', { method: 'POST', body: JSON.stringify({ op: 'send', id: j.quote.id }) });
      note.textContent = `✓ ${j.quote.number} disimpan & draf WA masuk antrean. Periksa pesannya lalu klik “Setujui & kirim WA”.`;
      qtNew(true); qtSetView('list');
    }
    qtRefreshBadge();
  } catch (e) {
    if (win) win.close();
    note.innerHTML = 'Gagal: ' + qtMigrationMsg(e);
  } finally { document.querySelectorAll('#qt-view-calc .qt-actions button').forEach(b => { b.disabled = false; }); }
}

async function qtEdit(id) {
  try {
    const { quote: q } = await crmApi('/api/office/quotes?id=' + id);
    qtSetView('calc');
    qtNew(true);
    qt.editingId = q.status === 'draf' ? q.id : null;
    qt.editingNumber = q.number;
    qt.leadId = q.lead_id;
    qt.inputs = Object.assign(QuoteCalc.defaultInputs(qt.settings), q.inputs || {});
    qtEl('qt-client').value = q.client_name || ''; qtEl('qt-contact').value = q.client_contact || '';
    qtEl('qt-wa').value = q.client_wa ? '0' + q.client_wa.replace(/^62/, '') : ''; qtEl('qt-email').value = q.client_email || '';
    qtEl('qt-title').value = q.project_title || ''; qtEl('qt-notes').value = q.notes || '';
    qtEl('qt-lead-note').textContent = q.lead_id ? 'Terhubung ke calon klien di CRM.' : '';
    qtEl('qt-editing').textContent = q.status === 'draf' ? `Mengedit ${q.number} (draf)` : `Salinan dari ${q.number} — disimpan sebagai penawaran baru`;
    qtRenderCalcForm(); qtRecalc();
    window.scrollTo(0, 0); document.querySelector('.main').scrollTop = 0;
  } catch (e) { qtShowError(qtMigrationMsg(e)); }
}

// ── Daftar penawaran ──
async function qtLoadList() {
  const body = qtEl('qt-list-body');
  const st = qtEl('qt-f-status').value;
  try {
    const j = await crmApi('/api/office/quotes' + (st ? '?status=' + st : ''));
    qt.list = j.rows; qtShowError(null);
  } catch (e) { qtShowError(qtMigrationMsg(e)); body.innerHTML = '<tr><td colspan="8">—</td></tr>'; return; }
  const all = qt.list;
  const sum = k => all.filter(q => q.status === k);
  const won = sum('diterima');
  qtEl('qt-kpis').innerHTML = [
    [sum('draf').length, 'draf'],
    [sum('menunggu_kirim').length, 'menunggu persetujuan kirim'],
    [`${sum('terkirim').length} <small style="font-size:13px">(${sum('terkirim').filter(q => q.viewed_at).length} dibuka)</small>`, 'terkirim, menunggu keputusan klien'],
    [qtRp(won.reduce((a, q) => a + +q.offer_price, 0)).replace('Rp ', 'Rp '), `${won.length} penawaran diterima`],
  ].map(([v, l]) => `<div class="aio-kpi"><b>${v}</b><span>${l}</span></div>`).join('');
  body.innerHTML = all.length ? all.map(q => {
    const status = q.expired ? 'kedaluwarsa' : q.status;
    const b = (label, fn) => `<button onclick="${fn}">${label}</button>`;
    const acts = [];
    if (q.status === 'draf') acts.push(b('Edit', `qtEdit(${q.id})`), b('Kirim WA…', `qtSend(${q.id})`));
    acts.push(b('Dokumen ↗', `qtOpenDoc(${q.id})`));
    if (q.status === 'menunggu_kirim') acts.push(b('Batal kirim', `qtStatus(${q.id},'draf')`));
    if (q.status === 'terkirim') acts.push(b('Salin link', `qtCopyLink(${q.id})`), b('Diterima ✓', `qtStatus(${q.id},'diterima')`), b('Ditolak', `qtStatus(${q.id},'ditolak')`), b('Kirim ulang', `qtSend(${q.id})`));
    if (q.status === 'diterima') acts.push(b('Buat tiket onboarding', `qtOnboard(${q.id})`));
    acts.push(b('Duplikat', `qtDuplicate(${q.id})`));
    return `<tr><td><b>${escapeHtml(q.number)}</b><br><span class="crm-sub">${qtDate(q.created_at)}</span></td>
      <td>${escapeHtml(q.client_name)}<br><span class="crm-sub">${escapeHtml(q.project_title || '')}</span></td>
      <td>${escapeHtml(q.tier || '-')}</td><td class="num">${qtRp(q.offer_price)}</td><td class="num">${q.yearly_recurring ? qtRp(q.yearly_recurring) : '—'}</td>
      <td><span class="qt-status ${status}">${QT_STATUS[status] || status}</span>${q.viewed_at && q.status === 'terkirim' ? `<br><span class="crm-sub">dibuka ${officeAgo(q.viewed_at)}</span>` : ''}</td>
      <td>${qtDate(q.valid_until)}</td><td><div class="qt-rowact">${acts.join('')}</div></td></tr>`;
  }).join('') : '<tr><td colspan="8">Belum ada penawaran. Buat dari tab Kalkulator.</td></tr>';
  qtLoadQueue();
}

async function qtLoadQueue() {
  const box = qtEl('qt-queue');
  let st; try { st = await officeFetch(); } catch (e) { box.innerHTML = `<div class="pf-card-empty">Gagal memuat antrean: ${escapeHtml(e.message)}</div>`; return; }
  const items = st.approvals.filter(a => a.kind === 'penawaran');
  box.innerHTML = items.length ? items.map(a => `<div class="crm-q" id="qq-${a.id}">
      <div class="crm-q-head"><b>${escapeHtml(a.summary)}</b><span>${officeAgo(a.created_at)}</span></div>
      <textarea id="qqm-${a.id}" maxlength="1500">${escapeHtml(a.payload?.message || '')}</textarea>
      <div class="crm-q-actions">
        <button class="aio-btn" onclick="qtDecide('${a.id}','setuju')">Setujui &amp; kirim WA</button>
        <button class="crm-btn-ghost" onclick="qtDecide('${a.id}','tolak')">Batal (kembali ke draf)</button>
        ${a.payload?.url ? `<a class="crm-btn-ghost" style="text-decoration:none" href="${escapeHtml(a.payload.url)}" target="_blank" rel="noopener">Cek link klien ↗</a>` : ''}
        <span id="qqn-${a.id}"></span>
      </div></div>`).join('') : '<div class="pf-card-empty">Tidak ada penawaran yang menunggu dikirim.</div>';
}
async function qtDecide(id, decision) {
  const card = qtEl('qq-' + id), note = qtEl('qqn-' + id);
  card.querySelectorAll('button').forEach(b => { b.disabled = true; });
  note.textContent = decision === 'setuju' ? 'Mengirim…' : 'Menyimpan…';
  try {
    const j = await crmApi('/api/office/approval', { method: 'POST', body: JSON.stringify({ id, decision, message: qtEl('qqm-' + id).value }) });
    note.textContent = '✓ ' + j.status;
    setTimeout(qtLoadList, 700); qtRefreshBadge();
  } catch (e) { note.textContent = 'Gagal: ' + e.message; card.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
}
async function qtSend(id) {
  try { await crmApi('/api/office/quote', { method: 'POST', body: JSON.stringify({ op: 'send', id }) }); qtLoadList(); qtRefreshBadge(); }
  catch (e) { qtShowError(qtMigrationMsg(e)); }
}
async function qtStatus(id, status) {
  try { await crmApi('/api/office/quote', { method: 'POST', body: JSON.stringify({ op: 'status', id, status }) }); qtLoadList(); qtRefreshBadge(); }
  catch (e) { qtShowError(qtMigrationMsg(e)); }
}
async function qtDuplicate(id) {
  try { const j = await crmApi('/api/office/quote', { method: 'POST', body: JSON.stringify({ op: 'duplicate', id }) }); await qtEdit(j.quote.id); }
  catch (e) { qtShowError(qtMigrationMsg(e)); }
}
function qtOpenDoc(id) {
  const q = qt.list.find(x => x.id === id);
  const url = q && ['terkirim', 'diterima', 'ditolak', 'kedaluwarsa'].includes(q.status) && q.share_token ? '/penawaran/' + q.share_token : `/api/office/quotes?id=${id}&preview=1`;
  window.open(url, '_blank', 'noopener');
}
async function qtCopyLink(id) {
  const q = qt.list.find(x => x.id === id); if (!q?.share_token) return;
  const url = location.origin + '/penawaran/' + q.share_token;
  try { await navigator.clipboard.writeText(url); }
  catch { /* clipboard ditolak browser */ }
  qtFlash(`Link ${q.number} disalin: ${url}`);
}
function qtFlash(msg) {
  const e = qtEl('qt-error'); e.textContent = msg; e.style.display = 'block'; clearTimeout(qt.flashT); qt.flashT = setTimeout(() => { e.style.display = 'none'; }, 6000);
}
async function qtOnboard(id) {
  const q = qt.list.find(x => x.id === id); if (!q) return;
  try {
    const j = await crmApi('/api/office/ticket', { method: 'POST', body: JSON.stringify({ client_name: q.client_name, wa: q.client_wa, email: q.client_email, lead_id: q.lead_id, quote_id: q.id, channel: 'manual',
      subject: `Onboarding ${q.number}: ${q.project_title || 'Website'}`, category: 'permintaan_fitur', priority: 'normal',
      body: `Penawaran ${q.number} diterima (${q.tier}, ${qtRp(q.offer_price)}). Checklist: invoice DP, kumpulkan materi (logo, teks, foto), jadwalkan kickoff.` }) });
    hd.pendingSelect = j.ticket.id; showPage('helpdesk');
  } catch (e) { qtShowError(qtMigrationMsg(e)); }
}
async function qtRefreshBadge() {
  try {
    const st = await officeFetch();
    const n = st.approvals.filter(a => a.kind === 'penawaran').length;
    const b = qtEl('qt-badge'); if (!b) return;
    b.textContent = n; b.style.display = n ? '' : 'none';
  } catch { /* abaikan */ }
}

// ── Pengaturan harga ──
function qtRenderSettings() {
  const s = qt.settings; if (!s) return;
  const inp = (path, val, opt = {}) => `<label>${opt.label}<input data-s="${path}" type="${opt.type || 'number'}" ${opt.step ? `step="${opt.step}"` : ''} min="0" value="${escapeHtml(val)}"></label>`;
  const pct = v => Math.round(v * 1000) / 10;
  const groups = s.groups.map(g => `<option>${g}</option>`).join('');
  qtEl('qt-settings-form').innerHTML = `
    <div class="qt-card qt-set-block"><h3 class="aio-h">Asumsi biaya (rahasia internal)</h3><div class="qt-set">
      ${inp('rate', s.rate, { label: 'Tarif per jam (Rp)', step: 5000 })}
      ${inp('buffer', pct(s.buffer), { label: 'Buffer risiko (%)', step: 1 })}
      ${inp('margin', pct(s.margin), { label: 'Margin profit proyek (%)', step: 1 })}
      ${inp('marginRecurring', pct(s.marginRecurring), { label: 'Margin hosting & maintenance (%)', step: 1 })}
      ${inp('rounding', s.rounding, { label: 'Pembulatan harga proyek (Rp)', step: 50000 })}
      ${inp('roundingRecurring', s.roundingRecurring, { label: 'Pembulatan harga bulanan (Rp)', step: 1000 })}
      ${inp('maintHours', s.maintHours, { label: 'Jam maintenance / klien / bulan', step: 0.5 })}
    </div></div>
    <div class="qt-card qt-set-block"><h3 class="aio-h">Modal hosting & biaya tahunan</h3><div class="qt-set">
      ${inp('hosting.shared', s.hosting.shared, { label: 'Server Shared / bulan (Rp)', step: 10000 })}
      ${inp('hosting.vps', s.hosting.vps, { label: 'Server VPS / bulan (Rp)', step: 10000 })}
      ${inp('hosting.dedicated', s.hosting.dedicated, { label: 'Server Dedicated / bulan (Rp)', step: 10000 })}
      ${inp('yearly.domain', s.yearly.domain, { label: 'Domain / tahun (Rp)', step: 10000 })}
      ${inp('yearly.ssl', s.yearly.ssl, { label: 'SSL / tahun (Rp)', step: 10000 })}
      ${inp('yearly.email', s.yearly.email, { label: 'Email / tahun (Rp)', step: 10000 })}
    </div></div>
    <div class="qt-card qt-set-block"><h3 class="aio-h">Paket & kompleksitas</h3><div class="qt-set">
      ${s.tiers.map((t, i) => `<label>Nama paket ${i + 1}<input data-tier="${i}" data-k="name" type="text" value="${escapeHtml(t.name)}"></label><label>Harga paket ${i + 1} (Rp)<input data-tier="${i}" data-k="price" type="number" step="500000" min="0" value="${t.price}"></label>`).join('')}
      ${Object.entries(s.complexity).map(([k, v]) => inp('complexity.' + k, v, { label: `Pengali ${k}`, step: 0.1 })).join('')}
    </div></div>
    <div class="qt-card qt-set-block"><h3 class="aio-h">Dokumen penawaran</h3><div class="qt-set">
      ${inp('validDays', s.validDays, { label: 'Masa berlaku (hari)' })}
      ${inp('defaultRevisions', s.defaultRevisions, { label: 'Batas revisi bawaan' })}
      <label style="grid-column:1/-1">Termin pembayaran<input data-s="paymentTerms" type="text" value="${escapeHtml(s.paymentTerms)}"></label>
      ${['name', 'city', 'wa', 'email', 'web', 'signer'].map(k => `<label>${{ name: 'Nama perusahaan', city: 'Kota', wa: 'WhatsApp', email: 'Email', web: 'Website', signer: 'Penanda tangan' }[k]}<input data-s="company.${k}" type="text" value="${escapeHtml(s.company[k])}"></label>`).join('')}
    </div></div>
    <div class="qt-card qt-set-block"><div class="qt-card-head"><h3 class="aio-h">Katalog komponen</h3><button class="crm-btn-ghost" onclick="qtSetAddRow('comp')">+ Komponen</button></div>
      <div class="pf-table-wrap qt-table-wrap"><table class="pf-table qt-set-table"><thead><tr><th>Kelompok</th><th>Nama internal</th><th>Teks di dokumen klien (kosong = tidak ditulis)</th><th class="num">Jam</th><th class="num">Biaya tetap</th><th>Default</th><th></th></tr></thead>
      <tbody id="qt-set-comp">${s.components.map(c => `<tr data-id="${escapeHtml(c.id)}"><td><select data-k="group">${groups.replace(`<option>${c.group}</option>`, `<option selected>${c.group}</option>`)}</select></td>
        <td><input data-k="name" value="${escapeHtml(c.name)}"></td><td><input data-k="client" value="${escapeHtml(c.client || '')}"></td>
        <td class="num"><input data-k="hours" type="number" min="0" step="0.5" value="${c.hours}"></td><td class="num"><input data-k="fixed" type="number" min="0" step="50000" value="${c.fixed}"></td>
        <td><input data-k="on" type="checkbox" ${c.on ? 'checked' : ''}></td><td><button class="crm-btn-ghost" onclick="this.closest('tr').remove()">Hapus</button></td></tr>`).join('')}</tbody></table></div></div>
    <div class="qt-card qt-set-block"><div class="qt-card-head"><h3 class="aio-h">Katalog fitur khusus</h3><button class="crm-btn-ghost" onclick="qtSetAddRow('feat')">+ Fitur</button></div>
      <div class="pf-table-wrap qt-table-wrap"><table class="pf-table qt-set-table"><thead><tr><th>Fitur</th><th>Sub-pekerjaan</th><th class="num">Jam dasar</th><th></th></tr></thead>
      <tbody id="qt-set-feat">${s.features.map(f => `<tr data-id="${escapeHtml(f.key)}"><td><input data-k="name" value="${escapeHtml(f.name)}"></td><td><input data-k="sub" value="${escapeHtml(f.sub)}"></td>
        <td class="num"><input data-k="hours" type="number" min="0" step="0.5" value="${f.hours}"></td><td><button class="crm-btn-ghost" onclick="this.closest('tr').remove()">Hapus</button></td></tr>`).join('')}</tbody></table></div></div>`;
  qtEl('qt-settings-note').textContent = qt.settingsSaved ? '' : 'Belum pernah disimpan — saat ini memakai angka bawaan.';
}
function qtSetAddRow(kind) {
  const id = 'baru_' + Date.now().toString(36);
  if (kind === 'comp') {
    qtEl('qt-set-comp').insertAdjacentHTML('beforeend', `<tr data-id="${id}"><td><select data-k="group">${qt.settings.groups.map(g => `<option ${g === 'Lainnya' ? 'selected' : ''}>${g}</option>`).join('')}</select></td>
      <td><input data-k="name" placeholder="Nama komponen"></td><td><input data-k="client" placeholder="Teks untuk klien"></td>
      <td class="num"><input data-k="hours" type="number" min="0" step="0.5" value="0"></td><td class="num"><input data-k="fixed" type="number" min="0" step="50000" value="0"></td>
      <td><input data-k="on" type="checkbox"></td><td><button class="crm-btn-ghost" onclick="this.closest('tr').remove()">Hapus</button></td></tr>`);
  } else {
    qtEl('qt-set-feat').insertAdjacentHTML('beforeend', `<tr data-id="${id}"><td><input data-k="name" placeholder="Nama fitur"></td><td><input data-k="sub" placeholder="Sub-pekerjaan"></td>
      <td class="num"><input data-k="hours" type="number" min="0" step="0.5" value="0"></td><td><button class="crm-btn-ghost" onclick="this.closest('tr').remove()">Hapus</button></td></tr>`);
  }
}
function qtReadSettings() {
  const s = JSON.parse(JSON.stringify(qt.settings));
  document.querySelectorAll('#qt-settings-form [data-s]').forEach(el => {
    const path = el.dataset.s.split('.');
    let v = el.type === 'number' ? +el.value : el.value;
    if (['buffer', 'margin', 'marginRecurring'].includes(path[0])) v = v / 100;
    if (path.length === 1) s[path[0]] = v; else s[path[0]][path[1]] = v;
  });
  s.tiers = s.tiers.map((t, i) => ({ key: t.key, name: document.querySelector(`[data-tier="${i}"][data-k="name"]`).value, price: +document.querySelector(`[data-tier="${i}"][data-k="price"]`).value }));
  const val = (tr, k) => tr.querySelector(`[data-k="${k}"]`);
  s.components = [...document.querySelectorAll('#qt-set-comp tr')].map(tr => ({ id: tr.dataset.id, group: val(tr, 'group').value, name: val(tr, 'name').value.trim(),
    client: val(tr, 'client').value.trim() || null, hours: +val(tr, 'hours').value, fixed: +val(tr, 'fixed').value, on: val(tr, 'on').checked })).filter(c => c.name);
  s.features = [...document.querySelectorAll('#qt-set-feat tr')].map(tr => ({ key: tr.dataset.id, name: val(tr, 'name').value.trim(), sub: val(tr, 'sub').value.trim(), hours: +val(tr, 'hours').value })).filter(f => f.name);
  return s;
}
async function qtSaveSettings() {
  const note = qtEl('qt-settings-note');
  const s = qtReadSettings();
  note.textContent = 'Menyimpan…';
  try {
    const j = await crmApi('/api/office/quote-settings', { method: 'POST', body: JSON.stringify({ settings: s }) });
    qt.settings = QuoteCalc.mergeSettings(j.settings); qt.settingsSaved = true;
    note.textContent = '✓ Tersimpan. Penawaran baru memakai angka ini.';
    qt.ready = false; await qtInit(); qtSetView('settings');
  } catch (e) { note.innerHTML = 'Gagal: ' + qtMigrationMsg(e); }
}
function qtResetSettings() {
  qt.settings = QuoteCalc.mergeSettings(null); qtRenderSettings();
  qtEl('qt-settings-note').textContent = 'Angka bawaan dimuat — klik “Simpan pengaturan” untuk menerapkan.';
}

// ════════════════════ HELPDESK ════════════════════
const HD_STATUS = { baru: 'Baru', dibuka: 'Dibuka', menunggu_klien: 'Menunggu klien', selesai: 'Selesai', ditutup: 'Ditutup' };
const HD_PRIORITY = { urgent: 'Urgent', tinggi: 'Tinggi', normal: 'Normal', rendah: 'Rendah' };
const HD_CATEGORY = { teknis: 'Teknis', tagihan: 'Tagihan', permintaan_fitur: 'Permintaan fitur', pertanyaan: 'Pertanyaan', keluhan: 'Keluhan', lainnya: 'Lainnya' };
const HD_CHANNEL = { wa: 'WhatsApp', email: 'Email', manual: 'Manual', web: 'Web' };
const hd = { rows: [], stats: null, sel: null, detail: null, timer: null, poll: null, pendingSelect: null, ready: false };
const hdOpts = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('');

function hdSla(t) {
  if (t.status === 'menunggu_klien') return '<span class="hd-sla ok">menunggu klien</span>';
  if (!['baru', 'dibuka'].includes(t.status) || !t.sla_due_at) return '';
  const ms = new Date(t.sla_due_at).getTime() - Date.now();
  const fmt = m => { m = Math.abs(m); const h = m / 3600e3; return h < 1 ? Math.max(1, Math.round(m / 60000)) + ' mnt' : h < 48 ? Math.round(h) + ' jam' : Math.round(h / 24) + ' hari'; };
  if (ms < 0) return `<span class="hd-sla late">⏰ terlambat ${fmt(ms)}</span>`;
  return `<span class="hd-sla ${ms < 3600e3 ? 'soon' : 'ok'}">balas dalam ${fmt(ms)}</span>`;
}

function hdInit() {
  if (!hd.ready) {
    document.getElementById('hd-f-priority').innerHTML = '<option value="">Semua prioritas</option>' + hdOpts(HD_PRIORITY);
    document.getElementById('hd-f-category').innerHTML = '<option value="">Semua kategori</option>' + hdOpts(HD_CATEGORY);
    hd.poll = setInterval(() => { if (document.getElementById('page-helpdesk').classList.contains('active') && !document.hidden) hdLoad(true); }, 60000);
    hd.ready = true;
  }
  hdLoad();
}
function hdDebounce() { clearTimeout(hd.timer); hd.timer = setTimeout(hdLoad, 350); }

async function hdLoad(quiet) {
  const err = document.getElementById('hd-error');
  const qs = new URLSearchParams({ status: document.getElementById('hd-f-status').value });
  const p = document.getElementById('hd-f-priority').value; if (p) qs.set('priority', p);
  const c = document.getElementById('hd-f-category').value; if (c) qs.set('category', c);
  const q = document.getElementById('hd-q').value.trim(); if (q) qs.set('q', q);
  let j;
  try { j = await crmApi('/api/office/tickets?' + qs); err.style.display = 'none'; }
  catch (e) { err.innerHTML = qtMigrationMsg(e); err.style.display = 'block'; document.getElementById('hd-list-body').innerHTML = ''; return; }
  hd.rows = j.rows; hd.stats = j.stats;
  const s = j.stats;
  document.getElementById('hd-kpis').innerHTML = [
    [s.open, 'tiket terbuka'],
    [s.waiting_us, 'menunggu balasan kita'],
    [s.overdue, 'lewat SLA', s.overdue ? 'color:#c0392b' : ''],
    [`${s.solved_7d}${s.avg_first_response_h != null ? ` <small style="font-size:13px;font-weight:500">· respon ${String(s.avg_first_response_h).replace('.', ',')} jam</small>` : ''}`, 'selesai 7 hari · rata-rata respon pertama'],
  ].map(([v, l, st]) => `<div class="aio-kpi"><b style="${st || ''}">${v}</b><span>${l}</span></div>`).join('');
  hdSetBadge(s.overdue + j.rows.filter(t => t.status === 'baru').length);
  document.getElementById('hd-list-body').innerHTML = hd.rows.length ? hd.rows.map(t => `
    <div class="hd-item p-${t.priority} ${hd.sel === t.id ? 'active' : ''}" onclick="hdSelect(${t.id})">
      <div class="wa-item-top"><b>${escapeHtml(t.client_name)}</b><span>${officeAgo(t.last_message_at)}</span></div>
      <div class="hd-item-subj">${escapeHtml(t.subject)}</div>
      <div><span class="hd-tag">${escapeHtml(t.number)}</span><span class="hd-tag ${t.priority}">${HD_PRIORITY[t.priority]}</span><span class="hd-tag ${t.status}">${HD_STATUS[t.status]}</span>${hdSla(t)}</div>
    </div>`).join('') : `<div class="wa-empty">${document.getElementById('hd-f-status').value === 'terbuka' ? 'Tidak ada tiket terbuka. 🎉<br>WA dari klien berstatus Deal otomatis muncul di sini, atau klik “+ Tiket baru”.' : 'Tidak ada tiket di filter ini.'}</div>`;
  if (hd.pendingSelect) { const id = hd.pendingSelect; hd.pendingSelect = null; hdSelect(id); }
  else if (hd.sel && !quiet) hdSelect(hd.sel, true);
}
function hdSetBadge(n) { const b = document.getElementById('hd-nav-badge'); if (!b) return; b.textContent = n; b.style.display = n ? '' : 'none'; }
async function hdRefreshBadge() {
  try { const j = await crmApi('/api/office/tickets?status=terbuka'); hdSetBadge(j.stats.overdue + j.rows.filter(t => t.status === 'baru').length); } catch { /* modul belum aktif */ }
}

async function hdSelect(id, keepDraft) {
  hd.sel = id;
  document.querySelectorAll('.hd-item').forEach(el => el.classList.toggle('active', el.getAttribute('onclick') === `hdSelect(${id})`));
  const box = document.getElementById('hd-thread');
  const typed = keepDraft ? document.getElementById('hd-reply')?.value : null;
  try { hd.detail = await crmApi('/api/office/tickets?id=' + id); }
  catch (e) { box.innerHTML = `<div class="wa-empty">${escapeHtml(e.message)}</div>`; return; }
  hdRenderThread(typed);
}

function hdRenderThread(typed) {
  const { ticket: t, messages, quotes, lead, history } = hd.detail;
  const box = document.getElementById('hd-thread');
  const fmt = iso => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const open = ['baru', 'dibuka', 'menunggu_klien'].includes(t.status);
  const draft = typed != null ? typed : (t.ai_draft || '');
  box.innerHTML = `
    <div class="wa-thread-head"><b>${escapeHtml(t.number)} · ${escapeHtml(t.subject)}</b>
      <div class="hd-head-meta">
        <select onchange="hdUpdate({status:this.value})" title="Status">${hdOpts(HD_STATUS, t.status)}</select>
        <select onchange="hdUpdate({priority:this.value})" title="Prioritas">${hdOpts(HD_PRIORITY, t.priority)}</select>
        <select onchange="hdUpdate({category:this.value})" title="Kategori">${hdOpts(HD_CATEGORY, t.category)}</select>
        ${hdSla(t)}
      </div></div>
    <div class="hd-side-info">
      <span><b>${escapeHtml(t.client_name)}</b>${t.wa ? ' · +' + escapeHtml(t.wa) : ''}${t.email ? ' · ' + escapeHtml(t.email) : ''} · via ${HD_CHANNEL[t.channel] || t.channel}</span>
      ${lead ? `<span>CRM: ${escapeHtml(CRM_STATUS[lead.status] || lead.status)}${lead.city ? ' · ' + escapeHtml(lead.city) : ''}</span>` : ''}
      ${quotes.length ? `<span>Penawaran: ${quotes.map(q => `<a onclick="window.open('/api/office/quotes?id=${q.id}&preview=1','_blank','noopener')">${escapeHtml(q.number)}</a> (${escapeHtml(QT_STATUS[q.status] || q.status)})`).join(', ')}</span>` : ''}
      ${history.length ? `<span>Tiket lain: ${history.map(h => `<a onclick="hdSelect(${h.id})">${escapeHtml(h.number)}</a>`).join(', ')}</span>` : ''}
    </div>
    ${t.summary ? `<p class="hd-summary"><b>Ringkasan Rawat</b>${escapeHtml(t.summary)}</p>` : ''}
    <div class="wa-msgs" id="hd-msgs">${messages.length ? messages.map(m => `<div class="wa-bubble ${m.direction}">${escapeHtml(m.body)}<small>${m.direction === 'note' ? 'Catatan internal · ' : m.direction === 'out' ? (m.channel === 'email' ? 'Email · ' : 'WA · ') : ''}${fmt(m.created_at)}</small></div>`).join('') : '<div class="wa-empty">Belum ada pesan.</div>'}</div>
    <div class="hd-compose">
      <textarea id="hd-reply" maxlength="3000" placeholder="${open ? 'Tulis balasan, atau klik “Draf dari Rawat”…' : 'Tiket sudah selesai — balasan baru akan membuka kembali alurnya.'}">${escapeHtml(draft)}</textarea>
      <div class="hd-compose-actions">
        <button class="hd-ai-btn" id="hd-ai-btn" onclick="hdDraft()">✨ Draf dari Rawat</button>
        ${t.wa ? `<button class="aio-btn" onclick="hdReply('wa')">Kirim WA</button><button class="aio-btn" style="background:#2e7d4f" onclick="hdReply('wa',true)">Kirim WA &amp; selesai</button>` : ''}
        ${t.email ? `<button class="aio-btn" onclick="hdReply('email')">Kirim email</button>` : ''}
        <button class="crm-btn-ghost" onclick="hdNote()">Simpan sebagai catatan internal</button>
        <span id="hd-reply-note">${t.ai_draft && typed == null ? 'Draf dari Rawat — periksa sebelum kirim.' : ''}</span>
      </div>
    </div>`;
  const m = document.getElementById('hd-msgs'); m.scrollTop = m.scrollHeight;
}

async function hdUpdate(patch) {
  try { await crmApi('/api/office/ticket', { method: 'POST', body: JSON.stringify({ op: 'update', id: hd.sel, ...patch }) }); hdLoad(); }
  catch (e) { document.getElementById('hd-reply-note').textContent = 'Gagal: ' + e.message; }
}
async function hdReply(via, close) {
  const ta = document.getElementById('hd-reply'), note = document.getElementById('hd-reply-note');
  if (!ta.value.trim()) { note.textContent = 'Tulis balasan dulu.'; return; }
  const btns = document.querySelectorAll('.hd-compose button'); btns.forEach(b => { b.disabled = true; });
  note.textContent = 'Mengirim…';
  try {
    await crmApi('/api/office/ticket', { method: 'POST', body: JSON.stringify({ op: 'reply', id: hd.sel, via, close: !!close, body: ta.value, from_draft: !!hd.detail.ticket.ai_draft }) });
    await hdLoad(true); await hdSelect(hd.sel);
  } catch (e) { note.textContent = 'Gagal: ' + e.message; btns.forEach(b => { b.disabled = false; }); }
}
async function hdNote() {
  const ta = document.getElementById('hd-reply');
  if (!ta.value.trim()) return;
  try { await crmApi('/api/office/ticket', { method: 'POST', body: JSON.stringify({ op: 'reply', kind: 'note', id: hd.sel, body: ta.value }) }); ta.value = ''; hdSelect(hd.sel); }
  catch (e) { document.getElementById('hd-reply-note').textContent = 'Gagal: ' + e.message; }
}
async function hdDraft() {
  const btn = document.getElementById('hd-ai-btn'), note = document.getElementById('hd-reply-note');
  btn.disabled = true; note.textContent = 'Rawat sedang membaca tiket & menulis draf…';
  try {
    const j = await crmApi('/api/agents/rawat', { method: 'POST', body: JSON.stringify({ ticket_id: hd.sel }) });
    await hdLoad(true); await hdSelect(hd.sel);
    document.getElementById('hd-reply').value = j.draft;
    document.getElementById('hd-reply-note').textContent = (j.source === 'template' ? 'AI sedang tidak tersedia (cek saldo API) — ini draf template. ' : 'Draf dari Rawat — periksa sebelum kirim. ') + (j.needs ? 'Cek dulu: ' + j.needs : '');
  } catch (e) { note.textContent = 'Gagal: ' + e.message; btn.disabled = false; }
}

function hdNewTicketForm(prefill = {}) {
  openSharedModal(`<h3>Tiket baru</h3><div class="crm-sub">Kategori & prioritas otomatis ditebak dari isi pesan bila dibiarkan “Otomatis”.</div>
    <div class="hd-form">
      <label>Nama klien<input id="hdn-name" maxlength="200" value="${escapeHtml(prefill.name || '')}"></label>
      <label>Kanal<select id="hdn-channel">${hdOpts(HD_CHANNEL, prefill.channel || 'wa')}</select></label>
      <label>WhatsApp<input id="hdn-wa" maxlength="30" value="${escapeHtml(prefill.wa ? '0' + String(prefill.wa).replace(/^62/, '') : '')}"></label>
      <label>Email<input id="hdn-email" maxlength="200" value="${escapeHtml(prefill.email || '')}"></label>
      <label class="wide">Subjek<input id="hdn-subject" maxlength="200" placeholder="opsional — diambil dari isi pesan"></label>
      <label class="wide">Isi pesan / keluhan klien<textarea id="hdn-body" rows="5" maxlength="4000"></textarea></label>
      <label>Prioritas<select id="hdn-priority"><option value="">Otomatis</option>${hdOpts(HD_PRIORITY)}</select></label>
      <label>Kategori<select id="hdn-category"><option value="">Otomatis</option>${hdOpts(HD_CATEGORY)}</select></label>
    </div>
    <div class="qt-actions"><button class="aio-btn" onclick="hdCreate(${prefill.lead_id ? +prefill.lead_id : 'null'})">Buat tiket</button><span class="crm-sub" id="hdn-note"></span></div>`);
}
async function hdCreate(leadId) {
  const v = id => document.getElementById(id).value;
  const note = document.getElementById('hdn-note');
  note.textContent = 'Menyimpan…';
  try {
    const j = await crmApi('/api/office/ticket', { method: 'POST', body: JSON.stringify({ lead_id: leadId, client_name: v('hdn-name'), channel: v('hdn-channel'), wa: v('hdn-wa'), email: v('hdn-email'),
      subject: v('hdn-subject'), body: v('hdn-body'), priority: v('hdn-priority') || undefined, category: v('hdn-category') || undefined }) });
    document.getElementById('pf-modal-overlay').style.display = 'none';
    hd.pendingSelect = j.ticket.id;
    if (document.getElementById('page-helpdesk').classList.contains('active')) hdLoad(); else showPage('helpdesk');
  } catch (e) { note.innerHTML = 'Gagal: ' + qtMigrationMsg(e); }
}
/** Dari CRM / percakapan WA: jadikan tiket memakai pesan masuk terakhir. */
async function hdFromLead(leadId) {
  try {
    const j = await crmApi('/api/office/ticket', { method: 'POST', body: JSON.stringify({ op: 'from-lead', lead_id: leadId }) });
    const o = document.getElementById('pf-modal-overlay'); if (o) o.style.display = 'none';
    hd.pendingSelect = j.ticket.id; showPage('helpdesk');
  } catch (e) { alertInline(e); }
}
function alertInline(e) {
  const n = document.getElementById('crm-note') || document.getElementById('wa-note');
  if (n) n.innerHTML = 'Gagal membuat tiket: ' + qtMigrationMsg(e);
}
