# NADI Content Automation — Client Project Tasks

Ordered easy → hard. Slow-approval items (TikTok, LinkedIn) disubmit lebih awal
meskipun integrasi-nya dikerjakan belakangan — approval butuh berminggu-minggu.

---

## Phase 0 — Quick admin & submissions (lakukan segera)

- [ ] Client konfirmasi admin access ke: WordPress, Facebook Business Manager, Instagram Business account, X Developer account, TikTok for Developers, LinkedIn Company Page
- [ ] Submit TikTok Content Posting API review (butuh berminggu-minggu — submit sekarang, build belakangan)
- [ ] Submit LinkedIn Marketing Developer Platform application (1–2 minggu approval — submit sekarang, build belakangan)
- [ ] Putuskan: shared Postiz instance (dengan SocialNest infra) vs dedicated instance untuk client ini
- [ ] Putuskan: OpenAI (GPT Image/Sora) vs Higgsfield untuk image/video generation

---

## Phase 1 — WordPress path (loop paling mudah, ship pertama)

- [ ] Client buat WordPress Application Password, scoped ke posts+media
- [ ] Extend Airtable: tabel Content Queue (atau field `ca_` prefixed) — topic/brief, content_type, media_urls[], wp_category, status, approval state
- [ ] Setup Claude API + OpenAI/Higgsfield credentials di n8n
- [ ] Research node: Google Trends lookup → candidate topics dengan relative interest score
- [ ] Competitor content gap check (manual/web-search based)
- [ ] Claude API node: generate article copy dari research-based brief
- [ ] Image generation node (GPT Image atau Higgsfield)
- [ ] Approval gate — route ke Telegram bot untuk review/approve
- [ ] WordPress publish: upload media → create post → tulis result balik ke Airtable
- [ ] End-to-end test: satu artikel nyata, brief → research → generate → approve → publish

---

## Phase 2 — Facebook Page + Instagram via Postiz

- [ ] Deploy/konfirmasi Postiz instance (self-hosted)
- [ ] Hubungkan Postiz ke Facebook Page dan Instagram Business account client
- [ ] n8n: generate FB/IG caption variants (Claude) + image
- [ ] n8n: Postiz publish call untuk FB + IG, capture per-channel result
- [ ] End-to-end test: satu post dipublish ke keduanya

---

## Phase 3 — Video content + short-form (Reels/TikTok-style)

- [ ] Video generation node (Sora atau Higgsfield), short-form optimized
- [ ] Route generated video ke FB/IG Postiz publish flow (Reels)

---

## Phase 4 — Nagara Command Center integration

- [ ] Desain panel "Content Automation" (publish status, queue depth, cost tracking)
- [ ] n8n webhook → Command Center saat publish success/failure
- [ ] Cost tracking widget: OpenAI spend, Postiz hosting

---

## Phase 5 — X / Twitter

- [ ] Client approve X API paid tier cost (Basic $200+/bulan) sebagai pass-through
- [ ] Hubungkan Postiz ke X account client
- [ ] n8n: X caption variant (short-form) + publish via Postiz
- [ ] Tambah X API cost ke Command Center cost tracking

---

## Phase 6 — TikTok (API review gate)

- [ ] Konfirmasi TikTok Content Posting API review result dari Phase 0
- [ ] Hubungkan Postiz ke TikTok account client
- [ ] n8n: route short-form video ke TikTok publish via Postiz
- [ ] Catatan: app yang belum diaudit hanya bisa post ke draft/private — set ekspektasi client

---

## Phase 7 — LinkedIn (API access gate)

- [ ] Konfirmasi LinkedIn Marketing Developer Platform approval dari Phase 0
- [ ] Hubungkan Postiz ke LinkedIn Company Page client
- [ ] n8n: generate LinkedIn-formal caption variant + publish via Postiz

---

## Phase 8 — QA & Handoff

- [ ] Full end-to-end test di semua 6 destination dengan satu real client brief
- [ ] Dokumentasi SOP untuk client (cara submit brief, cara approval bekerja)
- [ ] Konfirmasi pricing tier / billing alignment dengan model NADI Starter/Growth/Enterprise
- [ ] Handoff runbook untuk ongoing ops (siapa monitor failures, retry process)
