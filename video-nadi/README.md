# video-nadi

Template video vertikal (1080×1920) Studio Desain NADI, dibuat dengan [Remotion](https://www.remotion.dev).
Dirender gratis oleh GitHub Actions (`.github/workflows/render-video.yml`), dipicu workflow n8n **NADI 6 - Studio Desain**.

- Komposisi `VideoNADI` (`src/VideoNADI.tsx`): adegan klip/keyframe dengan teks besar + subtitle, transisi fade, penutup CTA. Props: `src/types.ts`.
- `scripts/siapkan.mjs` mengunduh media ke `public/media/` lalu menulis `props.json`; `scripts/lapor.mjs` mengunggah MP4 ke Supabase Storage dan memanggil RPC `desain_render_hasil`.
- Pratinjau lokal: `npm install && npm run studio`.
- Lisensi Remotion: gratis untuk perorangan & perusahaan ≤3 karyawan (lihat remotion.dev/license).
