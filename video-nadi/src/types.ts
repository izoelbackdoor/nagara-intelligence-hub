// Props yang dikirim database (desain_media_antrian) → n8n → GitHub Actions → render.
export type Adegan = {
  /** URL klip video (Higgsfield) atau gambar keyframe. */
  sumber: string;
  jenis: 'video' | 'image';
  /** Lama adegan dalam detik (1–15). */
  durasi: number;
  /** Teks besar di layar (maks ±6 kata). Kosong = tanpa teks. */
  teks?: string;
  /** Subtitle / narasi singkat di bawah. */
  subtitle?: string;
};

export type VideoProps = {
  judul: string;
  palet: { dasar: string; tinta: string; aksen: string };
  font_judul: string;
  font_isi: string;
  adegan: Adegan[];
  penutup: { teks: string; sub?: string; durasi?: number };
  /** Opsional: URL musik latar (bebas royalti). */
  musik?: string;
};

export const FPS = 30;
export const TRANSISI = 10; // frame overlap antar-adegan

export const contohProps: VideoProps = {
  judul: 'Contoh video NADI',
  palet: { dasar: '#2B1D15', tinta: '#FFF8EE', aksen: '#F2C14E' },
  font_judul: 'Fraunces',
  font_isi: 'Inter',
  adegan: [
    { sumber: 'https://remotion.media/video.mp4', jenis: 'video', durasi: 4, teks: 'Sore lebih pelan', subtitle: 'Pulang kerja nggak harus buru-buru.' },
    { sumber: 'https://remotion.media/video.mp4', jenis: 'video', durasi: 4, teks: 'Kopi gula aren', subtitle: 'Diseduh pelan, manisnya pas.' },
  ],
  penutup: { teks: 'Mampir ke Dago', sub: 'Buka jam 3 sore · pesan via WhatsApp', durasi: 3 },
};
