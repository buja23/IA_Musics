import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Layers, Activity, Music, Disc } from 'lucide-react';
import { NoteEvent, DrumMapping, BeatMetadata } from '../types';

interface PianoRollCanvasProps {
  currentTime: number;
  duration: number;
  melodyNotes?: NoteEvent[];
  bassNotes?: NoteEvent[];
  vocalNotes?: NoteEvent[];
  drums?: DrumMapping;
  metadata?: BeatMetadata;
}

type LayerKey = 'melody' | 'bass_808' | 'vocals' | 'drums';

export const PianoRollCanvas: React.FC<PianoRollCanvasProps> = ({
  currentTime,
  duration,
  melodyNotes = [],
  bassNotes = [],
  vocalNotes = [],
  drums,
  metadata,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Filtros de camadas ativos
  const [activeLayers, setActiveLayers] = useState<Record<LayerKey, boolean>>({
    melody: true,
    bass_808: true,
    vocals: true,
    drums: true,
  });

  // Janela de visualização (segundos visíveis na tela)
  const [zoomWindowSeconds, setZoomWindowSeconds] = useState<number>(10);

  const toggleLayer = (layer: LayerKey) => {
    setActiveLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));
  };

  // Cálculo das notas ativas em tempo real
  const currentActiveNotes = useMemo(() => {
    const findActive = (notes: NoteEvent[]) => {
      const active = notes.find((n) => currentTime >= n.start && currentTime <= n.end);
      return active ? active.note_name : '—';
    };

    return {
      melody: findActive(melodyNotes),
      bass: findActive(bassNotes),
      vocals: findActive(vocalNotes),
    };
  }, [currentTime, melodyNotes, bassNotes, vocalNotes]);

  // Faixa de notas MIDI a exibir (ex: MIDI 24/C1 até MIDI 84/C6)
  const minMidi = 24; // C1
  const maxMidi = 84; // C6
  const totalMidiRows = maxMidi - minMidi + 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Ajuste de DPI
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Janela temporal visível centrada ou com playhead a 25% da tela
    const windowStart = Math.max(0, currentTime - zoomWindowSeconds * 0.25);
    const windowEnd = windowStart + zoomWindowSeconds;

    const timeToX = (t: number) => {
      return ((t - windowStart) / zoomWindowSeconds) * width;
    };

    const midiToY = (m: number) => {
      const clamped = Math.max(minMidi, Math.min(maxMidi, m));
      const row = maxMidi - clamped;
      return (row / totalMidiRows) * (height - 90); // deixa espaço inferior para drums
    };

    const noteHeight = Math.max(4, (height - 90) / totalMidiRows);

    // 1. Limpar Fundo
    ctx.fillStyle = '#06090f';
    ctx.fillRect(0, 0, width, height);

    // 2. Grid de Tempo (linhas verticais em tempos ou segundos)
    ctx.lineWidth = 1;
    const bpm = metadata?.bpm || 140;
    const secondsPerBeat = 60 / bpm;
    const firstBeat = Math.floor(windowStart / secondsPerBeat) * secondsPerBeat;

    for (let t = firstBeat; t <= windowEnd; t += secondsPerBeat) {
      const x = timeToX(t);
      ctx.strokeStyle = '#0f172a';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Linhas horizontais sutis para teclas pretas / brancas
    for (let m = minMidi; m <= maxMidi; m++) {
      const y = midiToY(m);
      const isBlack = [1, 3, 6, 8, 10].includes(m % 12);
      ctx.fillStyle = isBlack ? 'rgba(15, 23, 42, 0.4)' : 'rgba(30, 41, 59, 0.15)';
      ctx.fillRect(0, y, width, noteHeight);
    }

    // 3. Renderizar Notas das Camadas
    // A) Melodia (Ciano / Roxo)
    if (activeLayers.melody) {
      ctx.fillStyle = '#b026ff';
      melodyNotes.forEach((n) => {
        if (n.end < windowStart || n.start > windowEnd) return;
        const x1 = timeToX(n.start);
        const x2 = timeToX(n.end);
        const y = midiToY(n.midi);
        const w = Math.max(3, x2 - x1);

        ctx.fillStyle = 'rgba(176, 38, 255, 0.85)';
        ctx.fillRect(x1, y, w, noteHeight - 1);
        ctx.strokeStyle = '#d946ef';
        ctx.strokeRect(x1, y, w, noteHeight - 1);
      });
    }

    // B) Vocais (Rosa Neon)
    if (activeLayers.vocals) {
      vocalNotes.forEach((n) => {
        if (n.end < windowStart || n.start > windowEnd) return;
        const x1 = timeToX(n.start);
        const x2 = timeToX(n.end);
        const y = midiToY(n.midi);
        const w = Math.max(3, x2 - x1);

        ctx.fillStyle = 'rgba(255, 0, 127, 0.75)';
        ctx.fillRect(x1, y, w, noteHeight - 1);
      });
    }

    // C) Baixo / 808 com Curvas de Pitch Bend / Glide (Ciano Neon)
    if (activeLayers.bass_808) {
      bassNotes.forEach((n) => {
        if (n.end < windowStart || n.start > windowEnd) return;
        const x1 = timeToX(n.start);
        const x2 = timeToX(n.end);
        const y = midiToY(n.midi);
        const w = Math.max(3, x2 - x1);

        // Bloco base da nota 808
        ctx.fillStyle = 'rgba(0, 240, 255, 0.8)';
        ctx.fillRect(x1, y, w, noteHeight - 1);
        ctx.strokeStyle = '#00f0ff';
        ctx.strokeRect(x1, y, w, noteHeight - 1);

        // Desenhar Curva de Pitch Bend (Glides)
        if (n.pitch_bend && n.pitch_bend.length > 1) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();

          const bends = n.pitch_bend;
          const stepX = w / (bends.length - 1);

          bends.forEach((b, idx) => {
            const bx = x1 + idx * stepX;
            // Cada semitom de bend sobe ou desce o equivalente a noteHeight
            const by = y + noteHeight / 2 - b * noteHeight;
            if (idx === 0) ctx.moveTo(bx, by);
            else ctx.lineTo(bx, by);
          });
          ctx.stroke();
          ctx.lineWidth = 1;
        }
      });
    }

    // D) Faixa de Bateria no Fundo (Drum Grid)
    if (activeLayers.drums && drums) {
      const drumStartY = height - 85;

      // Divisor
      ctx.strokeStyle = '#1e2b45';
      ctx.beginPath();
      ctx.moveTo(0, drumStartY);
      ctx.lineTo(width, drumStartY);
      ctx.stroke();

      // 3 Linhas dedicadas: Kicks (linha 0), Snares/Claps (linha 1), Hi-Hats (linha 2)
      const drumTracks = [
        { label: 'KICK', hits: drums.kicks, color: '#ff8800', y: drumStartY + 15 },
        { label: 'SNARE', hits: drums.snares_claps, color: '#00f0ff', y: drumStartY + 40 },
        { label: 'HI-HAT', hits: drums.hihats, color: '#00ff66', y: drumStartY + 65 },
      ];

      drumTracks.forEach((track) => {
        ctx.fillStyle = '#64748b';
        ctx.font = '10px "JetBrains Mono"';
        ctx.fillText(track.label, 8, track.y + 4);

        track.hits.forEach((hit) => {
          if (hit.time < windowStart || hit.time > windowEnd) return;
          const x = timeToX(hit.time);
          const radius = Math.max(2, hit.intensity * 5);

          ctx.fillStyle = track.color;
          ctx.beginPath();
          ctx.arc(x, track.y, radius, 0, Math.PI * 2);
          ctx.fill();
        });
      });
    }

    // 4. Playhead (Agulha de Tempo Vermelha/Ciano)
    const playheadX = timeToX(currentTime);
    if (playheadX >= 0 && playheadX <= width) {
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Triângulo indicador no topo do playhead
      ctx.fillStyle = '#00f0ff';
      ctx.beginPath();
      ctx.moveTo(playheadX - 6, 0);
      ctx.lineTo(playheadX + 6, 0);
      ctx.lineTo(playheadX, 8);
      ctx.fill();
    }
  }, [
    currentTime,
    zoomWindowSeconds,
    activeLayers,
    melodyNotes,
    bassNotes,
    vocalNotes,
    drums,
    metadata,
  ]);

  return (
    <div className="w-full bg-surface/90 border border-surface-border rounded-2xl p-4 flex flex-col gap-3 shadow-xl">
      {/* HUD de Notas Ativas e Métricas em Tempo Real */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-highlight/40 border border-surface-border p-3 rounded-xl">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-neon-cyan animate-pulse" />
            <span className="text-xs font-bold text-white tracking-wider">
              ACOMPANHADOR HARMÔNICO
            </span>
          </div>

          {/* Notas Ativas em Tempo Real */}
          <div className="flex items-center gap-2 pl-4 border-l border-surface-border">
            <span className="text-[11px] text-gray-400">NOTA ATUAL:</span>
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded bg-neon-purple/20 border border-neon-purple/40 text-neon-purple text-xs font-bold">
                Melodia: {currentActiveNotes.melody}
              </span>
              <span className="px-2 py-0.5 rounded bg-neon-cyan/20 border border-neon-cyan/40 text-neon-cyan text-xs font-bold">
                808: {currentActiveNotes.bass}
              </span>
              <span className="px-2 py-0.5 rounded bg-neon-pink/20 border border-neon-pink/40 text-neon-pink text-xs font-bold">
                Voz: {currentActiveNotes.vocals}
              </span>
            </div>
          </div>
        </div>

        {/* Informações Globais da Faixa (BPM & Escala) */}
        <div className="flex items-center gap-3 text-xs">
          {metadata?.bpm && (
            <div className="bg-surface px-2.5 py-1 rounded border border-surface-border">
              <span className="text-gray-400">BPM: </span>
              <span className="text-neon-cyan font-bold">{metadata.bpm}</span>
            </div>
          )}
          {metadata?.key && (
            <div className="bg-surface px-2.5 py-1 rounded border border-surface-border">
              <span className="text-gray-400">ESCALA: </span>
              <span className="text-neon-pink font-bold">{metadata.key}</span>
            </div>
          )}
        </div>
      </div>

      {/* Seletor de Camadas / Filtros */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-[11px] text-gray-400">Camadas:</span>

          <button
            onClick={() => toggleLayer('melody')}
            className={`px-2 py-1 rounded text-[10px] font-bold border transition-all cursor-pointer ${
              activeLayers.melody
                ? 'bg-neon-purple/20 border-neon-purple text-neon-purple'
                : 'bg-surface-highlight border-surface-border text-gray-500'
            }`}
          >
            Melodia
          </button>

          <button
            onClick={() => toggleLayer('bass_808')}
            className={`px-2 py-1 rounded text-[10px] font-bold border transition-all cursor-pointer ${
              activeLayers.bass_808
                ? 'bg-neon-cyan/20 border-neon-cyan text-neon-cyan'
                : 'bg-surface-highlight border-surface-border text-gray-500'
            }`}
          >
            808 (c/ Glides)
          </button>

          <button
            onClick={() => toggleLayer('vocals')}
            className={`px-2 py-1 rounded text-[10px] font-bold border transition-all cursor-pointer ${
              activeLayers.vocals
                ? 'bg-neon-pink/20 border-neon-pink text-neon-pink'
                : 'bg-surface-highlight border-surface-border text-gray-500'
            }`}
          >
            Vocais
          </button>

          <button
            onClick={() => toggleLayer('drums')}
            className={`px-2 py-1 rounded text-[10px] font-bold border transition-all cursor-pointer ${
              activeLayers.drums
                ? 'bg-neon-orange/20 border-neon-orange text-neon-orange'
                : 'bg-surface-highlight border-surface-border text-gray-500'
            }`}
          >
            Bateria (Grid)
          </button>
        </div>

        {/* Zoom temporal */}
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="text-[10px]">Zoom:</span>
          {[5, 10, 20].map((sec) => (
            <button
              key={sec}
              onClick={() => setZoomWindowSeconds(sec)}
              className={`px-1.5 py-0.5 rounded text-[10px] border cursor-pointer ${
                zoomWindowSeconds === sec
                  ? 'bg-surface-highlight border-neon-cyan text-neon-cyan'
                  : 'bg-surface border-surface-border text-gray-500'
              }`}
            >
              {sec}s
            </button>
          ))}
        </div>
      </div>

      {/* Canvas do Piano Roll */}
      <div className="w-full h-64 bg-background rounded-xl border border-surface-border overflow-hidden relative">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
    </div>
  );
};
