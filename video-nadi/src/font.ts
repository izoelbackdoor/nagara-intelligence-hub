import { continueRender, delayRender } from 'remotion';

// Font dipilih bebas oleh Art Director, jadi dimuat langsung dari Google Fonts CSS API.
// (@remotion/google-fonts mengimpor ±1.800 font sekaligus saat bundling — terlalu berat untuk runner gratis.)
const dimuat = new Map<string, string>();
const CADANGAN = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const muatFont = (nama: string): string => {
  const n = (nama || '').trim().replace(/[^A-Za-z0-9 ]/g, '');
  if (!n) return CADANGAN;
  if (dimuat.has(n)) return dimuat.get(n)!;
  const keluarga = `"${n}", ${CADANGAN}`;
  dimuat.set(n, keluarga);
  if (typeof document === 'undefined') return keluarga;

  const handle = delayRender(`Memuat font ${n}`, { timeoutInMilliseconds: 20000 });
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(n).replace(/%20/g, '+')}:wght@400;600;700&display=block`;
  const selesai = () => continueRender(handle);
  link.onload = () => {
    Promise.all([document.fonts.load(`700 40px "${n}"`), document.fonts.load(`400 40px "${n}"`)])
      .catch(() => undefined)
      .finally(selesai);
  };
  link.onerror = selesai; // nama font tidak ada di Google Fonts → pakai font sistem
  document.head.appendChild(link);
  return keluarga;
};
