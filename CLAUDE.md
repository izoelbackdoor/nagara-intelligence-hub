# Nagara Command Center (repo: nagara-intelligence-hub)

Dashboard internal Nagara Group Indonesia (NGI): CRM calon klien, inbox WA/email,
"Virtual Office" karyawan AI, dan antrean persetujuan. Dulu bernama Nagara Intelligence Hub.
Pemilik & satu-satunya user: Aa Imam. Bahasa UI, pesan error, komentar, dan commit: **Bahasa Indonesia**.

- Production: https://nagara-intelligence-hub.vercel.app (login wajib)
- Deploy: Vercel project `nagara-intelligence-hub`, auto-deploy dari branch default — **push = rilis ke production**
- Database: Supabase project `nagara-command-center` (tabel `office_*`, `crm_*`)
- Data lama/sumber prospek: Airtable (Nagara CRM `apprX0HpneI5lcqOP`, EduKit Pipeline `appo57WuaPrR0zICH`)

## Struktur

| Path | Isi |
|---|---|
| `index.html` | Seluruh dashboard (±10.000 baris, HTML+CSS+JS vanilla, tanpa build step) |
| `js/quote-calc.js` | Kalkulator harga NADI (murni, browser + server) — port dari `Kalkulator_Harga_Website_NADI.xlsx`. Tes: `js/quote-calc.test.js` |
| `js/sales-ui.js` | UI halaman **Penawaran & Kalkulator** dan **Helpdesk** (dimuat index.html) |
| `js/iklan-ui.js` | Tab **Iklan Meta & 11 Page FB** (halaman `marketing-content`): data iklan Meta langsung + Analis Meta Ads |
| `office/` | Virtual Office hasil build (statis). **Jangan edit langsung** — sumbernya `office-src/` |
| `office-src/` | Vite + React + TS, fork Claude Office (MIT). Build: `npm install && npm run build`, salin `dist/*` ke `../office/` (pertahankan `office/3d.html` & `LICENSE-claude-office.txt`) |
| `api/` | Vercel Node functions (CommonJS, `module.exports = async (req, res)`) |
| `lib/` | Helper server: `session.js` (auth), `supabase.js` (REST), `wa.js` (Fonnte), `leads.js` (skor prospek), `inbound.js` (WA masuk → CRM/helpdesk), `sales.js` (penawaran + halaman klien), `helpdesk.js` (tiket, SLA, triase), `nadi-progress.js` (halaman Outreach & Brief NADI, hanya baca), `agents/` |
| `supabase/migrations/` | SQL migrasi, dijalankan manual di Supabase SQL Editor (aditif, aman diulang) |
| `kb/` | Knowledge base untuk AI draft balasan (`api/inbox/ai-draft.js` membaca file ini) |
| `docs/` | Cara agen (n8n/Hermes) lapor ke Virtual Office; workflow n8n siap import |
| `scripts/` | Utilitas lokal: `setup-secrets.js` / `hash-password.js` (DASH_PASS_HASH), import kontak ke Airtable |
| `TASKS.md` | Roadmap proyek client Content Automation (Phase 4 = integrasi panel ke Command Center) |

## Aturan penting

- **Batas Vercel Hobby: 12 serverless functions.** Saat ini 11 file di `api/` (file berawalan `_` tidak dihitung). Jangan tambah file function baru — tambahkan aksi ke router yang ada (`api/office/state.js?action=…`, `api/agents/run.js?agent=…`, `api/auth.js?action=…`) dan daftarkan route di `vercel.json`.
- Setiap route baru wajib ditambahkan di `vercel.json` → `routes`, **sebelum** catch-all `/(.*)` → `index.html`.
- File JS statis baru (`js/*.js`) wajib didaftarkan **dua kali** di `vercel.json`: di `builds` (`@vercel/static`) **dan** di `routes` (`/js/<file>.js`). Tanpa route, file itu dijawab dengan `index.html` oleh catch-all → script gagal dimuat dan tombol halaman tidak bisa diklik (pernah terjadi pada `hari-ini.js` & `produksi-ui.js`).
- Auth: cookie HMAC `ngi_session` (`lib/session.js`). Endpoint untuk dashboard pakai `requireAuth`/`withAuth`. Endpoint mesin-ke-mesin pakai Bearer token + `safeEqual` (`OFFICE_INGEST_TOKEN`, `WA_INBOUND_TOKEN`, `CRON_SECRET`), minimal 32/16 karakter.
- Secret hanya di env Vercel. Jangan menulis token/API key di kode, HTML, atau localStorage. `.env*` di-ignore.
- Supabase diakses hanya dari server dengan service role (`lib/supabase.js`), lewat PostgREST. Nilai dari user harus di-`encodeURIComponent` atau divalidasi (int/enum) sebelum masuk query string.
- Respon JSON pakai `sendJson(res, status, body)` dari `lib/session.js`.

