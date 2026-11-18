import React, { useEffect, useState } from 'react';
import { Volume2, VolumeX, Download, FileCode, Sliders } from 'lucide-react';
import { StemType, StemChannelState, MidiFiles, EnergyEnvelopes } from '../types';
import type { MutableRefObject } from 'react';

interface StemMixerProps {
  channels: Record<StemType, StemChannelState>;
  onToggleMute: (stem: StemType) => void;
  onToggleSolo: (stem: StemType) => void;
  onVolumeChange: (stem: StemType, val: number) => void;
  stemsUrls: Record<StemType, string>;
  midiFiles?: MidiFiles;
  masterVolume: number;
  onMasterVolumeChange: (val: number) => void;
  getFrequencyData?: () => Uint8Array;
  envelopes?: EnergyEnvelopes;
  effectiveGainsRef?: MutableRefObject<Record<StemType, number>>;
  currentTime: number;
}

interface ChannelMeta {
  key: StemType;
  title: string;
  subtitle: string;
  color: string;
  borderColor: string;
  accentBg: string;
}

const CHANNELS_CONFIG: ChannelMeta[] = [
  {
    key: 'drums',
    title: 'Bateria',
    subtitle: 'Kicks / Snares / Hats',
    color: 'text-neon-orange',
    borderColor: 'border-neon-orange/40',
    accentBg: 'bg-neon-orange',
  },
  {
    key: 'bass',
    title: 'Baixo / 808',
    subtitle: 'Sub-bass & Glides',
    color: 'text-neon-cyan',
    borderColor: 'border-neon-cyan/40',
    accentBg: 'bg-neon-cyan',
  },
  {
    key: 'other',
    title: 'Melodia',
    subtitle: 'Synths & Instrumentos',
    color: 'text-neon-purple',
    borderColor: 'border-neon-purple/40',
    accentBg: 'bg-neon-purple',
  },
  {
    key: 'vocals',
    title: 'Vocais',
    subtitle: 'Voz / Ad-libs',
    color: 'text-neon-pink',
    borderColor: 'border-neon-pink/40',
    accentBg: 'bg-neon-pink',
  },
];

const BACKEND_URL = 'http://localhost:8000';

