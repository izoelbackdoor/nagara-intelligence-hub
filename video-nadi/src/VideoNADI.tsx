import { Audio, Video } from '@remotion/media';
import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

// Sumber dari props: URL (Studio/pratinjau) atau path relatif ke public/ (hasil unduhan siapkan.mjs saat render CI)
const src = (s: string) => (/^https?:\/\//.test(s) ? s : staticFile(s));
import { muatFont } from './font';
import { TRANSISI, type Adegan, type VideoProps } from './types';

const PAD = 72; // margin aman kiri-kanan untuk 1080 lebar

// Teks besar: masuk dari bawah dengan sedikit fade. Satu momen gerak per adegan.
const TeksLayar: React.FC<{ teks: string; font: string; warna: string }> = ({ teks, font, warna }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        fontFamily: font, color: warna, fontSize: 96, lineHeight: 1.0, letterSpacing: '-0.03em', fontWeight: 700,
        textWrap: 'balance', maxWidth: 1080 - PAD * 2,
        textShadow: '0 2px 24px rgba(0,0,0,.35)',
        opacity: interpolate(frame, [0.15 * fps, 0.6 * fps], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        translate: interpolate(frame, [0.15 * fps, 0.8 * fps], ['0px 48px', '0px 0px'], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
      }}
    >
      {teks}
    </div>
  );
};

const Subtitle: React.FC<{ teks: string; font: string; dasar: string; tinta: string }> = ({ teks, font, dasar, tinta }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        fontFamily: font, fontSize: 40, lineHeight: 1.35, fontWeight: 600, color: tinta, background: dasar,
        padding: '14px 22px', alignSelf: 'flex-start', maxWidth: 1080 - PAD * 2,
        opacity: interpolate(frame, [0.4 * fps, 0.8 * fps], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
      }}
    >
      {teks}
    </div>
  );
};

const Latar: React.FC<{ a: Adegan }> = ({ a }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  if (a.jenis === 'video') {
    return <Video src={src(a.sumber)} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  }
  // Gambar diam: zoom pelan (Ken Burns) supaya tetap hidup
  return (
    <Img
      src={src(a.sumber)}
      style={{
        width: '100%', height: '100%', objectFit: 'cover',
        scale: interpolate(frame, [0, durationInFrames], [1, 1.08], { extrapolateRight: 'clamp' }),
      }}
    />
  );
};

const AdeganView: React.FC<{ a: Adegan; p: VideoProps; fJudul: string; fIsi: string }> = ({ a, p, fJudul, fIsi }) => (
  <AbsoluteFill style={{ background: p.palet.dasar }}>
    <AbsoluteFill><Latar a={a} /></AbsoluteFill>
    {(a.teks || a.subtitle) && (
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end', padding: `0 ${PAD}px 220px`, gap: 28,
          // scrim netral hanya di bagian bawah agar teks terbaca di atas foto/video
          background: 'linear-gradient(to top, rgba(0,0,0,.55) 0%, rgba(0,0,0,0) 45%)',
        }}
      >
        {a.teks ? <TeksLayar teks={a.teks} font={fJudul} warna={p.palet.tinta} /> : null}
        {a.subtitle ? <Subtitle teks={a.subtitle} font={fIsi} dasar={p.palet.dasar} tinta={p.palet.tinta} /> : null}
      </AbsoluteFill>
    )}
  </AbsoluteFill>
);

const Penutup: React.FC<{ p: VideoProps; fJudul: string; fIsi: string }> = ({ p, fJudul, fIsi }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: p.palet.dasar, justifyContent: 'center', padding: `0 ${PAD}px`, gap: 36 }}>
      <div
        style={{
          fontFamily: fJudul, fontSize: 120, lineHeight: 0.98, letterSpacing: '-0.035em', fontWeight: 700,
          color: p.palet.tinta, textWrap: 'balance',
          opacity: interpolate(frame, [0, 0.5 * fps], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          translate: interpolate(frame, [0, 0.7 * fps], ['0px 40px', '0px 0px'], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        {p.penutup.teks}
      </div>
      {p.penutup.sub ? (
        <div
          style={{
            fontFamily: fIsi, fontSize: 44, fontWeight: 700, color: p.palet.dasar, background: p.palet.aksen,
            padding: '20px 30px', alignSelf: 'flex-start',
            opacity: interpolate(frame, [0.4 * fps, 0.9 * fps], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          }}
        >
          {p.penutup.sub}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const VideoNADI: React.FC<VideoProps> = (p) => {
  const { fps } = useVideoConfig();
  const fJudul = muatFont(p.font_judul);
  const fIsi = muatFont(p.font_isi);
  const items: React.ReactNode[] = [];
  p.adegan.forEach((a, i) => {
    if (i > 0) items.push(<TransitionSeries.Transition key={'t' + i} presentation={fade()} timing={linearTiming({ durationInFrames: TRANSISI })} />);
    items.push(
      <TransitionSeries.Sequence key={'a' + i} durationInFrames={Math.round(a.durasi * fps)}>
        <AdeganView a={a} p={p} fJudul={fJudul} fIsi={fIsi} />
      </TransitionSeries.Sequence>,
    );
  });
  if (p.adegan.length) items.push(<TransitionSeries.Transition key="tp" presentation={fade()} timing={linearTiming({ durationInFrames: TRANSISI })} />);
  items.push(
    <TransitionSeries.Sequence key="penutup" durationInFrames={Math.round((p.penutup.durasi || 3) * fps)}>
      <Penutup p={p} fJudul={fJudul} fIsi={fIsi} />
    </TransitionSeries.Sequence>,
  );
  return (
    <AbsoluteFill style={{ background: p.palet.dasar }}>
      <TransitionSeries>{items}</TransitionSeries>
      {p.musik ? <Audio src={src(p.musik)} volume={0.5} /> : null}
    </AbsoluteFill>
  );
};
