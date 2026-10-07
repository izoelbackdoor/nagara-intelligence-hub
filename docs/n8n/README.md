# Menyambungkan Hermes (n8n) ke Virtual Office

1. Credentials → New → **Header Auth**, nama **NGI Office Token**
   - Name: `Authorization` · Value: `Bearer <OFFICE_INGEST_TOKEN>`
2. Import 2 workflow (Workflows → Import from File):
   - `ngi-office-lapor.json` — sub-workflow "Lapor ke Kantor"
   - `ngi-office-heartbeat-hermes.json` — heartbeat tiap 10 menit → **Activate**
   Di node HTTP, pilih credential "NGI Office Token".
3. Di workflow Hermes, tambahkan node **Execute Workflow** (pilih "NGI Office · Lapor ke Kantor")
   di 4 titik, dengan input JSON:
   | Titik | Isi |
   |---|---|
   | Riset selesai | `{"message":"Riset topik: {{judul}}"}` |
   | Draft lolos QA | `{"message":"Draft lolos QA: {{judul}}"}` |
   | Kirim approval Telegram | `{"type":"approval","kind":"publikasi","summary":"Post FB: {{judul}}"}` |
   | Terbit / gagal | `{"message":"Terbit di FB: {{judul}}"}` atau `{"level":"peringatan","message":"Gagal terbit: {{error}}"}` |
   Set node Execute Workflow → Settings → **On Error: Continue**, supaya Hermes tetap jalan walau kantor sedang gangguan.