## Karyawan AI (lib/agents)

- Model: `claude-haiku-4-5-20251001` lewat fetch langsung ke Messages API (`CLAUDE_API_KEY`). Biaya dicatat di `office_costs`; batas harian per meja $0.5.
- **Arah** (Chief of Staff): brief pagi/sore via Vercel Cron (00:00 & 10:00 UTC = 07:00 & 17:00 WIB), opsional email ke pemilik.
- **Usul** (outreach): menyusun draf WA perkenalan dari `crm_leads` → `office_approvals`. Jika AI gagal → draf template (`templateMessage`).
- **Rawat** (helpdesk, meja Studio NADI): `/api/agents/rawat` {ticket_id} → ringkasan, saran kategori/prioritas, draf balasan dari `kb/` (tanpa `pricing.md` — angka hanya dari penawaran klien). Draf hanya mengisi kotak balasan.
- Prinsip tidak bisa ditawar: **tidak ada pesan ke klien tanpa persetujuan pemilik.** Kirim WA hanya terjadi di `decideApproval` (klik "Setujui & kirim"). Batas: 20 draf/hari, 20 antrean, 20 kirim/hari. Setiap pesan wajib berakhir dengan opsi "Balas STOP"; balasan STOP → `jangan_hubungi`.
- Agen tidak boleh mengarang klaim/harga/testimoni di luar `OFFERS` di `usul.js`.
- Semua aksi agen dicatat di `office_events` (level: info · teknis · peringatan · bahaya).

## Penawaran (lib/sales.js)

- Angka selalu dihitung ulang di server dengan `js/quote-calc.js`; asumsi di tabel `sales_settings` (key `kalkulator`), snapshot asumsi disimpan per penawaran.
- **Tarif per jam, jam kerja, biaya dasar & margin tidak boleh masuk dokumen klien** — dokumen hanya memakai `result.client` (`clientView`).
- Alur: draf → `op: send` membuat approval `kind: penawaran` (desk `usul`) → pemilik "Setujui & kirim WA" → `terkirim` → klien buka `/penawaran/<token 64 hex>` (publik, `noindex`, CSP) → setujui online → `diterima` + lead `deal`.
- Hanya draf yang bisa diedit; selain itu duplikat. Draf/menunggu kirim tidak bisa dibuka lewat link publik.

## Helpdesk (lib/helpdesk.js)

- WA masuk dari lead berstatus `deal` atau nomor dengan tiket terbuka → tiket (`routeInbound`, dipanggil `lib/inbound.js`, error tidak boleh menggagalkan webhook). STOP tidak jadi tiket.
- SLA = batas balasan kita berikutnya sejak pesan klien terakhir (urgent 2j · tinggi 4j · normal 24j · rendah 48j); dikosongkan saat kita membalas / menunggu klien.
- Balasan WA/email hanya lewat klik pemilik (`op: reply`); kontak `jangan_hubungi` diblok.

## Struktur menu (wajib diikuti semua tim)

Menu samping digabung per tim/area (24 Okt 2026). **Jangan menambah menu samping baru untuk hal yang sudah punya tempat** — tambahkan sebagai halaman/tab di grup yang sesuai.

| Menu samping | Halaman (tab di atas halaman) |
|---|---|
| Hari Ini | `hari-ini` — semua keputusan dari semua tim |
| Overview NGI | `overview` Ringkasan · `portfolio` Portfolio produk · `business-unit` Per business unit · `legal-compliance` Lisensi & UU PDP |
| Kantor AI | `virtual-office` Kantor · `ai-orchestration` Daftar agen & log |
| Sales NADI | `outreach-nadi` Outreach & brief · `crm-pipeline` CRM & percakapan WA · `penawaran` Penawaran & kalkulator |
| Tim Produksi | `produksi` |
| Studio Desain | `desain` |
| Konten & Marketing | `konten` Konten NADI · `marketing-content` Iklan Meta & 11 Page FB |
| Helpdesk | `helpdesk` |