export const StemMixer: React.FC<StemMixerProps> = ({
  channels,
  onToggleMute,
  onToggleSolo,
  onVolumeChange,
  stemsUrls,
  midiFiles,
  masterVolume,
  onMasterVolumeChange,
  getFrequencyData,
  envelopes,
  effectiveGainsRef,
  currentTime,
}) => {
  const [vuLevels, setVuLevels] = useState<Record<StemType, number>>({ drums: 0, bass: 0, other: 0, vocals: 0 });
  useEffect(() => {
    const timer = window.setInterval(() => {
      const frame = Math.floor(currentTime * 30);
      const gains = effectiveGainsRef?.current;
      setVuLevels({
        drums: (envelopes?.drums?.[frame] ?? 0) * (gains?.drums ?? 1),
        bass: (envelopes?.bass?.[frame] ?? 0) * (gains?.bass ?? 1),
        other: (envelopes?.other?.[frame] ?? 0) * (gains?.other ?? 1),
        vocals: (envelopes?.vocals?.[frame] ?? 0) * (gains?.vocals ?? 1),
      });
    }, 60);
    return () => window.clearInterval(timer);
  }, [currentTime, envelopes, effectiveGainsRef]);
  const getFullUrl = (path: string) => {
    if (path.startsWith('http')) return path;
    return `${BACKEND_URL}${path.startsWith('/') ? '' : '/'}${path}`;
  };

  const masterMuted = false;
  const channelConfigs = [
    { key: null as StemType | null, title: 'Master', index: '', color: '#d4d8de' },
    { key: 'drums' as StemType, title: 'Drums', index: '1', color: '#76e068' },
    { key: 'bass' as StemType, title: '808', index: '2', color: '#ff7b00' },
    { key: 'other' as StemType, title: 'Melody', index: '3', color: '#7ce073' },
    { key: 'vocals' as StemType, title: 'Vocals', index: '4', color: '#fb7185' },
  ];

  return (
    <aside className="w-[310px] shrink-0 bg-[#282d33] border-l border-[#121417] flex flex-col">
      <div className="h-[26px] bg-[#2c323a] border-b border-[#121417] px-2 flex items-center justify-between">
        <span className="text-[11px] font-mono text-[#d5dae0]">Mixer — Trap AI</span>
        <span className="text-[9px] font-mono text-[#76e068]">48 kHz</span>
      </div>
      <div className="flex-1 grid grid-cols-5 gap-px bg-[#121417] p-px">
        {channelConfigs.map((conf) => {
          const ch = conf.key ? channels[conf.key] : null;
          const level = conf.key ? vuLevels[conf.key] : masterVolume;
          const litSegments = Math.round(level * 14);
          return (
            <div key={conf.title} className="min-w-0 bg-[#1e2226] flex flex-col items-center py-1.5">
              <div className="h-1 w-full mb-1" style={{ backgroundColor: conf.color }} />
              <div className="h-7 text-[9px] font-mono text-[#d5dae0] text-center leading-3">{conf.index && `[${conf.index}]`}<br />{conf.title}</div>

              {ch ? (
                <button onClick={() => onToggleMute(conf.key as StemType)} title={ch.muted ? 'Ativar canal' : 'Mutar canal'} className={`mt-1 h-3 w-3 rounded-full border border-[#121417] ${ch.muted ? 'bg-[#323840]' : 'bg-[#4ade80] shadow-[0_0_5px_#4ade80]'}`} />
              ) : <span className="mt-1 h-3 w-3 rounded-full border border-[#121417] bg-[#4ade80] shadow-[0_0_5px_#4ade80]" />}

              {ch && <button onClick={() => onToggleSolo(conf.key as StemType)} className={`mt-1 h-5 w-5 border border-[#121417] text-[9px] font-mono ${ch.solo ? 'bg-[#ff7b00] text-[#181b1f]' : 'bg-[#323840] text-[#d5dae0]'}`}>S</button>}

              <div className="mt-2 flex-1 min-h-[150px] w-full flex items-center justify-center gap-1">
                <div className="h-full w-3 bg-[#131619] border border-[#121417] flex flex-col-reverse gap-px p-px">
                  {Array.from({ length: 14 }).map((_, index) => {
                    const active = index < litSegments;
                    const color = index >= 12 ? '#ef4444' : index >= 9 ? '#f59e0b' : '#76e068';
                    return <span key={index} className="h-2 w-full" style={{ backgroundColor: active ? color : '#323840' }} />;
                  })}
                </div>
                <div className="h-full flex flex-col justify-between text-[7px] font-mono text-[#7e8791] py-1"><span>0</span><span>-6</span><span>-12</span><span>-24</span></div>
              </div>

              {conf.key ? (
                <input aria-label={`Fader ${conf.title}`} type="range" min="0" max="1" step="0.01" value={ch?.muted ? 0 : ch?.volume ?? 0.85} onChange={(event) => onVolumeChange(conf.key as StemType, parseFloat(event.target.value))} className="hardware-fader w-5 h-14 mt-1" style={{ writingMode: 'vertical-lr', direction: 'rtl' }} />
              ) : (
                <input aria-label="Fader Master" type="range" min="0" max="1" step="0.01" value={masterVolume} onChange={(event) => onMasterVolumeChange(parseFloat(event.target.value))} className="hardware-fader w-5 h-14 mt-1" style={{ writingMode: 'vertical-lr', direction: 'rtl' }} />
              )}
              <div className="mt-1 text-[8px] font-mono text-[#76e068]">{conf.key ? (ch?.muted ? '-INF' : `${Math.round((ch?.volume ?? 0) * 100)}%`) : `${Math.round(masterVolume * 100)}%`}</div>
            </div>
          );
        })}
      </div>
    </aside>
  );
};
