// Dipakai GitHub Actions setelah render: unggah MP4 ke Supabase Storage (signed upload URL) lalu lapor ke database.
// Argumen: "ok" atau "gagal". Tanpa secret: upload memakai URL bertanda tangan sekali pakai,
// laporan memakai RPC desain_render_hasil yang memeriksa token per render.
import { readFile } from 'node:fs/promises';

const status = process.argv[2] || 'gagal';
let meta;
try { meta = JSON.parse(await readFile('meta.json', 'utf8')); }
catch {
  const ev = process.env.GITHUB_EVENT_PATH ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const p = JSON.parse(ev?.inputs?.payload || process.env.PAYLOAD || '{}');
  meta = { id: p.id, token: p.token, upload_url: p.upload_url, callback_url: p.callback_url, anon_key: p.anon_key };
}
if (!meta?.callback_url) { console.log('Tidak ada callback_url'); process.exit(0); }

const lapor = async (ok, error) => {
  const r = await fetch(meta.callback_url, {
    method: 'POST',
    headers: { apikey: meta.anon_key, Authorization: 'Bearer ' + meta.anon_key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_id: meta.id, p_token: meta.token, p_ok: ok, p_error: error || null }),
  });
  console.log('Laporan ke database:', r.status, (await r.text()).slice(0, 200));
};

if (status !== 'ok') {
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  await lapor(false, 'Render gagal di GitHub Actions: ' + runUrl);
  process.exit(0);
}

const video = await readFile('out/video.mp4');
const up = await fetch(meta.upload_url, {
  method: 'PUT',
  headers: { 'Content-Type': 'video/mp4', 'x-upsert': 'true', apikey: meta.anon_key },
  body: video,
});
if (!up.ok) {
  const t = (await up.text()).slice(0, 300);
  console.log('Upload gagal:', up.status, t);
  await lapor(false, `Upload ke storage gagal (${up.status}): ${t}`);
  process.exit(1);
}
console.log(`Terunggah ${(video.length / 1e6).toFixed(1)} MB`);
await lapor(true, null);
