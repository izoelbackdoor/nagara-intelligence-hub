// Dipakai GitHub Actions sebelum render.
// Input : env PAYLOAD (JSON dari n8n: { id, token, props, upload_url, callback_url, anon_key })
// Output: props.json (sumber media sudah diunduh ke public/media/*, path relatif) + meta.json (untuk upload & callback)
// Media diunduh dulu supaya render tidak bergantung pada CORS CDN generator.
import { mkdir, writeFile } from 'node:fs/promises';

const raw = process.env.PAYLOAD;
if (!raw) throw new Error('PAYLOAD kosong');
const p = JSON.parse(raw);
if (!p?.props || !p?.upload_url || !p?.callback_url) throw new Error('PAYLOAD tidak lengkap');

await mkdir('public/media', { recursive: true });
const props = p.props;
const ext = (url, ct) => {
  const m = String(url).split('?')[0].match(/\.(mp4|webm|mov|png|jpe?g|webp|mp3|m4a|wav)$/i);
  if (m) return m[1].toLowerCase();
  if (/video/.test(ct)) return 'mp4';
  if (/png/.test(ct)) return 'png';
  if (/webp/.test(ct)) return 'webp';
  if (/audio/.test(ct)) return 'mp3';
  return 'jpg';
};
const unduh = async (url, nama) => {
  if (!/^https:\/\//.test(String(url || ''))) return null;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const file = `media/${nama}.${ext(url, r.headers.get('content-type') || '')}`;
      await writeFile('public/' + file, Buffer.from(await r.arrayBuffer()));
      return file;
    } catch (e) {
      console.log(`Gagal unduh ${nama} (percobaan ${i + 1}): ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 3000));
    }
  }
  return null;
};

const adegan = [];
for (const [i, a] of (props.adegan || []).entries()) {
  const f = await unduh(a.sumber, 'adegan-' + (i + 1));
  if (f) adegan.push({ ...a, sumber: f });
  else console.log(`Adegan ${i + 1} dilewati (media tidak bisa diunduh)`);
}
if (!adegan.length) throw new Error('Tidak ada media adegan yang bisa diunduh');
props.adegan = adegan;
if (props.musik) props.musik = (await unduh(props.musik, 'musik')) || undefined;

await writeFile('props.json', JSON.stringify(props));
await writeFile('meta.json', JSON.stringify({ id: p.id, token: p.token, upload_url: p.upload_url, callback_url: p.callback_url, anon_key: p.anon_key }));
console.log(`Siap: ${adegan.length} adegan.`);
