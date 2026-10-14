// Kalkulator Harga NADI — port dari "Kalkulator_Harga_Website_NADI.xlsx"
// (lihat dok "Panduan Kalkulator Harga Website NADI").
// Murni perhitungan: tanpa DOM, tanpa fetch. Dipakai di browser (window.QuoteCalc)
// dan di server (require) supaya angka di dashboard & di dokumen klien selalu sama.
//
//   Harga final = Biaya dasar × (1 + buffer) × (1 + margin), dibulatkan ke atas ke kelipatan pembulatan
//   Biaya dasar = Σ (jam × tarif) + biaya tetap, untuk komponen yang aktif
//   Jam "Fitur khusus" = Σ jam dasar fitur terpilih × pengali kompleksitas
//
// Tarif per jam TIDAK PERNAH dikirim ke klien — clientView() hanya memuat ruang lingkup & harga.
(function (root) {
  'use strict';

  var DEFAULTS = {
    version: 1,
    rate: 150000,             // tarif per jam (Rp) — rahasia internal
    buffer: 0.15,             // cadangan revisi/konten telat/bug
    margin: 0.40,             // margin profit proyek
    marginRecurring: 0.40,    // margin hosting & maintenance
    rounding: 500000,         // pembulatan harga proyek (ke atas)
    roundingRecurring: 10000, // pembulatan harga bulanan (ke atas)
    maintHours: 2,            // jam maintenance per klien per bulan
    hosting: { shared: 50000, vps: 200000, dedicated: 1500000 }, // modal server per bulan
    yearly: { domain: 200000, ssl: 0, email: 0 },                 // modal tahunan
    tiers: [
      { key: 'starter', name: 'Starter', price: 7000000 },
      { key: 'growth', name: 'Growth', price: 12000000 },
      { key: 'enterprise', name: 'Enterprise', price: 20000000 },
    ],
    complexity: { sederhana: 1, menengah: 1.5, kompleks: 2 },
    validDays: 14,
    defaultRevisions: 2,
    paymentTerms: '50% di muka saat persetujuan, 50% saat website siap live.',
    company: { name: 'Nagara Digital Lab Indonesia (NADI)', city: 'Bandung', wa: '0858-8777-9036', email: 'halo@nagaraku.id', web: 'nagaraku.id', signer: 'Imam' },
    groups: ['Desain', 'Development', 'Konten', 'Lisensi', 'Integrasi', 'Lainnya'],
    // Angka jam = contoh dari file kalkulator; sesuaikan di Pengaturan.
    components: [
      { id: 'desain_template', group: 'Desain', name: 'Desain berbasis template', client: 'Desain tampilan website (berbasis template premium, disesuaikan brand)', hours: 8, fixed: 0, on: true },
      { id: 'desain_custom', group: 'Desain', name: 'Desain custom dari nol', client: 'Desain tampilan custom dari nol sesuai identitas brand', hours: 24, fixed: 0, on: false },
      { id: 'setup', group: 'Development', name: 'Setup proyek, domain & hosting', client: 'Setup domain, hosting, dan SSL', hours: 3, fixed: 0, on: true },
      { id: 'halaman', group: 'Development', name: 'Pembuatan halaman (±5 halaman)', client: 'Pembuatan halaman website (±5 halaman), responsif di HP', hours: 12, fixed: 0, on: true },
      { id: 'input_konten', group: 'Konten', name: 'Input data & konten', client: 'Input konten awal (teks, foto, produk/layanan)', hours: 6, fixed: 0, on: true },
      { id: 'copywriting', group: 'Konten', name: 'Copywriting', client: 'Penulisan copywriting halaman', hours: 6, fixed: 0, on: false },
      { id: 'lisensi_tema', group: 'Lisensi', name: 'Tema / plugin premium', client: 'Lisensi tema/plugin premium', hours: 0, fixed: 800000, on: true },
      { id: 'lisensi_api', group: 'Lisensi', name: 'API berbayar', client: 'Lisensi layanan/API pihak ketiga', hours: 0, fixed: 0, on: false },
      { id: 'midtrans', group: 'Integrasi', name: 'Payment gateway (Midtrans)', client: 'Integrasi pembayaran online (QRIS, VA, e-wallet)', hours: 8, fixed: 0, on: false },
      { id: 'whatsapp', group: 'Integrasi', name: 'Integrasi WhatsApp', client: 'Tombol & integrasi WhatsApp', hours: 4, fixed: 0, on: true },
      { id: 'analytics', group: 'Integrasi', name: 'Analytics / Pixel', client: 'Pemasangan Google Analytics & Meta Pixel', hours: 2, fixed: 0, on: true },
      { id: 'seo', group: 'Lainnya', name: 'SEO dasar', client: 'SEO dasar (meta, sitemap, Google Search Console)', hours: 4, fixed: 0, on: true },
      { id: 'training', group: 'Lainnya', name: 'Training klien', client: 'Pelatihan pengelolaan website', hours: 2, fixed: 0, on: true },
      { id: 'meeting', group: 'Lainnya', name: 'Meeting', client: null, hours: 4, fixed: 0, on: true },
      { id: 'revisi', group: 'Lainnya', name: 'Revisi', client: null, hours: 4, fixed: 0, on: true },
    ],
    features: [
      { key: 'toko', name: 'Toko online / checkout', sub: 'Keranjang, checkout, ongkir, manajemen pesanan, testing', hours: 21 },
      { key: 'booking', name: 'Booking / reservasi', sub: 'Form booking, kalender slot, notifikasi WA/email, dashboard admin, testing', hours: 20 },
      { key: 'katalog', name: 'Katalog produk', sub: 'Admin produk, daftar + filter, detail, pencarian, testing', hours: 16 },
      { key: 'login', name: 'Login & membership', sub: 'Registrasi/login, profil, reset password, role, testing', hours: 14 },
      { key: 'chatbot', name: 'Chatbot AI (Claude API)', sub: 'Setup API & prompt, basis pengetahuan, widget chat, testing', hours: 13 },
      { key: 'dashboard', name: 'Dashboard laporan', sub: 'Metrik & query, grafik, export, testing', hours: 12 },
      { key: 'multibahasa', name: 'Multi-bahasa', sub: 'Setup terjemahan, input konten, testing', hours: 6 },
      { key: 'blog', name: 'Blog / artikel', sub: 'Setup CMS, template artikel, testing', hours: 5 },
      { key: 'form_lead', name: 'Form lead ke WA / Airtable / CRM', sub: 'Form, kirim data via n8n, testing', hours: 4 },
    ],
  };

  var SERVERS = { none: 'Tanpa hosting', shared: 'Shared', vps: 'VPS', dedicated: 'Dedicated' };

  function num(v, d, min, max) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) n = d;
    if (min != null && n < min) n = min;
    if (max != null && n > max) n = max;
    return n;
  }
  function str(v, max) { return String(v == null ? '' : v).slice(0, max || 200); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function ceilTo(v, step) { return step > 0 ? Math.ceil(Math.round(v) / step) * step : Math.round(v); }

  /** Gabungkan pengaturan tersimpan dengan default; nilai rusak/aneh jatuh ke default. */
  function mergeSettings(saved) {
    var s = clone(DEFAULTS), x = saved && typeof saved === 'object' ? saved : {};
    s.rate = num(x.rate, s.rate, 0, 1e8);
    s.buffer = num(x.buffer, s.buffer, 0, 5);
    s.margin = num(x.margin, s.margin, 0, 10);
    s.marginRecurring = num(x.marginRecurring, s.marginRecurring, 0, 10);
    s.rounding = num(x.rounding, s.rounding, 0, 1e9);
    s.roundingRecurring = num(x.roundingRecurring, s.roundingRecurring, 0, 1e8);
    s.maintHours = num(x.maintHours, s.maintHours, 0, 1000);
    s.validDays = Math.round(num(x.validDays, s.validDays, 1, 365));
    s.defaultRevisions = Math.round(num(x.defaultRevisions, s.defaultRevisions, 0, 50));
    if (x.paymentTerms != null) s.paymentTerms = str(x.paymentTerms, 500);
    if (x.company && typeof x.company === 'object') {
      ['name', 'city', 'wa', 'email', 'web', 'signer'].forEach(function (k) { if (x.company[k] != null) s.company[k] = str(x.company[k], 120); });
    }
    ['shared', 'vps', 'dedicated'].forEach(function (k) { if (x.hosting) s.hosting[k] = num(x.hosting[k], s.hosting[k], 0, 1e9); });
    ['domain', 'ssl', 'email'].forEach(function (k) { if (x.yearly) s.yearly[k] = num(x.yearly[k], s.yearly[k], 0, 1e9); });
    ['sederhana', 'menengah', 'kompleks'].forEach(function (k) { if (x.complexity) s.complexity[k] = num(x.complexity[k], s.complexity[k], 0.1, 10); });
    if (Array.isArray(x.tiers) && x.tiers.length) {
      s.tiers = x.tiers.slice(0, 6).map(function (t, i) {
        return { key: str(t.key || 'tier' + i, 40), name: str(t.name || 'Paket ' + (i + 1), 60), price: num(t.price, 0, 0, 1e11) };
      }).filter(function (t) { return t.price > 0; }).sort(function (a, b) { return a.price - b.price; });
    }
    if (Array.isArray(x.components) && x.components.length) {
      var seen = {};
      s.components = x.components.slice(0, 80).map(function (c, i) {
        var id = str(c.id || 'k' + i, 40).replace(/[^a-z0-9_]/gi, '_') || 'k' + i;
        while (seen[id]) id += '_';
        seen[id] = 1;
        return { id: id, group: s.groups.indexOf(c.group) >= 0 ? c.group : 'Lainnya', name: str(c.name || id, 120),
          client: c.client === null ? null : str(c.client || c.name || id, 200), hours: num(c.hours, 0, 0, 1000), fixed: num(c.fixed, 0, 0, 1e10), on: !!c.on };
      });
    }
    if (Array.isArray(x.features) && x.features.length) {
      s.features = x.features.slice(0, 60).map(function (f, i) {
        return { key: str(f.key || 'f' + i, 40).replace(/[^a-z0-9_]/gi, '_'), name: str(f.name || 'Fitur ' + (i + 1), 120), sub: str(f.sub, 300), hours: num(f.hours, 0, 0, 2000) };
      });
    }
    return s;
  }

  /** Input default untuk penawaran baru (komponen sesuai kolom "Masuk?" bawaan). */
  function defaultInputs(settings) {
    var s = settings || DEFAULTS, comps = {};
    s.components.forEach(function (c) { comps[c.id] = { on: !!c.on, hours: c.hours, fixed: c.fixed }; });
    return { components: comps, features: {}, server: 'shared', offerPrice: null, revisions: s.defaultRevisions };
  }

  /** Inti kalkulator. settings sudah lewat mergeSettings; inputs dari form. */
  function compute(settings, inputs) {
    var s = settings, inp = inputs || {}, ci = inp.components || {}, fi = inp.features || {};
    var rate = s.rate;

    var featureLines = [], featureHours = 0;
    s.features.forEach(function (f) {
      var sel = fi[f.key];
      if (!sel || !sel.on) return;
      var cx = s.complexity[sel.complexity] ? sel.complexity : 'sederhana';
      var hours = Math.round(f.hours * s.complexity[cx] * 100) / 100;
      featureHours += hours;
      featureLines.push({ key: f.key, name: f.name, complexity: cx, baseHours: f.hours, mult: s.complexity[cx], hours: hours });
    });

    var lines = [];
    s.components.forEach(function (c) {
      var v = ci[c.id] || {};
      var on = v.on == null ? c.on : !!v.on;
      if (!on) return;
      var hours = num(v.hours, c.hours, 0, 1000), fixed = num(v.fixed, c.fixed, 0, 1e10);
      lines.push({ id: c.id, group: c.group, name: c.name, client: c.client, hours: hours, fixed: fixed, subtotal: hours * rate + fixed });
    });
    if (featureHours > 0) {
      lines.push({ id: 'fitur_khusus', group: 'Development', name: 'Fitur khusus', client: null, hours: featureHours, fixed: 0, subtotal: featureHours * rate });
    }

    var hours = 0, costBase = 0;
    lines.forEach(function (l) { hours += l.hours; costBase += l.subtotal; });
    hours = Math.round(hours * 100) / 100;
    costBase = Math.round(costBase);
    var withBuffer = Math.round(costBase * (1 + s.buffer));
    var priceCalc = Math.round(withBuffer * (1 + s.margin));
    var priceFinal = ceilTo(priceCalc, s.rounding);

    var tier = null;
    for (var i = 0; i < s.tiers.length; i++) { if (s.tiers[i].price >= priceFinal) { tier = s.tiers[i]; break; } }
    var tierRoom = tier ? tier.price - priceFinal : null;

    // Harga yang ditawarkan: default harga paket (prinsip: ke klien tawarkan harga paket), Custom → harga final.
    var suggested = tier ? tier.price : priceFinal;
    var override = inp.offerPrice == null || inp.offerPrice === '' ? null : num(inp.offerPrice, null, 0, 1e11);
    var offerPrice = override && override > 0 ? Math.round(override) : suggested;

    var server = SERVERS[inp.server] ? inp.server : 'shared';
    var monthlyCost = 0, monthly = 0, yearlyHosting = 0, annualCost = 0, annual = 0;
    if (server !== 'none') {
      monthlyCost = s.hosting[server] + s.maintHours * rate;
      monthly = ceilTo(monthlyCost * (1 + s.marginRecurring), s.roundingRecurring);
      yearlyHosting = monthly * 12;
    }
    annualCost = s.yearly.domain + s.yearly.ssl + s.yearly.email;
    annual = Math.round(annualCost * (1 + s.marginRecurring));

    return {
      lines: lines,
      featureLines: featureLines,
      hours: hours,
      costBase: costBase,
      withBuffer: withBuffer,
      priceCalc: priceCalc,
      priceFinal: priceFinal,
      profit: priceFinal - costBase,
      tier: tier ? { key: tier.key, name: tier.name, price: tier.price } : null,
      tierLabel: tier ? tier.name : 'Custom',
      tierRoom: tierRoom,
      suggestedPrice: suggested,
      offerPrice: offerPrice,
      offerProfit: offerPrice - costBase,
      belowMinimum: offerPrice < priceFinal,
      recurring: {
        server: server, serverLabel: SERVERS[server],
        monthlyCost: monthlyCost, monthly: monthly, yearlyHosting: yearlyHosting,
        annualCost: annualCost, annual: annual,
        totalYearly: yearlyHosting + annual,
      },
    };
  }

  /** Data aman untuk dokumen klien: ruang lingkup & harga saja — tanpa jam, tarif, biaya dasar, margin. */
  function clientView(settings, inputs, result) {
    var scope = {};
    result.lines.forEach(function (l) {
      if (!l.client) return;
      (scope[l.group] = scope[l.group] || []).push(l.client);
    });
    var features = result.featureLines.map(function (f) { return f.name; });
    if (features.length) (scope.Development = scope.Development || []).push.apply(scope.Development, features.map(function (n) { return 'Fitur: ' + n; }));
    var groups = settings.groups.filter(function (g) { return scope[g] && scope[g].length; }).map(function (g) { return { group: g, items: scope[g] }; });
    var r = result.recurring;
    return {
      scope: groups,
      packageName: result.tier ? 'Paket ' + result.tier.name : 'Paket Custom',
      price: result.offerPrice,
      revisions: inputs && inputs.revisions != null ? Math.round(num(inputs.revisions, settings.defaultRevisions, 0, 50)) : settings.defaultRevisions,
      paymentTerms: settings.paymentTerms,
      company: settings.company,
      recurring: r.server === 'none' && !r.annual ? null : {
        serverLabel: r.server === 'none' ? null : r.serverLabel,
        monthly: r.monthly, yearlyHosting: r.yearlyHosting, annual: r.annual, totalYearly: r.totalYearly,
      },
    };
  }

  function formatRp(n) {
    var v = Math.round(Number(n) || 0);
    return 'Rp ' + v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function formatJt(n) {
    var v = (Number(n) || 0) / 1e6;
    return 'Rp ' + (Math.round(v * 100) / 100).toString().replace('.', ',') + ' jt';
  }

  var QuoteCalc = {
    DEFAULTS: DEFAULTS, SERVERS: SERVERS,
    mergeSettings: mergeSettings, defaultInputs: defaultInputs, compute: compute, clientView: clientView,
    formatRp: formatRp, formatJt: formatJt, ceilTo: ceilTo,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = QuoteCalc;
  else root.QuoteCalc = QuoteCalc;
})(typeof window !== 'undefined' ? window : globalThis);