- Grup diatur di `MENU_GROUPS` (index.html, dekat `PAGE_META`); tab dirender `ccRenderSubnav()` ke `#cc-subnav`. Tombol menu grup ber-id `nav-g-<grup>`. Id halaman tidak berubah, jadi `showPage('<id>')` dan link `/#<id>` tetap jalan.
- Halaman tim baru: buat `<div id="page-<id>" class="page-section">`, daftarkan di `PAGE_META` + loader di `showPage`, lalu **masukkan ke grup** di `MENU_GROUPS`. Menu samping baru hanya untuk tim yang benar-benar baru (mis. Keuangan, Legal) — satu tim satu menu.
- Sebelum membuat halaman, cek dulu apakah isinya beririsan dengan halaman yang ada (daftar agen, biaya token, approval, meeting, penawaran, konten). Kalau beririsan, perluas halaman yang ada.
- Keputusan pemilik selalu tampil di **Hari Ini** (lewat `cc_tim_nadi()` / `hub_hari_ini()`), bukan dibuat ulang per menu.
- Halaman lama tersembunyi (`page-nadi`, `page-agent-ai`, `page-finance`, `page-crm`, `page-legal`, `page-marketing`, `page-inbox`, dll.) tidak ada di menu; jangan dihidupkan lagi tanpa digabung ke grup.

## Hari Ini (js/hari-ini.js) — halaman pembuka setelah login

- Satu tempat untuk semua yang menunggu keputusan pemilik dari semua tim (standar: Project doc `claude/standar-command-center.md` — satu pintu, tidak ada subdomain per tim).
- Data: `GET /api/office/hari-ini` → RPC `hub_hari_ini()` = `cc_tim_nadi()` + `keputusan` (approval Produksi + follow-up Sales yang menunggu persetujuan).
- Keputusan di halaman: `POST /api/office/putuskan {sumber: prod|followup, id, aksi, nilai?, pesan?}`. Produksi dijalankan RPC `prod_aksi` (logika sama dengan link Telegram); follow-up dikirim via Fonnte dari server lalu dicatat `sales_followup_result`.
- `decideApproval`: approval berproyek (`project_id`) **wajib** lewat `prod_aksi` — jangan hanya ditandai disetujui.
- Tim lain (desain, konten, penawaran) tampil di "Menunggu Anda di tim lain" dengan tombol ke halaman review masing-masing. Link Telegram Produksi & follow-up mengarah ke `<hub_url>/#hari-ini` (`nadi_config.cfg.hub_url`). URL `/#<halaman>` membuka halaman itu setelah login.

## Tim Produksi (js/produksi-ui.js)

- Menu **Tim Produksi** (Studio NADI): alur kerja 7 tahap dengan jumlah proyek per tahap, tim & jobdesk (dari `office_desks`/`office_agents`, termasuk system prompt), daftar proyek + detail (rencana PM, tugas & hasil kerja, laporan uji per putaran, bug, keputusan, pesan WA), aktivitas.
- Data: `GET /api/office/produksi[?id=<uuid>]` → RPC `hub_produksi(p_id)`. Hanya baca; keputusan tetap di **Hari Ini**.
- Tim lain menambah menu dengan pola yang sama (satu file `js/<tim>-ui.js` + satu RPC `hub_<tim>()` + satu aksi di `state.js`).

## Konten NADI (js/konten.js)

