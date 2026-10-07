# Lapor ke Virtual Office dari agen (n8n / Hermes)

Endpoint: `POST https://<domain-dashboard>/api/office/state`
Header: `Authorization: Bearer <OFFICE_INGEST_TOKEN>` · `Content-Type: application/json`

Token disimpan di Vercel (env `OFFICE_INGEST_TOKEN`, min. 32 karakter) dan di n8n sebagai
credential "Header Auth" — jangan ditulis langsung di node.

## Jenis laporan

| type | body | efek di kantor |
|---|---|---|
| `heartbeat` | `{"desk":"hermes","type":"heartbeat"}` | status meja jadi **online** (15 menit) |
| `event` (default) | `{"desk":"hermes","message":"Draft 'tips parenting' lolos QA","level":"info"}` | masuk tab Aktivitas; level: info · teknis · peringatan · bahaya |
| `approval` | `{"desk":"hermes","type":"approval","kind":"publikasi","summary":"Post FB: tips parenting"}` | masuk tab Persetujuan + Aktivitas |

`desk` harus kunci meja yang ada (mis. `hermes`, `fb-engine`). Pesan maks. 500 karakter.

## Titik lapor yang disarankan untuk Hermes
1. Selesai riset topik → `event`
2. Draft selesai / lolos QA → `event`
3. Kirim ke Telegram untuk approval → `approval` (kind `publikasi`)
4. Terbit / gagal terbit → `event` (gagal = level `peringatan`)
5. Cron tiap 10 menit → `heartbeat`
