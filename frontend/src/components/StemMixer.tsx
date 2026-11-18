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

  return (
    <aside className="w-full lg:w-80 bg-[#0f172a]/90 border border-slate-800/80 p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-neon-cyan" />
          <h2 className="text-white text-sm font-bold tracking-wider">
            STEM MIXER
          </h2>
        </div>
        <div className="text-[10px] text-gray-400 bg-surface-highlight px-2 py-0.5 rounded border border-surface-border">
          4 CANAIS
        </div>
      </div>

      {/* Master Volume */}
      <div className="bg-surface-highlight/40 border border-surface-border rounded-xl p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-300 font-bold flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 text-neon-cyan" />
            Master
          </span>
          <span className="text-neon-cyan font-mono text-[11px]">
            {Math.round(masterVolume * 100)}%
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={masterVolume}
          onChange={(e) => onMasterVolumeChange(parseFloat(e.target.value))}
          className="w-full accent-neon-cyan h-1.5 bg-surface-border rounded-lg cursor-pointer"
        />
      </div>

      {/* Lista de Canais de Stems */}
      <div className="flex flex-col gap-2.5">
        {CHANNELS_CONFIG.map((conf) => {
          const ch = channels[conf.key];
          const wavUrl = stemsUrls[conf.key];

          return (
            <div
              key={conf.key}
              className={`bg-surface-highlight/30 border rounded-xl p-3 flex flex-col gap-2 transition-all ${
                ch.solo
                  ? 'border-neon-cyan bg-neon-cyan/5 shadow-cyan-glow'
                  : ch.muted
                  ? 'border-surface-border opacity-60'
                  : 'border-surface-border hover:border-surface-border/80'
              }`}
            >
              {/* Header do Canal */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${conf.accentBg}`} />
                  <div>
                    <h3 className={`text-xs font-bold ${conf.color}`}>
                      [{CHANNELS_CONFIG.indexOf(conf) + 1}] {conf.title}
                    </h3>
                    <p className="text-[10px] text-gray-400 font-sans">
                      {conf.subtitle}
                    </p>
                  </div>
                </div>

                {/* Mute & Solo Buttons */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onToggleMute(conf.key)}
                    className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold transition-all cursor-pointer ${
                      ch.muted
                        ? 'bg-red-500/80 text-white shadow-sm'
                        : 'bg-surface-highlight text-gray-400 hover:text-white border border-surface-border'
                    }`}
                    title={ch.muted ? 'Desmutar' : 'Mutar (M)'}
                  >
                    M
                  </button>

                  <button
                    onClick={() => onToggleSolo(conf.key)}
                    className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold transition-all cursor-pointer ${
                      ch.solo
                        ? 'bg-neon-cyan text-black shadow-cyan-glow font-black'
                        : 'bg-surface-highlight text-gray-400 hover:text-white border border-surface-border'
                    }`}
                    title={ch.solo ? 'Desativar Solo' : 'Solo (S)'}
                  >
                    S
                  </button>
                </div>
              </div>

              {/* Slider de Volume individual */}
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={ch.muted ? 0 : ch.volume}
                  disabled={ch.muted}
                  onChange={(e) => onVolumeChange(conf.key, parseFloat(e.target.value))}
                  className="w-full accent-neon-cyan h-1 bg-surface-border rounded-lg cursor-pointer disabled:opacity-30"
                />
                <span className="text-[10px] text-gray-400 font-mono w-10 text-right">
                  {ch.muted ? '0%' : `${Math.round(ch.volume * 100)}%`}
                </span>
              </div>

              <div className="h-[3px] w-full overflow-hidden bg-slate-800/80" aria-label={`Nivel ${conf.title}`}>
                <div
                  className="h-full bg-[#00f0ff] transition-[width] duration-75"
                  style={{ width: `${Math.min(100, vuLevels[conf.key] * 100)}%`, backgroundColor: conf.key === 'vocals' ? '#f43f5e' : conf.key === 'drums' ? '#10b981' : conf.key === 'bass' ? '#00f0ff' : '#a855f7' }}
                />
              </div>

              {/* Download rápido de WAV */}
              {wavUrl && (
                <div className="pt-1 flex items-center justify-end">
                  <a
                    href={getFullUrl(wavUrl)}
                    download={`${conf.key}.wav`}
                    className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-neon-cyan transition-colors"
                    title={`Baixar ${conf.title} em WAV`}
                  >
                    <Download className="w-3 h-3" />
                    <span>.wav</span>
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Exportação de MIDIs Transcritos */}
      {midiFiles && (
        <div className="border-t border-surface-border pt-3 flex flex-col gap-2">
          <h4 className="text-[11px] font-bold text-gray-300 flex items-center gap-1.5">
            <FileCode className="w-3.5 h-3.5 text-neon-green" />
            Arquivos MIDI Gerados
          </h4>
          <div className="grid grid-cols-1 gap-1.5">
            {midiFiles.melody && (
              <a
                href={getFullUrl(midiFiles.melody)}
                download="melody.mid"
                className="flex items-center justify-between text-xs bg-surface-highlight/40 hover:bg-neon-purple/10 border border-surface-border hover:border-neon-purple/50 px-2.5 py-1.5 rounded transition-all text-gray-300 hover:text-neon-purple"
              >
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-neon-purple" />
                  Melodia (.mid)
                </span>
                <Download className="w-3.5 h-3.5" />
              </a>
            )}

            {midiFiles.bass_808 && (
              <a
                href={getFullUrl(midiFiles.bass_808)}
                download="bass_808.mid"
                className="flex items-center justify-between text-xs bg-surface-highlight/40 hover:bg-neon-cyan/10 border border-surface-border hover:border-neon-cyan/50 px-2.5 py-1.5 rounded transition-all text-gray-300 hover:text-neon-cyan"
              >
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan" />
                  Baixo 808 (.mid)
                </span>
                <Download className="w-3.5 h-3.5" />
              </a>
            )}

            {midiFiles.vocals && (
              <a
                href={getFullUrl(midiFiles.vocals)}
                download="vocals.mid"
                className="flex items-center justify-between text-xs bg-surface-highlight/40 hover:bg-neon-pink/10 border border-surface-border hover:border-neon-pink/50 px-2.5 py-1.5 rounded transition-all text-gray-300 hover:text-neon-pink"
              >
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-neon-pink" />
                  Vocais (.mid)
                </span>
                <Download className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