- Menu **Konten NADI** untuk tim Marketing (`mkt-*`) + Studio Desain: form **Minta materi** (langsung ke penulis per kanal, maks 8 materi, satu per hari), review draf (setujui / revisi / tolak / setujui semua), detail isi siap salin, tandai sudah diposting, rencana mingguan + arahan Kepala Marketing, status agen.
- Data: `GET /api/office/konten[?id=<uuid>]` → RPC `hub_konten()` / `hub_konten_detail(p_id)`. Aksi: `POST /api/office/konten {op}` → `hub_konten_aksi(p)`; keputusan draf memakai logika `tim_aksi` yang sama dengan halaman n8n.
- `mkt_rencana.jenis`: `mingguan` (unik per minggu, dibuat `mkt_mulai_minggu`) atau `permintaan` (dari menu ini). Migrasi: `supabase/migrations/20261023_hub_konten.sql`.
- Penulis dijalankan workflow n8n **NADI 7 - Marketing & Sales**; tanpa workflow itu permintaan hanya mengantre (halaman menampilkan peringatan).
- **Buffer** (kartu "Posting via Buffer"): konten `siap_terbit` dijadwalkan ke channel Buffer sesuai kanal (`ig_fb` → Instagram+Facebook, `tiktok` → TikTok+YouTube, `linkedin`). Tabel `mkt_buffer_channel` / `mkt_buffer_post`, fungsi `buffer_*`, pengaturan `cfg.tim.marketing.buffer` (default mati). Panggilan API Buffer dilakukan workflow n8n **NADI 7c - Buffer** (credential `Buffer NADI`, tidak ada token di repo/database). Gagal di Buffer → Telegram + kembali ke paket manual. Aksi `buffer` / `buffer_channel` di `POST /api/office/konten`. Migrasi: `supabase/migrations/20261023_buffer.sql`.

## Studio Desain (js/desain-ui.js)

- Menu **Studio Desain** (unit `desain`: Art Director + UI/UX, Brand, Social & Ads, Motion): alur kerja 7 tahap, tim & jobdesk (termasuk system prompt), **Job & hasil** (mockup HTML di iframe, galeri gambar/video, caption, arah kreatif, review Art Director, jejak kerja + biaya), form **Job baru**, aktivitas.
- Data: `GET /api/office/desain[?id=<uuid>]` → RPC `hub_desain(p_id)`. Aksi: `POST /api/office/desain-aksi {op: buat|putuskan|ulang}` → `hub_desain_aksi(p)` (memakai `desain_buat_job` / `desain_putuskan`). Setujui + ada nomor klien → link pratinjau dikirim via Fonnte dari server.
- Mockup HTML: `GET /api/office/desain-aset?id=` (wajib login) disajikan dengan `Content-Security-Policy: sandbox allow-scripts allow-popups` — skrip agen tidak bisa membaca cookie dashboard. Jangan hapus header ini.
- Link Telegram & "Menunggu Anda" di Hari Ini → `<hub_url>/#desain`. Link klien (hanya lihat) masih halaman webhook n8n `desain-lihat` sampai `klien.nagaraku.id` dibuat.
- Mesin: workflow n8n **NADI 6 - Studio Desain** (Claude + Higgsfield). Migrasi: `supabase/migrations/20261023_hub_04_desain.sql`.
- **Video final (Remotion, gratis):** folder `video-nadi/` (template `VideoNADI` 1080×1920) dirender oleh GitHub Actions `.github/workflows/render-video.yml` (workflow_dispatch dari n8n, input `payload`). Tanpa secret di GitHub: hasil diunggah ke bucket Storage publik `desain` lewat signed upload URL, lalu laporan ke RPC `desain_render_hasil` (anon, dicek token per render). Aset `Video Final` (`media.endpoint = 'remotion'`) dibuat dari field `edit` Motion Designer dan baru dikirim setelah klip/keyframe di tugas yang sama tuntas; klip gagal → keyframe sumbernya. Migrasi: `supabase/migrations/20261024_desain_render_video.sql`. `video-nadi/` diabaikan Vercel (`.vercelignore`). Lisensi Remotion gratis selama NADI ≤3 karyawan.

## Outreach & Brief NADI (n8n)

- Halaman **Outreach & Brief NADI** (`js/sales-ui.js`, `on*`) membaca `GET /api/office/nadi-progress[?lead=id]` → view `nadi_v_ringkasan`, `nadi_v_progres`, `nadi_v_penawaran` (`supabase/migrations/20261022_nadi_progres_views.sql`) + `crm_messages`.
- Hanya baca. Outreach WA dari 0858, balasan bot, dan kirim penawaran berjalan di n8n (n8n.nagaraku.id, workflow NADI 2/3/4) + form brief.nagaraku.id — bukan lewat antrean persetujuan dashboard.

