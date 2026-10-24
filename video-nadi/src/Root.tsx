import React from 'react';
import { Composition, type CalculateMetadataFunction } from 'remotion';
import { VideoNADI } from './VideoNADI';
import { contohProps, FPS, TRANSISI, type VideoProps } from './types';

const HEX = /^#[0-9a-f]{6}$/i;

// Durasi total = semua adegan + penutup − overlap transisi. Props dirapikan supaya input agen yang
// kurang rapi (durasi aneh, warna salah) tidak menggagalkan render.
const calculateMetadata: CalculateMetadataFunction<VideoProps> = ({ props }) => {
  const palet = {
    dasar: HEX.test(props.palet?.dasar) ? props.palet.dasar : '#241E1A',
    tinta: HEX.test(props.palet?.tinta) ? props.palet.tinta : '#FFFFFF',
    aksen: HEX.test(props.palet?.aksen) ? props.palet.aksen : '#FF7A2E',
  };
  const adegan = (props.adegan || [])
    .filter((a) => /^(https?:\/\/|media\/)/.test(a.sumber || ''))
    .slice(0, 8)
    .map((a) => ({ ...a, jenis: a.jenis === 'image' ? ('image' as const) : ('video' as const), durasi: Math.min(15, Math.max(1.5, Number(a.durasi) || 4)) }));
  const penutup = { teks: props.penutup?.teks || props.judul || '', sub: props.penutup?.sub, durasi: Math.min(6, Math.max(2, Number(props.penutup?.durasi) || 3)) };
  const frames = adegan.reduce((s, a) => s + Math.round(a.durasi * FPS), 0) + Math.round(penutup.durasi * FPS) - adegan.length * TRANSISI;
  return { durationInFrames: Math.max(FPS, frames), props: { ...props, palet, adegan, penutup } };
};

export const Root: React.FC = () => (
  <Composition
    id="VideoNADI"
    component={VideoNADI}
    fps={FPS}
    width={1080}
    height={1920}
    durationInFrames={FPS * 10}
    defaultProps={contohProps}
    calculateMetadata={calculateMetadata}
  />
);
