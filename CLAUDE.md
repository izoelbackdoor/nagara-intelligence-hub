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

## Hari Ini (js/hari-ini.js) — halaman pembuka setelah login

- Satu tempat untuk semua yang menunggu keputusan pemilik dari semua tim (standar: Project doc `claude/standar-command-center.md` — satu pintu, tidak ada subdomain per tim).
- Data: `GET /api/office/hari-ini` → RPC `hub_hari_ini()` = `cc_tim_nadi()` + `keputusan` (approval Produksi + follow-up Sales yang menunggu persetujuan).
- Keputusan di halaman: `POST /api/office/putuskan {sumber: prod|followup, id, aksi, nilai?, pesan?}`. Produksi dijalankan RPC `prod_aksi` (logika sama dengan link Telegram); follow-up dikirim via Fonnte dari server lalu dicatat `sales_followup_result`.
- `decideApproval`: approval berproyek (`project_id`) **wajib** lewat `prod_aksi` — jangan hanya ditandai disetujui.
- Tim lain (desain, konten, penawaran) tampil di "Menunggu Anda di tim lain" dengan tombol ke halaman review masing-masing. Link Telegram Produksi & follow-up mengarah ke `<hub_url>/#hari-ini` (`nadi_config.cfg.hub_url`). URL `/#<halaman>` membuka halaman itu setelah login.

## Outreach & Brief NADI (n8n)

- Halaman **Outreach & Brief NADI** (`js/sales-ui.js`, `on*`) membaca `GET /api/office/nadi-progress[?lead=id]` → view `nadi_v_ringkasan`, `nadi_v_progres`, `nadi_v_penawaran` (`supabase/migrations/20261022_nadi_progres_views.sql`) + `crm_messages`.
- Hanya baca. Outreach WA dari 0858, balasan bot, dan kirim penawaran berjalan di n8n (n8n.nagaraku.id, workflow NADI 2/3/4) + form brief.nagaraku.id — bukan lewat antrean persetujuan dashboard.

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