## Iklan Meta (js/iklan-ui.js, lib/agents/iklan.js) — tim Marketing NADI

- Tab **Iklan Meta & 11 Page FB** (menu Konten & Marketing, halaman `marketing-content`): kampanye/ad set/iklan dengan status, belanja, impresi, klik, CTR, CPC, hasil, biaya per hasil (7 hari · 30 hari · seumur), grafik harian 30 hari, peringatan, rekomendasi analis. Bagian "11 Facebook Page" di bawahnya tidak berubah (`mc*`).
- Data: `GET /api/office/iklan` → RPC `hub_iklan()`; aksi `POST /api/office/iklan {op: rekomendasi|peringatan|budget}` → `hub_iklan_aksi`. Tabel `mkt_iklan_entitas`, `mkt_iklan_harian` (per iklan per hari), `mkt_iklan_sinkron`, `mkt_iklan_peringatan`, `mkt_iklan_analisis` (migrasi `20261024_iklan_meta.sql`).
- Sinkron: workflow n8n **NADI 7b - Iklan Meta** tiap 6 jam (`mkt_iklan_sinkron_mulai` → GET Graph API → `mkt_iklan_ingest`). Akun = `nadi_config.cfg.tim.marketing.ads.act_id`. Token Meta **hanya** di credential n8n "Meta NADI" (`ads_read`), tidak di database/kode/env Vercel.
- **Hanya baca.** Tidak ada kode yang menulis ke akun iklan. Rekomendasi hanya ditandai "sudah dijalankan/diabaikan"; eksekusi oleh pemilik di Ads Manager.
- Peringatan (`mkt_iklan_cek_peringatan`, pg_cron tiap jam + setiap ingest): kampanye berhenti / ACTIVE tapi tidak tayang N hari, iklan ditolak/bermasalah/tertahan pembayaran, belanja kemarin > `ads.budget_bulanan`/30, biaya per hasil naik > `ads.cpr_naik_persen` (30%) dari rata-rata 7 hari, token kedaluwarsa (kode 190), sinkron macet > 13 jam. Tampil di **Hari Ini** (`cc_tim_nadi` → tim "Iklan Meta") + Telegram saat baru.
- Analis Meta Ads (meja `mkt-ads`, model dari `office_agents`): pg_cron Senin 06.30 WIB → `mkt_iklan_mulai_analisis` (office_task jenis `iklan_analisis`). Dikerjakan n8n NADI 7 (`tim_antrian`) atau, bila masih antre > 20 menit, oleh cron `arah`; tombol "Analisis sekarang" = `POST /api/agents/iklan` (login). Hasil: maks 5 rekomendasi (alasan berangka) + 3 variasi teks iklan (dicek `tim_cek_teks`); variasi yang perlu visual → satu job Studio Desain internal. Biaya token dicatat `tim_selesai` → `office_costs`.

## WhatsApp

- Fonnte = outreach awal (lewat antrean persetujuan) — `lib/wa.js`.
- wacrm / WhatsApp Cloud API = percakapan lanjutan & inbound → `POST /api/office/wa-inbound`.
- Inbox lama (`api/inbox/*`) masih menyimpan percakapan ke Airtable; CRM baru ada di Supabase (`crm_messages`).

## Tes

`npm test` → `node --test 'js/*.test.js' 'lib/*.test.js'` (data portofolio, kalkulator — termasuk contoh angka di panduan kalkulator, triase helpdesk). Alur API penawaran/helpdesk sudah diuji end-to-end terhadap Postgres + PostgREST lokal, tapi skrip ujinya belum masuk repo.

## Catatan teknis yang diketahui

- `api/robot/signal.js`: POST wajib `ROBOT_WEBHOOK_SECRET` (min. 16 karakter; tanpa env → 503, tidak ada secret default), GET wajib login. Sinyal masih disimpan di memori (hilang tiap cold start) — kandidat pindah ke Supabase.
- `api/openwa/proxy.js` meneruskan request ke URL dari header `X-OpenWA-URL` dengan CORS `*`; pastikan tetap di balik login.
- `api/inbox/*` campur gaya (Airtable, `https` manual); kode baru ikuti pola `lib/` (fetch + Supabase).
